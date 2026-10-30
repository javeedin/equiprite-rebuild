define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/shellBus',
], (ActionChain, exportKit, bus) => {
  'use strict';

  // Exports what is on this transfer: each unit, where it is, its order line.
  class exportUnitsChain extends ActionChain {
    async run(context, { format }) {
      const v = context.$page.variables;
      v.exportOpen = false;
      const h = v.head || {};
      const res = await exportKit.run(format, {
        name: h.number || 'transfer',
        title: 'Transfer ' + (h.number || ''),
        subtitle: [h.kindLabel, h.route, h.label].filter(Boolean).join(' · '),
        rows: v.units,
        columns: [
          { key: 'lineNumber', label: 'Line', type: 'number', value: (u) => (u.lineNumber != null ? Number(u.lineNumber) : '') },
          { key: 'name', label: 'Equipment' }, { key: 'cls', label: 'Class' }, { key: 'serial', label: 'Serial' },
          { key: 'qty', label: 'Qty', type: 'number' },
          { key: 'where', label: 'Where it is', value: (u) => (u.state && u.state.words) || '' },
          { key: 'lineStatus', label: 'Stored line status' },
          { key: 'toLineStatus', label: 'Stored transfer status' },
        ],
      });
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportUnitsChain;
});
