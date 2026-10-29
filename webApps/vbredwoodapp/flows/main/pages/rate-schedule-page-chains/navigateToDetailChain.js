
define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class navigateToDetailChain extends ActionChain {
    /**
     * @param {Object} context
     * @param {Object} params
     * @param {string} params.scheduleId
     */
    async run(context, params) {
      // oj-table fires firstSelectedRowChanged PART WAY THROUGH its own
      // select-and-focus sequence. Navigating synchronously from here tore the
      // page down mid-sequence, and the dying table then tried to resolve the
      // key of a row whose data was already gone:
      //   TypeError: Cannot read properties of undefined (reading 'key')
      //     at GetKey / _fireBeforeSelectEvent / HandleSelectionOption
      // reported by VB as "Fatal exception delivering binding updates", which
      // aborts the rest of that binding-delivery cycle. Yield one macrotask so
      // the table finishes selecting before the route changes. Navigation
      // behaviour is unchanged.
      await new Promise(resolve => setTimeout(resolve, 0));

      const { $page } = context;
      const scheduleId = params.scheduleId;

      console.log('[navigateToDetailChain] Navigating to edit rate schedule:', scheduleId);

      if (!scheduleId) {
        console.warn('[navigateToDetailChain] No scheduleId provided.');
        return;
      }

      // Navigate to create-rate-schedule in "Edit" mode by passing the ID
      await Actions.navigateToPage(context, {
        page: 'create-rate-schedule',
        params: { scheduleId: scheduleId }
      });
    }
  }

  return navigateToDetailChain;
});
