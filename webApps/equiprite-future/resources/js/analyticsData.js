/**
 * Equipment Analytics — shared data helpers for the SDP-backed analytics page.
 *
 * The four tab grids bind their SDPs directly (live, no cache), so this module
 * is NOT a fetch layer for the lists. It only covers the bits the SDPs can't do
 * themselves: the KPI roll-up and the chart series, both from the live
 * `groupBy` aggregate endpoints, plus the date-window math for Utilization.
 *
 * Endpoints (declared in services/eqp-v1/openapi3.json):
 *   - eqp-v1/getEquipriteV1ViewsYardStock              (list + groupBy=unitStatus|className)
 *   - eqp-v1/getEquipriteV1ViewsPendingApprovalLines   (list + groupBy=lineStatus|className)
 *   - eqp-v1/getEquipriteV1ViewsOnhandQty              (list + groupBy=className w/ qtySum)
 *   - eqp-v1/getEquipriteV1ViewsYardUtilization        (yard×day; fromDate/toDate required)
 *
 * groupBy responses are { data:[ { groupKey, count, qtySum } ] } — groupKey can be null.
 */
define(['resources/js/reportCriterion'], function (reportCriterion) {
  'use strict';

  // Smart-search criterion → params scoped to ONE endpoint. Anything the active
  // tab's endpoint doesn't declare is dropped rather than forwarded, so a search
  // on the Onhand tab can't emit yard-stock's unitStatus (and vice versa).
  var TAB_CRITERION_KEY = {
    'equipment-master':  'yard-stock',
    'equipment-pending': 'pending-approval-lines',
    'onhand':            'onhand-qty',
    'equip-utilization': 'yard-utilization'
  };

  function searchParams(tab, criterion) {
    var key = TAB_CRITERION_KEY[tab];
    return key ? reportCriterion.toUriParams(key, criterion) : {};
  }

  /**
   * Chips per tab. These MUST match the ids in that tab's config file, because
   * the config is what actually decides which chips render: oj-sp-smart-search
   * draws one per filter the loaded config declares, and suggestion-filters is
   * only an ordering hint. A single shared config therefore put Line Status on
   * Stock, Unit Status on Onhand and all three on Utilization — none of which
   * are params of those endpoints, so they filtered nothing.
   *
   * Ids are reused across the files (StatusFilter is unitStatus on Stock,
   * lineStatus on Pending) since only one file is ever loaded.
   *
   * Utilization gets none: its only search param is free-text q, and its window
   * is page-controlled, so a chip there would be inert.
   */
  var SUGGESTION_FILTERS = {
    'equipment-master':  ['AssetGroupFilter', 'ClassFilter', 'StatusFilter', 'TypeFilter', 'YardFilter', 'ProjectFilter'],
    'equipment-pending': ['AssetGroupFilter', 'ClassFilter', 'StatusFilter', 'YardFilter', 'ProjectFilter', 'EquipmentFilter'],
    'onhand':            ['AssetGroupFilter', 'ClassFilter', 'YardFilter', 'EquipmentFilter'],
    'equip-utilization': []
  };


  // ARRAY, not a JSON string: the component's suggestion-filters property is
  // string[] and silently ignored the stringified form.
  function suggestionFiltersFor(tab) {
    return (SUGGESTION_FILTERS[tab] || []).slice();
  }

  /** Path of the tab's own smart-search config, relative to $application.path. */
  function searchConfigPathFor(tab) {
    return 'resources/data/analytics/' +
           (SUGGESTION_FILTERS[tab] ? tab : 'equipment-master') + '.json';
  }

  /**
   * Chip options: distinct values from the tab's own rows, sorted A-Z.
   * Unlike buildSelectOptions this omits the leading { label:'All', value:null }
   * row — that is a dropdown affordance, and as a chip value null is dropped by
   * reportCriterion anyway, so it would render a choice that does nothing.
   */
  function buildChipOptions(rows, field, valueField) {
    var seen = {}, opts = [];
    (rows || []).forEach(function (r) {
      // valueField lets the chip SHOW one field and SEND another — Yard shows
      // the yard name but must send invOrgId, which is what the param takes.
      var v = valueField ? r[valueField] : r[field];
      if (v == null || v === '' || seen[v]) return;
      seen[v] = true;
      opts.push({ label: String(valueField ? r[field] : v), value: v });
    });
    opts.sort(function (a, b) { return a.label.localeCompare(b.label); });
    return opts;
  }

  /** Stable signature of the criterion for a tab's endpoint (refetch guard). */
  function searchSignature(tab, criterion) {
    var key = TAB_CRITERION_KEY[tab];
    return key ? reportCriterion.signature(key, criterion) : '';
  }

  function pct(part, whole) {
    return whole > 0 ? Math.round((part / whole) * 100) : 0;
  }

  // The equipment-manager's actionable line statuses on the Pending Approval
  // tab. Matches the pending-approval-lines view's built-in default queue.
  // Drives both the Line Status dropdown and the Line-Status-Mix donut so the
  // grid, filter, and chart all show the same set (no Deployed/Returned/etc.).
  var ACTIONABLE_LINE_STATUSES = ['IN_PROCESS', 'ALLOCATED', 'PICK_INITIATED', 'SHIP_TO_SITE'];

  // ── Date Period preset → { fromDate, toDate } ISO (yyyy-mm-dd) ──
  // Utilization requires a window. Returns a real window for every preset.
  //
  // 'custom' returns the caller's own dates untouched. They come from
  // oj-input-date, which already yields a local yyyy-mm-dd string — deliberately
  // NOT re-crossed through Date, because the preset branches below use
  // toISOString() (UTC) and would shift a user west of UTC back by a day.
  // Falls back to the 30-day window if either custom date is missing, so the
  // required fromDate/toDate are never blank.
  function periodToWindow(preset, now, customFrom, customTo) {
    var today = now || new Date();
    var iso = function (d) { return d.toISOString().slice(0, 10); };

    if (preset === 'custom') {
      var cf = customFrom ? String(customFrom).slice(0, 10) : '';
      var ct = customTo   ? String(customTo).slice(0, 10)   : '';
      if (cf && ct) {
        // Tolerate a reversed pair rather than sending an empty window.
        return cf <= ct ? { fromDate: cf, toDate: ct } : { fromDate: ct, toDate: cf };
      }
      preset = 'last-30';
    }

    var start;
    switch (preset) {
      case 'last-90':
        start = new Date(today); start.setDate(start.getDate() - 90); break;
      case 'ytd':
        start = new Date(today.getFullYear(), 0, 1); break;
      case 'last-30':
      default:
        start = new Date(today); start.setDate(start.getDate() - 30); break;
    }
    return { fromDate: iso(start), toDate: iso(today) };
  }

  // ── ONE call to yard-stock?groupBy=unitStatus, three derivations ──
  // The unit-status group counts feed the KPI tiles, the Status-filter
  // dropdown options, AND the Stock/Utilization donut. Fetch them once here
  // and derive all three, so a Stock-tab load makes a single unitStatus call
  // instead of three identical ones.
  async function fetchUnitStatusGroups(context, Actions, invOrgId) {
    var uriParams = { groupBy: 'unitStatus' };
    var yp = yardParam(invOrgId);
    if (yp !== undefined) uriParams.invOrgId = yp;
    var resp = await Actions.callRest(context, {
      endpoint: 'eqp-v1/getEquipriteV1ViewsYardStock', uriParams: uriParams
    });
    if (!resp || !resp.ok) { console.warn('[analyticsData] unitStatus groups fetch failed'); return []; }
    return (resp.body && Array.isArray(resp.body.data)) ? resp.body.data : [];
  }

  // KPI object from already-fetched unitStatus group rows (no network).
  function kpisFromGroups(rows) {
    var byStatus = {}, total = 0;
    (rows || []).forEach(function (r) {
      var c = Number(r.count || 0);
      byStatus[r.groupKey || 'UNKNOWN'] = (byStatus[r.groupKey || 'UNKNOWN'] || 0) + c;
      total += c;
    });
    var rented = byStatus.RENTED || 0, avail = byStatus.AVAILABLE || 0;
    return {
      totalUnits: total, outOnRent: rented, available: avail,
      utilizationPct: pct(rented, total), outOnRentPct: pct(rented, total), availablePct: pct(avail, total)
    };
  }

  // Status-filter dropdown options from already-fetched group rows (no network).
  function statusOptionsFromGroups(rows) {
    var opts = [{ label: 'All Statuses', value: null }];
    (rows || []).forEach(function (r) {
      if (r.groupKey != null && r.groupKey !== '') {
        opts.push({ label: unitStatusLabel(r.groupKey), value: r.groupKey });
      }
    });
    return opts;
  }

  // Status-mix series from already-fetched group rows (no network).
  // Returns BAR shape: one series whose per-item bars are the statuses
  // (group = status name), so it renders as a labeled bar chart.
  function donutFromGroups(rows) {
    var groups = [];
    var items = [];
    (rows || []).forEach(function (r, i) {
      groups.push(r.groupKey != null ? String(r.groupKey) : '(none)');
      items.push({ value: Number(r.count || 0), color: PALETTE[i % PALETTE.length] });
    });
    return { barSeries: [{ name: 'Count', items: items }], barGroups: groups };
  }

  // KPI roll-up — standalone (its own fetch). Used on tabs that don't already
  // load the unitStatus groups (Pending / Onhand). Stock/Util derive KPIs from
  // the shared fetch in loadActiveTab instead.
  async function fetchKpis(context, Actions, invOrgId) {
    return kpisFromGroups(await fetchUnitStatusGroups(context, Actions, invOrgId));
  }

  // ── Generic groupBy → oj-chart series/groups for a tab's charts ──
  // Returns { series, groups } for a pie/bar. `measure` = 'count' | 'qtySum'.
  var PALETTE = ['#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f','#edc948','#b07aa1','#ff9da7','#9c755f','#499894'];

  // Semantic status colors for the pending-approval Line Status Mix chart.
  var STATUS_COLORS = {
    'IN_PROCESS':     '#f28e2b',  // orange  — actively being processed
    'ALLOCATED':      '#59a14f',  // green   — reserved, ready to confirm
    'PICK_INITIATED': '#4e79a7',  // blue    — pick underway
    'SHIP_TO_SITE':   '#76b7b2'   // teal    — en-route to site
  };

  async function fetchGroupSeries(context, Actions, endpoint, uriParams, measure) {
    var resp = await Actions.callRest(context, { endpoint: endpoint, uriParams: uriParams });
    if (!resp || !resp.ok) return { series: [], groups: [] };
    var rows = (resp.body && Array.isArray(resp.body.data)) ? resp.body.data : [];
    var m = measure || 'count';
    var groups = [];
    var items = [];
    rows.forEach(function (r, i) {
      groups.push(r.groupKey != null ? String(r.groupKey) : '(none)');
      items.push({ value: Number(r[m] || 0), color: PALETTE[i % PALETTE.length] });
    });
    // Pie wants one series per slice; bar wants one series with per-item colors.
    var pieSeries = rows.map(function (r, i) {
      return { name: r.groupKey != null ? String(r.groupKey) : '(none)', items: [Number(r[m] || 0)], color: PALETTE[i % PALETTE.length] };
    });
    return { series: items, groups: groups, pieSeries: pieSeries, pieGroups: ['Mix'] };
  }

  // ── Unit-status friendly label (NOT line status — this is the physical
  // unit_status: AVAILABLE/RENTED/IN_MAINTENANCE/...). Title-cases the token. ──
  function unitStatusLabel(code) {
    if (code == null || code === '') return '';
    return String(code).toLowerCase().replace(/_/g, ' ')
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  // Standalone Status-options fetch (own network call) — kept for any caller
  // that needs it in isolation. The Stock tab does NOT use this; loadActiveTab
  // derives options from the shared fetchUnitStatusGroups call instead.
  async function fetchStatusOptions(context, Actions, invOrgId) {
    return statusOptionsFromGroups(await fetchUnitStatusGroups(context, Actions, invOrgId));
  }

  // ── Live list fetch per tab → snake_case rows the grid providers expect ──
  function ymd(v) { return v ? String(v).slice(0, 10) : ''; }

  function mapStock(r) {
    return {
      equip_class: r.className || '', equip_name: r.equipmentName || '',
      unit_number: r.unitNumber || '', unit_type: r.unitType || '',
      asset_number: r.assetNumber || '', yard: r.invOrgName || '',
      inv_org_id: r.invOrgId != null ? r.invOrgId : '',
      unit_status: r.unitStatus || '', onhand_qty: r.onhandQty,
      project_name: r.projectName || '', start_date: ymd(r.currentStartDate), end_date: ymd(r.currentEndDate)
    };
  }
  function mapPending(r) {
    return {
      req_number: r.requestNumber || '', line_no: r.lineNumber,
      equipment_class: r.className || '', equipment_name: r.equipmentName || '',
      qty: r.quantity, project_name: r.projectName || '', task_name: r.taskName || '',
      requestor: r.requestor || '', start_date: ymd(r.lineStartDate), end_date: ymd(r.lineEndDate),
      line_status: r.lineStatus || '',
      // No unit_type: that chip is gone (this grid has no Unit Type column).
      // invOrgId is present but invOrgName is NOT on this view, so the Yard
      // chip's labels come from the inv-orgs lookup below, not from these rows.
      inv_org_id: r.invOrgId != null ? r.invOrgId : '',
      allocated_serial: r.allocatedSerial || '',
      bill_rate: r.billRate, est_cost: r.estimatedCost
    };
  }
  function mapOnhand(r) {
    return {
      equipment_id: r.equipmentMasterId, equipment_class: r.className || '',
      equipment_name: r.equipmentName || '', yard: r.invOrgName || '',
      inv_org_id: r.invOrgId != null ? r.invOrgId : '',
      inventory_item: r.itemNumber || '', uom: r.uomCode || '', onhand_qty: r.onhandQty
    };
  }

  async function fetchList(context, Actions, endpoint, uriParams, mapFn) {
    var resp = await Actions.callRest(context, { endpoint: endpoint, uriParams: uriParams });
    if (!resp || !resp.ok) { console.warn('[analyticsData] list fetch failed: ' + endpoint); return []; }
    var rows = (resp.body && Array.isArray(resp.body.data)) ? resp.body.data : [];
    return rows.map(mapFn);
  }

  /**
   * invOrgId -> yard name, for the Yard chip's labels.
   *
   * Yard Stock and Onhand rows carry invOrgName, so those tabs label from their
   * own rows. Pending Approval does NOT — it returns invOrgId with no name — so
   * its labels come from here.
   *
   * THE TRAP: the views' invOrgId is inv-orgs' ORGANIZATION_ID, not inv-orgs'
   * own invOrgId column. Matching on the latter silently yields no names
   * (verified: organizationId 300000047274447 -> "Atlanta"; the same value as
   * invOrgId matches nothing).
   *
   * Cached at module scope — the org registry does not change within a session,
   * and this would otherwise refetch on every Pending load.
   */
  var _yardNames = null;
  async function fetchYardNames(context, Actions) {
    if (_yardNames) return _yardNames;
    var resp = await Actions.callRest(context, {
      endpoint: 'eqp-v1/getInvOrgs', uriParams: { page: 0, size: 500 }
    });
    var rows = (resp && resp.ok && resp.body && Array.isArray(resp.body.data)) ? resp.body.data : [];
    _yardNames = {};
    rows.forEach(function (r) {
      if (r.organizationId != null) _yardNames[String(r.organizationId)] = r.organizationName || '';
    });
    return _yardNames;
  }

  /** Yard options from rows that carry only an id, labelled via the lookup. */
  function yardOptionsFromIds(rows, names) {
    var seen = {}, opts = [];
    (rows || []).forEach(function (r) {
      var id = r.inv_org_id;
      if (id == null || id === '' || seen[id]) return;
      seen[id] = true;
      opts.push({ label: names[String(id)] || String(id), value: id });
    });
    opts.sort(function (a, b) { return a.label.localeCompare(b.label); });
    return opts;
  }

  function yardParam(invOrgId) {
    return (invOrgId != null && Number(invOrgId) > 0) ? Number(invOrgId) : undefined;
  }

  // Fetch the active tab's live rows.
  //
  // `size` is the server's real hard maximum (2000 — asking for more is silently
  // clamped, so the old size:10000 was always really 2000).
  //
  // `criterion` is the smart-search filter; it becomes scoped query params so the
  // search runs server-side. The dropdown selections (unitStatus/lineStatus/…)
  // are applied first and win, since they are explicit UI state; a search chip for
  // the same field would otherwise silently override the visible dropdown.
  var PAGE_SIZE = 2000;

  // NB in all three fetchers the explicit argument is applied AFTER the search
  // params, so it wins over a chip of the same name. Those arguments come from
  // selectedUnitStatus/selectedLineStatus/selectedUnitType, which are declared
  // but never assigned today (no drill-down writes them), so nothing overrides a
  // chip in practice. Wiring a KPI drill-down to them would silently beat the
  // chip — merge into the criterion instead (see catalogCriterion.merge).
  function fetchStock(context, Actions, invOrgId, unitStatus, criterion) {
    var p = Object.assign({ size: PAGE_SIZE }, searchParams('equipment-master', criterion));
    if (yardParam(invOrgId) !== undefined) p.invOrgId = yardParam(invOrgId);
    if (unitStatus) p.unitStatus = unitStatus;
    return fetchList(context, Actions, 'eqp-v1/getEquipriteV1ViewsYardStock', p, mapStock);
  }
  function fetchPending(context, Actions, invOrgId, lineStatus, unitType, criterion) {
    var p = Object.assign({ size: PAGE_SIZE }, searchParams('equipment-pending', criterion));
    if (yardParam(invOrgId) !== undefined) p.invOrgId = yardParam(invOrgId);
    if (lineStatus) p.lineStatus = lineStatus;
    if (unitType)   p.unitType = unitType;
    return fetchList(context, Actions, 'eqp-v1/getEquipriteV1ViewsPendingApprovalLines', p, mapPending);
  }
  function fetchOnhand(context, Actions, invOrgId, criterion) {
    var p = Object.assign({ size: PAGE_SIZE }, searchParams('onhand', criterion));
    if (yardParam(invOrgId) !== undefined) p.invOrgId = yardParam(invOrgId);
    return fetchList(context, Actions, 'eqp-v1/getEquipriteV1ViewsOnhandQty', p, mapOnhand);
  }

  // ── Utilization: flat (yard,day) rows → month/day tree the grid renders ──
  // Pivots metrics into per-yard columns: "<Yard> Fleet | Deployed | Util %".
  // Mirrors the row shape the existing getUtilizationGridProvider consumes.
  function fetchUtilization(context, Actions, invOrgId, lineStatus, unitType, fromDate, toDate, criterion) {
    // fromDate/toDate are the REQUIRED window and are set last so a search chip
    // can never widen or blank them (reportCriterion also maps no dates here).
    var p = Object.assign({ size: PAGE_SIZE }, searchParams('equip-utilization', criterion),
      { fromDate: fromDate, toDate: toDate });
    if (yardParam(invOrgId) !== undefined) p.invOrgId = yardParam(invOrgId);
    if (lineStatus) p.lineStatus = lineStatus;
    if (unitType)   p.unitType = unitType;
    return Actions.callRest(context, { endpoint: 'eqp-v1/getEquipriteV1ViewsYardUtilization', uriParams: p })
      .then(function (resp) {
        if (!resp || !resp.ok) { console.warn('[analyticsData] utilization fetch failed'); return []; }
        return (resp.body && Array.isArray(resp.body.data)) ? resp.body.data : [];
      });
  }

  // Build { monthData, dynamicCols } from flat yard-util rows for the pivot grid.
  function buildUtilMonthData(rows) {
    var months = {};   // monthLabel → { Component, id, children:[] , <col>:val }
    var cols = {};     // ordered set of "<Yard> Metric" column keys
    var id = 1;
    function dayLabel(iso) {
      var d = new Date(iso);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    (rows || []).forEach(function (r) {
      var yard = r.yardName || '—';
      var fleetC = yard + ' Fleet', depC = yard + ' Deployed', utilC = yard + ' Util %';
      cols[fleetC] = cols[depC] = cols[utilC] = true;
      if (!months[r.monthLabel]) months[r.monthLabel] = { Component: r.monthLabel, id: id++, children: [] };
      var m = months[r.monthLabel];
      // day row
      var dl = dayLabel(r.dayDate);
      var day = m.children.find(function (c) { return c.Component === dl; });
      if (!day) { day = { id: id++, Component: dl }; m.children.push(day); }
      day[fleetC] = String(r.fleetSize != null ? r.fleetSize : '');
      day[depC]   = String(r.deployedUnits != null ? r.deployedUnits : '');
      day[utilC]  = (r.utilPercent != null ? r.utilPercent : 0) + '%';
      // month-level summary = last seen fleet, summed deployed avg util (simple: max util)
      m[fleetC] = day[fleetC];
      m[depC]   = String(Math.max(parseInt(m[depC] || '0', 10), r.deployedUnits || 0));
      m[utilC]  = (Math.max(parseInt(m[utilC] || '0', 10), r.utilPercent || 0)) + '%';
    });
    Object.keys(months).forEach(function (k) {
      months[k].children.sort(function (a, b) { return new Date(a.Component + ' 2026') - new Date(b.Component + ' 2026'); });
    });
    return { monthData: Object.keys(months).map(function (k) { return months[k]; }), dynamicCols: Object.keys(cols) };
  }

  // ── Per-tab charts via groupBy (donut + bar). Sets chart* page vars. ──
  // `donut` here is BAR-shaped ({ barSeries, barGroups }); the top "mix" chart
  // is now a bar chart, not a pie. chartDonut* vars hold the bar series/groups.
  function setChartVars($page, donut, bar, donutTitle, barTitle) {
    $page.variables.chartDonutSeries = donut.barSeries || [];
    $page.variables.chartDonutGroups = donut.barGroups || [];
    $page.variables.chartBarSeries   = bar.series && bar.series.length ? [{ name: barTitle, items: bar.series }] : [];
    $page.variables.chartBarGroups   = bar.groups || [];
    $page.variables.chartDonutTitle  = donutTitle;
    $page.variables.chartBarTitle    = barTitle;
  }

  // From a fetchGroupSeries result, keep only the actionable line statuses and
  // return BAR shape (one series, statuses as groups), colored by STATUS_COLORS.
  function filterDonutToActionable(donut) {
    var groups = [];
    var items = [];
    (donut.pieSeries || []).forEach(function (s) {
      if (ACTIONABLE_LINE_STATUSES.indexOf(s.name) === -1) return;
      groups.push(s.name);
      items.push({ value: (s.items && s.items[0]) || 0, color: STATUS_COLORS[s.name] || PALETTE[items.length % PALETTE.length] });
    });
    return { barSeries: [{ name: 'Count', items: items }], barGroups: groups };
  }

  // Build Lines-by-Requestor series from the already-fetched pendingRows.
  // No extra API call needed. Always caps display at TOP_N so the chart stays
  // readable even when the dataset has thousands of requestors.
  // ── Stock tab — client-side computed chart ───────────────────────────────
  // buildStockCharts produces one chart from the already-fetched stockRows:
  //   Fleet Availability by Yard — grouped bar (Available / Rented / Other)
  //   per yard. Combines the geographic and status dimensions in a single view
  //   so a manager can immediately see which yard has idle stock vs. which is
  //   fully deployed — directly actionable for fulfilment decisions.
  var STOCK_YARD_TOP_N = 8;

  // Build LOV options array from a rows array + field name.
  // Produces [{ label:'All', value:null }, ...unique values sorted A-Z].
  function buildSelectOptions(rows, field) {
    var seen = {}, opts = [{ label: 'All', value: null }];
    (rows || []).forEach(function (r) {
      var v = r[field];
      if (v && !seen[v]) { seen[v] = true; opts.push({ label: String(v), value: v }); }
    });
    opts.sort(function (a, b) {
      if (a.value === null) return -1;
      if (b.value === null) return 1;
      return a.label.localeCompare(b.label);
    });
    return opts;
  }

  function buildStockCharts(rows, $page) {
    if (!Array.isArray(rows) || !rows.length) return;

    var yardMap = {};
    rows.forEach(function (r) {
      var yard = (r.yard && r.yard.trim()) || '(Unknown)';
      if (!yardMap[yard]) yardMap[yard] = { available: 0, rented: 0, other: 0, total: 0 };
      var st = (r.unit_status || '').toUpperCase();
      if      (st === 'AVAILABLE')                   { yardMap[yard].available++; }
      else if (st === 'RENTED' || st === 'DEPLOYED') { yardMap[yard].rented++;    }
      else                                            { yardMap[yard].other++;     }
      yardMap[yard].total++;
    });

    var yardEntries = Object.keys(yardMap)
      .map(function (k) { return { label: k, data: yardMap[k] }; })
      .sort(function (a, b) { return b.data.total - a.data.total; })
      .slice(0, STOCK_YARD_TOP_N);

    $page.variables.stockYardStatusGroups = yardEntries.map(function (e) { return e.label; });
    $page.variables.stockYardStatusSeries = [
      { name: 'Available',         items: yardEntries.map(function (e) { return { value: e.data.available, color: '#59a14f' }; }) },
      { name: 'Rented / Deployed', items: yardEntries.map(function (e) { return { value: e.data.rented,    color: '#f28e2b' }; }) },
      { name: 'Other',             items: yardEntries.map(function (e) { return { value: e.data.other,     color: '#94a3b8' }; }) }
    ];
  }

  function buildUtilCharts(rows, $page) {
    if (!Array.isArray(rows) || !rows.length) return;
    var dayMap = {}, dayOrder = [];
    rows.forEach(function (r) {
      var d = r.dayDate || '_';
      if (!dayMap[d]) { dayMap[d] = 0; dayOrder.push(d); }
      dayMap[d] += (r.deployedUnits || 0);
    });
    dayOrder.sort();
    function fmtDay(iso) {
      var p = iso.split('-');
      var mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return p.length === 3 ? mo[parseInt(p[1], 10) - 1] + ' ' + parseInt(p[2], 10) : iso;
    }
    $page.variables.utilDailyGroups = dayOrder.map(fmtDay);
    $page.variables.utilDailySeries = [{
      name: 'Units Deployed',
      color: '#4e79a7',
      items: dayOrder.map(function (d) { return { value: dayMap[d] }; })
    }];
  }

  var PENDING_REQUESTOR_TOP_N = 10;

  function buildPendingCharts(rows, $page) {
    if (!Array.isArray(rows) || !rows.length) return;

    // Lines by Requestor — count per requestor, top N descending, categorical colors
    var reqMap = {};
    rows.forEach(function (r) {
      var req = (r.requestor && r.requestor.trim()) || '(Unknown)';
      reqMap[req] = (reqMap[req] || 0) + 1;
    });
    var reqTotal = Object.keys(reqMap).length;
    var reqEntries = Object.keys(reqMap)
      .map(function (k) { return { label: k, value: reqMap[k] }; })
      .sort(function (a, b) { return b.value - a.value; })
      .slice(0, PENDING_REQUESTOR_TOP_N);

    $page.variables.pendingRequestorSeries = [{
      name: 'Lines',
      items: reqEntries.map(function (e, i) { return { value: e.value, color: PALETTE[i % PALETTE.length] }; })
    }];
    $page.variables.pendingRequestorGroups = reqEntries.map(function (e) { return e.label; });
    $page.variables.pendingRequestorTotal   = reqTotal;
    $page.variables.pendingRequestorSubtitle = reqTotal > PENDING_REQUESTOR_TOP_N
      ? 'Top ' + PENDING_REQUESTOR_TOP_N + ' of ' + reqTotal + ' requestors, by line count'
      : 'By pending line count';
  }

  async function loadCharts($page, context, Actions) {
    var tab = $page.variables.analyticsActiveTab;
    var yard = $page.variables.selectedYard;
    var yp = yardParam(yard);
    var base = {};
    if (yp !== undefined) base.invOrgId = yp;

    if (tab === 'equipment-master') {
      var b1 = await fetchGroupSeries(context, Actions, 'eqp-v1/getEquipriteV1ViewsYardStock', Object.assign({ groupBy: 'className' }, base), 'count');
      $page.variables.chartBarSeries = b1.series && b1.series.length ? [{ name: 'Units by Class', items: b1.series }] : [];
      $page.variables.chartBarGroups = b1.groups || [];
      $page.variables.chartBarTitle  = 'Units by Class';
      buildStockCharts($page.variables.stockRows, $page);
    } else if (tab === 'equip-utilization') {
      buildUtilCharts($page.variables.utilExportRows, $page);
    } else if (tab === 'equipment-pending') {
      // groupBy=lineStatus returns the FULL lifecycle (the view's actionable
      // default queue does not apply to groupBy), so keep only the actionable
      // statuses client-side to match the dropdown + grid.
      var d2 = await fetchGroupSeries(context, Actions, 'eqp-v1/getEquipriteV1ViewsPendingApprovalLines', { groupBy: 'lineStatus' }, 'count');
      d2 = filterDonutToActionable(d2);
      var b2 = await fetchGroupSeries(context, Actions, 'eqp-v1/getEquipriteV1ViewsPendingApprovalLines', Object.assign({ groupBy: 'className' }, base), 'count');
      setChartVars($page, d2, b2, 'Line Status Mix', 'Lines by Class');
      // Cost-by-Project and Lines-by-Requestor are derived from the rows already in
      // memory — no extra API call. pendingRows is set in loadActiveTab before loadCharts.
      buildPendingCharts($page.variables.pendingRows, $page);
    } else if (tab === 'onhand') {
      var d3 = await fetchGroupSeries(context, Actions, 'eqp-v1/getEquipriteV1ViewsOnhandQty', Object.assign({ groupBy: 'className' }, base), 'count');
      var b3 = await fetchGroupSeries(context, Actions, 'eqp-v1/getEquipriteV1ViewsOnhandQty', Object.assign({ groupBy: 'className' }, base), 'qtySum');
      // top "mix" chart is a bar now: reshape d3 (fetchGroupSeries) → bar shape.
      var d3bar = { barSeries: [{ name: 'Count', items: d3.series || [] }], barGroups: d3.groups || [] };
      setChartVars($page, d3bar, b3, 'Items by Class', 'On-Hand Qty by Class');
    }
  }

  /**
   * Load the live rows + charts for whichever tab is active into $page.variables.
   * No-op (leaves mock arrays in place) when useMockData is true.
   */
  async function loadActiveTab($page, context, Actions) {
    if ($page.variables.useMockData) return;

    // Show loading state and wipe all display variables synchronously —
    // this happens before any await so the UI hides stale data immediately.
    $page.variables.isLoading                    = true;
    // NB: the criterion is deliberately NOT cleared here. This function runs on
    // every search too, so clearing would wipe the user's search term the instant
    // they typed it. Tab switches clear it explicitly, in TabChangedChain.
    var criterion = $page.variables.analyticsFilterCriterion;
    // One array per chip id, refilled below from THIS tab's rows.
    $page.variables.analyticsClassOptionsArray   = [];
    $page.variables.analyticsStatusOptionsArray  = [];
    $page.variables.analyticsTypeOptionsArray    = [];
    $page.variables.analyticsYardOptionsArray    = [];
    $page.variables.analyticsProjectOptionsArray   = [];
    $page.variables.analyticsEquipmentOptionsArray = [];

    $page.variables.analyticsSuggestionFilters =
      suggestionFiltersFor($page.variables.analyticsActiveTab);
    $page.variables.chartDonutSeries         = [];
    $page.variables.chartDonutGroups         = [];
    $page.variables.chartDonutTitle          = '';
    $page.variables.chartBarSeries           = [];
    $page.variables.chartBarGroups           = [];
    $page.variables.chartBarTitle            = '';
    $page.variables.stockRows                = [];
    $page.variables.pendingRows              = [];
    $page.variables.onhandRows               = [];
    $page.variables.stockYardStatusSeries    = [];
    $page.variables.stockYardStatusGroups    = [];
    $page.variables.pendingRequestorSeries   = [];
    $page.variables.pendingRequestorGroups   = [];
    $page.variables.monthData                = [];
    $page.variables.dynamicCols              = [];
    // Month keys collapsed under the previous window must not persist into the
    // new one — they no longer refer to the same rows.
    $page.variables.collapsedMonths          = [];
    $page.variables.utilDailySeries          = [];
    $page.variables.utilDailyGroups          = [];
    $page.variables.analyticsKpis            = { totalUnits: 0, outOnRent: 0, available: 0, utilizationPct: 0, outOnRentPct: 0, availablePct: 0 };

    var tab = $page.variables.analyticsActiveTab;
    var yard = $page.variables.selectedYard;
    try {
    if (tab === 'equipment-master') {
      // ONE unitStatus-groups call feeds three things: KPI tiles, the Status
      // dropdown options, and the Status-Mix donut. (The className bar is the
      // only other yard-stock call, in loadCharts.)
      var statusGroups = await fetchUnitStatusGroups(context, Actions, yard);
      $page.variables.analyticsKpis           = kpisFromGroups(statusGroups);
      $page.variables.unitStatusOptionsArray  = statusOptionsFromGroups(statusGroups);
      var donut = donutFromGroups(statusGroups);
      $page.variables.chartDonutSeries = donut.barSeries;
      $page.variables.chartDonutGroups = donut.barGroups;
      $page.variables.chartDonutTitle  = 'Status Mix';
      $page.variables.stockRows = await fetchStock(context, Actions, yard, $page.variables.selectedUnitStatus, criterion);
      $page.variables.analyticsClassOptionsArray  = buildChipOptions($page.variables.stockRows, 'equip_class');
      $page.variables.analyticsStatusOptionsArray = buildChipOptions($page.variables.stockRows, 'unit_status');
      $page.variables.analyticsTypeOptionsArray   = buildChipOptions($page.variables.stockRows, 'unit_type');
      $page.variables.analyticsYardOptionsArray  = buildChipOptions($page.variables.stockRows, 'yard', 'inv_org_id');
      $page.variables.analyticsProjectOptionsArray = buildChipOptions($page.variables.stockRows, 'project_name');
    } else if (tab === 'equipment-pending') {
      $page.variables.analyticsKpis = kpisFromGroups(await fetchUnitStatusGroups(context, Actions, yard));
      $page.variables.pendingRows = await fetchPending(context, Actions, yard, $page.variables.selectedLineStatus, $page.variables.selectedUnitType, criterion);
      $page.variables.analyticsClassOptionsArray  = buildChipOptions($page.variables.pendingRows, 'equipment_class');
      $page.variables.analyticsStatusOptionsArray = buildChipOptions($page.variables.pendingRows, 'line_status');
      $page.variables.analyticsProjectOptionsArray   = buildChipOptions($page.variables.pendingRows, 'project_name');
      // Options ARE populated (project_name/equipment_name are on every row),
      // but pending-approval-lines' endpoint accepts no projectName/
      // equipmentName query param (confirmed against reportCriterion's
      // ENDPOINT_PARAMS) — picking a value here currently filters nothing
      // server-side until that param is added.
      $page.variables.analyticsEquipmentOptionsArray = buildChipOptions($page.variables.pendingRows, 'equipment_name');
      // Roughly half these lines are still unallocated and carry NO yard, so a
      // Yard pick necessarily hides them — the yard is not known until a unit
      // is allocated.
      $page.variables.analyticsYardOptionsArray   = yardOptionsFromIds(
        $page.variables.pendingRows, await fetchYardNames(context, Actions));
      // The rows only cover the view's actionable default queue, so the Line
      // Status options list exactly the statuses this tab is about. An explicit
      // lineStatus would override that queue server-side, but the donut is
      // hard-filtered to the actionable four, so widening here would make the
      // chart disagree with the grid.
    } else if (tab === 'onhand') {
      $page.variables.analyticsKpis = kpisFromGroups(await fetchUnitStatusGroups(context, Actions, yard));
      $page.variables.onhandRows = await fetchOnhand(context, Actions, yard, criterion);
      $page.variables.analyticsClassOptionsArray = buildChipOptions($page.variables.onhandRows, 'equipment_class');
      $page.variables.analyticsYardOptionsArray  = buildChipOptions($page.variables.onhandRows, 'yard', 'inv_org_id');
      // No Project chip on this tab: onhand-qty rows carry no project field
      // at all (confirmed against the view's response schema) — removed
      // rather than shipped empty, unlike Equipment Name which IS present.
      $page.variables.analyticsEquipmentOptionsArray = buildChipOptions($page.variables.onhandRows, 'equipment_name');
    } else if (tab === 'equip-utilization') {
      // Utilization is Yard + Date only — lineStatus/unitType are NOT util
      // filters (lineStatus filters only the numerator = misleading ratio).
      // Pass null so a value left over from the Pending tab can't scope it.
      var rows = await fetchUtilization(context, Actions, yard, null, null,
        $page.variables.utilFromDate, $page.variables.utilToDate, criterion);
      var built = buildUtilMonthData(rows);
      $page.variables.monthData   = built.monthData;
      $page.variables.dynamicCols = built.dynamicCols;
      $page.variables.utilExportRows = rows; // flat per-(yard,day) for CSV export
      // Util donut + KPIs reuse the unit-status mix (one shared call).
      var ug = await fetchUnitStatusGroups(context, Actions, yard);
      $page.variables.analyticsKpis = kpisFromGroups(ug);
      var ud = donutFromGroups(ug);
      $page.variables.chartDonutSeries = ud.barSeries;
      $page.variables.chartDonutGroups = ud.barGroups;
      $page.variables.chartDonutTitle  = 'Status Mix';
    }
    await loadCharts($page, context, Actions);
    } finally {
      $page.variables.isLoading = false;
    }
  }

  return {
    PAGE_SIZE:            PAGE_SIZE,
    suggestionFiltersFor: suggestionFiltersFor,
    searchSignature:      searchSignature,
    searchParams:         searchParams,
    periodToWindow:  periodToWindow,
    fetchKpis:       fetchKpis,
    fetchGroupSeries: fetchGroupSeries,
    fetchStock:      fetchStock,
    fetchPending:    fetchPending,
    fetchOnhand:     fetchOnhand,
    fetchUtilization: fetchUtilization,
    buildUtilMonthData: buildUtilMonthData,
    buildStockCharts:   buildStockCharts,
    buildPendingCharts: buildPendingCharts,
    buildUtilCharts:    buildUtilCharts,
    fetchStatusOptions: fetchStatusOptions,
    unitStatusLabel: unitStatusLabel,
    loadCharts:      loadCharts,
    loadActiveTab:   loadActiveTab,
    searchConfigPathFor: searchConfigPathFor,
    buildChipOptions:    buildChipOptions,
    fetchYardNames:      fetchYardNames,
    yardOptionsFromIds:  yardOptionsFromIds
  };
});
