/*
 * EquipRite Next: a request's flow. Its history from start to end (requestHistory), the steps a row in Requests offers
 * (requestList.actions), Help's flow and statuses (helpGuide), the hand-off that opens a screen on one request
 * (shellBus.focus), and Help in the menu (nav). Loads the real modules.
 *
 * Run:  node tests/next-flow.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const JS = path.join(__dirname, '..', 'webApps', 'equiprite-next', 'resources', 'js');

function load(name, deps) {
  const sandbox = { console, Intl, Date, setTimeout };
  let mod;
  sandbox.define = (names, factory) => { mod = factory(...names.map((n) => (deps || {})[n])); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(JS, name + '.js'), 'utf8'), sandbox, { filename: name + '.js' });
  return mod;
}

const rules = load('rules');
const fmt = load('fmt');
const Progress = load('requestProgress');
const nav = load('nav', { 'resources/js/rules': rules });
const list = load('requestList', { 'resources/js/requestProgress': Progress, 'resources/js/fmt': fmt, 'resources/js/rules': rules });
const queue = load('approvalQueue', { 'resources/js/requestProgress': Progress, 'resources/js/fmt': fmt, 'resources/js/rules': rules });
const history = load('requestHistory', { 'resources/js/requestProgress': Progress, 'resources/js/fmt': fmt });
const guide = load('helpGuide', { 'resources/js/requestProgress': Progress, 'resources/js/rules': rules });
const bus = load('shellBus');

const states = (h) => h.milestones.map((m) => m.key + ':' + m.state).join(' ');

// ── History ─────────────────────────────────────────────────────────────────────────────────────────────
T.section('history: what the server recorded');
const recorded = history.fromStatusHistory({ data: [
  { requestId: 9, toStatus: 'SUBMITTED', fromStatus: 'DRAFT', changedDate: '2026-10-08T09:15:00Z', changedBy: 'user.rite' },
  { requestId: 9, lineId: 1, newStatus: 'IN_PROCESS', oldStatus: 'SUBMITTED', statusDate: '2026-10-09T11:02:10Z', createdBy: 'javeed.shaik' },
  { requestId: 9, lineId: 2, newStatus: 'IN_PROCESS', oldStatus: 'SUBMITTED', statusDate: '2026-10-09T11:02:40Z', createdBy: 'javeed.shaik' },
  { requestId: 9, lineId: 3, newStatus: 'IN_PROCESS', oldStatus: 'SUBMITTED', statusDate: '2026-10-09T11:02:50Z', createdBy: 'javeed.shaik' },
  { requestId: 9, lineId: 1, status: 'REJECTED', changeDate: '2026-10-10', updatedBy: 'em', comments: 'Wrong class' },
] }, false);
T.eq('several spellings read; one approval of three lines is one event', recorded.map((e) => e.title).join(' | '), 'Sent for approval | Approved | Sent back');
T.eq('the approval says how many pieces and what they were', recorded[1].text, '3 pieces · was: waiting for approval');
T.eq('who approved it', recorded[1].who, 'javeed.shaik');
T.eq('a reason is quoted', recorded[2].text.indexOf('“Wrong class”') !== -1, true);
T.eq('a date alone reads as a date', recorded[2].when, '10 Oct 2026');
T.eq('a list as an array works too', history.fromStatusHistory([{ toStatus: 'ALLOCATED', changedDate: '2026-10-11' }]).map((e) => e.title).join(), 'Unit assigned');
T.eq('a customer request in process is with the Equipment Manager', history.fromStatusHistory([{ toStatus: 'IN_PROCESS', changedDate: '2026-10-11' }], true)[0].title, 'Sent to the Equipment Manager');

T.section('history: transfer orders');
const tos = history.fromTransferOrders({ data: [
  { id: 1, orderNumber: 'TO-1', orderType: 'OUTBOUND', createdDate: '2026-10-12', shippedDate: '2026-10-13', receivedDate: '2026-10-14', carrierName: 'DHL', trackingNumber: 'Z9' },
  { id: 2, orderNumber: 'TO-2', orderType: 'INBOUND', createdDate: '2026-10-28' },
  { id: 3, orderNumber: 'TO-3', orderType: 'INTER_PROJECT', createdDate: '2026-10-20' },
] });
T.eq('raised, shipped, received; the return raised; between projects left to transfers', tos.map((e) => e.title).join(' | '),
  'Transfer order TO-1 raised for picking | Shipped to site | Received on site | Transfer order TO-2 raised to bring it back');
T.eq('carrier and tracking with the shipment', tos[1].text, 'TO-1 · DHL, tracking Z9');

T.section('history: the milestones');
const NOW = Date.UTC(2026, 9, 30);
const partly = history.build({
  head: { status: 'IN_PROCESS', number: 'REQ-9', requestor: 'User Rite', createdDate: '2026-10-08T09:00:00Z' },
  lines: [{ lineStatus: 'SHIP_TO_SITE' }, { lineStatus: 'PICK_INITIATED' }, { lineStatus: 'IN_PROCESS' }],
  statusHistory: [{ toStatus: 'SUBMITTED', changedDate: '2026-10-08T09:15:00Z' }, { toStatus: 'IN_PROCESS', changedDate: '2026-10-09T11:02:00Z', changedBy: 'javeed.shaik' }],
  transferOrders: [{ orderNumber: 'TO-1', orderType: 'OUTBOUND', createdDate: '2026-10-12', shippedDate: '2026-10-13' }],
  now: NOW,
});
T.eq('one of three shipped: approved by all; units, picking and shipping partly', states(partly),
  'created:done submitted:done approved:done allocated:partly picked:partly shipped:partly onsite:todo back:todo done:todo');
T.eq('partly says how many', partly.milestones.filter((m) => m.key === 'shipped')[0].count, '1 of 3');
T.eq('approved: when and by whom', partly.milestones[2].who, 'javeed.shaik');
T.eq('shipped: the transfer order date', partly.milestones.filter((m) => m.key === 'shipped')[0].when, '13 Oct 2026');
T.eq('the step furthest behind carries what is next', partly.milestones.filter((m) => m.key === 'allocated')[0].note,
  'Next: Equipment Manager to assign a unit (1 of 3)');
T.eq('newest first; created is in', [partly.events[0].title, partly.events[partly.events.length - 1].title].join(' … '), 'Shipped to site … Request created');
T.eq('the approval history', partly.approvals.map((e) => e.title).join(' | '), 'Sent for approval | Approved');
T.check('the note says what was recorded', /2 status changes recorded/.test(partly.note));

const waiting = history.build({ head: { status: 'SUBMITTED' }, lines: [{ lineStatus: 'SUBMITTED' }, { lineStatus: 'SUBMITTED' }], now: NOW });
T.eq('waiting for approval: the next step is now', states(waiting).split(' ').slice(0, 3).join(' '), 'created:done submitted:done approved:here');
T.eq('and says who is next', waiting.milestones[2].note, 'Next: Equipment Manager to approve it (2 of 2)');
T.check('nothing recorded: said so', /No status changes were recorded/.test(waiting.note));

const unrecorded = history.build({ head: { status: 'IN_PROCESS' }, lines: [{ lineStatus: 'DEPLOYED' }], now: NOW });
T.eq('reached but not recorded: marked, never dated', unrecorded.milestones.filter((m) => m.key === 'approved')[0].missing, true);
T.eq('on site now', unrecorded.milestones.filter((m) => m.key === 'onsite')[0].state, 'done');
T.eq('then coming back is next', unrecorded.milestones.filter((m) => m.key === 'back')[0].state, 'here');

const sentBack = history.build({ head: { status: 'REJECTED' }, lines: [{ lineStatus: 'REJECTED' }],
  statusHistory: [{ toStatus: 'REJECTED', changedDate: '2026-10-10', changedBy: 'em', reason: 'Dates clash' }], now: NOW });
T.eq('sent back: stopped where it stopped, the rest not reached', states(sentBack).split(' ').slice(1, 4).join(' '), 'submitted:stopped approved:skipped allocated:skipped');
T.eq('with who and why', [sentBack.milestones[1].who, sentBack.milestones[1].note].join(' '), 'em “Dates clash”');

const draft = history.build({ head: { status: 'DRAFT', createdDate: '2026-10-01' }, lines: [{ lineStatus: 'DRAFT' }], now: NOW });
T.eq('a draft: sending it is next', draft.milestones[1].state + ' ' + draft.milestones[1].note, 'here Next: Requester to submit it');
T.eq('created, dated', draft.milestones[0].when, '1 Oct 2026');

T.section('history: load (reads only, a failed read named)');
(async () => {
  const calls = [];
  const Actions = { callRest: (ctx, o) => {
    calls.push(o.endpoint);
    if (o.endpoint.endsWith('getRequestStatusHistory')) return Promise.resolve({ ok: true, body: { data: [{ toStatus: 'SUBMITTED', changedDate: '2026-10-08' }] } });
    if (o.endpoint.endsWith('getEquipriteV1EquipmentRequestById')) return Promise.resolve({ ok: true, body: { id: 9, requestNumber: 'REQ-9', status: 'SUBMITTED', createdDate: '2026-10-07', requestorName: 'User Rite' } });
    if (o.endpoint.endsWith('getEquipriteV1ViewsRequestDetailLines')) return Promise.resolve({ ok: true, body: { data: [{ lineStatus: 'SUBMITTED', requestNumber: 'REQ-9' }] } });
    if (o.endpoint.endsWith('getTransferOrders')) return Promise.resolve({ ok: false, status: 500 });
    return Promise.resolve({ ok: true, body: { data: [] } });
  } };
  const h = await history.load({}, Actions, { id: 9, head: {} });
  T.eq('reads in parallel, every one a GET', calls.sort().join(), ['eqp-v1/getEquipriteV1EquipmentRequestById', 'eqp-v1/getEquipriteV1ViewsRequestDetailLines',
    'eqp-v1/getPurchaseRequisitions', 'eqp-v1/getRequestStatusHistory', 'eqp-v1/getTransferHistory', 'eqp-v1/getTransferOrders'].join());
  T.eq('the header gives created and by whom', h.events.filter((e) => e.kind === 'created')[0].who, 'User Rite');
  T.check('the failed read is named', /Not read: the transfer orders/.test(h.note));
  const given = [];
  await history.load({}, { callRest: (c, o) => { given.push(o.endpoint); return Promise.resolve({ ok: true, body: [] }); } }, { id: 9, head: { external: true }, lines: [{ lineStatus: 'DEPLOYED' }] });
  T.check('lines already loaded are not read again; a customer request reads its quotes',
    given.indexOf('eqp-v1/getEquipriteV1ViewsRequestDetailLines') === -1 && given.indexOf('eqp-v1/getQuoteHistory') !== -1);
  T.eq('no id: says so', (await history.load({}, Actions, {})).error, 'This request has no id yet: open it from Requests.');

  // ── A row's steps ───────────────────────────────────────────────────────────────────────────────────
  T.section('Requests: the steps a row offers');
  const can = { decide: true, assign: true, pick: true };
  const rows = [
    { eqrEquipmentRequestId: 1, requestNumber: 'R1', status: 'SUBMITTED', requestOrigin: 'Internal' },
    { eqrEquipmentRequestId: 2, requestNumber: 'R2', status: 'IN_PROCESS', requestOrigin: 'Internal' },
    { eqrEquipmentRequestId: 3, requestNumber: 'R3', status: 'IN_PROCESS', requestOrigin: 'Internal' },
    { eqrEquipmentRequestId: 4, requestNumber: 'R4', status: 'DRAFT', requestOrigin: 'Internal' },
  ];
  const lines = {
    R1: [{ lineStatus: 'SUBMITTED', name: 'A' }],
    R2: [{ lineStatus: 'IN_PROCESS', allocation: 'PENDING', name: 'B' }, { lineStatus: 'SHIP_TO_SITE', name: 'C' }],
    R3: [{ lineStatus: 'ALLOCATED', allocation: 'ALLOCATED', name: 'D' }, { lineStatus: 'SCHEDULED_FOR_PICKING', name: 'E' }, { lineStatus: 'DEPLOYED', name: 'F' }],
    R4: [{ lineStatus: 'DRAFT', name: 'G' }],
  };
  const kinds = {};
  queue.build(rows, lines, { now: NOW }).forEach((q) => { kinds[q.number] = q.kind; });
  const acts = (r, c) => { const a = list.actions(r, lines[r.requestNumber], kinds[r.requestNumber] || '', c); return [a.approve ? 'approve' : '', a.assign ? 'assign' : '', a.pick ? 'pick' + a.pick : ''].filter(Boolean).join('+') || 'none'; };
  T.eq('waiting: approve; approved without units: assign; units at the yard: pick 2; a draft: none', rows.map((r) => acts(r, can)).join(' | '), 'approve | assign | pick2 | none');
  T.eq('read-only on Approve & allocate: assign (to look), never approve', rows.map((r) => acts(r, { decide: false, assign: true, pick: false })).join(' | '), 'none | assign | none | none');
  T.eq('no access: nothing (fail closed)', rows.map((r) => acts(r, {})).join(' | '), 'none | none | none | none');
  T.eq('a request still waiting is never picked', list.actions({ status: 'SUBMITTED' }, [{ lineStatus: 'ALLOCATED' }], 'decide', can).pick, 0);

  // ── Help ────────────────────────────────────────────────────────────────────────────────────────────
  T.section('Help: the flow');
  T.eq('ten steps, in order', guide.STEPS.map((s) => s.key).join(), 'create,submit,approve,assign,pick,inspect,ship,onsite,return,back');
  const every = Object.keys({ DRAFT: 1, SUBMITTED: 1, QUOTE_GENERATED: 1, QUOTE_ACCEPTED: 1, IN_PROCESS: 1, APPROVED: 1, ALLOCATED: 1, UNDER_PROCUREMENT: 1,
    SCHEDULED_FOR_PICKING: 1, PICK_INITIATED: 1, PICK_RELEASED: 1, EQP_INSPECTION_COMPLETE: 1, INSPECTION_FAILED: 1, SHIP_TO_SITE: 1, SHIPPED: 1, DELIVERED: 1,
    DEPLOYED: 1, RETURN_INITIATED: 1, RETURN_IN_PROCESS: 1, SHIPPED_TO_YARD: 1, RETURNED: 1, CLOSED: 1, CONSUMED: 1 });
  T.eq('every status of the journey sits at a step', every.filter((c) => !guide.stepOf(c)).join(), '');
  T.eq('a customer request in process waits for approval', guide.stepOf('IN_PROCESS', true), 'approve');
  const cts = guide.counts(rows.concat([{ requestNumber: 'R5', status: 'REJECTED' }]), lines);
  T.eq('pieces now at each step', ['approve', 'assign', 'pick', 'ship', 'onsite', 'create', 'stopped'].map((k) => k + ':' + cts[k].pieces).join(' '),
    'approve:1 assign:2 pick:1 ship:1 onsite:1 create:1 stopped:1');
  T.eq('and on how many requests', cts.assign.requests, 2);
  const mine = guide.mine({ EQR_WORKBENCH: 'FULL', EQR_INITIATE_PICKING: 'READ_ONLY' }, true);
  T.eq('your steps: what your access lets you take', guide.STEPS.filter((s) => mine[s.key]).map((s) => s.key).join(), 'approve,assign,inspect');
  T.eq('none until access loads', Object.keys(guide.mine({ EQR_WORKBENCH: 'FULL' }, false)).filter((k) => guide.mine({ EQR_WORKBENCH: 'FULL' }, false)[k]).length, 0);
  const svg = guide.svg({ counts: cts, mine, selected: 'assign' });
  T.check('the diagram: a step per data-step, clickable', guide.STEPS.every((s) => svg.indexOf('data-step="' + s.key + '"') !== -1));
  T.check('the open step and your steps are marked', /hs-node--on" data-step="assign"/.test(svg.replace(/hs-node nx-stage--ready hs-node--mine /, '')) || /hs-node--mine hs-node--on" data-step="assign"/.test(svg));
  T.check('a badge where pieces are', /aria-label="Step 4: Assign units, 2 here now"/.test(svg));
  T.check('the loops are drawn', /sent back: fix, send again/.test(svg) && /failed: swap the unit/.test(svg));
  const d = guide.detail('pick', cts);
  T.eq('a step in detail', [d.n, d.title, d.lane, d.navId, d.chip].join(' | '), '5 | Pick at the yard | Yard | picking | ready');
  T.eq('its statuses in the screens\' words', d.statuses.map((s) => s.label).join(' | '), 'Waiting to be picked | Being picked at the yard | Being picked at the yard');
  T.eq('right now', d.now, '1 piece on 1 request are here now');
  const srows = guide.statusRows();
  T.check('every status listed, in flow order, with the customer case', srows[0].code === 'DRAFT' && srows.some((r) => r.code === 'IN_PROCESS (customer)') && srows.some((r) => r.code === 'REJECTED'));
  T.eq('a status row', ['code', 'step', 'label', 'next'].map((k) => srows.filter((r) => r.code === 'SUBMITTED')[0][k]).join(' | '),
    'SUBMITTED | 3. Approve or send back | Waiting for approval | Equipment Manager to approve it');

  // ── Hand-off, menu ──────────────────────────────────────────────────────────────────────────────────
  T.section('shellBus.focus: open a screen on one request');
  const sent = [];
  bus.register((r) => sent.push(r.action + ':' + (r.navId || '')));
  bus.focus('picking', { id: 7, number: 'R7' });
  T.eq('the tab opens', sent.join(), 'open:picking');
  T.eq('the screen takes it once', JSON.stringify([bus.takeFocus('picking'), bus.takeFocus('picking')]), '[{"id":7,"number":"R7"},null]');
  let woke = 0;
  bus.onFocus('approvals', () => { woke += 1; });
  bus.focus('approvals', { id: 1 });
  T.eq('an open screen is woken to take it', woke + ' ' + JSON.stringify(bus.takeFocus('approvals')), '1 {"id":1}');
  bus.onFocus('requests', () => { throw new Error('a closed page'); });
  bus.focus('requests', { stage: 'out' });
  T.eq('a closed screen\'s page failing keeps it for the next one', JSON.stringify(bus.takeFocus('requests')), '{"stage":"out"}');

  T.section('Help in the menu');
  const ALL = { EQR_DASHBOARD: 'FULL', EQR_EQUIPMENT_REQUESTS: 'FULL' };
  T.eq('not a menu group (it sits at the foot)', nav.visibleGroups(ALL, true, {}, true, {}).some((g) => g.key === 'help'), false);
  T.eq('open to everyone once access loads, and only then', [nav.itemVisible(nav.item('help'), {}, true, {}, true, {}), nav.itemVisible(nav.item('help'), ALL, false, {}, true, {})].join(), 'true,false');
  T.eq('the command bar finds it', nav.search('flow', nav.visibleGroups(ALL, true, {}, true, {})).map((r) => r.id).join(), 'help');
  T.eq('its screen', JSON.stringify(nav.routeOf(nav.item('help'))), '{"flow":"help","page":"help","params":{}}');

  T.report();
})().catch((e) => { console.error(e); process.exit(1); });
