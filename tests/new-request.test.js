/*
 * New EquipRite, New request (webApps/equiprite/flows/request/pages/new-request-page*).
 *
 * Checks the page against the old create flow it replaces for project requests:
 *   - the snapshot it hands the shared builders has every field NavigateToCatalogChain's has
 *   - the header and line bodies it produces (through the REAL requestHeaderBody / requestLineBody) are what the
 *     old cart posts, and the estimate on screen equals the estimatedCost posted
 *   - submit and save-draft run the old sequence of calls against a fake backend, and stop on a failure
 *   - every endpoint the page calls exists in services/
 *
 * Run:  node tests/new-request.test.js
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
const PAGE = path.join(NEW, 'flows', 'request', 'pages');
const CHAINS = path.join(PAGE, 'new-request-page-chains');
const JS = path.join(NEW, 'resources', 'js');

function loadAmd(file, deps) {
  const sandbox = { console, setTimeout, Promise, window: { scrollTo() {} }, sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} } };
  let mod;
  sandbox.define = (names, factory) => { mod = factory(...names.map((n) => (deps && n in deps ? deps[n] : {}))); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: path.basename(file) });
  return mod;
}

const geocoder = { lookup: async () => null };
const lineBody = loadAmd(path.join(JS, 'requestLineBody.js'));
const catalogCart = loadAmd(path.join(JS, 'catalogCart.js'));
const hdr = loadAmd(path.join(JS, 'requestHeaderBody.js'), { 'resources/js/geocoder': geocoder });
const Page = loadAmd(path.join(PAGE, 'new-request-page.js'), { 'resources/js/requestLineBody': lineBody });
const page = new Page();

const ROWS = [
  { eqrEquipmentMasterId: 11, equipmentName: 'CAT 320 Excavator', className: 'Excavators', eqrEquipmentClassId: 1,
    availabilityStatus: 'AVAILABLE', availableQty: 3, isRentable: true, rate: 1400, rateUom: 'DAY', periodAmount: 1400, periodType: 'DAILY' },
  { eqrEquipmentMasterId: 12, equipmentName: 'Mini Excavator 3.5t', className: 'Excavators', eqrEquipmentClassId: 1,
    availabilityStatus: 'NOT AVAILABLE', availableQty: 0, isRentable: true, rate: 300, rateUom: 'DAY' },
  { eqrEquipmentMasterId: 21, equipmentName: 'Trench safety kit', className: 'Safety', eqrEquipmentClassId: 2,
    availabilityStatus: 'PARTIAL QUANTITY', availableQty: 4, isRentable: false, unitPrice: 25, periodAmount: 25, periodType: 'DAILY' },
  { eqrEquipmentMasterId: 31, equipmentName: 'Dump truck 30t', className: 'Trucks', eqrEquipmentClassId: 3,
    availabilityStatus: 'AVAILABLE', availableQty: 2, isRentable: true, rate: 800, rateUom: 'DAY', periodAmount: 4800, periodType: 'WEEKLY' },
];
const START = '2026-11-02';
const END = '2026-11-27'; // 26 days, both ends counted

T.section('catalog cards: availability, price, estimate, filters');
T.eq('26 days, both ends counted', page.days(START, END), 26);
T.eq('available shows the free quantity', page.availability(ROWS[0]).label, 'Available · 3');
T.eq('not available', page.availability(ROWS[1]).key, 'none');
T.eq('partial quantity', page.availability(ROWS[2]).label, 'Partial: 4 free');
T.eq('no dates yet: browse mode', page.availability({}).key, 'unknown');
T.eq('weekly price reads as the business quotes it', page.rateText(ROWS[3], false), '$4,800 / WEEK');
T.eq('consumable is per unit', page.rateText(ROWS[2], false), '$25 / unit');
T.eq('quote pending hides every price', page.rateText(ROWS[0], true), 'Rate on request');
T.eq('card estimate for the window', page.cardEstimate(ROWS[0], START, END, false), 'Est. $36,400 for 26 days');
T.eq('no estimate when not available', page.cardEstimate(ROWS[1], START, END, false), '');
T.eq('no estimate before the dates', page.cardEstimate(ROWS[0], '', '', false), '');
T.eq('class chips with counts, All first', page.classChips(ROWS).map((c) => c.label + ':' + c.count).join(','),
  'All equipment:4,Excavators:2,Safety:1,Trucks:1');
T.eq('filter by class', page.filterCatalog(ROWS, '', 'Excavators', '').length, 2);
T.eq('free on these dates hides the unavailable', page.filterCatalog(ROWS, '', 'all', 'free').map((r) => r.eqrEquipmentMasterId).join(','), '11,21,31');
T.eq('text search over name and class', page.filterCatalog(ROWS, 'truck', 'all', '').length, 1);
T.eq('picture initials skip symbols', page.initials('Safety & consumables') + page.initials('') , 'SC?');

T.section('cart: estimate equals what is posted');
const cart = [catalogCart.itemFromRow(ROWS[0], 2, null), catalogCart.itemFromRow(ROWS[2], 10, null), catalogCart.itemFromRow(ROWS[3], 1, null)];
cart[2].startDate = '2026-11-10'; // its own window: 10 Nov – 27 Nov = 18 days
T.eq('rentable: qty × daily rate × days', page.lineCost(cart[0], START, END, false), 2 * 1400 * 26);
T.eq('consumable: qty × unit price, not per day', page.lineCost(cart[1], START, END, false), 250);
T.eq('a line with its own start date uses it', page.lineCost(cart[2], START, END, false), 800 * 18);
const summary = page.cartSummary(cart, START, END, false);
T.eq('total of the priced lines', summary.total, 72800 + 250 + 14400);
T.eq('quote pending: no line cost', page.lineCost(cart[0], START, END, true), null);
const ctx = { requestId: 9, lineStatus: 'SUBMITTED', detail: { requestedStartDate: START, requestedEndDate: END }, headerHours: null, agreementLineMap: {}, quotePending: false };
T.check('every line: screen estimate = posted estimatedCost',
  cart.every((it) => lineBody.build(it, ctx).estimatedCost === page.lineCost(it, START, END, false)),
  cart.map((it) => lineBody.build(it, ctx).estimatedCost + ' vs ' + page.lineCost(it, START, END, false)).join('; '));
T.eq('weekly line posts the period price', JSON.stringify([lineBody.build(cart[2], ctx).billRate, lineBody.build(cart[2], ctx).priceUom]), '[4800,"WEEK"]');
T.eq('qtyIn', page.qtyIn(cart, 21) + page.qtyIn(cart, 99), 10);

T.section('steps: what each one needs');
const blank = page.emptyForm('Pat Lee', 'pat.lee');
T.eq('step 1 needs dates and equipment', page.missingFor(1, blank, []).join('|'), 'Start date|End date|At least one piece of equipment');
T.eq('end before start is caught', page.missingFor(1, Object.assign({}, blank, { startDate: END, endDate: START }), cart).join('|'), 'End date on or after the start date');
T.eq('step 2 needs project, task, customer, delivery (the old INTERNAL rule)', page.missingFor(2, blank, cart).join('|'), 'Project|Task|Customer|Delivery location');
const FORM = Object.assign({}, blank, {
  startDate: START, endDate: END,
  projectId: '300000123', projectNumber: 'PRJ-2026-001', projectName: 'Pipeline North', projectBuId: 300000001, projectBuName: 'EPC_UAE_BU',
  taskId: '300000777', taskNumber: '2.1', taskName: 'Trenching',
  customerId: '100000555', customerName: 'Acme Utilities', contractId: '300000999', contractNumber: 'K-77',
  locationType: 'PROJECT_SITE', location: '1 Main St, Houston TX', hours: 8, notes: 'Gate 3',
});
T.eq('a complete form passes', page.missingFor('submit', FORM, cart).length, 0);
T.eq('a draft needs only dates and equipment', page.missingFor('draft', Object.assign({}, blank, { startDate: START, endDate: END }), cart).length, 0);
T.eq('a line ending before it starts blocks submit', page.missingFor('submit', FORM, [Object.assign({}, cart[0], { endDate: '2026-11-01' })]).join('|'), 'Dates of CAT 320 Excavator');
T.eq('tracker', page.steps(2).map((s) => s.state[0]).join(''), 'dct');
T.eq('task filter', page.taskMatches([{ TaskNumber: '1.1', TaskName: 'Survey' }, { TaskNumber: '2.1', TaskName: 'Trenching' }], 'trench').length, 1);

T.section('the snapshot and header match the old create page');
const detail = page.buildDetail(FORM);
const oldNav = fs.readFileSync(path.join(OLD, 'flows', 'customer-portal', 'pages', 'project-create-request-page-chains', 'NavigateToCatalogChain.js'), 'utf8');
const block = oldNav.slice(oldNav.indexOf('$flow.variables.ActiveRequestDetail = {'), oldNav.indexOf("$flow.variables.requestOrigin = 'project'"));
const oldKeys = (block.match(/^\s{8}([a-zA-Z]+):/gm) || []).map((k) => k.trim().replace(':', ''));
T.check('the old snapshot was read', oldKeys.length >= 20, oldKeys.join(','));
T.check('every field of the old snapshot is in the new one', oldKeys.every((k) => k in detail), oldKeys.filter((k) => !(k in detail)).join(', '));
const d = hdr.derive({ request: FORM, ActiveRequestDetail: detail, CartItemsArray: cart, requestOrigin: 'project', fromAgreementId: null });
const body = hdr.build(d, 'REQ-1');
const expect = {
  status: 'DRAFT', requestType: 'INTERNAL', projectRefId: 300000123, projectNumber: 'PRJ-2026-001', projectBuId: 300000001,
  taskId: 300000777, taskName: 'Trenching', requestorUserId: null, requestorName: 'Pat Lee', requestorUsername: 'pat.lee',
  eqrCustomerRefId: null, customerName: null, projectInternalCustomerId: 100000555, projectInternalCustomer: 'Acme Utilities',
  projectContractId: 300000999, projectContract: 'K-77', deliveryLocationType: 'PROJECT_SITE', attribute1: '1 Main St, Houston TX',
  requestedStartDate: '2026-11-02T00:00:00Z', requestedEndDate: '2026-11-27T00:00:00Z', defaultHours: 8, isSoftReservation: 'N', attribute2: 'Gate 3',
};
Object.keys(expect).forEach((k) => T.eq('header ' + k, body[k], expect[k]));

T.section('submit and save draft: the old call sequence');
function fakeBackend(fail) {
  const calls = [];
  const Actions = {
    async callRest(context, o) {
      calls.push({ endpoint: o.endpoint, uriParams: o.uriParams, body: o.body });
      if (fail === o.endpoint) return { ok: false, status: 500, body: { message: 'boom' } };
      if (o.endpoint === 'eqp-v1/createEquipmentRequest') return { ok: true, status: 201, body: { id: 501, requestNumber: 'EQR-000501' } };
      return { ok: true, status: 200, body: {} };
    },
    async fireNotificationEvent(context, n) { calls.push({ toast: n.summary }); },
    async navigateToPage(context, n) { calls.push({ nav: n.page, params: n.params }); },
    async callChain(context, n) { calls.push({ chain: n.chain }); },
  };
  return { calls, Actions };
}
function makeContext(form, cartItems, extra) {
  const variables = Object.assign({ form, cart: cartItems, isSubmitting: false, missing: [], resume: null, agreementId: null, agreementLineMap: {} }, extra || {});
  return {
    $page: { variables, functions: page },
    $application: {
      variables: { jwt: '', globalSettings: {}, flagsLoaded: true },
      functions: { isQuotingAllowed: () => false },
      user: { username: 'pat.lee' },
    },
  };
}
const cu = { auditHeaders: () => ({ 'X-User-Id': 'pat.lee' }) };
function loadSubmit(Actions) {
  return loadAmd(path.join(CHAINS, 'submitChain.js'), {
    'vb/action/actionChain': class {}, 'vb/action/actions': Actions,
    'resources/js/currentUser': cu, 'resources/js/requestLineBody': lineBody, 'resources/js/requestHeaderBody': hdr,
  });
}

(async () => {
  {
    const { calls, Actions } = fakeBackend();
    const Submit = loadSubmit(Actions);
    const c = makeContext(FORM, cart);
    await new Submit().run(c, { mode: 'submit' });
    const seq = calls.map((x) => x.endpoint || (x.toast && 'toast') || (x.nav && 'nav:' + x.nav)).join(' > ');
    T.eq('submit: header, lines, status, toast, then the new request',
      seq, 'eqp-v1/createEquipmentRequest > eqp-v1/createRequestLinesBatch > eqp-v1/patchEquipmentRequest > toast > nav:request-detail');
    const lines = calls.find((x) => x.endpoint === 'eqp-v1/createRequestLinesBatch');
    T.eq('lines go to the new header', lines.uriParams.requestId, 501);
    T.check('every line is SUBMITTED', lines.body.lines.every((l) => l.lineStatus === 'SUBMITTED'));
    T.eq('the header moves to SUBMITTED (a project request waits for approval)', JSON.stringify(calls.find((x) => x.endpoint === 'eqp-v1/patchEquipmentRequest').body), '{"status":"SUBMITTED"}');
    T.eq('opens the new request', JSON.stringify(calls[calls.length - 1].params), '{"requestId":"EQR-000501","requestNumericId":501}');
    T.eq('the cart is emptied', c.$page.variables.cart.length, 0);
    T.eq('the busy flag is cleared', c.$page.variables.isSubmitting, false);
  }
  {
    const { calls, Actions } = fakeBackend();
    const Submit = loadSubmit(Actions);
    await new Submit().run(makeContext(FORM, cart), { mode: 'draft' });
    T.check('draft: lines are DRAFT and the header is not moved',
      calls.find((x) => x.endpoint === 'eqp-v1/createRequestLinesBatch').body.lines.every((l) => l.lineStatus === 'DRAFT')
      && !calls.some((x) => x.endpoint === 'eqp-v1/patchEquipmentRequest'));
  }
  {
    const { calls, Actions } = fakeBackend('eqp-v1/createRequestLinesBatch');
    const Submit = loadSubmit(Actions);
    const c = makeContext(FORM, cart);
    await new Submit().run(c, { mode: 'submit' });
    T.check('a failed line batch deletes the new header and never sets SUBMITTED',
      calls.some((x) => x.endpoint === 'eqp-v1/deleteEquipmentRequest') && !calls.some((x) => x.endpoint === 'eqp-v1/patchEquipmentRequest'));
    T.check('... and keeps the cart and the page', c.$page.variables.cart.length === 3 && !calls.some((x) => x.nav));
  }
  {
    const { calls, Actions } = fakeBackend();
    const Submit = loadSubmit(Actions);
    const c = makeContext(Object.assign({}, FORM, { taskId: null }), cart);
    await new Submit().run(c, { mode: 'submit' });
    T.check('an incomplete request calls nothing and lists what is missing', calls.length === 0 && c.$page.variables.missing.join() === 'Task');
  }
  {
    const { calls, Actions } = fakeBackend();
    const Submit = loadSubmit(Actions);
    const c = makeContext(FORM, cart, { resume: { id: 77, requestNumber: 'EQR-000077', attribute1: '1 Main St, Houston TX', shipToSiteId: 5 } });
    await new Submit().run(c, { mode: 'submit' });
    const seq = calls.filter((x) => x.endpoint).map((x) => x.endpoint).join(' > ');
    T.eq('a reopened draft is updated in place and its lines replaced',
      seq, 'eqp-v1/patchEquipmentRequest > eqp-v1/replaceRequestLinesBatch > eqp-v1/patchEquipmentRequest');
  }
  {
    const { calls, Actions } = fakeBackend();
    const Submit = loadSubmit(Actions);
    const c = makeContext(FORM, cart);
    const s = new Submit();
    await Promise.all([s.run(c, { mode: 'submit' }), s.run(c, { mode: 'submit' })]);
    T.eq('a double click creates one request', calls.filter((x) => x.endpoint === 'eqp-v1/createEquipmentRequest').length, 1);
  }

  T.section('cart chain');
  {
    const Cart = loadAmd(path.join(CHAINS, 'cartChain.js'), { 'vb/action/actionChain': class {}, 'resources/js/catalogCart': catalogCart });
    const c = makeContext(FORM, [], { catalogRows: ROWS });
    const run = (p) => new Cart().run(c, p);
    await run({ action: 'add', id: '11' });
    await run({ action: 'add', id: '11' });
    await run({ action: 'add', id: '21' });
    T.eq('add twice = one line of 2', c.$page.variables.cart.map((i) => i.id + 'x' + i.quantity).join(','), '11x2,21x1');
    await run({ action: 'dec', id: '21' });
    T.eq('down to 0 removes the line', c.$page.variables.cart.length, 1);
    await run({ action: 'line', id: '11', field: 'notes', value: 'With operator' });
    await run({ action: 'set', id: '11', value: '0' });
    T.eq('a typed quantity is at least 1, notes kept', c.$page.variables.cart[0].quantity + '|' + c.$page.variables.cart[0].notes, '1|With operator');
    await run({ action: 'line', id: '11', field: 'notes', value: '' });
    T.check('clearing a line value falls back to the request', !('notes' in c.$page.variables.cart[0]));
  }

  T.section('every endpoint the page calls exists in services/');
  const ops = {};
  ['eqp-v1', 'bipService', 'ProjectLOV'].forEach((svc) => {
    const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'services', svc, 'openapi3.json'), 'utf8'));
    Object.values(spec.paths || {}).forEach((p) => Object.values(p).forEach((op) => { if (op && op.operationId) ops[svc + '/' + op.operationId] = true; }));
  });
  const used = new Set();
  [CHAINS, JS].forEach((dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.js')).forEach((f) => {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    if (dir === JS && !/requestHeaderBody|requestLineBody|draftResume|projectBusinessUnit/.test(f)) return;
    (src.match(/endpoint:\s*'([^']+)'/g) || []).forEach((m) => used.add(m.replace(/endpoint:\s*'/, '').replace("'", '')));
  }));
  [...used].sort().forEach((e) => T.check(e, !!ops[e]));

  T.report();
})();
