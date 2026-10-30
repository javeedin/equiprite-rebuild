/*
 * EquipRite Next, the yard (Picking & shipping, Receiving & returns): the list logic (resources/js/yardWork.js), the
 * yard rule, the picking ticks and transfer orders (New's rules), which steps would write to Fusion, and the request
 * bodies the yard's chains send, run against a fake Actions. Loads the real modules.
 *
 * Run:  node tests/next-yard.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const NEXT = path.join(__dirname, '..', 'webApps', 'equiprite-next');
const JS = path.join(NEXT, 'resources', 'js');
const PAGES = path.join(NEXT, 'flows', 'yard', 'pages');

function loadFile(file, deps, extra) {
  const sandbox = Object.assign({ console: { log() {}, warn() {}, error() {}, info() {} }, TextEncoder, URLSearchParams, Intl, Date, setTimeout,
    Promise, Object, Map, Set, Array, JSON, Math, String, Number, Boolean, encodeURIComponent, window: {}, document: { getElementById: () => null, querySelector: () => null } }, extra || {});
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
const nav = load('nav', { 'resources/js/rules': rules });
const kit = load('exportKit');
const requestData = load('requestData', { 'resources/js/rules': rules });
const rdl = load('requestDetailLines');
const yw = load('yardWork', { 'resources/js/requestProgress': Progress, 'resources/js/requestData': requestData,
  'resources/js/requestDetailLines': rdl, 'resources/js/fmt': fmt });
const lineBody = load('requestLineBody');
const cu = load('currentUser');
const rl = load('returnLeg');
const dr = load('directReturn');
const mal = load('maintAssetLocation');
const pickSlip = load('pickSlip', { jspdf: { jsPDF: function () {} } });

const NOW = Date.UTC(2026, 9, 30, 9, 0, 0);
const d = (n) => new Date(NOW + n * 86400000).toISOString().slice(0, 10);

// ── Copied helpers are New's, unchanged ──────────────────────────────────────────────────────────────────────────
T.section('helpers copied from New EquipRite, unchanged');
['pickSlip', 'requestLineBody', 'requestDetailLines', 'maintAssetLocation', 'directReturn', 'returnLeg', 'unitScanner', 'currentUser'].forEach((m) => {
  const a = fs.readFileSync(path.join(JS, m + '.js'), 'utf8');
  const b = fs.readFileSync(path.join(__dirname, '..', 'webApps', 'equiprite', 'resources', 'js', m + '.js'), 'utf8');
  T.check(m + '.js is identical to New\'s', a === b);
});

// ── Menu ─────────────────────────────────────────────────────────────────────────────────────────────────────────
T.section('menu');
T.eq('Picking & shipping is built, in the yard flow', JSON.stringify(nav.routeOf(nav.item('picking'))), '{"flow":"yard","page":"picking","params":{}}');
T.eq('Receiving & returns is built, in the yard flow', JSON.stringify(nav.routeOf(nav.item('returns'))), '{"flow":"yard","page":"returns","params":{}}');
T.eq('their screens in New EquipRite', [nav.newUrl('http://n/', 'picking'), nav.newUrl('http://n', 'returns')].join(' '),
  'http://n/vp/shell/logistics/picking http://n/vp/shell/logistics/receipt');
const flow = JSON.parse(fs.readFileSync(path.join(NEXT, 'flows', 'yard', 'yard-flow.json'), 'utf8'));
T.check('the flow and its pages can be shown in a tab', flow.navigation.embeddable === 'enabled'
  && ['picking', 'returns'].every((p) => JSON.parse(fs.readFileSync(path.join(PAGES, p + '-page.json'), 'utf8')).navigation.embeddable === 'enabled'));
['picking', 'returns'].forEach((p) => {
  const page = JSON.parse(fs.readFileSync(path.join(PAGES, p + '-page.json'), 'utf8'));
  const named = [];
  Object.values(page.eventListeners).forEach((l) => l.chains.forEach((c) => named.push(c.chain)));
  const missing = named.filter((c) => !fs.existsSync(path.join(PAGES, p + '-page-chains', c + '.js')));
  T.eq(p + ': every chain the page names exists', missing.join(), '');
  const html = fs.readFileSync(path.join(PAGES, p + '-page.html'), 'utf8');
  const bindings = html.match(/\[\[[\s\S]*?\]\]/g) || [];
  T.eq(p + ': no arrow functions or String/Number/Boolean in bindings', bindings.filter((b) => /=>|\bString\(|\bNumber\(|\bBoolean\(/.test(b)).join(' '), '');
  T.check(p + ': no for-each inside a select or table', !/<(select|table|tbody)[^>]*>[\s\S]*?oj-bind-for-each[\s\S]*?<\/\1>/.test(html));
});
const appFlow = JSON.parse(fs.readFileSync(path.join(NEXT, 'app-flow.json'), 'utf8'));
T.check('the stylesheet is imported', appFlow.imports.css.indexOf('resources/css/next-yard.css') !== -1);

// ── Queues ───────────────────────────────────────────────────────────────────────────────────────────────────────
T.section('the queues (New\'s calls and mapping)');
T.eq('picking: views/workbench-requests?stage=INITIATE&size=1000', JSON.stringify(yw.QUEUE.picking), '{"endpoint":"eqp-v1/getEquipriteV1ViewsWorkbenchRequests","uriParams":{"stage":"INITIATE","size":1000}}');
T.eq('returns: stage=RETURN', yw.QUEUE.returns.uriParams.stage, 'RETURN');
const q = yw.queueRows([
  { eqrEquipmentRequestId: 501, requestNumber: 'REQ-1', source: 'INTERNAL', projectName: 'P', customerName: 'X', requestor: 'J', contactName: 'K', taskName: 'T1',
    requestedStartDate: d(-3) + 'T00:00:00Z', requestedEndDate: d(20) + 'T00:00:00Z', location: 'Pier A' },
  { eqrEquipmentRequestId: 501, requestNumber: 'REQ-1', projectName: 'second row of the same request' },
  { eqrEquipmentRequestId: 503, requestNumber: 'REQ-3', source: 'EXTERNAL', customerName: 'Gulf', projectName: 'P3', contactName: 'Dana', requestor: 'R', taskName: 'T3',
    requestedStartDate: d(5), requestedEndDate: d(60) },
  { eqrEquipmentRequestId: 502, requestNumber: 'REQ-2', source: 'CUSTOMER', customerName: 'Lone Star', requestedStartDate: d(0) },
], rules.isExternalSource);
T.eq('one row per request (first row wins), newest first', q.map((r) => r.id).join(), '503,502,501');
T.eq('a project request: project, task, requestor', [q[2].party, q[2].task, q[2].requestor, q[2].start, q[2].location].join('|'), 'P|T1|J|' + d(-3) + '|Pier A');
T.eq('a customer request (EXTERNAL or legacy CUSTOMER): customer and contact, no task', [q[0].party, q[0].task, q[0].requestor, q[0].isCustomer, q[1].isCustomer].join('|'), 'Gulf||Dana|true|true');

// ── Pieces and the list ──────────────────────────────────────────────────────────────────────────────────────────
const L = (lineId, status, extra) => Object.assign({ lineId, lineStatus: status, equipmentName: 'Eq ' + lineId, className: 'C', quantity: 1, isTransactable: 'Y' }, extra || {});
const pickLines = {
  501: [L(1, 'SCHEDULED_FOR_PICKING', { toNumber: 'TO-1', allocatedSerial: 'EX-1' }), L(2, 'SCHEDULED_FOR_PICKING', { isTransactable: 'N' }),
    L(3, 'PICK_INITIATED', { startDate: d(2) }), L(4, 'DRAFT'), L(5, 'SHIP_TO_SITE')],
  502: [L(6, 'PICK_RELEASED')],
  503: [L(7, 'EQP_INSPECTION_COMPLETE'), L(8, 'SHIP_TO_SITE')],
};
T.section('pieces: where each is in the yard\'s work');
const pc = yw.piece(L(9, 'scheduled_for_picking', { endDate: d(9) }), q[2], 'picking', NOW);
T.eq('a piece: stage, words from requestProgress, late days, the line\'s own date else the request\'s', [pc.stage, pc.label, pc.late, pc.start, pc.end].join('|'),
  'pick|Waiting to be picked|3|' + d(-3) + '|' + d(9));
T.eq('outbound stages', ['SCHEDULED_FOR_PICKING', 'PICK_INITIATED', 'PICK_RELEASED', 'EQP_INSPECTION_COMPLETE', 'SHIP_TO_SITE', 'ALLOCATED', 'DEPLOYED']
  .map((s) => yw.OUT[s] || '-').join(), 'pick,picking,picking,ship,shipped,-,-');
T.eq('inbound stages', ['DEPLOYED', 'RETURN_INITIATED', 'RETURN_IN_PROCESS', 'SHIPPED_TO_YARD', 'CLOSED', 'CONSUMED', 'SHIP_TO_SITE']
  .map((s) => yw.IN[s] || '-').join(), 'site,requested,transit,receive,done,done,-');
T.check('a fixed asset is read with New\'s rule (fulfilmentClass, else isTransactable)', yw.piece(L(1, 'X', { isTransactable: 'N' }), q[2], 'picking', NOW).fm === true
  && yw.piece(L(1, 'X', { fulfilmentClass: 'S_AND_T', isTransactable: 'N' }), q[2], 'picking', NOW).fm === false);

T.section('Picking & shipping: the list');
const items = yw.items('picking', q, pickLines, { 1: 'Houston Yard', 2: '', 3: 'Atlanta Yard', 6: 'Atlanta Yard' }, NOW, { finding: false });
const byId = (id) => items.filter((i) => i.id === String(id))[0];
T.eq('sections by the day it is needed, late first', yw.sections('picking', items).map((s) => s.key + ':' + s.items.map((i) => i.requestNumber).join('+')).join(' '),
  'late:REQ-1 today:REQ-2 week:REQ-3');
T.eq('a late request: how late, pieces, other lines left out', [JSON.stringify(byId(501).when), byId(501).summary, byId(501).otherCount].join(' | '),
  '{"main":"3 days late","sub":"needed 27 Oct 2026"} | 2 to pick · 1 being picked · 1 shipped | 1');
T.eq('its yards: recorded ones, "Not recorded" for a line with none', byId(501).yardText, 'Houston Yard, Not recorded, Atlanta Yard');
T.eq('next: a transfer-order release is New\'s (Fusion)', JSON.stringify(byId(501).next),
  '{"text":"Release 2 pieces for picking","where":"new","note":"Transfer order release is a Fusion step: in New EquipRite"}');
T.eq('next: released in Fusion, then inspected: ship confirm in Fusion', [byId(502).next.text, byId(502).next.where, byId(503).next.text, byId(503).next.where].join(' | '),
  'Pick on Oracle mobile, then inspect or ship confirm | fusion | Ship confirm 1 piece | fusion');
const fmOnly = yw.items('picking', [q[2]], { 501: [L(2, 'SCHEDULED_FOR_PICKING', { isTransactable: 'N' })] }, {}, NOW)[0];
T.eq('next: a fixed asset is released here', [fmOnly.next.text, fmOnly.next.where].join(' | '), 'Release 1 piece for picking | here');
const shipNext = yw.items('picking', [q[2]], { 501: [L(3, 'PICK_INITIATED')] }, {}, NOW)[0];
T.eq('next: Pick and ship here', [shipNext.next.text, shipNext.next.where].join(' | '), 'Pick and ship 1 piece | here');
T.eq('when: today, a weekday, no date', [byId(502).when.main, byId(503).when.main, yw.items('picking', [Object.assign({}, q[1], { start: '' })], { 502: [L(6, 'PICK_RELEASED')] }, {}, NOW)[0].when.main].join(' | '),
  'Today | Wed 4 Nov | No date');
T.eq('a request whose lines failed stays, in a section of its own (never late on a guess)', (() => {
  const x = yw.items('picking', [q[2]], { 501: null }, {}, NOW)[0]; return [x.section, x.loaded, x.late, x.summary].join(' | '); })(),
  'other | false | 0 | Lines could not be loaded: open it to retry');
T.eq('a request with nothing at a picking step yet says what it waits for', (() => {
  const x = yw.items('picking', [q[2]], { 501: [L(1, 'ALLOCATED'), L(2, 'IN_PROCESS')] }, {}, NOW)[0]; return [x.section, x.summary, x.next.text, x.next.note].join(' | '); })(),
  'other | Nothing scheduled for picking yet | Unit assigned | Equipment Manager to confirm it for picking');
T.eq('stage tiles: pieces and requests', yw.tiles('picking', items).map((t) => t.key + ':' + t.count + '/' + t.requests).join(' '),
  'late:2/1 pick:2/1 picking:2/2 ship:1/1 shipped:2/2');
T.eq('the summary', yw.summary('picking', items), '5 pieces to get out on 3 requests · 2 late · 1 needed today');
T.eq('yards to filter by (Not recorded last)', yw.yardOptions(items).map((y) => y.key + ':' + y.count).join(), 'all:3,Atlanta Yard:2,Houston Yard:1,Not recorded:1');
T.eq('filter: a yard', yw.filter(items, { yard: 'Atlanta Yard' }).map((i) => i.id).join(), '502,501');
T.eq('filter: a stage', yw.filter(items, { stage: 'ship' }).map((i) => i.id).join(), '503');
T.eq('filter: late', yw.filter(items, { stage: 'late' }).map((i) => i.id).join(), '501');
T.eq('filter: search by equipment, serial or transfer order', [yw.filter(items, { text: 'ex-1' }), yw.filter(items, { text: 'to-1' }), yw.filter(items, { text: 'eq 7' })]
  .map((l) => l.map((i) => i.id).join()).join(' | '), '501 | 501 | 503');
T.eq('export: the shown pieces at the stage and yard', yw.shownPieces(items, { yard: 'Atlanta Yard' }).map((p) => p.lineId).join(), '6,3');
T.eq('a hidden section keeps its count', JSON.stringify(yw.sections('picking', items, { week: true }).filter((s) => s.key === 'week').map((s) => [s.count, s.items.length, s.collapsed])),
  '[[1,0,true]]');
const pending = yw.items('picking', q, pickLines, {}, NOW, { finding: true });
T.eq('yards still being found', [pending[0].yardText, yw.items('picking', q, pickLines, {}, NOW, { finding: false })[0].yardText].join(' | '), 'Finding… | Open it to see');
T.eq('yard lookups: urgent sections first, not for what has shipped or is known', yw.yardLookups(items, { 1: 'H', 2: '', 3: 'A', 6: 'A' }).map((x) => x.lineId).join(), '7');
T.eq('yard lookups from nothing known', yw.yardLookups(items, {}).map((x) => x.requestId + ':' + x.lineId).join(), '501:1,501:2,501:3,502:6,503:7');

T.section('Receiving & returns: the list');
const retLines = {
  501: [L(11, 'SHIPPED_TO_YARD'), L(12, 'RETURN_IN_PROCESS', { inboundToNumber: 'TO-9' }), L(13, 'DEPLOYED', { endDate: d(-10) })],
  502: [L(14, 'RETURN_INITIATED', { isTransactable: 'N' })],
  503: [L(15, 'DEPLOYED', { endDate: d(30) }), L(16, 'CLOSED')],
};
const ritems = yw.items('returns', q, retLines, {}, NOW);
const rById = (id) => ritems.filter((i) => i.id === String(id))[0];
T.eq('sections: overdue first, then the yard\'s job', yw.sections('returns', ritems).map((s) => s.key + ':' + s.items.map((i) => i.id).join('+')).join(' '),
  'overdue:501 requested:502 later:503');
T.eq('overdue: how much, its pieces, receive comes next', [rById(501).when.main, rById(501).summary, rById(501).next.text].join(' | '),
  '10 days overdue | 1 to receive · 1 on the way back · 1 on site | Receive 1 piece at the yard');
T.eq('a fixed asset with its return asked for is recorded here when back', [rById(502).next.text, rById(502).next.where].join(' | '), 'Record the return when it is back (1) | here');
const stockReq = yw.items('returns', [q[1]], { 502: [L(14, 'RETURN_INITIATED')] }, {}, NOW)[0];
T.eq('a stock return needs a return transfer order: New', [stockReq.next.text, stockReq.next.where].join(' | '), 'Raise the return transfer order (1) | new');
T.eq('on site and not due: when it is due back', rById(503).next.text, 'Due back Sun 29 Nov');
const transitOnly = yw.items('returns', [q[1]], { 502: [L(12, 'RETURN_IN_PROCESS')] }, {}, NOW)[0];
T.eq('on the way back', [transitOnly.section, transitOnly.next.text].join(' | '), 'transit | 1 piece coming back');
const overdueReq = yw.items('returns', [q[2]], { 501: [L(13, 'DEPLOYED', { endDate: d(-10) })] }, {}, NOW)[0];
T.eq('overdue and nothing in return: the requester starts it', overdueReq.next.text, 'J to start the return');
T.eq('due within a week', yw.items('returns', [q[2]], { 501: [L(13, 'DEPLOYED', { endDate: d(4) })] }, {}, NOW)[0].section, 'week');
T.eq('the summary', yw.summary('returns', ritems), '5 pieces out or coming back on 3 requests · 1 overdue · 1 to receive');
T.eq('stage tiles', yw.tiles('returns', ritems).map((t) => t.key + ':' + t.count).join(' '), 'late:1 receive:1 requested:1 transit:1 site:2');
T.eq('yard lookups skip closed lines', yw.yardLookups(ritems, {}).map((x) => x.lineId).join(), '11,12,13,14,15');

// ── The yard rule ────────────────────────────────────────────────────────────────────────────────────────────────
T.section('the yard a line ships from (New\'s rule)');
T.eq('MANUAL: the yard recorded on its allocations', yw.yardOfUnits([{ allocationId: 1, allocationMethod: 'MANUAL', sourceInvOrgName: 'Houston Yard', invOrgName: 'Somewhere' }]), 'Houston Yard');
T.eq('MANUAL: else the line\'s own stamp', yw.yardOfUnits([{ allocationId: 1, lineSourceInvOrgName: 'Atlanta Yard' }]), 'Atlanta Yard');
T.eq('AUTO: the line\'s stamp (no allocation rows)', yw.yardOfUnits([{ allocationMethod: 'AUTO', lineSourceInvOrgName: 'Atlanta Yard', allocationId: null }]), 'Atlanta Yard');
T.eq('two yards for one line', yw.yardOfUnits([{ allocationId: 1, sourceInvOrgName: 'A' }, { allocationId: 2, sourceInvOrgName: 'B' }, { allocationId: 3, sourceInvOrgName: 'A' }]), 'A, B');
T.eq('never a guess from where a unit sits now', yw.yardOfUnits([{ allocationId: null, invOrgName: 'Current Yard' }]), '');

// ── Picking: ticks and transfer orders ───────────────────────────────────────────────────────────────────────────
T.section('picking: ticks and transfer orders (New\'s rules)');
const wl = [
  { lineId: '1', toNumber: 'TO-A', lineStatus: 'SCHEDULED_FOR_PICKING', isFAndM: false },
  { lineId: '2', toNumber: 'TO-A', lineStatus: 'PICK_INITIATED', isFAndM: false },
  { lineId: '3', toNumber: 'TO-B', lineStatus: 'PICK_INITIATED', isFAndM: false },
  { lineId: '4', toNumber: '', lineStatus: 'PICK_INITIATED', isFAndM: true },
  { lineId: '5', toNumber: '', lineStatus: 'SCHEDULED_FOR_PICKING', isFAndM: true },
  { lineId: '6', toNumber: '', lineStatus: 'ALLOCATED', isFAndM: true },
];
const tos = [{ value: '91', orderNumber: 'TO-A', released: false }, { value: '92', orderNumber: 'TO-B', released: true }];
T.eq('an order\'s lines (what opens ticked)', yw.ticksForOrder(wl, 'TO-A').join(), '1,2');
T.eq('the single ticked order, or none', [yw.selectedTOIdFor(tos, wl, ['1', '2']), yw.selectedTOIdFor(tos, wl, ['1', '3']), yw.selectedTOIdFor(tos, wl, ['4'])].join('|'), '91||');
T.eq('releasable orders: ticked and not released', yw.releasableTOOptions(tos, wl, ['1', '3']).map((t) => t.orderNumber).join(), 'TO-A');
T.eq('fixed assets to release here: ticked, scheduled or allocated', yw.fmToRelease(wl, ['4', '5', '6', '1']).map((l) => l.lineId).join(), '5,6');
T.eq('stock waiting for release (New, Fusion)', yw.stockToRelease(wl).map((l) => l.lineId).join(), '1');
T.check('ship: an unreleased order cannot ship; a released one with picked lines can', !yw.canShip(tos, '91', wl.slice(0, 3), ['1', '2'])
  && yw.canShip(tos, '92', wl.slice(0, 3), ['3']));
T.check('ship: a picked fixed asset can always ship', yw.canShip(tos, '', wl, ['4']));
T.eq('ship set: the ticked order\'s picked lines', yw.shipLines(tos, '92', wl, ['3']).map((l) => l.lineId).join(), '3,4');
T.eq('ship set: the ticked fixed assets only', yw.shipLines(tos, '92', wl, ['3', '5']).map((l) => l.lineId).join(), '3');
T.eq('ship set: no single order: every picked line', yw.shipLines(tos, '', wl, []).map((l) => l.lineId).join(), '2,3,4');
T.eq('toggle a tick and every tick', [yw.toggleTick(['1'], '2', true).join(), yw.toggleTick(['1', '2'], 1, false).join(), yw.toggleAll(wl, ['1']).length, yw.toggleAll(wl, wl.map((l) => l.lineId)).length].join('|'),
  '1,2|2|6|0');

T.section('which steps write to Fusion');
const srv = [{ id: 4, isMaintenanceTracked: 'Y', isTransactable: 'N' }, { id: 7, isMaintenanceTracked: 'Y', isTransactable: 'Y' },
  { id: 8, isMaintenanceTracked: 'N', isTransactable: 'N' }, { id: 9, isMaintenanceTracked: 'Y' }];
T.eq('asset sync off: Pick and ship writes nothing to Fusion', yw.fusionRelocations(false, srv).length, 0);
T.eq('asset sync on: maintenance tracked and not transactable (the gate of maintAssetLocation)', yw.fusionRelocations(true, srv).map((l) => l.id).join(), '4');

T.section('receiving');
const rl8 = [{ lineId: '1', lineStatus: 'SHIPPED_TO_YARD' }, { lineId: '2', lineStatus: 'RETURN_IN_PROCESS' }];
T.eq('only lines shipped back to the yard are received', yw.toReceive(rl8, ['1', '2']).map((l) => l.lineId).join(), '1');
T.eq('the header box ticks only those', yw.toggleAll(rl8, [], yw.isReceivable).join(), '1');
T.check('a return is recorded here only when every ticked unit is a fixed asset', yw.allFixedAssets([{ fulfilmentClass: 'F_AND_M' }])
  && !yw.allFixedAssets([{ fulfilmentClass: 'F_AND_M' }, { fulfilmentClass: 'S_AND_T' }]) && !yw.allFixedAssets([{ fulfilmentClass: null }]) && !yw.allFixedAssets([]));

T.section('export');
const csv = kit.csv(yw.shownPieces(items, {}), yw.exportColumns('picking'));
T.check('the picking export: a row per piece, the columns a person wants', csv.split('\r\n')[0].includes('Needed by,Days late,Request,Type,Project or customer,Task,Deliver to,Equipment')
  && csv.split('\r\n').filter(Boolean).length === 8);
T.check('the returns export', kit.csv(yw.shownPieces(ritems, {}), yw.exportColumns('returns')).split('\r\n')[0].startsWith('﻿Due back,Days overdue,Request'));
T.eq('lines and found units have their own columns', ['lines-picking', 'lines-returns', 'found'].map((k) => yw.exportColumns(k).length).join(), '11,8,10');

T.section('the pick slip (pickSlip.buildModel, New\'s)');
const slip = pickSlip.buildModel({ requestNumber: 'REQ-1', toNumber: 'TO-A', yard: 'Houston Yard', project: 'P', neededByDate: '2026-11-02T00:00:00Z' }, [
  { equipmentName: 'B', lineStatus: 'PICK_INITIATED', subinventory: 'Available', locator: 'A-10' },
  { equipmentName: 'A', lineStatus: 'SCHEDULED_FOR_PICKING', subinventory: 'Available', locator: 'A-01' },
  { equipmentName: 'C', lineStatus: 'SHIP_TO_SITE', subinventory: 'Available', locator: 'A-2' },
], new Date(NOW));
T.eq('only released pieces, in walking order', slip.rows.map((r) => r.lineNo + r.equipmentName).join(), '3C,1B');

// ── Chains: what is sent ─────────────────────────────────────────────────────────────────────────────────────────
class ActionChain {}
function fakeActions(answer) {
  const calls = [];
  return {
    calls,
    callRest: async (ctx, o) => { calls.push(o); return answer(o) || { ok: false, status: 404, body: {} }; },
    callChain: async (ctx, o) => { calls.push({ chain: o.chain, params: o.params }); return null; },
  };
}
function chain(page, name, Actions) {
  return loadFile(path.join(PAGES, page + '-page-chains', name + '.js'), {
    'vb/action/actionChain': ActionChain, 'vb/action/actions': Actions, 'resources/js/yardWork': yw, 'resources/js/requestLineBody': lineBody,
    'resources/js/currentUser': cu, 'resources/js/requestData': requestData, 'resources/js/rules': rules, 'resources/js/maintAssetLocation': mal,
    'resources/js/returnLeg': rl, 'resources/js/directReturn': dr, 'resources/js/requestDetailLines': rdl, 'resources/js/shellBus': { open() {}, toast() {} },
  });
}
function ctx(vars, opts) {
  const o = opts || {};
  return {
    $page: { variables: vars, functions: {} },
    $application: {
      user: { userName: 'priya.raman' },
      variables: { pageAccessMap: o.access || { EQR_INITIATE_PICKING: 'FULL', EQR_EQUIPMENT_RETURNS: 'FULL' }, pageAccessLoaded: true,
        featureFlags: o.flags || {}, flagsLoaded: true, jwt: '' },
      functions: { isFeatureEnabled: rules.isFeatureEnabled, isExternalSource: rules.isExternalSource },
    },
  };
}
const rests = (A) => A.calls.filter((c) => c.endpoint).map((c) => c.endpoint.replace('eqp-v1/', ''));

(async () => {
  T.section('release (fixed assets only): the line batch');
  {
    const A = fakeActions((o) => (o.endpoint === 'eqp-v1/patchRequestLinesBatch' ? { ok: true, body: { data: [] } } : null));
    const C = chain('picking', 'releaseChain', A);
    const v = { busy: '', ticks: ['1', '4', '5', '6'], openId: '501', banner: {}, work: { req: { id: '501', eqrEquipmentRequestId: 501 }, lines: wl, tos } };
    await new C().run(ctx(v));
    T.eq('one call: PATCH lines/batch', rests(A).join(), 'patchRequestLinesBatch');
    T.eq('the ticked fixed assets waiting for release move to Pick initiated', JSON.stringify(A.calls[0].body),
      JSON.stringify({ lines: [{ id: 5, lineStatus: 'PICK_INITIATED' }, { id: 6, lineStatus: 'PICK_INITIATED' }] }));
    T.eq('on request 501, stamped with the user', JSON.stringify([A.calls[0].uriParams, A.calls[0].headers]), JSON.stringify([{ requestId: 501 }, { 'X-User-Id': 'priya.raman' }]));
    T.eq('the lines move in place; the ticked stock line is left as it is', v.work.lines.map((l) => l.lineStatus.slice(0, 4)).join(), 'SCHE,PICK,PICK,PICK,PICK,PICK');
    T.check('it says so', /2 fixed-asset pieces released/.test(v.banner.text) && /left as they are/.test(v.banner.text));
    const A2 = fakeActions(() => null);
    const v2 = { busy: '', ticks: ['1'], work: v.work, banner: {} };
    await new (chain('picking', 'releaseChain', A2))().run(ctx(v2));
    T.eq('no fixed asset ticked: nothing is sent', A2.calls.length, 0);
    const A3 = fakeActions(() => null);
    const v3 = { busy: '', ticks: ['5'], work: { req: { id: '501' }, lines: wl, tos }, banner: {} };
    await new (chain('picking', 'releaseChain', A3))().run(ctx(v3, { access: { EQR_INITIATE_PICKING: 'READ_ONLY' } }));
    T.eq('read-only: nothing is sent', A3.calls.length, 0);
  }

  T.section('Pick and ship: live statuses, then the ship batch');
  {
    const server = [{ id: 2, lineStatus: 'PICK_INITIATED', isTransactable: 'Y', isMaintenanceTracked: 'N' }, { id: 3, lineStatus: 'PICK_INITIATED', isTransactable: 'Y' },
      { id: 4, lineStatus: 'PICK_INITIATED', isTransactable: 'N', isMaintenanceTracked: 'Y' }];
    const answer = (o) => {
      if (o.endpoint === 'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2') return { ok: true, body: { data: server } };
      if (o.endpoint === 'eqp-v1/patchRequestLinesBatch') return { ok: true, body: { data: [] } };
      return null;
    };
    const A = fakeActions(answer);
    const v = { busy: '', ticks: ['3'], selectedTOId: '92', openId: '501', banner: {}, work: { req: { id: '501', eqrEquipmentRequestId: 501 }, lines: wl, tos } };
    await new (chain('picking', 'shipChain', A))().run(ctx(v));
    const r = rests(A);
    T.eq('calls: read the lines, PATCH the batch, then New\'s asset step reads only (sync off)', [r[0], r[1]].join(' > '),
      'getEquipriteV1EquipmentRequestsRequestIdLines2 > patchRequestLinesBatch');
    T.check('no write but the batch', A.calls.filter((c) => c.endpoint && !/^eqp-v1\/get/.test(c.endpoint) && c.endpoint !== 'eqp-v1/patchRequestLinesBatch').length === 0);
    T.eq('the ticked order\'s picked line and the picked fixed asset ship', JSON.stringify(A.calls[1].body),
      JSON.stringify({ lines: [{ id: 3, lineStatus: 'SHIP_TO_SITE' }, { id: 4, lineStatus: 'SHIP_TO_SITE' }] }));
    T.check('the workspace is read again', A.calls.some((c) => c.chain === 'openWorkChain'));
    const A2 = fakeActions(answer);
    const v2 = Object.assign({}, v, { busy: '', banner: {} });
    await new (chain('picking', 'shipChain', A2))().run(ctx(v2, { flags: { MAINT_ASSET_LOCATION_SYNC_ENABLED: 'true' } }));
    T.eq('asset sync on and a fixed asset would move in Fusion: only the read, nothing written', rests(A2).join(), 'getEquipriteV1EquipmentRequestsRequestIdLines2');
    T.check('it says why and where', /Nothing was shipped/.test(v2.banner.text) && /New EquipRite/.test(v2.banner.text));
  }

  T.section('Receive at yard: New\'s AcceptReturnLinesChain');
  {
    const answer = (o) => {
      if (o.endpoint === 'eqp-v1/patchRequestLinesBatch') return { ok: true, body: { data: [] } };
      if (o.endpoint === 'eqp-v1/getAllocations') {
        return { ok: true, body: { data: o.uriParams.requestLineId === 1
          ? [{ eqrSerialRefId: 41 }, { eqrSerialRefId: 41 }, { eqrLotRefId: 41 }, { inventoryItemRefId: 7 }, { eqrSerialRefId: 50, allocationStatus: 'RELEASED' }] : [] } };
      }
      if (/patch(Serial|Lot|InventoryItem)Ref/.test(o.endpoint) || o.endpoint === 'eqp-v1/patchEquipmentRequest') return { ok: true, body: {} };
      if (o.endpoint === 'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2') return { ok: true, body: { data: [{ lineStatus: 'CLOSED' }, { lineStatus: 'REJECTED' }] } };
      return null;
    };
    const A = fakeActions(answer);
    const v = { busy: '', ticks: ['1', '2'], returnDate: '2026-10-20', openId: '601', banner: {},
      work: { req: { id: '601', eqrEquipmentRequestId: 601 }, lines: [{ lineId: '1', lineStatus: 'SHIPPED_TO_YARD' }, { lineId: '2', lineStatus: 'RETURN_IN_PROCESS' }] } };
    await new (chain('returns', 'acceptReturnLinesChain', A))().run(ctx(v));
    T.eq('calls, in New\'s order', rests(A).join(' > '),
      'patchRequestLinesBatch > getAllocations > patchSerialRef > patchLotRef > patchInventoryItemRef > getEquipriteV1EquipmentRequestsRequestIdLines2 > patchEquipmentRequest');
    T.eq('only the line shipped back closes, with the day it came back', JSON.stringify(A.calls[0].body),
      JSON.stringify({ lines: [{ id: 1, lineStatus: 'CLOSED', actualReturnDate: '2026-10-20T00:00:00Z' }] }));
    T.eq('each unit back in stock, by its kind; a released one left alone', A.calls.filter((c) => /Ref$/.test(c.endpoint || '')).map((c) => c.uriParams.id + JSON.stringify(c.body)).join(' '),
      '41{"unitStatus":"AVAILABLE"} 41{"lotStatus":"ACTIVE"} 7{"itemStatus":"ACTIVE"}');
    T.eq('every line finished: the request closes', JSON.stringify(A.calls.filter((c) => c.endpoint === 'eqp-v1/patchEquipmentRequest')[0].body), '{"status":"CLOSED"}');
    T.check('it says so', /1 piece received and closed/.test(v.banner.text) && /3 units are back in stock/.test(v.banner.text) && /request is closed/.test(v.banner.text));
    const A2 = fakeActions(answer);
    const v2 = { busy: '', ticks: ['2'], openId: '601', banner: {}, work: v.work };
    await new (chain('returns', 'acceptReturnLinesChain', A2))().run(ctx(v2));
    T.eq('nothing shipped back ticked: nothing is sent', rests(A2).length, 0);
  }

  T.section('a unit back without notice: fixed assets only');
  {
    const A = fakeActions((o) => (o.endpoint === 'eqp-v1/recordReturn' ? { ok: true, body: { linesPromoted: o.body.lineIds.length } } : null));
    const found = [{ rowKey: '8:1', requestId: 603, requestNumber: 'REQ-3', lineId: 8, fulfilmentClass: 'F_AND_M' },
      { rowKey: '8:2', requestId: 603, requestNumber: 'REQ-3', lineId: 8, fulfilmentClass: 'F_AND_M' },
      { rowKey: '9:3', requestId: 604, requestNumber: 'REQ-4', lineId: 9, fulfilmentClass: 'F_AND_M' },
      { rowKey: '7:4', requestId: 601, requestNumber: 'REQ-1', lineId: 7, fulfilmentClass: 'S_AND_T' }];
    const v = { busy: '', found, foundTicks: ['8:1', '8:2', '9:3'], findBanner: {}, scan: {} };
    await new (chain('returns', 'recordReturnChain', A))().run(ctx(v));
    T.eq('per request: record the return (no transfer order)', A.calls.filter((c) => c.endpoint).map((c) => c.endpoint.replace('eqp-v1/', '') + ' ' + c.uriParams.requestId + ' ' + JSON.stringify(c.body)).join(' | '),
      'recordReturn 603 {"lineIds":[8]} | recordReturn 604 {"lineIds":[9]}');
    T.check('it says so and the next scan starts clean', /2 fixed-asset units returned/.test(v.findBanner.text) && v.found.length === 0 && v.foundTicks.length === 0);
    const A2 = fakeActions(() => null);
    const v2 = { busy: '', found, foundTicks: ['8:1', '7:4'], findBanner: {}, scan: {} };
    await new (chain('returns', 'recordReturnChain', A2))().run(ctx(v2));
    T.eq('a stock unit ticked: nothing is sent (its transfer order is New\'s, in Fusion)', A2.calls.length, 0);
    T.check('it says why', /return transfer order in Fusion/.test(v2.findBanner.text));
  }

  T.section('finding a unit (New\'s two searches)');
  {
    const A = fakeActions((o) => (o.endpoint === 'eqp-v1/searchDeployedUnits'
      ? { ok: true, body: { data: o.uriParams.q ? [{ requestLineId: 5, unitRefId: 2, requestId: 1, serialNumber: 'AC-1', fulfilmentClass: 'S_AND_T' }] : [], recordCount: o.uriParams.q ? 1 : 0 } } : null));
    const v = { busy: '', findQuery: '', found: [], foundTicks: ['x'], foundMeta: {}, findBanner: {} };
    const C = chain('returns', 'findChain', A);
    await new C().run(ctx(v), { value: 'compressor', key: 'a' });
    T.eq('a key other than Enter does not search', A.calls.length, 0);
    await new C().run(ctx(v), { value: 'compressor', key: 'Enter' });
    T.eq('exact first, then broad', A.calls.map((c) => JSON.stringify([c.uriParams.serialNumber || '', c.uriParams.q || '', c.uriParams.lineStatus])).join(' '),
      '["compressor","","DEPLOYED,RETURN_INITIATED"] ["","compressor","DEPLOYED,RETURN_INITIATED"]');
    T.eq('candidates, none ticked', [v.found.length, v.foundTicks.length, v.found[0].rowKey].join('|'), '1|0|5:2');
  }

  T.section('the page modules');
  {
    const pick = new (loadFile(path.join(PAGES, 'picking-page.js'), { 'resources/js/exportKit': kit, 'resources/js/nav': nav, 'resources/js/rules': rules,
      'resources/js/requestProgress': Progress, 'resources/js/yardWork': yw, 'resources/js/shellBus': { onFocus: () => {} } }))();
    T.eq('release words: singular and plural', [pick.stockReleaseText([wl[0]], [tos[0]]), pick.stockReleaseText(wl, tos)].join(' | '),
      '1 piece on transfer order TO-A waits for release. | 1 piece on transfer order TO-A waits for release.');
    T.check('fixed assets: what releasing here does', /2 fixed-asset pieces with no transfer order wait for release/.test(pick.fmReleaseText(wl)) && /Nothing is sent to Fusion/.test(pick.fmReleaseText(wl)));
    T.eq('transfer orders in words', [pick.toList(tos), pick.toList([tos[1]]), pick.toList([tos[0], Object.assign({}, tos[0], { orderNumber: 'TO-C' })])].join(' | '),
      'TO-A, TO-B · 1 awaiting release | TO-B · released | TO-A, TO-C · all awaiting release');
    T.eq('where to pick it', [pick.where({ yard: 'H', subinventory: 'Available', locator: 'A-1' }), pick.where({})].join(' | '), 'H · Available · A-1 | Yard not recorded');
    T.eq('the asset-sync note counts what would move in Fusion', [pick.relocates(true, tos, '', [{ lineId: '4', lineStatus: 'PICK_INITIATED', isFAndM: true, maintenanceTracked: 'Y', transactable: 'N' }], ['4']),
      pick.relocates(false, tos, '', [{ lineId: '4', lineStatus: 'PICK_INITIATED', isFAndM: true, maintenanceTracked: 'Y', transactable: 'N' }], ['4'])].join(), '1,0');
    T.check('only full access acts', pick.canAct({ EQR_INITIATE_PICKING: 'FULL' }, true) && !pick.canAct({ EQR_INITIATE_PICKING: 'READ_ONLY' }, true) && !pick.canAct({ EQR_INITIATE_PICKING: 'FULL' }, false));
    const ret = new (loadFile(path.join(PAGES, 'returns-page.js'), { 'resources/js/exportKit': kit, 'resources/js/nav': nav, 'resources/js/rules': rules,
      'resources/js/requestProgress': Progress, 'resources/js/yardWork': yw, 'resources/js/directReturn': dr, 'resources/js/fmt': fmt }))();
    T.eq('needs: singular and plural', [ret.needsText(1, 'stock piece', 'x.'), ret.needsText(2, 'stock piece', 'x.')].join(' | '), '1 stock piece needs x. | 2 stock pieces need x.');
    T.eq('the lines shown back-at-the-yard first, load order kept for what is sent', ret.lineRows([{ lineStatus: 'DEPLOYED', lineId: 1 }, { lineStatus: 'SHIPPED_TO_YARD', lineId: 2 },
      { lineStatus: 'CLOSED', lineId: 3 }, { lineStatus: 'RETURN_IN_PROCESS', lineId: 4 }]).map((l) => l.lineId).join(), '2,4,1,3');
    T.eq('found units summary', [ret.foundSummary({ searched: true, recordCount: 3 }, [1, 2]), ret.foundSummary({ searched: true, tooShort: true }, []), ret.foundSummary({ searched: true, recordCount: 0 }, [])].join(' | '),
      'Showing 2 of 3 matches: narrow the search to see the rest. | Type at least 2 characters. | No equipment out in the field matches that.');
  }

  T.report();
})();
