define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Back to the Workbench, or on to this request's Request detail (the request flow).
  class goChain extends ActionChain {
    async run(context, { to }) {
      const { $page } = context;
      if (to === 'request-detail') {
        await Actions.navigateToFlow(context, {
          flow: 'request',
          page: 'request-detail',
          params: { requestId: String($page.variables.requestId || ''), requestNumericId: Number($page.variables.requestNumericId) },
          target: 'parent'
        });
        return;
      }
      await Actions.navigateToPage(context, { page: 'workbench' });
    }
  }

  return goChain;
});
