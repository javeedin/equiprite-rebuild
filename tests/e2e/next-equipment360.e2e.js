'use strict';
/*
 * EquipRite Next, everything about a piece of equipment, in a real browser: an item with three units in two yards
 * (bookings past, now and ahead, a transfer out and one back, a move between projects, an inspection, Fusion
 * maintenance), opened as the equipment-360 record. The head, the units (now, next, in the window), the one-line answer
 * and the bars (Availability's colours, today marked), the history newest first (a row opening its request in a tab,
 * the unit chips), a failed source said on the page, export (the files read back), Open in Availability, a unit's own
 * tab (serial) and the unit record, the calls (filtered by the equipment or the serial; nothing written), no sideways
 * scroll on a laptop or a phone, no browser errors. Needs `npm run build`. Run: node tests/e2e/next-equipment360.e2e.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();

// Dates relative to today (the browser's calendar day), so the bookings are current whenever this runs.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => (n < 10 ? '0' : '') + n;
const dayOf = (x) => x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
const at = (n) => { const x = new Date(); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() + n); return x; };
const d = (n) => dayOf(at(n));
const iso = (n, time) => d(n) + 'T' + (time || '00:00:00') + 'Z';
/** '4 Nov', with the year when the window's two days are in different years or not this one. */
const span = (a, b) => {
  const x = at(a);
  const y = at(b);
  const year = x.getFullYear() !== y.getFullYear() || x.getFullYear() !== at(0).getFullYear();
  const f = (z) => z.getDate() + ' ' + MON[z.getMonth()] + (year ? ' ' + z.getFullYear() : '');
  return 'from ' + f(x) + ' to ' + f(y);
};

