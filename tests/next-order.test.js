/*
 * EquipRite Next, New request (webApps/equiprite-next/flows/order, resources/js/orderForm.js).
 *
 * Checks that the rules are New EquipRite's (and so the old create page's and cart's):
 *   - the helper modules are New's, byte for byte; orderForm gives what New's page module gives
 *   - the header and line bodies (through the REAL requestHeaderBody / requestLineBody) and the estimate on screen
 *   - Submit and Save draft run New's sequence of calls against a fake backend, stop on a failure, and then refresh
 *     the shared requests, open the new request in its own tab and start a new one (or keep the saved draft)
 *   - the other chains: cart, fields, pick, review, catalog, opening (a draft, a customer draft, the agreement hand-over)
 *   - the menu item is built, a draft opens in a tab of its own, the page names only chains that exist, the bindings
 *     follow the Next page rules, and every endpoint called exists in services/
 *
 * Run:  node tests/next-order.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const ROOT = path.join(__dirname, '..');
const NEXT = path.join(ROOT, 'webApps', 'equiprite-next');
const NEW = path.join(ROOT, 'webApps', 'equiprite');
const JS = path.join(NEXT, 'resources', 'js');
const PAGE = path.join(NEXT, 'flows', 'order', 'pages');
const CHAINS = path.join(PAGE, 'new-request-page-chains');

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

function load(file, deps) {
  const sandbox = { console, setTimeout, Promise, URLSearchParams, Intl, Date, localStorage: local, sessionStorage: session };
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
const nav = js('nav', { 'resources/js/rules': rules });
const tabs = js('tabs', { 'resources/js/nav': nav });
const PageModule = load(path.join(PAGE, 'new-request-page.js'), { 'resources/js/orderForm': order, 'resources/js/fmt': fmt });
const pg = new PageModule();
const NewPage = load(path.join(NEW, 'flows', 'request', 'pages', 'new-request-page.js'), { 'resources/js/requestLineBody': lineBody });
const newPage = new NewPage();

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
const END = '2026-11-27'; // 26 days, both ends counted

T.section('the helpers are New EquipRite\'s, unchanged');
['catalogCart', 'requestHeaderBody', 'requestLineBody', 'draftResume', 'draftStorage', 'deliveryCoords', 'geocoder', 'projectTaskTree',
  'projectBusinessUnit', 'bipLov', 'currentUser'].forEach((f) => {
  T.check(f + '.js is New\'s copy', fs.readFileSync(path.join(JS, f + '.js'), 'utf8') === fs.readFileSync(path.join(NEW, 'resources', 'js', f + '.js'), 'utf8'));
});

T.section('orderForm gives what New\'s page gives');
const cart = [catalogCart.itemFromRow(ROWS[0], 2, null), catalogCart.itemFromRow(ROWS[2], 10, null), catalogCart.itemFromRow(ROWS[3], 1, null)];
cart[2].startDate = '2026-11-10'; // its own window: 10 Nov – 27 Nov = 18 days
const blank = order.emptyForm('Pat Lee', 'pat.lee');
const FORM = Object.assign({}, blank, {
  startDate: START, endDate: END,
  projectId: '300000123', projectNumber: 'PRJ-2026-001', projectName: 'Pipeline North', projectBuId: 300000001, projectBuName: 'EPC_US_BU',
  taskId: '300000777', taskNumber: '2.1', taskName: 'Trenching',
  customerId: '100000555', customerName: 'Acme Utilities', contractId: '300000999', contractNumber: 'K-77',
  locationType: 'PROJECT_SITE', location: '1200 Pipeline Rd, Odessa TX', hours: 8, notes: 'Gate 3',
});
const same = (name, a, b) => T.eq(name, JSON.stringify(a), JSON.stringify(b));
same('emptyForm', order.emptyForm('Pat Lee', 'pat.lee'), newPage.emptyForm('Pat Lee', 'pat.lee'));
same('buildDetail', order.buildDetail(FORM), newPage.buildDetail(FORM));
same('lineCost of each line', cart.map((it) => order.lineCost(it, START, END, false)), cart.map((it) => newPage.lineCost(it, START, END, false)));
same('cartSummary', order.cartSummary(cart, START, END, false), newPage.cartSummary(cart, START, END, false));
same('cartSummary while a quote is pending', order.cartSummary(cart, START, END, true), newPage.cartSummary(cart, START, END, true));
[[1, blank, []], [2, blank, cart], ['draft', blank, cart], ['submit', FORM, cart], ['submit', Object.assign({}, FORM, { endDate: '2026-11-01' }), cart],
  ['submit', FORM, [Object.assign({}, cart[0], { endDate: '2026-11-01' })]]].forEach(([step, f, c], i) => {
  same('missingFor #' + (i + 1) + ' (' + step + ')', order.missingFor(step, f, c), newPage.missingFor(step, f, c));
});
same('filterCatalog (class, free, text)', [order.filterCatalog(ROWS, '', 'Excavators', ''), order.filterCatalog(ROWS, '', 'all', 'free'), order.filterCatalog(ROWS, 'truck', 'all', '')]
  .map((l) => l.map((r) => r.eqrEquipmentMasterId)), [newPage.filterCatalog(ROWS, '', 'Excavators', ''), newPage.filterCatalog(ROWS, '', 'all', 'free'),
  newPage.filterCatalog(ROWS, 'truck', 'all', '')].map((l) => l.map((r) => r.eqrEquipmentMasterId)));
same('availability keys', ROWS.concat([{}]).map((r) => order.availability(r).key), ROWS.concat([{}]).map((r) => newPage.availability(r).key));
same('classChips', order.classChips(ROWS).map((c) => c.key + c.count), newPage.classChips(ROWS).map((c) => c.key + c.count));
const TASKS = [{ TaskNumber: '1.1', TaskName: 'Survey' }, { TaskNumber: '2.1', TaskName: 'Trenching' }];
same('taskMatches', order.taskMatches(TASKS, 'trench'), newPage.taskMatches(TASKS, 'trench'));
same('qtyIn', [order.qtyIn(cart, 21), order.qtyIn(cart, 99)], [newPage.qtyIn(cart, 21), newPage.qtyIn(cart, 99)]);
T.eq('Review needs what New\'s step 3 needs (steps 1 and 2)', order.missingFor('review', blank, []).join('|'),
  newPage.missingFor(1, blank, []).concat(newPage.missingFor(2, blank, [])).join('|'));

T.section('the words a person reads');
T.eq('rental days, both ends counted', order.days(START, END), 26);
T.eq('quick lengths: the end date, both ends counted', [order.endAfter(START, 7), order.endAfter(START, 28), order.endAfter('', 7)].join(), '2026-11-08,2026-11-29,');
T.eq('the length the dates make is marked', order.lengths(START, '2026-11-15').map((l) => l.label + (l.on ? '*' : '')).join(), '1 week,2 weeks*,4 weeks');
T.eq('availability in words', ROWS.concat([{}]).map((r) => order.availability(r).label).join(' | '), '3 free | Not free | Only 4 free | Some dates only | Pick dates');
T.eq('rates as quoted', ROWS.map((r) => order.rateText(r, false)).join(' | '), '$1,400 / day | $300 / day | $25 / unit | $4,800 / week');
T.eq('a cart line\'s rate', [order.rateText(cart[0], false), order.rateText(cart[1], false), order.rateText(cart[2], false)].join(' | '), '$1,400 / day | $25 / unit | $4,800 / week');
T.eq('a quote pending hides every price', order.rateText(ROWS[0], true), 'Rate on request');
const view = order.catalogView(ROWS, START, END, false);
T.eq('a catalog row for the dates', JSON.stringify(view[0]), JSON.stringify({ id: 11, name: 'CAT 320 Excavator', image: '', cls: 'Excavators · Crawler', avail: 'ok', availLabel: '3 free',
  rate: '$1,400 / day', est: '$36,400', estNote: '26 days, each', addable: true }));
T.eq('not free: no estimate, cannot be added', [view[1].est, view[1].addable].join(), ',false');
T.eq('a consumable: each', view[2].est + ' ' + view[2].estNote, '$25 each');
T.eq('no dates: no estimate', order.catalogView(ROWS, '', '', false)[0].est, '');
T.eq('the window', order.windowText(START, END), '2 Nov – 27 Nov 2026 · 26 days');
T.eq('a line in the rail', JSON.stringify(order.cartLine(cart, 31, FORM, false)), JSON.stringify({ id: 31, name: 'Dump truck 30t', cls: 'Trucks', qty: 1, rate: '$4,800 / week',
  cost: '$14,400', start: '2026-11-10', end: END, own: true, window: '10 Nov – 27 Nov 2026 · 18 days', notes: '', agreement: false,
  about: '$4,800 / week · 10 Nov – 27 Nov 2026 · 18 days' }));
T.eq('the lists render from ids', order.cartIds(cart).join(), '11,21,31');
T.eq('still needed, in words, in the screen\'s order (the customer first)', order.stillNeeded(blank, cart), 'Still needed: Start date, End date, Customer, Project, Task and Delivery location.');
T.eq('ready: nothing needed', order.stillNeeded(FORM, cart), '');
T.eq('what Submit does', order.submitWords(cart, null), 'A new request with 3 lines goes to the project\'s approver; it then opens in a tab of its own.');
T.eq('what Submit does for a draft', order.submitWords(cart.slice(0, 1), { requestNumber: 'EQR-000888' }), 'Draft EQR-000888 with 1 line goes to the project\'s approver; it then opens in a tab of its own.');
T.eq('what Save draft does', order.draftWords({ requestNumber: 'EQR-000888' }), 'Save draft updates EQR-000888. Nothing is sent for approval.');
T.eq('a customer request in New EquipRite', [order.customerRequestUrl('http://h/new/', 0), order.customerRequestUrl('http://h/new', 889), order.customerRequestUrl('', 1)].join(' | '),
  'http://h/new/vp/shell/customer/customer-new-request | http://h/new/vp/shell/customer/customer-new-request?draftId=889 | ');
T.eq('the agreement banner', order.agreementText({ id: 12, number: 'AGR-12', customer: 'Acme', lines: 3 }),
  'From agreement AGR-12 · Acme · 3 lines in the cart at the agreement\'s rates. Pick the dates and the project for this rental.');
T.eq('the total in the rail', JSON.stringify(pg.totals(cart, FORM, false)), JSON.stringify({ total: '$87,450', note: '' }));
T.eq('no total before the dates', JSON.stringify(pg.totals([cart[0]], blank, false)), JSON.stringify({ total: '—', note: 'once the dates are in' }));
T.eq('the cart count', [pg.cartCount([]), pg.cartCount(cart)].join(' | '), '0 items | 3 items · 13 pieces');
T.eq('the three steps, as New EquipRite\'s', pg.steps(2).map((x) => x.n + ' ' + x.label + ':' + x.state).join(' | '), '1 Equipment:done | 2 Project:current | 3 Review & submit:todo');
T.eq('a card without a picture shows its class\'s initials; a picture under the app path', [pg.initials('Lifting and Cranes'), pg.imageSrc('img/x.png', '/app/'), pg.imageSrc('https://h/y.png', '/app/'), pg.imageSrc('', '/app/')].join(' | '),
  'LA | /app/img/x.png | https://h/y.png | ');
T.eq('the catalog note', [pg.catalogNote(4, 4, 4, FORM), pg.catalogNote(1, 1, 4, blank)].join(' | '),
  '4 items · free and priced for 2 Nov – 27 Nov 2026 · 26 days | 1 of 4 items · pick the dates to see what is free');

T.section('the header and lines posted');
const detail = order.buildDetail(FORM);
const d = hdr.derive({ request: FORM, ActiveRequestDetail: detail, CartItemsArray: cart, requestOrigin: 'project', fromAgreementId: null });
const body = hdr.build(d, 'REQ-1');
const expect = {
  status: 'DRAFT', requestType: 'INTERNAL', projectRefId: 300000123, projectNumber: 'PRJ-2026-001', projectBuId: 300000001, projectBuName: 'EPC_US_BU',
  taskId: 300000777, taskName: 'Trenching', requestorUserId: null, requestorName: 'Pat Lee', requestorUsername: 'pat.lee',
  eqrCustomerRefId: null, customerName: null, projectInternalCustomerId: 100000555, projectInternalCustomer: 'Acme Utilities',
  projectContractId: 300000999, projectContract: 'K-77', deliveryLocationType: 'PROJECT_SITE', attribute1: '1200 Pipeline Rd, Odessa TX',
  requestedStartDate: '2026-11-02T00:00:00Z', requestedEndDate: '2026-11-27T00:00:00Z', defaultHours: 8, isSoftReservation: 'N', attribute2: 'Gate 3',
};
Object.keys(expect).forEach((k) => T.eq('header ' + k, body[k], expect[k]));
const lctx = { requestId: 9, lineStatus: 'SUBMITTED', detail: { requestedStartDate: START, requestedEndDate: END }, headerHours: null, agreementLineMap: {}, quotePending: false };
T.check('every line: the estimate shown = the estimatedCost posted',
  cart.every((it) => lineBody.build(it, lctx).estimatedCost === order.lineCost(it, START, END, false)));

T.section('Submit and Save draft');
function fakeActions(fail) {
  const calls = [];
  const Actions = {
    async callRest(context, o) {
      calls.push({ endpoint: o.endpoint, uriParams: o.uriParams, body: o.body });
      if (fail === o.endpoint) return { ok: false, status: 500, body: { message: 'boom' } };
      if (o.endpoint === 'eqp-v1/createEquipmentRequest') return { ok: true, status: 201, body: { id: 501, requestNumber: 'EQR-000501' } };
      if (o.endpoint === 'eqp-v1/createShipToSite') return { ok: true, status: 201, body: { id: 55 } };
      return { ok: true, status: 200, body: {} };
    },
    async callChain(context, o) { calls.push({ chain: o.chain, params: o.params }); },
  };
  return { calls, Actions };
}
function fakeBus() {
  const sent = [];
  return { sent, open: (r) => sent.push('open ' + JSON.stringify(r)), close: (id) => sent.push('close ' + id), rename: (id, t) => sent.push('rename ' + id + '=' + t),
    toast: (m, tone) => sent.push('toast ' + (tone || 'info') + ': ' + m) };
}
const requestData = { n: 0, invalidate() { this.n += 1; }, load: async () => ({ rows: [{ eqrEquipmentRequestId: 888, requestNumber: 'EQR-000888' }] }) };
const cu = { auditHeaders: () => ({ 'X-User-Id': 'pat.lee' }), auditActor: () => 'pat.lee', displayName: () => 'Pat Lee' };
function context(form, cartItems, extra, app) {
  const variables = Object.assign({ id: '', number: '', draftId: '', startStep: '', form, cart: cartItems, isSubmitting: false, missing: [], resume: null,
    agreementId: null, agreementLineMap: {}, saveError: '', sent: null, mode: 'build', catalogRows: ROWS, catalogText: '', catalogClass: 'all',
    catalogAvail: '', catalogLimit: 40, hideRates: false, taskOptions: [], contractOptions: [], projectResults: [], customerResults: [] }, extra || {});
  return {
    $page: { variables },
    $application: { variables: Object.assign({ jwt: '', globalSettings: {}, flagsLoaded: true, featureFlags: {}, fusionRoles: [], sessionRoles: [], sessionRolesLoaded: true }, app || {}),
      user: { username: 'pat.lee' } },
  };
}
const ActionChain = class {};
function chain(name, Actions, bus, more) {
  return load(path.join(CHAINS, name + '.js'), Object.assign({
    'vb/action/actionChain': ActionChain, 'vb/action/actions': Actions, 'resources/js/currentUser': cu, 'resources/js/requestLineBody': lineBody,
    'resources/js/requestHeaderBody': hdr, 'resources/js/orderForm': order, 'resources/js/requestData': requestData, 'resources/js/rules': rules,
    'resources/js/shellBus': bus || fakeBus(), 'resources/js/catalogCart': catalogCart, 'resources/js/deliveryCoords': deliveryCoords,
    'resources/js/draftResume': draftResume, 'resources/js/draftStorage': draftStorage,
  }, more || {}));
}
const ends = (calls) => calls.filter((x) => x.endpoint).map((x) => x.endpoint.replace('eqp-v1/', '')).join(' > ');

(async () => {
  {
    const { calls, Actions } = fakeActions();
    const bus = fakeBus();
    const Submit = chain('submitChain', Actions, bus);
    const c = context(FORM, cart);
    const before = requestData.n;
    await new Submit().run(c, { mode: 'submit' });
    T.eq('submit: header, site, site link, lines, status (New\'s order)', ends(calls),
      'createEquipmentRequest > createShipToSite > patchEquipmentRequest > createRequestLinesBatch > patchEquipmentRequest');
    const lines = calls.find((x) => x.endpoint === 'eqp-v1/createRequestLinesBatch');
    T.check('every line SUBMITTED, on the new header', lines.uriParams.requestId === 501 && lines.body.lines.every((l) => l.lineStatus === 'SUBMITTED'));
    T.eq('the header moves to SUBMITTED last', JSON.stringify(calls.filter((x) => x.endpoint === 'eqp-v1/patchEquipmentRequest').pop().body), '{"status":"SUBMITTED"}');
    T.eq('the shared requests are refreshed', requestData.n - before, 1);
    T.eq('it says so and opens the request in its own tab', bus.sent.join(' | '),
      'toast info: Request EQR-000501 was sent for approval. | open {"record":"request","params":{"id":501,"number":"EQR-000501"}}');
    T.eq('then this page starts a new request, saying what was sent', JSON.stringify(calls.filter((x) => x.chain)),
      JSON.stringify([{ chain: 'resetChain', params: { sent: { id: 501, number: 'EQR-000501', mode: 'submit' } } }]));
    T.eq('the busy flag is cleared', c.$page.variables.isSubmitting, false);
  }
  let saved;
  {
    const { calls, Actions } = fakeActions();
    const bus = fakeBus();
    const c = context(FORM, cart);
    await new (chain('submitChain', Actions, bus))().run(c, { mode: 'draft' });
    T.check('draft: lines DRAFT, the header not moved', calls.find((x) => x.endpoint === 'eqp-v1/createRequestLinesBatch').body.lines.every((l) => l.lineStatus === 'DRAFT')
      && calls.filter((x) => x.endpoint === 'eqp-v1/patchEquipmentRequest').length === 1);
    T.eq('the page keeps the draft, to save it in place next time', JSON.stringify(c.$page.variables.resume),
      JSON.stringify({ id: 501, requestNumber: 'EQR-000501', attribute1: '1200 Pipeline Rd, Odessa TX', shipToSiteId: 55 }));
    T.eq('it stays here and says so', bus.sent.join(' | ') + ' / ' + c.$page.variables.sent.mode + ' / ' + c.$page.variables.cart.length,
      'toast info: Draft EQR-000501 was saved. Nothing was sent for approval. / draft / 3');
    saved = c;
  }
  {
    const { calls, Actions } = fakeActions();
    await new (chain('submitChain', Actions))().run(saved, { mode: 'draft' });
    T.eq('saved again: the same request, lines replaced, no second site', ends(calls), 'patchEquipmentRequest > replaceRequestLinesBatch');
    T.check('... keeping its number and status', !('status' in calls[0].body) && !('requestNumber' in calls[0].body) && calls[0].uriParams.id === 501);
  }
  {
    const { calls, Actions } = fakeActions('eqp-v1/createRequestLinesBatch');
    const bus = fakeBus();
    const c = context(FORM, cart);
    const before = requestData.n;
    await new (chain('submitChain', Actions, bus))().run(c, { mode: 'submit' });
    T.check('a failed line batch deletes the new header and never sets SUBMITTED',
      calls.some((x) => x.endpoint === 'eqp-v1/deleteEquipmentRequest') && !calls.some((x) => x.endpoint === 'eqp-v1/patchEquipmentRequest' && x.body && x.body.status));
    T.check('... says so on the page, keeps the cart, opens nothing', /Request not submitted\. boom Nothing was saved/.test(c.$page.variables.saveError)
      && c.$page.variables.cart.length === 3 && !bus.sent.some((s) => s.startsWith('open')) && requestData.n === before);
  }
  {
    const { calls, Actions } = fakeActions('eqp-v1/createEquipmentRequest');
    const c = context(FORM, cart);
    await new (chain('submitChain', Actions))().run(c, { mode: 'submit' });
    T.eq('a failed header stops there', ends(calls), 'createEquipmentRequest');
    T.eq('... in words', c.$page.variables.saveError, 'Request not submitted: the request could not be created (HTTP 500). Your cart is unchanged.');
  }
  {
    const { calls, Actions } = fakeActions();
    const c = context(Object.assign({}, FORM, { taskId: null }), cart);
    await new (chain('submitChain', Actions))().run(c, { mode: 'submit' });
    T.check('an incomplete request calls nothing and lists what is missing', calls.length === 0 && c.$page.variables.missing.join() === 'Task');
  }
  {
    const { calls, Actions } = fakeActions();
    const c = context(FORM, cart);
    const s = new (chain('submitChain', Actions))();
    await Promise.all([s.run(c, { mode: 'submit' }), s.run(c, { mode: 'submit' })]);
    T.eq('a double click creates one request', calls.filter((x) => x.endpoint === 'eqp-v1/createEquipmentRequest').length, 1);
  }
  {
    const { calls, Actions } = fakeActions();
    const bus = fakeBus();
    const c = context(FORM, cart, { id: '888', resume: { id: 888, requestNumber: 'EQR-000888', attribute1: '1200 Pipeline Rd, Odessa TX', shipToSiteId: 5 } });
    await new (chain('submitChain', Actions, bus))().run(c, { mode: 'submit' });
    T.eq('a draft tab: updated in place, lines replaced, status', ends(calls), 'patchEquipmentRequest > replaceRequestLinesBatch > patchEquipmentRequest');
    T.eq('... the request opens and the draft\'s tab closes', bus.sent.slice(1).join(' | '), 'open {"record":"request","params":{"id":888,"number":"EQR-000888"}} | close draft:888');
  }
  {
    const { calls, Actions } = fakeActions();
    const c = context(FORM, cart, {}, { globalSettings: { ENABLE_QUOTES: 'PROJECTS' } });
    await new (chain('submitChain', Actions))().run(c, { mode: 'submit' });
    T.check('a quote coming: no price posted', calls.find((x) => x.endpoint === 'eqp-v1/createRequestLinesBatch').body.lines.every((l) => l.billRate === null && l.estimatedCost === null));
  }
  {
    const { calls, Actions } = fakeActions();
    const c = context(FORM, [Object.assign({}, cart[0], { source: 'agreement' })], { agreementId: 12, agreementLineMap: { 11: 9001 } });
    await new (chain('submitChain', Actions))().run(c, { mode: 'submit' });
    T.eq('an agreement request: on the header and on each line', [calls[0].body.eqrAgreementHeaderId,
      calls.find((x) => x.endpoint === 'eqp-v1/createRequestLinesBatch').body.lines[0].eqrAgreementLineId].join(), '12,9001');
  }

  T.section('the cart');
  {
    const c = context(FORM, [], { missing: ['Task'] });
    const run = (p) => new (chain('cartChain', fakeActions().Actions))().run(c, p);
    await run({ action: 'add', id: '11' });
    await run({ action: 'add', id: '11' });
    await run({ action: 'add', id: '21' });
    T.eq('add twice = one line of 2', c.$page.variables.cart.map((i) => i.id + 'x' + i.quantity).join(), '11x2,21x1');
    T.eq('a change clears the missing list', c.$page.variables.missing.length, 0);
    await run({ action: 'dec', id: '21' });
    T.eq('down to 0 removes the line', c.$page.variables.cart.length, 1);
    await run({ action: 'line', id: '11', field: 'notes', value: 'With operator' });
    await run({ action: 'set', id: '11', value: '0' });
    T.eq('a typed quantity is at least 1, notes kept', c.$page.variables.cart[0].quantity + '|' + c.$page.variables.cart[0].notes, '1|With operator');
    await run({ action: 'line', id: '11', field: 'notes', value: '' });
    T.check('clearing a line value falls back to the request', !('notes' in c.$page.variables.cart[0]));
  }

  T.section('fields');
  {
    const { calls, Actions } = fakeActions();
    const c = context(Object.assign({}, blank, { startDate: START }), [], { contractOptions: [{ id: '300000999', label: 'K-77' }],
      taskOptions: [{ TaskId: 3, TaskNumber: '2.1', TaskName: 'Trenching' }] });
    const run = (p) => new (chain('setFieldChain', Actions))().run(c, p);
    await run({ field: 'length', value: '14' });
    T.eq('a quick length sets the end date and asks the catalog again', c.$page.variables.form.endDate + ' ' + calls.map((x) => x.chain).join(), '2026-11-15 loadCatalogChain');
    await run({ field: 'taskId', value: '3' });
    T.eq('a task keeps its number and name', [c.$page.variables.form.taskId, c.$page.variables.form.taskNumber, c.$page.variables.form.taskName].join(), '3,2.1,Trenching');
    c.$page.variables.form = Object.assign({}, c.$page.variables.form, { projectId: 1, locationType: 'PROJECT_SITE', location: 'old site', locationLatitude: 1, locationLongitude: 2 });
    calls.length = 0;
    await run({ field: 'contractId', value: '300000999' });
    T.eq('a contract clears the site and loads its sites', c.$page.variables.form.contractNumber + '|' + c.$page.variables.form.location + '|' + calls.map((x) => x.chain).join(), 'K-77||loadSitesChain');
    await run({ field: 'location', value: '1 Main St' });
    T.eq('a typed address drops old coordinates', JSON.stringify([c.$page.variables.form.location, c.$page.variables.form.locationLatitude]), '["1 Main St",null]');
    await run({ field: 'notes', value: 'set by the page', from: 'external' });
    T.eq('only typed notes count', c.$page.variables.form.notes, '');
    await run({ field: 'hours', value: '8' });
    T.eq('hours are a number', c.$page.variables.form.hours, 8);
    await run({ field: 'requestFor', value: 'customer' });
    T.eq('customer request', c.$page.variables.requestFor, 'customer');
  }

  T.section('picking a project or a customer');
  {
    const { calls, Actions } = fakeActions();
    const c = context(Object.assign({}, FORM, { projectId: null, taskId: 7, contractId: 9 }), cart, {
      projectResults: [{ id: '300000123', label: 'Pipeline North', sub: 'PRJ-2026-001' }], customerResults: [{ id: '100000555', label: 'Acme Utilities' }] });
    await new (chain('pickChain', Actions))().run(c, { kind: 'project', index: '0' });
    const f = c.$page.variables.form;
    T.eq('the project, its task and contract cleared', [f.projectId, f.projectName, f.projectNumber, f.taskId, f.contractId, f.location].join('|'), '300000123|Pipeline North|PRJ-2026-001|||');
    T.eq('its lists load and the catalog is asked for its rates', calls.map((x) => x.chain + (x.params ? JSON.stringify(x.params) : '')).join(),
      'loadProjectListsChain{"withBusinessUnit":true},loadCatalogChain');
    calls.length = 0;
    await new (chain('pickChain', Actions))().run(c, { kind: 'customer', index: '0' });
    T.eq('a customer: its Fusion id and name, nothing else asked', [c.$page.variables.form.customerId, c.$page.variables.form.customerName, calls.length].join(), '100000555,Acme Utilities,0');
  }

  T.section('Review');
  {
    const { calls, Actions } = fakeActions();
    const c = context(Object.assign({}, FORM, { taskId: null }), cart);
    await new (chain('reviewChain', Actions))().run(c, { to: 'review' });
    T.eq('something missing: stays, says what', c.$page.variables.mode + ' ' + c.$page.variables.missing.join(), 'build Task');
    c.$page.variables.form = FORM;
    await new (chain('reviewChain', Actions))().run(c, { to: 'review' });
    T.eq('complete: Review, the delivery point found, the catalog asked again', [c.$page.variables.mode, c.$page.variables.form.locationLatitude,
      calls.map((x) => x.chain).join()].join(), 'review,31.85,loadCatalogChain');
    T.eq('Review is step 3', c.$page.variables.step, 3);
    await new (chain('reviewChain', Actions))().run(c, { to: 'build' });
    T.eq('back to editing', c.$page.variables.mode + ' ' + c.$page.variables.step, 'build 2');
  }

  T.section('the steps (New EquipRite\'s goStepChain)');
  {
    const { calls, Actions } = fakeActions();
    const c = context(Object.assign({}, FORM), []);
    c.$page.variables.step = 1;
    await new (chain('goStepChain', Actions))().run(c, { step: '2' });
    T.eq('no equipment yet: stays on step 1 and says what is missing', c.$page.variables.step + ' ' + c.$page.variables.missing.join(), '1 At least one piece of equipment');
    c.$page.variables.cart = cart;
    await new (chain('goStepChain', Actions))().run(c, { step: '2' });
    T.eq('dates and equipment in: on to the project', c.$page.variables.step + ' ' + c.$page.variables.missing.length, '2 0');
    await new (chain('goStepChain', Actions))().run(c, { step: '1' });
    T.eq('back is always allowed', c.$page.variables.step, 1);
    calls.length = 0;
    c.$page.variables.form = Object.assign({}, FORM, { customerId: null, projectId: null });
    await new (chain('goStepChain', Actions))().run(c, { step: '2' });
    c.$page.variables.form = FORM;
    T.eq('the Project step lists the customers and projects straight away', calls.map((x) => x.chain + JSON.stringify(x.params)).join(' '),
      'searchChain{"kind":"customer","text":""} searchChain{"kind":"project","text":""}');
    calls.length = 0;
    await new (chain('goStepChain', Actions))().run(c, { step: '3' });
    T.eq('Review is reviewChain\'s (its checks, the delivery point, the prices)', calls.map((x) => x.chain + JSON.stringify(x.params)).join(), 'reviewChain{"to":"review"}');
  }

  T.section('the customer and project lists, from their BIP reports');
  {
    // The SOAP body is the real one (bipLov.buildSoapBody); decoding the report needs a browser's XML parser, so the
    // answer here is the decoded rows.
    const real = load(path.join(JS, 'bipLov.js'));
    const sent = [];
    const ROWS = {
      EQP_CUSTOMERS_LOV_RP: [{ CUSTOMERID: '1', CUSTOMER: 'Acme Utilities', CUSTOMERNUMBER: 'C-1' }, { CUSTOMERID: '2', CUSTOMER: 'Bayou Energy', CUSTOMERNUMBER: 'C-2' }],
      EQP_PROJECTS_LOV_RP: [{ PROJECTID: '9', PROJECTNAME: 'Pipeline North', PROJECTNUMBER: 'PRJ-9' }],
    };
    const bip = { buildSoapBody: real.buildSoapBody, decodeReportRows: (body) => (body && body.rows) || [] };
    const Actions = { async callRest(ctx, o) {
      sent.push(o.body);
      return { ok: true, status: 200, body: { rows: ROWS[o.body.includes('EQP_CUSTOMERS_LOV_RP') ? 'EQP_CUSTOMERS_LOV_RP' : 'EQP_PROJECTS_LOV_RP'] } };
    }, async callChain() {} };
    const Search = chain('searchChain', Actions, null, { 'resources/js/bipLov': bip });
    const c = context(Object.assign({}, FORM), cart);
    await new Search().run(c, { kind: 'customer', text: '' });
    T.eq('nothing typed: the report\'s own list', c.$page.variables.customerResults.map((r) => r.label).join(), 'Acme Utilities,Bayou Energy');
    T.check('asked with a blank search over name and number', /EQP_CUSTOMERS_LOV_RP[\s\S]*P_SEARCH<\/pub:name><pub:values><pub:item><\/pub:item>[\s\S]*P_SEARCH_BY[\s\S]*ALL/.test(sent[0]), sent[0]);
    await new Search().run(c, { kind: 'customer', text: '' });
    T.eq('the list is kept: not asked again', sent.length, 1);
    await new Search().run(c, { kind: 'project', text: 'pipe' });
    T.check('typed text narrows it (the report is asked with it)', sent[1].includes('EQP_PROJECTS_LOV_RP') && sent[1].includes('<pub:item>pipe</pub:item>')
      && c.$page.variables.projectResults[0].label === 'Pipeline North');
    T.eq('the note under each list', [pg.listNote('customer', c.$page.variables.customerResults, '', false), pg.listNote('project', c.$page.variables.projectResults, 'pipe', false),
      pg.listNote('project', [], 'zzz', false), pg.listNote('project', [], '', true)].join(' | '),
      '2 customers from Oracle Fusion · type a name or number to narrow | 1 project matches “pipe”. | No project matches “zzz”. | Searching…');
  }

  T.section('the catalog');
  {
    const { calls, Actions } = fakeActions();
    Actions.callRest = async (ctx, o) => { calls.push(o); return { ok: true, body: { data: [Object.assign({}, ROWS[0], { rate: 1260 }), ROWS[2]] } }; };
    const c = context(Object.assign({}, FORM, { locationLatitude: 31.85, locationLongitude: -102.37 }), [cart[0], cart[1]], { agreementId: null });
    await new (chain('loadCatalogChain', Actions))().run(c);
    T.eq('asked with dates, availability, project and the delivery point', JSON.stringify(calls[0].uriParams),
      JSON.stringify({ page: 0, size: 10000, startDate: START, endDate: END, requestedQty: 1, projectRefId: 300000123, latitude: 31.85, longitude: -102.37 }));
    T.eq('the cart is priced again, keeping quantities', c.$page.variables.cart.map((i) => i.id + 'x' + i.quantity + '@' + i.billingRate).join(), '11x2@1260,21x10@25');
    T.eq('and says so', c.$page.variables.priceNote, '1 price was updated for project PRJ-2026-001 and these dates.');
    T.eq('then the list is worked out', calls.filter((x) => x.chain).map((x) => x.chain).join(), 'applyCatalogChain');
    calls.length = 0;
    await new (chain('loadCatalogChain', Actions))().run(context(blank, []));
    T.eq('nothing unknown is sent (no "undefined")', JSON.stringify(calls[0].uriParams), '{"page":0,"size":10000}');
    const v = context(FORM, [], { catalogRows: ROWS, catalogClass: 'Gone', catalogAvail: 'free', catalogLimit: 2 });
    await new (chain('applyCatalogChain', Actions))().run(v);
    T.eq('shown: free ones, at most the limit, an unknown class falls back to all', [v.$page.variables.catalogClass, v.$page.variables.catalogCount,
      v.$page.variables.catalogShown.map((r) => r.id).join('+')].join(), 'all,3,11+21');
    await new (chain('filterCatalogChain', Actions))().run(v, { more: true });
    T.eq('Show more', v.$page.variables.catalogLimit, 42);
  }

  T.section('opening it');
  {
    const DRAFT = { id: 888, requestNumber: 'EQR-000888', status: 'DRAFT', requestType: 'INTERNAL', projectRefId: 300000123, projectNumber: 'PRJ-2026-001',
      projectName: 'Pipeline North', projectBuName: 'EPC_US_BU', taskId: 3, taskNumber: '2.1', taskName: 'Trenching', requestorName: 'John Dunbar',
      projectInternalCustomerId: 100000555, projectInternalCustomer: 'Acme Utilities', attribute1: '1 Main St', attribute2: 'Gate code 4417', shipToSiteId: 55,
      requestedStartDate: '2026-12-01T00:00:00Z', requestedEndDate: '2026-12-14T00:00:00Z' };
    const backend = (header) => {
      const calls = [];
      const Actions = {
        async callRest(ctx, o) {
          calls.push(o);
          if (o.endpoint === 'eqp-v1/getEquipriteV1EquipmentRequestById') return { ok: true, body: header };
          if (o.endpoint === 'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2') return { ok: true, body: { data: [{ eqrEquipmentMasterId: 31, quantity: 2 }, { eqrEquipmentMasterId: 99, quantity: 1 }] } };
          return { ok: true, body: { data: ROWS } };
        },
        async callChain(ctx, o) { calls.push({ chain: o.chain, params: o.params }); },
      };
      return { calls, Actions };
    };
    const { calls, Actions } = backend(DRAFT);
    const bus = fakeBus();
    const c = context({}, [], { id: '888', startStep: 'review', isLoading: true });
    await new (chain('initChain', Actions, bus))().run(c);
    const v = c.$page.variables;
    T.eq('a draft tab: the draft, priced from today\'s catalog', [v.form.projectName, v.form.startDate, v.form.notes, v.cart.map((i) => i.id + 'x' + i.quantity).join()].join('|'),
      'Pipeline North|2026-12-01|Gate code 4417|31x2');
    T.eq('saved in place from now on', JSON.stringify(v.resume), JSON.stringify({ id: 888, requestNumber: 'EQR-000888', attribute1: '1 Main St', shipToSiteId: 55 }));
    T.eq('the tab is named after it', bus.sent.join(), 'rename draft:888=Draft EQR-000888');
    T.eq('a line no longer in the catalog is reported', v.priceNote, '1 line of the draft is no longer in the catalog, so it was left out.');
    T.eq('the project\'s lists, then Review', calls.filter((x) => x.chain).map((x) => x.chain + JSON.stringify(x.params)).join(),
      'loadProjectListsChain{"withBusinessUnit":false},reviewChain{"to":"review"}');
    T.check('read only', calls.every((x) => !x.endpoint || /^eqp-v1\/get/.test(x.endpoint)));

    const ext = backend(Object.assign({}, DRAFT, { id: 889, requestNumber: 'EQR-000889', requestType: 'EXTERNAL' }));
    const ce = context({}, [], { id: '889' });
    await new (chain('initChain', ext.Actions))().run(ce);
    T.check('a customer draft: says where it is edited', ce.$page.variables.externalDraftId === 889 && /customer request.*New EquipRite/.test(ce.$page.variables.loadError));

    const sub = backend(Object.assign({}, DRAFT, { status: 'SUBMITTED' }));
    const cs = context({}, [], { id: '888' });
    await new (chain('initChain', sub.Actions))().run(cs);
    T.eq('a request no longer a draft', cs.$page.variables.loadError, 'Only a request in Draft status can be reopened; this one is SUBMITTED.');

    const byNumber = backend(DRAFT);
    const cn = context({}, [], { number: 'eqr-000888' });
    await new (chain('initChain', byNumber.Actions, fakeBus()))().run(cn);
    T.eq('a draft tab opened by its number finds its id', cn.$page.variables.resume && cn.$page.variables.resume.id, 888);

    session.setItem('eqr.agreement.active', '1');
    draftStorage.save('fromAgreementId', 12);
    draftStorage.save('fromAgreementNumber', 'AGR-12');
    draftStorage.save('fromAgreementCustomer', 'Acme Utilities');
    draftStorage.save('fromAgreementFusionCustomerId', 100000555);
    draftStorage.save('agreementLineIdByEquipmentId', { 31: 9001 });
    draftStorage.save('CartItemsArray', [{ id: '31', name: 'Dump truck 30t', quantity: '2', billingRate: 700, source: 'agreement' }]);
    const fresh = backend(DRAFT);
    const ca = context({}, [], {}, { featureFlags: { AGREEMENTS_ENABLED: 'true', TIMESHEETS_ENABLED: 'true' }, globalSettings: { ENABLE_QUOTES: 'CUSTOMER' },
      sessionRoles: ['EQUIP_MGR'] });
    await new (chain('initChain', fresh.Actions))().run(ca);
    const a = ca.$page.variables;
    T.eq('the agreement hand-over: cart, agreement, customer', [a.cart.map((i) => i.id + 'x' + i.quantity).join(), a.agreementId, JSON.stringify(a.agreementLineMap),
      a.form.customerId, a.form.customerName, JSON.stringify(a.fromAgreement)].join(' | '),
    '31x2 | 12 | {"31":9001} | 100000555 | Acme Utilities | {"id":12,"number":"AGR-12","customer":"Acme Utilities","lines":1}');
    T.eq('used once', [session.getItem('eqr.agreement.active'), draftStorage.load('fromAgreementId')].join(), ',');
    T.eq('the requestor is the signed-in user; switches from the settings', [a.form.requestorName, a.form.requestorUsername, a.hideRates, a.showHours, a.customerQuotes, a.canCustomer].join(),
      'Pat Lee,pat.lee,false,true,true,false');
    T.eq('nothing written, then the catalog', fresh.calls.map((x) => x.chain || x.endpoint).join(), 'loadCatalogChain');
    const cm = context({}, [], { requestFor: 'project' }, { featureFlags: { CUSTOMERS_MODULE_ENABLED: 'true', PROJECTS_MODULE_ENABLED: 'true' }, sessionRoles: ['EQUIP_MGR'] });
    await new (chain('initChain', backend(DRAFT).Actions))().run(cm);
    T.eq('a manager, both modules: may choose a customer request', [cm.$page.variables.canCustomer, cm.$page.variables.requestFor].join(), 'true,project');
    const cr = context({}, [], { requestFor: 'project' }, { featureFlags: { CUSTOMERS_MODULE_ENABLED: 'true', PROJECTS_MODULE_ENABLED: 'true' }, sessionRoles: ['REQUESTOR'] });
    await new (chain('initChain', backend(DRAFT).Actions))().run(cr);
    T.eq('a requestor may not', cr.$page.variables.canCustomer, false);
    const co = context({}, [], { requestFor: 'project' }, { featureFlags: { CUSTOMERS_MODULE_ENABLED: 'true' }, sessionRoles: ['EQUIP_MGR'] });
    await new (chain('initChain', backend(DRAFT).Actions))().run(co);
    T.eq('licensed for customer requests only: a customer request, no choice', [co.$page.variables.canCustomer, co.$page.variables.requestFor].join(), 'false,customer');
  }

  T.section('starting another');
  {
    const { calls, Actions } = fakeActions();
    const c = context(FORM, cart, { resume: { id: 1 }, mode: 'review', agreementId: 3 });
    await new (chain('resetChain', Actions))().run(c, { sent: { id: 501, number: 'EQR-000501', mode: 'submit' } });
    const v = c.$page.variables;
    T.eq('an empty request for the signed-in user', [v.cart.length, v.resume, v.agreementId, v.mode, v.form.requestorName, v.form.startDate, v.sent.number].join(),
      '0,,,build,Pat Lee,,EQR-000501');
    T.eq('the catalog without dates', calls.map((x) => x.chain).join(), 'loadCatalogChain');
    const bus = fakeBus();
    const d2 = context(FORM, cart, { id: '888' });
    await new (chain('resetChain', Actions, bus))().run(d2, {});
    T.eq('in a draft\'s tab it opens New request instead', bus.sent.join() + ' ' + d2.$page.variables.cart.length, 'open {"navId":"new-request"} 3');
  }

  T.section('menu, tab and page');
  T.eq('New request is built: its own screen', JSON.stringify(nav.routeOf(nav.item('new-request'))), '{"flow":"order","page":"new-request","params":{}}');
  const dt = tabs.forRecord('draft', { id: 888, number: 'EQR-000888' });
  T.eq('a draft opens in a tab of its own', [dt.id, dt.flow, dt.page, dt.title, dt.navId].join(), 'draft:888,order,new-request,Draft EQR-000888,new-request');
  T.eq('a deep link to a draft', tabs.fromQuery('?open=draft&id=888').id, 'draft:888');
  T.check('a draft tab is open to whoever may raise a request', nav.itemVisible(nav.item(dt.navId), { EQR_PROJ_CREATE_REQUEST: 'FULL' }, true, {}, true, {})
    && !nav.itemVisible(nav.item(dt.navId), { EQR_EQUIPMENT_REQUESTS: 'FULL' }, true, {}, true, {}));
  const pageJson = JSON.parse(fs.readFileSync(path.join(PAGE, 'new-request-page.json'), 'utf8'));
  const flowJson = JSON.parse(fs.readFileSync(path.join(NEXT, 'flows', 'order', 'order-flow.json'), 'utf8'));
  T.check('page and flow are embeddable', pageJson.navigation.embeddable === 'enabled' && flowJson.navigation.embeddable === 'enabled' && flowJson.pages['new-request']);
  T.check('the tab inputs come from the caller', ['id', 'number', 'draftId', 'startStep'].every((k) => pageJson.variables[k].input === 'fromCaller'));
  const named = new Set();
  Object.values(pageJson.eventListeners).forEach((l) => l.chains.forEach((x) => named.add(x.chain)));
  fs.readdirSync(CHAINS).forEach((f) => {
    (fs.readFileSync(path.join(CHAINS, f), 'utf8').match(/chain: '([A-Za-z]+)'/g) || []).forEach((m) => named.add(m.replace(/chain: '|'/g, '')));
  });
  const missingChains = [...named].filter((n) => !fs.existsSync(path.join(CHAINS, n + '.js')));
  T.eq('every chain named exists', missingChains.join(), '');
  fs.readdirSync(CHAINS).forEach((f) => {
    const cls = (fs.readFileSync(path.join(CHAINS, f), 'utf8').match(/class (\w+) extends ActionChain/) || [])[1];
    T.check(f + ' is the class named like the file', cls === f.replace('.js', ''));
  });
  const html = fs.readFileSync(path.join(PAGE, 'new-request-page.html'), 'utf8');
  const bindings = html.match(/\[\[[\s\S]*?\]\]/g) || [];
  T.check('bindings: no arrow functions, no String() / Number() / Boolean()', bindings.every((b) => !/=>|\bString\(|\bNumber\(|\bBoolean\(/.test(b)),
    bindings.filter((b) => /=>|\bString\(|\bNumber\(|\bBoolean\(/.test(b)).join(' '));
  T.check('no for-each inside a table, tbody or select', !/<(table|tbody|select)[\s>][\s\S]*?oj-bind-for-each[\s\S]*?<\/\1>/.test(html));
  const usedFns = new Set((html.match(/\$functions\.(\w+)/g) || []).map((m) => m.split('.')[1]));
  T.eq('every page function used exists', [...usedFns].filter((n) => typeof pg[n] !== 'function').join(), '');
  const usedListeners = new Set((html.match(/\$listeners\.(\w+)/g) || []).map((m) => m.split('.')[1]));
  T.eq('every listener used is declared', [...usedListeners].filter((n) => !pageJson.eventListeners[n]).join(), '');
  const appFlow = JSON.parse(fs.readFileSync(path.join(NEXT, 'app-flow.json'), 'utf8'));
  T.check('its stylesheet is imported', appFlow.imports.css.indexOf('resources/css/next-order.css') !== -1);
  const css = fs.readFileSync(path.join(NEXT, 'resources', 'css', 'next-order.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = (css.match(/[^{}]+(?=\{)/g) || []).filter((s) => !/^\s*@media/.test(s))
    .map((s) => s.replace(/^[\s\S]*@media[^{]*$/, '')).join(',').split(',').map((s) => s.trim()).filter(Boolean);
  T.check('every rule is its own (starts with an .nx-or- class); shared classes are not restyled', selectors.length > 50 && selectors.every((s) => s.startsWith('.nx-or-')),
    selectors.filter((s) => !s.startsWith('.nx-or-')).join(' '));

  T.section('every endpoint called exists in services/');
  const ops = {};
  ['eqp-v1', 'bipService', 'ProjectLOV'].forEach((svc) => {
    const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'services', svc, 'openapi3.json'), 'utf8'));
    Object.values(spec.paths || {}).forEach((p) => Object.values(p).forEach((op) => { if (op && op.operationId) ops[svc + '/' + op.operationId] = true; }));
  });
  const used = new Set();
  const files = fs.readdirSync(CHAINS).map((f) => path.join(CHAINS, f))
    .concat(['requestHeaderBody', 'requestLineBody', 'draftResume', 'projectBusinessUnit'].map((f) => path.join(JS, f + '.js')));
  files.forEach((f) => (fs.readFileSync(f, 'utf8').match(/endpoint:\s*'([^']+)'/g) || []).forEach((m) => used.add(m.replace(/endpoint:\s*'/, '').replace("'", ''))));
  [...used].sort().forEach((e) => T.check(e, !!ops[e]));

  T.report();
})();
