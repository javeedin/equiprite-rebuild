/*
 * EquipRite Mobile, the Request tab (webApps/equiprite-mobile/flows/request, resources/js/mobileRequest.js).
 *
 * Checks, with the real shared modules loaded (orderForm, catalogCart, requestHeaderBody, requestLineBody, draftResume,
 * cartDrafts, offlineSnapshot, mapPicker, bipLov):
 *   - mobileRequest: the steps and their summaries, the words, the copy kept on the phone, where to start (drafts, sent
 *     back, order again), a request copied into a new one (fix, again)
 *   - the rules are Next's: each chain ported from Next's New request runs side by side with Next's own chain on the
 *     same inputs and makes the same calls (endpoints, parameters, audit headers, bodies, order) and the same changes;
 *     Submit and Save draft in every case (new, draft, a held draft, failures, quotes, agreements, a pinned point)
 *   - what the phone adds: nothing sent with no connection, the phone's copy, the start, carry on with a draft, fix a
 *     request sent back, order again, Use my location, the tab's count, the replace question
 *   - the page: every chain named exists and is used, bindings follow VB's rules, every function and listener used
 *     exists, every endpoint exists in services/, the styles are the tab's own
 *
 * Run:  node tests/mobile-request.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'webApps', 'equiprite-mobile');
const NEXT = path.join(ROOT, 'webApps', 'equiprite-next');
const JS = path.join(APP, 'resources', 'js');
const PAGE = path.join(APP, 'flows', 'request', 'pages');
const CHAINS = path.join(PAGE, 'request-page-chains');
const NEXT_CHAINS = path.join(NEXT, 'flows', 'order', 'pages', 'new-request-page-chains');

/** A fake Web Storage. */
function storage() {
  const m = new Map();
  return {
    get length() { return m.size; },
    key: (i) => Array.from(m.keys())[i] || null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
  };
}
const local = storage();
const session = storage();
const nav = { onLine: true };

function load(file, deps) {
  const sandbox = { console, setTimeout, Promise, URLSearchParams, Intl, Date, JSON, localStorage: local, sessionStorage: session,
    window: { localStorage: local, addEventListener: () => {} }, navigator: nav };
  let mod;
  sandbox.define = (names, factory) => { mod = factory(...names.map((n) => (deps && n in deps ? deps[n] : {}))); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: path.basename(file) });
  return mod;
}
const js = (name, deps) => load(path.join(JS, name + '.js'), deps);

let geoAnswer = { latitude: 31.85, longitude: -102.37, formattedAddress: '1200 Pipeline Rd, Odessa, Texas' };
const geocoder = { lookup: async () => geoAnswer };
const fmt = js('fmt');
const rules = js('rules');
const lineBody = js('requestLineBody');
const catalogCart = js('catalogCart');
const draftStorage = js('draftStorage');
const hdr = js('requestHeaderBody', { 'resources/js/geocoder': geocoder });
const draftResume = js('draftResume', { 'resources/js/requestHeaderBody': hdr, 'resources/js/catalogCart': catalogCart, 'resources/js/draftStorage': draftStorage });
const deliveryCoords = js('deliveryCoords', { 'resources/js/geocoder': geocoder });
const order = js('orderForm', { 'resources/js/requestLineBody': lineBody, 'resources/js/fmt': fmt });
const cartDrafts = js('cartDrafts', { 'resources/js/fmt': fmt, 'resources/js/rules': rules });
const snapshot = js('offlineSnapshot');
const realBip = js('bipLov');
const mr = js('mobileRequest', { 'resources/js/orderForm': order, 'resources/js/fmt': fmt, 'resources/js/cartDrafts': cartDrafts, 'resources/js/rules': rules });

const ROWS = [
  { eqrEquipmentMasterId: 11, equipmentName: 'CAT 320 Excavator', className: 'Excavators', subclassName: 'Crawler', eqrEquipmentClassId: 1,
    availabilityStatus: 'AVAILABLE', availableQty: 3, isRentable: true, rate: 1400, rateUom: 'DAY', periodAmount: 1400, periodType: 'DAILY' },
  { eqrEquipmentMasterId: 12, equipmentName: 'Mini Excavator 3.5t', className: 'Excavators', eqrEquipmentClassId: 1,
    availabilityStatus: 'NOT AVAILABLE', availableQty: 0, isRentable: true, rate: 300, rateUom: 'DAY' },
  { eqrEquipmentMasterId: 21, equipmentName: 'Trench safety kit', className: 'Safety', eqrEquipmentClassId: 2,
    availabilityStatus: 'PARTIAL QUANTITY', availableQty: 4, isRentable: false, unitPrice: 25, periodAmount: 25, periodType: 'DAILY' },
  { eqrEquipmentMasterId: 31, equipmentName: 'Dump truck 30t', className: 'Trucks', eqrEquipmentClassId: 3,
    availabilityStatus: 'PARTIAL DURATION', availableQty: 2, isRentable: true, rate: 800, rateUom: 'DAY', periodAmount: 4800, periodType: 'WEEKLY' },
];
const START = '2026-11-02';
const END = '2026-11-27';
const cart = [catalogCart.itemFromRow(ROWS[0], 2, null), catalogCart.itemFromRow(ROWS[2], 10, null), catalogCart.itemFromRow(ROWS[3], 1, null)];
cart[2].startDate = '2026-11-10';
const blank = order.emptyForm('Pat Lee', 'pat.lee');
const FORM = Object.assign({}, blank, {
  startDate: START, endDate: END,
  projectId: '300000123', projectNumber: 'PRJ-2026-001', projectName: 'Pipeline North', projectBuId: 300000001, projectBuName: 'EPC_US_BU',
  taskId: '300000777', taskNumber: '2.1', taskName: 'Trenching',
  customerId: '100000555', customerName: 'Acme Utilities', contractId: '300000999', contractNumber: 'K-77',
  locationType: 'PROJECT_SITE', location: '1200 Pipeline Rd, Odessa TX', hours: 8, notes: 'Gate 3',
});
const same = (name, a, b) => T.eq(name, JSON.stringify(a), JSON.stringify(b));

T.section('the steps, and what each holds');
T.eq('on the first step, nothing yet', mr.steps(1, blank, []).map((s) => s.n + ' ' + s.label + ' (' + s.sub + '):' + s.state).join(' | '),
  '1 Equipment (Nothing yet):current | 2 Project (Not chosen):todo | 3 Review ():todo');
T.eq('on the second, the pieces and the project', mr.steps(2, FORM, cart).map((s) => s.sub + ':' + s.state).join(' | '), '13 pieces:done | Pipeline North:current | Ready:todo');
T.eq('the title: new, or the draft held', [mr.title(null), mr.title({ id: 1, requestNumber: 'EQR-000888' })].join(' | '), 'New request | Draft EQR-000888');
T.eq('under it: the dates and the project, or what to do', [mr.subline(FORM), mr.subline(blank)].join(' | '),
  '2 Nov – 27 Nov 2026 · Pipeline North | Equipment and dates, then the project.');
T.eq('the cart button\'s count (pieces)', [mr.count([]), mr.count(cart), mr.count([Object.assign({}, cart[0], { quantity: 120 })])].join(','), ',13,99+');
T.eq('the cart in words', [mr.cartCount([]), mr.cartCount(cart), mr.cartCount([cart[2]])].join(' | '), 'Empty | 3 items · 13 pieces | 1 item');

T.section('the words a person reads');
T.eq('the total, as Next\'s rail', JSON.stringify(mr.totals(cart, FORM, false)), JSON.stringify({ total: '$87,450', note: '' }));
T.eq('no total before the dates', JSON.stringify(mr.totals([cart[0]], blank, false)), JSON.stringify({ total: '—', note: 'once the dates are in' }));
T.eq('above the catalog', [mr.catalogNote(4, 4, FORM), mr.catalogNote(1, 4, blank)].join(' | '),
  '4 items · free and priced for these dates | 1 of 4 items · pick the dates to see what is free');
T.eq('under a list', [mr.listNote('customer', [{}, {}], '', false), mr.listNote('project', [{}], 'pipe', false), mr.listNote('project', [], 'zzz', false),
  mr.listNote('project', [], '', true)].join(' | '),
'2 customers from Oracle Fusion. Type a name or number to narrow it. | 1 project matches “pipe”. | No project matches “zzz”. | Searching…');
T.eq('what is missing, in the screen\'s order (the customer first; orderForm.screenOrder)', mr.missingText(order.missingFor('review', blank, [])),
  'Still needed: Start date, End date, At least one piece of equipment, Customer, Project, Task and Delivery location.');
T.eq('the project, task and delivery on Review', [mr.projectText(FORM), mr.taskText(FORM), mr.deliveryText(FORM), mr.deliveryText(blank)].join(' | '),
  'PRJ-2026-001 Pipeline North · EPC_US_BU | 2.1 Trenching | 1200 Pipeline Rd, Odessa TX (a site on the contract) | ');
