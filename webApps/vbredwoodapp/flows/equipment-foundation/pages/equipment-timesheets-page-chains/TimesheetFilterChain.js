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
          if (node.attribute === 'thisWeekStatus') {
            statusValue = node.value;
          } else if (typeof node.value === 'object' && node.value !== null) {
            if (node.value.thisWeekStatus !== undefined) statusValue = node.value.thisWeekStatus;
          }
        }
      };

      extract(criterion);

      const filtered = (allData || []).filter(item => {
        if (statusValue !== 'ALL' && item.thisWeekStatus !== statusValue) return false;
        if (keyword) {
          const haystack = [
            item.requestNumber, item.projectName,
            item.equipmentName, item.className, item.taskName
          ].join(' ').toLowerCase();
          if (!haystack.includes(keyword)) return false;
        }
        return true;
      });

      $page.variables.TimesheetFilteredArray = filtered;
    }
  }

  return TimesheetFilterChain;
});
