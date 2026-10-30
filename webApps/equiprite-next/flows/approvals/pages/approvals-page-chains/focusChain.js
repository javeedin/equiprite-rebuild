define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/shellBus',
], (ActionChain, Actions, bus) => {
  'use strict';

  // Opens the request another screen handed over (Requests: "Assign units"; a request's tab: "Approve"), once the
  // queue has loaded. A request with nothing to decide or assign is not in the queue: a toast says so.
  class focusChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      for (let i = 0; i < 600 && v.isLoading; i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      const what = bus.takeFocus('approvals');
      if (!what) return;
      const item = (v.items || []).filter((i) => (what.id && i.key === String(what.id)) || (what.number && i.number === what.number))[0];
      if (!item) {
        bus.toast((what.number || 'That request') + ' has nothing waiting to approve or assign.', 'info');
        return;
      }
      await Actions.callChain(context, { chain: 'selectChain', params: { key: item.key } });
    }
  }

  return focusChain;
});