T.eq('a pinned point', [mr.pinText({ locationLatitude: 29.7604, locationLongitude: -95.3698 }), mr.coords({ lat: '', lng: 1 }), mr.coords(null)].join(' | '),
  'Pinned on the map · 29.76040, -95.36980 |  | ');
T.eq('what Submit does', [mr.submitWords(cart, null), mr.submitWords([cart[0]], { requestNumber: 'EQR-000888' })].join(' | '),
  'A new request with 3 lines goes to the project’s approver. You can follow it in My requests. | Draft EQR-000888 with 1 line goes to the project’s approver. You can follow it in My requests.');
T.eq('what Save draft does', [mr.draftWords(null), mr.draftWords({ requestNumber: 'EQR-000888' })].join(' | '),
  'Save draft keeps it in My requests as a draft. Nothing is sent for approval. | Save draft updates EQR-000888. Nothing is sent for approval.');
T.check('with no connection: nothing was sent, it is kept', mr.offlineText(true).startsWith('No connection: nothing was sent.') && mr.offlineText(false).includes('send it once the signal is back'));
T.eq('a card with no picture: the class\'s letters; a picture under the app path', [mr.initials('Lifting and Cranes'), mr.imageSrc('img/x.png', '/app/'),
  mr.imageSrc('https://h/y.png', '/app/'), mr.imageSrc('data:image/png;base64,x', '/app/'), mr.imageSrc('', '/app/')].join(' | '),
'LA | /app/img/x.png | https://h/y.png | data:image/png;base64,x | ');
T.eq('Use my location, when it cannot', ['denied', 'unsupported', 'timeout', 'other'].map((c) => mr.locateError(c).split('.')[0]).join(' | '),
  'Location is off for this app | This phone cannot share its location here | Your location took too long to find | Your location could not be found');
T.eq('the question before replacing', JSON.stringify(mr.replaceText({ number: 'REQ-2005', mode: 'draft' }, FORM, cart, { requestNumber: 'EQR-000778' })),
  JSON.stringify({ title: 'Open draft REQ-2005?', body: 'What you have started here (3 items · 13 pieces · Pipeline North) is cleared from this screen. Draft EQR-000778 stays saved as it was last saved.',
    go: 'Open REQ-2005' }));
T.eq('... for a fix and an order again', [mr.replaceText({ number: 'REQ-6', mode: 'fix' }, blank, [], null).title, mr.replaceText({ number: 'REQ-1', mode: 'again' }, blank, [], null).go,
  mr.replaceText({ number: 'REQ-1', mode: 'again' }, blank, [], null).body].join(' | '),
'Fix REQ-6? | Order again | What you have started here is cleared from this screen. It has not been saved.');
T.eq('before Start another', mr.resetText({ requestNumber: 'EQR-000778' }, cart),
  'The equipment and details here are cleared (3 items · 13 pieces). Draft EQR-000778 stays in My requests as it was last saved.');
T.eq('a cart line\'s second row', mr.lineAbout(order.cartLine(cart, 31, FORM, false)), 'Trucks · $4,800 / week · 10 Nov – 27 Nov 2026 · 18 days');
T.eq('started: anything entered; fresh: nothing in the cart and no draft held', [mr.started(blank, []), mr.started(Object.assign({}, blank, { notes: 'x' }), []),
  mr.started(blank, cart), mr.fresh([], null), mr.fresh([], { id: 1 }), mr.fresh(cart, null)].join(), 'false,true,true,true,false,false');

T.section('the copy kept on the phone');
const keptOne = mr.keep({ form: FORM, cart, step: 2, resume: { id: 888, requestNumber: 'EQR-000888' }, agreementId: '12', agreementLineMap: { 31: 9 }, catalogRows: ROWS });
T.eq('plain values, only what is being raised (not the catalog)', Object.keys(keptOne).join(), 'v,form,cart,step,resume,agreementId,agreementLineMap');
const back = mr.restore(JSON.parse(JSON.stringify(keptOne)), 'Pat Lee', 'pat.lee');
T.eq('back as it was', [back.form.projectName, back.cart.length, back.step, back.resume.requestNumber, back.agreementId, back.agreementLineMap[31]].join(), 'Pipeline North,3,2,EQR-000888,12,9');
T.eq('the form takes the empty form\'s shape first (a field added since is there)', 'isSoftReservation' in mr.restore({ v: 1, form: { notes: 'x' }, cart: [] }, '', '').form, true);
T.eq('nothing worth keeping, another shape or junk: nothing back', [mr.restore({ v: 1, form: blank, cart: [] }), mr.restore({ v: 2, form: FORM, cart }), mr.restore(null),
  mr.restore({ v: 1, form: 'x', cart: [] })].join(), ',,,');
T.eq('a step out of range is held to the three', mr.restore({ v: 1, form: FORM, cart: [], step: 9 }).step, 3);

T.section('where to start: carry on, fix, order again');
const now = Date.parse('2026-10-30T09:00:00Z');
const who = ['priya.raman', 'Priya Raman'];
const REQS = [
  { eqrEquipmentRequestId: 9, requestNumber: 'REQ-9', status: 'DRAFT', projectName: 'Gas Line', requestorUsername: 'priya.raman', lastUpdatedDate: '2026-10-28' },
  { eqrEquipmentRequestId: 8, requestNumber: 'REQ-8', status: 'REJECTED', projectName: 'Pier B', requestorUsername: 'priya.raman', startDate: '2026-11-16', endDate: '2026-11-27' },
  { eqrEquipmentRequestId: 7, requestNumber: 'REQ-7', status: 'IN_PROCESS', projectName: 'Plant C', requestorUsername: 'priya.raman', startDate: '2026-09-01', endDate: '2026-09-20' },
  { eqrEquipmentRequestId: 6, requestNumber: 'REQ-6', status: 'SUBMITTED', projectName: 'Dock', requestorUsername: 'dana.cole' },
  { eqrEquipmentRequestId: 5, requestNumber: 'REQ-5', status: 'CLOSED', projectName: 'Yard', requestorUsername: 'priya.raman', requestOrigin: 'Customer' },
  { eqrEquipmentRequestId: 4, requestNumber: 'REQ-4', status: 'CLOSED', projectName: 'Mine', requestorUsername: 'priya.raman' },
];
const LINES = {
  'REQ-9': [{ name: 'Crane', qty: 1 }], 'REQ-8': [{ name: 'Wheel Loader 950', qty: 1 }], 'REQ-7': [{ name: 'Dozer', qty: 1 }, { name: 'Light Tower', qty: 2 }, { name: 'Pump', qty: 1 }],
  'REQ-6': [{ name: 'Saw', qty: 1 }], 'REQ-5': [{ name: 'Truck', qty: 1 }],
};
const mine = cartDrafts.list(REQS, LINES, who, now).mine;
const carry = mr.carryOn(mine, REQS, LINES, who, 5);
T.eq('your drafts, then what was sent back to you', carry.cards.map((c) => c.number + ':' + c.pill + ':' + c.stage).join(' | '), 'REQ-9:Draft:draft | REQ-8:Sent back:stopped');
T.eq('each in words', [carry.cards[0].about, carry.cards[1].about, carry.cards[1].saved, carry.cards[1].dates].join(' | '),
  '1 piece · Crane | 1 piece · Wheel Loader 950 | Sent back: fix it and send it again | 16 Nov – 27 Nov 2026');
T.eq('drafts past the first few: how many more', mr.carryOn(mine.concat(mine, mine), [], {}, who, 2).more, 1);
const again = mr.recent(REQS, LINES, who, 4);
T.eq('order again: your past project requests with equipment (not drafts, not sent back, not others\', not customer requests, not empty)',
  again.map((r) => r.number).join(), 'REQ-7');
T.eq('... in words', [again[0].party, again[0].about, again[0].dates].join(' | '), 'Plant C | 4 pieces · Dozer, Light Tower and 1 more | 1 Sep – 20 Sep 2026');

T.section('a request copied into a new one');
const SENT_BACK = { id: 2006, requestNumber: 'REQ-2006', status: 'REJECTED', requestType: 'INTERNAL', projectRefId: 300000123, projectNumber: 'PRJ-2026-001',
  projectName: 'Pipeline North', projectBuName: 'EPC_US_BU', projectBuId: 300000001, taskId: 3, taskNumber: '2.1', taskName: 'Trenching', requestorName: 'Dana Cole',
  requestorUsername: 'dana.cole', projectInternalCustomerId: 100000555, projectInternalCustomer: 'Acme Utilities', deliveryLocationType: 'DELIVERY_LOCATION',
  attribute1: '1 Main St', attribute2: 'Smaller loader please', defaultHours: 8, eqrAgreementHeaderId: 12,
  requestedStartDate: '2026-11-16T00:00:00Z', requestedEndDate: '2026-11-27T00:00:00Z' };
