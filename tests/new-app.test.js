/*
 * New EquipRite (webApps/equiprite): the menu, page access and the links back to Old EquipRite.
 *
 * Loads the REAL app-flow.js and page modules (AMD, run in a sandbox) and checks them against both apps' files, so
 * a menu item can never point at a page that does not exist in either app.
 *
 * Run:  node tests/new-app.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const ROOT = path.join(__dirname, '..');
const NEW = path.join(ROOT, 'webApps', 'equiprite');
const OLD = path.join(ROOT, 'webApps', 'vbredwoodapp');

/** Loads an AMD module whose dependencies are stand-ins; returns what its factory returns. */
function loadAmd(file, deps) {
  const sandbox = {
    console, setTimeout, window: { location: { href: '' } },
    document: { querySelectorAll: () => [], body: {} },
    MutationObserver: function () { this.observe = () => {}; },
  };
  let mod;
  sandbox.define = (names, factory) => { mod = factory(...names.map((n) => (deps && deps[n]) || {})); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: path.basename(file) });
  return mod;
}

const AppModule = loadAmd(path.join(NEW, 'app-flow.js'), {
  'ojs/ojarraydataprovider': function ADP(data) { this.data = data; },
  'resources/js/lineStatusLabels': { formatLabel: (c) => c },
});
const app = new AppModule();
const pageExists = (appDir, flow, page) => fs.existsSync(path.join(appDir, 'flows', flow, 'pages', `${page}-page.json`));

const ALL = {};
['EQR_DASHBOARD', 'EQR_WORKBENCH', 'EQR_PROJ_CREATE_REQUEST', 'EQR_EQUIPMENT_REQUESTS', 'EQR_EQUIPMENT_SCHEDULE',
  'EQR_EQUIPMENT_MASTER', 'EQR_INITIATE_PICKING', 'EQR_EQUIPMENT_RETURNS', 'EQR_RATE_SCHEDULE', 'EQR_TIMESHEETS',
  'EQR_TIMESHEET_APPROVALS', 'EQR_POST_COST', 'EQR_RENTAL_AGREEMENTS', 'EQR_ANALYTICS', 'EQR_CONFIGURATIONS',
  'EQR_RBAC_ADMIN', 'EQR_CUST_DASHBOARD'].forEach((c) => { ALL[c] = 'FULL'; });
const FLAGS = { PROJECTS_MODULE_ENABLED: 'true', TIMESHEETS_ENABLED: 'true', CUSTOMERS_MODULE_ENABLED: 'true', AGREEMENTS_ENABLED: 'true' };
const ids = (groups) => [].concat(...groups.map((g) => g.items.map((i) => i.id)));

T.section('menu: every item leads somewhere real');
const everything = app.visibleNavGroups(ALL, true, FLAGS, true, {});
const items = [].concat(...everything.map((g) => g.items));
T.check('the full menu has every phase group', ['Request', 'Fulfil', 'Usage & cost', 'Master data', 'Insights', 'Settings', 'Customers']
  .every((l) => everything.some((g) => g.label === l)), everything.map((g) => g.label).join(', '));
items.forEach((it) => {
  if (it.status === 'new') {
    T.check(`${it.id}: its new page exists`, pageExists(NEW, it.route.flow, it.route.page), JSON.stringify(it.route));
  } else if (it.status === 'old') {
    T.check(`${it.id}: the old screen it opens exists in Old EquipRite`, !!it.old && pageExists(OLD, it.old.flow, it.old.page),
      JSON.stringify(it.old));
  } else {
    T.eq(`${it.id}: a planned item has no old screen`, it.old, undefined);
  }
  T.check(`${it.id}: has page codes and an FDD reference`, (it.pageCodes || []).length > 0 && !!it.fdd);
});
T.check('the later page and No Access exist', pageExists(NEW, 'home', 'later') && pageExists(NEW, 'home', 'no-access'));

