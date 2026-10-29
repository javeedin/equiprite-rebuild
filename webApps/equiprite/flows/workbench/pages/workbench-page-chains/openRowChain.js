define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Opens a row. how = 'detail' (the request number): Approve & allocate while approval or allocation is open, else
  // Request detail. how = 'action' (the Next action button): what workbench-page.js nextAction says, which can also
  // be another menu item (Initiate picking, Receipt & returns) opened through openNavChain.
  class openRowChain extends ActionChain {
    async run(context, { id, how }) {
      const { $page } = context;
      const v = $page.variables;
      const f = $page.functions;
      const row = ((v.buckets && v.buckets[v.tab]) || []).find((r) => String(r.request_id) === String(id));
      if (!row || row.request_id == null) {
        return;
      }
      const action = how === 'action' ? f.nextAction(row, v.tab) : { target: f.detailTarget(row) };
      const params = { requestId: String(row.request_number || ''), requestNumericId: Number(row.request_id) };
      if (action.target === 'approve-allocate') {
        await Actions.navigateToPage(context, { page: 'approve-allocate', params });
      } else if (action.target === 'request-detail') {
        await Actions.navigateToFlow(context, { flow: 'request', page: 'request-detail', params, target: 'parent' });
      } else if (action.target === 'nav' && action.navId) {
        await Actions.callChain(context, { chain: 'openNavChain', params: { navId: action.navId } });
      }
    }
  }

  return openRowChain;
});
