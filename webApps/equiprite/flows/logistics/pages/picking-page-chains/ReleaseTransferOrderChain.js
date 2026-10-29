define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/releaseTransferOrder',
  'resources/js/requestLineBody',
  'resources/js/currentUser'
], (ActionChain, Actions, rto, lineBody, cu) => {
  'use strict';

  // ojkeyset is no longer imported here: the table-selection reset it was used
  // for belonged to the dialog close, which this chain no longer performs.
  // closePickingDrawerChain owns that now (and always did for the X button).

  // sourceOrg MUST match the org the TO was actually CREATED against, or the
  // release resolves a different Fusion organization and fails (or worse,
  // releases against the wrong yard).
  //
  // This used to be a hardcoded '001', kept "in lock-step" with a
  // PAYLOAD_DEFAULTS.SourceOrganizationCode constant that no longer exists:
  // Confirm now resolves the source yard PER LINE from its allocations (or the
  // picked Yard), and fans out one TO per source yard. A TO created from
  // Atlanta ('002') was therefore being released against Seattle.
  //
  // Resolved instead from the REQUEST LINE the TO is mapped to. The line
  // carries the codes Confirm stamped on it at creation time
  // (lineSourceOrgCode), which is the same value that went to OIC — so this is
  // a read-back of what was sent, not a re-derivation.
  //
  // EQR_TRANSFER_ORDER.SOURCE_ORG_CODE would be the tidier source and the DTO
  // exposes it, but OIC does not populate it (0 of 191 rows), so the line is the
  // only reliable answer today. If that changes, prefer the TO row.
  //
  // Falls back to null → the shared module omits sourceOrg entirely rather than
  // sending a guessed yard, and OIC reports the failure. Never guess: releasing
  // against the wrong org is a real inventory movement.
  async function resolveSourceOrgCode(context, Actions, transferOrderId, requestId) {
    try {
      const toLinesResp = await Actions.callRest(context, {
        endpoint:  'eqp-v1/getTransferOrderLines',
        uriParams: { transferOrderId: Number(transferOrderId) }
      });
      const toLines = (toLinesResp && toLinesResp.ok && toLinesResp.body && toLinesResp.body.data) || [];
      const lineIds = toLines.map(tl => Number(tl.requestLineId)).filter(id => id);
      if (!lineIds.length || !requestId) return null;

      const linesResp = await Actions.callRest(context, {
        endpoint:  'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2',
        // size: the endpoint defaults to 20 rows.
        uriParams: { requestId: Number(requestId), size: 2000 }
      });
      const rows = (linesResp && linesResp.ok && linesResp.body && linesResp.body.data) || [];
      const byId = new Map(rows.map(r => [Number(r.id), r]));

      // Every line on one TO shares a source yard — that is exactly what the
      // per-yard fan-out guarantees — so the first line that carries a code
      // answers for the whole TO.
      for (const id of lineIds) {
        const row = byId.get(id);
        if (row && row.sourceOrgCode) return String(row.sourceOrgCode);
      }
      return null;
    } catch (e) {
      console.warn('[ReleaseTransferOrderChain] source org resolution failed:', e);
      return null;
    }
  }

  // THE DIALOG NO LONGER CLOSES ON RELEASE.
  //
  // It used to close on every post-OIC path, for a presentational reason: a
  // toast fired while the modal is up renders BEHIND the overlay, so the dialog
  // was dismissed to give the toast a clean page. The cost was that releasing
  // several TOs on one request meant reopening the request between each — and
  // multiple TOs per request is normal (one per source yard; the
  // SUPPLY_REQUEST_NUMBER -001/-002 suffixes are exactly that).
  //
  // Outcomes now report through the in-dialog banner ($page.variables
  // .releaseMessage / releaseMessageType) instead, which has no z-index problem
  // and puts the result next to the dropdown the user is about to use again.
  // That also fixes the pre-flight paths, which never closed and were therefore
  // already firing toasts behind the overlay.
  //
  // The row-selection reset that used to live here moved to
  // closePickingDrawerChain, which is where the dialog actually closes now.
  function setBanner($page, type, message) {
    $page.variables.releaseMessageType = type;
    $page.variables.releaseMessage     = message;
  }

  // LOV option label: the order number plus its release state, so the dropdown
  // itself says which orders are done and which still need releasing. Kept
  // identical to openPickingDrawerChain's copy so the label doesn't change
  // between an in-session release and a reopen.
  function statusLabel(orderNumber, fallback, released) {
    const base = orderNumber ? String(orderNumber) : (fallback || 'TO pending');
    return base + (released ? ' — Released' : ' — Awaiting release');
  }

  // Flags the released TO and relabels it so the LOV shows its status.
  //
  // Every TO stays in the list — nothing is removed and nothing is hidden. The
  // LOV is the single control: the selected TO's status decides which buttons
  // are live (unreleased → Release; released → Pick and Ship). Removing options
  // instead would both collapse the panel on the last release and take away the
  // selection Pick and Ship needs.
  //
  // The SELECTION DELIBERATELY STAYS on the TO just released, so the user can
  // click straight through to Pick and Ship for it. Auto-jumping to the next
  // unreleased TO would silently retarget those buttons at a different order.
  // Takes a LIST of ids now, because one click can release several transfer
  // orders: the ticked lines name every order to release, so the flagging has to
  // cover the same set in one pass. Flagging them one at a time would rewrite
  // selectedRequestTOs once per order and make the panel flicker through
  // intermediate states.
  function markReleased($page, releasedTOIds) {
    const ids = new Set((releasedTOIds || []).map(id => String(id)));
    if (!ids.size) return ($page.variables.selectedRequestTOs || []).filter(t => !t.released);
    $page.variables.selectedRequestTOs = ($page.variables.selectedRequestTOs || [])
      .map(t => ids.has(String(t.value))
        ? { ...t, released: true, label: statusLabel(t.orderNumber, t.label, true) }
        : t);
    return $page.variables.selectedRequestTOs.filter(t => !t.released);
  }

  /**
   * Release F&M lines for picking: ALLOCATED → PICK_INITIATED.
   *
   * The F&M counterpart of the OIC transfer-order release below. There is no
   * TO and no inventory transaction, so this is a direct status PATCH per
   * line — the equivalent assertion ("these are released to be picked"),
   * carried out the only way an F&M line can carry it.
   *
   * Only lines at ALLOCATED are advanced. A line already at PICK_INITIATED or
   * beyond is skipped rather than re-patched, so double-clicking Release
   * cannot walk a line backwards or re-announce work already done.
   *
   * Mirrors the S&T path in two ways that matter: isReleasingTO drives the
   * same button-disable so Release can't be double-fired, and the result is
   * reported through the in-dialog banner rather than a toast (oj-messages
   * renders behind the modal overlay).
   */
  async function releaseFAndMLines(context, $page, fmLines) {
    const req = $page.variables.selectedRequest;
    const requestId = req && (req.eqrEquipmentRequestId || req.id);
    if (!requestId) {
      return { ok: 0, failed: 0, skipped: fmLines.length, noRequest: true };
    }

    // Releasable = confirmed but not yet released. SCHEDULED_FOR_PICKING is the
    // status Confirm now writes, so it is the normal arrival state for an F&M
    // line on this page; ALLOCATED is kept for lines confirmed before that
    // change (and for any path that still leaves them there).
    const RELEASABLE_FM_STATUSES = ['SCHEDULED_FOR_PICKING', 'ALLOCATED'];
    const eligible = fmLines.filter(l =>
      RELEASABLE_FM_STATUSES.indexOf(String(l.lineStatus || '').toUpperCase()) !== -1);

    if (!eligible.length) {
      return { ok: 0, failed: 0, skipped: fmLines.length };
    }

    // ONE batch PATCH for every eligible line (one transaction, all or
    // nothing), replacing a per-line Promise.all.
    const fmBatch = await lineBody.updateLines(context, Actions, {
      requestId: Number(requestId),
      headers:   cu.auditHeaders(context),
      updates:   eligible.map(l => ({ id: Number(l.lineId), lineStatus: 'PICK_INITIATED' }))
    });
    let ok = 0;
    const failed = [];
    if (fmBatch.ok) {
      ok = eligible.length;
    } else {
      console.warn('[ReleaseTransferOrderChain] F&M release batch failed, no line changed:', fmBatch.message);
      eligible.forEach(l => failed.push(Number(l.lineId)));
    }

    // Mirror onto the in-memory rows so the grid's Line Status column updates
    // without closing the dialog — same approach the S&T path takes after its
    // PATCHes. Only the lines that actually succeeded are moved.
    if (ok) {
      const okIds = new Set(
        eligible.map(l => String(l.lineId)).filter(id => failed.indexOf(Number(id)) === -1)
      );
      const cur = $page.variables.selectedRequest || {};
      $page.variables.selectedRequest = {
        ...cur,
        lines: (cur.lines || []).map(l => okIds.has(String(l.lineId))
          ? { ...l, lineStatus: 'PICK_INITIATED' }
          : l)
      };
    }

    // NO BANNER AND NO isReleasingTO RESET HERE — deliberately.
    //
    // This runs both on its own (F&M-only tick) and as one half of a MIXED
    // release alongside the transfer-order path. In the mixed case the caller
    // has to report a single combined outcome, so a banner written here would
    // be overwritten a moment later, or would overwrite the TO result. Same for
    // isReleasingTO: the button must stay disabled until BOTH halves finish.
    //
    // Returning the tally lets the caller decide what to say and when.
    return { ok: ok, failed: failed.length, skipped: fmLines.length - eligible.length };
  }

  class ReleaseTransferOrderChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      // selectedTOId is deliberately NOT read here any more. It is still
      // maintained for the single-TO consumers (pick slip header, ship scoping),
      // but it goes blank on a multi-TO tick — which is precisely the case this
      // chain now handles. The set to release comes from the ticked lines.
      const tos = $page.variables.selectedRequestTOs || [];

      // Clear the previous result so the banner always reflects THIS attempt.
      // The dialog stays open across releases, so back-to-back releases are the
      // normal case and stale text from the prior one must not carry over.
      setBanner($page, 'confirmation', '');
      $page.variables.pickInitiatedWarning = '';

      // ── F&M BRANCH — release by LINE SELECTION, not by transfer order ─────
      //
      // F&M lines (fixed-asset / maintenance tracked, isTransactable='N') are
      // not inventory items, so there is no TO to release and no yard to ship
      // from. They still take BOTH steps of the pathway, though — release then
      // ship — so the lifecycle reads the same as an S&T line:
      //
      //   S&T:  ALLOCATED → PICK_INITIATED → SHIP_TO_SITE   (via TO)
      //   F&M:  ALLOCATED → PICK_INITIATED → SHIP_TO_SITE   (via line ticks)
      //
      // The user ticks the lines and clicks Release for Picking; this advances
      // exactly those lines to PICK_INITIATED. Pick and Ship then completes
      // them, the same button S&T uses.
      //
      // Checked BEFORE the TO guards below, because an F&M-only request has no
      // TO at all — falling through would hit "Select a Transfer Order first"
      // and the lines could never be released.
      //
      // Runs ONLY when the ticked rows are all F&M. A mixed selection is
      // rejected rather than half-processed: the two classes advance by
      // different mechanisms (OIC release vs a direct PATCH), so silently
      // doing one and not the other would misreport what happened.
      const pickedLines = ($page.functions && typeof $page.functions.selectedLines === 'function')
        ? ($page.functions.selectedLines() || [])
        : [];

      // A MIXED TICK IS ALLOWED — both classes release in one click.
      //
      // This used to refuse the selection outright and tell the user to release
      // the fixed-asset lines separately. That was needless friction: the two
      // classes advance to the SAME status (PICK_INITIATED) by different
      // mechanisms, and Pick and Ship already handles a mixed selection in one
      // action, so Release was the odd one out.
      //
      // ORDER MATTERS. The F&M half runs FIRST and reports nothing — it now
      // returns a tally instead of writing a banner (see releaseFAndMLines), so
      // the transfer-order half below can finish and then report ONE combined
      // outcome. Reversing this, or letting either half banner on its own, ends
      // with the second result silently overwriting the first.
      //
      // fmTally stays null when nothing F&M was ticked, which is how the
      // reporting code tells "no F&M in this release" from "F&M released 0".
      let fmTally = null;
      if (pickedLines.length) {
        const fmPicked = pickedLines.filter(l => l && l.isFAndM === true);
        const stPicked = pickedLines.filter(l => !l || l.isFAndM !== true);

        if (fmPicked.length) {
          $page.variables.isReleasingTO = true;
          fmTally = await releaseFAndMLines(context, $page, fmPicked);

          // F&M ONLY — nothing else to do, so report here and stop. With no
          // S&T lines ticked there is no transfer order to release, and falling
          // through would hit the "Select a Transfer Order first" guard below
          // on a request that may not have one at all.
          if (!stPicked.length) {
            $page.variables.isReleasingTO = false;
            if (fmTally.noRequest) {
              setBanner($page, 'error', 'Could not determine the request — close and reopen it.');
            } else if (fmTally.failed && fmTally.ok) {
              setBanner($page, 'warning',
                fmTally.ok + ' fixed-asset line(s) released for picking; ' + fmTally.failed +
                ' failed. Refresh and try the remainder again.');
            } else if (fmTally.failed) {
              setBanner($page, 'error',
                'No fixed-asset lines were released — ' + fmTally.failed + ' failed. Try Refresh first.');
            } else if (fmTally.ok) {
              setBanner($page, 'confirmation',
                fmTally.ok + ' fixed-asset line(s) released for picking. No transfer order is ' +
                'created for these — use Pick and Ship once the equipment has been picked.');
            } else {
              setBanner($page, 'warning',
                'No selected fixed-asset line is awaiting release. Only lines scheduled for ' +
                'picking can be released; those already at Pick Initiated are ready for Pick and Ship.');
            }
            return;
          }
          // Mixed: fall through to the transfer-order release for the S&T half.
          // Its banner appends the F&M tally via fmSuffix.
        }
      }

      // ── WHICH TRANSFER ORDERS — from the TICKED LINES, not from a dropdown ──
      //
      // The Transfer Order LOV was removed: the grid's TRANSFER ORDER NO. column
      // already names each line's order, so the dropdown was a second telling of
      // the same fact — and a narrower one, because it could only ever name ONE
      // order. Scope now comes from the ticks, the same mechanism F&M lines have
      // always used, so both classes are selected the same way.
      //
      // MULTIPLE ORDERS ARE RELEASED IN ONE CLICK. A request routinely has
      // several TOs (Confirm fans out one per source yard), and releasing them
      // used to mean re-picking the dropdown between each. Every ticked order
      // still awaiting release goes to OIC together and is released one at a
      // time there — see releaseTransferOrders.
      //
      // Already-released orders are filtered out rather than refused, so a mixed
      // tick still releases the ones that need it.
      const releasableTOs = ($page.functions
        && typeof $page.functions.releasableTOOptions === 'function')
        ? ($page.functions.releasableTOOptions(tos) || [])
        : [];

      if (!releasableTOs.length) {
        // Distinguish "nothing ticked" from "everything ticked is already done".
        // Both leave nothing to release, but they call for different next steps.
        const anyTicked = ($page.functions
          && typeof $page.functions.selectedTOOptions === 'function')
          ? ($page.functions.selectedTOOptions(tos) || [])
          : [];
        setBanner($page, anyTicked.length ? 'warning' : 'error',
          anyTicked.length
            ? 'Every transfer order in this selection has already been released — '
              + 'use Pick and Ship for their lines.'
            : 'Tick the lines you want to release. Their transfer orders are released together.');
        return;
      }

      // A TO still being created in Fusion has no order number yet and cannot be
      // released. Held back rather than failing the whole batch — the others are
      // releasable now, and this one just needs a moment.
      const pendingTOs   = releasableTOs.filter(t => !t.orderNumber);
      const releasableNow = releasableTOs.filter(t => t.orderNumber);

      if (!releasableNow.length) {
        setBanner($page, 'warning',
          'The selected transfer order(s) are still being created in Fusion. '
          + 'Try again in a few seconds.');
        return;
      }

      $page.variables.isReleasingTO = true;

      // Resolve the org each TO was created against BEFORE releasing — see
      // resolveSourceOrgCode. Blocks rather than guessing: releasing against the
      // wrong yard is a real inventory movement, and the old hardcoded '001'
      // silently did exactly that for every non-Seattle TO.
      //
      // PER TO, never once for the batch: a request has several TOs precisely
      // because they ship from different yards, so a shared code would be wrong
      // for all but one of them.
      const requestIdForOrg = $page.variables.selectedRequest && $page.variables.selectedRequest.id;
      const resolved = await Promise.all(releasableNow.map(async (t) => ({
        option:    t,
        toNumber:  String(t.orderNumber),
        sourceOrg: await resolveSourceOrgCode(context, Actions, t.value, requestIdForOrg)
      })));

      // A TO whose yard cannot be determined is DROPPED FROM THE BATCH, not sent
      // with a guessed org. The others still go — one unresolvable order must not
      // block orders that are fine.
      const unresolved = resolved.filter(r => !r.sourceOrg);
      const toSend     = resolved.filter(r => r.sourceOrg);

      if (!toSend.length) {
        $page.variables.isReleasingTO = false;
        setBanner($page, 'error',
          'Could not determine which yard TO ' + unresolved.map(r => r.toNumber).join(', ')
          + ' ships from, so nothing was released. This happens on transfer orders created '
          + 'before the source yard was recorded on the line.');
        return;
      }

      // ── POST to OIC release flow INT_SCM_EQR_IP_FUS_REL_TO_REA_V1 (batch) ─
      // isReleasingTO deliberately stays true through the line-status cascade
      // below (cleared only at the end, same as before this was factored
      // out) so the button can't be double-clicked while that's in flight.
      //
      // One call for the whole set: OIC releases them one at a time and reports
      // per-TO outcomes, so a failure partway leaves the rest attempted rather
      // than abandoned — which a browser-side loop could not guarantee.
      const batch = await rto.releaseTransferOrders(
        context, Actions,
        // BOTH AUTO-CONFIRM FLAGS FALSE — stated, not left to a default.
        //
        // This is the drawer's deliberate two-step flow: Release means "the warehouse
        // may now pick this" and stops at Pick Initiated; Pick and Ship is a separate
        // click for the separate, physical event of the equipment actually leaving.
        // An earlier version advanced straight to shipped and had to be undone,
        // because the status then claimed a shipment that had not happened.
        //
        // Bulk Initiate is the caller that passes true — there the user has explicitly
        // chosen not to be asked per request.
        toSend.map(r => ({
          toNumber:        r.toNumber,
          sourceOrg:       r.sourceOrg,
          autoPickConfirm: false,
          autoShipConfirm: false
        })),
        requestIdForOrg
      );

      if (!batch.ok) {
        $page.variables.isReleasingTO = false;
        // Nothing was released — every ticked order stays exactly as it was, so
        // the user can retry without reopening the request.
        setBanner($page, 'error',
          'No transfer orders were released. ' + (batch.message || ''));
        return;
      }

      // Match results back to the options by order number. OIC echoes toNumber
      // for exactly this, rather than relying on array position.
      const optionByNumber = new Map(toSend.map(r => [r.toNumber, r.option]));
      const releasedResults = [];
      const failedResults   = [];
      (batch.results || []).forEach((res) => {
        // alreadyReleased counts as released: it IS released in Fusion, the
        // local row simply didn't know. Flagging it stops the user retrying it
        // forever and makes Pick and Ship live for its lines.
        if (res.outcome === 'released' || res.outcome === 'alreadyReleased') {
          releasedResults.push(res);
        } else {
          failedResults.push(res);
        }
      });

      if (!releasedResults.length) {
        $page.variables.isReleasingTO = false;
        setBanner($page, 'error',
          'No transfer orders were released. '
          + failedResults.map(r => 'TO ' + r.toNumber + ': ' + (r.message || 'failed')).join('  '));
        return;
      }

      // The orders that actually released — everything downstream (the line
      // cascade, the released flags, the banner) is scoped to these, never to
      // what was merely submitted.
      const releasedTOs = releasedResults
        .map(r => optionByNumber.get(r.toNumber))
        .filter(t => t);

      // Advance lineStatus ALLOCATED → PICK_INITIATED on the lines of EVERY TO
      // that released. Lines in any other state are skipped (no PATCH).
      //
      // SCOPED TO releasedTOs, not to everything ticked: a TO that failed at OIC
      // has not been released, and walking its lines to Pick Initiated would
      // claim in the grid that it had. The two must not drift apart.
      const advancedLineIds = [];
      let releaseRequestId  = null;
      try {
        const requestId = $page.variables.selectedRequest && $page.variables.selectedRequest.id;
        releaseRequestId = requestId;

        // Fetched ONCE for the whole batch rather than per TO — it is a
        // request-wide read, and with several transfer orders the per-TO version
        // would re-fetch the same rows N times.
        const currentLineStatusById = new Map();
        if (requestId) {
          try {
            const lr = await Actions.callRest(context, {
              endpoint:  'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2',
              // size: the endpoint defaults to 20 rows.
              uriParams: { requestId: Number(requestId), size: 2000 }
            });
            if (lr && lr.ok && lr.body && Array.isArray(lr.body.data)) {
              lr.body.data.forEach(l => currentLineStatusById.set(Number(l.id), l.lineStatus));
            }
          } catch (e) {
            console.warn('[ReleaseTransferOrderChain] failed to fetch current lineStatus:', e);
          }
        }

        // The TO→lines mapping is still per transfer order; only this part fans
        // out. Failures are per TO so one unreadable order does not cost the
        // others their cascade.
        const perTOLines = await Promise.all(releasedTOs.map(async (t) => {
          try {
            const linesResp = await Actions.callRest(context, {
              endpoint:  'eqp-v1/getTransferOrderLines',
              uriParams: { transferOrderId: Number(t.value) }
            });
            return (linesResp && linesResp.ok && linesResp.body && linesResp.body.data) || [];
          } catch (e) {
            console.warn('[ReleaseTransferOrderChain] TO line fetch failed for', t.orderNumber, e);
            return [];
          }
        }));

        // Flattened and de-duplicated by requestLineId: a line belongs to one TO,
        // but de-duping keeps a double PATCH impossible even if the backend ever
        // returns one twice.
        const lineIdsToAdvance = new Set();
        const RELEASABLE_STATUSES = ['SCHEDULED_FOR_PICKING', 'ALLOCATED'];
        perTOLines.forEach((toLines) => {
          (toLines || []).forEach((tl) => {
            if (!tl.requestLineId || !requestId) return;
            const lineId = Number(tl.requestLineId);
            const cur = String(currentLineStatusById.get(lineId) || '').toUpperCase();
            // Advance only lines that are confirmed-but-not-yet-released.
            // SCHEDULED_FOR_PICKING is what Confirm now writes, so it is the
            // normal pre-release state; ALLOCATED is retained for lines confirmed
            // before that change. Anything else (already PICK_INITIATED, shipped,
            // rejected) is deliberately left alone — this must never walk a line
            // backwards.
            if (RELEASABLE_STATUSES.indexOf(cur) === -1) return;
            lineIdsToAdvance.add(lineId);
          });
        });

        // ONE batch PATCH for every line on the released TOs (all or
        // nothing), replacing a per-line Promise.all.
        const pickBatch = await lineBody.updateLines(context, Actions, {
          requestId: Number(requestId),
          headers:   cu.auditHeaders(context),
          updates:   [...lineIdsToAdvance].map(lineId => ({ id: lineId, lineStatus: 'PICK_INITIATED' }))
        });
        if (pickBatch.ok) {
          lineIdsToAdvance.forEach(lineId => advancedLineIds.push(lineId));
        } else {
          console.warn('[ReleaseTransferOrderChain] PICK_INITIATED batch failed, no line changed:',
                       pickBatch.message);
        }
      } catch (e) {
        console.warn('[ReleaseTransferOrderChain] line status update failed:', e);
      }

      // RELEASE STOPS AT PICK_INITIATED — it does NOT advance to SHIP_TO_SITE.
      //
      // Releasing means "the warehouse may now pick this"; shipping is a
      // separate physical event that has actually to happen first. This chain
      // used to flip PICK_INITIATED → SHIP_TO_SITE in the same click (before
      // that, in a 5s fire-and-forget timer), which claimed equipment had
      // shipped the instant it was released for picking. The explicit
      // "Pick and Ship" button in the dialog now owns that transition, so the
      // status reflects a real event instead of an assumed one.
      //
      // Consequence: lines sitting at PICK_INITIATED after a release are the
      // NORMAL state now, not evidence of the old stuck-line bug. They are
      // waiting on Pick and Ship.
      $page.variables.pickInitiatedWarning = '';

      $page.variables.isReleasingTO = false;

      // MARK the just-released TOs as released — do NOT remove them.
      //
      // They used to be spliced out of selectedRequestTOs, which emptied the
      // array on the last TO and collapsed the whole panel: its oj-bind-if went
      // false, taking every button with it and replacing them with "No Transfer
      // Order on this request yet" — while the success banner right above still
      // said the TO had just been released. That also removed the Pick and Ship
      // button at the exact moment it became the next step.
      //
      // Keeping the options (flagged released:true) means the panel stays put
      // and the controls disable individually: Release for Picking greys out
      // once the ticked orders are all done, and Pick and Ship stays live for
      // the lines now at Pick Initiated.
      //
      // The backend's TO row doesn't flip orderStatus on release, so a refetch
      // won't tell us this — the flag is what carries it for the rest of the
      // modal session. On close+reopen the stale backend status lets the TO look
      // releasable again; that pre-existing trade-off is unchanged.
      // (openPickingDrawerChain already filters POST_RELEASE_STATUSES, so a
      // later backend fix works for free.)
      //
      // THE TICKS ARE LEFT ALONE. The lines just released stay ticked, so Pick
      // and Ship acts on exactly what was released without the user re-ticking
      // anything — the same continuity the old "selection stays on the released
      // TO" behaviour gave, now expressed through the grid.
      const remainingTOs = markReleased($page, releasedTOs.map(t => t.value));

      // Reflect the new line statuses in the STILL-OPEN dialog.
      //
      // Deliberately NOT RefreshPickingDrawerChain: that re-reads transfer
      // orders from the backend, which does not flip orderStatus on release
      // (the reason the splice above exists at all), so the TO just released
      // would reappear in the dropdown. Patching the lines we already verified
      // avoids that entirely and costs no extra round-trip.
      const finalStatusById = new Map();
      advancedLineIds.forEach(id => finalStatusById.set(Number(id), 'PICK_INITIATED'));
      if (finalStatusById.size) {
        const cur = $page.variables.selectedRequest || {};
        $page.variables.selectedRequest = {
          ...cur,
          lines: (cur.lines || []).map(l => finalStatusById.has(Number(l.lineId))
            ? { ...l, lineStatus: finalStatusById.get(Number(l.lineId)) }
            : l)
        };
      }

      // Released for picking — the lines now await Pick and Ship. Say so
      // explicitly, so it's clear the flow isn't finished at this point.
      // Mixed release: the F&M half ran silently before the TO half, so its
      // result is appended here. Without this a mixed tick would report only
      // the transfer order and leave the user unsure whether the fixed-asset
      // lines moved at all.
      const fmSuffix = !fmTally ? ''
        : fmTally.failed
          ? '  ' + fmTally.ok + ' fixed-asset line(s) released, ' + fmTally.failed + ' failed.'
          : fmTally.ok
            ? '  ' + fmTally.ok + ' fixed-asset line(s) released (no transfer order needed).'
            : '  No selected fixed-asset line was awaiting release.';

      // NAMES EVERY ORDER RELEASED, not a count. With the dropdown gone the
      // banner is the confirmation of what the click actually did, and "3
      // transfer orders released" leaves the user to work out which three from a
      // grid they have just changed.
      const releasedNumbers = releasedResults.map(r => r.toNumber).filter(n => n);
      const releasedPhrase  = releasedNumbers.length === 1
        ? 'TO ' + releasedNumbers[0] + ' released for picking.'
        : 'TO ' + releasedNumbers.join(', ') + ' released for picking ('
          + releasedNumbers.length + ' transfer orders).';

      // PARTIAL BATCHES MUST NOT READ AS CLEAN SUCCESSES. Some orders released
      // and some did not is a warning, and it has to say which failed — the user
      // is about to click Pick and Ship, and needs to know it will not cover
      // everything they ticked.
      const failSuffix = failedResults.length
        ? '  FAILED: ' + failedResults
            .map(r => 'TO ' + r.toNumber + ' (' + (r.message || 'no detail') + ')').join('; ') + '.'
        : '';

      // Orders held back before the call ever went out — unresolvable yard, or
      // still being created in Fusion. Reported here rather than as their own
      // banner so one release produces one verdict.
      const heldSuffix = (unresolved.length || pendingTOs.length)
        ? '  NOT SENT: '
          + [
              unresolved.length
                ? unresolved.map(r => 'TO ' + r.toNumber).join(', ') + ' (source yard unknown)'
                : '',
              pendingTOs.length
                ? pendingTOs.length + ' still being created in Fusion'
                : ''
            ].filter(s => s).join('; ') + '.'
        : '';

      const isPartial = !!(failedResults.length || unresolved.length || pendingTOs.length);

      setBanner($page, isPartial ? 'warning' : 'confirmation',
        releasedPhrase +
        (advancedLineIds.length
          ? '  ' + advancedLineIds.length + ' line(s) at Pick Initiated — use Pick and Ship once picked.'
          : '') +
        fmSuffix +
        failSuffix +
        heldSuffix +
        (remainingTOs.length
          ? '  ' + remainingTOs.length + ' transfer order(s) left to release.'
          : '  All transfer orders for this request are released.'));

      // ── Pick slip ───────────────────────────────────────────────────────
      // AFTER the release, never inside it. The lines are already patched to
      // PICK_INITIATED and the banner already says so; the document is
      // paperwork ABOUT that release, not part of it. A PDF that fails to
      // render must not undo a pick release — the equipment has been released
      // whether or not the slip printed.
      //
      // That is why this sits past every return path above, is awaited only so
      // the preview opens before the user moves on, and swallows everything.
      // PrintPickSlipChain does its own try/catch and reports a failure through
      // the same banner with a "use Print Pick Slip to try again" prompt, so
      // there is nothing to handle here beyond not letting it throw.
      //
      // Gated on the same flag as the button. isFeatureEnabled fails CLOSED, so
      // with the flag absent or still loading no slip is generated and the
      // release is untouched.
      try {
        const { $application } = context;
        if ($application.functions.isFeatureEnabled(
              $application.variables.featureFlags,
              $application.variables.flagsLoaded,
              'SHIPPING_DOCUMENTS_ENABLED')) {
          await Actions.callChain(context, { chain: 'PrintPickSlipChain' });
        }
      } catch (e) {
        console.warn('[ReleaseTransferOrderChain] pick slip generation failed '
          + '(release itself is committed):', e);
      }
    }
  }

  return ReleaseTransferOrderChain;
});
