/*
 * EquipRite Next, the EquipRite FDD page (webApps/equiprite-next/flows/fdd; resources/js/fddCatalog.js, fddModel.js).
 * Loads the real modules.
 *
 * - the catalog is consistent: ids unique, every requirement has a module, a phase and an FDD section, every flow
 *   step's lane exists, every edge joins two steps, every mapped Next screen is a menu id, every Mobile tab, evidence and
 *   test file exists on disk, every Done names its evidence;
 * - it is judged on EquipRite Next only: no New or Old screens (newApp, oldApp) left, no evidence in their apps, no text
 *   that credits them, tests Next's or Mobile's; the statuses that rest on what Next does not call (transfer orders);
 * - the KPIs add up; every drill lists exactly as many rows as its tile or bar says; Complete %'s shares add up to it;
 *   To reach 100%'s gains and the current % add up to 100; the drill's chips, search, breadcrumb and export;
 * - filters, groups, chips; the mapping's rows and lists; step details; the swimlane SVG;
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
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const near = (a, b) => Math.abs(a - b) < 1e-9;

// Every JS file of Next's flows and resources/js (what Next can call).
function walk(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p, out);
    else if (d.name.endsWith('.js')) out.push(p);
  });
  return out;
}
const NEXT_FILES = walk(path.join(NEXT, 'flows'), walk(JS, [])).filter((f) => !/fddCatalog|fddModel/.test(f));
const NEXT_CODE = NEXT_FILES.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const NEXT_CODE_BUT_RDL = NEXT_FILES.filter((f) => !/requestDetailLines\.js$/.test(f)).map((f) => fs.readFileSync(f, 'utf8')).join('\n');

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

T.section('the catalog: the mapping, checked against Next\'s code');
const KEYS = [].concat(REQ, C.SCENARIOS, C.DECISIONS, C.INTEGRATIONS, C.BEYOND).map((x) => x.id);
T.eq('every item is mapped, and nothing else is', [KEYS.filter((k) => !C.MAPPING[k]).join(), Object.keys(C.MAPPING).filter((k) => !KEYS.includes(k)).join()].join('|'), '|');
const MAP = Object.entries(C.MAPPING);
T.eq('every status is done, partly, none or na', MAP.filter(([, m]) => !['done', 'partly', 'none', 'na'].includes(m.status)).map(([k]) => k).join(), '');
T.eq('every Next screen is a menu id in nav.js', MAP.flatMap(([k, m]) => m.next.filter((id) => !nav.ITEMS[id]).map((id) => k + ':' + id)).join(), '');
T.eq('every Mobile tab exists', MAP.flatMap(([k, m]) => m.mobile.filter((t) => !exists(`webApps/equiprite-mobile/flows/${t}/pages/${t}-page.json`)).map((t) => k + ':' + t)).join(), '');
T.eq('devices are the desktop client and the Android app', MAP.flatMap(([k, m]) => m.device.filter((d) => !['desktop', 'android'].includes(d)).map((d) => k + ':' + d)).join(), '');
T.eq('every evidence file exists on disk', MAP.flatMap(([k, m]) => m.evidence.filter((f) => !exists(f)).map((f) => k + ':' + f)).join(), '');
T.eq('every test named exists', MAP.flatMap(([k, m]) => m.tests.filter((f) => !exists(f)).map((f) => k + ':' + f)).join(), '');
T.eq('every Done names its evidence and a screen (Next, the phone or the device)', MAP.filter(([, m]) => m.status === 'done' && (!m.evidence.length
  || !(m.next.length + m.mobile.length + m.device.length))).map(([k]) => k).join(), '');
T.eq('every Partly done and Not started says what is missing', MAP.filter(([, m]) => (m.status === 'partly' || m.status === 'none') && !m.missing).map(([k]) => k).join(), '');
T.eq('Not started: no Next screen or phone tab claims it', MAP.filter(([, m]) => m.status === 'none' && (m.next.length + m.mobile.length)).map(([k]) => k).join(), '');

T.section('judged on EquipRite Next only');
T.eq('no newApp or oldApp left in the mapping', MAP.filter(([, m]) => 'newApp' in m || 'oldApp' in m).map(([k]) => k).join(), '');
T.check('… nor in the catalog\'s source', !/newApp|oldApp/.test(read('webApps/equiprite-next/resources/js/fddCatalog.js')) && !/newApp|oldApp|newText|oldText/.test(read('webApps/equiprite-next/resources/js/fddModel.js')));
T.eq('no evidence in New or Old EquipRite', MAP.flatMap(([k, m]) => m.evidence.filter((f) => /^webApps\/(equiprite|vbredwoodapp)\//.test(f)).map((f) => k + ':' + f)).join(), '');
const CREDIT = /\b(New|Old) EquipRite\b|\b(New|Old)'s\b|\bin (New|Old)\b(?! request)|\bOld only\b|\bNew records\b|\bOld raises\b/;
T.eq('no "has" or "missing" credits New or Old', MAP.filter(([, m]) => CREDIT.test(m.has + ' ' + m.missing)).map(([k]) => k).join(), '');
const DEVICE_TESTS = ['tests/desktop-devserver.test.js', 'tests/desktop-phone.test.js'];
T.eq('tests are Next\'s or Mobile\'s (the desktop client\'s only for the desktop client)', MAP.flatMap(([k, m]) => m.tests.filter((f) => !/^tests\/(e2e\/)?(next|mobile)-[\w-]+\.(test|e2e)\.js$/.test(f)
  && !(DEVICE_TESTS.includes(f) && m.device.includes('desktop'))).map((f) => k + ':' + f)).join(), '');
const K = M.kpis();
T.check('the page says the numbers are Next\'s, with its phone app, as checked on 31 Oct 2026', /^Judged on EquipRite Next only, as its code stood on 31 Oct 2026/.test(K.judged)
  && /EquipRite Mobile and EquipRite for Android count as Next's phone app/.test(K.judged) && /Old and New EquipRite are not counted/.test(K.judged));
T.check('… and EquipRite Mobile does run on Next\'s resources/js', ['approvalQueue', 'yardWork', 'requestProgress', 'unitPicker'].every((f) =>
  read('webApps/equiprite-mobile/resources/js/' + f + '.js') === read('webApps/equiprite-next/resources/js/' + f + '.js')));
T.check('Next makes no transfer order call (createSupplyRequest, releaseTO, reserveConfirm)', !/ics\/createSupplyRequest|ics\/releaseTO|eqp-v1\/reserveConfirm|eqp-v1\/planConfirm/.test(NEXT_CODE));
T.eq('… so the transfer order integrations are not started in Next', ['INT-04', 'INT-05', 'INT-06'].map((k) => C.MAPPING[k].status).join(), 'none,none,none');
T.eq('… and picking, its scenario and the reservation exception are partly done', ['BR-007', '7.16', 'S13', 'S14', 'DP-02'].map((k) => C.MAPPING[k].status).join(), 'partly,partly,partly,partly,partly');
T.check('Next\'s picking says so (stock goes through Fusion, not here)', /Lines on a transfer order are released through OIC in Fusion[^]*not done here/.test(read('webApps/equiprite-next/flows/yard/pages/picking-page-chains/releaseChain.js')));
T.check('Next never reads the failed transfer-order lines (failedLines): no screen calls requestDetailLines.fetchAndBuild', !/\.fetchAndBuild\(|eqp-v1\/failedLines/.test(NEXT_CODE_BUT_RDL));
T.eq('nothing in Next cancels a request, or uses kit templates', [C.MAPPING.S08.status, C.MAPPING.S05.status].join(), 'none,none');
T.eq('the integrations without a call in services/ are not started', ['INT-13', 'INT-18'].map((k) => C.MAPPING[k].status).join(), 'none,none');
T.check('… and Next\'s code says so (INT-13, INT-18)', /INT-13\) is Fusion and has no endpoint in services/.test(read('webApps/equiprite-next/flows/checks/pages/inspection-page-chains/completeInspectionChain.js'))
  && /inter-org transfer in Oracle Fusion \(INT-18\)/.test(read('webApps/equiprite-next/flows/checks/pages/transfer-page.html')));
T.check('posting costs to PPM (INT-08) is done from Next', C.MAPPING['INT-08'].status === 'done' && /ics\/postCostToFusion/.test(fs.readFileSync(path.join(JS, 'postCostToFusion.js'), 'utf8')));
T.check('a Post costs charge is the direct cost Next posts (INT-17 partly; 7.9 partly)', C.MAPPING['INT-17'].status === 'partly' && C.MAPPING['7.9'].status === 'partly'
  && /createMiscTransaction/.test(read('webApps/equiprite-next/flows/usage/pages/cost-page-chains/miscChain.js')) && /postMiscTransactions/.test(fs.readFileSync(path.join(JS, 'costPosting.js'), 'utf8')));
T.check('… while Next records no consumption (INT-09, INT-16 not started)', ['INT-09', 'INT-16'].every((k) => C.MAPPING[k].status === 'none') && !/eqp-v1\/createInventoryConsumption/.test(NEXT_CODE));
T.eq('BR-011 names the integrations not built in Next', C.MAPPING['BR-011'].missing.match(/\(INT-[^)]*\)/)[0],
  '(' + INT.filter((k) => C.MAPPING[k].status === 'none').map((k, i) => (i ? k.slice(4) : k)).join(', ') + ')');

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
T.section('KPIs: the arithmetic (EquipRite Next)');
const sum = (c) => c.done + c.partly + c.none + c.na;
T.check('requirements: done + partly + not started + n/a = total', sum(K.req) === K.req.total && K.req.total === 34);
T.check('integrations, scenarios, decision points add up', sum(K.ints) === 20 && sum(K.scen) === 34 && sum(K.dps) === 10);
const statusCount = (ids, s) => ids.filter((id) => C.MAPPING[id].status === s).length;
const reqIds = REQ.map((r) => r.id);
T.eq('counts from the mapping', [K.req.done, K.req.partly, K.req.none, K.req.na].join(), ['done', 'partly', 'none', 'na'].map((s) => statusCount(reqIds, s)).join());
T.eq('the Next-only numbers: 8 done, 25 partly, 0 not started, 1 n/a', [K.req.done, K.req.partly, K.req.none, K.req.na].join(), '8,25,0,1');
T.eq('% complete: done counts 1, partly ½, n/a left out', K.req.pct, Math.round((K.req.done + K.req.partly / 2) / (K.req.total - K.req.na) * 100));
T.eq('… 62%', K.req.pct + '%', '62%');
T.eq('the tiles say the same', K.tiles.map((t) => t.key + '=' + t.value).join(), ['total=34', 'done=8', 'partly=25', 'none=0', 'na=1', 'pct=62%', 'reach=+37.9'].join());
T.eq('the second row: in Next, on the phone, integrations, scenarios, decision points', K.tiles2.map((t) => t.key + '=' + t.value).join(' | '),
  'next=33 of 34 | phone=6 of 34 | ints=5 + 4 of 20 | scen=5 + 24 of 34 | dps=0 + 7 of 10');
T.check('no tile for New or Old', !K.tiles.concat(K.tiles2).some((t) => /New|Old/.test(t.label)));
T.eq('in Next: a requirement counts where it has a Next screen', K.inNext, REQ.filter((r) => C.MAPPING[r.id].next.length > 0).length);
T.eq('on the phone: a Mobile tab or the Android app', K.phone, REQ.filter((r) => C.MAPPING[r.id].mobile.length > 0 || C.MAPPING[r.id].device.includes('android')).length);
T.check('the headline says the numbers, for EquipRite Next', K.headline.startsWith('EquipRite Next (with its phone app) has built 62% of the FDD\'s requirements: 8 done, 25 partly done'));
const byMod = M.breakdown('module');
const byPhase = M.breakdown('phase');
T.eq('by module and by phase add up to the total', [byMod.reduce((a, b) => a + b.total, 0), byPhase.reduce((a, b) => a + b.total, 0)].join(), '34,34');
T.check('each bar\'s segments add up to 100%', byMod.concat(byPhase).every((b) => Math.abs(b.segs.reduce((a, s) => a + s.w, 0) - 100) < 0.5));
T.eq('a group with nothing expected says so', byPhase.filter((b) => b.key === 'later')[0].pctText, '—');
T.check('no module or phase uses the key of the "All" chip', !C.MODULES.concat(C.PHASES).some((g) => g.key === 'all'));

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
T.section('the drill: every number lists exactly its items');
const names = { nav: Object.fromEntries(Object.entries(nav.ITEMS).map(([k, v]) => [k, v.label])), open: { picking: true, approvals: true } };
const tileProblems = K.tiles.concat(K.tiles2).map((t) => { const d = M.drill({ source: t.drill }, names); return d && d.rows.length === t.count && d.count === t.count ? '' : t.key + ': ' + t.count + ' vs ' + (d ? d.rows.length : 'none'); }).filter(Boolean);
T.eq('every tile: its count = the rows its drill lists', tileProblems.join(' | '), '');
T.check('… and the count is the number the tile shows', K.tiles.slice(0, 5).every((t) => t.value === String(t.count)) && K.tiles2.every((t) => t.value.endsWith(' of ' + (t.key === 'next' || t.key === 'phone' ? 34 : t.count)))
  && K.tiles.filter((t) => t.key === 'pct' || t.key === 'reach').every((t) => t.note.startsWith(t.count + ' requirements')));
const barProblems = [];
byMod.concat(byPhase).forEach((b) => {
  if (M.drill({ source: b.drill }, names).rows.length !== b.total) barProblems.push(b.drill);
  b.segs.forEach((s) => { const d = M.drill({ source: b.drill, status: s.status }, names); if (d.rows.length !== s.n || d.rows.some((r) => r.status !== s.status)) barProblems.push(b.drill + ':' + s.status); });
});
T.eq('every bar and every segment: its count = the rows its drill lists', barProblems.join(), '');
const dDone = M.drill({ source: 'req:done' }, names);
T.eq('Done: exactly the done requirements', dDone.rows.map((r) => r.id).join(), reqIds.filter((id) => C.MAPPING[id].status === 'done').join());
T.check('… each row: id, title, status, what Next has, its Next screens (open or not), tests, its own entry', dDone.rows.every((r) => r.label && r.title && r.statusLabel === 'Done' && r.has
  && Array.isArray(r.screens) && r.reqLinks.length === 1 && r.reqLinks[0].id === r.id && r.self));
const r7 = M.drill({ source: 'req:partly' }, names).rows.filter((r) => r.id === 'BR-007')[0];
T.eq('a row\'s screens open only where the user may', JSON.stringify(r7.screens), '[{"id":"picking","label":"Picking & shipping","open":true}]');
T.eq('… its phone and its tests by name', r7.phoneText + ' | ' + r7.tests.join(), 'Pick, Android app | next-yard.test.js,next-yard.e2e.js,mobile-pick.test.js,mobile-pick.e2e.js');
const di = M.drill({ source: 'ints' }, names);
T.eq('Integrations: all twenty, the status chips with counts', di.chips.map((c) => c.key + '=' + c.count).join(' '), 'all=20 done=5 partly=4 none=11');
T.eq('… a chip narrows the list', M.drill({ source: 'ints', status: 'partly' }, names).rows.map((r) => r.id).join(), 'INT-03,INT-07,INT-11,INT-17');
T.eq('… an integration links to the requirements that name it', di.rows.filter((r) => r.id === 'INT-06')[0].reqLinks.map((q) => q.id).join(), 'BR-007,BR-011,7.16');
T.eq('a decision point links through its scenario', M.drill({ source: 'dps' }, names).rows.filter((r) => r.id === 'DP-03')[0].reqLinks.map((q) => q.id).join(), 'BR-006,7.12');
T.eq('search: every word must match', M.drill({ source: 'req', text: 'transfer order' }, names).rows.map((r) => r.id).join(), 'BR-007,BR-009,BR-013,7.16');
T.eq('… and it narrows with the chips', M.drill({ source: 'req', text: 'transfer order', module: 'projects' }, names).rows.map((r) => r.id).join(), 'BR-007,BR-009,7.16');
const narrowed = M.drill({ source: 'req:partly', module: 'projects' }, names);
T.eq('the breadcrumb, narrowed to a module', narrowed.crumbs.map((c) => c.label).join(' › '), 'Mapping › Partly done · 25 › Equipment for Projects · 14');
T.check('… the last crumb is where you are', narrowed.crumbs[narrowed.crumbs.length - 1].last && narrowed.crumbs.slice(0, -1).every((c) => !c.last));
T.eq('… the module chips count what each keeps', narrowed.modules.map((c) => c.key + '=' + c.count).join(' '), 'all=25 foundation=7 projects=14 customers=1 cross=3');
const seg = M.drill({ source: 'module:projects', status: 'partly' }, names);
T.eq('a bar segment: the bar, then its status', seg.crumbs.map((c) => c.label).join(' › '), 'Mapping › Equipment for Projects · 16 › Partly done · 14');
T.eq('… with no module chips (it is one module)', seg.modules.length, 0);
T.eq('the summary says how many are shown', [narrowed.summary, M.drill({ source: 'req' }, names).summary].join(' | '), '14 of 25 requirements | 34 requirements');
T.eq('Not started: no row, and it says so', [M.drill({ source: 'req:none' }, names).rows.length, M.drill({ source: 'req:none' }, names).empty].join(), '0,true');
T.eq('an unknown number opens nothing', M.drill({ source: 'nope' }, names), null);
const dp = M.drill({ source: 'phone' }, names);
T.eq('On the phone: what Next does there', dp.rows.map((r) => r.label + ' ' + r.phoneText).join(' | '),
  'BR-004 Request, Approve | BR-007 Pick, Android app | §7.5 Request | §7.6 My requests | §7.8 Approve | §7.16 Pick, Android app');

T.section('the drill: Complete % and To reach 100%');
const dPct = M.drill({ source: 'pct' }, names);
T.eq('Complete %: one row per requirement that applies', dPct.rows.length, K.req.total - K.req.na);
T.check('… each row is its share: done 1, partly ½, not started 0, of 1/33', dPct.rows.every((r) => near(r.share, ({ done: 1, partly: 0.5, none: 0 })[r.status] / 33 * 100)));
T.check('… the shares add up to Complete %', near(dPct.rows.reduce((a, r) => a + r.share, 0), K.req.exact) && Math.round(K.req.exact) === K.req.pct);
T.check('… and the rule is stated', /\(8 \+ ½ × 25\) ÷ 33 × 100 = 62\.1%, shown as 62%/.test(dPct.rule));
const reach = M.drill({ source: 'reach' }, names);
T.eq('To reach 100%: every partly or not started requirement', reach.rows.map((r) => r.id).sort().join(), reqIds.filter((id) => ['partly', 'none'].includes(C.MAPPING[id].status)).sort().join());
T.check('… a partly one adds ½ × 1/33 × 100 points, a not started one 1/33 × 100', reach.rows.every((r) => near(r.gain, (r.status === 'partly' ? 0.5 : 1) / 33 * 100)));
T.check('current % + every gain = 100%', near(K.req.exact + reach.rows.reduce((a, r) => a + r.gain, 0), 100));
T.check('… biggest gain first', reach.rows.every((r, i, a) => !i || a[i - 1].gain >= r.gain));
T.check('… the rule is stated on the page', /adds ½ × 1\/33 × 100 = 1\.52 points; a not started one adds 1\/33 × 100 = 3\.03 points/.test(reach.rule)
  && /these gains add up to the 37\.9 points still to go/.test(reach.rule));
T.eq('… the top five', reach.rows.slice(0, 5).map((r) => r.label + ' ' + r.figure).join(' | '), 'BR-011 +1.52 pts | BR-007 +1.52 pts | §7.16 +1.52 pts | BR-006 +1.52 pts | BR-012 +1.52 pts');
T.check('… the shares shown (two decimals) add up to Complete % within their rounding', Math.abs(dPct.rows.reduce((a, r) => a + parseFloat(r.figure), 0) - K.req.exact) < dPct.rows.length * 0.005);
T.eq('… each with the scenarios and integrations it touches that are not done', reach.rows.filter((r) => r.id === '7.16')[0].touches.map((x) => x.id + ':' + x.status).join(),
  'S13:partly,S14:partly,S15:none,INT-04:none,INT-05:none,INT-06:none');
T.check('… none of them done', reach.rows.every((r) => r.touches.every((x) => x.status === 'partly' || x.status === 'none')));
T.eq('then the integrations and decision points not done, with what each needs', reach.extra.map((r) => r.id).join(),
  INT.concat(C.DECISIONS.map((d) => d.id)).filter((id) => ['partly', 'none'].includes(C.MAPPING[id].status)).join());
T.check('… each says what it needs', reach.extra.every((r) => !!r.needs));
T.eq('the tile says the points still to go', K.tiles.filter((t) => t.key === 'reach')[0].value, '+' + (100 - K.req.exact).toFixed(1));

T.section('the drill: export');
const ex = M.drillExport(narrowed);
T.eq('exactly the rows it shows', ex.rows.map((r) => r.id).join(), narrowed.rows.map((r) => r.id).join());
T.eq('… its columns, every one with a value', ex.columns.map((c) => c.label).join(), 'ID,Kind,Item,Status,What Next has,What is missing,Next screens,On the phone,Tests,Evidence');
T.eq('… no column without its field', ex.columns.filter((c) => !(c.key in ex.rows[0])).map((c) => c.key).join(), '');
T.eq('To reach 100%: the gain and what it touches, then the integrations and DPs', [M.drillExport(reach).rows.length, M.drillExport(reach).columns.map((c) => c.label).slice(4, 6).join()].join(' | '),
  (reach.rows.length + reach.extra.length) + ' | Gain to Complete %,Touches, not done');
T.eq('Complete %: what each counts as and its share', M.drillExport(dPct).columns.map((c) => c.label).slice(4, 6).join(), 'Counts as,Share of Complete %');

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
T.section('requirements: filters, groups, chips');
const rows = M.requirementRows(names);
T.eq('34 rows', rows.length, 34);
const br4 = rows.filter((r) => r.id === 'BR-004')[0];
T.eq('a row: label, module, phase, FDD section, status', [br4.label, br4.moduleLabel, br4.phaseShort, br4.section, br4.statusLabel].join(' | '),
  'BR-004 | Equipment for Projects | 2 Request | 7.5, 7.8 | Done');
T.eq('… its roles and scenarios', br4.roles.join() + ' | ' + br4.scenarios.map((s) => s.id).join(), 'Project Manager,Equipment Manager | S01,S02,S03,S04,S07,S08,S09');
T.eq('… and its Next screens, by their menu labels, and its phone tabs', br4.nextText + ' | ' + br4.phoneText, 'New request, Approve & allocate, Requests | Request, Approve');
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
T.eq('a row: status, Next, the phone, tests', [r716.statusLabel, r716.nextText, r716.phoneText, r716.testCount].join(' | '), 'Partly done | Picking & shipping | Pick, Android app | 4');
T.check('… the evidence is Next\'s, and it says what Next lacks', r716.evidenceText.includes('webApps/equiprite-next/flows/yard/pages/picking-page-chains/releaseChain.js') && /creates, reserves and releases no transfer order/.test(r716.missing));
const mv = M.mapView('integrations', 'none', '', names);
T.eq('integrations not started', mv.rows.map((r) => r.id).join(), 'INT-04,INT-05,INT-06,INT-09,INT-10,INT-13,INT-14,INT-16,INT-18,INT-19,INT-20');
T.eq('… the status chips', mv.chips.map((c) => c.key + '=' + c.count).join(' '), 'all=20 done=5 partly=4 none=11 na=0');
T.eq('… the kinds with their sizes', mv.kinds.map((k) => k.key + '=' + k.count).join(' '), 'requirements=34 integrations=20 scenarios=35 decisions=10 beyond=6 all=105');
T.eq('search across screens, tests and files', M.mapView('all', 'all', 'releaseChain', names).rows.map((r) => r.id).join(), 'BR-007,7.16,INT-04,INT-05,INT-06,S13,S19');
T.eq('pending: every item not started, FDD order', M.pending(names).map((r) => r.id).join(),
  'INT-04,INT-05,INT-06,INT-09,INT-10,INT-13,INT-14,INT-16,INT-18,INT-19,INT-20,S05,S08,S15,S22,S33,DP-01,DP-04,DP-06');
T.eq('partly done, by kind', M.partlyChips(names).map((c) => c.key + '=' + c.count).join(' '), 'requirements=25 integrations=4 scenarios=24 decisions=7');
T.check('partly done rows say what is missing', M.partly('requirements', names).every((r) => !!r.missing));

T.section('exports');
const cols = (v) => M.exportColumns(v).map((c) => c.key);
const exReq = M.exportRequirements(rows.slice(0, 1))[0];
T.eq('requirements: every column has a value', cols('requirements').filter((k) => !(k in exReq)).join(), '');
T.eq('… lists as text', [exReq.rolesText, exReq.scenariosText, exReq.integrationsText].join(' | '), 'Equipment Manager, Project Manager, Finance / AR, Operations Lead | S30, S31 | INT-01, INT-15');
const exFlow = M.flowRows('picking', names);
T.eq('flows: one row per step, every column present', [exFlow.length, cols('flows').filter((k) => !(k in exFlow[0])).join()].join('|'), '14|');
T.eq('mapping: every column present', cols('mapping').filter((k) => !(k in mapReq[0])).join(), '');
T.eq('mapping: the columns, Next only', M.exportColumns('mapping').map((c) => c.label).join(), 'ID,Kind,Item,FDD,Status,EquipRite Next,On the phone,Desktop client,Tests,Evidence,What Next has,What is missing');

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
T.section('flows: list, steps, the diagram');
const list = M.flowList();
T.eq('the list says steps, integrations and how much is built', list.filter((f) => f.id === 'picking')[0].sub, '14 steps · 4 integrations · 29% built');
const info = M.flowInfo('picking');
T.eq('a flow\'s head: what it covers', info.covers, 'S13, S15, S17 · DP-02, DP-03, DP-04 · INT-04, INT-05, INT-06, INT-13');
T.check('… its lanes in words', info.lanes.startsWith('Scheduled job · Equipment · EquipRite · OIC · Fusion Inventory'));
const st = M.stepDetail('picking', 'release', names);
T.eq('a step: number, title, lane, kind', [st.n, st.title, st.laneLabel, st.kindLabel].join(' | '), '6 | Pick release | Fusion Inventory (Inventory, OM, Shipping) | Done by a system');
T.eq('… its integration, in words, with its status in Next', st.ints.map((x) => x.text + ' / ' + x.statusLabel).join(), 'INT-06 Pick release · Shipping · REST, out of EquipRite / Not started');
T.eq('… the FDD status and the stored ones', st.fdd + ' | ' + st.devText, 'PICK_RELEASED | PICK_RELEASED');
T.eq('… neighbours', st.prev + ',' + st.next, 'ok,pick');
T.check('… no New or Old in a step', !('newText' in st) && !('oldText' in st) && 'phoneText' in st);
const pick = M.stepDetail('picking', 'pick', names);
T.eq('a step taken on a Next screen this user may open', JSON.stringify(pick.screens) + ' ' + pick.canOpen, '[{"id":"picking","label":"Picking & shipping","open":true}] true');
T.eq('… on the phone too', pick.phoneText, 'Pick, Android app');
const insp = M.stepDetail('picking', 'inspect', names);
T.eq('… or may not', JSON.stringify(insp.screens.map((s) => s.open)), '[false]');
const dpRate = M.stepDetail('request', 'rate', names);
T.eq('a decision step: its DP and how far it is built', [dpRate.dp.id, dpRate.dp.statusLabel, dpRate.statusLabel].join(' | '), 'DP-01 | Not started | Not started');
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
T.check('… the drill has its chain, as a class named like its file', chains.has('drillChain') && /class drillChain extends ActionChain/.test(fs.readFileSync(path.join(PAGE, 'fdd-page-chains', 'drillChain.js'), 'utf8')));
T.check('listeners are under eventListeners', !!pageJson.eventListeners.onDrillAct && !!pageJson.eventListeners.onDrillSearch && !pageJson.listeners);
const html = fs.readFileSync(path.join(PAGE, 'fdd-page.html'), 'utf8');
const bindings = html.match(/\[\[[\s\S]*?\]\]/g) || [];
T.eq('no arrow functions, String(), Number() or Boolean() in bindings', bindings.filter((b) => /=>|\bString\(|\bNumber\(|\bBoolean\(/.test(b)).join(), '');
T.eq('no array literals in bindings', bindings.filter((b) => /\[\[\s*\[|[(,:]\s*\[/.test(b.slice(2, -2))).join(), '');
T.check('no oj-bind-for-each inside a table, tbody or select', !/<(table|tbody|select)[\s>][\s\S]*?oj-bind-for-each[\s\S]*?<\/\1>/.test(html));
T.eq('every listener the page uses is declared', (html.match(/\$listeners\.(\w+)/g) || []).map((x) => x.split('.')[1]).filter((l) => !pageJson.eventListeners[l]).join(), '');
T.eq('every page function it calls exists', (html.match(/\$functions\.(\w+)/g) || []).map((x) => x.split('.')[1])
  .filter((fn) => !new RegExp('\\b' + fn + '\\(').test(fs.readFileSync(path.join(PAGE, 'fdd-page.js'), 'utf8'))).join(), '');
T.check('the KPI tiles are buttons that open their drill', (html.match(/<button type="button" :class="\[\[ 'nx-kpi fdd-kpi/g) || []).length === 2 && /data-act="open" :data-value="\[\[ k\.data\.drill \]\]"/.test(html));
T.check('the bars and their segments are buttons too', /class="fdd-bar-label" data-act="open"/.test(html) && /<button type="button" :class="\[\[ 'fdd-seg fdd-seg--'/.test(html));
T.check('no New or Old column or card left', !/New EquipRite|Old EquipRite|'New: '|'Old: '|newText|oldText|Elsewhere/.test(html));
const appFlow = JSON.parse(fs.readFileSync(path.join(NEXT, 'app-flow.json'), 'utf8'));
T.check('its stylesheet is registered', appFlow.imports.css.includes('resources/css/next-fdd.css') && fs.existsSync(path.join(NEXT, 'resources', 'css', 'next-fdd.css')));
T.check('the head is the Redwood band (.nx-pagehead) with an Export menu', /class="nx-pagehead"/.test(html) && /id="fddExport"/.test(html));

T.report();
