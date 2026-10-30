/*
 * EquipRite Next, Analytics and Admin (Settings, Access, Integrations): the logic, and that it keeps New EquipRite's
 * business rules.
 *   - the helpers copied from New are byte-identical (analyticsData, reportCriterion, catalogCriterion,
 *     integrationHealth, configurationInventory), and settingsKit's copied methods are New's, character for character
 *   - Analytics: out / idle / not available by New's rule; the tiles, utilization, late (requestProgress's rule),
 *     requests by stage and month, cost; the reads are New's and Old's calls (run side by side against one fake backend)
 *   - Settings: Next's chains and New's, on the same input, send the same writes in the same order (save, partial
 *     failure, PPM posting labels, the week-ending day reset, a business unit) and refuse the same changes
 *   - Access: New's edit rules (invalid, locked, back to saved), the PUT a role's save sends is New's, the consequence
 *     in words, warnings
 *   - Integrations: New's reads and grades; since when; nothing writes
 *   - the pages: every chain named exists and compiles, bindings follow the page rules, endpoints exist in services/
 * Run:  node tests/next-insights-admin.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const ROOT = path.join(__dirname, '..');
const NEXT = path.join(ROOT, 'webApps', 'equiprite-next');
const NEW = path.join(ROOT, 'webApps', 'equiprite');
const OLD = path.join(ROOT, 'webApps', 'vbredwoodapp');
const JS = path.join(NEXT, 'resources', 'js');
const NEW_JS = path.join(NEW, 'resources', 'js');
const QUIET = { log() {}, info() {}, warn() {}, error() {} };

function loadAmd(file, deps, extra) {
  const sandbox = Object.assign({ console: QUIET, TextEncoder, URLSearchParams, Intl, Date, setTimeout, clearTimeout, Promise,
    document: { getElementById: () => null } }, extra || {});
  let mod;
  sandbox.define = (names, factory) => { mod = factory(...names.map((n) => (deps && n in deps ? deps[n] : {}))); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: path.basename(file) });
  return mod;
}
const next = (name, deps) => loadAmd(path.join(JS, name + '.js'), deps);
const clone = (o) => JSON.parse(JSON.stringify(o));

// ── The real modules ──────────────────────────────────────────────────────────────────────────────────────
const rules = next('rules');
const nav = next('nav', { 'resources/js/rules': rules });
const fmt = next('fmt');
const Progress = next('requestProgress');
const list = next('requestList', { 'resources/js/requestProgress': Progress, 'resources/js/fmt': fmt, 'resources/js/rules': rules });
const requestData = next('requestData', { 'resources/js/rules': rules });
const exportKit = next('exportKit');
const shellBus = next('shellBus');
const catalogCriterion = next('catalogCriterion');
const reportCriterion = next('reportCriterion', { 'resources/js/catalogCriterion': catalogCriterion });
const analyticsData = next('analyticsData', { 'resources/js/reportCriterion': reportCriterion });
const model = next('insightsModel', { 'resources/js/requestProgress': Progress, 'resources/js/requestList': list, 'resources/js/analyticsData': analyticsData, 'resources/js/fmt': fmt });
const IntegrationHealth = next('integrationHealth');
const ihView = next('integrationsView', { 'resources/js/integrationHealth': IntegrationHealth, 'resources/js/nav': nav });
const inv = next('configurationInventory');
const kit = next('settingsKit', { 'resources/js/configurationInventory': inv });
const access = next('accessMatrix', { 'resources/js/nav': nav });

const toasts = [];
shellBus.register((r) => { if (r.action === 'toast') toasts.push(r.message); });

// services/: operationId -> method
const OPS = {};
fs.readdirSync(path.join(ROOT, 'services')).forEach((svc) => {
  const f = path.join(ROOT, 'services', svc, 'openapi3.json');
  if (!fs.existsSync(f)) return;
  const spec = JSON.parse(fs.readFileSync(f, 'utf8'));
  Object.values(spec.paths || {}).forEach((p) => Object.entries(p).forEach(([m, op]) => { if (op && op.operationId) OPS[svc + '/' + op.operationId] = m.toUpperCase(); }));
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════
T.section('the helpers copied from New EquipRite are unchanged');
['analyticsData', 'reportCriterion', 'catalogCriterion', 'integrationHealth', 'configurationInventory'].forEach((n) => {
  T.eq(n + '.js is byte-identical to New\'s', fs.readFileSync(path.join(JS, n + '.js'), 'utf8') === fs.readFileSync(path.join(NEW_JS, n + '.js'), 'utf8'), true);
});
{
  const NewPage = loadAmd(path.join(NEW, 'flows', 'settings', 'pages', 'configuration-page.js'), { 'resources/js/configurationInventory': inv });
  const newPage = new NewPage();
  const COPIED = ['buildSettingsMap', 'getSettingBool', 'getSettingValue', 'getMissingPpmPostingRows', 'esColumnMap', 'esSettingKeys', 'esParseBool', 'esParseNum',
    'esDraftToBody', 'mapFusionBuAttrs', 'buildSettingsByBu', 'esLovLabel', 'esYesNo', 'norm', 'textMatches', 'sectionTitleMatches', 'settingMatches', 'settingDef',
    'storedValue', 'displayValue', 'rows', 'row', 'changeList', 'flagsAfter', 'menuImpact', 'esRateText', 'markupText', 'rateSourceOptions', 'boolOptions', 'rowOptions'];
  const differ = COPIED.filter((m) => String(kit[m]) !== String(newPage[m]));
  T.eq('settingsKit: ' + COPIED.length + ' methods are New\'s Configuration page methods, verbatim', differ.join(), '');
  const rowsIn = [{ id: 1, settingKey: 'PPM_RATES_ENABLED', settingValue: 'true' }, { id: 2, settingKey: 'TIMESHEETS_ENABLED', settingValue: 'true' }];
  const m1 = kit.buildSettingsMap(rowsIn);
  T.eq('and answer as New\'s on the same input', JSON.stringify([kit.rows('costing', m1, m1, {}, '', false), kit.getMissingPpmPostingRows(m1, { txnSource: 'A', document: 'B', docEntry: 'C' })]),
    JSON.stringify([newPage.rows('costing', m1, m1, {}, '', false), newPage.getMissingPpmPostingRows(m1, { txnSource: 'A', document: 'B', docEntry: 'C' })]));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════
T.section('Analytics: what is out, and what is idle');
const NOW = Date.UTC(2026, 9, 30, 12);
const day = (n) => new Date(NOW + n * 86400000).toISOString().slice(0, 10);
const RAW_STOCK = [
  { className: 'Excavators', equipmentName: 'CAT 320', unitNumber: 'EX-101', invOrgName: 'Atlanta', invOrgId: 1, unitStatus: 'AVAILABLE' },
  { className: 'Excavators', equipmentName: 'CAT 320', unitNumber: 'EX-102', invOrgName: 'Atlanta', invOrgId: 1, unitStatus: 'RENTED', projectName: 'Pipeline', currentEndDate: day(-4) + 'T00:00:00Z' },
  { className: 'Excavators', equipmentName: 'CAT 336', unitNumber: 'EX-103', invOrgName: 'Houston', invOrgId: 2, unitStatus: 'DEPLOYED', currentEndDate: day(9) },
  { className: 'Cranes', equipmentName: 'Grove RT', unitNumber: 'CR-7', invOrgName: 'Houston', invOrgId: 2, unitStatus: 'AVAILABLE' },
  { className: 'Cranes', equipmentName: 'Grove RT', unitNumber: 'CR-8', invOrgName: 'Houston', invOrgId: 2, unitStatus: 'IN_MAINTENANCE' },
];
// The rows as analyticsData maps them (its own fetchStock), through a fake backend.
async function mappedStock() {
  const p = { variables: {} };
  return analyticsData.fetchStock({}, { callRest: async () => ({ ok: true, body: { data: RAW_STOCK } }) }, null, null, null).then((r) => r);
}
const tests = [];
tests.push(mappedStock().then((stock) => {
  T.eq('a unit is out when RENTED or DEPLOYED, available when AVAILABLE, else not available (buildStockCharts\' rule)',
    stock.map((r) => model.unitState(r.unit_status)).join(), 'idle,out,out,idle,other');
  const kpis = { totalUnits: 5, outOnRent: 1, available: 2, utilizationPct: 20 };
  const f = model.fleet(stock, kpis, ['AVAILABLE', 'RENTED', 'DEPLOYED', 'IN_MAINTENANCE'], [{ items: [{ value: 2 }, { value: 1 }, { value: 1 }, { value: 1 }] }], {}, NOW);
  T.eq('the tiles are the fleet-wide kpisFromGroups figures (utilization = RENTED ÷ all units)', f.kpis.map((k) => k.value).join(), '5,1,2,2');
  // The yard chart counts as analyticsData.buildStockCharts counts.
  const page = { variables: {} };
  analyticsData.buildStockCharts(stock, page);
  const theirs = page.variables.stockYardStatusGroups.map((g, i) => g + ':' + page.variables.stockYardStatusSeries.map((s) => s.items[i].value).join('/')).join(' ');
  const ours = f.yards.map((y) => y.label + ':' + [y.idle, y.out, y.other].join('/')).join(' ');
  T.eq('by yard: the same counts as New\'s buildStockCharts (available / out / other)', ours, theirs);
  T.eq('utilization by class: out ÷ units of the class, busiest first', f.classes.map((c) => c.label + ' ' + c.pct).join(', '), 'Excavators 67, Cranes 0');
  T.eq('a unit out past its end date is flagged with how long', f.rows.filter((r) => r.pastEnd).map((r) => r.unit + ' ' + r.pastDays).join(), 'EX-102 4');
  const fy = model.fleet(stock, kpis, [], [], { yard: 'Houston', show: 'idle' }, NOW);
  T.eq('a yard and a tile filter the table; the yard chart still shows every yard', [fy.rows.map((r) => r.unit).join(), fy.yards.length, fy.filters.map((x) => x.label).join()].join(' | '),
    'CR-7 | 2 | Yard: Houston');
  T.eq('chip counts follow the other filters', fy.chips.map((c) => c.key + ':' + c.count).join(' '), 'all:3 out:1 idle:1 other:1');
  T.eq('the out-or-idle pick does not narrow the charts that show that split', fy.yards.map((y) => y.label + ' ' + y.out + '/' + y.idle + '/' + y.other).join(', '), 'Houston 1/1/1, Atlanta 1/1/0');
  const full = model.fleet(new Array(2000).fill(stock[0]), kpis, [], [], {}, NOW);
  T.check('a full list (2000 rows, the views\' maximum) says so', full.full && full.fullText.includes('first 2,000 units'));
  T.eq('the export: what the table shows, in words', model.exportOf('fleet').columns.map((c) => c.label).slice(0, 7).join(), 'Class,Equipment,Unit / serial,Asset,Yard,Out or idle,Unit status');
}));

T.section('Analytics: utilization');
{
  const UTIL = [
    { yardName: 'Atlanta', dayDate: '2026-10-27', monthLabel: 'Oct 2026', fleetSize: 10, deployedUnits: 6, utilPercent: 60, usedHours: 48 },
    { yardName: 'Houston', dayDate: '2026-10-27', monthLabel: 'Oct 2026', fleetSize: 8, deployedUnits: 2, utilPercent: 25, usedHours: 16 },
    { yardName: 'Atlanta', dayDate: '2026-10-28', monthLabel: 'Oct 2026', fleetSize: 10, deployedUnits: 7, utilPercent: 70, usedHours: 56 },
    { yardName: 'Houston', dayDate: '2026-10-28', monthLabel: 'Oct 2026', fleetSize: 8, deployedUnits: 4, utilPercent: 50, usedHours: 32 },
  ];
  const u = model.utilization(UTIL, { fromDate: '2026-09-30', toDate: '2026-10-30' }, {});
  T.eq('average utilization: units out ÷ units in the fleet over every yard and day', u.kpis[0].value, '53%');
  T.eq('a column per day: out and fleet', u.cols.map((c) => c.label + ' ' + c.out + '/' + c.fleet).join(', '), '27 Oct 8/18, 28 Oct 11/18');
  const page = { variables: {} };
  analyticsData.buildUtilCharts(UTIL, page);
  T.eq('the daily totals are New\'s buildUtilCharts figures', u.cols.map((c) => c.out).join(), page.variables.utilDailySeries[0].items.map((i) => i.value).join());
  T.eq('by yard, busiest first, with a trend line', u.yards.map((y) => y.label + ' ' + y.pct + ' ' + (y.spark ? 'line' : '')).join(', '), 'Atlanta 65 line, Houston 38 line');
  const uy = model.utilization(UTIL, {}, { yard: 'Houston', view: 'day' });
  T.eq('a yard picked: its days only, the table by day', [uy.cols.map((c) => c.out).join(), uy.rows.map((r) => r.yard).join()].join(' | '), '2,4 | Houston,Houston');
  const long = [];
  for (let i = 0; i < 70; i++) long.push({ yardName: 'A', dayDate: new Date(Date.UTC(2026, 6, 1) + i * 86400000).toISOString().slice(0, 10), fleetSize: 10, deployedUnits: i % 10 });
  T.check('a long period draws weeks', model.utilization(long, {}, {}).weekly && model.utilization(long, {}, {}).cols.length <= 11);
  T.eq('the window is New\'s periodToWindow', JSON.stringify(analyticsData.periodToWindow('custom', null, '2026-10-30', '2026-10-01')), '{"fromDate":"2026-10-01","toDate":"2026-10-30"}');
  T.eq('the by-day export keeps New\'s CSV columns', model.exportOf('use', 'day').columns.map((c) => c.label).join(), 'Yard,Date,Month,Fleet Size,Deployed Units,Utilization %,Used Hours');
  T.eq('sparkline path', model.sparkPath([0, 100]), 'M0.0 22.0 L100.0 2.0');
}

T.section('Analytics: late, and requests');
{
  const REQS = [
    { eqrEquipmentRequestId: 1, requestNumber: 'R1', status: 'IN_PROCESS', startDate: day(-40), endDate: day(-6), projectName: 'Pipeline', requestOrigin: 'Internal' },
    { eqrEquipmentRequestId: 2, requestNumber: 'R2', status: 'IN_PROCESS', startDate: day(-3), endDate: day(30), projectName: 'Plant B', requestOrigin: 'Internal' },
    { eqrEquipmentRequestId: 3, requestNumber: 'R3', status: 'SUBMITTED', startDate: day(12), endDate: day(20), customerName: 'Lone Star', requestOrigin: 'External' },
    { eqrEquipmentRequestId: 4, requestNumber: 'R4', status: 'DRAFT', startDate: day(-70), endDate: day(-50), projectName: 'Harbor' },
  ];
  const lines = requestData.indexLines([
    { requestNumber: 'R1', lineNumber: 1, equipmentName: 'Dozer', lineStatus: 'DEPLOYED' },
    { requestNumber: 'R1', lineNumber: 2, equipmentName: 'Loader', lineStatus: 'RETURNED' },
    { requestNumber: 'R1', lineNumber: 3, equipmentName: 'Truck', lineStatus: 'SHIPPED', endDate: day(2) },
    { requestNumber: 'R2', lineNumber: 1, equipmentName: 'Excavator', lineStatus: 'ALLOCATED' },
    { requestNumber: 'R3', lineNumber: 1, equipmentName: 'Light tower', lineStatus: 'SUBMITTED' },
  ]);
  const items = list.decorate(REQS, lines, NOW);
  const late = model.late(items, lines, NOW, {}, true);
  T.eq('late pieces, the oldest first: kind and days', late.rows.map((r) => r.requestNumber + ' ' + r.name + ' ' + r.kind + ' ' + r.days).join(' | '),
    'R1 Dozer overdue 6 | R2 Excavator not-shipped 3');
  T.check('a line\'s own end date wins over the request\'s (the truck ends in 2 days: not late)', !late.rows.some((r) => r.name === 'Truck'));
  const byProgress = list.equipmentRows(items, lines, NOW).filter((e) => e.late).map((e) => e.requestNumber + ' ' + e.name).join(' | ');
  T.eq('exactly the pieces requestProgress calls late', late.rows.map((r) => r.requestNumber + ' ' + r.name).join(' | '), byProgress);
  T.eq('what is next, in words', late.rows.map((r) => r.next).join(' | '), 'Requester to return it | Equipment Manager to confirm it for picking');
  T.eq('buckets', late.buckets.map((b) => b.total).join(), '1,1,0,0,0');
  T.eq('a kind and a party filter', model.late(items, lines, NOW, { kind: 'overdue', party: 'Pipeline' }, true).rows.length, 1);
  T.check('nothing late says so', model.late([], {}, NOW, {}, true).headline.startsWith('Nothing is late'));
  const flow = model.flow(items, NOW, {});
  T.eq('where every request is now: requestList\'s board columns', flow.lanes.map((l) => l.key + ':' + l.n).join(' '),
    list.LANES.map((l) => l.key + ':' + items.filter((r) => r.lane === l.key).length).join(' '));
  T.eq('months: 6 back and 2 ahead', [flow.months.length, flow.months.filter((m) => m.future).length].join(), '8,2');
  T.eq('12 months', model.flow(items, NOW, { months: 12 }).months.length, 14);
  T.eq('a stage and a month filter the table', model.flow(items, NOW, { lane: 'approval' }).rows.map((r) => r.requestNumber).join(), 'R3');
  T.eq('the requests export is the Requests screen\'s', model.exportOf('flow').columns.map((c) => c.label).join(), list.exportColumns('list').map((c) => c.label).join());
}

T.section('Analytics: cost');
{
  const COST = [
    { requestNumber: 'R1', lineNumber: 1, projectName: 'Pipeline', yardLocation: 'Atlanta', cost: 1200, quantity: 10, totalCost: 12000, postedStatus: 'POSTED' },
    { requestNumber: 'R1', lineNumber: 2, projectName: 'Pipeline', yardLocation: 'Atlanta', cost: 400, quantity: 5, totalCost: 2000, postedStatus: 'UNPOSTED' },
    { requestNumber: 'R2', lineNumber: 1, customerName: 'Acme', yardLocation: 'Houston', cost: 900, quantity: 3, postedStatus: '' },
  ];
  const c = model.cost(COST, {});
  T.eq('totals: posted, not posted, and a line with no posting status counted apart', c.kpis.map((k) => k.value).join(), '$14,900,$12,000,$2,000');
  T.check('the answer names the line with no status', c.headline.includes('$900 with no posting status'));
  T.eq('by project or customer, the largest first, posted and not', c.parties.map((p) => p.label + ' ' + p.segs.map((s) => s.key).join('+')).join(', '), 'Pipeline posted+unposted, Acme unknown');
  T.eq('the answer does not follow the filters', model.cost(COST, { posted: 'unposted' }).headline, c.headline);
  T.eq('nor do the charts that show posted and not posted', model.cost(COST, { posted: 'unposted' }).parties.map((p) => p.label + ' ' + p.segs.length).join(), 'Pipeline 2,Acme 1');
  T.eq('the table does', model.cost(COST, { posted: 'unposted' }).rows.map((r) => r.requestNumber + '/' + r.line).join(), 'R1/2');
  T.eq('a chip for a status that exists only', c.chips.map((x) => x.key).join(), 'all,posted,unposted,unknown');
}

T.section('Analytics: who may see what');
T.eq('fleet, utilization, late and requests need EQR_ANALYTICS; cost needs EQR_REPORTS', [model.reportsFor(true, false).map((r) => r.key).join(), model.reportsFor(false, true).map((r) => r.key).join()].join(' | '),
  'fleet,use,late,flow | cost');
T.eq('plain words for a failed call', model.loadErrorText([{ endpoint: 'x', status: 401 }]), 'Some of this report could not be loaded (HTTP 401), so the numbers may be incomplete. Your sign-in may have expired: reload the page and sign in again.');

// ════════════════════════════════════════════════════════════════════════════════════════════════════════
// Chains, run against one fake backend: Next's and New's (or Old's), on the same input.
function makeActions(respond, calls) {
  return {
    async callRest(ctx, o) {
      calls.push({ endpoint: o.endpoint, uriParams: o.uriParams, body: o.body, headers: o.headers });
      const method = OPS[o.endpoint] || 'GET';
      const r = respond ? respond(o, method, calls) : null;
      const def = { ok: true, status: method === 'POST' ? 201 : 200, statusCode: method === 'POST' ? 201 : 200, body: method === 'GET' ? { data: [] } : {} };
      return Object.assign(def, r || {});
    },
    async fireNotificationEvent(ctx, n) { calls.push({ toast: n.summary }); },
    async callChain(ctx, o) { return ctx.__run(o.chain, o.params); },
    async navigateToPage() {}, async navigateToFlow() {},
  };
}
function makeEnv(dir, pageJsonFile, setup) {
  const s = setup || {};
  const calls = [];
  const variables = {};
  const pj = JSON.parse(fs.readFileSync(pageJsonFile, 'utf8'));
  Object.entries(pj.variables || {}).forEach(([k, v]) => { variables[k] = v.defaultValue === undefined ? null : clone(v.defaultValue); });
  Object.assign(variables, clone(s.vars || {}));
  const appVars = Object.assign({ featureFlags: { PROJECTS_MODULE_ENABLED: 'true', TIMESHEETS_ENABLED: 'true' }, globalSettings: {}, flagsLoaded: true, buRateSources: {},
    pageAccessMap: { EQR_CONFIGURATIONS: 'FULL', EQR_RBAC_ADMIN: 'FULL', EQR_ANALYTICS: 'FULL', EQR_REPORTS: 'FULL', EQR_DASHBOARD: 'FULL', EQR_TIMESHEETS: 'FULL',
      EQR_TIMESHEET_APPROVALS: 'FULL', EQR_POST_COST: 'FULL', EQR_RATE_SCHEDULE: 'FULL' }, pageAccessLoaded: true, sessionRoles: [] }, clone(s.app || {}));
  const Actions = makeActions(s.respond, calls);
  const appFns = Object.assign({
    pageAccess: (m, l, c) => rules.pageAccess(m, l, c), isPageReadOnly: (m, l, c) => rules.pageAccess(m, l, c) === 'READ_ONLY',
    buRateSourceMap: (r) => rules.buRateSourceMap(r), navVisible: (m, l, c) => rules.canSee(m, l, [c]),
  }, s.appFns || {});
  const context = {
    $page: { variables, functions: s.functions || {} },
    $application: { variables: appVars, functions: appFns, user: { userName: 'priya.raman' } },
  };
  const deps = Object.assign({ 'vb/action/actionChain': class {}, 'vb/action/actions': Actions }, s.deps || {});
  context.__run = (name, params) => {
    const C = loadAmd(path.join(dir, name + '.js'), deps);
    return new C().run(context, params || {});
  };
  return { calls, variables, appVars, context, run: context.__run,
    writes: () => calls.filter((c) => c.endpoint && OPS[c.endpoint] && OPS[c.endpoint] !== 'GET'),
    reads: () => calls.filter((c) => c.endpoint && (OPS[c.endpoint] || 'GET') === 'GET') };
}
const W = (calls) => JSON.stringify(calls.map((c) => ({ endpoint: c.endpoint, uriParams: c.uriParams, body: c.body, headers: c.headers })));
const R = (calls) => JSON.stringify(calls.map((c) => ({ endpoint: c.endpoint, uriParams: c.uriParams })));

const NEXT_DEPS = {
  'resources/js/rules': rules, 'resources/js/nav': nav, 'resources/js/fmt': fmt, 'resources/js/requestProgress': Progress, 'resources/js/requestList': list,
  'resources/js/requestData': requestData, 'resources/js/exportKit': exportKit, 'resources/js/shellBus': shellBus, 'resources/js/analyticsData': analyticsData,
  'resources/js/insightsModel': model, 'resources/js/integrationsView': ihView, 'resources/js/configurationInventory': inv, 'resources/js/settingsKit': kit,
  'resources/js/accessMatrix': access,
};
const NX_ADMIN = path.join(NEXT, 'flows', 'admin', 'pages');
const NX_INSIGHTS = path.join(NEXT, 'flows', 'insights', 'pages');
const NEW_SETTINGS = path.join(NEW, 'flows', 'settings', 'pages');
const NEW_ADMIN = path.join(NEW, 'flows', 'admin', 'pages');
const NewConfigPage = loadAmd(path.join(NEW_SETTINGS, 'configuration-page.js'), { 'resources/js/configurationInventory': inv });

const SETTINGS_ROWS = [
  { id: 1, settingKey: 'PROJECTS_MODULE_ENABLED', settingValue: 'true', settingCategory: 'FEATURE_FLAG', isActiveFlag: 'Y' },
  { id: 2, settingKey: 'CUSTOMERS_MODULE_ENABLED', settingValue: 'false', settingCategory: 'FEATURE_FLAG', isActiveFlag: 'Y' },
  { id: 4, settingKey: 'TIMESHEETS_ENABLED', settingValue: 'true', settingCategory: 'FEATURE_FLAG', isActiveFlag: 'Y' },
  { id: 5, settingKey: 'PPM_RATES_ENABLED', settingValue: 'false', settingCategory: 'FEATURE_FLAG', isActiveFlag: 'Y' },
  { id: 8, settingKey: 'WEEK_END_DAY', settingValue: 'FRIDAY', settingCategory: 'SYSTEM', isActiveFlag: 'Y' },
];
const BU_ROWS = [{ id: 501, businessUnitId: 77, businessUnitName: 'US1 (stored)', rateSource: 'EQUIPRITE_RATES', ppmTransSource: 'EQUIPRITE', ppmBatchPrefix: 'EQRP',
  marginPercentage: 5, passProcurementCost: 'Y', adhocTimesheetEnabled: 'N', isActiveFlag: 'Y' }];
const FUSION_BU = { BusinessUnitId: 77, BusinessUnitName: 'US1 Business Unit', PrimaryLedgerId: '300', LocationId: 12, ManagerId: null, LegalEntityId: '400' };
function settingsRespond(extra) {
  return (o, method, calls) => {
    if (extra) { const r = extra(o, method, calls); if (r) return r; }
    if (o.endpoint === 'eqp-v1/getConfGlobalSettings') return { body: { data: SETTINGS_ROWS } };
    if (o.endpoint === 'eqp-v1/getConfEquipmentSettings') return { body: { data: BU_ROWS } };
    if (o.endpoint === 'ProjectLOV/getFscmRestApiResources11_13_18_05FinBusinessUnitsLOV') return { body: { items: [FUSION_BU] } };
    if (o.endpoint === 'eqp-v1/postConfGlobalSettings') return { body: { id: 900 + calls.length } };
    return null;
  };
}
function settingsEnvs(setup) {
  const s = setup || {};
  const nextEnv = makeEnv(path.join(NX_ADMIN, 'settings-page-chains'), path.join(NX_ADMIN, 'settings-page.json'),
    Object.assign({ deps: NEXT_DEPS, vars: { readOnly: false } }, s));
  const newEnv = makeEnv(path.join(NEW_SETTINGS, 'configuration-page-chains'), path.join(NEW_SETTINGS, 'configuration-page.json'),
    Object.assign({ functions: new NewConfigPage(), vars: { readOnly: false },
      deps: { 'resources/js/configurationInventory': inv, 'resources/js/bipLov': {}, 'resources/js/currentUser': {}, 'resources/js/invOrgAddress': {}, 'resources/js/geocoder': {},
        'resources/js/expenditureTypes': {}, 'resources/js/fetchAllPages': {} } }, s));
  return { nextEnv, newEnv };
}
async function both(setup, steps) {
  const { nextEnv, newEnv } = settingsEnvs(setup);
  await nextEnv.run('loadConfigSettingsChain');
  await newEnv.run('loadConfigSettingsChain');
  for (const [chain, params] of steps) {
    await nextEnv.run(chain, params);
    await newEnv.run(chain, params);
  }
  return { nextEnv, newEnv };
}

tests.push((async () => {
  T.section('Settings: the same writes as New EquipRite, in the same order');
  let e = await both({ respond: settingsRespond() }, [
    ['updateSettingChain', { settingKey: 'TIMESHEETS_ENABLED', value: 'false' }],
    ['updateSettingChain', { settingKey: 'NOTIFY_ON_APPROVAL', value: 'true' }],
    ['updateSettingChain', { settingKey: 'ENABLE_QUOTES', value: 'BOTH' }],
  ]);
  T.eq('staged the same', JSON.stringify(e.nextEnv.variables.changedRows), JSON.stringify(e.newEnv.variables.changedRows));
  await e.nextEnv.run('saveChangesChain');
  await e.newEnv.run('saveChangesChain');
  T.eq('Save: PATCH a stored key, POST a new one, in the order staged — as New', W(e.nextEnv.writes()), W(e.newEnv.writes()));
  T.eq('those writes', e.nextEnv.writes().map((c) => OPS[c.endpoint] + ' ' + c.endpoint.split('/')[1] + (c.uriParams ? ' ' + c.uriParams.id : '')).join(' | '),
    'PATCH patchConfGlobalSettingsById 4 | POST postConfGlobalSettings | POST postConfGlobalSettings');
  T.eq('then the app\'s flags are read again and split as New splits them (the menu follows)', JSON.stringify([e.nextEnv.appVars.featureFlags, e.nextEnv.appVars.globalSettings]),
    JSON.stringify([e.newEnv.appVars.featureFlags, e.newEnv.appVars.globalSettings]));
  T.eq('(from the settings table: flags and system settings apart)', JSON.stringify(e.nextEnv.appVars.globalSettings), '{"WEEK_END_DAY":"FRIDAY"}');

  e = await both({ respond: settingsRespond() }, [['updateSettingChain', { settingKey: 'PPM_RATES_ENABLED', value: 'true' }]]);
  T.eq('PPM on stages its posting labels with New\'s defaults, in New\'s order', Object.keys(e.nextEnv.variables.changedRows).join(), Object.keys(e.newEnv.variables.changedRows).join());
  T.eq('and their values', JSON.stringify(e.nextEnv.variables.changedRows), JSON.stringify(e.newEnv.variables.changedRows));
  T.eq('(the labels, then the switch)', Object.keys(e.nextEnv.variables.changedRows).join(), 'PPM_TXN_SOURCE,PPM_DOCUMENT,PPM_DOC_ENTRY,PPM_RATES_ENABLED');

  e = await both({ respond: settingsRespond() }, [['updateSettingChain', { settingKey: 'PROJECTS_MODULE_ENABLED', value: 'false' }]]);
  T.eq('one module must stay on: refused by both', [Object.keys(e.nextEnv.variables.changedRows).length, Object.keys(e.newEnv.variables.changedRows).length].join(), '0,0');
  T.check('in words', toasts.some((t) => t.includes('At least one module must stay on')));

  e = await both({ respond: settingsRespond() }, [
    ['updateSettingChain', { settingKey: 'PPM_RATES_ENABLED', value: 'true' }],
    ['updateSettingChain', { settingKey: 'TIMESHEETS_ENABLED', value: 'false' }],
  ]);
  T.eq('timesheets cannot go off under PPM: refused by both', [e.nextEnv.variables.changedRows.TIMESHEETS_ENABLED, e.newEnv.variables.changedRows.TIMESHEETS_ENABLED].join(), ',');

  e = await both({ respond: settingsRespond() }, [
    ['updateSettingChain', { settingKey: 'TIMESHEETS_ENABLED', value: 'false' }],
    ['updateSettingChain', { settingKey: 'TIMESHEETS_ENABLED', value: 'true' }],
  ]);
  T.eq('back to the stored value: nothing to save (both)', [Object.keys(e.nextEnv.variables.changedRows).length, Object.keys(e.newEnv.variables.changedRows).length].join(), '0,0');

  const failOnce = (o) => (o.endpoint === 'eqp-v1/patchConfGlobalSettingsById' && o.uriParams.id === 4 ? { ok: false, status: 500, body: {} } : null);
  e = await both({ respond: settingsRespond(failOnce) }, [
    ['updateSettingChain', { settingKey: 'TIMESHEETS_ENABLED', value: 'false' }],
    ['updateSettingChain', { settingKey: 'NOTIFY_ON_APPROVAL', value: 'true' }],
  ]);
  await e.nextEnv.run('saveChangesChain');
  await e.newEnv.run('saveChangesChain');
  T.eq('a partial failure: only what failed stays (both)', [Object.keys(e.nextEnv.variables.changedRows).join(), Object.keys(e.newEnv.variables.changedRows).join()].join(' | '),
    'TIMESHEETS_ENABLED | TIMESHEETS_ENABLED');
  T.check('and it says which, on the page', e.nextEnv.variables.saveError.includes('TIMESHEETS_ENABLED'));

  const read = settingsEnvs({ respond: settingsRespond(), vars: { readOnly: true } });
  await read.nextEnv.run('loadConfigSettingsChain');
  await read.nextEnv.run('updateSettingChain', { settingKey: 'TIMESHEETS_ENABLED', value: 'false' });
  await read.nextEnv.run('saveChangesChain');
  T.eq('read only: nothing staged, nothing written', [Object.keys(read.nextEnv.variables.changedRows).length, read.nextEnv.writes().length].join(), '0,0');

  e = await both({ respond: settingsRespond() }, []);
  await e.nextEnv.run('confirmChain', { action: 'ask', kind: 'resetWeek' });
  T.check('the week-ending day reset asks first', !!e.nextEnv.variables.confirm && e.nextEnv.writes().length === 0);
  await e.nextEnv.run('confirmChain', { action: 'ok' });
  await e.newEnv.run('resetWeekEndDayChain');
  T.eq('then New\'s PATCH', W(e.nextEnv.writes()), W(e.newEnv.writes()));
  T.eq('(PATCH WEEK_END_DAY to blank)', JSON.stringify([e.nextEnv.writes()[0].uriParams, e.nextEnv.writes()[0].body]), '[{"id":8},{"settingValue":""}]');
  T.eq('the card closes', e.nextEnv.variables.confirm, null);

  T.section('Settings: a business unit saves as New EquipRite saves it');
  e = await both({ respond: settingsRespond() }, [['loadEsSettingsChain', {}], ['openEsEditChain', { buId: '77' }],
    ['setDraftChain', { form: 'EsDraft', field: 'RATE_SOURCE', value: 'PPM_RATES' }], ['setDraftChain', { form: 'EsDraft', field: 'MARGIN_PERCENTAGE', value: '12.5' }],
    ['setDraftChain', { form: 'EsDraft', field: 'ADHOC_TIMESHEET_ENABLED', value: 'true' }]]);
  T.eq('the reads: New\'s (conf-equipment-settings, Fusion business units)', R(e.nextEnv.reads()), R(e.newEnv.reads().filter((c) => !/getClass|getEquipmentClasses|BIP|Lookup|Yard|InvOrg|Report/i.test(c.endpoint))));
  T.eq('the app\'s rate sources refreshed', JSON.stringify(e.nextEnv.appVars.buRateSources), '{"77":"EQUIPRITE_RATES"}');
  const draftCheck = kit.buChanges(e.nextEnv.variables.EsDraft, e.nextEnv.variables.EsSettingsByBuArray[0], {});
  T.eq('what Save would change, in words', draftCheck.map((c) => c.label + ': ' + c.from + ' → ' + c.to).join(' | '),
    'Rate source: EquipRite Rates → PPM Rates | Procurement markup (%): 5% → 12.5% | Adhoc timesheets: No → Yes');
  await e.nextEnv.run('saveEsDrawerChain');
  await e.newEnv.run('saveEsDrawerChain');
  T.eq('one PATCH of the business unit\'s row, the same body as New', W(e.nextEnv.writes()), W(e.newEnv.writes()));
  T.eq('that body', JSON.stringify(e.nextEnv.writes()[0].body), JSON.stringify({ rateSource: 'PPM_RATES', passProcurementCost: 'Y', ppmTransSource: 'EQUIPRITE', ppmBatchPrefix: 'EQRP',
    adhocTimesheetEnabled: 'Y', marginPercentage: 12.5, businessUnitName: 'US1 Business Unit', buPrimaryLedgerId: 300, buLocationId: 12, buManagerId: null, buLegalEntityId: 400, lastUpdatedBy: 'EQUIPRITE' }));
  e = await both({ respond: settingsRespond() }, [['loadEsSettingsChain', {}], ['openEsEditChain', { buId: '77' }], ['setDraftChain', { form: 'EsDraft', field: 'MARGIN_PERCENTAGE', value: '140' }]]);
  await e.nextEnv.run('saveEsDrawerChain');
  T.eq('a markup over 100 is refused before any write (New\'s rule)', e.nextEnv.writes().length, 0);

  T.section('Settings: what the page says');
  const map = kit.buildSettingsMap(SETTINGS_ROWS);
  const secs = kit.settingSections(map, map, {}, '', false);
  T.eq('three settings sections', secs.map((s) => s.key).join(), 'modules,costing,notifications');
  const ppm = secs[1].rows.filter((r) => r.key === 'PPM_RATES_ENABLED')[0];
  T.check('a setting says what it does, what it needs and what changes', !!ppm.help && ppm.needs[0].label === 'Timesheets' && ppm.affects.includes('Post costs'));
  T.eq('the search narrows to matching settings', kit.settingSections(map, map, {}, 'week', false).map((s) => s.rows.map((r) => r.key).join('+')).join(), 'WEEK_CONFIG_ENABLED+WEEK_END_DAY');
  const changed = { TIMESHEETS_ENABLED: { id: 4, settingValue: 'false' } };
  const before = nav.visibleGroups({ EQR_TIMESHEETS: 'FULL', EQR_TIMESHEET_APPROVALS: 'FULL' }, true, { PROJECTS_MODULE_ENABLED: 'true', TIMESHEETS_ENABLED: 'true' }, true, {});
  const after = nav.visibleGroups({ EQR_TIMESHEETS: 'FULL', EQR_TIMESHEET_APPROVALS: 'FULL' }, true, kit.flagsAfter({ PROJECTS_MODULE_ENABLED: 'true', TIMESHEETS_ENABLED: 'true' }, changed), true, {});
  const pend = kit.pending(changed, map, before, after);
  T.eq('the consequence before Save: from → to, and the menu', pend.list.map((c) => c.label + ': ' + c.from + ' → ' + c.to).join() + ' | ' + pend.menu.join(' '),
    'Timesheets: On → Off | The menu will hide Timesheets, Approve time.');
  T.eq('the list sections stay in New EquipRite', kit.newSections().map((s) => s.key).join(), 'yards,classes,exp-types,agreement-types,attachments');
  T.eq('history search', kit.historyRows([{ field: 'RATE_SOURCE', modifiedBy: 'sam' }, { field: 'X', modifiedBy: 'priya' }], 'sam').length, 1);
})());

// ════════════════════════════════════════════════════════════════════════════════════════════════════════
T.section('Access: New EquipRite\'s edit rules');
const ROLES = [{ appRoleId: 1, roleCode: 'ADMIN', roleName: 'Administrator', isActive: 'Y' }, { appRoleId: 2, roleCode: 'EQUIP_MGR', roleName: 'Equipment manager', isActive: 'Y' },
  { appRoleId: 3, roleCode: 'OLD', roleName: 'Retired', isActive: 'N' }];
const MATRIX = {};
[1, 2].forEach((id) => {
  MATRIX[id] = [
    { appRoleId: id, pageCode: 'EQR_WORKBENCH', pageLabel: 'Workbench', moduleCode: 'EQUIP_MANAGER', sortOrder: 10, accessLevel: 'FULL', isLocked: 'N' },
    { appRoleId: id, pageCode: 'EQR_DASHBOARD', pageLabel: 'Dashboard', moduleCode: 'PROJECT_REQUESTOR', sortOrder: 1, accessLevel: 'FULL', isLocked: 'N' },
    { appRoleId: id, pageCode: 'EQR_RBAC_ADMIN', pageLabel: 'Page access', moduleCode: 'ADMINISTRATOR', sortOrder: 30, accessLevel: id === 1 ? 'FULL' : 'HIDDEN', isLocked: id === 1 ? 'Y' : 'N' },
  ];
});
{
  T.eq('active roles only', access.activeRoles({ data: ROLES }).map((r) => r.appRoleId).join(), '1,2');
  T.eq('a role\'s rows: that role only, by sortOrder', access.roleRows({ data: MATRIX[1].concat(MATRIX[2]) }, 1).map((r) => r.appRoleId + r.pageCode).join(), '1EQR_DASHBOARD,1EQR_WORKBENCH,1EQR_RBAC_ADMIN');
  const rows1 = access.roleRows({ data: MATRIX[1] }, 1);
  const d0 = {};
  T.eq('an invalid level is refused', access.setLevel(rows1, d0, 'EQR_DASHBOARD', 'ADMIN'), d0);
  T.eq('a locked row is refused', access.setLevel(rows1, d0, 'EQR_RBAC_ADMIN', 'HIDDEN'), d0);
  const d1 = access.setLevel(rows1, d0, 'EQR_DASHBOARD', 'READ_ONLY');
  T.eq('an edit is staged in a new object', JSON.stringify(d1) + (d1 !== d0), '{"EQR_DASHBOARD":"READ_ONLY"}true');
  T.eq('the saved level again drops it', JSON.stringify(access.setLevel(rows1, d1, 'EQR_DASHBOARD', 'FULL')), '{}');
  const rowsByRole = { 1: rows1, 2: access.roleRows({ data: MATRIX[2] }, 2) };
  const dirty = { 1: { EQR_DASHBOARD: 'READ_ONLY' }, 2: { EQR_WORKBENCH: 'HIDDEN', EQR_DASHBOARD: 'HIDDEN' } };
  const mx = access.matrix(ROLES.slice(0, 2), rowsByRole, dirty);
  T.eq('the matrix: a row per page, a cell per role', mx.map((r) => r.pageCode + ':' + r.cells.map((c) => c.level + (c.dirty ? '*' : '') + (c.locked ? 'L' : '')).join('/')).join(' '),
    'EQR_DASHBOARD:READ_ONLY*/HIDDEN* EQR_WORKBENCH:FULL/HIDDEN* EQR_RBAC_ADMIN:FULLL/HIDDEN');
  T.eq('what each page opens in Next', mx[1].opens, 'Opens Approve & allocate, Fleet, Inspections, Transfers in Next');
  T.eq('the PUTs, one per role in role order, only changed rows', JSON.stringify(access.savePlan(ROLES, dirty)),
    JSON.stringify([{ appRoleId: 1, entries: [{ pageCode: 'EQR_DASHBOARD', accessLevel: 'READ_ONLY' }] }, { appRoleId: 2, entries: [{ pageCode: 'EQR_WORKBENCH', accessLevel: 'HIDDEN' }, { pageCode: 'EQR_DASHBOARD', accessLevel: 'HIDDEN' }] }]));
  const cons = access.consequences(ROLES, rowsByRole, dirty, { flags: { PROJECTS_MODULE_ENABLED: 'true' }, flagsLoaded: true, buRateSources: {}, sessionRoles: ['EQUIP_MGR'] });
  T.eq('the consequence, per role', cons.map((c) => c.text).join(' | '),
    'Administrator\'s menu stays the same; only what can be changed on those screens differs. | Equipment manager loses My work, Approve & allocate, Fleet, Inspections, Transfers in the menu.');
  T.eq('a role left with nothing is warned about', cons[1].warnings.join(), 'Equipment manager will see no screen at all; people with only this role land on No access.');
  const own = access.consequences(ROLES, { 1: rows1.map((r) => Object.assign({}, r, { isLocked: 'N' })) }, { 1: { EQR_RBAC_ADMIN: 'READ_ONLY' } }, { flags: {}, flagsLoaded: true, sessionRoles: ['ADMIN'] });
  T.eq('losing Access, and it is your own role', own[0].warnings[0], 'Administrator will no longer be able to change access. That is your role: you would lose this screen yourself.');
  const NewPA = loadAmd(path.join(NEW_ADMIN, 'page-access-page.js'));
  T.eq('a failed save reads as New\'s', access.saveErrorText({ status: 400, body: { message: 'Locked.' } }), 'Not saved: Locked. The changes are still here; fix the row it names and save again.');
  T.eq('levels and modules in New\'s words', [access.levelLabel('READ_ONLY'), access.moduleLabel('EQUIP_MANAGER')].join(), [new NewPA().levelLabel('READ_ONLY'), new NewPA().moduleLabel('EQUIP_MANAGER')].join());
  T.eq('the export: a column per role, unsaved levels marked', access.exportColumns(ROLES.slice(0, 2)).map((c) => c.label).join() + ' | ' + access.exportColumns(ROLES.slice(0, 2))[4].value(mx[0]),
    'Module,Page,Page code,In Next,Administrator,Equipment manager | Read only (unsaved, was Full)');
}

