'use strict';
/*
 * EquipRite Next, the customer portal, in a real browser against a stateful fake backend.
 *
 *   a customer (session role EXTERNAL_REQUESTOR, the EQR_CUST_* page codes only): lands on the portal and sees only
 *   customer screens; the home (what needs them, what is on its way, what is on their site); requests, equipment and
 *   invoices with export; a request in its tab (accept a delivery: New's calls; a consumable issued from stock is left
 *   to New; start a return; delete a draft); the quote with its terms, accepted in New (nothing written); a request's
 *   invoices; a new request sent (customer quoting on), and saved then handed to New (quoting off: the Fusion contract)
 *   a manager: the portal for customers (the staff banner), next to every other screen
 *
 * What a person sees, exactly what is written, no sideways scroll, no browser errors; screenshots.
 * Needs `npm run build`. Run: node tests/e2e/next-customer.e2e.js   (screenshots: E2E_SHOTS, else the OS temp folder)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const V1 = '/equiprite/v1';
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const PDF = Buffer.from('%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj '
  + '3 0 obj<</Type/Page/MediaBox[0 0 300 144]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF').toString('base64');
const CUST = 'Lone Star Paving LLC';

let quotes = 'CUSTOMER';
let REQS;
let LINES;
let INVOICES;
let nextId;

function seed() {
  nextId = 901;
  REQS = [
    { eqrEquipmentRequestId: 700, requestNumber: 'EQR-000700', requestStatus: 'IN_PROCESS', customerName: CUST, customerContact: 'Maria Torres',
      startDate: day(1) + 'T00:00:00Z', endDate: day(27) + 'T00:00:00Z', lines: 4, createdDate: day(-5) + 'T09:00:00Z', contractNumber: 'K-2026-0700' },
    { eqrEquipmentRequestId: 610, requestNumber: 'EQR-000610', requestStatus: 'QUOTE_GENERATED', customerName: CUST, customerContact: 'Maria Torres',
      startDate: day(5) + 'T00:00:00Z', endDate: day(30) + 'T00:00:00Z', lines: 2, createdDate: day(-3) + 'T09:00:00Z', quoteDocument: PDF, quoteFileName: 'Quote-610.pdf' },
    { eqrEquipmentRequestId: 520, requestNumber: 'EQR-000520', requestStatus: 'DEPLOYED', customerName: CUST, customerContact: 'Maria Torres',
      startDate: day(-24) + 'T00:00:00Z', endDate: day(-2) + 'T00:00:00Z', lines: 2, createdDate: day(-30) + 'T09:00:00Z', contractNumber: 'K-2026-0520' },
    { eqrEquipmentRequestId: 377, requestNumber: 'EQR-000377', requestStatus: 'CLOSED', customerName: CUST, customerContact: 'Maria Torres',
      startDate: day(-60) + 'T00:00:00Z', endDate: day(-35) + 'T00:00:00Z', lines: 1, createdDate: day(-64) + 'T09:00:00Z', contractNumber: 'K-2026-0377' },
    { eqrEquipmentRequestId: 905, requestNumber: 'EQR-000905', requestStatus: 'DRAFT', customerName: CUST, customerContact: 'Maria Torres',
      startDate: day(10) + 'T00:00:00Z', endDate: day(20) + 'T00:00:00Z', lines: 1, createdDate: day(-1) + 'T09:00:00Z' },
  ];
  const L = (lineId, equipmentName, className, quantity, lineStatus, extra) => Object.assign({ lineId, equipmentName, className, quantity, lineStatus,
    allocatedSerialNumber: 'SER-' + lineId, allocatedSerial: 'SER-' + lineId, serialNumber: 'SER-' + lineId, deploymentLocation: '1200 Pipeline Rd, Odessa TX' }, extra || {});
  LINES = {
    700: [
      L(7001, 'CAT 320 Excavator', 'Excavators', 1, 'SHIP_TO_SITE', { billRate: 1400, priceUom: 'DAY', consumableFlag: 'N' }),
      L(7002, 'Dump truck 30 t', 'Trucks', 1, 'SHIP_TO_SITE', { billRate: 950, priceUom: 'DAY', consumableFlag: 'N' }),
      L(7003, 'Roller 10 t', 'Compaction', 1, 'PICK_RELEASED', { billRate: 700, priceUom: 'DAY' }),
      L(7004, 'Safety barriers', 'Site safety', 10, 'SHIP_TO_SITE', { billRate: 4, priceUom: 'EACH', consumableFlag: 'Y', autoConsumeFlag: 'Y' }),
    ],
    610: [
      L(6101, 'Light tower', 'Lighting', 4, 'QUOTE_GENERATED', { billRate: 45, priceUom: 'DAY', startDate: day(5), endDate: day(30) }),
      L(6102, 'Mini excavator 3.5 t', 'Excavators', 1, 'QUOTE_GENERATED', { billRate: 2100, priceUom: 'WEEK', estimatedCost: 8400, startDate: day(5), endDate: day(30) }),
    ],
    520: [
      L(5201, 'Excavator 20 t', 'Excavators', 2, 'DEPLOYED', { billRate: 1100, priceUom: 'DAY', estimatedCost: 83600, billFrequency: 'MONTHLY' }),
      L(5202, 'Dump truck 30 t', 'Trucks', 1, 'DEPLOYED', { billRate: 950, priceUom: 'DAY', estimatedCost: 36100, billFrequency: 'MONTHLY' }),
    ],
    377: [L(3771, 'Mini excavator 3.5 t', 'Excavators', 1, 'CLOSED', { billRate: 160, priceUom: 'DAY', estimatedCost: 4000 })],
    905: [L(9051, 'CAT 320 Excavator', 'Excavators', 2, 'DRAFT', { eqrEquipmentMasterId: 11 })],
  };
  INVOICES = [
    { eqrBillingTransactionId: 1, eqrEquipmentRequestId: 520, eqrRequestLineId: 5201, invoiceNumber: 'INV-30871', status: 'PAID', grossAmount: 12140,
      billingPeriodStart: day(-24), billingPeriodEnd: day(-10), dueDate: day(5), transactionDate: day(-10) },
    { eqrBillingTransactionId: 2, eqrEquipmentRequestId: 520, eqrRequestLineId: 5202, invoiceNumber: 'INV-30902', status: 'POSTED', grossAmount: 6180,
      billingPeriodStart: day(-24), billingPeriodEnd: day(-10), dueDate: day(5), transactionDate: day(-10) },
    { eqrBillingTransactionId: 3, eqrEquipmentRequestId: 377, eqrRequestLineId: 3771, invoiceNumber: 'INV-30888', status: 'POSTED', grossAmount: 2240,
      billingPeriodStart: day(-60), billingPeriodEnd: day(-35), dueDate: day(-20), transactionDate: day(-35) },
  ];
}
const CATALOG = [
  { eqrEquipmentMasterId: 11, equipmentName: 'CAT 320 Excavator', className: 'Excavators', eqrEquipmentClassId: 1, isRentable: true, rate: 1400, rateUom: 'DAY' },
  { eqrEquipmentMasterId: 12, equipmentName: 'Mini Excavator 3.5t', className: 'Excavators', eqrEquipmentClassId: 1, isRentable: true, rate: 300, rateUom: 'DAY' },
  { eqrEquipmentMasterId: 21, equipmentName: 'Traffic cones', className: 'Safety', eqrEquipmentClassId: 2, isRentable: false, unitPrice: 4 },
];

const lineById = (id) => [].concat(...Object.values(LINES)).find((l) => Number(l.lineId) === Number(id));

function handle(req, res) {
  const p = req.path;
  if (p.endsWith('/conf-global-settings')) {
    return res.json({ data: ['PROJECTS_MODULE_ENABLED', 'CUSTOMERS_MODULE_ENABLED'].map((k) => ({ settingKey: k, settingValue: 'true', settingCategory: 'FEATURE_FLAG', isActiveFlag: 'Y' }))
      .concat([{ settingKey: 'ENABLE_QUOTES', settingValue: quotes, settingCategory: 'SYSTEM', isActiveFlag: 'Y' }]) });
  }
  if (p.endsWith('/views/customer-my-requests')) return res.json({ data: REQS });
  if (p.endsWith('/views/customer-request-details')) return res.json({ data: REQS.map((r) => Object.assign({}, r, { quoteDocument: undefined })) });
  if (p.endsWith('/views/customer-my-billing')) return res.json({ data: INVOICES });
  if (p.endsWith('/views/request-detail-lines')) return res.json({ data: LINES[req.query.get('requestId')] || [] });
  const batch = /\/equipment-requests\/(\d+)\/lines\/batch$/.exec(p);
  if (batch && req.method === 'PATCH') {
    (req.json().lines || []).forEach((u) => { const l = lineById(u.id); if (l && u.lineStatus) l.lineStatus = u.lineStatus; });
    return res.json({ data: [] });
  }
  const lines2 = /\/equipment-requests\/(\d+)\/lines$/.exec(p);
  if (lines2 && req.method === 'GET') {
    return res.json({ data: (LINES[lines2[1]] || []).map((l) => ({ id: l.lineId, lineStatus: l.lineStatus, eqrEquipmentMasterId: l.eqrEquipmentMasterId, quantity: l.quantity })) });
  }
  const one = /\/equipment-requests\/(\d+)$/.exec(p);
  if (one && req.method === 'GET') {
    const r = REQS.find((x) => x.eqrEquipmentRequestId === Number(one[1]));
    if (!r) return res.json({}, 404);
    return res.json({ id: r.eqrEquipmentRequestId, requestNumber: r.requestNumber, status: r.requestStatus, requestType: 'EXTERNAL', eqrCustomerRefId: 7,
      customerName: CUST, eqrCustomerPortalUserId: 41, contactName: 'Maria Torres', attribute1: '1200 Pipeline Rd, Odessa TX', deliveryLocationType: 'DELIVERY_LOCATION',
      requestedStartDate: r.startDate, requestedEndDate: r.endDate, shipToSiteId: 70 });
  }
  if (one && req.method === 'PATCH') {
    const r = REQS.find((x) => x.eqrEquipmentRequestId === Number(one[1]));
    const b = req.json() || {};
    if (r && b.status) r.requestStatus = b.status;
    return res.json({ id: Number(one[1]) });
  }
  if (one && req.method === 'DELETE') {
    REQS = REQS.filter((x) => x.eqrEquipmentRequestId !== Number(one[1]));
    return res.json({}, 204);
  }
  if (p.endsWith('/customer-refs')) return res.json({ data: [{ id: 7, customerName: CUST }] });
  if (p.endsWith('/customer-portal-users')) return res.json({ data: [{ id: 41, contactName: 'Maria Torres', username: 'maria.torres', email: 'maria@lonestar.example' }] });
  if (p.endsWith('/views/equipment-catalog')) {
    const dated = req.query.get('startDate');
    return res.json({ data: CATALOG.map((r) => Object.assign({}, r, dated ? { availabilityStatus: r.eqrEquipmentMasterId === 12 ? 'NOT AVAILABLE' : 'AVAILABLE', availableQty: 5 } : {})) });
  }
  if (req.method === 'POST' && p.endsWith(V1 + '/equipment-requests')) {
    const id = nextId++;
    return res.json({ id, requestNumber: 'EQR-000' + id }, 201);
  }
  if (p.endsWith('/ship-to-sites') && req.method === 'POST') return res.json({ id: 77 }, 201);
  return undefined;
}

const short = (w) => w.method + ' ' + w.path.replace(V1, '').replace(/^\/fscmRestApi\/resources\/[\d.]+/, '(fusion)');

async function download(page, button, fmt) {
  await page.click(button);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`.nx-menu-item[data-format="${fmt}"]:visible`)]);
  const file = path.join(os.tmpdir(), 'next-cu-' + dl.suggestedFilename());
  await dl.saveAs(file);
  return { name: dl.suggestedFilename(), file };
}

/** The page shown in the current tab (other tabs keep theirs alive, hidden). */
const visible = (sel) => sel + ':visible';

