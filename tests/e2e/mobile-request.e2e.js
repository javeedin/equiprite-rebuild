'use strict';
/*
 * EquipRite Mobile, the Request tab, in a phone-sized browser (390 x 844), for a requester (EQR_PROJ_CREATE_REQUEST
 * FULL): where to start (your drafts, a request sent back, Order again), the dates and the catalog's picture cards free
 * and priced for them, the cart and its sheet, customer first then project and task from the BIP reports, the dates,
 * the delivery point (search on a map, tap the map, Use my location), Review, Submit (exactly what Next's submitChain
 * writes, in Next's order), See it in My requests, Save draft (and again, in place), a draft opened from a deep link,
 * a request sent back fixed from My requests, Order again, no connection (nothing sent, nothing lost), no sideways
 * scroll, no browser errors.
 * Needs `npm run build`. Run: node tests/e2e/mobile-request.e2e.js   (screenshots go to the OS temp folder)
 */
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();

// ── The stand-in backend: Next's New request answers (tests/e2e/next-order.e2e.js), plus your requests ────────────
const PIC = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">'
  + '<rect width="96" height="96" fill="#f6c343"/><rect x="14" y="52" width="58" height="20" rx="4" fill="#2e5468"/>'
  + '<path d="M40 52 L52 24 L78 30 L80 40 L56 36 L50 52 Z" fill="#2e5468"/><circle cx="26" cy="76" r="8" fill="#16212c"/>'
  + '<circle cx="60" cy="76" r="8" fill="#16212c"/></svg>').toString('base64');
const ROWS = [
  { eqrEquipmentMasterId: 11, equipmentName: 'CAT 320 Excavator', className: 'Excavators', subclassName: 'Crawler', eqrEquipmentClassId: 1, isRentable: true,
    rate: 1400, rateUom: 'DAY', periodAmount: 1400, periodType: 'DAILY', equipmentImage: PIC },
  { eqrEquipmentMasterId: 12, equipmentName: 'Mini Excavator 3.5t', className: 'Excavators', eqrEquipmentClassId: 1, isRentable: true, rate: 300, rateUom: 'DAY' },
  { eqrEquipmentMasterId: 21, equipmentName: 'Trench safety kit', className: 'Safety & consumables', eqrEquipmentClassId: 2, isRentable: false, unitPrice: 25 },
  { eqrEquipmentMasterId: 41, equipmentName: 'Wheel Loader 950', className: 'Loaders', eqrEquipmentClassId: 4, isRentable: true, rate: 950, rateUom: 'DAY',
    periodAmount: 5700, periodType: 'WEEKLY' },
];
const AVAIL = { 11: ['AVAILABLE', 3], 12: ['NOT AVAILABLE', 0], 21: ['PARTIAL QUANTITY', 40], 41: ['PARTIAL DURATION', 1] };
const SITE = '1200 Pipeline Rd, Odessa TX 79761';
const FOUND = '1200 Pipeline Rd, Odessa, Texas 79761, United States'; // the harness's Mapbox answer for every lookup
const ME = { requestorName: 'priya.raman', requestorUsername: 'priya.raman' };
const PROJECT = { projectRefId: 300000123, projectNumber: 'PRJ-2026-001', projectName: 'Pipeline North', projectBuName: 'EPC_US_BU', projectBuId: 300000001,
  taskId: 3, taskNumber: '2.1', taskName: 'Trenching', projectInternalCustomerId: 100000555, projectInternalCustomer: 'Acme Utilities' };
const head = (id, status, extra) => Object.assign({ id, requestNumber: 'REQ-' + id, status, requestType: 'INTERNAL', deliveryLocationType: 'DELIVERY_LOCATION',
  attribute1: SITE }, PROJECT, ME, extra);
const S = {
  next: 777,
  req: {
    2001: head(2001, 'IN_PROCESS', { requestedStartDate: '2026-09-01T00:00:00Z', requestedEndDate: '2026-09-20T00:00:00Z' }),
    2005: head(2005, 'DRAFT', { attribute2: 'Gate code 4417', shipToSiteId: 55, requestedStartDate: '2026-12-01T00:00:00Z', requestedEndDate: '2026-12-14T00:00:00Z' }),
    2006: head(2006, 'REJECTED', { attribute2: 'Needs a smaller loader', requestedStartDate: '2026-11-16T00:00:00Z', requestedEndDate: '2026-11-27T00:00:00Z' }),
  },
  lines: {
    2001: [{ id: 1, eqrEquipmentMasterId: 11, quantity: 1, name: 'CAT 320 Excavator', status: 'DEPLOYED' },
      { id: 2, eqrEquipmentMasterId: 21, quantity: 4, name: 'Trench safety kit', status: 'DEPLOYED' }],
    2005: [{ id: 3, eqrEquipmentMasterId: 41, quantity: 2, name: 'Wheel Loader 950', status: 'DRAFT' },
      { id: 4, eqrEquipmentMasterId: 99, quantity: 1, name: 'Old Roller', status: 'DRAFT' }],
    2006: [{ id: 5, eqrEquipmentMasterId: 41, quantity: 1, name: 'Wheel Loader 950', status: 'REJECTED', lineNotes: 'With operator' }],
  },
};
const BIP = []; // the BI Publisher SOAP bodies asked for
const listRow = (r) => ({ eqrEquipmentRequestId: r.id, requestNumber: r.requestNumber, status: r.status, projectName: r.projectName || '',
  requestorName: r.requestorName, requestorUsername: r.requestorUsername, startDate: String(r.requestedStartDate || '').slice(0, 10),
  endDate: String(r.requestedEndDate || '').slice(0, 10), requestOrigin: 'Internal', taskName: r.taskName || '' });
