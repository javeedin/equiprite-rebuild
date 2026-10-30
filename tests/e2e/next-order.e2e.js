'use strict';
/*
 * EquipRite Next, New request, in a real browser: dates first, the catalog with availability and prices for them, the
 * cart pricing itself, project / task / customer / contract site, Review (re-priced for the project and the nearest
 * yard), Submit for approval (exactly what is written, and the new request opening in its own tab); a saved draft
 * reopened in its own tab, saved in place and submitted; a customer request and a customer draft sent to New
 * EquipRite; the agreement hand-over; no sideways scroll (desk and phone); no browser errors.
 * Needs `npm run build`. Run: node tests/e2e/next-order.e2e.js   (screenshots go to the OS temp folder)
 */
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const ROWS = [
  { eqrEquipmentMasterId: 11, equipmentName: 'CAT 320 Excavator', className: 'Excavators', subclassName: 'Crawler', eqrEquipmentClassId: 1, isRentable: true,
    rate: 1400, rateUom: 'DAY', periodAmount: 1400, periodType: 'DAILY' },
  { eqrEquipmentMasterId: 12, equipmentName: 'Mini Excavator 3.5t', className: 'Excavators', eqrEquipmentClassId: 1, isRentable: true, rate: 300, rateUom: 'DAY' },
  { eqrEquipmentMasterId: 21, equipmentName: 'Trench safety kit', className: 'Safety & consumables', eqrEquipmentClassId: 2, isRentable: false, unitPrice: 25 },
  { eqrEquipmentMasterId: 41, equipmentName: 'Wheel Loader 950', className: 'Loaders', eqrEquipmentClassId: 4, isRentable: true, rate: 950, rateUom: 'DAY',
    periodAmount: 5700, periodType: 'WEEKLY' },
];
const AVAIL = { 11: ['AVAILABLE', 3], 12: ['NOT AVAILABLE', 0], 21: ['PARTIAL QUANTITY', 40], 41: ['PARTIAL DURATION', 1] };
const SITE = '1200 Pipeline Rd, Odessa TX 79761';
const DRAFT = { id: 888, requestNumber: 'EQR-000888', status: 'DRAFT', requestType: 'INTERNAL',
  projectRefId: 300000123, projectNumber: 'PRJ-2026-001', projectName: 'Pipeline North', projectBuName: 'EPC_US_BU', projectBuId: 300000001,
  taskId: 3, taskNumber: '2.1', taskName: 'Trenching', requestorName: 'John Dunbar', requestorUsername: 'john.dunbar',
  projectInternalCustomerId: 100000555, projectInternalCustomer: 'Acme Utilities', deliveryLocationType: 'DELIVERY_LOCATION',
  attribute1: SITE, attribute2: 'Gate code 4417', shipToSiteId: 55, requestedStartDate: '2026-12-01T00:00:00Z', requestedEndDate: '2026-12-14T00:00:00Z' };

