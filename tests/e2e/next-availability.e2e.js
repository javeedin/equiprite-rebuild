'use strict';
/*
 * EquipRite Next, Availability, in a real browser: the calls (New EquipRite's schedule calls, nothing written), the
 * window and what is free in it class by class, clashes and tight turnarounds, the timeline (rows by class or yard,
 * bars by journey stage, maintenance, today, the window, week and month), search and chips, a booking opening its
 * request in a tab, export (the files are read back), 309 units without slowing down, no sideways scroll on a
 * laptop or a phone, no browser errors. Needs `npm run build`. Run: node tests/e2e/next-availability.e2e.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();

// Dates relative to today (the browser's calendar day), so the bookings are current whenever this runs.
const pad = (n) => (n < 10 ? '0' : '') + n;
const dayOf = (x) => x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return dayOf(x); };
const iso = (n) => d(n) + 'T00:00:00Z';

const SERIALS = [
  { id: 1, serialNumber: 'EX-2201', equipmentId: 11, currentLocationId: 501, faAssetRefId: '100482', maintenanceAssetNumber: 'MA-2201' },
  { id: 2, serialNumber: 'EX-2203', equipmentId: 11, currentLocationId: 501 },
  { id: 3, serialNumber: 'EX-2210', equipmentId: 12, currentLocationId: 502, maintenanceAssetNumber: 'MA-2210' },
  { id: 4, serialNumber: 'MC-07', equipmentId: 21, currentLocationId: 502 },
  { id: 5, serialNumber: 'TC-02', equipmentId: 22 },
  { id: 6, serialNumber: 'EX-2299', equipmentId: 12, currentLocationId: 501 },
  { id: 7, serialNumber: 'EX-2300', equipmentId: 12, currentLocationId: 501, maintenanceAssetNumber: 'MA-2300' },
  { id: 8, serialNumber: 'TC-05', equipmentId: 22, currentLocationId: 502 },
];
const MASTERS = [
  { id: 11, equipmentName: 'CAT 320 Excavator', equipmentClassId: 1 }, { id: 12, equipmentName: 'PC210 Excavator', equipmentClassId: 1 },
  { id: 21, equipmentName: 'Mobile Crane 50t', equipmentClassId: 2 }, { id: 22, equipmentName: 'Tower Crane', equipmentClassId: 2 },
  { id: 31, equipmentName: 'Generator 100kVA', equipmentClassId: 3 },
];
const CLASSES = [{ id: 1, className: 'Excavators' }, { id: 2, className: 'Cranes' }, { id: 3, className: 'Generators' }];
const line = (id, serial, req, reqId, project, status, from, to, extra) => Object.assign({
  eqrRequestLineId: id, eqrEquipmentRequestId: reqId, requestNumber: req, lineNumber: 1, projectName: project, taskName: 'Earthworks',
  requestorName: 'Pat Lee', allocatedSerial: serial, allocStatus: status, requestedStartDate: iso(from), requestedEndDate: iso(to), deploymentLocation: 'Gate 3' }, extra || {});
const LINES = [
  line(9001, 'EX-2201', 'REQ-10511', 511, 'Pipeline North', 'ALLOCATED', -5, 10),
  line(9002, 'EX-2201', 'REQ-10530', 530, 'Plant Expansion B', 'PENDING', 5, 30),
  line(9003, 'EX-2203', 'REQ-10530', 530, 'Plant Expansion B', 'PENDING', 2, 40, { lineNumber: 2 }),
  line(9004, 'EX-2210', 'REQ-10540', 540, 'Pipeline North', 'ALLOCATED', 3, 12),
  line(9005, 'MC-07', 'REQ-10498', 498, 'Plant Expansion B', 'ALLOCATED', -20, 6),
  line(9010, 'MC-07', 'REQ-10560', 560, 'Harbour Wall', 'ALLOCATED', 8, 20),
  line(9006, 'TC-02', 'REQ-10470', 470, 'Harbour Wall', 'CANCELLED', -10, 5),
  line(9006, 'TC-02', 'REQ-10470', 470, 'Harbour Wall', 'CANCELLED', -10, 5),
  line(9007, 'MC-07', 'REQ-10400', 400, 'Harbour Wall', 'ALLOCATED', -60, -30),
  line(9008, 'MC-07', 'REQ-10401', 401, 'Harbour Wall', 'ALLOCATED', -40, -25),
  line(9011, 'ZZ-9', 'REQ-10600', 600, '', 'ALLOCATED', 1, 3, { equipmentName: 'Light Tower', className: 'Lighting' }),
  line(9012, 'EX-2299', 'REQ-10380', 380, 'Old job', 'ALLOCATED', -15, 9),
  line(9013, 'TC-05', 'REQ-10610', 610, 'Plant Expansion B', 'ALLOCATED', 0, 5),
];
// 300 generators in the Houston yard: a booking ending in four days on every second one, one from day 15 to 25 on
// every third. 200 of them are free in the window (days 7 to 19).
for (let i = 1; i <= 300; i++) {
  const serial = 'GEN-' + (1000 + i);
  SERIALS.push({ id: 100 + i, serialNumber: serial, equipmentId: 31, currentLocationId: 501 });
  if (i % 2 === 0) LINES.push(line(20000 + i, serial, 'REQ-2' + pad(i % 50), 2000 + (i % 50), 'Plant Expansion B', 'ALLOCATED', -3, 4));
  if (i % 3 === 0) LINES.push(line(30000 + i, serial, 'REQ-3' + pad(i % 50), 3000 + (i % 50), 'Harbour Wall', 'PENDING', 15, 25));
}
const REQS = [
  { eqrEquipmentRequestId: 511, requestNumber: 'REQ-10511', status: 'IN_PROCESS', startDate: d(-5), endDate: d(10), projectName: 'Pipeline North', requestOrigin: 'Internal' },
  { eqrEquipmentRequestId: 600, requestNumber: 'REQ-10600', status: 'IN_PROCESS', startDate: d(1), endDate: d(3), customerName: 'Lone Star Paving', requestOrigin: 'External' },
];
const MY_LINES = [
  { requestNumber: 'REQ-10511', lineNumber: 1, equipmentName: 'CAT 320 Excavator', lineStatus: 'DEPLOYED', allocatedSerial: 'EX-2201' },
  { requestNumber: 'REQ-10530', lineNumber: 1, lineStatus: 'IN_PROCESS' }, { requestNumber: 'REQ-10530', lineNumber: 2, lineStatus: 'IN_PROCESS' },
  { requestNumber: 'REQ-10540', lineNumber: 1, lineStatus: 'SHIP_TO_SITE' }, { requestNumber: 'REQ-10498', lineNumber: 1, lineStatus: 'DEPLOYED' },
  { requestNumber: 'REQ-10560', lineNumber: 1, lineStatus: 'SCHEDULED_FOR_PICKING' }, { requestNumber: 'REQ-10380', lineNumber: 1, lineStatus: 'RETURNED' },
];
const LOCATIONS = { 501: { id: 501, locationName: 'Houston Yard', locationCode: 'HOU-Y1' }, 502: { id: 502, locationName: 'Dallas Yard', locationCode: 'DAL-Y2' } };
const WORK_ORDERS = {
  'MA-2210': [{ WorkOrderNumber: 'WO-55821', WorkOrderType: 'Preventive', WorkOrderDescription: '500 h service', PlannedStartDate: iso(8), PlannedCompletionDate: iso(14), WorkOrderStatus: 'Released' }],
  'MA-2300': [{ WorkOrderNumber: 'WO-60000', WorkOrderType: 'Repair', PlannedStartDate: iso(10), PlannedCompletionDate: iso(11) }],
};

let linesDown = false;
function handle(req, res) {
  const p = req.path;
  if (p.endsWith('/serial-refs')) return res.json({ data: SERIALS, hasMore: false });
  if (p.endsWith('/equipment-classes')) return res.json({ data: CLASSES, hasMore: false });
  if (p.endsWith('/views/workbench-lines')) return linesDown ? res.json({ message: 'down' }, 500) : res.json({ data: LINES, hasMore: false });
  if (p.endsWith('/equipment-master')) return res.json({ data: MASTERS, recordCount: MASTERS.length, hasMore: false });
  if (p.endsWith('/views/my-requests')) return res.json({ data: REQS });
  if (p.endsWith('/views/my-request-lines')) return res.json({ data: MY_LINES });
  const loc = /\/locations\/(\d+)$/.exec(p);
  if (loc) return LOCATIONS[loc[1]] ? res.json(LOCATIONS[loc[1]]) : res.json({ message: 'not found' }, 404);
  const q = req.query.get('q') || '';
  if (p.endsWith('/installedBaseAssets')) return res.json({ items: /MA-2210|MA-2300/.test(q) ? [{ AssetId: q.includes('2210') ? 300100 : 300200, OperatingOrganizationCode: 'HOU' }] : [] });
  if (p.endsWith('/maintenanceWorkOrders')) {
    const asset = (/AssetNumber='([^']+)'/.exec(q) || [])[1];
    return res.json({ items: (asset && WORK_ORDERS[asset]) || [] });
  }
  if (p.endsWith('/views/request-detail-lines')) {
    const id = Number(req.query.get('requestId'));
    return res.json({ data: id === 511 ? [{ lineId: 5111, lineNumber: 1, requestNumber: 'REQ-10511', equipmentName: 'CAT 320 Excavator', lineStatus: 'DEPLOYED', requestStatus: 'IN_PROCESS',
      allocatedSerial: 'EX-2201', projectName: 'Pipeline North', requestedStartDate: d(-5), requestedEndDate: d(10), quantity: 1 }] : [] });
  }
  const m = /\/equipment-requests\/(\d+)$/.exec(p);
  if (m) return res.json({ id: Number(m[1]), requestNumber: 'REQ-' + (Number(m[1]) === 511 ? '10511' : m[1]), status: 'IN_PROCESS' });
  return undefined;
}

async function download(page, fmt) {
  await page.click('#avExport');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`.nx-menu-item[data-format="${fmt}"]`)]);
  const file = path.join(os.tmpdir(), 'next-' + dl.suggestedFilename());
  await dl.saveAs(file);
  return { name: dl.suggestedFilename(), file };
}

(async () => {
  const env = await E.start({ port: 19340, handle, app: 'next' });
  const { page } = env;
  const units = async () => page.$$eval('.nx-av-row--unit', (r) => r.map((x) => x.dataset.unit));
  const settle = (ms) => page.waitForTimeout(ms || 250);
  try {
    T.section('opens and reads what New EquipRite\'s schedule reads');
    const t0 = Date.now();
    await env.open('/?open=availability');
    await page.waitForSelector('.nx-av-row--unit', { timeout: 30000 });
    const firstRows = Date.now() - t0;
    await page.waitForFunction(() => !/still loading/.test(document.getElementById('avAskNote').innerText), null, { timeout: 30000 });
    await settle(300);
    T.eq('the tab', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId + '=' + t.innerText.trim()), 'availability=Availability');
    T.eq('the summary', await env.text('#avSummary'), '309 units in 4 classes · 258 bookings now or ahead · 2 clashes · 1 tight turnaround');
    const calls = env.calls.map((c) => decodeURIComponent(c).replace('/equiprite/v1', '').replace('/fscmRestApi/resources/11.13.18.05', ''));
    [
      'GET /serial-refs?size=10000',
      'GET /equipment-classes?page=0&size=200',
      'GET /views/workbench-lines?page=0&size=2000',
      'GET /equipment-master?page=0&size=200',
      'GET /locations/501',
      'GET /locations/502',
      "GET /installedBaseAssets?limit=1&onlyData=true&q=AssetNumber='MA-2210'",
      "GET /maintenanceWorkOrders?limit=100&onlyData=true&orderBy=PlannedStartDate:desc&q=AssetNumber='MA-2210'",
    ].forEach((c) => T.check('called ' + c, calls.includes(c), calls.filter((x) => !/rbac|conf-global|session|lookups|Report|users/i.test(x)).join(' ; ')));
    T.check('no work orders asked for an asset Fusion does not know', !calls.some((c) => c.includes('maintenanceWorkOrders') && c.includes('MA-2201')));
    T.eq('each location read once', calls.filter((c) => c.startsWith('GET /locations/')).length, 2);
    T.eq('reading availability writes nothing', env.writes.length, 0);
    T.check('first rows on screen within 10 s of opening (309 units)', firstRows < 10000, firstRows + ' ms');
    T.eq('the window starts as the next two weeks', [await page.inputValue('#avFrom'), await page.inputValue('#avTo')].join(' '), d(0) + ' ' + d(13));
    T.check('today\'s line and the window are drawn on the timeline', !!(await page.$('#avToday')) && !!(await page.$('#avBand')));
    T.eq('the window\'s days are marked in the header', (await page.$$('.nx-av-tick--win')).length, 14);

    T.section('can I have one from day 7 to day 19?');
    await page.fill('#avFrom', d(7));
    await settle();
    await page.fill('#avTo', d(19));
    await settle(400);
    T.eq('the window', [await page.inputValue('#avFrom'), await page.inputValue('#avTo')].join(' '), d(7) + ' ' + d(19));
    T.check('the answer', (await env.text('#avAnswer')).startsWith('204 of 309 units free') && (await env.text('#avAnswer')).includes('(1 with a tight turnaround)'), await env.text('#avAnswer'));
    const cards = await page.$$eval('.nx-av-class', (c) => c.map((x) => x.querySelector('.nx-av-class-name').innerText + ': ' + x.querySelector('.nx-av-class-free').innerText));
    T.eq('free per class', cards.join(' | '), 'All classes: 204 of 309 free | Cranes: 2 of 3 free | Excavators: 1 of 5 free | Generators: 200 of 300 free | Lighting: 1 of 1 free');
    T.check('why Excavators are short, in words', (await env.text('.nx-av-class[data-value="Excavators"]')).includes('3 booked · 1 in maintenance'));
    T.eq('the timeline moves to the window, its days marked', (await page.$$('.nx-av-tick--win')).length + ' ' + !!(await page.$('#avBand')), '13 true');
    await page.click('.nx-av-class[data-value="Excavators"]');
    await settle(300);
    T.eq('picking a class shows its units, clashes first', (await units()).join(), 'EX-2201,EX-2210,EX-2203,EX-2299,EX-2300');
    T.check('the answer follows the class', (await env.text('#avAnswer')).startsWith('1 of 5 units Excavators free'), await env.text('#avAnswer'));
    const states = await page.$$eval('.nx-av-row--unit', (r) => r.map((x) => x.dataset.unit + ':' + x.querySelector('.nx-av-state').innerText.trim()));
    T.eq('each unit says whether it is free in the window', states.join(' '), 'EX-2201:Booked EX-2210:Booked EX-2203:Booked EX-2299:Free EX-2300:Maintenance');
    await page.click('.nx-chip[data-value="free"]');
    await settle(300);
    T.eq('Free in your window', (await units()).join(), 'EX-2299');
    await env.shot('next-availability-window.png');
    await page.click('#avClear');
    await settle(300);

    T.section('the timeline');
    const row = '.nx-av-row--unit[data-unit="EX-2201"]';
    const bars = await page.$$eval(row + ' .nx-av-bar', (b) => b.map((x) => ({ text: x.innerText.trim(), cls: x.className, tag: x.tagName })));
    T.eq('bars named by request and project', bars.map((b) => b.text).join(' | '), 'REQ-10511 · Pipeline North | REQ-10530 · Plant Expansion B');
    T.check('coloured by journey stage: on site, assigned; held, not confirmed', bars[0].cls.includes('nx-stage--onsite') && bars[0].cls.includes('nx-av-bar--hard')
      && bars[1].cls.includes('nx-av-bar--soft'), bars.map((b) => b.cls).join(' ; '));
    T.check('a clash: both bars outlined and the days marked', bars.every((b) => b.cls.includes('nx-av-bar--clash')) && !!(await page.$(row + ' .nx-av-mark--clash')));
    const tops = await page.$$eval(row + ' .nx-av-bar', (b) => b.map((x) => x.style.top));
    T.eq('overlapping bars stack instead of hiding each other', tops.join(), '6px,30px');
    const maint = await page.$$eval('.nx-av-row--unit[data-unit="EX-2210"] .nx-av-bar--maint', (b) => b.map((x) => x.innerText.trim() + '|' + x.tagName));
    T.eq('planned maintenance from Fusion, not clickable', maint.join(), 'Maintenance · WO-55821|SPAN');
    T.check('the stored status one hover away', (await page.getAttribute(row + ' .nx-av-bar', 'title')).includes('Stored: allocation ALLOCATED, line DEPLOYED'));
    T.check('a cancelled booking is not drawn', (await page.$$('.nx-av-row--unit[data-unit="TC-02"] .nx-av-bar')).length === 0);
    T.check('back at the yard: faded, and the unit free', (await page.getAttribute('.nx-av-row--unit[data-unit="EX-2299"] .nx-av-bar', 'class')).includes('nx-av-bar--past'));
    T.eq('grouped by class, each saying how many are free', (await page.$$eval('.nx-av-group-name', (g) => g.map((x) => x.innerText.trim()))).join(), 'Cranes,Excavators,Generators,Lighting');
    T.check('a group heading counts the free ones', (await env.text('.nx-av-row--group')).includes('3 units · 2 free'), await env.text('.nx-av-row--group'));
    T.eq('four weeks, day by day', (await page.$$('.nx-av-tick')).length, 28);
    T.eq('every class shows, a page of rows each (80 shared out)', (await units()).length, 29);
    T.eq('the rest one click away, inside the class', await env.text('.nx-av-row--more'), 'Show 50 more of Generators (280 not shown)');
    await env.shot('next-availability.png');
    const t1 = Date.now();
    await page.click('.nx-av-row--more button');
    await page.waitForFunction(() => document.querySelectorAll('.nx-av-row--unit').length === 79);
    const moreMs = Date.now() - t1;
    T.check('50 more rows within 3 s', moreMs < 3000, moreMs + ' ms');
    const t2 = Date.now();
    await page.fill('#avSearch', 'req-10560');
    await page.waitForFunction(() => document.querySelectorAll('.nx-av-row--unit').length === 1);
    const searchMs = Date.now() - t2;
    T.check('a search over 309 units within 3 s', searchMs < 3000, searchMs + ' ms');
    console.log('  (timings: first rows ' + firstRows + ' ms after opening the app, 50 more rows ' + moreMs + ' ms, search ' + searchMs + ' ms)');
    T.eq('search finds a unit by its booking', (await units()).join(), 'MC-07');
    T.check('the tight turnaround on it, dashed', (await page.$$eval('.nx-av-row--unit[data-unit="MC-07"] .nx-av-bar', (b) => b.filter((x) => x.className.includes('nx-av-bar--tight')).length)) === 2
      && !!(await page.$('.nx-av-row--unit[data-unit="MC-07"] .nx-av-mark--tight')));
    await page.fill('#avSearch', '');
    await settle(300);

    T.section('week, month, moving, by yard');
    const before = await env.text('#avRange');
    await page.click('#avNext');
    await settle();
    T.check('later moves the timeline two weeks', (await env.text('#avRange')) !== before);
    await page.click('button[data-field="move"][data-value="window"]');
    await settle();
    T.eq('back to your window', await env.text('#avRange'), before);
    await page.click('button[data-field="zoom"][data-value="month"]');
    await settle(400);
    T.eq('month: thirteen weeks', (await page.$$('.nx-av-tick')).length, 13);
    T.check('month names over the weeks', (await page.$$eval('.nx-av-month', (m) => m.map((x) => x.innerText.trim()).filter(Boolean))).length >= 3);
    await env.shot('next-availability-month.png');
    await page.click('button[data-field="zoom"][data-value="week"]');
    await page.click('button[data-field="groupBy"][data-value="yard"]');
    await settle(400);
    T.eq('grouped by yard', (await page.$$eval('.nx-av-group-name', (g) => g.map((x) => x.innerText.trim()))).join(' | '), 'DAL-Y2 · Dallas Yard | HOU-Y1 · Houston Yard | No yard recorded');
    await page.click('#avYard');
    await page.click('.nx-menu-item[data-value="DAL-Y2"]');
    await settle(300);
    T.eq('one yard', (await units()).join(), 'EX-2210,MC-07,TC-05');
    await page.click('.nx-av-group');
    await settle(200);
    T.eq('a group folds to its heading', (await units()).length, 0);
    await page.click('#avClear');
    await page.click('button[data-field="groupBy"][data-value="class"]');
    await settle(300);

    T.section('where are my clashes?');
    const probs = await page.$$eval('.nx-av-prob', (p) => p.map((x) => x.querySelector('.nx-av-prob-title').innerText.trim() + ':' + x.dataset.unit));
    T.eq('listed, earliest first', probs.join(' | '), 'Double booking:EX-2201 | Booked during maintenance:EX-2210 | Tight turnaround:MC-07');
    T.check('a clash names both bookings and when', (await env.text('.nx-av-prob[data-unit="EX-2201"]')).includes('REQ-10511') && (await env.text('.nx-av-prob[data-unit="EX-2201"]')).includes('REQ-10530')
      && (await env.text('.nx-av-prob[data-unit="EX-2201"]')).includes('6 days at once'));
    await page.click('.nx-chip[data-value="clash"]');
    await settle(300);
    T.eq('the Clashes chip', (await units()).join(), 'EX-2201,EX-2210');
    await page.click('#avClear');
    await page.click('.nx-av-prob[data-unit="MC-07"] .nx-av-show');
    await settle(500);
    T.eq('Show on the timeline: that unit', (await units()).join() + ' / ' + (await page.inputValue('#avSearch')), 'MC-07 / MC-07');
    await page.click('#avClear');
    await settle(300);
    await env.shot('next-availability-clashes.png');

    T.section('export the bookings shown');
    await page.click('.nx-av-class[data-value="Cranes"]');
    await settle(300);
    const csv = await download(page, 'csv');
    T.check('CSV file name', /^equiprite-availability-\d{4}-\d{2}-\d{2}\.csv$/.test(csv.name), csv.name);
    const lines = fs.readFileSync(csv.file, 'utf8').split('\r\n').filter(Boolean);
    T.eq('the Cranes bookings in view: header + 3', lines.length, 4);
    T.check('rows read as on screen', lines[0].includes('Unit (serial),Equipment,Class,Yard') && lines.some((l) => l.startsWith('MC-07,Mobile Crane 50t,Cranes') && l.includes('REQ-10560')),
      lines.join(' / '));
    await page.click('#avClear');
    await page.click('.nx-av-class[data-value="Excavators"]');
    await settle(300);
    const xl = await download(page, 'xlsx');
    let read = '';
    try {
      read = execFileSync('python3', ['-I', '-c', 'import sys, openpyxl\nws = openpyxl.load_workbook(sys.argv[1]).active\nrows = list(ws.iter_rows(values_only=True))\nprint(len(rows)); print(sorted(set(r[5] for r in rows[1:]))); print([r for r in rows if r[5] == "REQ-10511"][0][11])', xl.file], { encoding: 'utf8' }).trim();
    } catch (e) { read = 'unavailable'; }
    if (read !== 'unavailable') {
      T.eq('the Excel rows: bookings and maintenance of the excavators, days as numbers', read.split('\n').join(' | '),
        "8 | ['REQ-10380', 'REQ-10511', 'REQ-10530', 'REQ-10540', 'WO-55821', 'WO-60000'] | 16");
    }
    await page.click('#avClear');
    await settle(300);

    T.section('a booking opens its request');
    await page.click('.nx-av-row--unit[data-unit="EX-2201"] button.nx-av-bar');
    await page.waitForSelector('.nx-record-title', { timeout: 20000 });
    await settle(500);
    T.eq('in a tab named after it', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId + '=' + t.innerText.trim()), 'request:511=REQ-10511');
    await page.click('.nx-tab-btn[data-id="availability"]');
    await settle(400);
    T.check('back on Availability, as it was left', (await page.isVisible('.nx-av-row--unit[data-unit="EX-2201"]')) && (await page.inputValue('#avFrom')) === d(7));

    T.section('a quick window');
    await page.click('.nx-av-presets .nx-chip[data-value="7"]');
    await settle(400);
    T.eq('the date boxes follow, even after typing in them', [await page.inputValue('#avFrom'), await page.inputValue('#avTo')].join(' '), d(0) + ' ' + d(6));
    T.check('and the answer', /^\d+ of 309 units free/.test(await env.text('#avAnswer')), await env.text('#avAnswer'));

    T.section('fits the screen');
    T.check('no sideways scroll on a laptop', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    await page.setViewportSize({ width: 390, height: 900 });
    await settle(600);
    // The page's own content; the shell's top bar is the shell's (it is wider than a phone on every screen).
    const phone = await page.evaluate(() => [...document.querySelectorAll('.nx-content, .nx-av')].map((c) => c.scrollWidth + '/' + c.clientWidth));
    T.check('no sideways scroll on a phone', phone.every((x) => Number(x.split('/')[0]) <= Number(x.split('/')[1]) + 1), phone.join(' '));
    T.check('the timeline still fits: bars inside the track', await page.evaluate(() => [...document.querySelectorAll('.nx-av-bar')].every((b) => b.getBoundingClientRect().right <= window.innerWidth + 1)));
    await env.shot('next-availability-phone.png');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await settle(300);

    T.eq('reads only', env.writes.length, 0);
    T.eq('no browser errors', env.errors.filter((e) => !e.startsWith('warning')).join('\n'), '');

    T.section('a source that fails is said on the page');
    linesDown = true;
    await page.click('#avRefresh');
    await page.waitForSelector('.nx-av-note', { timeout: 20000 });
    await settle(400);
    T.check('bookings not loaded: said in words, units still listed', (await env.text('.nx-av-note')).includes('Bookings could not be loaded (HTTP 500)')
      && (await units()).length > 0, await env.text('.nx-av-note'));
    T.eq('nothing written on a refresh either', env.writes.length, 0);
  } catch (e) {
    T.check('run finished', false, e.message);
    await env.shot('next-availability-failed.png').catch(() => {});
  } finally {
    await env.close();
    T.report();
  }
})();
