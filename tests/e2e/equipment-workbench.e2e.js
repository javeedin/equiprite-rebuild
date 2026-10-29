'use strict';
/*
 * Equipment workbench in a real browser: lanes, unit cards, turnaround risk, the unit panel, the list, search.
 * Needs `npm run build`. Run: node tests/e2e/equipment-workbench.e2e.js
 */
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
  return undefined;
}

(async () => {
  const env = await E.start({ port: 19210, handle });
  const { page } = env;
  try {
    T.section('the board');
    await env.open('/vp/shell/fleet/equipment-workbench');
    await page.waitForSelector('.er-ew-card', { timeout: 30000 });
    await page.waitForTimeout(500);
    T.check('reached from the menu item', (await page.$eval('.er-nav-item--active', (e) => e.dataset.navId).catch(() => '')) === 'equipment-workbench');
    T.check('the deployed-units call asks for units on their way and on site', env.calls.some((c) => c.includes('/views/deployed-units') && decodeURIComponent(c).includes('SHIP_TO_SITE,DEPLOYED,RETURN_INITIATED')));
    const lanes = await page.$$eval('.er-ew-lane', (ls) => ls.map((l) => l.dataset.lane + ':' + l.querySelectorAll('.er-ew-card').length));
    T.eq('lanes and their units', lanes.join(' '), 'yard:2 going:1 out:1 due:1 overdue:1 maint:1');
    T.check('the band sums it up', /7 units · 3 out \(43%\) · 1 overdue · 1 tight turnarounds/.test(await env.text('.er-band-sub')), await env.text('.er-band-sub'));
    T.check('an overdue unit says by how much and where', /EX-2201.*CAT 320 Excavator.*Pipeline North.*4 days overdue/.test(await env.text('.er-ew-lane--overdue')));
    T.check('a tight turnaround is flagged on the card', (await env.text('.er-ew-lane--due')).includes('1-day turnaround'));
    T.check('a free unit says until when', /Free until \d+ \w{3}/.test(await env.text('.er-ew-lane--yard')));
    await env.shot('equipment-workbench-board.png');

    T.section('tiles and filters');
    await page.click('.er-ew-tile--overdue');
    await page.waitForTimeout(300);
    T.eq('a lane tile shows that lane only', await page.$$eval('.er-ew-lane', (ls) => ls.map((l) => l.dataset.lane).join()), 'overdue');
    await page.click('.er-ew-tile--overdue');
    await page.waitForTimeout(300);
    await page.click('button[data-field="cls"][data-value="Rollers"]');
    await page.waitForTimeout(300);
    T.eq('class chip', await page.$$eval('.er-ew-card', (c) => c.length), 2);
    await page.click('button[data-field="cls"][data-value="Rollers"]');
    await page.fill('.er-search input', 'lone star');
    await page.waitForTimeout(400);
    T.eq('search by customer', await page.$$eval('.er-ew-card .er-ew-unit', (c) => c.map((x) => x.innerText).join()), 'DT-1108');
    await page.fill('.er-search input', '');
    await page.waitForTimeout(300);

    T.section('the unit panel');
    await page.click('.er-ew-card[data-key="EX-2202"]');
    await page.waitForSelector('.er-ew-panel');
    const panel = await env.text('.er-ew-panel');
    T.check('what it is, where, now and next', panel.includes('EX-2202') && panel.includes('Houston Yard') && panel.includes('REQ-10490') && panel.includes('REQ-10510'));
    T.check('the turnaround warning names the next request', /1-day turnaround: REQ-10510 needs it on/.test(panel));
    T.check('due back: Receipt & returns is offered', panel.includes('Receipt & returns'));
    T.check('every lane stays in view with the panel open', await page.$$eval('.er-ew-lane', (ls) => ls.every((l) => l.getBoundingClientRect().right <= window.innerWidth)));
    T.check('the warning reads a date like a person', /needs it on \d+ \w{3}\./.test(panel));
    await env.shot('equipment-workbench-panel.png');
    await page.click('.er-ew-panel .er-link');
    await page.waitForURL(/request-detail/, { timeout: 15000 });
    T.check('the current request opens Request detail', page.url().includes('requestNumericId=10490'));

    T.section('the list');
    await env.open('/vp/shell/fleet/equipment-workbench');
    await page.waitForSelector('.er-ew-card', { timeout: 30000 });
    await page.click('button[data-field="view"][data-value="list"]');
    await page.waitForSelector('.er-grid--ew');
    T.eq('a row per unit', await page.$$eval('.er-grid--ew .er-grid-row:not(.er-grid-head)', (r) => r.length), 7);
    T.check('no sideways scroll on the page', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    await env.shot('equipment-workbench-list.png');
    T.eq('reads only', env.writes.length, 0);
    T.eq('no browser errors', env.errors.filter((e) => !e.startsWith('warning')).join('\n'), '');
  } catch (e) {
    T.check('run finished', false, e.message);
    await env.shot('equipment-workbench-failed.png').catch(() => {});
  } finally {
    await env.close();
    T.report();
  }
})();
