/*
 * EquipRite Next, the customer portal (webApps/equiprite-next/flows/customer). Loads the real modules.
 *
 *   - the rules are New EquipRite's: customerPortal.js, rentalTerms.js and requestModel.js stay byte-identical to New's,
 *     and the order page's rules (customerOrder.js) give the answers of New's customer New request page module
 *   - the writes make exactly New's calls: the same scenarios run through New's customer chains and Next's side by
 *     side and the calls and bodies are compared (accept a delivery, refuse it, start a return, delete a draft, send a
 *     request, save a draft); where New writes to Fusion (a consumable issued from stock on delivery, the sell contract
 *     made at send with customer quoting off, accepting a quote) Next writes nothing
 *   - what the customer reads: words from the equipment, what needs them, the tiles, chips, filters, invoices, export
 *   - the reads: only the customer's own requests are read; nothing is written on entry
 *   - the pages: listeners, functions, variables and chains line up, VB binding rules, the menu, the record kinds
 *
 * Run:  node tests/next-customer.test.js
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
const NEW_JS = path.join(NEW, 'resources', 'js');
const PAGES = path.join(NEXT, 'flows', 'customer', 'pages');
const NEW_PAGES = path.join(NEW, 'flows', 'customer', 'pages');

function loadAmd(file, deps) {
  const sandbox = {
    console: { log() {}, warn() {}, error() {}, info() {} }, setTimeout, Promise, Blob, Date, Math, JSON, Number, String, Object, Array, isNaN, Set, Map,
    encodeURIComponent, TextEncoder, URLSearchParams, Intl, Uint8Array, atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    URL: { createObjectURL: () => 'blob:quote', revokeObjectURL() {} },
  };
  let mod;
  sandbox.define = (names, factory) => { mod = factory(...names.map((n) => (deps && n in deps ? deps[n] : {}))); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: path.basename(file) });
  return mod;
}
const js = (name, deps) => loadAmd(path.join(JS, name + '.js'), deps);
const same = (name) => fs.readFileSync(path.join(JS, name + '.js'), 'utf8') === fs.readFileSync(path.join(NEW_JS, name + '.js'), 'utf8');

const rules = js('rules');
const fmt = js('fmt');
const Progress = js('requestProgress');
const portal = js('customerPortal');
const terms = js('rentalTerms');
const requestModel = js('requestModel');
const lineBody = js('requestLineBody');
const catalogCart = js('catalogCart');
const exportKit = js('exportKit');
const nav = js('nav', { 'resources/js/rules': rules });
const tabs = js('tabs', { 'resources/js/nav': nav });
const geocoder = { lookup: async (q) => (q ? { latitude: 31.85, longitude: -102.37, formattedAddress: q + ', United States' } : null) };
const hdr = js('requestHeaderBody', { 'resources/js/geocoder': geocoder });
const deliveryCoords = js('deliveryCoords', { 'resources/js/geocoder': geocoder });
const draftStorage = { save() {}, load() { return null; }, clear() {} };
const draftResume = js('draftResume', { 'resources/js/requestHeaderBody': hdr, 'resources/js/catalogCart': catalogCart, 'resources/js/draftStorage': draftStorage });
const V = js('portalView', { 'resources/js/requestProgress': Progress, 'resources/js/customerPortal': portal, 'resources/js/fmt': fmt });
const O = js('customerOrder', { 'resources/js/requestLineBody': lineBody, 'resources/js/requestModel': requestModel, 'resources/js/fmt': fmt });
const fusion = loadAmd(path.join(NEW_JS, 'fusionContractDefaults.js'));

const signalLog = [];
const signal = { listen() {}, changed: () => signalLog.push('changed') };
const realSignal = js('portalSignal');
const PAGE_DEPS = {
  'resources/js/portalSignal': signal,
  'resources/js/exportKit': exportKit, 'resources/js/fmt': fmt, 'resources/js/customerPortal': portal, 'resources/js/portalView': V,
  'resources/js/rentalTerms': terms, 'resources/js/customerOrder': O,
};
const NextPortal = loadAmd(path.join(PAGES, 'portal-page.js'), PAGE_DEPS);
const NextRequest = loadAmd(path.join(PAGES, 'request-page.js'), PAGE_DEPS);
const NextQuote = loadAmd(path.join(PAGES, 'quote-page.js'), PAGE_DEPS);
const NextInvoice = loadAmd(path.join(PAGES, 'invoice-page.js'), PAGE_DEPS);
const NextOrder = loadAmd(path.join(PAGES, 'order-page.js'), PAGE_DEPS);
const NewRequestPage = loadAmd(path.join(NEW_PAGES, 'customer-request-page.js'), { 'resources/js/customerPortal': portal });
const NewQuotePage = loadAmd(path.join(NEW_PAGES, 'customer-quote-page.js'), { 'resources/js/customerPortal': portal });
const NewContractPage = loadAmd(path.join(NEW_PAGES, 'customer-contract-page.js'), { 'resources/js/customerPortal': portal, 'resources/js/rentalTerms': terms });
const NewOrderPage = loadAmd(path.join(NEW_PAGES, 'customer-new-request-page.js'), {
  'resources/js/requestLineBody': lineBody, 'resources/js/requestModel': requestModel, 'resources/js/rentalTerms': terms, 'resources/js/customerPortal': portal,
});

const cu = { auditHeaders: () => ({ 'X-User-Id': 'maria.torres' }), auditActor: () => 'maria.torres', displayName: () => 'Maria Torres' };
const busLog = [];
const bus = {
  open: (r) => busLog.push('open ' + JSON.stringify(r)),
  rename: (id, t) => busLog.push('rename ' + id + '=' + t),
  toast: (m, tone) => busLog.push('toast ' + tone + ': ' + m),
  close: (id) => busLog.push('close ' + id),
};

/** A fake Actions that records every call; `answer(o, calls)` returns a response or undefined (200 {}). */
function fake(answer) {
  const calls = [];
  const Actions = {
    async callRest(ctx, o) {
      calls.push({ endpoint: o.endpoint, uriParams: o.uriParams || {}, body: o.body, headers: o.headers });
      const r = answer ? answer(o, calls) : undefined;
      return r === undefined ? { ok: true, status: 200, body: {} } : r;
    },
    async fireNotificationEvent(ctx, n) { calls.push({ toast: n.summary, type: n.type, message: n.message }); },
    async callChain(ctx, n) { calls.push({ chain: n.chain, params: n.params }); },
    async navigateToPage(ctx, n) { calls.push({ nav: n.page, params: n.params }); },
    async callComponentMethod() {},
  };
  return { calls, Actions };
}
const ok = (body) => ({ ok: true, status: 200, body });
const fail = (status) => ({ ok: false, status: status || 500, body: { message: 'boom' } });
const rest = (calls) => calls.filter((c) => c.endpoint);
const writes = (calls) => rest(calls).filter((c) => !/\/get[A-Z]/.test(c.endpoint));
const norm = (calls) => rest(calls).map((c) => JSON.stringify([c.endpoint, c.uriParams, c.body || null, c.headers || {}])).join('\n');
const names = (calls) => rest(calls).map((c) => c.endpoint.replace(/^eqp-v1\//, '')).join(' > ');

const DEPS = {
  'vb/action/actionChain': class {}, 'resources/js/currentUser': cu, 'resources/js/requestLineBody': lineBody, 'resources/js/shellBus': bus,
  'resources/js/rules': rules, 'resources/js/customerPortal': portal, 'resources/js/portalView': V, 'resources/js/customerOrder': O,
  'resources/js/exportKit': exportKit, 'resources/js/draftResume': draftResume, 'resources/js/requestHeaderBody': hdr,
  'resources/js/deliveryCoords': deliveryCoords, 'resources/js/catalogCart': catalogCart, 'resources/js/fusionContractDefaults': fusion,
  'resources/js/portalSignal': signal, 'resources/js/requestData': { invalidate: () => signalLog.push('invalidated') },
};
const nextChain = (page, name, Actions) => loadAmd(path.join(PAGES, page + '-page-chains', name + '.js'), Object.assign({}, DEPS, { 'vb/action/actions': Actions }));
const newChain = (page, name, Actions) => loadAmd(path.join(NEW_PAGES, page + '-page-chains', name + '.js'), Object.assign({}, DEPS, { 'vb/action/actions': Actions }));

const APP = (settings, extra) => Object.assign({
  featureFlags: { CUSTOMERS_MODULE_ENABLED: 'true' }, flagsLoaded: true, globalSettings: settings || { ENABLE_QUOTES: 'CUSTOMER' },
  pageAccessMap: { EQR_CUST_DASHBOARD: 'FULL', EQR_CUST_MY_REQUESTS: 'FULL', EQR_CUST_CREATE_REQ: 'FULL' }, pageAccessLoaded: true,
  appUrls: { old: 'http://old/', new: 'http://new/' }, fusionRoles: [], sessionRoles: [],
}, extra || {});
function context(fns, variables, app) {
  return {
    $page: { variables, functions: fns },
    $application: {
      variables: app || APP(),
      functions: {
        isFeatureEnabled: (f, l, k) => rules.isFeatureEnabled(f, l, k),
        isFeatureFlagOff: (f, l, k) => rules.isFeatureFlagOff(f, l, k),
        isQuotingAllowed: (s, l, src) => rules.isQuotingAllowed(s, l, src),
        navVisible: (m, l, c) => rules.pageAccess(m, l, c) !== 'HIDDEN',
      },
      user: {},
    },
  };
}

const NOW = Date.UTC(2026, 9, 30, 9);
const day = (n) => new Date(NOW + n * 86400000).toISOString().slice(0, 10);
const realNow = Date.now;

(async () => {
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('the rules are New EquipRite\'s, unchanged');
  ['customerPortal', 'rentalTerms', 'requestModel', 'requestLineBody', 'requestHeaderBody', 'currentUser', 'draftResume', 'catalogCart', 'deliveryCoords', 'geocoder', 'requestProgress']
    .forEach((n) => T.check('resources/js/' + n + '.js is New\'s, byte for byte', same(n)));
  const np = new NewOrderPage();
  const cart = [
    catalogCart.itemFromRow({ eqrEquipmentMasterId: 11, equipmentName: 'CAT 320 Excavator', className: 'Excavators', isRentable: true, rate: 1400, rateUom: 'DAY' }, 2),
    catalogCart.itemFromRow({ eqrEquipmentMasterId: 21, equipmentName: 'Traffic cones', className: 'Safety', isRentable: false, unitPrice: 4 }, 50),
    Object.assign(catalogCart.itemFromRow({ eqrEquipmentMasterId: 12, equipmentName: 'Mini excavator', className: 'Excavators', isRentable: true, rate: 300, periodAmount: 1500, periodType: 'WEEKLY' }, 1), { startDate: day(3) }),
  ];
  const rows = [
    { eqrEquipmentMasterId: 11, equipmentName: 'CAT 320 Excavator', className: 'Excavators', rate: 1400, rateUom: 'DAY', availabilityStatus: 'AVAILABLE', availableQty: 3 },
    { eqrEquipmentMasterId: 12, equipmentName: 'Mini excavator', className: 'Excavators', rate: 300, periodAmount: 1500, periodType: 'WEEKLY', availabilityStatus: 'NOT AVAILABLE' },
    { eqrEquipmentMasterId: 21, equipmentName: 'Traffic cones', className: 'Safety', isRentable: false, unitPrice: 4, availabilityStatus: 'PARTIAL QUANTITY', availableQty: 20 },
    { eqrEquipmentMasterId: 31, equipmentName: 'Light tower', className: 'Lighting', rate: null },
  ];
  const f = Object.assign(np.emptyForm(), { customerRefId: 7, customerName: 'Lone Star', requestorId: 41, requestorName: 'Maria', location: 'Odessa', startDate: day(1), endDate: day(14), notes: 'Gate 3' });
  const parity = (label, a, b) => T.eq('the order rules give New\'s answers: ' + label, JSON.stringify(a), JSON.stringify(b));
  parity('emptyForm', O.emptyForm(), np.emptyForm());
  parity('lineCost', cart.map((c) => [O.lineCost(c, f.startDate, f.endDate, false), O.lineCost(c, f.startDate, f.endDate, true)]),
    cart.map((c) => [np.lineCost(c, f.startDate, f.endDate, false), np.lineCost(c, f.startDate, f.endDate, true)]));
  parity('cartSummary', O.cartSummary(cart, f.startDate, f.endDate, false), np.cartSummary(cart, f.startDate, f.endDate, false));
  parity('rateText', rows.concat(cart).map((x) => [O.rateText(x, false), O.rateText(x, true)]), rows.concat(cart).map((x) => [np.rateText(x, false), np.rateText(x, true)]));
  parity('availability and estimates', rows.map((r) => [O.availability(r), O.cardEstimate(r, f.startDate, f.endDate, false)]), rows.map((r) => [np.availability(r), np.cardEstimate(r, f.startDate, f.endDate, false)]));
  parity('classChips, filterCatalog', [O.classChips(rows), O.filterCatalog(rows, 'exc', 'Excavators', 'free'), O.filterCatalog(rows, '', 'all', '')],
    [np.classChips(rows), np.filterCatalog(rows, 'exc', 'Excavators', 'free'), np.filterCatalog(rows, '', 'all', '')]);
  parity('partyMatches, qtyIn', [O.partyMatches([{ customerName: 'Lone Star' }, { customerName: 'Gulf' }], 'lone'), O.qtyIn(cart, 21)], [np.partyMatches([{ customerName: 'Lone Star' }, { customerName: 'Gulf' }], 'lone'), np.qtyIn(cart, 21)]);
  parity('missingFor', [1, 2, 'draft', 'submit'].map((s) => [O.missingFor(s, {}, []), O.missingFor(s, f, cart), O.missingFor(s, Object.assign({}, f, { endDate: day(-1) }), [Object.assign({}, cart[0], { endDate: day(-3) })])]),
    [1, 2, 'draft', 'submit'].map((s) => [np.missingFor(s, {}, []), np.missingFor(s, f, cart), np.missingFor(s, Object.assign({}, f, { endDate: day(-1) }), [Object.assign({}, cart[0], { endDate: day(-3) })])]));
  parity('buildDetail, buildRequest (what the shared builders post)', [O.buildDetail(f), O.buildRequest(f)], [np.buildDetail(f), np.buildRequest(f)]);
  parity('windowText', O.windowText(f.startDate, f.endDate), np.windowText(f.startDate, f.endDate));

  const nr = new NewRequestPage();
  const nq = new NewQuotePage();
  const nc = new NewContractPage();
  const LR = [
    { lineId: 1, equipmentName: 'Light tower', className: 'Lighting', quantity: 4, startDate: day(5) + 'T00:00:00Z', endDate: day(30), billRate: 45, priceUom: 'DAY' },
    { lineId: 2, equipmentName: 'Mini excavator', className: 'Excavators', quantity: 1, startDate: day(5), endDate: day(30), billRate: 2100, priceUom: 'WEEK', estimatedCost: 8400 },
    { lineId: 3, equipmentName: 'Cones', quantity: null, startDate: day(5), endDate: day(6), billRate: 4, priceUom: 'EACH' },
    { lineId: 4, equipmentName: 'Old', quantity: 2, billRate: null },
  ];
  parity('quote lines and totals (New\'s quote page)', LR.map(V.quoteLine), LR.map((r) => nq.quoteLine(r)));
  parity('rates as quoted (New\'s request page)', V.linesOf(LR).map(V.rateText), V.linesOf(LR).map((l) => nr.rateText(l)));
  parity('the contract in words and its value (New\'s contract page)', [V.contractState('K-1', true), V.contractState('', true), V.contractState('', false), V.contractValue(V.linesOf(LR))],
    [nc.contractState('K-1', true), nc.contractState('', true), nc.contractState('', false), nc.value(V.linesOf(LR))]);
  const sel = V.linesOf([{ lineId: 1, lineStatus: 'SHIP_TO_SITE' }, { lineId: 2, lineStatus: 'DEPLOYED' }, { lineId: 3, lineStatus: 'SHIP_TO_SITE' }]);
  const states = [{}, { 1: true }, { 1: true, 3: true }, { 1: true, 2: true }, { 2: true }, { 1: true, 2: true, 3: true }].map((t) => V.selection(sel, t));
  const newStates = [[], [0], [0, 2], [0, 1], [1], [0, 1, 2]].map((ix) => { nr.initGridData(sel); ix.forEach((i) => nr.setRowSelected(i, true)); return nr.getSelectionStateRaw(); });
  parity('the selection state that enables accept, refuse and return (New\'s)', states, newStates);

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('what the customer reads: their requests, from the equipment');
  Date.now = () => NOW;
  const REQ_ROWS = [
    { eqrEquipmentRequestId: 700, requestNumber: 'EQR-000700', requestStatus: 'IN_PROCESS', customerName: 'Lone Star', startDate: day(1) + 'T00:00:00Z', endDate: day(27) + 'T00:00:00Z', contractNumber: 'K-700', createdDate: day(-5) + 'T09:00:00Z' },
    { eqrEquipmentRequestId: 700, requestNumber: 'EQR-000700', requestStatus: 'IN_PROCESS', customerName: 'Lone Star' },
    { eqrEquipmentRequestId: 610, requestNumber: 'EQR-000610', requestStatus: 'QUOTE_GENERATED', customerName: 'Lone Star', startDate: day(5), endDate: day(30), quoteDocument: 'JVBER' },
    { eqrEquipmentRequestId: 520, requestNumber: 'EQR-000520', requestStatus: 'DEPLOYED', customerName: 'Lone Star', startDate: day(-24), endDate: day(-2), contractNumber: 'K-520' },
    { eqrEquipmentRequestId: 377, requestNumber: 'EQR-000377', requestStatus: 'CLOSED', customerName: 'Lone Star', contractNumber: 'K-377' },
    { eqrEquipmentRequestId: 905, requestNumber: 'EQR-000905', requestStatus: 'DRAFT', customerName: 'Lone Star', startDate: day(10), endDate: day(20) },
    { eqrEquipmentRequestId: 330, requestNumber: 'EQR-000330', requestStatus: 'REJECTED', customerName: 'Lone Star' },
  ];
  const reqs = V.requestsOf(REQ_ROWS);
  T.eq('one row per request (the view repeats a request on each line), newest first', reqs.map((r) => r.id).join(), '905,700,610,520,377,330');
  T.eq('… mapped as New maps it', JSON.stringify(reqs.find((r) => r.id === 700)),
    JSON.stringify({ id: 700, requestNumber: 'EQR-000700', customerName: 'Lone Star', customerContact: '', agreementType: '', status: 'IN_PROCESS', startDate: day(1), endDate: day(27),
      lines: 0, createdDate: day(-5), contractNumber: 'K-700', createdRaw: day(-5) + 'T09:00:00Z', hasQuoteDoc: false }));
  T.eq('the equipment is read for open requests only (New\'s groupOf), newest first', V.toRead(reqs).map((r) => r.id).join(), '905,700,610,520');
  const SER = { allocatedSerial: 'SER-1', allocatedSerialNumber: 'SER-1', serialNumber: 'SER-1' };
  const lines = {
    700: V.linesOf([Object.assign({ lineId: 7001, equipmentName: 'CAT 320', quantity: 1, lineStatus: 'SHIP_TO_SITE' }, SER), { lineId: 7002, equipmentName: 'Truck', quantity: 1, lineStatus: 'SHIP_TO_SITE' },
      { lineId: 7003, equipmentName: 'Roller', quantity: 1, lineStatus: 'PICK_RELEASED' }, { lineId: 7004, equipmentName: 'Barriers', quantity: 10, lineStatus: 'SHIP_TO_SITE', consumableFlag: 'Y', autoConsumeFlag: 'Y' }]),
    610: V.linesOf([{ lineId: 6101, equipmentName: 'Light tower', quantity: 4, lineStatus: 'QUOTE_GENERATED' }, { lineId: 6102, equipmentName: 'Mini', quantity: 1, lineStatus: 'QUOTE_GENERATED' }]),
    520: V.linesOf([{ lineId: 5201, equipmentName: 'Excavator 20 t', quantity: 2, lineStatus: 'DEPLOYED', deploymentLocation: 'Odessa' }, { lineId: 5202, equipmentName: 'Dump truck', quantity: 1, lineStatus: 'DEPLOYED' }]),
    905: V.linesOf([{ lineId: 9051, equipmentName: 'Light tower', quantity: 2, lineStatus: 'DRAFT' }]),
  };
  T.check('no line carries a serial number', !JSON.stringify(lines).includes('SER-'));
  const dec = V.decorate(reqs, lines, { quotingAllowed: true, now: NOW });
  const D = (id) => dec.find((r) => r.id === id);
  T.eq('where each request is, in plain words', dec.map((r) => r.requestNumber + ': ' + r.headline).join(' | '),
    'EQR-000905: Draft | EQR-000700: Partly shipped · 3 of 4 | EQR-000610: Quote ready for you | EQR-000520: On site | EQR-000377: Completed | EQR-000330: Turned down');
  T.eq('… what each one waits for, the customer\'s own step first', dec.map((r) => r.next + (r.mine ? ' *' : '')).join(' | '),
    'Check it and send it * | Accept the delivery when it arrives (3 pieces) * | Accept the quote * | Return it: it was due back 28 Oct * |  | Contact your equipment manager *');
  T.eq('… late, and the pieces', [D(520).late, D(700).pieces, D(700).detail, D(610).detail].join(' | '), '2 past their end date (28 Oct), not returned | 13 | 3 on the way · 1 getting ready | Quote ready for you to accept');
  T.eq('… a bar per piece, coloured by stage', D(700).segs.map((s) => s.stage).join(), 'out,out,ready,out');
  T.eq('the customer\'s words for every status, the stage from requestProgress', ['IN_PROCESS', 'QUOTE_GENERATED', 'ALLOCATED', 'PICK_RELEASED', 'SHIP_TO_SITE', 'DEPLOYED', 'RETURN_INITIATED', 'CLOSED', 'REJECTED', 'SOMETHING_NEW']
    .map((s) => V.lineWords(s) + '/' + V.lineStage(s)).join(' | '),
    'With your equipment manager/approval | Quote ready for you to accept/approval | Confirmed, being arranged/ready | Being prepared at the yard/ready | On the way to your site/out | On your site/onsite | Return asked for, waiting for pickup/back | Back with us/done | Turned down/stopped | Something new/ready');
  T.eq('a staff step told to the customer', [V.nextText({ next: { who: 'Equipment Manager', what: 'assign a unit', text: 'Equipment Manager to assign a unit (2 of 3)' } }),
    V.nextText({ next: { who: 'Yard', what: 'pick and ship it', text: 'Yard to pick and ship it' } }), V.nextText({ next: { who: 'Requester', what: 'return it when the job is done', text: 'In use until 12 Nov' } })].join(' | '),
    'We choose your equipment (2 of 3) | Our yard prepares and ships it | In use until 12 Nov');

  T.section('what needs the customer: New\'s todo, in Next\'s words, each opening its tab');
  const BILL = [
    { eqrBillingTransactionId: 1, eqrEquipmentRequestId: 520, eqrRequestLineId: 5201, invoiceNumber: 'INV-1', status: 'PAID', grossAmount: 12140, billingPeriodStart: day(-24), billingPeriodEnd: day(-10), dueDate: day(5), transactionDate: day(-10) },
    { eqrBillingTransactionId: 2, eqrEquipmentRequestId: 520, eqrRequestLineId: 5202, invoiceNumber: 'INV-2', status: 'POSTED', grossAmount: 6180, billingPeriodStart: day(-24), billingPeriodEnd: day(-10), dueDate: day(5), transactionDate: day(-10) },
    { eqrBillingTransactionId: 3, eqrEquipmentRequestId: 377, eqrRequestLineId: 3771, invoiceNumber: 'INV-3', status: 'POSTED', grossAmount: 2240, billingPeriodStart: day(-60), billingPeriodEnd: day(-35), dueDate: day(-20), transactionDate: day(-35) },
    { eqrBillingTransactionId: 4, eqrEquipmentRequestId: 520, eqrRequestLineId: 5201, invoiceNumber: 'CR-4', status: 'POSTED', transactionType: 'CREDIT', grossAmount: -100, billingPeriodStart: day(-12), billingPeriodEnd: day(-10) },
    { eqrBillingTransactionId: 5, eqrEquipmentRequestId: 520, eqrRequestLineId: 5202, status: 'SCHEDULED', grossAmount: 950, billingPeriodStart: day(1), billingPeriodEnd: day(7) },
  ];
  const invoices = portal.mapInvoices(BILL, new Date(NOW));
  const totals = portal.invoiceTotals(invoices);
  const needs = V.needs(reqs, lines, totals, { quotingAllowed: true, overdueRequest: V.overdueRequest(invoices, reqs) });
  T.eq('quotes, deliveries, drafts, overdue invoices', needs.map((n) => n.kind + ': ' + n.title).join(' | '),
    'quote: Accept the quote for EQR-000610 | delivery: Accept the delivery of EQR-000700 | draft: Finish and send EQR-000905 | invoice: 1 invoice is overdue');
  T.eq('… each opens its tab: the quote, the request, the draft, the overdue request\'s invoices', needs.map((n) => JSON.stringify(n.open)).join(' | '),
    '{"record":"quote","params":{"id":610,"number":"EQR-000610"}} | {"record":"customer-request","params":{"id":700,"number":"EQR-000700"}} | {"record":"customer-request","params":{"id":905,"number":"EQR-000905"}} | {"record":"invoice","params":{"id":"377","number":"EQR-000377"}}');
  T.eq('… a delivery: the pieces shipped, from New\'s rule (headers in operations, lines at SHIP_TO_SITE)', needs[1].text,
    '3 pieces were shipped to your site. When they arrive, check them and accept them, or refuse what is wrong.');
  T.eq('quoting off: the quote opens the request (nothing to accept online)', JSON.stringify(V.needs(reqs, lines, null, { quotingAllowed: false }).map((n) => n.open.record)), '["customer-request","customer-request","customer-request"]');
  T.eq('billing withdrawn: no invoice need', V.needs(reqs, lines, null, { quotingAllowed: true }).some((n) => n.kind === 'invoice'), false);
  const eq = V.equipmentRows(reqs, lines, NOW);
  T.eq('the tiles count pieces, with what they mean', V.tiles(dec, eq, totals, true, NOW).map((t) => t.key + ':' + t.value + ' (' + t.note + ')').join(' | '),
    'out:12 (12 pieces to accept when they arrive) | onsite:3 (3 pieces past the end date) | coming:6 (4 open requests) | pay:$9,270 (2 open · 1 overdue)');
  T.eq('… no bill tile while billing is withdrawn', V.tiles(dec, eq, totals, false, NOW).map((t) => t.key).join(), 'out,onsite,coming');
  T.eq('the summary', V.summary('Lone Star', dec, needs.length, false), 'Lone Star · 4 open requests · 4 things need you');

  T.section('the lists: chips, search, sort, export');
  T.eq('New\'s chips', V.requestChips(dec).map((c) => c.key + ':' + c.count).join(' '), 'needs:2 open:4 done:2 all:6');
  T.eq('chips and search (by equipment too)', [V.filterRequests(dec, 'open', '').map((r) => r.id).join(), V.filterRequests(dec, 'done', '').map((r) => r.id).join(),
    V.filterRequests(dec, 'all', 'roller').map((r) => r.id).join(), V.filterRequests(dec, 'all', 'k-520').map((r) => r.id).join()].join(' | '), '905,700,610,520 | 377,330 | 700 | 520');
  T.eq('sort by dates', V.sortRequests(V.filterRequests(dec, 'open', ''), 'dates', 'asc').map((r) => r.id).join(), '520,700,610,905');
  T.eq('the equipment: a row per piece, no draft', eq.map((e) => e.key).join(), '700:7001,700:7002,700:7003,700:7004,610:6101,610:6102,520:5201,520:5202');
  T.eq('… chips', V.equipmentChips(eq).map((c) => c.key + ':' + c.count).join(' '), 'all:8 late:2 coming:3 out:3 onsite:2 back:0 done:0');
  T.eq('… late in words, the customer\'s next step', [eq.find((e) => e.key === '520:5201').late, eq.find((e) => e.key === '700:7001').next, eq.find((e) => e.key === '520:5201').next].join(' | '),
    'Due back 28 Oct · 2 days over | Accept it when it arrives | Start the return when you are done');
  T.eq('… search', V.filterEquipment(eq, 'all', 'odessa').map((e) => e.key).join(), '520:5201');
  const inv = V.invoiceRows(invoices, reqs, lines);
  T.eq('invoices: request, equipment, words', inv.map((i) => (i.invoiceNumber || '—') + ' ' + i.requestNumber + ' ' + (i.equipment || '?') + ' ' + i.words).join(' | '),
    '— EQR-000520 Dump truck Not billed yet | CR-4 EQR-000520 Excavator 20 t Credit | INV-1 EQR-000520 Excavator 20 t Paid | INV-2 EQR-000520 Dump truck To pay | INV-3 EQR-000377 ? Overdue');
  T.eq('… chips', V.invoiceChips(inv).map((c) => c.key + ':' + c.count).join(' '), 'all:5 topay:2 overdue:1 paid:1 other:2');
  T.eq('… the totals are New\'s billing detail\'s', [totals.outstandingAmount, totals.overdueAmount, totals.paidAmount, totals.totalInvoiced, totals.netAdjustment].join(), '9270,2240,12140,21410,-100');
  T.eq('export columns: requests', V.exportColumns('requests').map((c) => c.label).join(', '), 'Request, Where the equipment is, Detail, Next, Start, End, Pieces, Contract, Customer, Contact, Late, Raised, Stored status');
  T.eq('… equipment, never a serial', V.exportColumns('equipment').map((c) => c.label).join(', '), 'Equipment, Class, Qty, Request, Where it is, Start, End, Deliver to, Late, Next for you, Stored status');
  T.eq('… a row in words', V.exportColumns('requests').map((c) => (c.value ? c.value(D(700)) : D(700)[c.key])).join(' | '),
    'EQR-000700 | Partly shipped · 3 of 4 | 3 on the way · 1 getting ready | Accept the delivery when it arrives (3 pieces) | ' + day(1) + ' | ' + day(27) + ' | 13 | K-700 | Lone Star |  |  | ' + day(-5) + ' | IN_PROCESS');
  T.check('the CSV of the equipment has no serial', !exportKit.csv(eq, V.exportColumns('equipment')).includes('SER-'));

  T.section('a request\'s next step and its actions, said before they are done');
  T.eq('New\'s nextAction, in Next\'s words for a delivery', JSON.stringify(V.nextStep({ status: 'IN_PROCESS' }, lines[700], true)),
    '{"key":"delivery","tone":"action","action":"delivery","title":"Your equipment is on its way","text":"3 pieces were shipped to your site. When they arrive, check them, then accept the delivery, or refuse a piece that is wrong."}');
  T.eq('… the others as New says them', ['DRAFT', 'QUOTE_GENERATED', 'SUBMITTED', 'CLOSED', 'REJECTED'].map((s) => V.nextStep({ status: s }, [], true).title).join(' | '),
    'This request has not been sent | Your quote is ready | We are working on it | All done | This request was turned down');
  const accAll = V.plan('accept', lines[700], {});
  T.eq('accept everything that came: the barriers would be issued from stock (Fusion), so not here', [accAll.ok, accAll.eligible.length, accAll.fusion.map((l) => l.lineId).join()].join(' | '), 'false | 3 | 7004');
  T.check('… said in words, with New as the way', /Barriers\)\. That issue is recorded in Oracle Fusion/.test(accAll.text) && /Accept them in New EquipRite/.test(accAll.text));
  const acc2 = V.plan('accept', lines[700], { 7001: true, 7002: true });
  T.eq('two ticked rentals: what it will do', [acc2.ok, acc2.title, acc2.text, acc2.button].join(' | '),
    'true | Accept the delivery of 2 pieces | CAT 320, Truck will be marked on your site. Billing for them starts from then. | Accept 2 pieces');
  T.eq('a mixed tick: the others are left as they are', V.plan('accept', lines[700], { 7001: true, 7003: true }).text, 'CAT 320 will be marked on your site. Billing for it starts from then. 1 ticked piece is left as it is.');
  T.eq('return: what it will do', V.plan('return', lines[520], {}).text, 'Excavator 20 t, Dump truck will be marked for collection. We collect them and close the request once everything is back.');
  T.eq('nothing to act on', [V.plan('return', lines[700], {}).title, V.plan('refuse', lines[520], {}).title].join(' | '), 'Nothing to return | Nothing to accept or refuse');

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('accepting a delivery makes New\'s calls (side by side)');
  const L = (lineId, lineStatus, extra) => Object.assign({ lineId, equipmentName: 'Eq ' + lineId, quantity: 2, lineStatus }, extra || {});
  async function runAccept(lineRows, tickIds, answer) {
    const mapped = V.linesOf(lineRows);
    // New: its page module holds the lines and the ticks
    const nf = fake(answer);
    const npg = new NewRequestPage();
    npg.initGridData(mapped.map((l) => Object.assign({}, l)));
    mapped.forEach((l, i) => { if (tickIds.indexOf(Number(l.lineId)) !== -1) npg.setRowSelected(i, true); });
    const nv = { requestNumericId: 700, requestId: 'EQR-000700', formData: {}, selectionState: {}, selectionTick: 0 };
    await new (newChain('customer-request', 'acceptDeliveryChain', nf.Actions))().run(context(npg, nv));
    // Next: the tab's variables
    const xf = fake(answer);
    const ticks = {};
    tickIds.forEach((id) => { ticks[String(id)] = true; });
    const xv = { requestId: 700, lines: mapped, ticks, head: { requestNumber: 'EQR-000700', id: 700 }, ask: {}, banner: {}, busy: '' };
    await new (nextChain('request', 'acceptDeliveryChain', xf.Actions))().run(context(new NextRequest(), xv));
    return { n: nf.calls, x: xf.calls, xv };
  }
  let r = await runAccept([L(1, 'SHIP_TO_SITE'), L(2, 'SHIP_TO_SITE'), L(3, 'DEPLOYED')], []);
  T.eq('every piece that came, the rest on site: the batch, then the header DEPLOYED', names(r.x), 'patchRequestLinesBatch > patchEquipmentRequest');
  T.eq('… exactly New\'s calls and bodies', norm(r.x), norm(r.n));
  T.check('… then the request is read again', r.x.some((c) => c.chain === 'loadRecordChain') && r.xv.banner.text.includes('Everything on this request is on your site'));
  T.eq('… and the portal\'s home is told to read again, the shared requests forgotten', signalLog.splice(0).join(), 'changed,invalidated');
  r = await runAccept([L(1, 'SHIP_TO_SITE'), L(2, 'SHIP_TO_SITE'), L(3, 'PICK_RELEASED')], [2, 3]);
  T.eq('ticked pieces only, no header rollup while one is not on site', [names(r.x), norm(r.x) === norm(r.n)].join(' | '), 'patchRequestLinesBatch | true');
  T.eq('… the body', JSON.stringify(writes(r.x)[0].body), '{"lines":[{"id":2,"lineStatus":"DEPLOYED"}]}');
  r = await runAccept([L(1, 'SHIP_TO_SITE', { consumableFlag: 'Y' }), L(2, 'SHIP_TO_SITE')], []);
  T.eq('a consumable that is not issued from stock goes DELIVERED with its quantity, as New', [JSON.stringify(writes(r.x)[0].body), norm(r.x) === norm(r.n)].join(' | '),
    '{"lines":[{"id":1,"lineStatus":"DELIVERED","deliveredQuantity":2},{"id":2,"lineStatus":"DEPLOYED"}]} | true');
  signalLog.length = 0;
  r = await runAccept([L(1, 'SHIP_TO_SITE'), L(2, 'SHIP_TO_SITE')], [], (o) => (/LinesBatch/.test(o.endpoint) ? fail(409) : undefined));
  T.eq('a failed batch: nothing else, said on the page', [names(r.x), norm(r.x) === norm(r.n), r.xv.banner.type, /No line was changed/.test(r.xv.banner.text)].join(' | '), 'patchRequestLinesBatch | true | error | true');
  T.eq('… nothing changed, so the home is not told', signalLog.length, 0);
  r = await runAccept([L(1, 'SHIP_TO_SITE', { consumableFlag: 'Y', autoConsumeFlag: 'Y' }), L(2, 'SHIP_TO_SITE')], [],
    (o) => (/LineDetailUnits/.test(o.endpoint) ? ok({ data: [{ unitNumber: 'CONE', uomCode: 'EA', invOrgId: 3 }] }) : undefined));
  T.eq('a consumable issued from stock: New issues it (inventory consumption, which Fusion receives)…', names(r.n),
    'getEquipriteV1ViewsLineDetailUnits > createInventoryConsumption > patchRequestLinesBatch > patchEquipmentRequest');
  T.eq('… Next writes nothing and says why, with New as the way', [rest(r.x).length, r.xv.banner.type, /Oracle Fusion/.test(r.xv.banner.text), r.xv.banner.link].join(' | '),
    '0 | warning | true | http://new/vp/shell/customer/customer-request?requestId=EQR-000700&requestNumericId=700');
  r = await runAccept([L(1, 'DEPLOYED')], []);
  T.eq('nothing on its way: no call in either', [rest(r.n).length, rest(r.x).length].join(), '0,0');

  T.section('refusing a delivery and starting a return make New\'s calls');
  async function runLine(newName, nextName, lineRows, tickIds, answer) {
    const mapped = V.linesOf(lineRows);
    const nf = fake(answer);
    const npg = new NewRequestPage();
    npg.initGridData(mapped.map((l) => Object.assign({}, l)));
    mapped.forEach((l, i) => { if (tickIds.indexOf(Number(l.lineId)) !== -1) npg.setRowSelected(i, true); });
    await new (newChain('customer-request', newName, nf.Actions))().run(context(npg, { requestNumericId: 520, requestId: 'EQR-000520', formData: {}, selectionState: {}, selectionTick: 0 }));
    const xf = fake(answer);
    const ticks = {};
    tickIds.forEach((id) => { ticks[String(id)] = true; });
    const xv = { requestId: 520, lines: mapped, ticks, head: { requestNumber: 'EQR-000520', id: 520 }, ask: {}, banner: {}, busy: '' };
    await new (nextChain('request', nextName, xf.Actions))().run(context(new NextRequest(), xv));
    return { n: nf.calls, x: xf.calls, xv };
  }
  r = await runLine('rejectDeliveryChain', 'rejectDeliveryChain', [L(1, 'SHIP_TO_SITE'), L(2, 'SHIP_TO_SITE'), L(3, 'DEPLOYED')], [2]);
  T.eq('refuse: the ticked piece REJECTED (the customer copy), New\'s call', [JSON.stringify(writes(r.x)[0].body), norm(r.x) === norm(r.n)].join(' | '), '{"lines":[{"id":2,"lineStatus":"REJECTED"}]} | true');
  const lines2 = (states2) => (o) => (/RequestIdLines2/.test(o.endpoint) ? ok({ data: states2 }) : undefined);
  r = await runLine('initiateReturnChain', 'initiateReturnChain', [L(1, 'DEPLOYED'), L(2, 'DEPLOYED'), L(3, 'SHIP_TO_SITE')], [], lines2([{ id: 1, lineStatus: 'RETURN_INITIATED' }]));
  T.eq('return: the pieces on site RETURN_INITIATED, then the lines read for the close rule', [names(r.x), JSON.stringify(writes(r.x)[0].body), norm(r.x) === norm(r.n)].join(' | '),
    'patchRequestLinesBatch > getEquipriteV1EquipmentRequestsRequestIdLines2 | {"lines":[{"id":1,"lineStatus":"RETURN_INITIATED"},{"id":2,"lineStatus":"RETURN_INITIATED"}]} | true');
  r = await runLine('initiateReturnChain', 'initiateReturnChain', [L(1, 'DEPLOYED')], [], lines2([{ id: 1, lineStatus: 'CLOSED' }, { id: 2, lineStatus: 'REJECTED' }]));
  T.eq('… every line terminal with one back: the header CLOSED, as New', [names(r.x), norm(r.x) === norm(r.n), /The request is closed/.test(r.xv.banner.text)].join(' | '),
    'patchRequestLinesBatch > getEquipriteV1EquipmentRequestsRequestIdLines2 > patchEquipmentRequest | true | true');
  r = await runLine('initiateReturnChain', 'initiateReturnChain', [L(1, 'SHIP_TO_SITE')], [], lines2([]));
  T.eq('… nothing on site: no call', [rest(r.n).length, rest(r.x).length].join(), '0,0');

  T.section('deleting a draft makes New\'s call');
  {
    const nf = fake();
    await new (newChain('customer-request', 'draftActionChain', nf.Actions))().run(context({}, { requestNumericId: 905, formData: { requestNumber: 'EQR-000905', status: 'DRAFT' }, isDraftBusy: false }), { action: 'delete' });
    const xf = fake();
    busLog.length = 0;
    const xv = { requestId: 905, id: '905', number: '', head: { requestNumber: 'EQR-000905', status: 'DRAFT', id: 905 }, busy: '', banner: {}, deleteAsk: true };
    await new (nextChain('request', 'deleteDraftChain', xf.Actions))().run(context(new NextRequest(), xv));
    T.eq('DELETE equipment-requests/905, isAdmin, no caller id', [names(xf.calls), JSON.stringify(rest(xf.calls)[0].uriParams), norm(xf.calls) === norm(nf.calls)].join(' | '),
      'deleteEquipmentRequest | {"id":905,"isAdmin":true} | true');
    T.eq('… then the tab closes on the portal', busLog.filter((l) => !l.startsWith('toast')).join(' | '), 'open {"navId":"customer-portal"} | close customer-request:905');
    const yf = fake();
    await new (nextChain('request', 'deleteDraftChain', yf.Actions))().run(context(new NextRequest(), Object.assign({}, xv, { head: { status: 'IN_PROCESS' } })));
    T.eq('… only a draft', rest(yf.calls).length, 0);
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('a new request: New\'s customer submit, step for step; the Fusion contract left to New');
  async function runSubmit(mode, quotes, opts) {
    const o = opts || {};
    const app = APP({ ENABLE_QUOTES: quotes });
    const form = Object.assign(O.emptyForm(), { customerRefId: 7, customerName: 'Lone Star', requestorId: 41, requestorName: 'Maria Torres', location: '1200 Pipeline Rd, Odessa TX', startDate: day(12), endDate: day(25), notes: 'Gate 3' });
    const items = [catalogCart.itemFromRow({ eqrEquipmentMasterId: 11, equipmentName: 'CAT 320 Excavator', className: 'Excavators', isRentable: true, rate: 1400, rateUom: 'DAY' }, 2)];
    const answer = (c) => (c.endpoint === 'eqp-v1/createEquipmentRequest' ? ok({ id: 901, requestNumber: 'EQR-000901' })
      : (c.endpoint === 'eqp-v1/createShipToSite' ? ok({ id: 77 }) : (/contracts|Contract/.test(c.endpoint) ? ok({ ContractNumber: 'K-901' }) : undefined)));
    const realDate = Date.now;
    Date.now = () => 1790000000000; // the placeholder REQ- number is the time
    const nf = fake(answer);
    const nfns = new NewOrderPage();
    const nv = { form, cart: items.slice(), resume: o.resume || null, agreementId: null, agreementLineMap: {}, termsAccepted: true, missing: [], isSubmitting: false };
    await new (newChain('customer-new-request', 'submitChain', nf.Actions))().run(context(nfns, nv, app), { mode: mode === 'submit' ? 'submit' : 'draft' });
    const xf = fake(answer);
    busLog.length = 0;
    const xv = { form, cart: items.slice(), resume: o.resume || null, agreementId: null, agreementLineMap: {}, termsAccepted: true, missing: [], isSubmitting: false,
      canCreate: true, draft: o.draft || '', saveError: '', sent: null };
    await new (nextChain('order', 'submitChain', xf.Actions))().run(context(new NextOrder(), xv, app), { mode });
    Date.now = realDate;
    return { n: nf.calls, x: xf.calls, xv, bus: busLog.slice() };
  }
  r = await runSubmit('submit', 'CUSTOMER');
  T.eq('quoting on: header, site, lines, IN_PROCESS', names(r.x), 'createEquipmentRequest > createShipToSite > patchEquipmentRequest > createRequestLinesBatch > patchEquipmentRequest');
  T.eq('… exactly New\'s calls and bodies (New makes no contract either)', norm(r.x), norm(r.n));
  T.eq('… the line unpriced, a quote is coming', [writes(r.x)[3].body.lines[0].lineStatus, writes(r.x)[3].body.lines[0].billRate].join(), 'IN_PROCESS,');
  T.eq('… the request opens in its own tab, this one starts again', r.bus.filter((l) => l.startsWith('open')).join(), 'open {"record":"customer-request","params":{"id":901,"number":"EQR-000901"}}');
  T.check('… and resets', r.x.some((c) => c.chain === 'resetChain'));
  r = await runSubmit('submit', 'NONE');
  T.eq('quoting off: New sends and makes the Fusion contract…', names(r.n), 'createEquipmentRequest > createShipToSite > patchEquipmentRequest > createRequestLinesBatch > patchEquipmentRequest > ' + fusion.ENDPOINT + ' > patchEquipmentRequest');
  T.eq('… Next sends nothing and says why', [rest(r.x).length, /Oracle Fusion/.test(r.xv.saveError)].join(), '0,true');
  r = await runSubmit('handoff', 'NONE');
  T.eq('… it saves the draft, exactly New\'s Save draft', [names(r.x), norm(r.x) === norm(r.n)].join(' | '),
    'createEquipmentRequest > createShipToSite > patchEquipmentRequest > createRequestLinesBatch | true');
  T.eq('… priced DRAFT lines, then the way to send it in New', [writes(r.x)[3].body.lines[0].lineStatus, writes(r.x)[3].body.lines[0].billRate, r.xv.sent.link].join(' | '),
    'DRAFT | 1400 | http://new/vp/shell/customer/customer-new-request?draftId=901&startStep=3');
  T.eq('… and keeps the draft to save it in place next time', JSON.stringify(r.xv.resume), '{"id":901,"requestNumber":"EQR-000901","attribute1":"1200 Pipeline Rd, Odessa TX","shipToSiteId":77}');
  r = await runSubmit('draft', 'CUSTOMER', { resume: { id: 905, requestNumber: 'EQR-000905', attribute1: '1200 Pipeline Rd, Odessa TX', shipToSiteId: 70 } });
  T.eq('a reopened draft saved again: PATCH in place, lines replaced, as New', [names(r.x), norm(r.x) === norm(r.n)].join(' | '), 'patchEquipmentRequest > replaceRequestLinesBatch | true');
  {
    const xf = fake();
    const xv = { form: O.emptyForm(), cart: [], resume: null, termsAccepted: true, missing: [], isSubmitting: false, canCreate: true, saveError: '' };
    await new (nextChain('order', 'submitChain', xf.Actions))().run(context(new NextOrder(), xv), { mode: 'submit' });
    T.eq('what is missing is listed, nothing is sent', [rest(xf.calls).length, xv.missing.join(', ')].join(' | '), '0 | Start date, End date, At least one piece of equipment, Customer, Contact, Delivery address');
    const yf = fake();
    const yv = { form: Object.assign(O.emptyForm(), { customerRefId: 7, requestorId: 41, location: 'x', startDate: day(1), endDate: day(2) }), cart: [cart[0]], termsAccepted: false, missing: [], isSubmitting: false, canCreate: true };
    await new (nextChain('order', 'submitChain', yf.Actions))().run(context(new NextOrder(), yv), { mode: 'submit' });
    T.eq('the rental terms first', [rest(yf.calls).length, yv.missing.join()].join(' | '), '0 | Accept the rental terms');
  }

  T.section('opening a new request: New\'s reads; a draft reopened');
  {
    const answer = (o) => {
      if (o.endpoint === 'eqp-v1/getCustomerRefs') return ok({ data: [{ id: 7, customerName: 'Lone Star' }] });
      if (o.endpoint === 'eqp-v1/getCustomerPortalUsers') return ok({ data: [{ id: 41, contactName: 'Maria Torres' }] });
      if (o.endpoint === 'eqp-v1/getEquipriteV1EquipmentRequestById') return ok({ id: 905, requestNumber: 'EQR-000905', status: 'DRAFT', requestType: 'EXTERNAL', eqrCustomerRefId: 7, customerName: 'Lone Star',
        eqrCustomerPortalUserId: 41, contactName: 'Maria Torres', attribute1: 'Odessa', requestedStartDate: day(10), requestedEndDate: day(20), shipToSiteId: 70 });
      if (o.endpoint === 'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2') return ok({ data: [{ id: 9051, eqrEquipmentMasterId: 11, quantity: 2, lineStatus: 'DRAFT' }] });
      if (o.endpoint === 'eqp-v1/getEquipriteV1ViewsEquipmentCatalog') return ok({ data: [{ eqrEquipmentMasterId: 11, equipmentName: 'CAT 320 Excavator', rate: 1400, rateUom: 'DAY' }] });
      return undefined;
    };
    const nf = fake(answer);
    const nv = { draftId: 905, startStep: 3, form: {}, cart: [], customers: [], contacts: [], step: 1 };
    await new (newChain('customer-new-request', 'initChain', nf.Actions))().run(context(new NewOrderPage(), nv));
    const xf = fake(answer);
    const xv = { draft: '905', startStep: 'review', form: {}, cart: [], customers: [], contacts: [], mode: 'edit' };
    await new (nextChain('order', 'initChain', xf.Actions))().run(context(new NextOrder(), xv));
    T.eq('the same reads, in the same order', names(xf.calls), names(nf.calls));
    T.eq('… the draft back in the form and the cart, on Review', [xv.form.customerName, xv.form.requestorName, xv.form.location, xv.cart.map((c) => c.name + ' ×' + c.quantity).join(), xv.resume.requestNumber, xv.mode].join(' | '),
      'Lone Star | Maria Torres | Odessa | CAT 320 Excavator ×2 | EQR-000905 | review');
    T.eq('… as New has them', JSON.stringify([xv.form, xv.cart, xv.resume]), JSON.stringify([nv.form, nv.cart, nv.resume]));
    T.eq('nothing is written on entry', writes(xf.calls).length, 0);
    const pf = fake(answer);
    const pv = { draft: '', form: {}, cart: [], customers: [], contacts: [], mode: 'edit' };
    await new (nextChain('order', 'initChain', pf.Actions))().run(context(new NextOrder(), pv, APP({ ENABLE_QUOTES: 'NONE' })));
    T.eq('a new one: the one customer and contact picked; prices shown, the contract made at send', [pv.form.customerName, pv.form.requestorName, pv.hideRates, pv.contractAtSubmit].join(' | '), 'Lone Star | Maria Torres | false | true');
    const qf = fake(answer);
    const qv = { draft: '', form: {}, cart: [], customers: [], contacts: [], mode: 'edit' };
    await new (nextChain('order', 'initChain', qf.Actions))().run(context(new NextOrder(), qv, APP(null, { pageAccessMap: { EQR_CUST_DASHBOARD: 'FULL' } })));
    T.eq('without EQR_CUST_CREATE_REQ: no request can be raised, nothing is read', [qv.canCreate, rest(qf.calls).length].join(), 'false,0');
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('the reads: only the customer\'s own requests; nothing written on entry');
  {
    const answer = (o) => {
      if (o.endpoint === 'eqp-v1/getEquipriteV1ViewsCustomerMyRequests') return ok({ data: REQ_ROWS });
      if (o.endpoint === 'eqp-v1/getEquipriteV1ViewsCustomerMyBilling') return ok({ data: BILL });
      if (o.endpoint === 'eqp-v1/getEquipriteV1ViewsRequestDetailLines') return ok({ data: [{ lineId: 1, lineStatus: 'DEPLOYED' }] });
      if (o.endpoint === 'eqp-v1/getEquipriteV1ViewsCustomerRequestDetails') return ok({ data: REQ_ROWS });
      return undefined;
    };
    const pf = fake(answer);
    const pv = { base: [], linesById: {}, invoiceBase: [] };
    await new (nextChain('portal', 'loadChain', pf.Actions))().run(context(new NextPortal(), pv));
    T.eq('the portal: New\'s two views, then the lines of the open requests', rest(pf.calls).map((c) => c.endpoint.replace('eqp-v1/getEquipriteV1Views', '') + JSON.stringify(c.uriParams)).join(' > '),
      'CustomerMyRequests{"page":0,"size":200} > CustomerMyBilling{"page":0,"size":10000} > RequestDetailLines{"requestId":905,"size":10000} > RequestDetailLines{"requestId":700,"size":10000} > RequestDetailLines{"requestId":610,"size":10000} > RequestDetailLines{"requestId":520,"size":10000}');
    T.eq('… reads only', writes(pf.calls).length, 0);
    const bf = fake(answer);
    const bv = { base: [], linesById: {}, invoiceBase: [] };
    await new (nextChain('portal', 'loadChain', bf.Actions))().run(context(new NextPortal(), bv, APP(null, { featureFlags: { CUSTOMERS_MODULE_ENABLED: 'true', EXTERNAL_PROJECT_ASSIGN_ENABLED: 'true' } })));
    T.eq('billing withdrawn (EXTERNAL_PROJECT_ASSIGN_ENABLED): invoices are not read', [rest(bf.calls).some((c) => /Billing/.test(c.endpoint)), bv.billingShown].join(), 'false,false');

    const rf = fake(answer);
    busLog.length = 0;
    const rv = { id: '520', number: 'EQR-000520', ticks: {}, banner: {} };
    await new (nextChain('request', 'loadRecordChain', rf.Actions))().run(context(new NextRequest(), rv));
    T.eq('a request: New\'s reads, in order', names(rf.calls), 'getEquipriteV1ViewsCustomerRequestDetails > getEquipriteV1ViewsRequestDetailLines');
    T.eq('… nothing written, even with every line on site and the header behind (New reconciles it on open)', [writes(rf.calls).length, rv.head.status, rv.head.headline].join(' | '), '0 | DEPLOYED | On site');
    T.eq('… the tab named after it', busLog.join(), 'rename customer-request:520=EQR-000520');
    const sf = fake(answer);
    const sv = { id: '700', number: '', ticks: {}, banner: {} };
    await new (nextChain('request', 'loadRecordChain', sf.Actions))().run(context(new NextRequest(), Object.assign(sv, { number: '' })));
    T.eq('… found by its id when the tab has no number', sv.head.requestNumber, 'EQR-000700');
    const gf = fake(answer);
    const gv = { id: '999', number: 'EQR-000999', ticks: {}, banner: {} };
    await new (nextChain('request', 'loadRecordChain', gf.Actions))().run(context(new NextRequest(), gv));
    T.eq('a request that is not theirs: said, and its lines are never asked for', [names(gf.calls), gv.error].join(' | '), 'getEquipriteV1ViewsCustomerRequestDetails | Request EQR-000999 could not be found among yours.');

    const qanswer = (o) => (o.endpoint === 'eqp-v1/getEquipriteV1ViewsRequestDetailLines' ? ok({ data: LR }) : answer(o));
    const nqf = fake(qanswer);
    await new (newChain('customer-quote', 'quoteInitChain', nqf.Actions))().run(context(new NewQuotePage(), { requestId: 'EQR-000610', requestNumericId: 610, quoteData: {} }));
    const qf = fake(qanswer);
    const qv = { id: '610', number: 'EQR-000610' };
    await new (nextChain('quote', 'loadQuoteChain', qf.Actions))().run(context(new NextQuote(), qv));
    T.eq('the quote: New\'s reads, in order', names(qf.calls), names(nqf.calls));
    T.eq('… its total, the PDF, where it stands', [qv.quote.grandTotal, qv.hasQuoteDoc, qv.state.key, qv.state.title].join(' | '), [LR.map(V.quoteLine).reduce((s, l) => s + l.lineTotal, 0), true, 'ready', 'Accept the quote to confirm your rental'].join(' | '));
    T.eq('… accepting is New\'s page (it creates the Fusion contract); nothing written here', [new NextQuote().acceptUrl('http://new', qv.quote, qv.requestId), writes(qf.calls).length].join(' | '),
      'http://new/vp/shell/customer/customer-quote?requestId=EQR-000610&requestNumericId=610 | 0');
    T.eq('… where it stands otherwise', [V.quoteState({}, false, true).key, V.quoteState({ contractNumber: 'K-1' }, true, true).title, V.quoteState({}, true, false).title].join(' | '),
      'none | You accepted this quote | Accepting quotes online is switched off');

    const ianswer = (o) => (o.endpoint === 'eqp-v1/getEquipriteV1ViewsRequestDetailLines'
      ? ok({ data: [{ lineId: 5201, equipmentName: 'Excavator 20 t', quantity: 2, billRate: 1100, lineStatus: 'DEPLOYED' }, { lineId: 5202, equipmentName: 'Dump truck', lineStatus: 'DEPLOYED' }] }) : answer(o));
    const nif = fake(ianswer);
    const niv = { requestId: 'EQR-000520', requestNumericId: 520, formData: {}, lines: [], totals: {} };
    await new (newChain('customer-invoice', 'invoiceInitChain', nif.Actions))().run(context({}, niv));
    const xif = fake(ianswer);
    const xiv = { id: '520', number: 'EQR-000520' };
    await new (nextChain('invoice', 'loadInvoicesChain', xif.Actions))().run(context(new NextInvoice(), xiv));
    T.eq('a request\'s invoices: New\'s reads, in order', names(xif.calls), names(nif.calls));
    T.eq('… grouped by piece and totalled as New does', JSON.stringify([xiv.groups.map((g) => [g.lineId, g.invoices.map((i) => i.invId), g.totalValue]), xiv.totals]),
      JSON.stringify([niv.lines.map((g) => [g.lineId, g.invoices.map((i) => i.invId), g.totalValue]), niv.totals]));
    const oif = fake(ianswer);
    const oiv = { id: '520', number: 'EQR-000520' };
    await new (nextChain('invoice', 'loadInvoicesChain', oif.Actions))().run(context(new NextInvoice(), oiv, APP(null, { featureFlags: { EXTERNAL_PROJECT_ASSIGN_ENABLED: 'true' } })));
    T.eq('… withdrawn while billing goes through the assigned project: nothing read', [rest(oif.calls).length, oiv.error].join(' | '), '0 | Billing for external requests is handled through the assigned project.');
  }
  Date.now = realNow;

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('every endpoint the chains call exists; Fusion is never called');
  const ops = {};
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'services', 'eqp-v1', 'openapi3.json'), 'utf8'));
  Object.values(spec.paths || {}).forEach((p) => Object.values(p).forEach((op) => { if (op && op.operationId) ops['eqp-v1/' + op.operationId] = true; }));
  const PAGE_NAMES = ['portal', 'request', 'quote', 'invoice', 'order'];
  const used = new Set();
  PAGE_NAMES.forEach((pg) => fs.readdirSync(path.join(PAGES, pg + '-page-chains')).forEach((file) => {
    (fs.readFileSync(path.join(PAGES, pg + '-page-chains', file), 'utf8').match(/'(eqp-v1|fusion[A-Za-z]*|ics|commonService)\/[A-Za-z0-9_]+'/g) || []).forEach((m) => used.add(m.slice(1, -1)));
  }));
  [...used].sort().forEach((e) => T.check(e, !!ops[e]));
  T.check('no chain names Fusion, ICS or the contract defaults', ![...used].some((e) => /^(fusion|ics)/i.test(e))
    && !PAGE_NAMES.some((pg) => fs.readdirSync(path.join(PAGES, pg + '-page-chains')).some((file) => /'resources\/js\/fusionContractDefaults'|'eqp-v1\/createInventoryConsumption'|ProjectLOV\//.test(fs.readFileSync(path.join(PAGES, pg + '-page-chains', file), 'utf8')))));

  T.section('pages: listeners, functions, variables and chains line up; VB binding rules');
  const flow = JSON.parse(fs.readFileSync(path.join(NEXT, 'flows', 'customer', 'customer-flow.json'), 'utf8'));
  T.eq('the flow: its pages, embeddable', flow.id + ':' + Object.keys(flow.pages).join(',') + ':' + flow.navigation.embeddable, 'customer:portal,request,quote,invoice,order:enabled');
  const modules = { portal: new NextPortal(), request: new NextRequest(), quote: new NextQuote(), invoice: new NextInvoice(), order: new NextOrder() };
  PAGE_NAMES.forEach((name) => {
    const html = fs.readFileSync(path.join(PAGES, name + '-page.html'), 'utf8');
    const json = JSON.parse(fs.readFileSync(path.join(PAGES, name + '-page.json'), 'utf8'));
    const dir = path.join(PAGES, name + '-page-chains');
    T.eq(name + ': embeddable', json.navigation && json.navigation.embeddable, 'enabled');
    const listeners = [...new Set((html.match(/\$listeners\.([A-Za-z]+)/g) || []).map((m) => m.split('.')[1]))];
    T.check(name + ': every listener in the HTML is declared (' + listeners.length + ')', listeners.every((l) => json.eventListeners[l]), listeners.filter((l) => !json.eventListeners[l]).join(', '));
    const named = [...new Set([].concat(...Object.values(json.eventListeners).map((l) => l.chains.map((c) => c.chain))))];
    const files = fs.readdirSync(dir).map((x) => x.replace(/\.js$/, ''));
    T.check(name + ': every chain the page names exists', named.every((c) => files.includes(c)), named.filter((c) => !files.includes(c)).join(', '));
    T.check(name + ': each chain is a class named like its file', files.every((x) => new RegExp('class ' + x + ' extends ActionChain').test(fs.readFileSync(path.join(dir, x + '.js'), 'utf8'))));
    const called = new Set();
    files.forEach((x) => (fs.readFileSync(path.join(dir, x + '.js'), 'utf8').match(/chain: '([A-Za-z]+)'/g) || []).forEach((m) => called.add(m.split("'")[1])));
    T.check(name + ': every chain the chains call exists', [...called].every((c) => files.includes(c)), [...called].filter((c) => !files.includes(c)).join(', '));
    const fns = [...new Set((html.match(/\$functions\.([A-Za-z]+)/g) || []).map((m) => m.split('.')[1]))];
    T.check(name + ': every function in the HTML exists (' + fns.length + ')', fns.every((x) => typeof modules[name][x] === 'function'), fns.filter((x) => typeof modules[name][x] !== 'function').join(', '));
    const declared = new Set(Object.keys(json.variables));
    const usedVars = new Set();
    [html].concat(files.map((x) => fs.readFileSync(path.join(dir, x + '.js'), 'utf8'))).forEach((src) => {
      (src.match(/\$variables\.([A-Za-z]+)/g) || []).forEach((m) => usedVars.add(m.split('.')[1]));
      (src.match(/\bv\.([A-Za-z]+)\s*=[^=]/g) || []).forEach((m) => usedVars.add(m.slice(2).split(/\s*=/)[0]));
    });
    const missing = [...usedVars].filter((x) => !declared.has(x));
    T.check(name + ': every variable used is declared', missing.length === 0, missing.join(', '));
    const bindings = html.match(/\[\[[\s\S]*?\]\]/g) || [];
    const bad = bindings.filter((b) => /=>|function\s*\(|\bString\(|\bNumber\(|\bBoolean\(|\{\s*[A-Za-z]+\s*:/.test(b));
    T.check(name + ': no arrow functions, String(), Number(), Boolean() or object literals in bindings', !bad.length, bad.join(' '));
    T.check(name + ': no oj-bind-for-each inside table, tbody or select', !/<(table|tbody|select)[\s\S]*?oj-bind-for-each[\s\S]*?<\/\1>/.test(html));
    T.check(name + ': no :style', !/:style=/.test(html));
    T.check(name + ': no serial number is shown', !/[Ss]erial(Number)?\b(?! numbers)/.test(html.replace(/never serial numbers/g, '')));
    T.check(name + ': nothing is written on entry', (json.eventListeners.vbEnter.chains || []).every((c) => /^(load|init)/.test(c.chain)));
  });
  T.check('the records take their id and number from the tab', ['request', 'quote', 'invoice'].every((p) => ['id', 'number'].every((k) => JSON.parse(fs.readFileSync(path.join(PAGES, p + '-page.json'), 'utf8')).variables[k].input === 'fromCaller'))
    && ['draft', 'number', 'startStep'].every((k) => JSON.parse(fs.readFileSync(path.join(PAGES, 'order-page.json'), 'utf8')).variables[k].input === 'fromCaller'));

  T.section('the portal\'s home reads again after a change in another of its tabs');
  {
    const heard = [];
    realSignal.changed();
    realSignal.listen(() => heard.push('reload'));
    realSignal.changed();
    realSignal.listen(() => { throw new Error('tab gone'); });
    realSignal.changed();
    T.eq('the last portal page listening is told; a gone tab does no harm', heard.join(), 'reload');
    const fired = [];
    loadAmd(path.join(PAGES, 'portal-page.js'), Object.assign({}, PAGE_DEPS, { 'resources/js/portalSignal': realSignal }));
    const P = loadAmd(path.join(PAGES, 'portal-page.js'), Object.assign({}, PAGE_DEPS, { 'resources/js/portalSignal': realSignal }));
    new P({ getEventHelper: () => ({ fireCustomEvent: (n) => fired.push(n) }) });
    realSignal.changed();
    const pj = JSON.parse(fs.readFileSync(path.join(PAGES, 'portal-page.json'), 'utf8'));
    T.eq('… as the page\'s portalChanged event, which loads the home', [fired.join(), pj.events.portalChanged.payloadType, pj.eventListeners.portalChanged.chains[0].chain].join(' | '), 'portalChanged | object | loadChain');
  }

  T.section('the menu, the record kinds, the stylesheet');
  T.eq('the portal is built, in the customer flow', JSON.stringify(nav.routeOf(nav.item('customer-portal'))), '{"flow":"customer","page":"portal","params":{}}');
  const CUST = { EQR_CUST_DASHBOARD: 'FULL', EQR_CUST_MY_REQUESTS: 'FULL', EQR_CUST_CREATE_REQ: 'FULL' };
  T.eq('a customer\'s menu: the portal alone', nav.visibleGroups(CUST, true, { CUSTOMERS_MODULE_ENABLED: 'true' }, true, {}).map((g) => g.items.map((i) => i.id).join()).join(' | '), 'customer-portal');
  T.eq('… and nothing without the Customers module', nav.visibleGroups(CUST, true, {}, true, {}).length, 0);
  const restored = tabs.restore(null).tabs.filter((t) => nav.itemVisible(nav.item(t.navId), CUST, true, { CUSTOMERS_MODULE_ENABLED: 'true' }, true, {}));
  T.eq('a customer cannot keep My work open (the shell then shows the portal)', restored.length, 0);
  T.eq('a request, its quote, its invoices open in tabs of their own', ['customer-request', 'quote', 'invoice'].map((k) => {
    const t = tabs.forRecord(k, { id: 610, number: 'EQR-000610' });
    return t.id + '=' + t.title + '@' + t.flow + '/' + t.page + ':' + t.navId;
  }).join(' | '), 'customer-request:610=EQR-000610@customer/request:customer-portal | quote:610=Quote · EQR-000610@customer/quote:customer-portal | invoice:610=Invoices · EQR-000610@customer/invoice:customer-portal');
  T.eq('a new request: one tab; a draft: its own', [tabs.forRecord('customer-order', {}).id + '=' + tabs.forRecord('customer-order', {}).title,
    tabs.forRecord('customer-order', { draft: 905, number: 'EQR-000905' }).id + '=' + tabs.forRecord('customer-order', { draft: 905, number: 'EQR-000905' }).title].join(' | '),
    'customer-order:new=New request | customer-order:draft-905=Draft EQR-000905');
  T.eq('… deep links', [tabs.fromQuery('?open=customer-portal').id, tabs.fromQuery('?open=quote&id=610&number=EQR-000610').id, tabs.fromQuery('?open=customer-order').id].join(), 'customer-portal,quote:610,customer-order:new');
  T.eq('New\'s customer pages, for the steps that write to Fusion', [nav.newUrl('http://new', 'customer-portal'), V.newRequestPage('http://new/', 'customer-quote', 'EQR-1', 5),
    V.newPage('http://new', 'customer-new-request', { draftId: 9, startStep: 3 }), V.newPage('', 'x', {})].join(' | '),
    'http://new/vp/shell/customer/customer-home | http://new/vp/shell/customer/customer-quote?requestId=EQR-1&requestNumericId=5 | http://new/vp/shell/customer/customer-new-request?draftId=9&startStep=3 | ');
  const app = JSON.parse(fs.readFileSync(path.join(NEXT, 'app-flow.json'), 'utf8'));
  T.check('the stylesheet is imported and exists', app.imports.css.includes('resources/css/next-customer.css') && fs.existsSync(path.join(NEXT, 'resources', 'css', 'next-customer.css')));
  const css = fs.readFileSync(path.join(NEXT, 'resources', 'css', 'next-customer.css'), 'utf8');
  const selectors = (css.replace(/\/\*[\s\S]*?\*\//g, '').match(/(^|\})\s*([^{}@]+)\{/g) || []).map((m) => m.replace(/^\}?\s*/, '').replace(/\{$/, '').trim());
  T.check('the stylesheet only styles the portal\'s own classes (nx-cu-*, its grids)', selectors.every((s) => s.split(',').every((part) => /\.nx-(cu|grid--cu)/.test(part))),
    selectors.filter((s) => !s.split(',').every((part) => /\.nx-(cu|grid--cu)/.test(part))).join(' | '));

  T.report();
})().catch((e) => { console.error(e); process.exitCode = 1; });
