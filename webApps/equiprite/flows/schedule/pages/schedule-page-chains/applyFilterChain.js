define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Recomputes what the page shows from the loaded model and the filters: the units in view, the counts, the
  // conflict panel, the list and each filter's choices; then narrows the Gantt and the map to the same units.
  // Replaces the old ScheduleFilterChain (smart-search criterion -> filterScheduler on the resource store).
  class applyFilterChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const v = $page.variables;
      const fns = $page.functions;
      const model = v.model;
      const oldAppUrl = $application.variables.oldAppUrl;
      if (!model || !Array.isArray(model.resources)) {
        v.visibleIds = [];
        v.summary = fns.summary(null, []);
        v.conflictRows = [];
        v.listRows = [];
        return;
      }
      const f = Object.assign(fns.emptyFilters(), v.filters || {});
      const ids = fns.filterUnits(model, f);
      v.visibleIds = ids;
      v.summary = fns.summary(model, ids);
      v.conflictRows = fns.conflictRows(model, oldAppUrl, ids);
      v.listRows = fns.listRows(model, ids, v.listLimit, oldAppUrl);
      v.classOptions = fns.filterOptions(model, 'class', f.classes);
      v.projectOptions = fns.filterOptions(model, 'project', f.projects);
      v.yardOptions = fns.filterOptions(model, 'yard', f.yards);
      fns.applyGanttFilter(ids, f.projects);
    }
  }

  return applyFilterChain;
});
