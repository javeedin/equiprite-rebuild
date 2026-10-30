define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/shellBus',
], (ActionChain, exportKit, bus) => {
  'use strict';

  // Exports what would be posted (each ledger row or charge: what, quantity, expenditure type, where it posts, amount),
  // or the cost week by week.
  class exportChain extends ActionChain {
    async run(context, { format, what }) {
      const { $page } = context;
      const v = $page.variables;
      const fns = $page.functions;
      v.exportOpen = false;
      const num = v.row.requestNumber || v.number || 'request';
      const plan = what === 'plan';
      const res = await exportKit.run(format, {
        name: num + (plan ? '-to-post' : '-costs'),
        title: num + (plan ? ': what would be posted' : ': cost week by week'),
        subtitle: [fns.subline(v.row), plan ? fns.money(fns.planTotal(v.plan)) + ' · posted from New EquipRite' : ''].filter(Boolean).join(' · '),
        rows: plan ? v.plan : v.table,
        columns: fns.exportColumns(plan ? 'plan' : 'weeks'),
      });
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
