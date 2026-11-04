define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The Redwood look's header (your menu, Look): each of its actions takes the current look's chain.
  //   refresh       Refresh (loadRecordChain)
  //   exportPlan    Export, what will be posted, as Excel (exportChain)
  //   exportWeeks   Export, the cost week by week, as Excel (exportChain)
  class rwActionChain extends ActionChain {
    async run(context, { id }) {
      if (id === 'refresh') await Actions.callChain(context, { chain: 'loadRecordChain', params: { refresh: true } });
      else if (id === 'exportPlan') await Actions.callChain(context, { chain: 'exportChain', params: { format: 'xlsx', what: 'plan' } });
      else if (id === 'exportWeeks') await Actions.callChain(context, { chain: 'exportChain', params: { format: 'xlsx', what: 'weeks' } });
    }
  }

  return rwActionChain;
});
