define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/shellBus',
], (ActionChain, exportKit, bus) => {
  'use strict';

  // Exports one list as shown: the requests, the request's equipment and consumables, its material issues, its direct
  // costs or its cost history.
  const TITLES = { requests: 'Approved and active requests', lines: 'Equipment and consumables', issues: 'Material issues',
    direct: 'Direct costs', history: 'Cost history' };

  class exportChain extends ActionChain {
    async run(context, { format, what }) {
      const { $page } = context;
      const v = $page.variables;
      const fns = $page.functions;
      v.exportOpen = '';
      const num = v.current ? v.current.requestNumber : '';
      const rows = {
        requests: () => fns.requestRows(v.requests, v.requestText),
        lines: () => fns.lineRows(v.lines, v.consumptions),
        issues: () => fns.issueRows(v.consumptions, v.lines),
        direct: () => fns.directRows(v.directCosts),
        history: () => fns.historyRows(v.costRows),
      }[what] || (() => []);
      const res = await exportKit.run(format, {
        name: what === 'requests' ? 'direct-cost-requests' : (num + '-' + what),
        title: (what === 'requests' ? '' : num + ': ') + (TITLES[what] || 'Export'),
        subtitle: what === 'requests' ? (v.requestText ? '"' + v.requestText + '"' : '')
          : [v.current ? v.current.projectName : '', v.current ? v.current.taskName : ''].filter(Boolean).join(' / '),
        rows: rows(),
        columns: fns.exportColumns(what),
      });
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
