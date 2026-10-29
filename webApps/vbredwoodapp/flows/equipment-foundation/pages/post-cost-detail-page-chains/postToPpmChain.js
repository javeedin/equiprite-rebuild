define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestLineBody',
  'resources/js/currentUser'
], (ActionChain, Actions, lineBody, cu) => {
  'use strict';

  class postToPpmChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const internalRequestId = $page.variables.internalRequestId;
      const ppmProjectNumber  = $page.variables.ppmProjectNumber;
      const ppmTaskNumber     = $page.variables.ppmTaskNumber;
      const ppmBusinessUnit   = $page.variables.ppmBusinessUnit;
      const ppmProjectRefId   = $page.variables.ppmProjectRefId;
      const ppmTaskRefId      = $page.variables.ppmTaskRefId;
      const rateScheduleId    = $page.variables.rateScheduleId;
      const requestNumber     = $page.variables.requestNumber;

      // A PPM project is genuinely required — cost can't post without one.
      // rateScheduleId is NOT required: it only matters for rate-driven costing
      // (RENTABLE / DIRECT-schedule branches). PR markup lines cost PO_price ×
      // margin% and need no schedule, and the amounts are already resolved in
      // EQP_P_POST_COST_DETAILS, so a null/0 rateScheduleId must not block the post.
      if (!ppmProjectNumber) {
        $page.variables.postError = 'This request is not linked to a PPM project. Cannot post costs.';
        return;
      }

      const today = new Date();
      const yyyy = today.getFullYear();
      const mm   = String(today.getMonth() + 1).padStart(2, '0');
      const dd   = String(today.getDate()).padStart(2, '0');
      const batchName = `EQR-${requestNumber}-${yyyy}${mm}${dd}`;

      $page.variables.isPosting   = true;
      $page.variables.postError   = '';
      $page.variables.postSuccess = false;

      try {
        const response = await Actions.callRest(context, {
          endpoint: 'ics/postIcApiIntegrationV1FlowsRestEQP_POST_COST_FLOW1_0EqpPostCost',
          body: {
            internalProjectRefId: internalRequestId,
            internalTaskId:       internalRequestId,
            projectRefId:         ppmProjectRefId,
            taskRefId:            ppmTaskRefId,
            projectNumber:        ppmProjectNumber,
            taskNumber:           ppmTaskNumber,
            businessUnit:         ppmBusinessUnit,
            batchName:            batchName,
            rateScheduleId:       rateScheduleId
          }
        });

        if (response && response.ok) {
          // Persist POSTED status to eqp-v1 DB so refresh reflects the change.
          // Two settle paths — RENTABLE rows flip their time entries to POSTED;
          // DIRECT rows (non-rentable consumables/materials) have no time entry,
          // so we stamp costPostedDate on the request line. That date is the
          // idempotency gate: EQP_P_POST_COST_DETAILS excludes lines where it's
          // set, so a consumable can't be posted twice.
          const entryIds       = $page.variables.matchedEntryIds || [];
          const directLineIds  = $page.variables.matchedDirectLineIds || [];
          const requestId      = $page.variables.internalRequestId;
          let patchFailed = 0;

          for (const entryId of entryIds) {
            const patchResp = await Actions.callRest(context, {
              endpoint: 'eqp-v1/patchTimeEntry',
              uriParams: { id: Number(entryId) },
              body: { status: 'POSTED' }
            });
            if (!patchResp || !patchResp.ok) {
              console.warn('[postToPpmChain] Failed to mark entry POSTED in DB:', entryId);
              patchFailed++;
            }
          }

          // Stamp costPostedDate on non-rentable lines (YYYY-MM-DD, matches the
          // backend LocalDate mapping). Uses today's date — the same day the
          // cost was posted to PPM.
          const postedDate = `${yyyy}-${mm}-${dd}`;
          // ONE batch PATCH stamps every line (one transaction, all or
          // nothing), replacing a sequential per-line loop. On failure no line
          // is stamped, so every one of them counts as not settled.
          if (directLineIds.length) {
            if (!requestId) {
              patchFailed += directLineIds.length;
            } else {
              const stampBatch = await lineBody.updateLines(context, Actions, {
                requestId: Number(requestId),
                headers:   cu.auditHeaders(context),
                updates:   directLineIds.map(lineId => ({ id: Number(lineId), costPostedDate: postedDate }))
              });
              if (!stampBatch.ok) {
                console.warn('[postToPpmChain] costPostedDate batch failed, no line stamped:', stampBatch.message);
                patchFailed += directLineIds.length;
              }
            }
          }

          // Only mark the header POSTED when EVERY line/entry settled. If any
          // settle PATCH failed (e.g. costPostedDate not stamped), those lines
          // still have cost_posted_date NULL and remain on the post-cost view —
          // so they are NOT posted. Flipping the header to POSTED here would mask
          // that partial failure until refresh and invite a double-post. Keep the
          // header un-POSTED on partial failure so the line stays actionable.
          if (patchFailed > 0) {
            $page.variables.postSuccess = false;
            await Actions.fireNotificationEvent(context, {
              summary: 'Partially Posted',
              message: patchFailed + ' line(s) could not be marked as posted and remain on this page. '
                + 'The other costs were submitted to PPM. Re-post the remaining line(s).',
              type: 'warning',
              displayMode: 'persist'
            });
          } else {
            $page.variables.headerStatus = 'POSTED';
            $page.variables.postSuccess  = true;
            await Actions.fireNotificationEvent(context, {
              summary: 'Costs Posted',
              message: 'Costs have been successfully posted to PPM.',
              type: 'confirmation',
              displayMode: 'transient'
            });
          }
        } else {
          $page.variables.postError = 'Failed to post costs to PPM. Please try again.';
          await Actions.fireNotificationEvent(context, {
            summary: 'Error',
            message: 'Failed to post costs to PPM. Please try again.',
            type: 'error',
            displayMode: 'transient'
          });
        }
      } catch (err) {
        console.error('[postToPpmChain] Error:', err);
        $page.variables.postError = 'Unexpected error posting to PPM.';
      } finally {
        $page.variables.isPosting = false;
      }
    }
  }

  return postToPpmChain;
});
