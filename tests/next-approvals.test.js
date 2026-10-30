/*
 * EquipRite Next, Approve & allocate (webApps/equiprite-next/flows/approvals; resources/js/approvalQueue.js,
 * approveAllocate.js, unitPicker.js). Loads the real modules.
 *
 *   - the business rules are New EquipRite's: every write approveAllocate makes is run side by side with New's chain
 *     (confirmRequestChain, rejectRequestChain, bulkDecideChain, saveAllocationChain, openUnitsChain) on the same
 *     backend, and the calls (endpoint, parameters, body, headers, order) must be the same
 *   - the unit picker is New's page module's code (method by method) and stages the same changes
 *   - the gates (who may open a line's units, what approve and reject act on) give New's answers
 *   - the queue: what waits on the Equipment Manager, most urgent first, late, chips, search, words
 *   - the page's chains: nothing written without full access or without a reason; reads only on opening
 *   - wiring: copied helpers unchanged, chains, listeners, functions, variables, styles, endpoints, menu
 *
 * Run:  node tests/next-approvals.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const ROOT = path.join(__dirname, '..');
const NEXT = path.join(ROOT, 'webApps', 'equiprite-next');
const NEXT_JS = path.join(NEXT, 'resources', 'js');
const PAGE_DIR = path.join(NEXT, 'flows', 'approvals', 'pages');
const CHAINS = path.join(PAGE_DIR, 'approvals-page-chains');
const NEW = path.join(ROOT, 'webApps', 'equiprite');
const NEW_JS = path.join(NEW, 'resources', 'js');
const NEW_PAGES = path.join(NEW, 'flows', 'workbench', 'pages');
const AA_CHAINS = path.join(NEW_PAGES, 'approve-allocate-page-chains');
const WB_CHAINS = path.join(NEW_PAGES, 'workbench-page-chains');

const read = (f) => fs.readFileSync(f, 'utf8');
const json = (v) => JSON.stringify(v);

function loadAmd(file, deps) {
  const sandbox = {
    console: { log() {}, warn() {}, error() {} }, setTimeout, Promise, Intl, Date, TextEncoder, URLSearchParams, window: { location: { href: '' } },
    document: { querySelectorAll: () => [], body: {} }, MutationObserver: function () { this.observe = () => {}; },
  };
  let mod;
  sandbox.define = (names, factory) => { mod = factory(...names.map((n) => (deps && n in deps ? deps[n] : {}))); };
  vm.createContext(sandbox);
  vm.runInContext(read(file), sandbox, { filename: path.basename(file) });
  return mod;
}

// ── Next's modules ────────────────────────────────────────────────────────────────────────────────────────────
const rules = loadAmd(path.join(NEXT_JS, 'rules.js'));
const fmt = loadAmd(path.join(NEXT_JS, 'fmt.js'));
const Progress = loadAmd(path.join(NEXT_JS, 'requestProgress.js'));
const queue = loadAmd(path.join(NEXT_JS, 'approvalQueue.js'), { 'resources/js/requestProgress': Progress, 'resources/js/fmt': fmt, 'resources/js/rules': rules });
const unitPicker = loadAmd(path.join(NEXT_JS, 'unitPicker.js'));
const cu = { auditHeaders: () => ({ 'X-User-Id': 'priya.raman' }) };
const nx = {
  lineBody: loadAmd(path.join(NEXT_JS, 'requestLineBody.js')),
  rdl: loadAmd(path.join(NEXT_JS, 'requestDetailLines.js')),
  ldu: loadAmd(path.join(NEXT_JS, 'lineDetailUnits.js')),
  lineConfirmed: loadAmd(path.join(NEXT_JS, 'lineConfirmed.js')),
};
const aa = loadAmd(path.join(NEXT_JS, 'approveAllocate.js'), { 'resources/js/requestLineBody': nx.lineBody, 'resources/js/requestDetailLines': nx.rdl,
  'resources/js/lineDetailUnits': nx.ldu, 'resources/js/lineConfirmed': nx.lineConfirmed, 'resources/js/currentUser': cu });

// ── New EquipRite's, the reference ────────────────────────────────────────────────────────────────────────────
const AppModule = loadAmd(path.join(NEW, 'app-flow.js'), { 'ojs/ojarraydataprovider': function ADP(data) { this.data = data; }, 'resources/js/lineStatusLabels': { formatLabel: (c) => c } });
const app = new AppModule();
const AaPage = loadAmd(path.join(NEW_PAGES, 'approve-allocate-page.js'));
const nw = {
  lineBody: loadAmd(path.join(NEW_JS, 'requestLineBody.js')),
  rdl: loadAmd(path.join(NEW_JS, 'requestDetailLines.js')),
  ldu: loadAmd(path.join(NEW_JS, 'lineDetailUnits.js')),
  lineConfirmed: loadAmd(path.join(NEW_JS, 'lineConfirmed.js')),
};
const newChain = (dir, name, Actions) => loadAmd(path.join(dir, name + '.js'), {
  'vb/action/actionChain': class {}, 'vb/action/actions': Actions, 'resources/js/requestLineBody': nw.lineBody, 'resources/js/currentUser': cu,
  'resources/js/requestDetailLines': nw.rdl, 'resources/js/lineDetailUnits': nw.ldu, 'resources/js/lineConfirmed': nw.lineConfirmed,
});

// ── A fake backend: Actions that record every call and answer from answer(endpoint, opts) ────────────────────────
function backend(answer) {
  const calls = [];
  const toasts = [];
  const chains = [];
  const Actions = {
    async callRest(_c, o) {
      calls.push({ endpoint: o.endpoint, uriParams: o.uriParams, body: o.body, headers: o.headers });
      const r = answer ? answer(o.endpoint, o) : undefined;
      return r || { ok: true, status: 200, body: { data: [] } };
    },
    async fireNotificationEvent(_c, n) { toasts.push(n); },
    async callChain(_c, c) { chains.push(c); return { ok: true }; },
    async callComponentMethod(_c, m) { chains.push({ component: m.selector, method: m.method }); },
    async navigateToPage() {}, async navigateToFlow() {},
  };
  return { calls, toasts, chains, Actions };
}
const ok = (data, extra) => ({ ok: true, status: 200, body: Object.assign({ data }, extra || {}) });
const isWrite = (c) => /^eqp-v1\/(patch|create|update|delete|replace|failedLines)/.test(c.endpoint);
const now = (b) => (b ? JSON.parse(JSON.stringify(b).replace(/"(allocatedDate|releasedDate)":"[^"]+"/g, '"$1":"NOW"')) : b);
const spell = (calls) => json(calls.map((c) => ({ endpoint: c.endpoint, uriParams: c.uriParams, body: now(c.body), headers: c.headers })));
const appContext = (extra) => ({
  functions: app,
  variables: Object.assign({ flagsLoaded: true, pageAccessLoaded: true, featureFlags: { CUSTOMERS_MODULE_ENABLED: 'true' }, pageAccessMap: { EQR_WORKBENCH: 'FULL' },
    globalSettings: { ENABLE_QUOTES: 'CUSTOMER' }, appUrls: { old: 'http://old/', new: 'http://new/' } }, extra || {}),
});

const NOW = Date.UTC(2026, 9, 30, 9);
const day = (n) => new Date(NOW + n * 86400000).toISOString().slice(0, 10);

(async () => {
  T.section('copied from New EquipRite unchanged');
  ['requestLineBody', 'requestDetailLines', 'lineDetailUnits', 'lineConfirmed', 'currentUser'].forEach((f) => {
    T.check(`resources/js/${f}.js = New's`, read(path.join(NEXT_JS, f + '.js')) === read(path.join(NEW_JS, f + '.js')));
  });
  // The unit picker: New's page module methods, body for body.
  const body = (src, name) => {
    const at = src.search(new RegExp('\\n    ' + name.replace('$', '\\$') + '\\([^)]*\\) \\{'));
    if (at < 0) return null;
    let i = src.indexOf('{', at);
    let depth = 0;
    const start = i;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) break;
    }
    return src.slice(start, i + 1).replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ');
  };
  const pickerSrc = read(path.join(NEXT_JS, 'unitPicker.js'));
  const newPageSrc = read(path.join(NEW_PAGES, 'approve-allocate-page.js'));
  ['initUnits', 'getStagedChanges', 'isQtyMode', '_resource', 'remainingCapacity', '_locked', 'stageAssign', 'stageLot', 'setLotQty', 'stageRelease', 'cancelStage',
    'fillFree', 'allocationSummary', 'scheduleWindow', '_span', 'unitRows', 'windowBand', 'pickerMode'].forEach((m) => {
    const a = body(pickerSrc, m);
    T.check(`unitPicker.${m} = New's page module ${m}`, !!a && a === body(newPageSrc, m), m);
  });

  // ── The unit picker stages what New's stages ──────────────────────────────────────────────────────────────
  T.section('the unit picker stages what New EquipRite stages');
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
  const LOTS = [unitRow('LOT', 801, 'LOT-A', { availableToReserve: 3, uomCode: 'EA' }), unitRow('LOT', 802, 'LOT-B', { availableToReserve: 10, uomCode: 'EA', invOrgName: 'Dallas Yard' }),
    unitRow('LOT', 803, 'LOT-C', { availableToReserve: 0 })];
  const ITEMS = [unitRow('ITEM', 901, 'ITEM-9', { availableToReserve: 7, uomCode: 'EA' })];
  const BOOKINGS = [{ unitRefId: 701, bookingRequestNumber: 'REQ-482', bookingStartDate: '2026-10-28', bookingEndDate: '2026-11-12' },
    { unitRefId: 703, bookingRequestNumber: 'REQ-511', bookingStartDate: '2026-11-25', bookingEndDate: '2026-12-20' }];
  const both = (rows, mode, qty, confirmed, readOnly) => [new unitPicker.Picker(), new AaPage()].map((p) => {
    const built = nx.ldu.buildResources(rows, mode, { equipmentName: 'CAT 320', className: 'Excavators' }, 11);
    p.initUnits(built.resources, built.allocated, Object.assign({}, LINE_DATA, { qty }), mode, confirmed, readOnly, BOOKINGS, 'REQ-503');
    return p;
  });
  const seqs = [
    ['serial: assign, full, release, undo', SERIALS, 'serial', 2, (p) => [p.stageAssign(702), p.stageAssign(703), p.stageRelease(704), p.stageAssign(703), p.cancelStage(704), p.stageAssign(701)]],
    ['serial: fill from free units', SERIALS, 'serial', 3, (p) => [p.fillFree()]],
    ['serial: a confirmed line refuses everything', SERIALS, 'serial', 2, (p) => [p.stageAssign(702), p.fillFree(), p.stageRelease(704)], true],
    ['lot: quantities clamped, the box remembered, fill', LOTS, 'lot', 5, (p) => [p.stageLot(801, 9), p.setLotQty(802, 4), p.stageLot(802), p.setLotQty(801, 1), p.fillFree()]],
    ['lot: fill from free lots', LOTS, 'lot', 12, (p) => [p.fillFree()]],
    ['inventory: assign and release', ITEMS, 'inventory', 2, (p) => [p.stageLot(901), p.stageRelease(901)]],
  ];
  for (const [name, rows, mode, qty, run, confirmed] of seqs) {
    const [mine, theirs] = both(rows, mode, qty, !!confirmed, false);
    const a = run(mine);
    const b = run(theirs);
    T.eq(`${name}: same outcomes`, json(a), json(b));
    T.eq(`${name}: same staged changes`, json(mine.getStagedChanges()), json(theirs.getStagedChanges()));
    T.eq(`${name}: same rows, summary and schedule`, json([mine.unitRows(0), mine.allocationSummary(0), mine.windowBand()]),
      json([theirs.unitRows(0), theirs.allocationSummary(0), theirs.windowBand()]));
  }
  {
    const [p] = both(SERIALS, 'serial', 2);
    p.stageRelease(704);
    p.stageAssign(703);
    T.eq('what Save will do, in words', p.plan().text, 'Assign EX-2210 (Dallas Yard) and release EX-2214. The line will have 1 of 2 units.');
    const [l] = both(LOTS, 'lot', 12);
    l.fillFree();
    T.eq('suggestions in words (lots: how many from which)', l.suggestions().map((s) => s.text).join(' | '), '3 from LOT-A (Houston Yard) | 9 from LOT-B (Dallas Yard)');
    T.eq('nothing staged: no plan', new unitPicker.Picker().plan().text, '');
  }

  // ── The queue ─────────────────────────────────────────────────────────────────────────────────────────────
  T.section('the queue: what waits on the Equipment Manager, most urgent first');
  const ROWS = [
    { eqrEquipmentRequestId: 10, requestNumber: 'R10', status: 'SUBMITTED', startDate: day(9), endDate: day(20), projectName: 'Pipeline North', taskName: '2.1', requestorName: 'Priya', requestOrigin: 'Internal' },
    { eqrEquipmentRequestId: 11, requestNumber: 'R11', status: 'SUBMITTED', startDate: day(-2), endDate: day(20), customerName: 'Gulf Coast', requestorName: 'Dana', requestOrigin: 'External' },
    { eqrEquipmentRequestId: 12, requestNumber: 'R12', status: 'IN_PROCESS', startDate: day(3), endDate: day(20), projectName: 'Plant B', requestorName: 'Sam', requestOrigin: 'Internal' },
    { eqrEquipmentRequestId: 13, requestNumber: 'R13', status: 'IN_PROCESS', startDate: day(1), endDate: day(20), projectName: 'Plant B', requestOrigin: 'Internal' },
    { eqrEquipmentRequestId: 14, requestNumber: 'R14', status: 'QUOTE_ACCEPTED', startDate: day(3), endDate: day(20), customerName: 'Acme', requestOrigin: 'External' },
    { eqrEquipmentRequestId: 15, requestNumber: 'R15', status: 'DRAFT', startDate: day(1), endDate: day(9), projectName: 'X' },
    { eqrEquipmentRequestId: 16, requestNumber: 'R16', status: 'QUOTE_GENERATED', startDate: day(1), endDate: day(9), customerName: 'Acme', requestOrigin: 'External' },
    { eqrEquipmentRequestId: 9, requestNumber: 'R9', status: 'SUBMITTED', startDate: day(9), endDate: day(20), projectName: 'Older', requestOrigin: 'Internal' },
    { eqrEquipmentRequestId: 17, requestNumber: 'R17', status: 'IN_PROCESS', projectName: 'No dates', requestOrigin: 'Internal' },
  ];
  const LN = (status, alloc, name, qty) => ({ lineStatus: status, allocation: alloc || 'PENDING', name: name || 'Eq', cls: 'Cls', qty: qty || 1 });
  const LINES = {
    R10: [LN('SUBMITTED', '', 'Excavator'), LN('SUBMITTED', '', 'Dump truck')],
    R11: [LN('SUBMITTED', '', 'Generator')],
    R12: [LN('IN_PROCESS', 'ALLOCATED', 'Roller'), LN('IN_PROCESS', 'PENDING', 'Light tower'), LN('SHIP_TO_SITE', 'ALLOCATED')],
    R13: [LN('ALLOCATED', 'ALLOCATED'), LN('SCHEDULED_FOR_PICKING', 'ALLOCATED')],
    R14: [LN('QUOTE_ACCEPTED', 'PENDING', 'Scaffold')],
    R15: [LN('DRAFT')], R16: [LN('QUOTE_GENERATED')],
    R9: [LN('SUBMITTED'), LN('REJECTED')],
    R17: [LN('IN_PROCESS', 'PARTIAL', 'Crane')],
  };
  const quoting = (src) => rules.isQuotingAllowed({ ENABLE_QUOTES: 'CUSTOMER' }, true, src);
  const items = queue.build(ROWS, LINES, { now: NOW, quoting });
  const by = (n) => items.find((i) => i.number === n);
  T.eq('in the queue: submitted, and approved with lines still needing a unit (not a draft, not fully allocated, not waiting on a customer)',
    items.map((i) => i.number + ':' + i.kind).join(' '), 'R11:decide R12:allocate R14:allocate R9:decide R10:decide R17:allocate');
  T.eq('most urgent first: the late one, then by start date, then the oldest request; no date last', items.map((i) => i.number).join(), 'R11,R12,R14,R9,R10,R17');
  T.eq('late: days past the start, and why (requestProgress)', json([by('R11').late, by('R11').lateWhy]), '["2 days late","1 not shipped, due 28 Oct (2 days late)"]');
  T.eq('when it starts', json([by('R12').when, by('R10').when, by('R11').when]), '["Starts in 3 days","Starts in 9 days","Started 2 days ago"]');
  T.eq('what each waits for, in words', items.map((i) => i.detail).join(' | '),
    '1 line waiting for your decision | 1 of 3 lines still without a unit | 1 line approved, no unit assigned yet | 1 line waiting for your decision'
    + ' | 2 lines waiting for your decision | 1 line with only part of its units');
  T.eq('an approved customer request owing a quote says so', queue.build([Object.assign({}, ROWS[4], { status: 'IN_PROCESS' })], LINES, { now: NOW, quoting })[0].detail,
    'A quote is owed before units can be assigned');
  T.eq('a sent-back line does not count as open', by('R9').lineCount, 1);
  T.eq('quote owed: customer origin with ENABLE_QUOTES=CUSTOMER, no quote yet (QUOTE_ACCEPTED has one)', json([by('R11').quoteOwed, by('R14').quoteOwed, by('R14').needs]), '[true,false,"Units to assign"]');
  T.eq('chips', json(queue.chips(items).map((c) => c.key + ':' + c.count)), '["all:6","late:1","decide:3","allocate:3"]');
  T.eq('no Late chip when nothing is late', queue.chips(items.filter((i) => !i.lateDays)).map((c) => c.key).join(), 'all,decide,allocate');
  T.eq('chip, source and search (every word, equipment included)', [queue.filter(items, '', 'late').map((i) => i.number).join(), queue.filter(items, '', 'all', 'EXTERNAL').map((i) => i.number).join(),
    queue.filter(items, 'plant tower', 'all').map((i) => i.number).join()].join(' | '), 'R11 | R11,R14 | R12');
  T.eq('summary', queue.summary(items), '3 requests to decide · 3 requests with units to assign · 1 late');
  T.eq('summary when nothing waits', queue.summary([]), 'Nothing is waiting on you: every request is decided and every approved line has its units.');
  T.eq('selection: only requests to decide, with what they add up to', json(queue.selection(items, ['10', '11', '12', '99'])),
    '{"count":2,"ids":["11","10"],"text":"2 requests ticked · 1 project, 1 customer · 3 lines"}');
  T.eq('a request read with nothing left to assign leaves the queue, until more of its lines wait', [
    queue.build(ROWS, LINES, { now: NOW, quoting, settled: { 12: 1 } }).some((i) => i.number === 'R12'),
    queue.build(ROWS, LINES, { now: NOW, quoting, settled: { 12: 0 } }).some((i) => i.number === 'R12')].join(), 'false,true');
  T.check('the export: the columns a person wants, with the stored status', queue.exportColumns().map((c) => c.label).join() ===
    'Request,Type,Project or customer,Task,Waiting for,What,Equipment,Start,End,When,Late,Requested by,Stored status' && queue.exportColumns()[1].value(by('R11')) === 'Customer');

  // ── The gates are New's ───────────────────────────────────────────────────────────────────────────────────
  T.section('the gates give New EquipRite\'s answers');
  const aaNew = new AaPage();
  const L = (no, status, extra) => Object.assign({ line_id: 900 + no, line_no: no, lineId: String(900 + no), lineStatus: status, line_status: status,
    equipment_name: 'Eq ' + no, equipmentName: 'Eq ' + no, qty: 1, alloc_status: 'PENDING', is_serial_controlled: true, availability: 'AVAILABLE', est_cost: 100 }, extra || {});
  let same = 0;
  let total = 0;
  const diffs = [];
  ['SUBMITTED', 'IN_PROCESS', 'QUOTE_GENERATED', 'QUOTE_ACCEPTED', 'DEPLOYED', 'REJECTED'].forEach((status) => [false, true].forEach((ext) => [false, true].forEach((quot) =>
    [false, true].forEach((ro) => ['IN_PROCESS', 'SUBMITTED', 'UNDER_PROCUREMENT', 'REJECTED', 'CANCELLED', 'ALLOCATED'].forEach((ls) =>
      [{}, { is_serial_controlled: false }, { is_serial_controlled: false, is_lot_controlled: true }, { is_serial_controlled: false, fulfilment_class: 'F_AND_M' },
        { alloc_status: 'ALLOCATED' }].forEach((x) => {
        const line = L(1, ls, x);
        const a = queue.lineAction(line, { status, external: ext }, quot, ro);
        const b = aaNew.lineAction(line, { status, isCustomer: ext }, quot, ro);
        total++;
        if (a.kind === b.kind && (a.kind !== 'allocate' || (a.label === 'Pick units') === (b.label === 'Allocate'))) same++;
        else diffs.push([status, ext, quot, ro, ls, json(x), a.kind, b.kind].join('/'));
      }))))));
  T.eq(`lineAction: the same kind as New in every case (${total})`, same + ' ' + diffs.slice(0, 3).join(' ; '), total + ' ');
  T.eq('isPickable, tracking and availability as New', json([L(1, '', { is_serial_controlled: false }), L(2, ''), L(3, '', { is_serial_controlled: false, is_inventory_tracked: true })]
    .map((l) => [queue.isPickable(l), queue.tracking(l)])), json([L(1, '', { is_serial_controlled: false }), L(2, ''), L(3, '', { is_serial_controlled: false, is_inventory_tracked: true })]
    .map((l) => [aaNew.isPickable(l), aaNew.tracking(l)])));
  T.eq('availability tones as New', ['AVAILABLE', 'PARTIAL DURATION', 'PARTIAL QUANTITY', 'NOT AVAILABLE', ''].map((a) => queue.availTone(a)).join(),
    ['AVAILABLE', 'PARTIAL DURATION', 'PARTIAL QUANTITY', 'NOT AVAILABLE', ''].map((a) => aaNew.availTone(a)).join());
  {
    const lines = [L(1, 'SUBMITTED'), L(2, 'SUBMITTED', { availability: 'NOT AVAILABLE' }), L(3, 'REJECTED'), L(4, 'IN_PROCESS')];
    aaNew.initGridData(lines);
    const cases = [[[], []], [['902'], [1]], [['904', '901'], [3, 0]], [['903'], [2]]];
    const got = cases.map(([ids, idx]) => {
      aaNew.setAllSelected(false);
      idx.forEach((i) => aaNew.setRowSelected(i, true));
      return ['approve', 'reject'].map((k) => {
        const a = queue.decisionPlan(k, lines, ids, 'Sam');
        const b = aaNew.decisionPlan(k, lines, idx.length, 0);
        return a.count === b.count && a.settled === b.settled && a.all === b.all;
      }).join();
    });
    T.eq('approve / reject act on the same lines as New (the ticked ones in tick order, or every line)', got.join(' '), 'true,true true,true true,true true,true');
    T.eq('the ticked lines in the order ticked (New\'s getSelectedLines)', queue.pool(lines, ['904', '901']).map((l) => l.lineId).join(), '904,901');
    const plan = queue.decisionPlan('approve', lines, [], 'Sam');
    T.eq('approve, before the click', json([plan.label, plan.note]), '["Approve all 3 lines","3 lines will be approved. Every line is then decided, so the request moves on to unit assignment. 1 line already decided stays as it is."]');
    const sub = queue.decisionPlan('approve', lines, ['901'], 'Sam');
    T.eq('approve one line: the request keeps waiting', sub.note, '1 line will be approved. The request keeps waiting for 1 line still to decide.');
    const rej = queue.decisionPlan('reject', lines, ['902'], 'Sam');
    T.eq('send back, before the click', json([rej.label, rej.note, rej.headerMoves]), '["Send back 1 line","1 line will go back to Sam with your reason; a line sent back cannot be approved later. The rest of the request stays open.",false]');
    T.eq('send back everything open: the request is sent back', queue.decisionPlan('reject', lines, [], 'Sam').headerMoves, true);
    const v = queue.verdict({ status: 'SUBMITTED' }, lines, false);
    T.check('the verdict: decision, availability', v.tone === 'warn' && v.text.startsWith('Waiting for your decision: 3 of 4 lines.') && v.text.includes('Line 2 (Eq 2) is not available for its dates'), v.text);
    const inLines = [L(1, 'IN_PROCESS', { alloc_status: 'ALLOCATED' }), L(2, 'IN_PROCESS'), L(3, 'IN_PROCESS', { is_serial_controlled: false })];
    T.eq('the verdict: what still needs units', queue.verdict({ status: 'IN_PROCESS' }, inLines, false).text,
      '1 of 2 lines has its units. Line 2 (Eq 2) still needs units: assign them here, or leave it for the yard to pick on the Oracle mobile app.');
    T.eq('the verdict: all assigned, next is picking (in New)', json(queue.verdict({ status: 'IN_PROCESS' }, [inLines[0], inLines[2]], false)),
      '{"tone":"ok","text":"Every line has its units (1 of 1). Next: Initiate picking, in New EquipRite.","next":"picking"}');
    T.eq('the verdict: a quote owed', queue.verdict({ status: 'IN_PROCESS' }, inLines, true).next, 'quote');
    T.eq('nothing left to assign: how many lines take no unit', json([queue.settledCount({ status: 'IN_PROCESS' }, [inLines[0], inLines[2]], false),
      queue.settledCount({ status: 'IN_PROCESS' }, inLines, false), queue.settledCount({ status: 'SUBMITTED' }, [inLines[0]], false)]), '[1,null,null]');
    const rows = queue.lineRows([L(1, 'IN_PROCESS', { allocated_serial: '1 of 2 allocated', qty: 2, alloc_status: 'PARTIAL' }), L(2, 'IN_PROCESS', { is_serial_controlled: false })],
      { status: 'IN_PROCESS', external: false }, false, false);
    T.eq('the lines in words', json(rows.map((r) => [r.label, r.units, r.action, r.actionLabel, r.reason])),
      '[["Approved, no unit assigned yet","1 of 2 assigned","allocate","Pick units",""],["Approved, no unit assigned yet","No unit needed","none","","Free stock: no unit to assign; the yard picks the quantity."]]');
  }

  // ── The writes are New's ──────────────────────────────────────────────────────────────────────────────────
  T.section('approve and send back: the same calls as New\'s confirmRequestChain and rejectRequestChain');
  const DL = [{ lineId: 9011, equipmentName: 'CAT 320', lineStatus: 'SUBMITTED' }, { lineId: 9012, equipmentName: 'Dump truck', lineStatus: 'SUBMITTED' },
    { lineId: 9013, equipmentName: 'Roller', lineStatus: 'REJECTED' }, { lineId: 9014, equipmentName: 'Light tower', lineStatus: 'IN_PROCESS' }];
  const refs = DL.map((l) => ({ lineId: String(l.lineId), lineStatus: l.lineStatus, equipmentName: l.equipmentName }));
  const answer = (opts) => (ep, o) => {
    const x = opts || {};
    if (ep === 'eqp-v1/getEquipriteV1ViewsRequestDetailLines') return x.noLines ? { ok: false, status: 500, body: {} } : ok(DL);
    if (ep === 'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2') return x.lookupFails ? { ok: false, status: 500, body: {} } : ok([{ id: 9011, allocationStatus: 'ALLOCATED' }, { id: 9012, allocationStatus: 'PENDING' }]);
    if (ep === 'eqp-v1/patchRequestLinesBatch' && x.batch409) return { ok: false, status: 409, body: { message: 'Line 9011 was changed by another user' } };
    if (ep === 'eqp-v1/patchEquipmentRequest' && x.headerFails) return { ok: false, status: 500, body: {} };
    return undefined;
  };
  async function runNew(name, ticked, opts) {
    const b = backend(answer(opts));
    const sel = refs.filter((r) => ticked.indexOf(r.lineId) !== -1);
    await new (newChain(AA_CHAINS, name, b.Actions))().run({ $page: { variables: { requestNumericId: 501, requestId: 'REQ-501', formData: { status: 'SUBMITTED' }, selectionTick: 0 },
      functions: { getSelectedLines: () => ticked.map((id) => sel.find((r) => r.lineId === id)), getAllLines: () => refs.slice() } } });
    return b;
  }
  async function runNext(fn, ticked, opts) {
    const b = backend(answer(opts));
    const res = await aa[fn](null, b.Actions, { requestId: 501, pool: ticked.length ? ticked.map((id) => refs.find((r) => r.lineId === id)) : refs.slice(), allLines: refs.slice() });
    return Object.assign(b, { res });
  }
  const decideCases = [
    ['every line', []], ['two lines ticked, in tick order', ['9012', '9011']], ['a settled line ticked', ['9013']],
    ['every line, the lookup failing', [], { lookupFails: true }], ['every line, the batch refused (409)', [], { batch409: true }],
    ['every line, the header failing', [], { headerFails: true }],
  ];
  for (const [name, ticked, opts] of decideCases) {
    const n1 = await runNew('confirmRequestChain', ticked, opts);
    const m1 = await runNext('approve', ticked, opts);
    T.eq(`approve, ${name}: the same calls`, spell(m1.calls), spell(n1.calls.filter((c) => c.endpoint.startsWith('eqp-v1/'))));
    const n2 = await runNew('rejectRequestChain', ticked, opts);
    const m2 = await runNext('reject', ticked, opts);
    T.eq(`send back, ${name}: the same calls`, spell(m2.calls), spell(n2.calls));
  }
  {
    const m = await runNext('approve', []);
    T.eq('approve, written out: an allocated line goes to ALLOCATED, a sent-back one is left alone; the header moves once every line is decided',
      json(m.calls.filter(isWrite).map((c) => [c.endpoint, c.uriParams, c.body, c.headers])),
      json([['eqp-v1/patchRequestLinesBatch', { requestId: 501 }, { lines: [{ id: 9011, lineStatus: 'ALLOCATED' }, { id: 9012, lineStatus: 'IN_PROCESS' }, { id: 9014, lineStatus: 'IN_PROCESS' }] }, { 'X-User-Id': 'priya.raman' }],
        ['eqp-v1/patchEquipmentRequest', { id: 501 }, { status: 'IN_PROCESS' }, undefined]]));
    T.eq('…in words', queue.approveWords('REQ-501', m.res).text,
      'Approved 3 lines on REQ-501. 1 line already had its units and is ready for picking. Every line is decided: the request moves on to unit assignment.');
    const f = await runNext('approve', [], { batch409: true });
    T.check('a refused batch: nothing changed, said so, someone else may have changed it', !f.res.ok && /^Nothing was approved on REQ-501: Line 9011 was changed by another user No line was changed\. Someone else may have changed/.test(queue.approveWords('REQ-501', f.res).text),
      queue.approveWords('REQ-501', f.res).text);
    const r = await runNext('reject', ['9012']);
    T.eq('send back one line: only it, the request stays open', json([r.calls.filter(isWrite).map((c) => c.body), r.res.requestRejected]), '[[{"lines":[{"id":9012,"lineStatus":"REJECTED"}]}],false]');
    T.eq('…in words, with the reason sent', queue.rejectWords('REQ-501', r.res, { ok: true }, 'Priya').text, 'Sent back 1 line on REQ-501. Your reason was sent to Priya.');
    T.eq('…or not', queue.rejectWords('REQ-501', r.res, { ok: false, status: 400 }, 'Priya').text, 'Sent back 1 line on REQ-501. Your reason could not be sent (HTTP 400). Tell Priya yourself.');
  }

  T.section('bulk: the same calls as New\'s bulkDecideChain, request by request');
  for (const action of ['approve', 'reject']) {
    for (const opts of [{}, { batch409: true }, { noLines: true }]) {
      const b = backend(answer(opts));
      const c = { $page: { variables: { buckets: { approve: [{ request_id: 501, request_number: 'REQ-501', status: 'SUBMITTED' }] }, selection: { count: 1, ids: [501] },
        selectedIds: [501], bulkBusy: false, isReadOnly: false } }, $application: appContext() };
      await new (newChain(WB_CHAINS, 'bulkDecideChain', b.Actions))().run(c, { action });
      const m = backend(answer(opts));
      const out = await aa.decideRequest(null, m.Actions, action, 501);
      T.eq(`${action}${opts.batch409 ? ', the batch refused' : (opts.noLines ? ', the lines unreadable' : '')}: the same calls`, spell(m.calls), spell(b.calls));
      if (opts.noLines) T.eq('…nothing changed, said so', json([out.ok, out.message]), '[false,"Its lines could not be read; nothing was changed."]');
    }
  }

  T.section('a line\'s units: the same reads and gates as New\'s openUnitsChain');
  const UNIT_ROWS = SERIALS.map((u) => Object.assign({ requestNumber: 'REQ-503', requestStatus: 'IN_PROCESS', source: 'INTERNAL', lineStatus: 'IN_PROCESS',
    equipmentMasterId: 11, equipmentName: 'CAT 320', className: 'Excavators', quantity: 2, isSerialControlled: 'Y', lineStartDate: '2026-11-08', lineEndDate: '2026-11-22' }, u));
  const unitsAnswer = (rows, tos) => (ep) => {
    if (ep === 'eqp-v1/getEquipriteV1ViewsLineDetailUnits') return ok(rows);
    if (ep === 'eqp-v1/getTransferOrders') return ok(tos || []);
    if (ep === 'eqp-v1/getTransferOrderLines') return ok([{ requestLineId: 9031 }]);
    if (ep === 'eqp-v1/getEquipriteV1ViewsLineDetailBookings') return ok(BOOKINGS);
    return undefined;
  };
  const LINE = L(1, 'IN_PROCESS', { line_id: 9031, equipment_master_id: 11, lineId: '9031' });
  for (const [name, rows, tos] of [['serial', UNIT_ROWS], ['serial, a live Transfer Order', UNIT_ROWS, [{ id: 77, fusionToStatus: 'TO_CREATED' }]],
    ['lot', [Object.assign({}, UNIT_ROWS[0], { isSerialControlled: 'N', isLotControlled: 'Y', unitType: 'LOT', unitRefId: 801, lotRefId: 801, availableToReserve: 4 })]],
    ['the units say SUBMITTED', UNIT_ROWS.map((u) => Object.assign({}, u, { requestStatus: 'SUBMITTED' }))], ['no unit of this line', []],
    ['a customer line being bought in', UNIT_ROWS.map((u) => Object.assign({}, u, { source: 'EXTERNAL', lineStatus: 'UNDER_PROCUREMENT' }))]]) {
    const b = backend(unitsAnswer(rows, tos));
    const c = { $page: { variables: { requestNumericId: 503, requestId: 'REQ-503', formData: { status: 'IN_PROCESS', requestNumber: 'REQ-503' }, quotingAllowed: false, isReadOnly: false,
      openLineId: '', allocLine: null, units: {}, stagingTick: 0 }, functions: new AaPage() }, $application: appContext() };
    c.$page.functions.initGridData([LINE]);
    await new (newChain(AA_CHAINS, 'openUnitsChain', b.Actions))().run(c, { lineId: '9031' });
    const m = backend(unitsAnswer(rows, tos));
    const u = await aa.loadUnits(null, m.Actions, { requestId: 503, line: LINE, requestNumber: 'REQ-503', readOnly: false, bookings: true,
      isExternal: (s) => rules.isExternalSource(s), quotingOn: (s) => rules.isQuotingAllowed({ ENABLE_QUOTES: 'CUSTOMER' }, true, s) });
    T.eq(`${name}: the same reads`, spell(m.calls), spell(b.calls));
    const v = c.$page.variables;
    T.eq(`${name}: the same outcome`, json(u.error ? [u.error.replace('Units can be assigned once the request is approved.', 'Allocation opens once the request is approved.')
      .replace('Its units could not be read', 'The units of this line could not be loaded')] : [u.mode, u.confirmed, u.readOnly, u.allocLine, u.resources.length]),
    json(v.units.error && !v.allocLine ? [v.units.error] : [v.units.mode, v.units.confirmed, v.units.readOnly, v.allocLine, c.$page.functions.unitRows(0).length]));
  }

  T.section('saving a line\'s units: the same calls as New\'s saveAllocationChain');
  function world(mode, opts) {
    const o = opts || {};
    const state = { lineStatus: o.lineStatus || 'IN_PROCESS', atr: { 801: 10, 802: 4, 901: 7 }, alloc: Object.assign({}, o.alloc || {}), nextId: 8800 };
    const units = mode === 'serial' ? SERIALS.slice(0, 3).concat([unitRow('SERIAL', 704, 'EX-2214', { availabilityStatus: 'AVAILABLE' })])
      : (mode === 'lot' ? [unitRow('LOT', 801, 'LOT-A', { availableToReserve: 10 }), unitRow('LOT', 802, 'LOT-B', { availableToReserve: 4 })]
        : [unitRow('ITEM', 901, 'ITEM-9', { availableToReserve: 7 })]);
    const ans = (ep, req) => {
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
    const resources = () => nx.ldu.buildResources(ans('eqp-v1/getEquipriteV1ViewsLineDetailUnits', {}).body.data, mode, { equipmentName: 'CAT 320', className: 'Excavators' }, 11);
    return { ans, resources };
  }
  const saveCases = [
    ['serial: assign one', 'serial', 1, (p) => p.stageAssign(702)],
    ['serial: assign two of three', 'serial', 3, (p) => { p.stageAssign(702); p.stageAssign(703); }],
    ['serial: swap', 'serial', 1, (p) => { p.stageRelease(704); p.stageAssign(702); }, { alloc: { 704: { id: 8704, qty: 1 } }, lineStatus: 'ALLOCATED' }],
    ['serial: release the last unit (back to IN_PROCESS)', 'serial', 1, (p) => p.stageRelease(704), { alloc: { 704: { id: 8704, qty: 1 } }, lineStatus: 'ALLOCATED' }],
    ['serial: release on a quoted line (back to QUOTE_ACCEPTED)', 'serial', 1, (p) => p.stageRelease(704), { alloc: { 704: { id: 8704, qty: 1 } }, lineStatus: 'ALLOCATED', quoting: true }],
    ['serial: a line past allocation keeps its status', 'serial', 1, (p) => p.stageAssign(702), { lineStatus: 'PICK_INITIATED' }],
    ['serial: fill from free units (auto-allocate)', 'serial', 2, (p) => p.fillFree()],
    ['serial: a live Transfer Order (nothing written)', 'serial', 1, (p) => p.stageAssign(702), { tos: [{ id: 5, fusionToStatus: 'TO_CREATED' }] }],
    ['serial: the allocation refused', 'serial', 1, (p) => p.stageAssign(702), { failCreate: true }],
    ['lot: from two lots', 'lot', 6, (p) => { p.stageLot(801, 3); p.stageLot(802, 4); }],
    ['lot: fill (auto-allocate)', 'lot', 12, (p) => p.fillFree()],
    ['lot: release', 'lot', 6, (p) => p.stageRelease(801), { alloc: { 801: { id: 8801, qty: 3 } } }],
    ['inventory: assign', 'inventory', 2, (p) => p.stageLot(901, 2)],
    ['inventory: release', 'inventory', 2, (p) => p.stageRelease(901), { alloc: { 901: { id: 8901, qty: 2 } } }],
  ];
  for (const [name, mode, qty, stage, opts] of saveCases) {
    const lineData = Object.assign({}, LINE_DATA, { qty, quoting_on: !!(opts && opts.quoting) });
    const w0 = world(mode, opts);
    const picker = new unitPicker.Picker();
    const built = w0.resources();
    picker.initUnits(built.resources, built.allocated, lineData, mode, false, false, [], 'REQ-503');
    stage(picker);
    const staged = picker.getStagedChanges();
    const bNew = backend(world(mode, opts).ans);
    const fns = new AaPage();
    fns.getStagedChanges = () => JSON.parse(JSON.stringify(staged));
    await new (newChain(AA_CHAINS, 'saveAllocationChain', bNew.Actions))().run({ $page: { variables: { requestId: 'REQ-503', requestNumericId: 503, allocLine: lineData, isSaving: false },
      functions: fns } });
    const bNext = backend(world(mode, opts).ans);
    const res = await aa.saveAllocation(null, bNext.Actions, { requestId: 503, lineData, staged: JSON.parse(JSON.stringify(staged)) });
    T.eq(`${name}: the same calls`, spell(bNext.calls), spell(bNew.calls));
    if (opts && opts.tos) T.eq('…a confirmed line: nothing written, said so', json([res.confirmed, queue.saveWords(lineData, res, picker.plan()).tone]), '[true,"error"]');
    if (opts && opts.failCreate) T.check('…the failure said in words', /saved with problems\. Create allocation for EX-2203 failed \(HTTP 500\)/.test(queue.saveWords(lineData, res, picker.plan()).text));
    if (name === 'serial: assign one') {
      T.eq('…written out', json(bNext.calls.filter(isWrite).map((c) => [c.endpoint, c.uriParams, now(c.body)])), json([
        ['eqp-v1/createAllocation', undefined, { requestLineId: 9031, serialRefId: 702, allocatedQty: 1, allocationStatus: 'ALLOCATED', allocatedDate: 'NOW', eqpInvOrgId: 300, eqpInvOrgName: 'Houston Yard' }],
        ['eqp-v1/patchSerialRef', { id: 702 }, { unitStatus: 'RENTED' }],
        ['eqp-v1/patchRequestLine', { requestId: 503, id: 9031 }, { allocationStatus: 'ALLOCATED', lineStatus: 'ALLOCATED' }]]));
      T.eq('…in words', queue.saveWords(lineData, res, picker.plan()).text, 'Line 1 (CAT 320): assign EX-2203 (Houston Yard). It has all its units.');
    }
  }
  {
    const b = backend();
    const res = await aa.saveAllocation(null, b.Actions, { requestId: 503, lineData: LINE_DATA, staged: { mode: 'serial', pendingAssignments: [], pendingReleases: [] } });
    T.eq('nothing staged: nothing called', json([b.calls.length, res.nothing]), '[0,true]');
  }

  T.section('the reason for sending back goes to the requester (added for Next: FDD S07, NTF-03)');
  {
    const b = backend();
    const r = await aa.notifySentBack(null, b.Actions, { userId: '77', requestId: 509, requestNumber: 'REQ-509', reason: '  Dates clash. ', lines: 2, whole: true });
    T.eq('one notification, in the fields the bell reads', json([r.ok, b.calls]), json([true, [{ endpoint: 'eqp-v1/createNotification', uriParams: undefined,
      body: { userId: 77, requestId: 509, requestNumber: 'REQ-509', subject: 'REQ-509 was sent back', message: 'Dates clash.' }, headers: { 'X-User-Id': 'priya.raman' } }]]));
    const n = backend();
    T.eq('no requester user: nothing sent, said so', json([(await aa.notifySentBack(null, n.Actions, { userId: null, requestId: 1, reason: 'x' })).skipped, n.calls.length]), '[true,0]');
  }

  // ── The page's chains ─────────────────────────────────────────────────────────────────────────────────────
  T.section('the page\'s chains: who may act, a reason first, reads only on opening');
  const toastLog = [];
  const opened = [];
  const bus = { toast: (m, t) => toastLog.push([m, t]), open: (r) => opened.push(r), rename() {} };
  let invalidated = 0;
  const reqData = (rows, lines) => ({ load: async () => ({ rows, linesByRequest: lines, linesLoaded: true, manager: true, error: '' }), invalidate: () => { invalidated++; } });
  const PageModule = loadAmd(path.join(PAGE_DIR, 'approvals-page.js'), { 'resources/js/exportKit': { FORMATS: [] }, 'resources/js/fmt': fmt,
    'resources/js/nav': { newUrl: (b, id) => (b ? b + 'vp/shell/logistics/picking' : '') }, 'resources/js/unitPicker': unitPicker, 'resources/js/approvalQueue': queue });
  const pageChain = (name, Actions, extra) => loadAmd(path.join(CHAINS, name + '.js'), Object.assign({
    'vb/action/actionChain': class {}, 'vb/action/actions': Actions, 'resources/js/approveAllocate': aa, 'resources/js/approvalQueue': queue, 'resources/js/rules': rules,
    'resources/js/requestProgress': Progress, 'resources/js/fmt': fmt, 'resources/js/shellBus': bus, 'resources/js/unitPicker': unitPicker,
    'resources/js/requestData': reqData([], {}), 'resources/js/exportKit': { run: async () => ({ ok: true, message: 'ok' }) },
  }, extra || {}));
  const pageJson = JSON.parse(read(path.join(PAGE_DIR, 'approvals-page.json')));
  const pageCtx = (vars, appVars) => {
    const v = {};
    Object.keys(pageJson.variables).forEach((k) => { v[k] = JSON.parse(JSON.stringify(pageJson.variables[k].defaultValue === undefined ? null : pageJson.variables[k].defaultValue)); });
    return { $page: { variables: Object.assign(v, vars || {}), functions: new PageModule() }, $application: appContext(appVars) };
  };
  const HEAD = { id: 509, number: 'REQ-509', status: 'SUBMITTED', requestor: 'Sam', requestorUserId: 77, deciding: true };
  const LINES509 = [{ lineId: '9091', lineStatus: 'SUBMITTED', equipmentName: 'Roller', line_status: 'SUBMITTED' }, { lineId: '9092', lineStatus: 'SUBMITTED', equipmentName: 'Compactor', line_status: 'SUBMITTED' }];
  {
    const b = backend();
    const c = pageCtx({ canAct: false, rec: { head: HEAD, rows: [] }, lines: LINES509, reason: 'x' });
    await new (pageChain('decideChain', b.Actions))().run(c, { action: 'approve' });
    await new (pageChain('decideChain', b.Actions))().run(c, { action: 'reject' });
    T.eq('without full access: nothing is called', b.calls.length, 0);
  }
  {
    const b = backend();
    const c = pageCtx({ canAct: true, rec: { head: HEAD, rows: [] }, lines: LINES509, reason: '   ' });
    await new (pageChain('decideChain', b.Actions))().run(c, { action: 'reject' });
    T.eq('send back without a reason: nothing is called, it asks for one', json([b.calls.length, c.$page.variables.formError]), '[0,"Write the reason first: Sam gets it with the request."]');
  }
  {
    const b = backend();
    const c = pageCtx({ canAct: true, rec: { head: HEAD, rows: [] }, lines: LINES509, ticks: ['9092'], reason: 'Booked for the shutdown.' });
    invalidated = 0;
    await new (pageChain('decideChain', b.Actions, { 'resources/js/requestData': reqData([], {}) }))().run(c, { action: 'reject' });
    T.eq('send back the ticked line: the line, then the reason', json(b.calls.map((x) => [x.endpoint.replace('eqp-v1/', ''), x.body])),
      json([['patchRequestLinesBatch', { lines: [{ id: 9092, lineStatus: 'REJECTED' }] }],
        ['createNotification', { userId: 77, requestId: 509, requestNumber: 'REQ-509', subject: 'REQ-509: 1 line was sent back', message: 'Booked for the shutdown.' }]]));
    T.eq('then the shared request list is dropped, the queue and the request read again', json([invalidated, b.chains.map((x) => x.chain)]), '[1,["loadChain","recordChain"]]');
    T.eq('the result in words, on the page', c.$page.variables.result.text, 'Sent back 1 line on REQ-509. Your reason was sent to Sam.');
  }
  {
    const b = backend();
    const items = [{ key: '509', id: 509, number: 'REQ-509', kind: 'decide', requestor: 'Sam' }];
    const c = pageCtx({ canAct: true, items, selection: { count: 1, ids: ['509'] }, bulk: { mode: 'reject', reason: '' } });
    await new (pageChain('bulkChain', b.Actions))().run(c, { action: 'reject' });
    T.eq('bulk send back without a reason: nothing called', json([b.calls.length, c.$page.variables.bulk.error]), '[0,"Write the reason first: each requester gets it with their request."]');
    const r = backend(answer());
    const ro = pageCtx({ canAct: false, items, selection: { count: 1, ids: ['509'] } });
    await new (pageChain('bulkChain', r.Actions))().run(ro, { action: 'approve' });
    T.eq('bulk without full access: nothing called', r.calls.length, 0);
    const a = backend(answer());
    const ok1 = pageCtx({ canAct: true, items, selection: { count: 1, ids: ['509'] } });
    await new (pageChain('bulkChain', a.Actions))().run(ok1, { action: 'approve' });
    T.eq('bulk approve: New\'s calls for the request, then the queue read again', json([a.calls.map((x) => x.endpoint.replace('eqp-v1/', '')), a.chains.map((x) => x.chain)]),
      json([['getEquipriteV1ViewsRequestDetailLines', 'getEquipriteV1EquipmentRequestsRequestIdLines2', 'patchRequestLinesBatch', 'patchEquipmentRequest'], ['loadChain']]));
    T.eq('…the result, in words', ok1.$page.variables.bulkResult.title, '1 of 1 request approved');
  }
  {
    const DET = [{ lineId: 9031, equipmentName: 'CAT 320', className: 'Excavators', quantity: 1, lineStatus: 'IN_PROCESS', availabilityStatus: 'AVAILABLE', isSerialControlled: 'Y',
      equipmentMasterId: 11, requestNumber: 'REQ-503', requestStatus: 'IN_PROCESS', startDate: '2026-11-08', endDate: '2026-11-22', source: 'INTERNAL' }];
    const b = backend((ep) => {
      if (ep === 'eqp-v1/getEquipriteV1ViewsRequestDetailLines') return ok(DET);
      if (ep === 'eqp-v1/getEquipriteV1EquipmentRequestById') return { ok: true, status: 200, body: { id: 503, status: 'IN_PROCESS', requestorName: 'Sam', requestorUserId: 77 } };
      if (ep === 'eqp-v1/getEquipriteV1ViewsLineDetailUnits') return ok(UNIT_ROWS.slice(0, 3).map((u) => Object.assign({}, u, { lineId: 9031, quantity: 1 })));
      return undefined;
    });
    const c = pageCtx({ canAct: true, current: { key: '503', id: 503, number: 'REQ-503', status: 'IN_PROCESS', start: '2026-11-08', end: '2026-11-22' } });
    const chainsRun = [];
    const Actions = Object.assign({}, b.Actions, {
      async callChain(ctx, ch) {
        chainsRun.push(ch.chain);
        if (ch.chain === 'suggestChain') await new (pageChain('suggestChain', Actions))().run(ctx, ch.params || {});
      },
    });
    await new (pageChain('recordChain', Actions))().run(c, {});
    T.eq('opening a request reads only: its lines and header, then each line\'s units and the Transfer Orders', json(b.calls.map((x) => x.endpoint.replace('eqp-v1/', ''))),
      json(['getEquipriteV1ViewsRequestDetailLines', 'getEquipriteV1EquipmentRequestById', 'getTransferOrders', 'getEquipriteV1ViewsLineDetailUnits']));
    T.check('nothing written', !b.calls.some(isWrite));
    T.eq('the suggestion for the line, in words', c.$page.variables.sugg.byLine['9031'].words.text, 'Suggested: EX-2203 (Houston Yard)');
    T.eq('auto-allocate, before the click', json(c.$page.variables.sugg.plan), json({ count: 1, lines: [{ id: '9031', text: 'Line 1 · CAT 320: EX-2203 (Houston Yard)' }], none: [],
      label: 'Assign the suggested units to 1 line' }));
    T.eq('the staged suggestion is what auto-allocate will save', json(c.$page.functions.suggestion('9031').getStagedChanges().pendingAssignments.map((a) => a.eqrSerialRefId)), '[702]');
  }
  {
    const b = backend();
    toastLog.length = 0;
    const c = pageCtx({ canAct: true, rec: { head: { id: 509, number: 'REQ-509', status: 'SUBMITTED' }, rows: [] }, lines: [Object.assign(L(1, 'SUBMITTED'), { lineId: '901' })] });
    await new (pageChain('unitsChain', b.Actions))().run(c, { lineId: '901' });
    T.eq('a line whose units are not open yet: nothing read, the reason said', json([b.calls.length, toastLog[0]]), '[0,["Units can be assigned once the request is approved.","info"]]');
  }
  {
    const b = backend();
    const c = pageCtx({}, { pageAccessMap: { EQR_WORKBENCH: 'HIDDEN' } });
    await new (pageChain('loadChain', b.Actions))().run(c, { refresh: false });
    T.eq('a role without the page: refused in words, nothing read', json([c.$page.variables.error, c.$page.variables.canAct, b.calls.length]), '["Approve & allocate is not open to your role.",false,0]');
    const r = backend();
    const rc = pageCtx({}, { pageAccessMap: { EQR_WORKBENCH: 'READ_ONLY' } });
    await new (pageChain('loadChain', r.Actions, { 'resources/js/requestData': reqData(ROWS, LINES) }))().run(rc, { refresh: false });
    T.eq('read only: the queue, no acting', json([rc.$page.variables.access, rc.$page.variables.canAct, rc.$page.variables.rows.length]), '["READ_ONLY",false,9]');
    const f = backend();
    const fc = pageCtx({}, { pageAccessMap: { EQR_WORKBENCH: 'FULL' } });
    await new (pageChain('loadChain', f.Actions, { 'resources/js/requestData': reqData(ROWS, LINES) }))().run(fc, { refresh: false });
    T.eq('full access acts', fc.$page.variables.canAct, true);
  }
  {
    const b = backend();
    const c = pageCtx({});
    await new (pageChain('openRecordChain', b.Actions))().run(c, { id: '503', number: 'REQ-503' });
    T.eq('a request opens in a tab of its own', json(opened[opened.length - 1]), '{"record":"request","params":{"id":503,"number":"REQ-503"}}');
  }

  // ── Wiring ────────────────────────────────────────────────────────────────────────────────────────────────
  T.section('wiring');
  const html = read(path.join(PAGE_DIR, 'approvals-page.html'));
  const flowJson = JSON.parse(read(path.join(NEXT, 'flows', 'approvals', 'approvals-flow.json')));
  T.eq('flow: id, page, embeddable', json([flowJson.id, Object.keys(flowJson.pages), flowJson.navigation, pageJson.navigation]),
    '["approvals",["approvals"],{"embeddable":"enabled"},{"embeddable":"enabled"}]');
  const named = new Set();
  Object.values(pageJson.eventListeners).forEach((l) => l.chains.forEach((c) => named.add(c.chain)));
  fs.readdirSync(CHAINS).forEach((f) => (read(path.join(CHAINS, f)).match(/chain: '(\w+)'/g) || []).forEach((m) => named.add(m.slice(8, -1))));
  T.check('every chain named exists, and each is a class named like its file', [...named].every((c) => fs.existsSync(path.join(CHAINS, c + '.js'))
    && read(path.join(CHAINS, c + '.js')).includes('class ' + c + ' extends ActionChain')), [...named].filter((c) => !fs.existsSync(path.join(CHAINS, c + '.js'))).join());
  const used = new Set((html.match(/\$listeners\.(\w+)/g) || []).map((m) => m.split('.')[1]));
  T.check('every listener in the HTML is defined', [...used].every((l) => pageJson.eventListeners[l]), [...used].filter((l) => !pageJson.eventListeners[l]).join());
  const mod = new PageModule();
  const fns = new Set((html.match(/\$functions\.(\w+)/g) || []).map((m) => m.split('.')[1]));
  fs.readdirSync(CHAINS).forEach((f) => (read(path.join(CHAINS, f)).match(/\$page\.functions\.(\w+)/g) || []).forEach((m) => fns.add(m.split('.').pop())));
  T.check('every page function the HTML and chains call exists', [...fns].every((fn) => typeof mod[fn] === 'function'), [...fns].filter((fn) => typeof mod[fn] !== 'function').join());
  const vars = new Set((html.match(/\$variables\.(\w+)/g) || []).map((m) => m.split('.')[1]));
  T.check('every variable the HTML reads is declared', [...vars].every((x) => pageJson.variables[x]), [...vars].filter((x) => !pageJson.variables[x]).join());
  const bindings = (html.match(/\[\[[\s\S]*?\]\]/g) || []).join('\n');
  T.check('bindings: no arrow functions, no String() / Number() / Boolean()', !/=>|\bString\(|\bNumber\(|\bBoolean\(/.test(bindings));
  T.check('no table, tbody, tr or select (oj-bind-for-each gotcha)', !/<(table|tbody|tr|select)[\s>]/.test(html));
  T.check(':style only in the object form', (html.match(/:style[.=]/g) || []).every((s) => s === ':style='));
  const navSrc = read(path.join(NEXT_JS, 'nav.js'));
  T.check('the menu item is built, on its own flow', /id: 'approvals'[^}]+route: \{ flow: 'approvals', page: 'approvals' \}, built: true/.test(navSrc));
  const appFlow = JSON.parse(read(path.join(NEXT, 'app-flow.json')));
  T.check('the stylesheet is imported', appFlow.imports.css.indexOf('resources/css/next-approvals.css') !== -1);
  const css = read(path.join(NEXT, 'resources', 'css', 'next-approvals.css')) + read(path.join(NEXT, 'resources', 'css', 'next.css'));
  const classes = new Set();
  (html.match(/nx-[a-z0-9-]+/g) || []).forEach((c) => classes.add(c));
  // A class is styled itself, or through its --variants (nx-ap-need--decide); nx-approvals is the page's root.
  const missing = [...classes].filter((c) => !c.endsWith('-') && c !== 'nx-approvals' && !new RegExp('\\.' + c.replace(/-/g, '\\-') + '(?![a-z0-9]|-[a-z0-9])').test(css));
  T.check('every nx- class the page uses is styled', !missing.length, missing.join(', '));
  const own = read(path.join(NEXT, 'resources', 'css', 'next-approvals.css')).replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = (own.match(/[^{}]+(?=\{)/g) || []).map((s) => s.trim()).filter((s) => s && !s.startsWith('@') && s !== 'to')
    .reduce((all, s) => all.concat(s.split(',').map((x) => x.trim())), []);
  const foreign = selectors.filter((s) => !/^\.nx-ap/.test(s));
  T.check(`the screen styles only its own classes (${selectors.length} selectors)`, !foreign.length, foreign.join(' | '));
  const ops = {};
  Object.values(JSON.parse(read(path.join(ROOT, 'services', 'eqp-v1', 'openapi3.json'))).paths)
    .forEach((p) => Object.values(p).forEach((op) => { if (op && op.operationId) ops['eqp-v1/' + op.operationId] = true; }));
  const endpoints = new Set();
  [path.join(NEXT_JS, 'approveAllocate.js'), path.join(NEXT_JS, 'lineConfirmed.js'), path.join(NEXT_JS, 'requestLineBody.js')].concat(fs.readdirSync(CHAINS).map((f) => path.join(CHAINS, f)))
    .forEach((f) => (read(f).match(/endpoint:\s*'([^']+)'/g) || []).forEach((m) => endpoints.add(m.replace(/endpoint:\s*'/, '').replace("'", ''))));
  const unknown = [...endpoints].filter((e) => !ops[e]);
  T.check(`every endpoint exists in services/eqp-v1 (${endpoints.size})`, !unknown.length, unknown.join());
  T.check('nothing writes to Fusion (no ProjectLOV, ICS or BI call)', ![...endpoints].some((e) => !e.startsWith('eqp-v1/')));

  T.report();
})().catch((e) => {
  T.check('run finished', false, e && e.stack);
  T.report();
});