tests.push((async () => {
  T.section('Access: the PUT a role sends is New EquipRite\'s');
  const respond = (o) => {
    if (o.endpoint === 'eqp-v1/getRbacAppRoles') return { body: { data: ROLES } };
    if (o.endpoint === 'eqp-v1/getRbacPageAccessMatrix') return { body: { data: MATRIX[o.uriParams.appRoleId] || [] } };
    return null;
  };
  const nx = makeEnv(path.join(NX_ADMIN, 'access-page-chains'), path.join(NX_ADMIN, 'access-page.json'), { deps: NEXT_DEPS, respond });
  const nw = makeEnv(path.join(NEW_ADMIN, 'page-access-page-chains'), path.join(NEW_ADMIN, 'page-access-page.json'), { respond });
  await nx.run('enterChain');
  await nw.run('pageAccessInitChain');
  T.eq('the role list and the first role\'s pages: New\'s calls', R(nx.reads().slice(0, 2)), R(nw.reads().slice(0, 2)));
  T.eq('then every other role\'s pages, the same call', R(nx.reads().slice(2)), JSON.stringify([{ endpoint: 'eqp-v1/getRbacPageAccessMatrix', uriParams: { appRoleId: 2 } }]));
  await nw.run('loadMatrixChain', { appRoleId: 2 });
  await nx.run('levelChain', { roleId: '2', pageCode: 'EQR_WORKBENCH', accessLevel: 'HIDDEN' });
  await nw.run('setLevelChain', { pageCode: 'EQR_WORKBENCH', accessLevel: 'HIDDEN' });
  await nx.run('levelChain', { roleId: '2', pageCode: 'EQR_DASHBOARD', accessLevel: 'READ_ONLY' });
  await nw.run('setLevelChain', { pageCode: 'EQR_DASHBOARD', accessLevel: 'READ_ONLY' });
  T.eq('the same pending edits', JSON.stringify(nx.variables.dirty[2]), JSON.stringify(nw.variables.dirtyMap));
  await nx.run('saveChain');
  await nw.run('saveMatrixChain');
  T.eq('Save: the same PUT (body and X-User-Id)', W(nx.writes()), W(nw.writes()));
  T.eq('(one PUT, X-User-Id from the signed-in user)', nx.writes().length + ' ' + nx.writes()[0].headers['X-User-Id'], '1 priya.raman');
  T.eq('then the role read again', nx.reads().slice(-1)[0].uriParams.appRoleId, 2);
  T.eq('edits cleared after a saved PUT', JSON.stringify(nx.variables.dirty), '{}');

  const nx2 = makeEnv(path.join(NX_ADMIN, 'access-page-chains'), path.join(NX_ADMIN, 'access-page.json'), { deps: NEXT_DEPS,
    respond: (o) => (o.endpoint === 'eqp-v1/putRbacPageAccess' && o.body.appRoleId === 2 ? { ok: false, status: 400, body: { message: 'Not allowed.' } } : respond(o)) });
  await nx2.run('enterChain');
  await nx2.run('levelChain', { roleId: '1', pageCode: 'EQR_DASHBOARD', accessLevel: 'HIDDEN' });
  await nx2.run('levelChain', { roleId: '1', pageCode: 'EQR_RBAC_ADMIN', accessLevel: 'HIDDEN' });
  await nx2.run('levelChain', { roleId: '2', pageCode: 'EQR_WORKBENCH', accessLevel: 'READ_ONLY' });
  T.eq('a locked row is refused in the matrix too', Object.keys(nx2.variables.dirty[1]).join(), 'EQR_DASHBOARD');
  await nx2.run('saveChain');
  T.eq('two roles: two PUTs in role order', nx2.writes().map((c) => c.body.appRoleId).join(), '1,2');
  T.eq('the refused role keeps its edit and says why; the saved one is cleared', [Object.keys(nx2.variables.dirty).join(), nx2.variables.saveErrors[2]].join(' | '),
    '2 | Equipment manager: Not saved: Not allowed. The changes are still here; fix the row it names and save again.');

  const ro = makeEnv(path.join(NX_ADMIN, 'access-page-chains'), path.join(NX_ADMIN, 'access-page.json'), { deps: NEXT_DEPS, respond, app: { pageAccessMap: { EQR_RBAC_ADMIN: 'READ_ONLY' } } });
  await ro.run('enterChain');
  T.check('without Full access to Access nothing is loaded (New\'s gate)', ro.calls.length === 0 && ro.variables.loadError.includes('do not have permission'));
  ro.variables.dirty = { 1: { EQR_DASHBOARD: 'HIDDEN' } };
  ro.variables.roles = ROLES.slice(0, 1);
  await ro.run('saveChain');
  T.eq('and Save writes nothing', ro.writes().length, 0);
})());