function handle(req, res) {
  const p = req.path;
  if (p.endsWith('/views/equipment-catalog')) {
    const dated = req.query.get('startDate');
    const proj = req.query.get('projectRefId');
    const agr = req.query.get('agreementId');
    return res.json({ data: ROWS.map((r) => Object.assign({}, r,
      dated ? { availabilityStatus: AVAIL[r.eqrEquipmentMasterId][0], availableQty: AVAIL[r.eqrEquipmentMasterId][1] } : {},
      proj && r.eqrEquipmentMasterId === 11 ? { rate: 1260, periodAmount: 1260 } : {},
      agr && r.eqrEquipmentMasterId === 41 ? { billRate: 800, rateUom: 'DAY' } : {})) });
  }
  if (p.endsWith('/ExternalReportWSSService')) {
    if (req.body.includes('EQP_PROJECTS_LOV_RP')) return res.bip([{ PROJECTID: 300000123, PROJECTNAME: 'Pipeline North', PROJECTNUMBER: 'PRJ-2026-001' }]);
    if (req.body.includes('EQP_CUSTOMERS_LOV_RP')) return res.bip([{ CUSTOMERID: 100000555, CUSTOMER: 'Acme Utilities', CUSTOMERNUMBER: 'C-1001' }]);
    if (req.body.includes('EQP_CONTRACTS_BY_PROJECT_LOV_RP')) return res.bip([{ CONTRACT_ID: 300000999, CONTRACT_NUMBER: 'K-77', STATUS: 'ACTIVE' }]);
    if (req.body.includes('EQP_SHIP_TO_SITES_BY_CONTRACT_LOV_RP')) return res.bip([{ SITE_ADDRESS: SITE, CUSTOMER_NAME: 'Acme Utilities' }]);
    return undefined;
  }
  if (/\/projects\/\d+\/child\/Tasks$/.test(p)) return res.json({ items: [
    { TaskId: 1, TaskNumber: '1', TaskName: 'Earthworks', ParentTaskId: null },
    { TaskId: 3, TaskNumber: '2.1', TaskName: 'Trenching', ParentTaskId: 1 }] });
  if (/\/projects\/\d+$/.test(p)) return res.json({ ProjectId: 300000123, BusinessUnitId: 300000001, BusinessUnitName: 'EPC_US_BU' });
  if (req.method === 'POST' && p.endsWith('/equipment-requests')) return res.json({ id: 777, requestNumber: 'EQR-000777' }, 201);
  if (p.endsWith('/ship-to-sites')) return res.json({ id: 56 }, 201);
  if (/\/equipment-requests\/888$/.test(p) && req.method === 'GET') return res.json(DRAFT);
  if (/\/equipment-requests\/888\/lines$/.test(p)) return res.json({ data: [{ id: 1, eqrEquipmentMasterId: 41, quantity: 2 }, { id: 2, eqrEquipmentMasterId: 99, quantity: 1 }] });
  if (/\/equipment-requests\/889$/.test(p) && req.method === 'GET') return res.json({ id: 889, requestNumber: 'EQR-000889', status: 'DRAFT', requestType: 'EXTERNAL' });
  const m = /\/equipment-requests\/(\d+)$/.exec(p);
  if (m && req.method === 'GET') return res.json({ id: Number(m[1]), requestNumber: 'EQR-000' + m[1], status: 'SUBMITTED', requestType: 'INTERNAL', projectName: 'Pipeline North' });
  if (p.endsWith('/views/request-detail-lines')) {
    return res.json({ data: [{ lineId: 1, lineNumber: 1, equipmentName: 'CAT 320 Excavator', className: 'Excavators', quantity: 2, lineStatus: 'SUBMITTED',
      requestStatus: 'SUBMITTED', requestNumber: 'EQR-000' + req.query.get('requestId'), projectName: 'Pipeline North' }] });
  }
  return undefined;
}

const seq = (env) => env.writes.map((w) => w.method + ' ' + w.path.replace('/equiprite/v1', '')).join(' > ');
const vis = (sel) => sel + ' >> visible=true';

async function setDate(page, sel, value) {
  await page.fill(vis(sel), value);
  await page.dispatchEvent(vis(sel), 'change');
  await page.waitForTimeout(700);
}

/** The page's own area scrolls only up and down (the shell's top bar is the shell's). */
async function noSideways(page) {
  return page.evaluate(() => {
    const c = document.querySelector('.nx-content');
    const p = Array.prototype.filter.call(document.querySelectorAll('.nx-order'), (el) => el.offsetParent !== null)[0];
    return !!c && !!p && c.scrollWidth <= c.clientWidth + 1 && p.scrollWidth <= p.clientWidth + 1;
  });
}

/** A screenshot of the whole page: the shell scrolls inside .nx-content, so the window is made tall for it. */
async function shot(env, name) {
  const h = await env.page.evaluate(() => {
    const c = document.querySelector('.nx-content');
    if (c) c.scrollTop = 0;
    return c ? c.scrollHeight + 160 : 1000;
  });
  const size = env.page.viewportSize();
  await env.page.setViewportSize({ width: size.width, height: Math.min(Math.max(h, 900), 4000) });
  await env.page.waitForTimeout(300);
  await env.shot(name);
  await env.page.setViewportSize(size);
  await env.page.waitForTimeout(200);
}

