/**
 * Equipment Reports — per-tab data layer.
 *
 * Replaces the old load-everything InitChain, which awaited SEVEN endpoints
 * sequentially on vbEnter (five with size=10000) to render one visible tab.
 * Here each tab owns one endpoint and is fetched only when it becomes active.
 *
 * Search is server-side: the smart-search criterion is translated by
 * reportCriterion into params scoped to the ACTIVE tab's endpoint only, so a
 * search on Rate Exceptions cannot emit Rental-Requests params. The old
 * client-side _filterRows path is gone.
 *
 * LOVs are per-tab too. An earlier build pooled option values across all six
 * reports, so the Equipment dropdown on Rate Exceptions offered names that only
 * existed in Rental Requests — pick one, get zero rows. Each tab now derives its
 * options from its own rows.
 *
 * CHIPS MUST NAME REAL PARAMS, AND EACH TAB LOADS ITS OWN CONFIG
 * A smart-search filter's `field` is forwarded only when the active tab's
 * ENDPOINT_PARAMS map declares that exact name, and the views ignore unknown
 * params silently (rental-requests?equipmentName=zzz → HTTP 200, all 642 rows).
 * So a chip whose field is not a real param of the tab's endpoint renders,
 * accepts a pick, shows as an active filter — and changes nothing. That was the
 * state of the Equipment chip on five of six tabs, plus Class on Rate Schedule
 * (param is className) and Status on Rental Requests (param is requestStatus).
 *
 * The six views spell those concepts differently, so the filters cannot live in
 * one shared config: oj-sp-smart-search renders a chip for EVERY filter the
 * loaded config declares, and `suggestion-filters` does NOT gate that row — a
 * config holding all six tabs' filters put three chips labelled "Equipment",
 * two "Class" and two "Status" on screen at once. Hence one config file per tab
 * under resources/data/reports/<tab>.json, selected by the config URL
 * expression in the page's reportsSearchConfiguration variable. Filter ids are
 * reused across those files because only one file is ever loaded — StatusFilter
 * is allocationStatus on Equipment History, requestStatus on Rental Requests and
 * status on Agreement Expiry, all sharing one options array.
 *
 * The chip set per tab is CURATED, not every param the endpoint accepts; each
 * config file's description records what was left off and why.
 *
 * NB `size`: the views clamp size to a hard server-side max of 2000 (undocumented
 * — size=10000 silently becomes 2000). PAGE_SIZE reflects the real ceiling. Views
 * report recordCount/hasMore truthfully, so TAB_META.rowsVar consumers can detect
 * truncation rather than silently showing a partial report.
 */
