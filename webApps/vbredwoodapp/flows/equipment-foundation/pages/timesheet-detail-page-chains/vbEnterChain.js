define([
  'vb/action/actionChain',
  'vb/action/actions',
  'ojs/ojarraydataprovider',
  'resources/js/expenditureTypes',
  'resources/js/timesheetRows'
], (
  ActionChain,
  Actions,
  ArrayDataProvider,
  expenditureTypes,
  timesheetRows
) => {
  'use strict';

  var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function toISODate(d) {
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + mm + '-' + dd;
  }

  function getMondayOf(d) {
    var day = d.getDay();
    var diff = (day === 0) ? -6 : 1 - day;
    var mon = new Date(d);
    mon.setDate(d.getDate() + diff);
    mon.setHours(0, 0, 0, 0);
    return mon;
  }

  function weekLabel(monDate) {
    var endDate = new Date(monDate);
    endDate.setDate(monDate.getDate() + 6);
    var startStr = MONTH_NAMES[monDate.getMonth()] + ' ' + monDate.getDate();
    var endStr   = MONTH_NAMES[endDate.getMonth()] + ' ' + endDate.getDate() + ', ' + endDate.getFullYear();
    if (monDate.getFullYear() !== endDate.getFullYear()) {
      startStr += ', ' + monDate.getFullYear();
    }
    return startStr + ' – ' + endStr;
  }

  class vbEnterChain extends ActionChain {

    async run(context) {
      const { $page } = context;

      var today          = new Date();
      today.setHours(0, 0, 0, 0);
      var todayMonday    = getMondayOf(today);
      var todayMondayStr = toISODate(todayMonday);

      const requestNumber = $page.variables.requestId;

      // -- internal request id -------------------------------------------------
      // This page is given the request NUMBER only, but patchRequestLine is
      // PATCH /equipment-requests/{requestId}/lines/{id} and needs BOTH ids. Resolve
      // it once here so the per-line expenditure-type save has something to address;
      // without it every such save 404s while looking like it worked.
      //
      // Fire-and-forget like the LOV below: the grid must not wait on it, and the
      // save re-checks the variable before using it.
      expenditureTypes.resolveRequestIdByNumber(
        function (opts) { return Actions.callRest(context, opts); },
        requestNumber
      ).then(function (rid) {
        if (rid) { $page.variables.internalRequestId = rid; }
        console.log('[EXPTYPE] internalRequestId =', rid);
      }).catch(function (e) {
        console.warn('[EXPTYPE] internalRequestId resolve failed:', e && e.message);
      });

      // -- expenditure types -----------------------------------------------------
      // Same resolver the Post Cost pickers use, so the two screens can never
      // offer different values: resources/js/expenditureTypes.js. The tenant's
      // active types, NOT scoped by project (see the module header for why).
      //
      // Fire-and-forget. The grid must render on its own schedule; this only feeds
      // the Expenditure Type column's dropdown, and an empty result leaves the
      // module's proven-accepted fallback in place, so the picker is never blank.
      // Held in a variable, not fired and forgotten, because the mapping check
      // further down needs to know when this has finished -- a mapping can only
      // be judged against the list it is meant to narrow.
      const expTypesReady = expenditureTypes.loadForRequest(
        function (opts) { return Actions.callRest(context, opts); },
        { requestNumber: requestNumber }
      ).then(function (list) {
        if (!list || !list.length) { return null; }
        // Publish the list FIRST, then enrich. The picker is usable the moment
        // the types arrive; the unit is a second, slower round trip to Fusion and
        // must not hold the dropdown hostage if it is slow or fails.
        $page.variables.expTypeList = list;

        // Attach the UNIT to each type. This is what tells the grid whether a
        // day box means a day or an hour -- see expenditureTypes.attachUnits.
        //
        // Read off the EXPENDITURE TYPE, not off a rate schedule line. Both
        // carry it and they agree (checked against all 1,581 lines of the
        // customer's real schedule), but the rate-line route needed ONE schedule
        // named in config -- and a tenant has one per country, 130 at this
        // customer, so a single name is wrong everywhere but one. Expenditure
        // types are global setup, so this needs no configuration and is correct
        // for every business unit.
        return expenditureTypes.attachUnits(
          function (opts) { return Actions.callRest(context, opts); },
          list
        ).then(function (enriched) {
          // Reassign whole: VBCS tracks the array by reference, so mutating the
          // published one in place would not re-render the picker.
          if (enriched && enriched.length) { $page.variables.expTypeList = enriched; }
        });
      }).catch(function (e) {
        console.warn('[EXPTYPE] timesheet resolve failed, keeping the proven values:', e && e.message);
      });

      // Use the week passed from the card click, fall back to today's Monday
      // Sanitize: only accept a valid YYYY-MM-DD date string; reject '—' or any garbage
      const rawNavWeek = $page.variables.weekStartDate;
      const navWeekStr = (rawNavWeek && /^\d{4}-\d{2}-\d{2}$/.test(rawNavWeek)) ? rawNavWeek : '';

      // ─── Step 1: Fetch data for the target week ───────────────────────────
      const initialWeekStr = navWeekStr || todayMondayStr;
      const response = await Actions.callRest(context, {
        endpoint: 'eqp-v1/getEquipriteV1ViewsTimesheetDetailsByWeek',
        uriParams: {
          weekStartDate: initialWeekStr,
          requestNumber: requestNumber || 'ALL'
        }
      });


      if (!response || !response.ok) {
        console.warn('[vbEnterChain] Failed to fetch timesheet details');
        return;
      }

      var rows = response.body.data || [];

      // requestNumber is now a path param — backend filters server-side

      // ─── Step 2: Build the week range drop-down ───────────────────────────
      var effectiveStart, effectiveEnd;

      if (rows.length > 0 && rows[0].requestedStartDate && rows[0].requestedEndDate) {
        effectiveStart = rows[0].requestedStartDate.slice(0, 10);
        effectiveEnd   = rows[0].requestedEndDate.slice(0, 10);
      } else {
        // rows empty — fetch using today's Monday to get requestedStartDate/End
        // from the deployed lines (they always return regardless of entry existence)
        var fallbackResp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getEquipriteV1ViewsTimesheetDetailsByWeek',
          uriParams: {
            weekStartDate: todayMondayStr,
            requestNumber: requestNumber || 'ALL'
          }
        });
        var fallbackRows = (fallbackResp && fallbackResp.ok && fallbackResp.body && fallbackResp.body.data)
          ? fallbackResp.body.data : [];

        if (fallbackRows.length > 0 && fallbackRows[0].requestedStartDate && fallbackRows[0].requestedEndDate) {
          effectiveStart = fallbackRows[0].requestedStartDate.slice(0, 10);
          effectiveEnd   = fallbackRows[0].requestedEndDate.slice(0, 10);
          // Also use these rows if our initial fetch was for the wrong week
          if (rows.length === 0) {
            rows = fallbackRows;
          }
        } else {
          // Last resort: tight 4-week window around today only
          effectiveStart = toISODate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 14));
          effectiveEnd   = toISODate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 14));
        }
      }

      var rangeStart = new Date(effectiveStart + 'T00:00:00');
      var rangeEnd   = new Date(effectiveEnd   + 'T00:00:00');

      var cursor = getMondayOf(rangeStart);
      var weeks  = [];
      while (cursor <= rangeEnd) {
        weeks.push({ value: toISODate(cursor), label: weekLabel(cursor) });
        var next = new Date(cursor);
        next.setDate(cursor.getDate() + 7);
        cursor = next;
      }

      if (!weeks.length) {
        weeks.push({ value: todayMondayStr, label: weekLabel(todayMonday) });
      }

      $page.variables.weekRangeProvider = new ArrayDataProvider(weeks, { keyAttributes: 'value' });

      // ─── Step 3: Select target week, clamped to range ─────────────────────
      var firstWeekStr = weeks[0].value;
      var lastWeekStr  = weeks[weeks.length - 1].value;
      var selectedWeekStr;

      // Prefer the week from the nav param; fall back to today's Monday
      var targetWeekStr = initialWeekStr;
      if (targetWeekStr <= firstWeekStr) {
        selectedWeekStr = firstWeekStr;
      } else if (targetWeekStr >= lastWeekStr) {
        selectedWeekStr = lastWeekStr;
      } else {
        var found = weeks.find(function (w) { return w.value === targetWeekStr; });
        selectedWeekStr = found ? found.value : firstWeekStr;
      }

      $page.variables.selectedWeekStart = selectedWeekStr;

      // ─── Step 4: Re-fetch only if clamped week differs from initial fetch week ─
      var finalRows = rows;
      if (selectedWeekStr !== initialWeekStr) {
        const reResp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getEquipriteV1ViewsTimesheetDetailsByWeek',
          uriParams: {
            weekStartDate: selectedWeekStr,
            requestNumber: requestNumber || 'ALL'
          }
        });
        if (reResp && reResp.ok && reResp.body.data) {
          finalRows = reResp.body.data;
        }
      }

      // ─── Step 5: Map rows → grid lines ────────────────────────────────────
      // Non-rentable lines (consumables/materials) post cost directly and must
      // never appear as timesheet rows. Exclude only confirmed non-rentables
      // ('N') so rentable lines with no entry yet (synthesized, possibly
      // unflagged) still show — otherwise the grid flashes then empties.
      finalRows = finalRows.filter(r => r.isRentable !== 'N');

      const lines = timesheetRows.toGridRows(finalRows);

      // Narrow each row's Expenditure Type picker to the types AUTHORED for that
      // equipment (EQR_EXP_TYPE_MAP), instead of the project's whole list.
      //
      // Fire-and-forget, like the list itself: the grid must not wait on it. The
      // pickers show the full list until this lands and narrow when it does, and
      // a failure leaves them unnarrowed rather than empty.
      expenditureTypes.loadMapsForMasters(
        function (opts) { return Actions.callRest(context, opts); },
        lines.map(function (l) { return l.equipment_master_id; })
      ).then(function (map) {
        // Reassign whole -- VBCS tracks the object by reference, so adding keys
        // in place would not re-render the pickers.
        if (map && Object.keys(map).length) { $page.variables.expTypeMap = map; }

        // Then SAY SOMETHING when a mapping cannot apply here. Narrowing that
        // matches nothing falls back to the full list, which is safe but
        // indistinguishable from having authored no mapping at all -- so
        // without this, a mapping made against the wrong catalogue looks
        // exactly like success. One message per page load, naming the
        // equipment, because the person who needs it is usually not the person
        // who authored it.
        return expTypesReady.then(function () {
          const unmatched = expenditureTypes.unmatchedMasters($page.variables.expTypeList, map);
          if (!unmatched.length) { return null; }
          const names = unmatched.map(function (id) {
            const row = lines.find(function (l) { return String(l.equipment_master_id) === String(id); });
            return (row && row.equipment_name) || ('equipment ' + id);
          });
          console.warn('[EXPTYPE] %d mapping(s) do not apply to this project: %o', names.length, names);
          return Actions.fireNotificationEvent(context, {
            summary: 'Expenditure type mapping not used',
            message: names.join(', ') + ' — the mapped types are not chargeable on this project, '
              + 'so the full list is shown. Check the mapping in Configurations > Expenditure Types.',
            displayMode: 'transient',
            type: 'warning'
          });
        });
      }).catch(function (e) {
        console.warn('[EXPTYPE] mapping refresh failed:', e && e.message);
      });

      // Header shows the RENTAL SPAN, not the week -- the week is already in the
      // week picker beside it. Set wherever the grid is (re)built so it survives
      // a week change.
      const spanLabel = $page.functions.formatRequestSpan(lines);
      // Only overwrite when we actually derived one. The span belongs to the
      // REQUEST, so it must not blank out just because the week the user paged
      // to happens to carry no rows.
      if (spanLabel) { $page.variables.requestSpanLabel = spanLabel; }
      const provider = $page.functions.initProviderFromLines(lines, selectedWeekStr);
      $page.variables.dataGridProvider = provider;

      // ─── Step 6: Set header variables ─────────────────────────────────────
      if (finalRows.length > 0) {
        const allPosted    = finalRows.every(r => r.entryStatus === 'POSTED');
        const allApproved  = finalRows.every(r => r.entryStatus === 'APPROVED' || r.entryStatus === 'POSTED');
        const allSubmitted = finalRows.every(r => r.entryStatus === 'SUBMITTED' || r.entryStatus === 'APPROVED' || r.entryStatus === 'POSTED');
        const derivedStatus = allPosted ? 'POSTED' : allApproved ? 'APPROVED' : allSubmitted ? 'SUBMITTED' : 'DRAFT';
        $page.variables.headerStatus = derivedStatus;
        $page.variables.totalHours   = finalRows.reduce((s, r) => s + (r.totalHours || 0), 0);
        $page.variables.billAmount   = finalRows.reduce((s, r) => s + (r.totalBill   || 0), 0);
      } else {
        $page.variables.headerStatus = '';
        $page.variables.totalHours   = 0;
        $page.variables.billAmount   = 0;
      }
    }
  }

  return vbEnterChain;
});