async function noSideways(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

(async () => {
  seed();
  // ══ A customer ════════════════════════════════════════════════════════════════════════════════════════════════
  const env = await E.start({
    port: 19390, handle, app: 'next', sessionRole: 'EXTERNAL_REQUESTOR', username: 'maria.torres',
    // EQR_DASHBOARD too: customers may hold it, and still land on the portal without My work.
    access: { EQR_DASHBOARD: 'FULL', EQR_CUST_DASHBOARD: 'FULL', EQR_CUST_MY_REQUESTS: 'FULL', EQR_CUST_CREATE_REQ: 'FULL' }, shots: process.env.E2E_SHOTS,
  });
  const { page } = env;
  try {
    T.section('a customer lands on the portal and sees only customer screens');
    await env.open('/');
    await page.waitForSelector(visible('#cuNeeds .nx-cu-need'), { timeout: 30000 });
    await page.waitForTimeout(600);
    T.eq('the only tab is the portal', await page.$$eval('.nx-tab', (t) => t.map((x) => x.dataset.tabId).join()), 'customer-portal');
    T.eq('the menu holds the customer portal alone', await page.$$eval('.nx-nav-item', (n) => n.map((x) => x.dataset.navId).join()), 'customer-portal');
    T.check('… shown as built', !(await page.$('.nx-nav-item .nx-nav-soon')));
    T.check('a greeting by name, the customer and what needs them', (await env.text(visible('.nx-cu .nx-pagehead'))).includes('Maria')
      && (await env.text(visible('#cuSummary'))) === CUST + ' · 4 open requests · 4 things need you', await env.text(visible('#cuSummary')));
    T.check('a customer sign-in gets no staff banner', !(await page.$(visible('#cuBehalf'))));
    await page.waitForSelector('.nx-bell-count', { timeout: 20000 });
    await page.click('#nxBell');
    await page.waitForSelector('.nx-alert');
    T.eq('the bell: what needs the customer, from the portal (the overdue invoice first)', await page.$$eval('.nx-alert-title', (t) => t.map((x) => x.innerText).join(' | ')),
      '1 invoice is overdue | Accept the quote for EQR-000610 | Accept the delivery of EQR-000700 | Finish and send EQR-000905');
    T.check('… never from the staff request views', !env.calls.some((c) => /\/views\/my-requests\?|\/views\/my-request-lines\?/.test(c)),
      env.calls.filter((c) => /\/views\/my-requests\?|\/views\/my-request-lines\?/.test(c)).join(', '));
    await page.keyboard.press('Escape');

    T.section('the home: what needs them, what is on its way, what is on their site');
    T.eq('what needs them, New\'s order: the quote, the delivery, the draft, the overdue invoice', await page.$$eval('.nx-cu-need-title', (t) => t.map((x) => x.innerText).join(' | ')),
      'Accept the quote for EQR-000610 | Accept the delivery of EQR-000700 | Finish and send EQR-000905 | 1 invoice is overdue');
    T.check('… the delivery in plain words', (await env.text(visible('.nx-cu-need--delivery'))).includes('3 pieces were shipped to your site. When they arrive'));
    T.eq('the tiles count pieces', await page.$$eval(visible('.nx-cu-tiles .nx-kpi'), (t) => t.map((x) => x.dataset.tile + ':' + x.querySelector('.nx-kpi-value').innerText).join(' ')),
      'out:12 onsite:3 coming:6 pay:$8,420');
    T.eq('… and what they mean', await page.$$eval(visible('.nx-cu-tiles .nx-kpi-note'), (t) => t.map((x) => x.innerText).join(' | ')),
      '12 pieces to accept when they arrive | 3 pieces past the end date | 4 open requests | 2 open · 1 overdue');
    T.eq('on the way to you, in words', await page.$$eval('#cuWay .nx-cu-piece .nx-pill', (p) => p.map((x) => x.innerText.trim()).join(' | ')),
      'On the way to your site | On the way to your site | On the way to your site');
    T.check('on your site: late and by how much', (await env.text('#cuSite')).includes('Excavator 20 t ×2') && (await env.text('#cuSite')).includes('Due back') && (await env.text('#cuSite')).includes('2 days over'));
    T.eq('the latest requests, read from the equipment', await page.$$eval('.nx-grid--curecent .nx-pill', (p) => p.map((x) => x.innerText.trim()).join(' | ')),
      'Draft | Quote ready for you | Partly shipped · 3 of 4 | On site | Completed');
    T.check('never a serial number', !(await page.innerText('body')).includes('SER-'));
    T.check('no sideways scroll on the home', await noSideways(page));
    await env.shot('next-customer-home.png');

    T.section('requests, equipment and invoices, each exported as shown');
    await page.click(visible('.nx-cu-views button[data-value="requests"]'));
    await page.waitForSelector(visible('.nx-grid--cureq .nx-row--click'));
    T.eq('open requests by default (the closed one is under Finished)', await page.$$eval(visible('.nx-grid--cureq .nx-row--click'), (r) => r.map((x) => x.dataset.number).join()),
      'EQR-000905,EQR-000700,EQR-000610,EQR-000520');
    T.eq('the next step, the customer\'s own first', await page.$$eval(visible('.nx-grid--cureq .nx-cu-next'), (r) => r.map((x) => x.innerText.split('\n')[0].trim()).join(' | ')),
      'Check it and send it | Accept the delivery when it arrives (3 pieces) | Accept the quote | Return it: it was due back ' + new Date(Date.now() - 2 * 86400000).getUTCDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][new Date(Date.now() - 2 * 86400000).getUTCMonth()]);
    await page.click(visible('.nx-chip[data-field="reqGroup"][data-value="done"]'));
    await page.waitForTimeout(300);
    T.eq('Finished: the closed request', await page.$$eval(visible('.nx-grid--cureq .nx-row--click'), (r) => r.map((x) => x.dataset.number + ' ' + x.querySelector('.nx-pill').innerText.trim()).join()), 'EQR-000377 Completed');
    await page.click(visible('.nx-chip[data-field="reqGroup"][data-value="all"]'));
    await page.fill(visible('input[data-field="reqText"]'), 'dump truck');
    await page.waitForTimeout(300);
    T.eq('search finds requests by their equipment', await page.$$eval(visible('.nx-grid--cureq .nx-row--click'), (r) => r.map((x) => x.dataset.number).join()), 'EQR-000700,EQR-000520');
    const csv = await download(page, visible('#cuExport'), 'csv');
    const text = fs.readFileSync(csv.file, 'utf8');
    T.check('CSV: the requests shown, in words, no serial', csv.name.startsWith('equiprite-my-requests-') && text.split('\r\n').filter(Boolean).length === 3
      && text.includes('Partly shipped · 3 of 4') && !text.includes('SER-'), csv.name + ' ' + text.slice(0, 300));
    await page.fill(visible('input[data-field="reqText"]'), '');
    await page.waitForTimeout(200);
    await env.shot('next-customer-requests.png');

    await page.click(visible('.nx-cu-views button[data-value="equipment"]'));
    await page.waitForSelector(visible('.nx-grid--cueq .nx-row--click'));
    T.eq('a row per piece of the open requests', await page.$$eval(visible('.nx-grid--cueq .nx-row--click'), (r) => r.length), 8);
    await page.click(visible('.nx-chip[data-field="eqChip"][data-value="late"]'));
    await page.waitForTimeout(300);
    T.eq('Late: the pieces past their end date', await page.$$eval(visible('.nx-grid--cueq .nx-row--click .nx-cell-main'), (r) => r.map((x) => x.innerText.trim()).join(' | ')), 'Excavator 20 t ×2 | Dump truck 30 t');
    const xl = await download(page, visible('#cuExport'), 'xlsx');
    let read = '';
    try {
      read = execFileSync('python3', ['-I', '-c', 'import sys, openpyxl\nws = openpyxl.load_workbook(sys.argv[1]).active\nrows = list(ws.iter_rows(values_only=True))\nprint(len(rows)); print(rows[0][:5]); print(rows[1][4])', xl.file], { encoding: 'utf8' }).trim();
    } catch (e) { read = 'unavailable'; }
    if (read !== 'unavailable') T.eq('Excel: the late pieces, the columns, the words', read.split('\n').join(' | '), "3 | ('Equipment', 'Class', 'Qty', 'Request', 'Where it is') | On your site");
    await env.shot('next-customer-equipment.png');

    await page.click(visible('.nx-cu-views button[data-value="invoices"]'));
    await page.waitForSelector(visible('.nx-grid--cuinv .nx-row--click'));
    T.eq('the balance: due, overdue, paid', await page.$$eval(visible('.nx-cu-tiles .nx-kpi-value'), (v) => v.map((x) => x.innerText).join(' | ')).then((s) => s.split(' | ').slice(0, 3).join(' | ')),
      '$8,420 | $2,240 | $12,140');
    T.eq('the invoices, newest period first, in words', await page.$$eval(visible('.nx-grid--cuinv .nx-row--click'), (r) => r.map((x) => x.querySelector('.nx-link').innerText + ' ' + x.querySelector('.nx-pill').innerText.trim()).join(' | ')),
      'INV-30871 Paid | INV-30902 To pay | INV-30888 Overdue');
    await env.shot('next-customer-invoices.png');
    T.check('no sideways scroll on the lists', await noSideways(page));

    T.section('a request in its own tab: accept the delivery (New\'s calls); a consumable issued from stock is left to New');
    await page.click(visible('.nx-cu-views button[data-value="home"]'));
    await page.click('.nx-cu-need--delivery .nx-btn');
    await page.waitForSelector(visible('#crStep'), { timeout: 20000 });
    await page.waitForTimeout(500);
    T.eq('it opens in a tab named after it', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId + '=' + t.innerText.trim()), 'customer-request:700=EQR-000700');
    T.check('the next step: your equipment is on its way', (await env.text(visible('#crStep'))).includes('Your equipment is on its way') && (await env.text(visible('#crStep'))).includes('Accept all 3'));
    T.eq('the journey', await page.$$eval(visible('.nx-stop'), (s) => s.map((x) => x.dataset.stop + ':' + x.className.match(/nx-stop--(\w+)/)[1]).join(' ')),
      'approval:done ready:here out:here onsite:todo back:todo done:todo');
    T.eq('each piece in words', await page.$$eval(visible('.nx-grid--culines .nx-row:not(.nx-row--head) .nx-pill'), (p) => p.map((x) => x.innerText.trim()).join(' | ')),
      'On the way to your site | On the way to your site | Being prepared at the yard | On the way to your site');
    T.check('rates as quoted, never a serial', (await env.text(visible('.nx-grid--culines'))).includes('$1,400 / DAY') && !(await env.text(visible('#crLines'))).includes('SER-'));
    await env.shot('next-customer-request.png');
    env.writes.length = 0;
    await page.click(visible('#crAcceptArrived'));
    await page.waitForSelector(visible('#crBanner'));
    T.check('accepting all would issue the barriers from stock (Fusion): said, and nothing is written',
      (await env.text(visible('#crBanner'))).includes('Safety barriers') && (await env.text(visible('#crBanner'))).includes('Oracle Fusion') && env.writes.length === 0, await env.text(visible('#crBanner')));
    T.eq('… with the way to do it in New', await page.getAttribute(visible('#crBanner a'), 'href'), env.newUrl + '/vp/shell/customer/customer-request?requestId=EQR-000700&requestNumericId=700');
    await page.check(visible('.nx-grid--culines input[data-line="7001"]'));
    await page.check(visible('.nx-grid--culines input[data-line="7002"]'));
    await page.click(visible('#crAccept'));
    await page.waitForSelector(visible('#crAsk'));
    T.check('it says what it will do first', (await env.text(visible('#crAsk'))).includes('Accept the delivery of 2 pieces') && (await env.text(visible('#crAsk'))).includes('CAT 320 Excavator, Dump truck 30 t will be marked on your site'));
    T.eq('… and writes nothing yet', env.writes.length, 0);
    await page.click(visible('#crGo'));
    await page.waitForFunction(() => { const b = [...document.querySelectorAll('#crBanner')].find((x) => x.offsetParent); return b && /accepted/.test(b.innerText); }, null, { timeout: 20000 });
    await page.waitForTimeout(400);
    T.eq('accept: one batch for the two ticked pieces (New\'s chain); no header rollup while others are not on site', env.writes.map(short).join(' > '), 'PATCH /equipment-requests/700/lines/batch');
    T.eq('… both DEPLOYED', JSON.stringify(env.writes[0] && env.writes[0].body.lines), '[{"id":7001,"lineStatus":"DEPLOYED"},{"id":7002,"lineStatus":"DEPLOYED"}]');
    T.eq('… sent as the signed-in user', env.writes[0] && JSON.stringify(Object.keys(env.writes[0].body)), '["lines"]');
    T.check('the tab reads them on site now', (await env.text(visible('.nx-grid--culines'))).split('On your site').length === 3 && (await env.text(visible('#crBanner'))).includes('2 pieces were accepted'));

    T.section('the home reads itself again after a change in a request\'s tab');
    await page.click('.nx-tab-btn[data-id="customer-portal"]');
    const reread = await page.waitForFunction(() => {
      const n = [...document.querySelectorAll('.nx-cu-need--delivery .nx-cu-need-text')].find((x) => x.offsetParent);
      return n && /^1 piece was shipped/.test(n.innerText);
    }, null, { timeout: 10000 }).then(() => true).catch(() => false);
    T.check('one piece is left to accept (the barriers)', reread);

    T.section('start a return');
    await page.click(visible('#cuSite .nx-cu-piece'));
    await page.waitForFunction(() => document.querySelector('.nx-tab--on') && document.querySelector('.nx-tab--on').dataset.tabId === 'customer-request:520', null, { timeout: 20000 });
    await page.waitForSelector(visible('#crChooseReturn'));
    T.check('the next step: finished with the equipment?', (await env.text(visible('#crStep'))).includes('Finished with the equipment?'));
    await page.click(visible('#crChooseReturn'));
    await page.waitForTimeout(300);
    T.eq('both pieces on site are ticked', await page.$$eval(visible('.nx-grid--culines .nx-cu-row--on'), (r) => r.length), 2);
    env.writes.length = 0;
    await page.click(visible('#crReturn'));
    await page.waitForSelector(visible('#crAsk'));
    T.check('the return says what it does', (await env.text(visible('#crAsk'))).includes('Start the return of 2 pieces') && (await env.text(visible('#crAsk'))).includes('marked for collection'));
    await page.click(visible('#crGo'));
    await page.waitForFunction(() => { const b = [...document.querySelectorAll('#crBanner')].find((x) => x.offsetParent); return b && /return/.test(b.innerText); }, null, { timeout: 20000 });
    await page.waitForTimeout(400);
    T.eq('return: one batch, RETURN_INITIATED (New\'s chain); not closed while nothing is back', env.writes.map(short).join(' > '), 'PATCH /equipment-requests/520/lines/batch');
    T.eq('… the body', JSON.stringify(env.writes[0] && env.writes[0].body.lines), '[{"id":5201,"lineStatus":"RETURN_INITIATED"},{"id":5202,"lineStatus":"RETURN_INITIATED"}]');
    T.check('… then the lines were read again for the close rule', env.calls.some((c) => c.startsWith('GET ' + V1 + '/equipment-requests/520/lines?')));
    T.check('the pieces now wait for pickup', (await env.text(visible('.nx-grid--culines'))).includes('Return asked for, waiting for pickup'));

    T.section('the quote, with its terms; accepting creates the Fusion contract, so it is done in New');
    await page.click('.nx-tab-btn[data-id="customer-portal"]');
    env.writes.length = 0;
    await page.click('.nx-cu-need--quote .nx-btn');
    await page.waitForSelector(visible('#cqState'), { timeout: 20000 });
    await page.waitForTimeout(500);
    T.eq('it opens in a tab of its own', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId + '=' + t.innerText.trim()), 'quote:610=Quote · EQR-000610');
    T.check('the decision says what accepting does, with the total', (await env.text(visible('#cqState'))).includes('Accept the quote to confirm your rental')
      && (await env.text(visible('#cqState'))).includes('Total $13,080 for 2 lines') && (await env.text(visible('#cqFusion'))).includes('Oracle Fusion'));
    T.eq('accept in New EquipRite, on the same quote', await page.getAttribute(visible('#cqAccept'), 'href'), env.newUrl + '/vp/shell/customer/customer-quote?requestId=EQR-000610&requestNumericId=610');
    T.eq('the lines, totalled as New does', await page.$$eval(visible('.nx-grid--cuquote .nx-row:not(.nx-row--head)'), (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ').trim()).join(' | ')).then((s) => s.replace(/\d+ \w{3} – \d+ \w{3} \d{4}/g, 'D')),
      'Light tower Lighting 4 D 26 days $45 / DAY $4,680 | Mini excavator 3.5 t Excavators 1 D 26 days $2,100 / WEEK $8,400 | Total $13,080');
    T.check('the terms are on the page', (await env.text(visible('#cqTerms'))).includes('1. Acceptance of Delivery and Transfer of Risk'));
    T.check('the quote PDF opens', !!(await page.getAttribute(visible('#cqPdf'), 'href')).startsWith('blob:'));
    T.eq('nothing is written', env.writes.length, 0);
    await env.shot('next-customer-quote.png');

    T.section('a request\'s invoices');
    await page.click('.nx-tab-btn[data-id="customer-portal"]');
    await page.click(visible('.nx-cu-views button[data-value="invoices"]'));
    await page.click(visible('.nx-grid--cuinv .nx-row--click[data-number="EQR-000520"]'));
    await page.waitForSelector(visible('.nx-cu-group'), { timeout: 20000 });
    await page.waitForTimeout(400);
    T.eq('in a tab of its own', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId + '=' + t.innerText.trim()), 'invoice:520=Invoices · EQR-000520');
    T.eq('still to pay, paid', await page.$$eval(visible('#ciTiles .nx-kpi-value'), (v) => v.map((x) => x.innerText).join(' | ')).then((s) => s.split(' | ').slice(0, 2).join(' | ')), '$6,180 | $12,140');
    T.eq('each piece with its invoices', await page.$$eval(visible('.nx-cu-group'), (g) => g.map((x) => x.querySelector('.nx-cu-group-what strong').innerText + ': ' + [...x.querySelectorAll('[data-invoice]')].map((i) => i.dataset.invoice).join()).join(' | ')),
      'Excavator 20 t: INV-30871 | Dump truck 30 t: INV-30902');
    await env.shot('next-customer-invoice.png');

    T.section('a draft: reopened on its Review, then deleted after the question');
    await page.click('.nx-tab-btn[data-id="customer-portal"]');
    await page.click(visible('.nx-cu-views button[data-value="home"]'));
    await page.click('.nx-cu-need--draft .nx-btn');
    await page.waitForSelector(visible('#crSendDraft'), { timeout: 20000 });
    T.check('the next step: send it', (await env.text(visible('#crStep'))).includes('This request has not been sent'));
    env.writes.length = 0;
    await page.click(visible('#crSendDraft'));
    await page.waitForSelector(visible('#coCheck'), { timeout: 20000 });
    await page.waitForTimeout(800);
    T.eq('the draft opens in a tab of its own, on its Review', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId + '=' + t.innerText.trim()), 'customer-order:draft-905=Draft EQR-000905');
    T.check('… with what it holds', (await env.text(visible('#coFacts'))).includes('Maria Torres') && (await env.text(visible('#coLines'))).includes('CAT 320 Excavator')
      && (await page.$eval(visible('#coLines input[type="number"]'), (i) => i.value)) === '2', await env.text(visible('#coLines')));
    T.eq('… reading it wrote nothing', env.writes.length, 0);
    await page.click('.nx-tab-btn[data-id="customer-request:905"]');
    await page.waitForSelector(visible('#crAskDelete'), { timeout: 20000 });
    env.writes.length = 0;
    await page.click(visible('#crAskDelete'));
    await page.waitForSelector(visible('#crDeleteAsk'));
    T.eq('the question first, nothing written', env.writes.length, 0);
    await page.click(visible('#crDelete'));
    await page.waitForFunction(() => !document.querySelector('[data-tab-id="customer-request:905"]'), null, { timeout: 20000 });
    T.eq('delete: New\'s call', env.writes.map((w) => short(w) + w.query).join(), 'DELETE /equipment-requests/905?isAdmin=true');
    T.eq('the tab closed, the portal shown', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId), 'customer-portal');

    T.section('a new request, customer quoting on: sent here (EquipRite only)');
    await page.click(visible('#cuRefresh'));
    await page.waitForTimeout(600);
    await page.click(visible('#cuNew'));
    await page.waitForSelector(visible('#coWhen'), { timeout: 20000 });
    await page.waitForTimeout(600);
    T.eq('in a tab of its own', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId + '=' + t.innerText.trim()), 'customer-order:new=New request');
    T.check('one customer and one contact: picked', (await env.text(visible('#coCustomer'))).includes(CUST) && (await env.text(visible('#coContact'))).includes('Maria Torres'));
    T.check('a quote is coming: no prices', (await env.text(visible('#coCatalog'))).includes('Rate on request'));
    await page.fill(visible('#coStart'), day(12));
    await page.dispatchEvent(visible('#coStart'), 'change');
    await page.fill(visible('#coEnd'), day(25));
    await page.dispatchEvent(visible('#coEnd'), 'change');
    await page.waitForTimeout(900);
    T.check('the catalog was asked for the dates and the customer', env.calls.some((c) => c.includes('equipment-catalog') && c.includes('startDate=' + day(12)) && c.includes('customerRefId=7')));
    T.check('what is not free cannot be added', await page.$eval(visible('.nx-grid--cucat [data-id="12"] button'), (b) => b.disabled));
    await page.click(visible('.nx-grid--cucat button[data-action="add"][data-id="11"]'));
    await page.waitForTimeout(200);
    await page.click(visible('#coReview'));
    await page.waitForSelector(visible('#coMissing'));
    T.eq('Review lists what is missing', await env.text(visible('#coMissing')), 'Still needed: Delivery address.');
    await page.fill(visible('#coAddress'), '1200 Pipeline Rd, Odessa TX 79761');
    await page.dispatchEvent(visible('#coAddress'), 'change');
    await page.click(visible('#coReview'));
    await page.waitForSelector(visible('#coTerms'));
    await page.waitForTimeout(800);
    T.check('Review: the catalog asked again with the delivery point', env.calls.some((c) => c.includes('equipment-catalog') && c.includes('latitude=31.85')));
    T.eq('Send waits for the terms', await page.$eval(visible('#coSubmit'), (b) => b.disabled), true);
    await page.check(visible('#coTermsChk'));
    await page.waitForTimeout(200);
    await env.shot('next-customer-new-request.png');
    env.writes.length = 0;
    await page.click(visible('#coSubmit'));
    await page.waitForFunction(() => document.querySelector('.nx-tab--on') && document.querySelector('.nx-tab--on').dataset.tabId === 'customer-request:901', null, { timeout: 20000 });
    await page.waitForTimeout(600);
    T.eq('send: New\'s customer submit, without a contract (quoting is on)', env.writes.map(short).join(' > '),
      'POST /equipment-requests > POST /ship-to-sites > PATCH /equipment-requests/901 > POST /equipment-requests/901/lines/batch > PATCH /equipment-requests/901');
    const hb = env.writes[0] && env.writes[0].body;
    T.eq('the header: a customer DRAFT with the customer columns', hb && [hb.requestType, hb.status, hb.eqrCustomerRefId, hb.customerName, hb.contactName, hb.eqrCustomerPortalUserId].join(' | '),
      'EXTERNAL | DRAFT | 7 | ' + CUST + ' | Maria Torres | 41');
    const lb = env.writes[3] && env.writes[3].body && env.writes[3].body.lines && env.writes[3].body.lines[0];
    T.eq('the line: IN_PROCESS, unpriced while a quote is coming', lb && [lb.lineStatus, lb.billRate == null ? 'no rate' : lb.billRate, lb.quantity].join(' | '), 'IN_PROCESS | no rate | 1');
    T.eq('then IN_PROCESS', JSON.stringify(env.writes[4] && env.writes[4].body), '{"status":"IN_PROCESS"}');
    T.check('no Fusion call', !env.calls.some((c) => /fscmRestApi|contracts/.test(c)));
  } catch (e) {
    T.check('customer run finished', false, e.stack || e.message);
    await env.shot('next-customer-failed.png').catch(() => {});
  }

  try {
    T.section('a new request, customer quoting off: the contract is made at send, so it is saved here and sent in New');
    quotes = 'NONE';
    seed();
    await env.open('/?open=customer-order');
    await page.waitForSelector(visible('#coWhen'), { timeout: 30000 });
    await page.waitForTimeout(800);
    T.check('prices show (no quote is coming)', (await env.text(visible('#coCatalog'))).includes('$1,400 / DAY'));
    await page.fill(visible('#coStart'), day(12));
    await page.dispatchEvent(visible('#coStart'), 'change');
    await page.fill(visible('#coEnd'), day(25));
    await page.dispatchEvent(visible('#coEnd'), 'change');
    await page.waitForTimeout(900);
    await page.click(visible('.nx-grid--cucat button[data-action="add"][data-id="11"]'));
    await page.fill(visible('#coAddress'), '1200 Pipeline Rd, Odessa TX 79761');
    await page.dispatchEvent(visible('#coAddress'), 'change');
    await page.waitForTimeout(200);
    T.check('the cart prices itself for the dates', (await env.text(visible('#coTotal'))).includes('$19,600'), await env.text(visible('#coTotal')));
    await page.click(visible('#coReview'));
    await page.waitForSelector(visible('#coHandOff'));
    await page.waitForTimeout(600);
    T.check('Send is not offered: it says why and what to do', !(await page.$(visible('#coSubmit'))) && (await env.text(visible('#coFusion'))).includes('creates your rental contract in Oracle Fusion'));
    await env.shot('next-customer-new-request-handoff.png');
    env.writes.length = 0;
    await page.click(visible('#coHandOff'));
    await page.waitForSelector(visible('#coSent'), { timeout: 20000 });
    await page.waitForTimeout(300);
    T.eq('saved as a draft (New\'s save draft), nothing sent, no contract', env.writes.map(short).join(' > '),
      'POST /equipment-requests > POST /ship-to-sites > PATCH /equipment-requests/901 > POST /equipment-requests/901/lines/batch');
    T.eq('… its lines DRAFT, priced', [env.writes[3].body.lines[0].lineStatus, env.writes[3].body.lines[0].billRate].join(' | '), 'DRAFT | 1400');
    T.eq('send it in New, on its Review', await page.getAttribute(visible('#coSendInNew'), 'href'), env.newUrl + '/vp/shell/customer/customer-new-request?draftId=901&startStep=3');
    T.eq('the tab is named after the draft', await page.$eval('.nx-tab--on', (t) => t.innerText.trim()), 'Draft EQR-000901');
    T.check('no Fusion call', !env.calls.some((c) => /fscmRestApi|contracts/.test(c)));
    T.check('no sideways scroll', await noSideways(page));
    T.eq('no browser errors (customer)', env.errors.filter((e) => !e.startsWith('warning')).join('\n'), '');
  } catch (e) {
    T.check('hand-off run finished', false, e.stack || e.message);
    await env.shot('next-customer-handoff-failed.png').catch(() => {});
  } finally {
    await env.close();
  }

  // ══ A manager ═════════════════════════════════════════════════════════════════════════════════════════════════
  quotes = 'CUSTOMER';
  seed();
  const mgr = await E.start({ port: 19390, handle, app: 'next', shots: process.env.E2E_SHOTS });
  try {
    T.section('a manager: the portal for customers, next to every other screen');
    await mgr.open('/?open=customer-portal');
    await mgr.page.waitForSelector(visible('#cuNeeds .nx-cu-need'), { timeout: 30000 });
    await mgr.page.waitForTimeout(500);
    T.eq('the portal tab, after My work', await mgr.page.$$eval('.nx-tab', (t) => t.map((x) => x.dataset.tabId).join()), 'home,customer-portal');
    T.check('the menu has every screen, the portal among them', (await mgr.page.$$eval('.nx-nav-item', (n) => n.map((x) => x.dataset.navId))).length > 10
      && !!(await mgr.page.$('.nx-nav-item[data-nav-id="customer-portal"].nx-nav-item--on')));
    T.check('the staff banner says they use the portal for customers', (await mgr.text(visible('#cuBehalf'))).includes('You are using the portal for customers'));
    T.eq('the same customer work', await mgr.page.$$eval('.nx-cu-need-title', (t) => t.length), 4);
    await mgr.shot('next-customer-manager.png');
    T.check('no sideways scroll (manager)', await noSideways(mgr.page));
    await mgr.page.setViewportSize({ width: 390, height: 900 });
    await mgr.page.waitForTimeout(500);
    T.check('no sideways scroll on a phone', await noSideways(mgr.page));
    await mgr.shot('next-customer-phone.png');
    T.eq('reads only (manager)', mgr.writes.length, 0);
    T.eq('no browser errors (manager)', mgr.errors.filter((e) => !e.startsWith('warning')).join('\n'), '');
  } catch (e) {
    T.check('manager run finished', false, e.stack || e.message);
    await mgr.shot('next-customer-manager-failed.png').catch(() => {});
  } finally {
    await mgr.close();
    T.report();
  }
})();