define([
  'resources/js/reportCriterion'
], function (reportCriterion) {
  'use strict';

  // The real server-side maximum. Asking for more is silently clamped.
  var PAGE_SIZE = 2000;

  function ymd(v) { return v ? String(v).slice(0, 10) : ''; }
  function str(v) { return v == null ? '' : String(v); }

  // ── Row mappers: API camelCase → the field names each grid provider reads ──

  function mapHistory(r) {
    return {
      equipment_name:    r.equipmentName    || '',
      equipment_number:  r.equipmentNumber  || '',
      serial_number:     r.serialNumber     || '',
      start_date:        r.startDate        || '',
      end_date:          r.endDate          || '',
      allocation_status: r.allocationStatus || '',
      line_status:       r.lineStatus       || '',
      project_number:    r.projectNumber    || '',
      project_name:      r.projectName      || '',
      customer_name:     r.customerName     || ''
    };
  }

  // Rental Requests passes through as-is — the view already emits camelCase that
  // matches the grid provider's field names.
  function mapRental(r) { return r; }

  // NB the view has no costDate, no cost-type breakdown and no vendor — the
  // columns fed by those were blank on every row and are gone. postedDate IS
  // returned (it just isn't in the openapi response schema), so the date column
  // now shows when the cost was posted.
  function mapProjCost(r) {
    return {
      project_number: r.projectNumber || '',
      project_name:   r.projectName   || '',
      request_number: r.requestNumber || '',
      line_number:    r.lineNumber != null ? String(r.lineNumber) : '',
      equip_number:   r.equipmentNumber || '',
      equip_name:     r.equipmentName || '',
      equip_desc:     r.equipmentDescription || r.equipmentName || '',
      posted_date:    r.postedDate || '',
      cost_amount:    r.cost != null ? r.cost : 0,
      quantity:       r.quantity,
      total_cost:     r.totalCost != null ? r.totalCost : 0,
      posted_status:  r.postedStatus || ''
    };
  }

  // equip_name is the equipment NAME — the view exposes no description, which is
  // why the column that used to be labelled "Equipment Description" has always
  // shown the name. The evaluation-window columns are gone: the view reports
  // units whose resolved rate is zero and carries no window, so they were blank.
  function mapRateExc(r) {
    return {
      yard:             r.yard            || '',
      equip_number:     r.equipmentNumber || '',
      equip_name:       r.equipmentName   || '',
      equip_class:      r.equipmentClass  || '',
      subclass:         r.subclass        || '',
      exception_reason: 'Rate Not Defined'
    };
  }

  function mapRateSched(r) {
    var uom = r.rateUom || 'DAY';
    var threshold = '';
    if (r.fromUnit != null) {
      threshold = r.toUnit != null
        ? r.fromUnit + ' – ' + r.toUnit + ' ' + uom
        : r.fromUnit + '+ ' + uom;
    }
    return {
      schedule_id:    r.scheduleCode          || r.scheduleId    || '',
      schedule_name:  r.scheduleName          || '',
      equip_class:    r.equipmentClassName    || r.className     || '',
      equip_subclass: r.equipmentSubclassName || '',
      equip_name:     r.equipmentName         || '',
      effective_from: r.schedEffectiveFrom    || r.effectiveFrom || '',
      effective_to:   r.schedEffectiveTo      || r.effectiveTo   || '',
      status:         r.isActiveFlag === 'Y' ? 'ACTIVE'
                    : r.isActiveFlag === 'N' ? 'INACTIVE'
                    : (r.scheduleStatus || r.isActiveFlag || ''),
      period:         r.periodType   || r.ratePeriod || '',
      rate_type:      r.lineRateType || r.rateType   || '',
      // The rateType PARAM filters on the SCHEDULE's type, not the line's —
      // proven live: rateType=STANDARD returns all 131 rows, rateType=USAGE
      // (a lineRateType value) returns 0. The Rate Type chip must therefore
      // take its options from here, not from rate_type above.
      sched_rate_type: r.schedRateType || '',
      threshold:      r.thresholdDisplay || threshold,
      rate:           r.costRate != null ? r.costRate : (r.rateAmount || 0)
    };
  }

  // Agreement Expiry passes through as-is.
  function mapAgreement(r) { return r; }

  // Declared BEFORE TAB_META on purpose: TAB_META references these in its
  // object literal, and `var` hoists the declaration but not the assignment —
  // defined after it, every static lov entry would be undefined at module load
  // and loadTab would throw on the first tab that uses one.
  // ── Static option sets: params whose valid values are an enum the rows never
  // carry. Sourced from services/eqp-v1/openapi3.json.
  var OPT_PROCUREMENT = { static: [
    { label: 'Has Requisition',    value: 'HAS_PR'  },
    { label: 'Has Purchase Order', value: 'HAS_PO'  },
    { label: 'Awaiting PO',        value: 'PENDING' },
    { label: 'No Procurement',     value: 'NEITHER' }
  ] };
  var OPT_POSTED = { static: [
    { label: 'Posted',   value: 'POSTED'   },
    { label: 'Unposted', value: 'UNPOSTED' }
  ] };
  var OPT_ACTIVE = { static: [
    { label: 'Active',   value: 'Y' },
    { label: 'Inactive', value: 'N' }
  ] };

  /**
   * Per-tab wiring.
   *
   * `criterionKey` is the reportCriterion endpoint key, which scopes search to
   * this tab alone.
   *
   * `lovs` maps an option-array page variable to the row field(s) that fill it.
   * A string means label and value are the same field; a { label, value } pair
   * means they differ — needed whenever the view filters on an identifier but
   * the user must pick a readable name (Equipment History filters by
   * equipmentMasterId, Project Cost Detail by equipmentNumber).
   *
   * One variable per filter id, refilled from THIS tab's rows. Only the ids in
   * this tab's config file are filled. The previous build filled arrays no chip
   * read (yard, project, serial) while leaving a chip it DID offer unfilled
   * (Status on Agreement Expiry, whose dropdown showed the previous tab's
   * leftovers).
   */
  var TAB_META = {
    'equip-history': {
      endpoint:     'eqp-v1/getEquipriteV1ViewsEquipmentHistory2',
      criterionKey: 'equipment-history',
      rowsVar:      'historyRows',
      map:          mapHistory,
      lovs: {
        reportsStatusOptionsArray:     'allocation_status',
        reportsLineStatusOptionsArray: 'line_status',
        reportsProjectOptionsArray:    'project_name',
        reportsEquipmentOptionsArray:  'equipment_name'
      }
    },
    'rental-requests': {
      endpoint:     'eqp-v1/getEquipriteV1ViewsRentalRequests',
      criterionKey: 'rental-requests',
      rowsVar:      'rentalReqRows',
      map:          mapRental,
      // EquipmentFilter options ARE populated below (equipmentName is on every
      // row), but see rental-requests.json's own caution note: this view's
      // endpoint has no equipment query param at all, so picking a value here
      // currently filters nothing server-side — free-text q is still the only
      // way this view actually narrows by equipment.
      lovs: {
        reportsClassOptionsArray:       'equipmentClass',
        reportsStatusOptionsArray:      'requestStatus',
        reportsLineStatusOptionsArray:  'lineStatus',
        reportsProcurementOptionsArray: OPT_PROCUREMENT,
        reportsProjectOptionsArray:     'projectName',
        reportsEquipmentOptionsArray:   'equipmentName'
      }
    },
    'proj-cost-detail': {
      endpoint:     'eqp-v1/getEquipriteV1ViewsProjectCostDetail2',
      criterionKey: 'project-cost-detail',
      rowsVar:      'projCostRows',
      map:          mapProjCost,
      lovs: {
        reportsPostedOptionsArray:    OPT_POSTED,
        reportsProjectOptionsArray:   'project_name',
        reportsEquipmentOptionsArray: 'equip_name'
      }
    },
    'rate-exceptions': {
      endpoint:     'eqp-v1/getEquipriteV1ViewsRateExceptions',
      criterionKey: 'rate-exceptions',
      rowsVar:      'rateExcRows',
      map:          mapRateExc,
      // No Project chip: rate exceptions are unit/class/subclass-level rows
      // with no project field at all (confirmed against the view's response
      // schema) — removed rather than shipped empty.
      lovs: {
        reportsClassOptionsArray:    'equip_class',
        reportsSubclassOptionsArray: 'subclass',
        reportsYardOptionsArray:     'yard',
        reportsEquipmentOptionsArray: 'equip_name'
      }
    },
    'rate-schedule-rpt': {
      endpoint:     'eqp-v1/getEquipriteV1ViewsRateSchedLines',
      criterionKey: 'rate-sched-lines',
      rowsVar:      'rateSchedRows',
      map:          mapRateSched,
      // No equipment chip: rate lines are authored at class/subclass level, so
      // equipmentName is null on virtually every row and is not a param either.
      // No Class chip: rate-sched-lines DECLARES a className param but the
      // server ignores it (className=ZZZ still returns all 131 rows), unlike
      // the same-named param on the three analytics views. Free-text q covers
      // class here in the meantime.
      lovs: {
        reportsRateTypeOptionsArray: 'sched_rate_type',
        reportsPeriodOptionsArray:   'period',
        reportsActiveOptionsArray:   OPT_ACTIVE
      }
    },
    'agreement-expiry': {
      endpoint:     'eqp-v1/getEquipriteV1ViewsAgreementExpiry2',
      criterionKey: 'agreement-expiry',
      rowsVar:      'agreementExpiryRows',
      map:          mapAgreement,
      // No equipment chip: agreements carry no equipment at all. The old build
      // labelled one "Equipment" and filled it with agreement NAMES.
      lovs: {
        reportsTypeOptionsArray:   'agreementType',
        reportsStatusOptionsArray: 'status',
        reportsExpiryOptionsArray: 'expiryStatus'
      }
    }
  };

  /**
   * Suggestion chips per tab — only filters whose `field` is a real query param
   * of that tab's endpoint (see reportCriterion.ENDPOINT_PARAMS).
   *
   * The previous set offered EquipNameFilter on all six tabs, but only
   * rate-exceptions declares an equipmentName param, so the Equipment chip was a
   * visible no-op on the other five. ClassFilter on rate-schedule-rpt and
   * StatusFilter on rental-requests failed the same way: those views name the
   * params className and requestStatus, and a near-miss is dropped exactly like
   * an absent one.
   */
  var SUGGESTION_FILTERS = {
    'equip-history':     ['AssetGroupFilter', 'StatusFilter', 'LineStatusFilter', 'ProjectFilter', 'EquipmentFilter'],
    'rental-requests':   ['AssetGroupFilter', 'ClassFilter', 'StatusFilter', 'LineStatusFilter', 'ProcurementFilter', 'ProjectFilter', 'EquipmentFilter'],
    'proj-cost-detail':  ['AssetGroupFilter', 'PostedFilter', 'ProjectFilter', 'EquipmentFilter'],
    'rate-exceptions':   ['AssetGroupFilter', 'ClassFilter', 'SubclassFilter', 'YardFilter', 'EquipmentFilter'],
    'rate-schedule-rpt': ['RateTypeFilter', 'PeriodFilter', 'ActiveFilter'],
    'agreement-expiry':  ['TypeFilter', 'StatusFilter', 'ExpiryFilter']
  };

  // Returned as an ARRAY: the component's suggestion-filters property is
  // string[], and the old JSON.stringify handed it a String, which it ignored.
  // It orders/preselects the chips; it does NOT decide which ones exist — that
  // is the per-tab config file (see searchConfigPathFor).
  function suggestionFiltersFor(tab) {
    return (SUGGESTION_FILTERS[tab] || []).slice();
  }

  /** Path of the tab's own smart-search config, relative to $application.path. */
  function searchConfigPathFor(tab) {
    return 'resources/data/reports/' + (TAB_META[tab] ? tab : 'equip-history') + '.json';
  }

  /**
   * Distinct sorted { label, value } options for one chip.
   *
   * `spec` is one of:
   *   'field'                      label === value, read from that row field
   *   { label, value }             two different row fields (name shown, id sent)
   *   { static: [ {label,value} ] } fixed set, for params whose valid values are
   *                                an enum the rows do not contain (duration,
   *                                postedStatus, isActiveFlag, procurement)
   *
   * Dedupe is on the VALUE — that is what gets sent as the query param, so two
   * units sharing a description must stay two options.
   */
  function buildOptions(rows, spec) {
    if (spec && spec.static) return spec.static.slice();

    var labelField = typeof spec === 'string' ? spec : (spec.label || spec.value);
    var valueField = typeof spec === 'string' ? spec : spec.value;
    var seen = {}, opts = [];

    function push(value, label) {
      var k = String(value);
      if (seen[k]) return;
      seen[k] = true;
      opts.push({ label: label == null || label === '' ? k : String(label), value: value });
    }

    (rows || []).forEach(function (r) {
      var v = r[valueField];
      if (v == null || v === '') return;
      push(v, r[labelField]);
    });

    opts.sort(function (a, b) { return a.label.localeCompare(b.label); });
    return opts;
  }


  /**
   * Page-level date window -> query params, for the tabs that have one.
   *
   * This is NOT part of the criterion: smart search has no date filter type, so
   * the window is a page control (Period preset + Custom range) exactly as on
   * the Analytics Utilization tab. Only Equipment History has one today; the map
   * is keyed by tab so another report can be added without touching loadTab.
   *
   *   preset  -> duration=LAST_30_DAYS
   *   custom  -> fromDate/toDate, which this view lets win over duration
   *   'all'   -> nothing, so the report is unfiltered (the default, which keeps
   *              the tab showing every row as it did before the control existed)
   */
  var WINDOW_PARAMS = {
    'equip-history': { preset: 'duration', from: 'fromDate', to: 'toDate' }
  };

  function windowParams($page, tab) {
    var map = WINDOW_PARAMS[tab];
    if (!map) return {};
    var preset = $page.variables.reportsDatePreset;
    if (!preset || preset === 'all') return {};
    if (preset === 'custom') {
      var f = $page.variables.reportsCustomFrom, t = $page.variables.reportsCustomTo;
      f = f ? String(f).slice(0, 10) : '';
      t = t ? String(t).slice(0, 10) : '';
      if (!f || !t) return {};                       // half a range filters nothing
      var out = {};
      // Tolerate a reversed pair rather than sending an empty window.
      out[map.from] = f <= t ? f : t;
      out[map.to]   = f <= t ? t : f;
      return out;
    }
    var p = {};
    p[map.preset] = preset;
    return p;
  }

  /**
   * Fetch one tab under the current criterion and write its rows + LOVs.
   * Returns { rows, recordCount, truncated }.
   */
  async function loadTab($page, context, Actions, tab, criterion) {
    var meta = TAB_META[tab];
    if (!meta) { console.warn('[reportsData] unknown tab: ' + tab); return { rows: [] }; }

    // Search params are scoped to THIS endpoint; unsupported fields are dropped.
    var uriParams = reportCriterion.toUriParams(meta.criterionKey, criterion);
    // The page-level window is merged in AFTER the criterion, but no chip emits
    // a date field so the two cannot collide.
    Object.assign(uriParams, windowParams($page, tab));
    uriParams.page = 0;
    uriParams.size = PAGE_SIZE;

    var resp = await Actions.callRest(context, {
      endpoint: meta.endpoint,
      uriParams: uriParams
    });

    if (!resp || !resp.ok) {
      console.warn('[reportsData] fetch failed for ' + tab + ' (' + meta.endpoint + ')');
      $page.variables[meta.rowsVar] = [];
      return { rows: [], recordCount: 0, truncated: false };
    }

    var body = resp.body || {};
    var raw  = Array.isArray(body.data) ? body.data : [];
    var rows = raw.map(meta.map);
    $page.variables[meta.rowsVar] = rows;

    // Per-tab LOVs, derived from this tab's rows only.
    Object.keys(meta.lovs || {}).forEach(function (lovVar) {
      $page.variables[lovVar] = buildOptions(rows, meta.lovs[lovVar]);
    });

    // recordCount stays truthful past the 2000 clamp, so this is a real signal.
    var recordCount = body.recordCount != null ? body.recordCount : rows.length;
    var truncated = rows.length < recordCount;
    if (truncated) {
      console.warn('[reportsData] ' + tab + ' truncated: showing ' + rows.length +
                   ' of ' + recordCount + ' rows (server size cap ' + PAGE_SIZE + ')');
    }

    return { rows: rows, recordCount: recordCount, truncated: truncated };
  }

  return {
    PAGE_SIZE:            PAGE_SIZE,
    TAB_META:             TAB_META,
    SUGGESTION_FILTERS:   SUGGESTION_FILTERS,
    suggestionFiltersFor: suggestionFiltersFor,
    WINDOW_PARAMS:        WINDOW_PARAMS,
    windowParams:         windowParams,
    searchConfigPathFor:  searchConfigPathFor,
    buildOptions:         buildOptions,
    loadTab:              loadTab
  };
});
