define([
  'vb/action/actionChain',
  'vb/action/actions',
  'ojs/ojkeyset',
  'resources/js/requestLineBody',
  'resources/js/currentUser'
], (ActionChain, Actions, keySet, lineBody, cu) => {
  'use strict';

  // sourceOrg MUST match the org the TO was actually CREATED against, or the
  // release resolves a different Fusion organization.
  //
  // This used to be a hardcoded '001', kept "in lock-step" with a
  // PAYLOAD_DEFAULTS.SourceOrganizationCode constant that no longer exists —
  // Confirm/Process Return now resolve org codes per line.
  //
  // THIS IS THE RETURN (INBOUND) LEG, so the inversion matters: the equipment
  // travels FROM the virtual org it was delivered to, BACK TO the yard. The
  // release therefore needs the line's DESTINATION code
  // (lineDestinationOrgCode / destinationOrgCode — the virtual org, '005'/'006'),
  // not its source. Sending the yard here would release against the wrong end of
  // the movement. The outbound equivalent in initiate-picking-page-chains reads
  // sourceOrgCode for exactly the mirrored reason.
  //
  // Falls back to null → the release is blocked rather than guessing, because
  // releasing against the wrong org is a real inventory movement.
  async function resolveReturnSourceOrgCode(context, Actions, transferOrderId, requestId) {
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
        uriParams: { requestId: Number(requestId), size: 2000 }
      });
      const rows = (linesResp && linesResp.ok && linesResp.body && linesResp.body.data) || [];
      const byId = new Map(rows.map(r => [Number(r.id), r]));

      // Every line on one TO shares a route — the per-route fan-out guarantees
      // it — so the first line carrying a code answers for the whole TO.
      for (const id of lineIds) {
        const row = byId.get(id);
        if (row && row.destinationOrgCode) return String(row.destinationOrgCode);
      }
      return null;
    } catch (e) {
      console.warn('[ReleaseTransferOrderChain] return source org resolution failed:', e);
      return null;
    }
  }

  async function safeNotify(context, payload) {
    try {
      await Actions.fireNotificationEvent(context, payload);
    } catch (e) {
      console.warn('[ReleaseTransferOrderChain] toast failed — continuing:', e);
    }
  }

  // Closes the picking detail dialog and clears the table row selection.
  // Called from every post-OIC path (success + every failure that fires a
  // toast) so toasts always render on the clean page rather than behind
  // the modal overlay. Pre-flight validation paths (no TO selected, stale
  // TO, no orderNumber yet) deliberately do NOT call this — the user
  // stays in the modal to correct their input.
  function closeDialogAndClearSelection($page) {
    try {
      const dlg = document.getElementById('pickingDetailDialog');
      if (dlg && typeof dlg.close === 'function') dlg.close();
      $page.variables.isDrawerOpen = false;
      // Deferred KeySetImpl reset so re-clicking the SAME row reopens the
      // dialog after a TO release (mirrors closePickingDrawerChain).
      setTimeout(() => {
        try {
          const table = document.getElementById('equipmentReturnsTable');
          if (table) {
            table.selected = { row: new keySet.KeySetImpl(), column: new keySet.KeySetImpl() };
          }
        } catch (_) {}
      }, 0);
    } catch (e) {
      console.warn('[ReleaseTransferOrderChain] dialog close failed:', e);
    }
  }

  class ReleaseTransferOrderChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const selectedTOId = $page.variables.selectedTOId;
      const tos          = $page.variables.selectedRequestTOs || [];

      if (!selectedTOId) {
        await safeNotify(context, {
          summary:     'Release Transfer Order',
          message:     'Select a Transfer Order first.',
          type:        'error',
          displayMode: 'persist'
        });
        return;
      }

      const selectedTO = tos.find(t => String(t.value) === String(selectedTOId));
      if (!selectedTO) {
        await safeNotify(context, {
          summary:     'Release Transfer Order',
          message:     'Selected Transfer Order is no longer in the list — close and reopen the drawer.',
          type:        'error',
          displayMode: 'persist'
        });
        return;
      }

      const toNumber = selectedTO.orderNumber || '';
      if (!toNumber) {
        await safeNotify(context, {
          summary:     'Release Transfer Order',
          message:     'This Transfer Order is still being created in Fusion. Try again in a few seconds.',
          type:        'warning',
          displayMode: 'persist'
        });
        return;
      }

      $page.variables.isReleasingTO = true;

      // Resolve the org this inbound TO was created against BEFORE releasing —
      // see resolveReturnSourceOrgCode. Blocked rather than guessed.
      const requestIdForOrg = $page.variables.selectedRequest && $page.variables.selectedRequest.id;
      const returnSourceOrg = await resolveReturnSourceOrgCode(
        context, Actions, selectedTO.value, requestIdForOrg
      );
      if (!returnSourceOrg) {
        $page.variables.isReleasingTO = false;
        await safeNotify(context, {
          summary:     'Release Failed',
          message:     'Could not determine which organization TO ' + toNumber + ' ships from, so it ' +
                       'was not released. This happens on transfer orders created before the yard ' +
                       'codes were recorded on the request line.',
          type:        'error',
          displayMode: 'persist'
        });
        return;
      }

      // ── POST to OIC release flow INT_SCM_EQR_IP_FUS_REL_TO_REA_V1 ──────
      let oicResp;
      try {
        oicResp = await Actions.callRest(context, {
          endpoint: 'ics/releaseTO',
          body: {
            toNumber:  toNumber,
            sourceOrg: returnSourceOrg,
          }
        });
      } catch (e) {
        console.error('[ReleaseTransferOrderChain] OIC releaseTO threw:', e);
        $page.variables.isReleasingTO = false;
        closeDialogAndClearSelection($page);
        await safeNotify(context, {
          summary:     'Release Failed',
          message:     'Network error contacting Integration Cloud.',
          type:        'error',
          displayMode: 'persist'
        });
        return;
      }

      if (!oicResp || !oicResp.ok) {
        const serverMsg =
               (oicResp && oicResp.body && oicResp.body.message) ||
               (oicResp && oicResp.body && JSON.stringify(oicResp.body));
        console.warn('[ReleaseTransferOrderChain] OIC releaseTO non-OK',
                     oicResp && oicResp.status, oicResp && oicResp.body);
        $page.variables.isReleasingTO = false;

        // Detect Fusion's "already released" fingerprint. After a TO is
        // released, Fusion's pickWaves endpoint returns 400 with this exact
        // phrasing because the (OrderNumber, OrderTypeCode, SourceSystemName)
        // triple no longer uniquely resolves to a releasable wave. The error
        // bubbles up through OIC as HTTP 500 with the nested 400 body.
        // Treat as a soft warning instead of a hard "Release Failed".
        const bodyStr = (oicResp && oicResp.body)
          ? (typeof oicResp.body === 'string' ? oicResp.body : JSON.stringify(oicResp.body))
          : '';
        const isAlreadyReleased =
          bodyStr.indexOf('OrderNumber, OrderTypeCode, SourceSystemName') !== -1;

        if (isAlreadyReleased) {
          closeDialogAndClearSelection($page);
          await safeNotify(context, {
            summary:     'Already Released',
            message:     'Transfer Order ' + toNumber + ' has already been released.',
            type:        'warning',
            displayMode: 'persist'
          });
          return;
        }

        closeDialogAndClearSelection($page);
        await safeNotify(context, {
          summary:     'Release Failed',
          message:     serverMsg
                       ? ('HTTP ' + oicResp.status + ': ' + serverMsg)
                       : ('OIC rejected the release (HTTP ' + (oicResp && oicResp.status) + ').'),
          type:        'error',
          displayMode: 'persist'
        });
        return;
      }

      // Advance lineStatus ALLOCATED → PICK_INITIATED. Lines in any other
      // state are skipped (no PATCH). 5s later, a timer flips PICK_INITIATED
      // → SHIP_TO_SITE on the advanced lines, re-verifying state at fire-time.
      const advancedLineIds = [];
      let releaseRequestId  = null;
      try {
        const linesResp = await Actions.callRest(context, {
          endpoint:  'eqp-v1/getTransferOrderLines',
          uriParams: { transferOrderId: Number(selectedTO.value) }
        });
        if (linesResp && linesResp.ok) {
          const toLines = linesResp.body.data || [];
          const requestId = $page.variables.selectedRequest && $page.variables.selectedRequest.id;
          releaseRequestId = requestId;

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

          // ONE batch PATCH for every ALLOCATED line on this TO (all or
          // nothing), replacing a per-line Promise.all.
          const toAdvance = requestId ? Array.from(new Set(toLines
            .filter(tl => tl.requestLineId && currentLineStatusById.get(Number(tl.requestLineId)) === 'ALLOCATED')
            .map(tl => Number(tl.requestLineId)))) : [];
          const pickBatch = await lineBody.updateLines(context, Actions, {
            requestId: Number(requestId),
            headers:   cu.auditHeaders(context),
            updates:   toAdvance.map(lineId => ({ id: lineId, lineStatus: 'PICK_INITIATED' }))
          });
          if (pickBatch.ok) {
            toAdvance.forEach(lineId => advancedLineIds.push(lineId));
          } else {
            console.warn('[ReleaseTransferOrderChain] PICK_INITIATED batch failed, no line changed:',
                         pickBatch.message);
          }
        }
      } catch (e) {
        console.warn('[ReleaseTransferOrderChain] line status update failed:', e);
      }

      // Schedule the PICK_INITIATED → SHIP_TO_SITE timer (5s). Fire-and-forget;
      // chain returns immediately. Each line re-verifies its own state at fire
      // time so manual changes (e.g. reject) are not clobbered.
      if (advancedLineIds.length && releaseRequestId) {
        setTimeout(() => {
          (async () => {
            try {
              // ONE read and ONE batch PATCH for all advanced lines (was a
              // full line read plus a PATCH per line).
              const verify = await Actions.callRest(context, {
                endpoint:  'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2',
                uriParams: { requestId: Number(releaseRequestId), size: 2000 }
              });
              if (!verify || !verify.ok || !verify.body || !Array.isArray(verify.body.data)) return;
              const stillPicking = new Set(verify.body.data
                .filter(l => l.lineStatus === 'PICK_INITIATED').map(l => Number(l.id)));
              const shipBatch = await lineBody.updateLines(context, Actions, {
                requestId: Number(releaseRequestId),
                headers:   cu.auditHeaders(context),
                updates:   advancedLineIds.filter(id => stillPicking.has(id))
                  .map(id => ({ id: id, lineStatus: 'SHIP_TO_SITE' }))
              });
              if (!shipBatch.ok) {
                console.warn('[ReleaseTransferOrderChain] SHIP_TO_SITE batch failed:', shipBatch.message);
              }
            } catch (e) {
              console.warn('[ReleaseTransferOrderChain] SHIP_TO_SITE timer failed', e);
            }
          })();
        }, 5000);
      }

      $page.variables.isReleasingTO = false;

      // Remove the just-released TO from the dropdown's in-memory options.
      // The backend's TO row doesn't update its orderStatus on release, so
      // refetching wouldn't drop it — this immutable splice is what hides
      // it for the rest of this modal session. If the user closes + reopens
      // the modal the backend's stale status will let it re-appear; that's
      // an accepted trade-off until backend reflects the released state.
      // (openPickingDrawerChain already filters POST_RELEASE_STATUSES, so
      // any backend change later works for free.)
      $page.variables.selectedRequestTOs = ($page.variables.selectedRequestTOs || [])
        .filter(t => String(t.value) !== String(selectedTOId));
      $page.variables.selectedTOId = '';

      // Close the modal BEFORE firing the toast so the toast renders above
      // the page, not behind the dialog overlay. Same pattern as every
      // post-OIC path in this chain.
      closeDialogAndClearSelection($page);

      await safeNotify(context, {
        summary:     'Transfer Order ' + toNumber + ' Released',
        type:        'confirmation',
        displayMode: 'persist'
      });
    }
  }

  return ReleaseTransferOrderChain;
});
