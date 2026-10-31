define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/integrationsView',
  'resources/js/shellBus',
], (ActionChain, exportKit, view, bus) => {
  'use strict';

  // Exports one list as shown: the integrations, the exception queue (its chip) or the sync runs.
  class exportChain extends ActionChain {
    async run(context, { list, format }) {
      const v = context.$page.variables;
      v.exportOpen = '';
      const spec = view.exportOf(list);
      const rows = list === 'cards' ? v.m.cards : (list === 'jobs' ? v.m.jobs : v.m.queue);
      const res = await exportKit.run(format, {
        name: spec.name,
        title: spec.title,
        subtitle: ['Checked ' + v.checkedAt, list === 'queue' && v.integ ? v.integ : ''].filter(Boolean).join(' · '),
        rows,
        columns: spec.columns,
      });
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