const priced = { items: [Object.assign(catalogCart.itemFromRow(ROWS[3], 1, null), { startDate: '2026-11-20', notes: 'With operator' })], missing: [{}], agreementLineIdByEquipmentId: { 31: 9001 } };
const fix = mr.copyOf(hdr.toFlowState(SENT_BACK), priced, 'fix', SENT_BACK, { name: 'Priya Raman', actor: 'priya.raman' });
T.eq('fix: everything, its dates and notes too; you are the requester', [fix.form.projectId, fix.form.taskId, fix.form.customerId, fix.form.location, fix.form.startDate,
  fix.form.endDate, fix.form.notes, fix.form.hours, fix.form.requestorName, fix.form.requestorUsername, fix.form.requestType].join(' | '),
'300000123 | 3 | 100000555 | 1 Main St | 2026-11-16 | 2026-11-27 | Smaller loader please | 8 | Priya Raman | priya.raman | INTERNAL');
T.eq('... the lines with their own dates and notes, the agreement', [fix.cart[0].startDate, fix.cart[0].notes, fix.agreementId, fix.agreementLineMap[31]].join(), '2026-11-20,With operator,12,9001');
T.eq('... saying so', fix.notice, 'REQ-2006 was sent back. It is copied into a new request here: put right what is needed and send it again. REQ-2006 itself stays as it was. '
  + '1 line is no longer in the catalog, so it was left out.');
const ag = mr.copyOf(hdr.toFlowState(SENT_BACK), priced, 'again', SENT_BACK, { name: 'Priya Raman', actor: 'priya.raman' });
T.eq('order again: the equipment, project, customer and delivery; new dates, no notes', [ag.form.projectName, ag.form.customerName, ag.form.location, ag.form.startDate,
  ag.form.endDate, ag.form.notes, 'startDate' in ag.cart[0], ag.cart[0].notes, ag.agreementId].join(' | '),
'Pipeline North | Acme Utilities | 1 Main St |  |  |  | false | With operator | ');
T.check('the copy is plain (no shared objects)', ag.cart[0] !== priced.items[0] && fix.cart[0] !== priced.items[0]);

// ── Chains: the fakes ───────────────────────────────────────────────────────────────────────────────────────────
const HEADERS = {
  888: { id: 888, requestNumber: 'EQR-000888', status: 'DRAFT', requestType: 'INTERNAL', projectRefId: 300000123, projectNumber: 'PRJ-2026-001', projectName: 'Pipeline North',
    projectBuName: 'EPC_US_BU', taskId: 3, taskNumber: '2.1', taskName: 'Trenching', requestorName: 'John Dunbar', projectInternalCustomerId: 100000555,
    projectInternalCustomer: 'Acme Utilities', attribute1: '1 Main St', attribute2: 'Gate code 4417', shipToSiteId: 55,
    requestedStartDate: '2026-12-01T00:00:00Z', requestedEndDate: '2026-12-14T00:00:00Z' },
  889: { id: 889, requestNumber: 'EQR-000889', status: 'DRAFT', requestType: 'EXTERNAL' },
  2006: SENT_BACK,
};
const HLINES = { 888: [{ eqrEquipmentMasterId: 31, quantity: 2 }, { eqrEquipmentMasterId: 99, quantity: 1 }], 2006: [{ eqrEquipmentMasterId: 31, quantity: 1, lineNotes: 'With operator' }] };
function fakeActions(fail) {
  const calls = [];
  const Actions = {
    async callRest(context, o) {
      calls.push({ endpoint: o.endpoint, uriParams: o.uriParams, headers: o.headers, body: o.body });
      if (fail === o.endpoint) return { ok: false, status: 500, body: { message: 'boom' } };
      if (o.endpoint === 'eqp-v1/createEquipmentRequest') return { ok: true, status: 201, body: { id: 501, requestNumber: 'EQR-000501' } };
      if (o.endpoint === 'eqp-v1/createShipToSite') return { ok: true, status: 201, body: { id: 55 } };
      if (o.endpoint === 'eqp-v1/getEquipriteV1EquipmentRequestById') {
        const h = HEADERS[o.uriParams.id];
        return h ? { ok: true, status: 200, body: h } : { ok: false, status: 404, body: {} };
      }
      if (o.endpoint === 'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2') return { ok: true, status: 200, body: { data: HLINES[o.uriParams.requestId] || [] } };
      if (o.endpoint === 'eqp-v1/getEquipriteV1ViewsEquipmentCatalog') {
        return { ok: true, status: 200, body: { data: ROWS.map((r) => Object.assign({}, r, o.uriParams.projectRefId && r.eqrEquipmentMasterId === 11 ? { rate: 1260 } : {})) } };
      }
      if (o.endpoint === 'bipService/runBIPReport') {
        const rows = /CUSTOMERS/.test(o.body) ? [{ CUSTOMERID: '100000555', CUSTOMER: 'Acme Utilities', CUSTOMERNUMBER: 'C-1' }]
          : /CONTRACTS/.test(o.body) ? [{ CONTRACT_ID: '300000999', CONTRACT_NUMBER: 'K-77', STATUS: 'ACTIVE' }]
            : /SITES/.test(o.body) ? [{ SITE_ADDRESS: '1200 Pipeline Rd', CUSTOMER_NAME: 'Acme' }]
              : [{ PROJECTID: '300000123', PROJECTNAME: 'Pipeline North', PROJECTNUMBER: 'PRJ-2026-001' }];
        return { ok: true, status: 200, body: { rows } };
      }
      if (/ProjectTasks$/.test(o.endpoint)) return { ok: true, status: 200, body: { items: [{ TaskId: 1, TaskNumber: '1', ParentTaskId: null }, { TaskId: 3, TaskNumber: '2.1', TaskName: 'Trenching', ParentTaskId: 1 }] } };
      if (/ProjectsById|projects/i.test(o.endpoint)) return { ok: true, status: 200, body: { BusinessUnitId: 300000001, BusinessUnitName: 'EPC_US_BU' } };
      return { ok: true, status: 200, body: {} };
    },
    async callChain(context, o) { calls.push({ chain: o.chain, params: o.params }); },
  };
  return { calls, Actions };
}
function fakeBus() {
  const sent = [];
  const waiting = {};
  return { sent, waiting, open: (r) => sent.push('open ' + JSON.stringify(r)), close: (id) => sent.push('close ' + id), rename: (id, t) => sent.push('rename ' + id + '=' + t),
    toast: (m, tone) => sent.push('toast ' + (tone || 'info') + ': ' + m), badge: (tab, n) => sent.push('badge ' + tab + '=' + n),
    focus: (tab, what) => sent.push('focus ' + tab + ' ' + JSON.stringify(what)),
    takeFocus: (tab) => { const w = waiting[tab] || null; delete waiting[tab]; return w; } };
}
const DATA = { rows: REQS.concat([{ eqrEquipmentRequestId: 888, requestNumber: 'EQR-000888', status: 'DRAFT', requestorUsername: 'pat.lee' },
  { eqrEquipmentRequestId: 889, requestNumber: 'EQR-000889', status: 'DRAFT', requestorUsername: 'pat.lee' },
  { eqrEquipmentRequestId: 2006, requestNumber: 'REQ-2006', status: 'REJECTED', requestorUsername: 'pat.lee' }]), linesByRequest: LINES };
const requestData = { n: 0, loads: [], invalidate() { this.n += 1; }, async load(ctx, A, o) { this.loads.push(o || {}); return DATA; } };
const cu = { auditHeaders: () => ({ 'X-User-Id': 'pat.lee' }), auditActor: () => 'pat.lee', displayName: () => 'Pat Lee' };
const bipFake = { buildSoapBody: realBip.buildSoapBody, decodeReportRows: (body, tag, id, label, label2) => ((body && body.rows) || [])
  .map((r) => Object.assign({}, r, { id: r[id] || '', label: r[label] || '', label2: label2 ? (r[label2] || '') : '' })) };

