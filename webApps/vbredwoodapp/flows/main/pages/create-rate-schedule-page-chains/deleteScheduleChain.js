define([
  'vb/action/actionChain',
  'vb/action/actions',
  'vb/action/actionUtils',
], (
  ActionChain,
  Actions,
  ActionUtils
) => {
  'use strict';

  class deleteScheduleChain extends ActionChain {

    /**
     * @param {Object} context
     */
    async run(context) {
      const { $page, $flow, $application } = context;

      const scheduleId = Number($page.variables.scheduleId);
      if (!scheduleId) {
        return;
      }

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

          // Navigate back to the list page (rate-schedule-page)
          await Actions.navigateToPage(context, {
            page: 'rate-schedule'
          });
        } else {
          await Actions.fireNotificationEvent(context, {
            summary: 'Error',
            message: 'Failed to delete Rate Schedule. ' + (deleteResponse.statusText || ''),
            displayMode: 'transient',
            type: 'error'
          });
        }
      } catch (error) {
        if (error.name === 'AbortError' || error.message?.includes('Aborting stale fetch')) {
          console.log('Fetch aborted (normal JET rendering behavior).');
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
