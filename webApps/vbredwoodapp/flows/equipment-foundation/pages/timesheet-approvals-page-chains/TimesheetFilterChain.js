define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  class TimesheetFilterChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const criterion = $page.variables.filterCriterion;
      const allData   = $page.variables.TimesheetAllArray;

      if (!criterion || (Array.isArray(criterion.criteria) && criterion.criteria.length === 0)) {
        $page.variables.TimesheetFilteredArray = [...(allData || [])];
        $page.variables.pendingCount =
          (allData || []).filter(r => r.status === 'SUBMITTED').length;
        return;
      }

      let keyword     = '';
      let statusValue = 'ALL';

      const extract = (node) => {
        if (!node) return;
        if (node.$tag === '_root_' || node.op === '$and') {
          (node.criteria || []).forEach(extract);
        } else if (node.text !== undefined) {
          keyword = String(node.text).toLowerCase();
        } else if (node.op === '$eq') {
          if (node.attribute === 'status') statusValue = node.value;
        }
      };
      extract(criterion);

      const filtered = (allData || []).filter(item => {
        if (statusValue !== 'ALL' && item.status !== statusValue) return false;
        if (keyword) {
          const haystack = [
            item.request_id, item.project, item.week_label, item.status
          ].join(' ').toLowerCase();
          if (!haystack.includes(keyword)) return false;
        }
        return true;
      });

      $page.variables.TimesheetFilteredArray = filtered;
      // Keep the subtitle honest after a filter, otherwise it keeps showing the
      // unfiltered pending count while the table shows a subset.
      $page.variables.pendingCount = filtered.filter(r => r.status === 'SUBMITTED').length;
    }
  }

  return TimesheetFilterChain;
});
