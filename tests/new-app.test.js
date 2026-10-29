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
const cust = app.visibleNavGroups({ EQR_CUST_CREATE_REQ: 'FULL' }, true, FLAGS, true, {});
T.eq('an item opens for ANY of its page codes (customer create)', ids(cust).join(','), 'new-request');
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
  JSON.stringify(app.getRoleHomeTarget(FLAGS, true, { EQR_WORKBENCH: 'FULL' }, true)), '{"flow":"home","page":"later","params":{"navId":"workbench"}}');
T.eq('nothing at all: No Access', app.getRoleHomeTarget(FLAGS, true, {}, true).page, 'no-access');
T.eq('the later page highlights the item it stands for', app.getNavIdForPage({ id: 'later' }, 'schedule'), 'schedule');
T.eq('Home is gated by EQR_DASHBOARD', app.getPageCodeForPage({ id: 'home' }), 'EQR_DASHBOARD');

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

T.report();
