/*
 * EquipRite Next: the two steps between the yard and the site, done in Next. Confirm for picking (confirmPicking: Old's
 * Confirm Request, plan -> reserve -> OIC createSupplyRequest per yard -> record, or release on failure) and Accept
 * delivery (acceptDelivery: New's, rental -> DEPLOYED, consumable -> DELIVERED or issued from stock -> CONSUMED, the
 * request rolled up). Loads the real modules against a fake server that records every call.
 *
 * Run:  node tests/next-site-steps.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const JS = path.join(__dirname, '..', 'webApps', 'equiprite-next', 'resources', 'js');

function load(name, deps) {
  const sandbox = { console: { log() {}, warn() {}, error() {} }, Intl, Date, Math, setTimeout, Promise, JSON };
  let mod;
  sandbox.define = (names, factory) => { mod = factory(...names.map((n) => (deps || {})[n])); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(JS, name + '.js'), 'utf8'), sandbox, { filename: name + '.js' });
  return mod;
}

const rdl = load('requestDetailLines');
const lineBody = load('requestLineBody');
const cu = load('currentUser');
const C = load('confirmPicking', { 'resources/js/requestDetailLines': rdl, 'resources/js/requestLineBody': lineBody, 'resources/js/currentUser': cu });
const A = load('acceptDelivery', { 'resources/js/requestLineBody': lineBody, 'resources/js/currentUser': cu });

/** A fake server: answers by endpoint name; records [endpoint, uriParams, body] for every call. */
function server(answers) {
  const calls = [];
  const Actions = {
    callRest(ctx, o) {
      calls.push({ ep: o.endpoint.replace(/^eqp-v1\/|^ics\//, ''), uri: o.uriParams || {}, body: o.body });
      const a = answers[o.endpoint.replace(/^eqp-v1\/|^ics\//, '')];
      const r = typeof a === 'function' ? a(o) : a;
      return Promise.resolve(r || { ok: false, status: 404, body: {} });
    },
  };
  // Reads: the get… calls, and failedLines (requestDetailLines' failed transfer-order sweep, best effort).
  return { Actions, calls, writes: () => calls.filter((c) => !/^get|^failedLines$/.test(c.ep)).map((c) => c.ep) };
}
const ok = (body) => ({ ok: true, status: 200, body });
const row = (id, status, extra) => Object.assign({ lineId: id, lineNumber: id, equipmentName: 'Piece ' + id, lineStatus: status, allocatedQty: 1, quantity: 1, fulfilmentClass: 'S_AND_T' }, extra || {});
const ctx = { $application: { variables: {} } };

(async () => {
  T.section('Confirm for picking: what can be confirmed');
  const mapped = [row(1, 'ALLOCATED'), row(2, 'SCHEDULED_FOR_PICKING'), row(3, 'IN_PROCESS', { allocatedQty: 0 }), row(4, 'ALLOCATED', { toNumber: 'TO-1' }),
    row(5, 'ALLOCATED', { fulfilmentClass: 'F_AND_M' }), row(6, 'ALLOCATED', { fulfilmentClass: 'F_AND_M', quantity: 2, allocatedQty: 1 })].map(rdl.mapRow);
  T.eq('unit assigned, no transfer order yet (a fixed asset: allocated)', C.confirmable(mapped).map((l) => l.line_id).join(), '1,5');
  const k1 = C.idempotencyKey({ requestId: 9, lineIds: [3, 1, 2], leg: 'OUTBOUND', sourceCode: 'HOU' });
  T.eq('the same intent, the same key (order of lines does not matter)', k1 === C.idempotencyKey({ requestId: 9, lineIds: [1, 2, 3], leg: 'OUTBOUND', sourceCode: 'HOU' }) && k1.length, 16);
  T.check('another yard or a retry: another key', k1 !== C.idempotencyKey({ requestId: 9, lineIds: [1, 2, 3], leg: 'OUTBOUND', sourceCode: 'ATL' })
    && k1 !== C.idempotencyKey({ requestId: 9, lineIds: [1, 2, 3], leg: 'OUTBOUND', sourceCode: 'HOU', attempt: 1 }));
  const bt = C.blockText([{ reasonCode: 'NOT_CONFIRMABLE', lineNumber: 9, equipmentName: 'X' }, { reasonCode: 'NO_YARD', lineNumber: 2, equipmentName: 'Roller' }]);
  T.eq('a block: the first kind that matters, in words', bt.title + ' | ' + bt.text,
    'No yard to ship from | This piece has no allocation, so nothing says which yard it ships from: assign its unit in Approve & allocate: line 2 (Roller). Nothing was sent to Fusion.');
  const body = C.payload({ batchNumber: 'EQR-R1-1-HOU', nowIso: '2026-11-03T00:00:00.000Z', needByIso: '2026-11-30T23:59:59.000Z', requestId: 9,
    items: [{ lineId: 1, itemNumber: 'EX-1', qty: 2, srcCode: 'HOU', destCode: 'VPJ' }], subinvByCode: { VPJ: 'SITE' } });
  T.eq('the OIC body: Old\'s, outbound, one line per piece', [body.OrderType, body.InterfaceBatchNumber, body.equipmentRequestId, body.supplyRequestLines.length].join(), 'OUTBOUND,EQR-R1-1-HOU,9,1');
  const l0 = body.supplyRequestLines[0];
  T.eq('a line: yards, the destination subinventory, item, quantity, need-by, the request line',
    [l0.SourceOrganizationCode, l0.DestinationOrganizationCode, l0.DestinationSubinventoryCode, l0.ItemNumber, l0.Quantity, l0.NeedByDate, l0.requestLineId, l0.SupplyType].join(),
    'HOU,VPJ,SITE,EX-1,2,2026-11-30T23:59:59.000Z,1,TRANSFER');
  T.eq('no subinventory mapped: Old\'s default', C.payload({ batchNumber: 'b', items: [{ lineId: 1, destCode: 'X' }] }).supplyRequestLines[0].DestinationSubinventoryCode, 'Stores');

  T.section('Confirm for picking: the calls, in order');
  const plan = { buckets: [
    { sourceOrgCode: 'HOU', sourceOrgId: 11, sourceOrgName: 'Houston Yard', destOrgCode: 'VPJ', destOrgId: 21, destOrgName: 'Virtual project', lines: [{ requestLineId: 1, lineNumber: 1, equipmentName: 'Piece 1', itemNumber: 'EX-1', qty: 1 }] },
    { sourceOrgCode: 'ATL', sourceOrgId: 12, destOrgCode: 'VPJ', destOrgId: 21, lines: [{ requestLineId: 7, lineNumber: 7, equipmentName: 'Piece 7', itemNumber: 'EX-7', qty: 1 }] },
  ], blocks: [], fAndMLineIds: [5] };
  const lines = [row(1, 'ALLOCATED'), row(7, 'ALLOCATED'), row(5, 'ALLOCATED', { fulfilmentClass: 'F_AND_M' }), row(2, 'SCHEDULED_FOR_PICKING')];
  const base = () => ({
    getEquipriteV1ViewsRequestDetailLines: ok({ data: lines }),
    getTransferOrders: ok({ data: [] }),
    planConfirm: ok(plan),
    reserveConfirm: (o) => ok({ reservedLineIds: o.body.lineIds, rejectedLineIds: [], replayed: false }),
    createSupplyRequest: { ok: true, status: 202, body: { status: 'ACCEPTED' } },
    recordConfirm: ok({}),
    getBuOrgMappings: ok({ data: [{ invOrgCode: 'VPJ', subinventoryCode: 'SITE' }] }),
  });
  let s = server(base());
  let out = await C.confirm(ctx, s.Actions, { requestId: 9, requestNumber: 'R9', endDate: '2026-11-30', now: Date.UTC(2026, 10, 3) });
  T.eq('per yard: reserve, Fusion, record; then the fixed asset, recorded without a transfer order', s.writes().join(' > '),
    'planConfirm > reserveConfirm > createSupplyRequest > recordConfirm > reserveConfirm > createSupplyRequest > recordConfirm > recordConfirm');
  T.eq('the plan is asked for the pieces with their unit assigned', JSON.stringify(s.calls.filter((c) => c.ep === 'planConfirm')[0].body), '{"lineIds":[1,7,5],"fallbackYardOrgId":null}');
  const recs = s.calls.filter((c) => c.ep === 'recordConfirm').map((c) => c.body);
  const at = Date.UTC(2026, 10, 3);
  T.eq('record stamps the yards; the fixed asset has its own batch', [recs[0].batchNumber, recs[0].sourceOrgCode, recs[0].destOrgCode, recs[0].allocationMethod, recs[2].batchNumber, recs[2].lineIds.join()].join(' | '),
    'EQR-R9-' + at + '-HOU | HOU | VPJ | MANUAL | EQR-R9-' + at + '-FM | 5');
  T.eq('Fusion gets the request\'s end date as need-by', s.calls.filter((c) => c.ep === 'createSupplyRequest')[0].body.supplyRequestLines[0].NeedByDate, '2026-11-30T23:59:59.000Z');
  T.eq('the outcome', [out.ok, out.tone, out.title, out.changed, out.created].join(), 'true,ok,Confirmed for picking,true,2');
  T.check('in words: two transfer orders, one per yard, and the fixed asset', /^2 transfer orders requested from Fusion \(one per yard it ships from\): 2 pieces scheduled for picking/.test(out.text)
    && out.text.includes('1 fixed-asset piece confirmed without a transfer order'), out.text);

  T.section('Confirm for picking: when Fusion or the server says no');
  s = server(Object.assign(base(), { createSupplyRequest: (o) => (o.body.supplyRequestLines[0].SourceOrganizationCode === 'ATL'
    ? { ok: false, status: 500, body: { message: 'Item EX-7 not in org ATL' } } : { ok: true, status: 202, body: {} }) }));
  out = await C.confirm(ctx, s.Actions, { requestId: 9, requestNumber: 'R9' });
  T.eq('a yard Fusion refuses: its reservation is released, the others go on', s.writes().join(' > '),
    'planConfirm > reserveConfirm > createSupplyRequest > recordConfirm > reserveConfirm > createSupplyRequest > releaseReservation > recordConfirm');
  T.eq('partly confirmed, with why', out.title + ' | ' + /yard ATL \(HTTP 500: Item EX-7 not in org ATL\)/.test(out.text), 'Partly confirmed | true');
  s = server(Object.assign(base(), { planConfirm: ok({ buckets: [], fAndMLineIds: [], blocks: [{ reasonCode: 'NEEDS_QUOTE', lineNumber: 1, equipmentName: 'Piece 1' }] }) }));
  out = await C.confirm(ctx, s.Actions, { requestId: 9 });
  T.eq('a block stops everything before Fusion', s.writes().join(' > ') + ' | ' + out.title, 'planConfirm | A quote is needed first');
  s = server(Object.assign(base(), { planConfirm: { ok: false, status: 503, body: {} } }));
  out = await C.confirm(ctx, s.Actions, { requestId: 9 });
  T.eq('no plan: nothing is sent (no guessing the yards here)', s.writes().join(' > ') + ' | ' + out.tone, 'planConfirm | error');
  s = server(Object.assign(base(), { reserveConfirm: ok({ replayed: true, reservedLineIds: [], rejectedLineIds: [] }), planConfirm: ok({ buckets: plan.buckets.slice(0, 1), fAndMLineIds: [] }) }));
  out = await C.confirm(ctx, s.Actions, { requestId: 9 });
  T.eq('a second click: the reserve says replayed, nothing more is created', s.writes().join(' > ') + ' | ' + out.title, 'planConfirm > reserveConfirm | Already requested');
  s = server(Object.assign(base(), { recordConfirm: { ok: false, status: 500, body: {} }, planConfirm: ok({ buckets: plan.buckets.slice(0, 1), fAndMLineIds: [] }),
    getAllocations: ok({ data: [{ id: 501, allocationStatus: 'ALLOCATED', eqpInvOrgId: 11 }, { id: 502, allocationStatus: 'RELEASED', eqpInvOrgId: 11 }] }),
    patchAllocation: ok({}), patchRequestLinesBatch: ok({ data: [] }) }));
  out = await C.confirm(ctx, s.Actions, { requestId: 9 });
  T.eq('record not answering: Old\'s fallback stamps the live allocation, then the lines in one batch', s.writes().join(' > '),
    'planConfirm > reserveConfirm > createSupplyRequest > recordConfirm > patchAllocation > patchRequestLinesBatch');
  T.eq('the line scheduled for picking, with its yards', JSON.stringify(s.calls.filter((c) => c.ep === 'patchRequestLinesBatch')[0].body.lines[0]),
    '{"id":1,"sourceInvOrgId":11,"sourceInvOrgName":"Houston Yard","sourceOrgCode":"HOU","destInvOrgId":21,"destInvOrgName":"Virtual project","destinationOrgCode":"VPJ","allocationMethod":"MANUAL","lineStatus":"SCHEDULED_FOR_PICKING"}');
  s = server(Object.assign(base(), { getTransferOrders: ok({ data: [{ id: 3 }] }), getTransferOrderLines: ok({ data: [{ requestLineId: 1 }, { requestLineId: 7 }, { requestLineId: 5 }] }) }));
  out = await C.confirm(ctx, s.Actions, { requestId: 9 });
  T.eq('already on a transfer order: nothing to confirm, nothing sent', s.writes().join(' > ') + '|' + out.title, '|Nothing to confirm');

  T.section('Accept delivery');
  T.eq('a rental goes on site, a consumable delivered', [A.targetFor({ consumableFlag: 'N' }), A.targetFor({ consumableFlag: 'Y' })].join(), 'DEPLOYED,DELIVERED');
  T.eq('the request: every piece on site -> Deployed; every piece finished -> Closed; else as it is',
    [A.rollup([{ lineId: '1', lineStatus: 'SHIP_TO_SITE' }, { lineId: '2', lineStatus: 'DEPLOYED' }], { 1: 'DEPLOYED' }),
      A.rollup([{ lineId: '1', lineStatus: 'SHIP_TO_SITE' }, { lineId: '2', lineStatus: 'REJECTED' }], { 1: 'CONSUMED' }),
      A.rollup([{ lineId: '1', lineStatus: 'SHIP_TO_SITE' }, { lineId: '2', lineStatus: 'SCHEDULED_FOR_PICKING' }], { 1: 'DEPLOYED' }) || '-'].join(), 'DEPLOYED,CLOSED,-');
  const lineRows = [
    { lineId: 1, equipmentName: 'Excavator', lineStatus: 'SHIP_TO_SITE', quantity: 1 },
    { lineId: 2, equipmentName: 'Gravel', lineStatus: 'SHIP_TO_SITE', quantity: 30, consumableFlag: 'Y' },
    { lineId: 3, equipmentName: 'Cement', lineStatus: 'SHIP_TO_SITE', quantity: 10, consumableFlag: 'Y', autoConsumeFlag: 'Y' },
    { lineId: 4, equipmentName: 'Crane', lineStatus: 'DEPLOYED', quantity: 1 },
  ];
  s = server({
    getEquipriteV1ViewsRequestDetailLines: ok({ data: lineRows }),
    getEquipriteV1ViewsLineDetailUnits: ok({ data: [{ unitNumber: 'CEM-50', uomCode: 'BAG', invOrgId: 11 }] }),
    createInventoryConsumption: { ok: true, status: 201, body: {} },
    patchRequestLinesBatch: ok({ data: [] }),
    patchEquipmentRequest: ok({}),
  });
  out = await A.accept(ctx, s.Actions, { requestId: 9, now: Date.UTC(2026, 10, 3) });
  T.eq('calls: the cement issued from stock first, one batch, then the request', s.writes().join(' > '), 'createInventoryConsumption > patchRequestLinesBatch > patchEquipmentRequest');
  T.eq('each piece where it goes', JSON.stringify(s.calls.filter((c) => c.ep === 'patchRequestLinesBatch')[0].body.lines),
    '[{"id":1,"lineStatus":"DEPLOYED"},{"id":2,"lineStatus":"DELIVERED","deliveredQuantity":30},{"id":3,"lineStatus":"CONSUMED","deliveredQuantity":10,"consumedQuantity":10}]');
  const cons = s.calls.filter((c) => c.ep === 'createInventoryConsumption')[0].body;
  T.eq('the material issue: its item, quantity, unit, date', [cons.itemNumber, cons.quantityConsumed, cons.uomCode, cons.invOrgId, cons.transactionDate, cons.consumptionType].join(),
    'CEM-50,10,BAG,11,2026-11-03T00:00:00Z,USAGE');
  T.eq('everything on site: the request is Deployed', JSON.stringify(s.calls.filter((c) => c.ep === 'patchEquipmentRequest')[0].body), '{"status":"DEPLOYED"}');
  T.eq('in words', out.text, '3 pieces accepted (1 on site, 2 delivered). 1 consumable issued from stock and consumed. Everything on the request is on site: it is marked Deployed.');
  s = server({ getEquipriteV1ViewsRequestDetailLines: ok({ data: [lineRows[0], { lineId: 5, lineStatus: 'IN_PROCESS' }] }), patchRequestLinesBatch: ok({ data: [] }) });
  out = await A.accept(ctx, s.Actions, { requestId: 9 });
  T.eq('a piece still to come: the request is left as it is', s.writes().join(' > ') + ' | ' + out.text, 'patchRequestLinesBatch | 1 piece accepted: on site now.');
  s = server({ getEquipriteV1ViewsRequestDetailLines: ok({ data: [lineRows[0]] }), patchRequestLinesBatch: { ok: false, status: 409, body: { message: 'Line 1 changed meanwhile.' } } });
  out = await A.accept(ctx, s.Actions, { requestId: 9 });
  T.eq('the batch refused: nothing changed, it says why', [out.ok, out.tone, /^Nothing was accepted: .*No piece changed\.$/.test(out.text)].join(), 'false,error,true');
  s = server({ getEquipriteV1ViewsRequestDetailLines: ok({ data: [lineRows[3]] }) });
  out = await A.accept(ctx, s.Actions, { requestId: 9 });
  T.eq('nothing on its way: nothing is written', s.writes().join() + '|' + out.title, '|Nothing to accept');

  T.report();
})().catch((e) => { console.error(e); process.exit(1); });
