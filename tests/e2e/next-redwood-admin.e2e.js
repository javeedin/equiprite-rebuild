'use strict';
/*
 * EquipRite Next, the Redwood look of the customer, admin and insights screens, in a real browser against fake data.
 * Redwood is chosen in your menu (env.setLook); each screen is then built from Oracle's own templates and components:
 *   - Customer portal: Oracle's general overview page as the header (greeting, summary, New request; Refresh and Export
 *     in its menu) over the portal's own body; its Requests view is Smart Search (a filter per column, then Show) over an
 *     oj-table with oj-badge statuses, as Old's customer My requests page; a row opens the request in its tab, as on Current
 *   - the customer's records (request, quote, invoices, new request): the general overview header with Oracle's badge, the
 *     current look's buttons and back to the portal
 *   - Settings, Access, Integrations, SQL worksheet, Analytics, EquipRite FDD: the general overview header with the current
 *     look's buttons (Save, Discard, Export, Check again, New connection, Refresh)
 * No browser errors; a screenshot of each screen; Current brings each screen's own look back.
 * Needs `npm run build`. Run: node tests/e2e/next-redwood-admin.e2e.js   (screenshots: /tmp/equiprite-e2e/rw-admin-*.png)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('./harness');
const H = require('../_harness');
const { fakeOracle } = require('./fake-oracle');

const T = H.makeAsserter();
const PORT = 19650;
const NOW = Date.now();
const day = (n) => new Date(NOW + n * 86400000).toISOString().slice(0, 10);
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const PDF = Buffer.from('%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj '
  + '3 0 obj<</Type/Page/MediaBox[0 0 300 144]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF').toString('base64');

// ── The customer's requests (as tests/e2e/next-customer.e2e.js) ─────────────────────────────────────────────────
const CUST = 'Lone Star Paving LLC';
const REQS = [
  { eqrEquipmentRequestId: 700, requestNumber: 'EQR-000700', requestStatus: 'IN_PROCESS', customerName: CUST, customerContact: 'Maria Torres',
    startDate: day(1) + 'T00:00:00Z', endDate: day(27) + 'T00:00:00Z', lines: 3, createdDate: day(-5) + 'T09:00:00Z', contractNumber: 'K-2026-0700' },
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
  deploymentLocation: '1200 Pipeline Rd, Odessa TX' }, extra || {});
const LINES = {
  700: [
    L(7001, 'CAT 320 Excavator', 'Excavators', 1, 'SHIP_TO_SITE', { billRate: 1400, priceUom: 'DAY', consumableFlag: 'N' }),
    L(7002, 'Dump truck 30 t', 'Trucks', 1, 'SHIP_TO_SITE', { billRate: 950, priceUom: 'DAY', consumableFlag: 'N' }),
    L(7003, 'Roller 10 t', 'Compaction', 1, 'PICK_RELEASED', { billRate: 700, priceUom: 'DAY' }),
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
const INVOICES = [
  { eqrBillingTransactionId: 1, eqrEquipmentRequestId: 520, eqrRequestLineId: 5201, invoiceNumber: 'INV-30871', status: 'PAID', grossAmount: 12140,
    billingPeriodStart: day(-24), billingPeriodEnd: day(-10), dueDate: day(5), transactionDate: day(-10) },
  { eqrBillingTransactionId: 2, eqrEquipmentRequestId: 520, eqrRequestLineId: 5202, invoiceNumber: 'INV-30902', status: 'POSTED', grossAmount: 6180,
    billingPeriodStart: day(-24), billingPeriodEnd: day(-10), dueDate: day(5), transactionDate: day(-10) },
];
const CATALOG = [
  { eqrEquipmentMasterId: 11, equipmentName: 'CAT 320 Excavator', className: 'Excavators', eqrEquipmentClassId: 1, isRentable: true, rate: 1400, rateUom: 'DAY' },
  { eqrEquipmentMasterId: 21, equipmentName: 'Traffic cones', className: 'Safety', eqrEquipmentClassId: 2, isRentable: false, unitPrice: 4 },
];

function customerHandle(req, res) {
  const p = req.path;
  if (p.endsWith('/conf-global-settings')) {
    return res.json({ data: ['PROJECTS_MODULE_ENABLED', 'CUSTOMERS_MODULE_ENABLED'].map((k) => ({ settingKey: k, settingValue: 'true', settingCategory: 'FEATURE_FLAG', isActiveFlag: 'Y' }))
      .concat([{ settingKey: 'ENABLE_QUOTES', settingValue: 'CUSTOMER', settingCategory: 'SYSTEM', isActiveFlag: 'Y' }]) });
  }
  if (p.endsWith('/views/customer-my-requests')) return res.json({ data: REQS });
  if (p.endsWith('/views/customer-request-details')) return res.json({ data: REQS.map((r) => Object.assign({}, r, { quoteDocument: undefined })) });
  if (p.endsWith('/views/customer-my-billing')) return res.json({ data: INVOICES });
  if (p.endsWith('/views/request-detail-lines')) return res.json({ data: LINES[req.query.get('requestId')] || [] });
  const one = /\/equipment-requests\/(\d+)$/.exec(p);
  if (one && req.method === 'GET') {
    const r = REQS.find((x) => x.eqrEquipmentRequestId === Number(one[1]));
    if (!r) return res.json({}, 404);
    return res.json({ id: r.eqrEquipmentRequestId, requestNumber: r.requestNumber, status: r.requestStatus, requestType: 'EXTERNAL', eqrCustomerRefId: 7,
      customerName: CUST, eqrCustomerPortalUserId: 41, contactName: 'Maria Torres', attribute1: '1200 Pipeline Rd, Odessa TX', deliveryLocationType: 'DELIVERY_LOCATION',
      requestedStartDate: r.startDate, requestedEndDate: r.endDate, shipToSiteId: 70 });
  }
  const lines2 = /\/equipment-requests\/(\d+)\/lines$/.exec(p);
  if (lines2 && req.method === 'GET') {
    return res.json({ data: (LINES[lines2[1]] || []).map((l) => ({ id: l.lineId, lineStatus: l.lineStatus, eqrEquipmentMasterId: l.eqrEquipmentMasterId, quantity: l.quantity })) });
  }
  if (p.endsWith('/customer-refs')) return res.json({ data: [{ id: 7, customerName: CUST }] });
  if (p.endsWith('/customer-portal-users')) return res.json({ data: [{ id: 41, contactName: 'Maria Torres', username: 'maria.torres', email: 'maria@lonestar.example' }] });
  if (p.endsWith('/views/equipment-catalog')) return res.json({ data: CATALOG });
  return undefined;
}

// ── Admin and insights (as tests/e2e/next-insights-admin.e2e.js, smaller) ──────────────────────────────────────
const SETTINGS = [
  { id: 1, settingKey: 'PROJECTS_MODULE_ENABLED', settingValue: 'true', settingCategory: 'FEATURE_FLAG', isActiveFlag: 'Y' },
  { id: 2, settingKey: 'CUSTOMERS_MODULE_ENABLED', settingValue: 'false', settingCategory: 'FEATURE_FLAG', isActiveFlag: 'Y' },
  { id: 3, settingKey: 'AGREEMENTS_ENABLED', settingValue: 'true', settingCategory: 'FEATURE_FLAG', isActiveFlag: 'Y' },
  { id: 4, settingKey: 'TIMESHEETS_ENABLED', settingValue: 'true', settingCategory: 'FEATURE_FLAG', isActiveFlag: 'Y' },
  { id: 6, settingKey: 'ENABLE_QUOTES', settingValue: 'CUSTOMER', settingCategory: 'SYSTEM', isActiveFlag: 'Y' },
  { id: 8, settingKey: 'WEEK_END_DAY', settingValue: 'FRIDAY', settingCategory: 'SYSTEM', isActiveFlag: 'Y' },
];
const ROLES = [
  { appRoleId: 1, roleCode: 'ADMIN', roleName: 'Administrator', isActive: 'Y' },
  { appRoleId: 2, roleCode: 'EQUIP_MANAGER', roleName: 'Equipment manager', isActive: 'Y' },
];
const MATRIX = {};
[1, 2].forEach((id) => {
  MATRIX[id] = [
    { pageCode: 'EQR_DASHBOARD', pageLabel: 'Dashboard', moduleCode: 'PROJECT_REQUESTOR', sortOrder: 1, accessLevel: 'FULL', isLocked: 'N' },
    { pageCode: 'EQR_WORKBENCH', pageLabel: 'Workbench', moduleCode: 'EQUIP_MANAGER', sortOrder: 10, accessLevel: 'FULL', isLocked: 'N' },
    { pageCode: 'EQR_ANALYTICS', pageLabel: 'Equipment analytics', moduleCode: 'ANALYTICS', sortOrder: 20, accessLevel: 'FULL', isLocked: 'N' },
  ].map((r) => Object.assign({ appRoleId: id }, r));
});
const STOCK = [
  { className: 'Excavators', equipmentName: 'CAT 320', unitNumber: 'EX-101', unitType: 'SERIAL', assetNumber: 'A-1', invOrgName: 'Atlanta', invOrgId: 1, unitStatus: 'AVAILABLE' },
  { className: 'Excavators', equipmentName: 'CAT 336', unitNumber: 'EX-103', unitType: 'SERIAL', assetNumber: 'A-5', invOrgName: 'Houston', invOrgId: 2, unitStatus: 'RENTED',
    projectName: 'Plant B', currentStartDate: day(-3) + 'T00:00:00Z', currentEndDate: day(20) + 'T00:00:00Z' },
  { className: 'Cranes', equipmentName: 'Grove RT', unitNumber: 'CR-7', unitType: 'SERIAL', assetNumber: 'A-3', invOrgName: 'Houston', invOrgId: 2, unitStatus: 'AVAILABLE' },
];
const groupsOf = (rows, field) => {
  const m = {};
  rows.forEach((r) => { const k = r[field]; m[k] = m[k] || { groupKey: k, count: 0 }; m[k].count++; });
  return Object.values(m);
};

function adminHandle(req, res) {
  const p = req.path;
  const q = req.query;
  if (p.endsWith('/conf-global-settings') && req.method === 'GET') return res.json({ data: SETTINGS });
  if (p.endsWith('/conf-equipment-settings') && req.method === 'GET') return res.json({ data: [] });
  if (p.endsWith('/finBusinessUnitsLOV')) return res.json({ items: [] });
  if (p.endsWith('/audit-trail')) return res.json({ data: [] });
  if (p.endsWith('/rbac/app-roles')) return res.json({ data: ROLES });
  if (p.endsWith('/rbac/page-access-matrix')) return res.json({ data: MATRIX[Number(q.get('appRoleId'))] || [] });
  if (p.endsWith('/integration-events')) {
    return res.json({ data: [{ id: 1, integrationCode: 'INT-11', status: 'FAILED', createdAt: ago(5), httpStatus: 401 }, { id: 4, integrationCode: 'INT-08', status: 'SUCCESS', createdAt: ago(30) }] });
  }
  if (p.endsWith('/error-logs')) return res.json({ data: [{ id: 7, integrationCode: 'INT-11', errorCode: 'EQR-API-002', httpStatus: 401, errorMessage: 'Unauthorized', severity: 'CRITICAL', createdAt: ago(12) }] });
  if (p.endsWith('/dead-letter-queue') || p.endsWith('/job-run-logs')) return res.json({ data: [] });
  if (p.endsWith('/fusion-sync/exceptions')) return res.json({ items: [] });
  if (p.endsWith('/fusion-sync/lock')) return res.json({ held: false });
  if (p.endsWith('/views/yard-stock')) {
    if (q.get('groupBy') === 'unitStatus') return res.json({ data: groupsOf(STOCK, 'unitStatus') });
    if (q.get('groupBy') === 'className') return res.json({ data: groupsOf(STOCK, 'className') });
    return res.json({ data: STOCK });
  }
  return undefined;
}

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────
const settle = (page, ms) => page.waitForTimeout(ms || 400);
const visible = (sel) => sel + ':visible';
/** Oracle's general overview page in a Redwood view: upgraded, shown, with its own header. */
const ready = (page, id) => page.waitForSelector('#' + id + ' oj-sp-general-overview-page.oj-complete >> visible=true', { timeout: 30000 });
/** Its header as shown: the title, all its text, its own buttons (primary and secondary shown as buttons, back). */
const header = (page, id) => page.$eval('#' + id + ' oj-sp-general-overview-page', (el) => {
  const shown = (b) => b.offsetParent !== null && getComputedStyle(b).visibility !== 'hidden';
  return {
    title: ((el.querySelector('h1') || {}).innerText || '').trim(),
    text: el.innerText.replace(/\s+/g, ' ').trim(),
    buttons: Array.from(el.querySelectorAll('oj-c-button, oj-button')).filter(shown).map((b) => b.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean),
  };
}).catch((e) => ({ title: '', text: 'missing: ' + e.message, buttons: [] }));
/** The secondary actions Oracle's header keeps in its menu (…), as listed when it opens. */
async function headerMenu(page, id) {
  const btn = await page.$('#' + id + ' oj-sp-general-overview-page oj-c-menu-button >> visible=true');
  if (!btn) return [];
  await btn.click();
  await page.waitForSelector('[role=menuitem] >> visible=true', { timeout: 5000 }).catch(() => {});
  await settle(page, 200);
  const items = await page.$$eval('[role=menuitem]', (els) => els.filter((e) => e.offsetParent !== null).map((e) => e.innerText.replace(/\s+/g, ' ').trim() + (e.getAttribute('aria-disabled') === 'true' ? ' (disabled)' : '')));
  await page.keyboard.press('Escape');
  await settle(page, 300);
  return items;
}
/** Takes a header action as a person does: its own button when the header shows one, else from Oracle's menu (…). */
async function headerAct(page, id, label) {
  const scope = '#' + id + ' oj-sp-general-overview-page';
  for (const b of await page.$$(scope + ' oj-c-button, ' + scope + ' oj-button')) {
    if (await b.isVisible() && (await b.innerText()).replace(/\s+/g, ' ').trim() === label) { await b.click(); return 'button'; }
  }
  const menu = await page.$(scope + ' oj-c-menu-button >> visible=true');
  if (menu) {
    await menu.click();
    const item = await page.waitForSelector('[role=menuitem][data-oj-label="' + label + '"] >> visible=true', { timeout: 5000 }).catch(() => null);
    if (item) { await item.click(); return 'menu'; }
    await page.keyboard.press('Escape');
  }
  return '';
}
const rows = (page, sel) => page.$$eval(sel + ' .oj-table-body-row', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
const numbers = async (page) => (await rows(page, '#cuRwTable')).map((r) => (r.match(/EQR-\d+/) || [''])[0]).join();
const tabOn = (page) => page.$eval('.nx-tab--on', (t) => t.dataset.tabId);
async function download(page, click) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), click()]);
  const file = path.join(os.tmpdir(), 'rw-admin-' + dl.suggestedFilename());
  await dl.saveAs(file);
  return { name: dl.suggestedFilename(), file };
}
const errs = (env) => env.errors.filter((e) => !/404|Failed to load resource/.test(e));
/** A screenshot of the screen as a person sees it: nothing focused, the mouse out of the way. */
async function shot(env, name) {
  await env.page.mouse.move(5, 500);
  await env.page.evaluate(() => { const a = document.activeElement; if (a && a !== document.body && a.blur) a.blur(); });
  await settle(env.page, 200);
  await env.shot(name);
}
const noSideways = (page) => page.evaluate(() => { const c = document.querySelector('.nx-content'); return !c || c.scrollWidth <= c.clientWidth + 1; });

