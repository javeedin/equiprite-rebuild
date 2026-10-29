'use strict';
/*
 * New request in a real browser: dates, cart, project, review, submit; then a saved draft reopened on Review.
 * Needs `npm run build`. Run: node tests/e2e/new-request.e2e.js   (screenshots go to the OS temp folder)
 */
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const ROWS = [
  { eqrEquipmentMasterId: 11, equipmentName: 'CAT 320 Excavator', className: 'Excavators', eqrEquipmentClassId: 1, isRentable: true, rate: 1400, rateUom: 'DAY', periodAmount: 1400, periodType: 'DAILY' },
  { eqrEquipmentMasterId: 12, equipmentName: 'Mini Excavator 3.5t', className: 'Excavators', eqrEquipmentClassId: 1, isRentable: true, rate: 300, rateUom: 'DAY' },
  { eqrEquipmentMasterId: 21, equipmentName: 'Trench safety kit', className: 'Safety & consumables', eqrEquipmentClassId: 2, isRentable: false, unitPrice: 25 },
  { eqrEquipmentMasterId: 41, equipmentName: 'Wheel Loader 950', className: 'Loaders', eqrEquipmentClassId: 4, isRentable: true, rate: 950, rateUom: 'DAY' },
];
const AVAIL = { 11: ['AVAILABLE', 3], 12: ['NOT AVAILABLE', 0], 21: ['PARTIAL QUANTITY', 40], 41: ['PARTIAL DURATION', 1] };

function handle(req, res) {
  const p = req.path;
  if (p.endsWith('/views/equipment-catalog')) {
    const dated = req.query.get('startDate');
    const proj = req.query.get('projectRefId');
    return res.json({ data: ROWS.map((r) => Object.assign({}, r,
      dated ? { availabilityStatus: AVAIL[r.eqrEquipmentMasterId][0], availableQty: AVAIL[r.eqrEquipmentMasterId][1] } : {},
      proj && r.eqrEquipmentMasterId === 11 ? { rate: 1260, periodAmount: 1260 } : {})) });
  }
  if (p.endsWith('/ExternalReportWSSService')) {
    if (req.body.includes('EQP_PROJECTS_LOV_RP')) return res.bip([{ PROJECTID: 300000123, PROJECTNAME: 'Pipeline North', PROJECTNUMBER: 'PRJ-2026-001' }]);
    if (req.body.includes('EQP_CUSTOMERS_LOV_RP')) return res.bip([{ CUSTOMERID: 100000555, CUSTOMER: 'Acme Utilities', CUSTOMERNUMBER: 'C-1001' }]);
    if (req.body.includes('EQP_CONTRACTS_BY_PROJECT_LOV_RP')) return res.bip([{ CONTRACT_ID: 300000999, CONTRACT_NUMBER: 'K-77', STATUS: 'ACTIVE' }]);
    if (req.body.includes('EQP_SHIP_TO_SITES_BY_CONTRACT_LOV_RP')) return res.bip([{ SITE_ADDRESS: '1200 Pipeline Rd, Odessa TX 79761', CUSTOMER_NAME: 'Acme Utilities' }]);
    return undefined;
  }
  if (/\/projects\/\d+\/child\/Tasks$/.test(p)) return res.json({ items: [
    { TaskId: 1, TaskNumber: '1', TaskName: 'Earthworks', ParentTaskId: null },
    { TaskId: 3, TaskNumber: '2.1', TaskName: 'Trenching', ParentTaskId: 1 }] });
  if (/\/projects\/\d+$/.test(p)) return res.json({ ProjectId: 300000123, BusinessUnitId: 300000001, BusinessUnitName: 'EPC_US_BU' });
  if (req.method === 'POST' && p.endsWith('/equipment-requests')) return res.json({ id: 777, requestNumber: 'EQR-000777' }, 201);
  if (p.endsWith('/ship-to-sites')) return res.json({ id: 55 }, 201);
  if (/\/equipment-requests\/888$/.test(p) && req.method === 'GET') return res.json({ id: 888, requestNumber: 'EQR-000888', status: 'DRAFT', requestType: 'INTERNAL',
    projectRefId: 300000123, projectNumber: 'PRJ-2026-001', projectName: 'Pipeline North', projectBuName: 'EPC_US_BU', projectBuId: 300000001,
    taskId: 3, taskNumber: '2.1', taskName: 'Trenching', requestorName: 'John Dunbar', requestorUsername: 'john.dunbar',
    projectInternalCustomerId: 100000555, projectInternalCustomer: 'Acme Utilities', deliveryLocationType: 'DELIVERY_LOCATION',
    attribute1: '1200 Pipeline Rd, Odessa TX 79761', shipToSiteId: 55, requestedStartDate: '2026-12-01T00:00:00Z', requestedEndDate: '2026-12-14T00:00:00Z' });
  if (/\/equipment-requests\/888\/lines$/.test(p)) return res.json({ data: [{ id: 1, eqrEquipmentMasterId: 41, quantity: 1 }, { id: 2, eqrEquipmentMasterId: 99, quantity: 1 }] });
  if (/\/equipment-requests\/777$/.test(p) && req.method === 'GET') return res.json({ id: 777, requestNumber: 'EQR-000777', status: 'SUBMITTED', requestType: 'INTERNAL' });
  return undefined;
}

