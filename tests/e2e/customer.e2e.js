'use strict';
/*
 * The customer portal in a real browser, signed in as a customer (session role CUSTOMER, customer page codes only):
 * home, requests, tracking and accepting a delivery, the quote accepted (contract created), billing, invoices, the
 * rental contract, and a customer request raised with customer quoting off (contract created at submit).
 * Needs `npm run build`. Run: node tests/e2e/customer.e2e.js   (screenshots: E2E_SHOTS, else the OS temp folder)
 */
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const PDF = Buffer.from('%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj '
  + '3 0 obj<</Type/Page/MediaBox[0 0 300 144]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF').toString('base64');

let quotes = 'CUSTOMER';
const FLAGS = ['PROJECTS_MODULE_ENABLED', 'CUSTOMERS_MODULE_ENABLED'];
const REQS = [
  { eqrEquipmentRequestId: 700, requestNumber: 'EQR-000700', requestStatus: 'IN_PROCESS', customerName: 'Lone Star Paving LLC', customerContact: 'Maria Torres',
    startDate: '2026-11-02T00:00:00Z', endDate: '2026-11-27T00:00:00Z', lines: 3, createdDate: '2026-10-25T09:00:00Z', contractNumber: 'K-2026-0700' },
  { eqrEquipmentRequestId: 610, requestNumber: 'EQR-000610', requestStatus: 'QUOTE_GENERATED', customerName: 'Lone Star Paving LLC', customerContact: 'Maria Torres',
    startDate: '2026-11-04T00:00:00Z', endDate: '2026-11-30T00:00:00Z', lines: 2, createdDate: '2026-10-27T09:00:00Z', quoteDocument: PDF, quoteFileName: 'Quote-610.pdf' },
  { eqrEquipmentRequestId: 520, requestNumber: 'EQR-000520', requestStatus: 'DEPLOYED', customerName: 'Lone Star Paving LLC', customerContact: 'Maria Torres',
    startDate: '2026-10-06T00:00:00Z', endDate: '2026-11-12T00:00:00Z', lines: 2, createdDate: '2026-10-01T09:00:00Z', contractNumber: 'K-2026-0520' },
  { eqrEquipmentRequestId: 377, requestNumber: 'EQR-000377', requestStatus: 'CLOSED', customerName: 'Lone Star Paving LLC', customerContact: 'Maria Torres',
    startDate: '2026-09-02T00:00:00Z', endDate: '2026-09-27T00:00:00Z', lines: 1, createdDate: '2026-08-28T09:00:00Z', contractNumber: 'K-2026-0377' },
];
const LINES = {
  700: [
    { lineId: 7001, equipmentName: 'CAT 320 Excavator', className: 'Excavators', quantity: 1, lineStatus: 'SHIP_TO_SITE', startDate: '2026-11-02', endDate: '2026-11-27', billRate: 1400, priceUom: 'DAY', consumableFlag: 'N' },
    { lineId: 7002, equipmentName: 'Dump truck 30 t', className: 'Trucks', quantity: 1, lineStatus: 'SHIP_TO_SITE', startDate: '2026-11-02', endDate: '2026-11-27', billRate: 950, priceUom: 'DAY', consumableFlag: 'N' },
    { lineId: 7003, equipmentName: 'Roller 10 t', className: 'Compaction', quantity: 1, lineStatus: 'PICK_RELEASED', startDate: '2026-11-02', endDate: '2026-11-27', billRate: 700, priceUom: 'DAY' },
  ],
  610: [
    { lineId: 6101, equipmentName: 'Light tower', className: 'Lighting', quantity: 4, lineStatus: 'QUOTE_GENERATED', startDate: '2026-11-04', endDate: '2026-11-30', billRate: 45, priceUom: 'DAY' },
    { lineId: 6102, equipmentName: 'Mini excavator 3.5 t', className: 'Excavators', quantity: 1, lineStatus: 'QUOTE_GENERATED', startDate: '2026-11-04', endDate: '2026-11-30', billRate: 2100, priceUom: 'WEEK', estimatedCost: 8400 },
  ],
  520: [
    { lineId: 5201, equipmentName: 'Excavator 20 t', className: 'Excavators', quantity: 2, lineStatus: 'DEPLOYED', startDate: '2026-10-06', endDate: '2026-11-12', billRate: 1100, priceUom: 'DAY', estimatedCost: 83600 },
    { lineId: 5202, equipmentName: 'Dump truck 30 t', className: 'Trucks', quantity: 1, lineStatus: 'DEPLOYED', startDate: '2026-10-06', endDate: '2026-11-12', billRate: 950, priceUom: 'DAY', estimatedCost: 36100 },
  ],
  377: [{ lineId: 3771, equipmentName: 'Mini excavator 3.5 t', className: 'Excavators', quantity: 1, lineStatus: 'CLOSED', startDate: '2026-09-02', endDate: '2026-09-27', billRate: 160, priceUom: 'DAY', estimatedCost: 4000 }],
};
const INVOICES = [
  { eqrBillingTransactionId: 1, eqrEquipmentRequestId: 520, eqrRequestLineId: 5201, invoiceNumber: 'INV-30871', status: 'PAID', grossAmount: 12140, billingPeriodStart: '2026-10-06', billingPeriodEnd: '2026-10-31', dueDate: '2026-11-15', transactionDate: '2026-10-31' },
  { eqrBillingTransactionId: 2, eqrEquipmentRequestId: 520, eqrRequestLineId: 5202, invoiceNumber: 'INV-30902', status: 'POSTED', grossAmount: 6180, billingPeriodStart: '2026-10-06', billingPeriodEnd: '2026-10-31', dueDate: '2026-11-15', transactionDate: '2026-10-31' },
  { eqrBillingTransactionId: 3, eqrEquipmentRequestId: 377, eqrRequestLineId: 3771, invoiceNumber: 'INV-30888', status: 'POSTED', grossAmount: 2240, billingPeriodStart: '2026-09-02', billingPeriodEnd: '2026-09-27', dueDate: '2026-10-11', transactionDate: '2026-09-27' },
];
const CATALOG = [
  { eqrEquipmentMasterId: 11, equipmentName: 'CAT 320 Excavator', className: 'Excavators', eqrEquipmentClassId: 1, isRentable: true, rate: 1400, rateUom: 'DAY', periodAmount: 1400, periodType: 'DAILY' },
  { eqrEquipmentMasterId: 12, equipmentName: 'Mini Excavator 3.5t', className: 'Excavators', eqrEquipmentClassId: 1, isRentable: true, rate: 300, rateUom: 'DAY' },
  { eqrEquipmentMasterId: 21, equipmentName: 'Traffic cones', className: 'Safety', eqrEquipmentClassId: 2, isRentable: false, unitPrice: 4 },
];

