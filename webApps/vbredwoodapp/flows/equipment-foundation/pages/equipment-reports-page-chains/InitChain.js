define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/reportsData',
], (ActionChain, Actions, reportsData) => {
  'use strict';

  class InitChain extends ActionChain {
    /**
     * Initial load — fetches ONLY the active tab's endpoint.
     *
     * This chain used to await seven endpoints sequentially (five with
     * size=10000) to render one visible tab, discarding six results until the
     * user switched. Each tab now loads on demand via OnReportsTabChangedChain.
     *
     * KPI tiles are the one cross-tab concern: they summarise Equipment History,
     * Project Cost and Rate Exceptions, so they need those three counts. They are
     * fetched with size=1 — the count comes from recordCount, not from the rows —
     * so this costs three tiny calls rather than three full report pulls.
     */
    async run(context) {
      const { $page } = context;

      const tab = $page.variables.reportsActiveTab;

      // Chips for the active tab only (previously all six tabs shared one set).
      $page.variables.reportsSuggestionFilters = reportsData.suggestionFiltersFor(tab);

      // Active tab's rows + its own LOVs, under any pre-existing criterion.
      await reportsData.loadTab(
        $page, context, Actions, tab, $page.variables.reportsFilterCriterion
      );

      // ── KPI tiles ────────────────────────────────────────────────────────
      // Two of the three tiles are pure counts, so those fetch size=1 and read
      // recordCount instead of pulling the whole report. Total Cost has to sum a
      // column, so it does need rows — but project-cost-detail is the smallest
      // view here, so fetching it in full is cheaper than degrading the tile.
      // All three run concurrently; they are independent.
      const [ehCount, reCount, pcRows] = await Promise.all([
        countOf(context, 'eqp-v1/getEquipriteV1ViewsEquipmentHistory2'),
        countOf(context, 'eqp-v1/getEquipriteV1ViewsRateExceptions'),
        rowsOf(context, 'eqp-v1/getEquipriteV1ViewsProjectCostDetail2')
      ]);

      $page.variables.kpiEquipRecords   = ehCount;
      $page.variables.kpiRateExceptions = reCount;

      const totalCostNum = pcRows.reduce(
        (sum, r) => sum + (Number(r.totalCost != null ? r.totalCost : r.cost) || 0), 0
      );
      $page.variables.kpiTotalCost = '$' + totalCostNum.toLocaleString('en-US', {
        minimumFractionDigits: 0, maximumFractionDigits: 0
      });

      async function countOf(ctx, endpoint) {
        const resp = await Actions.callRest(ctx, {
          endpoint: endpoint, uriParams: { page: 0, size: 1 }
        });
        const body = (resp && resp.ok && resp.body) ? resp.body : {};
        return body.recordCount != null ? body.recordCount : 0;
      }

      async function rowsOf(ctx, endpoint) {
        const resp = await Actions.callRest(ctx, {
          endpoint: endpoint, uriParams: { page: 0, size: reportsData.PAGE_SIZE }
        });
        const body = (resp && resp.ok && resp.body) ? resp.body : {};
        return Array.isArray(body.data) ? body.data : [];
      }
    }
  }

  return InitChain;
});
