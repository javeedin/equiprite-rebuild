define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/shellBus',
], (ActionChain, exportKit, bus) => {
  'use strict';

  // Exports what will be posted (each ledger row or charge ticked: what, quantity, expenditure type, where it posts,
  // amount; everything ready for a role that may only look), or the cost week by week.
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
        title: num + (plan ? (v.readOnly ? ': what would be posted' : ': what will be posted') : ': cost week by week'),
        subtitle: [fns.subline(v.row), plan ? fns.money(fns.planTotal(v.plan)) + ' to Fusion PPM' : ''].filter(Boolean).join(' · '),
        rows: plan ? v.plan : v.table,
        columns: fns.exportColumns(plan ? 'plan' : 'weeks'),
      });
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
