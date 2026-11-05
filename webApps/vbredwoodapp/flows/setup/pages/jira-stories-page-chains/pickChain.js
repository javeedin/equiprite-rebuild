define([
  'vb/action/actionChain'
], (ActionChain) => {
  'use strict';

  // A click in the analysis: a finding (its own filter: overdue, a release, a check …), a quality check or an FDD
  // section. Those are not columns Smart Search can filter on, so the pick is kept apart and shown as the removable
  // "Showing: …" chip over the table; what: 'clear' (the chip's ×) shows every story again.
  class pickChain extends ActionChain {
    async run(context, { what, value }) {
      const { $page } = context;
      const v = $page.variables;
      const F = $page.functions;
      const p = what === 'clear' ? null : F.pickOf(what, value, JSON.parse(JSON.stringify(v.analysis || {})));
      v.pick = p ? p.filter : {};
      v.pickLabel = p ? p.label : '';
      v.shownRows = F.shown(JSON.parse(JSON.stringify(v.rows || [])), JSON.parse(JSON.stringify(v.search || {})), p ? p.filter : {});
      if (p && typeof document !== 'undefined') {
        const bar = document.getElementById('jiraToolbar');
        if (bar && bar.scrollIntoView) bar.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }

  return pickChain;
});