function context(form, cartItems, extra, app) {
  const variables = Object.assign({ id: '', number: '', draftId: '', startStep: '', view: 'form', step: 1, form, cart: cartItems, isSubmitting: false, missing: [], resume: null,
    agreementId: null, agreementLineMap: {}, saveError: '', sent: null, mode: 'build', catalogRows: ROWS, catalogText: '', catalogClass: 'all', catalogAvail: '',
    catalogLimit: 20, hideRates: false, taskOptions: [], contractOptions: [], projectResults: [], customerResults: [], projectQuery: '', customerQuery: '', taskQuery: '',
    siteOptions: [], sheet: '', lineOpen: 0, pending: null, notice: '', isLoading: false, loadError: '', externalDraftId: 0, priceNote: '', online: true,
    drafts: [], draftMore: 0, recent: [], canCustomer: false, requestFor: 'project',
    mapDlg: { open: false, query: '', results: [], picked: null, error: '', searching: false, locating: false, note: '' } }, extra || {});
  const fnLog = [];
  return {
    fnLog,
    $page: { variables, functions: { syncInputs: (f, t) => fnLog.push('sync ' + (f && f.endDate) + (t !== undefined ? ' search' : '')), toTop: (s) => fnLog.push('top ' + s),
      showInTrack: async (id, n) => fnLog.push('track ' + id + ' ' + n) } },
    $application: { variables: Object.assign({ jwt: '', globalSettings: {}, flagsLoaded: true, featureFlags: {}, fusionRoles: [], sessionRoles: [], sessionRolesLoaded: true }, app || {}),
      user: { username: 'pat.lee' } },
  };
}
const ActionChain = class {};
const MODS = { 'resources/js/currentUser': cu, 'resources/js/requestLineBody': lineBody, 'resources/js/requestHeaderBody': hdr, 'resources/js/orderForm': order,
  'resources/js/requestData': requestData, 'resources/js/rules': rules, 'resources/js/catalogCart': catalogCart, 'resources/js/deliveryCoords': deliveryCoords,
  'resources/js/draftResume': draftResume, 'resources/js/draftStorage': draftStorage, 'resources/js/bipLov': bipFake, 'resources/js/cartDrafts': cartDrafts,
  'resources/js/offlineSnapshot': snapshot, 'resources/js/mobileRequest': mr, 'resources/js/projectTaskTree': js('projectTaskTree'),
  'resources/js/projectBusinessUnit': { fetchForProject: async () => ({ id: 300000001, name: 'EPC_US_BU' }) } };
function chain(name, Actions, bus, more) {
  return load(path.join(CHAINS, name + '.js'), Object.assign({ 'vb/action/actionChain': ActionChain, 'vb/action/actions': Actions, 'resources/js/mobileBus': bus || fakeBus() },
    MODS, more || {}));
}
function nextChain(name, Actions, more) {
  return load(path.join(NEXT_CHAINS, name + '.js'), Object.assign({ 'vb/action/actionChain': ActionChain, 'vb/action/actions': Actions, 'resources/js/shellBus': fakeBus() },
    MODS, more || {}));
}
// The placeholder number (REQ- and the time) differs from run to run; everything else must be the same.
const rest = (calls) => JSON.stringify(calls.filter((x) => x.endpoint)).replace(/REQ-\d{10,}/g, 'REQ-#');
const ends = (calls) => calls.filter((x) => x.endpoint).map((x) => x.endpoint.replace('eqp-v1/', '')).join(' > ');
const chainsCalled = (calls) => calls.filter((x) => x.chain && x.chain !== 'keepChain').map((x) => x.chain + JSON.stringify(x.params || {})).join(' ');

/** Next's chain and Mobile's, side by side on the same inputs. */
async function sideBySide(name, make, params, opts) {
  const o = opts || {};
  const a = fakeActions(o.fail);
  const b = fakeActions(o.fail);
  const cn = make();
  const cm = make();
  const N = nextChain(name, a.Actions, o.more);
  const M = chain(name, b.Actions, null, o.more);
  await new N().run(cn, params);
  await new M().run(cm, params);
  return { next: { calls: a.calls, v: cn.$page.variables }, mobile: { calls: b.calls, v: cm.$page.variables, ctx: cm } };
}
const pick = (v, keys) => JSON.stringify(keys.map((k) => v[k]));

