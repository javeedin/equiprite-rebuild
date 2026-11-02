define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/sqlWorksheet',
  'resources/js/shellBus',
], (ActionChain, exportKit, W, bus) => {
  'use strict';

  // The rows fetched, as the grid shows them: Excel, CSV, print or copy.
  class exportChain extends ActionChain {
    async run(context, { format }) {
      const v = context.$page.variables;
      v.exportOpen = false;
      const spec = W.exportSpec(v.raw.columns, v.raw.rows);
      const res = await exportKit.run(format, {
        name: 'sql-result',
        title: 'SQL result · ' + (v.session.name || ''),
        subtitle: String(v.res.statement || '').replace(/\s+/g, ' ').slice(0, 200),
        rows: spec.rows,
        columns: spec.columns,
      });
      bus.toast(res.message + (v.res.more ? ' Only the rows fetched so far: fetch more first for the rest.' : ''), res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
