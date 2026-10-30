'use strict';
/*
 * EquipRite Next, the yard (Picking & shipping, Receiving & returns), in a real browser against a stateful fake backend:
 * what a person sees (sections by date, late first; stage tiles; yards; the open request's steps) and exactly what is
 * written. Steps that write to Fusion are shown and left to New EquipRite: nothing is sent for them.
 * Needs `npm run build`. Run: node tests/e2e/next-yard.e2e.js   (screenshots go to the OS temp folder)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const V1 = '/equiprite/v1';
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
let flags = E.ALL_FLAGS.concat(['SHIPPING_DOCUMENTS_ENABLED']);

// ── Outbound ─────────────────────────────────────────────────────────────────────────────────────────────────────
const PICK_QUEUE = [ // one row per line for 501, as the view may answer
  { eqrEquipmentRequestId: 501, requestNumber: 'REQ-10527', requestStatus: 'IN_PROCESS', source: 'INTERNAL', projectName: 'Plant Expansion B',
    taskName: '1.3 Foundations', requestor: 'John Dunbar', location: 'Pier A', requestedStartDate: day(-3) + 'T00:00:00Z', requestedEndDate: day(20) + 'T00:00:00Z' },
  { eqrEquipmentRequestId: 501, requestNumber: 'REQ-10527', requestStatus: 'IN_PROCESS', source: 'INTERNAL', projectName: 'Plant Expansion B' },
  { eqrEquipmentRequestId: 502, requestNumber: 'REQ-10530', requestStatus: 'IN_PROCESS', source: 'INTERNAL', projectName: 'Pipeline North',
    taskName: '2.1 Trenching', requestor: 'Priya Raman', location: 'Odessa camp', requestedStartDate: day(0) + 'T00:00:00Z', requestedEndDate: day(30) + 'T00:00:00Z' },
  { eqrEquipmentRequestId: 503, requestNumber: 'REQ-10505', requestStatus: 'IN_PROCESS', source: 'EXTERNAL', customerName: 'Gulf Coast Builders',
    contactName: 'Dana Ortiz', location: 'Galveston', requestedStartDate: day(5) + 'T00:00:00Z', requestedEndDate: day(60) + 'T00:00:00Z' },
];
const pickStatus = { 7001: 'SCHEDULED_FOR_PICKING', 7002: 'SCHEDULED_FOR_PICKING', 7003: 'SCHEDULED_FOR_PICKING', 7004: 'PICK_INITIATED',
  7005: 'DRAFT', 7006: 'SCHEDULED_FOR_PICKING', 7101: 'PICK_INITIATED', 7201: 'EQP_INSPECTION_COMPLETE', 7202: 'SHIP_TO_SITE' };
const PICK_LINES = {
  501: [
    { id: 7001, name: 'CAT 320 Excavator', cls: 'Excavators', master: 11, to: 'TO-778402', tx: 'Y', mt: 'N', fc: 'S_AND_T' },
    { id: 7002, name: 'Komatsu PC210 Excavator', cls: 'Excavators', master: 12, to: 'TO-778402', tx: 'Y', mt: 'N', fc: 'S_AND_T' },
    { id: 7003, name: 'Light tower', cls: 'Lighting', master: 13, to: 'TO-778399', tx: 'Y', mt: 'N', fc: 'S_AND_T', qty: 2 },
    { id: 7004, name: 'Survey drone', cls: 'Survey', master: 14, tx: 'N', mt: 'Y', fc: 'F_AND_M' },
    { id: 7006, name: 'Site office cabin', cls: 'Cabins', master: 16, tx: 'N', mt: 'N', fc: 'F_AND_M' },
    { id: 7005, name: 'Fuel bowser', cls: 'Fuel', master: 15, tx: 'Y', mt: 'N', fc: 'S_AND_T' },
  ],
  502: [{ id: 7101, name: 'Trencher T-450', cls: 'Trenchers', master: 21, to: 'TO-778500', tx: 'Y', mt: 'N', fc: 'S_AND_T' }],
  503: [
    { id: 7201, name: 'Crawler crane 80t', cls: 'Cranes', master: 31, to: 'TO-778600', tx: 'Y', mt: 'N', fc: 'S_AND_T' },
    { id: 7202, name: 'Generator 100 kVA', cls: 'Generators', master: 32, to: 'TO-778600', tx: 'Y', mt: 'N', fc: 'S_AND_T' },
  ],
};
const UNITS = {
  7001: [{ equipmentName: 'CAT 320 Excavator', className: 'Excavators', allocationId: 1, unitNumber: 'EX-2201', unitStatus: 'RENTED',
    unitRefId: 31, unitType: 'SERIAL', allocationMethod: 'MANUAL', sourceInvOrgName: 'Houston Yard' }],
  7002: [{ equipmentName: 'Komatsu PC210 Excavator', className: 'Excavators', allocationId: 2, unitNumber: 'EX-2207', unitStatus: 'DAMAGED',
    unitRefId: 32, unitType: 'SERIAL', allocationMethod: 'MANUAL', sourceInvOrgName: 'Houston Yard' }],
  7003: [{ equipmentName: 'Light tower', className: 'Lighting', allocationId: 3, unitNumber: 'LT-0042', unitStatus: 'RENTED',
    unitRefId: 33, unitType: 'SERIAL', allocationMethod: 'AUTO', lineSourceInvOrgName: 'Atlanta Yard' }],
  7004: [{ equipmentName: 'Survey drone', className: 'Survey', allocationId: 4, unitNumber: 'DR-9', unitStatus: 'RENTED',
    unitRefId: 34, unitType: 'SERIAL', allocationMethod: 'MANUAL', sourceInvOrgName: 'Houston Yard' }],
  7006: [{ equipmentName: 'Site office cabin', className: 'Cabins', allocationId: 6, unitNumber: 'CB-0003', unitStatus: 'RENTED',
    unitRefId: 36, unitType: 'SERIAL', allocationMethod: 'MANUAL', sourceInvOrgName: 'Houston Yard' }],
  7101: [{ equipmentName: 'Trencher T-450', className: 'Trenchers', allocationId: 7, unitNumber: 'TR-0450', unitStatus: 'RENTED',
    unitRefId: 41, unitType: 'SERIAL', allocationMethod: 'MANUAL', sourceInvOrgName: 'Atlanta Yard' }],
  7201: [{ equipmentName: 'Crawler crane 80t', className: 'Cranes', allocationId: 8, unitNumber: 'CR-0080', unitRefId: 51, unitType: 'SERIAL',
    allocationMethod: 'MANUAL', sourceInvOrgName: 'Houston Yard' }],
};
const SERIAL_REFS = { 11: [{ id: 31, currentSubinventory: 'Available', currentLocator: 'A-12-04' }], 12: [{ id: 32, currentSubinventory: 'Maintenance', currentLocator: 'M-01' }],
  16: [{ id: 36, currentSubinventory: 'Available', currentLocator: 'C-02-01' }], 14: [{ id: 34, currentSubinventory: 'Available', currentLocator: 'D-01-01' }] };
const TOS = { 501: [{ id: 9001, orderNumber: 'TO-778402', orderStatus: 'OPEN', createdDate: '2026-10-29T10:00:00Z' },
  { id: 9002, orderNumber: 'TO-778399', orderStatus: 'OPEN', createdDate: '2026-10-28T10:00:00Z' }],
  601: [{ id: 9101, orderNumber: 'TO-779010', orderStatus: 'OPEN', orderType: 'INBOUND', createdDate: '2026-10-20T10:00:00Z' }] };
const TO_LINES = { 9001: [7001, 7002], 9002: [7003], 9101: [8001, 8002] };

// ── Inbound ──────────────────────────────────────────────────────────────────────────────────────────────────────
const RET_QUEUE = [
  { eqrEquipmentRequestId: 601, requestNumber: 'REQ-10440', requestStatus: 'DEPLOYED', source: 'INTERNAL', projectName: 'Plant Expansion B',
    taskName: '4.2 Steel', requestor: 'John Dunbar', className: 'Generators', requestedStartDate: day(-80), requestedEndDate: day(-45) + 'T00:00:00Z' },
  { eqrEquipmentRequestId: 601, requestNumber: 'REQ-10440', requestStatus: 'DEPLOYED', source: 'INTERNAL', projectName: 'Plant Expansion B' },
  { eqrEquipmentRequestId: 602, requestNumber: 'REQ-10431', requestStatus: 'DEPLOYED', source: 'EXTERNAL', customerName: 'Lone Star Paving',
    contactName: 'Ann Lee', className: 'Cranes', requestedStartDate: day(-30), requestedEndDate: day(2) + 'T00:00:00Z' },
  { eqrEquipmentRequestId: 603, requestNumber: 'REQ-10450', requestStatus: 'DEPLOYED', source: 'INTERNAL', projectName: 'Survey West',
    requestor: 'Priya Raman', requestedStartDate: day(-10), requestedEndDate: day(3) + 'T00:00:00Z' },
];
const retStatus = { 8001: 'SHIPPED_TO_YARD', 8002: 'RETURN_IN_PROCESS', 8003: 'DEPLOYED', 8101: 'RETURN_INITIATED', 8201: 'DEPLOYED', 8202: 'DEPLOYED' };
const RET_LINES = {
  601: [{ id: 8001, name: 'Generator 100 kVA', cls: 'Generators', master: 61, tx: 'Y', mt: 'N', fc: 'S_AND_T', serial: 'GN-0412' },
    { id: 8002, name: 'Light tower', cls: 'Lighting', master: 62, tx: 'Y', mt: 'N', fc: 'S_AND_T', serial: 'LT-0050', inbound: 'TO-779010' },
    { id: 8003, name: 'Air compressor', cls: 'Compressors', master: 63, tx: 'Y', mt: 'N', fc: 'S_AND_T', serial: 'AC-0007' }],
  602: [{ id: 8101, name: 'Mobile crane 40t', cls: 'Cranes', master: 71, tx: 'Y', mt: 'N', fc: 'S_AND_T', serial: 'MC-0040' }],
  603: [{ id: 8201, name: 'Survey drone', cls: 'Survey', master: 81, tx: 'N', mt: 'Y', fc: 'F_AND_M', serial: 'DR-9' },
    { id: 8202, name: 'Total station', cls: 'Survey', master: 82, tx: 'N', mt: 'Y', fc: 'F_AND_M', serial: 'TS-12', end: day(30) }],
};
const RET_UNITS = { 8001: 'Houston Yard', 8002: 'Houston Yard', 8003: 'Atlanta Yard', 8101: 'Houston Yard', 8201: 'Houston Yard', 8202: 'Houston Yard' };
const DEPLOYED = [
  { requestLineId: 8003, unitRefId: 53, unitType: 'SERIAL', unitIdentifier: 'AC-0007', serialRefId: 53, serialNumber: 'AC-0007', lineStatus: 'DEPLOYED',
    requestId: 601, requestNumber: 'REQ-10440', requestType: 'INTERNAL', projectName: 'Plant Expansion B', equipmentName: 'Air compressor',
    className: 'Compressors', fulfilmentClass: 'S_AND_T', endDate: day(-45) + 'T00:00:00Z', overdue: true, yardOrgName: 'Atlanta Yard' },
  { requestLineId: 8201, unitRefId: 54, unitType: 'SERIAL', unitIdentifier: 'DR-9', serialRefId: 54, serialNumber: 'DR-9', lineStatus: 'DEPLOYED',
    requestId: 603, requestNumber: 'REQ-10450', requestType: 'INTERNAL', projectName: 'Survey West', equipmentName: 'Survey drone',
    className: 'Survey', fulfilmentClass: 'F_AND_M', isTransactable: 'N', endDate: day(3) + 'T00:00:00Z', overdue: false, yardOrgName: 'Houston Yard' },
];

const ALL = Object.assign({}, PICK_LINES, RET_LINES);
const statusOf = (id) => pickStatus[id] || retStatus[id];
const reqOf = (rid) => PICK_QUEUE.concat(RET_QUEUE).filter((r) => r.eqrEquipmentRequestId === rid && r.requestNumber)[0];

function detailRows(rid) {
  const req = reqOf(rid);
  return (ALL[rid] || []).map((l) => ({ requestId: rid, requestNumber: req.requestNumber, requestStatus: req.requestStatus, lineId: l.id,
    equipmentName: l.name, className: l.cls, quantity: l.qty || 1, lineStatus: statusOf(l.id), allocatedSerial: l.serial || '',
    startDate: (req.requestedStartDate || '').slice(0, 10), endDate: l.end || (req.requestedEndDate || '').slice(0, 10), toNumber: l.to || '',
    inboundToNumber: l.inbound || '', isTransactable: l.tx, isMaintenanceTracked: l.mt, deploymentLocation: req.location || '' }));
}

function handle(req, res) {
  const p = req.path;
  const q = req.query;
  if (p.endsWith('/conf-global-settings')) {
    return res.json({ data: flags.map((k) => ({ settingKey: k, settingValue: 'true', settingCategory: 'FEATURE_FLAG', isActiveFlag: 'Y' })) });
  }
  if (p.endsWith('/views/workbench-requests')) {
    return res.json({ data: q.get('stage') === 'INITIATE' ? PICK_QUEUE : (q.get('stage') === 'RETURN' ? RET_QUEUE : []) });
  }
  if (p.endsWith('/views/request-detail-lines')) return res.json({ data: detailRows(Number(q.get('requestId'))) });
  if (p.endsWith('/transfer-orders')) return res.json({ data: TOS[Number(q.get('equipmentRequestId'))] || [] });
  if (p.endsWith('/transfer-order-lines')) return res.json({ data: (TO_LINES[Number(q.get('transferOrderId'))] || []).map((id) => ({ requestLineId: id })) });
  const lm = /\/equipment-requests\/(\d+)\/lines$/.exec(p);
  if (req.method === 'GET' && lm) {
    return res.json({ data: (ALL[Number(lm[1])] || []).map((l) => ({ id: l.id, eqrEquipmentMasterId: l.master, quantity: l.qty || 1, lineStatus: statusOf(l.id),
      fulfilmentClass: l.fc, isTransactable: l.tx, isMaintenanceTracked: l.mt })) });
  }
  if (p.endsWith('/views/line-detail-units')) {
    const id = Number(q.get('lineId'));
    if (UNITS[id]) return res.json({ data: UNITS[id] });
    if (RET_UNITS[id]) {
      const l = Object.values(RET_LINES).flat().filter((x) => x.id === id)[0];
      return res.json({ data: [{ equipmentName: l.name, className: l.cls, allocationId: 100 + id, unitNumber: l.serial, unitStatus: 'RENTED',
        allocationMethod: 'MANUAL', sourceInvOrgName: RET_UNITS[id] }] });
    }
    return res.json({ data: [] });
  }
  if (req.method === 'GET' && p.endsWith('/serial-refs')) return res.json({ data: SERIAL_REFS[Number(q.get('equipmentId'))] || [] });
  if (req.method === 'PATCH' && /\/equipment-requests\/\d+\/lines\/batch$/.test(p)) {
    req.json().lines.forEach((l) => {
      if (l.id in pickStatus) pickStatus[l.id] = l.lineStatus;
      if (l.id in retStatus) retStatus[l.id] = l.lineStatus;
    });
    return res.json({ data: [] });
  }
  const rm = /\/equipment-requests\/(\d+)$/.exec(p);
  if (req.method === 'GET' && rm) return res.json({ id: Number(rm[1]), requestNumber: (reqOf(Number(rm[1])) || {}).requestNumber, deliveryLocationType: 'SITE' });
  if (req.method === 'GET' && p.endsWith('/allocations')) {
    return res.json({ data: Number(q.get('requestLineId')) === 8001 ? [{ id: 1, eqrSerialRefId: 41, allocationStatus: 'ACTIVE' }] : [] });
  }
  if (req.method === 'PATCH' && /\/serial-refs\/\d+$/.test(p)) return res.json({ id: 41, unitStatus: 'AVAILABLE' });
  if (p.endsWith('/views/deployed-units')) {
    const term = (q.get('serialNumber') || q.get('q') || '').toLowerCase();
    const rows = DEPLOYED.filter((d) => (q.get('serialNumber') ? d.serialNumber.toLowerCase() === term : d.equipmentName.toLowerCase().includes(term)));
    return res.json({ data: rows, recordCount: rows.length, page: 0, pageSize: 50, totalPages: 1, hasMore: false });
  }
  if (p.endsWith('/returns/record')) {
    const ids = req.json().lineIds;
    ids.forEach((id) => { if (id in retStatus) retStatus[id] = 'RETURN_IN_PROCESS'; });
    return res.json({ linesPromoted: ids.length });
  }
  return undefined;
}

// A stand-in for jsPDF (the CDN is not reachable here): records the slip's text so the test can read it.
const FAKE_JSPDF = 'define([], function () {'
  + ' function D() { this.t = []; window.__slipText = this.t; }'
  + " ['setFont', 'setFontSize', 'setTextColor', 'setDrawColor', 'setLineWidth', 'line', 'addPage'].forEach(function (m) { D.prototype[m] = function () { return this; }; });"
  + ' D.prototype.text = function (s) { this.t.push([].concat(s).join(" ")); return this; };'
  + ' D.prototype.splitTextToSize = function (s) { return [String(s)]; };'
  + " D.prototype.output = function () { return 'data:application/pdf;base64,' + btoa('%PDF-1.4 fake'); };"
  + ' return { jsPDF: D }; });';

const short = (w) => `${w.method} ${w.path.replace(V1, '')}`;
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
// The screen's own content within the window. (At phone width the shell's top bar is itself wider than the window, on
// every Next screen; that is the shell's, so a phone check looks at the screen.)
const fits = (page, sel) => page.evaluate((s) => {
  const cw = document.documentElement.clientWidth;
  return [...document.querySelectorAll(s + ' *')].filter((e) => e.getBoundingClientRect().right > cw + 1).map((e) => e.className).slice(0, 3).join(' | ');
}, sel);

async function download(page, button, what, fmt) {
  await page.click(button);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`.nx-menu-item[data-what="${what}"][data-format="${fmt}"]`)]);
  const file = path.join(os.tmpdir(), 'next-yard-' + dl.suggestedFilename());
  await dl.saveAs(file);
  return { name: dl.suggestedFilename(), file };
}

function readXlsx(file, script) {
  try {
    return execFileSync('python3', ['-I', '-c', 'import sys, openpyxl\nws = openpyxl.load_workbook(sys.argv[1]).active\nrows = list(ws.iter_rows(values_only=True))\n' + script, file],
      { encoding: 'utf8' }).trim();
  } catch (e) {
    return 'unavailable';
  }
}

(async () => {
  const env = await E.start({ port: 19320, handle, app: 'next' });
  const { page } = env;
  await page.route('https://cdnjs.cloudflare.com/ajax/libs/jspdf/**', (route) => route.fulfill({ contentType: 'application/javascript', body: FAKE_JSPDF }));
  try {
    // ── Picking & shipping ────────────────────────────────────────────────────────────────────────────────────
    T.section('Picking & shipping: what has to go out');
    await env.open('/?open=picking');
    await page.waitForSelector('#ydPicking .nx-yd-row[data-id]', { timeout: 30000 });
    await page.waitForFunction(() => !document.querySelector('.nx-yd-finding'), null, { timeout: 20000 });
    await page.waitForTimeout(300);
    T.check('the queue was asked for the INITIATE stage', env.calls.some((c) => c.includes('/views/workbench-requests?') && c.includes('stage=INITIATE') && c.includes('size=1000')));
    T.eq('one row per request, in sections by the day it is needed, late first',
      await page.$$eval('#ydPicking .nx-yd-section', (s) => s.map((x) => x.dataset.section + ':' + [...x.querySelectorAll('.nx-yd-row[data-id]')].map((r) => r.dataset.number).join('+')).join(' ')),
      'late:REQ-10527 today:REQ-10530 week:REQ-10505');
    T.eq('the summary', await env.text('#ydSummary'), '7 pieces to get out on 3 requests · 5 late · 1 needed today');
    const tile = async (k) => (await env.text(`#ydPicking .nx-yd-tile[data-value="${k}"]`));
    T.eq('stage tiles count the pieces', [await tile('late'), await tile('pick'), await tile('picking'), await tile('ship'), await tile('shipped')].join(' | '),
      'Late 5 on 1 request | To pick 4 on 1 request | Being picked 2 on 2 requests | Ready to ship 1 on 1 request | Shipped 1 on 1 request');
    const late = await env.text('#ydPicking .nx-yd-row[data-number="REQ-10527"]');
    T.check('a late row says how late, from which yard, its pieces and the next step', late.includes('3 days late') && late.includes('Houston Yard, Atlanta Yard')
      && late.includes('4 to pick · 1 being picked') && late.includes('Release 4 pieces for picking'), late);
    T.check('the inspected crane waits for its ship confirm in Fusion', (await env.text('#ydPicking .nx-yd-row[data-number="REQ-10505"]')).includes('Ship confirm 1 piece'));
    T.eq('the yards it ships from, found per line', await page.$$eval('#ydPicking .nx-yd-yards .nx-chip', (c) => c.map((x) => x.dataset.value).join()), 'all,Atlanta Yard,Houston Yard');
    await page.click('#ydPicking .nx-yd-yards .nx-chip[data-value="Atlanta Yard"]');
    await page.waitForTimeout(250);
    T.eq('a yard keeps its requests', await page.$$eval('#ydPicking .nx-yd-row[data-id]', (r) => r.map((x) => x.dataset.number).join()), 'REQ-10527,REQ-10530');
    await page.click('#ydPicking .nx-yd-yards .nx-chip[data-value="all"]');
    await page.click('#ydPicking .nx-yd-tile[data-value="ship"]');
    await page.waitForTimeout(250);
    T.eq('a tile keeps the requests with pieces at that stage', await page.$$eval('#ydPicking .nx-yd-row[data-id]', (r) => r.map((x) => x.dataset.number).join()), 'REQ-10505');
    await page.click('#ydPicking .nx-yd-tile[data-value="ship"]');
    await page.fill('#ydPicking .nx-search input', 'trencher');
    await page.waitForTimeout(250);
    T.eq('search finds a request by its equipment', await page.$$eval('#ydPicking .nx-yd-row[data-id]', (r) => r.map((x) => x.dataset.number).join()), 'REQ-10530');
    await page.fill('#ydPicking .nx-search input', '');
    await page.waitForTimeout(250);
    T.check('no sideways scroll on the page', await noSideways(page));
    await env.shot('next-yard-picking.png');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    T.eq('on a phone: the screen fits the width', await fits(page, '#ydPicking'), '');
    T.check('on a phone: the rows fold', await page.$eval('#ydPicking .nx-yd-row[data-number="REQ-10527"] .nx-yd-c-next', (e) => getComputedStyle(e).display === 'none'));
    await page.$eval('#ydPicking .nx-yd-section', (e) => e.scrollIntoView());
    await env.shot('next-yard-picking-phone.png');
    await page.$eval('#ydPicking', (e) => e.scrollIntoView());
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForTimeout(300);

    T.section('Picking & shipping: export what is shown');
    const xl = await download(page, '#ydExport', 'list', 'xlsx');
    T.check('Excel file name', /^equiprite-picking-\d{4}-\d{2}-\d{2}\.xlsx$/.test(xl.name), xl.name);
    const xr = readXlsx(xl.file, 'print(len(rows)); print(rows[0][:4]); print(sorted(set(r[2] for r in rows[1:]))); print([r for r in rows if r[7] == "Light tower"][0][11])');
    if (xr !== 'unavailable') {
      T.eq('one row per piece: header + 8, the columns, the yard', xr.split('\n').join(' | '),
        "9 | ('Needed by', 'Days late', 'Request', 'Type') | ['REQ-10505', 'REQ-10527', 'REQ-10530'] | Atlanta Yard");
    }

    T.section('Picking & shipping: a request beside the list');
    env.writes.length = 0;
    await page.click('#ydPicking .nx-yd-row[data-number="REQ-10527"] .nx-yd-c-pieces');
    await page.waitForSelector('#ydWork .nx-yd-line[data-line]', { timeout: 20000 });
    await page.waitForTimeout(400);
    T.eq('only the pieces in picking (New\'s rule): the DRAFT line is not one', await page.$$eval('#ydWork .nx-yd-line[data-line]', (x) => x.map((r) => r.dataset.line).sort().join()),
      '7001,7002,7003,7004,7006');
    T.eq('it opens with the first transfer order awaiting release ticked', await page.$$eval('#ydWork input[data-line-id]:checked', (x) => x.map((i) => i.dataset.lineId).sort().join()), '7001,7002');
    T.check('where to pick from: yard, subinventory, locator', (await env.text('#ydWork .nx-yd-line[data-line="7001"]')).includes('EX-2201 · Houston Yard · Available · A-12-04'));
    T.check('the damaged serial is an exception', (await env.text('#ydWork .nx-yd-exc')).includes('Serial EX-2207 is DAMAGED'));
    const release = await env.text('#ydStockRelease');
    T.check('releasing a transfer order is a Fusion step: shown, and done in New', release.includes('3 pieces on transfer order TO-778402, TO-778399 wait for release')
      && release.includes('writes to Fusion'), release);
    T.eq('Do it in New EquipRite opens New\'s picking screen', await page.getAttribute('#ydReleaseInNew', 'href'), env.newUrl + '/vp/shell/logistics/picking');
    T.check('also on the request: the line not in picking, in words', (await env.text('#ydOther')).includes('Fuel bowser') && (await env.text('#ydOther')).includes('Not sent yet'));
    T.check('fixed-asset release waits for a fixed-asset tick', await page.$eval('#ydReleaseFm', (b) => b.disabled && /Tick the fixed-asset/.test(b.textContent)));
    T.eq('opening reads only', env.writes.length, 0);
    T.check('no sideways scroll with the request open', await noSideways(page));
    await env.shot('next-yard-picking-open.png');

    T.section('Picking & shipping: release a fixed-asset piece (EquipRite only)');
    await page.click('#ydWork input[data-line-id="7006"]');
    await page.waitForTimeout(200);
    T.check('the button says what it releases', (await env.text('#ydReleaseFm')).includes('Release 1 ticked piece'));
    env.writes.length = 0;
    await page.click('#ydReleaseFm');
    await page.waitForFunction(() => /released for picking/.test((document.querySelector('#ydBanner') || {}).textContent || ''), null, { timeout: 20000 });
    await page.waitForTimeout(300);
    T.eq('calls: the line batch only (no Fusion release)', env.writes.map(short).join(' > '), 'PATCH /equipment-requests/501/lines/batch');
    T.eq('only the ticked fixed-asset line moves to Pick initiated', JSON.stringify(env.writes[0].body), JSON.stringify({ lines: [{ id: 7006, lineStatus: 'PICK_INITIATED' }] }));
    T.check('the ticked transfer-order pieces were left for New', (await env.text('#ydBanner')).includes('left as they are'));
    T.eq('they still wait for release', pickStatus[7001] + ' ' + pickStatus[7002], 'SCHEDULED_FOR_PICKING SCHEDULED_FOR_PICKING');
    T.check('the list row follows', (await env.text('#ydPicking .nx-yd-row[data-number="REQ-10527"]')).includes('3 to pick · 2 being picked'));

    T.section('Picking & shipping: Pick and ship (EquipRite only)');
    T.check('it says how many it will ship', (await env.text('#ydShip')).includes('Pick and ship 1 piece'));
    env.writes.length = 0;
    await page.click('#ydShip');
    await page.waitForFunction(() => /shipped to site/.test((document.querySelector('#ydBanner') || {}).textContent || ''), null, { timeout: 20000 });
    await page.waitForTimeout(400);
    T.eq('calls: the ship batch only', env.writes.map(short).join(' > '), 'PATCH /equipment-requests/501/lines/batch');
    T.eq('the ticked fixed-asset piece ships to site', JSON.stringify(env.writes[0].body), JSON.stringify({ lines: [{ id: 7006, lineStatus: 'SHIP_TO_SITE' }] }));
    T.check('it read the live statuses first', env.calls.filter((c) => c.startsWith('GET ' + V1 + '/equipment-requests/501/lines')).length >= 2);
    T.check('the workspace is read again: the opening order ticked', (await page.$$eval('#ydWork input[data-line-id]:checked', (x) => x.map((i) => i.dataset.lineId).sort().join())) === '7001,7002');

    T.section('Picking & shipping: the pick slip');
    await page.click('#ydSlipMake');
    await page.waitForSelector('#ydSlip iframe', { timeout: 15000 });
    T.check('the slip is shown, with what was released', (await env.text('#ydSlip')).includes('Pick slip PS-REQ-10527-') && (await env.text('#ydSlip')).includes('2 lines, in walking order'));
    const slipText = await page.evaluate(() => (window.__slipText || []).join(' | '));
    T.check('the slip lists the released pieces with their locators, not the unreleased ones', slipText.includes('Survey drone') && slipText.includes('D-01-01')
      && !slipText.includes('CAT 320'), slipText.slice(0, 300));
    const slipFile = await Promise.all([page.waitForEvent('download'), page.click('#ydSlipDownload')]).then(([d]) => d.suggestedFilename());
    T.eq('it downloads as a PDF', slipFile, 'pick-slip-REQ-10527.pdf');
    await env.shot('next-yard-pick-slip.png');

    T.section('Picking & shipping: a ship that would move an asset in Fusion is left to New');
    flags = flags.concat(['MAINT_ASSET_LOCATION_SYNC_ENABLED']);
    await env.open('/?open=picking');
    await page.waitForSelector('#ydPicking .nx-yd-row[data-number="REQ-10527"]', { timeout: 30000 });
    await page.click('#ydPicking .nx-yd-row[data-number="REQ-10527"] .nx-yd-toggle');
    await page.waitForSelector('#ydWork .nx-yd-line[data-line]', { timeout: 20000 });
    await page.waitForTimeout(300);
    await page.click('#ydWork input[data-line-id="7001"]');
    await page.click('#ydWork input[data-line-id="7002"]');
    await page.click('#ydWork input[data-line-id="7004"]');
    await page.waitForTimeout(200);
    T.check('before the click it says shipping moves its maintenance asset in Fusion', (await env.text('#ydShipInNew')).includes('writes to Fusion'));
    env.writes.length = 0;
    await page.click('#ydShip');
    await page.waitForFunction(() => /Nothing was shipped/.test((document.querySelector('#ydBanner') || {}).textContent || ''), null, { timeout: 20000 });
    T.eq('nothing is written', env.writes.length, 0);
    T.eq('the drone is still being picked', pickStatus[7004], 'PICK_INITIATED');

    T.section('Picking & shipping: the request in its own tab');
    await page.click('#ydPicking .nx-yd-row[data-number="REQ-10530"] .nx-yd-num');
    await page.waitForSelector('.nx-record-title', { timeout: 20000 });
    await page.waitForTimeout(400);
    T.eq('the request number opens the request in a tab of its own', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId), 'request:502');
    await page.click('.nx-tab-btn[data-id="picking"]');
    await page.waitForTimeout(300);
    T.check('back on Picking & shipping, as it was left', await page.isVisible('#ydWork'));
    flags = flags.filter((f) => f !== 'MAINT_ASSET_LOCATION_SYNC_ENABLED');

    // ── Receiving & returns ───────────────────────────────────────────────────────────────────────────────────
    T.section('Receiving & returns: what is coming back');
    await env.open('/?open=returns');
    await page.waitForSelector('#ydReturns .nx-yd-row[data-id]', { timeout: 30000 });
    await page.waitForFunction(() => !document.querySelector('#ydReturns .nx-yd-finding'), null, { timeout: 20000 });
    await page.waitForTimeout(300);
    T.check('the queue was asked for the RETURN stage', env.calls.some((c) => c.includes('/views/workbench-requests?') && c.includes('stage=RETURN')));
    T.eq('one row per request, in sections by the yard\'s job, overdue first',
      await page.$$eval('#ydReturns .nx-yd-section', (s) => s.map((x) => x.dataset.section + ':' + [...x.querySelectorAll('.nx-yd-row[data-id]')].map((r) => r.dataset.number).join('+')).join(' ')),
      'overdue:REQ-10440 requested:REQ-10431 week:REQ-10450');
    T.eq('the summary', await env.text('#ydrSummary'), '6 pieces out or coming back on 3 requests · 1 overdue · 1 to receive');
    const rtile = async (k) => (await env.text(`#ydReturns .nx-yd-tile[data-value="${k}"]`));
    T.eq('stage tiles', [await rtile('late'), await rtile('receive'), await rtile('requested'), await rtile('transit'), await rtile('site')].join(' | '),
      'Overdue 1 on 1 request | To receive 1 on 1 request | Return requested 1 on 1 request | On the way back 1 on 1 request | On site 3 on 2 requests');
    const over = await env.text('#ydReturns .nx-yd-row[data-number="REQ-10440"]');
    T.check('an overdue row: how overdue, the yard it goes back to, its pieces, the next step', over.includes('45 days overdue')
      && over.includes('Houston Yard, Atlanta Yard') && over.includes('1 to receive · 1 on the way back · 1 on site') && over.includes('Receive 1 piece at the yard'), over);
    T.check('a stock return waits for its transfer order: in New', (await env.text('#ydReturns .nx-yd-row[data-number="REQ-10431"]')).includes('Raise the return transfer order (1)'));
    T.check('no sideways scroll', await noSideways(page));
    await env.shot('next-yard-returns.png');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    T.eq('on a phone: the screen fits the width', await fits(page, '#ydReturns'), '');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForTimeout(300);
    const csv = await download(page, '#ydrExport', 'list', 'csv');
    const csvText = fs.readFileSync(csv.file, 'utf8');
    T.check('export: one row per piece, in the list\'s order', csv.name.startsWith('equiprite-returns-') && csvText.split('\r\n').filter(Boolean).length === 7
      && csvText.indexOf('REQ-10440') < csvText.indexOf('REQ-10431') && csvText.includes('Days overdue'), csvText.slice(0, 200));

    T.section('Receiving & returns: receive at the yard (EquipRite only)');
    env.writes.length = 0;
    await page.click('#ydReturns .nx-yd-row[data-number="REQ-10440"] .nx-yd-c-pieces');
    await page.waitForSelector('#ydrWork .nx-yd-line[data-line]', { timeout: 20000 });
    await page.waitForTimeout(300);
    T.eq('the pieces, shipped back first', await page.$$eval('#ydrWork .nx-yd-line[data-line]', (x) => x.map((r) => r.dataset.line).join()), '8001,8002,8003');
    T.eq('only the piece shipped back to the yard can be ticked', await page.$$eval('#ydrWork input[data-line-id]:not(:disabled)', (x) => x.map((i) => i.dataset.lineId).join()), '8001');
    T.check('the return transfer order of what is on its way', (await env.text('#ydrWork .nx-yd-facts')).includes('TO-779010'));
    T.check('receive waits for a tick', await page.$eval('#ydrReceive', (b) => b.disabled));
    await page.click('#ydrWork input[data-line-id="8001"]');
    await page.fill('#ydrDate', day(-2));
    await page.dispatchEvent('#ydrDate', 'change');
    await page.waitForTimeout(250);
    T.check('the button says what it receives', (await env.text('#ydrReceive')).includes('Receive 1 piece at the yard'));
    T.eq('opening reads only', env.writes.length, 0);
    await env.shot('next-yard-returns-open.png');
    await page.click('#ydrReceive');
    await page.waitForFunction(() => /received and closed/.test((document.querySelector('#ydrBanner') || {}).textContent || ''), null, { timeout: 20000 });
    await page.waitForTimeout(300);
    T.eq('calls: close the line, then its unit back to stock (no Fusion)', env.writes.map(short).join(' > '), 'PATCH /equipment-requests/601/lines/batch > PATCH /serial-refs/41');
    T.eq('closed with the day it came back', JSON.stringify(env.writes[0].body), JSON.stringify({ lines: [{ id: 8001, lineStatus: 'CLOSED', actualReturnDate: day(-2) + 'T00:00:00Z' }] }));
    T.eq('the serial is available again', JSON.stringify(env.writes[1].body), '{"unitStatus":"AVAILABLE"}');
    T.check('the result in words', (await env.text('#ydrBanner')).includes('1 unit is back in stock'));
    T.check('the list row follows', (await env.text('#ydReturns .nx-yd-row[data-number="REQ-10440"]')).includes('1 on the way back · 1 on site · 1 closed'));

    T.section('Receiving & returns: a unit back without notice');
    await page.click('#ydrFindOpen');
    await page.waitForSelector('#ydrQuery input', { state: 'visible' });
    env.writes.length = 0;
    await page.fill('#ydrQuery input', 'DR-9');
    await page.press('#ydrQuery input', 'Enter');
    await page.waitForSelector('#ydrFind input[data-row-key]', { timeout: 15000 });
    T.check('the scanned serial is looked up exactly', env.calls.some((c) => c.includes('/views/deployed-units?') && c.includes('serialNumber=DR-9')));
    T.eq('nothing is ticked for the operator', await page.$$eval('#ydrFind input[data-row-key]:checked', (x) => x.length), 0);
    T.check('recording waits for a tick', await page.$eval('#ydrRecord', (b) => b.disabled));
    await page.click('#ydrFind input[data-row-key="8201:54"]');
    await page.waitForTimeout(200);
    T.check('a fixed asset is recorded here', (await env.text('#ydrRecord')).includes('Record the return of 1 unit'));
    await page.click('#ydrRecord');
    await page.waitForFunction(() => /returned, no transfer order/.test((document.querySelector('#ydrFindBanner') || {}).textContent || ''), null, { timeout: 20000 });
    await page.waitForTimeout(400);
    T.eq('calls: record the return only (no transfer order)', env.writes.map(short).join(' > '), 'POST /requests/603/returns/record');
    T.eq('the fixed-asset line', JSON.stringify(env.writes[0].body), JSON.stringify({ lineIds: [8201] }));
    T.check('the list follows: it is on its way back', (await page.$$eval('#ydReturns .nx-yd-section[data-section="transit"] .nx-yd-row[data-id]', (r) => r.map((x) => x.dataset.number).join())) === 'REQ-10450');

    env.writes.length = 0;
    await page.fill('#ydrQuery input', 'AC-0007');
    await page.press('#ydrQuery input', 'Enter');
    await page.waitForSelector('#ydrFind input[data-row-key="8003:53"]', { timeout: 15000 });
    await page.click('#ydrFind input[data-row-key="8003:53"]');
    await page.waitForTimeout(200);
    T.check('a stock unit needs a return transfer order: shown, and done in New', (await env.text('#ydrFoundInNew')).includes('return transfer order')
      && (await page.$eval('#ydrRecord', (b) => b.disabled && /Only fixed assets/.test(b.textContent))));
    T.eq('Do it in New EquipRite opens New\'s receipt screen', await page.$eval('#ydrFoundInNew a', (a) => a.getAttribute('href')), env.newUrl + '/vp/shell/logistics/receipt');
    T.eq('nothing is written for it', env.writes.length, 0);
    await env.shot('next-yard-returns-find.png');
    const scanBtn = await page.$('#ydrScan');
    if (scanBtn) {
      await scanBtn.click();
      await page.waitForFunction(() => /camera/i.test((document.querySelector('#ydrFind') || {}).textContent || '') && !document.querySelector('#ydrScanVideo'), null, { timeout: 15000 });
      T.check('with no camera here it says why, and leaves no camera running', true);
    } else {
      T.check('with no camera here it says why', /camera/i.test(await env.text('#ydrNoCamera')));
    }
    T.check('no sideways scroll', await noSideways(page));

    T.eq('no browser errors', env.errors.filter((e) => !e.startsWith('warning')).join('\n'), '');
  } catch (e) {
    T.check('run finished', false, e.message);
    console.log('browser errors:\n' + env.errors.join('\n'));
    console.log('last calls:\n' + env.calls.slice(-10).join('\n'));
    await env.shot('next-yard-failed.png').catch(() => {});
  } finally {
    console.log('\nscreenshots: ' + path.join(os.tmpdir(), 'equiprite-e2e'));
    await env.close();
    T.report();
  }
})();
