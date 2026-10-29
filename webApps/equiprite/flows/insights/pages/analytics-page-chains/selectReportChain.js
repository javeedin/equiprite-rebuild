define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/analyticsData',
], (ActionChain, Actions, analyticsData) => {
  'use strict';

  // Switches report (the old TabChangedChain). A search built for the previous report means nothing to the next
  // endpoint, so the criterion, its refetch signature, the search text and the chips are cleared first, exactly
  // as TabChangedChain cleared them; then the report loads.
  class selectReportChain extends ActionChain {
    /**
     * @param {Object} context
     * @param {Object} params
     * @param {string} params.tab analyticsData tab id
     * @param {boolean} [params.scroll] bring the report into view (picked from the library)
     */
    async run(context, { tab, scroll }) {
      const { $page } = context;
      const v = $page.variables;
      if (!tab || !$page.functions.liveReports().some((r) => r.id === tab)) {
        return;
      }
      if (scroll && typeof document !== 'undefined') {
        const el = document.getElementById('erReport');
        if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      if (tab === v.analyticsActiveTab && v.loadedTab === tab) {
        return;
      }
      v.analyticsActiveTab = tab;
      v.analyticsFilterCriterion = null;
      v.analyticsLastQuerySignature = '';
      v.searchText = '';
      v.picks = {};
      v.chipOptions = {};
      v.analyticsSuggestionFilters = analyticsData.suggestionFiltersFor(tab);
      await Actions.callChain(context, { chain: 'loadReportChain' });
    }
  }

  return selectReportChain;
});
