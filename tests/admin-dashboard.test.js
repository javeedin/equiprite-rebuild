/*
 * New EquipRite Home: the Administrator's dashboard (resources/js/adminDashboard.js) and "View as"
 * (app-flow.js dashboardPersonas). Loads the real modules.
 *
 * Run:  node tests/admin-dashboard.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const NEW = path.join(__dirname, '..', 'webApps', 'equiprite');

function loadAmd(file, deps) {
  const sandbox = { console, setTimeout, window: { location: { href: '' } }, document: { querySelectorAll: () => [], body: {} },
    MutationObserver: function () { this.observe = () => {}; } };
  let mod;
  sandbox.define = (names, factory) => { mod = factory(...names.map((n) => (deps && n in deps ? deps[n] : {}))); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: path.basename(file) });
  return mod;
}

const A = loadAmd(path.join(NEW, 'resources', 'js', 'adminDashboard.js'));
const IntegrationHealth = loadAmd(path.join(NEW, 'resources', 'js', 'integrationHealth.js'));
const AppModule = loadAmd(path.join(NEW, 'app-flow.js'), {
  'ojs/ojarraydataprovider': function ADP(data) { this.data = data; },
  'resources/js/lineStatusLabels': { formatLabel: (c) => c },
});
const app = new AppModule();

const NOW = Date.UTC(2026, 9, 29, 10, 0, 0); // 29 Oct 2026
const day = (n) => new Date(NOW + n * 86400000).toISOString().slice(0, 10);
const REQ = (id, status, start, end, extra) => Object.assign({ eqrEquipmentRequestId: id, requestNumber: 'REQ-' + id, status, startDate: start, endDate: end,
  projectName: 'Pipeline North', requestorName: 'Priya', requestOrigin: 'Internal' }, extra || {});
const REQUESTS = [
  REQ(1, 'DRAFT', day(-5), day(10)),                         // stale draft (start passed)
  REQ(2, 'DRAFT', day(5), day(20)),
  REQ(3, 'SUBMITTED', day(2), day(30)),                      // urgent approval, at risk
  REQ(4, 'SUBMITTED', day(20), day(40)),
  REQ(5, 'IN_PROCESS', day(6), day(30)),                     // at risk
  REQ(6, 'PICK_INITIATED', day(1), day(15)),
  REQ(7, 'DEPLOYED', day(-30), day(-4)),                     // overdue 4 days
  REQ(8, 'DEPLOYED', day(-10), day(10)),
  REQ(9, 'SHIP_TO_SITE', day(-20), day(-12), { requestOrigin: 'External', customerName: 'Lone Star', projectName: null }), // overdue 12
  REQ(10, 'RETURN_IN_PROCESS', day(-40), day(-2)),          // returning: not overdue (already on its way back)
  REQ(11, 'CLOSED', day(-60), day(-30)),
  REQ(12, 'SUBMITTED', day(-1), day(10)),                    // urgent (started yesterday, still waiting)
];

T.section('pipeline: every request in one stage, in lifecycle order');
const pipe = A.pipeline(REQUESTS);
T.eq('stage order', pipe.map((s) => s.key).join(','), 'draft,submitted,process,moving,onsite,returning,done');
T.eq('counts', pipe.map((s) => s.count).join(','), '2,3,1,2,2,1,1');
T.eq('the stages add up to every request', pipe.reduce((n, s) => n + s.count, 0), REQUESTS.length);
T.eq('an unknown status counts as in process, not lost', A.pipeline([{ status: 'SOMETHING_NEW' }]).find((s) => s.key === 'process').count, 1);

T.section('request facts: FDD 7.1.3 KPIs and the attention rules');
const f = A.requestFacts(REQUESTS, NOW);
T.eq('active = not draft and not closed', f.active, 9);
T.eq('pending approvals = SUBMITTED', f.submitted, 3);
T.eq('urgent approvals start within 3 days (or already started)', f.urgentApprovals, 2);
T.eq('overdue = out and past the end date, longest first', f.overdue.map((o) => o.request.eqrEquipmentRequestId + ':' + o.days).join(','), '9:12,7:4');
T.eq('a return already on its way is not overdue', f.overdue.some((o) => o.request.eqrEquipmentRequestId === 10), false);
T.eq('at risk = not moving and starting within 7 days, soonest first', f.atRisk.map((o) => o.request.eqrEquipmentRequestId).join(','), '3,5');
T.eq('stale drafts', f.staleDrafts, 1);
T.eq('project / customer split', f.project + '/' + f.customer, '11/1');

T.section('fleet: the Analytics rule (rented / all units)');
const fl = A.fleet([{ groupKey: 'RENTED', count: 30 }, { groupKey: 'AVAILABLE', count: 15 }, { groupKey: 'MAINTENANCE', count: 5 }], (k) => k.toLowerCase());
T.eq('utilisation', fl.utilizationPct, 60);
T.eq('largest status first, labelled', fl.byStatus.map((s) => s.label + ':' + s.count).join(','), 'rented:30,available:15,maintenance:5');
T.eq('no stock data: no utilisation, not 0%', A.fleet([]).utilizationPct, null);

T.section('certificates, locked accounts, changes');
const certs = A.certificates([{ expiryDate: day(-1) }, { expiryDate: day(10) }, { expiryDate: day(90) }, { status: 'EXPIRED' }], NOW);
T.eq('expired and expiring within 30 days', certs.expired + '/' + certs.expiring, '2/1');
T.eq('locked portal users', A.lockedUsers([{ status: 'LOCKED' }, { status: 'ACTIVE' }, { userStatus: 'locked' }]), 2);
T.eq('latest change first', A.changes([{ id: 1, changedDate: '2026-10-01', changeSummary: 'old' }, { id: 2, changedDate: '2026-10-20', changedBy: 'ann', changeSummary: 'new' }])[0].what, 'new');

T.section('the whole Home');
const ih = new IntegrationHealth();
const health = ih.model({
  events: [], errors: [], dlq: [{ id: 1, status: 'OPEN' }, { id: 2, status: 'OPEN' }],
  jobs: [{ id: 9, jobName: 'EQUIP_FUSION_REFRESH', status: 'FAILED', startedAt: new Date(NOW - 3600000).toISOString(), notes: 'Fusion said 401' }],
  syncExceptions: [], lock: null,
}, NOW);
const model = A.build({
  requests: REQUESTS,
  fleetGroups: [{ groupKey: 'RENTED', count: 30 }, { groupKey: 'AVAILABLE', count: 15 }, { groupKey: 'MAINTENANCE', count: 5 }],
  timesheetsSubmitted: 4,
  finance: { weeksToPost: 6, costPending: 12345.6 },
  health,
  dlqOpen: health.kpis.dlq,
  syncExceptions: 0,
  certifications: [{ expiryDate: day(-1) }],
  portalUsers: [{ status: 'LOCKED' }],
  audit: [{ id: 1, changedDate: '2026-10-28T09:00:00Z', changedBy: 'ann', changeSummary: 'TIMESHEETS_ENABLED → true' }],
  appRoles: [{}, {}, {}],
  modules: { PROJECTS_MODULE_ENABLED: true, TIMESHEETS_ENABLED: true },
}, NOW);
T.eq('the FDD 7.1.3 bar plus integrations', model.kpis.map((k) => k.key).join(','), 'active,deployed,approvals,overdue,utilization,integrations');
T.eq('KPI values', model.kpis.map((k) => k.value).join(' | '), '9 | 30 | 3 | 2 | 60% | 0 / ' + health.cards.length);
T.eq('the integrations tile says what is down', model.kpis[5].hint, '1 down');
T.check('every KPI opens a real menu item', model.kpis.every((k) => app.getNavRoute(k.nav) && app.getNavRoute(k.nav).page !== 'later'),
  model.kpis.map((k) => k.nav + '=' + JSON.stringify(app.getNavRoute(k.nav))).join(' '));
T.eq('attention, most severe first', model.attention.map((a) => a.key).join(','),
  'integration-down,overdue,approvals-urgent,certificates,at-risk,dlq,timesheets,post-costs,locked-users,drafts');
T.check('a down integration leads, with the fix', model.attention[0].severity === 'critical' && /down/.test(model.attention[0].title));
T.eq('cost to post in words', model.attention.find((a) => a.key === 'post-costs').detail, '$12,346 incurred and not yet in Fusion Projects.');
T.check('every attention item with a destination opens a menu item (built, or its Old EquipRite stand-in)',
  model.attention.filter((a) => a.nav).every((a) => !!app.getNavRoute(a.nav)), model.attention.map((a) => a.nav).join(','));
T.eq('nothing to do: an empty list', A.build({ requests: [REQ(1, 'CLOSED', day(-9), day(-3))], health: ih.model({}, NOW) }, NOW).attention.length, 0);
T.eq('latest requests, newest first, at most 8', model.recent.map((r) => r.id).slice(0, 3).join(','), '12,11,10');
T.eq('modules on and off', model.modules.filter((m) => m.on).map((m) => m.label).join(','), 'Projects,Timesheets');
T.eq('access', JSON.stringify(model.access), '{"roles":3,"lockedUsers":1}');
T.eq('integration counts read the shared health model', model.integrations.counts.down, 1);

T.section('"View as": who may switch to what');
const personas = (sessionRoles) => app.dashboardPersonas([], sessionRoles).map((p) => p.code).join(',');
T.eq('an Administrator previews every persona', personas(['EQUIP_ADMIN']), 'EQUIP_ADMIN,EQUIP_MGR,REQUESTOR,INSPECTION,TIMEKEEPER,TIME_APPROVER,FINANCE_USER');
T.eq('someone with two personas switches between those two', personas(['EQUIP_MGR', 'TIME_APPROVER']), 'EQUIP_MGR,TIME_APPROVER');
T.eq('one persona: no switcher', personas(['REQUESTOR']), '');
T.eq('a customer is never offered Home personas', personas(['EXTERNAL_REQUESTOR']), '');
T.eq('labels', app.personaLabel('EQUIP_MGR'), 'Equipment Manager');

T.section('Home wiring');
const homeJson = JSON.parse(fs.readFileSync(path.join(NEW, 'flows', 'home', 'pages', 'home-page.json'), 'utf8'));
T.check('View as re-runs Home with the chosen role', JSON.stringify(homeJson.eventListeners.onViewRole).includes('homeInitChain'));
const chain = fs.readFileSync(path.join(NEW, 'flows', 'home', 'pages', 'home-page-chains', 'homeInitChain.js'), 'utf8');
T.check('sign-out and the customer redirect follow the REAL persona, never the previewed one',
  chain.includes('if (shouldSignOut($application, fns, myRole))') && chain.includes('scheduleSignOut($application, fns, myRole);')
  && chain.includes("myRole === 'EXTERNAL_REQUESTOR'"));

T.report();
