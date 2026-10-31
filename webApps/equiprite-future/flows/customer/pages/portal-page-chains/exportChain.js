define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/portalView',
  'resources/js/shellBus',
], (ActionChain, exportKit, V, bus) => {
  'use strict';

  // Exports what the current view shows (its chip, its search, its order): the requests, the equipment or the
  // invoices; from the overview, every request. Never a serial number.
  class exportChain extends ActionChain {
    async run(context, { format }) {
      const v = context.$page.variables;
      v.exportOpen = false;
      const chipLabel = (chips, key) => { const c = (chips || []).filter((x) => x.key === key)[0]; return c && key !== 'all' ? c.label : 'All'; };
      let o;
      if (v.view === 'equipment') {
        o = { name: 'my-equipment', title: 'Your equipment', subtitle: [chipLabel(v.eqChips, v.eqChip), v.eqText ? '"' + v.eqText + '"' : ''], rows: v.eqShown, what: 'equipment' };
      } else if (v.view === 'invoices') {
        o = { name: 'my-invoices', title: 'Your invoices', subtitle: [chipLabel(v.invChips, v.invChip), v.invText ? '"' + v.invText + '"' : ''], rows: v.invShown, what: 'invoices' };
      } else if (v.view === 'requests') {
        o = { name: 'my-requests', title: 'Your requests', subtitle: [chipLabel(v.reqChips, v.reqGroup), v.reqText ? '"' + v.reqText + '"' : ''], rows: v.reqShown, what: 'requests' };
      } else {
        o = { name: 'my-requests', title: 'Your requests', subtitle: ['All'], rows: v.rows, what: 'requests' };
      }
      const res = await exportKit.run(format, {
        name: o.name,
        title: o.title,
        subtitle: [v.customerName].concat(o.subtitle).filter(Boolean).join(' · '),
        rows: o.rows,
        columns: V.exportColumns(o.what),
      });
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
