'use strict';
/*
 * Equipment schedule in a real browser: the Gantt draws rows and bars from the fake data, conflicts come first,
 * filters, scale and month work, Map / List switch, the page reads exactly what the old page read and writes nothing
 * (a drag on a bar sends no call: the old schedule is read only), and with Bryntum and Mapbox blocked the same data
 * is listed. Needs `npm run build`. Run: node tests/e2e/schedule.e2e.js   (screenshots go to the OS temp folder)
 */
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();

// Dates relative to today, so the bookings are current whenever this runs.
const pad = (n) => (n < 10 ? '0' : '') + n;
const dayOf = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const rel = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return dayOf(d); };
const iso = (n) => rel(n) + 'T00:00:00Z';

const SERIALS = [
  { id: 1, serialNumber: 'EX-2201', equipmentId: 11, currentLocationId: 501, faAssetRefId: '100482', maintenanceAssetNumber: 'MA-2201' },
  { id: 2, serialNumber: 'EX-2203', equipmentId: 11, currentLocationId: 501, faAssetRefId: '100517' },
  { id: 3, serialNumber: 'EX-2210', equipmentId: 12, currentLocationId: 502, faAssetRefId: '100561', maintenanceAssetNumber: 'MA-2210' },
  { id: 4, serialNumber: 'MC-07', equipmentId: 21, currentLocationId: 502, faAssetRefId: '100219' },
  { id: 5, serialNumber: 'TC-02', equipmentId: 22, faAssetRefId: '100230' },
];
const MASTERS = [
  { id: 11, equipmentName: 'CAT 320 Excavator', equipmentClassId: 1, manufacturer: 'Caterpillar' },
  { id: 12, equipmentName: 'PC210 Excavator', equipmentClassId: 1, manufacturer: 'Komatsu' },
  { id: 21, equipmentName: 'Mobile Crane 50t', equipmentClassId: 2, manufacturer: 'Liebherr' },
  { id: 22, equipmentName: 'Tower Crane', equipmentClassId: 2, manufacturer: 'Potain' },
];
const CLASSES = [{ id: 1, className: 'Excavators' }, { id: 2, className: 'Cranes' }];
const line = (id, serial, req, reqId, project, status, from, to) => ({
  eqrRequestLineId: id, eqrEquipmentRequestId: reqId, requestNumber: req, projectName: project, taskName: 'Earthworks',
  requestorName: 'Pat Lee', allocatedSerial: serial, allocStatus: status, requestedStartDate: iso(from), requestedEndDate: iso(to),
  deploymentLocation: 'Site gate 3',
});
const LINES = [
  line(9001, 'EX-2201', 'REQ-10511', 511, 'Pipeline North', 'ALLOCATED', -5, 10),
  line(9002, 'EX-2201', 'REQ-10530', 530, 'Plant Expansion B', 'PENDING', 5, 30),
  line(9003, 'EX-2203', 'REQ-10530', 530, 'Plant Expansion B', 'PENDING', 2, 40),
  line(9004, 'EX-2210', 'REQ-10540', 540, 'Pipeline North', 'ALLOCATED', 3, 12),
  line(9005, 'MC-07', 'REQ-10498', 498, 'Plant Expansion B', 'ALLOCATED', -20, 60),
  line(9006, 'TC-02', 'REQ-10470', 470, 'Harbour Wall', 'CANCELLED', -10, 5),
  line(9006, 'TC-02', 'REQ-10470', 470, 'Harbour Wall', 'CANCELLED', -10, 5), // the view repeats a line: deduped
  line(9007, 'MC-07', 'REQ-10400', 400, 'Harbour Wall', 'ALLOCATED', -60, -30),
  line(9008, 'MC-07', 'REQ-10401', 401, 'Harbour Wall', 'ALLOCATED', -40, -25), // overlapped, but over: not a conflict
];
const SITES = [
  { id: 1, equipmentRequestId: 511, latitude: 29.80, longitude: -95.40, siteName: 'Pipeline North gate' },
  { id: 2, equipmentRequestId: 530, latitude: 29.70, longitude: -95.30, siteName: 'Plant B' },
  { id: 3, equipmentRequestId: 498, latitude: 29.75, longitude: -95.45, siteName: 'Plant B east' },
];
const LOCATIONS = {
  501: { id: 501, locationName: 'Houston Yard', locationCode: 'HOU-Y1', latitude: 29.76, longitude: -95.37 },
  502: { id: 502, locationName: 'Dallas Yard', locationCode: 'DAL-Y2', latitude: 32.78, longitude: -96.80 },
};
const WORK_ORDERS = [{ WorkOrderNumber: 'WO-55821', WorkOrderType: 'Preventive', WorkOrderDescription: '500 h service',
  PlannedStartDate: iso(8), PlannedCompletionDate: iso(14), AssetNumber: 'MA-2210', WorkOrderStatus: 'Released' }];

