/*
 * New EquipRite, Workbench and Approve & allocate (webApps/equiprite/flows/workbench).
 *
 * Checks the two pages against the old screens they replace:
 *   - the Workbench rows are the old Workbench's rows (WorkbenchInitChain's mapping), split into six stage tabs
 *     whose counts add up, with the right next action and blocker on each row
 *   - the load makes the old stage calls; a failed stage is reported, not hidden
 *   - bulk approve / reject send, request by request, exactly what the old approve / reject chains send for the same
 *     lines (they are run side by side here), and a failure stops only that request
 *   - Approve & allocate's approve / reject chains are Request detail's, unchanged; its gates are the old page's
 *   - saving an allocation writes exactly what the OLD line-detail saveLineChain writes for the same staged
 *     changes (serial, lot and inventory; assign, release, swap), and a confirmed line or a failed write is handled
 *   - copied files are byte-identical, every endpoint exists in services/, every listener and chain is wired
 *
 * Run:  node tests/workbench.test.js
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
const FLOW = path.join(NEW, 'flows', 'workbench');
const PAGES = path.join(FLOW, 'pages');
const WB_CHAINS = path.join(PAGES, 'workbench-page-chains');
const AA_CHAINS = path.join(PAGES, 'approve-allocate-page-chains');
const NEW_JS = path.join(NEW, 'resources', 'js');
const OLD_JS = path.join(OLD, 'resources', 'js');

function loadAmd(file, deps) {
  const sandbox = {
    console, setTimeout, Promise, Intl, window: { location: { href: '' } },
    document: { querySelectorAll: () => [], body: {} }, MutationObserver: function () { this.observe = () => {}; },
  };
  let mod;
  sandbox.define = (names, factory) => { mod = factory(...names.map((n) => (deps && n in deps ? deps[n] : {}))); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: path.basename(file) });
  return mod;
}
const read = (f) => fs.readFileSync(f, 'utf8');
const json = (v) => JSON.stringify(v);

const AppModule = loadAmd(path.join(NEW, 'app-flow.js'), {
  'ojs/ojarraydataprovider': function ADP(data) { this.data = data; },
  'resources/js/lineStatusLabels': { formatLabel: (c) => c },
});
const app = new AppModule();
const lineBody = loadAmd(path.join(NEW_JS, 'requestLineBody.js'));
const rdl = loadAmd(path.join(NEW_JS, 'requestDetailLines.js'));
const ldu = loadAmd(path.join(NEW_JS, 'lineDetailUnits.js'));
const lineConfirmed = loadAmd(path.join(NEW_JS, 'lineConfirmed.js'));
const cu = { auditHeaders: () => ({ 'X-User-Id': 'priya.raman' }) };
const WbPage = loadAmd(path.join(PAGES, 'workbench-page.js'));
const AaPage = loadAmd(path.join(PAGES, 'approve-allocate-page.js'));
const wb = new WbPage();

// ── Fake backend: Actions that record every call and answer from `answer(endpoint, opts, n)` ──────────────────────
function backend(answer) {
  const calls = [];
  const toasts = [];
  const chains = [];
  const navs = [];
  const Actions = {
    async callRest(_c, o) {
      calls.push({ endpoint: o.endpoint, uriParams: o.uriParams, body: o.body, headers: o.headers });
      const r = answer ? answer(o.endpoint, o, calls.length) : undefined;
      return r || { ok: true, status: 200, body: { data: [] } };
    },
    async fireNotificationEvent(_c, n) { toasts.push(n); },
    async callChain(_c, c) { chains.push(c); return { ok: true }; },
    async callComponentMethod(_c, m) { chains.push({ component: m.selector, method: m.method }); },
    async navigateToPage(_c, n) { navs.push(Object.assign({ kind: 'page' }, n)); },
    async navigateToFlow(_c, n) { navs.push(Object.assign({ kind: 'flow' }, n)); },
  };
  return { calls, toasts, chains, navs, Actions };
}
const ok = (data, extra) => ({ ok: true, status: 200, body: Object.assign({ data }, extra || {}) });
const isWrite = (c) => /^eqp-v1\/(patch|create|update|delete|replace)/.test(c.endpoint);
const now = (b) => (b ? JSON.parse(JSON.stringify(b).replace(/"(allocatedDate|releasedDate)":"[^"]+"/g, '"$1":"NOW"')) : b);
const writes = (calls) => calls.filter(isWrite).map((c) => ({ endpoint: c.endpoint, uriParams: c.uriParams, body: now(c.body) }));

function appContext(extra) {
  return {
    functions: app,
    currentPage: { id: 'workbench' },
    variables: Object.assign({
      flagsLoaded: true, pageAccessLoaded: true, featureFlags: { CUSTOMERS_MODULE_ENABLED: 'true' },
      pageAccessMap: { EQR_WORKBENCH: 'FULL' }, globalSettings: { ENABLE_QUOTES: 'CUSTOMER' },
    }, extra || {}),
  };
}

// ── Workbench rows ───────────────────────────────────────────────────────────────────────────────────────────
const RAW = [
  { eqrEquipmentRequestId: 10, requestNumber: 'REQ-10', requestStatus: 'SUBMITTED', source: 'INTERNAL', projectName: 'Pipeline North', taskName: '2.1',
    requestor: 'Priya', requestedStartDate: '2026-11-04T00:00:00Z', requestedEndDate: '2026-11-30T00:00:00Z', totalLines: 3, allocatedLines: 0, totalEstCost: 80000 },
  { eqrEquipmentRequestId: 10, requestNumber: 'REQ-10', requestStatus: 'SUBMITTED', source: 'INTERNAL', projectName: 'Pipeline North' },
  { eqrEquipmentRequestId: 11, requestNumber: 'REQ-11', requestStatus: 'SUBMITTED', source: 'EXTERNAL', projectName: 'Gulf Coast', customerName: 'Gulf Coast',
    requestedStartDate: '2026-11-02T00:00:00Z', totalLines: '2', allocatedLines: null, totalEstCost: '37200' },
  { eqrEquipmentRequestId: 12, requestNumber: 'REQ-12', requestStatus: 'IN_PROCESS', source: 'EXTERNAL', projectName: 'EPC_ MO_Operations', customerName: 'US Navy',
    requestedStartDate: '2026-11-10T00:00:00Z', totalLines: 4, allocatedLines: 1, totalEstCost: 5000, contactName: 'Ann' },
  { eqrEquipmentRequestId: 13, requestNumber: 'REQ-13', requestStatus: 'QUOTE_GENERATED', source: 'CUSTOMER', projectName: 'Acme', customerName: 'Acme', totalLines: 1, allocatedLines: 0 },
  { eqrEquipmentRequestId: 14, requestNumber: 'REQ-14', requestStatus: 'IN_PROCESS', source: 'INTERNAL', projectName: 'Plant B', totalLines: 2, allocatedLines: 2, allocationPct: 100,
    requestedStartDate: '2026-11-01T00:00:00Z' },
  { requestNumber: 'NO-ID' },
];
const isExt = (s) => app.isExternalSource(s);
const quoting = (s) => app.isQuotingAllowed({ ENABLE_QUOTES: 'CUSTOMER' }, true, s);

T.section('Workbench rows: the old WorkbenchInitChain mapping');
const rows = wb.mapRequests(RAW, isExt, quoting);
const byNo = (n) => rows.find((r) => r.request_number === n);
T.eq('one row per request, rows without an id dropped, newest first', rows.map((r) => r.request_number).join(','), 'REQ-14,REQ-13,REQ-12,REQ-11,REQ-10');
T.eq('internal: project and task', byNo('REQ-10').project + ' / ' + byNo('REQ-10').task, 'Pipeline North / 2.1');
T.eq('external with the customer mirrored into projectName: no project, the customer', json([byNo('REQ-11').project, byNo('REQ-11').customer]), '["","Gulf Coast"]');
T.eq('external with an assigned project keeps it', byNo('REQ-12').project, 'EPC_ MO_Operations');
T.eq('requestor falls back to the contact', byNo('REQ-12').requestor, 'Ann');
T.eq('allocation % from the line counts; strings and nulls are numbers', json([byNo('REQ-12').allocation_pct, byNo('REQ-11').allocation_pct, byNo('REQ-11').lines]), '[25,0,2]');
T.eq('a server percentage wins', byNo('REQ-14').allocation_pct, 100);
T.eq('legacy CUSTOMER origin is external', byNo('REQ-13').origin, 'EXTERNAL');
T.eq('quote owed: customer origin with ENABLE_QUOTES=CUSTOMER until a quote exists', json(rows.map((r) => r.quote_owed)), '[false,false,true,true,false]');
T.eq('dates as days, "-" when missing', json([byNo('REQ-10').start_date, byNo('REQ-10').end_date, byNo('REQ-13').start_date]), '["2026-11-04","2026-11-30","-"]');

T.section('Workbench tabs: every request in exactly one tab');
const pickRows = wb.mapRequests([RAW[5]], isExt, quoting);
const deployed = wb.mapRequests([{ eqrEquipmentRequestId: 20, requestNumber: 'REQ-20', requestStatus: 'DEPLOYED', source: 'INTERNAL', totalLines: 1, allocatedLines: 1 }], isExt, quoting);
const procurement = wb.procurementRows([
  { requestNumber: 'REQ-12', equipmentName: 'Tower Crane', estimatedCost: 100, lineStartDate: '2026-11-12T00:00:00Z' },
  { requestNumber: 'REQ-12', equipmentName: 'Hoist', estimatedCost: 50 },
  { requestNumber: 'REQ-99', equipmentName: 'Barge', requestor: 'Lee' },
], rows);
const B = wb.buckets({ outbound: rows, pick: pickRows, deployed, inbound: [], procurement });
T.eq('To approve = submitted; To pick = the INITIATE queue; Outbound = the rest of outbound (not what is in To pick)',
  json([B.approve.map((r) => r.request_number), B.pick.map((r) => r.request_number), B.outbound.map((r) => r.request_number)]),
  '[["REQ-11","REQ-10"],["REQ-14"],["REQ-13","REQ-12"]]');
T.eq('To approve sorted by start date, soonest first', B.approve[0].request_number, 'REQ-11');
T.eq('tab counts and which ones call for action', json(wb.tabs(B).map((t) => `${t.key}:${t.count}${t.hot ? '!' : ''}`)),
  '["approve:2!","pick:1!","outbound:2","deployed:1","inbound:0","procurement:2!"]');
T.eq('procurement lines group by request and borrow its id and status', json([procurement[0].request_id, procurement[0].status, procurement[0].procurement_lines, procurement[0].equipment]),
  '[12,"IN_PROCESS",2,"Tower Crane, Hoist"]');
T.eq('a procurement request not in any stage has no id, so no Review', json([procurement[1].request_id, wb.nextAction(procurement[1], 'procurement').target]), '[null,"none"]');
T.eq('source chip', wb.filterRows(rows, '', 'EXTERNAL').map((r) => r.request_number).join(), 'REQ-13,REQ-12,REQ-11');
T.eq('search across number, project, customer, requestor, task (any word)', wb.filterRows(rows, 'navy pipeline', '').map((r) => r.request_number).join(), 'REQ-12,REQ-10');

T.section('Workbench next action and blockers');
T.eq('To approve: Review in Approve & allocate', json(wb.nextAction(byNo('REQ-10'), 'approve')), '{"label":"Review","target":"approve-allocate","tone":"dark"}');
T.eq('To pick: Initiate picking (menu item)', json([wb.nextAction(pickRows[0], 'pick').target, wb.nextAction(pickRows[0], 'pick').navId]), '["nav","picking"]');
T.eq('Outbound in process and unallocated: Allocate', wb.nextAction(byNo('REQ-12'), 'outbound').label, 'Allocate');
T.eq('Outbound quote generated: opens Request detail', wb.nextAction(byNo('REQ-13'), 'outbound').target, 'request-detail');
T.eq('Inbound: Receipt & returns', wb.nextAction(deployed[0], 'inbound').navId, 'receipt');
T.eq('blockers say what holds a row up', json([wb.blocker(byNo('REQ-11'), 'approve'), wb.blocker(byNo('REQ-12'), 'outbound'), wb.blocker(byNo('REQ-13'), 'outbound'), wb.blocker(procurement[0], 'procurement')]),
  '["Quote owed before allocation","Quote owed before allocation","Customer has not accepted the quote","2 lines waiting on a PO"]');
T.eq('an internal unallocated row: lines not allocated', wb.blocker(Object.assign({}, byNo('REQ-12'), { quote_owed: false }), 'outbound'), '3 of 4 lines not allocated');
T.eq('the request number opens Approve & allocate while approval or allocation is open',
  ['SUBMITTED', 'IN_PROCESS', 'QUOTE_ACCEPTED', 'QUOTE_GENERATED', 'DEPLOYED'].map((s) => wb.detailTarget({ status: s })).join(','),
  'approve-allocate,approve-allocate,approve-allocate,request-detail,request-detail');
T.eq('stage summary: To approve', wb.stageSummary('approve', B.approve), '2 requests · 5 lines · $117,200 estimated · 1 owe a quote');
T.eq('stage summary: Outbound needing allocation', wb.stageSummary('outbound', B.outbound), '2 requests · 1 need allocation (3 lines)');
T.eq('selection: the consequence before the click', wb.selectionSummary(B.approve, [10, '11', 999]).text, '2 selected · 1 project, 1 customer · 5 lines · $117,200 estimated');
T.eq('dates read like a person wrote them', json([wb.dateRange('2026-11-04', '2026-11-30'), wb.dateRange('2026-11-06', '2027-01-06'), wb.dateRange('-', '-')]),
  '["4 Nov – 30 Nov 2026","6 Nov 2026 – 6 Jan 2027","—"]');
T.eq('how soon it starts', json(['2026-11-03', '2026-10-29', '2026-10-30', '2026-10-27'].map((d) => wb.startHint(d, '2026-10-29'))),
  '["starts in 5 days","starts today","starts tomorrow","started 2 days ago"]');
T.eq('late = starting today or earlier', json([wb.isLate('2026-10-29', '2026-10-29'), wb.isLate('2026-10-30', '2026-10-29')]), '[true,false]');
T.eq('old quote page link', wb.oldQuoteLink('http://x', byNo('REQ-11')), 'http://x/vp/shell/equipment-foundation/request-quote?requestId=11&requestNumber=REQ-11&sourcePage=request-detail');
T.check('old quote page exists', fs.existsSync(path.join(OLD, 'flows', 'equipment-foundation', 'pages', 'request-quote-page.json')));

// ── Approve & allocate page module ───────────────────────────────────────────────────────────────────────────
T.section('Approve & allocate: gates (old equipment-foundation request-detail-page.js)');
const aa = new AaPage();
const L = (no, status, extra) => Object.assign({ line_id: 900 + no, line_no: no, lineId: String(900 + no), lineStatus: status, line_status: status,
  equipment_name: 'Eq ' + no, equipmentName: 'Eq ' + no, qty: 1, alloc_status: 'PENDING', is_serial_controlled: true, availability: 'AVAILABLE', est_cost: 100 }, extra || {});
const SUB = { status: 'SUBMITTED', isCustomer: false };
const INP = { status: 'IN_PROCESS', isCustomer: false };
T.eq('submitted: allocation opens after approval', json(aa.lineAction(L(1, 'SUBMITTED'), SUB, false, false)), '{"kind":"blocked","label":"Allocate","reason":"Opens once the request is approved."}');
T.eq('in process: allocate', aa.lineAction(L(1, 'IN_PROCESS'), INP, false, false).kind, 'allocate');
T.eq('quote owed (quoting on, no quote yet): blocked', aa.lineAction(L(1, 'IN_PROCESS'), INP, true, false).reason, 'Opens once the quote is generated.');
T.eq('quote accepted: a quote exists, allocation open', aa.lineAction(L(1, 'IN_PROCESS'), { status: 'QUOTE_ACCEPTED' }, true, false).kind, 'allocate');
T.eq('customer line under procurement is viewable while gated', aa.lineAction(L(1, 'UNDER_PROCUREMENT'), { status: 'SUBMITTED', isCustomer: true }, false, false).kind, 'view');
T.eq('rejected lines take no action', aa.lineAction(L(1, 'REJECTED'), INP, false, false).kind, 'none');
T.eq('free stock: nothing to allocate', aa.lineAction(L(1, 'IN_PROCESS', { is_serial_controlled: false }), INP, false, false).reason, 'Free stock: no units to allocate.');
T.eq('an F&M line is allocatable', aa.lineAction(L(1, 'IN_PROCESS', { is_serial_controlled: false, fulfilment_class: 'F_AND_M' }), INP, false, false).kind, 'allocate');
T.eq('read-only role: view only', aa.lineAction(L(1, 'IN_PROCESS'), INP, false, true).kind, 'view');
T.eq('tracking', [L(1), L(2, '', { is_serial_controlled: false, is_lot_controlled: true }), L(3, '', { is_serial_controlled: false, is_inventory_tracked: true }),
  L(4, '', { is_serial_controlled: false })].map((l) => aa.tracking(l)).join(','), 'Serial,Lot,Quantity,Free stock');

T.section('Approve & allocate: what a click will do, the verdict, the steps');
const subLines = [L(1, 'SUBMITTED'), L(2, 'SUBMITTED', { availability: 'NOT AVAILABLE' }), L(3, 'REJECTED')];
aa.initGridData(subLines);
T.eq('nothing ticked: Approve acts on every open line', json(aa.decisionPlan('approve', subLines, 0)), '{"count":2,"all":true,"label":"Approve all 2 lines","settled":1}');
aa.setRowSelected(0, true);
T.eq('one ticked: on that line only', aa.decisionPlan('approve', subLines, 1).label, 'Approve 1 line');
T.eq('reject skips settled lines', aa.decisionPlan('reject', subLines, 0).label, 'Reject all 2 lines');
const v1 = aa.verdict(SUB, subLines, false);
T.check('verdict: ready, what approval does, what is unavailable', v1.tone === 'warn' && v1.text.includes('Ready to approve: 2 of 3 lines') && v1.text.includes('Line 2 is not available for its dates'), v1.text);
const inLines = [L(1, 'IN_PROCESS', { alloc_status: 'ALLOCATED' }), L(2, 'IN_PROCESS'), L(3, 'IN_PROCESS', { is_serial_controlled: false })];
T.check('verdict: what still needs units', aa.verdict(INP, inLines, false).text.startsWith('1 of 2 lines allocated. Line 2 still needs units'), aa.verdict(INP, inLines, false).text);
T.check('verdict: all allocated, next is picking', aa.verdict(INP, [inLines[0], inLines[2]], false).text.includes('Next: Initiate picking'));
T.eq('steps: submitted, allocating, ready to pick', [aa.steps('SUBMITTED', false, subLines), aa.steps('IN_PROCESS', false, inLines), aa.steps('IN_PROCESS', false, [inLines[0]])]
  .map((s) => s.map((x) => x.state[0]).join('')).join(' '), 'ctt dct ddc');
T.eq('old Workbench request link', aa.oldDetailLink('http://x/', 'REQ-1', 7),
  'http://x/vp/shell/equipment-foundation/request-detail?requestNumber=REQ-1&requestId=7&sourcePage=Equipment%20Workbench');
T.eq('dates', json([aa.dateRange('2026-11-08', '2026-11-22'), aa.dateRange('2026-11-06', '2026-12-06'), aa.dateRange('2026-12-30', '2027-01-02')]),
  '["8 – 22 Nov 2026","6 Nov – 6 Dec 2026","30 Dec 2026 – 2 Jan 2027"]');
T.eq('availability tone', ['AVAILABLE', 'PARTIAL DURATION', 'NOT AVAILABLE', ''].map((a) => aa.availTone(a)).join(','), 'ok,part,none,unknown');

// ── Unit picker staging ──────────────────────────────────────────────────────────────────────────────────────
T.section('Approve & allocate: staging units (old line-detail page module)');
const LINE_DATA = { line_id: 9031, line_no: 1, equipment_master_id: 11, equipment_name: 'CAT 320', class: 'Excavators', qty: 2,
  start_date: '2026-11-08', end_date: '2026-11-22', line_status: 'IN_PROCESS', quoting_on: false, request_number: 'REQ-503' };
const unitRow = (type, ref, no, extra) => Object.assign({ lineId: 9031, unitType: type, unitRefId: ref, unitNumber: no, invOrgId: 300, invOrgName: 'Houston Yard' },
  type === 'SERIAL' ? { serialRefId: ref } : (type === 'LOT' ? { lotRefId: ref } : { inventoryItemRefId: ref }), extra || {});
const SERIALS = [
  unitRow('SERIAL', 701, 'EX-2201', { availabilityStatus: 'NOT AVAILABLE' }),
  unitRow('SERIAL', 702, 'EX-2203', { availabilityStatus: 'AVAILABLE' }),
  unitRow('SERIAL', 703, 'EX-2210', { availabilityStatus: 'AVAILABLE', invOrgId: 310, invOrgName: 'Dallas Yard' }),
  unitRow('SERIAL', 704, 'EX-2214', { availabilityStatus: 'AVAILABLE', allocationId: 8704, allocationStatus: 'ALLOCATED', allocatedQty: 1 }),
];
const BOOKINGS = [{ unitRefId: 701, bookingRequestNumber: 'REQ-482', bookingStartDate: '2026-10-28', bookingEndDate: '2026-11-12' },
  { unitRefId: 703, bookingRequestNumber: 'REQ-511', bookingStartDate: '2026-11-25', bookingEndDate: '2026-12-20' },
  { unitRefId: 704, bookingRequestNumber: 'REQ-503', bookingStartDate: '2026-11-08', bookingEndDate: '2026-11-22' }];
function serialPicker(qty, confirmed, readOnly) {
  const p = new AaPage();
  const built = ldu.buildResources(SERIALS, 'serial', { equipmentName: 'CAT 320', className: 'Excavators' }, 11);
  p.initUnits(built.resources, built.allocated, Object.assign({}, LINE_DATA, { qty }), 'serial', confirmed, readOnly, BOOKINGS, 'REQ-503');
  return p;
}
{
  const p = serialPicker(2);
  const states = p.unitRows(0).map((u) => u.name + ':' + u.state + (u.conflict ? '!' : ''));
  T.eq('unit states, and a booking over the requested dates is a clash', states.join(','), 'EX-2201:booked!,EX-2203:available,EX-2210:available,EX-2214:assigned');
  T.eq('this request\'s own booking is drawn from its allocation, not as a booking', p.unitRows(0)[3].bars.map((b) => b.kind).join(), 'own');
  T.eq('a later booking is drawn but does not clash', p.unitRows(0)[2].bars.map((b) => b.kind).join(), 'booked');
  T.eq('capacity: qty 2, 1 allocated', p.remainingCapacity(), 1);
  T.eq('assign a free serial', p.stageAssign(702), 'STAGED');
  T.eq('the line is full', p.stageAssign(703), 'FULL');
  T.eq('a booked unit cannot be assigned', p.stageAssign(701), 'GONE');
  T.eq('staged assignment: the write id, the serial and its inventory org', json(p.getStagedChanges()),
    '{"mode":"serial","pendingAssignments":[{"eqrSerialRefId":702,"resourceId":702,"serialNumber":"EX-2203","invOrgId":300,"invOrgName":"Houston Yard"}],"pendingReleases":[]}');
  T.eq('release the allocated one', p.stageRelease(704), 'STAGED');
  T.eq('staged release', json(p.getStagedChanges().pendingReleases), '[{"allocationId":8704,"eqrSerialRefId":704,"serialNumber":"EX-2214"}]');
  T.eq('a release frees capacity', p.remainingCapacity(), 1);
  T.eq('summary', p.allocationSummary(0).text, '1 / 2 serials allocated (2 pending)');
  p.cancelStage(704);
  p.cancelStage(702);
  T.eq('undo both', p.getStagedChanges().pendingAssignments.length + p.getStagedChanges().pendingReleases.length, 0);
  T.eq('auto-fill stages free units in list order up to the quantity', p.fillFree() + ':' + p.getStagedChanges().pendingAssignments.map((a) => a.serialNumber).join(), '1:EX-2203');
  T.eq('the schedule runs a week either side; the band spans the requested days (8–22 Nov of 1–30 Nov)', json(p.windowBand()), '{"left":24.1,"width":51.7}');
  const locked = serialPicker(2, true);
  T.eq('a confirmed line is read only', json([locked.stageAssign(702), locked.fillFree(), locked.allocationSummary(0).canSave, locked.unitRows(0)[3].canRelease]), '["LOCKED",0,false,false]');
}
{
  const p = new AaPage();
  const lots = [unitRow('LOT', 801, 'LOT-A', { availableToReserve: 3, uomCode: 'EA' }), unitRow('LOT', 802, 'LOT-B', { availableToReserve: 10, uomCode: 'EA' }),
    unitRow('LOT', 803, 'LOT-C', { availableToReserve: 0 })];
  const built = ldu.buildResources(lots, 'lot', { equipmentName: 'Cones', className: 'Safety' }, 61);
  p.initUnits(built.resources, built.allocated, Object.assign({}, LINE_DATA, { qty: 5 }), 'lot', false, false, [], 'REQ-503');
  T.eq('lot: default quantity is what the lot can cover', p.unitRows(0)[0].qty, 3);
  T.eq('lot: stage clamps to the lot', p.stageLot(801, 9) + ':' + p.getStagedChanges().pendingAssignments[0].qty, 'STAGED:3');
  p.setLotQty(802, 4);
  T.eq('lot: the quantity box is used by Assign, clamped to what is left', p.stageLot(802) + ':' + p.getStagedChanges().pendingAssignments[1].qty, 'STAGED:2');
  T.eq('lot: staged shape (lot and inventory aliases)', json(p.getStagedChanges().pendingAssignments[0]),
    '{"lotRefId":801,"eqrLotRefId":801,"inventoryItemRefId":801,"lotNumber":"LOT-A","qty":3,"invOrgId":300,"invOrgName":"Houston Yard"}');
  T.eq('lot: an empty lot is not offered', p.unitRows(0)[2].state, 'out');
  T.eq('lot summary', p.allocationSummary(0).text, '5 / 5 units allocated (2 pending)');
}

// ── Copies are copies ────────────────────────────────────────────────────────────────────────────────────────
T.section('copied files are unchanged');
const REQ_DETAIL = path.join(NEW, 'flows', 'request', 'pages', 'request-detail-page-chains');
['confirmRequestChain', 'rejectRequestChain', 'toggleLineChain', 'onSelectionChangedChain'].forEach((c) => {
  T.check(`approve-allocate ${c} = Request detail's`, read(path.join(AA_CHAINS, c + '.js')) === read(path.join(REQ_DETAIL, c + '.js')));
});
['confirmRequestChain', 'rejectRequestChain'].forEach((c) => {
  T.check(`${c} = the old equipment-request-detail's`, read(path.join(AA_CHAINS, c + '.js')) === read(path.join(OLD, 'flows', 'main', 'pages', 'equipment-request-detail-page-chains', c + '.js')));
});
[WB_CHAINS, AA_CHAINS].forEach((dir) => ['enforcePageAccessChain', 'openNavChain'].forEach((c) => {
  T.check(`${path.basename(dir)} ${c} = My requests'`, read(path.join(dir, c + '.js')) === read(path.join(NEW, 'flows', 'request', 'pages', 'my-requests-page-chains', c + '.js')));
}));
['requestDetailLines', 'lineDetailUnits', 'lineConfirmed'].forEach((f) => {
  T.check(`resources/js/${f}.js = Old EquipRite's`, read(path.join(NEW_JS, f + '.js')) === read(path.join(OLD_JS, f + '.js')));
});

// ── Chains ───────────────────────────────────────────────────────────────────────────────────────────────────
const chain = (dir, name, Actions, extraDeps) => loadAmd(path.join(dir, name + '.js'), Object.assign({
  'vb/action/actionChain': class {}, 'vb/action/actions': Actions, 'resources/js/requestLineBody': lineBody, 'resources/js/currentUser': cu,
  'resources/js/requestDetailLines': rdl, 'resources/js/lineDetailUnits': ldu, 'resources/js/lineConfirmed': lineConfirmed,
}, extraDeps || {}));

function wbContext(vars) {
  return {
    $page: { variables: Object.assign({ buckets: {}, tab: 'approve', tabChosen: false, selectedIds: [], selection: { count: 0, ids: [] }, searchText: '', source: '',
      bulkBusy: false, isReadOnly: false, visibleRows: [] }, vars || {}), functions: new WbPage() },
    $application: appContext(),
  };
}

const WB_RAW = {
  OUTBOUND: [RAW[0], RAW[2], RAW[3], RAW[4]],
  INITIATE: [RAW[5]],
  DEPLOYED: [{ eqrEquipmentRequestId: 20, requestNumber: 'REQ-20', requestStatus: 'DEPLOYED', source: 'INTERNAL' }],
  INBOUND: [],
};

(async () => {
  T.section('loadWorkbenchChain: the old stage calls');
  {
    const { calls, chains, Actions } = backend((ep, o) => {
      if (ep === 'eqp-v1/getEquipriteV1ViewsWorkbenchRequests') return ok(WB_RAW[o.uriParams.stage]);
      if (ep === 'eqp-v1/getEquipriteV1ViewsPendingApprovalLines') return ok([{ requestNumber: 'REQ-12', equipmentName: 'Tower Crane' }]);
      return undefined;
    });
    const Load = chain(WB_CHAINS, 'loadWorkbenchChain', Actions);
    const c = wbContext();
    await new Load().run(c);
    T.eq('five reads, the old parameters', json(calls.map((x) => [x.endpoint.replace('eqp-v1/getEquipriteV1Views', ''), x.uriParams])),
      json([['WorkbenchRequests', { size: 1000, stage: 'OUTBOUND' }], ['WorkbenchRequests', { stage: 'INITIATE', size: 1000 }],
        ['WorkbenchRequests', { size: 1000, stage: 'DEPLOYED' }], ['WorkbenchRequests', { size: 1000, stage: 'INBOUND' }],
        ['PendingApprovalLines', { size: 2000, lineStatus: 'UNDER_PROCUREMENT', includeAll: 'Y' }]]));
    T.check('nothing written', !calls.some(isWrite));
    T.eq('tab counts', c.$page.variables.tabList.map((t) => t.count).join(','), '2,1,2,1,0,1');
    T.eq('source chips shown with the customers module', c.$page.variables.showSource, true);
    T.eq('then the filter runs', chains.map((x) => x.chain).join(), 'applyFilterChain');
    T.eq('no error', c.$page.variables.fetchError + c.$page.variables.loadNote, '');
  }
  {
    const { Actions } = backend((ep, o) => {
      if (ep === 'eqp-v1/getEquipriteV1ViewsWorkbenchRequests' && o.uriParams.stage === 'DEPLOYED') return { ok: false, status: 503, body: {} };
      if (ep === 'eqp-v1/getEquipriteV1ViewsWorkbenchRequests') return ok(WB_RAW[o.uriParams.stage]);
      return undefined;
    });
    const Load = chain(WB_CHAINS, 'loadWorkbenchChain', Actions);
    const c = wbContext({ selectedIds: [10, 14] });
    await new Load().run(c);
    T.eq('a failed stage is named, the rest still load', c.$page.variables.loadNote, 'Not loaded: Deployed. Those tabs may be short; Refresh to try again.');
    T.eq('a tick on a request no longer to approve is dropped', json(c.$page.variables.selectedIds), '[10]');
  }
  {
    const { Actions } = backend(() => ({ ok: false, status: 500, body: {} }));
    const Load = chain(WB_CHAINS, 'loadWorkbenchChain', Actions);
    const c = wbContext({ tab: 'approve' });
    c.$application.variables.pageAccessMap = { EQR_WORKBENCH: 'READ_ONLY' };
    await new Load().run(c);
    T.eq('everything failed: an error, not an empty workbench', c.$page.variables.fetchError, 'The workbench could not be loaded (HTTP 500).');
    T.eq('READ_ONLY access: read only', c.$page.variables.isReadOnly, true);
  }
  {
    const { Actions } = backend((ep, o) => (ep === 'eqp-v1/getEquipriteV1ViewsWorkbenchRequests' ? ok(o.uriParams.stage === 'INITIATE' ? WB_RAW.INITIATE : []) : undefined));
    const c = wbContext();
    await new (chain(WB_CHAINS, 'loadWorkbenchChain', Actions))().run(c);
    T.eq('first load with nothing to approve lands on the first stage with work', c.$page.variables.tab, 'pick');
  }

  T.section('applyFilterChain, setViewChain, toggleRowChain');
  {
    const { Actions } = backend();
    const c = wbContext({ buckets: B, tab: 'approve' });
    await new (chain(WB_CHAINS, 'applyFilterChain', Actions))().run(c);
    T.eq('visible rows of the tab', c.$page.variables.visibleRows.length, 2);
    await new (chain(WB_CHAINS, 'toggleRowChain', Actions))().run(c, { id: 'all', checked: true });
    await new (chain(WB_CHAINS, 'applyFilterChain', Actions))().run(c);
    T.eq('tick all = every visible request', json(c.$page.variables.selection.ids), '[11,10]');
    await new (chain(WB_CHAINS, 'toggleRowChain', Actions))().run(c, { id: '10', checked: 'false' });
    await new (chain(WB_CHAINS, 'applyFilterChain', Actions))().run(c);
    T.eq('untick one', json(c.$page.variables.selection.ids), '[11]');
    c.$page.variables.searchText = 'pipeline';
    await new (chain(WB_CHAINS, 'applyFilterChain', Actions))().run(c);
    T.eq('a ticked request hidden by the search is not in the selection', c.$page.variables.selection.count, 0);
    await new (chain(WB_CHAINS, 'setViewChain', Actions))().run(c, { tab: 'outbound' });
    T.eq('changing tab clears the ticks', json([c.$page.variables.tab, c.$page.variables.selectedIds, c.$page.variables.tabChosen]), '["outbound",[],true]');
    await new (chain(WB_CHAINS, 'setViewChain', Actions))().run(c, { source: 'ALL' });
    T.eq('All clears the source', c.$page.variables.source, '');
  }

  T.section('openRowChain: where a row leads');
  {
    const { navs, chains, Actions } = backend();
    const Open = chain(WB_CHAINS, 'openRowChain', Actions);
    const c = wbContext({ buckets: B, tab: 'approve' });
    await new Open().run(c, { id: '10', how: 'detail' });
    c.$page.variables.tab = 'outbound';
    await new Open().run(c, { id: '13', how: 'detail' });
    c.$page.variables.tab = 'pick';
    await new Open().run(c, { id: '14', how: 'action' });
    await new Open().run(c, { id: '999', how: 'action' });
    T.eq('Approve & allocate in this flow, with the request number and id', json(navs[0]), '{"kind":"page","page":"approve-allocate","params":{"requestId":"REQ-10","requestNumericId":10}}');
    T.eq('Request detail in the request flow', json(navs[1]), '{"kind":"flow","flow":"request","page":"request-detail","params":{"requestId":"REQ-13","requestNumericId":13},"target":"parent"}');
    T.eq('Initiate picking through the menu', json(chains), '[{"chain":"openNavChain","params":{"navId":"picking"}}]');
    T.eq('an unknown row goes nowhere', navs.length, 2);
  }

  T.section('bulk approve = the old approve, request by request');
  const LINES = {
    501: [{ lineId: 9011, equipmentName: 'CAT 320', lineStatus: 'SUBMITTED' }, { lineId: 9012, equipmentName: 'Dump truck', lineStatus: 'SUBMITTED' },
      { lineId: 9013, equipmentName: 'Roller', lineStatus: 'REJECTED' }],
    502: [{ lineId: 9021, equipmentName: 'Generator', lineStatus: 'SUBMITTED' }, { lineId: 9022, equipmentName: 'Light tower', lineStatus: 'DEPLOYED' }],
  };
  const ALLOC = { 501: [{ id: 9011, allocationStatus: 'ALLOCATED' }, { id: 9012, allocationStatus: 'PENDING' }], 502: [] };
  const answerLines = (failBatchFor) => (ep, o) => {
    if (ep === 'eqp-v1/getEquipriteV1ViewsRequestDetailLines') return ok(LINES[o.uriParams.requestId]);
    if (ep === 'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2') return ok(ALLOC[o.uriParams.requestId]);
    if (ep === 'eqp-v1/patchRequestLinesBatch' && o.uriParams.requestId === failBatchFor) return { ok: false, status: 409, body: { message: 'Line 9021 changed meanwhile' } };
    return undefined;
  };
  const approveRows = [{ request_id: 501, request_number: 'REQ-501', status: 'SUBMITTED' }, { request_id: 502, request_number: 'REQ-502', status: 'SUBMITTED' }];
  async function runOld(name, id) {
    const { calls, Actions } = backend(answerLines());
    const Old = chain(AA_CHAINS, name, Actions);
    const lines = LINES[id].map((l) => ({ lineId: String(l.lineId), lineStatus: l.lineStatus, equipmentName: l.equipmentName }));
    await new Old().run({ $page: { variables: { requestNumericId: id, requestId: 'REQ-' + id, formData: { status: 'SUBMITTED' }, selectionTick: 0 },
      functions: { getSelectedLines: () => [], getAllLines: () => lines } } });
    return calls;
  }
  async function runBulk(action, ids, failBatchFor) {
    const b = backend(answerLines(failBatchFor));
    const c = wbContext({ buckets: { approve: approveRows }, tab: 'approve', selection: { count: ids.length, ids } });
    await new (chain(WB_CHAINS, 'bulkDecideChain', b.Actions))().run(c, { action });
    return Object.assign(b, { c });
  }
  {
    const bulk = await runBulk('approve', [501, 502]);
    const perRequest = (id) => bulk.calls.filter((x) => json(x.uriParams).includes(String(id)) && x.endpoint !== 'eqp-v1/getEquipriteV1ViewsRequestDetailLines');
    for (const id of [501, 502]) {
      const old = await runOld('confirmRequestChain', id);
      T.eq(`REQ-${id}: the same calls, bodies and headers as confirmRequestChain`, json(perRequest(id)), json(old));
    }
    T.eq('order: lines, allocation, batch, header, then the next request; REQ-502 keeps a DEPLOYED line, so (old rule) its header stays',
      bulk.calls.map((x) => x.endpoint.replace('eqp-v1/', '') + ':' + (x.uriParams.requestId || x.uriParams.id)).join(' > '),
      'getEquipriteV1ViewsRequestDetailLines:501 > getEquipriteV1EquipmentRequestsRequestIdLines2:501 > patchRequestLinesBatch:501 > patchEquipmentRequest:501 > '
      + 'getEquipriteV1ViewsRequestDetailLines:502 > getEquipriteV1EquipmentRequestsRequestIdLines2:502 > patchRequestLinesBatch:502');
    T.check('…and the result says so', bulk.c.$page.variables.bulkResult.done[1].message.includes('the request stays Submitted'), json(bulk.c.$page.variables.bulkResult.done));
    T.eq('an allocated line goes to ALLOCATED, a rejected one is left alone', json(bulk.calls[2].body), '{"lines":[{"id":9011,"lineStatus":"ALLOCATED"},{"id":9012,"lineStatus":"IN_PROCESS"}]}');
    T.eq('audit header sent', json(bulk.calls[2].headers), '{"X-User-Id":"priya.raman"}');
    T.eq('result', bulk.c.$page.variables.bulkResult.title, '2 of 2 requests approved');
    T.eq('ticks cleared, workbench reloaded', json([bulk.c.$page.variables.selectedIds, bulk.chains.map((x) => x.chain)]), '[[],["loadWorkbenchChain"]]');
    T.eq('one summary toast', bulk.toasts.map((t) => t.summary).join(), 'Requests approved');
  }
  {
    const bulk = await runBulk('approve', [501, 502], 502);
    T.eq('a failed batch: no header PATCH for that request, the other request still approved',
      bulk.calls.filter(isWrite).map((x) => x.endpoint.replace('eqp-v1/', '') + ':' + (x.uriParams.requestId || x.uriParams.id)).join(' > '),
      'patchRequestLinesBatch:501 > patchEquipmentRequest:501 > patchRequestLinesBatch:502');
    T.check('…and is reported with the reason', bulk.c.$page.variables.bulkResult.failed.length === 1
      && bulk.c.$page.variables.bulkResult.failed[0].message.includes('No line was changed'), json(bulk.c.$page.variables.bulkResult.failed));
    T.eq('the toast persists', bulk.toasts[0].displayMode, 'persist');
  }
  {
    const bulk = await runBulk('reject', [501, 502]);
    const perRequest = (id) => bulk.calls.filter((x) => json(x.uriParams).includes(String(id)) && x.endpoint !== 'eqp-v1/getEquipriteV1ViewsRequestDetailLines');
    for (const id of [501, 502]) {
      const old = await runOld('rejectRequestChain', id);
      T.eq(`REQ-${id}: the same calls as rejectRequestChain`, json(perRequest(id)), json(old));
    }
    T.eq('settled lines are skipped (REQ-501 line 9013 is already REJECTED)', json(bulk.calls.find((x) => x.endpoint === 'eqp-v1/patchRequestLinesBatch').body),
      '{"lines":[{"id":9011,"lineStatus":"REJECTED"},{"id":9012,"lineStatus":"REJECTED"}]}');
    T.eq('every line rejected: each request is rejected too (rejectRequestChain\'s rollup)',
      bulk.calls.filter((x) => x.endpoint === 'eqp-v1/patchEquipmentRequest').map((x) => x.uriParams.id + ':' + x.body.status).join(), '501:REJECTED,502:REJECTED');
    T.eq('the reject dialog was closed first', json(bulk.chains[0]), '{"component":"#bulkRejectDialog","method":"close"}');
  }
  {
    const b = backend(() => ({ ok: false, status: 500, body: {} }));
    const c = wbContext({ buckets: { approve: approveRows }, selection: { count: 1, ids: [501] } });
    await new (chain(WB_CHAINS, 'bulkDecideChain', b.Actions))().run(c, { action: 'approve' });
    T.check('lines that cannot be loaded: nothing written, reported', !b.calls.some(isWrite) && c.$page.variables.bulkResult.failed.length === 1);
    const r = backend();
    const ro = wbContext({ buckets: { approve: approveRows }, selection: { count: 1, ids: [501] }, isReadOnly: true });
    await new (chain(WB_CHAINS, 'bulkDecideChain', r.Actions))().run(ro, { action: 'approve' });
    T.eq('read only: nothing called', r.calls.length, 0);
    const d = backend();
    await new (chain(WB_CHAINS, 'bulkDecideChain', d.Actions))().run(wbContext(), { action: 'askReject' });
    T.eq('Reject asks first', json(d.chains), '[{"component":"#bulkRejectDialog","method":"open"}]');
  }

  T.section('Approve & allocate initChain: the old Workbench detail load');
  const HEADER = { eqrEquipmentRequestId: 503, requestNumber: 'REQ-503', requestStatus: 'IN_PROCESS', source: 'EXTERNAL', projectName: 'Acme', customerName: 'Acme',
    requestor: 'Ann', location: 'Gate 2', requestedStartDate: '2026-11-08T00:00:00Z', requestedEndDate: '2026-11-22T00:00:00Z', totalEstCost: 40350 };
  const DETAIL_LINES = [
    { lineId: 9031, equipmentMasterId: 11, equipmentName: 'CAT 320', className: 'Excavators', quantity: 2, lineStatus: 'IN_PROCESS', allocatedQty: 1,
      isSerialControlled: 'Y', isLotControlled: 'N', isInventoryTracked: 'Y', availabilityStatus: 'AVAILABLE', billRate: 1400, priceUom: 'DAY', estimatedCost: 38400,
      startDate: '2026-11-08T00:00:00Z', endDate: '2026-11-22T00:00:00Z' },
    { lineId: 9032, equipmentName: 'Trench kit', quantity: 10, lineStatus: 'IN_PROCESS', isSerialControlled: 'N', isLotControlled: 'N', isInventoryTracked: 'N', estimatedCost: 1950 },
  ];
  const initAnswer = (ep, o) => {
    if (ep === 'eqp-v1/getEquipriteV1ViewsWorkbenchRequests') return ok([HEADER]);
    if (ep === 'eqp-v1/getEquipriteV1ViewsRequestDetailLines') return ok(DETAIL_LINES);
    return undefined;
  };
  function aaContext(vars, appVars) {
    return {
      $page: { variables: Object.assign({ requestId: 'REQ-503', requestNumericId: 503, formData: {}, lines: [], selectionState: { count: 0 }, selectionTick: 0,
        quotingAllowed: false, isReadOnly: false, openLineId: '', allocLine: null, units: {}, stagingTick: 0, isSaving: false }, vars || {}), functions: new AaPage() },
      $application: appContext(appVars),
    };
  }
  {
    const { calls, Actions } = backend(initAnswer);
    const c = aaContext();
    await new (chain(AA_CHAINS, 'initChain', Actions))().run(c, { requestId: 'REQ-503', requestNumericId: 503 });
    T.eq('the header by id, as the old page', json(calls[0]), json({ endpoint: 'eqp-v1/getEquipriteV1ViewsWorkbenchRequests', uriParams: { eqrEquipmentRequestId: 503 } }));
    T.eq('the lines through requestDetailLines.fetchAndBuild (with its PR and failed-TO enrichment)',
      calls.slice(1).map((x) => x.endpoint).join(','), 'eqp-v1/getEquipriteV1ViewsRequestDetailLines,eqp-v1/getPurchaseRequisitions,eqp-v1/failedLines');
    T.eq('lines carry the names the copied approve / reject chains read', json(c.$page.variables.lines.map((l) => [l.lineId, l.lineStatus, l.equipmentName, l.allocated_serial])),
      '[["9031","IN_PROCESS","CAT 320","1 of 2 allocated"],["9032","IN_PROCESS","Trench kit","0 of 10 allocated"]]');
    T.eq('header', json([c.$page.variables.formData.status, c.$page.variables.formData.isCustomer, c.$page.variables.formData.customer, c.$page.variables.formData.startDate]),
      '["IN_PROCESS",true,"Acme","2026-11-08"]');
    T.eq('quoting resolved for the origin (ENABLE_QUOTES=CUSTOMER, customer request)', c.$page.variables.quotingAllowed, true);
    T.eq('the page module holds the lines for the approve / reject chains', c.$page.functions.getAllLines().length, 2);
  }
  {
    const { Actions } = backend((ep) => (ep === 'eqp-v1/getEquipriteV1ViewsWorkbenchRequests' ? ok([]) : initAnswer(ep)));
    const c = aaContext();
    await new (chain(AA_CHAINS, 'initChain', Actions))().run(c, {});
    T.eq('a request not on the Workbench says so', c.$page.variables.fetchError, 'This request is not on the Workbench.');
  }

  T.section('openUnitsChain: the old line-detail load and its gates');
  const UNIT_ROWS = SERIALS.map((u) => Object.assign({ requestNumber: 'REQ-503', requestStatus: 'IN_PROCESS', source: 'INTERNAL', lineStatus: 'IN_PROCESS',
    equipmentMasterId: 11, equipmentName: 'CAT 320', className: 'Excavators', quantity: 2, isSerialControlled: 'Y', lineStartDate: '2026-11-08', lineEndDate: '2026-11-22' }, u));
  async function openUnits(rowsFor, tos, formData, extra) {
    const b = backend((ep, o) => {
      if (ep === 'eqp-v1/getEquipriteV1ViewsLineDetailUnits') return ok(rowsFor);
      if (ep === 'eqp-v1/getTransferOrders') return ok(tos || []);
      if (ep === 'eqp-v1/getTransferOrderLines') return ok([{ requestLineId: 9031 }]);
      if (ep === 'eqp-v1/getEquipriteV1ViewsLineDetailBookings') return ok(BOOKINGS);
      return undefined;
    });
    const c = aaContext(Object.assign({ formData: formData || { status: 'IN_PROCESS', requestNumber: 'REQ-503' } }, extra || {}));
    c.$page.functions.initGridData([L(1, 'IN_PROCESS', { line_id: 9031, equipment_master_id: 11 })]);
    await new (chain(AA_CHAINS, 'openUnitsChain', b.Actions))().run(c, { lineId: '9031' });
    return Object.assign(b, { c });
  }
  {
    const o = await openUnits(UNIT_ROWS);
    T.eq('reads: units, transfer orders, then bookings', o.calls.map((x) => x.endpoint.replace('eqp-v1/', '') + json(x.uriParams)).join(' > '),
      'getEquipriteV1ViewsLineDetailUnits{"requestId":503,"lineId":9031,"size":10000} > getTransferOrders{"equipmentRequestId":503} > '
      + 'getEquipriteV1ViewsLineDetailBookings{"equipmentMasterId":11,"size":10000}');
    T.eq('serial mode, editable, the old lineData shape', json([o.c.$page.variables.units.mode, o.c.$page.variables.units.readOnly, o.c.$page.variables.allocLine.qty,
      o.c.$page.variables.allocLine.quoting_on, o.c.$page.variables.allocLine.start_date]), '["serial",false,2,false,"2026-11-08"]');
    T.eq('the picker is loaded', o.c.$page.functions.unitRows(0).length, 4);
    T.eq('opening it again closes it', await (async () => {
      await new (chain(AA_CHAINS, 'openUnitsChain', o.Actions))().run(o.c, { lineId: '9031' });
      return o.c.$page.variables.openLineId;
    })(), '');
  }
  {
    const o = await openUnits(UNIT_ROWS, [{ id: 77, fusionToStatus: 'TO_CREATED' }]);
    T.eq('a live Transfer Order on this line: confirmed, the picker locked', json([o.c.$page.variables.units.confirmed, o.c.$page.functions.allocationSummary(0).locked,
      o.c.$page.variables.units.readOnlyWhy]), '[true,true,"A Transfer Order is live for this line: its units can no longer change."]');
    T.check('…checked through the TO lines', o.calls.some((x) => x.endpoint === 'eqp-v1/getTransferOrderLines' && x.uriParams.transferOrderId === 77));
  }
  {
    const lots = [Object.assign({}, UNIT_ROWS[0], { isSerialControlled: 'N', isLotControlled: 'Y', unitType: 'LOT', unitRefId: 801, lotRefId: 801, availableToReserve: 4 })];
    const o = await openUnits(lots);
    T.eq('lot mode: no bookings read', json([o.c.$page.variables.units.mode, o.calls.some((x) => x.endpoint.includes('Bookings'))]), '["lot",false]');
  }
  {
    const o = await openUnits(UNIT_ROWS, [], { status: 'SUBMITTED', requestNumber: 'REQ-503' });
    T.eq('submitted request: nothing is read, the reason is shown', json([o.calls.length, o.toasts[0].message]), '[0,"Opens once the request is approved."]');
    const sub = UNIT_ROWS.map((u) => Object.assign({}, u, { requestStatus: 'SUBMITTED' }));
    const o2 = await openUnits(sub, [], { status: 'IN_PROCESS', requestNumber: 'REQ-503' });
    T.eq('the units say SUBMITTED (stale page): closed, as the old page bounces back', o2.c.$page.variables.units.error, 'Allocation opens once the request is approved.');
  }

  T.section('saveAllocationChain writes what the OLD saveLineChain writes');
  // A small stateful backend both chains run against: units, allocations, lot and item free quantities, line status.
  function world(mode, opts) {
    const o = opts || {};
    const state = {
      lineStatus: o.lineStatus || 'IN_PROCESS',
      atr: { 801: 10, 802: 4, 901: 7 },
      alloc: Object.assign({}, o.alloc || {}), // unitRefId -> { id, qty }
      nextId: 8800,
    };
    const units = mode === 'serial' ? SERIALS.map((u) => Object.assign({}, u, { allocationId: undefined, allocationStatus: undefined }))
      : (mode === 'lot' ? [unitRow('LOT', 801, 'LOT-A', { availableToReserve: 10 }), unitRow('LOT', 802, 'LOT-B', { availableToReserve: 4 })]
        : [unitRow('ITEM', 901, 'ITEM-9', { availableToReserve: 7 })]);
    const answer = (ep, req) => {
      const p = req.uriParams || {};
      if (ep === 'eqp-v1/getTransferOrders') return ok(o.tos || []);
      if (ep === 'eqp-v1/getTransferOrderLines') return ok([{ requestLineId: 9031 }]);
      if (ep === 'eqp-v1/getAllocations') return ok(Object.keys(state.alloc).map((k) => ({ id: state.alloc[k].id, allocationStatus: 'ALLOCATED' })));
      if (ep === 'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2') return ok([{ id: 9031, lineStatus: state.lineStatus }]);
      if (ep === 'eqp-v1/patchAllocation') {
        Object.keys(state.alloc).forEach((k) => { if (state.alloc[k].id === p.id) delete state.alloc[k]; });
        return { ok: true, status: 200, body: {} };
      }
      if (ep === 'eqp-v1/createAllocation') {
        if (o.failCreate) return { ok: false, status: 500, body: {} };
        const ref = req.body.serialRefId || req.body.lotRefId || req.body.inventoryItemRefId;
        state.alloc[ref] = { id: state.nextId++, qty: req.body.allocatedQty };
        return { ok: true, status: 201, body: { id: state.alloc[ref].id } };
      }
      if (ep === 'eqp-v1/getLotRefById' || ep === 'eqp-v1/getInventoryItemRefById') return { ok: true, status: 200, body: { availableToReserve: state.atr[p.id] } };
      if (ep === 'eqp-v1/getEquipriteV1ViewsLineDetailUnits') {
        return ok(units.map((u) => Object.assign({}, u, state.alloc[u.unitRefId] ? { allocationId: state.alloc[u.unitRefId].id, allocationStatus: 'ALLOCATED', allocatedQty: state.alloc[u.unitRefId].qty } : {})));
      }
      return undefined;
    };
    const resources = () => {
      const rows = answer('eqp-v1/getEquipriteV1ViewsLineDetailUnits', {}).body.data;
      return ldu.buildResources(rows, mode, { equipmentName: 'CAT 320', className: 'Excavators' }, 11);
    };
    return { answer, resources, state };
  }
  async function bothChains(mode, qty, stage, opts) {
    const lineData = Object.assign({}, LINE_DATA, { qty, quoting_on: !!(opts && opts.quoting) });
    // Stage with the NEW page module, then hand the same staged changes to both chains.
    const w0 = world(mode, opts);
    const picker = new AaPage();
    const built = w0.resources();
    picker.initUnits(built.resources, built.allocated, lineData, mode, false, false, [], 'REQ-503');
    stage(picker);
    const staged = picker.getStagedChanges();

    const wOld = world(mode, opts);
    const bOld = backend(wOld.answer);
    const OldSave = loadAmd(path.join(OLD, 'flows', 'equipment-foundation', 'pages', 'line-detail-page-chains', 'saveLineChain.js'), {
      'vb/action/actionChain': class {}, 'vb/action/actions': bOld.Actions, 'resources/js/bryntumDates': loadAmd(path.join(OLD_JS, 'bryntumDates.js')),
      'resources/js/lineDetailUnits': loadAmd(path.join(OLD_JS, 'lineDetailUnits.js')), 'resources/js/lineConfirmed': loadAmd(path.join(OLD_JS, 'lineConfirmed.js')),
    });
    await new OldSave().run({ $page: {
      variables: { requestId: '503', lineId: '9031', requestNumber: 'REQ-503', equipmentMasterId: '11', lineData: Object.assign({}, lineData),
        adjustedStartDate: lineData.start_date, adjustedEndDate: lineData.end_date, isSaving: false },
      functions: { getStagedChanges: () => JSON.parse(JSON.stringify(staged)), initScheduler() {} } } });

    const wNew = world(mode, opts);
    const bNew = backend(wNew.answer);
    const c = aaContext({ allocLine: lineData });
    c.$page.functions.getStagedChanges = () => JSON.parse(JSON.stringify(staged));
    await new (chain(AA_CHAINS, 'saveAllocationChain', bNew.Actions))().run(c);
    return { old: writes(bOld.calls), neu: writes(bNew.calls), bNew, staged, c };
  }
  const cases = [
    ['serial: assign one', 'serial', 1, (p) => p.stageAssign(702)],
    ['serial: assign two (partial line of three)', 'serial', 3, (p) => { p.stageAssign(702); p.stageAssign(703); }],
    ['serial: swap (release one, assign another)', 'serial', 1, (p) => { p.stageRelease(704); p.stageAssign(702); }, { alloc: { 704: { id: 8704, qty: 1 } }, lineStatus: 'ALLOCATED' }],
    ['serial: release the last unit of an ALLOCATED line (back to IN_PROCESS)', 'serial', 1, (p) => p.stageRelease(704), { alloc: { 704: { id: 8704, qty: 1 } }, lineStatus: 'ALLOCATED' }],
    ['serial: release on a quoted line (back to QUOTE_ACCEPTED)', 'serial', 1, (p) => p.stageRelease(704), { alloc: { 704: { id: 8704, qty: 1 } }, lineStatus: 'ALLOCATED', quoting: true }],
    ['serial: a line past allocation keeps its status', 'serial', 1, (p) => p.stageAssign(702), { lineStatus: 'PICK_INITIATED' }],
    ['lot: assign from two lots', 'lot', 6, (p) => { p.stageLot(801, 3); p.stageLot(802, 4); }],
    ['lot: release', 'lot', 6, (p) => p.stageRelease(801), { alloc: { 801: { id: 8801, qty: 3 } } }],
    ['inventory: assign', 'inventory', 2, (p) => p.stageLot(901, 2)],
    ['inventory: release', 'inventory', 2, (p) => p.stageRelease(901), { alloc: { 901: { id: 8901, qty: 2 } } }],
  ];
  for (const [name, mode, qty, stage, opts] of cases) {
    const r = await bothChains(mode, qty, stage, opts);
    T.check(`${name}: something was written`, r.neu.length > 0, json(r.staged));
    T.eq(`${name}: same writes, bodies and order as the old chain`, json(r.neu), json(r.old));
  }
  {
    const r = await bothChains('serial', 1, (p) => p.stageAssign(702));
    T.eq('serial assign, written out', r.neu.map((x) => x.endpoint.replace('eqp-v1/', '') + json(x.uriParams || {}) + json(x.body)).join(' > '),
      'createAllocation{}{"requestLineId":9031,"serialRefId":702,"allocatedQty":1,"allocationStatus":"ALLOCATED","allocatedDate":"NOW","eqpInvOrgId":300,"eqpInvOrgName":"Houston Yard"} > '
      + 'patchSerialRef{"id":702}{"unitStatus":"RENTED"} > patchRequestLine{"requestId":503,"id":9031}{"allocationStatus":"ALLOCATED","lineStatus":"ALLOCATED"}');
    T.eq('reads before the writes: the confirmed gate, then the allocations', r.bNew.calls.slice(0, 2).map((x) => x.endpoint).join(), 'eqp-v1/getTransferOrders,eqp-v1/getAllocations');
    T.eq('then the lines and the picker refresh in place', r.bNew.chains.map((x) => x.chain).join(), 'initChain,openUnitsChain');
    T.eq('a confirmation toast', r.bNew.toasts.map((t) => t.summary + ': ' + t.message).join(), 'Saved: 1 allocation change applied successfully.');
    T.eq('busy flag cleared', r.c.$page.variables.isSaving, false);
  }
  const spell = (ws) => ws.map((x) => x.endpoint.replace('eqp-v1/', '') + json(x.uriParams || {}) + json(x.body)).join(' > ');
  {
    const r = await bothChains('serial', 1, (p) => p.stageRelease(704), { alloc: { 704: { id: 8704, qty: 1 } }, lineStatus: 'ALLOCATED' });
    T.eq('serial release of the last unit, written out', spell(r.neu),
      'patchAllocation{"id":8704}{"allocationStatus":"RELEASED","releasedDate":"NOW"} > patchSerialRef{"id":704}{"unitStatus":"AVAILABLE"} > '
      + 'patchRequestLine{"requestId":503,"id":9031}{"allocationStatus":"PENDING","lineStatus":"IN_PROCESS"}');
  }
  {
    const r = await bothChains('lot', 6, (p) => { p.stageLot(801, 3); p.stageLot(802, 4); });
    T.eq('lot assign, written out (free quantity read, then reduced)', spell(r.neu),
      'createAllocation{}{"requestLineId":9031,"lotRefId":801,"allocatedQty":3,"allocationStatus":"ALLOCATED","allocatedDate":"NOW","eqpInvOrgId":300,"eqpInvOrgName":"Houston Yard"} > '
      + 'patchLotRef{"id":801}{"availableToReserve":7} > '
      + 'createAllocation{}{"requestLineId":9031,"lotRefId":802,"allocatedQty":3,"allocationStatus":"ALLOCATED","allocatedDate":"NOW","eqpInvOrgId":300,"eqpInvOrgName":"Houston Yard"} > '
      + 'patchLotRef{"id":802}{"availableToReserve":1} > patchRequestLine{"requestId":503,"id":9031}{"allocationStatus":"ALLOCATED","lineStatus":"ALLOCATED"}');
  }
  {
    const r = await bothChains('serial', 1, (p) => p.stageAssign(702), { tos: [{ id: 5, fusionToStatus: 'TO_CREATED' }] });
    T.eq('a confirmed line: nothing written (old gate), an error shown', json([r.neu.length, r.old.length, r.bNew.toasts[0].summary]), '[0,0,"Line already confirmed"]');
  }
  {
    const r = await bothChains('serial', 1, (p) => p.stageAssign(702), { tos: [{ id: 5, fusionToStatus: 'SR_CREATED' }] });
    T.check('a Transfer Order not yet live does not lock the line', r.neu.length === 3);
  }
  {
    const r = await bothChains('serial', 1, (p) => p.stageAssign(702), { failCreate: true });
    T.eq('a failed allocation: the unit is not rented; the line is recounted as the old chain does', json(r.neu), json(r.old));
    T.check('…and the failure is shown and kept', r.bNew.toasts[0].summary === 'Save partially failed' && r.bNew.toasts[0].displayMode === 'persist'
      && r.bNew.toasts[0].message.includes('Create allocation for EX-2203 failed (HTTP 500)'), json(r.bNew.toasts));
  }
  {
    const b = backend();
    const c = aaContext({ allocLine: LINE_DATA });
    await new (chain(AA_CHAINS, 'saveAllocationChain', b.Actions))().run(c);
    T.eq('nothing staged: nothing called', json([b.calls.length, b.toasts[0].summary]), '[0,"No changes"]');
  }

  T.section('stageChain and rejectDialogChain');
  {
    const b = backend();
    const c = aaContext();
    const built = ldu.buildResources(SERIALS, 'serial', {}, 11);
    c.$page.functions.initUnits(built.resources, built.allocated, Object.assign({}, LINE_DATA, { qty: 2 }), 'serial', false, false, [], 'REQ-503');
    const Stage = chain(AA_CHAINS, 'stageChain', b.Actions);
    await new Stage().run(c, { action: 'assign', id: '702' });
    await new Stage().run(c, { action: 'assign', id: '703' });
    T.eq('assign stages; a full line says so', json([c.$page.functions.getStagedChanges().pendingAssignments.length, b.toasts.map((t) => t.summary)]), '[1,["Line quantity reached"]]');
    T.eq('every change bumps the tick', c.$page.variables.stagingTick, 2);
    const d = backend();
    const rc = aaContext();
    await new (chain(AA_CHAINS, 'rejectDialogChain', d.Actions))().run(rc, { action: 'confirm' });
    T.eq('confirming reject closes the dialog, then runs rejectRequestChain', json(d.chains), '[{"component":"#rejectLinesDialog","method":"close"},{"chain":"rejectRequestChain"}]');
  }

  T.section('wiring: menu, listeners, page functions, endpoints, styles');
  const item = app.navItem('workbench');
  T.eq('menu item', json([item.status, item.route, item.pages, item.old]),
    '["new",{"flow":"workbench","page":"workbench"},["approve-allocate"],{"flow":"equipment-foundation","page":"equipment-workbench"}]');
  T.eq('both pages are guarded by EQR_WORKBENCH', [app.getPageCodeForPage({ id: 'workbench' }), app.getPageCodeForPage({ id: 'approve-allocate' })].join(), 'EQR_WORKBENCH,EQR_WORKBENCH');
  T.eq('Approve & allocate highlights Workbench in the menu', app.getNavIdForPage({ id: 'approve-allocate' }), 'workbench');
  T.eq('a role with only Workbench now lands on it', json(app.getRoleHomeTarget({}, true, { EQR_WORKBENCH: 'FULL' }, true)), '{"flow":"workbench","page":"workbench"}');
  T.eq('Old version link', app.oldAppLink('http://x/', 'workbench'), 'http://x/vp/shell/equipment-foundation/equipment-workbench');
  const flowJson = JSON.parse(read(path.join(FLOW, 'workbench-flow.json')));
  T.eq('flow and page ids', json([flowJson.id, Object.keys(flowJson.pages)]), '["workbench",["workbench","approve-allocate"]]');

  [['workbench', WB_CHAINS, wb], ['approve-allocate', AA_CHAINS, aa]].forEach(([page, dir, mod]) => {
    const pj = JSON.parse(read(path.join(PAGES, `${page}-page.json`)));
    const html = read(path.join(PAGES, `${page}-page.html`));
    const used = new Set((html.match(/\$listeners\.([a-zA-Z]+)/g) || []).map((m) => m.split('.')[1]));
    T.check(`${page}: every listener in the HTML is defined`, [...used].every((l) => pj.eventListeners[l]), [...used].filter((l) => !pj.eventListeners[l]).join());
    const fns = new Set((html.match(/\$functions\.([a-zA-Z]+)/g) || []).map((m) => m.split('.')[1]));
    fs.readdirSync(dir).forEach((f) => (read(path.join(dir, f)).match(/\$page\.functions\.([a-zA-Z]+)/g) || []).forEach((m) => fns.add(m.split('.').pop())));
    T.check(`${page}: every page function the HTML and chains call exists`, [...fns].every((fn) => typeof mod[fn] === 'function'), [...fns].filter((fn) => typeof mod[fn] !== 'function').join());
    const vars = new Set((html.match(/\$variables\.([a-zA-Z]+)/g) || []).map((m) => m.split('.')[1]));
    T.check(`${page}: every variable the HTML reads is declared`, [...vars].every((v) => pj.variables[v]), [...vars].filter((v) => !pj.variables[v]).join());
    T.check(`${page}: no table, tbody, tr or select (oj-bind-for-each gotcha)`, !/<(table|tbody|tr|select)[\s>]/.test(html));
    T.check(`${page}: an Old version link`, html.includes('>Old version</a>'));
    T.check(`${page}: enforcePageAccessChain on entry`, json(pj.eventListeners.vbBeforeEnter) === '{"chains":[{"chain":"enforcePageAccessChain"}]}');
  });

  const ops = {};
  ['eqp-v1', 'ProjectLOV'].forEach((svc) => {
    const spec = JSON.parse(read(path.join(ROOT, 'services', svc, 'openapi3.json')));
    Object.values(spec.paths || {}).forEach((p) => Object.values(p).forEach((op) => { if (op && op.operationId) ops[svc + '/' + op.operationId] = true; }));
  });
  const endpoints = new Set();
  [WB_CHAINS, AA_CHAINS].forEach((dir) => fs.readdirSync(dir).forEach((f) => (read(path.join(dir, f)).match(/endpoint:\s*'([^']+)'/g) || [])
    .forEach((m) => endpoints.add(m.replace(/endpoint:\s*'/, '').replace("'", '')))));
  ['requestDetailLines', 'lineConfirmed', 'requestLineBody'].forEach((f) => (read(path.join(NEW_JS, f + '.js')).match(/endpoint:\s*'([^']+)'/g) || [])
    .forEach((m) => endpoints.add(m.replace(/endpoint:\s*'/, '').replace("'", ''))));
  [...endpoints].sort().forEach((e) => T.check(`endpoint exists: ${e}`, !!ops[e]));

  const css = read(path.join(NEW, 'resources', 'css', 'fulfil.css')) + read(path.join(NEW, 'resources', 'css', 'equiprite.css'));
  T.check('fulfil.css has the section heading', css.includes('/* ── Workbench and Approve & allocate ── */'));
  const classes = new Set();
  ['workbench', 'approve-allocate'].forEach((page) => {
    (read(path.join(PAGES, `${page}-page.html`)).match(/er-[a-z0-9-]+/g) || []).forEach((c) => classes.add(c));
  });
  const undefinedClasses = [...classes].filter((c) => !c.endsWith('-') && !new RegExp('\\.' + c.replace(/-/g, '\\-') + '(?![a-z0-9-])').test(css));
  T.check('every er- class the pages use is styled', !undefinedClasses.length, undefinedClasses.join(', '));

  T.report();
})();