T.section('menu: feature flags and page access');
T.check('nothing shows before page access loads', app.visibleNavGroups(ALL, false, FLAGS, true, {}).length === 0);
const pm = app.visibleNavGroups({ EQR_DASHBOARD: 'FULL', EQR_PROJ_CREATE_REQUEST: 'FULL', EQR_EQUIPMENT_REQUESTS: 'READ_ONLY' }, true, FLAGS, true, {});
T.eq('a requestor sees Home and the request group only', ids(pm).join(','), 'home,new-request,my-requests');
const reportsOnly = app.visibleNavGroups({ EQR_REPORTS: 'READ_ONLY' }, true, FLAGS, true, {});
T.eq('an item opens for ANY of its page codes (reports-only role: Analytics)', ids(reportsOnly).join(','), 'analytics');
const CUSTOMER = { EQR_DASHBOARD: 'FULL', EQR_CUST_DASHBOARD: 'FULL', EQR_CUST_CREATE_REQ: 'FULL', EQR_CUST_MY_REQUESTS: 'FULL' };
T.eq('a customer sees the customer portal only, never staff request screens',
  ids(app.visibleNavGroups(CUSTOMER, true, FLAGS, true, {})).join(','), 'home,customer-portal');
T.eq('a customer is not "internal", even holding Home', app.hasInternalPageAccess(CUSTOMER, true), false);
T.eq('a customer lands on the customer portal home', JSON.stringify(app.getRoleHomeTarget(FLAGS, true, CUSTOMER, true)),
  JSON.stringify(app.getNavRoute('customer-portal')));
T.eq('... unless the customers module is off', app.getRoleHomeTarget(Object.assign({}, FLAGS, { CUSTOMERS_MODULE_ENABLED: 'false' }), true, CUSTOMER, true).page, 'home');
T.eq('staff holding a customer page as well still land on Home',
  app.getRoleHomeTarget(FLAGS, true, Object.assign({ EQR_WORKBENCH: 'FULL' }, CUSTOMER), true).page, 'home');
const noTs = app.visibleNavGroups(ALL, true, Object.assign({}, FLAGS, { TIMESHEETS_ENABLED: 'false' }), true, {});
T.check('timesheets off hides time entry and approval, keeps post costs',
  !ids(noTs).includes('time-entry') && !ids(noTs).includes('timesheet-approval') && ids(noTs).includes('post-costs'));
const noProj = app.visibleNavGroups(ALL, true, Object.assign({}, FLAGS, { PROJECTS_MODULE_ENABLED: 'false' }), true, {});
T.check('projects module off hides the whole usage & cost group', !noProj.some((g) => g.label === 'Usage & cost'));
const noAgr = app.visibleNavGroups(ALL, true, Object.assign({}, FLAGS, { AGREEMENTS_ENABLED: 'false' }), true, {});
T.check('agreements off hides rental agreements', !ids(noAgr).includes('agreements'));
T.check('PPM rates hide post costs', !ids(app.visibleNavGroups(ALL, true, Object.assign({}, FLAGS, { PPM_RATES_ENABLED: 'true' }), true, {})).includes('post-costs'));

T.section('landing page by role');
T.eq('Home for anyone with EQR_DASHBOARD', JSON.stringify(app.getRoleHomeTarget(FLAGS, true, ALL, true)), '{"flow":"home","page":"home"}');
T.eq('no Home grant: the first item the role can open',
  JSON.stringify(app.getRoleHomeTarget(FLAGS, true, { EQR_WORKBENCH: 'FULL' }, true)), JSON.stringify(app.getNavRoute('workbench')));
T.eq('nothing at all: No Access', app.getRoleHomeTarget(FLAGS, true, {}, true).page, 'no-access');
T.eq('the later page highlights the item it stands for', app.getNavIdForPage({ id: 'later' }, 'schedule'), 'schedule');
T.eq('Home is gated by EQR_DASHBOARD', app.getPageCodeForPage({ id: 'home' }), 'EQR_DASHBOARD');
T.eq('a page opens for ANY of its item\'s codes (reports-only role, Analytics)',
  app.canEnterPage({ EQR_REPORTS: 'READ_ONLY' }, true, app.getPageCodeForPage({ id: 'analytics' })), true);
