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

  class onSecondaryActionChain extends ActionChain {

    /**
     * @param {Object} context
     * @param {Object} params
     * @param {string} params.actionId 
     */
    async run(context, { event }) {
      const { $page, $flow, $application } = context;
      const actionId = event && event.detail && event.detail.secondaryItem;

      if (actionId === 'cancel') {
        await Actions.callChain(context, {
          chain: 'cancelChain',
        });
      } else if (actionId === 'delete') {
        const scheduleId = Number($page.variables.scheduleId);
        if (!scheduleId) return;

        const deleteResponse = await Actions.callRest(context, {
          endpoint: 'eqp-v1/deleteRateSchedule',
          uriParams: { id: scheduleId }
        });

        if (deleteResponse.ok) {
          await Actions.fireNotificationEvent(context, {
            summary: 'Success',
            message: 'Rate Schedule successfully deleted.',
            displayMode: 'transient',
            type: 'confirmation'
          });
          await Actions.navigateToPage(context, { page: 'rate-schedule' });
        } else {
          await Actions.fireNotificationEvent(context, {
            summary: 'Error',
            message: 'Failed to delete Rate Schedule. ' + (deleteResponse.statusText || ''),
            displayMode: 'transient',
            type: 'error'
          });
        }
      }
    }
  }

  return onSecondaryActionChain;
});
