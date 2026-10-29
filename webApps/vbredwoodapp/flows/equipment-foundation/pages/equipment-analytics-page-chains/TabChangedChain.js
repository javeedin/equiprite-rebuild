define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/analyticsData',
], (
  ActionChain,
  Actions,
  analyticsData
) => {
  'use strict';

  class TabChangedChain extends ActionChain {

    /**
     * Fires when the analytics tab-bar selection changes. Loads the newly-active
     * tab's live rows (no-op while useMockData=true). KPIs are unchanged by a tab
     * switch, so they aren't refetched here.
     */
    async run(context) {
      const { $page, $application } = context;

      // Unmount the smart search so its internal LOV state is fully destroyed.
      // Clearing the criterion here (rather than in loadActiveTab, which also
      // runs on every search) is deliberate: a criterion built from the previous
      // tab's fields is meaningless for the incoming endpoint.
      $page.variables.analyticsSmartSearchVisible = false;
      $page.variables.analyticsFilterCriterion    = null;
      // Reset the refetch guard, or the first search on the new tab could be
      // suppressed by a signature left over from the previous one.
      $page.variables.analyticsLastQuerySignature = '';

      // Each data tab (Stock/Pending/Onhand) has its OWN Start/End Date
      // fields (see equipment-analytics-page.html) — clear ALL of them on
      // every tab switch, not just the one being left, so a date picked on
      // Stock never lingers into Pending/Onhand and vice versa, and
      // re-visiting a tab always starts from a clean date range.
      $page.variables.stockDateFrom   = '';
      $page.variables.stockDateTo     = '';
      $page.variables.pendingDateFrom = '';
      $page.variables.pendingDateTo   = '';
      $page.variables.onhandDateFrom  = '';
      $page.variables.onhandDateTo    = '';

      // Chip set for the incoming tab — single source of truth in analyticsData.
      const tab = $page.variables.analyticsActiveTab;
      $page.variables.analyticsSuggestionFilters = analyticsData.suggestionFiltersFor(tab);

      // Each tab has its OWN filter config: the widget renders a chip for every
      // filter the loaded config declares, so a shared config showed Line Status
      // on Stock, Unit Status on Onhand and all three on Utilization — none of
      // which those endpoints accept. The variable's url is also an expression
      // on analyticsActiveTab; this assignment makes the swap explicit instead
      // of relying on the factory variable re-provisioning itself, and happens
      // while the widget is unmounted so it can only be read once.
      $page.variables.analyticsSearchConfiguration = {
        url: $application.path + analyticsData.searchConfigPathFor(tab)
      };

      // Yield one tick so Knockout processes the false→DOM-removal before remounting.
      await new Promise(resolve => setTimeout(resolve, 0));
      $page.variables.analyticsSmartSearchVisible = true;

      await analyticsData.loadActiveTab($page, context, Actions);
    }
  }

  return TabChangedChain;
});
