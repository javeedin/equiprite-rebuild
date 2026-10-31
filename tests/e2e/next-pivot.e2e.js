'use strict';
/*
 * EquipRite Next, Availability's yard grid, in a real browser: Timeline | Yard grid on the Units and bookings card;
 * equipment as rows grouped by class, yards as columns ("No yard recorded" last); a tick where the equipment is with
 * how many and how many are free in your window, coloured all / some / none free; row and yard totals; free counts
 * following the window; the page's search; the Units grain; a cell and a unit row opening the equipment-360 tab;
 * export of the grid as shown (the file read back); another screen's handover (shellBus.focus: search, window, view),
 * with the tab open and closed; the name column and header staying put while the grid scrolls inside its card, never
 * the page, on a laptop and a phone; nothing written; no browser errors. Needs `npm run build`.
 * Run: node tests/e2e/next-pivot.e2e.js
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

// The fleet of tests/e2e/next-availability.e2e.js, and 60 generators spread over ten yards.
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
  line(9011, 'ZZ-9', 'REQ-10600', 600, '', 'ALLOCATED', 1, 3, { equipmentName: 'Light Tower', className: 'Lighting' }),
  line(9012, 'EX-2299', 'REQ-10380', 380, 'Old job', 'ALLOCATED', -15, 9),
  line(9013, 'TC-05', 'REQ-10610', 610, 'Plant Expansion B', 'ALLOCATED', 0, 5),
];
const LOCATIONS = {
  501: { id: 501, locationName: 'Houston Yard', locationCode: 'HOU-Y1' }, 502: { id: 502, locationName: 'Dallas Yard', locationCode: 'DAL-Y2' },
  503: { id: 503, locationName: 'Austin Yard', locationCode: 'AUS-Y3' }, 504: { id: 504, locationName: 'San Antonio Yard', locationCode: 'SAT-Y4' },
  505: { id: 505, locationName: 'El Paso Yard', locationCode: 'ELP-Y5' }, 506: { id: 506, locationName: 'Lubbock Depot', locationCode: 'LBB-Y6' },
  507: { id: 507, locationName: 'Corpus Christi Yard', locationCode: 'CRP-Y7' }, 508: { id: 508, locationName: 'Midland Yard', locationCode: 'MAF-Y8' },
  509: { id: 509, locationName: 'Tyler Yard', locationCode: 'TYR-Y9' }, 510: { id: 510, locationName: 'Beaumont Yard', locationCode: 'BPT-Y10' },
};
// Generator i is at yard 501 + (i % 10); out until day 4 when i is even, out from day 15 to 25 when i is a multiple of 3.
const GEN = [];
for (let i = 1; i <= 60; i++) {
  const serial = 'GEN-' + (1000 + i);
  GEN.push({ i, serial, loc: 501 + (i % 10) });
  SERIALS.push({ id: 100 + i, serialNumber: serial, equipmentId: 31, currentLocationId: 501 + (i % 10) });
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
const WORK_ORDERS = {
  'MA-2210': [{ WorkOrderNumber: 'WO-55821', WorkOrderType: 'Preventive', WorkOrderDescription: '500 h service', PlannedStartDate: iso(8), PlannedCompletionDate: iso(14), WorkOrderStatus: 'Released' }],
  'MA-2300': [{ WorkOrderNumber: 'WO-60000', WorkOrderType: 'Repair', PlannedStartDate: iso(10), PlannedCompletionDate: iso(11) }],
};

function handle(req, res) {
  const p = req.path;
  if (p.endsWith('/serial-refs')) return res.json({ data: SERIALS, hasMore: false });
  if (p.endsWith('/equipment-classes')) return res.json({ data: CLASSES, hasMore: false });
  if (p.endsWith('/views/workbench-lines')) return res.json({ data: LINES, hasMore: false });
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
  return undefined;
}

// The yards as the grid's columns: by name, "No yard recorded" last.
const YARDS = Object.values(LOCATIONS).map((l) => ({ key: l.locationCode, label: l.locationCode + ' · ' + l.locationName, id: l.id }))
  .sort((a, b) => (a.label.toLowerCase() < b.label.toLowerCase() ? -1 : 1));
const COLUMN_KEYS = YARDS.map((y) => y.key).concat(['-']);
// Generators in your window, day 7 to 19: free unless out from day 15 (the ones out until day 4 are back three days before it).
const genAt = (loc, free) => GEN.filter((g) => g.loc === loc && (!free || g.i % 3 !== 0)).length;

async function download(page, fmt) {
  await page.click('#avExport');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`.nx-menu-item[data-format="${fmt}"]`)]);
  const file = path.join(os.tmpdir(), 'next-pivot-' + dl.suggestedFilename());
  await dl.saveAs(file);
  return { name: dl.suggestedFilename(), file };
}

(async () => {
  const env = await E.start({ port: 19440, handle, app: 'next' });
  const { page } = env;
  const settle = (ms) => page.waitForTimeout(ms || 250);
  const rows = async () => page.$$eval('#avGrid .nx-pv-row--item .nx-cell-main', (r) => r.map((x) => x.innerText.trim()));
  const cell = async (row, yard) => page.$eval(`#avGrid .nx-pv-row--item[data-key="${row}"] .nx-pv-c[data-yard="${yard}"]`, (c) => c.innerText.trim());
  const tick = async (row, yard) => page.$eval(`#avGrid .nx-pv-row--item[data-key="${row}"] .nx-pv-c[data-yard="${yard}"] .nx-pv-tick`, (c) => c.className);
  const eqRow = (cls, name) => 'e:' + cls + '|' + name;
  // Fires another screen's handover, as Check availability will: shellBus.focus('availability', what).
  const handover = (what) => page.evaluate((w) => new Promise((resolve, reject) => {
    window.require(['resources/js/shellBus'], (bus) => { bus.focus('availability', w); resolve(true); }, reject);
  }), what);
  try {
    T.section('the timeline stays the default');
    await env.open('/?open=availability');
    await page.waitForSelector('.nx-av-row--unit', { timeout: 30000 });
    await page.waitForFunction(() => !/still loading/.test(document.getElementById('avAskNote').innerText), null, { timeout: 30000 });
    await settle(300);
    T.eq('Timeline | Yard grid on the card, Timeline on', await page.$$eval('.nx-pv-switch .nx-seg-btn', (b) => b.map((x) => x.innerText.trim() + ':' + x.getAttribute('aria-pressed')).join(' ')),
      'Timeline:true Yard grid:false');
    T.check('no grid until asked for', !(await page.$('#avGrid')));
    // Your window: day 7 to day 19.
    await page.fill('#avFrom', d(7));
    await settle();
    await page.fill('#avTo', d(19));
    await settle(400);

    T.section('the yard grid: equipment by yard');
    await page.click('#avShowGrid');
    await page.waitForSelector('#avGrid .nx-pv-row--item', { timeout: 10000 });
    await settle(300);
    T.eq('the switch shows the grid', await page.$eval('#avShowGrid', (b) => b.getAttribute('aria-pressed')), 'true');
    T.check('the timeline and its own tools step aside', !(await page.$('.nx-av-row--unit')) && !(await page.$('button[data-field="zoom"]')) && !(await page.$('#avRange')));
    T.eq('a column per yard, by name, "No yard recorded" last', (await page.$$eval('#avGrid .nx-pv-row--head .nx-pv-yard', (c) => c.map((x) => x.dataset.yard))).join(), COLUMN_KEYS.join());
    T.eq('a yard\'s header: code and name', await page.$eval('#avGrid .nx-pv-yard[data-yard="HOU-Y1"]', (c) => c.innerText.replace(/\s+/g, ' ').trim()), 'HOU-Y1 Houston Yard');
    T.eq('classes, then equipment by name', (await page.$$eval('#avGrid .nx-pv-row--group, #avGrid .nx-pv-row--item', (r) => r.map((x) => (x.classList.contains('nx-pv-row--group')
      ? '[' + x.querySelector('.nx-pv-group-name').innerText.trim() + ']' : x.querySelector('.nx-cell-main').innerText.trim())))).join(' '),
      '[Cranes] Mobile Crane 50t Tower Crane [Excavators] CAT 320 Excavator PC210 Excavator [Generators] Generator 100kVA [Lighting] Light Tower');
    T.eq('a tick where it is: how many, how many free in your window', await cell(eqRow('Excavators', 'PC210 Excavator'), 'HOU-Y1'), '✓ 2 · 1 free');
    T.eq('empty where it is not', await cell(eqRow('Excavators', 'PC210 Excavator'), 'AUS-Y3'), '');
    T.eq('Tower Crane: one at Dallas (tight, still free), one with no yard', [await cell(eqRow('Cranes', 'Tower Crane'), 'DAL-Y2'), await cell(eqRow('Cranes', 'Tower Crane'), '-')].join(' | '),
      '✓ 1 · 1 free | ✓ 1 · 1 free');
    T.eq('coloured by your window: none, some, all free',
      [await tick(eqRow('Excavators', 'CAT 320 Excavator'), 'HOU-Y1'), await tick(eqRow('Excavators', 'PC210 Excavator'), 'HOU-Y1'), await tick(eqRow('Cranes', 'Tower Crane'), 'DAL-Y2')]
        .map((c) => c.split('--')[1]).join(), 'none,some,all');
    const genCells = await page.$$eval(`#avGrid .nx-pv-row--item[data-key="${eqRow('Generators', 'Generator 100kVA')}"] .nx-pv-c`, (c) => c.map((x) => x.innerText.trim()));
    T.eq('60 generators over ten yards', genCells.join(' | '), YARDS.map((y) => '✓ ' + genAt(y.id) + ' · ' + genAt(y.id, true) + ' free').concat(['']).join(' | '));
    const totals = await page.$$eval('#avGrid .nx-pv-row--item', (r) => r.map((x) => [...x.querySelectorAll('.nx-pv-num')].map((n) => n.innerText.trim()).join('/')));
    T.eq('row totals: units and free', totals.join(' '), '1/0 2/2 2/0 3/1 60/40 1/1');
    const yardTotals = await page.$$eval('#avGrid .nx-pv-row--total .nx-pv-c', (c) => c.map((x) => x.dataset.yard + '=' + x.innerText.trim()));
    T.eq('a totals row per yard', yardTotals.find((t) => t.startsWith('HOU-Y1=')) + ' ' + yardTotals.find((t) => t.startsWith('-=')),
      'HOU-Y1=' + (4 + genAt(501)) + ' · ' + (1 + genAt(501, true)) + ' free -=2 · 2 free');
    const all = await page.$$eval('#avGrid .nx-pv-row--total .nx-pv-num', (n) => n.map((x) => x.innerText.trim()).join('/'));
    T.eq('and in all, as the capacity panel says', all + ' / ' + (await env.text('.nx-av-class--all .nx-av-class-free')), '69/44 / 44 of 69 free');
    T.check('the line above the grid', (await env.text('#avGridNote')).startsWith('6 equipment items · 69 units in 11 yards · 44 free'), await env.text('#avGridNote'));
    T.check('a cell says it in words on hover', (await page.getAttribute(`#avGrid .nx-pv-row--item[data-key="${eqRow('Excavators', 'PC210 Excavator')}"] .nx-pv-c[data-yard="HOU-Y1"]`, 'title'))
      .includes('2 units, 1 free · 1 in maintenance'));
    await page.$eval('#avTimeline', (e) => e.scrollIntoView({ block: 'start' }));
    await env.shot('next-pivot.png');

    T.section('free follows your window');
    await page.click('.nx-av-presets .nx-chip[data-value="7"]');
    await settle(400);
    T.eq('the next 7 days: both PC210s at Houston free', await cell(eqRow('Excavators', 'PC210 Excavator'), 'HOU-Y1'), '✓ 2 · 2 free');
    T.eq('the generators out until day 4 are not', await cell(eqRow('Generators', 'Generator 100kVA'), 'HOU-Y1'), '✓ ' + genAt(501) + ' · ' + GEN.filter((g) => g.loc === 501 && g.i % 2 !== 0).length + ' free');
    await page.fill('#avFrom', d(7));
    await settle();
    await page.fill('#avTo', d(19));
    await settle(400);
    T.eq('back to day 7 to 19', await cell(eqRow('Excavators', 'PC210 Excavator'), 'HOU-Y1'), '✓ 2 · 1 free');

    T.section('the page\'s search, chips and yard apply');
    await page.fill('#avSearch', 'excavator');
    await settle(400);
    T.eq('search: the excavators', (await rows()).join(), 'CAT 320 Excavator,PC210 Excavator');
    T.eq('every yard is still a column', (await page.$$('#avGrid .nx-pv-row--head .nx-pv-yard')).length, 11);
    await page.fill('#avSearch', 'req-10560');
    await settle(400);
    T.eq('search by a booking', (await rows()).join(), 'Mobile Crane 50t');
    await page.fill('#avSearch', '');
    await settle(300);
    await page.click('.nx-chip[data-value="free"]');
    await settle(400);
    T.eq('Free in your window: only free units counted', await cell(eqRow('Generators', 'Generator 100kVA'), 'HOU-Y1'), '✓ ' + genAt(501, true) + ' · ' + genAt(501, true) + ' free');
    await page.click('#avClear');
    await settle(300);
    await page.click('#avYard');
    await page.click('.nx-menu-item[data-value="DAL-Y2"]');
    await settle(400);
    T.eq('one yard: its column alone', (await page.$$eval('#avGrid .nx-pv-row--head .nx-pv-yard', (c) => c.map((x) => x.dataset.yard))).join(), 'DAL-Y2');
    await page.click('#avClear');
    await settle(300);
    await page.click('#avGrid .nx-pv-group[data-value="c:Generators"]');
    await settle(300);
    T.check('a class folds to its row, still counting per yard', !(await rows()).includes('Generator 100kVA')
      && (await page.$eval('#avGrid .nx-pv-row--group[data-group="c:Generators"] .nx-pv-c[data-yard="HOU-Y1"]', (c) => c.innerText.trim())) === genAt(501) + ' · ' + genAt(501, true) + ' free');
    await page.click('#avGrid .nx-pv-group[data-value="c:Generators"]');
    await settle(300);

    T.section('export the grid as shown');
    await page.click('#avExport');
    T.check('the menu says what goes out', (await env.text('.nx-menu-note')).startsWith('6 equipment items by 11 yards, free'), await env.text('.nx-menu-note'));
    await page.click('#avExport');
    const csv = await download(page, 'csv');
    T.check('CSV file name', /^equiprite-availability-yard-grid-\d{4}-\d{2}-\d{2}\.csv$/.test(csv.name), csv.name);
    const lines = fs.readFileSync(csv.file, 'utf8').replace(/^﻿/, '').split('\r\n').filter(Boolean);
    T.eq('the header: class, equipment, the yards, the totals', lines[0], 'Class,Equipment,' + YARDS.map((y) => y.label).join(',') + ',No yard recorded,Units,Free in your window');
    T.eq('a row per equipment, then the totals', lines.length, 1 + 6 + 1);
    T.check('rows read as on screen', lines.some((l) => l.startsWith('Excavators,PC210 Excavator,') && l.includes('✓ 2 · 1 free') && l.endsWith(',3,1'))
      && lines[lines.length - 1].startsWith(',Total,') && lines[lines.length - 1].endsWith(',69,44'), lines.join(' / '));
    const xl = await download(page, 'xlsx');
    let read = '';
    try {
      read = execFileSync('python3', ['-I', '-c', 'import sys, openpyxl\nws = openpyxl.load_workbook(sys.argv[1]).active\nrows = list(ws.iter_rows(values_only=True))\nprint(len(rows)); print(rows[4][1], rows[4][-2], rows[4][-1], type(rows[4][-1]).__name__)', xl.file], { encoding: 'utf8' }).trim();
    } catch (e) { read = 'unavailable'; }
    if (read !== 'unavailable') T.eq('the Excel sheet: the totals as numbers', read.split('\n').join(' | '), '8 | PC210 Excavator 3 1 int');

    T.section('units: where is each one');
    await page.click('#avGrainUnits');
    await page.waitForSelector('#avGrid .nx-pv-row--item[data-serial="MC-07"]', { timeout: 10000 });
    await settle(300);
    const unitTick = async (serial) => page.$$eval(`#avGrid .nx-pv-row--item[data-serial="${serial}"] .nx-pv-c`, (c) => c.filter((x) => x.innerText.trim()).map((x) => x.dataset.yard + ' ' + x.innerText.trim()));
    T.eq('one tick per unit, in its yard, with its state in your window', [await unitTick('MC-07'), await unitTick('EX-2300'), await unitTick('TC-05'), await unitTick('TC-02')].map((x) => x.join()).join(' | '),
      'DAL-Y2 ✓ Booked | HOU-Y1 ✓ Maintenance | DAL-Y2 ✓ Free, tight | - ✓ Free');
    T.eq('coloured by its state', await page.$eval('#avGrid .nx-pv-row--item[data-serial="EX-2300"] .nx-pv-tick', (t) => t.className), 'nx-pv-tick nx-pv-tick--maint');
    T.eq('serial and name', await page.$eval('#avGrid .nx-pv-row--item[data-serial="EX-2201"] .nx-pv-first', (c) => c.innerText.replace(/\s+/g, ' ').trim()), 'EX-2201 CAT 320 Excavator');
    T.eq('a class shows a page of its units', await env.text('#avGrid .nx-pv-row--more'), 'Show 10 more of Generators (10 not shown)');
    await page.click('#avGrid .nx-pv-row--more button');
    await settle(400);
    T.eq('the rest one click away', (await page.$$('#avGrid .nx-pv-row--item')).length, 69);
    T.eq('the totals are the same', await page.$$eval('#avGrid .nx-pv-row--total .nx-pv-num', (n) => n.map((x) => x.innerText.trim()).join('/')), '69/44');
    T.check('the line above says units', (await env.text('#avGridNote')).startsWith('69 units in 11 yards · 44 free'), await env.text('#avGridNote'));

    T.section('the grid scrolls inside its card, never the page');
    const scroller = await page.$eval('#avGridScroll', (s) => ({ sw: s.scrollWidth, cw: s.clientWidth, sh: s.scrollHeight, ch: s.clientHeight }));
    T.check('eleven yards: the grid scrolls sideways', scroller.sw > scroller.cw, JSON.stringify(scroller));
    T.check('no sideways scroll on the page', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth
      && [...document.querySelectorAll('.nx-content, .nx-av')].every((c) => c.scrollWidth <= c.clientWidth + 1)));
    await page.$eval('#avGridScroll', (s) => { s.scrollLeft = 500; s.scrollTop = 600; });
    await settle(200);
    const stuck = await page.evaluate(() => {
      const box = document.getElementById('avGridScroll');
      const r = box.getBoundingClientRect();
      // The scroll box's inside (its border left out).
      const s = { left: r.left + box.clientLeft, top: r.top + box.clientTop };
      const corner = document.querySelector('#avGrid .nx-pv-corner').getBoundingClientRect();
      const name = document.querySelector('#avGrid .nx-pv-row--item[data-serial="GEN-1030"] .nx-pv-first');
      const aus = document.querySelector('#avGrid .nx-pv-row--head .nx-pv-yard[data-yard="AUS-Y3"]').getBoundingClientRect();
      return { corner: Math.round(corner.left - s.left) + ',' + Math.round(corner.top - s.top), name: name ? Math.round(name.getBoundingClientRect().left - s.left) : 'none', moved: aus.left < s.left + 100 };
    });
    T.eq('the header and the name column stay put', stuck.corner + ' ' + stuck.name, '0,0 0');
    T.check('the yards scroll under them', stuck.moved);
    await page.$eval('#avTimeline', (e) => e.scrollIntoView({ block: 'start' }));
    await env.shot('next-pivot-units-scrolled.png');
    await page.$eval('#avGridScroll', (s) => { s.scrollLeft = 0; s.scrollTop = 0; });

    T.section('a row or a cell opens everything about that equipment');
    await page.click('#avGrid .nx-pv-row--item[data-serial="MC-07"] .nx-pv-c[data-yard="DAL-Y2"]');
    await page.waitForSelector('.nx-tab[data-tab-id="equipment-360:unit-MC-07"]', { timeout: 20000 });
    await settle(400);
    T.eq('a unit opens by serial, in a tab of its own', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId + '=' + t.innerText.trim()), 'equipment-360:unit-MC-07=MC-07');
    await page.click('.nx-tab-btn[data-id="availability"]');
    await settle(400);
    await page.click('#avGrainEquipment');
    await settle(400);
    await page.click(`#avGrid .nx-pv-row--item[data-key="${eqRow('Excavators', 'CAT 320 Excavator')}"] .nx-pv-c[data-yard="HOU-Y1"]`);
    await page.waitForSelector('.nx-tab[data-tab-id="equipment-360:item-11"]', { timeout: 20000 });
    await settle(400);
    T.eq('an equipment cell opens the equipment, by its id', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId + '=' + t.innerText.trim()), 'equipment-360:item-11=CAT 320 Excavator');
    T.check('the equipment page has its name', (await page.innerText('.nx-tab-panel--on, .nx-content')).includes('CAT 320 Excavator'));
    await page.click('.nx-tab-btn[data-id="availability"]');
    await settle(400);
    await page.click(`#avGrid .nx-pv-row--item[data-key="${eqRow('Lighting', 'Light Tower')}"] .nx-pv-name`);
    await page.waitForSelector('.nx-tab[data-tab-id="equipment-360:item-Light Tower"]', { timeout: 20000 });
    T.check('an equipment with no id known opens by name', !!(await page.$('.nx-tab[data-tab-id="equipment-360:item-Light Tower"]')));
    await page.click('.nx-tab-btn[data-id="availability"]');
    await settle(400);
    T.check('back on the grid, as it was left', (await page.isVisible('#avGrid')) && (await page.inputValue('#avFrom')) === d(7));
    await page.click('.nx-av-prob[data-unit="MC-07"] .nx-av-show');
    await page.waitForSelector('.nx-av-row--unit', { timeout: 10000 });
    await settle(400);
    T.eq('a clash\'s "Show on the timeline" goes back to the timeline', (await page.$$eval('.nx-av-row--unit', (r) => r.map((x) => x.dataset.unit))).join() + ' '
      + (await page.$eval('#avShowTimeline', (b) => b.getAttribute('aria-pressed'))) + ' ' + !!(await page.$('#avGrid')), 'MC-07 true false');
    await page.click('#avClear');
    await settle(300);

    T.section('another screen opens it prefilled (shellBus.focus)');
    await handover({ text: 'Tower Crane', from: d(20), to: d(26), view: 'grid' });
    await page.waitForSelector('#avGrid', { timeout: 10000 });
    await settle(400);
    T.eq('the search, the window and the grid', [await page.inputValue('#avSearch'), await page.inputValue('#avFrom'), await page.inputValue('#avTo'),
      await page.$eval('#avShowGrid', (b) => b.getAttribute('aria-pressed'))].join(' '), 'Tower Crane ' + d(20) + ' ' + d(26) + ' true');
    T.eq('the grid shows what it found, free in that window', (await rows()).join() + ' ' + (await cell(eqRow('Cranes', 'Tower Crane'), 'DAL-Y2')), 'Tower Crane ✓ 1 · 1 free');
    T.check('the answer follows the window', (await env.text('#avAnswer')).includes(av(d(20), d(26))), await env.text('#avAnswer'));
    await handover({ view: 'timeline' });
    await page.waitForSelector('.nx-av-row--unit', { timeout: 10000 });
    await settle(300);
    T.eq('a view alone: the timeline, the search kept', (await page.$$eval('.nx-av-row--unit', (r) => r.map((x) => x.dataset.unit))).join() + ' / ' + (await page.inputValue('#avSearch')), 'TC-02,TC-05 / Tower Crane');
    // With the tab closed: it opens, loads, then takes what was handed over.
    await page.click('.nx-tab-close[data-id="availability"]');
    await settle(600);
    T.check('the tab is closed', !(await page.$('.nx-tab[data-tab-id="availability"]')));
    await handover({ text: 'generator', from: d(2), to: d(5), view: 'grid' });
    await page.waitForSelector('#avGrid .nx-pv-row--item', { timeout: 30000 });
    await page.waitForFunction(() => document.getElementById('avSearch') && document.getElementById('avSearch').value === 'generator', null, { timeout: 10000 });
    await settle(400);
    T.eq('reopened prefilled', [await page.inputValue('#avSearch'), await page.inputValue('#avFrom'), await page.inputValue('#avTo'), (await rows()).join()].join(' '),
      'generator ' + d(2) + ' ' + d(5) + ' Generator 100kVA');
    T.eq('free in that window: the ones out until day 4 are not', await cell(eqRow('Generators', 'Generator 100kVA'), 'HOU-Y1'),
      '✓ ' + genAt(501) + ' · ' + GEN.filter((g) => g.loc === 501 && g.i % 2 !== 0).length + ' free');
    await page.click('#avClear');
    await settle(400);

    T.section('fits the screen');
    T.check('no sideways scroll on a laptop', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    await page.setViewportSize({ width: 390, height: 900 });
    await settle(600);
    const phone = await page.evaluate(() => [...document.querySelectorAll('.nx-content, .nx-av')].map((c) => c.scrollWidth + '/' + c.clientWidth));
    T.check('no sideways scroll on a phone', phone.every((x) => Number(x.split('/')[0]) <= Number(x.split('/')[1]) + 1), phone.join(' '));
    T.check('the grid still scrolls inside its card', await page.$eval('#avGridScroll', (s) => s.scrollWidth > s.clientWidth && s.getBoundingClientRect().right <= window.innerWidth + 1));
    await page.$eval('#avTimeline', (e) => e.scrollIntoView({ block: 'start' }));
    await env.shot('next-pivot-phone.png');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await settle(300);

    T.eq('reads only', env.writes.length, 0);
    T.eq('no browser errors', env.errors.filter((e) => !e.startsWith('warning')).join('\n'), '');
  } catch (e) {
    T.check('run finished', false, e.message);
    await env.shot('next-pivot-failed.png').catch(() => {});
  } finally {
    await env.close();
    T.report();
  }
})();

// "20 – 26 Nov 2026" as availability.range() writes a window.
function av(a, b) {
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p = (s) => ({ y: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)) - 1, d: Number(s.slice(8, 10)) });
  const x = p(a);
  const y = p(b);
  if (x.y !== y.y) return x.d + ' ' + MON[x.m] + ' ' + x.y + ' – ' + y.d + ' ' + MON[y.m] + ' ' + y.y;
  if (x.m !== y.m) return x.d + ' ' + MON[x.m] + ' – ' + y.d + ' ' + MON[y.m] + ' ' + y.y;
  return x.d + ' – ' + y.d + ' ' + MON[y.m] + ' ' + y.y;
}