function handle(req, res) {
  const p = req.path;
  if (p.endsWith('/conf-global-settings')) {
    return res.json({ data: FLAGS.map((k) => ({ settingKey: k, settingValue: 'true', settingCategory: 'FEATURE_FLAG', isActiveFlag: 'Y' }))
      .concat([{ settingKey: 'ENABLE_QUOTES', settingValue: quotes, settingCategory: 'SYSTEM', isActiveFlag: 'Y' }]) });
  }
  if (p.endsWith('/views/customer-my-requests')) return res.json({ data: REQS });
  if (p.endsWith('/views/customer-request-details')) {
    return res.json({ data: REQS.concat([{ eqrEquipmentRequestId: 901, requestNumber: 'EQR-000901', requestStatus: 'IN_PROCESS', customerName: 'Lone Star Paving LLC',
      customerContact: 'Maria Torres', startDate: '2026-12-01T00:00:00Z', endDate: '2026-12-14T00:00:00Z' }]).map((r) => Object.assign({}, r, { quoteDocument: undefined })) });
  }
  if (p.endsWith('/views/customer-my-billing')) return res.json({ data: INVOICES });
  if (p.endsWith('/views/request-detail-lines')) return res.json({ data: LINES[req.query.get('requestId')] || [{ lineId: 9011, equipmentName: 'CAT 320 Excavator', quantity: 1, lineStatus: 'IN_PROCESS' }] });
  const lines2 = /\/equipment-requests\/(\d+)\/lines$/.exec(p);
  if (lines2 && req.method === 'GET') return res.json({ data: (LINES[lines2[1]] || []).map((l) => ({ id: l.lineId, lineStatus: l.lineStatus })) });
  if (p.endsWith('/customer-refs')) return res.json({ data: [{ id: 7, customerName: 'Lone Star Paving LLC' }] });
  if (p.endsWith('/customer-portal-users')) return res.json({ data: [{ id: 41, contactName: 'Maria Torres', username: 'maria.torres', email: 'maria@lonestar.example' }] });
  if (p.endsWith('/views/equipment-catalog')) {
    const dated = req.query.get('startDate');
    return res.json({ data: CATALOG.map((r) => Object.assign({}, r, dated ? { availabilityStatus: r.eqrEquipmentMasterId === 12 ? 'NOT AVAILABLE' : 'AVAILABLE', availableQty: 5 } : {})) });
  }
  if (p.endsWith('/purchase-requisitions')) return res.json({ data: [] });
  if (p.endsWith('/quote-lines') && req.method === 'GET') return res.json([{ requestLineId: 6101, quotedRate: 42, quotedUom: 'DAY', quotedLineTotal: 4536, quotedQty: 4 }]);
  if (p.endsWith('/contracts') && req.method === 'POST') return res.json({ ContractNumber: req.json().Cognomen === 'EQR-000610' ? 'K-2026-0610' : 'K-2026-0901' }, 201);
  if (req.method === 'POST' && p.endsWith('/equiprite/v1/equipment-requests')) return res.json({ id: 901, requestNumber: 'EQR-000901' }, 201);
  if (p.endsWith('/ship-to-sites')) return res.json({ id: 77 }, 201);
  return undefined;
}

