/*
 * New EquipRite, Customers: the customer portal (webApps/equiprite/flows/customer).
 *
 * Two kinds of check:
 *   - the pure logic: the plain-word statuses, the parcel tracker, what needs the customer next, the request chips,
 *     the billing totals, the quote line totals, the customer request form (resources/js/customerPortal.js and the
 *     page modules)
 *   - every chain that writes, and the reads they depend on, run against a fake backend: endpoint, body and order,
 *     and the failure paths. Where an Old EquipRite chain is replaced, the OLD chain is run too, on the same answers,
 *     and the two call sequences must be identical (request numbers made from Date.now() aside).
 * Plus: the Fusion contract test values in resources/js/fusionContractDefaults.js equal the old chains' literals, and
 * every endpoint the flow calls exists in services/.
 *
 * Run:  node tests/customer.test.js
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
const FLOW = path.join(NEW, 'flows', 'customer', 'pages');
const OLDP = path.join(OLD, 'flows', 'customer-portal', 'pages');
const DEBUG = !!process.env.DEBUG;

// ── loading the real modules ───────────────────────────────────────────────────────────────────────────────────

const quiet = { log() {}, info() {}, warn: DEBUG ? console.warn : () => {}, error: DEBUG ? console.error : () => {} };
const store = {};
const storage = {
  getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; },
  key: (i) => Object.keys(store)[i], get length() { return Object.keys(store).length; },
};
const geocoder = { lookup: async (a) => (a ? { latitude: 31.85, longitude: -102.37, formattedAddress: a + ' (found)' } : null) };

function sandbox() {
  return {
    console: quiet, setTimeout, clearTimeout, Promise, Intl, atob, btoa, Uint8Array,
    URL: { createObjectURL: () => 'blob:quote-pdf' },
    Blob: function Blob(parts, o) { this.parts = parts; this.type = o && o.type; },
    window: { scrollTo() {}, location: { reload() {}, assign() {}, href: '' } },
    document: { getElementById: () => null, querySelectorAll: () => [], body: {} },
    MutationObserver: function () { this.observe = () => {}; },
    sessionStorage: storage, localStorage: storage,
  };
}

/** An AMD loader for one app: resources/js/* resolve from that app (each loaded once), the rest from `fixed`. */
function loader(appDir, fixed) {
  const cache = {};
  const resolve = (name) => {
    if (fixed && name in fixed) return fixed[name];
    if (name.indexOf('resources/js/') === 0) {
      if (!(name in cache)) cache[name] = load(path.join(appDir, name + '.js'));
      return cache[name];
    }
    return {};
  };
  function load(file, extra) {
    const sb = sandbox();
    let mod;
    sb.define = (names, factory) => {
      mod = factory(...(names || []).map((n) => (extra && n in extra ? extra[n] : resolve(n))));
    };
    vm.createContext(sb);
    vm.runInContext(fs.readFileSync(file, 'utf8'), sb, { filename: path.basename(file) });
    return mod;
  }
  return { load, resolve };
}

const FIXED = { 'resources/js/geocoder': geocoder, 'ojs/ojarraydataprovider': function ADP(d) { this.data = d; } };
const N = loader(NEW, FIXED);
const O = loader(OLD, FIXED);
const portal = N.resolve('resources/js/customerPortal');
const fusion = N.resolve('resources/js/fusionContractDefaults');
const terms = N.resolve('resources/js/rentalTerms');
const hdr = N.resolve('resources/js/requestHeaderBody');
const lineBody = N.resolve('resources/js/requestLineBody');
const catalogCart = N.resolve('resources/js/catalogCart');
const requestModel = N.resolve('resources/js/requestModel');
const App = N.load(path.join(NEW, 'app-flow.js'), { 'resources/js/lineStatusLabels': { formatLineStatus: (c) => c, statusPillClass: () => '' } });
const app = new App();

const page = (name) => { const P = N.load(path.join(FLOW, name + '-page.js')); return new P(); };

/** A chain of the new flow / of the old portal, built against `Actions`. */
const newChain = (pageName, chain, Actions) => N.load(path.join(FLOW, pageName + '-page-chains', chain + '.js'),
  { 'vb/action/actionChain': class {}, 'vb/action/actions': Actions });
const oldChain = (pageName, chain, Actions) => O.load(path.join(OLDP, pageName + '-page-chains', chain + '.js'),
  { 'vb/action/actionChain': class {}, 'vb/action/actions': Actions });

/** A fake backend: `answer(opts, n)` replies (default ok {}); every call, toast and navigation is recorded. */
function backend(answer) {
  const calls = [];
  const Actions = {
    async callRest(ctx, o) {
      calls.push({ endpoint: o.endpoint, uriParams: o.uriParams || null, body: o.body === undefined ? null : o.body, headers: o.headers || null });
      const r = answer ? answer(o, calls.length) : null;
      return r || { ok: true, status: 200, body: {} };
    },
    async fireNotificationEvent(ctx, n) { calls.push({ toast: n.summary, type: n.type || '' }); },
    async navigateToPage(ctx, n) { calls.push({ nav: n.page, params: n.params || {} }); },
    async navigateToFlow(ctx, n) { calls.push({ nav: n.flow + '/' + n.page }); },
    async callChain(ctx, n) { calls.push({ chain: n.chain || n.id }); return true; },
    async callComponentMethod(ctx, n) { calls.push({ component: n.selector + ':' + n.method }); },
  };
  return { calls, Actions };
}
const rest = (calls) => calls.filter((c) => c.endpoint);
const norm = (x) => JSON.stringify(x).replace(/REQ-\d{10,}/g, 'REQ-<now>').replace(/STS-REQ-<now>/g, 'STS-REQ-<now>');
const seq = (calls) => rest(calls).map((c) => c.endpoint.replace('eqp-v1/', '')).join(' > ');

const FLAGS = { CUSTOMERS_MODULE_ENABLED: 'true', PROJECTS_MODULE_ENABLED: 'true' };
const CUSTOMER_ACCESS = { EQR_CUST_DASHBOARD: 'FULL', EQR_CUST_MY_REQUESTS: 'FULL', EQR_CUST_CREATE_REQ: 'FULL' };

function context(pageVars, pageFns, o) {
  const x = o || {};
  return {
    $page: { variables: pageVars, functions: pageFns || {} },
    $functions: pageFns || {},
    $flow: { variables: x.flow || {} },
    $application: {
      variables: {
        jwt: '', featureFlags: Object.assign({}, FLAGS, x.flags || {}), flagsLoaded: true,
        globalSettings: { ENABLE_QUOTES: x.quotes || 'CUSTOMER' },
        pageAccessMap: x.access || CUSTOMER_ACCESS, pageAccessLoaded: true,
        fusionRoles: [], sessionRoles: ['CUSTOMER'], sessionRolesLoaded: true,
      },
      functions: app,
      user: { username: 'maria.torres', isAuthenticated: true },
      currentPage: { id: x.pageId || 'customer-home' },
    },
  };
}

