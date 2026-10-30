/*
 * EquipRite Mobile, the Pick tab: its pure module (resources/js/mobilePick.js: the checklist by step in walking order,
 * the next piece, scanning a unit, the Ship and Release sheets, the cards, the copy kept on the phone) and its chains
 * run against a fake Actions. The chains Mobile ports from Next's Picking & shipping (opening a request, Release, Pick
 * and ship) are run beside Next's own on the same answers: the same calls in the same order, the same bodies. Then
 * Mobile's own guards: no connection sends nothing, a saved copy is read afresh first, what is shipped is what the
 * sheet said. Loads the real modules.
 *
 * Run:  node tests/mobile-pick.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const APP = path.join(__dirname, '..', 'webApps', 'equiprite-mobile');
const NEXT = path.join(__dirname, '..', 'webApps', 'equiprite-next');
const JS = path.join(APP, 'resources', 'js');
const CHAINS = path.join(APP, 'flows', 'pick', 'pages', 'pick-page-chains');
const NEXT_CHAINS = path.join(NEXT, 'flows', 'yard', 'pages', 'picking-page-chains');

const quiet = { log() {}, warn() {}, error() {}, info() {} };
// The phone: its connection and its buzzer, changed by the tests.
const phone = { onLine: true, buzzes: [], vibrate(p) { phone.buzzes.push(p); return true; } };
const store = {};
const fakeWindow = {
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  scrollY: 0, scrollTo() {}, requestAnimationFrame(fn) { fn(); },
};

function loadFile(file, deps, extra) {
  const sandbox = Object.assign({ console: quiet, TextEncoder, URLSearchParams, Intl, Date, setTimeout, Promise, Object, Map, Set, Array, JSON, Math, String, Number,
    Boolean, encodeURIComponent, window: fakeWindow, navigator: phone, URL: { revokeObjectURL() {} },
    document: { getElementById: () => null, querySelector: () => null } }, extra || {});
  let mod;
  sandbox.define = (names, factory) => { mod = factory(...names.map((n) => (deps || {})[n])); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: path.basename(file) });
  return mod;
}
const load = (name, deps, extra) => loadFile(path.join(JS, name + '.js'), deps, extra);

const rules = load('rules');
const fmt = load('fmt');
const Progress = load('requestProgress');
const requestData = load('requestData', { 'resources/js/rules': rules });
const rdl = load('requestDetailLines');
const yw = load('yardWork', { 'resources/js/requestProgress': Progress, 'resources/js/requestData': requestData,
  'resources/js/requestDetailLines': rdl, 'resources/js/fmt': fmt });
const yardLoad = load('yardLoad', { 'resources/js/yardWork': yw });
const lineBody = load('requestLineBody');
const cu = load('currentUser');
const mal = load('maintAssetLocation');
const snapshot = load('offlineSnapshot');
const pickSlip = load('pickSlip', { jspdf: { jsPDF: function () {} } });
const mp = load('mobilePick', { 'resources/js/yardWork': yw, 'resources/js/requestProgress': Progress, 'resources/js/fmt': fmt });

const NOW = Date.UTC(2026, 9, 30, 9, 0, 0);
const d = (n) => new Date(NOW + n * 86400000).toISOString().slice(0, 10);

// ── A request's workspace, as openWorkChain builds it ───────────────────────────────────────────────────────────────
const W = (id, o) => Object.assign({ lineId: String(id), equipmentName: 'Piece ' + id, equipmentClass: 'Class', quantity: 1, yard: 'Houston Yard', allocUnits: [],
  serialNumber: '', subinventory: '', locator: '', toNumber: '', isFAndM: false, lineStatus: 'PICK_INITIATED', maintenanceTracked: 'N', transactable: 'Y' }, o);
const unit = (n) => [{ serialNumber: n, currentStatus: 'RENTED', unitRefId: 1, unitType: 'SERIAL' }];
const lines = [
  W(5001, { equipmentName: 'Volvo A30 Dump Truck', lineStatus: 'SCHEDULED_FOR_PICKING', toNumber: 'TO-880101', allocUnits: unit('DT-3001'), serialNumber: 'DT-3001',
    subinventory: 'Available', locator: 'A-03-01' }),
  W(5002, { equipmentName: 'Roller 10t', lineStatus: 'SCHEDULED_FOR_PICKING', isFAndM: true, allocUnits: unit('RL-1002'), serialNumber: 'RL-1002',
    subinventory: 'Available', locator: 'B-10-02', transactable: 'N' }),
  W(5003, { equipmentName: 'Generator 100kVA', isFAndM: true, allocUnits: unit('GN-0412'), serialNumber: 'GN-0412', subinventory: 'Available', locator: 'B-2-01',
    transactable: 'N' }),
  W(5004, { equipmentName: 'Light tower', isFAndM: true, allocUnits: unit('LT-0042'), serialNumber: 'LT-0042', subinventory: 'Available', locator: 'A-12-04',
    transactable: 'N' }),
  W(5005, { equipmentName: 'Site office cabin', lineStatus: 'SHIP_TO_SITE', isFAndM: true, allocUnits: unit('CB-0003'), serialNumber: 'CB-0003', transactable: 'N' }),
  W(5007, { equipmentName: 'Compactor plate', toNumber: 'TO-880102', allocUnits: unit('CP-0007'), serialNumber: 'CP-0007', subinventory: 'Available', locator: 'A-3-09' }),
];
const tos = [{ value: '91', orderNumber: 'TO-880101', released: false }, { value: '92', orderNumber: 'TO-880102', released: true }];
const req = { id: '2003', eqrEquipmentRequestId: 2003, requestNumber: 'REQ-2003', party: 'EPC_MO_Operations', task: '4.1 Civil works', location: 'Moss Landing',
  start: d(-2), requestor: 'Priya Raman', isCustomer: false };
const work = { req, lines, exceptions: [], tos, yards: 'Houston Yard' };

(async () => {
  T.section('a piece\'s step, and what a phone may tick');
  T.eq('being picked: tick it when picked', mp.stepOf(lines[2]), 'pick');
  T.eq('a fixed asset waiting for release: tick it to release', mp.stepOf(lines[1]), 'release');
  T.eq('a stock piece waiting: released in Fusion first', mp.stepOf(lines[0]), 'fusion');
  T.eq('shipped', mp.stepOf(lines[4]), 'shipped');
  T.eq('allocated from before Confirm (Next releases it too)', mp.stepOf({ lineStatus: 'ALLOCATED', isFAndM: true }), 'release');
  T.eq('tickable: being picked and fixed assets to release only', lines.filter(mp.tickable).map((l) => l.lineId).join(), '5002,5003,5004,5007');
  T.eq('ticks kept that still mean something', mp.liveTicks(lines, ['5001', '5003', '5005', '9999']).join(), '5003');

  T.section('walking order (the pick slip\'s)');
  const slipOrder = pickSlip.buildModel({ requestNumber: 'REQ-2003' }, lines.map((l) => Object.assign({}, l, { lineStatus: 'PICK_INITIATED' })), new Date(NOW)).rows
    .map((r) => r.equipmentName).join(' > ');
  T.eq('by subinventory then locator (numbers as numbers), unlocated last: as the slip prints', mp.walk(lines).map((l) => l.equipmentName).join(' > '), slipOrder);
  T.eq('A-3-09 before A-12-04', mp.walk(lines).map((l) => l.locator).join(), 'A-03-01,A-3-09,A-12-04,B-2-01,B-10-02,');

  T.section('the pick list (mobilePick.checklist)');
  let c = mp.checklist(work, [], '', {});
  T.eq('groups by step: release, being picked, Fusion, shipped', c.groups.map((g) => g.key + ':' + g.count).join(), 'release:1,pick:3,fusion:1,shipped:1');
  T.eq('being picked in walking order', c.groups[1].pieces.map((p) => p.unit).join(), 'CP-0007,LT-0042,GN-0412');
  T.eq('the next piece: the first not yet picked, on the walk', c.next.unit + ' @ ' + c.next.where, 'CP-0007 @ Houston Yard · Available · A-3-09');
  T.eq('progress: shipped counts as picked', [c.progress, c.ringText].join(' | '), '1 of 6 picked | 1/6');
  T.eq('nothing ticked: Next\'s gate (a fixed asset at Pick initiated) lets every piece being picked ship', [c.canShip, c.ship, c.primary].join(), 'true,3,ship');
  T.eq('a stock piece waiting for Fusion is said so', c.fusionText, '1 piece on transfer order TO-880101 waits for release.');
  T.eq('the transfer orders in words', c.tos, 'TO-880101, TO-880102 · 1 awaiting release');
  T.check('the ring: a style object JET can bind', /^conic-gradient\(var\(--mb-ok\) 0 16\.7%/.test(c.ring.backgroundImage), c.ring.backgroundImage);
  c = mp.checklist(work, ['5002'], '', {});
  T.eq('a fixed asset ticked to release: Release is the step', [c.release, c.primary].join(), '1,release');
  const t2 = ['5004', '5003'];
  c = mp.checklist(work, t2, yw.selectedTOIdFor(tos, lines, t2), {});
  T.eq('ticked as picked', [c.picked, c.next.unit, c.groups[1].ticked].join(), '3,CP-0007,2');
  T.eq('no single order ticked: every piece being picked ships (Next\'s rule)', [c.ship, c.shipAllTicked].join(), '3,false');
  const t3 = ['5007'];
  c = mp.checklist(work, t3, yw.selectedTOIdFor(tos, lines, t3), {});
  T.eq('one released order ticked: its pieces and the fixed assets being picked', [yw.selectedTOIdFor(tos, lines, t3), c.ship].join(), '92,3');
  const ro = mp.checklist(work, [], '', { syncOn: true });
  T.eq('asset sync on: no fixed asset here is maintenance tracked, nothing for Fusion', ro.relocates, 0);
  const mt = mp.checklist({ req, tos, lines: lines.map((l) => (l.lineId === '5003' ? Object.assign({}, l, { maintenanceTracked: 'Y' }) : l)) }, [], '', { syncOn: true });
  T.eq('one maintenance tracked and not transactable: Fusion would move it', mt.relocates, 1);
  const onlyFusion = mp.checklist({ req, tos, lines: [lines[0], lines[4]] }, [], '', {});
  T.eq('only waiting for Fusion: no step, a hint', [onlyFusion.primary, onlyFusion.hint].join('|'), '|Waiting for release in Fusion');
  const unreleased = mp.checklist({ req, tos: [{ value: '91', orderNumber: 'TO-880101', released: false }], lines: [W(1, { toNumber: 'TO-880101' })] }, ['1'], '91', {});
  T.eq('ticked on an order still waiting for Fusion: says so', unreleased.hint, 'Transfer order TO-880101 still has pieces waiting for release in Fusion');
  T.eq('an empty pick list', mp.checklist(null, [], '', {}).progress, 'Nothing at a picking step');

  T.section('ticks: a group, after Release');
  T.eq('tick all being picked keeps the fixed asset ticked to release', mp.toggleGroup(lines, ['5002'], 'pick').sort().join(), '5002,5003,5004,5007');
  T.eq('again: untick them, the other group\'s tick stays', mp.toggleGroup(lines, ['5002', '5003', '5004', '5007'], 'pick').join(), '5002');
  T.eq('a released piece is ticked again when picked', mp.afterRelease(['5002', '5003'], ['5002']).join(), '5003');

  T.section('the sheets say what will happen');
  const sh = mp.shipSheet(work, ['5003', '5004'], '');
  T.eq('Ship: request, how many, to whom', sh.title, 'Ship 3 pieces of REQ-2003 to EPC_MO_Operations');
  T.eq('the pieces, in walking order (? = not ticked)', sh.pieces.map((p) => p.unit + (p.ticked ? '' : '?')).join(), 'CP-0007?,LT-0042,GN-0412');
  T.eq('the same ids Pick and ship picks', sh.ids.sort().join(), yw.shipLines(tos, '', lines, ['5003', '5004']).map((l) => l.lineId).sort().join());
  T.eq('what is not ticked is said', sh.untickedText.split('.')[0], '1 of these is not ticked as picked');
  T.eq('all ticked: nothing to say', mp.shipSheet(work, ['5003', '5004', '5007'], '').untickedText, '');
  T.eq('one piece, none ticked', mp.shipSheet({ req, tos: [], lines: [lines[2]] }, [], '').untickedText.split('.')[0], 'It is not ticked as picked');
  const rs = mp.releaseSheet(work, ['5002', '5003']);
  T.eq('Release: only the ticked fixed assets waiting', [rs.title, rs.ids.join()].join(' | '), 'Release 1 fixed-asset piece of REQ-2003 for picking | 5002');
  T.check('and that nothing goes to Fusion', /nothing is sent to Fusion/.test(rs.note));

  T.section('a scanned or typed unit');
  T.check('any case, spaces aside', mp.sameUnit(' lt-0042 ', 'LT-0042') && mp.sameUnit('LT 0042', 'LT-0042') === false && mp.sameUnit('lt-0042', 'LT-0042'));
  T.check('a QR tag holding a link to the unit', mp.sameUnit('https://tags.example/units/LT-0042?x=1', 'LT-0042'));
  T.check('not a part of a longer number', !mp.sameUnit('LT-00421', 'LT-0042'));
  const scan = (v, ticks, o) => mp.scanResult(work, ticks || [], v, Object.assign({ canTick: true }, o));
  let r = scan('gn-0412');
  T.eq('being picked: ticked as picked, a buzz', [r.tone, r.tick, r.lineId, r.buzz, r.title].join('|'), 'ok|true|5003|hit|Picked: Generator 100kVA · GN-0412');
  T.eq('where it is', r.text, 'Houston Yard · Available · B-2-01');
  T.eq('a fixed asset waiting: ticked to release', [scan('RL-1002').title, scan('RL-1002').tick].join('|'), 'To release: Roller 10t · RL-1002|true');
  T.eq('already ticked: not untouched by a second read', [scan('GN-0412', ['5003']).tick, scan('GN-0412', ['5003']).text].join('|'), 'false|Already ticked as picked.');
  T.eq('shipped: said, not ticked', [scan('CB-0003').tick, scan('CB-0003').text].join('|'), 'false|It has already shipped.');
  T.check('waiting for Fusion: said, not ticked', !scan('DT-3001').tick && /TO-880101 is released in Fusion first/.test(scan('DT-3001').text) && scan('DT-3001').tone === 'warn');
  T.eq('read-only: found, never ticked', [scan('GN-0412', [], { canTick: false }).tick, scan('GN-0412', [], { canTick: false }).text].join('|'),
    'false|On this request: Being picked at the yard. Houston Yard · Available · B-2-01.');
  const items = [{ id: '2007', requestNumber: 'REQ-2007', party: 'Pipeline North', pieces: [{ lineId: '7101', serial: '', stage: 'picking' }] },
    { id: '2003', requestNumber: 'REQ-2003', party: 'EPC_MO_Operations', pieces: [{ lineId: '5003', serial: 'GN-0412', stage: 'picking' }] }];
  r = scan('TR-0450', [], { items, units: { 7101: ['TR-0450'] } });
  T.eq('on another request: says which, nothing ticked, two buzzes', [r.tone, r.tick, r.buzz, r.title, r.text].join('|'),
    'miss|false|miss|TR-0450 is not on REQ-2003|It is on REQ-2007 (Pipeline North). Nothing was ticked.');
  T.eq('on no request', scan('ZZ-1', [], { items }).text, 'Check the tag, or type the unit number. Nothing was ticked.');
  T.eq('from the list: the request a unit is on (yard lookups)', JSON.stringify(mp.findInList(items, { 7101: ['TR-0450'] }, 'tr-0450')),
    JSON.stringify({ unit: 'TR-0450', id: '2007', number: 'REQ-2007', party: 'Pipeline North', lineId: '7101', stage: 'picking' }));
  T.eq('or the serial on the request\'s lines', mp.findInList(items, {}, 'GN-0412').number, 'REQ-2003');
  T.eq('the unit numbers of a line-detail-units answer: allocated rows only', mp.unitNumbers([{ allocationId: 1, unitNumber: 'A' }, { unitNumber: 'B' }, { allocationId: 2, unitNumber: 'A' }]).join(), 'A');
  T.eq('the same tag read again at once is the same read', [mp.sameScan({ value: 'lt-0042', at: 1000 }, 'LT-0042', 2000), mp.sameScan({ value: 'LT-0042', at: 1000 }, 'LT-0042', 4000)].join(),
    'true,false');
  phone.buzzes = [];
  T.eq('a buzz on a match, twice on a miss, a tap on a tick', [mp.vibrate(phone, 'hit'), mp.vibrate(phone, 'miss'), mp.vibrate(phone, 'tap'), JSON.stringify(phone.buzzes)].join(' '),
    'true true true [45,[90,60,90],15]');
  T.eq('no buzzer (an iPhone): nothing, no error', [mp.vibrate({}, 'hit'), mp.vibrate(null, 'hit'), mp.vibrate({ vibrate() { throw new Error('x'); } }, 'hit')].join(), 'false,false,false');

  T.section('today\'s work: cards');
  const QUEUE = [
    { eqrEquipmentRequestId: 2003, requestNumber: 'REQ-2003', requestStatus: 'IN_PROCESS', source: 'INTERNAL', projectName: 'EPC_MO_Operations', taskName: '4.1 Civil works',
      location: 'Moss Landing', requestedStartDate: d(-2) + 'T00:00:00Z' },
    { eqrEquipmentRequestId: 2007, requestNumber: 'REQ-2007', requestStatus: 'IN_PROCESS', source: 'INTERNAL', projectName: 'Pipeline North', requestedStartDate: d(0) + 'T00:00:00Z' },
  ];
  const records = yw.queueRows(QUEUE, rules.isExternalSource);
  const DL = (rid, id, status, extra) => Object.assign({ requestId: rid, lineId: id, equipmentName: 'P' + id, className: 'C', quantity: 1, lineStatus: status,
    startDate: '', allocatedSerial: '', toNumber: '', isTransactable: 'N', unused: 'x'.repeat(50) }, extra || {});
  const linesBy = { 2003: [DL(2003, 5001, 'SCHEDULED_FOR_PICKING', { isTransactable: 'Y' }), DL(2003, 5003, 'PICK_INITIATED', { allocatedSerial: 'GN-0412' }),
    DL(2003, 5004, 'PICK_INITIATED'), DL(2003, 5005, 'SHIP_TO_SITE'), DL(2003, 5006, 'DRAFT')], 2007: [DL(2007, 7101, 'PICK_INITIATED', { isTransactable: 'Y', toNumber: 'TO-1' })] };
  const yards = { 5001: 'Houston Yard', 5003: 'Houston Yard', 5004: 'Houston Yard', 7101: 'Atlanta Yard' };
  const its = yw.items('picking', records, linesBy, yards, NOW, {});
  const kept = mp.withTicks(mp.kept(null), '2003', 'REQ-2003', ['5003', '5001'], true, NOW - 3600000);
  const card = mp.card(its.filter((i) => i.id === '2003')[0], kept, NOW);
  T.eq('a card: when, where to, how many picked (ticked on this phone count)', [card.number, card.when, card.tone, card.party, card.sub, card.pickedText].join(' | '),
    'REQ-2003 | 2 days late | late | EPC_MO_Operations | 4.1 Civil works · to Moss Landing | 2 of 4 pieces picked');
  T.eq('the ticks kept, not yet sent', [card.kept, card.offline, card.ringText].join(' | '), '1 piece ticked on this phone | true | 2/4');
  T.eq('its next step and where it is done', [card.next, card.where, card.yard].join(' | '), 'Release 1 piece for picking | new | Houston Yard');
  const secs = mp.sections(yw.sections('picking', its, { done: true }), kept, NOW);
  T.eq('in yardWork\'s sections, late first, a card each', secs.map((s) => s.key + ':' + s.cards.map((x) => x.number).join('+')).join(' '), 'late:REQ-2003 today:REQ-2007');
  T.eq('the stage chips: All first, then the tiles', mp.chips(yw.tiles('picking', its), its).map((x) => x.key + x.count).join(), 'all2,late3,pick1,picking3,ship0,shipped1');
  T.eq('what is left for the yard (the Pick tab\'s count)', mp.left(its), 4);
  T.eq('New EquipRite\'s picking screen', [mp.newUrl('http://n/'), mp.newUrl('http://n'), mp.newUrl('')].join(' '), 'http://n/vp/shell/logistics/picking http://n/vp/shell/logistics/picking ');
  T.eq('the yard in words', [mp.yardLabel('all'), mp.yardLabel('Houston Yard')].join(), 'All yards,Houston Yard');
  T.eq('when it must ship', [mp.whenText({ start: d(-2) }, NOW), mp.whenText({ start: d(0) }, NOW), mp.whenText({}, NOW)].join(' | '),
    '2 days late · needed Wed 28 Oct | Today · Fri 30 Oct | No date');
  T.eq('also on the request (Next\'s list): the line not in picking', mp.otherLines(linesBy[2003], lines, false).map((o) => o.lineId + ':' + o.label).filter((x) => /5006/.test(x)).join(),
    '5006:Not sent yet');

  T.section('the copy kept on the phone');
  let k = mp.withList(mp.kept(null), records, linesBy, yards, { 7101: ['TR-0450'] }, NOW);
  T.check('lines kept in the fields the list reads only', !('unused' in k.list.linesBy[2003][0]) && k.list.linesBy[2003][0].lineStatus === 'SCHEDULED_FOR_PICKING');
  const back = JSON.parse(JSON.stringify(k));
  const again = yw.items('picking', back.list.records, back.list.linesBy, back.list.yards, NOW, {});
  T.eq('restored, the list is the same', JSON.stringify(yw.sections('picking', again, {}).map((s) => [s.key, s.items.map((i) => i.summary + i.when.main)])),
    JSON.stringify(yw.sections('picking', its, {}).map((s) => [s.key, s.items.map((i) => i.summary + i.when.main)])));
  for (let i = 0; i < 14; i++) k = mp.withWork(k, { req: { id: 'R' + i } }, NOW + i);
  T.eq('the newest twelve pick lists', Object.keys(k.works).length + ' ' + !!mp.workOf(k, 'R13') + ' ' + !!mp.workOf(k, 'R0'), '12 true false');
  k = mp.withTicks(k, '2003', 'REQ-2003', ['5003'], true, NOW);
  T.eq('ticks with no connection: marked', mp.ticksOf(k, '2003', NOW).offline, true);
  k = mp.withTicks(k, '2003', 'REQ-2003', ['5003', '5004'], undefined, NOW);
  T.eq('more ticks online: still marked (not sent yet)', mp.ticksOf(k, '2003', NOW).offline, true);
  T.eq('what waits to be sent', JSON.stringify(mp.pending(k, NOW)), JSON.stringify([{ id: '2003', number: 'REQ-2003', count: 2,
    text: 'REQ-2003: 2 pieces ticked with no connection, kept on this phone' }]));
  k = mp.withTicks(k, '2003', 'REQ-2003', ['5004'], false, NOW);
  T.eq('sent: the mark goes', [mp.ticksOf(k, '2003', NOW).offline, mp.pending(k, NOW).length].join(), 'false,0');
  T.eq('a shift later the ticks are forgotten', mp.ticksOf(k, '2003', NOW + mp.TICKS_KEEP_MS + 1), null);
  T.eq('no ticks: the request is forgotten', mp.ticksOf(mp.withTicks(k, '2003', '', [], undefined, NOW), '2003', NOW), null);
  T.eq('the yard chosen', [mp.withYard(k, 'Houston Yard').yard, mp.withYard(k, 'all').yard].join('|'), 'Houston Yard|');
  const fakeStore = { data: null, read() { return this.data ? { at: 1, data: this.data } : null; }, save(n, u, data) { this.data = data; return true; } };
  mp.keep(fakeStore, 'u', (x) => mp.withYard(x, 'Atlanta Yard'));
  mp.keep(fakeStore, 'u', (x, at) => mp.withTicks(x, '1', 'REQ-1', ['9'], undefined, at));
  T.eq('each change reads the copy afresh (nothing lost between two steps)', [mp.read(fakeStore, 'u').yard, mp.read(fakeStore, 'u').ticks[1].ticks.join()].join(), 'Atlanta Yard,9');
  T.eq('a broken store never throws', [mp.keep({ read() { throw new Error('x'); } }, 'u', (x) => x), JSON.stringify(mp.read({ read() { throw new Error('x'); } }, 'u'))].join(' '),
    'false {"list":null,"works":{},"ticks":{},"yard":""}');

  // ── Chains ──────────────────────────────────────────────────────────────────────────────────────────────────────
  class ActionChain {}
  function fakeActions(answer) {
    const calls = [];
    return {
      calls,
      callRest: async (ctx, o) => { calls.push(o); return answer(o) || { ok: false, status: 404, body: {} }; },
      callChain: async (ctx, o) => { calls.push({ chain: o.chain, params: o.params }); return null; },
    };
  }
  const said = [];
  const bus = { toast: (m, tone) => said.push('toast:' + tone + ':' + m), badge: (t, n) => said.push('badge:' + t + ':' + n), takeFocus: () => focusWant,
    onFocus() {}, focus() {}, go() {} };
  let focusWant = null;
  const deps = (Actions) => ({
    'vb/action/actionChain': ActionChain, 'vb/action/actions': Actions, 'resources/js/yardWork': yw, 'resources/js/requestLineBody': lineBody,
    'resources/js/currentUser': cu, 'resources/js/requestData': requestData, 'resources/js/rules': rules, 'resources/js/maintAssetLocation': mal,
    'resources/js/requestDetailLines': rdl, 'resources/js/mobilePick': mp, 'resources/js/offlineSnapshot': snapshot, 'resources/js/mobileBus': bus,
    'resources/js/yardLoad': yardLoad, 'resources/js/shellBus': { open() {}, toast() {}, takeFocus() { return null; }, onFocus() {} },
    'resources/js/unitScanner': { isCameraAvailable: () => ({ ok: false, message: 'This browser cannot open the camera.' }) },
    require: (names, ok) => ok(pickSlipStub),
  });
  const pickSlipStub = { buildModel: (r, l) => ({ r, l }), buildPickSlipPdf: (m) => ({ base64: 'eA==', fileName: 'pick-slip-' + m.r.requestNumber + '.pdf', docNumber: 'PS-1', rowCount: 4 }),
    toBlobUrl: () => 'blob:slip' };
  const chain = (name, Actions, dir) => loadFile(path.join(dir || CHAINS, name + '.js'), deps(Actions));
  function ctx(vars, o) {
    const opts = o || {};
    return {
      $page: { variables: vars, functions: { downloadSlip: () => true, shareSlip: async () => ({ ok: false, cancelled: true }) } },
      $application: {
        user: { userName: 'priya.raman' },
        variables: { pageAccessMap: opts.access || { EQR_INITIATE_PICKING: 'FULL' }, pageAccessLoaded: true, featureFlags: opts.flags || {}, flagsLoaded: true, jwt: '',
          appUrls: {} },
        functions: { isFeatureEnabled: rules.isFeatureEnabled, isExternalSource: rules.isExternalSource },
      },
    };
  }
  const pageVars = (extra) => Object.assign({
    isLoading: false, error: '', saved: '', records: records.slice(), linesBy: {}, yards: {}, units: {}, items: its, view: 'list', openId: '', listY: 0,
    work: { req: {}, lines: [], exceptions: [], tos: [], yards: '' }, workLoading: false, workError: '', workSaved: '', ticks: [], selectedTOId: '',
    check: mp.checklist(null, [], '', {}), banner: { type: '', text: '' }, busy: '', slip: { url: '', fileName: '', docNumber: '', rows: 0 }, sheet: '', sheetData: {},
    scan: { open: false, supported: true, status: '', last: {} }, unitText: '', flash: '', can: { act: true, slip: true, sync: false, known: true }, online: true,
    stage: 'all', yard: 'all', text: '', collapsed: { done: true }, yardKnown: false, loadToken: 0, yardsLoading: false, pending: [],
  }, extra || {});
  const rests = (A) => A.calls.filter((x) => x.endpoint).map((x) => x.endpoint.replace('eqp-v1/', '') + JSON.stringify(x.uriParams || {}));
  const chains = (A) => A.calls.filter((x) => x.chain).map((x) => x.chain);
  const USER = 'priya.raman';
  const forget = () => Object.keys(store).forEach((x) => delete store[x]);

  // The server, for opening REQ-2003 (the answers Next's openWorkChain reads).
  const server = {
    lines: [
      { id: 5001, eqrEquipmentMasterId: 11, quantity: 1, lineStatus: 'SCHEDULED_FOR_PICKING', fulfilmentClass: 'S_AND_T', isTransactable: 'Y', isMaintenanceTracked: 'N' },
      { id: 5002, eqrEquipmentMasterId: 12, quantity: 1, lineStatus: 'SCHEDULED_FOR_PICKING', fulfilmentClass: 'F_AND_M', isTransactable: 'N', isMaintenanceTracked: 'N' },
      { id: 5003, eqrEquipmentMasterId: 13, quantity: 1, lineStatus: 'PICK_INITIATED', fulfilmentClass: 'F_AND_M', isTransactable: 'N', isMaintenanceTracked: 'N' },
      { id: 5004, eqrEquipmentMasterId: 14, quantity: 1, lineStatus: 'PICK_INITIATED', fulfilmentClass: 'F_AND_M', isTransactable: 'N', isMaintenanceTracked: 'N' },
      { id: 5005, eqrEquipmentMasterId: 15, quantity: 1, lineStatus: 'SHIP_TO_SITE', fulfilmentClass: 'F_AND_M', isTransactable: 'N', isMaintenanceTracked: 'N' },
      { id: 5006, eqrEquipmentMasterId: 16, quantity: 1, lineStatus: 'DRAFT', fulfilmentClass: 'S_AND_T', isTransactable: 'Y', isMaintenanceTracked: 'N' },
      { id: 5007, eqrEquipmentMasterId: 17, quantity: 1, lineStatus: 'PICK_INITIATED', fulfilmentClass: 'S_AND_T', isTransactable: 'Y', isMaintenanceTracked: 'N' },
    ],
    units: { 5001: 'DT-3001', 5002: 'RL-1002', 5003: 'GN-0412', 5004: 'LT-0042', 5005: 'CB-0003', 5007: 'CP-0007' },
  };
  const answer = (o) => {
    const e = o.endpoint.replace('eqp-v1/', '');
    if (e === 'getTransferOrders') {
      return { ok: true, body: { data: [{ id: 92, orderNumber: 'TO-880102', orderStatus: 'OPEN', createdDate: '2026-10-28T10:00:00Z' },
        { id: 91, orderNumber: 'TO-880101', orderStatus: 'OPEN', createdDate: '2026-10-29T10:00:00Z' }] } };
    }
    if (e === 'getTransferOrderLines') return { ok: true, body: { data: (o.uriParams.transferOrderId === 91 ? [5001] : [5007]).map((id) => ({ requestLineId: id })) } };
    if (e === 'getEquipriteV1EquipmentRequestsRequestIdLines2') return { ok: true, body: { data: server.lines.map((l) => Object.assign({}, l)) } };
    if (e === 'getEquipriteV1ViewsLineDetailUnits') {
      const n = server.units[o.uriParams.lineId];
      return { ok: true, body: { data: n ? [{ equipmentName: 'Piece ' + o.uriParams.lineId, className: 'C', allocationId: 1, unitNumber: n, unitStatus: 'RENTED',
        unitRefId: o.uriParams.lineId, unitType: 'SERIAL', allocationMethod: 'MANUAL', sourceInvOrgName: 'Houston Yard' }] : [] } };
    }
    if (e === 'getSerialRefs') return { ok: true, body: { data: [{ id: 5000 + (o.uriParams.equipmentId - 10), currentSubinventory: 'Available', currentLocator: 'L-' + o.uriParams.equipmentId }] } };
    if (e === 'patchRequestLinesBatch') {
      o.body.lines.forEach((u) => { server.lines.filter((l) => l.id === u.id)[0].lineStatus = u.lineStatus; });
      return { ok: true, body: { data: [] } };
    }
    if (e === 'getEquipriteV1ViewsRequestDetailLines') return { ok: true, body: { data: linesBy[o.uriParams.requestId] || [] } };
    if (e === 'getEquipriteV1ViewsWorkbenchRequests') return { ok: true, body: { data: QUEUE } };
    return null;
  };
  const rec = records.filter((x) => x.id === '2003')[0];

  T.section('opening a request: Next\'s calls, in Next\'s order');
  {
    forget();
    const NA = fakeActions(answer);
    const nv = { records: [rec], openId: '', work: { req: {}, lines: [], exceptions: [], tos: [] }, banner: {}, slip: {}, ticks: [], selectedTOId: '' };
    await new (chain('openWorkChain', NA, NEXT_CHAINS))().run(ctx(nv), { id: '2003', keepBanner: false });
    const MA = fakeActions(answer);
    const v = pageVars({ records: [rec] });
    await new (chain('openWorkChain', MA))().run(ctx(v), { id: '2003', keepBanner: false });
    T.check('the same reads, in the same order, as Next', rests(MA).join('\n') === rests(NA).join('\n') && rests(MA).length === 1 + 2 + 1 + 6 + 6,
      rests(MA).slice(0, 4).join(' > '));
    T.eq('nothing written', MA.calls.filter((x) => x.endpoint && !/\/get/.test('/' + x.endpoint.replace('eqp-v1/', ''))).length, 0);
    T.eq('the same pick list as Next', JSON.stringify(v.work.lines), JSON.stringify(nv.work.lines));
    T.eq('the same transfer orders', JSON.stringify(v.work.tos), JSON.stringify(nv.work.tos));
    T.eq('Next opens on its first order awaiting release ticked', nv.ticks.join(), '5001');
    T.eq('a phone opens with nothing ticked (a tick is a piece picked)', [v.ticks.length, v.selectedTOId].join('|'), '0|');
    T.eq('the pick list on the screen', [v.view, v.check.groups.map((g) => g.key).join('+'), v.check.next.unit].join(' '), 'work release+pick+fusion+shipped GN-0412');
    T.check('kept on the phone for no connection', !!mp.workOf(mp.read(snapshot, USER), '2003'));
    // Ticks this phone kept come back (only those still tickable).
    mp.keep(snapshot, USER, (x, at) => mp.withTicks(x, '2003', 'REQ-2003', ['5003', '5001', '5005'], true, at));
    const v2 = pageVars({ records: [rec] });
    await new (chain('openWorkChain', fakeActions(answer)))().run(ctx(v2), { id: '2003', keepBanner: false });
    T.eq('opened again: the phone\'s ticks, still tickable ones only', v2.ticks.join(), '5003');
    T.eq('kept as they are, still marked not yet sent', mp.ticksOf(mp.read(snapshot, USER), '2003', Date.now()).offline, true);

    phone.onLine = false;
    const OA = fakeActions(answer);
    const v3 = pageVars({ records: [rec] });
    await new (chain('openWorkChain', OA))().run(ctx(v3), { id: '2003', keepBanner: false });
    T.eq('no connection: nothing asked', OA.calls.length, 0);
    T.check('the copy saved on this phone, saying when, with its ticks', /^No connection\. Saved on this phone at \d\d:\d\d$/.test(v3.workSaved) && v3.ticks.join() === '5003'
      && v3.work.lines.length === 6, v3.workSaved);
    forget();
    const v4 = pageVars({ records: [rec] });
    await new (chain('openWorkChain', fakeActions(answer)))().run(ctx(v4), { id: '2003', keepBanner: false });
    T.eq('no copy: says so', v4.workError, 'No connection, and this phone has no saved copy of REQ-2003: open it once with a connection.');
    phone.onLine = true;
    const failing = (o) => (/Lines2$/.test(o.endpoint) ? { ok: false, status: 503, body: {} } : answer(o));
    mp.keep(snapshot, USER, (x, at) => mp.withWork(x, JSON.parse(JSON.stringify(v.work)), at));
    const v5 = pageVars({ records: [rec] });
    await new (chain('openWorkChain', fakeActions(failing)))().run(ctx(v5), { id: '2003', keepBanner: false });
    T.check('the lines cannot be read: the saved copy, saying why', /^The lines of REQ-2003 could not be loaded \(HTTP 503\)\. Saved on this phone/.test(v5.workSaved) && !v5.workError, v5.workSaved);
  }

  T.section('ticking');
  {
    forget();
    const open = () => pageVars({ records: [rec], view: 'work', openId: '2003', work: JSON.parse(JSON.stringify(work)), check: mp.checklist(work, [], '', {}) });
    const v = open();
    const C = chain('tickChain', fakeActions(() => null));
    phone.buzzes = [];
    await new C().run(ctx(v), { lineId: '5007', source: 'tap' });
    T.eq('a tap ticks it; the single ticked order follows (Next\'s rule)', [v.ticks.join(), v.selectedTOId, v.check.ship].join('|'), '5007|92|3');
    T.eq('a tap buzzes', JSON.stringify(phone.buzzes), '[15]');
    await new C().run(ctx(v), { lineId: '5007', source: 'tap' });
    T.eq('again: unticked', [v.ticks.length, v.selectedTOId].join('|'), '0|');
    await new C().run(ctx(v), { lineId: '5001' });
    await new C().run(ctx(v), { lineId: '5005' });
    T.eq('waiting for Fusion, or shipped: cannot be ticked', v.ticks.length, 0);
    const ro = Object.assign(open(), { can: { act: false } });
    await new C().run(ctx(ro), { lineId: '5003' });
    T.eq('read-only: nothing ticked', ro.ticks.length, 0);
    phone.onLine = false;
    await new C().run(ctx(v), { lineId: '5003', checked: true });
    phone.onLine = true;
    T.eq('with no connection: kept on the phone as picked, not yet sent', JSON.stringify(mp.ticksOf(mp.read(snapshot, USER), '2003', Date.now()).ticks) + ' '
      + mp.ticksOf(mp.read(snapshot, USER), '2003', Date.now()).offline, '["5003"] true');
    await new (chain('tickAllChain', fakeActions(() => null)))().run(ctx(v), { group: 'pick' });
    T.eq('tick all being picked', v.ticks.slice().sort().join(), '5003,5004,5007');
  }

  T.section('Release (fixed assets): Next\'s call and body');
  {
    const okBatch = (o) => (o.endpoint === 'eqp-v1/patchRequestLinesBatch' ? { ok: true, body: { data: [] } } : null);
    const base = () => ({ busy: '', ticks: ['5002', '5003', '5001'], openId: '2003', banner: {}, records: [rec], linesBy: {}, items: its, view: 'work', workSaved: '',
      can: { act: true, sync: false }, work: JSON.parse(JSON.stringify(work)), sheet: 'release' });
    const NA = fakeActions(okBatch);
    const nv = base();
    await new (chain('releaseChain', NA, NEXT_CHAINS))().run(ctx(nv));
    const MA = fakeActions(okBatch);
    const v = base();
    said.length = 0;
    let invalidated = 0;
    requestData.onChange(() => { invalidated += 1; });
    await new (chain('releaseChain', MA))().run(ctx(v), {});
    T.eq('one call, as Next: PATCH lines/batch', rests(MA).join(), rests(NA).join());
    T.eq('the same body: the ticked fixed asset waiting moves to Pick initiated', JSON.stringify(MA.calls[0].body), JSON.stringify(NA.calls[0].body));
    T.eq('that body', JSON.stringify(MA.calls[0].body), JSON.stringify({ lines: [{ id: 5002, lineStatus: 'PICK_INITIATED' }] }));
    T.eq('stamped with the user, on the request', JSON.stringify([MA.calls[0].uriParams, MA.calls[0].headers]), JSON.stringify([{ requestId: 2003 }, { 'X-User-Id': 'priya.raman' }]));
    T.eq('Next\'s words', v.banner.text, nv.banner.text);
    T.eq('then the shared request list is stale, and the card is read again', [invalidated > 0, chains(MA).join()].join(), 'true,refreshRowChain');
    T.eq('released: no longer ticked (ticked again when picked)', v.ticks.join(), '5003,5001'.split(',').filter((x) => x !== '5002').join());
    T.check('a toast and the tab\'s count', said[0] === 'toast:info:1 piece of REQ-2003 released for picking.' && /^badge:pick:\d+$/.test(said[1]), said.join(' | '));
    T.eq('the sheet closes', v.sheet, '');
    phone.onLine = false;
    const OA = fakeActions(okBatch);
    said.length = 0;
    await new (chain('releaseChain', OA))().run(ctx(base()), {});
    phone.onLine = true;
    T.eq('no connection: nothing sent, said so', [OA.calls.length, said.join()].join(' '), '0 toast:warning:No connection: nothing was sent.');
    const SA = fakeActions(okBatch);
    const sv = Object.assign(base(), { workSaved: 'Saved on this phone at 10:00' });
    await new (chain('releaseChain', SA))().run(ctx(sv), {});
    T.check('a copy saved on the phone: nothing sent until it is read afresh', SA.calls.length === 0 && /copy saved on this phone/.test(sv.banner.text));
    const RA = fakeActions(okBatch);
    await new (chain('releaseChain', RA))().run(ctx(base(), { access: { EQR_INITIATE_PICKING: 'READ_ONLY' } }), {});
    T.eq('read-only: nothing sent', RA.calls.length, 0);
  }

  T.section('Pick and ship: Next\'s calls and body');
  {
    const resetServer = () => server.lines.forEach((l) => { l.lineStatus = { 5001: 'SCHEDULED_FOR_PICKING', 5002: 'SCHEDULED_FOR_PICKING', 5005: 'SHIP_TO_SITE', 5006: 'DRAFT' }[l.id] || 'PICK_INITIATED'; });
    const base = (ticks) => ({ busy: '', ticks: ticks, selectedTOId: yw.selectedTOIdFor(tos, lines, ticks), openId: '2003', banner: {}, records: [rec], items: its, view: 'work',
      workSaved: '', can: { act: true, sync: false }, work: JSON.parse(JSON.stringify(work)), sheet: 'ship' });
    resetServer();
    const NA = fakeActions(answer);
    await new (chain('shipChain', NA, NEXT_CHAINS))().run(ctx(base(['5007'])));
    const nextBody = JSON.stringify(NA.calls.filter((x) => x.endpoint === 'eqp-v1/patchRequestLinesBatch')[0].body);
    resetServer();
    const MA = fakeActions(answer);
    const v = Object.assign(base(['5007']), { sheetData: mp.shipSheet(work, ['5007'], '92') });
    said.length = 0;
    await new (chain('shipChain', MA))().run(ctx(v), {});
    const r = rests(MA);
    T.eq('first the live statuses, then one batch (as Next)', r.slice(0, 2).map((x) => x.split('{')[0]).join(' > '), 'getEquipriteV1EquipmentRequestsRequestIdLines2 > patchRequestLinesBatch');
    T.eq('the same body as Next: the ticked order\'s piece and the fixed assets being picked', JSON.stringify(MA.calls.filter((x) => x.endpoint === 'eqp-v1/patchRequestLinesBatch')[0].body), nextBody);
    T.eq('that body', nextBody, JSON.stringify({ lines: [{ id: 5007, lineStatus: 'SHIP_TO_SITE' }, { id: 5003, lineStatus: 'SHIP_TO_SITE' }, { id: 5004, lineStatus: 'SHIP_TO_SITE' }] }));
    T.check('no write but the batch (New\'s asset step reads only, here with nothing to move)',
      MA.calls.filter((x) => x.endpoint && !/\/get/.test('/' + x.endpoint.replace('eqp-v1/', '')) && x.endpoint !== 'eqp-v1/patchRequestLinesBatch').length === 0);
    T.eq('then, as Next: the pick list read again, the card; then back to the list', chains(MA).join(), 'openWorkChain,refreshRowChain,closeWorkChain');
    T.eq('said: how many, of which request, to whom; the count left', said[0] + ' | ' + said[1].split(':').slice(0, 2).join(':'),
      'toast:info:3 pieces of REQ-2003 shipped to EPC_MO_Operations. | badge:pick');
    T.eq('Next\'s words in the banner', v.banner.text, '3 pieces marked shipped to site.');

    resetServer();
    const XA = fakeActions(answer);
    const xv = Object.assign(base(['5003']), { sheetData: { kind: 'ship', ids: ['5003', '5004'] } });
    await new (chain('shipChain', XA))().run(ctx(xv), {});
    T.eq('the server would ship more than the sheet said: nothing written, read again', [rests(XA).length, chains(XA).join()].join(' '), '1 openWorkChain');
    T.check('and it says so', /have changed since it was opened \(the server would ship 3 pieces, the sheet said 2\)/.test(xv.banner.text), xv.banner.text);

    phone.onLine = false;
    const OA = fakeActions(answer);
    said.length = 0;
    await new (chain('shipChain', OA))().run(ctx(base(['5003'])), {});
    phone.onLine = true;
    T.eq('no connection: nothing asked or sent, said so', [OA.calls.length, said.join()].join(' '), '0 toast:warning:No connection: nothing was sent.');
    const SA = fakeActions(answer);
    await new (chain('shipChain', SA))().run(ctx(Object.assign(base(['5003']), { workSaved: 'Saved on this phone at 10:00' })), {});
    T.eq('a copy saved on the phone: nothing sent', SA.calls.length, 0);

    resetServer();
    server.lines.filter((l) => l.id === 5003)[0].isMaintenanceTracked = 'Y';
    const FA = fakeActions(answer);
    const fv = base(['5003']);
    await new (chain('shipChain', FA))().run(ctx(fv, { flags: { MAINT_ASSET_LOCATION_SYNC_ENABLED: 'true' } }), {});
    server.lines.filter((l) => l.id === 5003)[0].isMaintenanceTracked = 'N';
    T.eq('asset sync on and a fixed asset would move in Fusion: only the read (Next\'s guard)', rests(FA).map((x) => x.split('{')[0]).join(), 'getEquipriteV1EquipmentRequestsRequestIdLines2');
    T.check('it says why and where', /Nothing was shipped/.test(fv.banner.text) && /New EquipRite/.test(fv.banner.text));
    const RA = fakeActions(answer);
    await new (chain('shipChain', RA))().run(ctx(base(['5003']), { access: { EQR_INITIATE_PICKING: 'READ_ONLY' } }), {});
    T.eq('read-only: nothing sent', RA.calls.length, 0);
  }

  T.section('the Ship sheet opens only where Next\'s Pick and ship is live');
  {
    const v = pageVars({ view: 'work', openId: '2003', work: JSON.parse(JSON.stringify(work)), ticks: ['5003'], check: mp.checklist(work, ['5003'], '', {}) });
    await new (chain('sheetChain', fakeActions(() => null)))().run(ctx(v), { sheet: 'ship' });
    T.eq('it says what will happen', [v.sheet, v.sheetData.title].join(' | '), 'ship | Ship 3 pieces of REQ-2003 to EPC_MO_Operations');
    const ro = Object.assign(pageVars(), { can: { act: false }, check: { canShip: true } });
    await new (chain('sheetChain', fakeActions(() => null)))().run(ctx(ro), { sheet: 'ship' });
    T.eq('read-only: no sheet', ro.sheet, '');
    const none = Object.assign(pageVars(), { check: { canShip: false } });
    await new (chain('sheetChain', fakeActions(() => null)))().run(ctx(none), { sheet: 'ship' });
    T.eq('nothing to ship: no sheet', none.sheet, '');
  }

  T.section('scan to tick');
  {
    const v = pageVars({ view: 'work', openId: '2003', work: JSON.parse(JSON.stringify(work)), items: items });
    const A = fakeActions(() => null);
    phone.buzzes = [];
    await new (chain('scanHitChain', A))().run(ctx(v), { value: 'lt-0042', source: 'typed', key: 'Enter' });
    T.eq('a typed unit on the request: ticked through tickChain (a tap\'s rules)', JSON.stringify(A.calls.map((x) => [x.chain, x.params])),
      JSON.stringify([['tickChain', { lineId: '5004', checked: true, source: 'scan' }]]));
    T.eq('said, lit, buzzed', [v.scan.last.title, v.flash, JSON.stringify(phone.buzzes)].join(' | '), 'Picked: Light tower · LT-0042 | 5004 | [45]');
    await new (chain('scanHitChain', A))().run(ctx(v), { value: 'LT', source: 'typed', key: 'L' });
    T.eq('typing, not Enter: nothing yet', A.calls.length, 1);
    phone.buzzes = [];
    await new (chain('scanHitChain', A))().run(ctx(v), { value: 'XX-9', source: 'typed' });
    T.eq('not on the request: said, two buzzes, nothing ticked', [v.scan.last.title, JSON.stringify(phone.buzzes), A.calls.length].join(' | '), 'XX-9 is not on REQ-2003 | [[90,60,90]] | 1');
    const L = pageVars({ view: 'list', items: items, units: { 7101: ['TR-0450'] } });
    const LA = fakeActions(() => null);
    const S = chain('scanHitChain', LA);
    await new S().run(ctx(L), { value: 'TR-0450', source: 'camera' });
    T.eq('scanned on the list: its request opens first', JSON.stringify(LA.calls[0]), JSON.stringify({ chain: 'openWorkChain', params: { id: '2007', keepBanner: false } }));
    await new S().run(ctx(L), { value: 'tr-0450', source: 'camera' });
    T.eq('the camera seeing the same tag again at once: one read', LA.calls.length, 1);
  }

  T.section('focus: from My requests or a deep link');
  {
    const v = pageVars({ records: records });
    focusWant = { number: 'REQ-2007' };
    const A = fakeActions(() => null);
    await new (chain('focusChain', A))().run(ctx(v));
    T.eq('by number: its pick list opens', JSON.stringify(A.calls[0]), JSON.stringify({ chain: 'openWorkChain', params: { id: '2007', keepBanner: false } }));
    focusWant = { id: 2003, number: 'REQ-2003' };
    const B = fakeActions(() => null);
    await new (chain('focusChain', B))().run(ctx(v));
    T.eq('by id', B.calls[0].params.id, '2003');
    focusWant = { number: 'REQ-9' };
    said.length = 0;
    await new (chain('focusChain', fakeActions(() => null)))().run(ctx(v));
    T.eq('not waiting at the yard: said', said[0], 'toast:info:REQ-9 has nothing waiting at the yard to pick or ship.');
    let taken = 0;
    bus.takeFocus = () => { taken += 1; return null; };
    await new (chain('focusChain', fakeActions(() => null)))().run(ctx(pageVars({ isLoading: true })));
    T.eq('still loading: left for the load to take', taken, 0);
  }

  T.section('loading today\'s work');
  {
    forget();
    const A = fakeActions(answer);
    const v = pageVars({ records: [], items: [] });
    await new (chain('loadChain', A))().run(ctx(v), { refresh: false });
    T.eq('Next\'s reads: the queue, then each request\'s lines', rests(A).map((x) => x.split('{')[0]).join(' > '),
      'getEquipriteV1ViewsWorkbenchRequests > getEquipriteV1ViewsRequestDetailLines > getEquipriteV1ViewsRequestDetailLines');
    T.eq('the INITIATE queue', JSON.stringify(A.calls[0].uriParams), JSON.stringify({ stage: 'INITIATE', size: 1000 }));
    T.eq('then the list, the yards, a focus; the steps loaded for no connection', chains(A).slice(0, 3).join(), 'applyChain,lookupYardsChain,focusChain');
    T.check('the steps a person may take offline are loaded once (each returns at once)', chains(A).indexOf('shipChain') !== -1 && chains(A).indexOf('tickChain') !== -1);
    T.eq('what the access allows', JSON.stringify(v.can), JSON.stringify({ act: true, slip: false, sync: false, known: true }));
    T.check('kept on the phone', mp.read(snapshot, USER).list.records.length === 2);
    mp.keep(snapshot, USER, (x) => mp.withYard(x, 'Houston Yard'));
    phone.onLine = false;
    const O = fakeActions(answer);
    const ov = pageVars({ records: [], items: [] });
    await new (chain('loadChain', O))().run(ctx(ov, { access: { EQR_INITIATE_PICKING: 'READ_ONLY' } }), { refresh: true });
    phone.onLine = true;
    T.eq('no connection: nothing asked', rests(O).length, 0);
    T.check('the list this phone saved, saying when', ov.records.length === 2 && /^Saved on this phone at \d\d:\d\d$/.test(ov.saved), ov.saved);
    T.eq('the yard this person chose', ov.yard, 'Houston Yard');
    T.eq('read-only: no steps', ov.can.act, false);
    forget();
    phone.onLine = false;
    const ev = pageVars({ records: [], items: [] });
    await new (chain('loadChain', fakeActions(answer)))().run(ctx(ev), { refresh: true });
    phone.onLine = true;
    T.eq('no copy either: said', ev.error, 'What has to go out could not be loaded: No connection.');
  }

  T.section('the yard lookups keep the units they read');
  {
    const A = fakeActions(answer);
    const v = pageVars({ records: records, items: its, yards: {}, loadToken: 4 });
    await new (chain('lookupYardsChain', A))().run(ctx(v), { token: 4 });
    T.check('Next\'s calls: line-detail-units per line still in the yard', rests(A).every((x) => /^getEquipriteV1ViewsLineDetailUnits/.test(x)) && rests(A).length === 4, rests(A).join());
    T.eq('yards and units', [v.yards[5003], (v.units[5003] || []).join(), v.yardsLoading].join(), 'Houston Yard,GN-0412,false');
  }

  T.section('back online');
  {
    forget();
    mp.keep(snapshot, USER, (x, at) => mp.withTicks(x, '2003', 'REQ-2003', ['5003', '5004'], true, at));
    const v = pageVars({ view: 'work', openId: '2003', work: JSON.parse(JSON.stringify(work)) });
    const A = fakeActions(() => null);
    await new (chain('connectionChain', A))().run(ctx(v), { online: true });
    T.eq('the ticks made with no connection are pointed out; nothing sent', [v.banner.text, A.calls.filter((x) => x.endpoint).length].join(' | '),
      'Back online. 2 pieces ticked with no connection are kept on this phone: nothing was sent. Check them, then ship. | 0');
    const s = pageVars({ saved: 'Saved on this phone at 08:00', view: 'work', openId: '2003', workSaved: 'x', work: JSON.parse(JSON.stringify(work)) });
    const B = fakeActions(() => null);
    await new (chain('connectionChain', B))().run(ctx(s), { online: true });
    T.eq('a saved copy is read again', chains(B).join(), 'loadChain,openWorkChain');
    const off = pageVars();
    await new (chain('connectionChain', fakeActions(() => null)))().run(ctx(off), { online: false });
    T.eq('gone: noted', off.online, false);
  }

  T.section('the pick slip (Next\'s, made from the pick list)');
  {
    const v = pageVars({ view: 'work', openId: '2003', work: JSON.parse(JSON.stringify(work)), check: mp.checklist(work, [], '', {}) });
    await new (chain('pickSlipChain', fakeActions(() => null)))().run(ctx(v), { action: 'make' });
    T.eq('made, then its sheet', [v.slip.fileName, v.slip.rows, v.sheet].join(' | '), 'pick-slip-REQ-2003.pdf | 4 | slip');
    said.length = 0;
    await new (chain('pickSlipChain', fakeActions(() => null)))().run(ctx(v), { action: 'download' });
    T.eq('downloaded', said[0], 'toast:info:Pick slip PS-1 downloaded.');
    await new (chain('pickSlipChain', fakeActions(() => null)))().run(ctx(v), { action: 'close' });
    T.eq('closed: freed', [v.slip.url, v.sheet].join('|'), '|');
    const off = pageVars({ view: 'work', work: JSON.parse(JSON.stringify(work)), check: mp.checklist(work, [], '', {}), can: { act: true, slip: false } });
    await new (chain('pickSlipChain', fakeActions(() => null)))().run(ctx(off), { action: 'make' });
    T.eq('shipping documents off: no slip (Next\'s gate)', off.slip.url, '');
    const saved = pageVars({ view: 'work', work: JSON.parse(JSON.stringify(work)), check: mp.checklist(work, [], '', {}), workSaved: 'Saved on this phone at 10:00' });
    await new (chain('pickSlipChain', fakeActions(() => null)))().run(ctx(saved), { action: 'make' });
    T.check('not from a copy saved on the phone', !saved.slip.url && /fresh read/.test(saved.banner.text));
  }

  T.section('the page');
  const pageJson = JSON.parse(fs.readFileSync(path.join(APP, 'flows', 'pick', 'pages', 'pick-page.json'), 'utf8'));
  T.eq('embeddable in the shell', pageJson.navigation.embeddable, 'enabled');
  T.check('a focusRequest event, fired from the page module', !!pageJson.events.focusRequest
    && /bus\.onFocus\('pick'/.test(fs.readFileSync(path.join(APP, 'flows', 'pick', 'pages', 'pick-page.js'), 'utf8')));
  const html = fs.readFileSync(path.join(APP, 'flows', 'pick', 'pages', 'pick-page.html'), 'utf8');
  T.check('steps that write are offered with full access only', /\$variables\.can\.act && !\$variables\.workLoading/.test(html) && /id="pkShipGo"/.test(html));
  const css = fs.readFileSync(path.join(APP, 'resources', 'css', 'mobile-pick.css'), 'utf8');
  T.eq('its styles are .mb-pick-* (and the shared parts)', (css.match(/^\.[a-z-]+/gm) || []).filter((s) => !/^\.mb-pick/.test(s)).join(), '');
  T.eq('colours from mobile.css\'s tokens, no new hex in the ring', /conic-gradient\(var\(--mb-ok\)/.test(fs.readFileSync(path.join(JS, 'mobilePick.js'), 'utf8')), true);

  T.report();
})().catch((e) => {
  T.check('run finished', false, e && e.stack);
  T.report();
});
