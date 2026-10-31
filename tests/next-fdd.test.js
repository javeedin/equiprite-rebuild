/*
 * EquipRite Next, the EquipRite FDD page (webApps/equiprite-next/flows/fdd; resources/js/fddCatalog.js, fddModel.js).
 * Loads the real modules.
 *
 * - the catalog is consistent: ids unique, every requirement has a module, a phase and an FDD section, every flow
 *   step's lane exists, every edge joins two steps, every mapped Next screen is a menu id, every New / Old / Mobile
 *   screen and every evidence and test file exists on disk, every Done names its evidence;
 * - the KPIs add up; filters, groups, chips; the mapping's rows and lists; step details; the swimlane SVG;
 * - the menu item (open to every role with an EquipRite screen, not to a customer-only role), and the page's VB rules.
 *
 * Run:  node tests/next-fdd.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const ROOT = path.join(__dirname, '..');
const NEXT = path.join(ROOT, 'webApps', 'equiprite-next');
const JS = path.join(NEXT, 'resources', 'js');

function load(name, deps) {
  const sandbox = { console };
  let mod;
  sandbox.define = (names, factory) => { mod = factory(...names.map((n) => (deps || {})[n])); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(JS, name + '.js'), 'utf8'), sandbox, { filename: name + '.js' });
  return mod;
}

const rules = load('rules');
const nav = load('nav', { 'resources/js/rules': rules });
const C = load('fddCatalog');
const M = load('fddModel', { 'resources/js/fddCatalog': C });
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const uniq = (list) => new Set(list).size === list.length;

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
T.section('the catalog: requirements');
const REQ = C.REQUIREMENTS;
T.eq('14 business requirements (FDD 4.1) and 20 pages (FDD 7)', [REQ.filter((r) => r.kind === 'business').length, REQ.filter((r) => r.kind === 'page').length].join(), '14,20');
T.eq('BR-001 to BR-014, in order', REQ.filter((r) => r.kind === 'business').map((r) => r.id).join(),
  Array.from({ length: 14 }, (_, i) => 'BR-' + String(i + 1).padStart(3, '0')).join());
T.check('ids unique (requirements, scenarios, decisions, integrations, beyond)', uniq([].concat(REQ, C.SCENARIOS, C.DECISIONS, C.INTEGRATIONS, C.BEYOND).map((x) => x.id)));
const MODS = C.MODULES.map((m) => m.key);
const PHASES = C.PHASES.map((p) => p.key);
const badReq = REQ.filter((r) => !MODS.includes(r.module) || !PHASES.includes(r.phase) || !r.section || !r.title || !r.says || !r.priority);
T.eq('every requirement has a module, a phase, an FDD section, a title, what it says, a priority line', badReq.map((r) => r.id).join(), '');
T.eq('the FDD gives no priorities: only BR-010 says one (a future phase)', REQ.filter((r) => r.priority !== 'Not given in the FDD').map((r) => r.id + ':' + r.priority).join(), 'BR-010:Future phase (2.3)');
const SC = C.SCENARIOS.map((s) => s.id);
const INT = C.INTEGRATIONS.map((i) => i.id);
T.eq('every requirement\'s scenarios and integrations exist', REQ.filter((r) => r.scenarios.some((s) => !SC.includes(s)) || r.integrations.some((i) => !INT.includes(i))).map((r) => r.id).join(), '');
T.check('every role named exists', REQ.every((r) => r.roles.every((k) => !!C.ROLES[k])));
T.eq('35 scenarios, 34 of them the FDD\'s (S35 is the redesign\'s)', [C.SCENARIOS.length, C.SCENARIOS.filter((s) => s.inFdd !== false).length].join(), '35,34');
T.eq('DP-01 to DP-10, each on its scenario', C.DECISIONS.map((d) => d.id + (SC.includes(d.scenario) ? '' : '!')).join(), Array.from({ length: 10 }, (_, i) => 'DP-' + String(i + 1).padStart(2, '0')).join());
T.eq('INT-01 to INT-20', INT.join(), Array.from({ length: 20 }, (_, i) => 'INT-' + String(i + 1).padStart(2, '0')).join());

T.section('the catalog: the mapping, checked against the code');
const KEYS = [].concat(REQ, C.SCENARIOS, C.DECISIONS, C.INTEGRATIONS, C.BEYOND).map((x) => x.id);
T.eq('every item is mapped, and nothing else is', [KEYS.filter((k) => !C.MAPPING[k]).join(), Object.keys(C.MAPPING).filter((k) => !KEYS.includes(k)).join()].join('|'), '|');
const MAP = Object.entries(C.MAPPING);
T.eq('every status is done, partly, none or na', MAP.filter(([, m]) => !['done', 'partly', 'none', 'na'].includes(m.status)).map(([k]) => k).join(), '');
T.eq('every Next screen is a menu id in nav.js', MAP.flatMap(([k, m]) => m.next.filter((id) => !nav.ITEMS[id]).map((id) => k + ':' + id)).join(), '');
T.eq('every New EquipRite screen exists', MAP.flatMap(([k, m]) => m.newApp.filter((s) => !exists(`webApps/equiprite/flows/${s.split('/')[0]}/pages/${s.split('/')[1]}-page.json`)).map((s) => k + ':' + s)).join(), '');
T.eq('every Old EquipRite screen exists', MAP.flatMap(([k, m]) => m.oldApp.filter((s) => !exists(`webApps/vbredwoodapp/flows/${s.split('/')[0]}/pages/${s.split('/')[1]}-page.json`)).map((s) => k + ':' + s)).join(), '');
T.eq('every Mobile tab exists', MAP.flatMap(([k, m]) => m.mobile.filter((t) => !exists(`webApps/equiprite-mobile/flows/${t}/pages/${t}-page.json`)).map((t) => k + ':' + t)).join(), '');
T.eq('devices are the desktop client and the Android app', MAP.flatMap(([k, m]) => m.device.filter((d) => !['desktop', 'android'].includes(d)).map((d) => k + ':' + d)).join(), '');
T.eq('every evidence file exists on disk', MAP.flatMap(([k, m]) => m.evidence.filter((f) => !exists(f)).map((f) => k + ':' + f)).join(), '');
T.eq('every test named exists', MAP.flatMap(([k, m]) => m.tests.filter((f) => !exists(f)).map((f) => k + ':' + f)).join(), '');
T.eq('every Done names its evidence and a screen (or the device)', MAP.filter(([, m]) => m.status === 'done' && (!m.evidence.length
  || !(m.next.length + m.newApp.length + m.oldApp.length + m.mobile.length + m.device.length))).map(([k]) => k).join(), '');
T.eq('every Partly done and Not started says what is missing', MAP.filter(([, m]) => (m.status === 'partly' || m.status === 'none') && !m.missing).map(([k]) => k).join(), '');
T.eq('Not started: nothing on any screen claims it', MAP.filter(([, m]) => m.status === 'none' && (m.newApp.length + m.oldApp.length + m.mobile.length)).map(([k]) => k).join(), '');
T.eq('the integrations without a call in services/ are not started', ['INT-13', 'INT-17', 'INT-18'].map((k) => C.MAPPING[k].status).join(), 'none,none,none');
T.check('… and the code says so (INT-13, INT-18)', /INT-13\) has no endpoint in services/.test(fs.readFileSync(path.join(ROOT, 'webApps/equiprite/flows/operations/pages/inspection-page-chains/completeInspectionChain.js'), 'utf8'))
  && /INT-18\) has no call in services/.test(fs.readFileSync(path.join(ROOT, 'webApps/equiprite/flows/operations/pages/transfers-page-chains/createTransferChain.js'), 'utf8')));
T.check('posting costs to PPM (INT-08) is done, from Next too', C.MAPPING['INT-08'].status === 'done' && /ics\/postCostToFusion/.test(fs.readFileSync(path.join(JS, 'postCostToFusion.js'), 'utf8')));

T.section('the catalog: flows');
const FLOWS = C.FLOWS;
T.eq('the flows asked for', FLOWS.map((f) => f.id).join(), 'e2e,request,picking,onsite,returns,procure,maint,customer,integrations');
T.check('flow ids unique', uniq(FLOWS.map((f) => f.id)));
const flowProblems = [];
FLOWS.forEach((f) => {
  if (!uniq(f.steps.map((s) => s.key))) flowProblems.push(f.id + ': step keys repeat');
  if (!uniq(f.lanes)) flowProblems.push(f.id + ': lanes repeat');
  f.lanes.forEach((l) => { if (!C.LANES[l]) flowProblems.push(f.id + ': lane ' + l); });
  const cells = {};
  f.steps.forEach((s) => {
    if (!f.lanes.includes(s.lane)) flowProblems.push(f.id + '.' + s.key + ': lane ' + s.lane);
    if (cells[s.lane + ':' + s.col]) flowProblems.push(f.id + '.' + s.key + ': shares its cell');
    cells[s.lane + ':' + s.col] = 1;
    if (s.map && !C.MAPPING[s.map]) flowProblems.push(f.id + '.' + s.key + ': map ' + s.map);
    (s.navIds || []).forEach((id) => { if (!nav.ITEMS[id]) flowProblems.push(f.id + '.' + s.key + ': nav ' + id); });
    (s.ints || []).forEach((id) => { if (!INT.includes(id)) flowProblems.push(f.id + '.' + s.key + ': ' + id); });
    if (s.dp && !C.DECISIONS.some((d) => d.id === s.dp)) flowProblems.push(f.id + '.' + s.key + ': ' + s.dp);
    if (!['task', 'decision', 'system', 'end', undefined].includes(s.kind)) flowProblems.push(f.id + '.' + s.key + ': kind ' + s.kind);
  });
  (f.edges || []).forEach((e) => {
    if (!f.steps.some((s) => s.key === e.from) || !f.steps.some((s) => s.key === e.to)) flowProblems.push(f.id + ': edge ' + e.from + '→' + e.to);
    (e.ints || []).forEach((id) => { if (!INT.includes(id)) flowProblems.push(f.id + ': edge ' + id); });
  });
});
T.eq('every step\'s lane exists; one step per cell; maps, screens, INT and DP ids exist; edges join steps', flowProblems.join(' | '), '');
T.eq('the integrations map shows all twenty', FLOWS.filter((f) => f.id === 'integrations')[0].steps.filter((s) => /^INT-/.test(s.key)).map((s) => s.key).sort().join(), INT.join());
T.check('the lanes include the parties and the Fusion modules', ['requester', 'manager', 'yard', 'equiprite', 'oic', 'inventory', 'ppm', 'procurement', 'maintenance', 'ar']
  .every((l) => FLOWS.some((f) => f.lanes.includes(l))));
const flowDps = new Set(FLOWS.flatMap((f) => f.steps.map((s) => s.dp).filter(Boolean)));
T.eq('decision points on the diagrams', [...flowDps].sort().join(), 'DP-01,DP-02,DP-03,DP-04,DP-05,DP-06,DP-07,DP-09');

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
T.section('KPIs: the arithmetic');
const K = M.kpis();
const sum = (c) => c.done + c.partly + c.none + c.na;
T.check('requirements: done + partly + not started + n/a = total', sum(K.req) === K.req.total && K.req.total === 34);
T.check('integrations, scenarios, decision points add up', sum(K.ints) === 20 && sum(K.scen) === 34 && sum(K.dps) === 10);
const statusCount = (ids, s) => ids.filter((id) => C.MAPPING[id].status === s).length;
const reqIds = REQ.map((r) => r.id);
T.eq('counts from the mapping', [K.req.done, K.req.partly, K.req.none, K.req.na].join(), ['done', 'partly', 'none', 'na'].map((s) => statusCount(reqIds, s)).join());
T.eq('% complete: done counts 1, partly ½, n/a left out', K.req.pct, Math.round((K.req.done + K.req.partly / 2) / (K.req.total - K.req.na) * 100));
T.eq('the tiles say the same', K.tiles.map((t) => t.key + '=' + t.value).join(), ['total=34', 'done=' + K.req.done, 'partly=' + K.req.partly, 'none=' + K.req.none, 'na=' + K.req.na, 'pct=' + K.req.pct + '%'].join());
T.check('by app: a requirement counts where it has a screen', K.apps.every((a) => a.n <= a.total)
  && K.apps.filter((a) => a.key === 'next')[0].n === REQ.filter((r) => C.MAPPING[r.id].next.length > 0).length);
T.eq('integrations tile', K.tiles2.filter((t) => t.key === 'ints')[0].value, K.ints.done + ' + ' + K.ints.partly + ' of 20');
T.check('the headline says the numbers', K.headline.startsWith(K.req.pct + '% of the FDD\'s requirements are built: ' + K.req.done + ' done, ' + K.req.partly + ' partly done'));
const byMod = M.breakdown('module');
const byPhase = M.breakdown('phase');
T.eq('by module and by phase add up to the total', [byMod.reduce((a, b) => a + b.total, 0), byPhase.reduce((a, b) => a + b.total, 0)].join(), '34,34');
T.check('each bar\'s segments add up to 100%', byMod.concat(byPhase).every((b) => Math.abs(b.segs.reduce((a, s) => a + s.w, 0) - 100) < 0.5));
T.eq('a group with nothing expected says so', byPhase.filter((b) => b.key === 'later')[0].pctText, '—');
T.check('no module or phase uses the key of the "All" chip', !C.MODULES.concat(C.PHASES).some((g) => g.key === 'all'));

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
T.section('requirements: filters, groups, chips');
const names = { nav: Object.fromEntries(Object.entries(nav.ITEMS).map(([k, v]) => [k, v.label])), open: { picking: true, approvals: true } };
const rows = M.requirementRows(names);
T.eq('34 rows', rows.length, 34);
const br4 = rows.filter((r) => r.id === 'BR-004')[0];
T.eq('a row: label, module, phase, FDD section, status', [br4.label, br4.moduleLabel, br4.phaseShort, br4.section, br4.statusLabel].join(' | '),
  'BR-004 | Equipment for Projects | 2 Request | 7.5, 7.8 | Done');
T.eq('… its roles and scenarios', br4.roles.join() + ' | ' + br4.scenarios.map((s) => s.id).join(), 'Project Manager,Equipment Manager | S01,S02,S03,S04,S07,S08,S09');
T.eq('… and its Next screens, by their menu labels', br4.nextText, 'New request, Approve & allocate, Requests');
T.eq('a page requirement shows its section as its id', rows.filter((r) => r.id === '7.16A')[0].label, '§7.16A');
T.eq('search: every word must match', M.filterRequirements(rows, { text: 'inter-org transfer' }).map((r) => r.id).join(), 'BR-009,7.16A');
T.eq('module filter', M.filterRequirements(rows, { module: 'customers' }).map((r) => r.id).join(), 'BR-002,7.3A,7.18');
T.eq('… across modules', M.filterRequirements(rows, { module: 'cross' }).map((r) => r.id).join(), 'BR-011,BR-014,7.1');
T.eq('phase filter', M.filterRequirements(rows, { phase: '3' }).map((r) => r.id).join(), 'BR-006,BR-007,7.12,7.16');
T.eq('kind and phase together', M.filterRequirements(rows, { kind: 'page', phase: '4' }).map((r) => r.id).join(), '7.9,7.13,7.14,7.14A');
T.eq('groups follow the FDD\'s modules, empty ones left out', M.groupByModule(M.filterRequirements(rows, { phase: '1' })).map((g) => g.key + ':' + g.count).join(), 'foundation:4,customers:2');
const view = M.reqView(rows, { module: 'all', phase: '5', kind: 'all', text: '' });
T.eq('the view: summary and the phase chips counted on the other filters', view.summary + ' | ' + view.phase.map((c) => c.key + '=' + c.count).join(' '),
  '2 of 34 requirements match | all=34 1=6 2=7 3=4 4=5 5=2 across=9 later=1');
T.eq('… the module chips counted with the phase', view.module.map((c) => c.key + '=' + c.count).join(' '), 'all=2 foundation=0 projects=2 customers=0 cross=0');
T.eq('nothing filtered: the whole list in words', M.reqView(rows, {}).summary, '34 requirements: 14 business requirements (FDD 4.1) and 20 pages (FDD 7)');

T.section('the mapping: rows, filters, lists');
const mapReq = M.mappingRows('requirements', names);
T.eq('one row per requirement', mapReq.length, 34);
const r716 = mapReq.filter((r) => r.id === '7.16')[0];
T.eq('a row: status, Next, the other apps, tests', [r716.statusLabel, r716.nextText, r716.apps, r716.testCount].join(' | '), 'Partly done | Picking & shipping | Next · New · Old · Mobile · Android app | 4');
T.check('… the evidence and what is missing', r716.evidenceText.includes('releaseTransferOrder.js') && /Confirm in Old/.test(r716.missing));
const mv = M.mapView('integrations', 'none', '', names);
T.eq('integrations not started', mv.rows.map((r) => r.id).join(), 'INT-10,INT-13,INT-14,INT-17,INT-18,INT-19,INT-20');
T.eq('… the status chips', mv.chips.map((c) => c.key + '=' + c.count).join(' '), 'all=20 done=7 partly=6 none=7 na=0');
T.eq('… the kinds with their sizes', mv.kinds.map((k) => k.key + '=' + k.count).join(' '), 'requirements=34 integrations=20 scenarios=35 decisions=10 beyond=6 all=105');
T.eq('search across screens, tests and files', M.mapView('all', 'all', 'createTransferChain', names).rows.map((r) => r.id).join(), 'BR-009,7.16A,INT-05,INT-18,S28');
T.eq('pending: every item not started, FDD order', M.pending(names).map((r) => r.id).join(), 'INT-10,INT-13,INT-14,INT-17,INT-18,INT-19,INT-20,S15,S22,S33,DP-01,DP-04,DP-06');
T.eq('partly done, by kind', M.partlyChips(names).map((c) => c.key + '=' + c.count).join(' '), 'requirements=23 integrations=6 scenarios=24 decisions=6');
T.check('partly done rows say what is missing', M.partly('requirements', names).every((r) => !!r.missing));

T.section('exports');
const cols = (v) => M.exportColumns(v).map((c) => c.key);
const exReq = M.exportRequirements(rows.slice(0, 1))[0];
T.eq('requirements: every column has a value', cols('requirements').filter((k) => !(k in exReq)).join(), '');
T.eq('… lists as text', [exReq.rolesText, exReq.scenariosText, exReq.integrationsText].join(' | '), 'Equipment Manager, Project Manager, Finance / AR, Operations Lead | S30, S31 | INT-01, INT-15');
const exFlow = M.flowRows('picking', names);
T.eq('flows: one row per step, every column present', [exFlow.length, cols('flows').filter((k) => !(k in exFlow[0])).join()].join('|'), '14|');
T.eq('mapping: every column present', cols('mapping').filter((k) => !(k in mapReq[0])).join(), '');

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
T.section('flows: list, steps, the diagram');
const list = M.flowList();
T.eq('the list says steps, integrations and how much is built', list.filter((f) => f.id === 'picking')[0].sub, '14 steps · 4 integrations · 57% built');
const info = M.flowInfo('picking');
T.eq('a flow\'s head: what it covers', info.covers, 'S13, S15, S17 · DP-02, DP-03, DP-04 · INT-04, INT-05, INT-06, INT-13');
T.check('… its lanes in words', info.lanes.startsWith('Scheduled job · Equipment · EquipRite · OIC · Fusion Inventory'));
const st = M.stepDetail('picking', 'release', names);
T.eq('a step: number, title, lane, kind', [st.n, st.title, st.laneLabel, st.kindLabel].join(' | '), '6 | Pick release | Fusion Inventory (Inventory, OM, Shipping) | Done by a system');
T.eq('… its integration, in words, with its status', st.ints.map((x) => x.text + ' / ' + x.statusLabel).join(), 'INT-06 Pick release · Shipping · REST, out of EquipRite / Done');
T.eq('… the FDD status and the stored ones', st.fdd + ' | ' + st.devText, 'PICK_RELEASED | PICK_RELEASED');
T.eq('… neighbours', st.prev + ',' + st.next, 'ok,pick');
const pick = M.stepDetail('picking', 'pick', names);
T.eq('a step taken on a Next screen this user may open', JSON.stringify(pick.screens) + ' ' + pick.canOpen, '[{"id":"picking","label":"Picking & shipping","open":true}] true');
const insp = M.stepDetail('picking', 'inspect', names);
T.eq('… or may not', JSON.stringify(insp.screens.map((s) => s.open)), '[false]');
const dp = M.stepDetail('request', 'rate', names);
T.eq('a decision step: its DP and how far it is built', [dp.dp.id, dp.dp.statusLabel, dp.statusLabel].join(' | '), 'DP-01 | Not started | Not started');
T.check('a development step not in the FDD says so', M.stepDetail('customer', 'quote', names).notInFdd);
T.eq('an unknown step', M.stepDetail('picking', 'nope', names), null);

const svg = M.svg('picking', { selected: 'release' });
const f = FLOWS.filter((x) => x.id === 'picking')[0];
T.eq('the SVG: one clickable step per step, one lane per lane', [(svg.match(/data-step="/g) || []).length, (svg.match(/class="fdd-lane[ "]/g) || []).length].join(), [f.steps.length, f.lanes.length].join());
T.eq('one path per edge', (svg.match(/class="fdd-edge/g) || []).length, f.edges.length);
T.check('integration hops labelled with their INT ids', ['INT-04', 'INT-05', 'yes · INT-06', 'fail · INT-13'].every((t) => svg.includes('>' + t + '<')));
T.check('decision points as diamonds with their DP', (svg.match(/<polygon class="fdd-shape"/g) || []).length === f.steps.filter((s) => s.kind === 'decision').length && svg.includes('>DP-02<'));
T.check('the selected step is marked', /class="fdd-node fdd-node--system fdd-node--on" data-step="release"/.test(svg));
T.check('a dot per mapped step, coloured by its status', (svg.match(/class="fdd-dot fdd-st--/g) || []).length === f.steps.filter((s) => s.map).length);
T.check('loops back are drawn dashed', svg.includes('fdd-edge fdd-edge--back'));
T.check('keyboard and screen readers: tabindex, role and a label on each step', (svg.match(/tabindex="0" role="button" aria-label="Step /g) || []).length === f.steps.length);
T.eq('no undefined or NaN anywhere, in any flow', FLOWS.map((x) => M.svg(x.id, {})).filter((s) => /undefined|NaN/.test(s)).length, 0);
const outside = [];
FLOWS.forEach((x) => {
  const L = M.layout(x);
  Object.entries(L.boxes).forEach(([k, b]) => { if (b.x < 120 || b.x + b.w > L.width || b.y < 0 || b.y + b.h > L.height) outside.push(x.id + '.' + k); });
});
T.eq('every step inside its diagram, right of the lane names', outside.join(), '');
T.eq('an unknown flow draws nothing', M.svg('nope', {}), '');

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
T.section('the menu item');
const it = nav.item('fdd');
T.eq('EquipRite FDD, in Insights, built, its own flow', [it.label, it.group, it.built, JSON.stringify(nav.routeOf(it))].join(' | '), 'EquipRite FDD | insights | true | {"flow":"fdd","page":"fdd","params":{}}');
const FLAGS = { PROJECTS_MODULE_ENABLED: 'true' };
const REQUESTOR = { EQR_DASHBOARD: 'FULL', EQR_EQUIPMENT_REQUESTS: 'FULL' };
T.eq('every role with an EquipRite screen opens it, no page code needed', [nav.itemVisible(it, REQUESTOR, true, FLAGS, true, {}), nav.itemVisible(it, { EQR_TIMESHEETS: 'READ_ONLY' }, true, FLAGS, true, {})].join(), 'true,true');
T.eq('not before access loads, not a role with no page, not a customer-only role', [nav.itemVisible(it, REQUESTOR, false, FLAGS, true, {}), nav.itemVisible(it, {}, true, FLAGS, true, {}),
  nav.itemVisible(it, { EQR_DASHBOARD: 'FULL', EQR_CUST_DASHBOARD: 'FULL' }, true, FLAGS, true, {})].join(), 'false,false,false');
T.eq('the command bar finds it', nav.search('requirements', nav.visibleGroups(REQUESTOR, true, FLAGS, true, {})).map((r) => r.id).join(), 'fdd');
T.eq('… by its name', nav.search('fdd', nav.visibleGroups(REQUESTOR, true, FLAGS, true, {})).map((r) => r.id).join(), 'fdd');

T.section('the page: VB rules');
const PAGE = path.join(NEXT, 'flows', 'fdd', 'pages');
const pageJson = JSON.parse(fs.readFileSync(path.join(PAGE, 'fdd-page.json'), 'utf8'));
const flowJson = JSON.parse(fs.readFileSync(path.join(NEXT, 'flows', 'fdd', 'fdd-flow.json'), 'utf8'));
T.eq('page and flow are embeddable', [pageJson.navigation.embeddable, flowJson.navigation.embeddable].join(), 'enabled,enabled');
const chains = new Set(Object.values(pageJson.eventListeners).flatMap((l) => l.chains.map((c) => c.chain)));
T.eq('every chain the page names exists', [...chains].filter((c) => !fs.existsSync(path.join(PAGE, 'fdd-page-chains', c + '.js'))).join(), '');
const html = fs.readFileSync(path.join(PAGE, 'fdd-page.html'), 'utf8');
const bindings = html.match(/\[\[[\s\S]*?\]\]/g) || [];
T.eq('no arrow functions, String(), Number() or Boolean() in bindings', bindings.filter((b) => /=>|\bString\(|\bNumber\(|\bBoolean\(/.test(b)).join(), '');
T.eq('no array literals in bindings', bindings.filter((b) => /\[\[\s*\[|[(,:]\s*\[/.test(b.slice(2, -2))).join(), '');
T.check('no oj-bind-for-each inside a table, tbody or select', !/<(table|tbody|select)[\s>][\s\S]*?oj-bind-for-each[\s\S]*?<\/\1>/.test(html));
T.eq('every listener the page uses is declared', (html.match(/\$listeners\.(\w+)/g) || []).map((x) => x.split('.')[1]).filter((l) => !pageJson.eventListeners[l]).join(), '');
T.eq('every page function it calls exists', (html.match(/\$functions\.(\w+)/g) || []).map((x) => x.split('.')[1])
  .filter((fn) => !new RegExp('\\b' + fn + '\\(').test(fs.readFileSync(path.join(PAGE, 'fdd-page.js'), 'utf8'))).join(), '');
const appFlow = JSON.parse(fs.readFileSync(path.join(NEXT, 'app-flow.json'), 'utf8'));
T.check('its stylesheet is registered', appFlow.imports.css.includes('resources/css/next-fdd.css') && fs.existsSync(path.join(NEXT, 'resources', 'css', 'next-fdd.css')));
T.check('the head is the Redwood band (.nx-pagehead) with an Export menu', /class="nx-pagehead"/.test(html) && /id="fddExport"/.test(html));

T.report();