(async () => {
  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('words: every status reads in plain words');
  T.eq('a quote waiting', portal.statusText('QUOTE_GENERATED'), 'Quote ready for you');
  T.eq('arrived on site', portal.statusText('SHIP_TO_SITE'), 'Arrived, please confirm');
  T.eq('deployed is on site', portal.statusText('DEPLOYED'), 'On site');
  T.eq('an unknown status reads as words', portal.statusText('SOME_NEW_THING'), 'Some new thing');
  T.eq('empty stays empty', portal.statusText(''), '');
  T.eq('pill tone: needs the customer', portal.statusClass('DRAFT'), 'er-cu-pill er-cu-pill--action');
  T.eq('pill tone: stopped', portal.statusClass('REJECTED'), 'er-cu-pill er-cu-pill--stopped');
  T.eq('date range, one year', portal.dateRange('2026-11-02', '2026-12-15'), '2 Nov – 15 Dec 2026');
  T.eq('date range across years', portal.dateRange('2026-12-20', '2027-01-05'), '20 Dec 2026 – 5 Jan 2027');
  T.eq('money', portal.money(18420) + ' ' + portal.money(1250.5) + ' ' + portal.money(-40) + ' ' + portal.money(null), '$18,420 $1,250.50 −$40 —');

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('tracking steps (parcel style)');
  const st = (status, lines, info) => portal.trackSteps(status, lines || [], info || {}).map((s) => s.state[0]).join('');
  T.eq('six stops', portal.trackSteps('SUBMITTED', [], {}).map((s) => s.label).join(' | '),
    'Requested | Confirmed | Being prepared | On the way | On site | Returned');
  T.eq('a draft sits on Requested, not sent yet', st('DRAFT'), 'cttttt');
  T.eq('… and says so', portal.trackSteps('DRAFT', [], {})[0].when, 'Not sent yet');
  T.eq('a customer submit (IN_PROCESS) is Requested', st('IN_PROCESS'), 'cttttt');
  T.eq('quote accepted is Confirmed', st('QUOTE_ACCEPTED', [], { contractNumber: 'K-9' }), 'dctttt');
  T.eq('… with the contract under it', portal.trackSteps('QUOTE_ACCEPTED', [], { contractNumber: 'K-9' })[1].when, 'Contract K-9');
  T.eq('the furthest line counts: header IN_PROCESS, a line on its way', st('IN_PROCESS', [{ lineStatus: 'PICK_RELEASED' }, { lineStatus: 'SHIPPED' }]), 'dddctt');
  T.eq('an arrived line: On the way, "Arrived"', portal.trackSteps('IN_PROCESS', [{ lineStatus: 'SHIP_TO_SITE' }], { startDate: '2026-11-02' })[3].when, 'Arrived');
  T.eq('on site, from the start date', portal.trackSteps('DEPLOYED', [{ lineStatus: 'DEPLOYED' }], { startDate: '2026-11-02' })[4].when, 'From 2 Nov');
  T.eq('on site: Returned is next, due back', portal.trackSteps('DEPLOYED', [{ lineStatus: 'DEPLOYED' }], { endDate: '2026-11-27' })[5].when, 'Due back 27 Nov');
  T.eq('going back is the current last stop', st('DEPLOYED', [{ lineStatus: 'RETURN_INITIATED' }]), 'dddddc');
  T.eq('closed: everything done', st('CLOSED', [{ lineStatus: 'CLOSED' }]), 'dddddd');
  T.eq('every line back or used: done', st('DEPLOYED', [{ lineStatus: 'RETURNED' }, { lineStatus: 'CONSUMED' }]), 'dddddd');
  T.eq('all lines turned down is not "returned"', st('IN_PROCESS', [{ lineStatus: 'REJECTED' }]), 'cttttt');
  T.eq('rejected stops at Requested', portal.trackSteps('REJECTED', [], {}).map((s) => s.state === 'stopped' ? s.label : '').join(''), 'Turned down');

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('next step: the one thing at the top of a request');
  const nx = (fd, lines, q) => portal.nextAction(fd, lines, { quotingAllowed: q !== false });
  T.eq('draft → send it', nx({ status: 'DRAFT' }, []).action, 'draft');
  T.eq('quote ready → accept it', nx({ status: 'QUOTE_GENERATED' }, []).action, 'quote');
  T.eq('quote ready but accepting is off → no button', nx({ status: 'QUOTE_GENERATED' }, [], false).action, '');
  T.check('arrived lines → accept the delivery, with the count',
    nx({ status: 'IN_PROCESS' }, [{ lineStatus: 'SHIP_TO_SITE' }, { lineStatus: 'SHIP_TO_SITE' }, { lineStatus: 'DEPLOYED' }]).action === 'delivery'
    && nx({ status: 'IN_PROCESS' }, [{ lineStatus: 'SHIP_TO_SITE' }, { lineStatus: 'SHIP_TO_SITE' }]).text.indexOf('2 items arrived') === 0);
  T.eq('on site → start the return', nx({ status: 'DEPLOYED', endDate: '2026-11-27' }, [{ lineStatus: 'DEPLOYED' }]).action, 'return');
  T.check('… with the due date', nx({ status: 'DEPLOYED', endDate: '2026-11-27' }, [{ lineStatus: 'DEPLOYED' }]).text.indexOf('due back 27 Nov 2026') > 0);
  T.eq('delivery comes before return', nx({ status: 'DEPLOYED' }, [{ lineStatus: 'DEPLOYED' }, { lineStatus: 'SHIP_TO_SITE' }]).action, 'delivery');
  T.eq('arrived lines on a not-yet-confirmed request: no line action', nx({ status: 'SUBMITTED' }, [{ lineStatus: 'SHIP_TO_SITE' }]).action, '');
  T.eq('submitted → we are working on it', nx({ status: 'SUBMITTED' }, []).key, 'wait');
  T.eq('closed → all done', nx({ status: 'CLOSED' }, []).key, 'done');
  T.eq('rejected → stopped', nx({ status: 'REJECTED' }, []).tone, 'stopped');
  T.eq('line actions only once the request is in operations (the old allowlist)',
    ['DRAFT', 'SUBMITTED', 'IN_PROCESS', 'QUOTE_ACCEPTED', 'DEPLOYED', 'CLOSED'].map((s) => portal.headerIsConfirmed(s) ? 1 : 0).join(''), '001110');
  T.eq('a quote can be viewed once one exists, where quoting is on',
    ['QUOTE_GENERATED', 'QUOTE_ACCEPTED', 'DEPLOYED', 'IN_PROCESS'].map((s) => portal.hasQuote(s, true) ? 1 : 0).join('') + (portal.hasQuote('QUOTE_GENERATED', false) ? 1 : 0), '11100');

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('requests list: chips and search');
  const ROWS = [
    { id: 1, requestNumber: 'REQ-1', status: 'DRAFT', customerName: 'Lone Star Paving' },
    { id: 2, requestNumber: 'REQ-2', status: 'QUOTE_GENERATED', customerName: 'Lone Star Paving', customerContact: 'Maria Torres' },
    { id: 3, requestNumber: 'REQ-3', status: 'DEPLOYED', customerName: 'Lone Star Paving', contractNumber: 'K-77' },
    { id: 4, requestNumber: 'REQ-4', status: 'CLOSED', customerName: 'Lone Star Paving' },
    { id: 5, requestNumber: 'REQ-5', status: 'BRAND_NEW', customerName: 'Acme' },
  ];
  T.eq('chips: needs you, open, finished, all', portal.groupChips(ROWS).map((c) => c.key + ':' + c.count).join(' '), 'needs:2 open:4 done:1 all:5');
  T.eq('needs you = draft and quote ready', portal.filterRequests(ROWS, 'needs', '').map((r) => r.id).join(), '1,2');
  T.eq('open includes an unknown status', portal.filterRequests(ROWS, 'open', '').map((r) => r.id).join(), '1,2,3,5');
  T.eq('search by contract number', portal.filterRequests(ROWS, 'all', 'k-77').map((r) => r.id).join(), '3');
  T.eq('search by contact', portal.filterRequests(ROWS, 'all', 'maria').map((r) => r.id).join(), '2');
  T.eq('search by the words shown', portal.filterRequests(ROWS, 'all', 'on site').map((r) => r.id).join(), '3');
  const reqPage = page('customer-requests');
  T.eq('who', reqPage.who(ROWS[1]) + '|' + reqPage.who(ROWS[0]), 'Lone Star Paving · Maria Torres|Lone Star Paving');
  T.eq('empty text names the chip', reqPage.emptyText('needs', ''), 'Nothing needs you right now.');

  T.section('staff using the portal for customers');
  T.eq('a customer sign-in (customer codes, Home) is not staff', portal.actsForCustomers(Object.assign({ EQR_DASHBOARD: 'FULL' }, CUSTOMER_ACCESS), true), false);
  T.eq('an Equipment Manager is', portal.actsForCustomers(Object.assign({ EQR_WORKBENCH: 'FULL' }, CUSTOMER_ACCESS), true), true);
  T.eq('a HIDDEN internal code does not count', portal.actsForCustomers(Object.assign({ EQR_WORKBENCH: 'HIDDEN' }, CUSTOMER_ACCESS), true), false);
  T.eq('nothing while page access loads', portal.actsForCustomers({ EQR_WORKBENCH: 'FULL' }, false), false);
  T.eq('why not hasInternalPageAccess: it reads a customer as staff', app.hasInternalPageAccess(CUSTOMER_ACCESS, true), true);

  T.section('home: next for you, on site');
  const todo = portal.todo(ROWS, { 3: 2 }, { overdueCount: 1, overdueAmount: 1600 }, { quotingAllowed: true });
  T.eq('most urgent first: quote, delivery, draft, invoice', todo.map((t) => t.kind).join(), 'quote,delivery,draft,invoice');
  T.eq('delivery says how many arrived', todo[1].sub, '2 items have arrived at your site.');
  T.eq('overdue invoice with the amount', todo[3].title + ' / ' + todo[3].sub, '1 invoice is overdue / $1,600 past its due date.');
  T.eq('billing hidden: no invoice item', portal.todo(ROWS, {}, null, { quotingAllowed: true }).map((t) => t.kind).join(), 'quote,draft');
  const home = page('customer-home');
  T.eq('greeting from the sign-in name', home.greeting({ username: 'maria.torres' }, new Date(2026, 9, 29, 9)), 'Good morning, Maria');
  T.eq('greeting without a name', home.greeting({}, new Date(2026, 9, 29, 15)), 'Welcome');
  T.eq('on site: requests with deployed lines, most first', JSON.stringify(home.onSite(ROWS, { 3: 2, 2: 0, 1: 5 }).map((r) => r.id + ':' + r.count)), '["1:5","3:2"]');
  T.eq('summary line', home.summary({ active: 3 }, 2, false), '3 active requests · 2 things need you');

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('billing totals (the old billing detail rules)');
  const today = new Date(2026, 9, 29);
  const INV = [
    { eqrBillingTransactionId: 1, eqrEquipmentRequestId: 30, eqrRequestLineId: 301, invoiceNumber: 'INV-1', status: 'PAID', grossAmount: 12140, billingPeriodStart: '2026-09-01', billingPeriodEnd: '2026-09-30', dueDate: '2026-10-15', transactionDate: '2026-09-30' },
    { eqrBillingTransactionId: 2, eqrEquipmentRequestId: 30, eqrRequestLineId: 301, invoiceNumber: 'INV-2', status: 'POSTED', grossAmount: 16180, billingPeriodStart: '2026-10-01', billingPeriodEnd: '2026-10-31', dueDate: '2026-11-15', transactionDate: '2026-10-31' },
    { eqrBillingTransactionId: 3, eqrEquipmentRequestId: 30, eqrRequestLineId: 302, invoiceNumber: 'INV-3', status: 'POSTED', grossAmount: 2240, billingPeriodStart: '2026-09-01', billingPeriodEnd: '2026-09-27', dueDate: '2026-10-11', transactionDate: '2026-09-27' },
    { eqrBillingTransactionId: 4, eqrEquipmentRequestId: 30, eqrRequestLineId: 302, transactionType: 'CREDIT', status: 'POSTED', grossAmount: -240, billingPeriodStart: '2026-09-01', billingPeriodEnd: '2026-09-27' },
    { eqrBillingTransactionId: 5, eqrEquipmentRequestId: 30, eqrRequestLineId: 302, status: 'VOID', grossAmount: 999 },
    { eqrBillingTransactionId: 6, eqrEquipmentRequestId: 40, eqrRequestLineId: 401, status: 'SCHEDULED', netAmount: 500, billingPeriodStart: '2026-11-01', billingPeriodEnd: '2026-11-30' },
  ];
  const mapped = portal.mapInvoices(INV, today);
  const byNo = (n) => mapped.find((i) => i.invId === String(n));
  T.eq('paid stays paid', byNo(1).status, 'PAID');
  T.eq('posted, not yet due: to pay (OPEN)', byNo(2).status, 'OPEN');
  T.eq('posted past its due date: OVERDUE', byNo(3).status, 'OVERDUE');
  T.eq('credit note is an adjustment', byNo(4).status + '/' + byNo(4).isAdjustment, 'CREDIT/true');
  T.eq('void is cancelled', byNo(5).status, 'CANCELLED');
  T.eq('scheduled is not billed yet', byNo(6).status + ' ' + byNo(6).amount, 'SCHEDULED 500');
  T.eq('period label', byNo(2).periodLabel, 'Oct 1 → Oct 31, 2026');
  const tot = portal.invoiceTotals(mapped);
  T.eq('total invoiced leaves out cancelled, nets the credit', tot.totalInvoiced, 12140 + 16180 + 2240 - 240 + 500);
  T.eq('paid', tot.paidAmount, 12140);
  T.eq('outstanding = everything not paid', tot.outstandingAmount, 16180 + 2240 - 240 + 500);
  T.eq('overdue count and amount', tot.overdueCount + ' ' + tot.overdueAmount, '1 2240');
  T.eq('adjustments', tot.netAdjustment + ' ' + tot.hasAdjustments, '-240 true');
  T.eq('last invoice is the latest period', tot.lastInvoiceLabel, 'Nov 1, 2026');
  const billPage = page('customer-billing');
  const sums = billPage.summaries([{ id: 30, requestNumber: 'REQ-30', contractNumber: 'K-30' }, { id: 50, requestNumber: 'REQ-50', contractNumber: 'K-50' }], mapped);
  T.eq('per billed request: invoiced / paid / outstanding / overdue / count',
    [sums[0].invoiced, sums[0].paid, sums[0].outstanding, sums[0].overdue, sums[0].invoiceCount].join(' '), [30320, 12140, 18180, 1, 4].join(' '));
  T.eq('a billed request without invoices reads zero', sums[1].invoiced + sums[1].outstanding + sums[1].invoiceCount, 0);
  T.eq('invoice → its request number', billPage.requestOf(byNo(1), [{ id: 30, requestNumber: 'REQ-30' }]), 'REQ-30');
  T.eq('invoice words', ['OPEN', 'OVERDUE', 'SCHEDULED'].map((s) => portal.invoiceText(s)).join(' | '), 'To pay | Overdue | Not billed yet');

  T.section('quote line totals (the old QuoteInitChain rule) and contract value');
  const quote = page('customer-quote');
  T.eq('stored estimatedCost wins', quote.quoteLine({ startDate: '2026-11-02', endDate: '2026-11-27', quantity: 2, billRate: 1400, priceUom: 'DAY', estimatedCost: 70000 }).lineTotal, 70000);
  T.eq('daily rate × qty × days (both ends)', quote.quoteLine({ startDate: '2026-11-02', endDate: '2026-11-27', quantity: 2, billRate: 1400, priceUom: 'DAILY' }).lineTotal, 2 * 1400 * 26);
  T.eq('a weekly rate is not multiplied by days', quote.quoteLine({ startDate: '2026-11-02', endDate: '2026-11-27', quantity: 1, billRate: 3200, priceUom: 'WEEK' }).lineTotal, 3200);
  T.eq('rate shows what it covers', quote.rateText({ billRate: 3200, priceUom: 'WEEKLY' }), '$3,200 / WEEK');
  T.eq('accept label: accepted', quote.acceptLabel({ contractNumber: 'K-1' }, false, true), 'Accepted · contract K-1');
  T.check('accept open only with no contract, not running, and allowed',
    quote.canAccept({}, false, true) && !quote.canAccept({ contractNumber: 'K' }, false, true) && !quote.canAccept({}, true, true) && !quote.canAccept({}, false, false));
  const contract = page('customer-contract');
  T.eq('contract value sums the stored line totals', JSON.stringify(contract.value([{ estimatedCost: 100 }, { estimatedCost: null }, { estimatedCost: '50.5' }])), '{"total":150.5,"priced":2,"lines":3}');
  T.check('no contract yet: says when it comes', contract.contractState('', true).text.indexOf('accept the quote') > 0
    && contract.contractState('', false).text.indexOf('submitted') > 0);
  T.eq('the terms are the old dialog\'s twelve sections', terms.SECTIONS.length + ' / ' + terms.SECTIONS[11].title, '12 / 12. Governing Law and Entire Agreement');
  const oldDialog = fs.readFileSync(path.join(OLDP, 'request-cart-page.html'), 'utf8');
  const dialogText = oldDialog.slice(oldDialog.indexOf('id="termsDialog"'), oldDialog.indexOf('<!-- Insurance Details -->'))
    .replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
  const paras = [].concat(terms.INTRO, ...terms.SECTIONS.map((s) => [s.title].concat(s.paras.map((p) => (p.lead ? p.lead + ' ' : '') + p.text))));
  const notFound = paras.filter((p) => dialogText.indexOf(p.replace(/\s+/g, ' ')) === -1);
  T.check(`every terms paragraph (${paras.length}) is word for word in the old dialog`, paras.length > 40 && !notFound.length, notFound.slice(0, 2).join(' || '));

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('Fusion contract values: one module, equal to the old chains (TEST VALUES)');
  const literals = (file) => {
    const src = fs.readFileSync(file, 'utf8');
    const out = {};
    (src.match(/^\s+(LegalEntityName|OrgId|PrimaryPartyId|ContractTypeId|InvOrgName|OrgName|ContractTypeName|PartyName|CurrencyCode|LineTypeId|LineTypeName):\s+('[^']*'|\d+)/gm) || [])
      .forEach((m) => { const k = m.trim().split(':')[0]; out[k] = m.split(':').slice(1).join(':').trim().replace(/^'|'$/g, ''); });
    return out;
  };
  const oldSubmit = literals(path.join(OLDP, 'request-cart-page-chains', 'SubmitRequestChain.js'));
  const oldAccept = literals(path.join(OLDP, 'customer-quote-page-chains', 'AcceptQuoteChain.js'));
  const mine = Object.assign({}, fusion.CONTRACT, fusion.LINE);
  T.eq('the old chains were read (11 fixed values each)', Object.keys(oldSubmit).length + '/' + Object.keys(oldAccept).length, '11/11');
  Object.keys(mine).forEach((k) => T.check(`${k} = old submit = old accept (${mine[k]})`, String(mine[k]) === oldSubmit[k] && String(mine[k]) === oldAccept[k],
    `module ${mine[k]}, submit ${oldSubmit[k]}, accept ${oldAccept[k]}`));
  const usesFusion = ['customer-quote-page-chains/acceptQuoteChain.js', 'customer-new-request-page-chains/submitChain.js'];
  usesFusion.forEach((f) => {
    const src = fs.readFileSync(path.join(FLOW, f), 'utf8');
    T.check(`${f}: takes the values from the module, no literal of its own`,
      src.includes("'resources/js/fusionContractDefaults'") && !/EPC UAE|Stark Industries|300000334372921|100000000395788|300000048179116/.test(src));
  });
  const flowSrc = fs.readdirSync(FLOW, { recursive: true }).filter((f) => f.endsWith('.js') || f.endsWith('.html'))
    .map((f) => fs.readFileSync(path.join(FLOW, f), 'utf8')).join('\n');
  T.check('no other file of the flow carries the test values', !/EPC UAE|Stark Industries|300000334372921/.test(flowSrc));

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('customer request form: the old CreateRequestNextChain snapshot, field for field');
  const nr = page('customer-new-request');
  const FORM = Object.assign(nr.emptyForm(), {
    customerRefId: 7, customerName: 'Lone Star Paving LLC', requestorId: 41, requestorName: 'Maria Torres',
    location: '1200 Pipeline Rd, Odessa TX', startDate: '2026-11-02', endDate: '2026-11-27', notes: 'Gate 3',
  });
  const detail = nr.buildDetail(FORM);
  const oldNext = fs.readFileSync(path.join(OLDP, 'customer-create-req-page-chains', 'CreateRequestNextChain.js'), 'utf8');
  const block = oldNext.slice(oldNext.indexOf('$flow.variables.ActiveRequestDetail = {'), oldNext.indexOf('// Start from the canonical default shape'));
  const oldKeys = (block.match(/^\s{8}([a-zA-Z]+):/gm) || []).map((k) => k.trim().replace(':', ''));
  T.check('the old snapshot was read', oldKeys.length >= 18, oldKeys.join(','));
  T.eq('the same keys, in the same order', Object.keys(detail).join(','), oldKeys.join(','));
  T.eq('step 2 needs customer, contact, delivery (the old required fields)', nr.missingFor(2, nr.emptyForm(), []).join('|'), 'Customer|Contact|Delivery address');
  T.eq('a complete form passes', nr.missingFor('submit', FORM, [{ name: 'x' }]).length, 0);
  T.eq('contacts and customers searchable', nr.partyMatches([{ id: 1, contactName: 'Maria Torres', email: 'm@x' }, { id: 2, contactName: 'Bo' }], 'MARIA').length, 1);
  // The old flow's variables for the same form, built as CreateRequestNextChain builds them.
  const oldFlowVars = (form) => {
    const request = Object.assign(requestModel.defaultRequest(), {}, {
      customerId: form.customerRefId, requestorId: form.requestorId, requestorName: form.requestorName, location: form.location,
      startDate: form.startDate, endDate: form.endDate, notes: form.notes || '', projectId: null, projectNumber: '', projectName: '',
      taskId: null, taskNumber: '', taskName: '', isSoftReservation: false,
    });
    request.requestType = 'EXTERNAL';
    request.locationLatitude = form.locationLatitude != null ? form.locationLatitude : null;
    request.locationLongitude = form.locationLongitude != null ? form.locationLongitude : null;
    return { request, ActiveRequestDetail: {
      customerRefId: form.customerRefId, customerName: form.customerName, requestorId: form.requestorId, requestorName: form.requestorName,
      location: form.location, requestedStartDate: form.startDate, requestedEndDate: form.endDate, notes: form.notes || '',
      projectId: null, projectNumber: '', projectName: '', taskId: null, taskNumber: '', taskName: '',
      internalCustomerId: null, internalCustomerName: '', contractId: null, contractNumber: '', isSoftReservation: false,
    } };
  };
  const ROWS_CAT = [
    { eqrEquipmentMasterId: 11, equipmentName: 'CAT 320 Excavator', className: 'Excavators', eqrEquipmentClassId: 1, isRentable: true, rate: 1400, rateUom: 'DAY', periodAmount: 1400, periodType: 'DAILY' },
    { eqrEquipmentMasterId: 21, equipmentName: 'Trench safety kit', className: 'Safety', eqrEquipmentClassId: 2, isRentable: false, unitPrice: 25 },
  ];
  const CART = [catalogCart.itemFromRow(ROWS_CAT[0], 2, null), catalogCart.itemFromRow(ROWS_CAT[1], 10, null)];
  const ov = oldFlowVars(FORM);
  const oldBody = hdr.build(hdr.derive(Object.assign({}, ov, { CartItemsArray: CART, requestOrigin: 'customer', fromAgreementId: null })), 'REQ-1');
  const newBody = hdr.build(hdr.derive({ request: nr.buildRequest(FORM), ActiveRequestDetail: detail, CartItemsArray: CART, requestOrigin: 'customer', fromAgreementId: null }), 'REQ-1');
  T.eq('the header body equals the old customer cart\'s, byte for byte', JSON.stringify(newBody), JSON.stringify(oldBody));
  const expect = { requestType: 'EXTERNAL', status: 'DRAFT', eqrCustomerRefId: 7, customerName: 'Lone Star Paving LLC', contactName: 'Maria Torres',
    eqrCustomerPortalUserId: 41, requestorUserId: null, requestorName: null, projectRefId: null, taskId: null, projectInternalCustomerId: null,
    deliveryLocationType: null, attribute1: '1200 Pipeline Rd, Odessa TX', attribute2: 'Gate 3', requestedStartDate: '2026-11-02T00:00:00Z', isSoftReservation: 'N' };
  Object.keys(expect).forEach((k) => T.eq('header ' + k, newBody[k], expect[k]));

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('submit a customer request: the old EXTERNAL path, old and new side by side');
  const answerSubmit = (fail) => (o) => {
    if (fail === o.endpoint) return { ok: false, status: 500, body: { message: 'boom' } };
    if (o.endpoint === 'eqp-v1/createEquipmentRequest') return { ok: true, status: 201, body: { id: 901, requestNumber: 'EQR-000901' } };
    if (o.endpoint === 'eqp-v1/createShipToSite') return { ok: true, status: 201, body: { id: 77 } };
    if (o.endpoint === fusion.ENDPOINT) return fail === 'contract' ? { ok: false, status: 400, body: { title: 'bad' } } : { ok: true, status: 201, body: { ContractNumber: 'K-2026-0042' } };
    return null;
  };
  const submitPageVars = (extra) => Object.assign({ form: Object.assign({}, FORM), cart: CART.map((c) => Object.assign({}, c)), isSubmitting: false, missing: [],
    resume: null, agreementId: null, agreementLineMap: {}, termsAccepted: true, isCreatingContract: false }, extra || {});
  async function runNewSubmit(mode, quotes, fail, extra) {
    const b = backend(answerSubmit(fail));
    const C = newChain('customer-new-request', 'submitChain', b.Actions);
    const c = context(submitPageVars(extra), nr, { quotes, pageId: 'customer-new-request' });
    await new C().run(c, { mode });
    return { calls: b.calls, c };
  }
  async function runOldSubmit(quotes, fail) {
    const b = backend(answerSubmit(fail));
    const C = oldChain('request-cart', 'SubmitRequestChain', b.Actions);
    const flow = Object.assign(oldFlowVars(FORM), { CartItemsArray: CART.map((c) => Object.assign({}, c)), requestOrigin: 'customer', fromAgreementId: null,
      agreementLineIdByEquipmentId: {}, resumeDraft: null });
    const c = context({ termsAccepted: true, isSubmitting: false }, {}, { quotes, flow });
    await new C().run(c);
    return { calls: b.calls, c };
  }
  {
    const n = await runNewSubmit('submit', 'NONE');
    const o = await runOldSubmit('NONE');
    T.eq('quoting off: header, site, site link, lines, status, contract, contract number',
      seq(n.calls), 'createEquipmentRequest > createShipToSite > patchEquipmentRequest > createRequestLinesBatch > patchEquipmentRequest > ProjectLOV/postFscmRestApiResources11_13_18_05Contracts > patchEquipmentRequest');
    T.eq('… every call identical to the old SubmitRequestChain (endpoint, parameters, body, headers, order)', norm(rest(n.calls)), norm(rest(o.calls)));
    const lines = rest(n.calls)[3];
    T.check('every line IN_PROCESS and priced (no quote coming)', lines.body.lines.every((l) => l.lineStatus === 'IN_PROCESS') && lines.body.lines[0].billRate === 1400);
    T.eq('the header goes IN_PROCESS (no customer-side approver)', JSON.stringify(rest(n.calls)[4].body), '{"status":"IN_PROCESS"}');
    const k = rest(n.calls)[5].body;
    T.eq('contract: the fixed values from the module', [k.LegalEntityName, k.OrgId, k.PrimaryPartyId, k.ContractTypeId, k.PartyName, k.CurrencyCode].join(' | '),
      'EPC UAE | 300000334372921 | 100000000395788 | 300000048179116 | Stark Industries | USD');
    T.eq('contract: estimated amount = rate × qty × days for every cart line (the old rule)', k.EstimatedAmount, 2 * 1400 * 26 + 10 * 25 * 26);
    T.check('contract: one line per cart line, the old Cognomen (the REQ- placeholder)', k.ContractLine.length === 2 && /^REQ-\d+$/.test(k.Cognomen)
      && k.ContractLine[0].LineTypeId === 300000000099381 && k.ContractLine[1].LineNumber === '2');
    T.eq('the contract number is stamped on the request', JSON.stringify(rest(n.calls)[6].body), '{"contractNumber":"K-2026-0042"}');
    T.eq('then the customer is told and shown the new request',
      n.calls.slice(-2).map((x) => x.toast || x.nav).join(' > '), 'Request Submitted > customer-request');
    T.eq('… with its number and id', JSON.stringify(n.calls[n.calls.length - 1].params), '{"requestId":"EQR-000901","requestNumericId":901}');
    T.eq('the terms tick is used up', n.c.$page.variables.termsAccepted, false);
    T.eq('the cart is emptied and the busy flags cleared', n.c.$page.variables.cart.length + '|' + n.c.$page.variables.isSubmitting + '|' + n.c.$page.variables.isCreatingContract, '0|false|false');
  }
  {
    const n = await runNewSubmit('submit', 'CUSTOMER');
    const o = await runOldSubmit('CUSTOMER');
    T.eq('quoting on: no contract at submit (accepting the quote creates it)',
      seq(n.calls), 'createEquipmentRequest > createShipToSite > patchEquipmentRequest > createRequestLinesBatch > patchEquipmentRequest');
    T.eq('… identical to the old chain', norm(rest(n.calls)), norm(rest(o.calls)));
    T.check('… and the lines carry no price, the quote sets it', rest(n.calls)[3].body.lines.every((l) => l.billRate === null && l.estimatedCost === null && l.priceUom === null));
  }
  {
    const n = await runNewSubmit('submit', 'NONE', 'contract');
    const o = await runOldSubmit('NONE', 'contract');
    T.eq('Fusion refuses the contract: no contract number PATCH, a warning, the request stands',
      seq(n.calls) + ' | ' + n.calls.filter((x) => x.toast).map((x) => x.toast + ':' + x.type).join(', '),
      'createEquipmentRequest > createShipToSite > patchEquipmentRequest > createRequestLinesBatch > patchEquipmentRequest > ProjectLOV/postFscmRestApiResources11_13_18_05Contracts'
      + ' | Contract not created:warning, Request Submitted:confirmation');
    T.eq('… identical to the old chain', norm(rest(n.calls)), norm(rest(o.calls)));
  }
  {
    const n = await runNewSubmit('submit', 'NONE', 'eqp-v1/createRequestLinesBatch');
    const o = await runOldSubmit('NONE', 'eqp-v1/createRequestLinesBatch');
    T.eq('a failed line batch deletes the new header; no status, no contract',
      seq(n.calls), 'createEquipmentRequest > createShipToSite > patchEquipmentRequest > createRequestLinesBatch > deleteEquipmentRequest');
    T.eq('… identical to the old chain (delete with the contact as caller)', norm(rest(n.calls)), norm(rest(o.calls)));
    T.check('… the delete names the portal user', JSON.stringify(rest(n.calls)[4].uriParams) === '{"id":901,"isAdmin":true,"callerUserId":41}');
    T.check('… the cart and the page are kept', n.c.$page.variables.cart.length === 2 && !n.calls.some((x) => x.nav));
  }
  {
    const n = await runNewSubmit('submit', 'NONE', 'eqp-v1/createEquipmentRequest');
    T.eq('a refused header: nothing else is sent', seq(n.calls), 'createEquipmentRequest');
  }
  {
    const n = await runNewSubmit('submit', 'NONE', null, { termsAccepted: false });
    T.check('terms not accepted: nothing is sent, the gate says why', rest(n.calls).length === 0 && n.c.$page.variables.missing.join() === 'Accept the rental terms');
  }
  {
    const n = await runNewSubmit('submit', 'NONE', null, { form: Object.assign({}, FORM, { requestorId: null }) });
    T.check('missing contact: nothing is sent, the field is named', rest(n.calls).length === 0 && n.c.$page.variables.missing.join() === 'Contact');
  }
  {
    const b = backend(answerSubmit());
    const C = newChain('customer-new-request', 'submitChain', b.Actions);
    const c = context(submitPageVars(), nr, { quotes: 'NONE' });
    const s = new C();
    await Promise.all([s.run(c, { mode: 'submit' }), s.run(c, { mode: 'submit' })]);
    T.eq('a double click creates one request and one contract',
      rest(b.calls).filter((x) => x.endpoint === 'eqp-v1/createEquipmentRequest' || x.endpoint === fusion.ENDPOINT).length, 2);
  }

  T.section('save a customer draft: the old Save as Draft (SecondaryActionChain)');
  {
    const n = await runNewSubmit('draft', 'NONE', null, { termsAccepted: false });
    const b = backend(answerSubmit());
    const C = oldChain('request-cart', 'SecondaryActionChain', b.Actions);
    const flow = Object.assign(oldFlowVars(FORM), { CartItemsArray: CART.map((x) => Object.assign({}, x)), requestOrigin: 'customer', fromAgreementId: null, agreementLineIdByEquipmentId: {}, resumeDraft: null });
    await new C().run(context({}, {}, { quotes: 'NONE', flow }), { event: { detail: { secondaryItem: 'saveAsDraft' } } });
    T.eq('draft: header, site, lines as DRAFT; no status, no contract, no terms needed',
      seq(n.calls), 'createEquipmentRequest > createShipToSite > patchEquipmentRequest > createRequestLinesBatch');
    T.eq('… identical to the old Save as Draft', norm(rest(n.calls)), norm(rest(b.calls)));
    T.check('… every line DRAFT', rest(n.calls)[3].body.lines.every((l) => l.lineStatus === 'DRAFT'));
  }
  {
    const n = await runNewSubmit('submit', 'NONE', null, { resume: { id: 555, requestNumber: 'EQR-000555', attribute1: FORM.location, shipToSiteId: 9 } });
    T.eq('a reopened draft is updated in place, its lines replaced, then IN_PROCESS and the contract',
      seq(n.calls), 'patchEquipmentRequest > replaceRequestLinesBatch > patchEquipmentRequest > ProjectLOV/postFscmRestApiResources11_13_18_05Contracts > patchEquipmentRequest');
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('accept the quote: the old AcceptQuoteChain, old and new side by side');
  const QUOTE = { requestNumber: 'EQR-000610', customerName: 'Lone Star Paving LLC', startDate: '2026-11-02', endDate: '2026-11-27', status: 'QUOTE_GENERATED', contractNumber: '',
    grandTotal: 41800, lines: [
      { equipmentName: 'CAT 320 Excavator', equipmentClass: 'Excavators', quantity: 1, startDate: '2026-11-02', endDate: '2026-11-27', billRate: 1400, priceUom: 'DAY', lineTotal: 36400 },
      { equipmentName: 'Light tower', equipmentClass: '', quantity: 2, startDate: '2026-11-05', endDate: '2026-11-27', billRate: 2700, priceUom: 'WEEK', lineTotal: 5400 }] };
  const answerAccept = (fail) => (o) => {
    if (o.endpoint === fusion.ENDPOINT) return fail === 'contract' ? { ok: false, status: 500, body: {} } : { ok: true, status: 201, body: { ContractNumber: 'K-2026-0610' } };
    if (o.endpoint === 'eqp-v1/getPurchaseRequisitions') return { ok: true, body: { data: [{ eqrRequestLineId: 62 }] } };
    if (o.endpoint === 'eqp-v1/getCurrentQuoteLines') return { ok: true, body: [{ requestLineId: 61, quotedRate: 1300, quotedUom: 'DAY', quotedLineTotal: 33800, quotedQty: 1, billFrequency: 'MONTHLY', rateOverriddenFlag: 'Y' }] };
    if (o.endpoint === 'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2') return { ok: true, body: { data: [
      { id: 61, lineStatus: 'QUOTE_GENERATED' }, { id: 62, lineStatus: 'QUOTE_GENERATED' }, { id: 63, lineStatus: 'ALLOCATED' }] } };
    if (fail === o.endpoint) return { ok: false, status: 500, body: {} };
    return null;
  };
  async function runAccept(which, fail) {
    const b = backend(answerAccept(fail));
    const C = which === 'old' ? oldChain('customer-quote', 'AcceptQuoteChain', b.Actions) : newChain('customer-quote', 'acceptQuoteChain', b.Actions);
    const c = context({ quoteData: JSON.parse(JSON.stringify(QUOTE)), requestNumericId: 610, requestId: 'EQR-000610', isAccepting: false }, quote, { quotes: 'CUSTOMER' });
    await new C().run(c);
    return { calls: b.calls, c };
  }
  {
    const n = await runAccept('new');
    const o = await runAccept('old');
    T.eq('contract, header, PRs, quote lines, lines, one batch, quote accepted',
      seq(n.calls), 'ProjectLOV/postFscmRestApiResources11_13_18_05Contracts > patchEquipmentRequest > getPurchaseRequisitions > getCurrentQuoteLines > getEquipriteV1EquipmentRequestsRequestIdLines2 > patchRequestLinesBatch > acceptCurrentQuote');
    T.eq('… every call identical to the old AcceptQuoteChain (bodies included)', norm(rest(n.calls)), norm(rest(o.calls)));
    const k = rest(n.calls)[0].body;
    T.eq('contract body: the request number, dates, the quoted total, then the fixed values',
      [k.Cognomen, k.StartDate, k.EndDate, k.EstimatedAmount, k.LegalEntityName, k.PartyName].join(' | '), 'EQR-000610 | 2026-11-02 | 2026-11-27 | 41800 | EPC UAE | Stark Industries');
    T.eq('contract lines name the equipment and class', k.ContractLine.map((l) => l.ItemDescription).join(' / '), 'CAT 320 Excavator - Excavators / Light tower');
    T.eq('header: QUOTE_ACCEPTED with the Fusion contract number', JSON.stringify(rest(n.calls)[1].body), '{"status":"QUOTE_ACCEPTED","contractNumber":"K-2026-0610"}');
    const batch = rest(n.calls)[5].body.lines;
    T.eq('lines: the quoted price stamped; a PR line goes UNDER_PROCUREMENT; an allocated line is left alone',
      JSON.stringify(batch), JSON.stringify([
        { id: 61, lineStatus: 'QUOTE_ACCEPTED', billRate: 1300, priceUom: 'DAY', estimatedCost: 33800, quantity: 1, billFrequency: 'MONTHLY', rateOverriddenFlag: 'Y' },
        { id: 62, lineStatus: 'UNDER_PROCUREMENT' }]));
    T.eq('quote/accept for the request', JSON.stringify(rest(n.calls)[6].uriParams), '{"requestId":610}');
    T.eq('then a confirmation and the request page', n.calls.slice(-2).map((x) => x.toast ? x.type : x.nav).join(' > '), 'confirmation > customer-request');
    T.eq('the button is free again', n.c.$page.variables.isAccepting, false);
  }
  {
    const n = await runAccept('new', 'contract');
    const o = await runAccept('old', 'contract');
    T.eq('Fusion refuses: nothing else is written, an error is shown, the page stays',
      seq(n.calls) + ' | ' + n.calls.filter((x) => x.toast).map((x) => x.type).join() + ' | ' + (n.calls.some((x) => x.nav) ? 'navigated' : 'stayed'),
      'ProjectLOV/postFscmRestApiResources11_13_18_05Contracts | error | stayed');
    T.eq('… identical to the old chain', norm(rest(n.calls)), norm(rest(o.calls)));
    T.eq('… and the button is free again', n.c.$page.variables.isAccepting, false);
  }
  {
    const n = await runAccept('new', 'eqp-v1/patchRequestLinesBatch');
    T.check('a failed line cascade does not undo the accept (the contract exists): quote still marked accepted',
      seq(n.calls).endsWith('patchRequestLinesBatch > acceptCurrentQuote') && n.calls.some((x) => x.toast && x.type === 'confirmation'));
  }
  {
    const b = backend(answerAccept());
    const C = newChain('customer-quote', 'acceptQuoteChain', b.Actions);
    const c = context({ quoteData: JSON.parse(JSON.stringify(QUOTE)), requestNumericId: 610, isAccepting: false }, quote);
    const s = new C();
    await Promise.all([s.run(c), s.run(c)]);
    T.eq('a double click creates one contract', rest(b.calls).filter((x) => x.endpoint === fusion.ENDPOINT).length, 1);
  }

  T.section('the quote page reads (old QuoteInitChain)');
  {
    const answerQ = (o) => {
      if (o.endpoint === 'eqp-v1/getEquipriteV1ViewsCustomerRequestDetails') return { ok: true, body: { data: [
        { requestNumber: 'EQR-000609', eqrEquipmentRequestId: 609 }, { requestNumber: 'EQR-000610', eqrEquipmentRequestId: 610, customerName: 'Lone Star Paving LLC', requestStatus: 'QUOTE_GENERATED', startDate: '2026-11-02T00:00:00Z', endDate: '2026-11-27T00:00:00Z' }] } };
      if (o.endpoint === 'eqp-v1/getEquipriteV1ViewsCustomerMyRequests') return { ok: true, body: { data: [
        { eqrEquipmentRequestId: 610, requestNumber: 'EQR-000610' }, { eqrEquipmentRequestId: 610, requestNumber: 'EQR-000610', quoteDocument: Buffer.from('%PDF-1.4 quote').toString('base64'), quoteFileName: 'Q-610.pdf' }] } };
      if (o.endpoint === 'eqp-v1/getEquipriteV1ViewsRequestDetailLines') return { ok: true, body: { data: [
        { equipmentName: 'CAT 320 Excavator', className: 'Excavators', quantity: 1, startDate: '2026-11-02', endDate: '2026-11-27', billRate: 1400, priceUom: 'DAY' },
        { equipmentName: 'Light tower', quantity: 2, startDate: '2026-11-05', endDate: '2026-11-27', billRate: 2700, priceUom: 'WEEK' }] } };
      return null;
    };
    const run = async (which) => {
      const b = backend(answerQ);
      const C = which === 'old' ? oldChain('customer-quote', 'QuoteInitChain', b.Actions) : newChain('customer-quote', 'quoteInitChain', b.Actions);
      const c = context({ requestId: 'EQR-000610', requestNumericId: null, quoteData: {}, isLoading: true, hasQuoteDoc: false, acceptAllowed: false }, quote);
      await new C().run(c);
      return { calls: b.calls, v: c.$page.variables };
    };
    const n = await run('new');
    const o = await run('old');
    T.eq('reads: request header, quote document, lines', seq(n.calls), 'getEquipriteV1ViewsCustomerRequestDetails > getEquipriteV1ViewsCustomerMyRequests > getEquipriteV1ViewsRequestDetailLines');
    T.eq('… identical to the old chain', norm(rest(n.calls)), norm(rest(o.calls)));
    T.eq('… the same quote data (lines and total)', JSON.stringify(n.v.quoteData), JSON.stringify(o.v.quoteData));
    T.eq('grand total: daily line × days + weekly line as quoted', n.v.quoteData.grandTotal, 1400 * 26 + 2700 * 2);
    T.check('the PDF is there, accept allowed (ENABLE_QUOTES=CUSTOMER), the numeric id resolved', n.v.hasQuoteDoc && n.v.acceptAllowed && n.v.requestNumericId === 610 && n.v.quotePdfUrl === 'blob:quote-pdf');
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('request page: reads, the on-entry DEPLOYED reconcile, line actions (old customer chains)');
  const detailPage = () => page('customer-request');
  const HEADER_ROWS = [{ requestNumber: 'EQR-000700', eqrEquipmentRequestId: 700, customerName: 'Lone Star Paving LLC', customerContact: 'Maria Torres', requestStatus: 'IN_PROCESS', startDate: '2026-11-02', endDate: '2026-11-27', contractNumber: 'K-700' }];
  const linesAnswer = (lines, header) => (o) => {
    if (o.endpoint === 'eqp-v1/getEquipriteV1ViewsCustomerRequestDetails') return { ok: true, body: { data: header || HEADER_ROWS } };
    if (o.endpoint === 'eqp-v1/getEquipriteV1ViewsRequestDetailLines') return { ok: true, body: { data: lines } };
    if (o.endpoint === 'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2') return { ok: true, body: { data: lines.map((l) => ({ id: Number(l.lineId), lineStatus: l.after || l.lineStatus })) } };
    return null;
  };
  async function runInit(which, lines, header) {
    const b = backend(linesAnswer(lines, header));
    const pm = detailPage();
    const C = which === 'old' ? oldChain('customer-request-detail', 'initChain', b.Actions) : newChain('customer-request', 'initChain', b.Actions);
    const c = context({ requestId: 'EQR-000700', requestNumericId: 700, formData: {}, dataGridProvider: [], selectionTick: 0 }, pm);
    await new C().run(c, { requestId: 'EQR-000700', requestNumericId: 700 });
    return { calls: b.calls, v: c.$page.variables, pm };
  }
  {
    const L = [{ lineId: 1, equipmentName: 'Excavator', lineStatus: 'DEPLOYED' }, { lineId: 2, equipmentName: 'Cones', lineStatus: 'CONSUMED', consumableFlag: 'Y' }];
    const n = await runInit('new', L);
    const o = await runInit('old', L);
    T.eq('every line on site, header behind: reconcile to DEPLOYED', seq(n.calls), 'getEquipriteV1ViewsCustomerRequestDetails > getEquipriteV1ViewsRequestDetailLines > patchEquipmentRequest');
    T.eq('… identical to the old page', norm(rest(n.calls)), norm(rest(o.calls)));
    T.eq('… and the page shows DEPLOYED', n.v.formData.status, 'DEPLOYED');
    T.eq('contract number from the header row', n.v.formData.contractNumber, 'K-700');
    const closed = await runInit('new', L, [Object.assign({}, HEADER_ROWS[0], { requestStatus: 'CLOSED' })]);
    T.eq('a CLOSED request is never dragged back', seq(closed.calls), 'getEquipriteV1ViewsCustomerRequestDetails > getEquipriteV1ViewsRequestDetailLines');
    const mixed = await runInit('new', [{ lineId: 1, lineStatus: 'SHIP_TO_SITE' }, { lineId: 2, lineStatus: 'DEPLOYED' }]);
    T.eq('not all on site: reads only', seq(mixed.calls), 'getEquipriteV1ViewsCustomerRequestDetails > getEquipriteV1ViewsRequestDetailLines');
    T.check('only DEPLOYED lines are returnable', mixed.v.dataGridProvider.map((l) => l.isReturnable).join() === 'false,true');
  }
  const SHIP = [
    { lineId: '11', equipmentName: 'Excavator', lineStatus: 'SHIP_TO_SITE', quantity: 1, consumableFlag: 'N' },
    { lineId: '12', equipmentName: 'Cones', lineStatus: 'SHIP_TO_SITE', quantity: 40, consumableFlag: 'Y', autoConsumeFlag: 'N' },
    { lineId: '13', equipmentName: 'Roller', lineStatus: 'DEPLOYED', quantity: 1 },
  ];
  async function runLineAction(which, chainOld, chainNew, lines, tick, fail) {
    const b = backend((o) => (fail === o.endpoint ? { ok: false, status: 409, body: { message: 'conflict' } } : null));
    const pm = detailPage();
    pm.initGridData(lines.map((l) => Object.assign({ isReturnable: l.lineStatus === 'DEPLOYED' }, l)));
    (tick || []).forEach((i) => pm.setRowSelected(i, true));
    const C = which === 'old' ? oldChain('customer-request-detail', chainOld, b.Actions) : newChain('customer-request', chainNew, b.Actions);
    const c = context({ requestId: 'EQR-000700', requestNumericId: 700, formData: { status: 'IN_PROCESS' }, selectionState: {}, selectionTick: 0 }, pm);
    await new C().run(c);
    return { calls: b.calls, v: c.$page.variables };
  }
  {
    const n = await runLineAction('new', 'acceptDeliveryChain', 'acceptDeliveryChain', SHIP, []);
    const o = await runLineAction('old', 'acceptDeliveryChain', 'acceptDeliveryChain', SHIP, []);
    T.eq('accept with nothing ticked: every arrived line, one batch, then the header', seq(n.calls), 'patchRequestLinesBatch > patchEquipmentRequest');
    T.eq('… identical to the old customer acceptDeliveryChain', norm(rest(n.calls)), norm(rest(o.calls)));
    T.eq('rental → DEPLOYED, consumable → DELIVERED with its delivered quantity',
      JSON.stringify(rest(n.calls)[0].body.lines), JSON.stringify([{ id: 11, lineStatus: 'DEPLOYED' }, { id: 12, lineStatus: 'DELIVERED', deliveredQuantity: 40 }]));
    T.check('… with the audit header', JSON.stringify(rest(n.calls)[0].headers) === '{"X-User-Id":"maria.torres"}');
    T.eq('all on site now: header DEPLOYED', JSON.stringify(rest(n.calls)[1].body), '{"status":"DEPLOYED"}');
    T.check('the page refreshes itself (no browser reload) and clears the ticks',
      n.calls.some((x) => x.chain === 'initChain') && n.v.selectionState.count === 0);
    const one = await runLineAction('new', 'acceptDeliveryChain', 'acceptDeliveryChain', SHIP, [0]);
    T.eq('accept the ticked line only: no header change while another is still arriving',
      seq(one.calls) + ' ' + JSON.stringify(rest(one.calls)[0].body.lines), 'patchRequestLinesBatch [{"id":11,"lineStatus":"DEPLOYED"}]');
    const failed = await runLineAction('new', 'acceptDeliveryChain', 'acceptDeliveryChain', SHIP, [], 'eqp-v1/patchRequestLinesBatch');
    T.eq('a refused batch: no header change, an error', seq(failed.calls) + ' | ' + failed.calls.filter((x) => x.toast).map((x) => x.toast).join(), 'patchRequestLinesBatch | Accept failed');
  }
  {
    const n = await runLineAction('new', 'rejectDeliveryChain', 'rejectDeliveryChain', SHIP, [0, 1]);
    const o = await runLineAction('old', 'rejectDeliveryChain', 'rejectDeliveryChain', SHIP, [0, 1]);
    T.eq('refuse the ticked arrived lines: REJECTED (the customer copy of the old chain)', JSON.stringify(rest(n.calls)[0].body.lines),
      JSON.stringify([{ id: 11, lineStatus: 'REJECTED' }, { id: 12, lineStatus: 'REJECTED' }]));
    T.eq('… identical to the old customer rejectDeliveryChain', norm(rest(n.calls)), norm(rest(o.calls)));
    const failed = await runLineAction('new', 'rejectDeliveryChain', 'rejectDeliveryChain', SHIP, [0], 'eqp-v1/patchRequestLinesBatch');
    T.check('a refused batch: an error and no refresh', failed.calls.some((x) => x.toast === 'Rejection failed') && !failed.calls.some((x) => x.chain));
  }
  {
    const RET = [{ lineId: '13', equipmentName: 'Roller', lineStatus: 'DEPLOYED', after: 'RETURN_INITIATED' }, { lineId: '14', lineStatus: 'CLOSED' }];
    const run = async (which) => {
      const b = backend(linesAnswer(RET));
      const pm = detailPage();
      pm.initGridData(RET.map((l) => Object.assign({ isReturnable: l.lineStatus === 'DEPLOYED' }, l)));
      pm.setRowSelected(0, true);
      const C = which === 'old' ? oldChain('customer-request-detail', 'InitiateReturnChain', b.Actions) : newChain('customer-request', 'initiateReturnChain', b.Actions);
      await new C().run(context({ requestId: 'EQR-000700', requestNumericId: 700, formData: { status: 'DEPLOYED' } }, pm));
      return b.calls;
    };
    const n = await run('new');
    const o = await run('old');
    T.eq('start the return: RETURN_INITIATED, then the lines are read back for the close rollup',
      seq(n) + ' ' + JSON.stringify(rest(n)[0].body.lines), 'patchRequestLinesBatch > getEquipriteV1EquipmentRequestsRequestIdLines2 [{"id":13,"lineStatus":"RETURN_INITIATED"}]');
    T.eq('… identical to the old customer InitiateReturnChain', norm(rest(n)), norm(rest(o)));
  }
  {
    const run = async (which, action) => {
      const b = backend();
      const C = which === 'old' ? oldChain('customer-request-detail', 'draftActionChain', b.Actions) : newChain('customer-request', 'draftActionChain', b.Actions);
      const c = context({ requestNumericId: 800, requestId: 'EQR-000800', isDraftBusy: false, formData: { requestNumber: 'EQR-000800', status: 'DRAFT' } }, detailPage());
      await new C().run(c, { action });
      return b.calls;
    };
    const n = await run('new', 'delete');
    const o = await run('old', 'delete');
    T.eq('delete a draft: the same DELETE as the old page (no caller id, as its form has none)', norm(rest(n)), norm(rest(o)));
    T.eq('… DELETE /equipment-requests/800?isAdmin=true', JSON.stringify(rest(n)[0].uriParams), '{"id":800,"isAdmin":true}');
    T.eq('… then back to My requests', n[n.length - 1].nav, 'customer-requests');
    const edit = await run('new', 'submit');
    T.eq('send a draft: reopened on Review in New request (customer)', JSON.stringify(edit[edit.length - 1]), '{"nav":"customer-new-request","params":{"draftId":800,"startStep":3}}');
  }
  {
    const pm = detailPage();
    pm.initGridData(SHIP);
    T.eq('select the arrived items', pm.selectByStatus('SHIP_TO_SITE') + ' ' + pm.getSelectionStateRaw().allShipToSite, '2 true');
    T.eq('rate with its unit', pm.rateText({ billRate: 1400, priceUom: 'DAILY' }) + ' | ' + pm.rateText({ billRate: '' }), '$1,400 / DAY | —');
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('reads of home, lists and billing: the old chains\' calls');
  const REQS = [
    { eqrEquipmentRequestId: 1, requestNumber: 'REQ-1', requestStatus: 'IN_PROCESS', customerName: 'Lone Star Paving', createdDate: '2026-10-25T10:00:00Z' },
    { eqrEquipmentRequestId: 2, requestNumber: 'REQ-2', requestStatus: 'QUOTE_GENERATED', customerName: 'Lone Star Paving', createdDate: '2026-10-26T10:00:00Z' },
    { eqrEquipmentRequestId: 3, requestNumber: 'REQ-3', requestStatus: 'QUOTE_ACCEPTED', customerName: 'Lone Star Paving', contractNumber: 'K-3', createdDate: '2026-10-20T10:00:00Z' },
    { eqrEquipmentRequestId: 4, requestNumber: 'REQ-4', requestStatus: 'CLOSED', customerName: 'Lone Star Paving', contractNumber: 'K-4', createdDate: '2026-09-01T10:00:00Z' },
  ];
  const answerHome = (o) => {
    if (o.endpoint === 'eqp-v1/getEquipriteV1ViewsCustomerMyRequests') return { ok: true, body: { data: REQS } };
    if (o.endpoint === 'eqp-v1/getEquipriteV1ViewsCustomerMyBilling') return { ok: true, body: { data: INV } };
    if (o.endpoint === 'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2') {
      return { ok: true, body: { data: o.uriParams.requestId === 1 ? [{ lineStatus: 'DEPLOYED' }, { lineStatus: 'SHIP_TO_SITE' }] : [{ lineStatus: 'DEPLOYED' }, { lineStatus: 'DEPLOYED' }] } };
    }
    return null;
  };
  {
    const runH = async (which) => {
      const b = backend(answerHome);
      const C = which === 'old' ? oldChain('customer-dashboard', 'CustomerDashboardInitChain', b.Actions) : newChain('customer-home', 'homeInitChain', b.Actions);
      const c = context({ kpis: {}, todo: [], recent: [], onSite: [] }, home);
      await new C().run(c);
      return { calls: b.calls, v: c.$page.variables };
    };
    const n = await runH('new');
    const o = await runH('old');
    T.eq('home: the old dashboard\'s reads, in its order', norm(rest(n.calls)), norm(rest(o.calls)));
    T.eq('… lines only for IN_PROCESS / QUOTE_ACCEPTED requests', rest(n.calls).filter((x) => x.uriParams.requestId).map((x) => x.uriParams.requestId).join(), '1,3');
    T.eq('active and on-site counts equal the old tiles', n.v.kpis.active + '/' + n.v.kpis.onSite, o.v.activeRequestsCount + '/' + o.v.onSiteCount);
    T.eq('next for you: the quote, then the arrived delivery', n.v.todo.map((t) => t.kind + ':' + t.requestNumber).join(), 'quote:REQ-2,delivery:REQ-1,invoice:');
    T.eq('invoices to pay: the billing rules, not the raw PENDING count', n.v.kpis.toPay + ' (old tile counted ' + o.v.pendingInvoicesCount + ')', (16180 + 2240 - 240 + 500) + ' (old tile counted 0)');
    T.eq('one customer named in the band', n.v.customerName, 'Lone Star Paving');
    T.eq('latest ten, newest first', n.v.recent.map((r) => r.id).join(), '2,1,3,4');
    const b = backend((o) => (o.endpoint === 'eqp-v1/getEquipriteV1ViewsCustomerMyRequests'
      ? { ok: true, body: { data: [{ eqrEquipmentRequestId: 9, requestNumber: 'REQ-9', requestStatus: 'DEPLOYED' }] } } : answerHome(o)));
    const c = context({ kpis: {}, todo: [], recent: [], onSite: [] }, home);
    await new (newChain('customer-home', 'homeInitChain', b.Actions))().run(c);
    T.eq('a DEPLOYED request\'s lines are read too, so its equipment counts as on site (the old tile skipped it)',
      rest(b.calls).filter((x) => x.uriParams.requestId).map((x) => x.uriParams.requestId).join() + ' / ' + c.$page.variables.kpis.onSite, '9 / 2');
  }
  {
    const runL = async (which) => {
      const b = backend(answerHome);
      const C = which === 'old' ? oldChain('customer-my-requests', 'EquipmentRequestInitChain', b.Actions) : newChain('customer-requests', 'loadRequestsChain', b.Actions);
      const c = context({ allRows: [], RequestAllArray: [] }, reqPage);
      await new C().run(c);
      return { calls: b.calls, v: c.$page.variables };
    };
    const n = await runL('new');
    const o = await runL('old');
    T.eq('my requests: the old list\'s read', norm(rest(n.calls)), norm(rest(o.calls)));
    T.eq('… the same rows (newest first here)', JSON.stringify(n.v.allRows.slice().sort((a, b) => a.id - b.id)), JSON.stringify(o.v.RequestAllArray));
  }
  {
    const b = backend(answerHome);
    const C = newChain('customer-billing', 'billingInitChain', b.Actions);
    const c = context({ billed: [], invoices: [], summary: {} }, billPage);
    await new C().run(c);
    const ob = backend(answerHome);
    const OC = oldChain('customer-my-billing', 'BilledRequestInitChain', ob.Actions);
    const oc = context({}, {});
    await new OC().run(oc);
    T.eq('billing: the old billed-requests read, then the invoices', seq(b.calls), 'getEquipriteV1ViewsCustomerMyRequests > getEquipriteV1ViewsCustomerMyBilling');
    T.eq('… the requests read is the old one', norm(rest(b.calls)[0]), norm(rest(ob.calls)[0]));
    T.eq('… the same billed requests (with a contract)', c.$page.variables.billed.map((r) => r.id).join(), oc.$page.variables.RequestAllArray.map((r) => r.id).join());
    T.eq('… the invoices read is the old billing detail\'s', JSON.stringify(rest(b.calls)[1].uriParams), '{"page":0,"size":10000}');
    T.eq('… balance due over every invoice', c.$page.variables.summary.outstandingAmount, 16180 + 2240 - 240 + 500);
  }
  {
    const answerInv = (o) => {
      if (o.endpoint === 'eqp-v1/getEquipriteV1ViewsCustomerRequestDetails') return { ok: true, body: { data: [{ requestNumber: 'REQ-30', eqrEquipmentRequestId: 30, contractNumber: 'K-30' }] } };
      if (o.endpoint === 'eqp-v1/getEquipriteV1ViewsRequestDetailLines') return { ok: true, body: { data: [{ lineId: 301, equipmentName: 'Excavator' }, { lineId: 302, equipmentName: 'Truck' }] } };
      if (o.endpoint === 'eqp-v1/getEquipriteV1ViewsCustomerMyBilling') return { ok: true, body: { data: INV } };
      return null;
    };
    const b = backend(answerInv);
    const C = newChain('customer-invoice', 'invoiceInitChain', b.Actions);
    const c = context({ requestId: 'REQ-30', requestNumericId: null, lines: [], totals: {} }, page('customer-invoice'));
    await new C().run(c, { requestId: 'REQ-30' });
    const ob = backend(answerInv);
    const OC = oldChain('customer-billing-detail', 'BillingDetailInitChain', ob.Actions);
    const oc = context({ requestId: 'REQ-30' }, {});
    await new OC().run(oc, { requestId: 'REQ-30' });
    T.eq('invoices of a request: the old billing detail\'s reads, in its order', norm(rest(b.calls)), norm(rest(ob.calls)));
    const v = c.$page.variables;
    const ov2 = oc.$page.variables;
    T.eq('… the same totals as the old banner', [v.totals.totalInvoiced, v.totals.paidAmount, v.totals.outstandingAmount, v.totals.lastInvoiceLabel, v.totals.netAdjustment].join(' | '),
      [ov2.totalInvoiced, ov2.paidAmount, ov2.outstandingAmount, ov2.lastInvoiceLabel, ov2.netAdjustment].join(' | '));
    T.eq('… invoices grouped per line, first line open', v.lines.map((l) => l.lineId + ':' + l.invoiceCount + (l.expanded ? '+' : '')).join(), '301:2+,302:3');
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('guards');
  {
    const b = backend();
    const C = newChain('customer-home', 'customersModuleGuardChain', b.Actions);
    await new C().run(context({}, {}, { flags: { CUSTOMERS_MODULE_ENABLED: 'false' } }));
    T.eq('Customers module off: a warning, then Home', b.calls.map((x) => x.toast || x.nav).join(' > '), 'Module unavailable > home/home');
    const b2 = backend();
    await new (newChain('customer-home', 'customersModuleGuardChain', b2.Actions))().run(context({}, {}));
    T.eq('module on: nothing happens', b2.calls.length, 0);
    const b3 = backend();
    await new (newChain('customer-billing', 'billingGuardChain', b3.Actions))().run(context({}, {}, { flags: { EXTERNAL_PROJECT_ASSIGN_ENABLED: 'true' } }));
    T.eq('billing withdrawn while external requests bill through a project', b3.calls.map((x) => x.toast || x.nav).join(' > '), 'Billing unavailable > customer-home');
    const b4 = backend();
    await new (newChain('customer-home', 'goChain', b4.Actions))().run(context({}, {}, { flags: { EXTERNAL_PROJECT_ASSIGN_ENABLED: 'true' } }), { page: 'customer-billing' });
    T.eq('… and no link opens it', b4.calls.length, 0);
    const b5 = backend();
    await new (newChain('customer-home', 'goChain', b5.Actions))().run(context({}, {}), { page: 'customer-request', id: '7', number: 'REQ-7' });
    T.eq('a link carries the request as the old pages did', JSON.stringify(b5.calls[0]), '{"nav":"customer-request","params":{"requestNumericId":7,"requestId":"REQ-7"}}');
    const b6 = backend();
    await new (newChain('customer-home', 'goChain', b6.Actions))().run(context({}, {}), { page: 'workbench' });
    T.eq('only portal pages', b6.calls.length, 0);
  }

  T.section('menu: the portal item');
  const it = app.navItem('customer-portal');
  T.eq('built: opens the new home', it.status + ' ' + JSON.stringify(it.route), 'new {"flow":"customer","page":"customer-home"}');
  T.check('keeps the Old link', app.oldAppLink('http://x/', 'customer-portal') === 'http://x/vp/shell/customer-portal/customer-dashboard');
  const flowJson = JSON.parse(fs.readFileSync(path.join(NEW, 'flows', 'customer', 'customer-flow.json'), 'utf8'));
  T.eq('every page of the flow belongs to the item (highlight and page guard)',
    Object.keys(flowJson.pages).filter((p) => app.getNavIdForPage({ id: p }) !== 'customer-portal').join(), '');
  T.eq('… and is gated by the portal\'s page code', app.getPageCodeForPage({ id: 'customer-quote' }), 'EQR_CUST_DASHBOARD');
  T.check('a customer-only role sees the item', app.visibleNavGroups(CUSTOMER_ACCESS, true, FLAGS, true, {}).some((g) => g.items.some((i) => i.id === 'customer-portal')));
  const guardSrc = fs.readFileSync(path.join(NEW, 'flows', 'request', 'pages', 'my-requests-page-chains', 'enforcePageAccessChain.js'), 'utf8');
  Object.keys(flowJson.pages).forEach((p) => {
    T.check(`${p}: page id prefixed, enforcePageAccessChain byte-identical`, p.indexOf('customer-') === 0
      && fs.readFileSync(path.join(FLOW, p + '-page-chains', 'enforcePageAccessChain.js'), 'utf8') === guardSrc);
  });

  T.section('every page function the chains call exists in that page module');
  Object.keys(flowJson.pages).forEach((p) => {
    const pm = page(p);
    const used = new Set();
    fs.readdirSync(path.join(FLOW, p + '-page-chains')).forEach((f) => {
      (fs.readFileSync(path.join(FLOW, p + '-page-chains', f), 'utf8').match(/\$page\.functions\.([a-zA-Z]+)/g) || []).forEach((m) => used.add(m.split('.').pop()));
    });
    const html = fs.readFileSync(path.join(FLOW, p + '-page.html'), 'utf8');
    (html.match(/\$functions\.([a-zA-Z]+)/g) || []).forEach((m) => used.add(m.split('.').pop()));
    const missing = [...used].filter((fn) => typeof pm[fn] !== 'function');
    T.check(`${p}: ${used.size} function(s) found`, !missing.length, missing.join(', '));
  });

  T.section('every endpoint the flow calls exists in services/');
  const ops = {};
  ['eqp-v1', 'bipService', 'ProjectLOV'].forEach((svc) => {
    const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'services', svc, 'openapi3.json'), 'utf8'));
    Object.values(spec.paths || {}).forEach((p) => Object.values(p).forEach((op) => { if (op && op.operationId) ops[svc + '/' + op.operationId] = true; }));
  });
  const used = new Set([fusion.ENDPOINT]);
  fs.readdirSync(FLOW, { recursive: true }).filter((f) => f.endsWith('.js')).forEach((f) => {
    (fs.readFileSync(path.join(FLOW, f), 'utf8').match(/endpoint:\s*'([^']+)'/g) || []).forEach((m) => used.add(m.replace(/endpoint:\s*'/, '').replace("'", '')));
  });
  [...used].sort().forEach((e) => T.check(e, !!ops[e]));

  T.report();
})().catch((e) => { console.error(e); T.check('suite ran', false, e && e.stack); T.report(); });
