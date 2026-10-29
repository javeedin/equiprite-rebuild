define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/prPassThrough',
  'resources/js/postCostToFusion',
], (ActionChain, Actions, prPassThrough, postCostToFusion) => {
  'use strict';

  /*
   * Post Cost Test — REAL forward post (durable).
   *
   * TWO STEPS, in this order.
   *
   * 1. RECORD. For each selected postable week, write a POSTED ORIGINAL row to
   *    the EQR_POSTED_WEEK ledger (createPostedWeek); selected misc charges go
   *    in one transaction via postMiscTransactions. The view serves those back
   *    as POSTED on the next load, so posting SURVIVES A REFRESH.
   *
   * 2. SEND. Trigger the OIC flow, which drains EQP_P_FUSION_POST_QUEUE —
   *    everything for this request that is POSTED but not yet stamped with a
   *    batch — and posts one unprocessedProjectCosts line per row, stamping
   *    PPM_BATCH_NAME as each succeeds.
   *
   * The order matters: step 2 has no parameters beyond the request number
   * because step 1 is what decides its contents. And because settled rows leave
   * the queue, step 2 is safe to repeat — a second call posts nothing.
   *
   * A step-2 failure is not a failed post: the cost is recorded either way, and
   * the unsent rows are picked up by the next post. It is reported as a warning.
   *
   * ANTI-V190: every stored dollar is COPIED from the row's view-sourced fields
   * (cost/rate/period the engine produced); this chain does NO cost math. That
   * holds for a split too: it sends PERCENTAGES and lets the server apportion.
   *
   * PROJECT SPLIT: a week whose equipment carries a split of 2+ projects posts
   * through createPostedWeekSplit instead — still ONE call, but the server writes
   * N ledger rows under one SPLIT_GROUP_ID. An unsplit week's request body is
   * unchanged, field for field, from before that feature existed.
   *
   * Idempotency: the ledger's partial-unique (one live POSTED ORIGINAL per
   * line+week, extended to line+week+project+task once splits ship) + the unique
   * REVERSAL_REF make a re-post benign. A failed insert keeps that week
   * actionable and flags a partial warning; the header is never force-marked
   * posted.
   */
  class postSelectedChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const sel = ($page.variables.selectedWeekKeys || []).slice();

      // ── Misc charges post by a different route ─────────────────────────────
      // Weeks go row-by-row into EQR_POSTED_WEEK; charges go as one id list to
      // /misc-transactions/post, which flips them in a single transaction. Both
      // are LOCAL — neither reaches Fusion — but they are counted separately so a
      // failure in one can never be reported as success for the other.
      const selMisc = ($page.variables.rowsAll || [])
        .filter(function (r) {
          return r.kind === 'misc' && r.selected && r.status !== 'POSTED' && r.miscId;
        });

      if (!sel.length && !selMisc.length) return;

      $page.variables.isPosting = true;
      $page.variables.postError = '';
      $page.variables.postSuccess = '';

      const rows = ($page.variables.rowsAll || []);
      const toPost = rows.filter(function (r) {
        return r.kind === 'week' && sel.indexOf(r.rowKey) >= 0 && r.postable && !r.posted && !r.reversed;
      });

      let okCount = 0, failCount = 0, movedCost = 0;

      for (let i = 0; i < toPost.length; i++) {
        const r = toPost[i];
        const lineId = r.requestLineId;
        const weekISO = r.weekStartISO;           // 'YYYY-MM-DD'
        if (!lineId || !weekISO) { failCount++; continue; }
        const weekCompact = weekISO.replace(/-/g, '');   // YYYYMMDD
        const bareKey = String(lineId) + ':0:' + weekCompact;

        // The ledger key MUST be the view's own ROW_KEY, not this reconstruction.
        //
        // bareKey rebuilds `lineId:0:week` from scratch. That has always WORKED, which
        // is exactly why it went unnoticed: for every population that could post until
        // now -- rentable complete-period (posted_source CP) and one-time DIRECT --
        // the view's ROW_KEY *is* `lineId:0:week`, so the reconstruction and the real
        // key were the same string. Verified on the live ledger: all 51 EQR_POSTED_WEEK
        // rows match ^<lineId>:0:<YYYYMMDD>$ AND all 51 match a ROW_KEY in
        // EQP_P_POST_COST_DETAILS. A coincidence, not a contract.
        //
        // V313 ends the coincidence. A request-specific PR line now emits TWO rows per
        // requisition -- base `lineId:B<prId>:week` (never postable) and margin
        // `lineId:M<prId>:week` (postable) -- and the view's new per-requisition ledger
        // guard retires a posted margin by matching pw.ROW_KEY against that exact
        // `:M<prId>:` key. Post the reconstructed `:0:` key instead and the guard can
        // never match, so the margin row keeps re-emitting after it has been posted and
        // can be posted again and again. Worse, both requisitions on a two-PO line
        // (1000001343) collapse to the same `:0:` key and become indistinguishable in
        // the ledger.
        //
        // So: pass the view's key straight through. Falling back to bareKey preserves
        // today's exact behaviour for any row the view somehow served without a key
        // (vbEnterChain synthesises `<groupKey>_w<i>` in that case, which must never
        // reach the ledger).
        const ledgerKey = r.rowKey && String(r.rowKey).indexOf(':') >= 0
          ? String(r.rowKey)
          : bareKey;

        // The AUTHORED expenditure type of THIS week's own request line.
        //
        // Not read off the group row: a group is keyed by equipment NAME and can span
        // two request lines with different authored types, in which case the group
        // row shows '' (mixed) and posting from it would send NULL -- which the
        // queue's NVL would silently turn into 'Equipment'. Each week belongs to
        // exactly one line, so the line's own value is unambiguous.
        //
        // lineExpenditureType, never expenditureType: the latter is the EFFECTIVE
        // value (frozen wins), so on an already-posted week it is what was sent last
        // time. Freezing that into the NEXT week propagates a stale classification
        // with nothing on screen to reveal it. Live proof this is real: line
        // 1000001918 reads 'Supplies' while its posted weeks carry 'Equipment
        // Rental', 'Equipment Freight' and 'Equipment'.
        const expType = r.lineExpenditureType ? String(r.lineExpenditureType) : null;

        // ── project split ─────────────────────────────────────────────────────
        // A split posts this ONE week as N ledger rows, one per project. The
        // split is authored on the request line and carried onto every week row
        // by vbEnterChain, so this reads the week's own copy.
        //
        // Guard on >= 2, and fall THROUGH to the unsplit branch on exactly one.
        // A single slice is whole-equipment reallocation, which is out of scope --
        // and worse, the queue view resolves NVL(pw.project_number,
        // eer.project_number), so one slice would silently move ALL of this
        // equipment's cost off the request's project with nothing on screen
        // saying so. splitFormError refuses to author it and this refuses to post
        // it; both, because the row can arrive from a stale in-place update.
        const splits = (Array.isArray(r.splits) ? r.splits : []).filter(function (s) {
          return s && s.projectNumber && s.splitPct != null;
        });
        // A PREVIEW split (applied on screen while the backend endpoint is not
        // deployed) must not reach Fusion. splitPersisted is false only in that
        // case; rows loaded by vbEnterChain came from the server and carry no
        // flag, which reads as persisted.
        //
        // Falling back to the UNSPLIT post is the safe direction: the week still
        // posts, wholly to the request's own project, exactly as it would have
        // before the split was previewed. Posting it as a split instead would
        // call an endpoint that 404s and drop the whole week into failCount --
        // turning a cosmetic preview into a failed post.
        const previewOnly = splits.length >= 2 && r.splitPersisted === false;
        if (previewOnly) {
          console.warn('[postSelected] week ' + r.rowKey + ' has an UNSAVED preview split; '
            + 'posting it whole to the request project instead.');
        }
        // A PR pass-through row can never post as a split, whatever it arrived
        // carrying. The UI locks the control and saveSplitChain refuses to author
        // one, so reaching here means the row is stale or the split predates the
        // lock -- and the same fall-through applies as for a preview: post the
        // week WHOLE to the request's project rather than fail it. That is what
        // would have happened before any split existed, and for a margin row it
        // is also the only correct destination, since the base it marks up is
        // already on that project via the PO distribution.
        const prSplitBlocked = splits.length >= 2 && prPassThrough.isPrLineRow(r);
        if (prSplitBlocked) {
          console.warn('[postSelected] week ' + r.rowKey + ' is a PR pass-through row and '
            + 'cannot be split; posting it whole to the request project instead.');
        }
        const isSplit = splits.length >= 2 && !previewOnly && !prSplitBlocked;

        try {
          // ONE call per week either way, so the accounting below is unchanged.
          // Deliberately not N calls for a split: okCount/failCount are per WEEK,
          // there is no message for "week half-posted" and no pre-Fusion reversal
          // path to clean one up. The server inserts the N rows in one
          // transaction under one SPLIT_GROUP_ID.
          const body = {
            requestLineId:     Number(lineId),
            weekStartDate:     weekISO + 'T00:00:00Z',
            rowKey:            ledgerKey,
            status:           'POSTED',
            entryKind:        'ORIGINAL',
            // DIRECT/consumable posts qty×price as ONE 'EACH' entry (posted_source=DIRECT);
            // rentals post per-week complete-period (posted_source=CP). The view distinguishes
            // them by the equipment's rentable flag; both come from this one ledger.
            postedSource:      r.direct ? 'DIRECT' : 'CP',
            postedCostAmount:  Number(r.cost || 0),          // view-sourced (qty×price for DIRECT)
            costRate:          Number(r.postedRate || 0),    // view-sourced (per-unit price for DIRECT)
            periodType:        r.direct ? 'EACH' : String(r.postedPeriod || ''),
            // How many units of periodType this row bills — days for a rental week,
            // item count for a one-time DIRECT charge. Both are numbers already on
            // screen (the Days column, and the qty on the equipment row), so this
            // COPIES a displayed figure rather than deriving one.
            //
            // Without it BILLABLE_DURATION stays NULL, which is where every existing
            // row sits, and Fusion Quantity would post empty: the queue view reads
            // this column straight into Quantity, paired with the UOM that
            // postedSource implies (CP -> Days, DIRECT -> Each).
            // `prDays` FIRST for a DIRECT row. A PR row's amount is scaled by its
            // day span while PO_QUANTITY is NULL (see prPassThrough.prDayMultiplier),
            // so sending qty=1 beside a 21-day cost would freeze a row that
            // contradicts itself: costRate 100, billableDuration 1, amount 2,100.
            // The queue view reads this column straight into Fusion Quantity, so
            // that inconsistency would reach PPM.
            //
            // Self-corrects with the backend fix, without another edit: once
            // PO_QUANTITY is stamped the view's own QTY becomes the PO quantity,
            // prDayMultiplier disarms, prDays is 0, and `r.qty` already carries 21.
            billableDuration:  r.direct ? Number(r.prDays || r.qty || 1) : Number(r.days || 0),
            rateScheduleId:    Number($page.variables.rateScheduleId) || null,
            // FROZEN HERE, on purpose. The queue view reads the ledger's copy and
            // never re-reads the line, so editing the equipment's type later
            // cannot change what an already-posted week sends to Fusion — the same
            // guarantee costRate and periodType above already give. NULL when
            // nobody chose: the queue view's NVL resolves that to 'Equipment',
            // which is what every rental posted as before this column existed.
            expenditureType:   expType,
            reversalRef:       'EQR-' + lineId + '-' + weekCompact,
            ppmBatchName:      null
          };

          // The split path ADDS to that body and overrides exactly one field, so
          // an UNSPLIT week's request is byte-for-byte what it was before this
          // feature existed -- which is the property the regression check relies
          // on. Nothing is added when nothing is split.
          if (isSplit) {
            // The server derives one ref per slice, as
            // EQR-<line>-<week>-P<projectRefId>-T<taskId>, so the format lives in
            // one place and stays deterministic -- which is what keeps a re-post
            // idempotent under the unique index. The bare key would collide
            // between the slices of the same week.
            body.reversalRef = null;
            // Percentages only. NO per-slice dollar amounts: postedCostAmount is
            // the single view-sourced week figure and the server apportions it by
            // largest remainder, so SUM(slices) equals the week amount by the
            // same transaction that inserts them. Dividing it here would be cost
            // math in the client (anti-V190) and would disagree with the posted
            // rows by a cent on exactly the splits people check.
            body.splits = splits.map(function (s) {
              return {
                projectRefId:  Number(s.projectRefId),
                projectNumber: String(s.projectNumber),
                taskId:        s.taskId != null ? Number(s.taskId) : null,
                taskNumber:    s.taskNumber ? String(s.taskNumber) : null,
                splitPct:      Number(s.splitPct)
              };
            });
          }

          const resp = await Actions.callRest(context, {
            endpoint: isSplit ? 'eqp-v1/createPostedWeekSplit' : 'eqp-v1/createPostedWeek',
            body: body
          });
          if (resp && resp.ok) { okCount++; movedCost += Number(r.cost || 0); }
          else { failCount++; console.warn('[postSelected] createPostedWeek not ok:', resp && resp.status); }
        } catch (e) {
          failCount++;
          console.error('[postSelected] createPostedWeek error:', e && e.message);
        }
      }

      // ── misc charges: ONE call for the whole selection ─────────────────────
      // The endpoint flips them in a single transaction, so this is all-or-nothing
      // for the charges — deliberately unlike the weeks, which settle row by row.
      // A charge is one indivisible amount; a week set is not.
      let miscOk = 0, miscCost = 0, miscFailed = false;
      if (selMisc.length) {
        try {
          const mResp = await Actions.callRest(context, {
            endpoint: 'eqp-v1/postMiscTransactions',
            body: { ids: selMisc.map(function (m) { return Number(m.miscId); }) }
          });
          if (mResp && mResp.ok) {
            miscOk = selMisc.length;
            miscCost = selMisc.reduce(function (s, m) { return s + Number(m.cost || 0); }, 0);
          } else {
            miscFailed = true;
            console.warn('[postSelected] postMiscTransactions not ok:', mResp && mResp.status);
          }
        } catch (e) {
          miscFailed = true;
          console.error('[postSelected] postMiscTransactions error:', e && e.message);
        }
      }

      // ── send to Fusion PPM ─────────────────────────────────────────────────
      // Only after something actually landed in our own tables. The OIC flow
      // drains EQP_P_FUSION_POST_QUEUE — every row for this request that is
      // POSTED but not yet stamped with a batch — so it needs no id list and
      // no amounts: what to send is whatever the writes above just created.
      //
      // That also makes it SELF-HEALING and safe to repeat. Rows the flow
      // settles drop out of the queue, so a re-run posts nothing (proven live:
      // a second call returns 200 with zero ForEach iterations and no Fusion
      // call). Rows it misses stay queued and go on the next post.
      //
      // A failure here is NOT a failed post. The cost is recorded in EquipRite
      // either way; only the send to PPM is outstanding, and the next post
      // retries it. So this reports as a warning appended to the success
      // message, never as an error that implies the money was lost.
      let sentToFusion = false, fusionFailed = false;
      if (okCount > 0 || miscOk > 0) {
        try {
          // Project URL first, v1 on 404 -- the two OICs differ, see the module.
          const fResp = await postCostToFusion.post(context, Actions, $page.variables.requestNumber || '');
          if (fResp && fResp.ok) { sentToFusion = true; }
          else { fusionFailed = true; console.warn('[postSelected] postCostToFusion not ok:', fResp && fResp.status); }
        } catch (e) {
          fusionFailed = true;
          console.error('[postSelected] postCostToFusion error:', e && e.message);
        }
      }

      $page.variables.isPosting = false;

      if (okCount > 0 || miscOk > 0) {
        // re-read so posted weeks render from the ledger (POSTED) via the view, and
        // posted charges from EQR_LINE_MISC_TXN. vbEnterChain is registered (it is
        // the vbEnter listener), so callChain is safe.
        try {
          await Actions.callChain(context, { chain: 'vbEnterChain' });
        } catch (e) {
          console.warn('[postSelected] refresh chain failed:', e && e.message);
        }
        const parts = [];
        if (okCount > 0) parts.push(okCount + ' week(s) — $' + Math.round(movedCost).toLocaleString());
        if (miscOk > 0)  parts.push(miscOk + ' charge(s) — $' + Math.round(miscCost).toLocaleString());
        $page.variables.postSuccess = 'Posted ' + parts.join(' and ')
          + (failCount ? ('  (' + failCount + ' week(s) failed — see console)') : '')
          + (miscFailed ? '  (charges failed — see console)' : '')
          + (sentToFusion ? '  — sent to Fusion PPM'
                          : (fusionFailed
                              ? '  — recorded in EquipRite, but the send to Fusion failed. It will be retried on the next post.'
                              : ''));
      }
      if (failCount > 0 && okCount === 0 && !miscOk) {
        $page.variables.postError = 'Posting failed for ' + failCount + ' week(s). '
          + 'If this is a "not found" error, the EQR_POSTED_WEEK REST resource may not be registered yet.';
      } else if (miscFailed && !miscOk && !okCount) {
        $page.variables.postError = 'Could not post the selected charge(s). '
          + 'If this is a "not found" error, the misc-transactions endpoint is not deployed yet.';
      }
    }
  }

  return postSelectedChain;
});
