define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/equipmentMaster',
  'resources/js/shellBus',
], (ActionChain, exportKit, em, bus) => {
  'use strict';

  // Exports one of the item's lists, as shown: its units (with the units search), its documents, or its Fusion work
  // orders.
  class exportChain extends ActionChain {
    async run(context, { format }) {
      const { $page } = context;
      const v = $page.variables;
      const f = $page.functions;
      v.exportOpen = false;
      const m = v.masterRecord || {};
      const base = m.equipmentNumber || ('equipment-' + v.equipmentId);
      const name = m.equipmentName || m.equipmentNumber || 'Equipment';
      let opts;
      if (v.exportWhat === 'docs') {
        opts = { name: base + '-documents', title: name + ': documents', subtitle: f.certText(v.attRows), rows: v.attRows, columns: em.docColumns() };
      } else if (v.exportWhat === 'wos') {
        opts = { name: base + '-work-orders', title: name + ': Fusion work orders', subtitle: f.woText(v.workOrders, v.woLoaded, v.woLoading),
          rows: v.workOrders, columns: em.workOrderColumns() };
      } else {
        opts = { name: base + '-units', title: name + ': ' + f.unitsTitle(v.controlType).toLowerCase(),
          subtitle: [m.equipmentNumber, f.classText(m), v.unitFilter ? '"' + v.unitFilter + '"' : ''].filter((x) => !!x).join(' · '),
          rows: f.filterUnits(v.unitsArray, v.unitFilter), columns: em.unitColumns(f, v.controlType) };
      }
      const res = await exportKit.run(format, opts);
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
