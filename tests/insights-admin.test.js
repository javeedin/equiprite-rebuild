/*
 * New EquipRite: Analytics (flows/insights), Page access and Integration health (flows/admin).
 *
 *   - Analytics: the helpers are Old EquipRite's files byte for byte; the aggregation they do (KPIs, every chart
 *     series, the utilization pivot) on known rows; the criterion the search and chips build reaches the old
 *     endpoint params; the library by role; Export CSV writes exactly what the old page wrote; the chains
 *   - Page access: the matrix logic and the role preview (through the REAL app-flow.js); every chain, and Save sends
 *     what the old saveMatrixChain sends (run side by side), keeps the edits on failure
 *   - Integration health: field reading, health rules, plain-language errors, the model; loading and
 *     Run now / Reprocess (endpoint, body, lock check, confirmation, failure paths)
 *   - every endpoint these pages call exists in services/eqp-v1
 *
 * Run:  node tests/insights-admin.test.js
 */
'use strict';

process.env.TZ = 'UTC';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const ROOT = path.join(__dirname, '..');
const NEW = path.join(ROOT, 'webApps', 'equiprite');
const OLD = path.join(ROOT, 'webApps', 'vbredwoodapp');
const JS = path.join(NEW, 'resources', 'js');
const INSIGHTS = path.join(NEW, 'flows', 'insights', 'pages');
const ADMIN = path.join(NEW, 'flows', 'admin', 'pages');

/** AMD loader: deps by name (missing ones are {}); `globals` are extra sandbox globals (Blob, document …). */
function loadAmd(file, deps, globals) {
  const sandbox = Object.assign({
    console: { log() {}, warn() {}, error() {}, info() {} }, setTimeout, clearTimeout, Promise, Date, window: {},
    document: { querySelectorAll: () => [], body: {}, getElementById: () => null },
    MutationObserver: function () { this.observe = () => {}; },
  }, globals || {});
  let mod;
  sandbox.define = (names, factory) => { mod = factory(...names.map((n) => (deps && n in deps ? deps[n] : {}))); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: path.basename(file) });
  return mod;
}
function ADP(data, opts) { this.data = data; this.opts = opts; }
const ActionChain = class {};

function loadAnalyticsData(dir) {
  const cc = loadAmd(path.join(dir, 'catalogCriterion.js'));
  const rc = loadAmd(path.join(dir, 'reportCriterion.js'), { 'resources/js/catalogCriterion': cc });
  return { ad: loadAmd(path.join(dir, 'analyticsData.js'), { 'resources/js/reportCriterion': rc }), rc };
}
const lineStatusLabels = loadAmd(path.join(JS, 'lineStatusLabels.js'));
const { ad: analyticsData, rc: reportCriterion } = loadAnalyticsData(JS);
const AnalyticsPage = loadAmd(path.join(INSIGHTS, 'analytics-page.js'), {
  'resources/js/lineStatusLabels': lineStatusLabels, 'resources/js/analyticsData': analyticsData, 'ojs/ojarraydataprovider': ADP,
});
const an = new AnalyticsPage();

// The real app module, for the menu functions the pages reuse.
const AppModule = loadAmd(path.join(NEW, 'app-flow.js'), { 'ojs/ojarraydataprovider': ADP, 'resources/js/lineStatusLabels': { formatLabel: (c) => c } });
const app = new AppModule();
const FLAGS = { PROJECTS_MODULE_ENABLED: 'true', TIMESHEETS_ENABLED: 'true', CUSTOMERS_MODULE_ENABLED: 'true', AGREEMENTS_ENABLED: 'true' };

// ── Fixtures ─────────────────────────────────────────────────────────
const STOCK = [
  { className: 'Excavators', equipmentName: 'CAT 320', unitNumber: 'EX-101', unitType: 'SERIAL', invOrgName: 'Atlanta', invOrgId: 11, unitStatus: 'AVAILABLE', onhandQty: 1 },
  { className: 'Excavators', equipmentName: 'CAT 320', unitNumber: 'EX-102', unitType: 'SERIAL', invOrgName: 'Atlanta', invOrgId: 11, unitStatus: 'RENTED', onhandQty: 1, projectName: 'Pipeline North', currentStartDate: '2026-10-01T00:00:00Z', currentEndDate: '2026-11-30T00:00:00Z' },
  { className: 'Cranes', equipmentName: 'Grove RT', unitNumber: 'CR-7', unitType: 'SERIAL', invOrgName: 'Houston', invOrgId: 12, unitStatus: 'AVAILABLE', onhandQty: 1 },
  { className: 'Cranes', equipmentName: 'Grove RT', unitNumber: 'CR-8', unitType: 'SERIAL', invOrgName: 'Houston', invOrgId: 12, unitStatus: 'IN_MAINTENANCE', onhandQty: 1 },
];
const PENDING = [
  { requestNumber: 'EQR-1', lineNumber: 1, className: 'Excavators', equipmentName: 'CAT 320', quantity: 1, requestor: 'Pat Lee', lineStatus: 'IN_PROCESS', invOrgId: null, lineStartDate: '2026-11-02', lineEndDate: '2026-11-27', billRate: 1400, estimatedCost: 36400 },
  { requestNumber: 'EQR-2', lineNumber: 1, className: 'Cranes', equipmentName: 'Grove RT', quantity: 1, requestor: 'Pat Lee', lineStatus: 'ALLOCATED', invOrgId: 12 },
  { requestNumber: 'EQR-3', lineNumber: 2, className: 'Excavators', equipmentName: 'CAT 320', quantity: 2, requestor: 'Sam Ortiz', lineStatus: 'IN_PROCESS', invOrgId: null },
];
const ONHAND = [
  { equipmentMasterId: 21, className: 'Safety', equipmentName: 'Trench kit', invOrgName: 'Atlanta', invOrgId: 11, itemNumber: 'TK-1', uomCode: 'EA', onhandQty: 40 },
  { equipmentMasterId: 22, className: 'Safety', equipmentName: 'Cones', invOrgName: 'Houston', invOrgId: 12, itemNumber: 'CN-1', uomCode: 'EA', onhandQty: 250 },
];
const UTIL = [
  { yardName: 'Atlanta', dayDate: '2026-10-27', monthLabel: 'Oct 2026', fleetSize: 10, deployedUnits: 6, utilPercent: 60, usedHours: 48 },
  { yardName: 'Houston', dayDate: '2026-10-27', monthLabel: 'Oct 2026', fleetSize: 8, deployedUnits: 2, utilPercent: 25, usedHours: 16 },
  { yardName: 'Atlanta', dayDate: '2026-10-28', monthLabel: 'Oct 2026', fleetSize: 10, deployedUnits: 7, utilPercent: 70, usedHours: 56 },
  { yardName: 'Houston', dayDate: '2026-10-28', monthLabel: 'Oct 2026', fleetSize: 8, deployedUnits: 4, utilPercent: 50, usedHours: 32 },
];
const groupsOf = (rows, field, qty) => {
  const m = {};
  rows.forEach((r) => { const k = r[field]; m[k] = m[k] || { groupKey: k, count: 0, qtySum: 0 }; m[k].count++; m[k].qtySum += Number(r[qty] || 0); });
  return Object.values(m);
};

/** A fake Actions that answers from `routes` (endpoint -> fn(options) -> response) and records every call. */
function fakeActions(routes, chainDir, chainDeps) {
  const calls = [];
  const Actions = {
    async callRest(context, o) {
      calls.push({ endpoint: o.endpoint, uriParams: o.uriParams, body: o.body, headers: o.headers });
      const r = routes[o.endpoint];
      if (typeof r === 'function') return r(o);
      return r || { ok: true, status: 200, body: { data: [] } };
    },
    async fireNotificationEvent(context, n) { calls.push({ toast: n }); },
    async navigateToPage(context, n) { calls.push({ nav: n }); },
    async navigateToFlow(context, n) { calls.push({ nav: n }); },
    async callChain(context, n) {
      calls.push({ chain: n.chain, params: n.params });
      if (!chainDir) return undefined;
      const C = loadAmd(path.join(chainDir, n.chain + '.js'), Object.assign({ 'vb/action/actionChain': ActionChain, 'vb/action/actions': Actions }, chainDeps || {}));
      return new C().run(context, n.params || {});
    },
  };
  return { calls, Actions };
}
const rest = (calls) => calls.filter((c) => c.endpoint);