// ════════════════════════════════════════════════════════════════════════════════════════════════════════
tests.push((async () => {
  T.section('Integrations: New EquipRite\'s reads and grades; since when');
  const now = Date.now();
  const ago = (min) => new Date(now - min * 60000).toISOString();
  const RAW = {
    events: [{ id: 1, integrationCode: 'INT-11', status: 'FAILED', createdAt: ago(5), httpStatus: 401 }, { id: 2, integrationCode: 'INT-11', status: 'FAILED', createdAt: ago(20), httpStatus: 401 },
      { id: 3, integrationCode: 'INT-11', status: 'FAILED', createdAt: ago(40), httpStatus: 401 }, { id: 4, integrationCode: 'INT-11', status: 'SUCCESS', createdAt: ago(300) },
      { id: 5, integrationCode: 'INT-08', status: 'SUCCESS', createdAt: ago(30) }],
    errors: [{ id: 8, integrationCode: 'INT-08', errorMessage: 'closed for charges', severity: 'ERROR', createdAt: ago(600) }],
    dlq: [], jobs: [{ jobRunId: 41, jobName: 'EQUIP_ITEM_REFRESH_SYNC', status: 'FAILED', startedAt: ago(120), notes: 'timed out' },
      { jobRunId: 40, jobName: 'EQUIP_ITEM_REFRESH_SYNC', status: 'FAILED', startedAt: ago(400) }, { jobRunId: 39, jobName: 'EQUIP_ITEM_REFRESH_SYNC', status: 'SUCCESS', startedAt: ago(900) }],
    syncExceptions: [], lock: { held: false },
  };
  const respond = (o) => {
    const map = { 'eqp-v1/getIntegrationEvents': RAW.events, 'eqp-v1/getErrorLogs': RAW.errors, 'eqp-v1/getDeadLetterQueue': RAW.dlq, 'eqp-v1/getJobRunLogs': RAW.jobs, 'eqp-v1/getFusionSyncExceptions': RAW.syncExceptions };
    if (map[o.endpoint]) return { body: { data: map[o.endpoint] } };
    if (o.endpoint === 'eqp-v1/getFusionSyncLock') return { body: RAW.lock };
    return null;
  };
  const NewIH = loadAmd(path.join(NEW_ADMIN, 'integration-health-page.js'), { 'resources/js/integrationHealth': IntegrationHealth });
  const nx = makeEnv(path.join(NX_ADMIN, 'integrations-page-chains'), path.join(NX_ADMIN, 'integrations-page.json'), { deps: NEXT_DEPS, respond });
  const nw = makeEnv(path.join(NEW_ADMIN, 'integration-health-page-chains'), path.join(NEW_ADMIN, 'integration-health-page.json'), { respond, functions: new NewIH() });
  await nx.run('loadChain');
  await nw.run('loadHealthChain');
  T.eq('the same six reads as New', R(nx.calls), R(nw.calls));
  T.eq('(six)', nx.calls.length, 6);
  T.eq('graded the same', nx.variables.m.cards.map((c) => c.key + ':' + c.state).join(), nw.variables.model.cards.map((c) => c.key + ':' + c.health.key).join());
  T.eq('nothing written', nx.writes().length, 0);
  const int11 = nx.variables.m.cards.filter((c) => c.key === 'INT-11')[0];
  T.check('down since the first failure after the last success (40 min ago)', int11.sinceText.startsWith('Down since') && int11.sinceText.endsWith('(40 min)'), int11.sinceText);
  const job = nx.variables.m.cards.filter((c) => c.key === 'EQUIP_ITEM_REFRESH_SYNC')[0];
  T.check('a sync: since its first failed run after the last success (400 min ago)', job.sinceText.endsWith('(7 h)'), job.sinceText);
  T.eq('what failed and what to do, in words', [int11.failedWhat, int11.fix.split('.')[0]].join(' | '), 'Fusion refused EquipRite\'s sign-in. | Update the stored Fusion credential for this connection, then reprocess');
  T.check('a failed sync reads as its exception-queue entry', job.failedWhat.startsWith('Equipment items: refresh failed.') && job.fix.startsWith('Run it again.'));
  const int08 = nx.variables.m.cards.filter((c) => c.key === 'INT-08')[0];
  T.check('degraded since its oldest open error', int08.state === 'degraded' && int08.sinceText.startsWith('Since') && int08.sinceText.endsWith('(10 h)'), int08.sinceText);
  T.eq('what is down, listed', nx.variables.m.banner.items.map((i) => i.key).join(), 'INT-11,EQUIP_ITEM_REFRESH_SYNC');
  T.check('re-running is New\'s: the action says what it would do', job.action && job.action.text.includes('Updates the Fusion fields') && ihView.newLink('http://n/') === 'http://n/vp/shell/admin/integration-health');
  T.eq('a chip narrows the queue', ihView.view(RAW, now, { integ: 'INT-08' }).queue.map((q) => q.integ).join(), 'INT-08');
  T.eq('exports', ['cards', 'queue', 'jobs'].map((l) => ihView.exportOf(l).columns.length).join(), '8,8,6');
})());