const MASTER = { id: 7001, equipmentName: 'Komatsu D65EX-18 Dozer', equipmentNumber: 'EQ-7001', equipmentClassId: 41, manufacturer: 'Komatsu', modelNumber: 'D65EX-18',
  mfgYear: 2023, maintenanceAssetNumber: 'MA-D65', currentLocationId: 501, createdDate: '2025-01-05T09:00:00Z', createdBy: 'priya.raman',
  // A small picture, inline (a data: URL is shown as it is).
  equipmentImage: 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#f5b400"/><rect x="14" y="52" width="68" height="18" rx="6" fill="#222"/><rect x="30" y="28" width="34" height="26" fill="#333"/></svg>') };
const SERIALS = [
  { id: 81, serialNumber: 'D65-0101', equipmentId: 7001, currentLocationId: 501, maintenanceAssetNumber: 'MA-0101', createdDate: '2025-03-02T09:30:00Z', createdBy: 'priya.raman' },
  { id: 82, serialNumber: 'D65-0102', equipmentId: 7001, currentLocationId: 501 },
  { id: 83, serialNumber: 'D65-0103', equipmentId: 7001, currentLocationId: 502 },
];
const LOCATIONS = { 501: { id: 501, locationName: 'Houston Yard', locationCode: 'HOU-Y1' }, 502: { id: 502, locationName: 'Dallas Yard', locationCode: 'DAL-Y2' } };
const hist = (lid, serial, from, to, alloc, line, extra) => Object.assign({ requestLineId: lid, equipmentMasterId: 7001, equipmentName: 'Komatsu D65EX-18 Dozer',
  serialNumber: serial, startDate: iso(from), endDate: iso(to), allocationStatus: alloc, lineStatus: line, projectName: null, customerName: null }, extra || {});
const HISTORY = [
  hist(9101, 'D65-0101', -60, -30, 'ALLOCATED', 'RETURNED', { projectName: 'Harbour Wall' }),
  hist(9102, 'D65-0101', -5, 10, 'ALLOCATED', 'DEPLOYED', { projectName: 'Pipeline North' }),
  hist(9103, 'D65-0102', -2, 3, 'ALLOCATED', 'SCHEDULED_FOR_PICKING', { projectName: 'Substation 4' }),
  hist(9104, 'D65-0102', 8, 20, 'PENDING', 'IN_PROCESS', { projectName: 'Plant Expansion B' }),
  hist(9105, 'D65-0103', -20, -1, 'ALLOCATED', 'RETURN_IN_PROCESS', { projectName: 'Gulf Terminal' }),
  hist(9106, 'D65-0103', -12, -8, 'CANCELLED', 'CANCELLED', { projectName: 'Harbour Wall' }),
];
const dep = (lid, serial, rid, num, line, from, to) => ({ requestLineId: lid, serialNumber: serial, requestId: rid, requestNumber: num, requestType: 'INTERNAL',
  lineStatus: line, startDate: iso(from), endDate: iso(to), equipmentMasterId: 7001 });
const DEPLOYED = [
  dep(9101, 'D65-0101', 400, 'REQ-10400', 'RETURNED', -60, -30), dep(9102, 'D65-0101', 511, 'REQ-10511', 'DEPLOYED', -5, 10),
  dep(9103, 'D65-0102', 530, 'REQ-10530', 'SCHEDULED_FOR_PICKING', -2, 3), dep(9104, 'D65-0102', 560, 'REQ-10560', 'IN_PROCESS', 8, 20),
  dep(9105, 'D65-0103', 480, 'REQ-10480', 'RETURN_IN_PROCESS', -20, -1), dep(9106, 'D65-0103', 470, 'REQ-10470', 'CANCELLED', -12, -8),
];
const LDB = [
  { serialNumber: 'D65-0101', bookingRequestId: 511, bookingRequestNumber: 'REQ-10511', bookingStartDate: iso(-5), bookingEndDate: iso(10), allocStatus: 'ALLOCATED',
    projectName: 'Pipeline North', taskName: 'Earthworks', requestor: 'Pat Lee', location: 'Gate 3' },
  { serialNumber: 'D65-0103', bookingRequestId: 620, bookingRequestNumber: 'REQ-10620', bookingStartDate: iso(30), bookingEndDate: iso(40), allocStatus: 'ALLOCATED',
    projectName: 'Refinery Turnaround', requestor: 'Sam Ortiz' },
];
const WOS = {
  'MA-0101': [{ WorkOrderNumber: 'WO-55821', WorkOrderType: 'Preventive', WorkOrderDescription: '500 h service', PlannedStartDate: iso(12), PlannedCompletionDate: iso(14), WorkOrderStatus: 'Released' }],
  'MA-D65': [{ WorkOrderNumber: 'WO-60000', WorkOrderType: 'Inspection', WorkOrderDescription: 'Fleet campaign', PlannedStartDate: iso(-90), PlannedCompletionDate: iso(-89), WorkOrderStatus: 'Completed' }],
};
const STATUS = { 511: [{ lineId: 9102, toStatus: 'SHIPPED', fromStatus: 'PICK_RELEASED', changedDate: iso(-6, '10:00:00'), changedBy: 'yard.lead' },
  { toStatus: 'IN_PROCESS', fromStatus: 'SUBMITTED', changedDate: iso(-12, '08:00:00'), changedBy: 'em.boss', comments: 'OK for North' }] };
const ORDERS = {
  511: [{ id: 3001, equipmentRequestId: 511, orderNumber: 'TO-3001', orderType: 'OUTBOUND', orderStatus: 'RECEIVED', sourceOrgId: 300, destinationOrgId: 400,
    createdDate: iso(-7, '08:00:00'), shippedDate: iso(-6, '11:00:00'), receivedDate: iso(-5, '15:30:00'), carrierName: 'Gulf Haul' }],
  480: [{ id: 3003, equipmentRequestId: 480, orderNumber: 'TO-3003', orderType: 'INBOUND', createdDate: iso(-2, '07:00:00'), shippedDate: iso(-1, '13:00:00') }],
};
const ORDER_LINES = { 3001: [{ id: 1, transferOrderId: 3001, serialNumber: 'D65-0101', requestLineId: 9102, lineNumber: 1, quantity: 1 }], 3003: [{ id: 2, transferOrderId: 3003, serialRefId: 83, requestLineId: 9105 }] };
const MOVE = { id: 41, serialNumber: 'D65-0101', transferDate: iso(-31, '12:00:00'), sourceRequestNumber: 'REQ-10400', sourceProjectName: 'Harbour Wall',
  destinationRequestNumber: 'REQ-10511', destinationProjectName: 'Pipeline North', transferOrderId: 3005, orderNumber: 'TO-3005', transferStatus: 'COMPLETED', transferredBy: 'dispatch.desk' };
const MOVES = { 400: [MOVE], 511: [MOVE] };
const ALLOCS = { 9102: [{ id: 1, requestLineId: 9102, serialRefId: 81, allocationStatus: 'ALLOCATED', allocatedDate: iso(-20, '14:00:00') }],
  9101: [{ id: 2, requestLineId: 9101, serialRefId: 81, allocationStatus: 'ALLOCATED', allocatedDate: iso(-70, '09:00:00'), releasedDate: iso(-29, '17:00:00') }] };
const INSPECTIONS = { 9102: [{ id: 11, requestLineId: 9102, inspectionType: 'PRE_DISPATCH', inspectionStatus: 'COMPLETED', completedDate: iso(-7, '15:00:00'), overallResult: 'PASS', notes: 'Tracks fine' }] };
const CERTS = [{ id: 1, equipmentMasterId: 7001, certType: 'ROPS', certNumber: 'C-77', issuedBy: 'TUV', issuedDate: '2025-01-10', expiryDate: iso(400) }];

let inspectionsDown = false;
function handle(req, res) {
  const p = req.path.replace('/equiprite/v1', '');
  const q = req.query;
  const num = (k) => Number(q.get(k));
  let m;
  if ((m = /^\/equipment-master\/(\d+)$/.exec(p))) return Number(m[1]) === 7001 ? res.json(MASTER) : res.json({ message: 'not found' }, 404);
  if (p === '/equipment-master') return res.json({ data: /komatsu/i.test(q.get('q') || '') ? [MASTER] : [], hasMore: false });
  if ((m = /^\/equipment-classes\/(\d+)$/.exec(p))) return res.json({ id: Number(m[1]), className: 'Dozers' });
  if (p === '/serial-refs') return res.json({ data: !q.get('equipmentId') || num('equipmentId') === 7001 ? SERIALS : [], hasMore: false });
  if ((m = /^\/locations\/(\d+)$/.exec(p))) return LOCATIONS[m[1]] ? res.json(LOCATIONS[m[1]]) : res.json({ message: 'not found' }, 404);
  if (p === '/views/equipment-history') return res.json({ data: q.get('serialNumber') ? HISTORY.filter((x) => x.serialNumber === q.get('serialNumber')) : HISTORY, hasMore: false });
  if (p === '/views/deployed-units') return res.json({ data: q.get('serialNumber') ? DEPLOYED.filter((x) => x.serialNumber === q.get('serialNumber')) : (q.get('equipmentMasterId') ? DEPLOYED : []), hasMore: false });
  if (p === '/views/line-detail-bookings') return res.json({ data: LDB, hasMore: false });
  if (p === '/request-status-history') return res.json({ data: STATUS[q.get('requestId')] || [] });
  if (p === '/transfer-orders') return res.json({ data: q.get('equipmentRequestId') ? (ORDERS[q.get('equipmentRequestId')] || []) : ORDERS[511].concat(ORDERS[480]) });
  if ((m = /^\/transfer-orders\/(\d+)$/.exec(p))) return res.json(ORDERS[511].concat(ORDERS[480]).find((o) => o.id === Number(m[1])) || {});
  if (p === '/transfer-order-lines') return res.json({ data: ORDER_LINES[q.get('transferOrderId')] || [] });
  if (p === '/transfer-history') return res.json({ data: q.get('equipmentRequestId') ? (MOVES[q.get('equipmentRequestId')] || []) : [MOVE] });
  if (p === '/allocations') return res.json({ data: ALLOCS[q.get('requestLineId')] || [] });
  // At the end, one booking's inspections cannot be read: the page says so and shows the rest.
  if (p === '/inspections') return inspectionsDown && num('requestLineId') === 9103 ? res.json({ message: 'down' }, 503) : res.json({ data: INSPECTIONS[q.get('requestLineId')] || [] });
  if (p === '/equipment-certifications') return res.json({ data: CERTS });
  if (p === '/equipment-attachments') return res.json({ data: q.get('entityName') === 'EQR_EQUIPMENT_MASTER' ? [{ id: 5, attachmentName: 'Operator manual', categoryLabel: 'Manuals', createdDate: '2025-02-01T10:00:00Z', createdBy: 'priya.raman' }] : [] });
  const fq = q.get('q') || '';
  if (p.endsWith('/installedBaseAssets')) return res.json({ items: /MA-0101|MA-D65/.test(fq) ? [{ AssetId: fq.includes('0101') ? 300101 : 300165, OperatingOrganizationCode: 'HOU' }] : [] });
  if (p.endsWith('/maintenanceWorkOrders')) {
    const asset = (/AssetNumber='([^']+)'/.exec(fq) || [])[1];
    return res.json({ items: (asset && WOS[asset]) || [] });
  }
  // The request a history row opens.
  if (p === '/views/request-detail-lines') {
    return res.json({ data: num('requestId') === 511 ? [{ lineId: 9102, lineNumber: 1, requestNumber: 'REQ-10511', equipmentName: 'Komatsu D65EX-18 Dozer', lineStatus: 'DEPLOYED', requestStatus: 'IN_PROCESS',
      allocatedSerial: 'D65-0101', projectName: 'Pipeline North', requestedStartDate: d(-5), requestedEndDate: d(10), quantity: 1 }] : [] });
  }
  if ((m = /^\/equipment-requests\/(\d+)$/.exec(p))) return res.json({ id: Number(m[1]), requestNumber: Number(m[1]) === 511 ? 'REQ-10511' : 'REQ-' + m[1], status: 'IN_PROCESS', projectName: 'Pipeline North' });
  return undefined;
}

