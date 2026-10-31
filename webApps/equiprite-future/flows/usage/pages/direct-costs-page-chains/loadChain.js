define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/usageAccess',
  'resources/js/requestData',
], (ActionChain, Actions, usageAccess, requestData) => {
  'use strict';

  // Opens Direct cost & inventory (or Refresh). Once the settings are in (usageAccess), the requests a cost can be
  // charged against: New's projectCostsInitChain call, views/my-requests with the role's origin filter (ALL for a
  // manager, Internal otherwise), here through requestData, which shares that read with the other Next screens; then
  // New's activeRequests (approved, on its way, on site or coming back). The first one opens, or the one that was open.
  // Reads only.
  class loadChain extends ActionChain {
    async run(context, { refresh }) {
      const { $page } = context;
      const v = $page.variables;
      v.isLoading = true;
      if (!refresh) {
        const acc = await usageAccess.settle(context, 'direct-costs');
        if (!acc.open) {
          v.closed = acc.reason;
          v.isLoading = false;
          return;
        }
      }
      let list = [];
      try {
        const data = await requestData.load(context, Actions, { refresh: !!refresh });
        v.loadError = data.error || '';
        list = $page.functions.activeRequests(data.rows);
        v.requests = list;
      } catch (e) {
        console.error('[direct-costs loadChain] failed', e);
        v.loadError = 'The requests could not be loaded.';
      } finally {
        v.isLoading = false;
      }
      const keep = v.current && list.find((r) => r.id === v.current.id);
      const first = keep || list[0];
      if (first) await Actions.callChain(context, { chain: 'pickRequestChain', params: { id: String(first.id), force: true } });
    }
  }

  return loadChain;
});
