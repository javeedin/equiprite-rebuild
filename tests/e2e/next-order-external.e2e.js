'use strict';
/*
 * EquipRite Next, New request for an EXTERNAL customer's project, in a real browser (Old's Customer Type): the Project
 * step asks who the project is for, Internal or External; External takes the customer from EquipRite's list and their
 * contact (a portal user), with the same project, task and delivery; Review shows them and the rental terms; sending
 * needs the terms ticked and posts the old cart's EXTERNAL request (customer and contact columns, IN_PROCESS: straight
 * to the Equipment Manager). Customer quotes are on here (the Fusion contract comes with the accepted quote).
 * Needs `npm run build`. Run: node tests/e2e/next-order-external.e2e.js
 */
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const ROWS = [
  { eqrEquipmentMasterId: 11, equipmentName: 'CAT 320 Excavator', className: 'Excavators', eqrEquipmentClassId: 1, isRentable: true, rate: 1400, rateUom: 'DAY',
    periodAmount: 1400, periodType: 'DAILY', availabilityStatus: 'AVAILABLE', availableQty: 3 },
];

function handle(req, res) {
  const p = req.path;
  if (p.endsWith('/views/equipment-catalog')) return res.json({ data: ROWS });
  if (p.endsWith('/ExternalReportWSSService')) {
    if (req.body.includes('EQP_PROJECTS_LOV_RP')) return res.bip([{ PROJECTID: 300000123, PROJECTNAME: 'Pipeline North', PROJECTNUMBER: 'PRJ-2026-001' }]);
    if (req.body.includes('EQP_CUSTOMERS_LOV_RP')) return res.bip([{ CUSTOMERID: 100000555, CUSTOMER: 'Acme Utilities', CUSTOMERNUMBER: 'C-1001' }]);
    return res.bip([]);
  }
  if (p.endsWith('/customer-refs')) return res.json({ data: [{ id: 41, customerName: 'Lone Star Paving LLC', customerNumber: 'CR-41' }, { id: 42, customerName: 'Gulf Coast Builders' }] });
  if (p.endsWith('/customer-portal-users')) {
    return res.json({ data: [{ id: 7, contactName: 'Maria Lopez', email: 'maria@lonestar.example', username: 'maria.lopez' }, { id: 8, contactName: 'Dana Ruiz', username: 'dana.ruiz' }] });
  }
  if (/\/projects\/\d+\/child\/Tasks$/.test(p)) return res.json({ items: [{ TaskId: 3, TaskNumber: '2.1', TaskName: 'Trenching', ParentTaskId: null }] });
  if (/\/projects\/\d+$/.test(p)) return res.json({ ProjectId: 300000123, BusinessUnitId: 300000001, BusinessUnitName: 'EPC_US_BU' });
  if (req.method === 'POST' && p.endsWith('/equipment-requests')) return res.json({ id: 777, requestNumber: 'EQR-000777' }, 201);
  if (p.endsWith('/ship-to-sites')) return res.json({ id: 56 }, 201);
  const m = /\/equipment-requests\/(\d+)$/.exec(p);
  if (m && req.method === 'GET') return res.json({ id: Number(m[1]), requestNumber: 'EQR-000' + m[1], status: 'IN_PROCESS', requestType: 'EXTERNAL', projectName: 'Pipeline North' });
  return undefined;
}

const seq = (env) => env.writes.map((w) => w.method + ' ' + w.path.replace('/equiprite/v1', '')).join(' > ');
const vis = (sel) => sel + ' >> visible=true';

