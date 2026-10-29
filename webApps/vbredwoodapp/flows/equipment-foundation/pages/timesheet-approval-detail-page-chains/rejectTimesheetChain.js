define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class rejectTimesheetChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const entryIds = $page.functions.getSelectedTimeEntryIdsByStatus('SUBMITTED');
      if (!entryIds || !entryIds.length) {
        $page.variables.approvalError = 'No SUBMITTED rows selected to reject.';
        return;
      }

      $page.variables.isRejecting = true;
      $page.variables.approvalError = '';

      try {
        for (const entryId of entryIds) {
          const response = await Actions.callRest(context, {
            endpoint: 'eqp-v1/patchTimeEntry',
            uriParams: { id: Number(entryId) },
            body: { status: 'REJECTED' }
          });
          if (!response || !response.ok) {
            $page.variables.approvalError = 'Failed to reject entry ' + entryId;
            $page.variables.isRejecting = false;
            return;
          }
        }
        // Refresh grid rows to show updated status
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
        
        await Actions.fireNotificationEvent(context, {
          summary: 'Success',
          message: 'Timesheet successfully rejected.',
          type: 'confirmation',
          displayMode: 'transient'
        });
      } catch (e) {
        $page.variables.approvalError = 'Rejection error: ' + (e.message || e);
      } finally {
        $page.variables.isRejecting = false;
        $page.functions.clearSelection($page.variables);
      }
    }
  }

  return rejectTimesheetChain;
});