/** Page variables of the analytics page, from its JSON defaults. */
function analyticsVars(extra) {
  const json = JSON.parse(fs.readFileSync(path.join(INSIGHTS, 'analytics-page.json'), 'utf8'));
  const v = {};
  Object.keys(json.variables).forEach((k) => { const d = json.variables[k].defaultValue; v[k] = d === undefined ? undefined : JSON.parse(JSON.stringify(d)); });
  return Object.assign(v, extra || {});
}
const ANALYTICS_ROUTES = {
  'eqp-v1/getEquipriteV1ViewsYardStock': (o) => ({ ok: true, status: 200, body: { data: o.uriParams.groupBy ? groupsOf(STOCK, o.uriParams.groupBy) : STOCK.filter((r) => !o.uriParams.className || r.className === o.uriParams.className) } }),
  'eqp-v1/getEquipriteV1ViewsPendingApprovalLines': (o) => ({ ok: true, status: 200, body: { data: o.uriParams.groupBy === 'lineStatus'
    ? groupsOf(PENDING, 'lineStatus').concat([{ groupKey: 'DEPLOYED', count: 9 }]) : (o.uriParams.groupBy ? groupsOf(PENDING, o.uriParams.groupBy) : PENDING) } }),
  'eqp-v1/getEquipriteV1ViewsOnhandQty': (o) => ({ ok: true, status: 200, body: { data: o.uriParams.groupBy ? groupsOf(ONHAND, 'className', 'onhandQty') : ONHAND } }),
  'eqp-v1/getEquipriteV1ViewsYardUtilization': { ok: true, status: 200, body: { data: UTIL } },
  'eqp-v1/getInvOrgs': { ok: true, status: 200, body: { data: [{ organizationId: 12, organizationName: 'Houston' }] } },
};
const analyticsChainDeps = { 'resources/js/analyticsData': analyticsData };
function analyticsContext(v, appVars) {
  return {
    $page: { variables: v, functions: an },
    $application: { variables: Object.assign({ pageAccessLoaded: true, pageAccessMap: { EQR_ANALYTICS: 'FULL' } }, appVars || {}), functions: app },
  };
}
const ANALYTICS_CHAINS = path.join(INSIGHTS, 'analytics-page-chains');
function analyticsChain(name, Actions) {
  return loadAmd(path.join(ANALYTICS_CHAINS, name + '.js'), Object.assign({ 'vb/action/actionChain': ActionChain, 'vb/action/actions': Actions }, analyticsChainDeps));
}

