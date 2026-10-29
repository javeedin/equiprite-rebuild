define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/reportsData',
], (ActionChain, Actions, reportsData) => {
  'use strict';

  class OnReportsTabChangedChain extends ActionChain {
    /**
     * Fires when the Report selector changes.
     *
     * Clears the search (a criterion built for the previous tab's fields is
     * meaningless here), points the widget at the incoming tab's own search
     * config, remounts it so its chip state is rebuilt from that config, then
     * lazily fetches the tab's endpoint — data is not preloaded by InitChain.
     */
    async run(context, { newTab }) {
      const { $page, $application } = context;

      const tab = newTab || $page.variables.reportsActiveTab;

      $page.variables.reportsFilterCriterion = null;
      $page.variables.reportsFilterVersion   = ($page.variables.reportsFilterVersion || 0) + 1;
      $page.variables.reportsSuggestionFilters = reportsData.suggestionFiltersFor(tab);
      // Reset the refetch guard, or the first search on the new tab could be
      // suppressed by a signature left over from the previous one.
      $page.variables.reportsLastQuerySignature = '';

      // Each tab has its OWN filter config, because the widget renders a chip
      // for every filter the loaded config declares — one shared config showed
      // all six tabs' filters at once (three "Equipment", two "Class", two
      // "Status"). The variable's url is also an expression on reportsActiveTab;
      // this assignment makes the swap explicit rather than relying on the
      // factory variable re-provisioning itself, and is done while the widget is
      // unmounted so it can only be read once.
      $page.variables.reportsSmartSearchVisible = false;
      $page.variables.reportsSearchConfiguration = {
        url: $application.path + reportsData.searchConfigPathFor(tab)
      };

      // Unmount → yield → remount so the widget's internal chip state is rebuilt
      // against the new config. A bare Promise.resolve() is not enough: Knockout
      // needs a macrotask to process the removal before the re-add.
      await new Promise((resolve) => setTimeout(resolve, 0));
      $page.variables.reportsSmartSearchVisible = true;

      // Lazy load: this tab's endpoint, unfiltered (criterion was just cleared).
      await reportsData.loadTab($page, context, Actions, tab, null);
    }
  }

  return OnReportsTabChangedChain;
});
