define([], () => {
  'use strict';

  /**
   * Read a whole paged list, not just its first page.
   *
   * ASKING FOR A BIG size IS NOT ENOUGH. These endpoints cap the page and
   * return their own maximum without saying so. Verified on the equipment
   * master: 306 rows exist, `size=10000` came back with recordCount=306,
   * pageSize=200, totalPages=2, hasMore=true — a valid HTTP 200 carrying two
   * thirds of the data. Nothing throws, nothing warns; the caller just
   * silently works from a partial set.
   *
   * That truncation has already caused two separate visible bugs:
   *   - the equipment-schedule rail rendered 193 of 705 units with a blank
   *     equipment name, because their master was in the missing 106;
   *   - the configurations expenditure-type picker dropped equipment whose
   *     ids sorted low, so it simply looked like the equipment did not exist.
   *
   * Use this instead of a bare callRest whenever you need EVERY row of a list.
   *
   * @param callRest    (opts) => Promise<response>  — normally
   *                    `o => Actions.callRest(context, o)`
   * @param endpoint    e.g. 'eqp-v1/getEquipriteV1EquipmentMaster'
   * @param extraParams extra uriParams merged into every page request
   * @param label       name used in warnings
   * @param opts        { pageSize = 200, maxPages = 200 }
   * @returns Promise<Array> merged rows across all pages; [] on total failure,
   *          or the pages that did succeed when a later page fails.
   */
  async function fetchAllPages(callRest, endpoint, extraParams, label, opts) {
    const o        = opts || {};
    const PAGE     = o.pageSize || 200;
    const MAX_PAGES = o.maxPages || 200;
    const name     = label || endpoint;
    const out      = [];

    for (let page = 0; page < MAX_PAGES; page++) {
      let r;
      try {
        r = await callRest({
          endpoint:  endpoint,
          uriParams: Object.assign({ page: page, size: PAGE }, extraParams || {})
        });
      } catch (e) {
        console.warn('[fetchAllPages] ' + name + ' page ' + page + ' threw:', e);
        break;
      }
      if (!r || !r.ok) {
        console.warn('[fetchAllPages] ' + name + ' page ' + page +
                     ' failed HTTP ' + (r && (r.status || r.statusCode)));
        break;
      }

      const body  = r.body || {};
      const batch = Array.isArray(body.data) ? body.data
                  : (Array.isArray(body) ? body : []);
      out.push.apply(out, batch);

      // NEVER stop merely because a page came back shorter than asked for.
      // The server caps the page size and says nothing, so a short page is the
      // NORMAL case here, not the last one — that assumption is exactly what
      // truncated these lists in the first place. Stop only on an answer that
      // actually means "that is all".
      if (!batch.length) break;
      if (body.hasMore === false) break;
      const total = Number(body.recordCount);
      if (!isNaN(total) && total > 0 && out.length >= total) break;
      // No hasMore and no recordCount to go on: one short page is then the only
      // signal left, so take it rather than loop to MAX_PAGES.
      if (body.hasMore === undefined && isNaN(total) && batch.length < PAGE) break;

      if (page === MAX_PAGES - 1) {
        console.warn('[fetchAllPages] ' + name + ' hit the maxPages safety cap (' +
                     MAX_PAGES + ') — result may still be truncated.');
      }
    }

    return out;
  }

  return { fetchAllPages: fetchAllPages };
});
