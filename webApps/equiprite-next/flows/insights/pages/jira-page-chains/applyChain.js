define([
  'vb/action/actionChain',
  'resources/js/jiraBacklog',
], (ActionChain, J) => {
  'use strict';

  // The rows shown: the page's filters (Current's own, a finding, a check or an FDD section clicked), then under
  // Redwood what Smart Search picked; and the Redwood table's rows.
  class applyChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const rows = JSON.parse(JSON.stringify(v.rows || []));
      let shown = J.filter(rows, JSON.parse(JSON.stringify(v.f || {})));
      shown = J.filter(shown, JSON.parse(JSON.stringify(v.rwCols || {})));
      v.shown = shown;
      v.rwRows = shown.map((r) => ({
        key: r.key, summary: r.summary, epic: r.epicKey ? r.epicKey + ' ' + r.epicName : '', status: r.status, statusCat: r.statusCat,
        priority: r.priority, assignee: r.assignee || '—', release: r.release || '—', due: r.due || '—', overdue: r.overdue,
        score: r.score, checks: r.checks.length, gaps: r.gaps.length, type: r.type,
      }));
    }
  }

  return applyChain;
});