// ════════════════════════════════════════════════════════════════════════════════════════════════════════
tests.push((async () => {
  T.section('Analytics: the reads are New\'s and Old\'s');
  const respond = (o) => {
    if (o.endpoint === 'eqp-v1/getEquipriteV1ViewsYardStock') return { body: { data: o.uriParams.groupBy ? [{ groupKey: 'AVAILABLE', count: 2 }] : RAW_STOCK } };
    return null;
  };
  const stub = { formatLineStatus: (c) => c };
  const NewAn = loadAmd(path.join(NEW, 'flows', 'insights', 'pages', 'analytics-page.js'), { 'resources/js/lineStatusLabels': stub, 'resources/js/analyticsData': analyticsData,
    'ojs/ojarraydataprovider': function ADP() {} });
  const nx = makeEnv(path.join(NX_INSIGHTS, 'analytics-page-chains'), path.join(NX_INSIGHTS, 'analytics-page.json'), { deps: NEXT_DEPS, respond });
  const nw = makeEnv(path.join(NEW, 'flows', 'insights', 'pages', 'analytics-page-chains'), path.join(NEW, 'flows', 'insights', 'pages', 'analytics-page.json'),
    { respond, functions: new NewAn(), deps: { 'resources/js/analyticsData': analyticsData } });
  nx.variables.win = { fromDate: '2026-10-01', toDate: '2026-10-30' };
  nx.variables.report = 'fleet';
  nx.variables.reports = model.REPORTS;
  await nx.run('loadChain', { report: 'fleet' });
  await nw.run('loadReportChain');
  T.eq('fleet: New\'s calls, in New\'s order', R(nx.calls), R(nw.calls));
  T.eq('(groupBy=unitStatus, the units, groupBy=className)', nx.calls.map((c) => c.uriParams.groupBy || 'size ' + c.uriParams.size).join(), 'unitStatus,size 2000,className');
  T.eq('shown, with its tiles', [nx.variables.cur.report, nx.variables.cur.m.kpis.length].join(), 'fleet,4');
  const nx2 = makeEnv(path.join(NX_INSIGHTS, 'analytics-page-chains'), path.join(NX_INSIGHTS, 'analytics-page.json'), { deps: NEXT_DEPS, respond });
  const nw2 = makeEnv(path.join(NEW, 'flows', 'insights', 'pages', 'analytics-page-chains'), path.join(NEW, 'flows', 'insights', 'pages', 'analytics-page.json'),
    { respond, functions: new NewAn(), deps: { 'resources/js/analyticsData': analyticsData },
      vars: { analyticsActiveTab: 'equip-utilization', utilFromDate: '2026-10-01', utilToDate: '2026-10-30' } });
  nx2.variables.win = { fromDate: '2026-10-01', toDate: '2026-10-30' };
  nx2.variables.report = 'use';
  await nx2.run('loadChain', { report: 'use' });
  await nw2.run('loadReportChain');
  T.eq('utilization: New\'s calls with the window', R(nx2.calls), R(nw2.calls));
  T.eq('(yard-utilization with its window, then the status groups)', nx2.calls.map((c) => c.endpoint.split('Views')[1] + ' ' + (c.uriParams.fromDate || c.uriParams.groupBy)).join(), 'YardUtilization 2026-10-01,YardStock unitStatus');
  // Cost: Old EquipRite's Reports page, Project cost detail, unfiltered (reportsData.loadTab).
  const oldRC = loadAmd(path.join(OLD, 'resources', 'js', 'reportCriterion.js'), { 'resources/js/catalogCriterion': loadAmd(path.join(OLD, 'resources', 'js', 'catalogCriterion.js')) });
  const reportsData = loadAmd(path.join(OLD, 'resources', 'js', 'reportsData.js'), { 'resources/js/reportCriterion': oldRC });
  const oldCalls = [];
  await reportsData.loadTab({ variables: {} }, {}, makeActions(null, oldCalls), 'proj-cost-detail', null);
  const nx3 = makeEnv(path.join(NX_INSIGHTS, 'analytics-page-chains'), path.join(NX_INSIGHTS, 'analytics-page.json'), { deps: NEXT_DEPS });
  nx3.variables.report = 'cost';
  await nx3.run('loadChain', { report: 'cost' });
  T.eq('cost: Old\'s Project cost detail call', R(nx3.calls), R(oldCalls));
  T.eq('(page 0, size 2000)', JSON.stringify(nx3.calls[0].uriParams), '{"page":0,"size":2000}');
  const nx4 = makeEnv(path.join(NX_INSIGHTS, 'analytics-page-chains'), path.join(NX_INSIGHTS, 'analytics-page.json'), { deps: NEXT_DEPS,
    respond: (o) => (o.endpoint === 'eqp-v1/getEquipriteV1ViewsYardStock' ? { ok: false, status: 503, body: {} } : null) });
  nx4.variables.report = 'fleet';
  await nx4.run('loadChain', { report: 'fleet' });
  T.check('a failed call is said on the page', nx4.variables.errors.fleet.startsWith('Some of this report could not be loaded (HTTP 503)'));
  const nx5 = makeEnv(path.join(NX_INSIGHTS, 'analytics-page-chains'), path.join(NX_INSIGHTS, 'analytics-page.json'), { deps: NEXT_DEPS, app: { pageAccessMap: { EQR_REPORTS: 'READ_ONLY' } } });
  await nx5.run('enterChain');
  T.eq('a role with Reports only opens cost', [nx5.variables.reports.map((r) => r.key).join(), nx5.variables.report].join(' | '), 'cost | cost');
  T.eq('no writes from Analytics', nx.writes().length + nx2.writes().length + nx3.writes().length, 0);
})());