T.eq('... and not for a role with none of them', app.canEnterPage({ EQR_WORKBENCH: 'FULL' }, true, app.getPageCodeForPage({ id: 'analytics' })), false);
T.eq('the best level of the codes wins', app.pageAccess({ EQR_ANALYTICS: 'READ_ONLY', EQR_REPORTS: 'FULL' }, true, 'EQR_ANALYTICS|EQR_REPORTS'), 'FULL');

T.section('links into Old EquipRite');
T.eq('VB path route under the old app (vp/shell/<flow>/<page>)', app.oldAppLink('http://localhost:18888/', 'schedule'),
  'http://localhost:18888/vp/shell/main/equipment-schedule');
T.eq('VBCS address (no trailing slash given)', app.oldAppLink('https://h/ic/builder/rt/EquipRite_Rebuild/live/webApps/vbredwoodapp', 'workbench'),
  'https://h/ic/builder/rt/EquipRite_Rebuild/live/webApps/vbredwoodapp/vp/shell/equipment-foundation/equipment-workbench');
T.eq('no link when the old app address is unknown', app.oldAppLink('', 'workbench'), '');
T.eq('no link for a planned screen', app.oldAppLink('http://x/', 'transfer'), '');

const Home = loadAmd(path.join(NEW, 'flows', 'home', 'pages', 'home-page.js'));
const home = new Home();
T.eq('a Home row opens the request in the old app', home.oldRequestLink('http://x/', { requestNumber: 'REQ-10482', eqrEquipmentRequestId: 10482 }, 'workbench'),
  'http://x/vp/shell/main/equipment-request-detail?requestId=REQ-10482&requestNumericId=10482&sourcePage=Equipment%20Requests');
T.eq('…and nothing for a row without a request number', home.oldRequestLink('http://x/', { requestNumber: '—' }, 'myRequests'), '');
const ROW = { requestNumber: 'REQ-7', weekStartDate: '2026-11-02' };
['workbenchPicking', 'timesheets', 'timesheetApprovals', 'postCost'].forEach((shape) => {
  const t = home.newRowTarget(ROW, shape);
  const route = t && app.getNavRoute(t.navId);
  const pageJson = route && path.join(NEW, 'flows', route.flow, 'pages', `${route.page}-page.json`);
  const inputs = pageJson && fs.existsSync(pageJson)
    ? Object.entries(JSON.parse(fs.readFileSync(pageJson, 'utf8')).variables || {}).filter(([, v]) => v.input === 'fromUrl').map(([k]) => k) : [];
  T.check(`Home ${shape} rows open a built screen that reads what they pass`,
    !!route && route.page !== 'later' && Object.keys(t.params).every((k) => inputs.includes(k)), JSON.stringify({ t, route, inputs }));
});
T.eq('a timesheet row carries its request and week', JSON.stringify(home.newRowTarget(ROW, 'timesheets')),
  '{"navId":"time-entry","params":{"request":"REQ-7","week":"2026-11-02"}}');
T.eq('a dash is not passed on', JSON.stringify(home.newRowTarget({ requestNumber: '—' }, 'postCost').params), '{}');
const rowPages = fs.readFileSync(path.join(NEW, 'flows', 'home', 'pages', 'home-page.js'), 'utf8').match(/path: '([a-z-]+\/[a-z-]+)'/g) || [];
rowPages.forEach((m) => {
  const [flow, page] = m.slice(7, -1).split('/');
  T.check(`row target ${flow}/${page} exists in Old EquipRite`, pageExists(OLD, flow, page));
});
T.eq('greeting uses the first name', home.greeting({ fullName: 'priya.raman' }).split(', ')[1], 'Priya');
T.eq('money KPIs as currency', home.kpiValue({ costPending: 12340 }, { key: 'costPending', money: true }).replace(/\s/g, ''), '$12,340');
T.eq('missing KPI as a dash', home.kpiValue({}, { key: 'x' }), '–');