(async () => {
  T.section('Analytics: helpers are Old EquipRite\'s, byte for byte');
  ['analyticsData.js', 'reportCriterion.js', 'catalogCriterion.js', 'lineStatusLabels.js'].forEach((f) => {
    T.check(f + ' unchanged', fs.readFileSync(path.join(JS, f), 'utf8') === fs.readFileSync(path.join(OLD, 'resources', 'js', f), 'utf8'));
  });

  T.section('Analytics: the old aggregation on known rows');
  {
    const v = analyticsVars({ analyticsActiveTab: 'equipment-master' });
    const { calls, Actions } = fakeActions(ANALYTICS_ROUTES);
    await analyticsData.loadActiveTab({ variables: v }, {}, Actions);
    T.eq('stock: calls = status groups, list, class groups', rest(calls).map((c) => c.endpoint.split('/')[1] + (c.uriParams.groupBy ? '?' + c.uriParams.groupBy : '')).join(' > '),
      'getEquipriteV1ViewsYardStock?unitStatus > getEquipriteV1ViewsYardStock > getEquipriteV1ViewsYardStock?className');
    T.eq('KPIs: 4 units, 1 out, 2 available, 25% / 50%', JSON.stringify(v.analyticsKpis),
      JSON.stringify({ totalUnits: 4, outOnRent: 1, available: 2, utilizationPct: 25, outOnRentPct: 25, availablePct: 50 }));
    T.eq('status mix: one series, a bar per status', JSON.stringify([v.chartDonutGroups, v.chartDonutSeries[0].items.map((i) => i.value)]),
      JSON.stringify([['AVAILABLE', 'RENTED', 'IN_MAINTENANCE'], [2, 1, 1]]));
    T.eq('availability by yard: available / rented / other per yard', JSON.stringify([v.stockYardStatusGroups, v.stockYardStatusSeries.map((s) => s.items.map((i) => i.value))]),
      JSON.stringify([['Atlanta', 'Houston'], [[1, 1], [1, 0], [0, 1]]]));
    T.eq('units by class', JSON.stringify([v.chartBarGroups, v.chartBarSeries[0].items.map((i) => i.value)]), JSON.stringify([['Excavators', 'Cranes'], [2, 2]]));
    T.eq('rows mapped to the old grid fields', JSON.stringify([v.stockRows[1].equip_name, v.stockRows[1].yard, v.stockRows[1].unit_status, v.stockRows[1].start_date]),
      JSON.stringify(['CAT 320', 'Atlanta', 'RENTED', '2026-10-01']));
    T.eq('loading flag cleared', v.isLoading, false);
  }
  {
    const v = analyticsVars({ analyticsActiveTab: 'equipment-pending' });
    const { Actions } = fakeActions(ANALYTICS_ROUTES);
    await analyticsData.loadActiveTab({ variables: v }, {}, Actions);
    T.eq('pending: line status mix keeps only the actionable statuses', JSON.stringify([v.chartDonutGroups, v.chartDonutSeries[0].items.map((i) => i.value)]),
      JSON.stringify([['IN_PROCESS', 'ALLOCATED'], [2, 1]]));
    T.eq('lines by requestor, most first', JSON.stringify([v.pendingRequestorGroups, v.pendingRequestorSeries[0].items.map((i) => i.value), v.pendingRequestorSubtitle]),
      JSON.stringify([['Pat Lee', 'Sam Ortiz'], [2, 1], 'By pending line count']));
    T.eq('yard chips labelled from inv-orgs', JSON.stringify(v.analyticsYardOptionsArray), JSON.stringify([{ label: 'Houston', value: 12 }]));
  }
  {
    const v = analyticsVars({ analyticsActiveTab: 'onhand' });
    const { Actions } = fakeActions(ANALYTICS_ROUTES);
    await analyticsData.loadActiveTab({ variables: v }, {}, Actions);
    T.eq('on-hand: items and quantity by class', JSON.stringify([v.chartDonutSeries[0].items.map((i) => i.value), v.chartBarSeries[0].items.map((i) => i.value), v.chartBarTitle]),
      JSON.stringify([[2], [290], 'On-Hand Qty by Class']));
  }
  {
    const v = analyticsVars({ analyticsActiveTab: 'equip-utilization', utilFromDate: '2026-09-29', utilToDate: '2026-10-29' });
    const { calls, Actions } = fakeActions(ANALYTICS_ROUTES);
    await analyticsData.loadActiveTab({ variables: v }, {}, Actions);
    const u = rest(calls)[0];
    T.eq('utilization: the required window is sent', JSON.stringify([u.endpoint, u.uriParams.fromDate, u.uriParams.toDate, u.uriParams.size]),
      JSON.stringify(['eqp-v1/getEquipriteV1ViewsYardUtilization', '2026-09-29', '2026-10-29', 2000]));
    T.eq('units deployed per day = sum over yards', JSON.stringify([v.utilDailyGroups, v.utilDailySeries[0].items.map((i) => i.value)]), JSON.stringify([['Oct 27', 'Oct 28'], [8, 11]]));
    const m = v.monthData[0];
    T.eq('month row = the busiest day per yard', JSON.stringify([m.Component, m['Atlanta Util %'], m['Atlanta Deployed'], m['Houston Util %'], m.children.length]),
      JSON.stringify(['Oct 2026', '70%', '7', '50%', 2]));
    T.eq('flat rows kept for the CSV', v.utilExportRows.length, 4);
  }
  {
    const now = new Date('2026-10-29T12:00:00Z');
    T.eq('period: last 30 days', JSON.stringify(analyticsData.periodToWindow('last-30', now)), JSON.stringify({ fromDate: '2026-09-29', toDate: '2026-10-29' }));
    T.eq('period: a reversed custom pair is put right', JSON.stringify(analyticsData.periodToWindow('custom', now, '2026-10-15', '2026-10-01')),
      JSON.stringify({ fromDate: '2026-10-01', toDate: '2026-10-15' }));
    T.eq('period: half a custom pair falls back to 30 days', analyticsData.periodToWindow('custom', now, '2026-10-15', '').fromDate, '2026-09-29');
  }

  T.section('Analytics: search and chips reach the old endpoint params');
  {
    const c = an.criterion('crane', { className: 'Cranes', unitStatus: 'AVAILABLE', invOrgId: '12' });
    T.eq('stock: q, class, status, yard', JSON.stringify(analyticsData.searchParams('equipment-master', c)),
      JSON.stringify({ q: 'crane', className: 'Cranes', invOrgId: '12', unitStatus: 'AVAILABLE' }));
    T.eq('pending: lineStatus, not unitStatus', JSON.stringify(analyticsData.searchParams('equipment-pending', an.criterion('', { lineStatus: 'ALLOCATED', unitStatus: 'X' }))),
      JSON.stringify({ lineStatus: 'ALLOCATED' }));
    T.eq('one chip alone is a single node', JSON.stringify(an.criterion('', { className: 'Cranes' })), JSON.stringify({ op: '$eq', value: { className: 'Cranes' } }));
    T.eq('nothing picked: no criterion', an.criterion('  ', { className: '' }), null);
    const keyOf = { 'equipment-master': 'yard-stock', 'equipment-pending': 'pending-approval-lines', onhand: 'onhand-qty', 'equip-utilization': 'yard-utilization' };
    an.liveReports().forEach((r) => {
      const fields = an.filtersFor(r.id).map((f) => f.field);
      T.check(`${r.label}: every chip is a param its endpoint takes`, fields.every((f) => reportCriterion.ENDPOINT_PARAMS[keyOf[r.id]][f]), fields.join(','));
    });
    T.eq('utilization has no chips (its window is the period)', an.filtersFor('equip-utilization').length, 0);
  }

  T.section('Analytics: library by role, insight, labels, pivot');
  {
    const ids = (g) => [].concat(...g.map((x) => x.items.map((i) => i.kind + ':' + i.id))).join(',');
    T.eq('analytics only: the four live reports', ids(an.library(true, false, false)), 'live:equipment-master,live:onhand,live:equip-utilization,live:equipment-pending');
    T.check('reports only: the six old ones, all opening Old EquipRite', an.library(false, true, false).every((g) => g.items.every((i) => i.kind === 'old'))
      && an.libraryCount(false, true, false) === 6);
    T.eq('integration errors only for a role that can open Integration health', an.libraryCount(true, true, true) - an.libraryCount(true, true, false), 1);
    T.eq('nothing granted: an empty library', an.library(false, false, false).length, 0);
    T.eq('old Reports page link', an.oldReportsLink('http://x/old'), 'http://x/old/vp/shell/equipment-foundation/equipment-reports');
    const stockRows = analyticsVars().stockRows.concat(STOCK.map((r) => ({ yard: r.invOrgName, unit_status: r.unitStatus })));
    const ins = an.insight('equipment-master', { totalUnits: 4, outOnRent: 1 }, { stockRows });
    T.eq('stock insight: units free to send out', ins.value + ' ' + ins.label, '2 units free to send out');
    T.check('…and where most of them are', ins.sentence.includes('most are in Atlanta (1)'), ins.sentence);
    const util = an.insight('equip-utilization', {}, { utilDailySeries: [{ items: [{ value: 8 }, { value: 11 }] }], utilDailyGroups: ['Oct 27', 'Oct 28'] });
    T.eq('utilization insight: the busiest day', util.value + ' | ' + util.sentence, '11 | Busiest day: Oct 28. On average 9.5 a day over 2 days.');
    const onh = an.insight('onhand', {}, { onhandRows: [{ onhand_qty: 40, yard: 'A' }, { onhand_qty: 250, yard: 'B' }], chartBarSeries: [{ items: [{ value: 290 }] }], chartBarGroups: ['Safety'] });
    T.eq('on-hand insight: total and the biggest class', onh.value + ' | ' + onh.sentence, '290 | 2 items in 2 yards. Most stock: Safety (290).');
    T.eq('status codes become words on the charts', an.chartGroups(['IN_MAINTENANCE'], 'unit')[0] + ' / ' + an.chartGroups(['ALLOCATED'], 'line')[0],
      'In Maintenance / ' + lineStatusLabels.formatLineStatus('ALLOCATED'));
    T.eq('chart text alternative', an.chartSummary('Mix', [{ name: 'Count', items: [{ value: 2 }, { value: 1 }] }], ['A', 'B']), 'Mix: A 2, B 1.');
    T.eq('chart numbers table', JSON.stringify(an.chartTable([{ items: [{ value: 1200 }] }], ['A'])), JSON.stringify([{ label: 'A', values: ['1,200'] }]));
    const cols = ['Atlanta Util %', 'Atlanta Deployed', 'Atlanta Fleet'];
    const md = [{ Component: 'Oct 2026', 'Atlanta Util %': '70%', children: [{ Component: 'Oct 27', 'Atlanta Util %': '60%' }] }];
    T.eq('pivot: month then its days', an.utilRows(md, cols, []).map((r) => r.label + ':' + r.cells[0]).join(','), 'Oct 2026:70%,Oct 27:60%');
    T.eq('pivot: a collapsed month hides its days', an.utilRows(md, cols, ['Oct 2026']).length, 1);
    T.eq('toggle opens and closes', JSON.stringify(an.toggleUtilMonth(an.toggleUtilMonth([], 'Oct 2026'), 'Oct 2026')), '[]');
    T.eq('a full page of rows says so', an.rowNote(2000).startsWith('Showing the first 2,000 rows'), true);
    T.eq('table height follows the rows, then scrolls', an.tableStyle(2).height + ' / ' + an.tableStyle(400).height, '208px / 520px');
    T.check('a sign-in failure says what to do', an.loadErrorText([{ endpoint: 'x', status: 401 }]).includes('sign in again'));
  }

  T.section('Analytics: Export CSV writes what the old page wrote');
  {
    function csvOf(file, deps) {
      const out = {};
      const globals = {
        Blob: function (parts) { out.text = parts.join(''); },
        URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
        document: { createElement: () => { const a = { style: {}, click() { out.filename = a.download; } }; return a; }, body: { appendChild() {}, removeChild() {} } },
      };
      const Mod = loadAmd(file, deps, globals);
      return { mod: new Mod(), out };
    }
    const fresh = csvOf(path.join(INSIGHTS, 'analytics-page.js'), { 'resources/js/lineStatusLabels': lineStatusLabels, 'resources/js/analyticsData': analyticsData, 'ojs/ojarraydataprovider': ADP });
    const old = csvOf(path.join(OLD, 'flows', 'equipment-foundation', 'pages', 'equipment-analytics-page.js'), {
      'ojs/ojeventtarget': { EventTargetMixin: { applyMixin() {} } }, 'resources/js/lineStatusLabels': lineStatusLabels,
    });
    const v = analyticsVars({ analyticsActiveTab: 'equipment-pending' });
    const { Actions } = fakeActions(ANALYTICS_ROUTES);
    await analyticsData.loadActiveTab({ variables: v }, {}, Actions);
    const data = { stock: STOCK.map((r) => ({ equip_class: r.className, equip_name: r.equipmentName, unit_status: r.unitStatus, yard: 'A, "B"' })),
      pending: v.pendingRows, onhand: [{ equipment_id: 1, onhand_qty: 3 }], util: UTIL };
    ['equipment-master', 'equipment-pending', 'onhand', 'equip-utilization'].forEach((tab) => {
      fresh.mod.exportCSV(tab, data);
      old.mod.exportCSV(tab, data);
      T.check(`${tab}: same file name and content as the old page`, fresh.out.text === old.out.text && fresh.out.filename === old.out.filename && !!fresh.out.text,
        fresh.out.filename);
    });
  }

  T.section('Analytics: chains');
  {
    // No EQR_ANALYTICS: nothing is fetched.
    const v = analyticsVars();
    const { calls, Actions } = fakeActions(ANALYTICS_ROUTES, ANALYTICS_CHAINS, analyticsChainDeps);
    const Init = analyticsChain('analyticsInitChain', Actions);
    await new Init().run(analyticsContext(v, { pageAccessMap: { EQR_REPORTS: 'READ_ONLY' } }));
    T.check('a role without EQR_ANALYTICS loads nothing', calls.length === 0 && v.canAnalytics === false && v.isBusy === false);
  }
  {
    const v = analyticsVars({ report: 'onhand' });
    const { calls, Actions } = fakeActions(ANALYTICS_ROUTES, ANALYTICS_CHAINS, analyticsChainDeps);
    const Init = analyticsChain('analyticsInitChain', Actions);
    await new Init().run(analyticsContext(v));
    T.check('?report= opens that report', v.analyticsActiveTab === 'onhand' && rest(calls).some((c) => c.endpoint === 'eqp-v1/getEquipriteV1ViewsOnhandQty'));
    T.check('the utilization window is seeded (required by yard-utilization)', /^\d{4}-\d{2}-\d{2}$/.test(v.utilFromDate) && /^\d{4}-\d{2}-\d{2}$/.test(v.utilToDate));
    T.check('table rows and unfiltered chip options after the load', v.tableRows.length === 2 && v.chipOptions.className.length === 1 && v.isBusy === false);

    // Chip: criterion, reload with the param; the same chip again clears it.
    await new (analyticsChain('selectReportChain', Actions))().run(analyticsContext(v), { tab: 'equipment-master' });
    T.eq('stock chips from the unfiltered rows', v.chipOptions.className.map((o) => o.value).join(','), 'Cranes,Excavators');
    calls.length = 0;
    const Filter = analyticsChain('filterChain', Actions);
    await new Filter().run(analyticsContext(v), { field: 'className', value: 'Cranes' });
    const list = rest(calls).find((c) => c.endpoint === 'eqp-v1/getEquipriteV1ViewsYardStock' && !c.uriParams.groupBy);
    T.eq('a class chip sends className', list && list.uriParams.className, 'Cranes');
    T.eq('…the table shows only those rows', v.tableRows.map((r) => r.unit_number).join(','), 'CR-7,CR-8');
    T.eq('chip options are not narrowed by a filtered load', v.chipOptions.className.length, 2);
    calls.length = 0;
    await new Filter().run(analyticsContext(v), { field: 'className', value: 'Cranes' });
    T.check('the picked chip again clears it', !v.picks.className && v.analyticsFilterCriterion === null);
    calls.length = 0;
    await new Filter().run(analyticsContext(v), { field: 'className', value: '' });
    T.eq('no change for this endpoint: no reload (old signature guard)', rest(calls).length, 0);

    // Switch report: the criterion is dropped.
    v.picks = { className: 'Cranes' };
    v.analyticsFilterCriterion = an.criterion('', v.picks);
    const Select = analyticsChain('selectReportChain', Actions);
    await new Select().run(analyticsContext(v), { tab: 'equipment-pending' });
    T.check('switching report clears search and chips', v.analyticsActiveTab === 'equipment-pending' && v.analyticsFilterCriterion === null && !v.picks.className);
    calls.length = 0;
    await new Select().run(analyticsContext(v), { tab: 'no-such-report' });
    T.eq('an unknown report is ignored', calls.length, 0);

    // Period: custom waits for both dates.
    v.analyticsActiveTab = 'equip-utilization';
    calls.length = 0;
    const Period = analyticsChain('periodChain', Actions);
    await new Period().run(analyticsContext(v), { preset: 'custom' });
    T.eq('custom without dates does not reload', rest(calls).length, 0);
    await new Period().run(analyticsContext(v), { from: '2026-10-01' });
    await new Period().run(analyticsContext(v), { to: '2026-10-15' });
    const u = rest(calls).find((c) => c.endpoint === 'eqp-v1/getEquipriteV1ViewsYardUtilization');
    T.eq('custom dates are the window sent', u && (u.uriParams.fromDate + '..' + u.uriParams.toDate), '2026-10-01..2026-10-15');
  }
  {
    const v = analyticsVars();
    const routes = Object.assign({}, ANALYTICS_ROUTES, { 'eqp-v1/getEquipriteV1ViewsYardStock': { ok: false, status: 500, body: {} } });
    const { Actions } = fakeActions(routes, ANALYTICS_CHAINS, analyticsChainDeps);
    const Load = analyticsChain('loadReportChain', Actions);
    await new Load().run(analyticsContext(v));
    T.check('a failed view is said plainly, the page still settles', v.loadError.includes('could not be loaded (HTTP 500)') && v.isBusy === false && v.isLoading === false, v.loadError);
  }

  // ── Page access ────────────────────────────────────────────────────
  const PageAccess = loadAmd(path.join(ADMIN, 'page-access-page.js'));
  const pa = new PageAccess();
  const ROWS = [
    { pageCode: 'EQR_DASHBOARD', pageLabel: 'Dashboard', moduleCode: 'PROJECT_REQUESTOR', sortOrder: 1, appRoleId: 2, accessLevel: 'FULL', isLocked: 'N' },
    { pageCode: 'EQR_WORKBENCH', pageLabel: 'Workbench', moduleCode: 'EQUIP_MANAGER', sortOrder: 10, appRoleId: 2, accessLevel: 'FULL', isLocked: 'N' },
    { pageCode: 'EQR_EQUIPMENT_MASTER', pageLabel: 'Equipment master', moduleCode: 'EQUIP_MANAGER', sortOrder: 11, appRoleId: 2, accessLevel: 'READ_ONLY', isLocked: 'N' },
    { pageCode: 'EQR_RBAC_ADMIN', pageLabel: 'Page access', moduleCode: 'ADMINISTRATOR', sortOrder: 30, appRoleId: 2, accessLevel: 'HIDDEN', isLocked: 'Y' },
  ];

  T.section('Page access: the matrix logic');
  {
    const dirty = { EQR_WORKBENCH: 'HIDDEN' };
    T.eq('effective level: the pending edit wins', pa.effectiveLevel(dirty, 'EQR_WORKBENCH', 'FULL'), 'HIDDEN');
    T.eq('unknown level reads as hidden (fail closed)', pa.effectiveLevel({}, 'X', undefined), 'HIDDEN');
    T.eq('save label', pa.saveLabel(dirty) + ' / ' + pa.saveLabel({}), 'Save 1 change / Save');
    T.eq('saved map', JSON.stringify(pa.savedMap(ROWS)), JSON.stringify({ EQR_DASHBOARD: 'FULL', EQR_WORKBENCH: 'FULL', EQR_EQUIPMENT_MASTER: 'READ_ONLY', EQR_RBAC_ADMIN: 'HIDDEN' }));
    T.eq('map with the edits', pa.effectiveMap(ROWS, dirty).EQR_WORKBENCH, 'HIDDEN');
    T.eq('counts with the edits', pa.levelCounts(ROWS, dirty), '1 full · 1 read only · 2 hidden');
    T.eq('the change in words', JSON.stringify(pa.changes(ROWS, dirty)), JSON.stringify([{ code: 'EQR_WORKBENCH', label: 'Workbench', from: 'Full', to: 'Hidden' }]));
    T.eq('search keeps module headers right', pa.visibleRows(ROWS, 'equip').map((r) => r.pageCode + (r.first ? '*' : '')).join(','), 'EQR_WORKBENCH*,EQR_EQUIPMENT_MASTER');
    T.eq('search by code', pa.visibleRows(ROWS, 'rbac').length, 1);
    T.eq('module labels (old map)', pa.moduleLabel('EQUIP_MANAGER') + ' / ' + pa.moduleLabel('NEW_ONE'), 'Equipment Manager / NEW_ONE');
  }

  T.section('Page access: preview the app as the role (real visibleNavGroups)');
  {
    const dirty = { EQR_WORKBENCH: 'HIDDEN' };
    const saved = app.visibleNavGroups(pa.savedMap(ROWS), true, FLAGS, true, {});
    const pending = app.visibleNavGroups(pa.effectiveMap(ROWS, dirty), true, FLAGS, true, {});
    const d = pa.menuDiff(saved, pending);
    T.eq('hiding Workbench removes the items it gates', d.removed.join(','), 'Workbench,Inspection,Transfers');
    T.eq('…and adds none', d.added.length, 0);
    T.eq('the consequence sentence', pa.consequence('Equipment manager', saved, pending), 'Equipment manager loses Workbench, Inspection, Transfers in the menu.');
    T.check('no menu change is said too', pa.consequence('X', saved, saved).includes('stays the same'));
    const equipment = pa.menuItems(saved).find((i) => i.id === 'equipment');
    T.check('Equipment is read only for this role', pa.itemReadOnly(equipment, pa.savedMap(ROWS)));
    T.check('Home is not', !pa.itemReadOnly(pa.menuItems(saved).find((i) => i.id === 'home'), pa.savedMap(ROWS)));
    T.eq('which New menu items a code opens', pa.usedByText(app.visibleNavGroups(pa.singleMap('EQR_ANALYTICS'), true, FLAGS, true, {})), 'New menu: Analytics');
    T.check('a code no New item uses says so', pa.usedByText(app.visibleNavGroups(pa.singleMap('EQR_NOT_IN_MENU'), true, FLAGS, true, {})).includes('Old EquipRite only'));
    T.eq('lands on Home with EQR_DASHBOARD', pa.landingLabel(app.getRoleHomeTarget(FLAGS, true, pa.savedMap(ROWS), true), app), 'Home');
    T.eq('without Home: the first item it can open', pa.landingLabel(app.getRoleHomeTarget(FLAGS, true, { EQR_ANALYTICS: 'FULL' }, true), app), 'Analytics');
    T.check('nothing at all: the No access page', pa.landingLabel(app.getRoleHomeTarget(FLAGS, true, {}, true), app).startsWith('the No access page'));
    T.eq('preview as saved ignores the edits', pa.previewMap(ROWS, dirty, 'saved').EQR_WORKBENCH, 'FULL');
  }

  T.section('Page access: chains');
  const PA_CHAINS = path.join(ADMIN, 'page-access-page-chains');
  function paContext(vars, level, user) {
    return {
      $page: { variables: Object.assign({ rolesArray: [], selectedRoleId: null, matrixArray: [], dirtyMap: {}, isLoading: false, isSaving: false, loadError: '', saveError: '', searchText: '', previewMode: 'pending' }, vars || {}), functions: pa },
      $application: { variables: { pageAccessLoaded: true, pageAccessMap: { EQR_RBAC_ADMIN: level || 'FULL' } }, functions: app, user: user || { userName: 'priya.raman' },
        events: { spShowToast: { fireEvent(context, p) { (context.toasts = context.toasts || []).push(p.message); } } } },
    };
  }
  const paChain = (name, Actions) => loadAmd(path.join(PA_CHAINS, name + '.js'), { 'vb/action/actionChain': ActionChain, 'vb/action/actions': Actions });
  const PA_ROUTES = {
    'eqp-v1/getRbacAppRoles': { ok: true, status: 200, body: { data: [{ appRoleId: 2, roleName: 'Equipment manager', isActive: 'Y' }, { appRoleId: 3, roleName: 'Retired', isActive: 'N' }] } },
    'eqp-v1/getRbacPageAccessMatrix': { ok: true, status: 200, body: { data: ROWS.slice().reverse().concat([{ pageCode: 'EQR_DASHBOARD', appRoleId: 9, accessLevel: 'HIDDEN' }]) } },
    'eqp-v1/putRbacPageAccess': { ok: true, status: 200, body: { data: [] } },
  };
  {
    const { calls, Actions } = fakeActions(PA_ROUTES, PA_CHAINS);
    const c = paContext({}, 'READ_ONLY');
    await new (paChain('pageAccessInitChain', Actions))().run(c);
    T.check('init: READ_ONLY loads nothing (stricter than the guard, as the old page)', calls.length === 0 && c.$page.variables.loadError.includes('do not have permission'));
  }
  {
    const { calls, Actions } = fakeActions(PA_ROUTES, PA_CHAINS);
    const c = paContext();
    await new (paChain('pageAccessInitChain', Actions))().run(c);
    T.eq('init: roles, then the first role\'s matrix', rest(calls).map((x) => x.endpoint + (x.uriParams ? JSON.stringify(x.uriParams) : '')).join(' > '),
      'eqp-v1/getRbacAppRoles > eqp-v1/getRbacPageAccessMatrix{"appRoleId":2}');
    T.eq('inactive roles are left out', c.$page.variables.rolesArray.length, 1);
    T.eq('rows of other roles dropped, sorted by sortOrder', c.$page.variables.matrixArray.map((r) => r.pageCode).join(','), ROWS.map((r) => r.pageCode).join(','));
  }
  {
    const { Actions } = fakeActions(PA_ROUTES, PA_CHAINS);
    const c = paContext({ matrixArray: ROWS });
    const Set = paChain('setLevelChain', Actions);
    await new Set().run(c, { pageCode: 'EQR_WORKBENCH', accessLevel: 'READ_ONLY' });
    T.eq('a change is pending', JSON.stringify(c.$page.variables.dirtyMap), '{"EQR_WORKBENCH":"READ_ONLY"}');
    await new Set().run(c, { pageCode: 'EQR_WORKBENCH', accessLevel: 'FULL' });
    T.eq('back to the saved level: no longer pending', JSON.stringify(c.$page.variables.dirtyMap), '{}');
    await new Set().run(c, { pageCode: 'EQR_RBAC_ADMIN', accessLevel: 'FULL' });
    T.eq('a locked row cannot change', JSON.stringify(c.$page.variables.dirtyMap), '{}');
    await new Set().run(c, { pageCode: 'EQR_WORKBENCH', accessLevel: 'ADMIN' });
    T.eq('an unknown level is ignored', JSON.stringify(c.$page.variables.dirtyMap), '{}');
    c.$page.variables.dirtyMap = { EQR_WORKBENCH: 'HIDDEN' };
    await new (paChain('cancelEditsChain', Actions))().run(c);
    T.eq('discard clears the edits', JSON.stringify(c.$page.variables.dirtyMap), '{}');
  }
  {
    // Save, side by side with the OLD saveMatrixChain: the same REST call.
    const run = async (file, routes) => {
      const f = fakeActions(routes, PA_CHAINS);
      const Chain = loadAmd(file, { 'vb/action/actionChain': ActionChain, 'vb/action/actions': f.Actions });
      const c = paContext({ selectedRoleId: 2, matrixArray: ROWS, dirtyMap: { EQR_WORKBENCH: 'HIDDEN', EQR_EQUIPMENT_MASTER: 'FULL' } });
      await new Chain().run(c);
      return { calls: f.calls, c };
    };
    const fresh = await run(path.join(PA_CHAINS, 'saveMatrixChain.js'), PA_ROUTES);
    const old = await run(path.join(OLD, 'flows', 'setup', 'pages', 'rbac-admin-page-chains', 'saveMatrixChain.js'), PA_ROUTES);
    const put = (x) => rest(x.calls).filter((c) => c.endpoint === 'eqp-v1/putRbacPageAccess');
    T.eq('save: one PUT with the dirty rows of the role', JSON.stringify(put(fresh)[0] && put(fresh)[0].body),
      JSON.stringify({ appRoleId: 2, entries: [{ pageCode: 'EQR_WORKBENCH', accessLevel: 'HIDDEN' }, { pageCode: 'EQR_EQUIPMENT_MASTER', accessLevel: 'FULL' }] }));
    T.eq('save: the audit header from the signed-in user', JSON.stringify(put(fresh)[0].headers), '{"X-User-Id":"priya.raman"}');
    T.eq('save: identical to the old page\'s call', JSON.stringify(put(fresh)), JSON.stringify(put(old)));
    T.check('save: edits cleared, then the matrix re-read', JSON.stringify(fresh.c.$page.variables.dirtyMap) === '{}'
      && fresh.calls.some((x) => x.chain === 'loadMatrixChain') && fresh.c.$page.variables.isSaving === false);

    const failing = Object.assign({}, PA_ROUTES, { 'eqp-v1/putRbacPageAccess': { ok: false, status: 400, body: { message: 'Page EQR_RBAC_ADMIN is locked.' } } });
    const bad = await run(path.join(PA_CHAINS, 'saveMatrixChain.js'), failing);
    T.check('save failed: the edits stay', Object.keys(bad.c.$page.variables.dirtyMap).length === 2 && !bad.calls.some((x) => x.chain));
    T.check('save failed: the backend\'s reason, in words, on the page and in a toast',
      bad.c.$page.variables.saveError.includes('Page EQR_RBAC_ADMIN is locked.') && bad.calls.some((x) => x.toast && x.toast.type === 'error'));
    T.eq('save failed: busy flag cleared', bad.c.$page.variables.isSaving, false);
  }
  {
    const { calls, Actions } = fakeActions(PA_ROUTES, PA_CHAINS);
    const Save = paChain('saveMatrixChain', Actions);
    await new Save().run(paContext({ selectedRoleId: 2, matrixArray: ROWS, dirtyMap: { EQR_WORKBENCH: 'HIDDEN' } }, 'READ_ONLY'));
    T.eq('save refused without FULL on the write path', rest(calls).length, 0);
    await new Save().run(paContext({ selectedRoleId: 2, matrixArray: ROWS, dirtyMap: {} }));
    T.eq('nothing pending: nothing sent', rest(calls).length, 0);
    const c = paContext({ selectedRoleId: 2, matrixArray: ROWS, dirtyMap: { EQR_WORKBENCH: 'HIDDEN' } });
    const s = new Save();
    await Promise.all([s.run(c), s.run(c)]);
    T.eq('a double click saves once', rest(calls).filter((x) => x.endpoint === 'eqp-v1/putRbacPageAccess').length, 1);
  }

  // ── Integration health ─────────────────────────────────────────────
  // The page module is the shared resources/js/integrationHealth.js (also used by the Administrator's Home).
  const Health = loadAmd(path.join(ADMIN, 'integration-health-page.js'),
    { 'resources/js/integrationHealth': loadAmd(path.join(JS, 'integrationHealth.js')) });
  const ih = new Health();
  const NOW = Date.parse('2026-10-29T12:00:00Z');
  const at = (min) => new Date(NOW - min * 60000).toISOString();

  T.section('Integration health: reading the logs');
  {
    T.eq('status words', ['SUCCESS', 'Completed', 'FAILED', 'COMPLETED_WITH_ERRORS', 'RUNNING', 'PENDING', 'E', 'weird', ''].map((s) => ih.statusClass(s)).join(','),
      'ok,ok,fail,fail,run,run,fail,other,other');
    T.eq('integration keys', ['INT-07', 'int_7', 'INT 11 AR invoice', 'Fusion REST'].map((s) => ih.integKey(s)).join(','), 'INT-07,INT-07,INT-11,FUSION REST');
    const n = ih.norm({ errorLogId: 5, interfaceCode: 'INT-04', errorMessage: 'boom', httpStatus: 503, severity: 'critical', entityType: 'TO', entityId: 'TO-1', retryCount: 2, createdAt: at(10) }, 'error');
    T.eq('a row read from any of the likely names', JSON.stringify([n.id, n.key, n.message, n.http, n.severity, n.record, n.retries]), JSON.stringify([5, 'INT-04', 'boom', 503, 'CRITICAL', 'TO TO-1', 2]));
    T.check('resolved by flag, by date or by status', ih.isResolved({ resolved: 'Y' }) && ih.isResolved({ resolvedAt: at(1) }) && ih.isResolved({ status: 'REPROCESSED' }) && !ih.isResolved({ resolved: 'N' }));
    T.eq('rows from data, items or a bare array', [ih.rowsOf({ data: [1] }), ih.rowsOf({ items: [1, 2] }), ih.rowsOf([1, 2, 3]), ih.rowsOf(null)].map((r) => r.length).join(','), '1,2,3,0');
    T.eq('lock: held and fresh = running', ih.lockState({ held: true, runLabel: 'FETCH', idleSeconds: 5, staleAfterSeconds: 1200 }).label, 'An Import from Fusion fetch');
    T.eq('lock: idle past its stale limit = not running', ih.lockState({ held: true, idleSeconds: 2000, staleAfterSeconds: 1200 }).running, false);
  }

  T.section('Integration health: health rules');
  {
    const h = (s, k) => ih.health(s, k).key;
    T.eq('running', h({ running: true, recent: ['fail', 'fail', 'fail'] }), 'running');
    T.eq('events: last 3 failed = down', h({ calls24: 5, ok24: 2, fail24: 3, recent: ['fail', 'fail', 'fail', 'ok'] }), 'down');
    T.eq('events: calls today, none succeeded = down', h({ calls24: 2, ok24: 0, fail24: 2, recent: ['fail', 'ok'] }), 'down');
    T.eq('events: one failure in 200 = degraded (under 99.5%)', h({ calls24: 200, ok24: 198, fail24: 2, recent: ['ok', 'fail'] }), 'degraded');
    T.eq('events: 1 in 1000 failed = healthy', h({ calls24: 1000, ok24: 999, fail24: 1, recent: ['ok'] }), 'healthy');
    T.eq('events: an open error = degraded', h({ calls24: 3, ok24: 3, recent: ['ok'], openErrors: 1 }), 'degraded');
    T.eq('events: slow = degraded', ih.health({ calls24: 3, ok24: 3, recent: ['ok'], avgMs: 4200 }).reason, 'Average 4.2 s (limit 3 s)');
    T.eq('events: nothing in 24 h = quiet', h({ calls24: 0, recent: ['ok'] }), 'idle');
    T.eq('job: last run failed = down', h({ recent: ['fail', 'ok'] }, 'job'), 'down');
    T.eq('job: failed, then succeeded = healthy', h({ recent: ['ok', 'fail'] }, 'job'), 'healthy');
    T.eq('job: never ran = idle', h({ recent: [] }, 'job'), 'idle');
  }

  T.section('Integration health: errors in plain language, with the fix');
  {
    const w = (e) => ih.explain(e).what;
    T.check('401 = the sign-in', w({ http: 401 }).includes('sign-in') && ih.explain({ code: 'EQR-API-002' }).fix.includes('credential'));
    T.check('timeout', w({ message: 'Read timed out after 30000 ms' }).includes('did not answer'));
    T.check('409 = locked', w({ http: 409 }).includes('locked'));
    T.check('closed task', w({ message: 'Project 4.2 is closed for charges' }).includes('closed for charges'));
    T.check('404 = not found, with the message', w({ http: 404, message: 'Item 77 not found' }).includes('Item 77 not found'));
    T.check('5xx', w({ http: 503 }).includes('HTTP 503'));
    T.check('OIC transfer order', w({ code: 'EQR-OIC-001' }).includes('transfer order'));
    T.check('budget', w({ code: 'EQR-BIZ-002' }).includes('budget'));
    T.check('no rate', ih.explain({ code: 'EQR-BIZ-004' }).fix.includes('Rate schedules'));
    T.check('anything else keeps the message and still says what to do', w({ message: 'ORA-00060' }) === 'ORA-00060' && ih.explain({ message: 'x' }).fix.length > 20);
  }

  T.section('Integration health: the page model');
  const RAW = {
    events: [
      { id: 1, integrationCode: 'INT-11', status: 'FAILED', createdAt: at(5), httpStatus: 401 },
      { id: 2, integrationCode: 'INT-11', status: 'FAILED', createdAt: at(20) },
      { id: 3, integrationCode: 'INT-11', status: 'FAILED', createdAt: at(40) },
      { id: 4, integrationCode: 'INT-08', status: 'SUCCESS', createdAt: at(30), durationMs: 600 },
      { id: 5, integrationCode: 'INT-08', status: 'SUCCESS', createdAt: at(60 * 30) },
    ],
    errors: [
      { id: 7, integrationCode: 'INT-11', errorCode: 'EQR-API-002', severity: 'CRITICAL', createdAt: at(12), requestNumber: 'REQ-1', retryCount: 3 },
      { id: 8, integrationCode: 'INT-08', errorMessage: 'Project 4.2 is closed for charges', severity: 'ERROR', createdAt: at(51 * 60) },
      { id: 9, integrationCode: 'INT-08', errorMessage: 'audit', severity: 'INFO', createdAt: at(5) },
      { id: 10, integrationCode: 'INT-08', errorMessage: 'old', severity: 'ERROR', createdAt: at(500), resolvedAt: at(400) },
    ],
    dlq: [{ id: 3, integrationCode: 'INT-05', errorMessage: 'Serial EX-2207 already reserved', status: 'DEAD', createdAt: at(3 * 24 * 60) }],
    jobs: [
      { jobRunId: 41, jobName: 'EQUIP_ITEM_REFRESH_SYNC', status: 'FAILED', startedAt: at(120), endedAt: at(118), notes: 'timed out' },
      { jobRunId: 40, jobName: 'EQUIP_FUSION_REFRESH', status: 'FAILED', startedAt: at(125) },
      { jobRunId: 39, jobName: 'EQUIP_UNIT_SERIAL_SYNC', status: 'SUCCESS', startedAt: at(130), endedAt: at(126) },
      { jobRunId: 38, jobName: 'EQUIP_UNIT_SERIAL_SYNC', status: 'FAILED', startedAt: at(2000) },
      { jobRunId: 37, jobName: 'NIGHTLY_IC_BILLING', status: 'SUCCESS', startedAt: at(600) },
    ],
    syncExceptions: [{ fusionSyncExceptionId: 5, equipmentNumber: 'EX-300', eqrSerialControlled: 'Y', fusionSerialControlled: 'N', eqrLotControlled: 'N', fusionLotControlled: 'N', detectedDate: at(26 * 60) }],
    lock: { held: false },
  };
  {
    const m = ih.model(RAW, NOW);
    const card = (k) => m.cards.find((c) => c.key === k);
    T.eq('down cards first', m.cards.slice(0, 3).map((c) => c.health.key).join(','), 'down,down,down');
    T.eq('INT-11: down, the last 3 calls failed', card('INT-11').health.reason, 'The last 3 calls failed');
    T.eq('INT-08: degraded by its open error (resolved and INFO rows do not count)', card('INT-08').health.reason, '1 open error');
    T.eq('a sync card per known sync, plus jobs the log names', ['EQUIP_ITEM_DEF_SYNC', 'EQUIP_ASSET_GROUP_SYNC', 'NIGHTLY_IC_BILLING'].every((k) => !!card(k)), true);
    T.eq('Run now on a sync, Apply staged stock on the refresh, nothing on an unknown job',
      JSON.stringify([card('EQUIP_ITEM_REFRESH_SYNC').action.type, card('EQUIP_FUSION_REFRESH').action.type, card('NIGHTLY_IC_BILLING').action]), '["run","refresh",null]');
    T.eq('a failure followed by a success is history', card('EQUIP_UNIT_SERIAL_SYNC').health.key, 'healthy');
    T.eq('the banner explains the first down integration', [m.banner.name, m.banner.what].join(' | '), 'INT-11 AR invoice | Fusion refused EquipRite\'s sign-in.');
    const kinds = m.queue.map((q) => q.kind + ':' + q.integ).join(',');
    T.eq('queue: oldest first; errors, dead letter, failed last runs, held items', kinds,
      'Dead letter:INT-05,Error:INT-08,Held item:INT-01,Job:EQUIP_FUSION_REFRESH,Job:EQUIP_ITEM_REFRESH_SYNC,Critical:INT-11');
    T.eq('reprocess only where an endpoint exists', m.queue.map((q) => (q.action ? q.action.type : '-')).join(','), '-,-,-,refresh,run,-');
    T.check('older than 48 h is flagged', m.queue[0].old && m.queue[1].old && !m.queue[5].old);
    T.check('the held item says what changed', m.queue[2].what.includes('serial control of EX-300'));
    T.eq('figures', JSON.stringify([m.kpis.rate, m.kpis.waiting, m.kpis.waitingHint, m.kpis.dlq, m.kpis.lastSync]), JSON.stringify(['25%', 6, '2 older than 48 h', 1, '2 h ago']));
    T.eq('counts for the band', JSON.stringify(m.counts), JSON.stringify({ healthy: 2, attention: 1, down: 3, running: 0, idle: 4 }));
    T.check('integrations with no calls are listed as unknown, not healthy', m.silent.length === 17 && m.silent.includes('INT-02 Project / task list'));
    T.eq('queue chips', ih.queueChips(m.queue).map((c) => c.label + ':' + c.count).join(','),
      'All:6,Apply stock to units:1,Equipment items: refresh:1,INT-01:1,INT-05:1,INT-08:1,INT-11:1');
    T.eq('queue filter', ih.filterQueue(m.queue, 'INT-08').length, 1);
    const locked = ih.model(Object.assign({}, RAW, { lock: { held: true, runLabel: 'SYNC', syncCode: 'EQUIP_ITEM_REFRESH_SYNC', idleSeconds: 1, staleAfterSeconds: 1200, acquiredAt: at(3) } }), NOW);
    T.check('a run holding the lock: its card is running and it is said', locked.cards.find((c) => c.key === 'EQUIP_ITEM_REFRESH_SYNC').health.key === 'running' && locked.lockText.startsWith('A Sync from Fusion'));
    const empty = ih.model({}, NOW);
    T.check('no data: no exceptions, every sync idle, no rate', empty.queue.length === 0 && empty.kpis.rate === '–' && empty.cards.every((c) => c.health.key === 'idle'));
  }

  T.section('Integration health: loading');
  const IH_CHAINS = path.join(ADMIN, 'integration-health-page-chains');
  const cu = { auditHeaders: () => ({ 'X-User-Id': 'priya.raman' }) };
  const ihChain = (name, Actions) => loadAmd(path.join(IH_CHAINS, name + '.js'), { 'vb/action/actionChain': ActionChain, 'vb/action/actions': Actions, 'resources/js/currentUser': cu });
  function ihContext(level, vars) {
    return {
      $page: { variables: Object.assign({ raw: {}, model: ih.model({}, NOW), isLoading: false, loadNote: '', checkedAt: '', queueFilter: '', confirm: null, busyKey: '', lastResult: null }, vars || {}), functions: ih },
      $application: { variables: { pageAccessLoaded: true, pageAccessMap: { EQR_CONFIGURATIONS: level || 'FULL' } }, functions: app, user: { userName: 'priya.raman' } },
    };
  }
  const IH_ROUTES = {
    'eqp-v1/getIntegrationEvents': { ok: true, status: 200, body: { data: RAW.events } },
    'eqp-v1/getErrorLogs': { ok: false, status: 500, body: {} },
    'eqp-v1/getDeadLetterQueue': { ok: true, status: 200, body: { data: RAW.dlq } },
    'eqp-v1/getJobRunLogs': { ok: true, status: 200, body: { data: RAW.jobs } },
    'eqp-v1/getFusionSyncExceptions': { ok: true, status: 200, body: { items: RAW.syncExceptions } },
    'eqp-v1/getFusionSyncLock': { ok: true, status: 200, body: { held: false } },
    'eqp-v1/runIntegrationSync': { ok: true, status: 202, body: { jobRunId: 99, status: 'STARTED' } },
    'eqp-v1/refreshFusionSyncUnits': { ok: true, status: 200, body: { serials: 12, lots: 3, onhand: 40, itemsHeld: 1 } },
  };
  {
    const { calls, Actions } = fakeActions(IH_ROUTES, IH_CHAINS, { 'resources/js/currentUser': cu });
    const c = ihContext();
    await new (ihChain('loadHealthChain', Actions))().run(c);
    T.eq('reads: six GETs', rest(calls).map((x) => x.endpoint.replace('eqp-v1/', '')).join(','),
      'getIntegrationEvents,getErrorLogs,getDeadLetterQueue,getJobRunLogs,getFusionSyncExceptions,getFusionSyncLock');
    T.eq('job runs newest first; open sync exceptions', JSON.stringify([rest(calls)[3].uriParams, rest(calls)[4].uriParams]),
      JSON.stringify([{ orderBy: 'startedAt:desc', size: 200 }, { status: 'OPEN' }]));
    T.check('a failed read is named; the rest still shows', c.$page.variables.loadNote.startsWith('Error logs could not be read (HTTP 500)')
      && c.$page.variables.model.cards.some((x) => x.key === 'INT-11') && c.$page.variables.isLoading === false);
  }

  T.section('Integration health: Run now and Reprocess');
  {
    const { calls, Actions } = fakeActions(IH_ROUTES, IH_CHAINS, { 'resources/js/currentUser': cu });
    const Run = ihChain('runActionChain', Actions);
    const ro = ihContext('READ_ONLY');
    await new Run().run(ro, { type: 'run', syncCode: 'EQUIP_ITEM_REFRESH_SYNC', confirmed: true });
    T.check('read only: nothing is sent, and it says why', rest(calls).length === 0 && calls.some((x) => x.toast && x.toast.summary === 'Read only'));

    calls.length = 0;
    const c = ihContext();
    await new Run().run(c, { type: 'run', syncCode: 'EQUIP_ITEM_REFRESH_SYNC' });
    T.check('first click only asks, saying what will happen', rest(calls).length === 0 && c.$page.variables.confirm.text.includes('Class and subclass are never touched'));

    await new Run().run(c, { type: 'run', syncCode: 'EQUIP_ITEM_REFRESH_SYNC', confirmed: true });
    const writes = rest(calls);
    T.eq('confirmed: the lock, then the run', writes.slice(0, 2).map((x) => x.endpoint).join(' > '), 'eqp-v1/getFusionSyncLock > eqp-v1/runIntegrationSync');
    T.eq('run: the sync code in the path, no body, the audit header', JSON.stringify([writes[1].uriParams, writes[1].body, writes[1].headers]),
      JSON.stringify([{ syncCode: 'EQUIP_ITEM_REFRESH_SYNC' }, undefined, { 'X-User-Id': 'priya.raman' }]));
    T.check('run: reported, then the page reloads', c.$page.variables.lastResult.summary === 'Equipment items: refresh started'
      && calls.some((x) => x.chain === 'loadHealthChain') && c.$page.variables.confirm === null && c.$page.variables.busyKey === '');

    calls.length = 0;
    const r = ihContext();
    await new Run().run(r, { type: 'refresh', syncCode: 'EQUIP_FUSION_REFRESH', confirmed: true });
    const ref = rest(calls).find((x) => x.endpoint === 'eqp-v1/refreshFusionSyncUnits');
    T.eq('apply staged stock: refresh-units, snapshot N (never clears units)', JSON.stringify(ref && ref.body), '{"snapshot":"N"}');
    T.check('…with the counts', r.$page.variables.lastResult.message.startsWith('12 serials, 3 lots and 40 on-hand records'));
  }
  {
    const busy = Object.assign({}, IH_ROUTES, { 'eqp-v1/getFusionSyncLock': { ok: true, status: 200, body: { held: true, runLabel: 'SYNC', idleSeconds: 2, staleAfterSeconds: 1200, acquiredAt: at(3) } } });
    const { calls, Actions } = fakeActions(busy, IH_CHAINS, { 'resources/js/currentUser': cu });
    const c = ihContext();
    await new (ihChain('runActionChain', Actions))().run(c, { type: 'run', syncCode: 'EQUIP_UNIT_LOT_SYNC', confirmed: true });
    T.check('a sync holding the lock: nothing started, and who holds it is said',
      !rest(calls).some((x) => x.endpoint === 'eqp-v1/runIntegrationSync') && c.$page.variables.lastResult.message.startsWith('A Sync from Fusion'));
  }
  {
    const conflict = Object.assign({}, IH_ROUTES, { 'eqp-v1/runIntegrationSync': { ok: false, status: 409, body: {} } });
    const { calls, Actions } = fakeActions(conflict, IH_CHAINS, { 'resources/js/currentUser': cu });
    const c = ihContext();
    await new (ihChain('runActionChain', Actions))().run(c, { type: 'run', syncCode: 'EQUIP_UNIT_LOT_SYNC', confirmed: true });
    T.check('409: already running, a warning, no reload', c.$page.variables.lastResult.type === 'warning' && !calls.some((x) => x.chain));
  }
  {
    const down = Object.assign({}, IH_ROUTES, { 'eqp-v1/runIntegrationSync': { ok: false, status: 500, body: {} }, 'eqp-v1/refreshFusionSyncUnits': { ok: false, status: 500, body: {} } });
    const { calls, Actions } = fakeActions(down, IH_CHAINS, { 'resources/js/currentUser': cu });
    const c = ihContext();
    await new (ihChain('runActionChain', Actions))().run(c, { type: 'run', syncCode: 'EQUIP_UNIT_LOT_SYNC', confirmed: true });
    T.check('a failed start: an error that stays, in words, no reload', c.$page.variables.lastResult.type === 'error'
      && c.$page.variables.lastResult.message.includes('could not be started (HTTP 500)') && calls.some((x) => x.toast && x.toast.displayMode === 'persist') && !calls.some((x) => x.chain));
    await new (ihChain('runActionChain', Actions))().run(c, { type: 'refresh', syncCode: 'EQUIP_FUSION_REFRESH', confirmed: true });
    T.check('a failed apply: nothing changed, said so', c.$page.variables.lastResult.message.includes('Nothing was changed'));
    calls.length = 0;
    const s = new (ihChain('runActionChain', Actions))();
    await Promise.all([s.run(c, { type: 'run', syncCode: 'EQUIP_UNIT_LOT_SYNC', confirmed: true }), s.run(c, { type: 'run', syncCode: 'EQUIP_UNIT_LOT_SYNC', confirmed: true })]);
    T.eq('a double click starts once', rest(calls).filter((x) => x.endpoint === 'eqp-v1/runIntegrationSync').length, 1);
    calls.length = 0;
    await s.run(c, { type: 'delete', syncCode: 'X', confirmed: true });
    T.eq('an unknown action is ignored', calls.length, 0);
  }
  T.check('runResult: 404 names the sync code', ih.runResult({ ok: false, status: 404 }, 'EQUIP_X').message.includes('EQUIP_X'));

  T.section('every endpoint these pages call exists in services/eqp-v1');
  const ops = {};
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'services', 'eqp-v1', 'openapi3.json'), 'utf8'));
  Object.values(spec.paths || {}).forEach((p) => Object.values(p).forEach((op) => { if (op && op.operationId) ops['eqp-v1/' + op.operationId] = true; }));
  const used = new Set();
  [path.join(INSIGHTS, 'analytics-page-chains'), PA_CHAINS, IH_CHAINS].forEach((dir) => fs.readdirSync(dir).forEach((f) => {
    (fs.readFileSync(path.join(dir, f), 'utf8').match(/endpoint:\s*'([^']+)'/g) || []).forEach((m) => used.add(m.replace(/endpoint:\s*'/, '').replace("'", '')));
  }));
  (fs.readFileSync(path.join(JS, 'analyticsData.js'), 'utf8').match(/'eqp-v1\/[A-Za-z0-9]+'/g) || []).forEach((m) => used.add(m.slice(1, -1)));
  T.check('found the calls', used.size >= 12, [...used].join(', '));
  [...used].sort().forEach((e) => T.check(e, !!ops[e]));

  T.report();
})();
