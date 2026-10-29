define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Same shape as request-detail-page-chains/AssignProjectTypeaheadChain — only the
  // field/variable names differ. (It was cloned from the create-request page's
  // ProjectTypeaheadChain, since deleted along with that page's server-side project
  // typeahead.)
  // As the user types in the BU oj-input-search, rewrite the Fusion q-filter and
  // re-query finBusinessUnitsLOV.
  class BuTypeaheadChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const rawText = (params && params.searchValue != null) ? String(params.searchValue) : '';
      const minChars = 2;
      const searchField = 'BusinessUnitName';

      let filterQ = '';

      if (rawText.length === 0) {
        filterQ = searchField + " LIKE '*'";
      } else if (rawText.length >= minChars) {
        const resolved = await $page.functions.debounce('buSearch', rawText, 200);
        if (resolved) {
          filterQ = searchField + " LIKE '*" + resolved + "*'";
        }
      }

      if (filterQ) {
        $page.variables.buSearchQ = filterQ;
        await Actions.resetVariables(context, { variables: ['$page.variables.BuOrgBuSDP'] });
      }
    }
  }

  return BuTypeaheadChain;
});