(async () => {
  // ══ A customer: the portal and its records ════════════════════════════════════════════════════════════════════
  let env = await E.start({
    port: PORT, handle: customerHandle, app: 'next', sessionRole: 'EXTERNAL_REQUESTOR', username: 'maria.torres',
    access: { EQR_DASHBOARD: 'FULL', EQR_CUST_DASHBOARD: 'FULL', EQR_CUST_MY_REQUESTS: 'FULL', EQR_CUST_CREATE_REQ: 'FULL' },
  });
  let page = env.page;
  try {
    await env.open('/?open=customer-portal');
    await page.waitForSelector(visible('#cuNeeds .nx-cu-need'), { timeout: 30000 });
    await settle(page, 600);
    T.section('Current, to start');
    T.check('the portal\'s own head; no Redwood view on the page yet', await page.isVisible('.nx-cu .nx-pagehead') && !(await page.$('#cuRedwood')));

    T.section('Customer portal: Oracle\'s general overview page over the portal\'s own body');
    await env.setLook('redwood');
    await ready(page, 'cuRedwood');
    await settle(page, 800);
    const ph = await header(page, 'cuRedwood');
    T.check('the template is upgraded; the current head is gone', !(await page.$('.nx-cu .nx-pagehead')));
    T.check('its header: the greeting and the summary', ph.title.includes('Maria') && ph.text.includes(CUST + ' · 4 open requests · 3 things need you'), JSON.stringify(ph));
    T.eq('its button: New request (Oracle\'s primary action)', ph.buttons.join(' | '), 'New request');
    await shot(env, 'rw-admin-portal.png');
    T.eq('… and Refresh and Export in its menu', (await headerMenu(page, 'cuRedwood')).join(' | '), 'Refresh | Export to Excel');
    T.check('the portal\'s body below it: what needs you, the tiles, the views', (await env.text(visible('#cuNeeds'))).includes('Accept the quote for EQR-000610')
      && (await page.$$(visible('.nx-cu-tiles .nx-kpi'))).length === 4 && await page.isVisible('.nx-cu-views'));
    const reads = () => env.calls.filter((c) => c.includes('/views/customer-my-requests')).length;
    const before = reads();
    T.eq('Refresh, from the header\'s menu', await headerAct(page, 'cuRedwood', 'Refresh'), 'menu');
    await page.waitForFunction(() => true);
    await settle(page, 1500);
    T.check('… reads the requests again', reads() > before, before + ' → ' + reads());
    T.check('no sideways scroll', await noSideways(page));

    T.section('Customer portal, Requests: Smart Search over an oj-table, as Old\'s My requests');
    await page.click(visible('.nx-cu-views button[data-value="requests"]'));
    await page.waitForSelector('#cuRwRequests oj-sp-smart-search.oj-complete >> visible=true', { timeout: 20000 });
    await page.waitForFunction(() => /EQR-000377/.test((document.querySelector('#cuRwTable') || {}).innerText || ''), null, { timeout: 20000 });
    await page.waitForFunction(() => Array.from(document.querySelectorAll('#cuRwRequests oj-sp-smart-search .oj-sp-filter-chip-container'))
      .filter((x) => x.innerText.trim()).length === 6, null, { timeout: 15000 }).catch(() => {});
    await settle(page, 800);
    T.check('Oracle\'s components, upgraded: Smart Search, collection container, oj-table', await page.evaluate(() => ['oj-sp-smart-search', 'oj-sp-collection-container', 'oj-table']
      .every((t) => { const el = document.querySelector('#cuRwRequests ' + t); return el && el.classList.contains('oj-complete'); })));
    T.check('the current list steps aside', !(await page.$('.nx-grid--cureq')));
    T.eq('every request, as Smart Search has nothing picked (Old\'s list shows all), newest first', await numbers(page), 'EQR-000905,EQR-000700,EQR-000610,EQR-000520,EQR-000377');
    const r700 = (await rows(page, '#cuRwTable')).find((r) => r.includes('EQR-000700')) || '';
    T.check('a row: number and when raised, dates, where the equipment is, next, contract', ['Raised', 'Starts tomorrow', 'Partly shipped · 2 of 3', 'Accept the delivery when it arrives', 'K-2026-0700']
      .every((t) => r700.includes(t)), r700);
    T.eq('statuses are Oracle\'s oj-badge', await page.$$eval('#cuRwTable .oj-table-body-row .oj-badge', (b) => b.map((x) => x.innerText.trim()).join(' | ')),
      'Draft | Partly shipped · 2 of 3 | Quote ready for you | On site | Completed');
    T.eq('the filters are the columns, then Show', (await page.$$eval('#cuRwRequests oj-sp-smart-search .oj-sp-filter-chip-container', (b) => b.map((x) => x.innerText.trim()))).join(),
      'Request,Dates,Where your equipment is,Next,Contract,Show');
    T.eq('… and the table\'s columns', (await page.$$eval('#cuRwTable .oj-table-column-header-text', (h) => h.map((x) => x.innerText.trim()))).join(),
      'Request,Dates,Where your equipment is,Next,Contract');
    await page.click('#cuRwRequests oj-sp-smart-search .oj-sp-filter-chip-container:has-text("Show")');
    await page.waitForSelector('text=Finished (1)', { timeout: 10000 });
    T.eq('Show offers the portal\'s own chips, with how many requests each holds', await page.$$eval('[role=option], li', (o) => o.filter((x) => x.offsetParent !== null)
      .map((x) => x.innerText.trim()).filter((t) => /\(\d+\)$/.test(t)).join(' | ')), 'Needs you (2) | Open (4) | Finished (1) | All (5)');
    await page.click('text=Open (4)');
    await settle(page, 500);
    await page.click('#cuRedwood h1');
    await page.waitForFunction(() => !/EQR-000377/.test((document.querySelector('#cuRwTable') || {}).innerText || ''), null, { timeout: 10000 }).catch(() => {});
    await settle(page, 600);
    T.eq('Show: Open (it applies as its list closes): the open requests', await numbers(page), 'EQR-000905,EQR-000700,EQR-000610,EQR-000520');
    await page.click('#cuRwRequests oj-sp-smart-search .oj-sp-filter-chip-container:has-text("Contract")');
    await page.waitForSelector('text=K-2026-0520 (1)', { timeout: 10000 });
    await page.click('text=K-2026-0520 (1)');
    await settle(page, 500);
    await page.click('#cuRedwood h1');
    await page.waitForFunction(() => !/EQR-000905/.test((document.querySelector('#cuRwTable') || {}).innerText || ''), null, { timeout: 10000 }).catch(() => {});
    await settle(page, 600);
    T.eq('a column filter narrows the rows: Contract K-2026-0520', await numbers(page), 'EQR-000520');
    T.check('no sideways scroll; every column fits', await noSideways(page) && await page.$eval('#cuRwTable .oj-table-scroller', (sc) => sc.scrollWidth <= sc.clientWidth + 1));
    await shot(env, 'rw-admin-portal-requests.png');

    T.section('a row opens the request in its tab, as on Current');
    await page.click('#cuRwTable .nx-rw-num');
    await page.waitForFunction(() => (document.querySelector('.nx-tab--on') || {}).dataset.tabId === 'customer-request:520', null, { timeout: 15000 });
    T.eq('the request, in a tab named after it', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId + '=' + t.innerText.trim()), 'customer-request:520=EQR-000520');

    T.section('Customer request: the general overview header with Oracle\'s badge, over the request\'s own body');
    await ready(page, 'crRedwood');
    await page.waitForSelector(visible('#crStep'), { timeout: 20000 });
    await settle(page, 800);
    const rh = await header(page, 'crRedwood');
    T.check('the request, the customer and contact, where it stands as a badge', rh.title === 'EQR-000520' && rh.text.includes(CUST + ' · Maria Torres') && rh.text.includes('On site'),
      JSON.stringify(rh));
    T.check('the badge is Oracle\'s, in the header', await page.$eval('#crRedwood oj-sp-general-overview-page', (el) => /On site/.test((el.querySelector('[class*="badge"]') || {}).innerText || '')));
    await shot(env, 'rw-admin-request.png');
    T.eq('its buttons: the current look\'s Refresh, then the others in its menu', rh.buttons.join(' | ') + ' · ' + (await headerMenu(page, 'crRedwood')).join(' | '),
      'Refresh · Export to Excel | Quote | Invoices | In New EquipRite');
    T.check('the current head is gone; the next step and the equipment below', !(await page.$(visible('.nx-record .nx-pagehead'))) && await page.isVisible('#crStep'));
    const xl = await download(page, () => headerAct(page, 'crRedwood', 'Export to Excel'));
    T.check('Export to Excel: the request\'s equipment', /eqr-000520.*\.xlsx$/i.test(xl.name), xl.name);
    T.eq('Invoices, from the header: its invoices in a tab', await headerAct(page, 'crRedwood', 'Invoices'), 'menu');
    await page.waitForFunction(() => (document.querySelector('.nx-tab--on') || {}).dataset.tabId === 'invoice:520', null, { timeout: 15000 }).catch(() => {});
    T.eq('… the invoices tab', await tabOn(page), 'invoice:520');

    T.section('Invoices: the general overview header over the figures, each piece\'s invoices as an oj-table');
    await ready(page, 'ciRedwood');
    await page.waitForFunction(() => /INV-30871/.test((document.querySelector('oj-table[id^="ciRwInv"]') || {}).innerText || ''), null, { timeout: 20000 });
    await settle(page, 800);
    const ih = await header(page, 'ciRedwood');
    T.check('the request, Invoices, the contract', ih.title === 'EQR-000520' && ih.text.includes('Invoices · Contract K-2026-0520'), JSON.stringify(ih));
    T.eq('each piece\'s invoices: Oracle\'s oj-table, the status an oj-badge', await page.$$eval('oj-table[id^="ciRwInv"]', (ts) => ts.filter((t) => t.offsetParent !== null)
      .map((t) => t.id + ':' + t.classList.contains('oj-complete') + ':' + Array.from(t.querySelectorAll('.oj-table-body-row')).map((r) => r.querySelector('.oj-badge').innerText.trim()
        + ' ' + r.innerText.match(/INV-\d+/)[0]).join(',')).join(' | ')), 'ciRwInv5201:true:Paid INV-30871 | ciRwInv5202:true:To pay INV-30902');
    T.check('the current grid steps aside', !(await page.$(visible('.nx-grid--cuinvl'))));
    await shot(env, 'rw-admin-invoice.png');
    T.eq('Refresh, then the others in its menu', ih.buttons.join(' | ') + ' · ' + (await headerMenu(page, 'ciRedwood')).join(' | '), 'Refresh · Export to Excel | Track the request');
    const back = await page.$('#ciRedwood oj-sp-general-overview-page .oj-sp-header-general-overview-inflow-back-btn >> visible=true');
    T.check('back to the portal (in-flow back)', !!back);
    if (back) await back.click();
    await page.waitForFunction(() => (document.querySelector('.nx-tab--on') || {}).dataset.tabId === 'customer-portal', null, { timeout: 15000 }).catch(() => {});
    T.eq('… the portal\'s tab', await tabOn(page), 'customer-portal');

    T.section('Quote: the general overview header, its state as a badge');
    await page.click(visible('.nx-cu-views button[data-value="home"]'));
    await page.click(visible('.nx-cu-need--quote .nx-btn'));
    await page.waitForFunction(() => (document.querySelector('.nx-tab--on') || {}).dataset.tabId === 'quote:610', null, { timeout: 15000 });
    await ready(page, 'cqRedwood');
    await page.waitForSelector(visible('#cqState'), { timeout: 20000 });
    await settle(page, 800);
    const qh = await header(page, 'cqRedwood');
    T.check('Your quote, for which request, the customer; its state', qh.title === 'Your quote' && qh.text.includes('Quote for EQR-000610 · ' + CUST) && qh.text.includes('Ready for you'), JSON.stringify(qh));
    await shot(env, 'rw-admin-quote.png');
    T.eq('Refresh, then the others in its menu', qh.buttons.join(' | ') + ' · ' + (await headerMenu(page, 'cqRedwood')).join(' | '), 'Refresh · Export to Excel | Open the PDF | Download | The request');
    T.eq('The request, from the header', await headerAct(page, 'cqRedwood', 'The request'), 'menu');
    await page.waitForFunction(() => (document.querySelector('.nx-tab--on') || {}).dataset.tabId === 'customer-request:610', null, { timeout: 15000 }).catch(() => {});
    T.eq('… opens it in its tab', await tabOn(page), 'customer-request:610');

    T.section('New request: the general overview header over the steps');
    await page.click('.nx-tab[data-tab-id="customer-portal"] .nx-tab-btn');
    await page.waitForFunction(() => (document.querySelector('.nx-tab--on') || {}).dataset.tabId === 'customer-portal', null, { timeout: 10000 });
    await ready(page, 'cuRedwood');
    await settle(page, 800);
    T.eq('New request, the portal header\'s primary action', await headerAct(page, 'cuRedwood', 'New request'), 'button');
    await page.waitForFunction(() => (document.querySelector('.nx-tab--on') || {}).dataset.tabId === 'customer-order:new', null, { timeout: 15000 }).catch(() => {});
    T.eq('… opens a new request', await tabOn(page), 'customer-order:new');
    await ready(page, 'coRedwood');
    await page.waitForSelector(visible('#coWhen'), { timeout: 20000 });
    await settle(page, 800);
    const oh = await header(page, 'coRedwood');
    T.check('Request equipment, for whom', oh.title === 'Request equipment' && oh.text.includes(CUST), JSON.stringify(oh));
    T.check('the steps below it', await page.isVisible('#coWhen') && !(await page.$(visible('.nx-cu-order .nx-pagehead'))));
    await shot(env, 'rw-admin-order.png');

    T.check('no browser errors on the customer screens', errs(env).length === 0, errs(env).join(' | ').slice(0, 1500));

    T.section('Current: each customer screen\'s own look again');
    await page.click('.nx-tab[data-tab-id="customer-portal"] .nx-tab-btn');
    await env.setLook('current');
    await page.waitForSelector(visible('.nx-cu .nx-pagehead'), { timeout: 15000 });
    T.check('the portal\'s own head, the Redwood view kept but hidden', await page.isVisible('#cuGreeting') && !(await page.isVisible('#cuRedwood')));
    T.check('… and its own Requests list, its own Show untouched by Redwood\'s (Open, its default)', await (async () => {
      await page.click(visible('.nx-cu-views button[data-value="requests"]'));
      await page.waitForSelector(visible('.nx-grid--cureq .nx-row--click'), { timeout: 10000 });
      return !(await page.isVisible('#cuRwRequests')) && (await page.getAttribute(visible('.nx-chip[data-field="reqGroup"][data-value="open"]'), 'aria-pressed')) === 'true';
    })());
    await page.click('.nx-tab[data-tab-id="invoice:520"] .nx-tab-btn');
    await page.waitForSelector(visible('.nx-grid--cuinvl'), { timeout: 10000 }).catch(() => {});
    T.check('the invoices: their own head and grids again, the oj-tables hidden', await page.isVisible('#ciTitle') && (await page.$$(visible('.nx-grid--cuinvl'))).length === 2
      && !(await page.$(visible('.nx-cu-rwinv'))) && !(await page.isVisible('#ciRedwood')));
    T.check('no browser errors after switching back', errs(env).length === 0, errs(env).join(' | ').slice(0, 1500));
  } catch (e) {
    T.check('customer run finished', false, String((e && e.stack) || e).slice(0, 1500));
  } finally {
    await env.close();
  }

  // ══ An administrator: Settings, Access, Integrations, SQL, Analytics, FDD ═════════════════════════════════════════
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rw-admin-sql-'));
  const enc = (t) => Buffer.from('ENC:' + Buffer.from(t).toString('base64'));
  const dec = (b) => Buffer.from(b.toString().slice(4), 'base64').toString();
  const sqlStore = await require('../../desktop/lib/oracleSql').open({ file: path.join(tmp, 'sql-connections.json'), driver: fakeOracle({ password: 'secret' }), encrypt: enc, decrypt: dec });
  env = await E.start({ port: PORT, handle: adminHandle, app: 'next', sessionRole: 'ADMIN', sqlStore });
  page = env.page;
  const open = async (navId, sel) => {
    await page.click('.nx-nav-item[data-nav-id="' + navId + '"]');
    await page.waitForFunction((id) => (document.querySelector('.nx-tab--on') || {}).dataset.tabId === id, navId, { timeout: 15000 });
    if (sel) await page.waitForSelector(visible(sel), { timeout: 30000 });
  };
  try {
    await env.open('/?open=settings');
    await page.waitForSelector(visible('.nx-st-switch[data-key="TIMESHEETS_ENABLED"]'), { timeout: 30000 });
    await settle(page, 500);
    await env.setLook('redwood');

    T.section('Settings: the general overview header, Save and Discard there');
    await ready(page, 'stRedwood');
    await settle(page, 800);
    let h = await header(page, 'stRedwood');
    T.check('Settings, what it is', h.title === 'Settings' && h.text.includes('nothing is written until you save'), JSON.stringify(h));
    T.check('Save, disabled while nothing is staged', h.buttons.includes('Save') && await page.$eval('#stRedwood oj-sp-general-overview-page oj-c-button[id$="_primaryAction"]:not(.oj-flex-item)',
      (b) => b.disabled === true || b.hasAttribute('disabled') || !!b.querySelector('button[disabled], button[aria-disabled="true"]')));
    T.check('the current head is gone; the settings below', !(await page.$(visible('.nx-st .nx-pagehead'))) && await page.isVisible('.nx-st-switch[data-key="TIMESHEETS_ENABLED"]'));
    await page.click(visible('.nx-st-switch[data-key="TIMESHEETS_ENABLED"]'));
    await settle(page, 600);
    h = await header(page, 'stRedwood');
    T.check('a change staged: Save 1 change', h.buttons.includes('Save 1 change'), JSON.stringify(h.buttons));
    await shot(env, 'rw-admin-settings.png');
    T.eq('… and Discard, beside Export, in its menu', (await headerMenu(page, 'stRedwood')).join(' | '), 'Discard | Export to Excel');
    T.check('Discard, from the header', !!(await headerAct(page, 'stRedwood', 'Discard')));
    await page.waitForSelector('#stPending', { state: 'detached', timeout: 10000 }).catch(() => {});
    h = await header(page, 'stRedwood');
    T.check('… nothing staged any more', !(await page.$('#stPending')) && h.buttons.includes('Save') && !h.buttons.join().includes('Discard'), JSON.stringify(h.buttons));

    T.section('Access: the general overview header over the matrix');
    await open('access', '.nx-ac-cell');
    await ready(page, 'acRedwood');
    await settle(page, 800);
    h = await header(page, 'acRedwood');
    T.check('Access, what it is, Save', h.title === 'Access' && h.text.includes('Which screens each role can open') && h.buttons.includes('Save'), JSON.stringify(h));
    T.check('the legend reads light on the header\'s colour', /rgba?\(255, 255, 255/.test(await page.$eval('.nx-ac-legend strong', (s) => getComputedStyle(s).color)));
    await shot(env, 'rw-admin-access.png');
    const ax = await download(page, () => headerAct(page, 'acRedwood', 'Export to Excel'));
    T.check('Export to Excel, from the header: the matrix', /access.*\.xlsx$/.test(ax.name), ax.name);

    T.section('Integrations: the general overview header, Check again there');
    await open('integrations', '#ihAnswer');
    await ready(page, 'ihRedwood');
    await settle(page, 800);
    h = await header(page, 'ihRedwood');
    T.check('Integrations, when checked', h.title === 'Integrations' && /Checked /.test(h.text), JSON.stringify(h));
    await shot(env, 'rw-admin-integrations.png');
    const checks = () => env.calls.filter((c) => c.includes('/integration-events')).length;
    const c0 = checks();
    T.check('Check again, from the header', !!(await headerAct(page, 'ihRedwood', 'Check again')));
    await page.waitForFunction(() => true);
    await settle(page, 1500);
    T.check('… reads every integration again', checks() > c0, c0 + ' → ' + checks());

    T.section('SQL worksheet: the general overview header, New connection there');
    await open('sql', '#sqlNoConns');
    await ready(page, 'sqlRedwood');
    await settle(page, 800);
    h = await header(page, 'sqlRedwood');
    T.check('SQL worksheet, what it does', h.title === 'SQL worksheet' && h.text.includes('as in SQL Developer'), JSON.stringify(h));
    await shot(env, 'rw-admin-sql.png');
    T.eq('New connection, from the header', await headerAct(page, 'sqlRedwood', 'New connection'), 'button');
    await page.waitForSelector('#sqlDialog', { timeout: 10000 }).catch(() => {});
    T.check('… opens the connection dialog, as on Current', !!(await page.$('#sqlDialog')));
    await page.click('#sqlDialog .nx-dialog-head .nx-iconbtn').catch(() => page.keyboard.press('Escape'));
    await settle(page, 400);

    T.section('Analytics: the general overview header over the questions');
    await open('analytics', '#anAnswer');
    await ready(page, 'anRedwood');
    await settle(page, 800);
    h = await header(page, 'anRedwood');
    T.check('Analytics, the question open', h.title === 'Analytics' && h.text.includes('What is out, and what is sitting idle?'), JSON.stringify(h));
    await shot(env, 'rw-admin-analytics.png');
    const stock = () => env.calls.filter((c) => c.includes('/views/yard-stock')).length;
    const s0 = stock();
    T.check('Refresh, from the header', !!(await headerAct(page, 'anRedwood', 'Refresh')));
    await page.waitForFunction(() => true);
    await settle(page, 1500);
    T.check('… reads the fleet again', stock() > s0, s0 + ' → ' + stock());

    T.section('EquipRite FDD: the general overview header over its tabs');
    await open('fdd', '#fddReqSummary');
    await ready(page, 'fddRedwood');
    await settle(page, 800);
    h = await header(page, 'fddRedwood');
    T.check('EquipRite FDD, its version', h.title === 'EquipRite FDD' && h.text.includes('FDD v1.7'), JSON.stringify(h));
    T.check('its tabs sit on the page, below the header\'s colour', await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('.nx-fdd .fdd-tabs')).filter((t) => t.offsetParent !== null)[0];
      const pageEl = tabs && tabs.closest('.nx-page');
      return !!tabs && tabs.getBoundingClientRect().top - pageEl.getBoundingClientRect().top >= parseFloat(getComputedStyle(pageEl).getPropertyValue('--rw-banner-h'));
    }));
    await shot(env, 'rw-admin-fdd.png');
    const fx = await download(page, () => headerAct(page, 'fddRedwood', 'Export the requirements to Excel'));
    T.check('Export, from the header: the requirements', /fdd.*\.xlsx$/.test(fx.name), fx.name);

    T.check('no browser errors on the admin screens', errs(env).length === 0, errs(env).join(' | ').slice(0, 1500));

    T.section('Current: each admin screen\'s own look again');
    await env.setLook('current');
    await page.waitForSelector(visible('.nx-fdd .nx-pagehead'), { timeout: 15000 });
    T.check('the FDD\'s own head, Export menu and all', await page.isVisible('#fddExport') && !(await page.isVisible('#fddRedwood')));
    for (const [navId, root, own] of [['settings', 'stRedwood', '#stSave'], ['access', 'acRedwood', '#acSave'], ['integrations', 'ihRedwood', '#ihCheck'],
      ['sql', 'sqlRedwood', '#sqlNewConn'], ['analytics', 'anRedwood', '#anRefresh']]) {
      await open(navId);
      await page.waitForSelector(visible(own), { timeout: 10000 }).catch(() => {});
      T.check(navId + ': its own head again, the Redwood view hidden', await page.isVisible(own) && !(await page.isVisible('#' + root)));
    }
    T.check('no browser errors after switching back', errs(env).length === 0, errs(env).join(' | ').slice(0, 1500));
  } catch (e) {
    T.check('admin run finished', false, String((e && e.stack) || e).slice(0, 1500));
  } finally {
    await env.close();
  }
  T.report();
})();
