define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Verbatim clone of post-cost-page vbEnterChain — loads real post-cost list data.
  class vbEnterChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      // The view fans one row per (request × ISO week) — 770+ rows across 180+
      // requests. The endpoint is paginated (page/size) and defaults small, so
      // without an explicit size only the first page comes back and newer/older
      // requests are silently dropped (e.g. a just-created request never appears
      // even though it sorts first). The page filters and groups client-side, so
      // pull them all in one page.
      // NOTE: query params (page/size) MUST go through `uriParams`, not
      // `parameters` — `parameters` is silently ignored by this REST action, so
      // the backend applied its default page size and the list truncated to ~50
      // requests. Every other working paginated call here uses uriParams.
      const response = await Actions.callRest(context, {
        endpoint: 'eqp-v1/getEquipriteV1ViewsPostCost',
        uriParams: { page: 0, size: 10000 }
      });

      if (!response || !response.ok || !response.body || !Array.isArray(response.body.data)) {
        console.warn('[vbEnterChain post-cost-test] Failed to load post-cost data:', response && response.status);
        $page.variables.PostCostAllArray      = [];
        $page.variables.PostCostFilteredArray = [];
        return;
      }

      // The view fans one row per (request × ISO week), so a single request
      // returns N rows (one per week). This is a LIST — one card per REQUEST —
      // so group by requestNumber and SUM each request's weekly cost/hours into
      // a single row. (Without this the same request shows once per week, e.g. a
      // 5-week rental appears 5 times.) Nav/context fields (ppm ids, dates,
      // schedule) are identical across a request's week-rows, so take them from
      // the first row seen.
      // FUTURE weeks are excluded from the totals, matching the detail page.
      // The detail drops any week the calendar has not reached (a week is future
      // iff its start is after today — a week straddling today is "In progress"
      // and still counts), so summing every week here would make the card read
      // $19,165 against a drill-down showing $7,240.
      //
      // The request row itself is KEPT even when all of its weeks are future
      // (2 requests live): the request is real and still in the queue, it simply
      // has nothing incurred yet, so it reads $0 rather than vanishing.
      //
      // weekStartDate is only visible here because it is now declared in the
      // eqp-v1 openapi — VBCS silently strips any field the schema omits, and
      // this one was omitted, so it used to arrive undefined.
      const today = (() => { const n = new Date(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())); })();
      const isFutureWeek = (r) => {
        const iso = String(r.weekStartDate || '').slice(0, 10);
        if (!iso) return false;                 // no week date -> never hide the cost
        const ws = new Date(iso + 'T00:00:00Z');
        return !isNaN(ws.getTime()) && ws > today;
      };

      const byRequest = {};
      const order = [];
      response.body.data.forEach(r => {
        const key = r.requestNumber || '';
        if (!byRequest[key]) {
          byRequest[key] = {
            rowKey:                key,
            eqrEquipmentRequestId: r.eqrEquipmentRequestId,
            requestNumber:         key,
            projectName:           r.projectName        || '—',
            taskName:              r.taskName           || '—',
            agreementNumber:       r.agreementNumber    || '—',
            startDate:             r.requestedStartDate ? String(r.requestedStartDate).slice(0, 10) : '—',
            endDate:               r.requestedEndDate   ? String(r.requestedEndDate).slice(0, 10)   : '—',
            timesheets:            0,
            totalHours:            0,
            totalBillCost:         0,
            ppmProjectNumber:      r.ppmProjectNumber   || '',
            ppmTaskNumber:         r.ppmTaskNumber      || '',
            ppmBusinessUnit:       r.ppmBusinessUnit    || '',
            ppmProjectRefId:       r.ppmProjectRefId    || 0,
            ppmTaskRefId:          r.ppmTaskRefId       || 0,
            rateScheduleId:        r.rateScheduleId     || 0
          };
          order.push(key);
        }
        // The request row is created above regardless, so an all-future request
        // keeps its card; only its money is withheld.
        if (isFutureWeek(r)) return;
        const g = byRequest[key];
        g.timesheets    += Number(r.timesheets    || 0);
        g.totalHours    += Number(r.totalHours    || 0);
        g.totalBillCost += Number(r.totalBillCost || 0);
      });

      // ── miscellaneous charges ────────────────────────────────────────────
      // EQP_POSTCOST knows nothing about EQR_LINE_MISC_TXN, so without this a
      // charge saved on the drill-down would make the card disagree with it —
      // the same class of mismatch the future-week filter above exists to avoid.
      // One UNFILTERED call rather than one per request: 83 requests, and the
      // page already pulls its whole dataset in a single page.
      try {
        const miscResp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getMiscTransactions',
          uriParams: { page: 0, size: 10000 }
        });
        const mBody = miscResp && miscResp.body;
        const mArr = (mBody && Array.isArray(mBody.data)) ? mBody.data
                   : (Array.isArray(mBody) ? mBody : []);
        mArr.forEach(m => {
          const g = byRequest[m && m.requestNumber];
          // A charge on a request the list does not carry (no PPM project, so
          // filtered out of EQP_POSTCOST) is skipped, not force-added — the list
          // is the PPM queue and that filter is deliberate.
          if (g) g.totalBillCost += Number(m.rawCost || 0);
        });
      } catch (e) {
        console.warn('[vbEnterChain post-cost-test] misc-transactions fetch failed (non-fatal):', e && e.message);
      }

      const data = order.map(k => byRequest[k]);
      data.forEach(g => { g.totalBillCost = Math.round(g.totalBillCost * 100) / 100; });

      data.sort((a, b) => (Number(b.eqrEquipmentRequestId) || 0) - (Number(a.eqrEquipmentRequestId) || 0));

      $page.variables.PostCostAllArray      = data;
      $page.variables.PostCostFilteredArray = data;
    }
  }

  return vbEnterChain;
});
