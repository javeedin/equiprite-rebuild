define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/shellBus',
], (ActionChain, exportKit, bus) => {
  'use strict';

  // A step from the request's tab: the screen that takes it opens on this request (shellBus.focus), so the decision,
  // the units and the picking keep their own screens' rules and checks. Also: the history's view and its export.
  //   act: approve | assign (Approve & allocate) | pick (Picking & shipping) | help | tab (value) | export (value)
  class stepChain extends ActionChain {
    async run(context, { act, value }) {
      const v = context.$page.variables;
      const head = v.head || {};
      const what = { id: head.id ? Number(head.id) : undefined, number: head.requestNumber || '' };
      if (act === 'approve' || act === 'assign') { bus.focus('approvals', what); return; }
      if (act === 'pick') { bus.focus('picking', what); return; }
      if (act === 'help') { bus.open({ navId: 'help' }); return; }
      if (act === 'tab') { v.histTab = value === 'activity' ? 'activity' : 'steps'; return; }
      if (act === 'export') {
        const h = v.history || {};
        const res = await exportKit.run(value, {
          name: 'history-' + (head.requestNumber || 'request'),
          title: (head.requestNumber || 'Request') + ': history',
          subtitle: [head.project || head.customer, v.p ? v.p.headline : ''].filter(Boolean).join(' · '),
          rows: h.events || [],
          columns: [
            { key: 'when', label: 'When' }, { key: 'title', label: 'What happened' }, { key: 'text', label: 'Details' },
            { key: 'who', label: 'Who' }, { key: 'source', label: 'Source', value: (r) => (r.recorded ? 'Recorded status change' : 'From its dates and transfer orders') },
          ],
        });
        bus.toast(res.message, res.ok ? 'info' : 'error');
      }
    }
  }

  return stepChain;
});
