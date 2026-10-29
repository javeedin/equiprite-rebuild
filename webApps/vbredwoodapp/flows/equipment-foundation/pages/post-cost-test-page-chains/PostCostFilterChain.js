define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Verbatim clone of post-cost-page PostCostFilterChain.
  class PostCostFilterChain extends ActionChain {

    async run(context) {
      const { $page } = context;
      const criterion = $page.variables.filterCriterion;
      const allData   = $page.variables.PostCostAllArray;

      if (!criterion || (Array.isArray(criterion.criteria) && criterion.criteria.length === 0)) {
        $page.variables.PostCostFilteredArray = [...(allData || [])];
        return;
      }

      let keyword = '';

      const extract = (node) => {
        if (!node) return;
        if (node.$tag === '_root_' || node.op === '$and') {
          (node.criteria || []).forEach(extract);
        } else if (node.text !== undefined) {
          keyword = String(node.text).toLowerCase();
        }
      };

      extract(criterion);

      const filtered = (allData || []).filter(item => {
        if (keyword) {
          const haystack = [
            item.requestNumber, item.projectName, item.taskName,
            item.agreementNumber, item.ppmProjectNumber, item.ppmTaskNumber
          ].join(' ').toLowerCase();
          if (!haystack.includes(keyword)) return false;
        }
        return true;
      });

      $page.variables.PostCostFilteredArray = filtered;
    }
  }

  return PostCostFilterChain;
});
