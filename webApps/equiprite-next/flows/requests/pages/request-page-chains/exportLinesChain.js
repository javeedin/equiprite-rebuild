define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/requestProgress',
  'resources/js/shellBus',
], (ActionChain, exportKit, Progress, bus) => {
  'use strict';

  // Exports this request's equipment: what, unit, where it is, dates, rate.
  class exportLinesChain extends ActionChain {
    async run(context, { format }) {
      const v = context.$page.variables;
      v.exportOpen = false;
      const ext = v.head.external;
      const res = await exportKit.run(format, {
        name: v.head.requestNumber || 'request',
        title: 'Request ' + (v.head.requestNumber || ''),
        subtitle: [v.head.project || v.head.customer, v.p.headline].filter(Boolean).join(' · '),
        rows: v.lines,
        columns: [
          { key: 'lineNumber', label: 'Line', type: 'number', value: (l) => (l.lineNumber != null ? Number(l.lineNumber) : '') },
          { key: 'name', label: 'Equipment' }, { key: 'cls', label: 'Class' }, { key: 'qty', label: 'Qty', type: 'number' },
          { key: 'unit', label: 'Unit / serial' },
          { key: 'where', label: 'Where it is', value: (l) => Progress.line(l.lineStatus, ext).label },
          { key: 'start', label: 'Start' }, { key: 'end', label: 'End' },
          { key: 'billRate', label: 'Rate', type: 'number', value: (l) => (l.billRate != null && l.billRate !== '' ? Number(l.billRate) : '') },
          { key: 'lineStatus', label: 'Stored line status' },
        ],
      });
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportLinesChain;
});
