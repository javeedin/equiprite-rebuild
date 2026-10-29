define([
  'vb/action/actionChain',
  'vb/action/actions',
], (
  ActionChain,
  Actions
) => {
  'use strict';

  class applyBannerFiltersChain extends ActionChain {

    /**
     * @param {Object} context
     */
    async run(context) {
      const { $page } = context;

      // Apply the filters — applyBannerFilters rebuilds _data and creates
      // a NEW DataGridProvider, returning it. We then assign the new
      // provider to $page.variables.dataGridProvider so the KO data
      // binding on <oj-data-grid data="[[ $variables.dataGridProvider ]]">
      // fires and the grid re-renders with the filtered rows.
      //
      // The previous version called applyBannerFilters but didn't reassign
      // the page variable, so the data-grid kept rendering the OLD
      // provider's data even though _data had been rebuilt. That's why
      // typing in the search box appeared to do nothing.
      const newProvider = $page.functions.applyBannerFilters(
        $page.variables.equipmentSearchText,
        $page.variables.selectedStatus,
        $page.variables.selectedUsageType,
        $page.variables.selectedClass
      );

      if (newProvider) {
        $page.variables.dataGridProvider = newProvider;
      }
    }
  }

  return applyBannerFiltersChain;
});
