define([
  'vb/action/actionChain',
  'resources/js/requestList',
  'resources/js/insightsModel',
], (ActionChain, list, model) => {
  'use strict';

  // Shows the picked question: its model (insightsModel) from the loaded data and the question's filters. The report
  // and its model are switched in one assignment (cur), so a report's template never meets another report's model.
  // A question whose data is not in yet keeps the previous one on screen (the page says it is loading).
  class applyChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const key = v.report;
      if (!key || !v.loaded[key]) return;
      const r = v.raw || {};
      const f = v.f[key] || {};
      const now = Date.now();
      let m = {};
      if (key === 'fleet') {
        m = model.fleet(r.stockRows, r.kpis, r.mixGroups, r.mixSeries, f, now);
      } else if (key === 'use') {
        m = model.utilization(r.utilRows, r.utilWin || v.win, f);
      } else if (key === 'late' || key === 'flow') {
        const items = list.decorate(r.rows, r.linesByRequest, now);
        m = key === 'late' ? model.late(items, r.linesByRequest, now, f, r.linesLoaded) : model.flow(items, now, f);
      } else if (key === 'cost') {
        m = model.cost(r.costRows, f);
      }
      v.cur = { report: key, m };
    }
  }

  return applyChain;
});
