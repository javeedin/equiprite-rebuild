define([
  'vb/action/actionChain'
], (ActionChain) => {
  'use strict';

  // Smart Search changed (words typed, a filter picked or removed): read its criterion as jiraBacklog.filter's filters
  // ($functions.readCriterion) and narrow the table. The finding, check or FDD section picked still applies on top.
  // The criterion comes from the event (the variable may not have been written back yet); page variables are proxies,
  // so everything is copied before it is reused.
  class filterChain extends ActionChain {
    async run(context, { criterion }) {
      const { $page } = context;
      const v = $page.variables;
      const F = $page.functions;
      const c = criterion !== undefined ? criterion : v.filterCriterion;
      v.search = F.readCriterion(c ? JSON.parse(JSON.stringify(c)) : null);
      v.shownRows = F.shown(JSON.parse(JSON.stringify(v.rows || [])), JSON.parse(JSON.stringify(v.search)), JSON.parse(JSON.stringify(v.pick || {})));
    }
  }

  return filterChain;
});
