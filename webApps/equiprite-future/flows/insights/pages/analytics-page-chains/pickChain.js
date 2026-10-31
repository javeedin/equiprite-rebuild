define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Another question: show it at once when its data is loaded, else load it (the tab says it is loading).
  class pickChain extends ActionChain {
    async run(context, { report }) {
      const v = context.$page.variables;
      if (!report || !(v.reports || []).some((r) => r.key === report)) return;
      v.exportOpen = false;
      v.limit = 100;
      v.report = report;
      if (v.loaded[report]) {
        await Actions.callChain(context, { chain: 'applyChain' });
      } else {
        await Actions.callChain(context, { chain: 'loadChain', params: { report } });
      }
    }
  }

  return pickChain;
});