(async () => {
  const env = await E.start({ port: 19300, handle, app: 'next', settings: { ENABLE_QUOTES: 'NONE' } });
  const { page } = env;
  try {
    T.section('opening it: nothing written, browse mode');
    await env.open('/?open=new-request');
    await page.waitForSelector(vis('.nx-or-card[data-id="11"]'), { timeout: 30000 });
    await page.waitForTimeout(400);
    T.eq('a tab of its own', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId + '=' + t.innerText.trim()), 'new-request=New request');
    T.eq('the title', await env.text(vis('#orTitle')), 'New request');
    T.eq('New EquipRite\'s three steps, on the first', await page.$$eval(vis('.nx-or-stepbtn'), (b) => b.map((x) => x.innerText.replace(/\s+/g, ' ').trim() + ':' + x.className.match(/--(\w+)/)[1]).join(' | ')),
      '1 Equipment:current | 2 Project:todo | 3 Review & submit:todo');
    T.eq('project or customer request beside them', await env.text(vis('.nx-or-for')), 'Project request Customer request');
    T.check('the catalog as cards, a picture box on each', !!(await page.$(vis('.nx-or-card[data-id="11"] .nx-or-pic'))) && (await env.text(vis('.nx-or-card[data-id="11"] .nx-or-add'))) === 'Add to cart');
    T.check('dates first: the catalog says to pick them', (await env.text(vis('.nx-or-card[data-id="11"]'))).includes('Pick dates')
      && (await env.text(vis('#orCatNote'))).includes('pick the dates to see what is free'));
    T.eq('"free only" waits for the dates', await page.$eval(vis('#orFreeOnly'), (b) => b.disabled), true);
    T.check('an empty cart says how to start', (await env.text(vis('#orRail'))).includes('Add equipment from the catalog') && !(await page.$(vis('#orNeed'))));
    T.eq('nothing is written on entry', env.writes.length, 0);

    T.section('dates: availability and prices for them');
    await setDate(page, '#orStart', '2026-11-02');
    await page.click(vis('.nx-or-lengths .nx-chip[data-value="14"]'));
    await page.waitForTimeout(700);
    T.eq('a quick length sets the end date', await page.$eval(vis('#orEnd'), (i) => i.value), '2026-11-15');
    await setDate(page, '#orEnd', '2026-11-27');
    const row = async (id) => env.text(vis(`.nx-or-card[data-id="${id}"]`));
    T.check('free, the rate as quoted, one unit for the dates', /3 free.*\$1,400 \/ day.*\$36,400.*26 days, each/.test(await row(11)), await row(11));
    T.check('weekly price read as a week', (await row(41)).includes('$5,700 / week') && (await row(41)).includes('Some dates only'));
    T.check('a consumable is per unit', (await row(21)).includes('$25 / unit') && (await row(21)).includes('Only 40 free'));
    T.check('not free: says so and cannot be added', (await row(12)).includes('Not free') && await page.$eval(vis('.nx-or-card[data-id="12"] .nx-or-add'), (b) => b.disabled));
    T.check('the catalog was asked for the dates', env.calls.some((c) => c.includes('equipment-catalog') && c.includes('startDate=2026-11-02') && c.includes('endDate=2026-11-27') && c.includes('requestedQty=1')));
    T.check('the window under the dates', (await env.text(vis('#orWindow'))).includes('2 Nov – 27 Nov 2026 · 26 days'));

    T.section('the catalog: free only, class, search');
    await page.check(vis('#orFreeOnly'));
    await page.waitForTimeout(300);
    T.eq('free on these dates only', await page.$$eval(vis('.nx-or-card[data-id]'), (r) => r.map((x) => x.dataset.id).join()), '11,21,41');
    await page.uncheck(vis('#orFreeOnly'));
    await page.click(vis('.nx-or-class[data-cls="Excavators"]'));
    await page.waitForTimeout(300);
    T.eq('a class', await page.$$eval(vis('.nx-or-card[data-id]'), (r) => r.map((x) => x.dataset.id).join()), '11,12');
    await page.click(vis('.nx-or-class[data-cls="all"]'));
    await page.fill(vis('#orCatSearch'), 'loader');
    await page.waitForTimeout(300);
    T.eq('search', await page.$$eval(vis('.nx-or-card[data-id]'), (r) => r.map((x) => x.dataset.id).join()), '41');
    await page.fill(vis('#orCatSearch'), '');
    await page.waitForTimeout(300);

    T.section('the cart prices itself');
    await page.click(vis('.nx-or-card[data-id="11"] button[data-action="add"]'));
    await page.click(vis('.nx-or-card[data-id="11"] button[data-action="inc"]'));
    await page.click(vis('.nx-or-card[data-id="21"] button[data-action="add"]'));
    await page.waitForTimeout(300);
    T.eq('the stepper on the card', (await env.text(vis('.nx-or-card[data-id="11"] .nx-or-stepper'))).replace(/\s+/g, ' '), '− 2 in cart +');
    T.eq('the cart rail, as New\'s', await env.text(vis('#orCartT')), 'Cart · 2 items · 3 pieces');
    T.eq('the total: 2 × $1,400 × 26 days + $25', await env.text(vis('#orTotal strong')), '$72,825');
    T.eq('the rail says what is still needed', await env.text(vis('#orNeed')), 'Still needed: Project, Task, Customer and Delivery location.');
    await shot(env, 'next-order-build.png');
    T.eq('step 1 goes on to the project', await env.text(vis('#orContinue')), 'Continue to project');
    await page.click(vis('#orContinue'));
    await page.waitForSelector(vis('#orProject'));
    T.eq('step 2: the project', await page.$eval(vis('.nx-or-stepbtn--current'), (b) => b.dataset.step), '2');
    T.eq('step 1 is marked done', await page.$eval(vis('.nx-or-stepbtn[data-step="1"]'), (b) => b.className.includes('--done')), true);
    await page.click(vis('#orContinue'));
    await page.waitForTimeout(300);
    T.eq('Review stops and says what is missing', await env.text(vis('#orMissing')), 'Still needed: Project, Task, Customer and Delivery location.');
    T.check('still on the project step', !!(await page.$(vis('#orFor'))));

    T.section('project, task, customer, contract site');
    await page.fill(vis('input[data-kind="project"]'), 'pipe');
    await page.click(vis('.nx-or-option[data-kind="project"][data-index="0"]'));
    await page.waitForSelector(vis('.nx-or-option[data-field="taskId"]'));
    T.eq('only chargeable tasks', await page.$$eval(vis('.nx-or-option[data-field="taskId"]'), (r) => r.length), 1);
    await page.click(vis('.nx-or-option[data-field="taskId"]'));
    await page.waitForTimeout(300);
    T.check('the project and its business unit', (await env.text(vis('#orProject'))).includes('Pipeline North') && (await env.text(vis('#orProject'))).includes('EPC_US_BU'));
    T.check('the project\'s rate straight away', env.calls.some((c) => c.includes('equipment-catalog') && c.includes('projectRefId=300000123')));
    T.eq('the cart follows: 2 × $1,260 × 26 + $25', await env.text(vis('#orTotal strong')), '$65,545');
    T.check('and says so', (await env.text(vis('#orPriceNote'))).includes('1 price was updated for project PRJ-2026-001 and these dates.'));
    await page.click(vis('button[data-field="contractId"][data-value="300000999"]'));
    await page.fill(vis('input[data-kind="customer"]'), 'acme');
    await page.click(vis('.nx-or-option[data-kind="customer"][data-index="0"]'));
    await page.click(vis('button[data-field="locationType"][data-value="PROJECT_SITE"]'));
    await page.click(vis('button[data-field="siteAddress"]'));
    await page.waitForTimeout(300);
    T.check('nothing more is needed', !(await page.$(vis('#orNeed'))));
    await page.fill(vis('#orNotes textarea'), 'Call the site lead before delivery');
    await page.press(vis('#orNotes textarea'), 'Tab');
    await page.fill(vis('#orHours'), '8');
    await page.dispatchEvent(vis('#orHours'), 'change');
    await shot(env, 'next-order-project.png');

    T.section('Review: the nearest yard\'s and the project\'s prices, then what Submit does');
    await page.click(vis('#orContinue'));
    await page.waitForSelector(vis('#orFacts'));
    await page.waitForTimeout(800);
    T.check('asked again with the project and the delivery point', env.calls.some((c) => c.includes('equipment-catalog') && c.includes('projectRefId=300000123') && c.includes('latitude=31.85')));
    const facts = await env.text(vis('#orFacts'));
    T.check('the facts', ['PRJ-2026-001 Pipeline North · EPC_US_BU', '2.1 Trenching', 'Acme Utilities', 'K-77', SITE + ' (contract site)', 'priya.raman'].every((x) => facts.includes(x)), facts);
    T.check('the notes are on Review', (await env.text(vis('#orCheck'))).includes('Call the site lead before delivery'));
    await page.fill(vis('.nx-or-rline[data-id="21"] input[type="number"]'), '10');
    await page.dispatchEvent(vis('.nx-or-rline[data-id="21"] input[type="number"]'), 'change');
    await page.waitForTimeout(300);
    T.eq('a consumable is qty × unit price', await env.text(vis('.nx-or-rline[data-id="21"] .nx-or-rline-cost strong')), '$250');
    T.check('Submit says what it does', (await env.text(vis('#orRail'))).includes('A new request with 2 lines goes to the project\'s approver'));
    await shot(env, 'next-order-review.png');
    env.writes.length = 0;
    await page.click(vis('#orSubmit'));
    await page.waitForFunction(() => { const t = document.querySelector('.nx-tab--on'); return t && t.dataset.tabId === 'request:777'; }, null, { timeout: 20000 });
    await page.waitForTimeout(800);
    T.eq('writes: header, site, site link, lines, status', seq(env),
      'POST /equipment-requests > POST /ship-to-sites > PATCH /equipment-requests/777 > POST /equipment-requests/777/lines/batch > PATCH /equipment-requests/777');
    const head = env.writes[0].body;
    T.eq('the header is created as DRAFT, INTERNAL', [head.status, head.requestType, head.projectRefId, head.taskId, head.projectBuName].join(), 'DRAFT,INTERNAL,300000123,3,EPC_US_BU');
    T.eq('customer, contract, delivery, dates, hours, notes', [head.projectInternalCustomerId, head.projectContract, head.deliveryLocationType, head.attribute1,
      head.requestedStartDate, head.requestedEndDate, head.defaultHours, head.attribute2].join(' | '),
    '100000555 | K-77 | PROJECT_SITE | ' + SITE + ' | 2026-11-02T00:00:00Z | 2026-11-27T00:00:00Z | 8 | Call the site lead before delivery');
    T.eq('the site is linked', JSON.stringify(env.writes[2].body), '{"shipToSiteId":56}');
    const lines = env.writes[3].body.lines;
    T.eq('lines: SUBMITTED, at the project rate, the estimate shown, the hours', lines.map((l) => [l.eqrEquipmentMasterId, l.quantity, l.lineStatus, l.billRate, l.priceUom,
      l.estimatedCost, l.defaultHours, l.startDate].join(':')).join(' | '),
    '11:2:SUBMITTED:1260:DAY:65520:8:2026-11-02T00:00:00Z | 21:10:SUBMITTED:25:EACH:250:8:2026-11-02T00:00:00Z');
    T.eq('then the request waits for approval', JSON.stringify(env.writes[4].body), '{"status":"SUBMITTED"}');
    await page.waitForSelector(vis('.nx-record-title'), { timeout: 20000 });
    T.eq('the new request in its own tab', await page.$eval('.nx-tab--on', (t) => t.innerText.trim()), 'EQR-000777');
    await page.click('.nx-tab-btn[data-id="new-request"]');
    await page.waitForTimeout(500);
    T.check('back on New request: it says what was sent', (await env.text(vis('#orSent'))).includes('EQR-000777 was sent for approval'));
    T.check('and starts a new one', (await page.$eval(vis('#orStart'), (i) => i.value)) === '' && (await env.text(vis('#orRail'))).includes('Add equipment from the catalog'));
    await shot(env, 'next-order-sent.png');

    T.section('a customer request is raised in New EquipRite');
    await page.click(vis('button[data-field="requestFor"][data-value="customer"]'));
    await page.waitForSelector(vis('#orCustomer'));
    const cust = await env.text(vis('#orCustomer'));
    T.check('what it needs: customer and contact, terms, a Fusion sell contract', cust.includes('The customer and their contact') && cust.includes('rental terms')
      && cust.includes('A Fusion sell contract') && cust.includes('made in Fusion when it is submitted'), cust);
    T.eq('a link to New EquipRite\'s customer New request', await page.getAttribute(vis('#orCustomerNew'), 'href'), env.newUrl + '/vp/shell/customer/customer-new-request');
    await shot(env, 'next-order-customer.png');
    await page.click(vis('#orCustomer button[data-value="project"]'));
    await page.waitForSelector(vis('#orWhen'));

    T.section('a saved draft reopens in its own tab and is saved in place');
    env.writes.length = 0;
    await env.open('/?open=draft&id=888');
    await page.waitForSelector(vis('.nx-or-line'), { timeout: 30000 });
    await page.waitForTimeout(800);
    T.eq('the tab is named after the draft', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId + '=' + t.innerText.trim()), 'draft:888=Draft EQR-000888');
    T.eq('the title', await env.text(vis('#orTitle')), 'Draft EQR-000888');
    T.eq('its dates are back', await page.$eval(vis('#orStart'), (i) => i.value), '2026-12-01');
    await page.click(vis('.nx-or-stepbtn[data-step="2"]'));
    await page.waitForSelector(vis('#orProject'));
    T.check('its project, task and customer are back', (await env.text(vis('#orProject'))).includes('Pipeline North') && (await env.text(vis('#orTask'))).includes('2.1 Trenching')
      && (await env.text(vis('#orCustomerField'))).includes('Acme Utilities'));
    T.check('priced from today\'s catalog; a line no longer there is reported', (await env.text(vis('#orRail'))).includes('Wheel Loader 950')
      && (await env.text(vis('#orPriceNote'))).includes('1 line of the draft is no longer in the catalog'));
    T.eq('nothing written on reopening', env.writes.length, 0);
    await page.click(vis('#orSaveDraft'));
    await page.waitForSelector(vis('#orSent'), { timeout: 20000 });
    await page.waitForTimeout(300);
    T.eq('Save draft: header PATCH, lines replaced (same address: no new site)', seq(env), 'PATCH /equipment-requests/888 > PUT /equipment-requests/888/lines/batch');
    T.check('the PATCH keeps the number and the status', !('status' in env.writes[0].body) && !('requestNumber' in env.writes[0].body) && env.writes[0].body.attribute2 === 'Gate code 4417');
    T.check('lines stay DRAFT', env.writes[1].body.lines.every((l) => l.lineStatus === 'DRAFT'));
    T.check('it says it is saved and nothing was sent', (await env.text(vis('#orSent'))).includes('Draft EQR-000888 is saved'));
    await shot(env, 'next-order-draft.png');
    T.eq('the draft\'s notes show in the notes box', await page.$eval(vis('#orNotes textarea'), (t) => t.value), 'Gate code 4417');
    env.writes.length = 0;
    await page.click(vis('#orContinue'));
    await page.waitForSelector(vis('#orSubmit'));
    await page.waitForTimeout(800);
    T.check('Submit names the draft', (await env.text(vis('#orRail'))).includes('Draft EQR-000888 with 1 line goes to the project\'s approver'));
    await page.click(vis('#orSubmit'));
    await page.waitForFunction(() => { const t = document.querySelector('.nx-tab--on'); return t && t.dataset.tabId === 'request:888'; }, null, { timeout: 20000 });
    await page.waitForTimeout(600);
    T.eq('Submit: header PATCH, lines replaced, status', seq(env), 'PATCH /equipment-requests/888 > PUT /equipment-requests/888/lines/batch > PATCH /equipment-requests/888');
    T.check('lines SUBMITTED', env.writes[1].body.lines.every((l) => l.lineStatus === 'SUBMITTED'));
    T.check('the draft\'s tab has done its job', !(await page.$('.nx-tab-btn[data-id="draft:888"]')));

    T.section('a customer draft is edited in New EquipRite');
    await env.open('/?open=draft&id=889');
    await page.waitForSelector(vis('#orLoadError'), { timeout: 30000 });
    T.check('says why', (await env.text(vis('#orLoadError'))).includes('Draft EQR-000889 is a customer request'));
    T.eq('and links there', await page.getAttribute(vis('#orExternalDraft'), 'href'), env.newUrl + '/vp/shell/customer/customer-new-request?draftId=889');

    T.section('the hand-over from a rental agreement');
    await page.evaluate(() => {
      sessionStorage.setItem('eqr.agreement.active', '1');
      const put = (k, v) => localStorage.setItem('eqr.draft.' + k, JSON.stringify(v));
      put('fromAgreementId', 12);
      put('fromAgreementNumber', 'AGR-12');
      put('fromAgreementCustomer', 'Acme Utilities');
      put('fromAgreementFusionCustomerId', 100000555);
      put('agreementLineIdByEquipmentId', { 41: 9001 });
      put('CartItemsArray', [{ id: 41, name: 'Wheel Loader 950', class: 'Loaders', quantity: 1, billingRate: 800, billingUnit: 'DAY', source: 'agreement' }]);
      localStorage.removeItem('eqr.next.tabs');
    });
    await env.open('/?open=new-request');
    await page.waitForSelector(vis('#orAgreement'), { timeout: 30000 });
    await page.waitForTimeout(600);
    T.check('the banner', (await env.text(vis('#orAgreement'))).includes('From agreement AGR-12 · Acme Utilities · 1 line in the cart at the agreement\'s rates'));
    T.check('the cart, at the agreement rate', (await env.text(vis('#orRail'))).includes('Wheel Loader 950') && (await env.text(vis('#orRail'))).includes('agreement rate'));
    await setDate(page, '#orStart', '2026-12-07');
    await setDate(page, '#orEnd', '2026-12-18');
    await page.click(vis('.nx-or-stepbtn[data-step="2"]'));
    await page.waitForSelector(vis('#orCustomerField'));
    T.check('the customer is filled in', (await env.text(vis('#orCustomerField'))).includes('Acme Utilities'));
    T.check('the catalog is asked with the agreement', env.calls.some((c) => c.includes('equipment-catalog') && c.includes('agreementId=12')));
    T.eq('the hand-over is used once', await page.evaluate(() => [sessionStorage.getItem('eqr.agreement.active'), localStorage.getItem('eqr.draft.fromAgreementId')].join()), ',');

    T.section('layout');
    T.check('no sideways scroll at a desk', await noSideways(page));
    await page.setViewportSize({ width: 390, height: 900 });
    await page.waitForTimeout(500);
    T.check('no sideways scroll on a phone', await noSideways(page));
    await shot(env, 'next-order-phone.png');
    await page.setViewportSize({ width: 1440, height: 1000 });
    T.eq('no browser errors', env.errors.filter((e) => !e.startsWith('warning')).join('\n'), '');
  } catch (e) {
    T.check('run finished', false, e.message);
    await env.shot('next-order-failed.png').catch(() => {});
  } finally {
    await env.close();
    T.report();
  }
})();