T.section('Home tiles and later page point at real menu items');
const dash = loadAmd(path.join(NEW, 'resources', 'js', 'dashboardRoleConfig.js'));
const navIds = new Set(items.map((i) => i.id));
Object.keys(dash.ROLE_CONFIG).forEach((role) => {
  const cfg = dash.ROLE_CONFIG[role];
  if (!cfg) { return; }
  const targets = [cfg.tableViewAllNav, ...cfg.kpis.map((k) => k.nav)];
  T.check(`${role}: tiles and View all open existing menu items`, targets.every((t) => navIds.has(t)), targets.join(', '));
});
const Later = loadAmd(path.join(NEW, 'flows', 'home', 'pages', 'later-page.js'));
const later = new Later();
items.filter((i) => i.status !== 'new').forEach((i) => {
  T.check(`${i.id}: the later page says what changes`, later.planned(i.id).length > 0);
});

T.section('My requests: status groups, filters, columns');
const MyReq = loadAmd(path.join(NEW, 'flows', 'request', 'pages', 'my-requests-page.js'));
const myReq = new MyReq();
const ROWS = [
  { requestNumber: 'R1', status: 'DRAFT', requestOrigin: 'Internal', projectName: 'Pipeline North' },
  { requestNumber: 'R2', status: 'SUBMITTED', requestOrigin: 'External', customerName: 'Lone Star Paving' },
  { requestNumber: 'R3', status: 'DEPLOYED', requestOrigin: 'Internal', projectName: 'Plant B' },
  { requestNumber: 'R4', status: 'CLOSED', requestOrigin: 'CUSTOMER', customerName: 'Acme' },
  { requestNumber: 'R5', status: 'SOME_NEW_STATUS', requestOrigin: 'Internal' },
];
const chips = myReq.groups(ROWS);
T.eq('All counts every row', chips[0].count, 5);
T.eq('group counts add up to All (no status falls through)', chips.slice(1).reduce((n, c) => n + c.count, 0), 5);
T.eq('Needs action = draft, rejected, quote generated', myReq.filterRows(ROWS, '', 'action', '').map((r) => r.requestNumber).join(), 'R1');
T.eq('an unknown status counts as Waiting', myReq.filterRows(ROWS, '', 'waiting', '').map((r) => r.requestNumber).join(), 'R2,R5');
T.eq('source Customer includes the legacy CUSTOMER origin', myReq.filterRows(ROWS, '', 'all', 'EXTERNAL').map((r) => r.requestNumber).join(), 'R2,R4');
T.eq('search matches customer names, any case', myReq.filterRows(ROWS, 'lone STAR', 'all', '').map((r) => r.requestNumber).join(), 'R2');
T.check('managers get Source and Customer columns, others do not',
  myReq.columns(true).some((c) => c.headerText === 'Customer') && !myReq.columns(false).some((c) => c.headerText === 'Customer' || c.headerText === 'Source'));
T.eq('date range reads like a person wrote it', myReq.dateRange('2026-11-02', '2026-12-15'), '2 Nov – 15 Dec 2026');

