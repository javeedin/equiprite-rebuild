'use strict';
/*
 * EquipRite Next, My work, in a real browser: what needs the persona, their counts, latest requests, shortcuts;
 * an administrator viewing another persona's work. Needs `npm run build`. Run: node tests/e2e/next-work.e2e.js
 */
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const REQS = [
  { eqrEquipmentRequestId: 1764, requestNumber: 'REQ-1764', status: 'IN_PROCESS', startDate: day(-22), endDate: day(0), projectName: 'EPC_MO_Operations', requestOrigin: 'Internal' },
  { eqrEquipmentRequestId: 1765, requestNumber: 'REQ-1765', status: 'SUBMITTED', startDate: day(6), endDate: day(30), projectName: 'Plant B', requestOrigin: 'Internal' },
  { eqrEquipmentRequestId: 1766, requestNumber: 'REQ-1766', status: 'IN_PROCESS', startDate: day(-3), endDate: day(20), projectName: 'Substation 4', requestOrigin: 'Internal' },
];
const LINES = [
  { requestNumber: 'REQ-1764', lineNumber: 1, equipmentName: 'Dozer', lineStatus: 'CLOSED' },
  { requestNumber: 'REQ-1764', lineNumber: 2, equipmentName: 'Bobcat S76', lineStatus: 'IN_PROCESS', allocationStatus: 'PENDING' },
  { requestNumber: 'REQ-1765', lineNumber: 1, equipmentName: 'Roller 10t', lineStatus: 'SUBMITTED' },
  { requestNumber: 'REQ-1766', lineNumber: 1, equipmentName: 'Light Tower', qty: 4, lineStatus: 'SHIP_TO_SITE' },
  { requestNumber: 'REQ-1766', lineNumber: 2, equipmentName: 'Generator', lineStatus: 'DEPLOYED' },
];
const STOCK = [
  { unitNumber: 'EX-1', unitType: 'SERIAL', equipmentName: 'Excavator', className: 'Excavators', invOrgName: 'Houston Yard', invOrgId: 1, unitStatus: 'RENTED' },
  { unitNumber: 'EX-2', unitType: 'SERIAL', equipmentName: 'Excavator', className: 'Excavators', invOrgName: 'Houston Yard', invOrgId: 1, unitStatus: 'AVAILABLE' },
  { unitNumber: 'EX-3', unitType: 'SERIAL', equipmentName: 'Excavator', className: 'Excavators', invOrgName: 'Houston Yard', invOrgId: 1, unitStatus: 'AVAILABLE' },
];
const DEPLOYED = [{ requestLineId: 1, serialNumber: 'EX-1', requestId: 1766, requestNumber: 'REQ-1766', projectName: 'Substation 4', lineStatus: 'DEPLOYED', startDate: day(-3), endDate: day(2), overdue: false }];

function handle(req, res) {
  const p = req.path;
  if (p.endsWith('/views/my-requests')) return res.json({ data: REQS });
  if (p.endsWith('/views/my-request-lines')) return res.json({ data: LINES });
  if (p.endsWith('/views/yard-stock')) return res.json({ data: STOCK });
  if (p.endsWith('/views/deployed-units')) return res.json({ data: DEPLOYED, recordCount: 1 });
  if (p.endsWith('/views/workbench-lines')) return res.json({ data: [] });
  if (p.endsWith('/views/request-detail-lines')) return res.json({ data: [{ lineId: 1, requestNumber: 'REQ-1764', requestStatus: 'IN_PROCESS', equipmentName: 'Dozer', lineStatus: 'CLOSED', quantity: 1 }] });
  return undefined;
}

(async () => {
  const env = await E.start({ port: 19280, handle, app: 'next', sessionRole: 'EQUIP_ADMIN' });
  const { page } = env;
  try {
    T.section('an Equipment Manager\'s work (an administrator, viewing as)');
    await env.open('/');
    await page.waitForSelector('.nx-kpi[data-tile]', { timeout: 30000 });
    await page.waitForSelector('.nx-need', { timeout: 20000 });
    await page.waitForTimeout(500);
    T.check('a greeting and the persona', (await env.text('.nx-work .nx-pagehead')).includes('Your work as Administrator'));
    T.eq('the administrator\'s counts', await page.$$eval('.nx-kpi[data-tile]', (t) => t.map((x) => x.dataset.tile + ':' + x.querySelector('.nx-kpi-value').innerText).join(' ')),
      'approval:1 assign:1 late:1 due:1 out:1 yard:2');
    T.eq('what needs them, late first', await page.$$eval('.nx-need-title', (t) => t.map((x) => x.innerText).join(' | ')),
      'REQ-1764 is late | 1 request waits for approval | 1 piece needs a unit assigned');
    T.eq('latest requests, read from the equipment', await page.$$eval('.nx-grid--recent .nx-pill', (p) => p.map((x) => x.innerText.trim()).join(' | ')),
      'Partly on site · 1 of 2 | Waiting for approval | Partly returned · 1 of 2');
    T.check('where they start from', (await page.$$eval('.nx-shortcut', (s) => s.map((x) => x.dataset.nav).join())).startsWith('approvals,requests,fleet'));
    await env.shot('next-work-manager.png');

    T.section('view as a requestor');
    await page.click('.nx-chip[data-persona="REQUESTOR"]');
    await page.waitForFunction(() => document.querySelector('.nx-kpi[data-tile="open"]'));
    await page.waitForTimeout(300);
    T.eq('a requestor\'s counts', await page.$$eval('.nx-kpi[data-tile]', (t) => t.map((x) => x.dataset.tile + ':' + x.querySelector('.nx-kpi-value').innerText).join(' ')),
      'open:3 out:1 onsite:1 late:1');
    T.check('a delivery to accept', (await env.text('.nx-needs')).includes('1 piece on the way to Substation 4'));

    T.section('opening work');
    await page.click('.nx-need >> text=REQ-1764 is late');
    await page.waitForSelector('.nx-record-title', { timeout: 20000 });
    T.eq('a need opens its request in a tab', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId), 'request:1764');
    await page.click('.nx-tab-btn[data-id="home"]');
    await page.fill('#workFind', '1765');
    await page.press('#workFind', 'Enter');
    await page.waitForFunction(() => document.querySelector('.nx-tab--on') && document.querySelector('.nx-tab--on').dataset.tabId === 'request:REQ-1765', null, { timeout: 20000 });
    T.check('a typed number opens that request', true);
    await page.click('.nx-tab-btn[data-id="home"]');
    await page.click('.nx-kpi[data-tile="late"]');
    await page.waitForTimeout(500);
    T.eq('a tile opens the screen it counts', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId), 'requests');
    T.check('no sideways scroll on the page', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    T.eq('reads only', env.writes.length, 0);
    T.eq('no browser errors', env.errors.filter((e) => !e.startsWith('warning')).join('\n'), '');
  } catch (e) {
    T.check('run finished', false, e.message);
    await env.shot('next-work-failed.png').catch(() => {});
  } finally {
    await env.close();
    T.report();
  }
})();