(async () => {
  const env = await E.start({ port: 19520, handle, app: 'next', settings: { ENABLE_QUOTES: 'CUSTOMER' } });
  const { page } = env;
  try {
    await env.open('/?open=new-request');
    await page.waitForSelector(vis('.nx-or-card[data-id="11"]'), { timeout: 30000 });
    await page.fill(vis('#orStart'), '2026-11-02');
    await page.dispatchEvent(vis('#orStart'), 'change');
    await page.waitForTimeout(500);
    await page.fill(vis('#orEnd'), '2026-11-27');
    await page.dispatchEvent(vis('#orEnd'), 'change');
    await page.waitForTimeout(700);
    await page.click(vis('.nx-or-card[data-id="11"] button[data-action="add"]'));
    await page.click(vis('#orContinue'));
    await page.waitForSelector(vis('#orProject'));
    await page.waitForTimeout(400);

    T.section('who the project is for: Internal or External');
    T.eq('the question, two choices, Internal first and chosen', [await env.text(vis('#orCustT2')), await page.$$eval(vis('.nx-or-kind-btn'), (b) => b.map((x) => x.querySelector('strong').innerText + ':'
      + x.getAttribute('aria-pressed')).join(' '))].join(' | '), 'Who the project is for | Internal:true External:false');
    T.check('Internal: the Fusion customer, as before', !!(await page.$(vis('#orCustomerField'))) && (await env.text(vis('#orKindNote'))).startsWith('Internal'));
    await page.click(vis('#orKindExternal'));
    await page.waitForSelector(vis('.nx-or-option[data-kind="extCustomer"]'), { timeout: 10000 });
    await page.waitForSelector(vis('.nx-or-option[data-kind="contact"]'), { timeout: 10000 });
    T.check('External: EquipRite\'s customers and their contacts instead', !(await page.$(vis('#orCustomerField'))) && !!(await page.$(vis('#orExtCustomer'))) && !!(await page.$(vis('#orContact')))
      && (await env.text(vis('#orKindNote'))).includes('straight to the Equipment Manager'));
    T.eq('the lists, and where they come from', [await page.$$eval(vis('.nx-or-option[data-kind="extCustomer"] strong'), (o) => o.map((x) => x.innerText).join()),
      await env.text(vis('#orExtCustomerNote'))].join(' | '), 'Gulf Coast Builders,Lone Star Paving LLC | 2 customers in EquipRite · type a name to narrow');
    T.eq('the rail says what is still needed, in the screen\'s order', await env.text(vis('#orNeed')),
      'Still needed: Customer, Customer contact, Project, Task and Delivery location.');
    await page.fill(vis('input[data-kind="extCustomer"]'), 'lone');
    await page.waitForTimeout(300);
    await page.click(vis('.nx-or-option[data-kind="extCustomer"][data-index="0"]'));
    await page.fill(vis('input[data-kind="contact"]'), 'lonestar');
    await page.waitForTimeout(300);
    T.eq('a contact found by e-mail', await page.$$eval(vis('.nx-or-option[data-kind="contact"] strong'), (o) => o.map((x) => x.innerText).join()), 'Maria Lopez');
    await page.click(vis('.nx-or-option[data-kind="contact"][data-index="0"]'));
    await page.waitForTimeout(200);
    T.check('both picked', (await env.text(vis('#orExtCustomer'))).includes('Lone Star Paving LLC') && (await env.text(vis('#orContact'))).includes('Maria Lopez'));
    await page.click(vis('.nx-or-option[data-kind="project"][data-index="0"]'));
    await page.waitForSelector(vis('.nx-or-option[data-field="taskId"]'));
    await page.click(vis('.nx-or-option[data-field="taskId"]'));
    await page.fill(vis('#orAddress'), '1200 Pipeline Rd, Odessa TX 79761');
    await page.dispatchEvent(vis('#orAddress'), 'input');
    await page.waitForTimeout(300);
    await env.shot('next-order-external.png');
    await page.click(vis('#orKindInternal'));
    await page.waitForTimeout(200);
    await page.click(vis('#orKindExternal'));
    await page.waitForTimeout(300);
    T.check('switching back and forth keeps the external choice', (await env.text(vis('#orExtCustomer'))).includes('Lone Star Paving LLC'));

    T.section('Review: the external customer, the contact, the rental terms');
    await page.click(vis('#orContinue'));
    await page.waitForSelector(vis('#orFacts'));
    await page.waitForTimeout(500);
    const facts = await env.text(vis('#orFacts'));
    T.check('the customer said as external, with the contact', facts.includes('Lone Star Paving LLC (external)') && facts.includes('Maria Lopez') && facts.includes('Pipeline North'), facts);
    T.check('the rental terms, to accept', (await env.text(vis('#orTerms'))).includes('Rental terms and conditions') && !!(await page.$(vis('#orTermsChk'))));
    T.eq('the button says where it goes', await env.text(vis('#orSubmit')), 'Send to the Equipment Manager');
    T.check('and what it does', (await env.text(vis('#orRail'))).includes('goes straight to the Equipment Manager'));
    env.writes.length = 0;
    await page.click(vis('#orSubmit'));
    await page.waitForTimeout(400);
    T.eq('not without the terms: nothing written', [await env.text(vis('#orMissing')), env.writes.length].join(' | '), 'Still needed: Accept the rental terms. | 0');
    await page.check(vis('#orTermsChk'));
    await page.waitForTimeout(200);
    await env.shot('next-order-external-review.png');
    await page.click(vis('#orSubmit'));
    await page.waitForFunction(() => { const t = document.querySelector('.nx-tab--on'); return t && t.dataset.tabId === 'request:777'; }, null, { timeout: 20000 });
    await page.waitForTimeout(600);

    T.section('what is sent: the old cart\'s EXTERNAL request');
    T.eq('header, site, site link, lines, status', seq(env),
      'POST /equipment-requests > POST /ship-to-sites > PATCH /equipment-requests/777 > POST /equipment-requests/777/lines/batch > PATCH /equipment-requests/777');
    const h = env.writes[0].body;
    T.eq('EXTERNAL, EquipRite\'s customer and the contact; no Fusion customer, no internal requestor',
      [h.requestType, h.eqrCustomerRefId, h.customerName, h.eqrCustomerPortalUserId, h.contactName, h.projectInternalCustomerId, h.requestorUserId, h.requestorName].join(' | '),
      'EXTERNAL | 41 | Lone Star Paving LLC | 7 | Maria Lopez |  |  | ');
    T.eq('with the project and task, as an internal one', [h.projectRefId, h.taskId, h.projectBuName].join(), '300000123,3,EPC_US_BU');
    T.check('the lines go straight on (IN_PROCESS)', env.writes[3].body.lines.every((l) => l.lineStatus === 'IN_PROCESS'), JSON.stringify(env.writes[3].body.lines.map((l) => l.lineStatus)));
    T.eq('and the request: straight to the Equipment Manager', JSON.stringify(env.writes[4].body), '{"status":"IN_PROCESS"}');
    T.eq('no browser errors', env.errors.filter((e) => !/404|Failed to load resource/.test(e)).join(' | '), '');
  } catch (e) {
    T.check('run finished', false, String((e && e.stack) || e).slice(0, 1200));
  } finally {
    await env.close();
  }
  T.report();
})();
