define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/expenditureTypes',
], (ActionChain, Actions, expenditureTypes) => {
  'use strict';

  // Loads one request's week into the grid. Carried from the old timesheet-detail chains:
  //   initial (a request is opened)   vbEnterChain: fetch the week, take the rental span from the first row (or,
  //                                   with no rows, from this week's fetch; else four weeks around today), build the
  //                                   week range, clamp the wanted week into it and re-fetch if the clamp moved it
  //   later (the week arrows)         refreshGridByWeekChain: fetch the week
  // Both: views/timesheet-details/{weekStartDate}/{requestNumber}, non-rentable lines left out (isRentable 'N').
  //
  // Fire-and-forget like vbEnterChain, so the grid never waits on them: the internal request id
  // (expenditureTypes.resolveRequestIdByNumber; patchRequestLinesBatch needs it to save expenditure types), the
  // line rates for the Rate column (views/request-detail-lines, the request detail's own call), and the
  // expenditure-type list with its units (expenditureTypes.loadForRequest + attachUnits).
  const fetchWeek = async (context, weekStartDate, requestNumber) => {
    const res = await Actions.callRest(context, {
      endpoint: 'eqp-v1/getEquipriteV1ViewsTimesheetDetailsByWeek',
      uriParams: { weekStartDate, requestNumber: requestNumber || 'ALL' },
    });
    return res && res.ok && res.body && Array.isArray(res.body.data) ? res.body.data : null;
  };

  class loadWeekChain extends ActionChain {
    async run(context, { requestNumber, weekStart, initial, keepMessages }) {
      const { $page } = context;
      const fns = $page.functions;
      const callRest = (opts) => Actions.callRest(context, opts);
      $page.variables.isLoading = true;
      $page.variables.loadError = '';
      if (!keepMessages) {
        $page.variables.saveError = '';
      }
      $page.variables.notice = '';
      try {
        let week = fns.mondayOf(weekStart) || fns.thisWeek();
        let rows = await fetchWeek(context, week, requestNumber);
        if (rows === null) {
          $page.variables.loadError = 'The timesheet for this week could not be loaded.';
          rows = [];
        }

        if (initial) {
          $page.variables.requestNumber = requestNumber;
          $page.variables.internalRequestId = 0;
          $page.variables.lineRates = {};
          this.background(context, requestNumber, callRest);

          let start = rows[0] && rows[0].requestedStartDate;
          let end = rows[0] && rows[0].requestedEndDate;
          if (!(start && end)) {
            const todays = fns.thisWeek();
            const fallback = todays !== week ? (await fetchWeek(context, todays, requestNumber)) || [] : rows;
            if (fallback[0] && fallback[0].requestedStartDate && fallback[0].requestedEndDate) {
              start = fallback[0].requestedStartDate;
              end = fallback[0].requestedEndDate;
              if (!rows.length) rows = fallback;
            }
          }
          const list = start && end ? fns.spanWeeks(start, end, week)
            : fns.spanWeeks(fns.mondayOf(this.shift(-14)), this.shift(14), week);
          $page.variables.weeks = list;
          const clamped = fns.clampWeek(week, list);
          if (clamped !== week) {
            const again = await fetchWeek(context, clamped, requestNumber);
            if (again) rows = again;
            week = clamped;
          }
        }

        const rentable = rows.filter((r) => r && r.isRentable !== 'N');
        const built = fns.buildRows(rentable, week);
        $page.variables.weekStart = week;
        $page.variables.weekDays = fns.weekDays(week);
        $page.variables.apiRows = rentable;
        $page.variables.rows = built;
        $page.variables.edits = {};
        const picked = {};
        built.forEach((r) => { if (fns.isEditable(r, false)) picked[r.key] = true; });
        $page.variables.picked = picked;
        $page.variables.headerStatus = fns.headerStatus(rentable);
        if (rentable[0] && rentable[0].projectName) {
          $page.variables.projectName = rentable[0].projectName;
        } else if (initial) {
          const q = ($page.variables.queue || []).find((x) => x.requestNumber === requestNumber);
          $page.variables.projectName = (q && q.projectName) || '';
        }
        if (built.some((r) => r.prefilled)) {
          $page.variables.notice = 'Days inside each line\'s dates are filled with its planned hours. Check them, then Save.';
        }
      } catch (e) {
        console.error('[loadWeekChain] failed', e);
        $page.variables.loadError = 'The timesheet for this week could not be loaded.';
      } finally {
        $page.variables.isLoading = false;
      }
    }

    shift(days) {
      const d = new Date();
      d.setDate(d.getDate() + days);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    background(context, requestNumber, callRest) {
      const { $page } = context;
      expenditureTypes.resolveRequestIdByNumber(callRest, requestNumber).then((rid) => {
        if (!rid || $page.variables.requestNumber !== requestNumber) return null;
        $page.variables.internalRequestId = rid;
        return callRest({ endpoint: 'eqp-v1/getEquipriteV1ViewsRequestDetailLines', uriParams: { requestId: Number(rid), size: 10000 } })
          .then((res) => {
            const data = res && res.ok && res.body && Array.isArray(res.body.data) ? res.body.data : [];
            const map = {};
            data.forEach((l) => {
              if (l && l.lineId != null) map[l.lineId] = { billRate: l.billRate, priceUom: l.priceUom };
            });
            if ($page.variables.requestNumber === requestNumber) $page.variables.lineRates = map;
          });
      }).catch((e) => console.warn('[loadWeekChain] request id / line rates failed:', e && e.message));

      expenditureTypes.loadForRequest(callRest, { requestNumber }).then((list) => {
        if (!list || !list.length) return null;
        $page.variables.expTypeList = list;
        return expenditureTypes.attachUnits(callRest, list).then((enriched) => {
          if (enriched && enriched.length) $page.variables.expTypeList = enriched;
        });
      }).catch((e) => console.warn('[loadWeekChain] expenditure types kept at the proven values:', e && e.message));
    }
  }

  return loadWeekChain;
});
