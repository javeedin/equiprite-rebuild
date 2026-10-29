define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // BU filter LOV changed — record the selected BU id; the table ADP re-filters
  // client-side via filterBuOrgMappings (mirrors the Equipment Class filter).
  class applyBuFilterChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const { businessUnitId } = params || {};
      $page.variables.BuOrgFilterBUId =
        businessUnitId != null && businessUnitId !== '' ? Number(businessUnitId) : null;
    }
  }

  return applyBuFilterChain;
});
