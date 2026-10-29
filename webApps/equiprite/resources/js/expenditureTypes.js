define([], function () {
  'use strict';

  /*
   * THE expenditure-type list, resolved once and shared.
   *
   * Two screens ask the same question — "which expenditure types can this line
   * be charged under?" — the Post Cost detail page (its per-equipment drawer and
   * its misc-charge drawer) and the timesheet detail grid. This module is the
   * single answer, deliberately: this app has already paid for the same logic
   * living in seven chains in two versions (see the visibleRows comment in
   * post-cost-test-detail-page.js), and a picker that offers different values on
   * two screens is worse than one that is wrong on both.
   *
   * The answer is the tenant catalogue (expenditureTypesLOV), active today. It is
   * NOT scoped by project, by decision (2026-10-04): at Oceaneering every active
   * type is chargeable on every project -- 0 of 4,682 projects on dev9 are
   * inclusive, and the usage projects carry no transaction controls. The project
   * check that used to run here (TransactionControlFlag + ProjectTransactionControls)
   * never removed a type there, cost two Fusion calls per screen, and 404'd on any
   * request whose project lives on another pod. Should a project ever restrict
   * types, Fusion rejects the type at cost import and says why.
   *
   * It used to be the value set behind the REQUISITION distribution DFF -- a
   * purchasing list. At Oceaneering (dev9) that set held 261 types for project
   * 0000242517 and NONE of the 28 equipment usage types actually costed to it.
   * The catalogue holds all of them, and it is the same list the mapping screens
   * author from, so an authored type can no longer fail to match the picker it is
   * meant to narrow.
   *
   * The PR drawer (request-detail-page) still reads the requisition value set,
   * and should: that list is exactly what a requisition line validates against.
   *
   * ⚠️ Still true: a type Fusion lists can be refused at cost import by the
   * document entry (e.g. a Usages-class entry wants usage types), and that check
   * only fires at posting. Passing this list is not passing import.
   */

  // The values PROVEN accepted by unprocessedProjectCosts (201, $300 to
  // OCEANEERING-DEMO). The floor under every failure path, so a picker is never
  // empty. Do NOT widen this by hand — a bad value fails only at submit.
  var PROVEN = [
    { value: 'Equipment',           label: 'Equipment',           id: null },
    { value: 'Purchased Equipment', label: 'Purchased Equipment', id: null },
    { value: 'Supplies',            label: 'Supplies',            id: null },
    { value: 'Miscellaneous',       label: 'Miscellaneous',       id: null }
  ];

  // Rows out of a list response, from EITHER envelope. This module talks to two
  // APIs with two conventions and it matters: Fusion REST returns { items: [...] },
  // the eqpt API returns { data: [...], recordCount, page, ... }. Reading only
  // `items` made every eqpt list look empty, which is how the timesheet page
  // silently resolved projectRefId = null and fell back to the seeded values while
  // Post Cost - which never needed an eqpt list - worked fine.
  function itemsOf(resp) {
    var b = resp && resp.body;
    if (!b) { return []; }
    if (Array.isArray(b.items)) { return b.items; }   // Fusion
    if (Array.isArray(b.data)) { return b.data; }     // eqpt
    if (Array.isArray(b)) { return b; }               // bare array
    return [];
  }

  function today() {
    var n = new Date();
    return n.getFullYear() + '-'
      + String(n.getMonth() + 1).padStart(2, '0') + '-'
      + String(n.getDate()).padStart(2, '0');
  }

  /**
   * Every expenditure type active today, sorted by name, each carrying its unit.
   *
   * Never throws: an empty return tells the caller to keep its seeded list rather
   * than blanking a picker. Locally every call 401s — the Fusion credentials in
   * .env are <placeholder> values and the dev proxy sends no auth — so expect
   * PROVEN on localhost and the real list only where credentials exist.
   *
   * End-dated types are dropped (9 of 2,510 on dev9, end-dated 1951-01-01 =
   * switched off); a row that already HOLDS one keeps it via withCurrentValue.
   *
   * @param callRest  function(options) -> Promise<response>
   * @returns Promise<Array<{value,label,id,uom}>>  empty if the catalogue failed
   */
  async function loadActiveTypes(callRest) {
    try {
      var d = today();
      var catalogue = await loadCatalogue(callRest);
      var list = catalogue.filter(function (r) { return isActive(r, d); })
        .map(function (r) {
          // Keyed on the NAME. The cost path sends _EXPENDITURE_TYPE_ID_Display and
          // EQR_LINE_MISC_TXN.EXPENDITURE_TYPE stores a name, so a numeric key would
          // write numbers into a column that holds names. The Id rides along unused.
          // The unit comes along too, so the day-box guard holds from first paint.
          return { value: r.name, label: r.name, id: r.id, uom: r.uom || undefined };
        })
        .sort(function (a, b) { return a.value.localeCompare(b.value); });
      console.log('[EXPTYPE] %d active expenditure type(s) of %d', list.length, catalogue.length);
      return list;
    } catch (e) {
      console.warn('[EXPTYPE] catalogue fetch failed:', e && e.message);
      return [];
    }
  }

  /**
   * requestNumber -> internal eqrEquipmentRequestId.
   *
   * The timesheet page needs the internal id for
   * `PATCH /equipment-requests/{requestId}/lines/{id}` and only ever receives the
   * request NUMBER; the Post Cost test page needs it for its PR lookup.
   *
   * It MUST be views/workbench-requests. `equipment-requests?requestNumber=` declares
   * the parameter and ignores it - verified live: asking for REQ-1786556804580 returns
   * REQ-1779485717855, the oldest of 368 rows. Using it would resolve the wrong
   * request entirely, so the match is asserted below rather than trusted.
   *
   * Generic enough to belong somewhere else eventually; it lives here because this is
   * where it was needed first and where its one caveat is documented.
   *
   * @returns Promise<number|null>
   */
  async function resolveRequestIdByNumber(callRest, requestNumber) {
    if (!requestNumber) { return null; }
    try {
      var wbItems = itemsOf(await callRest({
        endpoint:  'eqp-v1/getEquipriteV1ViewsWorkbenchRequests',
        uriParams: { requestNumber: String(requestNumber), page: 0, size: 1 }
      }));
      // Belt and braces: confirm the row we got back is the one we asked for, so a
      // future endpoint that quietly stops filtering cannot go unnoticed.
      var row = wbItems.find(function (r) {
        return String(r && r.requestNumber) === String(requestNumber);
      });
      if (!row) {
        console.warn('[EXPTYPE] workbench-requests did not return %s (got %o) - not guessing',
          requestNumber, wbItems.map(function (r) { return r && r.requestNumber; }));
        return null;
      }
      return Number(row.eqrEquipmentRequestId) || null;
    } catch (e) {
      console.warn('[EXPTYPE] request-number lookup failed:', e && e.message);
      return null;
    }
  }

  /**
   * The list for a request's pickers. The request no longer matters -- the list is
   * the same for every project -- but both pages call this name with their
   * request identifiers, so it keeps the signature and ignores `opts`.
   */
  async function loadForRequest(callRest, opts) {   // eslint-disable-line no-unused-vars
    return loadActiveTypes(callRest);
  }


  // ── UNIT OF MEASURE ────────────────────────────────────────────────────────
  //
  // Every expenditure type carries its own unit, and that unit is what decides
  // whether a timesheet day box means a day or an hour. The same equipment can
  // hold both: "AUV OS-7 - Operational Day Rate" is Day, "- Operational Hourly
  // Rate" is Hours. Enter 12 against a Day-based type and Fusion bills twelve
  // DAYS for that one day -- EquipRite 1.0 does exactly this, and their live
  // data has one item posting 84 DY for a seven-day week, approved.
  //
  // VERIFIED, not assumed: expenditureTypesLOV.UnitOfMeasure was compared
  // against the UnitOfMeasureName on all 1,581 lines of the customer's real
  // nonlabor cost rate schedule. It agreed on 1,581 and differed on none.
  //
  // This replaces reading the unit off a rate schedule. The rate line carries
  // the same value, but getting it there meant naming ONE schedule in config and
  // resolving it -- and a tenant has one schedule per country (130 at this
  // customer), so a single configured name is wrong everywhere but one. The
  // expenditure type is global setup, so this is correct everywhere with nothing
  // to configure. See resources/js/fusionRateLines.js, now needed only at
  // posting time for the non-labor resource.
  var UNIT_CACHE = null;
  var CATALOGUE_CACHE = null;
  var CATALOGUE_PENDING = null;

  /**
   * The tenant's whole expenditure-type catalogue, one row per type, read once.
   *
   * The single read behind the unit map, the timesheet's base list and the
   * category expansion of transaction controls. One read instead of three means
   * the three can never disagree about what a type is called or what unit it has.
   *
   * Paged: a tenant can hold thousands (2,510 at Oceaneering on dev9). Truncating
   * would drop everything past the first page silently -- the unit guard for
   * those types and the types themselves from the picker.
   *
   * @returns Promise<Array<{name, id, uom, categoryId, categoryName, start, end}>>
   */
  async function loadCatalogue(callRest) {
    if (CATALOGUE_CACHE) { return CATALOGUE_CACHE; }
    // One fetch shared by concurrent callers (the timesheet asks for the list and
    // the units at the same moment). Only a NON-EMPTY result is cached: caching a
    // failed read pinned every picker to the proven fallback for the rest of the
    // session, and the next screen never even retried (seen live 2026-10-04).
    if (!CATALOGUE_PENDING) {
      CATALOGUE_PENDING = fetchCatalogue(callRest)
        .then(function (rows) {
          if (rows.length) { CATALOGUE_CACHE = rows; }
          return rows;
        })
        .finally(function () { CATALOGUE_PENDING = null; });
    }
    return CATALOGUE_PENDING;
  }

  async function fetchCatalogue(callRest) {
    var rows = [], offset = 0;
    for (var guard = 0; guard < 30; guard++) {
      var resp = await callRest({
        endpoint: 'ProjectLOV/getFscmRestApiResources11_13_18_05ExpenditureTypesLOVByCategory',
        uriParams: {
          fields: 'ExpenditureTypeId,ExpenditureTypeName,UnitOfMeasure,ExpenditureCategoryId,'
            + 'ExpenditureCategory,ExpenditureTypeStartDate,ExpenditureTypeEndDate',
          limit:  500,
          offset: offset
        }
      });
      // callRest does not throw on an HTTP error -- it resolves with ok:false and
      // a body with no items, which read as an empty catalogue. Say why instead.
      if (resp && resp.ok === false) {
        throw new Error('expenditureTypesLOV HTTP ' + (resp.status || resp.statusCode)
          + ' at offset ' + offset + ' (401 = Fusion credentials on the backend)');
      }
      var body  = resp && resp.body;
      var items = (body && Array.isArray(body.items)) ? body.items : [];
      items.forEach(function (x) {
        var n = (x.ExpenditureTypeName || '').trim();
        if (!n) { return; }
        rows.push({
          name:         n,
          id:           (x.ExpenditureTypeId != null ? Number(x.ExpenditureTypeId) : null),
          uom:          x.UnitOfMeasure || null,
          categoryId:   (x.ExpenditureCategoryId != null ? String(x.ExpenditureCategoryId) : null),
          categoryName: x.ExpenditureCategory || null,
          start:        x.ExpenditureTypeStartDate || null,
          end:          x.ExpenditureTypeEndDate || null
        });
      });
      // Fusion says when it is done; a short page alone is not proof.
      if (!items.length || (body.hasMore === false) || (body.hasMore == null && items.length < 500)) { break; }
      offset += items.length;
    }
    console.log('[EXPTYPE] catalogue: ' + rows.length + ' expenditure type(s)');
    return rows;
  }

  /** Is the type usable on `day` (YYYY-MM-DD)? ISO dates compare as strings. */
  function isActive(row, day) {
    return (!row.start || row.start <= day) && (!row.end || row.end >= day);
  }

  async function loadUnits(callRest) {
    if (UNIT_CACHE) { return UNIT_CACHE; }
    var map = {};
    (await loadCatalogue(callRest)).forEach(function (r) {
      if (r.uom) { map[r.name] = r.uom; }
    });
    if (Object.keys(map).length) { UNIT_CACHE = map; }   // same rule: never cache a miss
    console.log('[EXPTYPE] units loaded for ' + Object.keys(map).length + ' expenditure type(s)');
    return map;
  }

  /**
   * Returns a NEW list with `uom` added to every entry that has one.
   *
   * Entries with no unit come back untouched and carry no `uom`, which every
   * consumer already reads as "unit unknown, behave as before". A failure here
   * returns the list unchanged: losing the unit costs a guard, losing the list
   * costs the picker.
   */
  async function attachUnits(callRest, list) {
    if (!Array.isArray(list) || !list.length) { return list; }
    var units;
    try {
      units = await loadUnits(callRest);
    } catch (e) {
      console.warn('[EXPTYPE] unit lookup failed, list unchanged:', e && e.message);
      return list;
    }
    var hits = 0;
    var out = list.map(function (opt) {
      var u = units[(opt.value || '').trim()];
      if (!u) { return opt; }
      hits++;
      return Object.assign({}, opt, { uom: u });
    });
    console.log('[EXPTYPE] units attached to ' + hits + ' of ' + list.length + ' type(s)');
    return out;
  }

  // ── WHICH TYPES BELONG TO WHICH EQUIPMENT ──────────────────────────────────
  //
  // The list above is everything the PROJECT may be charged under -- 84 types on
  // our dev pod, several hundred at the customer. Which two or three of them are
  // right for one piece of equipment cannot be derived: matching the equipment
  // name against the type name scores 3 of 569, and word-overlap ranking puts the
  // right answer in the top 5 only 18% of the time. They are two naming systems,
  // a procurement description versus a commercial billing name
  // ("DETECTOR ULTRASONIC FLAW 5IN DISPLAY 16GB" -> "UT Unit - Operational Day
  // Rate"). So it is AUTHORED, in EQR_EXP_TYPE_MAP, and read back here.
  //
  // Authored at MODEL grain (equipment master), with subclass and class as
  // broader fallbacks. EquipRite 1.0 authored per physical unit and covered 52 of
  // 4,380 -- the grain is the reason that feature went unused.

  var MAP_ID_CAP = 500;   // the endpoint 400s beyond this rather than ORA-01795

  /**
   * Resolve the authored expenditure types for a set of equipment masters.
   *
   * One call for a whole grid. The response envelope is `{ data }` ONLY -- no
   * recordCount/page, unlike every other list in this API -- so itemsOf() would
   * find it via its `data` branch, but the shape is spelled out here because it
   * is the one endpoint that differs.
   *
   * @returns Promise<object> keyed by master id:
   *          { <masterId>: { level: 'MASTER'|'SUBCLASS'|'CLASS'|'NONE',
   *                          types: [{ value, isDefault, displayOrder, useCount }] } }
   *          {} on any failure -- the caller then leaves every picker unnarrowed,
   *          which is the same behaviour as before this existed.
   */
  async function loadMapsForMasters(callRest, masterIds) {
    var seen = {}, ids = [];
    (masterIds || []).forEach(function (m) {
      var n = Number(m);
      if (!n || seen[n]) { return; }
      seen[n] = true;
      ids.push(n);
    });
    if (!ids.length) { return {}; }
    if (ids.length > MAP_ID_CAP) {
      console.warn('[EXPTYPE] %d masters exceeds the %d cap; asking for the first %d',
        ids.length, MAP_ID_CAP, MAP_ID_CAP);
      ids = ids.slice(0, MAP_ID_CAP);
    }

    var out = {};
    try {
      var resp = await callRest({
        endpoint: 'eqp-v1/resolveExpTypeMaps',
        // uriParams, NOT parameters: VB drops query values passed under
        // `parameters` silently, which would send the call with no ids and 400.
        uriParams: { equipmentMasterIds: ids.join(',') }
      });
      var rows = itemsOf(resp);
      rows.forEach(function (r) {
        if (!r || r.eqrEquipmentMasterId == null) { return; }
        out[Number(r.eqrEquipmentMasterId)] = {
          level: r.resolvedLevel || 'NONE',
          types: (Array.isArray(r.types) ? r.types : []).map(function (t) {
            return {
              value:        t.expenditureType,
              isDefault:    t.isDefault === 'Y',
              displayOrder: t.displayOrder,
              useCount:     t.useCount
            };
          })
        };
      });
      var mapped = Object.keys(out).filter(function (k) { return out[k].level !== 'NONE'; }).length;
      console.log('[EXPTYPE] mapping: %d of %d master(s) have authored types', mapped, ids.length);
    } catch (e) {
      console.warn('[EXPTYPE] mapping lookup failed, pickers stay unnarrowed:', e && e.message);
      return {};
    }
    return out;
  }

  /**
   * Narrow the project's type list to the ones authored for one equipment master.
   *
   * Returns the FULL list unchanged whenever narrowing cannot be done safely:
   * no mapping, level NONE, or -- the case worth knowing about -- an authored
   * name that is not in the project's chargeable list at all. Offering a type
   * Fusion will reject is the failure we already know about, but blanking the
   * picker is worse: the user then cannot record anything. So an empty
   * intersection falls back and says so in the console.
   *
   * Matching is case-insensitive on the NAME, which is the key everywhere here
   * (the Fusion id is usually null). Options come back whole, so they keep the
   * `uom` attachUnits() put on them -- narrowing must never cost the unit guard.
   *
   * Server order is preserved: default first, then displayOrder, then useCount.
   */
  function narrowForMaster(list, entry) {
    if (!Array.isArray(list) || !list.length) { return list; }
    if (!entry || entry.level === 'NONE' || !entry.types || !entry.types.length) { return list; }

    var byName = {};
    list.forEach(function (o) {
      if (o && o.value) { byName[String(o.value).trim().toUpperCase()] = o; }
    });

    var out = [];
    entry.types.forEach(function (t) {
      var hit = t && t.value ? byName[String(t.value).trim().toUpperCase()] : null;
      if (hit && out.indexOf(hit) === -1) { out.push(hit); }
    });

    if (!out.length) {
      console.warn('[EXPTYPE] %s-level mapping matched none of the project\'s types '
        + '(authored: %o) - keeping the full list rather than blanking the picker',
        entry.level, entry.types.map(function (t) { return t.value; }));
      return list;
    }
    return out;
  }

  /**
   * Which mapped masters resolved to types this project cannot be charged under.
   *
   * This exists because the failure is otherwise INVISIBLE. A mapping whose
   * names are not in the project's list behaves exactly like no mapping at all
   * -- the picker keeps its full list either way -- so someone can author twenty
   * mappings against the wrong catalogue and see no difference anywhere. It
   * happened on the first real attempt: 'Equipment' and 'Major Equipment' are in
   * the tenant-wide list the admin screen offers, and in neither case in the
   * project's 84.
   *
   * @returns array of master ids whose mapping matched nothing. Empty when all
   *          is well, which is the caller's cue to say nothing at all.
   */
  function unmatchedMasters(list, map) {
    if (!Array.isArray(list) || !list.length || !map) { return []; }
    var have = {};
    list.forEach(function (o) {
      if (o && o.value) { have[String(o.value).trim().toUpperCase()] = true; }
    });
    return Object.keys(map).filter(function (id) {
      var entry = map[id];
      if (!entry || entry.level === 'NONE' || !entry.types || !entry.types.length) { return false; }
      return !entry.types.some(function (t) {
        return t && t.value && have[String(t.value).trim().toUpperCase()];
      });
    });
  }

  /**
   * Put `current` back into a narrowed list if narrowing dropped it.
   *
   * Narrowing decides what a picker OFFERS; it must never decide what a row
   * already HOLDS. A saved value missing from its own picker's data renders
   * blank and, through a two-way binding, can be written back as null -- so a
   * mapping authored today would quietly erase a type recorded last week.
   *
   * The option object is taken from the full list when it is there, so it keeps
   * its label and its unit; only a value that is in neither list is wrapped as
   * a bare option, which is the case where the type is no longer offered by the
   * project at all and the user most needs to see what is on the row.
   *
   * NOTE ON THE DEFAULT: a mapping's isDefault does NOT auto-fill an empty cell.
   * It orders the list so the default is the first option. Auto-filling would
   * mark rows dirty that the user never touched, and the next save would PATCH
   * expenditure types onto lines nobody chose them for.
   */
  function withCurrentValue(narrowed, fullList, current) {
    if (!current || !Array.isArray(narrowed)) { return narrowed; }
    var key = String(current).trim().toUpperCase();
    var present = narrowed.some(function (o) {
      return o && String(o.value).trim().toUpperCase() === key;
    });
    if (present) { return narrowed; }

    var fromFull = (Array.isArray(fullList) ? fullList : []).find(function (o) {
      return o && String(o.value).trim().toUpperCase() === key;
    });
    return narrowed.concat([fromFull || { value: current, label: current, id: null }]);
  }

  return {
    PROVEN: PROVEN,
    attachUnits: attachUnits,
    // Exported for the mapping admin screen, which authors against the whole
    // tenant's types rather than one project's, and wants the unit beside each.
    loadUnits: loadUnits,
    loadMapsForMasters: loadMapsForMasters,
    narrowForMaster: narrowForMaster,
    withCurrentValue: withCurrentValue,
    unmatchedMasters: unmatchedMasters,
    resolveRequestIdByNumber: resolveRequestIdByNumber,
    loadActiveTypes: loadActiveTypes,
    loadForRequest: loadForRequest
  };
});
