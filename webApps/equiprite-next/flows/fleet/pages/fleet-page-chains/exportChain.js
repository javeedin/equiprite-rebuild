define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/equipmentBoard',
  'resources/js/shellBus',
], (ActionChain, exportKit, board, bus) => {
  'use strict';

  // Exports the units shown: what, where, the request it is on, when it is back, the next booking.
  const LANE_LABEL = {};
  board.LANES.forEach((l) => { LANE_LABEL[l.key] = l.label; });

  class exportChain extends ActionChain {
    async run(context, { format }) {
      const v = context.$page.variables;
      v.exportOpen = false;
      const res = await exportKit.run(format, {
        name: 'fleet',
        title: 'Fleet',
        subtitle: [v.tight ? 'Tight turnarounds' : (v.lane !== 'all' ? LANE_LABEL[v.lane] : 'All units'), v.cls, v.text ? '"' + v.text + '"' : ''].filter((x) => !!x).join(' · '),
        rows: v.shown,
        columns: [
          { key: 'unit', label: 'Unit' }, { key: 'type', label: 'Type' }, { key: 'asset', label: 'Asset' }, { key: 'name', label: 'Equipment' },
          { key: 'cls', label: 'Class' }, { key: 'lane', label: 'Where', value: (u) => LANE_LABEL[u.lane] || u.lane },
          { key: 'yard', label: 'Yard' }, { key: 'party', label: 'Project or customer' }, { key: 'requestNumber', label: 'Request' },
          { key: 'start', label: 'From' }, { key: 'end', label: 'Until' }, { key: 'when', label: 'When' },
          { key: 'next', label: 'Next booking', value: (u) => (u.next ? u.next.requestNumber + ' ' + u.next.start : '') },
          { key: 'turnaround', label: 'Turnaround (days)', type: 'number', value: (u) => (u.turnaround != null ? u.turnaround : '') },
          { key: 'qty', label: 'Qty', type: 'number', value: (u) => (u.qty != null ? Number(u.qty) : '') },
          { key: 'status', label: 'Stored unit status' },
        ],
      });
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