// ════════════════════════════════════════════════════════════════════════════════════════════════════════
T.section('the pages follow the page rules');
{
  const flows = [['insights', ['analytics']], ['admin', ['settings', 'access', 'integrations']]];
  flows.forEach(([flow, pages]) => {
    const fj = JSON.parse(fs.readFileSync(path.join(NEXT, 'flows', flow, flow + '-flow.json'), 'utf8'));
    T.eq(flow + ' flow is embeddable and lists its pages', [fj.navigation && fj.navigation.embeddable, Object.keys(fj.pages).join()].join(' | '), 'enabled | ' + pages.join());
    pages.forEach((pg) => {
      const dir = path.join(NEXT, 'flows', flow, 'pages');
      const pj = JSON.parse(fs.readFileSync(path.join(dir, pg + '-page.json'), 'utf8'));
      const html = fs.readFileSync(path.join(dir, pg + '-page.html'), 'utf8');
      const named = new Set();
      Object.values(pj.eventListeners || {}).forEach((l) => (l.chains || []).forEach((c) => named.add(c.chain)));
      const chainDir = path.join(dir, pg + '-page-chains');
      const files = fs.readdirSync(chainDir).filter((f) => f.endsWith('.js'));
      files.forEach((f) => { const src = fs.readFileSync(path.join(chainDir, f), 'utf8'); (src.match(/chain: '([A-Za-z]+)'/g) || []).forEach((m) => named.add(m.slice(8, -1))); });
      T.eq(pg + ': every chain named exists, each a class named like its file', [...named].filter((c) => !fs.existsSync(path.join(chainDir, c + '.js'))).join(), '');
      const broken = files.filter((f) => { try { new vm.Script(fs.readFileSync(path.join(chainDir, f), 'utf8')); return !new RegExp('class ' + f.slice(0, -3) + ' extends ActionChain').test(fs.readFileSync(path.join(chainDir, f), 'utf8')); } catch (e) { return true; } });
      T.eq(pg + ': every chain compiles', broken.join(), '');
      T.eq(pg + ': embeddable', pj.navigation && pj.navigation.embeddable, 'enabled');
      const bindings = html.match(/\[\[[\s\S]*?\]\]/g) || [];
      T.eq(pg + ': no arrow functions or String/Number/Boolean in bindings', bindings.filter((b) => /=>|\bString\(|\bNumber\(|\bBoolean\(/.test(b)).join(), '');
      T.eq(pg + ': :style binds an object', (html.match(/:style="\[\[[^\]]*\]\]"/g) || []).filter((s) => !/:style="\[\[\s*(\{|\$functions\.)/.test(s)).join(), '');
      T.check(pg + ': no oj-bind-for-each inside a table or a select', !/<(table|tbody|select)[^>]*>(?:(?!<\/\1>)[\s\S])*<oj-bind-for-each/.test(html));
      const listeners = new Set((html.match(/\$listeners\.(\w+)/g) || []).map((m) => m.split('.')[1]));
      T.eq(pg + ': every listener the page uses is declared', [...listeners].filter((l) => !(pj.eventListeners || {})[l]).join(), '');
      const mod = loadAmd(path.join(dir, pg + '-page.js'), NEXT_DEPS);
      const fnsUsed = new Set((html.match(/\$functions\.(\w+)/g) || []).map((m) => m.split('.')[1]));
      T.eq(pg + ': every page function the HTML calls exists', [...fnsUsed].filter((f) => typeof mod.prototype[f] !== 'function').join(), '');
      const endpoints = new Set();
      files.forEach((f) => (fs.readFileSync(path.join(chainDir, f), 'utf8').match(/endpoint: '([^']+)'/g) || []).forEach((m) => endpoints.add(m.slice(11, -1))));
      T.eq(pg + ': every endpoint exists in services/', [...endpoints].filter((e) => !OPS[e]).join(), '');
    });
  });
  ['analyticsData', 'integrationsView'].forEach((m) => {
    const src = fs.readFileSync(path.join(JS, m + '.js'), 'utf8');
    (src.match(/endpoint: '([^']+)'/g) || []).forEach((x) => { const e = x.slice(11, -1); if (!OPS[e]) T.check(m + ' endpoint exists: ' + e, false); });
  });
  ['analytics', 'settings', 'access', 'integrations'].forEach((id) => {
    const it = nav.item(id);
    T.eq('menu: ' + id + ' is built and routes to its page', [it.built, JSON.stringify(nav.routeOf(it))].join(' '), 'true ' + JSON.stringify({ flow: it.route.flow, page: it.route.page, params: {} }));
  });
  const app = JSON.parse(fs.readFileSync(path.join(NEXT, 'app-flow.json'), 'utf8'));
  T.check('the stylesheet is imported', app.imports.css.includes('resources/css/next-insights-admin.css'));
}

Promise.all(tests).catch((e) => T.check('tests ran', false, e && e.stack)).then(() => T.report());
