define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/shellBus',
], (ActionChain, Actions, bus) => {
  'use strict';

  // A filter, "show more", the export menu, a reason being typed, or a result dismissed. One request in front (focus):
  // focusAll shows the whole queue again, the request staying open; focusBack brings the screen that opened it here to
  // the front again. toYard: the open request in Picking & shipping (confirmed, with the yard).
  const PAGE = 60;

  class setChain extends ActionChain {
    async run(context, { field, value }) {
      const v = context.$page.variables;
      if (field === 'exportOpen') { v.exportOpen = value === 'toggle' ? !v.exportOpen : !!value; return; }
      if (field === 'limit') { v.limit += PAGE; return; }
      if (field === 'reason') { v.reason = String(value || ''); if (v.reason.trim()) v.formError = ''; return; }
      if (field === 'bulkReason') { v.bulk = Object.assign({}, v.bulk, { reason: String(value || ''), error: '' }); return; }
      if (field === 'result') { v.result = null; return; }
      if (field === 'bulkResult') { v.bulkResult = null; return; }
      if (field === 'toYard') {
        const head = (v.rec && v.rec.head) || {};
        bus.focus('picking', { id: Number(head.id) || undefined, number: head.number || '', from: { label: 'Approve & allocate', open: { navId: 'approvals' } } });
        return;
      }
      if (field === 'focusAll' || field === 'focusBack') {
        // A plain copy: the page variable is reset next, and a reference to it would read the reset value.
        const to = v.focus && v.focus.open ? JSON.parse(JSON.stringify(v.focus.open)) : null;
        v.focus = { number: '' };
        if (field === 'focusBack' && to) bus.open(to);
        return;
      }
      if (field === 'text') v.text = String(value || '');
      if (field === 'stage') v.stage = value || 'all';
      if (field === 'source') v.source = v.source === value ? '' : (value || '');
      v.limit = PAGE;
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return setChain;
});
