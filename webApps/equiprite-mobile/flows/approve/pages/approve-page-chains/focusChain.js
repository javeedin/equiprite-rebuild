define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/mobileBus',
  'resources/js/mobileApprove',
], (ActionChain, Actions, bus, ma) => {
  'use strict';

  // A request another tab (My requests: "Approve or send back") or a deep link (?tab=approve&number=…) asked for:
  // mobileBus.focus('approve', { id, number }). Opened once the queue has it, under a chip that shows it; before the
  // queue has loaded, the load takes it when done. A request with nothing to decide or assign is not in the queue: a
  // toast says so.
  class focusChain extends ActionChain {
    async run(context) {
      const pv = context.$page.variables;
      if (pv.isLoading) return;
      const want = bus.takeFocus('approve');
      if (!want) return;
      const hit = (pv.all || []).filter((c) => (want.id && String(c.id) === String(want.id)) || (want.number && c.number === String(want.number)))[0];
      if (!hit) {
        bus.toast((want.number || 'That request') + ' has nothing waiting to approve or assign.', 'info');
        return;
      }
      const key = hit.key;
      const keys = ma.keysOf(hit);
      if (pv.text || keys.indexOf(pv.chip) === -1) {
        const el = typeof document !== 'undefined' ? document.getElementById('apSearch') : null;
        if (el) el.value = '';
        await Actions.callChain(context, { chain: 'applyChain', params: { chip: hit.kind, text: '' } });
      }
      await Actions.callChain(context, { chain: 'openChain', params: { key } });
    }
  }

  return focusChain;
});
