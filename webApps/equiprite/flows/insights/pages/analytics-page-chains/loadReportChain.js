define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/analyticsData',
], (ActionChain, Actions, analyticsData) => {
  'use strict';

  // Loads the active report. Every fetch and every number is analyticsData.loadActiveTab, the module the old
  // Equipment Analytics page's chains call (vbEnterChain, TabChangedChain, FiltersChangedChain,
  // OnAnalyticsSmartSearchChangedChain), copied unchanged: same endpoints, params, order and aggregation.
  //
  // Two additions around it, neither of which touches a number:
  //   - the Actions it is handed records failed calls, because the module only logs them and the page should say
  //     plainly when a figure is missing;
  //   - afterwards the table rows (dates and labels for display) and, on an unfiltered load, the chip options.
  let seq = 0;

  class loadReportChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const v = $page.variables;
      const mySeq = ++seq;
      const failed = [];
      const recording = {
        async callRest(ctx, options) {
          let res = null;
          try {
            res = await Actions.callRest(ctx, options);
          } catch (e) {
            res = null;
          }
          if (!res || !res.ok) {
            failed.push({ endpoint: options && options.endpoint, status: res ? res.status : 0 });
          }
          return res;
        },
      };

      // isBusy (not analyticsData's isLoading) hides the report: isLoading clears before the table rows below are
      // built, and a table shown in between would be handed two data sets in a row.
      v.isBusy = true;
      v.loadError = '';
      try {
        await analyticsData.loadActiveTab($page, context, recording);
      } finally {
        // A newer load (another report or filter) started while this one ran: it owns the display.
        if (mySeq === seq) {
          const tab = v.analyticsActiveTab;
          v.tableRows = $page.functions.displayRows(tab, { stockRows: v.stockRows, pendingRows: v.pendingRows, onhandRows: v.onhandRows });
          if (!v.analyticsFilterCriterion) {
            v.chipOptions = $page.functions.chipOptions(tab, v);
          }
          v.loadError = $page.functions.loadErrorText(failed);
          v.loadedTab = tab;
          // Let the table's data provider take the new rows before the table is created, or its first fetch is
          // superseded at once ("Aborting stale fetch").
          await new Promise((r) => setTimeout(r, 0));
          if (mySeq === seq) {
            v.isBusy = false;
          }
        }
      }
    }
  }

  return loadReportChain;
});
