'use strict';
/*
 * EquipRite Next, Fleet, in a real browser: lane tiles, board and list, a unit's panel, tight turnarounds, export.
 * Needs `npm run build`. Run: node tests/e2e/next-fleet.e2e.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const STOCK = [
  { unitNumber: 'EX-2201', unitType: 'SERIAL', assetNumber: 'FA-1001', equipmentName: 'CAT 320 Excavator', className: 'Excavators', invOrgName: 'Houston Yard', invOrgId: 1, unitStatus: 'RENTED' },
  { unitNumber: 'EX-2202', unitType: 'SERIAL', equipmentName: 'CAT 320 Excavator', className: 'Excavators', invOrgName: 'Houston Yard', invOrgId: 1, unitStatus: 'RENTED' },
  { unitNumber: 'DT-1108', unitType: 'SERIAL', equipmentName: 'Volvo A30 Dump Truck', className: 'Trucks', invOrgName: 'Odessa Yard', invOrgId: 2, unitStatus: 'RENTED' },
  { unitNumber: 'RL-0301', unitType: 'SERIAL', equipmentName: 'Roller 10t', className: 'Rollers', invOrgName: 'Houston Yard', invOrgId: 1, unitStatus: 'AVAILABLE' },
  { unitNumber: 'RL-0302', unitType: 'SERIAL', equipmentName: 'Roller 10t', className: 'Rollers', invOrgName: 'Houston Yard', invOrgId: 1, unitStatus: 'AVAILABLE' },
  { unitNumber: 'GN-0040', unitType: 'SERIAL', equipmentName: 'Generator 100kVA', className: 'Generators', invOrgName: 'Odessa Yard', invOrgId: 2, unitStatus: 'MAINTENANCE' },
  { unitNumber: 'LOT-77', unitType: 'LOT', equipmentName: 'Trench shoring panels', className: 'Safety', invOrgName: 'Houston Yard', invOrgId: 1, unitStatus: 'AVAILABLE', onhandQty: 40 },
];
const DEPLOYED = [
  { requestLineId: 1, serialNumber: 'EX-2201', unitType: 'SERIAL', requestId: 10482, requestNumber: 'REQ-10482', projectName: 'Pipeline North', lineStatus: 'DEPLOYED', startDate: day(-30), endDate: day(-4), overdue: true },
  { requestLineId: 2, serialNumber: 'EX-2202', unitType: 'SERIAL', requestId: 10490, requestNumber: 'REQ-10490', projectName: 'Plant Expansion B', lineStatus: 'DEPLOYED', startDate: day(-10), endDate: day(3), overdue: false },
  { requestLineId: 3, serialNumber: 'DT-1108', unitType: 'SERIAL', requestId: 10498, requestNumber: 'REQ-10498', customerName: 'Lone Star Paving', lineStatus: 'DEPLOYED', startDate: day(-2), endDate: day(30), overdue: false },
];
const LINES = [
  { requestNumber: 'REQ-10510', requestStatus: 'IN_PROCESS', startDate: day(4), endDate: day(20), projectName: 'Substation 4', allocatedSerial: 'EX-2202' },
  { requestNumber: 'REQ-10511', requestStatus: 'ALLOCATED', startDate: day(2), endDate: day(9), projectName: 'Plant Expansion B', allocatedSerial: 'RL-0301' },
  { requestNumber: 'REQ-10512', requestStatus: 'ALLOCATED', startDate: day(40), endDate: day(50), projectName: 'Plant Expansion B', allocatedSerial: 'RL-0302' },
];

function handle(req, res) {
  const p = req.path;
  if (p.endsWith('/views/yard-stock')) return res.json({ data: STOCK });
  if (p.endsWith('/views/deployed-units')) return res.json({ data: DEPLOYED, recordCount: DEPLOYED.length });
  if (p.endsWith('/views/workbench-lines')) return res.json({ data: LINES });
  if (p.endsWith('/views/my-requests')) return res.json({ data: [{ eqrEquipmentRequestId: 10490, requestNumber: 'REQ-10490', status: 'IN_PROCESS', projectName: 'Plant Expansion B' }] });
  if (p.endsWith('/views/request-detail-lines')) return res.json({ data: [{ lineId: 1, requestNumber: 'REQ-10490', requestStatus: 'IN_PROCESS', equipmentName: 'CAT 320 Excavator', lineStatus: 'DEPLOYED', quantity: 1 }] });
  return undefined;
}

(async () => {
  const env = await E.start({ port: 19270, handle, app: 'next' });
  const { page } = env;
  try {
    T.section('the fleet');
    await env.open('/?open=fleet');
    await page.waitForSelector('.nx-ucard', { timeout: 30000 });
    await page.waitForTimeout(400);
    T.check('the summary', /^7 units · 3 out \(43%\) · 1 overdue · 1 tight turnarounds$/.test(await env.text('#fleetSummary')), await env.text('#fleetSummary'));
    T.eq('tiles count the fleet', await page.$$eval('.nx-fleet-tiles .nx-kpi', (t) => t.map((x) => x.dataset.value + ':' + x.querySelector('.nx-kpi-value').innerText).join(' ')),
      'yard:2 going:1 out:1 due:1 overdue:1 maint:1 tight:1');
    T.eq('lanes', await page.$$eval('.nx-fleet-board .nx-lane', (l) => l.map((x) => x.dataset.lane + ':' + x.querySelectorAll('.nx-ucard').length).join(' ')),
      'yard:2 going:1 out:1 due:1 overdue:1 maint:1');
    T.check('an overdue card says by how much', (await env.text('.nx-lane[data-lane="overdue"]')).includes('4 days overdue'));
    T.check('a tight turnaround is flagged', (await env.text('.nx-lane[data-lane="due"]')).includes('Tight'));
    await env.shot('next-fleet-board.png');

    T.section('filters');
    await page.click('.nx-kpi[data-value="overdue"]');
    await page.waitForTimeout(300);
    T.eq('a tile shows its lane only', await page.$$eval('.nx-ucard', (c) => c.map((x) => x.dataset.key).join()), 'EX-2201');
    await page.click('.nx-kpi[data-value="tight"]');
    await page.waitForTimeout(300);
    T.eq('tight turnarounds', await page.$$eval('.nx-ucard', (c) => c.map((x) => x.dataset.key).join()), 'EX-2202');
    await page.click('.nx-kpi[data-value="tight"]');
    await page.click('.nx-chip[data-field="cls"][data-value="Rollers"]');
    await page.waitForTimeout(300);
    T.eq('class chip', await page.$$eval('.nx-ucard', (c) => c.length), 2);
    await page.click('.nx-chip[data-field="cls"][data-value="Rollers"]');
    await page.fill('.nx-search input', 'lone star');
    await page.waitForTimeout(300);
    T.eq('search by customer', await page.$$eval('.nx-ucard', (c) => c.map((x) => x.dataset.key).join()), 'DT-1108');
    await page.fill('.nx-search input', '');
    await page.waitForTimeout(300);

    T.section('a unit');
    await page.click('.nx-ucard[data-key="EX-2202"]');
    await page.waitForSelector('.nx-unit-panel');
    const panel = await env.text('.nx-unit-panel');
    T.check('what it is, now, next', panel.includes('CAT 320 Excavator') && panel.includes('REQ-10490') && panel.includes('REQ-10510'));
    T.check('the turnaround warning names the next request', /1-day turnaround: REQ-10510 needs it on \d+ \w{3}\./.test(panel), panel);
    T.check('due back: Receiving & returns is offered', panel.includes('Receiving & returns'));
    T.check('every lane stays reachable with the panel open', await page.$$eval('.nx-lane', (ls) => ls.every((l) => l.getBoundingClientRect().left < window.innerWidth)));
    await env.shot('next-fleet-panel.png');
    await page.click('.nx-unit-now .nx-link');
    await page.waitForSelector('.nx-record-title', { timeout: 20000 });
    T.eq('the current request opens in its own tab', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId), 'request:10490');
    await page.click('.nx-tab-btn[data-id="fleet"]');
    await page.waitForTimeout(300);
    T.check('back on Fleet, the panel still open', await page.isVisible('.nx-unit-panel'));
    await page.click('.nx-unit-panel .nx-iconbtn');

    T.section('list and export');
    await page.click('button[data-field="view"][data-value="list"]');
    await page.waitForSelector('.nx-grid--fleet');
    T.eq('a row per unit', await page.$$eval('.nx-grid--fleet .nx-row--click', (r) => r.length), 7);
    await page.click('#fleetExport');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.nx-menu-item[data-format="csv"]')]);
    const file = path.join(os.tmpdir(), 'next-' + dl.suggestedFilename());
    await dl.saveAs(file);
    const csv = fs.readFileSync(file, 'utf8');
    T.check('CSV: a row per unit with where, when and the next booking', csv.split('\r\n').filter(Boolean).length === 8 && csv.includes('EX-2202') && csv.includes('REQ-10510'));
    T.check('no sideways scroll on the page', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    await env.shot('next-fleet-list.png');
    T.eq('reads only', env.writes.length, 0);
    T.eq('no browser errors', env.errors.filter((e) => !e.startsWith('warning')).join('\n'), '');
  } catch (e) {
    T.check('run finished', false, e.message);
    await env.shot('next-fleet-failed.png').catch(() => {});
  } finally {
    await env.close();
    T.report();
  }
})();
