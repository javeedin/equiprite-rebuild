define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/usageAccess',
  'resources/js/costData',
], (ActionChain, Actions, usageAccess, costData) => {
  'use strict';

  // Opens Post costs (or Refresh). Once the settings are in (usageAccess: Post costs is withdrawn under Fusion PPM
  // rates, as in New), New's list reads (costData.list: views/post-cost and the misc charges), then each request is
  // worked out in the background (breakdownChain). Reads only: nothing is written here, on entry or later.
  class loadChain extends ActionChain {
    async run(context, { refresh }) {
      const { $page } = context;
      const v = $page.variables;
      v.isLoading = true;
      if (!refresh) {
        const acc = await usageAccess.settle(context, 'costs');
        if (!acc.open) {
          v.closed = acc.reason;
          v.isLoading = false;
          return;
        }
      }
      try {
        const data = await costData.list(context, Actions, { refresh: !!refresh });
        v.loadError = data.error || '';
        v.gen = (v.gen || 0) + 1;
        v.breakdown = {};
        v.progress = { done: 0, total: 0, failed: 0 };
        v.misc = data.misc || [];
        v.list = data.list || [];
      } finally {
        v.isLoading = false;
      }
      await Actions.callChain(context, { chain: 'breakdownChain', params: { gen: v.gen } });
    }
  }

  return loadChain;
});
