/*
 * EquipRite Mobile, the Approve tab (webApps/equiprite-mobile/flows/approve; resources/js/mobileApprove.js). Loads the
 * real modules (the shared ones are Next's, byte for byte).
 *
 *   - mobileApprove: the queue as cards, chips, search, next up, the decision sheet's one line, quick reasons, the unit
 *     sheet's rows, the copy kept on the phone, the links to New and Old
 *   - the rules are Next's: Mobile's chains and Next's Approve & allocate chains run side by side on the same stand-in
 *     backend (read a request, approve, send back with a reason, a line's units, save them, assign the suggestions),
 *     and the calls (endpoint, parameters, body, audit headers, order) must be the same
 *   - Mobile's own guards: nothing sent with no connection, without full access, or without a reason; the queue and the
 *     request with no connection; a request handed over (focus)
 *   - wiring: chains, listeners, functions, variables, styles, endpoints
 *
 * Run:  node tests/mobile-approve.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'webApps', 'equiprite-mobile');
const MJS = path.join(APP, 'resources', 'js');
const PAGE = path.join(APP, 'flows', 'approve', 'pages');
const MCH = path.join(PAGE, 'approve-page-chains');
const NEXT = path.join(ROOT, 'webApps', 'equiprite-next');
const NJS = path.join(NEXT, 'resources', 'js');
const NPAGE = path.join(NEXT, 'flows', 'approvals', 'pages');
const NCH = path.join(NPAGE, 'approvals-page-chains');

const read = (f) => fs.readFileSync(f, 'utf8');
const json = (v) => JSON.stringify(v);

function loadAmd(file, deps, extra) {
  const sandbox = Object.assign({ console: { log() {}, warn() {}, error() {} }, setTimeout, Promise, Intl, Date, JSON, TextEncoder, URLSearchParams }, extra || {});
  let mod;
  sandbox.define = (names, factory) => { mod = factory(...names.map((n) => (deps && n in deps ? deps[n] : {}))); };
  vm.createContext(sandbox);
  vm.runInContext(read(file), sandbox, { filename: path.basename(file) });
  return mod;
}

// ── Each app's own copies of the modules ────────────────────────────────────────────────────────────────────────
const cu = { auditHeaders: () => ({ 'X-User-Id': 'priya.raman' }), auditActor: () => 'priya.raman', displayName: () => 'Priya Raman' };
function modules(dir) {
  const m = {};
  m.rules = loadAmd(path.join(dir, 'rules.js'));
  m.fmt = loadAmd(path.join(dir, 'fmt.js'));
  m.Progress = loadAmd(path.join(dir, 'requestProgress.js'));
  m.queue = loadAmd(path.join(dir, 'approvalQueue.js'), { 'resources/js/requestProgress': m.Progress, 'resources/js/fmt': m.fmt, 'resources/js/rules': m.rules });
  m.unitPicker = loadAmd(path.join(dir, 'unitPicker.js'));
  m.ldu = loadAmd(path.join(dir, 'lineDetailUnits.js'));
  m.aa = loadAmd(path.join(dir, 'approveAllocate.js'), { 'resources/js/requestLineBody': loadAmd(path.join(dir, 'requestLineBody.js')),
    'resources/js/requestDetailLines': loadAmd(path.join(dir, 'requestDetailLines.js')), 'resources/js/lineDetailUnits': m.ldu,
    'resources/js/lineConfirmed': loadAmd(path.join(dir, 'lineConfirmed.js')), 'resources/js/currentUser': cu });
  return m;
}
const mob = modules(MJS);
const nxt = modules(NJS);
const { rules, fmt, queue, aa, unitPicker } = mob;
const ma = loadAmd(path.join(MJS, 'mobileApprove.js'), { 'resources/js/approvalQueue': queue, 'resources/js/fmt': fmt });

const NOW = Date.UTC(2026, 9, 30, 9);
const day = (n) => new Date(NOW + n * 86400000).toISOString().slice(0, 10);

(async () => {
  // ── The queue as cards ────────────────────────────────────────────────────────────────────────────────────────
  T.section('the queue as cards (mobileApprove)');
  T.eq('the decision allow-lists are approveAllocate\'s', json([ma.APPROVABLE, ma.REJECT_TERMINAL]), json([aa.CASCADABLE, aa.TERMINAL_STATES]));
  const ROWS = [
    { eqrEquipmentRequestId: 10, requestNumber: 'R10', status: 'SUBMITTED', startDate: day(9), endDate: day(20), projectName: 'Pipeline North', taskName: '2.1', requestorName: 'Priya',
      requestOrigin: 'Internal', createdDate: day(-3) + 'T08:00:00Z' },
    { eqrEquipmentRequestId: 11, requestNumber: 'R11', status: 'SUBMITTED', startDate: day(-2), endDate: day(20), customerName: 'Gulf Coast', requestorName: 'Dana', requestOrigin: 'External' },
    { eqrEquipmentRequestId: 12, requestNumber: 'R12', status: 'IN_PROCESS', startDate: day(3), endDate: day(20), projectName: 'Plant B', requestorName: 'Sam', requestOrigin: 'Internal' },
    { eqrEquipmentRequestId: 13, requestNumber: 'R13', status: 'IN_PROCESS', startDate: day(1), endDate: day(20), projectName: 'Plant B', requestOrigin: 'Internal' },
    { eqrEquipmentRequestId: 15, requestNumber: 'R15', status: 'DRAFT', startDate: day(1), endDate: day(9), projectName: 'X' },
    { eqrEquipmentRequestId: 9, requestNumber: 'R9', status: 'SUBMITTED', startDate: day(9), endDate: day(20), projectName: 'Older', requestOrigin: 'Internal' },
  ];
  const LN = (status, alloc, name, qty) => ({ lineStatus: status, allocation: alloc || 'PENDING', name: name || 'Eq', cls: 'Cls', qty: qty || 1 });
  const LINES = {
    R10: [LN('SUBMITTED', '', 'Excavator', 2), LN('SUBMITTED', '', 'Dump truck')],
    R11: [LN('SUBMITTED', '', 'Generator')],
    R12: [LN('IN_PROCESS', 'ALLOCATED', 'Roller'), LN('IN_PROCESS', 'PENDING', 'Light tower', 4), LN('SHIP_TO_SITE', 'ALLOCATED')],
    R13: [LN('ALLOCATED', 'ALLOCATED')],
    R15: [LN('DRAFT')],
    R9: [LN('SUBMITTED'), LN('REJECTED')],
  };
  const items = queue.build(ROWS, LINES, { now: NOW });
  const cards = ma.cards(items, LINES, ROWS, NOW);
  const by = (n) => cards.find((c) => c.number === n);
  T.eq('the queue\'s order and kinds (approvalQueue.build)', cards.map((c) => c.number + ':' + c.kind).join(' '), 'R11:decide R12:allocate R9:decide R10:decide');
  T.eq('what each waits for, in the chips\' words', cards.map((c) => c.needs).join(), 'To decide,To assign units,To decide,To decide');
  T.eq('pieces: the quantity of the lines in question', json([by('R10').pieces, by('R12').pieces, by('R9').pieces]), '[3,4,1]');
  T.check('…the same lines approvalQueue counts', cards.every((c) => ma.waitingLines(c, LINES[c.number]).length === c.waiting));
  T.eq('colours: deciding is approval, units are getting ready', json([by('R11').tone, by('R12').tone]), '["approval","ready"]');
  T.eq('how old a request is, when the list says', json([by('R10').age, by('R11').age]), '["Raised 3 days ago",""]');
  T.eq('a card\'s second line', json([ma.cardSub(by('R10')), ma.cardSub(by('R12'))]), '["3 pieces · Priya","1 of 3 lines still without a unit · Sam"]');
  T.eq('chips: to decide, to assign units, late (when something is), all', json(ma.chips(cards).map((c) => c.key + ':' + c.count)), '["decide:3","allocate:1","late:1","all:4"]');
  T.eq('no Late chip when nothing is late', ma.chips(cards.filter((c) => !c.lateDays)).map((c) => c.key).join(), 'decide,allocate,all');
  T.eq('a chip and a search (every word, equipment included)', [ma.filter(cards, 'decide', '').map((c) => c.number).join(), ma.filter(cards, 'all', 'light tower').map((c) => c.number).join(),
    ma.filter(cards, 'late', '').map((c) => c.number).join()].join(' | '), 'R11,R9,R10 | R12 | R11');
  T.eq('it opens on what waits for a decision, else units', [ma.firstChip(cards), ma.firstChip(cards.filter((c) => c.kind === 'allocate')), ma.firstChip([])].join(), 'decide,allocate,all');
  T.eq('the line under the title', [ma.summary(cards), ma.summary([])].join(' | '), '3 to decide · 1 with units to assign · 1 late | Nothing is waiting on you');
  T.eq('the tab\'s count is the shell\'s: requests waiting for a decision', ma.badge(cards), queue.build(ROWS, LINES, { now: NOW }).filter((q) => q.kind === 'decide').length);
  T.eq('where it is in the list', [ma.position(cards, '9'), ma.position(cards, '99')].join('|'), '3 of 4|');
  T.eq('skip: the next card, none at the end', [ma.after(cards, '11').number, ma.after(cards, '10')].join('|'), 'R12|');

  T.section('next up, once a request is decided');
  const order = cards.map((c) => c.key);
  const after11 = cards.filter((c) => c.key !== '11');
  T.eq('the next one in the order being worked through, under the same chip', ma.nextUp(after11, '11', order, 'decide').number, 'R9');
  T.eq('…from the middle', ma.nextUp(cards, '9', order, 'decide').number, 'R10');
  T.eq('…wrapping to the top', ma.nextUp(cards, '10', order, 'decide').number, 'R11');
  T.eq('nothing left under the chip: whatever else waits', ma.nextUp(cards.filter((c) => c.kind === 'allocate'), '10', order, 'decide').number, 'R12');
  T.eq('nothing else waits: none', ma.nextUp([by('R10')], '10', order, 'decide'), null);
  const d1 = ma.done({ action: 'approve', words: { tone: 'ok', text: 'Approved 2 lines on R10.' }, key: '10', number: 'R10',
    list: cards.map((c) => (c.key === '10' ? Object.assign({}, c, { kind: 'allocate' }) : c)), order, chip: 'decide' });
  T.eq('approved: it now waits for units', json([d1.title, d1.againKey, d1.againLabel, d1.next.number, d1.clear]), '["Approved · R10","10","Assign R10\'s units now","R11",false]');
  const d2 = ma.done({ action: 'reject', words: { tone: 'ok', text: '' }, key: '9', number: 'R9', list: cards, order, chip: 'decide' });
  T.eq('part sent back: decide the rest', d2.againLabel, 'Decide the rest of R9');
  const d3 = ma.done({ action: 'units', words: { tone: 'ok', text: '' }, key: '12', number: 'R12', list: [], order, chip: 'allocate' });
  T.eq('the queue cleared', json([d3.title, d3.next, d3.clear, d3.left]), '["Units assigned · R12",null,true,"Nothing is waiting on you"]');

  T.section('the copy kept on the phone');
  const kept = ma.keep(cards, 2);
  T.eq('a few cards, as plain data', [kept.length, typeof kept[0].p].join(), '2,undefined');
  const back = ma.restore(kept);
  T.eq('back from the phone: searchable, marked as the saved copy', [back.every((c) => c.offline), ma.filter(back, 'all', 'gulf').length].join(), 'true,1');
  T.eq('a broken copy is skipped', ma.restore([null, {}, kept[0]]).length, 1);
  const off = ma.offlineRec(by('R10'), 'Saved on this phone at 08:00');
  T.eq('a saved request: what the card knew, nothing to decide', json([off.offline, off.head.deciding, off.head.equipment, off.verdict.text]),
    '[true,false,"Excavator and Dump truck","Saved on this phone at 08:00. Approving, sending back and assigning units need a connection."]');
  T.eq('online or not', [ma.online(null), ma.online({ onLine: true }), ma.online({ onLine: false })].join(), 'true,true,false');
  T.eq('a request\'s age', [ma.age(day(0), NOW), ma.age(day(-1), NOW), ma.age(day(-6), NOW), ma.age(day(2), NOW), ma.age('', NOW)].join('|'),
    'Raised today|Raised yesterday|Raised 6 days ago|Raised today|');

  // ── A request's lines and the decision sheet ──────────────────────────────────────────────────────────────────
  T.section('a request\'s lines, and what a decision will do');
  const L = (no, status, extra) => Object.assign({ line_id: 900 + no, line_no: no, lineId: String(900 + no), lineStatus: status, line_status: status,
    equipment_name: 'Eq ' + no, equipmentName: 'Eq ' + no, qty: 1, alloc_status: 'PENDING', is_serial_controlled: true, availability: 'AVAILABLE', est_cost: 100,
    bill_rate: '$10.00 / DAY', class: 'Cls' }, extra || {});
  const raw = [L(1, 'SUBMITTED', { qty: 2, est_cost: 1200 }), L(2, 'SUBMITTED', { availability: 'NOT AVAILABLE' }), L(3, 'REJECTED'),
    L(4, 'IN_PROCESS', { is_serial_controlled: false, availability: 'PARTIAL QUANTITY' })];
  const head = { id: 501, number: 'REQ-501', status: 'SUBMITTED', external: false, party: 'Pier B', dates: '4 Nov – 29 Nov 2026', requestor: 'Sam' };
  const lc = ma.lineCards(queue.lineRows(raw, head, false, false), raw);
  T.eq('a line in words, with what it costs', json([lc[0].title, lc[0].cost, lc[0].free]), '["1. Eq 1 × 2","$10.00 / DAY · est. $1,200",false]');
  T.eq('free stock says so', json([lc[3].free, lc[3].tracking]), '[true,"Free stock"]');
  T.eq('a line sent back cannot be chosen', lc.map((l) => l.decidable).join(), 'true,true,false,true');
  const cases = [[], ['902'], ['904', '901'], ['903']];
  T.eq('the lines a decision changes are approveAllocate\'s targets, counted as decisionPlan counts', cases.map((t) => ['approve', 'reject']
    .map((k) => ma.acting(k, raw, t).length === queue.decisionPlan(k, raw, t, 'Sam').count && ma.decideSheet(k, head, raw, t).count === queue.decisionPlan(k, raw, t, 'Sam').count)
    .join()).join(' '), 'true,true true,true true,true true,true');
  const ap = ma.decideSheet('approve', head, raw, []);
  T.eq('approve, in one line', ap.say, 'Approve 4 pieces for Pier B, 4 Nov – 29 Nov 2026 · est. $1,400.');
  T.eq('…the lines, what follows, what is not free', json([ap.title, ap.label, ap.names, ap.warn]),
    '["Approve REQ-501","Approve all 3 lines",["Eq 1 × 2","Eq 2","Eq 4"],"Eq 2 is not available for its dates; Eq 4 is only partly available."]');
  T.eq('…and decisionPlan\'s note', ap.note, queue.decisionPlan('approve', raw, [], 'Sam').note);
  const rj = ma.decideSheet('reject', head, raw, ['902']);
  T.eq('send back one line, in one line', json([rj.title, rj.say, rj.names, rj.label, rj.warn]), '["Send back REQ-501","Send back 1 piece to Sam.",["Eq 2"],"Send back 1 line",""]');
  T.eq('nothing to decide: the note says why', ma.decideSheet('reject', head, raw, ['903']).say, 'No line here can be sent back.');

  T.section('quick reasons');
  let r = ma.addReason('', 'Change the dates');
  T.eq('a tap adds the reason as a sentence', r, 'Change the dates.');
  r = ma.addReason(r + ' Two weeks later', 'Wrong project or task');
  T.eq('…after what was typed', r, 'Change the dates. Two weeks later. Wrong project or task.');
  T.eq('a second tap takes it out again', ma.addReason(r, 'Change the dates'), 'Two weeks later. Wrong project or task.');
  T.eq('…from the end too', ma.addReason(r, 'Wrong project or task'), 'Change the dates. Two weeks later.');
  T.eq('whether a quick reason is in', [ma.hasReason(r, 'change the dates'), ma.hasReason(r, 'Fewer pieces would do'), ma.hasReason(r, '')].join(), 'true,false,false');
  T.check('the quick reasons are short', ma.REASONS.length >= 4 && ma.REASONS.every((x) => x.length <= 32));

  T.section('a line\'s units in the unit sheet');
  const unitRow = (ref, no, extra) => Object.assign({ lineId: 9031, unitType: 'SERIAL', unitRefId: ref, serialRefId: ref, unitNumber: no, invOrgId: 300, invOrgName: 'Houston Yard' }, extra || {});
  const SERIALS = [unitRow(701, 'EX-2201', { availabilityStatus: 'NOT AVAILABLE' }), unitRow(702, 'EX-2203', { availabilityStatus: 'AVAILABLE' }),
    unitRow(703, 'EX-2210', { availabilityStatus: 'AVAILABLE', invOrgName: 'Dallas Yard' }),
    unitRow(704, 'EX-2214', { availabilityStatus: 'AVAILABLE', allocationId: 8704, allocationStatus: 'ALLOCATED', allocatedQty: 1 })];
  const built = mob.ldu.buildResources(SERIALS, 'serial', { equipmentName: 'CAT 320', className: 'Excavators' }, 11);
  const pk = new unitPicker.Picker();
  pk.initUnits(built.resources, built.allocated, { line_id: 9031, line_no: 1, qty: 2, start_date: '2026-11-08', end_date: '2026-11-22' }, 'serial', false, false,
    [{ unitRefId: 701, bookingRequestNumber: 'REQ-482', projectName: 'Pipeline North', bookingStartDate: '2026-10-28', bookingEndDate: '2026-11-12' }], 'REQ-503');
  pk.stageAssign(702);
  const ur = ma.unitRows(pk.unitRows(0), ['EX-2203']);
  T.eq('each unit: one step, its state, the suggested one, a clash in words', json(ur.map((u) => [u.name, u.act, u.actLabel, u.tone, u.suggested, u.clash])), json([
    ['EX-2201', '', '', 'off', false, 'Booked by REQ-482 · Pipeline North over these dates'], ['EX-2203', 'cancel', 'Undo', 'on', true, ''],
    ['EX-2210', '', '', 'ok', false, ''], ['EX-2214', 'release', 'Release', 'on', false, '']]));
  const sugg = { byLine: { 9031: { picks: [{ unit: 'EX-2203', text: 'EX-2203 (Houston Yard)' }], words: { state: 'ready', text: 'Suggested: EX-2203 (Houston Yard)' } } } };
  T.eq('the suggested units of a line, by name', json(ma.suggestedNames(sugg, '9031')), '["EX-2203"]');
  T.eq('a line\'s button: Change when a unit is suggested', [ma.lineButton({ id: '9031', action: 'allocate', actionLabel: 'Pick units' }, sugg),
    ma.lineButton({ id: '9032', action: 'allocate', actionLabel: 'Pick units' }, sugg), ma.lineButton({ id: '9', action: 'view', actionLabel: 'See units' }, sugg),
    ma.lineButton({ id: '9', action: 'none' }, sugg)].join('|'), 'Change|Pick units|See units|');

  T.section('steps that stay in New EquipRite (Fusion) or Old (quotes)');
  T.eq('Initiate picking, in New', ma.pickingUrl('http://new'), 'http://new/vp/shell/logistics/picking');
  T.eq('this request in New\'s Approve & allocate', ma.inNewUrl('http://new/', { id: 501, number: 'REQ-501' }),
    'http://new/vp/shell/workbench/approve-allocate?requestId=REQ-501&requestNumericId=501');
  T.eq('the quote, in Old', ma.quoteUrl('http://old', { id: 501, number: 'REQ-501' }),
    'http://old/vp/shell/equipment-foundation/request-quote?requestId=501&requestNumber=REQ-501&sourcePage=request-detail');
  T.eq('no address, no link', [ma.pickingUrl(''), ma.inNewUrl('', { id: 1 }), ma.quoteUrl('x', {})].join('|'), '||');
  T.eq('a toast\'s tone', ['ok', 'warn', 'error', 'info'].map(ma.toastTone).join(), 'info,warning,error,info');

  // ── The chains: Mobile's and Next's side by side ─────────────────────────────────────────────────────────────
  // A stand-in backend whose writes change it: requests, lines, units, lots, allocations.
  function world() {
    const S = {
      req: { 509: { status: 'SUBMITTED', number: 'REQ-509', origin: 'INTERNAL', requestorName: 'Sam Ortiz', requestorUserId: 77 },
        503: { status: 'IN_PROCESS', number: 'REQ-503', origin: 'INTERNAL', requestorName: 'Sam Ortiz', requestorUserId: 77 } },
      lines: [
        { req: 509, lineId: 9091, name: 'Vibratory Roller', status: 'SUBMITTED', qty: 1, master: 51, ser: 'Y', lot: 'N', inv: 'Y', est: 9800 },
        { req: 509, lineId: 9092, name: 'Plate Compactor', status: 'SUBMITTED', qty: 1, master: 52, ser: 'Y', lot: 'N', inv: 'Y', est: 1200, avail: 'NOT AVAILABLE' },
        { req: 503, lineId: 9031, name: 'CAT 320 Excavator', status: 'IN_PROCESS', qty: 1, master: 11, ser: 'Y', lot: 'N', inv: 'Y', est: 38400 },
        { req: 503, lineId: 9032, name: 'Trench safety kit', status: 'IN_PROCESS', qty: 10, master: 61, ser: 'N', lot: 'N', inv: 'N', est: 1950 },
        { req: 503, lineId: 9033, name: 'Traffic cones', status: 'IN_PROCESS', qty: 10, master: 62, ser: 'N', lot: 'Y', inv: 'Y', est: 300 },
      ],
      serials: [{ ref: 701, no: 'EX-2201', busy: true, org: 300, orgName: 'Houston Yard' }, { ref: 702, no: 'EX-2203', org: 300, orgName: 'Houston Yard' },
        { ref: 703, no: 'EX-2210', org: 310, orgName: 'Dallas Yard' }],
      lots: { 801: { no: 'LOT-A', atr: 6, org: 300, orgName: 'Houston Yard' }, 802: { no: 'LOT-B', atr: 10, org: 310, orgName: 'Dallas Yard' } },
      alloc: [],
      next: 8001,
    };
    const line = (id) => S.lines.find((l) => l.lineId === Number(id));
    const allocOf = (id) => S.alloc.filter((a) => a.line === Number(id) && a.status !== 'RELEASED');
    const got = (l) => allocOf(l.lineId).reduce((s, a) => s + a.qty, 0);
    const ok = (data) => ({ ok: true, status: 200, body: { data } });
    return function answer(ep, o) {
      const p = o.uriParams || {};
      if (ep === 'eqp-v1/getEquipriteV1ViewsRequestDetailLines') {
        return ok(S.lines.filter((l) => l.req === Number(p.requestId)).map((l) => ({ lineId: l.lineId, equipmentName: l.name, className: 'Cls', quantity: l.qty,
          lineStatus: l.status, availabilityStatus: l.avail || 'AVAILABLE', allocatedQty: got(l), billRate: 100, priceUom: 'DAY', estimatedCost: l.est,
          startDate: '2026-11-08T00:00:00Z', endDate: '2026-11-22T00:00:00Z', isSerialControlled: l.ser, isLotControlled: l.lot, isInventoryTracked: l.inv,
          equipmentMasterId: l.master, requestNumber: S.req[l.req].number, requestStatus: S.req[l.req].status, projectName: 'Plant Expansion B', requestorName: 'Sam Ortiz',
          deploymentLocation: 'Gate 2', source: S.req[l.req].origin })));
      }
      if (ep === 'eqp-v1/getEquipriteV1EquipmentRequestById') {
        const r = S.req[p.id];
        return { ok: true, status: 200, body: { id: Number(p.id), status: r.status, requestorName: r.requestorName, requestorUserId: r.requestorUserId, requestType: r.origin,
          createdDate: '2026-10-24T08:00:00Z' } };
      }
      if (ep === 'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2') {
        return ok(S.lines.filter((l) => l.req === Number(p.requestId)).map((l) => ({ id: l.lineId, lineStatus: l.status, allocationStatus: got(l) >= l.qty ? 'ALLOCATED' : 'PENDING' })));
      }
      if (ep === 'eqp-v1/patchRequestLinesBatch') {
        if (o.body.lines.some((u) => u.id === 9999)) return { ok: false, status: 409, body: { message: 'Line 9999 was changed by another user' } };
        o.body.lines.forEach((u) => { line(u.id).status = u.lineStatus; });
        return ok(o.body.lines);
      }
      if (ep === 'eqp-v1/patchEquipmentRequest') { S.req[p.id].status = o.body.status; return { ok: true, status: 200, body: {} }; }
      if (ep === 'eqp-v1/createNotification') return { ok: true, status: 201, body: { id: 1 } };
      if (ep === 'eqp-v1/getTransferOrders') return ok([]);
      if (ep === 'eqp-v1/getEquipriteV1ViewsLineDetailBookings') {
        return ok([{ unitRefId: 701, bookingRequestNumber: 'REQ-482', bookingStartDate: '2026-10-28', bookingEndDate: '2026-11-12', projectName: 'Pipeline North' }]);
      }
      if (ep === 'eqp-v1/getEquipriteV1ViewsLineDetailUnits') {
        const l = line(p.lineId);
        const r = S.req[l.req];
        const base = { lineId: l.lineId, requestNumber: r.number, requestStatus: r.status, source: r.origin, lineStatus: l.status, equipmentMasterId: l.master,
          equipmentName: l.name, className: 'Cls', quantity: l.qty, isSerialControlled: l.ser, isLotControlled: l.lot, isInventoryTracked: l.inv,
          lineStartDate: '2026-11-08', lineEndDate: '2026-11-22' };
        if (l.master === 11) {
          return ok(S.serials.map((u) => {
            const mine = S.alloc.find((a) => a.serial === u.ref && a.line === l.lineId && a.status !== 'RELEASED');
            const other = S.alloc.find((a) => a.serial === u.ref && a.line !== l.lineId && a.status !== 'RELEASED');
            return Object.assign({}, base, { unitType: 'SERIAL', unitRefId: u.ref, serialRefId: u.ref, unitNumber: u.no, invOrgId: u.org, invOrgName: u.orgName,
              availabilityStatus: u.busy || other ? 'NOT AVAILABLE' : 'AVAILABLE' }, mine ? { allocationId: mine.id, allocationStatus: 'ALLOCATED', allocatedQty: 1 } : {});
          }));
        }
        if (l.master === 62) {
          return ok(Object.keys(S.lots).map((k) => {
            const lot = S.lots[k];
            const mine = S.alloc.find((a) => a.lot === Number(k) && a.line === l.lineId && a.status !== 'RELEASED');
            return Object.assign({}, base, { unitType: 'LOT', unitRefId: Number(k), lotRefId: Number(k), unitNumber: lot.no, invOrgId: lot.org, invOrgName: lot.orgName,
              availableToReserve: lot.atr, uomCode: 'EA' }, mine ? { allocationId: mine.id, allocationStatus: 'ALLOCATED', allocatedQty: mine.qty } : {});
          }));
        }
        return ok([]);
      }
      if (ep === 'eqp-v1/getAllocations') return ok(allocOf(p.requestLineId).map((a) => ({ id: a.id, allocationStatus: 'ALLOCATED' })));
      if (ep === 'eqp-v1/createAllocation') {
        const a = { id: S.next++, line: o.body.requestLineId, serial: o.body.serialRefId, lot: o.body.lotRefId, qty: o.body.allocatedQty, status: 'ALLOCATED' };
        S.alloc.push(a);
        return { ok: true, status: 201, body: { id: a.id } };
      }
      if (ep === 'eqp-v1/patchSerialRef') return { ok: true, status: 200, body: {} };
      if (ep === 'eqp-v1/getLotRefById') return { ok: true, status: 200, body: { availableToReserve: S.lots[p.id].atr } };
      if (ep === 'eqp-v1/patchLotRef') { S.lots[p.id].atr = o.body.availableToReserve; return { ok: true, status: 200, body: {} }; }
      if (ep === 'eqp-v1/patchRequestLine') {
        if (o.body.lineStatus) line(p.id).status = o.body.lineStatus;
        return { ok: true, status: 200, body: {} };
      }
      return undefined;
    };
  }

  const toasts = [];
  const badges = [];
  const mbus = loadAmd(path.join(MJS, 'mobileBus.js'));
  mbus.register((q) => { if (q.action === 'toast') toasts.push([q.message, q.tone]); if (q.action === 'badge') badges.push([q.tab, q.count]); });
  const nbus = { toast: (m, t) => toasts.push([m, t]), open() {}, onFocus() {}, takeFocus: () => null };
  const store = {};
  const fakeWindow = { localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } } };
  const snap = loadAmd(path.join(MJS, 'offlineSnapshot.js'), {}, { window: fakeWindow });
  let invalidated = 0;
  let dataNow = { rows: [], linesByRequest: {}, error: '' };
  const reqData = { load: async () => dataNow, invalidate: () => { invalidated++; } };

  const MPage = loadAmd(path.join(PAGE, 'approve-page.js'), { 'resources/js/mobileBus': mbus, 'resources/js/unitPicker': unitPicker, 'resources/js/approvalQueue': queue,
    'resources/js/mobileApprove': ma, 'resources/js/fmt': fmt });
  const NPage = loadAmd(path.join(NPAGE, 'approvals-page.js'), { 'resources/js/exportKit': { FORMATS: [] }, 'resources/js/fmt': nxt.fmt, 'resources/js/nav': { newUrl: () => '' },
    'resources/js/unitPicker': nxt.unitPicker, 'resources/js/approvalQueue': nxt.queue, 'resources/js/shellBus': { onFocus() {} } });
  const mjson = JSON.parse(read(path.join(PAGE, 'approve-page.json')));
  const njson = JSON.parse(read(path.join(NPAGE, 'approvals-page.json')));
  const defaults = (pj) => {
    const v = {};
    Object.keys(pj.variables).forEach((k) => { v[k] = JSON.parse(JSON.stringify(pj.variables[k].defaultValue === undefined ? null : pj.variables[k].defaultValue)); });
    return v;
  };
  const appVars = (extra) => Object.assign({ flagsLoaded: true, pageAccessLoaded: true, featureFlags: {}, pageAccessMap: { EQR_WORKBENCH: 'FULL' }, globalSettings: {},
    appUrls: { old: 'http://old/', new: 'http://new/' } }, extra || {});

  /** One app's page and chains on a world of its own: run(chain, params), its calls, the chains it asked for. */
  function rig(app, o) {
    const opts = o || {};
    const answer = world();
    const calls = [];
    const asked = [];
    const runs = new Set(opts.runs || []);
    const Actions = {
      async callRest(_c, x) {
        calls.push({ endpoint: x.endpoint, uriParams: x.uriParams, body: x.body, headers: x.headers });
        return answer(x.endpoint, x) || { ok: true, status: 200, body: { data: [] } };
      },
      async callChain(ctx, c) { asked.push(c.chain); if (runs.has(c.chain)) await run(c.chain, c.params || {}); return { ok: true }; },
      async fireNotificationEvent() {},
    };
    const deps = app === 'mobile' ? {
      'vb/action/actionChain': class {}, 'vb/action/actions': Actions, 'resources/js/approveAllocate': aa, 'resources/js/approvalQueue': queue, 'resources/js/mobileApprove': ma,
      'resources/js/requestData': reqData, 'resources/js/mobileBus': mbus, 'resources/js/rules': rules, 'resources/js/requestProgress': mob.Progress, 'resources/js/fmt': fmt,
      'resources/js/unitPicker': unitPicker, 'resources/js/offlineSnapshot': snap, 'resources/js/currentUser': cu,
    } : {
      'vb/action/actionChain': class {}, 'vb/action/actions': Actions, 'resources/js/approveAllocate': nxt.aa, 'resources/js/approvalQueue': nxt.queue, 'resources/js/rules': nxt.rules,
      'resources/js/requestProgress': nxt.Progress, 'resources/js/fmt': nxt.fmt, 'resources/js/shellBus': nbus, 'resources/js/unitPicker': nxt.unitPicker, 'resources/js/requestData': reqData,
    };
    const ctx = { $page: { variables: Object.assign(defaults(app === 'mobile' ? mjson : njson), opts.vars || {}), functions: app === 'mobile' ? new MPage() : new NPage() },
      $application: { variables: appVars(opts.app), user: { username: 'priya.raman' } } };
    async function run(name, params) {
      const C = loadAmd(path.join(app === 'mobile' ? MCH : NCH, name + '.js'), deps, opts.sandbox);
      return new C().run(ctx, params || {});
    }
    return { ctx, v: ctx.$page.variables, f: ctx.$page.functions, calls, asked, run, runs };
  }
  const spell = (calls) => json(calls.map((c) => ({ endpoint: c.endpoint, uriParams: c.uriParams, body: c.body ? JSON.parse(JSON.stringify(c.body).replace(/"(allocatedDate|releasedDate)":"[^"]+"/g, '"$1":"NOW"')) : c.body,
    headers: c.headers })));
  const isWrite = (c) => /^eqp-v1\/(patch|create|update|delete)/.test(c.endpoint);
  const CUR = {
    509: { key: '509', id: 509, number: 'REQ-509', kind: 'decide', status: 'SUBMITTED', external: false, party: 'Plant Expansion B', start: '2026-11-08', end: '2026-11-22', when: 'Starts in 9 days', lateWhy: '' },
    503: { key: '503', id: 503, number: 'REQ-503', kind: 'allocate', status: 'IN_PROCESS', external: false, party: 'Plant Expansion B', start: '2026-11-08', end: '2026-11-22', when: 'Starts in 9 days', lateWhy: '' },
  };
  async function both(cur, runs) {
    const m = rig('mobile', { vars: { canAct: true, current: JSON.parse(json(cur)), view: 'detail', all: [JSON.parse(json(cur))] }, runs });
    const n = rig('next', { vars: { canAct: true, current: JSON.parse(json(cur)) }, runs });
    await m.run('recordChain', {});
    await n.run('recordChain', {});
    return { m, n };
  }

  T.section('reading a request: Next\'s reads, and Next\'s words');
  {
    const { m, n } = await both(CUR[509], ['suggestChain', 'applyChain']);
    T.eq('the same reads (its lines and its header, nothing written)', spell(m.calls), spell(n.calls));
    T.eq('…which are', m.calls.map((c) => c.endpoint.replace('eqp-v1/', '')).join(), 'getEquipriteV1ViewsRequestDetailLines,getEquipriteV1EquipmentRequestById');
    T.eq('the same head and verdict', json([m.v.rec.head.headline, m.v.rec.head.requestor, m.v.rec.head.requestorUserId, m.v.rec.head.est, m.v.rec.verdict]),
      json([n.v.rec.head.headline, n.v.rec.head.requestor, n.v.rec.head.requestorUserId, n.v.rec.head.est, n.v.rec.verdict]));
    T.eq('the same lines in words (and more on a phone)', json(m.v.rec.rows.map((r) => [r.id, r.label, r.units, r.action, r.reason])),
      json(n.v.rec.rows.map((r) => [r.id, r.label, r.units, r.action, r.reason])));
    T.eq('its age, from its header', m.v.rec.head.age, ma.age('2026-10-24T08:00:00Z', Date.now()));
  }
  {
    const { m, n } = await both(CUR[503], ['suggestChain', 'applyChain']);
    T.eq('units to assign: the same reads, then each line\'s units (suggestChain)', spell(m.calls), spell(n.calls));
    T.check('nothing written while suggesting', !m.calls.some(isWrite));
    T.eq('the same suggestions, in words', json(m.v.sugg), json(n.v.sugg));
    T.eq('…which are', json([m.v.sugg.byLine['9031'].words.text, m.v.sugg.byLine['9033'].words.text, m.v.sugg.plan.label]),
      '["Suggested: EX-2203 (Houston Yard)","Suggested: 6 from LOT-A (Houston Yard) and 4 from LOT-B (Dallas Yard)","Assign the suggested units to 2 lines"]');
  }

  T.section('approve and send back: the same calls as Next\'s decideChain');
  const decideCases = [
    ['approve every line', 'approve', [], ''],
    ['approve the chosen line', 'approve', ['9091'], ''],
    ['send back the chosen line, with the reason to the requester', 'reject', ['9092'], 'The compactor is booked for the shutdown.'],
    ['send back every line: the request is sent back', 'reject', [], 'Wrong project.'],
  ];
  for (const [name, action, ticks, reason] of decideCases) {
    const { m, n } = await both(CUR[509], []);
    const from = [m.calls.length, n.calls.length];
    m.v.ticks = ticks.slice();
    n.v.ticks = ticks.slice();
    m.v.reason = reason;
    n.v.reason = reason;
    m.v.shown = [JSON.parse(json(CUR[509])), Object.assign({}, CUR[503], { kind: 'allocate' })];
    m.v.chip = 'all';
    invalidated = 0;
    await m.run('decideChain', { action });
    await n.run('decideChain', { action });
    T.eq(`${name}: the same calls, headers included`, spell(m.calls.slice(from[0])), spell(n.calls.slice(from[1])));
    T.eq(`${name}: the same words`, m.v.done.text, n.v.result.text);
    T.eq(`${name}: then the shared request list is dropped and the queue read again`, json([invalidated, m.asked.slice(-1)]), '[2,["loadChain"]]');
    if (name.startsWith('send back the chosen')) {
      T.eq('…written out', json(m.calls.slice(from[0]).filter(isWrite).map((c) => [c.endpoint.replace('eqp-v1/', ''), c.body, c.headers])), json([
        ['patchRequestLinesBatch', { lines: [{ id: 9092, lineStatus: 'REJECTED' }] }, { 'X-User-Id': 'priya.raman' }],
        ['createNotification', { userId: 77, requestId: 509, requestNumber: 'REQ-509', subject: 'REQ-509: 1 line was sent back', message: 'The compactor is booked for the shutdown.' },
          { 'X-User-Id': 'priya.raman' }]]));
      T.eq('…what happened, and the reason cleared', json([m.v.view, m.v.done.title, m.v.reason, m.v.ticks]), '["done","Sent back · REQ-509","",[]]');
    }
    if (name === 'approve every line') {
      T.eq('…written out: the lines (with the audit headers), then the request', json(m.calls.slice(from[0]).filter(isWrite).map((c) => [c.endpoint.replace('eqp-v1/', ''), c.body, c.headers])),
        json([['patchRequestLinesBatch', { lines: [{ id: 9091, lineStatus: 'IN_PROCESS' }, { id: 9092, lineStatus: 'IN_PROCESS' }] }, { 'X-User-Id': 'priya.raman' }],
          ['patchEquipmentRequest', { status: 'IN_PROCESS' }, undefined]]));
      T.eq('…a toast says what happened', json(toasts[toasts.length - 1]), json([m.v.done.text, 'info']));
    }
  }
  {
    // A refused batch: nothing changed; the request stays open and is read again, saying why.
    const { m, n } = await both(CUR[509], []);
    m.v.lines = m.v.lines.map((l) => Object.assign({}, l, { lineId: '9999' }));
    n.v.lines = n.v.lines.map((l) => Object.assign({}, l, { lineId: '9999' }));
    const from = [m.calls.length, n.calls.length];
    await m.run('decideChain', { action: 'approve' });
    await n.run('decideChain', { action: 'approve' });
    T.eq('a refused batch: the same calls', spell(m.calls.slice(from[0])), spell(n.calls.slice(from[1])));
    T.check('…the request stays open, saying why, and is read again', m.v.view === 'detail' && /^Nothing was approved on REQ-509/.test(m.v.result.text)
      && m.asked.slice(-2).join() === 'loadChain,recordChain', json([m.v.view, m.v.result, m.asked.slice(-2)]));
  }

  T.section('Mobile\'s guards: nothing is sent without a connection, full access or a reason');
  {
    const { m } = await both(CUR[509], []);
    const from = m.calls.length;
    m.v.reason = '  ';
    await m.run('decideChain', { action: 'reject' });
    T.eq('send back without a reason: nothing sent, it asks for one', json([m.calls.length - from, m.v.formError]), '[0,"Write the reason first: Sam Ortiz gets it with the request."]');
    m.v.canAct = false;
    m.v.reason = 'x';
    await m.run('decideChain', { action: 'approve' });
    await m.run('decideChain', { action: 'reject' });
    T.eq('without full access: nothing sent', m.calls.length - from, 0);
  }
  {
    const off = rig('mobile', { vars: { canAct: true, current: JSON.parse(json(CUR[509])), view: 'detail' }, sandbox: { navigator: { onLine: false } } });
    await off.run('recordChain', {});
    const from = off.calls.length;
    toasts.length = 0;
    off.v.reason = 'Dates clash.';
    await off.run('decideChain', { action: 'approve' });
    await off.run('decideChain', { action: 'reject' });
    T.eq('no connection: nothing sent, said so', json([off.calls.length - from, off.v.formError, toasts[0]]),
      '[0,"No connection: nothing was sent.",["No connection: nothing was sent.","warning"]]');
    T.eq('…and the reason is kept for when it is back', off.v.reason, 'Dates clash.');
  }
  {
    const off = rig('mobile', { vars: { canAct: true, current: JSON.parse(json(CUR[503])), view: 'detail' }, runs: ['suggestChain', 'applyChain'], sandbox: { navigator: { onLine: false } } });
    await off.run('recordChain', {});
    await off.run('unitsChain', { lineId: '9031' });
    off.f.picker().stageAssign(703);
    const from = off.calls.length;
    await off.run('saveUnitsChain', {});
    await off.run('autoChain', {});
    T.eq('no connection: no units saved or assigned', json([off.calls.length - from, off.v.pickNote]), '[0,"No connection: nothing was sent."]');
  }

  T.section('a line\'s units: Next\'s gates, reads and saves');
  {
    const m = rig('mobile', { vars: { canAct: true, current: JSON.parse(json(CUR[509])), view: 'detail' } });
    await m.run('recordChain', {});
    const from = m.calls.length;
    toasts.length = 0;
    await m.run('unitsChain', { lineId: '9091' });
    T.eq('a line of a request still to decide: nothing read, the reason said', json([m.calls.length - from, toasts[0], m.v.sheet]),
      '[0,["Units can be assigned once the request is approved.","info"],""]');
  }
  {
    const { m, n } = await both(CUR[503], ['suggestChain', 'applyChain']);
    let from = [m.calls.length, n.calls.length];
    await m.run('unitsChain', { lineId: '9033' });
    await n.run('unitsChain', { lineId: '9033' });
    T.eq('free stock is not opened; a lot line opens: the same reads', spell(m.calls.slice(from[0])), spell(n.calls.slice(from[1])));
    from = [m.calls.length, n.calls.length];
    await m.run('unitsChain', { lineId: '9031' });
    await n.run('unitsChain', { lineId: '9031' });
    T.eq('a serial line: its units, the Transfer Orders, the other bookings (the same reads)', spell(m.calls.slice(from[0])), spell(n.calls.slice(from[1])));
    T.eq('…in the unit sheet, the suggested unit marked', json([m.v.sheet, m.v.picker.suggested, m.f.pickerRows(m.v.pickTick, m.v.picker.suggested).map((u) => u.name + ':' + u.act).join()]),
      '["unit",["EX-2203"],"EX-2201:,EX-2203:assign,EX-2210:assign"]');
    for (const x of [m, n]) await x.run('stageChain', { action: 'assign', id: '703' });
    from = [m.calls.length, n.calls.length];
    m.runs.clear();
    n.runs.clear();
    await m.run('saveUnitsChain', {});
    await n.run('saveUnitsChain', {});
    T.eq('save: the same calls (gate, stale check, allocation, unit, line)', spell(m.calls.slice(from[0])), spell(n.calls.slice(from[1])));
    T.eq('…written out', json(m.calls.slice(from[0]).filter(isWrite).map((c) => c.endpoint.replace('eqp-v1/', ''))), '["createAllocation","patchSerialRef","patchRequestLine"]');
    T.eq('…then the queue and the request are read again; the sheet closes', json([m.asked.slice(-2), m.v.sheet, m.v.result.text]),
      '[["loadChain","recordChain"],"","Line 1 (CAT 320 Excavator): assign EX-2210 (Dallas Yard). It has all its units."]');
    for (const x of [m, n]) { x.runs.add('suggestChain'); x.runs.add('applyChain'); }
    from = [m.calls.length, n.calls.length];
    await m.run('recordChain', { keep: true });
    await n.run('recordChain', { keep: true });
    T.eq('read again: the same reads; one line left to suggest for', [spell(m.calls.slice(from[0])) === spell(n.calls.slice(from[1])), m.v.sugg.plan.label].join(' | '),
      'true | Assign the suggested units to 1 line');
    from = [m.calls.length, n.calls.length];
    m.runs.clear();
    n.runs.clear();
    await m.run('sheetChain', { sheet: 'assign' });
    T.eq('the assign sheet', m.v.sheet, 'assign');
    await m.run('autoChain', {});
    await n.run('autoChain', { action: 'go' });
    T.eq('assign the suggestions: the same calls as Next\'s auto-allocate', spell(m.calls.slice(from[0])), spell(n.calls.slice(from[1])));
    T.eq('…written out', json(m.calls.slice(from[0]).filter(isWrite).map((c) => [c.endpoint.replace('eqp-v1/', ''), c.body && (c.body.lotRefId || c.body.availableToReserve)])),
      '[["createAllocation",801],["patchLotRef",0],["createAllocation",802],["patchLotRef",6],["patchRequestLine",null]]');
  }

  T.section('the queue: loading, the copy on the phone, a request handed over');
  {
    const hidden = rig('mobile', { app: { pageAccessMap: { EQR_WORKBENCH: 'READ_ONLY' } } });
    let loads = 0;
    const saveLoad = reqData.load;
    reqData.load = async () => { loads++; return dataNow; };
    await hidden.run('loadChain', { refresh: false });
    T.eq('without full access: refused in words, nothing read', json([hidden.v.canAct, hidden.v.error, loads, hidden.v.all]), '[false,"Approving needs full access to Approve & allocate.",0,[]]');
    reqData.load = saveLoad;
  }
  {
    const LROWS = ROWS.slice();
    const LLINES = {};
    Object.keys(LINES).forEach((k) => { LLINES[k] = LINES[k]; });
    dataNow = { rows: LROWS, linesByRequest: LLINES, error: '' };
    badges.length = 0;
    const m = rig('mobile', { runs: ['applyChain', 'focusChain', 'openChain', 'recordChain'] });
    await m.run('loadChain', { refresh: true });
    T.eq('loaded: the cards, the chip that holds what waits, the line under the title', json([m.v.all.map((c) => c.number), m.v.chip, m.v.shown.length, m.v.summary]),
      json([['R11', 'R12', 'R9', 'R10'], 'decide', 3, '3 to decide · 1 with units to assign · 1 late']));
    T.eq('…the tab\'s count', json(badges[badges.length - 1]), '["approve",3]');
    T.check('…and a copy on the phone, for this user', !!snap.read('approve', 'priya.raman') && snap.read('approve', 'priya.raman').data.length === 4);
    await m.run('applyChain', { chip: 'allocate' });
    T.eq('a chip', m.v.shown.map((c) => c.number).join(), 'R12');
    await m.run('applyChain', { chip: 'all', text: 'gulf' });
    T.eq('a search', m.v.shown.map((c) => c.number).join(), 'R11');
    await m.run('applyChain', { text: '' });

    mbus.focus('approve', { number: 'R9' });
    await m.run('focusChain', {});
    T.eq('a request handed over (My requests, a deep link): opened under a chip that shows it', json([m.v.view, m.v.current.number, m.v.chip, m.v.position]),
      '["detail","R9","all","3 of 4"]');
    T.eq('…and read in full', m.calls.map((c) => c.endpoint.replace('eqp-v1/', '')).slice(0, 2).join(), 'getEquipriteV1ViewsRequestDetailLines,getEquipriteV1EquipmentRequestById');
    T.eq('taken once', mbus.takeFocus('approve'), null);
    toasts.length = 0;
    mbus.focus('approve', { number: 'R13' });
    await m.run('focusChain', {});
    T.eq('nothing waiting on it: said so', json(toasts[0]), '["R13 has nothing waiting to approve or assign.","info"]');
    m.v.isLoading = true;
    mbus.focus('approve', { id: 10 });
    await m.run('focusChain', {});
    T.eq('while the queue loads, the load takes it when done', mbus.takeFocus('approve').id, 10);
    m.v.isLoading = false;

    await m.run('openChain', { key: '' });
    T.eq('back to the queue', json([m.v.view, m.v.current, m.v.lines]), '["list",{"key":""},[]]');

    dataNow = { rows: [], linesByRequest: {}, error: 'Requests could not be loaded.' };
    const off = rig('mobile', { runs: ['applyChain', 'focusChain', 'openChain'] });
    await off.run('loadChain', { refresh: true });
    T.check('no connection: the queue saved on this phone, saying when', off.v.all.length === 4 && /^Saved on this phone at \d\d:\d\d$/.test(off.v.saved) && !off.v.error, off.v.saved);
    await off.run('openChain', { key: '10' });
    T.eq('a saved request opens on what the card knew, with nothing read and nothing to decide', json([off.calls.length, off.v.rec.offline, off.v.rec.head.deciding, off.v.rec.head.equipment]),
      '[0,true,false,"Excavator and Dump truck"]');
    await off.run('sheetChain', { sheet: 'approve' });
    T.eq('…no decision sheet', off.v.sheet, '');
    snap.clear('approve', 'priya.raman');
    const none = rig('mobile', { runs: ['applyChain'] });
    await none.run('loadChain', { refresh: true });
    T.eq('no connection and no copy: the error', json([none.v.all, none.v.error]), '[[],"Requests could not be loaded."]');
  }

  T.section('the sheets, choosing lines, the reason');
  {
    const { m } = await both(CUR[509], []);
    await m.run('tickChain', { id: '9092' });
    await m.run('tickChain', { id: '9091' });
    await m.run('tickChain', { id: '9092' });
    T.eq('a line\'s tick turns on and off, in the order chosen', json(m.v.ticks), '["9091"]');
    await m.run('tickChain', { id: 'none' });
    T.eq('every line again', json(m.v.ticks), '[]');
    await m.run('sheetChain', { sheet: 'approve' });
    T.eq('the approve sheet says what will happen', json([m.v.sheet, m.v.decision.label, m.v.decision.say]),
      '["approve","Approve all 2 lines","Approve 2 pieces for Plant Expansion B, 8 Nov – 22 Nov 2026 · est. $11,000."]');
    await m.run('sheetChain', { sheet: '' });
    await m.run('sheetChain', { sheet: 'assign' });
    T.eq('nothing to assign: no assign sheet', m.v.sheet, '');
    await m.run('reasonChain', { phrase: 'Change the dates' });
    await m.run('reasonChain', { text: 'Change the dates. Two weeks later.' });
    await m.run('reasonChain', { phrase: 'Change the dates' });
    T.eq('typed and tapped reasons', m.v.reason, 'Two weeks later.');
    m.v.result = { tone: 'ok', text: 'x' };
    await m.run('sheetChain', { sheet: '', dismiss: true });
    T.eq('a result dismissed', m.v.result, null);
    m.v.lines = m.v.lines.map((l) => Object.assign({}, l, { lineStatus: 'REJECTED', line_status: 'REJECTED' }));
    await m.run('sheetChain', { sheet: 'reject' });
    T.eq('nothing left to send back: no sheet', m.v.sheet, '');
  }

  // ── Wiring ────────────────────────────────────────────────────────────────────────────────────────────────────
  T.section('wiring');
  const html = read(path.join(PAGE, 'approve-page.html'));
  const flowJson = JSON.parse(read(path.join(APP, 'flows', 'approve', 'approve-flow.json')));
  T.eq('flow and page: embeddable in the switcher', json([flowJson.navigation, mjson.navigation]), '[{"embeddable":"enabled"},{"embeddable":"enabled"}]');
  const named = new Set();
  Object.values(mjson.eventListeners).forEach((l) => l.chains.forEach((c) => named.add(c.chain)));
  fs.readdirSync(MCH).forEach((f) => (read(path.join(MCH, f)).match(/chain: '(\w+)'/g) || []).forEach((x) => named.add(x.slice(8, -1))));
  T.check('every chain named exists, each a class named like its file', [...named].every((c) => fs.existsSync(path.join(MCH, c + '.js'))
    && read(path.join(MCH, c + '.js')).includes('class ' + c + ' extends ActionChain')), [...named].filter((c) => !fs.existsSync(path.join(MCH, c + '.js'))).join());
  T.eq('every chain file is used', fs.readdirSync(MCH).map((f) => f.replace(/\.js$/, '')).filter((c) => !named.has(c)).join(), '');
  const used = new Set((html.match(/\$listeners\.(\w+)/g) || []).map((x) => x.split('.')[1]));
  T.eq('every listener in the HTML is defined', [...used].filter((l) => !mjson.eventListeners[l]).join(), '');
  T.eq('every listener defined is used (or is the page\'s own)', Object.keys(mjson.eventListeners).filter((l) => !used.has(l) && ['vbEnter', 'focusRequest'].indexOf(l) === -1).join(), '');
  const mod = new MPage();
  const fns = new Set((html.match(/\$functions\.(\w+)/g) || []).map((x) => x.split('.')[1]));
  fs.readdirSync(MCH).forEach((f) => (read(path.join(MCH, f)).match(/\$page\.functions\.(\w+)/g) || []).forEach((x) => fns.add(x.split('.').pop())));
  T.eq('every page function the HTML and chains call exists', [...fns].filter((fn) => typeof mod[fn] !== 'function').join(), '');
  const vars = new Set((html.match(/\$variables\.(\w+)/g) || []).map((x) => x.split('.')[1]));
  fs.readdirSync(MCH).forEach((f) => (read(path.join(MCH, f)).match(/\bpv\.(\w+)/g) || []).forEach((x) => vars.add(x.split('.')[1])));
  T.eq('every variable the HTML and chains use is declared', [...vars].filter((x) => !mjson.variables[x]).join(), '');
  T.eq('the event another tab fires is declared', Object.keys(mjson.events).join(), 'focusRequest');
  T.check('the page module takes a request handed over (mobileBus.onFocus)', /bus\.onFocus\('approve'/.test(read(path.join(PAGE, 'approve-page.js'))));
  const css = read(path.join(APP, 'resources', 'css', 'mobile-approve.css')) + read(path.join(APP, 'resources', 'css', 'mobile.css'));
  const classes = new Set((html.match(/mb-[a-z0-9-]+/g) || []));
  const missing = [...classes].filter((c) => !c.endsWith('-') && !new RegExp('\\.' + c.replace(/-/g, '\\-') + '(?![a-z0-9]|-[a-z0-9])').test(css));
  T.eq('every mb- class the page uses is styled', missing.join(', '), '');
  const own = read(path.join(APP, 'resources', 'css', 'mobile-approve.css')).replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = (own.match(/[^{}]+(?=\{)/g) || []).map((s) => s.trim()).filter((s) => s && !s.startsWith('@') && s !== 'to' && s !== 'from')
    .reduce((all, s) => all.concat(s.split(',').map((x) => x.trim())), []);
  T.eq(`the tab styles only its own classes (${selectors.length} selectors)`, selectors.filter((s) => !/^\.mb-approve/.test(s)).join(' | '), '');
  T.check('colours come from mobile.css\'s tokens, mostly', (own.match(/var\(--mb-/g) || []).length > 40);
  const ops = {};
  Object.values(JSON.parse(read(path.join(ROOT, 'services', 'eqp-v1', 'openapi3.json'))).paths)
    .forEach((p) => Object.values(p).forEach((op) => { if (op && op.operationId) ops['eqp-v1/' + op.operationId] = true; }));
  const endpoints = new Set();
  [path.join(MJS, 'approveAllocate.js'), path.join(MJS, 'lineConfirmed.js'), path.join(MJS, 'requestLineBody.js'), path.join(MJS, 'mobileApprove.js')]
    .concat(fs.readdirSync(MCH).map((f) => path.join(MCH, f)))
    .forEach((f) => (read(f).match(/endpoint:\s*'([^']+)'/g) || []).forEach((x) => endpoints.add(x.replace(/endpoint:\s*'/, '').replace("'", ''))));
  T.check(`every endpoint exists in services/eqp-v1 (${endpoints.size})`, [...endpoints].every((e) => ops[e]), [...endpoints].filter((e) => !ops[e]).join());
  T.check('nothing writes to Fusion (no ProjectLOV, ICS or BI call)', ![...endpoints].some((e) => !e.startsWith('eqp-v1/')));
  T.check('mobileApprove is pure: no calls', !/callRest|fetch\(|XMLHttpRequest/.test(read(path.join(MJS, 'mobileApprove.js'))));
  T.check('every write goes through approveAllocate (the chains call no write endpoint themselves)',
    !fs.readdirSync(MCH).some((f) => /endpoint:\s*'eqp-v1\/(patch|create|update|delete)/.test(read(path.join(MCH, f)))));

  T.report();
})().catch((e) => {
  T.check('run finished', false, e && e.stack);
  T.report();
});
