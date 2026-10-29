define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Delete schedule: the old create-rate-schedule-page-chains/deleteScheduleChain.js (DELETE /rate-schedules/{id},
  // a notice either way). Changes: it asks first on the page's question card (the old menu item deleted at once),
  // FULL access is checked, and afterwards the list is read again and the first schedule opens instead of
  // navigating to the old list page.
  class deleteScheduleChain extends ActionChain {
    async run(context, params) {
      const { $page, $application } = context;
      const av = $application.variables;
      if ($application.functions.pageAccess(av.pageAccessMap, av.pageAccessLoaded, 'EQR_RATE_SCHEDULE') !== 'FULL') return;

      const scheduleId = Number($page.variables.selectedId);
      if (!scheduleId) {
        return;
      }
      if (!(params && params.confirmed)) {
        const n = ($page.variables.lines || []).length;
        $page.variables.ask = {
          kind: 'deleteSchedule', title: 'Delete ' + ($page.variables.formData.scheduleName || 'this schedule') + '?',
          message: 'Deletes the schedule and its ' + n + ' rate line' + (n === 1 ? '' : 's') + '. Requests priced from it '
            + 'fall back to the next matching schedule. This cannot be undone.',
          ok: 'Delete schedule',
        };
        return;
      }
      $page.variables.ask = null;

      try {
        const deleteResponse = await Actions.callRest(context, {
          endpoint: 'eqp-v1/deleteRateSchedule',
          uriParams: {
            id: scheduleId
          }
        });

        if (deleteResponse.ok) {
          await Actions.fireNotificationEvent(context, {
            summary: 'Success',
            message: 'Rate Schedule successfully deleted.',
            displayMode: 'transient',
            type: 'confirmation'
          });
          $page.variables.dirty = false;
          $page.variables.selectedId = '';
          $page.variables.formData = {};
          $page.variables.lines = [];
          await Actions.callChain(context, { chain: 'loadSchedulesChain' });
          const first = ($page.variables.schedules || [])[0];
          if (first) {
            await Actions.callChain(context, { chain: 'selectScheduleChain', params: { id: first.id, confirmed: true } });
          }
        } else {
          await Actions.fireNotificationEvent(context, {
            summary: 'Error',
            message: 'Failed to delete Rate Schedule. ' + (deleteResponse.statusText || ''),
            displayMode: 'transient',
            type: 'error'
          });
        }
      } catch (error) {
        if (error.name === 'AbortError' || (error.message && error.message.includes('Aborting stale fetch'))) {
          return;
        }
        await Actions.fireNotificationEvent(context, {
          summary: 'Error',
          message: 'An unexpected error occurred while deleting the schedule: ' + error.message,
          displayMode: 'transient',
          type: 'error'
        });
      }
    }
  }

  return deleteScheduleChain;
});