// A style with no sources: the map draws (a plain background) without tiles, glyphs or sprites from the network.
const STYLE = { version: 8, name: 'test', sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e2e8f0' } }] };

function handle(req, res) {
  const p = req.path;
  if (p.endsWith('/serial-refs')) { return res.json({ data: SERIALS, hasMore: false }); }
  if (p.endsWith('/equipment-classes')) { return res.json({ data: CLASSES, hasMore: false }); }
  if (p.endsWith('/views/workbench-lines')) { return res.json({ data: LINES, hasMore: false }); }
  if (p.endsWith('/ship-to-sites')) { return res.json({ data: SITES, hasMore: false }); }
  if (p.endsWith('/equipment-master')) { return res.json({ data: MASTERS, recordCount: MASTERS.length, hasMore: false }); }
  const loc = /\/locations\/(\d+)$/.exec(p);
  if (loc) { return LOCATIONS[loc[1]] ? res.json(LOCATIONS[loc[1]]) : res.json({ message: 'not found' }, 404); }
  if (p.endsWith('/installedBaseAssets')) {
    return res.json({ items: (req.query.get('q') || '').includes('MA-2210') ? [{ AssetId: 300100, OperatingOrganizationCode: 'HOU' }] : [] });
  }
  if (p.endsWith('/maintenanceWorkOrders')) {
    return res.json({ items: (req.query.get('q') || '').includes('MA-2210') ? WORK_ORDERS : [] });
  }
  return undefined;
}

const PATH = '/vp/shell/schedule/schedule';

(async () => {
  const env = await E.start({ port: 19110, handle });
  const { page } = env;
  // Mapbox: a minimal style instead of the real one, and its telemetry answered (no network here).
  await page.route('https://api.mapbox.com/styles/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(STYLE) }));
  await page.route('https://events.mapbox.com/**', (route) => route.fulfill({ status: 204, body: '' }));
  // Bryntum's icons are Font Awesome from cdnjs (bryntum-shim.css, copied unchanged from Old EquipRite), with the
  // classic theme's local fonts/ folder as fallback, which neither app ships. This container cannot reach cdnjs, so
  // the font is answered here (empty: icons draw blank, nothing else changes).
  await page.route(/\/fa-(solid|regular|brands)-\d+\.(woff2|ttf)$/, (route) => route.fulfill({ status: 200, contentType: 'font/woff2', body: '' }));
  if (process.env.E2E_DEBUG) {
    page.on('requestfailed', (r) => console.log('    [failed]', r.url().slice(0, 160), r.failure() && r.failure().errorText));
    page.on('response', (r) => { if (r.status() >= 400) { console.log('    [http ' + r.status() + ']', r.url().slice(0, 160)); } });
  }
  const text =async (sel) => (await page.$$eval(sel, (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()))).join(' | ');
  try {
    T.section('loads what the old page loaded, nothing more');
    await env.open(PATH);
    await page.waitForSelector('#erScheduleGantt .b-sch-event', { timeout: 60000 });
    await page.waitForTimeout(800);
    const calls = env.calls.map((c) => decodeURIComponent(c).replace('/equiprite/v1', '').replace('/fscmRestApi/resources/11.13.18.05', ''));
    const expectCalls = [
      'GET /serial-refs?size=10000',
      'GET /equipment-classes?page=0&size=200',
      'GET /views/workbench-lines?page=0&size=2000',
      'GET /ship-to-sites?size=10000',
      'GET /equipment-master?size=10000',
      'GET /locations/501',
      'GET /locations/502',
      'GET /equipment-master?page=0&size=200',
      // onlyData=true is the ProjectLOV service's default, added by VB for the old page too.
      "GET /installedBaseAssets?limit=1&onlyData=true&q=AssetNumber='MA-2201'",
      "GET /installedBaseAssets?limit=1&onlyData=true&q=AssetNumber='MA-2210'",
      "GET /maintenanceWorkOrders?limit=100&onlyData=true&orderBy=PlannedStartDate:desc&q=AssetNumber='MA-2210'",
    ];
    expectCalls.forEach((c) => T.check('called ' + c, calls.includes(c), calls.filter((x) => !/rbac|conf-global|session|lookups|Report|users/i.test(x)).join(' ; ')));
    T.check('no work orders asked for an asset Fusion does not know', !calls.some((c) => c.includes('maintenanceWorkOrders') && c.includes('MA-2201')));
    T.eq('reading the schedule writes nothing', env.writes.length, 0);

    T.section('the Gantt: rows, bars, conflicts first');
    T.check('the band names the screen and counts it', (await env.text('.er-band')).includes('Equipment schedule')
      && (await env.text('.er-band-sub')).includes('5 units') && (await env.text('.er-band-sub')).includes('2 conflicts'), await env.text('.er-band-sub'));
    const groups = await text('#erScheduleGantt .b-group-row .b-grid-cell:first-child');
    T.check('grouped by class, the class with conflicts first', /^EXCAVATORS.*\|.*CRANES/i.test(groups), groups);
    const rows = await page.$$eval('#erScheduleGantt .b-grid-subgrid-locked .b-grid-row:not(.b-group-row) .er-sch-unit-cell strong', (els) => els.map((e) => e.textContent));
    T.eq('one row per unit, conflicts first inside a class', rows.join(','), 'CAT 320 Excavator,PC210 Excavator,CAT 320 Excavator,Mobile Crane 50t,Tower Crane');
    const bars = await page.$$eval('#erScheduleGantt .b-sch-event', (els) => els.map((e) => ({ cls: e.className, text: e.innerText.trim() })));
    const has = (k, label) => bars.some((b) => b.cls.includes('er-sch-bar--' + k) && (!label || b.text.includes(label)));
    T.check('hard reserve (ALLOCATED) bar', has('hard', 'REQ-10511 · Pipeline North'), JSON.stringify(bars.map((b) => b.text)));
    T.check('soft reserve (PENDING) bar', has('soft', 'REQ-10530'));
    T.check('maintenance block from the Fusion work order', has('maintenance', 'WO-55821'));
    T.check('cancelled booking, greyed', has('cancelled', 'REQ-10470'));
    T.eq('the repeated view row is drawn once', bars.filter((b) => b.text.includes('REQ-10470')).length, 1);
    T.eq('four bars outlined as conflicts (double booking and booking in maintenance)', bars.filter((b) => b.cls.includes('er-sch-bar--conflict')).length, 4);
    T.check('a clash that is over is not flagged', !bars.some((b) => b.text.includes('REQ-1040') && b.cls.includes('conflict')));
    T.check('the today line is drawn', (await page.$$('#erScheduleGantt .b-sch-current-time')).length > 0);
    await page.hover('#erScheduleGantt .b-sch-event.er-sch-bar--maintenance');
    await page.waitForSelector('.b-tooltip.er-sch-tooltip .er-sch-tip', { timeout: 5000 });
    const tipText = await env.text('.b-tooltip.er-sch-tooltip .er-sch-tip');
    T.check('hovering a bar shows its details (the work order on a maintenance bar)', tipText.includes('WO-55821') && tipText.includes('500 h service') && tipText.includes('Conflict'), tipText);
    T.eq('...on a white card', await page.$eval('.b-tooltip.er-sch-tooltip .b-tooltip-content', (e) => getComputedStyle(e).color), 'rgb(17, 24, 39)');
    await page.mouse.move(5, 5);
    const conflicts = await text('.er-sch-conflict');
    T.check('conflict panel: the double booking', conflicts.includes('Double booking') && conflicts.includes('REQ-10511') && conflicts.includes('REQ-10530'), conflicts);
    T.check('conflict panel: the booking during maintenance', conflicts.includes('Booked during maintenance') && conflicts.includes('WO-55821'));
    const link = await page.getAttribute('.er-sch-conflict a[href*="line-detail"]', 'href');
    T.check('"Reassign or change dates" opens the line in Old EquipRite',
      /\/vp\/shell\/equipment-foundation\/line-detail\?requestId=511&requestNumber=REQ-10511&lineId=9001&equipmentMasterId=11$/.test(link || ''), link);
    T.check('the Old version link opens the old schedule', ((await page.getAttribute('.er-band a.er-btn', 'href')) || '').endsWith('/vp/shell/main/equipment-schedule'));
    await env.shot('schedule.png');

    T.section('read only: a drag sends nothing');
    const bar = await page.$('#erScheduleGantt .b-sch-event.er-sch-bar--soft');
    const before = await bar.boundingBox();
    await page.mouse.move(before.x + 20, before.y + before.height / 2);
    await page.mouse.down();
    await page.mouse.move(before.x + 220, before.y + before.height / 2 + 50, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(600);
    const after = await (await page.$('#erScheduleGantt .b-sch-event.er-sch-bar--soft')).boundingBox();
    T.check('the bar did not move', Math.abs(after.x - before.x) < 2 && Math.abs(after.y - before.y) < 2, JSON.stringify([before, after]));
    T.eq('no call was made (the old schedule had drag, resize and edit off)', env.writes.length, 0);

    T.section('filters');
    await page.click('button[data-filter="class"]');
    await page.click('.er-sch-options button[data-kind="class"][data-value="Cranes"]');
    await page.waitForTimeout(500);
    let units = await page.$$eval('#erScheduleGantt .b-grid-subgrid-locked .b-grid-row:not(.b-group-row) .er-sch-unit-cell strong', (els) => els.map((e) => e.textContent));
    T.eq('class Cranes: two units', units.join(','), 'Mobile Crane 50t,Tower Crane');
    T.check('the chip says what is picked', (await env.text('button[data-filter="class"]')).includes('Class: Cranes'));
    T.eq('no conflicts among cranes: the panel goes', (await page.$$('.er-sch-conflict')).length, 0);
    await page.click('.er-sch-options button[data-kind="class"]:has-text("Clear")');
    await page.click('button[data-filter="class"]');
    await page.click('button[data-filter="yard"]');
    await page.click('.er-sch-options button[data-kind="yard"][data-value="DAL-Y2"]');
    await page.waitForTimeout(400);
    units = await page.$$eval('#erScheduleGantt .b-grid-subgrid-locked .b-grid-row:not(.b-group-row) .er-sch-unit-cell strong', (els) => els.map((e) => e.textContent));
    T.eq('yard DAL-Y2: the two units there', units.join(','), 'PC210 Excavator,Mobile Crane 50t');
    await page.click('.er-sch-options button[data-kind="yard"]:has-text("Clear")');
    await page.click('button[data-filter="yard"]');
    await page.click('button[data-filter="project"]');
    await page.click('.er-sch-options button[data-kind="project"][data-value="Harbour Wall"]');
    await page.waitForTimeout(400);
    const dim = await page.$$eval('#erScheduleGantt .b-sch-event', (els) => els.filter((e) => e.className.includes('er-sch-bar--dim')).map((e) => e.innerText.trim()));
    T.check('project Harbour Wall: its units only, other projects\' bars dimmed', dim.length > 0 && dim.every((t) => !t.includes('Harbour Wall')), dim.join(' | '));
    await page.click('.er-sch-options button[data-kind="project"]:has-text("Clear")');
    await page.click('button[data-filter="project"]');
    await page.click('button.er-sch-conflict-chip');
    await page.waitForTimeout(400);
    units = await page.$$eval('#erScheduleGantt .b-grid-subgrid-locked .b-grid-row:not(.b-group-row) .er-sch-unit-cell strong', (els) => els.map((e) => e.textContent));
    T.eq('conflicts only', units.join(','), 'CAT 320 Excavator,PC210 Excavator');
    await page.click('button.er-sch-conflict-chip');
    await page.fill('.er-search input', 'harbour');
    await page.dispatchEvent('.er-search input', 'input');
    await page.waitForTimeout(400);
    T.check('search reaches the bookings (project)', (await env.text('.er-band-sub')).startsWith('2 of 5 units'), await env.text('.er-band-sub'));
    await page.fill('.er-search input', '');
    await page.dispatchEvent('.er-search input', 'input');
    await page.waitForTimeout(300);

    T.section('scale and month');
    const ticks = async () => page.$$eval('#erScheduleGantt .b-sch-header-row-1 .b-sch-header-timeaxis-cell', (els) => els.length);
    const weekTicks = await ticks();
    await page.click('button[data-scale="day"]');
    await page.waitForTimeout(500);
    T.check('Day shows more, narrower columns than Week', (await ticks()) > weekTicks, (await ticks()) + ' vs ' + weekTicks);
    await page.click('button[data-scale="week"]');
    const label0 = await env.text('.er-sch-month-label');
    await page.click('button[data-month="next"]');
    await page.waitForTimeout(500);
    const label1 = await env.text('.er-sch-month-label');
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
    T.check('the band opens on this month', label0 === now.toLocaleString('en-US', { month: 'long', year: 'numeric' }), label0);
    T.eq('Next month', label1, nextMonth);
    await page.click('button[data-month="today"]');
    await page.waitForTimeout(400);
    T.eq('Today comes back', await env.text('.er-sch-month-label'), label0);
    await page.$eval('#erScheduleGantt .b-grid-subgrid-normal', (el) => { el.scrollLeft += 84 * 13; el.dispatchEvent(new Event('scroll')); });
    await page.waitForTimeout(900);
    const scrolled = await env.text('.er-sch-month-label');
    T.check('scrolling the timeline a quarter ahead moves the band\'s month (scheduleMonthInView)', scrolled !== label0 && scrolled !== '', scrolled);
    T.check('...without a warning from VB about the event', !env.errors.some((e) => /scheduleMonthInView|could not raise/.test(e)), env.errors.join(' | '));
    await page.click('button[data-month="today"]');
    await page.waitForTimeout(400);

    T.section('map and list');
    const mapReady = !(await page.$eval('button[data-panel="map"]', (b) => b.disabled));
    if (mapReady) {
      T.check('the map is drawn with unit and site pins', (await page.$$('#erScheduleMap .er-sch-pin')).length === 4
        && (await page.$$('#erScheduleMap .er-sch-site-pin')).length > 0, (await page.$$('#erScheduleMap .er-sch-pin')).length + ' unit pins');
    } else {
      T.check('no WebGL here: the map is replaced by the list', (await page.$$('.er-sch-list-item')).length === 5);
    }
    await page.click('button[data-panel="list"]');
    await page.waitForTimeout(300);
    T.eq('List shows every unit', (await page.$$('.er-sch-list-item')).length, 5);
    T.check('the map is hidden behind the list', await page.$eval('.er-sch-map-wrap', (e) => getComputedStyle(e).display === 'none'));
    T.check('a unit says where it is and what is next', (await text('.er-sch-list-item')).includes('HOU-Y1 · Houston Yard')
      && (await text('.er-sch-list-item')).includes('Next: REQ-10511 · Pipeline North'));
    await env.shot('schedule-list.png');
    if (mapReady) {
      await page.click('button[data-panel="map"]');
      await page.waitForTimeout(300);
      T.check('Map comes back', await page.$eval('.er-sch-map-wrap', (e) => getComputedStyle(e).display !== 'none'));
    }

    T.section('acting on a conflict');
    await page.click('.er-sch-conflict button.er-sch-show');
    await page.waitForTimeout(800);
    T.check('Show on schedule selects the bar', (await page.$$('#erScheduleGantt .b-sch-event-selected, #erScheduleGantt .b-sch-event-wrap.b-sch-event-selected')).length > 0);
    T.eq('still nothing written', env.writes.length, 0);
    T.eq('no browser errors', env.errors.filter((e) => !e.startsWith('warning')).join('\n'), '');
    await page.click('.er-sch-conflict button[data-request="511"]');
    await page.waitForURL(/request-detail/, { timeout: 20000 });
    T.check('Open request goes to New EquipRite\'s request detail', page.url().includes('requestNumericId=511') && page.url().includes('requestId=REQ-10511'), page.url());

    T.section('without Bryntum and Mapbox the same data is listed');
    await page.route('**/resources/js/schedulerpro.umd.js', (route) => route.abort());
    await page.route('**/resources/js/mapbox-gl.js', (route) => route.abort());
    env.errors.length = 0;
    await env.open(PATH);
    await page.waitForSelector('.er-sch-fallback', { timeout: 60000 });
    await page.waitForTimeout(600);
    const fb = await text('.er-sch-fl-row:not(.er-sch-fl-head)');
    T.eq('every unit is listed', (await page.$$('.er-sch-fl-row:not(.er-sch-fl-head)')).length, 5);
    T.check('with its bookings and their kind', fb.includes('REQ-10511 · Pipeline North') && fb.includes('Hard reserve') && fb.includes('Maintenance · WO-55821'), fb);
    T.check('conflicts first and marked', /^CAT 320 Excavator/.test(fb) && fb.includes('conflict'));
    T.check('the conflict panel still works', (await page.$$('.er-sch-conflict')).length === 2);
    T.check('the map falls back to the list', (await page.$$('.er-sch-list-item')).length === 5 && (await env.text('.er-sch-side')).includes('could not load'));
    await env.shot('schedule-fallback.png');
    T.eq('no errors besides the two blocked files',
      env.errors.filter((e) => !e.startsWith('warning') && !/ERR_FAILED|Script error|schedulerpro|mapbox-gl/i.test(e)).join('\n'), '');
  } catch (e) {
    T.check('run finished', false, e.message);
    await env.shot('schedule-failed.png').catch(() => {});
    console.log(env.errors.join('\n'));
  } finally {
    await env.close();
    T.report();
  }
})();
