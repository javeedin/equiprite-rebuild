define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/insightsModel',
  'resources/js/shellBus',
], (ActionChain, exportKit, model, bus) => {
  'use strict';

  // Exports the shown question's table, as filtered and in its order: Excel, CSV, PDF or rows to paste.
  class exportChain extends ActionChain {
    async run(context, { format }) {
      const v = context.$page.variables;
      v.exportOpen = false;
      const key = v.cur.report;
      if (!key) return;
      const f = v.f[key] || {};
      const spec = model.exportOf(key, f.view);
      const what = (v.reports.filter((r) => r.key === key)[0] || {}).question || spec.title;
      const filters = (v.cur.m.filters || []).map((x) => x.label);
      if (key === 'use') filters.unshift(v.cur.m.period || '');
      const chip = (v.cur.m.chips || []).filter((c) => c.key === (f.show || f.kind || f.posted))[0];
      if (chip && chip.key !== 'all') filters.unshift(chip.label);
      if (f.text) filters.push('"' + f.text + '"');
      const res = await exportKit.run(format, {
        name: spec.name,
        title: spec.title,
        subtitle: [what].concat(filters).filter(Boolean).join(' · '),
        rows: v.cur.m.rows || [],
        columns: spec.columns,
      });
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
