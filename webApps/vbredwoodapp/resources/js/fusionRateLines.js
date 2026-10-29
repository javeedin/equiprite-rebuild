define([], function () {
  'use strict';

  /*
   * THE UNIT of a Fusion PPM charge line.
   *
   * Under PPM rate sourcing EquipRite sends a quantity and lets Fusion price it.
   * That makes the UNIT the single most dangerous thing on the timesheet: the
   * same equipment routinely carries both a Day-based and an Hours-based line
   *
   *     AUV OS-7 - Operational Day Rate       UnitOfMeasureName = Day
   *     AUV OS-7 - Operational Hourly Rate    UnitOfMeasureName = Hours
   *
   * and nothing about the name tells the grid which one it is holding. Type 12
   * into a day box against a Day-based line and Fusion bills twelve DAYS for
   * that one day. This is not hypothetical: EquipRite 1.0 read this exact field,
   * stored it on the row, and never looked at it again, and their production
   * data has `VX RING TOOL 18 3/4"` posting 84 DY for a seven-day week, APPROVED.
   * See MD/Fusion Rates/08_HANDOFF_PPM_MODE.md 4A.3.
   *
   * WHAT THIS MODULE IS FOR, AND WHAT IT IS NOT FOR
   *
   * It fetches rate-schedule LINES and hands back their units. It deliberately
   * does NOT price anything and must never be used to. Under PPM sourcing the
   * cost is Fusion's to compute; the moment this module's `rate` is multiplied
   * by anything we are back to two pricing engines disagreeing.
   *
   * `rate` is returned for one reason only: a line with a zero or blank rate and
   * RateRequired ticked prices every transaction at nothing, silently. Every
   * visible line in the customer's own tenant currently reads 0. Surfacing that
   * is worth more than hiding it.
   *
   * WHY IT ENRICHES RATHER THAN REPLACES
   *
   * resources/js/expenditureTypes.js already answers "which expenditure types may
   * this project be charged under?", and that answer is hard-won (PPM transaction
   * controls, a known value-set gap, a proven-accepted floor). This module does
   * not second-guess it. It adds a `uom` to the entries that match by name and
   * leaves every other entry exactly as it was, so a failure here degrades to
   * the behaviour that shipped before it existed.
   *
   * WHY MATCHING IS BY EXPENDITURE TYPE NAME
   *
   * At this customer the non-labor resource and the expenditure type are the
   * same string on all 109 authored rows, and their cost lines carry a NULL
   * resource -- the price resolves on expenditure type alone. So the expenditure
   * type name is the only key present on both sides. NonLaborResourceName is
   * returned when present but is not relied on.
   */

  var BASE  = '/fscmRestApi/resources/11.13.18.05/';
  var PAGE  = 500;
  var CACHE = {};   // scheduleName -> { byType: {...}, scheduleId, currency }

  function rows(resp) {
    var b = resp && resp.body;
    if (!b) { return []; }
    return Array.isArray(b.items) ? b.items : (Array.isArray(b) ? b : []);
  }

  /**
   * Resolve a rate schedule NAME to its id.
   *
   * By name because nothing in the data marks a schedule as cost versus bill --
   * both are ScheduleType 'Nonlabor' and the distinction lives in the
   * organization costing rule, which REST does not expose. The name is also what
   * separates the currency pair (an AED schedule and a USD one over the same
   * lines), so it has to match exactly rather than by prefix.
   */
  async function resolveScheduleId(callRest, scheduleName) {
    if (!scheduleName) { return null; }
    var resp = await callRest({
      endpoint: 'ProjectLOV/getFscmRestApiResources11_13_18_05RateSchedules',
      // RateScheduleName, NOT Name -- verified against Dev9 2026-09-17. The
      // resource has no attribute called Name at all, so the obvious guess
      // returns a 400 rather than an empty list.
      uriParams: { q: "RateScheduleName='" + String(scheduleName).replace(/'/g, "''") + "'" }
    });
    var items = rows(resp);
    if (!items.length) {
      console.warn('[RATELINE] no rate schedule named', scheduleName);
      return null;
    }
    if (items.length > 1) {
      // Two schedules of the same name would mean picking a currency at random.
      console.warn('[RATELINE] ' + items.length + ' schedules named', scheduleName, '- using the first');
    }
    return { id: items[0].RateScheduleId, currency: items[0].CurrencyCode };
  }

  /**
   * All lines of one schedule, paged. Their tenant holds 233-932 lines per
   * schedule, so one page is usually enough, but paging is cheap and a silently
   * truncated list would drop units for whatever fell off the end.
   */
  async function fetchLines(callRest, scheduleId) {
    var out = [], offset = 0;
    for (var guard = 0; guard < 40; guard++) {
      var resp = await callRest({
        endpoint: 'ProjectLOV/getFscmRestApiResources11_13_18_05RateSchedulesRates',
        uriParams: { rateScheduleId: String(scheduleId), limit: PAGE, offset: offset }
      });
      var page = rows(resp);
      out = out.concat(page);
      if (page.length < PAGE) { break; }
      offset += PAGE;
    }
    return out;
  }

  /**
   * expenditure type name -> { uom, rate, resourceName, ... } for one schedule.
   * Cached per schedule name: the grid asks once per page load, and this list
   * changes when someone edits Fusion setup, not during a session.
   */
  async function loadByExpenditureType(callRest, scheduleName) {
    if (CACHE[scheduleName]) { return CACHE[scheduleName]; }

    var sched = await resolveScheduleId(callRest, scheduleName);
    if (!sched || !sched.id) { return null; }

    var lines = await fetchLines(callRest, sched.id);
    var byType = {};
    lines.forEach(function (l) {
      var key = (l.ExpenditureTypeName || '').trim();
      if (!key) { return; }
      // First line wins. A type with two lines in one schedule would be a
      // date-effective pair; taking the first keeps this deterministic rather
      // than letting page order decide the unit.
      if (byType[key]) { return; }
      byType[key] = {
        uom:          l.UnitOfMeasureName || null,
        rate:         (l.Rate === null || l.Rate === undefined) ? null : Number(l.Rate),
        resourceName: l.NonLaborResourceName || null,
        startDate:    l.StartDateActive || null,
        endDate:      l.EndDateActive || null
      };
    });

    CACHE[scheduleName] = { byType: byType, scheduleId: sched.id, currency: sched.currency };
    console.log('[RATELINE] ' + scheduleName + ': ' + lines.length + ' lines, ' +
                Object.keys(byType).length + ' expenditure types');
    return CACHE[scheduleName];
  }

  /**
   * Adds `uom` (and `rate`) to the entries of an existing {value,label} list.
   *
   * Returns a NEW array. Entries with no matching rate line come back untouched
   * and carry no `uom`, which every consumer already treats as "unit unknown,
   * behave exactly as before".
   */
  async function enrich(callRest, list, scheduleName) {
    if (!Array.isArray(list) || !list.length || !scheduleName) { return list; }
    var loaded;
    try {
      loaded = await loadByExpenditureType(callRest, scheduleName);
    } catch (e) {
      // Never let a unit lookup break the picker. Losing the unit costs a guard;
      // losing the list costs the page.
      console.warn('[RATELINE] enrich failed, list unchanged:', e && e.message);
      return list;
    }
    if (!loaded) { return list; }

    var hits = 0;
    var out = list.map(function (opt) {
      var m = loaded.byType[(opt.value || '').trim()];
      if (!m || !m.uom) { return opt; }
      hits++;
      return Object.assign({}, opt, { uom: m.uom, rate: m.rate });
    });
    console.log('[RATELINE] units attached to ' + hits + ' of ' + list.length + ' expenditure types');
    return out;
  }

  function clearCache() { CACHE = {}; }

  return {
    resolveScheduleId:      resolveScheduleId,
    loadByExpenditureType:  loadByExpenditureType,
    enrich:                 enrich,
    clearCache:             clearCache
  };
});