(async () => {
  T.section('Submit and Save draft: Next\'s calls, order, bodies, guards and audit headers');
  const pinned = Object.assign({}, FORM, { locationType: 'DELIVERY_LOCATION', location: '1210 Pipeline Rd, Odessa', locationLatitude: 31.851, locationLongitude: -102.371, locationPinned: true });
  const held = { id: 888, requestNumber: 'EQR-000888', attribute1: '1200 Pipeline Rd, Odessa TX', shipToSiteId: 5 };
  const CASES = [
    ['a new request, submitted', () => context(FORM, cart), { mode: 'submit' }],
    ['a new request, saved as a draft', () => context(FORM, cart), { mode: 'draft' }],
    ['a held draft, saved in place', () => context(FORM, cart, { resume: held }), { mode: 'draft' }],
    ['a held draft, submitted', () => context(FORM, cart, { resume: held }), { mode: 'submit' }],
    ['a held draft whose address changed', () => context(Object.assign({}, FORM, { location: '9 New Rd' }), cart, { resume: held }), { mode: 'draft' }],
    ['a point pinned on the map', () => context(pinned, cart), { mode: 'submit' }],
    ['a quote coming (no prices posted)', () => context(FORM, cart, {}, { globalSettings: { ENABLE_QUOTES: 'PROJECTS' } }), { mode: 'submit' }],
    ['an agreement request', () => context(FORM, [Object.assign({}, cart[0], { source: 'agreement' })], { agreementId: 12, agreementLineMap: { 11: 9001 } }), { mode: 'submit' }],
    ['a draft with only dates and equipment', () => context(Object.assign({}, blank, { startDate: START, endDate: END }), cart), { mode: 'draft' }],
    ['something missing: nothing called', () => context(Object.assign({}, FORM, { taskId: null }), cart), { mode: 'submit' }],
  ];
  for (const [name, make, params] of CASES) {
    const r = await sideBySide('submitChain', make, params);
    T.check(name + ': the same calls as Next (' + (ends(r.next.calls) || 'none') + ')', rest(r.next.calls) === rest(r.mobile.calls) && rest(r.next.calls) !== '',
      rest(r.mobile.calls).slice(0, 400));
    T.eq(name + ': the same request held after', pick(r.mobile.v, ['resume', 'missing']), pick(r.next.v, ['resume', 'missing']));
  }
  for (const fail of ['eqp-v1/createEquipmentRequest', 'eqp-v1/createRequestLinesBatch', 'eqp-v1/createShipToSite', 'eqp-v1/patchEquipmentRequest']) {
    const r = await sideBySide('submitChain', () => context(FORM, cart), { mode: 'submit' }, { fail });
    T.check('a failure at ' + fail.replace('eqp-v1/', '') + ': the same calls, the same words', rest(r.next.calls) === rest(r.mobile.calls)
      && r.next.v.saveError === r.mobile.v.saveError.replace('My requests', 'Requests'), r.mobile.v.saveError);
  }
  {
    const r = await sideBySide('submitChain', () => context(FORM, cart, { resume: held }), { mode: 'submit' }, { fail: 'eqp-v1/replaceRequestLinesBatch' });
    T.check('a held draft whose lines fail: kept as it was, the same words', rest(r.next.calls) === rest(r.mobile.calls) && r.next.v.saveError === r.mobile.v.saveError);
  }
  {
    const { calls, Actions } = fakeActions();
    await new (chain('submitChain', Actions))().run(context(FORM, cart), { mode: 'submit' });
    const w = calls.filter((x) => x.endpoint);
    T.eq('the audit headers on the header and the lines (where Next sends them)', w.map((x) => x.endpoint.replace('eqp-v1/', '') + (x.headers && x.headers['X-User-Id'] ? '+audit' : '')).join(' > '),
      'createEquipmentRequest+audit > createShipToSite > patchEquipmentRequest > createRequestLinesBatch+audit > patchEquipmentRequest');
  }

  T.section('Submit and Save draft on a phone');
  {
    const { calls, Actions } = fakeActions();
    const bus = fakeBus();
    const c = context(FORM, cart);
    const before = requestData.n;
    await new (chain('submitChain', Actions, bus))().run(c, { mode: 'submit' });
    T.eq('the shared requests are refreshed', requestData.n - before, 1);
    T.eq('a toast with the new number', bus.sent.join(' | '), 'toast info: Request EQR-000501 was sent for approval.');
    T.eq('then: a new request, saying what was sent; the drafts read again for the tab\'s count', chainsCalled(calls),
      'resetChain{"sent":{"id":501,"number":"EQR-000501","mode":"submit","about":"3 items · 13 pieces · Pipeline North"}} draftsChain{"refresh":true}');
    T.eq('the busy flag is cleared', c.$page.variables.isSubmitting, false);
  }
  {
    const { calls, Actions } = fakeActions();
    const bus = fakeBus();
    const c = context(FORM, cart);
    await new (chain('submitChain', Actions, bus))().run(c, { mode: 'draft' });
    T.eq('a draft: held here to save in place next time', JSON.stringify(c.$page.variables.resume),
      JSON.stringify({ id: 501, requestNumber: 'EQR-000501', attribute1: '1200 Pipeline Rd, Odessa TX', shipToSiteId: 55 }));
    T.eq('... it stays, says so, the phone keeps it, the count is read again', [c.$page.variables.sent.mode, bus.sent.join(), calls.filter((x) => x.chain).map((x) => x.chain).join()].join(' | '),
      'draft | toast info: Draft EQR-000501 was saved. Nothing was sent for approval. | keepChain,draftsChain');
  }
  {
    const { calls, Actions } = fakeActions();
    const bus = fakeBus();
    const c = context(FORM, cart);
    nav.onLine = false;
    await new (chain('submitChain', Actions, bus))().run(c, { mode: 'submit' });
    await new (chain('submitChain', Actions, bus))().run(c, { mode: 'draft' });
    nav.onLine = true;
    T.eq('no connection: nothing is sent', calls.length, 0);
    T.check('... and it says so, in words and a toast', c.$page.variables.saveError.startsWith('No connection: nothing was sent.') && bus.sent.length === 2
      && bus.sent.every((s) => s.startsWith('toast warning: No connection')) && c.$page.variables.isSubmitting === false && c.$page.variables.online === false);
  }
  {
    const { calls, Actions } = fakeActions();
    const c = context(FORM, cart);
    const s = new (chain('submitChain', Actions))();
    await Promise.all([s.run(c, { mode: 'submit' }), s.run(c, { mode: 'submit' })]);
    T.eq('a double tap creates one request', calls.filter((x) => x.endpoint === 'eqp-v1/createEquipmentRequest').length, 1);
    const pre = fakeActions();
    await new (chain('submitChain', pre.Actions))().run(context(FORM, cart), { mode: '' });
    T.eq('loaded early (no mode): does nothing', pre.calls.length, 0);
  }

  T.section('the other chains Next has: the same calls and changes');
  {
    const run = async (params, make) => sideBySide('cartChain', make || (() => context(FORM, cart.slice(), { missing: ['Task'] })), params);
    for (const p of [{ action: 'add', id: '12' }, { action: 'add', id: '11' }, { action: 'inc', id: '21' }, { action: 'dec', id: '31' }, { action: 'set', id: '11', value: '0' },
      { action: 'remove', id: '21' }, { action: 'line', id: '11', field: 'notes', value: 'With operator' }, { action: 'line', id: '31', field: 'startDate', value: '' }]) {
      const r = await run(p);
      T.eq('cart ' + JSON.stringify(p), pick(r.mobile.v, ['cart', 'missing', 'saveError']), pick(r.next.v, ['cart', 'missing', 'saveError']));
    }
    const r = await run({ action: 'add', id: '11' });
    T.eq('the phone keeps the cart after a change', r.mobile.calls.map((x) => x.chain).join(), 'keepChain');
    const none = await run({ action: '' });
    T.eq('loaded early (no action): nothing changes', none.mobile.calls.length + ':' + none.mobile.v.cart.length, '0:3');
  }
  {
    const make = () => context(Object.assign({}, blank, { startDate: START, projectId: 1, locationType: 'PROJECT_SITE', location: 'old site', locationLatitude: 1, locationLongitude: 2 }), [],
      { contractOptions: [{ id: '300000999', label: 'K-77' }], taskOptions: [{ TaskId: 3, TaskNumber: '2.1', TaskName: 'Trenching' }], missing: ['Task'], sheet: 'task' });
    for (const p of [{ field: 'length', value: '14' }, { field: 'startDate', value: '2026-11-05' }, { field: 'taskId', value: '3' }, { field: 'contractId', value: '300000999' },
      { field: 'siteAddress', value: '1200 Pipeline Rd' }, { field: 'locationType', value: 'DELIVERY_LOCATION' }, { field: 'location', value: '1 Main St' },
      { field: 'hours', value: '8' }, { field: 'notes', value: 'set by the page', from: 'external' }, { field: 'notes', value: 'typed', from: 'internal' }, { field: 'taskQuery', value: 'tr' }]) {
      const r = await sideBySide('setFieldChain', make, p);
      T.eq('field ' + JSON.stringify(p) + ': the same form, the same chains', pick(r.mobile.v, ['form', 'missing', 'taskQuery']) + chainsCalled(r.mobile.calls),
        pick(r.next.v, ['form', 'missing', 'taskQuery']) + chainsCalled(r.next.calls));
    }
    const t = await sideBySide('setFieldChain', make, { field: 'taskId', value: '3' });
    T.eq('a task picked closes its sheet', t.mobile.v.sheet, '');
    const len = await sideBySide('setFieldChain', make, { field: 'length', value: '7' });
    T.eq('a quick length puts the end date in the inputs', len.mobile.ctx.fnLog.join(), 'sync 2026-11-08');
  }
  {
    const make = () => context(Object.assign({}, FORM, { projectId: null, taskId: 7, contractId: 9 }), cart, {
      projectResults: [{ id: '300000123', label: 'Pipeline North', sub: 'PRJ-2026-001' }], customerResults: [{ id: '100000555', label: 'Acme Utilities' }], sheet: 'project' });
    for (const p of [{ kind: 'project', index: '0' }, { kind: 'customer', index: '0' }, { kind: 'project', index: '-1' }, { kind: 'customer', index: '5' }]) {
      const r = await sideBySide('pickChain', make, p);
      T.eq('pick ' + JSON.stringify(p) + ': the same form, lists and chains', pick(r.mobile.v, ['form', 'projectResults', 'customerResults', 'taskOptions', 'siteOptions'])
        + chainsCalled(r.mobile.calls), pick(r.next.v, ['form', 'projectResults', 'customerResults', 'taskOptions', 'siteOptions']) + chainsCalled(r.next.calls));
    }
    const r = await sideBySide('pickChain', make, { kind: 'project', index: '0' });
    T.eq('picked: the sheet closes', r.mobile.v.sheet, '');
  }
  {
    for (const [name, make, p] of [
      ['no equipment', () => context(Object.assign({}, FORM), [], { step: 1 }), { step: '2' }],
      ['on to the project', () => context(Object.assign({}, FORM, { customerId: null, projectId: null }), cart, { step: 1 }), { step: '2' }],
      ['back', () => context(FORM, cart, { step: 2 }), { step: '1' }],
      ['to Review', () => context(FORM, cart, { step: 2 }), { step: '3' }],
    ]) {
      const r = await sideBySide('goStepChain', make, p);
      T.eq('steps: ' + name, pick(r.mobile.v, ['step', 'mode', 'missing']) + chainsCalled(r.mobile.calls), pick(r.next.v, ['step', 'mode', 'missing']) + chainsCalled(r.next.calls));
    }
    for (const [name, make, p] of [
      ['complete', () => context(FORM, cart, { step: 2 }), { to: 'review' }],
      ['a task missing', () => context(Object.assign({}, FORM, { taskId: null }), cart, { step: 2 }), { to: 'review' }],
      ['dates missing', () => context(Object.assign({}, FORM, { startDate: '' }), cart, { step: 2 }), { to: 'review' }],
      ['pinned', () => context(pinned, cart, { step: 2 }), { to: 'review' }],
      ['back to editing', () => context(FORM, cart, { step: 3, mode: 'review' }), { to: 'build' }],
    ]) {
      const r = await sideBySide('reviewChain', make, p);
      T.eq('Review: ' + name, pick(r.mobile.v, ['step', 'mode', 'missing', 'form']) + chainsCalled(r.mobile.calls),
        pick(r.next.v, ['step', 'mode', 'missing', 'form']) + chainsCalled(r.next.calls));
    }
  }
  {
    const make = () => context(Object.assign({}, FORM, { locationLatitude: 31.85, locationLongitude: -102.37 }), [cart[0], cart[1]]);
    const r = await sideBySide('loadCatalogChain', make, {});
    T.eq('the catalog: the same parameters', rest(r.mobile.calls), rest(r.next.calls));
    T.eq('... the cart priced again the same way, saying so', pick(r.mobile.v, ['cart', 'priceNote', 'catalogRows']), pick(r.next.v, ['cart', 'priceNote', 'catalogRows']));
    const b = await sideBySide('loadCatalogChain', () => context(blank, []), {});
    T.eq('nothing unknown is sent', rest(b.mobile.calls), rest(b.next.calls));
    const f = await sideBySide('loadCatalogChain', make, {}, { fail: 'eqp-v1/getEquipriteV1ViewsEquipmentCatalog' });
    T.eq('a failed catalog: the same words', f.mobile.v.catalogError, f.next.v.catalogError);
    nav.onLine = false;
    const off = fakeActions('eqp-v1/getEquipriteV1ViewsEquipmentCatalog');
    const co = make();
    await new (chain('loadCatalogChain', off.Actions))().run(co);
    nav.onLine = true;
    T.eq('with no connection it says so', co.$page.variables.catalogError, 'The catalog needs a connection.');
    const ap = await sideBySide('applyCatalogChain', () => context(FORM, [], { catalogClass: 'Gone', catalogAvail: 'free', catalogLimit: 2 }), {});
    T.eq('what the list shows: the same', pick(ap.mobile.v, ['catalogClass', 'catalogCount', 'catalogShown', 'classChips']), pick(ap.next.v, ['catalogClass', 'catalogCount', 'catalogShown', 'classChips']));
    const more = await sideBySide('filterCatalogChain', () => context(FORM, []), { more: true });
    T.eq('Show more: 20 more on a phone (40 on Next)', [more.mobile.v.catalogLimit, more.next.v.catalogLimit].join(), '40,60');
    for (const p of [{ text: 'truck' }, { cls: 'Excavators' }, { avail: 'true' }, { avail: 'false' }]) {
      const r2 = await sideBySide('filterCatalogChain', () => context(FORM, []), p);
      T.eq('filter ' + JSON.stringify(p), pick(r2.mobile.v, ['catalogText', 'catalogClass', 'catalogAvail']) + chainsCalled(r2.mobile.calls),
        pick(r2.next.v, ['catalogText', 'catalogClass', 'catalogAvail']) + chainsCalled(r2.next.calls));
    }
  }
  {
    for (const p of [{ kind: 'customer', text: '' }, { kind: 'project', text: 'pipe & co' }]) {
      const r = await sideBySide('searchChain', () => context(FORM, cart), p);
      T.eq('the BIP lists ' + JSON.stringify(p) + ': the same SOAP bodies and rows', rest(r.mobile.calls) + pick(r.mobile.v, ['customerResults', 'projectResults']),
        rest(r.next.calls) + pick(r.next.v, ['customerResults', 'projectResults']));
    }
    const lp = await sideBySide('loadProjectListsChain', () => context(Object.assign({}, FORM, { projectBuName: '', contractId: '300000999' }), cart), { withBusinessUnit: true });
    T.eq('the project\'s tasks, contracts and business unit: the same', rest(lp.mobile.calls) + pick(lp.mobile.v, ['taskOptions', 'contractOptions', 'form']) + chainsCalled(lp.mobile.calls),
      rest(lp.next.calls) + pick(lp.next.v, ['taskOptions', 'contractOptions', 'form']) + chainsCalled(lp.next.calls));
    const ls = await sideBySide('loadSitesChain', () => context(FORM, cart), {});
    T.eq('the contract\'s sites: the same', rest(ls.mobile.calls) + pick(ls.mobile.v, ['siteOptions', 'sitesLoaded']), rest(ls.next.calls) + pick(ls.next.v, ['siteOptions', 'sitesLoaded']));
  }

  T.section('the delivery point: the map, and Use my location');
  {
    const shown = [];
    let here = { lat: 29.7604, lng: -95.3698, accuracy: 12 };
    const fns = { mapOpen: async (p) => { shown.push('open ' + JSON.stringify(p)); return true; }, mapShow: (p) => shown.push('show ' + p.label), mapClose: () => shown.push('close'),
      locate: async () => here, syncInputs: (f) => shown.push('sync ' + f.location) };
    const picker = { search: async (q) => (q.includes('Pipeline') ? [{ label: '1200 Pipeline Rd, Odessa', lat: 31.85, lng: -102.37 }] : []),
      reverse: async (lng, lat) => ({ label: 'Main St, Houston', lat, lng }) };
    const both = async (make, steps) => {
      const n = make();
      const m = make();
      n.$page.functions = fns;
      m.$page.functions = fns;
      const N = nextChain('mapChain', {}, { 'resources/js/mapPicker': picker });
      const M = chain('mapChain', fakeActions().Actions, null, { 'resources/js/mapPicker': picker });
      for (const p of steps) {
        await new N().run(n, p);
        await new M().run(m, p);
      }
      return [n.$page.variables, m.$page.variables];
    };
    const make = () => context(Object.assign({}, FORM, { locationType: 'DELIVERY_LOCATION', location: '1200 Pipeline Rd', locationLatitude: null, locationLongitude: null }), cart,
      { missing: ['Delivery location'] });
    const [nv, mv] = await both(make, [{ action: 'open' }, { action: 'picked', place: { label: '1210 Pipeline Rd, Odessa', lat: 31.851, lng: -102.371 } }, { action: 'use' }]);
    T.eq('open, tap, use: the same address, point and pin as Next', pick(mv, ['form', 'missing']), pick(nv, ['form', 'missing']));
    const [nc, mc] = await both(make, [{ action: 'open' }, { action: 'search', value: '1200 Pipeline' }, { action: 'pick', index: '0' }, { action: 'cancel' }]);
    T.eq('search, pick, cancel: the address as it was', pick(mc, ['form']), pick(nc, ['form']));
    T.eq('... and the sheet shut', mc.mapDlg.open, false);
    const c = make();
    c.$page.functions = fns;
    shown.length = 0;
    const Map = chain('mapChain', fakeActions().Actions, null, { 'resources/js/mapPicker': picker });
    await new Map().run(c, { action: 'locate' });
    T.eq('Use my location: the sheet opens, the pin goes where the phone is, with the address there', [shown.join(' | '), c.$page.variables.mapDlg.picked.label,
      mr.coords(c.$page.variables.mapDlg.picked), c.$page.variables.mapDlg.locating].join(' / '), 'open null | show Main St, Houston / Main St, Houston / 29.76040, -95.36980 / false');
    T.eq('... nothing used until Use this place', c.$page.variables.form.location, '1200 Pipeline Rd');
    await new Map().run(c, { action: 'use' });
    T.eq('used: the address and the point, pinned', [c.$page.variables.form.location, c.$page.variables.form.locationLatitude, c.$page.variables.form.locationPinned].join(), 'Main St, Houston,29.7604,true');
    here = { error: 'denied' };
    await new Map().run(c, { action: 'open' });
    await new Map().run(c, { action: 'locate' });
    T.eq('location off: says so; the map and the search still work', [c.$page.variables.mapDlg.note.split('.')[0], c.$page.variables.mapDlg.open, c.$page.variables.mapDlg.locating].join(' / '),
      'Location is off for this app / true / false');
    await new Map().run(c, { action: 'picked', error: 'Failed to initialize WebGL' });
    T.check('a map that cannot show says so', c.$page.variables.mapDlg.error.startsWith('The map could not be shown here (Failed to initialize WebGL)'));
  }

  T.section('opening the tab: Next\'s switches, the phone\'s copy, where to start');
  {
    local.clear();
    const { calls, Actions } = fakeActions();
    const c = context({}, [], { isLoading: true }, { featureFlags: { TIMESHEETS_ENABLED: 'true', CUSTOMERS_MODULE_ENABLED: 'true', PROJECTS_MODULE_ENABLED: 'true' },
      globalSettings: { ENABLE_QUOTES: 'CUSTOMER' }, sessionRoles: ['EQUIP_MGR'] });
    await new (chain('initChain', Actions))().run(c);
    const v = c.$page.variables;
    T.eq('the requester is you; the switches as Next reads them', [v.form.requestorName, v.form.requestorUsername, v.hideRates, v.showHours, v.customerQuotes, v.canCustomer, v.isLoading].join(),
      'Pat Lee,pat.lee,false,true,true,true,false');
    T.eq('nothing written; the chains needed offline loaded; the start read; the catalog; then any request asked for', calls.map((x) => x.chain + (x.params && x.params.mode === '' ? '(load)' : '')).join(),
      'submitChain(load),uiChain,cartChain,setFieldChain,mapChain,draftsChain,loadCatalogChain,focusChain');
    const co = context({}, [], { isLoading: true }, { featureFlags: { CUSTOMERS_MODULE_ENABLED: 'true' }, sessionRoles: ['EQUIP_MGR'] });
    await new (chain('initChain', fakeActions().Actions))().run(co);
    T.eq('licensed for customer requests only: a customer request (raised in New EquipRite)', co.$page.variables.requestFor, 'customer');
  }
  {
    const at = new Date(2026, 9, 30, 14, 5).getTime();
    snapshot.save('request', 'pat.lee', mr.keep({ form: FORM, cart, step: 2, resume: null }), at);
    const { calls, Actions } = fakeActions();
    const c = context({}, [], { isLoading: true });
    await new (chain('initChain', Actions))().run(c);
    const v = c.$page.variables;
    T.eq('the phone\'s copy comes back as it was left', [v.form.projectName, v.cart.length, v.step, v.notice].join(' | '),
      'Pipeline North | 3 | 2 | What you were raising is back as you left it. ' + snapshot.savedText(at, Date.now()) + '.');
    T.check('... with its project\'s lists and the starter list for the customer', calls.some((x) => x.chain === 'loadProjectListsChain'));
    snapshot.save('request', 'pat.lee', mr.keep({ form: FORM, cart, step: 3, resume: { id: 888, requestNumber: 'EQR-000888' } }), at);
    const r3 = fakeActions();
    const c3 = context({}, [], { isLoading: true });
    await new (chain('initChain', r3.Actions))().run(c3);
    T.check('a draft kept on Review: checked and priced again on Review', c3.$page.variables.notice.startsWith('Draft EQR-000888 is back as you left it.')
      && r3.calls.some((x) => x.chain === 'reviewChain'));
    snapshot.save('request', 'dana.cole', mr.keep({ form: FORM, cart, step: 1 }), at);
    local.removeItem(snapshot.key('request', 'pat.lee'));
    const c4 = context({}, [], { isLoading: true });
    await new (chain('initChain', fakeActions().Actions))().run(c4);
    T.eq('another user\'s copy is not yours', c4.$page.variables.cart.length + c4.$page.variables.notice, '0');
  }
  {
    const c = context(FORM, cart);
    await new (chain('keepChain', fakeActions().Actions))().run(c);
    T.eq('kept on the phone, per user', (snapshot.read('request', 'pat.lee') || {}).data.cart.length, 3);
    await new (chain('keepChain', fakeActions().Actions))().run(context(blank, []));
    T.eq('nothing being raised: the copy goes', snapshot.read('request', 'pat.lee'), null);
    await new (chain('keepChain', fakeActions().Actions))().run(context(blank, [], { resume: { id: 9, requestNumber: 'EQR-9' } }));
    T.check('a draft held, even with nothing in it: kept', !!snapshot.read('request', 'pat.lee'));
    local.clear();
  }
  {
    const bus = fakeBus();
    const c = context(blank, []);
    requestData.loads.length = 0;
    await new (chain('draftsChain', fakeActions().Actions, bus))().run(c, { refresh: true });
    const v = c.$page.variables;
    T.eq('the start: your drafts and what was sent back; order again', [v.drafts.map((d) => d.number + ':' + d.pill).join(), v.draftMore, v.recent.map((r) => r.number).join()].join(' | '),
      'EQR-000889:Draft,EQR-000888:Draft,REQ-2006:Sent back | 0 | ');
    T.eq('the tab counts your drafts (as the shell does), read anew', [bus.sent.join(), JSON.stringify(requestData.loads[0])].join(' | '), 'badge request=2 | {"refresh":true}');
  }

  T.section('carry on with a draft, fix one sent back, order again');
  {
    const bus = fakeBus();
    const { calls, Actions } = fakeActions();
    const c = context(blank, [], { step: 1 });
    await new (chain('resumeChain', Actions, bus))().run(c, { id: '', number: 'eqr-000888', mode: '' });
    const v = c.$page.variables;
    T.eq('a draft by its number: Next\'s resume (its form, priced from today\'s catalog, held to save in place)', [v.form.projectName, v.form.startDate, v.form.notes,
      v.cart.map((i) => i.id + 'x' + i.quantity).join(), JSON.stringify(v.resume)].join(' | '),
    'Pipeline North | 2026-12-01 | Gate code 4417 | 31x2 | {"id":888,"requestNumber":"EQR-000888","attribute1":"1 Main St","shipToSiteId":55}');
    T.eq('a line no longer in the catalog is said', v.priceNote, '1 line of the draft is no longer in the catalog, so it was left out.');
    T.eq('reads only, then its lists, then Review', ends(calls) + ' / ' + calls.filter((x) => x.chain && x.chain !== 'keepChain').map((x) => x.chain).join(),
      'getEquipriteV1EquipmentRequestById > getEquipriteV1EquipmentRequestsRequestIdLines2 > getEquipriteV1ViewsEquipmentCatalog / resetChain,loadProjectListsChain,reviewChain');
    T.check('the inputs follow, and the phone keeps it', c.fnLog.includes('sync 2026-12-14 search') && calls.some((x) => x.chain === 'keepChain'));
    // Next's own initChain.resume on the same draft gives the same form, cart and draft held.
    const nc = context({}, [], { id: '888' });
    await new (nextChain('initChain', fakeActions().Actions))().run(nc);
    T.eq('... exactly as Next reopens it', pick(v, ['form', 'cart', 'resume', 'agreementId', 'agreementLineMap', 'priceNote']),
      pick(nc.$page.variables, ['form', 'cart', 'resume', 'agreementId', 'agreementLineMap', 'priceNote']));
  }
  {
    const c = context(FORM, cart, { resume: { id: 888, requestNumber: 'EQR-000888' } });
    const bus = fakeBus();
    const { calls, Actions } = fakeActions();
    await new (chain('resumeChain', Actions, bus))().run(c, { id: '888', number: '' });
    T.eq('the draft already open here: says so', bus.sent.join() + ' ' + calls.filter((x) => x.endpoint).length, 'toast info: Draft EQR-000888 is open here. 0');
    const c2 = context(FORM, cart);
    await new (chain('resumeChain', Actions, bus))().run(c2, { id: '888', number: 'EQR-000888' });
    T.eq('something else being raised: asks first, nothing read', [c2.$page.variables.sheet, JSON.stringify(c2.$page.variables.pending), c2.$page.variables.cart.length].join(' | '),
      'replace | {"id":888,"number":"EQR-000888","mode":"draft"} | 3');
    const ui = fakeActions();
    await new (chain('uiChain', ui.Actions))().run(c2, { action: 'replace' });
    T.eq('confirmed: opened', ui.calls.map((x) => x.chain + JSON.stringify(x.params)).join(), 'resumeChain{"id":"888","number":"EQR-000888","mode":"","confirmed":true}');
    T.eq('... the question goes', [c2.$page.variables.sheet, c2.$page.variables.pending].join(), ',');
  }
  {
    const { calls, Actions } = fakeActions();
    const c = context(blank, []);
    await new (chain('resumeChain', Actions))().run(c, { id: '2006', number: 'REQ-2006', mode: '' });
    const v = c.$page.variables;
    T.eq('sent back: copied into a new request (it cannot be reopened; draftResume opens drafts only)', [v.resume, v.form.projectName, v.form.startDate, v.form.notes,
      v.cart.map((i) => i.id + 'x' + i.quantity + ':' + i.notes).join(), v.agreementId].join(' | '), ' | Pipeline North | 2026-11-16 | Smaller loader please | 31x1:With operator | 12');
    T.check('... saying so, on Review', v.notice.startsWith('REQ-2006 was sent back.') && calls.some((x) => x.chain === 'reviewChain'));
    T.check('... reads only (the sent-back request is not touched)', calls.filter((x) => x.endpoint).every((x) => /\/get/.test(x.endpoint)));
    const ag2 = fakeActions();
    const ca = context(blank, []);
    await new (chain('resumeChain', ag2.Actions))().run(ca, { id: '2006', number: 'REQ-2006', mode: 'again' });
    T.check('order again: new dates, on the equipment', ca.$page.variables.form.startDate === '' && ca.$page.variables.step === 1 && ag2.calls.some((x) => x.chain === 'loadCatalogChain')
      && !ag2.calls.some((x) => x.chain === 'reviewChain') && ca.$page.variables.notice.startsWith('Ordering again from REQ-2006'));
    const ce = context(blank, []);
    await new (chain('resumeChain', fakeActions().Actions))().run(ce, { id: '889', number: '' });
    T.check('a customer draft: edited in New EquipRite, with a link', ce.$page.variables.externalDraftId === 889 && /customer request.*New EquipRite/.test(ce.$page.variables.loadError));
    const bus = fakeBus();
    const cn = context(blank, []);
    await new (chain('resumeChain', fakeActions().Actions, bus))().run(cn, { id: '', number: 'REQ-404' });
    T.eq('not among your requests: says so', bus.sent.join(), 'toast warning: Request REQ-404 was not found among the requests you can see.');
  }
  {
    const bus = fakeBus();
    const { calls, Actions } = fakeActions();
    const c = context(blank, [], { isLoading: true });
    bus.waiting.request = { number: 'REQ-2005' };
    await new (chain('focusChain', Actions, bus))().run(c);
    T.eq('asked for while the tab is opening: left for initChain to take', [calls.length, !!bus.waiting.request].join(), '0,true');
    c.$page.variables.isLoading = false;
    await new (chain('focusChain', Actions, bus))().run(c);
    await new (chain('focusChain', Actions, bus))().run(c);
    T.eq('taken once it has opened, once', calls.map((x) => x.chain + JSON.stringify(x.params)).join(), 'resumeChain{"id":"","number":"REQ-2005","mode":""}');
  }

  T.section('the sheets, the connection, starting another');
  {
    const { calls, Actions } = fakeActions();
    const c = context(FORM, cart);
    const ui = (p) => new (chain('uiChain', Actions))().run(c, p);
    await ui({ action: 'sheet', value: 'customer' });
    T.eq('the customer sheet shows the report\'s list straight away', [c.$page.variables.sheet, calls.map((x) => x.chain + JSON.stringify(x.params)).join()].join(' | '),
      'customer | searchChain{"kind":"customer","text":""}');
    await ui({ action: 'line', value: '11' });
    T.eq('a line\'s own dates open', c.$page.variables.lineOpen, 11);
    await ui({ action: 'line', value: '11' });
    T.eq('and shut', c.$page.variables.lineOpen, 0);
    calls.length = 0;
    c.$page.variables.online = false;
    c.$page.variables.catalogError = 'The catalog needs a connection.';
    c.$page.variables.saveError = mr.offlineText(false);
    await ui({ action: 'online', value: 'true' });
    T.eq('back online: the catalog and the start read again; "nothing was sent" goes', [calls.map((x) => x.chain).join(), c.$page.variables.saveError, c.$page.variables.online].join(' | '),
      'loadCatalogChain,draftsChain |  | true');
    await ui({ action: 'notice' });
    await ui({ action: 'view', value: 'form' });
    T.eq('Raise another after a submit', c.$page.variables.view + ':' + c.$page.variables.sent, 'form:null');
  }
  {
    const { calls, Actions } = fakeActions();
    const c = context(FORM, cart, { resume: { id: 1 }, step: 3, mode: 'review', agreementId: 3, sheet: 'reset', notice: 'x' });
    await new (chain('resetChain', Actions))().run(c, { sent: { id: 501, number: 'EQR-000501', mode: 'submit' } });
    const v = c.$page.variables;
    T.eq('after a submit: an empty request for you, and what was sent', [v.cart.length, v.resume, v.agreementId, v.step, v.mode, v.form.requestorName, v.form.startDate, v.sent.number,
      v.view, v.sheet, v.notice].join(), '0,,,1,build,Pat Lee,,EQR-000501,sent,,');
    T.eq('the inputs emptied; the phone\'s copy goes; the catalog without dates', [c.fnLog[0], calls.map((x) => x.chain).join()].join(' | '),
      'sync  search | keepChain,applyCatalogChain,loadCatalogChain');
    const q = fakeActions();
    await new (chain('resetChain', q.Actions))().run(context(FORM, cart), { quiet: true });
    T.eq('quiet (a request is being opened): no catalog yet', q.calls.map((x) => x.chain).join(), 'keepChain');
    const o = context(FORM, cart);
    await new (chain('openRequestChain', fakeActions().Actions))().run(o, { id: '501', number: 'EQR-000501' });
    T.eq('See it in My requests', o.fnLog.join(), 'track 501 EQR-000501');
  }

  T.section('the page');
  const pageJson = JSON.parse(fs.readFileSync(path.join(PAGE, 'request-page.json'), 'utf8'));
  const flowJson = JSON.parse(fs.readFileSync(path.join(APP, 'flows', 'request', 'request-flow.json'), 'utf8'));
  T.check('page and flow are embeddable', pageJson.navigation.embeddable === 'enabled' && flowJson.navigation.embeddable === 'enabled');
  const named = new Set();
  Object.values(pageJson.eventListeners).forEach((l) => l.chains.forEach((x) => named.add(x.chain)));
  fs.readdirSync(CHAINS).forEach((f) => (fs.readFileSync(path.join(CHAINS, f), 'utf8').match(/chain: '([A-Za-z]+)'/g) || []).forEach((m) => named.add(m.replace(/chain: '|'/g, ''))));
  T.eq('every chain named exists', [...named].filter((n) => !fs.existsSync(path.join(CHAINS, n + '.js'))).join(), '');
  T.eq('every chain is used', fs.readdirSync(CHAINS).map((f) => f.replace('.js', '')).filter((n) => !named.has(n)).join(), '');
  fs.readdirSync(CHAINS).forEach((f) => {
    const cls = (fs.readFileSync(path.join(CHAINS, f), 'utf8').match(/class (\w+) extends ActionChain/) || [])[1];
    T.check(f + ' is the class named like the file', cls === f.replace('.js', ''));
  });
  T.check('the ported chains keep Next\'s names', ['initChain', 'loadCatalogChain', 'filterCatalogChain', 'applyCatalogChain', 'cartChain', 'loadProjectListsChain', 'searchChain',
    'pickChain', 'loadSitesChain', 'mapChain', 'setFieldChain', 'goStepChain', 'reviewChain', 'submitChain', 'openRequestChain', 'resetChain'].every((n) => fs.existsSync(path.join(CHAINS, n + '.js'))));
  const html = fs.readFileSync(path.join(PAGE, 'request-page.html'), 'utf8');
  const bindings = html.match(/\[\[[\s\S]*?\]\]|\{\{[\s\S]*?\}\}/g) || [];
  const badB = bindings.filter((b) => /=>|\b(String|Number|Boolean)\(|\[\s*[\w$'"]/.test(b.slice(2, -2).replace(/\$variables\.\w+\[/g, '')));
  T.eq('bindings: no arrow functions, String/Number/Boolean or array literals', badB.join(' '), '');
  T.check('no for-each inside a table, tbody or select', !/<(table|tbody|select)[\s>][\s\S]*?oj-bind-for-each[\s\S]*?<\/\1>/.test(html));
  const PageModule = load(path.join(PAGE, 'request-page.js'), { require: () => {}, 'resources/js/mobileBus': { onFocus: () => {} }, 'resources/js/mobileRequest': mr,
    'resources/js/orderForm': order, 'resources/js/mapPicker': {} });
  const pg = new PageModule();
  const usedFns = new Set((html.match(/\$functions\.(\w+)/g) || []).map((m) => m.split('.')[1]));
  T.eq('every page function used exists', [...usedFns].filter((n) => typeof pg[n] !== 'function').join(), '');
  T.check('and the chains\' page functions', ['mapOpen', 'mapShow', 'mapClose', 'locate', 'syncInputs', 'toTop', 'showInTrack'].every((n) => typeof pg[n] === 'function'));
  const usedListeners = new Set((html.match(/\$listeners\.(\w+)/g) || []).map((m) => m.split('.')[1]));
  T.eq('every listener used is declared', [...usedListeners].filter((n) => !pageJson.eventListeners[n]).join(), '');
  T.eq('every listener declared is used', Object.keys(pageJson.eventListeners).filter((n) => !['vbEnter', 'focusRequest', 'connection', 'mapPicked'].includes(n) && !usedListeners.has(n)).join(), '');
  const usedVars = new Set((html.match(/\$variables\.(\w+)/g) || []).map((m) => m.split('.')[1]));
  T.eq('every variable used is declared', [...usedVars].filter((n) => !pageJson.variables[n]).join(), '');
  T.eq('the page\'s functions in words', [pg.taskNote(false, [{ TaskNumber: '1' }, { TaskNumber: '2' }], ''), pg.taskNote(true, [], ''), pg.taskNote(false, [], ''), pg.availNext('free'),
    pg.availClass('ok'), pg.stepClass({ state: 'done' })].join(' | '),
  '2 of 2 chargeable tasks | Loading the project’s tasks… | This project has no chargeable tasks. | false | mb-request-avail mb-request-avail--ok | mb-request-step mb-request-step--done');
  const ids = (html.match(/\sid="[^"]+"/g) || []).map((m) => m.trim().slice(4, -1));
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i && !['rqPickSearch', 'rqPickNote', 'rqPickList'].includes(x));
  T.eq('ids are the tab\'s own (rq…) and unique (the pick sheet\'s three lists are one at a time)', [ids.filter((x) => !/^(rq|mbRequest)/.test(x)).join(), dup.join()].join(' | '), ' | ');
  const css = fs.readFileSync(path.join(APP, 'resources', 'css', 'mobile-request.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = (css.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '').match(/[^{}]+(?=\{)/g) || []).filter((s) => !/^\s*@media/.test(s))
    .join(',').split(',').map((s) => s.trim()).filter(Boolean);
  T.check('every style rule is the tab\'s own (.mb-request-*, or a shared part only inside one)', selectors.length > 60 && selectors.every((s) => /^\.mb-(request|dock\.mb-request|sheet-foot\.mb-request)/.test(s)),
    selectors.filter((s) => !/^\.mb-(request|dock\.mb-request|sheet-foot\.mb-request)/.test(s)).join(' '));
  T.check('colours from mobile.css\'s tokens (no new colours but white and its own shades of the band\'s)', !/#(?!fff\b|ffffff\b|c9dcf3\b|d4e5f8\b|eef3f7\b|f0f6f9\b|78350f\b|7f1d1d\b)[0-9a-f]{3,6}\b/i.test(css),
    (css.match(/#[0-9a-f]{3,6}\b/gi) || []).join());

  T.section('every endpoint called exists in services/');
  const ops = {};
  ['eqp-v1', 'bipService', 'ProjectLOV'].forEach((svc) => {
    const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'services', svc, 'openapi3.json'), 'utf8'));
    Object.values(spec.paths || {}).forEach((p) => Object.values(p).forEach((op) => { if (op && op.operationId) ops[svc + '/' + op.operationId] = true; }));
  });
  const used = new Set();
  fs.readdirSync(CHAINS).map((f) => path.join(CHAINS, f)).concat(['requestHeaderBody', 'requestLineBody', 'draftResume', 'requestData'].map((f) => path.join(JS, f + '.js')))
    .forEach((f) => (fs.readFileSync(f, 'utf8').match(/endpoint:\s*'([^']+)'/g) || []).forEach((m) => used.add(m.replace(/endpoint:\s*'/, '').replace("'", ''))));
  [...used].sort().forEach((e) => T.check(e, !!ops[e]));
  T.check('mobileRequest.js calls nothing (pure)', !/callRest|fetch\(|XMLHttpRequest/.test(fs.readFileSync(path.join(JS, 'mobileRequest.js'), 'utf8')));

  T.report();
})();
