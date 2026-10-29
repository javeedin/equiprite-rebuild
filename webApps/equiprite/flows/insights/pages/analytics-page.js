define([
  'resources/js/lineStatusLabels',
  'resources/js/analyticsData',
  'ojs/ojarraydataprovider'
], (lineStatusLabels, analyticsData, ArrayDataProvider) => {
  'use strict';

  // Analytics (FDD 7.15; wireframe Analytics). One report library by role:
  //   - the four reports of the old Equipment Analytics page run here, on the same views, with the same
  //     aggregation (resources/js/analyticsData.js, copied unchanged, does every fetch and every chart number);
  //   - the six reports of the old Equipment Reports page open there (EQR_REPORTS);
  //   - Integration errors (RPT-17) opens Integration health.
  // Nothing on this page writes. Everything here is display: labels, the library, the insight line, the table rows.

  // The old page's four tabs, by the ids analyticsData keys on. `statusField` is the criterion field the endpoint
  // takes for that tab's Status chips (reportCriterion.ENDPOINT_PARAMS); null = no status chip.
  const LIVE = [
    { id: 'equipment-master', label: 'Fleet stock', rpt: 'RPT-01', group: 'fleet', statusField: 'unitStatus',
      desc: 'Every unit with its yard, status and current project.', old: 'Equipment Stock' },
    { id: 'equipment-pending', label: 'Approvals in progress', rpt: 'RPT-02', group: 'requests', statusField: 'lineStatus',
      desc: 'Request lines the equipment manager is moving: in process, allocated, picking, shipping.', old: 'Equipment Manager Pending Approval' },
    { id: 'onhand', label: 'On-hand stock', rpt: 'RPT-01', group: 'fleet', statusField: null,
      desc: 'Bulk and consumable quantities by item and yard.', old: 'Equipment Onhand Quantity' },
    { id: 'equip-utilization', label: 'Utilization', rpt: 'RPT-03', group: 'fleet', statusField: null,
      desc: 'Units deployed per day and per yard over a period.', old: 'Equipment Utilization' },
  ];
  const LIVE_BY_ID = {};
  LIVE.forEach((r) => { LIVE_BY_ID[r.id] = r; });

  // The old Equipment Reports page (EQR_REPORTS), not rebuilt here: each entry opens that page in Old EquipRite.
  const OLD_REPORTS = [
    { id: 'equip-history', label: 'Equipment history', rpt: '', group: 'fleet', desc: 'Allocations of each unit over time.' },
    { id: 'rental-requests', label: 'Rental requests', rpt: '', group: 'requests', desc: 'Request lines with procurement status.' },
    { id: 'proj-cost-detail', label: 'Project cost detail', rpt: 'RPT-05', group: 'cost', desc: 'Cost per request line, posted or not.' },
    { id: 'rate-exceptions', label: 'Rate exceptions', rpt: '', group: 'cost', desc: 'Units whose rate resolves to zero.' },
    { id: 'rate-schedule-rpt', label: 'Rate schedules', rpt: 'RPT-07', group: 'cost', desc: 'Rate lines by class, period and threshold.' },
    { id: 'agreement-expiry', label: 'Agreement expiry', rpt: 'RPT-16', group: 'cost', desc: 'Agreements ending soon, with what is still out.' },
  ];

  // In the wireframe, not backed by any view yet (services/eqp-v1 has no downtime or revenue report).
  const NOT_YET = [
    { rpt: 'RPT-20', label: 'Utilization vs revenue' },
    { rpt: 'RPT-19', label: 'Downtime analysis' },
  ];

  const GROUPS = [
    { key: 'fleet', label: 'Fleet & operations' },
    { key: 'requests', label: 'Requests & approvals' },
    { key: 'cost', label: 'Cost & rates' },
    { key: 'system', label: 'System' },
  ];

  // Column headers are the old grids' (equipment-analytics-page.js STOCK_COLS / PENDING_COLS / ONHAND_COLS), so a
  // CSV exported from either app reads the same. oj-table sizes columns from width / minWidth.
  const COLUMNS = {
    'equipment-master': [
      ['Equipment Class', 'equip_class', 130], ['Equipment Name', 'equip_name', 200], ['Unit / Serial #', 'unit_number', 140],
      ['Unit Type', 'unit_type', 100], ['Asset #', 'asset_number', 110], ['Yard', 'yard', 120], ['Status', 'unit_status_label', 120],
      ['On-Hand Qty', 'onhand_qty', 100, true], ['Current Project', 'project_name', 180], ['Start', 'start_date', 100], ['End', 'end_date', 100],
    ],
    'equipment-pending': [
      ['Req #', 'req_number', 140], ['Line #', 'line_no', 70, true], ['Equipment Class', 'equipment_class', 130],
      ['Equipment Name', 'equipment_name', 190], ['Qty', 'qty', 60, true], ['Project', 'project_name', 170], ['Task', 'task_name', 150],
      ['Requestor', 'requestor', 140], ['Start', 'start_date', 100], ['End', 'end_date', 100], ['Line Status', 'line_status_label', 140],
      ['Allocated Serial', 'allocated_serial', 160], ['Rate', 'bill_rate_text', 100, true], ['Est Cost', 'est_cost_text', 110, true],
    ],
    'onhand': [
      ['Equipment ID', 'equipment_id', 110, true], ['Equipment Class', 'equipment_class', 140], ['Equipment Name', 'equipment_name', 220],
      ['Yard', 'yard', 130], ['Inventory Item', 'inventory_item', 160], ['UOM', 'uom', 70], ['On-Hand Qty', 'onhand_qty', 110, true],
    ],
  };

  // The old page's charts per report, bound to the page variables analyticsData fills (series / groups name
  // them). `labels` turns status codes into words; the numbers are untouched. The old Stock tab fetched Units by
  // class without showing it, and the old Utilization tab set the status mix without showing it; both are shown.
  const CHARTS = {
    'equipment-master': [
      { key: 'mix', title: 'Fleet status mix', sub: 'Units by status, whole fleet', series: 'chartDonutSeries', groups: 'chartDonutGroups', labels: 'unit', orientation: 'vertical', height: 220, legend: 'off' },
      { key: 'yard', title: 'Availability by yard', sub: 'Available, on rent and other units in the largest 8 yards (follows the filters)', series: 'stockYardStatusSeries', groups: 'stockYardStatusGroups', orientation: 'vertical', height: 300, legend: 'on' },
      { key: 'class', title: 'Units by class', sub: 'Whole fleet', series: 'chartBarSeries', groups: 'chartBarGroups', orientation: 'horizontal', height: 300, legend: 'off' },
    ],
    'equipment-pending': [
      { key: 'mix', title: 'Line status mix', sub: 'Lines at each stage, every yard', series: 'chartDonutSeries', groups: 'chartDonutGroups', labels: 'line', orientation: 'vertical', height: 220, legend: 'off' },
      { key: 'req', title: 'Lines by requestor', subVar: 'pendingRequestorSubtitle', series: 'pendingRequestorSeries', groups: 'pendingRequestorGroups', orientation: 'horizontal', height: 300, legend: 'off' },
      { key: 'class', title: 'Lines by class', sub: 'Lines per equipment class', series: 'chartBarSeries', groups: 'chartBarGroups', orientation: 'horizontal', height: 300, legend: 'off' },
    ],
    'onhand': [
      { key: 'items', title: 'Items by class', sub: 'Stocked items per class', series: 'chartDonutSeries', groups: 'chartDonutGroups', orientation: 'vertical', height: 240, legend: 'off' },
      { key: 'qty', title: 'On-hand quantity by class', sub: 'Total quantity per class', series: 'chartBarSeries', groups: 'chartBarGroups', orientation: 'vertical', height: 300, legend: 'off' },
    ],
    'equip-utilization': [
      { key: 'daily', title: 'Units deployed per day', sub: 'Total units out on rent each day', series: 'utilDailySeries', groups: 'utilDailyGroups', orientation: 'vertical', height: 280, legend: 'off', wide: true },
      { key: 'mix', title: 'Fleet status mix', sub: 'Units by status today, whole fleet', series: 'chartDonutSeries', groups: 'chartDonutGroups', labels: 'unit', orientation: 'vertical', height: 220, legend: 'off' },
    ],
  };

  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function num(v) {
    const n = Number(v);
    return isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '';
  }
  function money(v) {
    if (v === null || v === undefined || v === '') return '';
    const n = Number(v);
    return isFinite(n) ? '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : String(v);
  }
  function plural(n, one, many) {
    return num(n) + ' ' + (Number(n) === 1 ? one : (many || one + 's'));
  }
  function seriesValues(series) {
    const s = Array.isArray(series) && series[0];
    return s && Array.isArray(s.items) ? s.items.map((i) => Number(i && typeof i === 'object' ? i.value : i) || 0) : [];
  }

  class PageModule {
    /** The four live reports, for the switcher. */
    liveReports() {
      return LIVE.slice();
    }

    report(tab) {
      return LIVE_BY_ID[tab] || LIVE[0];
    }

    /**
     * The library for this role: live reports when it holds EQR_ANALYTICS, the old Reports page's when it holds
     * EQR_REPORTS, Integration errors when it can open Integration health. Groups with nothing in them are dropped.
     * @returns {Array<{key,label,items:Array<{id,label,rpt,desc,kind:'live'|'old'|'nav'}>}>}
     */
    library(canAnalytics, canReports, canIntegration) {
      const items = [];
      if (canAnalytics) LIVE.forEach((r) => items.push(Object.assign({ kind: 'live' }, r)));
      if (canReports) OLD_REPORTS.forEach((r) => items.push(Object.assign({ kind: 'old' }, r)));
      if (canIntegration) {
        items.push({ kind: 'nav', id: 'integration-health', label: 'Integration errors', rpt: 'RPT-17', group: 'system',
          desc: 'Failed calls to Fusion and the exception queue, on Integration health.' });
      }
      return GROUPS.map((g) => ({ key: g.key, label: g.label, items: items.filter((i) => i.group === g.key) }))
        .filter((g) => g.items.length);
    }

    libraryCount(canAnalytics, canReports, canIntegration) {
      return this.library(canAnalytics, canReports, canIntegration).reduce((n, g) => n + g.items.length, 0);
    }

    notYet() {
      return NOT_YET.slice();
    }

    /** Old EquipRite's Reports page (same vp/shell/<flow>/<page> shape as the app's oldAppLink). */
    oldReportsLink(oldAppUrl) {
      if (!oldAppUrl) return '';
      const base = oldAppUrl.endsWith('/') ? oldAppUrl : oldAppUrl + '/';
      return base + 'vp/shell/equipment-foundation/equipment-reports';
    }

    // ── Filters ────────────────────────────────────────────────────────

    /** Chip groups a report offers: only fields its endpoint takes (reportCriterion.ENDPOINT_PARAMS). */
    filtersFor(tab) {
      if (tab === 'equip-utilization') return [];
      const out = [{ field: 'className', label: 'Class' }];
      const st = this.report(tab).statusField;
      if (st) out.push({ field: st, label: 'Status' });
      out.push({ field: 'invOrgId', label: 'Yard' });
      return out;
    }

    /**
     * Search text and chip picks -> the criterion shape the old smart search produced, which
     * analyticsData.searchParams (reportCriterion.toUriParams) turns into the endpoint's params.
     * Keyword { text, matchBy } -> q; chip { op:'$eq', value:{ field: v } } -> field. null when empty.
     */
    criterion(text, picks) {
      const nodes = [];
      const t = String(text || '').trim();
      if (t) nodes.push({ text: t, matchBy: 'phrase' });
      Object.keys(picks || {}).sort().forEach((f) => {
        const v = picks[f];
        if (v === null || v === undefined || v === '') return;
        const value = {};
        value[f] = v;
        nodes.push({ op: '$eq', value });
      });
      if (!nodes.length) return null;
      if (nodes.length === 1) return nodes[0];
      return { $tag: '_root_', op: '$and', criteria: nodes };
    }

    /** Chip options captured from the unfiltered load, per field: [{ label, value }]. */
    chipOptions(tab, v) {
      const out = { className: (v.analyticsClassOptionsArray || []).slice(), invOrgId: (v.analyticsYardOptionsArray || []).slice() };
      const st = this.report(tab).statusField;
      if (st) out[st] = (v.analyticsStatusOptionsArray || []).slice();
      return out;
    }

    chipLabel(tab, field, opt) {
      const raw = opt && opt.label != null ? opt.label : '';
      if (field === 'unitStatus') return analyticsData.unitStatusLabel(raw);
      if (field === 'lineStatus') return lineStatusLabels.formatLineStatus(raw);
      return String(raw);
    }

    isPicked(picks, field, value) {
      return !!picks && picks[field] !== undefined && picks[field] !== null && String(picks[field]) === String(value);
    }

    periodOptions() {
      return [
        { value: 'last-30', label: 'Last 30 days' },
        { value: 'last-90', label: 'Last 90 days' },
        { value: 'ytd', label: 'Year to date' },
        { value: 'custom', label: 'Custom' },
      ];
    }

    /** "1 Oct – 29 Oct 2026" from two yyyy-mm-dd dates. */
    periodText(from, to) {
      const p = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? { y: m[1], m: Number(m[2]) - 1, d: Number(m[3]) } : null; };
      const a = p(from);
      const b = p(to);
      if (!a || !b) return '';
      return `${a.d} ${MON[a.m]}${a.y !== b.y ? ' ' + a.y : ''} – ${b.d} ${MON[b.m]} ${b.y}`;
    }

    // ── The one number, then the chart ─────────────────────────────────

    /**
     * Headline for a report: { value, label, sentence }. Built only from numbers the page already holds (the
     * analyticsData KPIs, rows and chart series), so it can never disagree with the charts below it.
     */
    insight(tab, kpis, d) {
      const k = kpis || {};
      const x = d || {};
      if (tab === 'equipment-pending') {
        const rows = x.pendingRows || [];
        const groups = x.pendingRequestorGroups || [];
        const vals = seriesValues(x.pendingRequestorSeries);
        const parts = (x.chartDonutGroups || []).map((g, i) => `${num(seriesValues(x.chartDonutSeries)[i])} ${lineStatusLabels.formatLineStatus(g).toLowerCase()}`);
        return {
          value: num(rows.length),
          label: rows.length === 1 ? 'line in progress' : 'lines in progress',
          sentence: (parts.length ? 'Across every yard: ' + parts.join(', ') + '. ' : '')
            + (groups.length ? `Most are for ${groups[0]} (${plural(vals[0], 'line')}).` : ''),
        };
      }
      if (tab === 'onhand') {
        const rows = x.onhandRows || [];
        const total = rows.reduce((n, r) => n + (Number(r.onhand_qty) || 0), 0);
        const yards = {};
        rows.forEach((r) => { if (r.yard) yards[r.yard] = true; });
        const qty = seriesValues(x.chartBarSeries);
        const groups = (x.chartBarSeries && x.chartBarSeries.length) ? (x.chartBarGroups || []) : [];
        let top = -1;
        qty.forEach((q, i) => { if (top < 0 || q > qty[top]) top = i; });
        return {
          value: num(total),
          label: 'on hand',
          sentence: `${plural(rows.length, 'item')} in ${plural(Object.keys(yards).length, 'yard')}.`
            + (top >= 0 && groups[top] ? ` Most stock: ${groups[top]} (${num(qty[top])}).` : ''),
        };
      }
      if (tab === 'equip-utilization') {
        const vals = seriesValues(x.utilDailySeries);
        const days = x.utilDailyGroups || [];
        if (!vals.length) {
          return { value: '0', label: 'units deployed', sentence: 'No utilization recorded for this period.' };
        }
        let peak = 0;
        vals.forEach((v, i) => { if (v > vals[peak]) peak = i; });
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        return {
          value: num(vals[peak]),
          label: 'units deployed on the busiest day',
          sentence: `Busiest day: ${days[peak] || ''}. On average ${num(Math.round(avg * 10) / 10)} a day over ${plural(vals.length, 'day')}.`,
        };
      }
      // Fleet stock: what is free to send out, by the same AVAILABLE rule as buildStockCharts' yard chart.
      const rows = x.stockRows || [];
      const byYard = {};
      let free = 0;
      rows.forEach((r) => {
        if (String(r.unit_status || '').toUpperCase() !== 'AVAILABLE') return;
        free++;
        const y = (r.yard && String(r.yard).trim()) || '(Unknown)';
        byYard[y] = (byYard[y] || 0) + 1;
      });
      let topYard = '';
      Object.keys(byYard).forEach((y) => { if (!topYard || byYard[y] > byYard[topYard]) topYard = y; });
      return {
        value: num(free),
        label: free === 1 ? 'unit free to send out' : 'units free to send out',
        sentence: rows.length
          ? `${num(free)} of the ${plural(rows.length, 'unit')} listed ${free === 1 ? 'is' : 'are'} available`
            + (topYard ? `; most are in ${topYard} (${num(byYard[topYard])}).` : '.')
            + ` Fleet-wide, ${num(k.outOnRent || 0)} of ${num(k.totalUnits || 0)} are on rent.`
          : 'No units match these filters.',
      };
    }

    /** The charts a report shows, in order (static definitions; the data comes from the named page variables). */
    charts(tab) {
      return (CHARTS[tab] || []).map((c) => Object.assign({}, c));
    }

    /** Status codes as words on the status-mix charts; other charts keep their labels. */
    chartGroups(groups, kind) {
      const g = Array.isArray(groups) ? groups : [];
      if (kind === 'unit') return g.map((c) => analyticsData.unitStatusLabel(c) || c);
      if (kind === 'line') return g.map((c) => lineStatusLabels.formatLineStatus(c) || c);
      return g;
    }

    /** One-line description of a chart for screen readers: "Title: A 3, B 5." (first 10 bars per series). */
    chartSummary(title, series, groups) {
      const s = Array.isArray(series) ? series : [];
      const g = Array.isArray(groups) ? groups : [];
      if (!s.length || !g.length) return title + ': no data.';
      const parts = s.map((one) => {
        const vals = (one.items || []).map((i) => (i && typeof i === 'object' ? i.value : i));
        const pairs = g.slice(0, 10).map((label, i) => `${label} ${num(vals[i] || 0)}`).join(', ');
        return (s.length > 1 ? one.name + ': ' : '') + pairs;
      });
      return title + ': ' + parts.join('; ') + '.';
    }

    /** Rows for a chart's "Show the numbers" table: [{ label, values: [..] }], one value per series. */
    chartTable(series, groups) {
      const s = Array.isArray(series) ? series : [];
      return (Array.isArray(groups) ? groups : []).map((label, i) => ({
        label: String(label),
        values: s.map((one) => {
          const it = (one.items || [])[i];
          return num(it && typeof it === 'object' ? it.value : it);
        }),
      }));
    }

    seriesNames(series) {
      return (Array.isArray(series) ? series : []).map((s) => s.name || '');
    }

    hasData(series) {
      return Array.isArray(series) && series.some((s) => (s.items || []).length > 0);
    }

    // ── Tables ─────────────────────────────────────────────────────────

    columns(tab) {
      return (COLUMNS[tab] || []).map(([headerText, field, w, right]) => (Object.assign(
        { headerText, field, sortable: 'enabled', minWidth: w },
        right ? { className: 'er-num', headerClassName: 'er-num' } : {})));
    }

    /**
     * A new data provider per set of rows. The table is rebuilt on every load, and a provider shared between the
     * old and the new table would refresh the removed one too ("Aborting stale fetch").
     */
    rowsDP(rows) {
      return new ArrayDataProvider(rows || [], { keyAttributes: '_key' });
    }

    /** Rows the table shows: the analyticsData rows plus display fields (dates, labels, money). */
    displayRows(tab, d) {
      const x = d || {};
      const self = this;
      if (tab === 'equipment-pending') {
        return (x.pendingRows || []).map((r, i) => Object.assign({ _key: i }, r, {
          start_date: self.formatDate(r.start_date), end_date: self.formatDate(r.end_date),
          line_status_label: lineStatusLabels.formatLineStatus(r.line_status),
          bill_rate_text: money(r.bill_rate), est_cost_text: money(r.est_cost),
        }));
      }
      if (tab === 'onhand') {
        return (x.onhandRows || []).map((r, i) => Object.assign({ _key: i }, r));
      }
      if (tab === 'equipment-master') {
        return (x.stockRows || []).map((r, i) => Object.assign({ _key: i }, r, {
          start_date: self.formatDate(r.start_date), end_date: self.formatDate(r.end_date),
          unit_status_label: analyticsData.unitStatusLabel(r.unit_status),
        }));
      }
      return [];
    }

    /**
     * The table's height: its rows, up to 520px, then it scrolls. oj-table with a scroll policy needs a height,
     * and a fixed one would leave a short report in a tall empty box.
     */
    tableStyle(count) {
      const n = Math.max(Number(count) || 0, 3);
      return { width: '100%', height: Math.min(520, 64 + n * 48) + 'px' };
    }

    /** The views cap a page at 2000 rows (analyticsData.PAGE_SIZE); say so when a report hits it. */
    rowNote(count) {
      const n = Number(count) || 0;
      if (n >= analyticsData.PAGE_SIZE) {
        return `Showing the first ${num(n)} rows, the most the report returns at once. Search or pick a chip to narrow it.`;
      }
      return plural(n, 'row');
    }

    // ── Utilization pivot (analyticsData.buildUtilMonthData: month rows with day rows, 3 columns per yard) ──

    utilYards(dynamicCols) {
      const out = [];
      (dynamicCols || []).forEach((c) => {
        const y = String(c).replace(/ (Fleet|Deployed|Util %)$/, '');
        if (out.indexOf(y) === -1) out.push(y);
      });
      return out;
    }

    /** Row layout for the pivot grid, as an object (:style binds an object of style properties). */
    utilGridStyle(dynamicCols) {
      const n = (dynamicCols || []).length;
      return { gridTemplateColumns: `minmax(110px, 1.1fr) repeat(${n}, minmax(76px, 1fr))`, minWidth: `${150 + n * 84}px` };
    }

    utilHeads(dynamicCols) {
      return (dynamicCols || []).map((c) => {
        const m = / (Fleet|Deployed|Util %)$/.exec(String(c));
        return { key: c, yard: String(c).replace(/ (Fleet|Deployed|Util %)$/, ''), metric: m ? (m[1] === 'Util %' ? 'Util.' : m[1]) : c };
      });
    }

    /** Flat rows for the pivot grid: each month, then its days unless the month is collapsed. */
    utilRows(monthData, dynamicCols, collapsed) {
      const cols = dynamicCols || [];
      const shut = collapsed || [];
      const out = [];
      (monthData || []).forEach((m) => {
        const open = shut.indexOf(m.Component) < 0;
        out.push({ key: 'm:' + m.Component, label: m.Component, isMonth: true, monthKey: m.Component, open,
          cells: cols.map((c) => (m[c] != null ? String(m[c]) : '')) });
        if (open) {
          (m.children || []).forEach((d) => {
            out.push({ key: 'd:' + m.Component + ':' + d.Component, label: d.Component, isMonth: false, monthKey: m.Component, open: false,
              cells: cols.map((c) => (d[c] != null ? String(d[c]) : '')) });
          });
        }
      });
      return out;
    }

    /** Copied unchanged from the old page module (equipment-analytics-page.js toggleUtilMonth). */
    toggleUtilMonth(currentCollapsed, monthKey) {
      var arr = (currentCollapsed || []).slice();
      var idx = arr.indexOf(monthKey);
      if (idx >= 0) arr.splice(idx, 1); else arr.push(monthKey);
      return arr;
    }

    /** Copied unchanged from the old page module (equipment-analytics-page.js formatDate): M/D/YYYY. */
    formatDate(val) {
      if (!val) return '';
      var s = String(val).substring(0, 10);
      var p = s.split('-');
      if (p.length !== 3) return s;
      return parseInt(p[1], 10) + '/' + parseInt(p[2], 10) + '/' + p[0];
    }

    // Copied unchanged from the old page module (equipment-analytics-page.js exportCSV), so the file a person
    // downloads has the same columns, labels and file name in both apps. `data` = { stock, pending, onhand, util }.
    exportCSV(activeTab, data) {
      var self = this;
      data = data || {};
      var headers, rows, filename;

      if (activeTab === 'equipment-master') {
        headers  = ['Equipment Class', 'Equipment Name', 'Unit / Serial #', 'Unit Type', 'Asset #', 'Yard', 'Status', 'On-Hand Qty', 'Current Project', 'Start', 'End'];
        rows     = (data.stock || []).map(function (r) {
          return [r.equip_class, r.equip_name, r.unit_number, r.unit_type, r.asset_number,
                  (r.yard || r.location), r.unit_status, r.onhand_qty, r.project_name,
                  self.formatDate(r.start_date), self.formatDate(r.end_date)];
        });
        filename = 'Equipment_Stock.csv';
      } else if (activeTab === 'equipment-pending') {
        headers  = ['Req #', 'Line #', 'Equipment Class', 'Equipment Name', 'Qty', 'Project', 'Task', 'Requestor', 'Start', 'End', 'Request Line Status', 'Allocated Serial', 'Rate', 'Est Cost'];
        rows     = (data.pending || []).map(function (r) {
          return [r.req_number, r.line_no, r.equipment_class, r.equipment_name, r.qty,
                  r.project_name, r.task_name, r.requestor,
                  self.formatDate(r.start_date), self.formatDate(r.end_date),
                  lineStatusLabels.formatLineStatus(r.line_status),
                  r.allocated_serial, r.bill_rate, r.est_cost];
        });
        filename = 'Equipment_Manager_Pending_Approval.csv';
      } else if (activeTab === 'onhand') {
        headers  = ['Equipment ID', 'Equipment Class', 'Equipment Name', 'Yard', 'Inventory Item', 'UOM', 'On-Hand Qty'];
        rows     = (data.onhand || []).map(function (r) {
          return [r.equipment_id, r.equipment_class, r.equipment_name,
                  (r.yard || r.location), r.inventory_item, r.uom, r.onhand_qty];
        });
        filename = 'Equipment_Onhand_Quantity.csv';
      } else { // equip-utilization — flat per-(yard, day) rows
        headers  = ['Yard', 'Date', 'Month', 'Fleet Size', 'Deployed Units', 'Utilization %', 'Used Hours'];
        rows     = (data.util || []).map(function (r) {
          return [r.yardName, self.formatDate(r.dayDate), r.monthLabel,
                  r.fleetSize, r.deployedUnits, r.utilPercent, r.usedHours];
        });
        filename = 'Equipment_Utilization.csv';
      }

      var escape = function (v) {
        var s = v == null ? '' : String(v);
        if (s.search(/[,"\n\r]/) !== -1) { s = '"' + s.replace(/"/g, '""') + '"'; }
        return s;
      };

      var lines = [headers.map(escape).join(',')];
      rows.forEach(function (row) { lines.push(row.map(escape).join(',')); });

      var blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
      var url  = URL.createObjectURL(blob);
      var a    = document.createElement('a');
      a.href        = url;
      a.download    = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    /** Plain-language load failure from the calls that failed: [{ endpoint, status }]. */
    loadErrorText(failed) {
      const f = Array.isArray(failed) ? failed : [];
      if (!f.length) return '';
      const codes = f.map((x) => x.status).filter((s) => s);
      const auth = codes.some((s) => s === 401 || s === 403);
      const what = 'Some of this report could not be loaded' + (codes.length ? ` (HTTP ${codes[0]})` : '') + ', so the numbers may be incomplete.';
      return what + (auth ? ' Your sign-in may have expired: reload the page and sign in again.' : ' Try again in a minute; if it keeps happening, check Integration health.');
    }
  }

  return PageModule;
});
