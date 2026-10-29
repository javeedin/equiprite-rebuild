define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/reportsData',
], (ActionChain, Actions, reportsData) => {
  'use strict';

  class FilterChain extends ActionChain {
    /**
     * Fires when the Equipment History Period control changes — the preset
     * select, or either date picker when the preset is Custom. All three bind
     * `on-value-changed="[[$listeners.onFilterChanged]]"`.
     *
     * This chain was a no-op stub: it used to drive a per-tab filter drawer that
     * is disabled in the markup, and its old body wrote client-side-filtered
     * rows into the *FilteredRows variables, which nothing reads. It is live
     * again for one job only — the date window — because that is the one filter
     * smart search cannot express: SelectSingleFilter is the only filter type
     * available, so there is no date chip to build.
     *
     * The window itself is turned into query params by reportsData.windowParams,
     * which loadTab merges in; nothing is filtered client-side here.
     */
    async run(context) {
      const { $page } = context;

      const tab = $page.variables.reportsActiveTab;
      if (!reportsData.WINDOW_PARAMS[tab]) return;   // no window on this report

      // A half-entered Custom range sends nothing (windowParams drops it), so
      // there is no point refetching until both dates are in.
      const preset = $page.variables.reportsDatePreset;
      if (preset === 'custom' &&
          !($page.variables.reportsCustomFrom && $page.variables.reportsCustomTo)) {
        return;
      }

      $page.variables.reportsIsLoading = true;
      try {
        await reportsData.loadTab(
          $page, context, Actions, tab, $page.variables.reportsFilterCriterion
        );
        // Bump the version so the grid provider's cache key changes and the grid
        // re-renders even when the new row count happens to match the old one.
        $page.variables.reportsFilterVersion = ($page.variables.reportsFilterVersion || 0) + 1;
      } finally {
        $page.variables.reportsIsLoading = false;
      }
    }
  }

  return FilterChain;
});
