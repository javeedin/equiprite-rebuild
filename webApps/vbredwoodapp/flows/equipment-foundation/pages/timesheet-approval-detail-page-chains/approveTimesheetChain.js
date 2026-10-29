define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/postCostToFusion',
], (ActionChain, Actions, postCostToFusion) => {
  'use strict';

  // "HTTP 400: <Fusion's message>" from a callRest result. OIC returns its
  // APIInvocationError as {title, detail}; anything else falls back to status.
  function describeFailure(resp) {
    if (!resp) { return 'no response'; }
    const b = resp.body;
    let detail = '';
    if (b && typeof b === 'object') { detail = b.detail || b.title || b.message || ''; }
    else if (typeof b === 'string') { detail = b; }
    return 'HTTP ' + (resp.status || '?') + (detail ? ': ' + String(detail).slice(0, 300) : '');
  }

  class approveTimesheetChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;

      const entryIds = $page.functions.getSelectedTimeEntryIdsByStatus('SUBMITTED');
      if (!entryIds || !entryIds.length) {
        $page.variables.approvalError = 'No SUBMITTED rows selected to approve.';
        return;
      }

      // ── Approval is all-or-nothing under PPM rates ──────────────────────
      //
      // Under PPM rates EquipRite calculates no rental cost and the Post Cost
      // screen is withdrawn (R14), so approval is the ONLY event that delivers
      // hours to Fusion. A timesheet must therefore never sit at APPROVED when
      // its hours did not reach Fusion -- that is how 08 §0.10i's request showed
      // "approved" while Fusion had refused every day.
      //
      // The order cannot be flipped (post first, approve after): the OIC flow
      // reads EQP_P_FUSION_POST_QUEUE, whose PPM branch selects
      // te.status = 'APPROVED'. So: approve, post, and on any failure PATCH the
      // rows this run approved back to SUBMITTED. Nothing else hangs off the
      // status (no trigger on EQR_TIME_ENTRY), so the revert takes the days
      // straight back out of the queue.
      //
      // ⚠️ OIC posts row by row and stamps each one as it goes. If day 3 of 5
      // fails, days 1-2 are already in Fusion with PPM_BATCH_NAME set; the
      // re-approval sends only the unstamped days, never those two again.
      //
      // isFeatureEnabled fails CLOSED (false while flags load), which here would
      // mean "approve without posting". Refuse instead until the flags are in.
      // ⚠️ $application MUST be destructured (it is, above) or the lookup
      // silently reads as "flag off".
      if (!$application.variables.flagsLoaded) {
        $page.variables.approvalError = 'Settings are still loading. Please try again in a moment.';
        return;
      }
      const ppmOn = $application.functions.isFeatureEnabled(
        $application.variables.featureFlags,
        $application.variables.flagsLoaded,
        'PPM_RATES_ENABLED'
      );
      const reqNum = $page.variables.requestNumber || '';
      if (ppmOn && !reqNum) {
        $page.variables.approvalError = 'Cannot approve: no request number on this timesheet, '
          + 'so the hours cannot be sent to Fusion PPM.';
        return;
      }

      $page.variables.isApproving = true;
      $page.variables.approvalError = '';

      const approvedIds = [];   // rows THIS run moved to APPROVED -- the revert set
      let failure = '';         // why the approval must not stand
      let sentToFusion = false;

      try {
        try {
          for (const entryId of entryIds) {
            const response = await Actions.callRest(context, {
              endpoint: 'eqp-v1/patchTimeEntry',
              uriParams: { id: Number(entryId) },
              body: { status: 'APPROVED' }
            });
            if (!response || !response.ok) {
              failure = 'Could not approve entry ' + entryId + ' (' + describeFailure(response) + ').';
              break;
            }
            approvedIds.push(entryId);
          }

          // The payload is {requestNumber} only. OIC re-reads the queue itself
          // and sends whatever is APPROVED but unstamped, so a repeat call posts
          // nothing twice. The flow is synchronous with no fault handler, so a
          // Fusion rejection comes back here as a non-2xx.
          if (!failure && ppmOn) {
            // Project URL first, v1 on 404 -- the two OICs differ, see the module.
            const fResp = await postCostToFusion.post(context, Actions, reqNum);
            if (fResp && fResp.ok) { sentToFusion = true; }
            else {
              console.warn('[approveTimesheet] postCostToFusion not ok:', fResp && fResp.status, fResp && fResp.body);
              // Not always Fusion: an OIC that does not serve the flow 404s too.
              failure = 'The send to Fusion PPM failed (' + describeFailure(fResp) + ').';
            }
          }
        } catch (e) {
          console.error('[approveTimesheet] error:', e && e.message);
          failure = failure || ('Approval error: ' + ((e && e.message) || e));
        }

        if (failure) {
          // Undo this run's approvals. A revert that fails is reported by id --
          // that row IS approved and the approver needs to know which one.
          const stuck = [];
          for (const entryId of approvedIds) {
            try {
              const r = await Actions.callRest(context, {
                endpoint: 'eqp-v1/patchTimeEntry',
                uriParams: { id: Number(entryId) },
                body: { status: 'SUBMITTED' }
              });
              if (!r || !r.ok) { stuck.push(entryId); }
            } catch (e) {
              stuck.push(entryId);
            }
          }
          $page.variables.approvalError = 'Timesheet NOT approved. ' + failure
            + (stuck.length
                ? ' ⚠️ Entries ' + stuck.join(', ') + ' could not be returned to SUBMITTED and are still APPROVED.'
                : ' It is still SUBMITTED; fix the cause and approve again.');
          await Actions.fireNotificationEvent(context, {
            summary: 'Timesheet not approved',
            message: failure,
            type: 'error',
            displayMode: 'persist'
          });
        } else {
          await Actions.fireNotificationEvent(context, {
            summary: 'Success',
            message: 'Timesheet successfully approved.' + (sentToFusion ? ' Hours sent to Fusion PPM.' : ''),
            type: 'confirmation',
            displayMode: 'transient'
          });
        }

        // Refresh grid rows to show the status as it now stands -- after a
        // revert too, so the header drops back to SUBMITTED.
        const refreshResp = await Actions.callRest(context, {
          endpoint:  'eqp-v1/getEquipriteV1ViewsTimesheetApprovalDetails',
          // The view is PAGED and holds every request's rows, and this chain
          // filters client-side -- so page 0 (Spring default size=20 of 54 rows)
          // could omit the very week being opened. uriParams, NOT parameters:
          // `parameters` is silently dropped in this VB project.
          uriParams: { page: 0, size: 1000 }
        });
        if (refreshResp && refreshResp.ok && refreshResp.body && Array.isArray(refreshResp.body.data)) {
          const requestNumber = $page.variables.requestNumber || '';
          const weekStartDate = $page.variables.weekStartDate || '';
          const rows = refreshResp.body.data.filter(r => {
            const rowWeek = r.weekStartDate ? String(r.weekStartDate).slice(0, 10) : '';
            return r.requestNumber === requestNumber && rowWeek === weekStartDate;
          });

          if (rows.length) {
            const allApproved = rows.every(r => r.timesheetStatus === 'APPROVED');
            const anyRejected = rows.some(r => r.timesheetStatus === 'REJECTED');
            const allSettled  = rows.every(r =>
              r.timesheetStatus === 'APPROVED' || r.timesheetStatus === 'REJECTED'
            );
            $page.variables.headerStatus = allApproved ? 'APPROVED'
              : anyRejected && allSettled  ? 'REJECTED'
              : anyRejected                ? 'SUBMITTED'
              : 'SUBMITTED';

            const lines = rows.map(r => ({
              request_number:     r.requestNumber      || '',
              class_name:         r.className          || '',
              equipment_name:     r.equipmentName      || '',
              eqr_time_entry_id:  r.eqrTimeEntryId     || null,
              hours_type:         r.hoursType          || '',
              status:             r.entryStatus        || '',
              task_name:          r.taskName           || '',
              start_date:         r.requestedStartDate ? r.requestedStartDate.slice(0, 10) : '',
              end_date:           r.requestedEndDate   ? r.requestedEndDate.slice(0, 10)   : '',
              non_labor_resource: r.nonLaborResource   || '',
              hours_day1:         r.day1Hours          || 0,
              hours_day2:         r.day2Hours          || 0,
              hours_day3:         r.day3Hours          || 0,
              hours_day4:         r.day4Hours          || 0,
              hours_day5:         r.day5Hours          || 0,
              hours_day6:         r.day6Hours          || 0,
              hours_day7:         r.day7Hours          || 0
            }));
            const provider = $page.functions.initProviderFromLinesReadOnly(lines, weekStartDate);
            $page.variables.dataGridProvider = provider;
          }
        }
      } catch (e) {
        $page.variables.approvalError = $page.variables.approvalError
          || ('Approval error: ' + ((e && e.message) || e));
      } finally {
        $page.variables.isApproving = false;
        $page.functions.clearSelection($page.variables);
      }
    }
  }

  return approveTimesheetChain;
});