const lineRow = (r, l, i) => ({ requestNumber: r.requestNumber, lineId: l.id || i + 1, lineNumber: i + 1, equipmentName: l.name, qty: l.quantity, quantity: l.quantity,
  lineStatus: l.status || r.status, requestStatus: r.status, projectName: r.projectName || '' });

function handle(req, res) {
  const p = req.path.replace('/equiprite/v1', '');
  let m;
  if (p.endsWith('/views/equipment-catalog')) {
    const dated = req.query.get('startDate');
    const proj = req.query.get('projectRefId');
    return res.json({ data: ROWS.map((r) => Object.assign({}, r,
      dated ? { availabilityStatus: AVAIL[r.eqrEquipmentMasterId][0], availableQty: AVAIL[r.eqrEquipmentMasterId][1] } : {},
      proj && r.eqrEquipmentMasterId === 11 ? { rate: 1260, periodAmount: 1260 } : {})) });
  }
  if (p.endsWith('/ExternalReportWSSService')) {
    BIP.push(req.body);
    if (req.body.includes('EQP_PROJECTS_LOV_RP')) return res.bip([{ PROJECTID: 300000123, PROJECTNAME: 'Pipeline North', PROJECTNUMBER: 'PRJ-2026-001' },
      { PROJECTID: 300000124, PROJECTNAME: 'Harbour Wall', PROJECTNUMBER: 'PRJ-2026-002' }]);
    if (req.body.includes('EQP_CUSTOMERS_LOV_RP')) return res.bip([{ CUSTOMERID: 100000555, CUSTOMER: 'Acme Utilities', CUSTOMERNUMBER: 'C-1001' },
      { CUSTOMERID: 100000556, CUSTOMER: 'Bayou Energy', CUSTOMERNUMBER: 'C-1002' }]);
    if (req.body.includes('EQP_CONTRACTS_BY_PROJECT_LOV_RP')) return res.bip([{ CONTRACT_ID: 300000999, CONTRACT_NUMBER: 'K-77', STATUS: 'ACTIVE' }]);
    if (req.body.includes('EQP_SHIP_TO_SITES_BY_CONTRACT_LOV_RP')) return res.bip([{ SITE_ADDRESS: SITE, CUSTOMER_NAME: 'Acme Utilities' }]);
    return undefined;
  }
  if (/\/projects\/\d+\/child\/Tasks$/.test(p)) {
    return res.json({ items: [{ TaskId: 1, TaskNumber: '1', TaskName: 'Earthworks', ParentTaskId: null },
      { TaskId: 3, TaskNumber: '2.1', TaskName: 'Trenching', ParentTaskId: 1 }, { TaskId: 4, TaskNumber: '2.2', TaskName: 'Backfill', ParentTaskId: 1 }] });
  }
  if (/\/projects\/\d+$/.test(p)) return res.json({ ProjectId: 300000123, BusinessUnitId: 300000001, BusinessUnitName: 'EPC_US_BU' });
  if (p === '/views/my-requests') return res.json({ data: Object.values(S.req).map(listRow) });
  if (p === '/views/my-request-lines') {
    return res.json({ data: [].concat(...Object.values(S.req).map((r) => (S.lines[r.id] || []).filter((l) => l.eqrEquipmentMasterId !== 99).map((l, i) => lineRow(r, l, i)))) });
  }
  if (p === '/views/request-detail-lines') {
    const r = S.req[Number(req.query.get('requestId'))];
    return res.json({ data: r ? (S.lines[r.id] || []).map((l, i) => lineRow(r, l, i)) : [] });
  }
  if (p === '/request-status-history') return res.json({ data: [] });
  if (req.method === 'POST' && p === '/equipment-requests') {
    const id = S.next++;
    S.req[id] = Object.assign({}, req.json() || {}, { id, requestNumber: 'EQR-000' + id, status: 'DRAFT' });
    return res.json({ id, requestNumber: 'EQR-000' + id }, 201);
  }
  if (p === '/ship-to-sites') return res.json({ id: 56 }, 201);
  if ((m = /^\/equipment-requests\/(\d+)\/lines\/batch$/.exec(p))) {
    const r = S.req[Number(m[1])];
    if (r) {
      S.lines[r.id] = ((req.json() || {}).lines || []).map((l, i) => ({ id: i + 1, eqrEquipmentMasterId: l.eqrEquipmentMasterId, quantity: l.quantity,
        name: (ROWS.filter((x) => x.eqrEquipmentMasterId === l.eqrEquipmentMasterId)[0] || {}).equipmentName || 'Equipment', status: l.lineStatus }));
    }
    return res.json({ data: [] });
  }
  if ((m = /^\/equipment-requests\/(\d+)\/lines$/.exec(p))) {
    return res.json({ data: (S.lines[Number(m[1])] || []).map((l) => ({ id: l.id, eqrEquipmentMasterId: l.eqrEquipmentMasterId, quantity: l.quantity,
      lineNotes: l.lineNotes || null, lineStatus: l.status })) });
  }
  if ((m = /^\/equipment-requests\/(\d+)$/.exec(p))) {
    const r = S.req[Number(m[1])];
    if (req.method === 'PATCH') {
      if (r) Object.assign(r, req.json() || {});
      return res.json(r || {});
    }
    if (req.method === 'GET') return r ? res.json(r) : res.json({ message: 'not found' }, 404);
  }
  return undefined;
}

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────
const ACCESS = { EQR_PROJ_CREATE_REQUEST: 'FULL', EQR_EQUIPMENT_REQUESTS: 'FULL' };
const seq = (env) => env.writes.map((w) => w.method + ' ' + w.path.replace('/equiprite/v1', '')).join(' > ');
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const current = (page) => page.$eval('#mbTabbar .mb-tabbtn--on', (b) => b.dataset.tab).catch(() => '');
const ids = (page, sel) => page.$$eval(sel, (r) => r.map((x) => x.dataset.id || x.dataset.number).join());
const settle = (page, ms) => page.waitForTimeout(ms || 400);
// Chromium's own notes about WebGL while a screenshot reads the map's canvas; not the app's.
const appErrors = (errors) => errors.filter((e) => !/GL Driver Message/.test(e));

