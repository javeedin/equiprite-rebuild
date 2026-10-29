define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/loadExpTypeMapsChain.js, unchanged.

  // The authored equipment -> expenditure type mappings, for the admin table.
  //
  // Filtering is SERVER-side (the endpoint takes scopeType and search) rather
  // than client-side, because this table is the one place that will grow: one
  // row per equipment-model x billing activity, so a few hundred at this
  // customer and more at a larger one.
  class loadExpTypeMapsChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const scope  = ($page.variables.ExpTypeMapFilterScope || '').trim();
      const search = ($page.variables.ExpTypeMapSearch || '').trim();

      // PAGED, not one big page. 306 equipment models x the two or three
      // activities each bills under is ~900 rows at this customer, so a single
      // size=500 call would silently hide the tail -- and a mapping you cannot
      // see is one you re-author as a duplicate and then get a 409 for.
      const PAGE = 200;
      const MAX_PAGES = 25;           // 5,000 rows; a real stop, not a guess
      const rows = [];
      let truncated = false;
      let failed = false;

      for (let page = 0; page < MAX_PAGES; page++) {
        const uriParams = { page: page, size: PAGE };
        if (scope)  { uriParams.scopeType = scope; }
        if (search) { uriParams.search = search; }

        const result = await Actions.callRest(context, {
          endpoint: 'eqp-v1/listExpTypeMapAdmin',
          // uriParams, NOT parameters -- VB drops query values passed under
          // `parameters` silently, and the filters would be ignored with no error.
          uriParams: uriParams
        });

        if (!result.ok) {
          console.error('loadExpTypeMapsChain: failed on page', page, result.statusCode);
          failed = (page === 0);
          break;
        }

        const body = result.body || {};
        const batch = Array.isArray(body.data) ? body.data : [];
        rows.push.apply(rows, batch);

        // Do NOT stop on a short page. These endpoints cap page size without
        // saying so -- proven on the equipment master, where one call returned
        // a subset and made real equipment look absent -- so a short page is
        // normal, not final. Stop only on hasMore false, the row count reached,
        // or an empty page.
        if (!batch.length) { break; }
        if (body.hasMore === false) { break; }
        const total = Number(body.recordCount);
        if (!isNaN(total) && total > 0 && rows.length >= total) { break; }
        if (body.hasMore === undefined && isNaN(total) && batch.length < PAGE) { break; }
        if (page === MAX_PAGES - 1) { truncated = true; }
      }

      if (failed) {
        $page.variables.ExpTypeMapAllArray = [];
        $page.variables.saveError = 'Failed to load expenditure type mappings.';
      } else {
        $page.variables.ExpTypeMapAllArray = rows;
        if (truncated) {
          console.warn('[EXPTYPEMAP] stopped at %d rows -- filter the list to see the rest',
            rows.length);
        }
      }
    }
  }

  return loadExpTypeMapsChain;
});
