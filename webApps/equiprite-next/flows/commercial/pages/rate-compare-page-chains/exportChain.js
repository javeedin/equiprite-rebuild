define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/rateCompare',
  'resources/js/shellBus',
], (ActionChain, exportKit, RC, bus) => {
  'use strict';

  // Exports the comparison shown (the rows the search and Only where they differ keep): a row per comparison row, for
  // each schedule its value, against the base and its note. Excel, CSV, PDF or rows to paste.
  class exportChain extends ActionChain {
    async run(context, { format }) {
      const v = context.$page.variables;
      v.exportOpen = false;
      const view = JSON.parse(JSON.stringify(v.view || {}));
      const opts = v.opts || {};
      const res = await exportKit.run(format || 'xlsx', {
        name: 'rate-comparison',
        title: 'Rate comparison',
        subtitle: [(view.cols || []).map((c) => c.name + (c.base ? ' (base)' : '')).join(' · '),
          view.mode === 'rental' ? 'A rental of ' + (opts.days || 0) + ' days' : 'Rate / day by tier', view.text].filter(Boolean).join(' · '),
        rows: view.rows || [],
        columns: RC.exportColumns(view.cols || [], view.mode),
      });
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
