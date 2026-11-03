define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/shellBus',
], (ActionChain, Actions, bus) => {
  'use strict';

  // Opens the request another screen handed over (Requests: "Assign units"; a request's tab: "Approve…", "Assign
  // units"), once the queue has loaded, and shows only it: the user asked for this one request, so the queue, its chips
  // and the bulk decision step aside (focus) until "Show the whole queue". "Back to …" brings the screen it came from to
  // the front again. A request with nothing to decide or assign is not in the queue: the bar says so, with the same way back.
  class focusChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      for (let i = 0; i < 600 && v.isLoading; i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      const what = bus.takeFocus('approvals');
      if (!what) return;
      const item = (v.items || []).filter((i) => (what.id && i.key === String(what.id)) || (what.number && i.number === what.number))[0];
      const from = what.from && what.from.label ? what.from : { label: '', open: null };
      v.focus = { key: item ? item.key : '', number: (item && item.number) || what.number || '', label: String(from.label || ''), open: from.open || null, missing: !item };
      if (!item) {
        await Actions.callChain(context, { chain: 'selectChain', params: { key: '' } });
        return;
      }
      await Actions.callChain(context, { chain: 'selectChain', params: { key: item.key } });
    }
  }

  return focusChain;
});