T.section('Request detail: selection, tracker, links');
const Detail = loadAmd(path.join(NEW, 'flows', 'request', 'pages', 'request-detail-page.js'));
const detail = new Detail();
const LINES = [
  { lineId: '1', equipmentName: 'Excavator', lineStatus: 'DEPLOYED', isReturnable: true },
  { lineId: '2', equipmentName: 'Dump truck', lineStatus: 'SHIP_TO_SITE', isReturnable: false },
  { lineId: '3', equipmentName: 'Roller', lineStatus: 'PICK_RELEASED', isReturnable: false },
];
detail.initGridData(LINES);
T.eq('nothing ticked: no action allowed', JSON.stringify(detail.getSelectionStateRaw()), JSON.stringify({ count: 0, sharedStatus: '', isMixed: false, allSelected: false, allDeployed: false, allReturnable: false, allShipToSite: false }));
detail.setRowSelected(1, true);
T.check('a shipped-to-site line allows accept / reject delivery only', detail.getSelectionStateRaw().allShipToSite && !detail.getSelectionStateRaw().allReturnable);
detail.setRowSelected(0, true);
T.check('mixed statuses allow neither', detail.getSelectionStateRaw().isMixed && !detail.getSelectionStateRaw().allShipToSite);
detail.setRowSelected(1, false);
T.check('a deployed line can be returned', detail.getSelectionStateRaw().allReturnable);
detail.setAllSelected(true);
T.check('select all', detail.isAllSelected() && detail.getSelectedLines().length === 3);
T.eq('a new request list clears the selection', detail.initGridData(LINES).length + detail.getSelectedLines().length, 3);
const stateAt = (status, lines) => detail.steps(status, lines).map((s) => s.state[0]).join('');
T.eq('tracker: header IN_PROCESS with a line on site shows On site', stateAt('IN_PROCESS', LINES), 'dddddctt');
T.eq('tracker: a draft', stateAt('DRAFT', []), 'cttttttt');
T.eq('tracker: rejected stops at the review step', detail.steps('REJECTED', []).map((s) => s.state === 'stopped' ? s.label : '').join(''), 'Rejected');
T.eq('line actions only once the request is in operations', ['DRAFT', 'SUBMITTED', 'IN_PROCESS', 'DEPLOYED', 'CLOSED'].map((s) => detail.headerIsConfirmed(s) ? 1 : 0).join(''), '00110');
T.eq('old project request link', detail.oldDetailLink('http://x/', 'REQ-1', 1, false), 'http://x/vp/shell/main/equipment-request-detail?requestId=REQ-1&requestNumericId=1');
T.eq('old customer request link', detail.oldDetailLink('http://x/', 'REQ-2', 2, true), 'http://x/vp/shell/customer-portal/customer-request-detail?requestId=REQ-2&requestNumericId=2');
[['main', 'equipment-request-detail'], ['customer-portal', 'customer-request-detail'], ['main', 'project-quote'], ['customer-portal', 'customer-quote']]
  .forEach(([f, p]) => T.check(`old page ${f}/${p} exists`, pageExists(OLD, f, p)));
const usedFns = new Set();
const chainsDir = path.join(NEW, 'flows', 'request', 'pages', 'request-detail-page-chains');
fs.readdirSync(chainsDir).forEach((f) => {
  (fs.readFileSync(path.join(chainsDir, f), 'utf8').match(/\$page\.functions\.([a-zA-Z]+)/g) || []).forEach((m) => usedFns.add(m.split('.').pop()));
});
T.check('every page function the copied chains call exists in the new page module',
  [...usedFns].every((fn) => typeof detail[fn] === 'function'), [...usedFns].filter((fn) => typeof detail[fn] !== 'function').join(', '));

T.section('every page: the chains it names exist');
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}
walk(NEW).filter((f) => /-page\.json$/.test(f)).forEach((f) => {
  const named = new Set();
  const visit = (o) => {
    if (Array.isArray(o)) { o.forEach(visit); return; }
    if (o && typeof o === 'object') {
      if (typeof o.chain === 'string') { named.add(o.chain); }
      Object.values(o).forEach(visit);
    }
  };
  visit(JSON.parse(fs.readFileSync(f, 'utf8')));
  const dir = f.replace(/\.json$/, '-chains');
  const missing = [...named].filter((c) => !fs.existsSync(path.join(dir, `${c}.js`)));
  T.check(`${path.relative(NEW, f)}: ${named.size} chain(s) found`, !missing.length, missing.join(', '));
});

T.report();