(async () => {
  const env = await E.start({ port: 19010, handle, flags: ['PROJECTS_MODULE_ENABLED', 'TIMESHEETS_ENABLED'] });
  const { page } = env;
  try {
    T.section('step 1: dates, catalog, cart');
    await env.open('/vp/shell/request/new-request');
    await page.waitForSelector('.er-eq-card');
    await page.fill('input[data-field="startDate"]', '2026-11-02');
    await page.dispatchEvent('input[data-field="startDate"]', 'change');
    await page.fill('input[data-field="endDate"]', '2026-11-27');
    await page.dispatchEvent('input[data-field="endDate"]', 'change');
    await page.waitForTimeout(1200);
    T.check('cards show availability and the estimate for the dates', (await env.text('.er-eq-card >> nth=0')).includes('Est. $36,400 for 26 days'));
    T.eq('an unavailable item cannot be added', await page.$eval('button[data-action="add"][data-id="12"]', (b) => b.disabled), true);
    await page.click('button[data-action="add"][data-id="11"]');
    await page.click('button[data-action="inc"][data-id="11"]');
    await page.click('button[data-action="add"][data-id="21"]');
    await page.waitForTimeout(300);
    T.check('the rail totals the cart', (await env.text('.er-rail')).includes('$72,825'));

    T.section('step 2: project, task, customer, delivery');
    await page.click('.er-stepbtn[data-step="3"]');
    await page.waitForTimeout(400);
    T.check('skipping to Review stops at Project with what is missing', (await env.text('.er-nr-main > .er-error')).includes('Project, Task, Customer, Delivery location'));
    await page.fill('input[data-kind="project"]', 'pipe');
    await page.click('.er-result[data-kind="project"][data-index="0"]');
    await page.waitForSelector('.er-result[data-field="taskId"]');
    T.eq('only chargeable tasks are offered', await page.$$eval('.er-result[data-field="taskId"]', (r) => r.length), 1);
    await page.click('.er-result[data-field="taskId"]');
    await page.click('button[data-field="contractId"][data-value="300000999"]');
    await page.fill('input[data-kind="customer"]', 'acme');
    await page.click('.er-result[data-kind="customer"][data-index="0"]');
    await page.click('button[data-field="locationType"][data-value="PROJECT_SITE"]');
    await page.click('button[data-field="siteAddress"]');

    T.section('step 3: review re-prices for the project, submit');
    await page.click('.er-rail-actions button[data-step="3"]');
    await page.waitForSelector('.er-lines .er-line');
    await page.waitForTimeout(1200);
    T.check('the project rate replaces the list rate', (await env.text('.er-lines')).includes('$1,260 / DAY'));
    T.check('the catalog was asked with project and delivery point',
      env.calls.some((c) => c.includes('equipment-catalog') && c.includes('projectRefId=300000123') && c.includes('latitude=31.85')));
    env.writes.length = 0;
    await page.click('.er-rail-actions button:has-text("Submit for approval")');
    await page.waitForURL(/request-detail/, { timeout: 20000 });
    await page.waitForTimeout(500);
    T.eq('calls: header, site, site link, lines, status',
      env.writes.map((w) => w.method + ' ' + w.path.replace('/equiprite/v1', '')).join(' > '),
      'POST /equipment-requests > POST /ship-to-sites > PATCH /equipment-requests/777 > POST /equipment-requests/777/lines/batch > PATCH /equipment-requests/777');
    T.check('lines are SUBMITTED at the project rate', env.writes[3].body.lines.every((l) => l.lineStatus === 'SUBMITTED') && env.writes[3].body.lines[0].billRate === 1260);
    T.check('opens the new request', page.url().includes('requestNumericId=777'));
    await env.shot('new-request-submitted.png');

    T.section('a saved draft reopens on Review and is updated in place');
    env.writes.length = 0;
    await env.open('/vp/shell/request/new-request?draftId=888&startStep=3');
    await page.waitForSelector('.er-lines .er-line', { timeout: 30000 });
    await page.waitForTimeout(800);
    T.check('the draft number is the title', (await env.text('.er-band h1')).includes('Draft EQR-000888'));
    T.check('a line no longer in the catalog is reported', (await env.text('.er-rail')).includes('no longer in the catalog'));
    await page.click('.er-rail-actions button:has-text("Save draft")');
    await page.waitForURL(/request-detail/, { timeout: 20000 });
    await page.waitForTimeout(500);
    T.eq('draft: header PATCH, lines replaced', env.writes.map((w) => w.method + ' ' + w.path.replace('/equiprite/v1', '')).join(' > '),
      'PATCH /equipment-requests/888 > PUT /equipment-requests/888/lines/batch');
    T.eq('no browser errors', env.errors.filter((e) => !e.startsWith('warning')).join('\n'), '');
  } catch (e) {
    T.check('run finished', false, e.message);
    await env.shot('new-request-failed.png').catch(() => {});
  } finally {
    await env.close();
    T.report();
  }
})();