const short = (w) => w.method + ' ' + w.path.replace('/equiprite/v1', '').replace(/^\/fscmRestApi\/resources\/[\d.]+/, '(fusion)');

(async () => {
  const env = await E.start({
    port: 19180, handle, flags: FLAGS, sessionRole: 'CUSTOMER', username: 'maria.torres',
    access: { EQR_CUST_DASHBOARD: 'FULL', EQR_CUST_MY_REQUESTS: 'FULL', EQR_CUST_CREATE_REQ: 'FULL' },
    shots: process.env.E2E_SHOTS,
  });
  const { page } = env;
  const shots = [];
  try {
    T.section('home: what needs the customer first');
    await env.open('/vp/shell/customer/customer-home');
    await page.waitForSelector('.er-cu-todo-item', { timeout: 30000 });
    await page.waitForTimeout(600);
    const todo = await env.text('.er-cu-next-list');
    T.check('the quote to accept comes first', todo.indexOf('Accept the quote for EQR-000610') !== -1 && todo.indexOf('Accept the quote') < todo.indexOf('Confirm the delivery'));
    T.check('the arrived delivery is listed', todo.includes('Confirm the delivery of EQR-000700') && todo.includes('2 items have arrived'));
    T.check('the overdue invoice is listed', todo.includes('1 invoice is overdue'));
    const kpis = (await env.text('.er-kpis')).toLowerCase();
    T.check('figures: active requests and equipment on site', kpis.includes('active requests 1') && kpis.includes('equipment on site 2'), kpis);
    T.check('the menu shows the portal as built and highlighted', (await env.text('.er-nav-item--active')).includes('Customer portal'));
    T.check('a customer sign-in gets no staff banner', !(await page.$('.er-cu-behalf')));
    shots.push(await env.shot('customer-home.png'));

    T.section('my requests: chips, tracker, quote button');
    await page.click('.er-band button[data-page="customer-requests"]');
    await page.waitForSelector('.er-cu-trow:not(.er-cu-thead)', { timeout: 20000 });
    T.eq('open requests by default (the closed one is under Finished)', await page.$$eval('.er-cu-table .er-cu-trow:not(.er-cu-thead)', (r) => r.length), 3);
    T.check('a ready quote has its Accept quote button', (await env.text('.er-cu-table')).includes('Accept quote'));
    await page.click('button[data-group="done"]');
    await page.waitForTimeout(300);
    T.check('Finished shows the closed request in plain words', (await env.text('.er-cu-table')).includes('EQR-000377') && (await env.text('.er-cu-table')).includes('Done'));
    await page.click('button[data-group="open"]');
    await page.waitForTimeout(300);
    shots.push(await env.shot('customer-requests.png'));

    T.section('tracking: the next step is the delivery, accepted in one click');
    await page.click('.er-cu-trow button.er-cu-link[data-number="EQR-000700"]');
    await page.waitForSelector('.er-cu-next', { timeout: 20000 });
    await page.waitForTimeout(500);
    T.check('next step: your equipment has arrived', (await env.text('.er-cu-next')).includes('Your equipment has arrived'));
    T.eq('the tracker stops at On the way, arrived', await page.$$eval('.er-cu-track .er-cu-stop', (s) => s.map((x) => x.className.split('--')[1][0]).join('')), 'dddctt');
    T.check('no serial numbers are shown', !(await env.text('.er-cu-lines')).toLowerCase().includes('serial'));
    shots.push(await env.shot('customer-request-tracking.png'));
    env.writes.length = 0;
    await page.click('#acceptArrivedBtn');
    await page.waitForTimeout(1500);
    T.eq('accept: one batch for the two arrived lines (the old customer chain)', env.writes.map(short).join(' > '), 'PATCH /equipment-requests/700/lines/batch');
    T.eq('… both go DEPLOYED', JSON.stringify(env.writes[0] && env.writes[0].body.lines), '[{"id":7001,"lineStatus":"DEPLOYED"},{"id":7002,"lineStatus":"DEPLOYED"}]');

    T.section('quote: accept creates the contract');
    await env.open('/vp/shell/customer/customer-quote?requestId=EQR-000610&requestNumericId=610');
    await page.waitForSelector('#acceptQuoteBtn', { timeout: 30000 });
    await page.waitForTimeout(500);
    T.check('the decision says what accepting does, with the total',
      (await env.text('.er-cu-next')).includes('Accepting creates your rental contract') && (await env.text('.er-cu-next')).includes('$13,260'));
    T.check('declining is explained, not faked', (await env.text('.er-cu-next')).includes('Declining a quote is not available online'));
    shots.push(await env.shot('customer-quote.png'));
    env.writes.length = 0;
    await page.click('#acceptQuoteBtn');
    await page.waitForURL(/customer-request\?|customer-request$/, { timeout: 30000 });
    await page.waitForTimeout(800);
    T.eq('accept: contract, header, line batch, quote accepted (the old AcceptQuoteChain)',
      env.writes.map(short).join(' > '), 'POST (fusion)/contracts > PATCH /equipment-requests/610 > PATCH /equipment-requests/610/lines/batch > POST /equipment-requests/610/quote/accept');
    const k = env.writes[0] && env.writes[0].body;
    T.eq('the contract body carries the fixed test values', k && [k.Cognomen, k.LegalEntityName, k.PartyName, k.EstimatedAmount].join(' | '), 'EQR-000610 | EPC UAE | Stark Industries | 13260');
    T.eq('the header gets QUOTE_ACCEPTED and the contract number', JSON.stringify(env.writes[1] && env.writes[1].body), '{"status":"QUOTE_ACCEPTED","contractNumber":"K-2026-0610"}');
    T.check('the quoted rate is stamped on the line', JSON.stringify(env.writes[2] && env.writes[2].body.lines[0]) === '{"id":6101,"lineStatus":"QUOTE_ACCEPTED","billRate":42,"priceUom":"DAY","estimatedCost":4536,"quantity":4}');

    T.section('billing, invoices, contract');
    await env.open('/vp/shell/customer/customer-billing');
    await page.waitForSelector('.er-cu-table--billing .er-cu-trow:not(.er-cu-thead)', { timeout: 30000 });
    await page.waitForTimeout(500);
    T.check('balance due and overdue', (await env.text('.er-band')).includes('Balance due $8,420') && (await env.text('.er-kpis')).includes('$2,240'));
    T.eq('billed requests: those with a contract', await page.$$eval('.er-cu-table--billing .er-cu-trow:not(.er-cu-thead)', (r) => r.length), 3);
    shots.push(await env.shot('customer-billing.png'));
    await page.click('.er-cu-table--billing button.er-cu-link[data-number="EQR-000520"]');
    await page.waitForSelector('.er-cu-acc', { timeout: 20000 });
    await page.waitForTimeout(500);
    T.check('invoices per piece of equipment, first one open', (await env.text('.er-cu-acc >> nth=0')).includes('INV-30871') && (await env.text('.er-kpis')).includes('$6,180'));
    shots.push(await env.shot('customer-invoice.png'));
    await env.open('/vp/shell/customer/customer-contract?requestId=EQR-000520&requestNumericId=520');
    await page.waitForSelector('.er-cu-qline', { timeout: 20000 });
    await page.waitForTimeout(400);
    T.check('the contract: number, value, terms', (await env.text('.er-band h1')).includes('Contract K-2026-0520')
      && (await env.text('.er-facts')).includes('$119,700') && (await env.text('#termsTitle')).includes('Rental terms'));
    shots.push(await env.shot('customer-contract.png'));

    T.section('raise a request, customer quoting off: terms gate, contract at submit');
    quotes = 'NONE';
    await env.open('/vp/shell/customer/customer-new-request');
    await page.waitForSelector('.er-eq-card', { timeout: 30000 });
    await page.fill('input[data-field="startDate"]', '2026-12-01');
    await page.dispatchEvent('input[data-field="startDate"]', 'change');
    await page.fill('input[data-field="endDate"]', '2026-12-14');
    await page.dispatchEvent('input[data-field="endDate"]', 'change');
    await page.waitForTimeout(1000);
    await page.click('button[data-action="add"][data-id="11"]');
    await page.click('button[data-action="add"][data-id="21"]');
    await page.waitForTimeout(300);
    T.check('the rail totals the cart for the dates', (await env.text('.er-rail')).includes('$19,604'));
    await page.click('.er-rail-actions button[data-step="2"]');
    await page.waitForSelector('#custTitle');
    T.check('one customer and one contact: picked for the customer', (await env.text('.er-form >> nth=0')).includes('Lone Star Paving LLC') && (await env.text('.er-form >> nth=0')).includes('Maria Torres'));
    await page.fill('input[data-field="location"]', '1200 Pipeline Rd, Odessa TX 79761');
    await page.dispatchEvent('input[data-field="location"]', 'change');
    await page.click('.er-rail-actions button[data-step="3"]');
    await page.waitForSelector('.er-lines .er-line');
    await page.waitForTimeout(1200);
    T.check('the catalog was asked with the customer and the delivery point',
      env.calls.some((c) => c.includes('equipment-catalog') && c.includes('customerRefId=7') && c.includes('latitude=31.85')));
    T.eq('Submit waits for the terms', await page.$eval('.er-rail-actions .er-btn--dark', (b) => b.disabled), true);
    await page.check('#termsAcceptChk');
    await page.waitForTimeout(300);
    shots.push(await env.shot('customer-new-request-review.png'));
    env.writes.length = 0;
    await page.click('.er-rail-actions button:has-text("Submit request")');
    await page.waitForURL(/customer-request/, { timeout: 30000 });
    await page.waitForTimeout(800);
    T.eq('submit: header, site, site link, lines, IN_PROCESS, contract, contract number (the old EXTERNAL path)',
      env.writes.map(short).join(' > '),
      'POST /equipment-requests > POST /ship-to-sites > PATCH /equipment-requests/901 > POST /equipment-requests/901/lines/batch > PATCH /equipment-requests/901 > POST (fusion)/contracts > PATCH /equipment-requests/901');
    const h = env.writes[0] && env.writes[0].body;
    T.eq('the header is the customer\'s', h && [h.requestType, h.eqrCustomerRefId, h.customerName, h.contactName, h.eqrCustomerPortalUserId, h.requestorUserId].join(' | '),
      'EXTERNAL | 7 | Lone Star Paving LLC | Maria Torres | 41 | ');
    T.check('lines IN_PROCESS, priced', env.writes[3] && env.writes[3].body.lines.every((l) => l.lineStatus === 'IN_PROCESS') && env.writes[3].body.lines[0].billRate === 1400);
    T.eq('the header goes IN_PROCESS', JSON.stringify(env.writes[4] && env.writes[4].body), '{"status":"IN_PROCESS"}');
    T.eq('contract amount = rate × qty × days over the lines', env.writes[5] && env.writes[5].body.EstimatedAmount, 1400 * 14 + 4 * 14);
    T.eq('the contract number is stamped', JSON.stringify(env.writes[6] && env.writes[6].body), '{"contractNumber":"K-2026-0901"}');
    T.check('the new request opens on its tracker', page.url().includes('requestNumericId=901'));
    shots.push(await env.shot('customer-request-new.png'));

    T.section('narrow screen');
    await page.setViewportSize({ width: 390, height: 900 });
    await env.open('/vp/shell/customer/customer-home');
    await page.waitForSelector('.er-cu-todo-item', { timeout: 30000 });
    await page.waitForTimeout(500);
    T.check('no sideways scrolling on a phone', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    shots.push(await env.shot('customer-home-phone.png'));

    T.eq('no browser errors', env.errors.filter((e) => !e.startsWith('warning')).join('\n'), '');
  } catch (e) {
    T.check('run finished', false, e.message);
    await env.shot('customer-failed.png').then((f) => console.log('failure screenshot: ' + f)).catch(() => {});
    console.log(env.errors.join('\n'));
  } finally {
    await env.close();
  }

  // Staff (an Equipment Manager, every page code) opening the portal for a customer: FDD 7.18.5.
  const staff = await E.start({ port: 19180, handle, flags: FLAGS, shots: process.env.E2E_SHOTS });
  try {
    T.section('staff acting for customers');
    quotes = 'CUSTOMER';
    await staff.open('/vp/shell/customer/customer-home');
    await staff.page.waitForSelector('.er-cu-todo-item', { timeout: 30000 });
    T.check('the home says the portal is being used for customers', (await staff.text('.er-cu-behalf')).includes('You are using the portal for customers'));
    await staff.open('/vp/shell/customer/customer-new-request');
    await staff.page.waitForSelector('.er-eq-card', { timeout: 30000 });
    await staff.page.fill('input[data-field="startDate"]', '2026-12-01');
    await staff.page.dispatchEvent('input[data-field="startDate"]', 'change');
    await staff.page.fill('input[data-field="endDate"]', '2026-12-14');
    await staff.page.dispatchEvent('input[data-field="endDate"]', 'change');
    await staff.page.waitForTimeout(800);
    await staff.page.click('button[data-action="add"][data-id="11"]');
    await staff.page.click('.er-rail-actions button[data-step="2"]');
    await staff.page.waitForSelector('#custTitle');
    T.check('step 2 says the request is raised for a customer', (await staff.text('.er-cu-behalf')).includes('You are raising this for a customer'));
    T.check('quoting on: prices wait for the quote', (await staff.text('.er-rail')).includes('Prices come on your quote'));
    shots.push(await staff.shot('customer-new-request-staff.png'));
    T.eq('no browser errors (staff)', staff.errors.filter((e) => !e.startsWith('warning')).join('\n'), '');
  } catch (e) {
    T.check('staff run finished', false, e.message);
    await staff.shot('customer-staff-failed.png').catch(() => {});
  } finally {
    await staff.close();
    console.log('\nScreenshots:\n  ' + shots.join('\n  '));
    T.report();
  }
})();