async function setDate(page, sel, value) {
  await page.fill(sel, value);
  await page.dispatchEvent(sel, 'change');
  await settle(page, 700);
}

/** What this phone keeps of the request being raised (offlineSnapshot 'request'). */
const kept = (page) => page.evaluate(() => {
  const v = localStorage.getItem('equiprite-mobile:request:priya.raman');
  return v ? JSON.parse(v).data : null;
});

/** A screenshot from the top of the screen. */
async function shot(env, name) {
  await env.page.evaluate(() => window.scrollTo(0, 0));
  await settle(env.page, 250);
  return env.shot(name);
}

(async () => {
  const env = await E.start({ port: 20800, app: 'mobile', handle, access: ACCESS, sessionRole: 'REQUESTOR', settings: { ENABLE_QUOTES: 'NONE' } });
  const { page } = env;
  const mapbox = [];
  page.on('request', (r) => { if (r.url().includes('api.mapbox.com/geocoding')) mapbox.push(r.url()); });
  try {
    T.section('opening the Request tab: where to start, nothing written');
    await env.open('/');
    await page.waitForSelector('#rqCatalog .mb-request-card', { timeout: 30000 });
    await page.waitForSelector('#rqDrafts .mb-item', { timeout: 15000 });
    await settle(page, 600);
    T.eq('a requester\'s tabs, opening on Request', [await page.$$eval('#mbTabbar .mb-tabbtn', (b) => b.map((x) => x.dataset.tab).join()), await current(page)].join(' / '),
      'request,track,me / request');
    T.eq('the title', await env.text('#rqTitle'), 'New request');
    T.eq('Next\'s three steps, each saying what it holds', await page.$$eval('#rqSteps .mb-request-step', (s) => s.map((x) => x.className.match(/--(\w+)/)[1] + ':'
      + x.innerText.replace(/\s+/g, ' ').trim()).join(' | ')), 'current:1 Equipment Nothing yet | todo:2 Project Not chosen | todo:3 Review');
    T.eq('carry on: your draft, and a request sent back to fix', await page.$$eval('#rqDrafts .mb-item', (b) => b.map((x) => x.dataset.number + ' '
      + x.querySelector('.mb-pill').innerText.trim()).join(', ')), 'REQ-2005 Draft, REQ-2006 Sent back');
    T.check('a draft says what is on it', (await env.text('#rqDrafts .mb-item[data-number="REQ-2005"]')).includes('2 pieces · Wheel Loader 950'));
    T.eq('order again: your past request (not the draft, not the one sent back)', await page.$$eval('#rqAgain button', (b) => b.map((x) => x.dataset.number).join()), 'REQ-2001');
    T.eq('the tab counts your drafts', await env.text('.mb-tabbtn[data-tab="request"] .mb-tabbadge'), '1');
    T.eq('the catalog as picture cards', await ids(page, '#rqCatalog .mb-request-card'), '11,12,21,41');
    T.check('a catalog picture where it has one, the class\'s letters where not',
      (await page.$eval('.mb-request-card[data-id="11"] .mb-request-pic img', (i) => i.getAttribute('src'))).startsWith('data:image/svg+xml')
      && (await env.text('.mb-request-card[data-id="12"] .mb-request-pic')) === 'E');
    T.check('dates first: the cards say to pick them', (await env.text('.mb-request-card[data-id="11"]')).includes('Pick dates')
      && (await env.text('#rqCatNote')).includes('pick the dates to see what is free') && !(await page.$('#rqFree')));
    T.eq('nothing is written on opening', env.writes.length, 0);
    T.eq('no sideways scroll', await sideways(page), false);
    await shot(env, 'mobile-request-start.png');

    T.section('step 1: the dates, the catalog for them, the cart');
    await setDate(page, '#rqStart', '2026-11-02');
    await page.click('#rqWhen .mb-chip[data-value="14"]');
    await settle(page, 700);
    T.eq('a quick length sets the end date in its input', await page.$eval('#rqEnd', (i) => i.value), '2026-11-15');
    await setDate(page, '#rqEnd', '2026-11-27');
    const card = (id) => env.text(`.mb-request-card[data-id="${id}"]`);
    T.check('free, the rate as quoted, one unit for the dates', /3 free[\s\S]*\$1,400 \/ day[\s\S]*\$36,400 · 26 days, each/.test(await card(11)), await card(11));
    T.check('a weekly price read as a week; partly free', (await card(41)).includes('$5,700 / week') && (await card(41)).includes('Some dates only'));
    T.check('not free: says so and cannot be added', (await card(12)).includes('Not free') && await page.$eval('.mb-request-card[data-id="12"] .mb-request-add', (b) => b.disabled));
    T.check('the catalog was asked for the dates', env.calls.some((c) => c.includes('equipment-catalog') && c.includes('startDate=2026-11-02') && c.includes('endDate=2026-11-27')
      && c.includes('requestedQty=1')));
    T.eq('the window under the dates', await env.text('#rqWindow'), 'Free and priced for 2 Nov – 27 Nov 2026 · 26 days.');
    await page.click('#rqFree');
    await settle(page);
    T.eq('free only', await ids(page, '#rqCatalog .mb-request-card'), '11,21,41');
    await page.click('#rqFree');
    await page.click('#rqChips .mb-chip[data-cls="Excavators"]');
    await settle(page);
    T.eq('a class', await ids(page, '#rqCatalog .mb-request-card'), '11,12');
    await page.click('#rqChips .mb-chip[data-cls="all"]');
    await page.fill('#rqSearch', 'loader');
    await settle(page);
    T.eq('search', await ids(page, '#rqCatalog .mb-request-card'), '41');
    await page.fill('#rqSearch', '');
    await settle(page);
    await page.click('.mb-request-card[data-id="11"] button[data-action="add"]');
    await page.click('.mb-request-card[data-id="11"] button[data-action="inc"]');
    await page.click('.mb-request-card[data-id="21"] button[data-action="add"]');
    await page.click('.mb-request-card[data-id="41"] button[data-action="add"]');
    await settle(page);
    T.eq('the stepper on the card', (await env.text('.mb-request-card[data-id="11"] .mb-request-stepper')).replace(/\s+/g, ' '), '− 2 +');
    T.eq('the cart count in the dock (pieces)', await env.text('#rqCartCount'), '4');
    T.eq('the steps say what step 1 holds', await env.text('#rqSteps .mb-request-step--current .mb-request-stepsub'), '4 pieces');
    T.eq('the drafts give way once the cart has something', [!!(await page.$('#rqDrafts')), !!(await page.$('#rqAgain'))].join(), 'false,false');
    T.eq('what is still needed', await env.text('#rqNeed'), 'Still needed: Customer, Project, Task and Delivery location.');
    T.check('kept on the phone as it goes', ((await kept(page)) || {}).cart.length === 3);
    await shot(env, 'mobile-request-equipment.png');
    await page.click('#rqCart');
    await page.waitForSelector('#rqCartSheet');
    await settle(page, 300);
    T.eq('the cart sheet', await env.text('#rqCartT'), 'Cart · 3 items · 4 pieces');
    await page.click('#rqCartSheet .mb-request-line[data-id="41"] button[data-action="remove"]');
    await settle(page, 300);
    T.eq('a line removed', await ids(page, '#rqCartLines .mb-request-line'), '11,21');
    T.eq('the total: 2 × $1,400 × 26 days + $25', await env.text('#rqCartTotal strong'), '$72,825');
    await page.click('#rqCartSheet .mb-request-line[data-id="11"] button[data-ui="line"]');
    await page.waitForSelector('#rqCartSheet .mb-request-line[data-id="11"] .mb-request-line-own');
    T.eq('a line takes the request\'s dates unless given its own', await page.$eval('#rqCartSheet .mb-request-line[data-id="11"] input[data-field="startDate"]', (i) => i.value), '2026-11-02');
    await page.fill('#rqCartSheet .mb-request-line[data-id="11"] input[data-field="notes"]', 'With operator');
    await page.dispatchEvent('#rqCartSheet .mb-request-line[data-id="11"] input[data-field="notes"]', 'change');
    await settle(page, 300);
    await page.click('#rqCartSheet .mb-request-line[data-id="21"] button[data-action="inc"]');
    await page.click('#rqCartSheet .mb-request-line[data-id="21"] button[data-action="dec"]');
    await settle(page, 300);
    T.eq('a sheet keeps to the screen\'s width', await sideways(page), false);
    await env.shot('mobile-request-cart.png');
    await page.click('#rqCartDone');
    await page.waitForSelector('#rqCartSheet', { state: 'detached' });

    T.section('step 2: the customer first, then project and task, the dates, the delivery');
    await page.click('#rqNext');
    await page.waitForSelector('#rqFor');
    await settle(page, 600);
    T.eq('step 1 is done, step 2 is current', await page.$$eval('#rqSteps .mb-request-step', (s) => s.map((x) => x.className.match(/--(\w+)/)[1]).join()), 'done,current,todo');
    T.eq('the customer first, then the project, the dates, the delivery', await page.$$eval('.mb-request-sec .mb-request-sectitle', (h) => h.map((x) => x.innerText.trim()).join(', ')),
      'Customer, Project, When, Delivery, Details');
    T.eq('the dates are here too', await page.$eval('#rqStart2', (i) => i.value) + ' – ' + await page.$eval('#rqEnd2', (i) => i.value), '2026-11-02 – 2026-11-27');
    await page.click('#rqNext');
    await settle(page);
    T.eq('Review stops and says what is missing, customer first', await env.text('#rqMissing'), 'Still needed: Customer, Project, Task and Delivery location.');
    T.eq('the task waits for the project', await page.$eval('#rqTask', (b) => b.disabled), true);
    await page.click('#rqCustomer');
    await page.waitForSelector('#rqPickSheet .mb-request-option');
    T.eq('customers listed from the BIP report before anything is typed', await page.$$eval('#rqPickList .mb-request-option strong', (o) => o.map((x) => x.innerText).join()),
      'Acme Utilities,Bayou Energy');
    T.eq('the note says where they come from', await env.text('#rqPickNote'), '2 customers from Oracle Fusion. Type a name or number to narrow it.');
    await env.shot('mobile-request-pick.png');
    await page.click('#rqPickList .mb-request-option[data-index="0"]');
    await page.waitForSelector('#rqPickSheet', { state: 'detached' });
    T.check('picked: the sheet closes on the customer', (await env.text('#rqCustomer')).includes('Acme Utilities'));
    await page.click('#rqProject');
    await page.waitForSelector('#rqPickSheet .mb-request-option');
    await page.fill('#rqPickSearch', 'pipe');
    await page.waitForFunction(() => /match/.test((document.querySelector('#rqPickNote') || {}).innerText || ''), null, { timeout: 10000 });
    T.check('typed text narrows the project report (asked with it, over name and number)', BIP.some((b) => b.includes('EQP_PROJECTS_LOV_RP')
      && b.includes('<pub:item>pipe</pub:item>') && b.includes('P_SEARCH_BY')));
    await page.click('#rqPickList .mb-request-option[data-index="0"]');
    await page.waitForSelector('#rqPickSheet', { state: 'detached' });
    await page.waitForFunction(() => /EPC_US_BU/.test((document.querySelector('#rqProject') || {}).innerText || ''), null, { timeout: 10000 });
    T.check('the project and its business unit', (await env.text('#rqProject')).includes('Pipeline North') && (await env.text('#rqProject')).includes('PRJ-2026-001 · EPC_US_BU'));
    T.check('the project\'s rate straight away', env.calls.some((c) => c.includes('equipment-catalog') && c.includes('projectRefId=300000123')));
    T.check('and says so', (await env.text('#rqPriceNote')).includes('1 price was updated for project PRJ-2026-001 and these dates.'));
    await page.click('#rqTask');
    await page.waitForSelector('#rqPickSheet .mb-request-option');
    T.eq('only chargeable tasks', await page.$$eval('#rqPickList .mb-request-option', (o) => o.map((x) => x.innerText.replace(/\s+/g, ' ').trim()).join(' | ')),
      '2.1 Trenching | 2.2 Backfill');
    await page.click('#rqPickList .mb-request-option[data-value="3"]');
    await page.waitForSelector('#rqPickSheet', { state: 'detached' });
    T.check('the task', (await env.text('#rqTask')).includes('2.1 Trenching'));
    await page.click('#rqContract .mb-chip[data-value="300000999"]');
    await settle(page);

    T.section('the delivery point: an address on a map, the map tapped, where you stand');
    await page.click('#rqMapOpen');
    await page.waitForSelector('#rqMapSheet');
    T.eq('a map sheet', await env.text('#rqMapT'), 'Where should it go?');
    T.eq('nothing picked yet: Use waits', await page.$eval('#rqMapUse', (b) => b.disabled), true);
    await page.waitForSelector('.mb-request-map canvas.mapboxgl-canvas, #rqMapError', { timeout: 15000 });
    const drawn = !!(await page.$('.mb-request-map canvas.mapboxgl-canvas'));
    T.check('the map is drawn (or says in words why it cannot be)', drawn || (await env.text('#rqMapError')).startsWith('The map could not be shown here'));
    await page.fill('#rqMapSearch', '1200 Pipeline');
    await page.waitForSelector('.mb-request-mapresult', { timeout: 10000 });
    T.eq('addresses found as you type', await env.text('.mb-request-mapresult'), FOUND);
    await page.click('.mb-request-mapresult');
    await settle(page, 300);
    T.check('picked: the address and its point', (await env.text('#rqMapPicked')).includes(FOUND) && (await env.text('#rqMapPicked')).includes('31.85000, -102.37000'));
    if (drawn) {
      await settle(page, 1500);
      const pin = await page.evaluate(() => {
        const mk = document.querySelector('.mb-request-map .mapboxgl-marker');
        const box = document.querySelector('.mb-request-map').getBoundingClientRect();
        if (!mk) return 'none';
        const r = mk.getBoundingClientRect();
        return r.width > 0 && r.left >= box.left && r.right <= box.right && r.top >= box.top && r.bottom <= box.bottom ? 'in' : 'out';
      });
      T.eq('the pin is on the map', pin, 'in');
      const box = await page.$eval('.mb-request-map', (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width * 0.25, y: r.top + r.height * 0.3 }; });
      await page.mouse.click(box.x, box.y);
      await page.waitForFunction(() => !/31\.85000, -102\.37000/.test((document.querySelector('#rqMapPicked') || {}).innerText || ''), null, { timeout: 10000 });
      T.check('a tap on the map moves the pin there, with its address', /\d+\.\d{5}, -\d+\.\d{5}/.test(await env.text('#rqMapPicked')), await env.text('#rqMapPicked'));
    }
    T.check('the map sheet keeps to the screen', !(await sideways(page)));
    await env.shot('mobile-request-map.png');
    await page.click('#rqMapUse');
    await page.waitForSelector('#rqMapSheet', { state: 'detached' });
    T.eq('the address is filled in', await page.$eval('#rqAddress', (i) => i.value), FOUND);
    T.check('and pinned', (await env.text('#rqPinned')).startsWith('Pinned on the map · '));
    await page.context().grantPermissions(['geolocation'], { origin: env.mobileUrl });
    await page.context().setGeolocation({ latitude: 29.7604, longitude: -95.3698 });
    await page.click('#rqLocate');
    await page.waitForSelector('#rqMapSheet');
    await page.waitForFunction(() => /29\.76040, -95\.36980/.test((document.querySelector('#rqMapPicked') || {}).innerText || ''), null, { timeout: 15000 });
    T.check('Use my location: the pin where the phone is, with the address there', (await env.text('#rqMapPicked')).includes(FOUND));
    T.check('the address there was looked up from the point', mapbox.some((u) => u.includes('/mapbox.places/-95.3698,29.7604.json')), mapbox.slice(-3).join(' '));
    await settle(page, 1200);
    await env.shot('mobile-request-locate.png');
    await page.click('#rqMapUse');
    await page.waitForSelector('#rqMapSheet', { state: 'detached' });
    T.eq('pinned where you stand', await env.text('#rqPinned'), 'Pinned on the map · 29.76040, -95.36980');
    await page.fill('#rqNotes textarea', 'Call the site lead before delivery');
    await page.press('#rqNotes textarea', 'Tab');
    await page.fill('#rqHours', '8');
    await page.dispatchEvent('#rqHours', 'change');
    await settle(page);
    T.check('nothing more is needed', !(await page.$('#rqNeed')) && !(await page.$('#rqMissing')));
    T.eq('nothing written', env.writes.length, 0);
    T.eq('no sideways scroll', await sideways(page), false);
    await shot(env, 'mobile-request-project.png');

    T.section('Review: the project\'s and the nearest yard\'s prices, then Submit');
    await page.click('#rqNext');
    await page.waitForSelector('#rqFacts');
    await settle(page, 800);
    T.check('asked again with the project and the delivery point', env.calls.some((c) => c.includes('equipment-catalog') && c.includes('projectRefId=300000123')
      && c.includes('latitude=29.7604')));
    const facts = await env.text('#rqFacts');
    T.check('everything in words', ['2 Nov – 27 Nov 2026 · 26 days', FOUND, 'Pinned on the map · 29.76040, -95.36980', 'PRJ-2026-001 Pipeline North · EPC_US_BU',
      '2.1 Trenching', 'Acme Utilities', 'K-77', 'priya.raman', '8'].every((x) => facts.includes(x)), facts);
    T.check('the notes', (await env.text('#rqCheck')).includes('Call the site lead before delivery'));
    T.check('each line, its price, its note', (await env.text('#rqLines')).includes('CAT 320 Excavator × 2') && (await env.text('#rqLines')).includes('$65,520')
      && (await env.text('#rqLines')).includes('Note: With operator'));
    T.eq('the estimate: 2 × $1,260 × 26 + $25', await env.text('#rqTotal strong'), '$65,545');
    T.check('what Submit does, before it is pressed', (await env.text('#rqWords')).includes('A new request with 2 lines goes to the project’s approver.'));
    T.eq('the dock: the cart, Save draft, Submit', await page.$$eval('#rqDock .mb-btn', (b) => b.map((x) => x.id).join()), 'rqCart,rqSaveDraft,rqSubmit');
    await shot(env, 'mobile-request-review.png');
    env.writes.length = 0;
    await page.click('#rqSubmit');
    await page.waitForSelector('#rqDone', { timeout: 20000 });
    await settle(page, 600);
    T.eq('writes: header, site, site link, lines, status (Next\'s order)', seq(env),
      'POST /equipment-requests > POST /ship-to-sites > PATCH /equipment-requests/777 > POST /equipment-requests/777/lines/batch > PATCH /equipment-requests/777');
    const hb = env.writes[0].body;
    T.eq('the header is created as DRAFT, INTERNAL, for the requester', [hb.status, hb.requestType, hb.projectRefId, hb.taskId, hb.projectBuName, hb.requestorUsername].join(),
      'DRAFT,INTERNAL,300000123,3,EPC_US_BU,priya.raman');
    T.eq('customer, contract, delivery, dates, hours, notes', [hb.projectInternalCustomerId, hb.projectContract, hb.deliveryLocationType, hb.attribute1,
      hb.requestedStartDate, hb.requestedEndDate, hb.defaultHours, hb.attribute2].join(' | '),
    '100000555 | K-77 | DELIVERY_LOCATION | ' + FOUND + ' | 2026-11-02T00:00:00Z | 2026-11-27T00:00:00Z | 8 | Call the site lead before delivery');
    const site = env.writes[1].body;
    T.eq('the ship-to-site at the pinned point (no second lookup of the words)', [site.latitude, site.longitude, site.address, site.equipmentRequestId].join(' | '),
      '29.7604 | -95.3698 | ' + FOUND + ' | 777');
    T.eq('the site is linked', JSON.stringify(env.writes[2].body), '{"shipToSiteId":56}');
    T.eq('lines: SUBMITTED, at the project rate, the estimate shown, the hours, the note', env.writes[3].body.lines.map((l) => [l.eqrEquipmentMasterId, l.quantity,
      l.lineStatus, l.billRate, l.priceUom, l.estimatedCost, l.defaultHours, l.startDate, l.lineNotes].join(':')).join(' | '),
    '11:2:SUBMITTED:1260:DAY:65520:8:2026-11-02T00:00:00Z:With operator | 21:1:SUBMITTED:25:EACH:25:8:2026-11-02T00:00:00Z:');
    T.eq('then the request waits for approval', JSON.stringify(env.writes[4].body), '{"status":"SUBMITTED"}');
    T.eq('a toast with its number', await env.text('#mbToast .mb-toast-text'), 'Request EQR-000777 was sent for approval.');
    T.check('it says what was sent and what happens next', (await env.text('#rqDone')).includes('EQR-000777') && (await env.text('#rqDone')).includes('waits for the project’s approver'));
    T.eq('nothing is kept on the phone any more', await kept(page), null);
    await shot(env, 'mobile-request-sent.png');
    await page.click('#rqSeeIt');
    await page.waitForSelector('#trDetail >> visible=true', { timeout: 20000 });
    T.eq('See it in My requests: there, on it', [await current(page), await env.text('#trNumber')].join(' / '), 'track / EQR-000777');
    await page.click('.mb-tabbtn[data-tab="request"]');
    await page.waitForSelector('#rqAnotherNew');
    await page.click('#rqAnotherNew');
    await page.waitForSelector('#rqWhen');
    T.check('Raise another: an empty request', (await page.$eval('#rqStart', (i) => i.value)) === '' && !(await page.$('#rqCartCount'))
      && (await env.text('#rqTitle')) === 'New request');

    T.section('Save draft, and again in place');
    await setDate(page, '#rqStart', '2026-12-07');
    await setDate(page, '#rqEnd', '2026-12-18');
    await page.click('.mb-request-card[data-id="41"] button[data-action="add"]');
    await settle(page);
    env.writes.length = 0;
    await page.click('#rqSaveDraft');
    await page.waitForSelector('#rqSaved', { timeout: 20000 });
    await settle(page, 600);
    T.eq('Save draft: header, lines (no address yet, so no site)', seq(env), 'POST /equipment-requests > POST /equipment-requests/778/lines/batch');
    T.check('the header DRAFT, its lines DRAFT, never SUBMITTED', env.writes[0].body.status === 'DRAFT' && env.writes[1].body.lines.every((l) => l.lineStatus === 'DRAFT'));
    T.eq('it is the draft now', await env.text('#rqTitle'), 'Draft EQR-000778');
    T.eq('the toast', await env.text('#mbToast .mb-toast-text'), 'Draft EQR-000778 was saved. Nothing was sent for approval.');
    await page.waitForFunction(() => (document.querySelector('.mb-tabbtn[data-tab="request"] .mb-tabbadge') || {}).innerText === '2', null, { timeout: 10000 });
    T.eq('the tab counts it', await env.text('.mb-tabbtn[data-tab="request"] .mb-tabbadge'), '2');
    env.writes.length = 0;
    await page.click('#rqSaveDraft');
    await page.waitForFunction(() => !document.querySelector('#rqSaveDraft').disabled && /Save draft/.test(document.querySelector('#rqSaveDraft').innerText), null, { timeout: 20000 });
    await settle(page, 400);
    T.eq('saved again: the same request, lines replaced', seq(env), 'PATCH /equipment-requests/778 > PUT /equipment-requests/778/lines/batch');
    T.check('... keeping its number and status', !('status' in env.writes[0].body) && !('requestNumber' in env.writes[0].body));
    await shot(env, 'mobile-request-draft.png');

    T.section('carry on with a draft from a deep link');
    env.writes.length = 0;
    await env.open('/?tab=request&number=REQ-2005');
    await page.waitForSelector('#rqReplaceSheet', { timeout: 30000 });
    await settle(page, 300);
    T.eq('the phone kept draft EQR-000778: it asks first', await env.text('#rqReplaceT'), 'Open draft REQ-2005?');
    T.check('saying what happens to the one here', (await env.text('#rqReplaceSheet')).includes('Draft EQR-000778 stays saved as it was last saved'));
    await env.shot('mobile-request-replace.png');
    await page.click('#rqReplace');
    await page.waitForFunction(() => (document.querySelector('#rqTitle') || {}).innerText === 'Draft REQ-2005', null, { timeout: 20000 });
    await page.waitForSelector('#rqFacts', { timeout: 20000 });
    await settle(page, 800);
    T.check('complete: it opens on Review, with its project, dates and notes', (await env.text('#rqFacts')).includes('Pipeline North') && (await env.text('#rqFacts')).includes('1 Dec – 14 Dec 2026')
      && (await env.text('#rqCheck')).includes('Gate code 4417'));
    T.check('priced from today\'s catalog; a line no longer there is said', (await env.text('#rqLines')).includes('Wheel Loader 950 × 2')
      && (await env.text('#rqPriceNote')).includes('1 line of the draft is no longer in the catalog'));
    T.eq('nothing written on reopening', env.writes.length, 0);
    await page.click('#rqSaveDraft');
    await page.waitForSelector('#rqSaved', { timeout: 20000 });
    await settle(page, 400);
    T.eq('Save draft: header PATCH, lines replaced (same address: no new site)', seq(env), 'PATCH /equipment-requests/2005 > PUT /equipment-requests/2005/lines/batch');
    T.check('the PATCH keeps the number and status, and its notes', !('status' in env.writes[0].body) && !('requestNumber' in env.writes[0].body)
      && env.writes[0].body.attribute2 === 'Gate code 4417');

    T.section('fix a request sent back, from My requests');
    await page.click('.mb-tabbtn[data-tab="track"]');
    await page.waitForSelector('#trList .mb-item >> visible=true', { timeout: 20000 });
    await page.click('#trChips .mb-chip[data-key="all"]');
    await settle(page);
    await page.click('#trList .mb-item[data-number="REQ-2006"]');
    await page.waitForSelector('#trContinue >> visible=true', { timeout: 10000 });
    T.eq('My requests offers to fix it', await env.text('#trContinue'), 'Fix it and send again');
    env.writes.length = 0;
    await page.click('#trContinue');
    await page.waitForSelector('#rqReplaceSheet', { timeout: 20000 });
    T.eq('in the Request tab, asking first (draft REQ-2005 is open)', [await current(page), await env.text('#rqReplaceT')].join(' / '), 'request / Fix REQ-2006?');
    await page.click('#rqReplace');
    await page.waitForSelector('#rqNotice', { timeout: 20000 });
    await page.waitForSelector('#rqFacts', { timeout: 20000 });
    await settle(page, 800);
    T.check('copied into a new request, saying so', (await env.text('#rqNotice')).startsWith('REQ-2006 was sent back. It is copied into a new request here')
      && (await env.text('#rqTitle')) === 'New request');
    T.check('with its dates, notes, project and equipment', (await env.text('#rqFacts')).includes('16 Nov – 27 Nov 2026') && (await env.text('#rqCheck')).includes('Needs a smaller loader')
      && (await env.text('#rqLines')).includes('Wheel Loader 950 × 1') && (await env.text('#rqLines')).includes('Note: With operator'));
    T.eq('nothing written', env.writes.length, 0);
    await shot(env, 'mobile-request-fix.png');
    await page.click('#rqSubmit');
    await page.waitForSelector('#rqDone', { timeout: 20000 });
    await settle(page, 400);
    T.eq('sent as a new request, in Next\'s order (the typed address looked up for its site)', seq(env),
      'POST /equipment-requests > POST /ship-to-sites > PATCH /equipment-requests/779 > POST /equipment-requests/779/lines/batch > PATCH /equipment-requests/779');
    T.check('REQ-2006 itself is not touched', env.writes.every((w) => !w.path.includes('/2006')));
    await page.click('#rqSeeIt');
    await page.waitForFunction(() => { const n = document.querySelector('#trNumber'); return n && n.offsetParent && n.innerText === 'EQR-000779'; }, null, { timeout: 20000 });
    T.eq('My requests, read again, shows the new one', await env.text('#trNumber'), 'EQR-000779');
    T.check('without a "not in your list" warning', !(await page.$('#mbToast.mb-toast--warning')));

    T.section('Order again');
    await page.click('.mb-tabbtn[data-tab="request"]');
    await page.click('#rqAnotherNew');
    await page.waitForSelector('#rqAgain button[data-number="REQ-2001"]', { timeout: 20000 });
    env.writes.length = 0;
    await page.click('#rqAgain button[data-number="REQ-2001"]');
    await page.waitForSelector('#rqNotice', { timeout: 20000 });
    await settle(page, 800);
    T.check('its equipment, project and delivery; new dates to pick', (await env.text('#rqNotice')).startsWith('Ordering again from REQ-2001')
      && (await page.$eval('#rqStart', (i) => i.value)) === '' && (await env.text('#rqCartCount')) === '5');
    T.eq('on the equipment step, the project already chosen', await page.$$eval('#rqSteps .mb-request-stepsub', (s) => s.map((x) => x.innerText).filter(Boolean).join(' | ')), '5 pieces | Pipeline North');
    T.eq('nothing written', env.writes.length, 0);
    await setDate(page, '#rqStart', '2026-12-01');
    await page.click('#rqWhen .mb-chip[data-value="7"]');
    await settle(page, 700);
    await page.click('#rqNext');
    await page.waitForSelector('#rqFor');
    T.check('the customer, project and task came with it', (await env.text('#rqCustomer')).includes('Acme Utilities') && (await env.text('#rqTask')).includes('2.1 Trenching')
      && (await page.$eval('#rqAddress', (i) => i.value)) === SITE);

    T.section('no connection: nothing sent, nothing lost');
    const before = env.errors.length;
    await page.context().setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.waitForSelector('#rqOffline', { timeout: 10000 });
    T.check('the dock says so', (await env.text('#rqOffline')).includes('this phone keeps what you enter'));
    env.writes.length = 0;
    await page.click('#rqSaveDraft');
    await page.waitForSelector('#rqSaveError', { timeout: 10000 });
    T.check('Save draft offline: says nothing was sent', (await env.text('#rqSaveError')).startsWith('No connection: nothing was sent.'));
    await page.fill('#rqNotes textarea', 'Typed with no signal');
    await page.press('#rqNotes textarea', 'Tab');
    await settle(page, 400);
    T.eq('nothing was sent', env.writes.length, 0);
    const offlineCopy = await kept(page);
    T.check('what was entered is on the phone', !!offlineCopy && offlineCopy.cart.length === 2 && offlineCopy.form.projectName === 'Pipeline North'
      && offlineCopy.form.notes === 'Typed with no signal');
    await shot(env, 'mobile-request-offline.png');
    await page.context().setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForSelector('#rqOffline', { state: 'detached', timeout: 10000 });
    T.check('back online: the message goes', !(await page.$('#rqSaveError')));
    env.errors.splice(before);
    await env.open('/');
    await page.waitForSelector('#rqNotice', { timeout: 30000 });
    await settle(page, 600);
    T.check('opened again: what was being raised is back', /What you were raising is back as you left it\. Saved on this phone at \d\d:\d\d\./.test(await env.text('#rqNotice')),
      await env.text('#rqNotice'));
    T.check('the cart, the project and the notes too', (await env.text('#rqCartCount')) === '5' && (await env.text('#rqSteps')).includes('Pipeline North')
      && (await page.$eval('#rqNotes textarea', (t) => t.value)) === 'Typed with no signal');

    T.section('layout');
    T.eq('no sideways scroll at 390 px', await sideways(page), false);
    await page.setViewportSize({ width: 320, height: 700 });
    await settle(page, 400);
    T.eq('nor at 320 px (step 2)', await sideways(page), false);
    await page.click('#rqSteps .mb-request-stepbtn[data-step="1"]');
    await settle(page, 600);
    T.eq('nor at 320 px (step 1, the catalog)', await sideways(page), false);
    await page.setViewportSize({ width: 390, height: 844 });
    T.eq('no browser errors', appErrors(env.errors).join(' | '), '');
  } catch (e) {
    T.check('run finished', false, e && e.stack);
    await env.shot('mobile-request-failure.png').catch(() => {});
  } finally {
    await env.close();
    T.report();
  }
})();