async function download(page, root, what, fmt) {
  await page.click(root + ' .nx-e3-export');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(root + ` .nx-menu-item[data-what="${what}"][data-format="${fmt}"]`)]);
  const file = path.join(os.tmpdir(), 'next-e3-' + dl.suggestedFilename());
  await dl.saveAs(file);
  return { name: dl.suggestedFilename(), lines: fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split('\r\n').filter(Boolean) };
}

(async () => {
  const env = await E.start({ port: 19450, handle, app: 'next' });
  const { page } = env;
  const settle = (ms) => page.waitForTimeout(ms || 250);
  // The shell's bus, as the global search, Availability's yard grid and Check availability use it.
  const openRecord = (record, params) => page.evaluate(([r, p]) => new Promise((done) => {
    window.require(['resources/js/shellBus'], (bus) => { bus.open({ record: r, params: p }); done(); });
  }), [record, params]);
  const ITEM = '.nx-e3[data-key="item-7001"]';
  const UNIT = '.nx-e3[data-key="unit-D65-0103"]';
  const loaded = async (root) => {
    await page.waitForSelector(root + ' .nx-e3-hlist li', { timeout: 30000 });
    await page.waitForFunction((r) => { const el = document.querySelector(r); return el && !el.querySelector('.nx-e3-busy'); }, root, { timeout: 30000 });
    await settle(300);
  };
  const texts = (sel) => page.$$eval(sel, (els) => els.map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
  try {
    T.section('an equipment item opens in a tab of its own');
    await env.open('/?open=fleet');
    // The Fleet reads the whole fleet (its own screen): let it finish, so what follows is the equipment page's alone.
    for (let i = 0; i < 100 && !(env.calls.some((c) => c.includes('/views/yard-stock')) && env.calls.some((c) => c.includes('/views/workbench-lines'))); i++) await settle(100);
    await settle(1000);
    const before = env.calls.length;
    await openRecord('equipment-360', { name: 'Komatsu D65EX-18 Dozer', equipmentId: '7001' });
    await loaded(ITEM);
    T.eq('the tab, named after it', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId + '=' + t.innerText.trim()), 'equipment-360:item-7001=Komatsu D65EX-18 Dozer');
    T.eq('the head: kicker, name, how many units and where', [await page.$eval(ITEM + ' .nx-kicker', (k) => k.textContent.trim()), await env.text(ITEM + ' .nx-e3-name'), await env.text(ITEM + ' .nx-e3-sub')].join(' | '),
      'Equipment · Dozers | Komatsu D65EX-18 Dozer | 3 units: 2 at HOU-Y1 · Houston Yard, 1 at DAL-Y2 · Dallas Yard');
    T.eq('what the units are doing; its facts', [await env.text(ITEM + ' .nx-e3-where'), (await texts(ITEM + ' .nx-e3-fact')).join(',')].join(' | '), 'Now: 1 booked · 1 on site · 1 coming back | EQ-7001,Komatsu,D65EX-18,2023');
    T.check('its picture', await page.$eval(ITEM + ' .nx-e3-pic', (i) => i.complete && i.naturalWidth > 0 && i.src.startsWith('data:image/svg')));

    T.section('the units: yard, now, next, free or not in the window');
    const units = await page.$$eval(ITEM + ' .nx-e3-urow', (rows) => rows.map((r) => [r.dataset.unit, r.querySelector('.nx-e3-yard').innerText.trim(),
      r.querySelector('.nx-e3-now .nx-pill').innerText.trim(), r.querySelector('.nx-e3-nowtext').innerText.trim(), r.querySelector('.nx-e3-next').innerText.replace('Next booking', '').trim(),
      r.querySelector('.nx-e3-win .nx-av-state').innerText.trim()].join(' | ')));
    T.eq('one row per unit', units.length, 3);
    T.check('on site, which request, until when', units[0].startsWith('D65-0101 | HOU-Y1 · Houston Yard | On site | REQ-10511 · Pipeline North · until ') && units[0].endsWith('Nothing booked ahead | Booked'), units[0]);
    T.check('booked, getting ready; its next booking', units[1].startsWith('D65-0102 | HOU-Y1 · Houston Yard | Booked | REQ-10530 · Substation 4 · Waiting to be picked | REQ-10560 · ') && units[1].endsWith('| Booked'), units[1]);
    T.check('coming back, late; free, tight in the window', /^D65-0103 \| DAL-Y2 · Dallas Yard \| Coming back \| REQ-10480 · Gulf Terminal · due back .* \(1 day late\) \| REQ-10620 · .* \| Free, tight$/.test(units[2]), units[2]);

    T.section('availability ahead');
    T.eq('the window: today and four weeks', [await page.inputValue(ITEM + ' .nx-e3-from'), await page.inputValue(ITEM + ' .nx-e3-to')].join(' '), d(0) + ' ' + d(27));
    T.eq('the answer', await env.text(ITEM + ' .nx-e3-answer'), '1 of 3 free ' + span(0, 27) + ' (1 with a tight turnaround)');
    const bars = await page.$$eval(ITEM + ' .nx-e3-trow[data-unit="D65-0101"] .nx-av-bar', (b) => b.map((x) => x.innerText.trim() + '|' + x.tagName + '|' + x.className));
    T.eq('a unit\'s bookings and maintenance as bars', bars.map((x) => x.split('|').slice(0, 2).join('|')).join(' ; '), 'REQ-10511 · Pipeline North|BUTTON ; Maintenance · WO-55821|SPAN');
    T.check('Availability\'s colours: on site, assigned; held, not confirmed; maintenance', bars[0].includes('nx-stage--onsite') && bars[0].includes('nx-av-bar--hard') && bars[1].includes('nx-av-bar--maint')
      && (await page.getAttribute(ITEM + ' .nx-e3-trow[data-unit="D65-0102"] .nx-av-bar:nth-of-type(2)', 'class') || (await page.$$eval(ITEM + ' .nx-e3-trow[data-unit="D65-0102"] .nx-av-bar', (b) => b.map((x) => x.className).join(' ')))).includes('nx-av-bar--soft'));
    T.check('a cancelled booking is not drawn', !(await texts(ITEM + ' .nx-e3-trow[data-unit="D65-0103"] .nx-av-bar')).some((t) => t.includes('REQ-10470')));
    T.check('today marked, on the timeline and in its head', !!(await page.$(ITEM + ' .nx-e3-today')) && (await page.$$(ITEM + ' .nx-av-tick--today')).length === 1);
    T.eq('the legend is Availability\'s', (await texts(ITEM + ' .nx-av-legend li')).join(','), 'Getting ready,On the way,On site,Coming back,Back at the yard,Light: held, not confirmed,Planned maintenance,Clash,Tight turnaround,Your window,Today');
    await env.shot('next-equipment360-item.png');

    T.section('what it read: this equipment, not the whole fleet');
    const calls = env.calls.slice(before).map((c) => decodeURIComponent(c).replace('/equiprite/v1', '').replace('/fscmRestApi/resources/11.13.18.05', ''));
    ['GET /equipment-master/7001', 'GET /serial-refs?equipmentId=7001&size=10000', 'GET /views/equipment-history?equipmentMasterId=7001&page=0&size=1000',
      'GET /views/line-detail-bookings?equipmentMasterId=7001&page=0&size=10000', 'GET /equipment-classes/41', 'GET /locations/501', 'GET /locations/502',
      'GET /request-status-history?requestId=511', 'GET /transfer-orders?equipmentRequestId=511', 'GET /transfer-order-lines?transferOrderId=3001', 'GET /transfer-history?equipmentRequestId=400',
      'GET /allocations?requestLineId=9102', 'GET /inspections?requestLineId=9102', 'GET /equipment-certifications?equipmentId=7001',
      'GET /equipment-attachments?entityId=7001&entityName=EQR_EQUIPMENT_MASTER', "GET /maintenanceWorkOrders?limit=100&onlyData=true&orderBy=PlannedStartDate:desc&q=AssetNumber='MA-0101'",
    ].forEach((c) => T.check('called ' + c, calls.some((x) => x === c || x.split('?')[0] === c.split('?')[0] && c.split('?')[1].split('&').every((kv) => x.includes(kv))),
      calls.filter((x) => x.includes(c.split('?')[0])).join(' ; ')));
    T.check('the deployed units of this equipment, every line status', calls.some((x) => x.startsWith('GET /views/deployed-units?') && x.includes('equipmentMasterId=7001') && x.includes('RETURNED') && x.includes('ALLOCATED')));
    T.check('no unfiltered unit list, no fleet-wide bookings', !calls.some((x) => x === 'GET /serial-refs?size=10000' || x.startsWith('GET /views/workbench-lines') || x.startsWith('GET /views/yard-stock')),
      calls.filter((x) => /serial-refs|workbench-lines|yard-stock/.test(x)).join(' ; '));
    T.eq('reading writes nothing', env.writes.length, 0);

    T.section('history: everything that happened, newest first');
    const entries = await page.$$eval(ITEM + ' .nx-e3-h', (li) => li.map((x) => ({ kind: x.dataset.kind, rec: x.dataset.rec, title: x.querySelector('.nx-e3-htitle').innerText.trim(),
      meta: x.querySelector('.nx-e3-hmeta').innerText.trim(), unit: (x.querySelector('.nx-e3-hunit') || { innerText: '' }).innerText.trim() })));
    const idx = (t) => entries.findIndex((e) => e.title.startsWith(t));
    T.eq('how many', [entries.length, await env.text(ITEM + ' #e3HistTitle')].join(' | '), '26 | History (26)');
    T.eq('each kind of entry', [...new Set(entries.map((e) => e.kind))].sort().join(), 'allocation,booking,cert,doc,inspection,maint,move,received,record,shipped,status,transfer');
    T.check('newest first: ahead, then on site, shipped, inspected, picking raised, approved, assigned, moved, the item added',
      idx('Certificate expires') === 0 && idx('Booked on REQ-10620') < idx('Received on site') && idx('Received on site') < idx('Shipped to site') && idx('Shipped to site') < idx('Inspection passed')
      && idx('Inspection passed') < idx('Transfer order TO-3001 raised') && idx('Transfer order TO-3001 raised') < idx('Approved · REQ-10511') && idx('Approved · REQ-10511') < idx('Unit assigned to REQ-10511')
      && idx('Unit assigned to REQ-10511') < idx('Moved to REQ-10511') && idx('Moved to REQ-10511') < idx('Added to the equipment master') && idx('Added to the equipment master') === entries.length - 1,
      entries.map((e) => e.title).join(' / '));
    const shipped = entries.find((e) => e.title === 'Shipped to site · REQ-10511');
    T.check('when and who', shipped && /^\d+ \w{3} \d{4}, \d{2}:\d{2} · yard\.lead$/.test(shipped.meta), shipped && shipped.meta);
    T.check('a booking is dated from its dates, and says so', entries.find((e) => e.title.startsWith('Booked on REQ-10511')).meta.endsWith('· Pat Lee · from its dates'));
    T.eq('which unit, on an item', entries.filter((e) => e.title.startsWith('Transfer order TO-3003')).map((e) => e.unit).join(), 'D65-0103');
    T.eq('what each opens', ['Booked on REQ-10511', 'Shipped back to the yard', 'Moved to REQ-10511', 'Certificate issued'].map((t) => entries[idx(t)].rec || '-').join(), 'request,transfer,transfer,-');
    T.check('every source read: nothing said missing', !(await page.$(ITEM + ' .nx-e3-failed')));
    T.check('what it is made of', (await env.text(ITEM + ' .nx-e3-hnote')).startsWith('26 entries, newest first, from bookings, units assigned and released, status changes, transfer orders, moves between projects, inspections'));
    // The tab scrolls inside the shell: bring the history into view for its picture.
    await page.evaluate((r) => { const h = document.querySelector(r + ' .nx-e3-hist'); if (h) h.scrollIntoView({ block: 'start' }); }, ITEM);
    await settle(300);
    await env.shot('next-equipment360-history.png');
    await page.evaluate(() => { const c = document.querySelector('.nx-content'); if (c) c.scrollTop = 0; });

    T.section('the unit chips');
    T.eq('a chip per unit, with its count', (await texts(ITEM + ' .nx-e3-chips .nx-chip')).join(' | '), 'All units 26 | D65-0101 14 | D65-0102 2 | D65-0103 5');
    await page.click(ITEM + ' .nx-e3-chips .nx-chip[data-value="D65-0102"]');
    await settle();
    T.eq('one unit\'s history', (await texts(ITEM + ' .nx-e3-htitle')).join(' | '), 'Booked on REQ-10560 · Plant Expansion B | Booked on REQ-10530 · Substation 4');
    T.eq('the heading says what is shown', await env.text(ITEM + ' #e3HistTitle'), 'History (2 of 26)');
    const csvU = await download(page, ITEM, 'history', 'csv');
    T.check('export: the history as shown, its file', /^equiprite-komatsu-d65ex-18-dozer-history-\d{4}-\d{2}-\d{2}\.csv$/.test(csvU.name) && csvU.lines.length === 3
      && csvU.lines[0] === 'When,What,Entry,Details,Unit,Who,"Request, transfer or work order",Date from' && csvU.lines[1].includes('REQ-10560'), csvU.name + ' / ' + csvU.lines.join(' / '));
    await page.click(ITEM + ' .nx-e3-chips .nx-chip[data-value="all"]');
    await settle();
    const csvUnits = await download(page, ITEM, 'units', 'csv');
    T.check('export: the units, with their state in the window', csvUnits.lines.length === 4 && csvUnits.lines[0].startsWith('Unit (serial),Equipment,Class,Yard,Now')
      && csvUnits.lines[1].startsWith('D65-0101,Komatsu D65EX-18 Dozer,Dozers,HOU-Y1 · Houston Yard,On site'), csvUnits.lines.join(' / '));
    T.check('the export toasted', /exported to CSV/.test(await page.innerText('body')));

    T.section('a history row opens its request in a tab');
    await page.click(ITEM + ' .nx-e3-h[data-kind="booking"] button[data-number="REQ-10511"]');
    await page.waitForSelector('.nx-record-title', { timeout: 20000 });
    await settle(600);
    T.eq('the request\'s tab', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId + '=' + t.innerText.trim()), 'request:511=REQ-10511');
    await page.click('.nx-tab-btn[data-id="equipment-360:item-7001"]');
    await settle(400);
    T.check('back on the equipment, as it was left', await page.isVisible(ITEM + ' .nx-e3-hlist'));

    T.section('the window');
    await page.click(ITEM + ' .nx-av-presets .nx-chip[data-value="7"]');
    await settle(400);
    T.eq('a quick window: the date boxes and the answer follow', [await page.inputValue(ITEM + ' .nx-e3-from'), await page.inputValue(ITEM + ' .nx-e3-to'), await env.text(ITEM + ' .nx-e3-answer')].join(' | '),
      d(0) + ' | ' + d(6) + ' | 1 of 3 free ' + span(0, 6) + ' (1 with a tight turnaround)');
    await page.fill(ITEM + ' .nx-e3-from', d(21));
    await settle(300);
    await page.fill(ITEM + ' .nx-e3-to', d(27));
    await settle(400);
    T.eq('a typed window: all three free then', await env.text(ITEM + ' .nx-e3-answer'), '3 of 3 free ' + span(21, 27) + ' (1 with a tight turnaround)');
    T.check('the timeline follows: today is before the window', (await page.$$(ITEM + ' .nx-av-tick--today')).length === 0 || d(21) <= d(6));
    T.check('no sideways scroll on a laptop', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));

    T.section('a unit, in its own tab (serial)');
    await openRecord('equipment-360', { serial: 'D65-0103' });
    await loaded(UNIT);
    T.eq('the tab: serial and name', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId + '=' + t.innerText.trim()), 'equipment-360:unit-D65-0103=D65-0103 · Komatsu D65EX-18 Dozer');
    T.eq('its head: serial, what it is doing, its name and class, its yard', [await env.text(UNIT + ' .nx-e3-name'), await env.text(UNIT + ' .nx-e3-nowpill'), await env.text(UNIT + ' .nx-e3-sub')].join(' | '),
      'D65-0103 | Coming back | Komatsu D65EX-18 Dozer · Dozers');
    T.check('where it is', (await env.text(UNIT + ' .nx-e3-where')).startsWith('Kept at DAL-Y2 · Dallas Yard · REQ-10480 · Gulf Terminal · due back'), await env.text(UNIT + ' .nx-e3-where'));
    T.eq('itself, with the way to every unit of its equipment', [(await page.$$(UNIT + ' .nx-e3-urow')).length, await env.text(UNIT + ' .nx-e3-all')].join(' | '), '1 | All 3 units of this equipment');
    T.check('the answer for a unit', (await env.text(UNIT + ' .nx-e3-answer')).startsWith('Free ' + span(0, 27) + ', with a tight turnaround: Back from REQ-10480'), await env.text(UNIT + ' .nx-e3-answer'));
    const uEntries = await texts(UNIT + ' .nx-e3-htitle');
    T.check('its history only (and its equipment\'s certificates)', uEntries.includes('Shipped back to the yard') && uEntries.includes('Booking cancelled: REQ-10470 · Harbour Wall')
      && uEntries.some((t) => t.startsWith('Certificate')) && !uEntries.some((t) => /REQ-10511|REQ-10530/.test(t)) && !(await page.$(UNIT + ' .nx-e3-chips')), uEntries.join(' / '));
    const uCalls = env.calls.map((c) => decodeURIComponent(c).replace('/equiprite/v1', ''));
    T.check('read by its serial', uCalls.some((c) => c === 'GET /views/equipment-history?page=0&serialNumber=D65-0103&size=500' || (c.startsWith('GET /views/equipment-history?') && c.includes('serialNumber=D65-0103'))));
    await env.shot('next-equipment360-unit.png');
    await page.setViewportSize({ width: 390, height: 900 });
    await settle(600);
    const phone = await page.evaluate(() => [...document.querySelectorAll('.nx-content, .nx-e3')].filter((c) => c.offsetParent !== null).map((c) => c.scrollWidth + '/' + c.clientWidth));
    T.check('no sideways scroll on a phone', phone.length > 0 && phone.every((x) => Number(x.split('/')[0]) <= Number(x.split('/')[1]) + 1), phone.join(' '));
    T.check('the bars stay inside the track', await page.evaluate((r) => [...document.querySelectorAll(r + ' .nx-av-bar')].every((b) => b.getBoundingClientRect().right <= window.innerWidth + 1), UNIT));
    await env.shot('next-equipment360-phone.png');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await settle(300);
    await page.click(UNIT + ' .nx-e3-all');
    await settle(500);
    T.eq('all units of this equipment: its tab', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId), 'equipment-360:item-7001');

    T.section('the unit record ({ unit }) opens the same page');
    await openRecord('unit', { unit: 'D65-0101' });
    await loaded('.nx-e3[data-key="unit-D65-0101"]');
    T.eq('its tab, named', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId + '=' + t.innerText.trim()), 'unit:D65-0101=D65-0101 · Komatsu D65EX-18 Dozer');
    T.eq('on site now', await env.text('.nx-e3[data-key="unit-D65-0101"] .nx-e3-nowpill'), 'On site');

    T.section('Open in Availability');
    await page.click('.nx-e3[data-key="unit-D65-0101"] .nx-e3-toav');
    await page.waitForSelector('.nx-tab--on[data-tab-id="availability"]', { timeout: 30000 });
    await page.waitForSelector('#avSearch', { state: 'visible', timeout: 30000 });
    await settle(800);
    T.eq('the Availability tab', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId), 'availability');

    T.eq('reads only', env.writes.length, 0);
    const warnings = env.errors.filter((e) => e.startsWith('warning'));
    if (warnings.length) console.log('  (browser warnings: ' + warnings.length + ')\n    ' + warnings.slice(0, 5).join('\n    '));
    T.eq('no browser errors', env.errors.filter((e) => !e.startsWith('warning')).join('\n'), '');

    T.section('a history read that fails is said on the page');
    inspectionsDown = true;
    await page.click('.nx-tab-btn[data-id="equipment-360:item-7001"]');
    await settle(400);
    await page.click(ITEM + ' .nx-pagehead .nx-btn--plain');
    await page.waitForSelector(ITEM + ' .nx-e3-failed', { timeout: 30000 });
    await loaded(ITEM);
    T.eq('named, in words', await env.text(ITEM + ' .nx-e3-failed'), 'Not read, so left out: the inspections of 1 booking.');
    T.eq('the rest still shown', (await page.$$(ITEM + ' .nx-e3-h')).length, 26);
    T.eq('nothing written on a refresh either', env.writes.length, 0);
    await env.shot('next-equipment360-failed-source.png');
  } catch (e) {
    T.check('run finished', false, e.message);
    await env.shot('next-equipment360-failed.png').catch(() => {});
  } finally {
    await env.close();
    T.report();
  }
})();
