/*
 * EquipRite Next's toolbar: the global search (resources/js/globalSearch.js), Check availability
 * (resources/js/quickAvailability.js, on the real availability.js) and what both read (resources/js/searchData.js), and
 * the shell page they live in (listeners, chains, functions, VB binding rules). Loads the real modules.
 *
 * Run:  node tests/next-search.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const NEXT = path.join(__dirname, '..', 'webApps', 'equiprite-next');
const JS = path.join(NEXT, 'resources', 'js');
const pending = [];

function load(name, deps) {
  const sandbox = { console, URLSearchParams, Intl, Date, setTimeout, Promise, JSON };
  let mod;
  sandbox.define = (names, factory) => { mod = factory(...names.map((n) => (deps || {})[n])); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(JS, name + '.js'), 'utf8'), sandbox, { filename: name + '.js' });
  return mod;
}

const rules = load('rules');
const nav = load('nav', { 'resources/js/rules': rules });
const tabs = load('tabs', { 'resources/js/nav': nav });
const fmt = load('fmt');
const Progress = load('requestProgress');
const av = load('availability', { 'resources/js/requestProgress': Progress, 'resources/js/rules': rules });
const avData = load('availabilityData');
const reqData = load('requestData', { 'resources/js/rules': rules });
const transferList = load('transferList', { 'resources/js/fmt': fmt, 'resources/js/requestProgress': Progress });
const qav = load('quickAvailability', { 'resources/js/availability': av });
const gs = load('globalSearch', { 'resources/js/requestProgress': Progress, 'resources/js/rules': rules, 'resources/js/fmt': fmt,
  'resources/js/transferList': transferList, 'resources/js/quickAvailability': qav });
// searchData with a stand-in requestData (the real one waits for VB's session roles).
let reqLoads = 0;
let reqFail = false;
const listeners = [];
const reqStub = {
  load: () => { reqLoads++; return Promise.resolve(reqFail ? { rows: [], linesByRequest: {}, linesLoaded: false, error: 'Requests could not be loaded (HTTP 500).' } : REQ_DATA); },
  onChange: (fn) => listeners.push(fn),
};
const data = load('searchData', { 'resources/js/availability': av, 'resources/js/availabilityData': avData, 'resources/js/requestData': reqStub });

// ── Fixtures: Monday 2 November 2026 ───────────────────────────────────────────────────────────────────────────────
const TODAY = '2026-11-02';
const d = (n) => av.addDays(TODAY, n);
const NOW = Date.UTC(2026, 10, 2, 12);
const SERIALS = [
  { id: 1, serialNumber: 'EX-2201', equipmentId: 11, currentLocationId: 501, maintenanceAssetNumber: 'MA-2201', faAssetRefId: '100482' },
  { id: 2, serialNumber: 'EX-2203', equipmentId: 11, currentLocationId: 501 },
  { id: 3, serialNumber: 'EX-2210', equipmentId: 12, currentLocationId: 502, maintenanceAssetNumber: 'MA-2210' },
  { id: 4, serialNumber: 'EX-2211', equipmentId: 12, currentLocationId: 502 },
  { id: 5, serialNumber: 'EX-2212', equipmentId: 12, currentLocationId: 501 },
  { id: 6, serialNumber: 'MC-07', equipmentId: 21, currentLocationId: 502 },
  { id: 7, serialNumber: 'TC-02', equipmentId: 22 },
];
for (let i = 1; i <= 30; i++) SERIALS.push({ id: 100 + i, serialNumber: 'GEN-' + (1000 + i), equipmentId: 31, currentLocationId: 501 });
const MASTERS = [
  { id: 11, equipmentName: 'CAT 320 Excavator', equipmentNumber: 'EQ-0011', equipmentClassId: 1, manufacturer: 'Caterpillar' },
  { id: 12, equipmentName: 'PC210 Excavator', equipmentNumber: 'EQ-0012', equipmentClassId: 1, manufacturer: 'Komatsu' },
  { id: 21, equipmentName: 'Mobile Crane 50t', equipmentNumber: 'EQ-0021', equipmentClassId: 2 },
  { id: 22, equipmentName: 'Tower Crane', equipmentNumber: 'EQ-0022', equipmentClassId: 2 },
  { id: 31, equipmentName: 'Generator 100kVA', equipmentNumber: 'EQ-0031', equipmentClassId: 3 },
  { id: 41, equipmentName: 'Rate Board', equipmentNumber: 'EQ-0041', equipmentClassId: 3 },
];
const CLASSES = [{ id: 1, className: 'Excavators' }, { id: 2, className: 'Cranes' }, { id: 3, className: 'Generators' }];
const LOCATIONS = { 501: { locationName: 'Houston Yard', locationCode: 'HOU-Y1' }, 502: { locationName: 'Odessa', locationCode: 'ODS-Y2' } };
const bk = (id, serial, req, reqId, project, alloc, from, to, extra) => Object.assign({ eqrRequestLineId: id, eqrEquipmentRequestId: reqId, requestNumber: req,
  lineNumber: 1, projectName: project, allocatedSerial: serial, allocStatus: alloc, requestedStartDate: d(from), requestedEndDate: d(to) }, extra || {});
const LINES = [
  bk(9001, 'EX-2201', 'REQ-10511', 511, 'Pipeline North', 'ALLOCATED', -5, 3),     // back on the 5th: tight for a window from the 6th
  bk(9002, 'EX-2203', 'REQ-10530', 530, 'Plant Expansion B', 'ALLOCATED', 2, 20),  // booked across the week
  bk(9003, 'EX-2211', 'REQ-10540', 540, 'Pipeline North', 'PENDING', 10, 12),      // free this week, booked next week
  bk(9004, 'MC-07', 'REQ-10498', 498, 'Harbour Wall', 'ALLOCATED', -20, 30),
  bk(9005, 'EX-2212', 'REQ-10380', 380, 'Old job', 'ALLOCATED', -15, 9),          // returned already (line RETURNED): holds nothing
];
const REQS = [
  { eqrEquipmentRequestId: 1765, requestNumber: 'REQ-1765', status: 'SUBMITTED', startDate: d(6), endDate: d(30), projectName: 'Plant B', requestOrigin: 'Internal',
    requestorName: 'Sam Ortiz', taskName: 'Foundations' },
  { eqrEquipmentRequestId: 1764, requestNumber: 'REQ-1764', status: 'IN_PROCESS', startDate: d(-22), endDate: d(0), projectName: 'EPC_MO_Operations', requestOrigin: 'Internal',
    requestorName: 'Pat Lee', taskName: 'Earthworks' },
  { eqrEquipmentRequestId: 511, requestNumber: 'REQ-10511', status: 'IN_PROCESS', startDate: d(-5), endDate: d(3), projectName: 'Pipeline North', requestOrigin: 'Internal',
    requestorName: 'Pat Lee' },
];
const MY_LINES = [
  { requestNumber: 'REQ-1764', lineNumber: 1, equipmentName: 'Komatsu D65EX-18 Dozer', lineStatus: 'CLOSED' },
  { requestNumber: 'REQ-1764', lineNumber: 2, equipmentName: 'Bobcat S76', lineStatus: 'IN_PROCESS', allocationStatus: 'PENDING' },
  { requestNumber: 'REQ-1765', lineNumber: 1, equipmentName: 'Roller 10t', lineStatus: 'SUBMITTED' },
  { requestNumber: 'REQ-10511', lineNumber: 1, equipmentName: 'CAT 320 Excavator', className: 'Excavators', lineStatus: 'DEPLOYED', allocatedSerial: 'EX-2201' },
  { requestNumber: 'REQ-10380', lineNumber: 1, lineStatus: 'RETURNED' },
];
const REQ_DATA = { rows: REQS, linesByRequest: reqData.indexLines(MY_LINES), linesLoaded: true, manager: true, error: '', at: NOW };
const WORK_ORDERS = { 'MA-2210': [{ WorkOrderNumber: 'WO-55821', WorkOrderType: 'Preventive', PlannedStartDate: d(3) + 'T00:00:00Z', PlannedCompletionDate: d(5) + 'T00:00:00Z' }] };
const ORDERS = [
  { id: 310, orderNumber: 'TO-310', orderType: 'OUTBOUND', orderStatus: 'PENDING', equipmentRequestId: 511, sourceOrgId: 300, destinationOrgId: 400, needByDate: d(1),
    createdDate: d(-6), trackingNumber: '1Z999AA10123456784', carrierName: 'FedEx Freight' },
  { id: 311, orderNumber: 'TO-311', orderType: 'INBOUND', orderStatus: 'PENDING', equipmentRequestId: 1764, sourceOrgId: 400, destinationOrgId: 300, createdDate: d(-1) },
];
const HISTORY = [{ id: 7, transferOrderId: 880, orderNumber: 'INV-TX 882104', destinationRequestId: 1765, sourceRequestNumber: 'REQ-1764', destinationRequestNumber: 'REQ-1765',
  transferDate: d(-2), transferStatus: 'PENDING' }];
const ORGS = [{ organizationId: 300, organizationCode: 'HOU', organizationName: 'Houston Yard' }, { organizationId: 400, organizationCode: 'TXS', organizationName: 'Texas sites' }];

function input(wo) {
  const masterById = {};
  MASTERS.forEach((m) => { masterById[String(m.id)] = m; });
  return { serials: SERIALS, classes: CLASSES, lines: LINES, masterById, locationsById: LOCATIONS, workOrdersByAsset: wo || {},
    requests: REQS, linesByRequest: REQ_DATA.linesByRequest };
}
function fleetOf(wo) {
  const inp = input(wo);
  return { model: av.build(inp, TODAY), serials: SERIALS, masterById: inp.masterById, classes: CLASSES, notes: [], maint: wo ? 'ready' : 'later' };
}
const FLEET = fleetOf(WORK_ORDERS);
const SNAP = { version: 1, requests: REQ_DATA, fleet: FLEET, transfers: { orders: ORDERS, history: HISTORY, orgs: ORGS }, errors: {}, pending: {} };

const CODES = ['EQR_DASHBOARD', 'EQR_EQUIPMENT_REQUESTS', 'EQR_PROJ_CREATE_REQUEST', 'EQR_WORKBENCH', 'EQR_EQUIPMENT_MASTER', 'EQR_EQUIPMENT_SCHEDULE',
  'EQR_INITIATE_PICKING', 'EQR_EQUIPMENT_RETURNS', 'EQR_TIMESHEETS', 'EQR_TIMESHEET_APPROVALS', 'EQR_POST_COST', 'EQR_RATE_SCHEDULE', 'EQR_RENTAL_AGREEMENTS',
  'EQR_ANALYTICS', 'EQR_CONFIGURATIONS', 'EQR_RBAC_ADMIN', 'EQR_CUST_DASHBOARD'];
const ALL = Object.fromEntries(CODES.map((c) => [c, 'FULL']));
const FLAGS = { PROJECTS_MODULE_ENABLED: 'true', TIMESHEETS_ENABLED: 'true', AGREEMENTS_ENABLED: 'true', CUSTOMERS_MODULE_ENABLED: 'true' };
const groupsFor = (map) => nav.visibleGroups(map, true, FLAGS, true, {});
const GROUPS_ALL = groupsFor(ALL);
const A_ALL = gs.accessOf(GROUPS_ALL);
const IDX = gs.index(SNAP, A_ALL, NOW);
const find = (text, o) => gs.search((o && o.idx) || IDX, text, Object.assign({ screens: nav.search(text, (o && o.groups) || GROUPS_ALL), access: (o && o.access) || A_ALL }, o || {}));
const rowsOf = (res) => res.rows.filter((r) => r.type === 'row');
const heads = (res) => res.rows.filter((r) => r.type === 'head').map((r) => r.label).join(',');

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
T.section('who may see what: only what the role may open is searched, and read');
T.eq('full access: screens, requests, the fleet, availability, transfers', JSON.stringify(A_ALL),
  '{"screens":true,"requests":true,"fleet":true,"availability":true,"transfers":true}');
T.eq('... reads requests, the fleet, transfers', JSON.stringify(gs.wants(A_ALL)), '{"requests":true,"fleet":true,"transfers":true}');
const REQUESTOR = { EQR_DASHBOARD: 'FULL', EQR_EQUIPMENT_REQUESTS: 'FULL', EQR_PROJ_CREATE_REQUEST: 'FULL' };
const A_REQ = gs.accessOf(groupsFor(REQUESTOR));
T.eq('a requestor: screens and requests, no fleet, no transfers', JSON.stringify(gs.wants(A_REQ)), '{"requests":true,"fleet":false,"transfers":false}');
T.eq('... and its scopes: Everything, Screens, Requests', gs.scopesOf(A_REQ).map((s) => s.label).join(','), 'Everything,Screens,Requests');
const CUSTOMER = { EQR_DASHBOARD: 'FULL', EQR_CUST_DASHBOARD: 'FULL' };
T.eq('a customer: reads nothing (their portal is theirs)', JSON.stringify(gs.wants(gs.accessOf(groupsFor(CUSTOMER)))), '{"requests":false,"fleet":false,"transfers":false}');
T.eq('before page access loads: nothing at all (fail closed)', JSON.stringify(gs.accessOf(nav.visibleGroups(ALL, false, FLAGS, true, {}))),
  '{"screens":false,"requests":false,"fleet":false,"availability":false,"transfers":false}');
const SCHEDULER = { EQR_DASHBOARD: 'FULL', EQR_EQUIPMENT_SCHEDULE: 'FULL' };
const A_SCHED = gs.accessOf(groupsFor(SCHEDULER));
T.eq('Availability only: the fleet is read (for its counts), not transfers', JSON.stringify(gs.wants(A_SCHED)), '{"requests":true,"fleet":true,"transfers":false}');

T.section('the index: each source');
const kinds = (idx) => Object.keys(idx.counts).sort().map((k) => k + '=' + idx.counts[k]).join(' ');
T.eq('requests, equipment items, classes, units, yards, transfers (one history-only)', kinds(IDX), 'class=3 item=6 request=3 transfer=3 unit=37 yard=2');
T.eq('a requestor\'s index: requests only, though the fleet was read', kinds(gs.index(SNAP, A_REQ, NOW)), 'request=3');
T.eq('a customer\'s index: empty', kinds(gs.index(SNAP, gs.accessOf(groupsFor(CUSTOMER)), NOW)), '');
T.eq('Availability only: equipment, classes, units and yards, no requests', kinds(gs.index(SNAP, A_SCHED, NOW)), 'class=3 item=6 unit=37 yard=2');
T.eq('a source not read yet is left out', kinds(gs.index(Object.assign({}, SNAP, { fleet: null, transfers: null }), A_ALL, NOW)), 'request=3');

T.section('screens, as before');
let res = find('rates');
T.eq('"rates": the Rates screen first', rowsOf(res)[0].label + ' > ' + JSON.stringify(rowsOf(res)[0].open), 'Rates > {"navId":"rates"}');
T.eq('... and nothing else', heads(res), 'Screens');
res = find('rate');
T.eq('"rate": the screen, then the equipment called "Rate Board" (as good a match: screens come first)', heads(res) + ' | ' + rowsOf(res).map((r) => r.label).join(),
  'Screens,Equipment | Rates,Rate Board');
res = find('work');
T.eq('"work": My work first, then the screens whose keywords match', rowsOf(res).slice(0, 2).map((r) => r.label).join(), 'My work,Approve & allocate');

T.section('requests: a number, a project, who asked, the equipment on them');
res = find('1764');
T.eq('"1764": Open request REQ-1764 first, with its id', rowsOf(res)[0].label + ' ' + JSON.stringify(rowsOf(res)[0].open),
  'Open request REQ-1764 {"record":"request","params":{"number":"REQ-1764","id":1764}}');
T.check('... with its project and where it is', /EPC_MO_Operations · /.test(rowsOf(res)[0].sub), rowsOf(res)[0].sub);
T.eq('... no second "Open request" for a request that is there', rowsOf(res).filter((r) => /^Open request/.test(r.label)).length, 1);
res = find('REQ-1764');
T.eq('"REQ-1764" too', rowsOf(res)[0].label, 'Open request REQ-1764');
res = find('176');
T.eq('"176": the requests whose number starts so, then Open request REQ-176', rowsOf(res).filter((r) => r.group === 'requests').map((r) => r.label).join(),
  'REQ-1765,REQ-1764,Open request REQ-176');
const noReqs = gs.index(Object.assign({}, SNAP, { requests: null }), A_ALL, NOW);
res = find('1764', { idx: noReqs });
T.eq('requests still being read: "Open request REQ-1764" first, as the command bar always did', rowsOf(res)[0].label + ' ' + JSON.stringify(rowsOf(res)[0].open),
  'Open request REQ-1764 {"record":"request","params":{"number":"REQ-1764"}}');
res = find('pat lee');
T.eq('"pat lee": the requests Pat Lee asked for', rowsOf(res).map((r) => r.label).join(), 'REQ-1764,REQ-10511');
T.check('... saying so', rowsOf(res)[0].sub.includes('Requested by Pat Lee'), rowsOf(res)[0].sub);
res = find('bobcat');
T.eq('"bobcat": the request with a Bobcat on it', rowsOf(res).map((r) => r.label + ' (' + r.sub + ')').join(), 'REQ-1764 (EPC_MO_Operations · Partly returned · 1 of 2 · Has Bobcat S76)');
res = find('earthworks');
T.eq('a task', rowsOf(res).map((r) => r.label).join(), 'REQ-1764');
const A_NO_REQ = Object.assign({}, A_ALL, { requests: false });
res = find('1764', { access: A_NO_REQ, idx: gs.index(SNAP, A_NO_REQ, NOW) });
T.eq('a role that cannot open Requests is never offered one', rowsOf(res).filter((r) => r.kind === 'request').length, 0);

T.section('equipment: items, classes, units, yards');
res = find('excavator');
T.eq('"excavator": Equipment first (the class, then the items), Units, then the request with one on it', heads(res), 'Equipment,Units,Requests');
T.eq('... the class, then the items', rowsOf(res).filter((r) => r.group === 'equipment').map((r) => r.label).join(), 'Excavators,CAT 320 Excavator,PC210 Excavator');
const cat = rowsOf(res).filter((r) => r.label === 'CAT 320 Excavator')[0];
T.eq('an equipment item opens everything about it (equipment-360)', JSON.stringify(cat.open), '{"record":"equipment-360","params":{"name":"CAT 320 Excavator","equipmentId":"11"}}');
T.eq('... in a tab of its own, keyed by the item', tabs.forRecord(cat.open.record, cat.open.params).id, 'equipment-360:item-11');
T.eq('... and says what is free now', cat.hint + ' | ' + cat.sub, '1 of 2 free now | Excavators · EQ-0011 · 2 units');
const exc = rowsOf(res).filter((r) => r.kind === 'class')[0];
T.eq('a class opens Availability on it', JSON.stringify(exc.open), '{"focus":"availability","what":{"text":"Excavators"}}');
res = find('EX-2201');
T.eq('"EX-2201": the unit first', rowsOf(res)[0].label + ' ' + JSON.stringify(rowsOf(res)[0].open), 'EX-2201 {"record":"equipment-360","params":{"serial":"EX-2201"}}');
T.eq('... its tab', tabs.forRecord('equipment-360', { serial: 'EX-2201' }).id, 'equipment-360:unit-EX-2201');
T.check('... what it is, where, and what it is doing', /CAT 320 Excavator · Houston Yard/.test(rowsOf(res)[0].sub) && /^Out until/.test(rowsOf(res)[0].hint),
  rowsOf(res)[0].sub + ' | ' + rowsOf(res)[0].hint);
res = find('2201');
T.eq('"2201": the unit EX-2201, then the request it is on (no "Open request REQ-2201": something is called that)', rowsOf(res).map((r) => r.label + ' ' + r.sub).join(' | '),
  'EX-2201 CAT 320 Excavator · Houston Yard | REQ-10511 Pipeline North · On site · Has unit EX-2201');
res = find('100482');
T.eq('a unit by its fixed asset number', rowsOf(res).map((r) => r.label).join(), 'EX-2201');
res = find('MA-2210');
T.eq('... by its maintenance asset', rowsOf(res)[0].label, 'EX-2210');
res = find('komatsu');
T.eq('an item by its make; the request with a Komatsu on it; its units', rowsOf(res).map((r) => r.label).join(), 'PC210 Excavator,REQ-1764,EX-2210,EX-2211,EX-2212');
res = find('odessa');
T.eq('a yard: the yard itself first (to Availability), then its units', heads(res) + ' | ' + rowsOf(res).filter((r) => r.kind === 'yard').map((r) => r.label + ' ' + JSON.stringify(r.open)).join(),
  'Yards,Units | Odessa {"focus":"availability","what":{"text":"ODS-Y2"}}');
res = find('excavator', { access: A_SCHED, idx: gs.index(SNAP, A_SCHED, NOW), groups: groupsFor(SCHEDULER) });
T.eq('Availability only: an item opens Availability on it (equipment-360 is Fleet\'s)', JSON.stringify(rowsOf(res).filter((r) => r.kind === 'item')[0].open),
  '{"focus":"availability","what":{"text":"CAT 320 Excavator"}}');
res = find('excavator', { access: A_REQ, idx: gs.index(SNAP, A_REQ, NOW), groups: groupsFor(REQUESTOR) });
T.eq('a requestor: no equipment, no units; only their request with one on it', heads(res) + ' | ' + rowsOf(res).map((r) => r.label).join(), 'Requests | REQ-10511');
res = find('rates', { access: A_REQ, idx: gs.index(SNAP, A_REQ, NOW), groups: groupsFor(REQUESTOR) });
T.eq('... nor the Rates screen it may not open', rowsOf(res).length, 0);

T.section('transfers');
res = find('TO-310');
T.eq('"TO-310": the transfer first, opening its tab', rowsOf(res)[0].label + ' ' + JSON.stringify(rowsOf(res)[0].open), 'TO-310 {"record":"transfer","params":{"number":"TO-310","id":310}}');
T.eq('... what it is, its request and project', rowsOf(res)[0].sub, 'Out to site · REQ-10511 · Pipeline North');
T.eq('... and no "Open request TO-310"', rowsOf(res).filter((r) => /Open request/.test(r.label)).length, 0);
res = find('1Z999AA10123456784');
T.eq('by its tracking number', rowsOf(res).map((r) => r.label).join(), 'TO-310');
res = find('882104');
T.eq('an inter-project transfer on record without an order: opened from its history', JSON.stringify(rowsOf(res)[0].open),
  '{"record":"transfer","params":{"number":"INV-TX 882104","id":880,"source":"history"}}');
res = find('pipeline north');
T.eq('"pipeline north": its requests, then its transfer', heads(res) + ' | ' + rowsOf(res).map((r) => r.label).join(), 'Requests,Transfers | REQ-10511,TO-310');

T.section('ranking and grouping: best first, a few per group, "N more"');
res = find('gen');
T.eq('"gen": equipment (a name starting so) before units (a part of a serial)', heads(res), 'Equipment,Units');
T.eq('Everything: four units, then "26 more units"', rowsOf(res).filter((r) => r.group === 'units').length + ' | ' + res.rows.filter((r) => r.type === 'more').map((r) => r.label + '>' + r.scope).join(),
  '4 | 26 more units>equipment');
T.eq('... the scopes and their counts', res.scopes.map((s) => s.label + ' ' + s.count + (s.on ? '*' : '')).join(', '), 'Everything 33*, Screens 0, Requests 0, Equipment 33');
const ns = res.rows.filter((r) => r.n !== undefined).map((r) => r.n);
T.eq('↑ ↓ run through every match and "more", across the groups', ns.join(), Array.from({ length: res.count }, (_, i) => i).join());
T.check('headings are not chosen', res.rows.filter((r) => r.type === 'head').every((r) => r.n === undefined));
res = find('gen', { scope: 'equipment' });
T.eq('Equipment scope: twelve units, then "18 more units" opening the group', rowsOf(res).filter((r) => r.group === 'units').length + ' | '
  + res.rows.filter((r) => r.type === 'more').map((r) => r.label + '>' + r.expand).join(), '12 | 18 more units>units');
res = find('gen', { scope: 'equipment', expanded: 'units' });
T.eq('... opened: all thirty', rowsOf(res).filter((r) => r.group === 'units').length, 30);
res = find('pat', { scope: 'requests' });
T.eq('Requests scope: requests and transfers only', heads(res), 'Requests');
res = find('rates', { scope: 'screens' });
T.eq('Screens scope: screens only', heads(res) + ' ' + rowsOf(res).map((r) => r.label).join(), 'Screens Rates');
res = find('rates', { scope: 'equipment', access: A_REQ, idx: gs.index(SNAP, A_REQ, NOW), groups: groupsFor(REQUESTOR) });
T.eq('a scope the role does not have falls back to Everything', res.scope, 'all');
res = find('zzzz');
T.eq('nothing: no rows, and the words for the empty line', res.rows.length + ' ' + res.empty, '0 zzzz');

T.section('the foot: what is searched, what is being read, what failed');
T.eq('all read', gs.foot(IDX, SNAP, A_ALL), 'Searching screens, 3 requests, 6 equipment items, 37 units and 3 transfers');
T.eq('still reading', gs.foot(gs.index({}, A_ALL, NOW), { pending: { requests: true, fleet: true, transfers: true }, errors: {} }, A_ALL),
  'Reading requests, equipment and transfers…');
T.eq('transfers failed: left out, in words', gs.foot(gs.index(Object.assign({}, SNAP, { transfers: null }), A_ALL, NOW),
  Object.assign({}, SNAP, { transfers: null, errors: { transfers: 'Transfers could not be read (HTTP 500).' } }), A_ALL),
'Searching screens, 3 requests, 6 equipment items and 37 units · Transfers could not be read, so it is left out');

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
T.section('Check availability: the window');
T.eq('presets on a Monday', qav.presets(TODAY).map((p) => p.key + ' ' + p.from + '..' + p.to).join(' | '),
  'today 2026-11-02..2026-11-02 | week 2026-11-02..2026-11-08 | next 2026-11-09..2026-11-15 | two 2026-11-02..2026-11-15');
T.eq('... on a Saturday: this week is the weekend', qav.presets('2026-10-31').filter((p) => p.key === 'week' || p.key === 'next').map((p) => p.from + '..' + p.to).join(' | '),
  '2026-10-31..2026-11-01 | 2026-11-02..2026-11-08');
T.eq('it opens on today and the six days after', JSON.stringify(qav.defaultWindow(TODAY)), '{"from":"2026-11-02","to":"2026-11-08"}');
T.eq('which preset a window is', [qav.presetOf(d(0), d(0), TODAY), qav.presetOf(d(7), d(13), TODAY), qav.presetOf(d(1), d(3), TODAY)].join(','), 'today,next,');

T.section('Check availability: the answer, on Availability\'s rules');
let ans = qav.answer(FLEET, { text: 'excav', from: d(0), to: d(6), today: TODAY });
T.eq('"excav": both excavators, the one with free units first', ans.rows.map((r) => r.name + ' ' + r.headline).join(' | '), 'PC210 Excavator 2 of 3 free | CAT 320 Excavator 0 of 2 free');
T.eq('... the headline', ans.headline, '2 of 5 units free, 2 – 8 Nov 2026 · 2 equipment items match');
const pc = ans.rows[0];
T.eq('free per yard', pc.yardText, 'Houston Yard 1 · Odessa 1');
T.eq('maintenance noted', pc.notes + ' | ' + pc.maintWhy, '1 in maintenance | EX-2210: Maintenance WO-55821 · 5 – 7 Nov 2026');
T.eq('the bar: free and maintenance', pc.segs.map((s) => s.k + ' ' + s.w).join(', '), 'free 66.7%, maint 33.3%');
const catRow = ans.rows[1];
T.eq('none free says so', catRow.none + ' | ' + catRow.yardText + ' | ' + catRow.notes, 'true | None free in your window | 2 booked');
ans = qav.answer(FLEET, { text: 'excav', from: d(5), to: d(8), today: TODAY });
T.eq('a window after a job ends two days before: free, with a tight turnaround', ans.rows.filter((r) => r.name === 'CAT 320 Excavator').map((r) => r.headline + ' | ' + r.notes + ' | ' + r.tightWhy)[0],
  '1 of 2 free | 1 tight turnaround · 1 booked | Tight turnaround: EX-2201 back from REQ-10511 on 5 Nov');
ans = qav.answer(FLEET, { pick: { kind: 'item', key: 'i:12' }, from: d(7), to: d(13), today: TODAY });
T.eq('a picked item next week: its units one by one, free first', ans.units.map((u) => u.serial + ' ' + u.state).join(', '), 'EX-2212 free, EX-2210 free, EX-2211 booked');
T.check('... a unit back at the yard holds nothing (the line returned), as on Availability', ans.units.some((u) => u.serial === 'EX-2212' && u.state === 'free'));
T.eq('... the headline', ans.headline, 'PC210 Excavator: 2 of 3 free, 9 – 15 Nov 2026');
ans = qav.answer(FLEET, { pick: { kind: 'class', key: 'c:Cranes' }, from: d(0), to: d(6), today: TODAY });
T.eq('a picked class: its items', ans.kind + ' | ' + ans.rows.map((r) => r.name + ' ' + r.headline).join(' | ') + ' | ' + ans.headline,
  'class | Tower Crane 1 of 1 free | Mobile Crane 50t 0 of 1 free | Cranes: 1 of 2 free, 2 – 8 Nov 2026');
T.eq('... a unit without a yard says so', ans.rows[0].yardText, 'No yard recorded 1');
ans = qav.answer(FLEET, { from: d(0), to: d(6), today: TODAY });
T.eq('nothing typed: every class', ans.kind + ' | ' + ans.rows.map((r) => r.name + ' ' + r.headline).join(' | '),
  'classes | Cranes 1 of 2 free | Excavators 2 of 5 free | Generators 30 of 30 free');
const win = av.windowOf(d(0), d(6), TODAY);
const cap = av.capacity(FLEET.model, FLEET.model.units.map((u) => u.id), win);
T.eq('... the same counts as the Availability screen\'s capacity', ans.rows.map((r) => r.name + ' ' + r.avail + '/' + r.total).join(', '),
  cap.classes.map((c) => c.label + ' ' + c.avail + '/' + c.total).join(', '));
ans = qav.answer(FLEET, { text: 'zz top', from: d(0), to: d(6), today: TODAY });
T.eq('nothing matches: says what to try', ans.rows.length + ' ' + ans.headline, '0 Nothing matches “zz top”: try a class, a name or a make.');
T.eq('before the fleet is read: nothing', qav.answer(null, { text: 'excav' }).kind, 'none');
const opts = qav.options(FLEET, 'cran');
T.eq('suggestions: the class first, then the items', opts.map((o) => o.kind + ':' + o.label).join(', '), 'class:Cranes, item:Mobile Crane 50t, item:Tower Crane');
T.eq('a unit the master does not know is an item of its own name', qav.items(fleetOf(null)).length, MASTERS.length);
T.check('without the work orders (still loading), PC210 has 3 free this week', qav.answer(fleetOf(null), { text: 'pc210', from: d(0), to: d(6), today: TODAY }).rows[0].headline === '3 of 3 free');
T.eq('the note: what free means; maintenance still loading', qav.note({ maint: 'later', notes: [] }),
  'Free means no booking and no planned maintenance in EquipRite on those days, as on Availability. Planned maintenance from Fusion is still loading: free counts may still drop.');

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
T.section('searchData: read once, shared, a failed part left out');
pending.push((async () => {
  const calls = [];
  let transfersDown = true;
  const answer = (o) => {
    calls.push(o.endpoint.split('/')[1]);
    const ep = o.endpoint;
    const ok = (body) => Promise.resolve({ ok: true, status: 200, body });
    if (ep.endsWith('getSerialRefs')) return ok({ data: SERIALS, hasMore: false });
    if (ep.endsWith('getEquipmentClasses')) return ok({ data: CLASSES, hasMore: false });
    if (ep.endsWith('getEquipriteV1ViewsWorkbenchLines')) return ok({ data: LINES, hasMore: false });
    if (ep.endsWith('getEquipriteV1EquipmentMaster')) return ok({ data: MASTERS, hasMore: false });
    if (ep.endsWith('getLocationById')) return ok(LOCATIONS[o.uriParams.id]);
    if (ep.endsWith('getTransferOrders')) return transfersDown ? Promise.resolve({ ok: false, status: 500 }) : ok({ data: ORDERS });
    if (ep.endsWith('getTransferHistory')) return ok({ data: HISTORY });
    if (ep.endsWith('getInvOrgs')) return ok({ data: ORGS });
    if (ep.endsWith('getInstalledBaseAssets')) return ok({ items: /MA-2210/.test(o.uriParams.q) ? [{ AssetId: 300100, OperatingOrganizationCode: 'HOU' }] : [] });
    if (ep.endsWith('getMaintenanceWorkOrders')) return ok({ items: /MA-2210/.test(o.uriParams.q) ? WORK_ORDERS['MA-2210'] : [] });
    return ok({ data: [] });
  };
  const ctx = {};
  const Actions = { callRest: (c, o) => answer(o) };
  data.reset();
  const want = gs.wants(A_ALL);
  T.check('nothing read before first use', data.needs(want) && data.snapshot().fleet === null);
  const jobs = data.start(ctx, Actions, want);
  T.eq('three parts started, side by side', jobs.length, 3);
  T.eq('... and while on their way, asked again: the same reads', data.start(ctx, Actions, want).length, 3);
  let snap = await data.ensure(ctx, Actions, want);
  T.eq('... the requests read once', reqLoads, 1);
  T.eq('the Availability screen\'s reads, then the transfers\'', [...new Set(calls)].sort().join(','),
    'getEquipmentClasses,getEquipriteV1EquipmentMaster,getEquipriteV1ViewsWorkbenchLines,getInvOrgs,getLocationById,getSerialRefs,getTransferHistory,getTransferOrders');
  T.eq('requests and the fleet are there; transfers failed, in words', [!!snap.requests, !!snap.fleet, String(snap.transfers), snap.errors.transfers].join(' | '),
    'true | true | null | Transfers could not be read (HTTP 500).');
  T.eq('the fleet is Availability\'s model, built with the requests', snap.fleet.model.units.length + ' units, ' + snap.fleet.model.bookings.length + ' bookings', '37 units, 5 bookings');
  T.eq('... maintenance not read yet (Check availability asks for it)', snap.fleet.maint, 'later');
  const before = calls.length;
  T.check('read again at once: nothing asked (kept a few minutes)', data.start(ctx, Actions, { requests: true, fleet: true }).length === 0 && calls.length === before);
  T.check('... but the failed part is asked again after a while, not at once', !data.needs({ transfers: true }));
  const m = data.startMaintenance(ctx, Actions);
  T.eq('maintenance on its way', data.snapshot().fleet.maint, 'loading');
  await m;
  snap = data.snapshot();
  T.eq('... then the model has it', snap.fleet.maint + ' | ' + snap.fleet.model.bookings.filter((b) => b.kind === 'maintenance').map((b) => b.wo).join(), 'ready | WO-55821');
  T.eq('... and Fusion was asked only for assets it knows', calls.filter((c) => c === 'getMaintenanceWorkOrders').length, 1);
  T.eq('asked once only', data.startMaintenance(ctx, Actions), null);
  listeners.forEach((fn) => fn());
  T.check('a request changed: the requests are read again', data.needs({ requests: true }));
  await data.ensure(ctx, Actions, { requests: true });
  T.eq('... and the fleet is built again with them, keeping its maintenance', data.snapshot().fleet.maint, 'ready');
  data.reset();
  reqFail = true;
  transfersDown = false;
  snap = await data.ensure(ctx, Actions, want);
  T.eq('requests failing: the fleet is still built, the requests left out', [String(snap.requests), !!snap.fleet, !!snap.transfers, snap.errors.requests].join(' | '),
    'null | true | true | Requests could not be loaded (HTTP 500).');
  reqFail = false;
  data.reset();
})());

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
T.section('the shell page: listeners, chains, functions; VB binding rules');
const PAGE = path.join(NEXT, 'pages');
const html = fs.readFileSync(path.join(PAGE, 'shell-page.html'), 'utf8');
const json = JSON.parse(fs.readFileSync(path.join(PAGE, 'shell-page.json'), 'utf8'));
const dir = path.join(PAGE, 'shell-page-chains');
const files = fs.readdirSync(dir).map((f) => f.replace(/\.js$/, ''));
const listenersIn = [...new Set((html.match(/\$listeners\.([A-Za-z]+)/g) || []).map((m) => m.split('.')[1]))];
T.check('every listener in the HTML is declared (' + listenersIn.length + ')', listenersIn.every((l) => json.eventListeners[l]), listenersIn.filter((l) => !json.eventListeners[l]).join());
const named = [...new Set([].concat(...Object.values(json.eventListeners).map((l) => l.chains.map((c) => c.chain))))];
T.check('every chain the page names exists', named.every((c) => files.includes(c)), named.filter((c) => !files.includes(c)).join());
T.check('each chain is a class named like its file', files.every((f) => new RegExp('class ' + f + ' extends ActionChain').test(fs.readFileSync(path.join(dir, f + '.js'), 'utf8'))));
const called = new Set();
files.forEach((f) => (fs.readFileSync(path.join(dir, f + '.js'), 'utf8').match(/chain: '([A-Za-z]+)'/g) || []).forEach((m) => called.add(m.split("'")[1])));
T.check('every chain the chains call exists', [...called].every((c) => files.includes(c)), [...called].filter((c) => !files.includes(c)).join());
T.check('the custom event the page module fires is declared', !!json.events.searchAway && !!json.eventListeners.searchAway);
const bindings = html.match(/\[\[[\s\S]*?\]\]|\{\{[\s\S]*?\}\}/g) || [];
const bad = bindings.filter((b) => /=>|\bfunction\s*\(|\b(String|Number|Boolean)\(|\[\s*[\w$'"]/.test(b.slice(2, -2)));
T.eq('bindings: no arrow functions, String/Number/Boolean or array literals', bad.join(' | '), '');
T.check('no oj-bind-for-each inside table, tbody or select', !/<(table|tbody|select)[^>]*>\s*<oj-bind-for-each/.test(html));
['search', 'qa', 'qaOpen', 'results', 'resultIndex', 'showResults'].forEach((k) => T.check('variable ' + k + ' is declared', !!json.variables[k]));
T.eq('the placeholder says what it searches', (/id="nxCommand"[^>]*placeholder="([^"]+)"/.exec(html) || [])[1], 'Search screens, requests, equipment, units…');
T.check('Check availability sits next to the QR code button, for roles that may open Availability',
  /canOpen\('availability'[\s\S]{0,400}id="nxQa"[\s\S]{0,900}id="nxPhone"/.test(html));
// Checked against the Redwood icon font Next loads (app-flow.json: ojuxIconFont 2507.0.3): every one of these has a glyph.
const FONT_HAS = ['event-available', 'calendar', 'clock-history', 'wrench', 'location-pin', 'barcode', 'box-grid', 'tag', 'inventory-transfer', 'file-text',
  'chevron-down', 'chevron-right', 'search', 'close'];
const usedNew = [...new Set((html + fs.readFileSync(path.join(JS, 'globalSearch.js'), 'utf8')).match(/oj-ux-ico-[a-z0-9-]+/g))]
  .map((i) => i.replace('oj-ux-ico-', '')).filter((i) => ['event-available', 'clock-history', 'wrench', 'location-pin', 'barcode', 'tag', 'chevron-down'].includes(i) || FONT_HAS.includes(i));
T.check('the new icons are ones the font has', usedNew.every((i) => FONT_HAS.includes(i)), usedNew.join());
['bellChain', 'cartChain', 'phoneChain', 'profileChain', 'tabMenuChain', 'dismissChain', 'openChain'].forEach((c) =>
  T.check(c + ' closes Check availability', /qaOpen = false/.test(fs.readFileSync(path.join(dir, c + '.js'), 'utf8'))));
T.check('a click outside (the backdrop) closes it', /\$variables\.phoneOpen \|\| \$variables\.qaOpen/.test(html));
T.check('chains only read: no write endpoint', files.every((f) => !/endpoint: 'eqp-v1\/(post|patch|put|delete|create|update)/i.test(fs.readFileSync(path.join(dir, f + '.js'), 'utf8'))));
const app = JSON.parse(fs.readFileSync(path.join(NEXT, 'app-flow.json'), 'utf8'));
T.check('the stylesheet is imported', app.imports.css.includes('resources/css/next-search.css'));
const css = fs.readFileSync(path.join(NEXT, 'resources', 'css', 'next-search.css'), 'utf8');
T.check('its rules are the search\'s and the panel\'s own (.nx-gs-*, .nx-qa-*, the search box)', (css.match(/^\s*\.[a-z-]+/gm) || []).every((s) => /^\s*\.nx-(gs|qa|results|command)/.test(s)),
  (css.match(/^\s*\.[a-z-]+/gm) || []).filter((s) => !/^\s*\.nx-(gs|qa|results|command)/.test(s)).join());

T.section('the Availability rules are shared, not copied: the mobile copies stay identical');
['availability.js', 'availabilityData.js', 'requestData.js'].forEach((f) => {
  const mob = path.join(__dirname, '..', 'webApps', 'equiprite-mobile', 'resources', 'js', f);
  if (fs.existsSync(mob)) T.check(f + ' unchanged in Mobile\'s copy', fs.readFileSync(mob, 'utf8') === fs.readFileSync(path.join(JS, f), 'utf8'));
});

Promise.all(pending).then(() => T.report(), (e) => { T.check('async checks finished', false, e && e.stack); T.report(); });
