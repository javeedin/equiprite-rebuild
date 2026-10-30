'use strict';
/*
 * EquipRite Next, Inspections and Transfers, in a real browser against fake data shaped like services/eqp-v1:
 *   - inspections: the queue (points, asked for / everything, late, failed), a unit's whole checklist, a failed
 *     question logged as a defect with a camera photo, FAIL -> exactly New EquipRite's calls; what happens to a failed
 *     unit; the next unit passes at the yard receipt (no line status); a failed unit re-inspected and cleared; a
 *     conditional result that needs its acknowledgement; export of the queue
 *   - transfers: every transfer order, from where to where, what is moving, where it is (read from the equipment),
 *     what is late; chips, kinds, search, sort, export; a transfer in its own tab; reads only
 *   - no sideways scroll (desktop, tablet, phone), no browser errors, screenshots
 * Needs `npm run build`. Run: node tests/e2e/next-checks.e2e.js   (screenshots go to the OS temp folder)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const ts = (n) => day(n) + 'T00:00:00Z';
const short = (w) => w.method + ' ' + w.path.replace('/equiprite/v1', '');

// ── Inspection data ──────────────────────────────────────────────────────────────────────────────────────────
const DETAIL = {
  501: [
    { lineId: 9001, requestId: 501, requestNumber: 'REQ-10505', requestStatus: 'IN_PROCESS', projectName: 'Pipeline North', taskName: '2.1',
      equipmentMasterId: 61, equipmentClassId: 10, equipmentSubclassId: 101, equipmentName: 'Mobile Crane 50t', className: 'Cranes',
      quantity: 1, lineStatus: 'PICK_RELEASED', allocatedSerial: 'MC-11', startDate: ts(-2), endDate: ts(40) },
    { lineId: 9002, requestId: 501, requestNumber: 'REQ-10505', requestStatus: 'IN_PROCESS', projectName: 'Pipeline North', taskName: '2.1',
      equipmentMasterId: 62, equipmentClassId: 20, equipmentSubclassId: 201, equipmentName: 'Generator 100 kVA', className: 'Power',
      quantity: 1, lineStatus: 'PICK_RELEASED', allocatedSerial: 'GN-0419', startDate: ts(4), endDate: ts(40) },
    { lineId: 9006, requestId: 501, requestNumber: 'REQ-10505', equipmentClassId: 10, equipmentName: 'Mobile Crane 50t', lineStatus: 'DEPLOYED' },
  ],
  502: [
    { lineId: 9003, requestId: 502, requestNumber: 'REQ-10510', projectName: 'Plant Expansion B', equipmentClassId: 30, equipmentName: 'Light tower',
      className: 'Lighting', quantity: 1, lineStatus: 'SHIPPED_TO_YARD', allocatedSerial: 'LT-0207', startDate: ts(-30), endDate: ts(-1) },
  ],
  503: [
    { lineId: 9004, requestId: 503, requestNumber: 'REQ-10512', projectName: 'Refinery C', equipmentClassId: 40, equipmentName: 'Plate compactor',
      className: 'Compaction', quantity: 1, lineStatus: 'INSPECTION_FAILED', allocatedSerial: 'CP-77', startDate: ts(1), endDate: ts(30) },
  ],
  504: [
    { lineId: 9005, requestId: 504, requestNumber: 'REQ-10498', projectName: 'Harbour Wall', equipmentClassId: 10, equipmentSubclassId: 102,
      equipmentName: 'Tower crane', className: 'Cranes', quantity: 1, lineStatus: 'RETURN_INITIATED', allocatedSerial: 'TC-03', startDate: ts(-60), endDate: ts(3) },
  ],
};
const MATRIX = [
  { id: 1, equipmentClassId: 10, equipmentSubclassId: 101, inspectionType: 'SHIP_OUT_YARD', isMandatoryFlag: 'Y', isActiveFlag: 'Y' },
  { id: 2, equipmentClassId: 20, equipmentSubclassId: null, inspectionType: 'SHIP_OUT_YARD', isMandatoryFlag: 'Y', isActiveFlag: 'Y' },
  { id: 3, equipmentClassId: 30, equipmentSubclassId: null, inspectionType: 'RECEIVE_YARD', isMandatoryFlag: 'N', isActiveFlag: 'Y' },
  { id: 4, equipmentClassId: 40, equipmentSubclassId: null, inspectionType: 'SHIP_OUT_YARD', isMandatoryFlag: 'Y', isActiveFlag: 'Y' },
  { id: 5, equipmentClassId: 10, equipmentSubclassId: 102, inspectionType: 'SHIP_OUT_SITE', isActiveFlag: 'N' },
];
const CHECKLISTS = {
  10: [
    { id: 701, equipmentClassId: 10, questionText: 'Load chart and certificate on board', responseType: 'YES_NO', isMandatoryFlag: 'Y', sequenceNumber: 1 },
    { id: 702, equipmentClassId: 10, questionText: 'Wire rope and hook', responseType: 'PASS_FAIL', isMandatoryFlag: 'Y', sequenceNumber: 2 },
    { id: 703, equipmentClassId: 10, questionText: 'Outrigger pad thickness', responseType: 'NUMERIC', minValue: 40, maxValue: 60, uom: 'mm', isMandatoryFlag: 'Y', sequenceNumber: 3 },
    { id: 704, equipmentClassId: 10, questionText: 'Cab cleanliness', responseType: 'RATING', maxValue: 5, isMandatoryFlag: 'N', sequenceNumber: 4 },
  ],
  20: [
    { id: 801, equipmentClassId: 20, questionText: 'Oil and coolant levels', responseType: 'PASS_FAIL', isMandatoryFlag: 'Y', sequenceNumber: 1 },
    { id: 802, equipmentClassId: 20, questionText: 'Emergency stop works', responseType: 'YES_NO', isMandatoryFlag: 'Y', sequenceNumber: 2 },
  ],
  30: [
    { id: 901, equipmentClassId: 30, questionText: 'Mast and lamps undamaged', responseType: 'PASS_FAIL', isMandatoryFlag: 'Y', sequenceNumber: 1 },
  ],
  40: [
    { id: 951, equipmentClassId: 40, questionText: 'Base plate and vibrator', responseType: 'PASS_FAIL', isMandatoryFlag: 'Y', sequenceNumber: 1 },
  ],
};
// The compactor failed here before: its last inspection, completed FAIL.
const EARLIER = { 9004: [{ id: 6100, requestLineId: 9004, inspectionType: 'SHIP_OUT_YARD', inspectionStatus: 'COMPLETED', overallResult: 'FAIL', completedDate: ts(-3) }] };
const stored = {};
const posted = { inspection: 0, response: 0, defect: 0 };

function inspectionHandle(req, res) {
  const p = req.path.replace('/equiprite/v1', '');
  const q = req.query;
  if (p === '/views/workbench-requests') {
    const stage = q.get('stage');
    if (stage === 'OUTBOUND') return res.json({ data: [{ eqrEquipmentRequestId: 501 }, { eqrEquipmentRequestId: 501 }, { eqrEquipmentRequestId: 503 }] });
    if (stage === 'INBOUND') return res.json({ data: [{ eqrEquipmentRequestId: 502 }, { eqrEquipmentRequestId: 504 }] });
    return undefined;
  }
  if (p === '/conf-inspection-details') return res.json({ data: MATRIX, recordCount: MATRIX.length });
  if (p === '/inspection-checklists') {
    const rows = CHECKLISTS[Number(q.get('classId'))] || [];
    return res.json({ data: rows, recordCount: rows.length, page: 0, pageSize: 20, totalPages: 1, hasMore: false });
  }
  if (p === '/inspections' && req.method === 'GET') {
    const id = Number(q.get('requestLineId'));
    const rows = (EARLIER[id] || []).concat(Object.values(stored).filter((x) => x.requestLineId === id));
    return res.json({ data: rows, recordCount: rows.length, page: 0, pageSize: 20, totalPages: 1, hasMore: false });
  }
  if (p === '/inspections' && req.method === 'POST') {
    const row = Object.assign({ id: 7000 + (++posted.inspection) }, req.json(), { objectVersionNumber: 1 });
    stored[row.id] = row;
    return res.json(row, 201);
  }
  if (/^\/inspections\/\d+$/.test(p) && req.method === 'PATCH') {
    const id = Number(p.split('/')[2]);
    stored[id] = Object.assign(stored[id] || { id }, req.json());
    return res.json(stored[id]);
  }
  if (p === '/inspection-responses' && req.method === 'POST') return res.json(Object.assign({ id: 80000 + (++posted.response) }, req.json()), 201);
  if (p === '/inspection-defects' && req.method === 'POST') return res.json(Object.assign({ id: 9100 + (++posted.defect) }, req.json()), 201);
  if (req.path === '/common/documents/v1' && req.method === 'POST') return res.json({ doc_id: 55, application_code: 'EQUIP_RITE', entity_type: 'EQR_INSPECTION_DEFECT' }, 201);
  if (/^\/equipment-requests\/\d+\/lines\/batch$/.test(p) && req.method === 'PATCH') return res.json({ data: req.json().lines });
  return undefined;
}

// ── Transfer data ────────────────────────────────────────────────────────────────────────────────────────────
// Every order is stored PENDING, as the backend leaves it after release: where each one is comes from its units.
Object.assign(DETAIL, {
  475: [
    { lineId: 4751, requestId: 475, requestNumber: 'REQ-10475', projectName: 'Pipeline North', equipmentName: 'Dump Truck 30t', className: 'Trucks', quantity: 1, lineStatus: 'DEPLOYED', allocatedSerial: 'DT-1108' },
    { lineId: 4752, requestId: 475, requestNumber: 'REQ-10475', projectName: 'Pipeline North', equipmentName: 'Dump Truck 30t', className: 'Trucks', quantity: 1, lineStatus: 'DEPLOYED', allocatedSerial: 'DT-1112' },
  ],
  510: [{ lineId: 5101, requestId: 510, requestNumber: 'REQ-10520', projectName: 'Refinery C', equipmentName: 'Excavator 20t', className: 'Excavators', quantity: 1, lineStatus: 'SHIP_TO_SITE', allocatedSerial: 'EX-2201' }],
  560: [{ lineId: 5601, requestId: 560, requestNumber: 'REQ-10560', projectName: 'Harbour Wall', equipmentName: 'Light tower', className: 'Lighting', quantity: 1, lineStatus: 'SHIPPED_TO_YARD', allocatedSerial: 'LT-0300' }],
  527: [{ lineId: 5271, requestId: 527, requestNumber: 'REQ-10527', projectName: 'Plant Expansion B', equipmentName: 'Dump Truck 30t', className: 'Trucks', quantity: 1, lineStatus: 'IN_PROCESS' }],
});
const MY_REQUESTS = [
  { eqrEquipmentRequestId: 475, requestNumber: 'REQ-10475', status: 'IN_PROCESS', projectName: 'Pipeline North' },
  { eqrEquipmentRequestId: 501, requestNumber: 'REQ-10505', status: 'IN_PROCESS', projectName: 'Pipeline North' },
  { eqrEquipmentRequestId: 510, requestNumber: 'REQ-10520', status: 'IN_PROCESS', projectName: 'Refinery C' },
  { eqrEquipmentRequestId: 527, requestNumber: 'REQ-10527', status: 'IN_PROCESS', projectName: 'Plant Expansion B' },
  { eqrEquipmentRequestId: 560, requestNumber: 'REQ-10560', status: 'IN_PROCESS', projectName: 'Harbour Wall' },
];
const ORGS = [
  { invOrgId: 1, organizationId: 1001, organizationCode: 'YARD1', organizationName: 'Houston yard', status: 'ACTIVE' },
  { invOrgId: 2, organizationId: 1002, organizationCode: 'YARD2', organizationName: 'Odessa yard', status: 'ACTIVE' },
  { invOrgId: 3, organizationId: 3001, organizationCode: 'TEXAS', organizationName: 'Texas project sites', status: 'ACTIVE' },
  { invOrgId: 4, organizationId: 3002, organizationCode: 'LOUISIANA', organizationName: 'Louisiana project sites', status: 'ACTIVE' },
];
const ORDERS = [
  { id: 300, equipmentRequestId: 475, orderNumber: 'TO-300', orderType: 'OUTBOUND', orderStatus: 'PENDING', sourceOrgId: 1001, destinationOrgId: 3001,
    requestedDate: ts(-35), needByDate: ts(-30), createdDate: ts(-36), carrierName: 'Lone Star Haul', trackingNumber: 'LSH-55102' },
  { id: 310, equipmentRequestId: 501, orderNumber: 'TO-310', orderType: 'OUTBOUND', orderStatus: 'PENDING', sourceOrgId: 1001, destinationOrgId: 3001,
    requestedDate: ts(-6), needByDate: ts(-2), createdDate: ts(-6) },
  { id: 320, equipmentRequestId: 510, orderNumber: 'TO-320', orderType: 'OUTBOUND', orderStatus: 'PENDING', sourceOrgId: 1002, destinationOrgId: 3001,
    requestedDate: ts(-1), needByDate: ts(5), createdDate: ts(-1) },
  { id: 330, equipmentRequestId: 560, orderNumber: 'TO-330', orderType: 'INBOUND', orderStatus: 'PENDING', sourceOrgId: 3002, destinationOrgId: 1001,
    requestedDate: ts(-4), needByDate: ts(-1), createdDate: ts(-4) },
  { id: 340, equipmentRequestId: 527, orderNumber: 'TO-340', orderType: 'OUTBOUND', orderStatus: 'CANCELLED', sourceOrgId: 1001, destinationOrgId: 3002, createdDate: ts(-10) },
  { id: 900, equipmentRequestId: 527, orderNumber: 'EQR-TRF-REQ-10527-1', orderType: 'INTER_PROJECT', orderStatus: 'PENDING', sourceOrgId: 3001, destinationOrgId: 3002,
    requestedDate: ts(-3), needByDate: ts(-3), createdDate: ts(-3), shippingNotes: 'Pipeline North finished early' },
];
const TO_LINES = {
  300: [{ id: 3001, transferOrderId: 300, requestLineId: 4751, lineNumber: 1, quantity: 1, serialNumber: 'DT-1108', lineStatus: 'PENDING' },
    { id: 3002, transferOrderId: 300, requestLineId: 4752, lineNumber: 2, quantity: 1, serialNumber: 'DT-1112', lineStatus: 'PENDING' }],
  310: [{ id: 3101, transferOrderId: 310, requestLineId: 9001, lineNumber: 1, quantity: 1, serialNumber: 'MC-11', lineStatus: 'PENDING' },
    { id: 3102, transferOrderId: 310, requestLineId: 9006, lineNumber: 2, quantity: 1, serialNumber: 'MC-07', lineStatus: 'PENDING' }],
  320: [{ id: 3201, transferOrderId: 320, requestLineId: 5101, lineNumber: 1, quantity: 1, serialNumber: 'EX-2201', lineStatus: 'PENDING' }],
  330: [{ id: 3301, transferOrderId: 330, requestLineId: 5601, lineNumber: 1, quantity: 1, serialNumber: 'LT-0300', lineStatus: 'PENDING' }],
  900: [{ id: 9901, transferOrderId: 900, requestLineId: 5271, lineNumber: 1, quantity: 1, serialNumber: 'DT-1108', lineStatus: 'PENDING' }],
};
const HISTORY = [
  { id: 41, transferOrderId: 880, orderNumber: 'INV-TX 882104', transferDate: ts(-8), equipmentName: 'Generator 60 kVA', serialNumber: 'GN-0388',
    sourceRequestId: 402, sourceRequestNumber: 'REQ-10402', sourceProjectName: 'Pipeline North', destinationRequestId: 466, destinationRequestNumber: 'REQ-10466',
    destinationProjectName: 'Plant Expansion B', sourceOrgId: 3001, destinationOrgId: 3002, transferStatus: 'COMPLETED', transferredBy: 'a.khan' },
  { id: 42, transferOrderId: 900, orderNumber: 'EQR-TRF-REQ-10527-1', transferDate: ts(-3), equipmentName: 'Dump Truck 30t', serialNumber: 'DT-1108',
    sourceRequestId: 475, sourceRequestNumber: 'REQ-10475', sourceProjectName: 'Pipeline North', sourceRequestLineId: 4751, destinationRequestId: 527,
    destinationRequestNumber: 'REQ-10527', destinationProjectName: 'Plant Expansion B', destinationRequestLineId: 5271, sourceOrgId: 3001, destinationOrgId: 3002,
    transferStatus: 'PENDING', transferredBy: 'priya.raman' },
];

function transferHandle(req, res) {
  const p = req.path.replace('/equiprite/v1', '');
  const q = req.query;
  if (p === '/views/my-requests') return res.json({ data: MY_REQUESTS });
  if (p === '/inv-orgs') return res.json({ data: ORGS, recordCount: ORGS.length });
  if (p === '/transfer-orders' && req.method === 'GET') return res.json({ data: ORDERS, recordCount: ORDERS.length });
  const one = /^\/transfer-orders\/(\d+)$/.exec(p);
  if (one && req.method === 'GET') {
    const o = ORDERS.find((x) => x.id === Number(one[1]));
    return o ? res.json(o) : res.json({ message: 'Transfer order not found' }, 404);
  }
  if (p === '/transfer-order-lines' && req.method === 'GET') {
    const rows = TO_LINES[Number(q.get('transferOrderId'))] || [];
    return res.json({ data: rows, recordCount: rows.length, page: 0, pageSize: 20, totalPages: 1, hasMore: false });
  }
  if (p === '/transfer-history' && req.method === 'GET') {
    const id = Number(q.get('equipmentRequestId') || 0);
    const rows = id ? HISTORY.filter((h) => h.sourceRequestId === id || h.destinationRequestId === id) : HISTORY;
    return res.json({ data: rows, recordCount: rows.length, page: 0, pageSize: 20, totalPages: 1, hasMore: false });
  }
  return undefined;
}

function handle(req, res) {
  const p = req.path.replace('/equiprite/v1', '');
  if (p === '/views/request-detail-lines') {
    const id = Number(req.query.get('requestId'));
    return res.json({ data: DETAIL[id] || [] });
  }
  return inspectionHandle(req, res) || transferHandle(req, res);
}

async function download(page, button, fmt) {
  await page.click(button);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`.nx-menu-item[data-format="${fmt}"]`)]);
  const file = path.join(os.tmpdir(), 'next-checks-' + dl.suggestedFilename());
  await dl.saveAs(file);
  return { name: dl.suggestedFilename(), file };
}
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth
  && [...document.querySelectorAll('.nx-content')].every((c) => c.scrollWidth <= c.clientWidth + 1));
// At phone width the shell's own top bar (.nx-top-end) runs past the edge on every screen (the base does it on
// Requests too), so there the check is this page: nothing of it past the edge, no sideways scroll in the content.
const pageFits = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s + ' *')].filter((el) => el.offsetParent !== null)
  .every((el) => el.getBoundingClientRect().right <= window.innerWidth + 1)
  && [...document.querySelectorAll('.nx-content')].every((c) => c.scrollWidth <= c.clientWidth + 1), sel);

(async () => {
  const env = await E.start({ port: 19330, handle, app: 'next' });
  const { page } = env;
  const shots = [];
  const ids = (sel) => page.$$eval(sel, (els) => els.map((e) => e.dataset.line).join(','));
  try {
    // ════ Inspections ══════════════════════════════════════════════════════════════════════════════════════
    T.section('inspections: the queue');
    await env.open('/?open=inspection');
    await page.waitForSelector('.nx-insp-unit', { timeout: 30000 });
    await page.waitForTimeout(400);
    T.eq('the tab is the Inspections screen, built in Next', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId + '=' + t.innerText.trim()), 'inspection=Inspections');
    T.eq('the summary', await env.text('#inspSummary'), '4 units to inspect · 2 leaving the yard · 1 back at the yard · 1 failed · 1 late');
    T.eq('asked for by the matrix, earliest needed first', await ids('.nx-insp-unit'), '9003,9001,9004,9002');
    T.eq('chips: everything, late, the four points, failed', await page.$$eval('.nx-chips[aria-label="Where the unit is"] .nx-chip', (c) => c.map((x) => x.dataset.value + ':' + x.querySelector('.nx-chip-count').textContent.trim()).join(' ')),
      'all:4 late:1 SHIP_OUT_YARD:2 RECEIVE_SITE:0 SHIP_OUT_SITE:0 RECEIVE_YARD:1 failed:1');
    const crane = await env.text('.nx-insp-unit[data-line="9001"]');
    T.check('a unit: what, where it goes, its request, asked for, how late', crane.includes('Mobile Crane 50t · MC-11') && crane.includes('Leaving the yard')
      && crane.includes('REQ-10505 · Pipeline North · Cranes') && crane.toLowerCase().includes('asked for') && crane.includes('2 days late'), crane);
    T.check('a failed unit says so', (await env.text('.nx-insp-unit[data-line="9004"]')).includes('Failed inspection'));
    await page.click('.nx-chip[data-value="late"]');
    await page.waitForTimeout(250);
    T.eq('Late', await ids('.nx-insp-unit'), '9001');
    await page.click('.nx-chip[data-value="failed"]');
    await page.waitForTimeout(250);
    T.eq('Failed, needs a decision', await ids('.nx-insp-unit'), '9004');
    await page.click('.nx-chip[data-value="all"]');
    await page.click('button[data-field="scope"][data-value="all"]');
    await page.waitForTimeout(250);
    T.eq('everything waiting adds the unit nobody asked for, after the ones asked for', await ids('.nx-insp-unit'), '9003,9001,9004,9002,9005');
    T.check('... marked optional', (await env.text('.nx-insp-unit[data-line="9005"]')).toLowerCase().includes('optional'));
    await page.fill('.nx-search input', 'tower');
    await page.waitForTimeout(250);
    T.eq('search', await ids('.nx-insp-unit'), '9003,9005');
    await page.fill('.nx-search input', '');
    await page.click('button[data-field="scope"][data-value="required"]');
    await page.waitForTimeout(250);
    shots.push(await env.shot('next-inspections-queue.png'));

    T.section('inspections: export the queue as shown');
    const csv = await download(page, '#inspExport', 'csv');
    const text = fs.readFileSync(csv.file, 'utf8');
    T.check('CSV file name', /^equiprite-inspections-\d{4}-\d{2}-\d{2}\.csv$/.test(csv.name), csv.name);
    T.eq('CSV: a header and the four units, in the queue order', text.split('\r\n').filter(Boolean).map((l) => l.split(',')[0]).join(' | '),
      '﻿Equipment | Light tower | Mobile Crane 50t | Plate compactor | Generator 100 kVA');
    T.check('CSV: the point in words, the stored status kept', text.includes('Leaving the yard') && text.includes('PICK_RELEASED') && text.includes('Failed inspection'));

    T.section('inspections: the whole checklist, one tap per question');
    await page.click('.nx-insp-unit[data-line="9001"]');
    await page.waitForSelector('.nx-insp-q', { timeout: 20000 });
    T.eq('the unit', await env.text('#inspUnitTitle'), 'Mobile Crane 50t · MC-11');
    T.eq('every question at once', await page.$$eval('.nx-insp-q', (q) => q.map((x) => x.dataset.item).join(',')), '701,702,703,704');
    const btn = await page.$eval('.nx-insp-ans', (b) => b.getBoundingClientRect().height);
    T.check('answer buttons are big enough for a glove (48px)', btn >= 48, String(btn));
    T.eq('nothing answered yet: not finished', await env.text('#inspVerdict'), 'Not finished');
    await page.click('.nx-insp-ans[data-item="701"][data-value="YES"]');
    await page.click('.nx-insp-ans[data-item="702"][data-value="FAIL"]');
    await page.waitForSelector('.nx-insp-q[data-item="702"] .nx-insp-fault');
    await page.fill('.nx-insp-q[data-item="702"] .nx-insp-note-in', 'Two broken wires near drum end');
    await page.dispatchEvent('.nx-insp-q[data-item="702"] .nx-insp-note-in', 'change');
    await page.click('.nx-insp-q[data-item="702"] .nx-insp-logbtn');
    await page.waitForSelector('.nx-insp-q[data-item="702"] .nx-insp-defect');
    T.eq('the defect is logged under its question, from the question and its note',
      await page.$eval('.nx-insp-q[data-item="702"] .nx-insp-defect input[data-field="description"]', (i) => i.value), 'Wire rope and hook: Two broken wires near drum end');
    T.eq('a required question\'s defect starts as major', await page.$eval('.nx-insp-q[data-item="702"] button[data-value="MAJOR"]', (b) => b.getAttribute('aria-pressed')), 'true');
    await page.fill('.nx-insp-q[data-item="703"] .nx-insp-num', '52');
    await page.dispatchEvent('.nx-insp-q[data-item="703"] .nx-insp-num', 'change');
    await page.click('.nx-insp-ans[data-item="704"][data-value="4"]');
    await page.waitForTimeout(250);
    T.eq('the result follows the answers and the defect', await env.text('#inspVerdict'), 'Fail: cannot ship');
    T.eq('progress', await env.text('#inspProgress'), '4 of 4 answered · 1 failed · score 75%');
    env.writes.length = 0;
    await page.click('#inspComplete');
    await page.waitForTimeout(400);
    T.check('a defect without its photo stops Complete, in words, and nothing is written',
      (await env.text('#inspBlocked')).includes('Photo of "Wire rope and hook: Two broken wires near drum end"') && env.writes.length === 0);
    await page.setInputFiles('.nx-insp-q[data-item="702"] .nx-insp-file', { name: 'wire-rope.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForSelector('.nx-insp-q[data-item="702"] .nx-insp-photo img');
    T.check('the photo shows on the defect', !!(await page.$('.nx-insp-q[data-item="702"] .nx-insp-photo img')));
    T.check('it says why', (await env.text('.nx-insp-reasons')).includes('Wire rope and hook: Fail') && (await env.text('.nx-insp-reasons')).includes('Major defect'));
    T.check('it says where the repair is raised', (await env.text('#inspFailNote')).includes('Oracle Maintenance'));
    T.eq('Complete says what it will write', await env.text('#inspWillDo'),
      'Saves the inspection with 4 answers and 1 defect with its photo, completed as Fail. The line is marked Failed inspection and cannot ship.');
    shots.push(await env.shot('next-inspections-checklist.png'));

    T.section('inspections: complete, FAIL: exactly New EquipRite\'s calls');
    env.writes.length = 0;
    await page.click('#inspComplete');
    await page.waitForSelector('.nx-insp-done', { timeout: 20000 });
    await page.waitForTimeout(400);
    T.eq('inspection, 4 answers, the defect, its photo, completed, the line',
      env.writes.map(short).join(' > '),
      'POST /inspections > POST /inspection-responses > POST /inspection-responses > POST /inspection-responses > POST /inspection-responses'
      + ' > POST /inspection-defects > POST /common/documents/v1 > PATCH /inspections/7001 > PATCH /equipment-requests/501/lines/batch');
    const w = env.writes;
    T.eq('the inspection: the line, the point, in progress', JSON.stringify([w[0].body.requestLineId, w[0].body.inspectionType, w[0].body.inspectionStatus]), '[9001,"SHIP_OUT_YARD","IN_PROGRESS"]');
    T.eq('the answers', w.slice(1, 5).map((x) => x.body.inspectionId + ':' + x.body.checklistId + '=' + x.body.responseValue + '/' + x.body.responseResult).join(','),
      '7001:701=YES/PASS,7001:702=FAIL/FAIL,7001:703=52/PASS,7001:704=4/PASS');
    T.eq('the note on the failed answer', w[2].body.notes, 'Two broken wires near drum end');
    T.eq('the defect', JSON.stringify(w[5].body),
      '{"inspectionId":7001,"checklistId":702,"defectDescription":"Wire rope and hook: Two broken wires near drum end","severity":"MAJOR","recommendedAction":"REPAIR","estimatedRepairCost":null,"defectStatus":"OPEN"}');
    T.check('the photo: a multipart upload on the defect', typeof w[6].body === 'string' && w[6].body.includes('"entity_type":"EQR_INSPECTION_DEFECT"')
      && w[6].body.includes('"entity_id":9101') && w[6].body.includes('wire-rope.png'));
    T.eq('completed FAIL', JSON.stringify([w[7].body.inspectionStatus, w[7].body.overallResult]), '["COMPLETED","FAIL"]');
    T.eq('the line is marked Inspection failed', JSON.stringify(w[8].body), '{"lines":[{"id":9001,"lineStatus":"INSPECTION_FAILED"}]}');
    T.check('the result is read back', env.calls.some((c) => /^GET \/equiprite\/v1\/inspections\?requestLineId=9001/.test(c)));
    T.check('the done card says what is stored', (await env.text('#inspDoneFacts')).includes('inspection 7001, recorded as Fail')
      && (await env.text('#inspDoneFacts')).includes('the line is now: Failed inspection'));
    const next = await env.text('#inspFailedNext');
    T.check('what happens to a failed unit: no shipping, repair in Oracle Maintenance, swap or cancel, inspect again',
      next.includes('It cannot ship') && next.includes('Oracle Maintenance') && next.includes('not connected yet') && next.includes('swap the unit')
      && next.includes('inspect it again'), next);
    T.eq('swap or cancel: the line in Old EquipRite', await page.getAttribute('#inspLineLink', 'href'),
      env.oldUrl + '/vp/shell/equipment-foundation/line-detail?requestId=501&requestNumber=REQ-10505&lineId=9001&equipmentMasterId=61');
    T.eq('the unit left the queue; the next one is offered', (await ids('.nx-insp-unit')) + ' / ' + (await env.text('.nx-insp-nextbtn')),
      '9003,9004,9002 / Inspect next: Light tower · LT-0207');
    shots.push(await env.shot('next-inspections-failed.png'));

    T.section('inspections: the next unit, back at the yard, passes (no line status)');
    await page.click('.nx-insp-nextbtn');
    await page.waitForSelector('.nx-insp-q[data-item="901"]', { timeout: 20000 });
    await page.click('.nx-insp-ans[data-item="901"][data-value="PASS"]');
    await page.waitForTimeout(200);
    T.eq('PASS at the yard receipt', await env.text('#inspVerdict'), 'Pass: received in good order');
    T.check('Complete says the receipt itself is elsewhere', (await env.text('#inspWillDo')).includes('The line status does not change here'));
    env.writes.length = 0;
    await page.click('#inspComplete');
    await page.waitForSelector('.nx-insp-done', { timeout: 20000 });
    await page.waitForTimeout(300);
    T.eq('the inspection and its answer, completed; the line is not touched', env.writes.map(short).join(' > '),
      'POST /inspections > POST /inspection-responses > PATCH /inspections/7002');
    T.check('the receipt itself: Receiving & returns', (await env.text('.nx-insp-done')).includes('The receipt itself is done in Receiving & returns'));

    T.section('inspections: the failed unit, repaired, is inspected again');
    await page.click('.nx-chip[data-value="failed"]');
    await page.waitForTimeout(250);
    await page.click('.nx-insp-unit[data-line="9004"]');
    await page.waitForSelector('.nx-insp-q[data-item="951"]', { timeout: 20000 });
    await page.waitForTimeout(200);
    T.check('it says it failed before, and when', (await env.text('.nx-insp-main')).includes('failed its last inspection')
      && (await env.text('.nx-insp-main')).includes('Already inspected here on'));
    await page.click('.nx-insp-ans[data-item="951"][data-value="PASS"]');
    env.writes.length = 0;
    await page.click('#inspComplete');
    await page.waitForSelector('.nx-insp-done', { timeout: 20000 });
    await page.waitForTimeout(300);
    T.eq('a pass clears it to ship', env.writes.map(short).join(' > ') + ' | ' + JSON.stringify(env.writes[env.writes.length - 1].body),
      'POST /inspections > POST /inspection-responses > PATCH /inspections/7003 > PATCH /equipment-requests/503/lines/batch | {"lines":[{"id":9004,"lineStatus":"EQP_INSPECTION_COMPLETE"}]}');

    T.section('inspections: a conditional result needs its acknowledgement');
    await page.click('.nx-chip[data-value="all"]');
    await page.waitForTimeout(250);
    await page.click('.nx-insp-unit[data-line="9002"]');
    await page.waitForSelector('.nx-insp-q[data-item="801"]', { timeout: 20000 });
    await page.click('.nx-insp-ans[data-item="801"][data-value="PASS"]');
    await page.click('.nx-insp-ans[data-item="802"][data-value="YES"]');
    await page.click('#inspAddOther');
    await page.waitForSelector('.nx-insp-other .nx-insp-defect');
    await page.fill('.nx-insp-other input[data-field="description"]', 'Scratched canopy');
    await page.dispatchEvent('.nx-insp-other input[data-field="description"]', 'change');
    await page.click('.nx-insp-other button[data-value="COSMETIC"]');
    await page.fill('.nx-insp-other input[data-field="cost"]', '$120');
    await page.dispatchEvent('.nx-insp-other input[data-field="cost"]', 'change');
    await page.setInputFiles('.nx-insp-other .nx-insp-file', { name: 'canopy.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForSelector('.nx-insp-other .nx-insp-photo img');
    T.eq('CONDITIONAL', await env.text('#inspVerdict'), 'Conditional: ships once acknowledged');
    env.writes.length = 0;
    await page.click('#inspComplete');
    await page.waitForTimeout(300);
    T.check('not without the acknowledgement, and nothing is written', (await env.text('#inspBlocked')).includes('Acknowledge the conditional result') && env.writes.length === 0);
    await page.check('.nx-insp-ack input');
    await page.fill('.nx-insp-notes', 'Canopy to be touched up at the next service');
    await page.dispatchEvent('.nx-insp-notes', 'change');
    await page.waitForTimeout(200);
    shots.push(await env.shot('next-inspections-conditional.png'));
    await page.click('#inspComplete');
    await page.waitForSelector('.nx-insp-done', { timeout: 20000 });
    await page.waitForTimeout(300);
    T.eq('answers, the cosmetic defect and its photo, completed, cleared to ship', env.writes.map(short).join(' > '),
      'POST /inspections > POST /inspection-responses > POST /inspection-responses > POST /inspection-defects > POST /common/documents/v1 > PATCH /inspections/7004 > PATCH /equipment-requests/501/lines/batch');
    const cw = env.writes;
    T.eq('the defect: cosmetic, its cost as a number, no question', JSON.stringify([cw[3].body.severity, cw[3].body.estimatedRepairCost, cw[3].body.checklistId]), '["COSMETIC",120,null]');
    T.check('the acknowledgement is recorded in the notes', /^Canopy to be touched up at the next service Conditional result acknowledged/.test(cw[5].body.notes) && cw[5].body.overallResult === 'CONDITIONAL');
    T.eq('... and the line is cleared to ship', cw[6].body.lines[0].lineStatus, 'EQP_INSPECTION_COMPLETE');
    T.eq('the queue is empty now', await env.text('.nx-insp-queue .nx-insp-empty'), 'Nothing needs an inspection right now. “Everything waiting” lists the rest.');
    T.check('no sideways scroll (desktop)', await noSideways(page));

    T.section('inspections: tablet and phone');
    await env.open('/?open=inspection');
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.waitForSelector('.nx-insp-unit', { timeout: 30000 });
    await page.click('.nx-insp-unit >> nth=0');
    await page.waitForSelector('.nx-insp-q', { timeout: 20000 });
    await page.waitForTimeout(300);
    T.check('portrait tablet: the checklist takes the width, the queue (and its chips) step aside', !(await page.isVisible('.nx-insp-queue'))
      && !(await page.isVisible('.nx-chips[aria-label="Where the unit is"]')) && await page.isVisible('#inspBack'));
    T.eq('before the sheet is finished, Complete says what is needed', await env.text('#inspWillDo'), 'Answer the required questions first; then this says what Complete will save.');
    T.check('portrait tablet: nothing runs off the side', await noSideways(page));
    shots.push(await env.shot('next-inspections-tablet.png'));
    await page.setViewportSize({ width: 390, height: 860 });
    await page.waitForTimeout(300);
    T.check('phone: nothing of the page runs off the side', await pageFits(page, '.nx-insp-page'));
    shots.push(await env.shot('next-inspections-phone.png'));
    await page.click('#inspBack');
    await page.waitForTimeout(300);
    T.check('back to the queue', await page.isVisible('.nx-insp-queue'));
    await page.setViewportSize({ width: 1440, height: 1000 });

    // ════ Transfers ════════════════════════════════════════════════════════════════════════════════════════
    T.section('transfers: every transfer order, where it is read from its equipment');
    env.writes.length = 0;
    await env.open('/?open=transfers');
    await page.waitForSelector('.nx-grid--trf .nx-row--click', { timeout: 30000 });
    await page.waitForFunction(() => !document.querySelector('#trfReading'), null, { timeout: 30000 });
    await page.waitForTimeout(400);
    const nums = () => page.$$eval('.nx-grid--trf .nx-row--click', (r) => r.map((x) => x.dataset.number).join(', '));
    T.eq('the tab', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId + '=' + t.innerText.trim()), 'transfers=Transfers');
    T.eq('the summary', await env.text('#trfSummary'), '7 transfers · 2 not left yet · 2 on the way · 3 late');
    T.eq('what is still open first, the most overdue first', await nums(),
      'EQR-TRF-REQ-10527-1, TO-310, TO-330, TO-320, TO-300, INV-TX 882104, TO-340');
    const row = (n) => env.text(`.nx-grid--trf .nx-row--click[data-number="${n}"]`);
    const r310 = await row('TO-310');
    T.check('a transfer: kind, request, from where to where, what is moving, where it is, how late',
      r310.includes('Out to site') && r310.includes('REQ-10505') && r310.includes('YARD1 · Houston yard') && r310.includes('TEXAS · Texas project sites')
      && r310.includes('Mobile Crane 50t · MC-11 +1') && r310.includes('Being picked at the yard') && r310.includes('1 arrived · 1 not left yet')
      && r310.includes('2 days late'), r310);
    T.check('stored PENDING, but its units are on site: it says Arrived', (await row('TO-300')).includes('Arrived on site')
      && (await page.$eval('.nx-row--click[data-number="TO-300"] .nx-pill', (e) => e.getAttribute('title'))) === 'Stored order status: PENDING');
    T.check('a return on its way back, late', (await row('TO-330')).includes('Back to the yard') && (await row('TO-330')).includes('On the way back to the yard')
      && (await row('TO-330')).includes('Due back at the yard') && (await row('TO-330')).includes('1 day late'));
    T.check('between projects: waiting for Fusion, never shown as moved', (await row('EQR-TRF-REQ-10527-1')).includes('Waiting for the inter-org transfer in Fusion')
      && (await row('EQR-TRF-REQ-10527-1')).includes('from REQ-10475 · Pipeline North') && (await row('EQR-TRF-REQ-10527-1')).includes('waiting 3 days for Fusion'));
    T.check('an inter-project transfer on record without its order is listed too', (await row('INV-TX 882104')).includes('Moved to the new project'));
    T.check('a cancelled order says so', (await row('TO-340')).includes('Cancelled'));
    T.eq('chips', await page.$$eval('.nx-chips[aria-label="Where it is"] .nx-chip', (c) => c.map((x) => x.dataset.value + ':' + x.querySelector('.nx-chip-count').textContent.trim()).join(' ')),
      'all:7 late:3 waiting:2 moving:2 arrived:2 stopped:0');
    await page.click('.nx-chip[data-value="late"]');
    await page.waitForTimeout(250);
    T.eq('Late', await nums(), 'EQR-TRF-REQ-10527-1, TO-310, TO-330');
    await page.click('.nx-chip[data-value="all"]');
    await page.click('.nx-trf-kinds button[data-value="back"]');
    await page.waitForTimeout(250);
    T.eq('kind: back to the yard', await nums(), 'TO-330');
    await page.click('.nx-trf-kinds button[data-value="all"]');
    await page.fill('.nx-search input', 'DT-1112');
    await page.waitForTimeout(250);
    T.eq('search finds a transfer by a serial on it', await nums(), 'TO-300');
    await page.fill('.nx-search input', '');
    await page.click('.nx-sort[data-key="number"]');
    await page.waitForTimeout(250);
    T.eq('sort by transfer', await nums(), 'EQR-TRF-REQ-10527-1, INV-TX 882104, TO-300, TO-310, TO-320, TO-330, TO-340');
    await page.click('.nx-sort[data-key="due"]');
    await page.waitForTimeout(250);
    T.eq('move equipment between projects: in New EquipRite (it writes a transfer order)', await page.getAttribute('#trfMoveInNew', 'href'),
      env.newUrl + '/vp/shell/operations/transfers');
    const toLineCalls = env.calls.filter((c) => /transfer-order-lines\?transferOrderId=/.test(c)).map((c) => c.split('=')[1]).sort().join(',');
    T.eq('the units are read for the open orders only (not the cancelled one; between projects from its history)', toLineCalls, '300,310,320,330');
    T.check('... with the orders, the history, the sites and the requests', ['/transfer-orders', '/transfer-history', '/inv-orgs?size=500']
      .every((x) => env.calls.some((c) => c === 'GET /equiprite/v1' + x)) && env.calls.some((c) => /request-detail-lines\?requestId=501/.test(c)));
    T.check('no sideways scroll (desktop)', await noSideways(page));
    shots.push(await env.shot('next-transfers-list.png'));

    T.section('transfers: export what is shown');
    const xl = await download(page, '#trfExport', 'xlsx');
    T.check('Excel file name', /^equiprite-transfers-\d{4}-\d{2}-\d{2}\.xlsx$/.test(xl.name), xl.name);
    let read = '';
    try {
      read = execFileSync('python3', ['-I', '-c', 'import sys, openpyxl\nws = openpyxl.load_workbook(sys.argv[1]).active\nrows = list(ws.iter_rows(values_only=True))\nprint(len(rows)); print(rows[0][:10]); print([r[0] for r in rows[1:]]); print([r for r in rows if r[0] == "TO-310"][0][7:13])', xl.file], { encoding: 'utf8' }).trim();
    } catch (e) { read = 'unavailable'; }
    if (read !== 'unavailable') {
      T.eq('the Excel rows: header + 7, the columns, a row in words', read.split('\n').join(' | '),
        "8 | ('Transfer', 'Kind', 'Request', 'Project or customer', 'From request', 'From', 'To', 'What is moving', 'Units', 'Where it is') | "
        + "['EQR-TRF-REQ-10527-1', 'TO-310', 'TO-330', 'TO-320', 'TO-300', 'INV-TX 882104', 'TO-340'] | "
        + "('Mobile Crane 50t · MC-11; Mobile Crane 50t · MC-07', 2, 'Being picked at the yard', '1 arrived · 1 not left yet', '" + day(-2) + "', 2)");
    } else {
      T.check('xlsx check skipped (python3 + openpyxl not available)', true);
    }
    await page.click('.nx-chip[data-value="late"]');
    await page.waitForTimeout(250);
    const tcsv = await download(page, '#trfExport', 'csv');
    const ttext = fs.readFileSync(tcsv.file, 'utf8');
    T.check('CSV exports only what the chip shows', ttext.split('\r\n').filter(Boolean).length === 4 && ttext.includes('TO-330') && !ttext.includes('TO-320'));
    await page.click('.nx-chip[data-value="all"]');
    await page.waitForTimeout(250);

    T.section('transfers: a transfer in its own tab');
    await page.click('.nx-row--click[data-number="TO-310"] .nx-trf-num');
    await page.waitForSelector('#trfPill:visible', { timeout: 20000 });
    await page.waitForTimeout(500);
    T.eq('it opens in a tab named after it', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId + '=' + t.innerText.trim()), 'transfer:310=TO-310');
    T.eq('where it is', await env.text('#trfPill:visible'), 'Being picked at the yard');
    T.eq('from where to where', (await env.text('#trfFrom:visible')) + ' → ' + (await env.text('#trfTo:visible')), 'YARD1 · Houston yard → TEXAS · Texas project sites');
    T.check('late, said in words', (await env.text('#trfLate:visible')).includes('Due on site') && (await env.text('#trfLate:visible')).includes('2 days late'));
    T.eq('each unit, where it is', await page.$$eval('.nx-grid--trfunits:visible .nx-row[data-line]', (r) => r.map((x) => x.dataset.line + ':' + x.querySelector('.nx-pill').innerText.trim()).join(' | ')),
      '9001:Being picked at the yard | 9006:Arrived on site');
    T.eq('release, ship or receive: in New EquipRite', await page.getAttribute('#trfInNew:visible', 'href'), env.newUrl + '/vp/shell/logistics/picking');
    shots.push(await env.shot('next-transfer-record.png'));
    await page.click('#trfOpenRequest:visible');
    await page.waitForTimeout(800);
    T.eq('its request opens in a tab of its own', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId), 'request:501');

    await page.click('.nx-tab-btn[data-id="transfers"]');
    await page.waitForTimeout(300);
    await page.click('.nx-row--click[data-number="EQR-TRF-REQ-10527-1"] .nx-trf-num');
    await page.waitForSelector('#trfFusion', { timeout: 20000 });
    await page.waitForTimeout(300);
    T.check('between projects: from one request to the other, waiting for Fusion, nothing faked',
      (await env.text('.nx-trf-way:visible')).includes('REQ-10475 · Pipeline North') && (await env.text('.nx-trf-way:visible')).includes('REQ-10527 · Plant Expansion B')
      && (await env.text('#trfFusion:visible')).includes('INT-18') && (await env.text('#trfPill:visible')) === 'Waiting for the inter-org transfer in Fusion');
    T.check('its history', (await env.text('.nx-grid--trfhist:visible')).includes('Dump Truck 30t · DT-1108') && (await env.text('.nx-grid--trfhist:visible')).includes('Pending'));
    T.eq('inter-project transfers: in New EquipRite', await page.getAttribute('#trfInNew:visible', 'href'), env.newUrl + '/vp/shell/operations/transfers');

    await page.click('.nx-tab-btn[data-id="transfers"]');
    await page.waitForTimeout(300);
    await page.click('.nx-row--click[data-number="INV-TX 882104"] .nx-trf-num');
    await page.waitForFunction(() => document.querySelector('.nx-tab--on') && document.querySelector('.nx-tab--on').dataset.tabId === 'transfer:880', null, { timeout: 20000 });
    await page.waitForTimeout(1200);
    T.check('a transfer with no order of its own is read from its history',
      (await env.text('.nx-tab--on')) === 'INV-TX 882104' && (await page.$$eval('#trfPill:visible', (p) => p.map((x) => x.innerText.trim()).join('|'))).includes('Moved to the new project'));
    T.eq('... its unit and its history once each', [await env.text('#trfUnitsTitle:visible'), await page.$$eval('.nx-grid--trfhist:visible .nx-row:not(.nx-row--head)', (r) => r.length)].join(' / '),
      'What is moving (1) / 1');
    T.check('... and no order was asked for', !env.calls.some((c) => /\/transfer-orders\/880/.test(c)));
    shots.push(await env.shot('next-transfer-between.png'));

    await page.click('.nx-tab-btn[data-id="transfers"]');
    await page.waitForTimeout(300);
    T.check('back on the list, as it was left', (await page.$$eval('.nx-grid--trf .nx-row--click', (r) => r.length)) === 7);
    await page.setViewportSize({ width: 390, height: 860 });
    await page.waitForTimeout(400);
    T.check('phone: the list as cards, nothing of the page off the side', await pageFits(page, '.nx-trf-page'));
    shots.push(await env.shot('next-transfers-phone.png'));
    await page.setViewportSize({ width: 1440, height: 1000 });
    T.eq('transfers read only', env.writes.length, 0);

    T.eq('no browser errors', env.errors.filter((e) => !e.startsWith('warning')).join('\n'), '');
    console.log('\nscreenshots:\n  ' + shots.join('\n  '));
  } catch (e) {
    T.check('run finished', false, e.message);
    await env.shot('next-checks-failed.png').catch(() => {});
    console.log(env.errors.join('\n'));
  } finally {
    await env.close();
    T.report();
  }
})();
