'use strict';
/*
 * EquipRite Next, Approve & allocate, in a real browser: the queue (most urgent first, late, chips, search, export),
 * a bulk approve, a request opened in the panel and decided line by line (send back with a reason, then approve),
 * auto-allocate of the suggested units, units picked by hand, the request in its own tab, a read-only role, a phone.
 * Every write is checked against what New EquipRite's chains send (endpoints, bodies, order).
 * Needs `npm run build`. Run: node tests/e2e/next-approvals.e2e.js (screenshots: the OS temp folder, equiprite-e2e/).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const iso = (n) => day(n) + 'T00:00:00Z';

// ── A small stateful backend: requests, lines, units and allocations that the writes change ─────────────────────
function world() {
  const REQ = {
    509: { requestNumber: 'REQ-509', status: 'SUBMITTED', origin: 'Internal', projectName: 'Plant Expansion B', taskName: '1.3 Foundations', requestorName: 'Sam Ortiz',
      requestorUserId: 77, start: -3, end: 20 },
    501: { requestNumber: 'REQ-501', status: 'SUBMITTED', origin: 'Internal', projectName: 'Pipeline North', taskName: '2.1 Trenching', requestorName: 'Priya Nair',
      requestorUserId: 71, start: 4, end: 30 },
    502: { requestNumber: 'REQ-502', status: 'SUBMITTED', origin: 'External', customerName: 'Gulf Coast Builders', requestorName: 'Dana Ruiz', requestorUserId: 72,
      start: 6, end: 60 },
    503: { requestNumber: 'REQ-503', status: 'IN_PROCESS', origin: 'Internal', projectName: 'Plant Expansion B', taskName: '4.2 Steel', requestorName: 'Sam Ortiz',
      requestorUserId: 77, start: 8, end: 22 },
    504: { requestNumber: 'REQ-504', status: 'IN_PROCESS', origin: 'Internal', projectName: 'Pipeline North', requestorName: 'Priya Nair', start: 2, end: 20 },
    505: { requestNumber: 'REQ-505', status: 'IN_PROCESS', origin: 'Internal', projectName: 'Refinery Turnaround', requestorName: 'Lee Chan', start: -10, end: 15 },
    506: { requestNumber: 'REQ-506', status: 'DRAFT', origin: 'Internal', projectName: 'Pipeline North', requestorName: 'Priya Nair', start: 12, end: 40 },
  };
  const serial = { isSerialControlled: 'Y', isLotControlled: 'N', isInventoryTracked: 'Y' };
  const L = (req, id, name, extra) => Object.assign({ req, lineId: id, equipmentName: name, className: 'Excavators', quantity: 1, lineStatus: 'SUBMITTED',
    availabilityStatus: 'AVAILABLE', billRate: 1400, priceUom: 'DAY', estimatedCost: 20000, equipmentMasterId: 11 }, serial, extra || {});
  const LINES = [
    L(509, 9091, 'Vibratory Roller', { className: 'Compaction', equipmentMasterId: 51, estimatedCost: 9800 }),
    L(509, 9092, 'Plate Compactor', { className: 'Compaction', equipmentMasterId: 52, estimatedCost: 1200, availabilityStatus: 'NOT AVAILABLE' }),
    L(501, 9011, 'CAT 320 Excavator', { estimatedCost: 38400 }),
    L(501, 9012, 'Dump Truck 30t', { className: 'Trucks', equipmentMasterId: 31, availabilityStatus: 'PARTIAL QUANTITY', estimatedCost: 41600 }),
    L(502, 9021, 'Generator 100 kVA', { className: 'Power', equipmentMasterId: 41, estimatedCost: 37200 }),
    L(503, 9031, 'CAT 320 Excavator', { lineStatus: 'IN_PROCESS', estimatedCost: 38400 }),
    L(503, 9032, 'Trench safety kit', { className: 'Safety', lineStatus: 'IN_PROCESS', quantity: 10, billRate: 75, estimatedCost: 1950, equipmentMasterId: 61,
      isSerialControlled: 'N', isLotControlled: 'N', isInventoryTracked: 'N' }),
    L(503, 9033, 'Traffic cones', { className: 'Safety', lineStatus: 'IN_PROCESS', quantity: 10, billRate: 2, estimatedCost: 300, equipmentMasterId: 62,
      isSerialControlled: 'N', isLotControlled: 'Y', isInventoryTracked: 'Y' }),
    L(504, 9041, 'Roller 10t', { lineStatus: 'ALLOCATED', allocated: 1 }),
    L(505, 9051, 'Light tower', { lineStatus: 'DEPLOYED', allocated: 1 }),
    L(506, 9061, 'Skid steer', { lineStatus: 'DRAFT' }),
  ];
  // Serial units of the CAT 320 (master 11), lots of the cones (master 62).
  const SERIALS = [
    { unitRefId: 701, unitNumber: 'EX-2201', invOrgId: 300, invOrgName: 'Houston Yard', busy: true },
    { unitRefId: 702, unitNumber: 'EX-2203', invOrgId: 300, invOrgName: 'Houston Yard' },
    { unitRefId: 703, unitNumber: 'EX-2210', invOrgId: 310, invOrgName: 'Dallas Yard' },
  ];
  const LOTS = { 801: { unitNumber: 'LOT-A', atr: 6, invOrgId: 300, invOrgName: 'Houston Yard' }, 802: { unitNumber: 'LOT-B', atr: 10, invOrgId: 310, invOrgName: 'Dallas Yard' } };
  const ALLOC = []; // { id, requestLineId, serialRefId | lotRefId, allocatedQty, allocationStatus }
  let nextAlloc = 8001;
  return { REQ, LINES, SERIALS, LOTS, ALLOC, newAlloc: () => nextAlloc++ };
}

function backend(W) {
  const line = (id) => W.LINES.find((l) => l.lineId === Number(id));
  const allocOf = (lineId) => W.ALLOC.filter((a) => a.requestLineId === Number(lineId) && a.allocationStatus !== 'RELEASED');
  const allocatedQty = (l) => (l.allocated || 0) + allocOf(l.lineId).reduce((s, a) => s + a.allocatedQty, 0);
  const allocStatus = (l) => (allocatedQty(l) >= l.quantity ? 'ALLOCATED' : (allocatedQty(l) ? 'PARTIAL' : 'PENDING'));
  const reqRow = (id) => {
    const r = W.REQ[id];
    return { eqrEquipmentRequestId: Number(id), requestNumber: r.requestNumber, status: r.status, startDate: day(r.start), endDate: day(r.end), projectName: r.projectName,
      taskName: r.taskName, customerName: r.customerName, requestorName: r.requestorName, requestOrigin: r.origin };
  };
  const detail = (l) => {
    const r = W.REQ[l.req];
    return { lineId: l.lineId, equipmentName: l.equipmentName, className: l.className, quantity: l.quantity, lineStatus: l.lineStatus,
      availabilityStatus: l.availabilityStatus, allocatedQty: allocatedQty(l), billRate: l.billRate, priceUom: l.priceUom, estimatedCost: l.estimatedCost,
      startDate: iso(r.start), endDate: iso(r.end), isSerialControlled: l.isSerialControlled, isLotControlled: l.isLotControlled, isInventoryTracked: l.isInventoryTracked,
      equipmentMasterId: l.equipmentMasterId, requestNumber: r.requestNumber, requestStatus: r.status, projectName: r.projectName, taskName: r.taskName,
      requestorName: r.requestorName, deploymentLocation: 'Gate 2', source: r.origin === 'External' ? 'EXTERNAL' : 'INTERNAL' };
  };
  return function handle(req, res) {
    const p = req.path.replace('/equiprite/v1', '');
    const q = req.query;
    let m;
    if (p === '/views/my-requests') return res.json({ data: Object.keys(W.REQ).map(reqRow) });
    if (p === '/views/my-request-lines') {
      return res.json({ data: W.LINES.map((l) => ({ requestNumber: W.REQ[l.req].requestNumber, lineNumber: W.LINES.filter((x) => x.req === l.req).indexOf(l) + 1,
        equipmentName: l.equipmentName, className: l.className, qty: l.quantity, lineStatus: l.lineStatus, allocationStatus: allocStatus(l) })) });
    }
    if (p === '/views/request-detail-lines') return res.json({ data: W.LINES.filter((l) => l.req === Number(q.get('requestId'))).map(detail) });
    if ((m = /^\/equipment-requests\/(\d+)$/.exec(p))) {
      const r = W.REQ[m[1]];
      if (req.method === 'PATCH') { r.status = req.json().status; return res.json({ id: Number(m[1]) }); }
      return res.json({ id: Number(m[1]), requestNumber: r.requestNumber, status: r.status, requestorName: r.requestorName, requestorUserId: r.requestorUserId,
        customerName: r.customerName, requestType: r.origin === 'External' ? 'EXTERNAL' : 'INTERNAL', attribute1: 'Gate 2' });
    }
    if ((m = /^\/equipment-requests\/(\d+)\/lines$/.exec(p))) {
      return res.json({ data: W.LINES.filter((l) => l.req === Number(m[1])).map((l) => ({ id: l.lineId, lineStatus: l.lineStatus, allocationStatus: allocStatus(l) })) });
    }
    if ((m = /^\/equipment-requests\/(\d+)\/lines\/batch$/.exec(p)) && req.method === 'PATCH') {
      const body = req.json();
      body.lines.forEach((u) => { const l = line(u.id); if (l) l.lineStatus = u.lineStatus; });
      return res.json({ data: body.lines });
    }
    if ((m = /^\/equipment-requests\/(\d+)\/lines\/(\d+)$/.exec(p)) && req.method === 'PATCH') {
      const l = line(m[2]);
      const body = req.json();
      if (body.lineStatus) l.lineStatus = body.lineStatus;
      return res.json({ id: l.lineId });
    }
    if (p === '/views/line-detail-units') {
      const l = line(q.get('lineId'));
      const r = W.REQ[l.req];
      const base = { lineId: l.lineId, requestNumber: r.requestNumber, requestStatus: r.status, source: r.origin === 'External' ? 'EXTERNAL' : 'INTERNAL', lineStatus: l.lineStatus,
        equipmentMasterId: l.equipmentMasterId, equipmentName: l.equipmentName, className: l.className, quantity: l.quantity, isSerialControlled: l.isSerialControlled,
        isLotControlled: l.isLotControlled, isInventoryTracked: l.isInventoryTracked, lineStartDate: day(r.start), lineEndDate: day(r.end), allocStatus: allocStatus(l) };
      if (l.equipmentMasterId === 11) {
        return res.json({ data: W.SERIALS.map((u) => {
          const mine = W.ALLOC.find((a) => a.serialRefId === u.unitRefId && a.requestLineId === l.lineId && a.allocationStatus !== 'RELEASED');
          const other = W.ALLOC.find((a) => a.serialRefId === u.unitRefId && a.requestLineId !== l.lineId && a.allocationStatus !== 'RELEASED');
          return Object.assign({}, base, { unitType: 'SERIAL', unitRefId: u.unitRefId, serialRefId: u.unitRefId, unitNumber: u.unitNumber, invOrgId: u.invOrgId,
            invOrgName: u.invOrgName, availabilityStatus: u.busy || other ? 'NOT AVAILABLE' : 'AVAILABLE' },
          mine ? { allocationId: mine.id, allocationStatus: 'ALLOCATED', allocatedQty: 1 } : {});
        }) });
      }
      if (l.equipmentMasterId === 62) {
        return res.json({ data: Object.keys(W.LOTS).map((k) => {
          const lot = W.LOTS[k];
          const mine = W.ALLOC.find((a) => a.lotRefId === Number(k) && a.requestLineId === l.lineId && a.allocationStatus !== 'RELEASED');
          return Object.assign({}, base, { unitType: 'LOT', unitRefId: Number(k), lotRefId: Number(k), unitNumber: lot.unitNumber, invOrgId: lot.invOrgId, invOrgName: lot.invOrgName,
            availableToReserve: lot.atr, uomCode: 'EA' }, mine ? { allocationId: mine.id, allocationStatus: 'ALLOCATED', allocatedQty: mine.allocatedQty } : {});
        }) });
      }
      return res.json({ data: [] });
    }
    if (p === '/views/line-detail-bookings') {
      return res.json({ data: [{ unitRefId: 701, bookingRequestNumber: 'REQ-482', bookingStartDate: day(-10), bookingEndDate: day(12), projectName: 'Pipeline North' }] });
    }
    if (p === '/transfer-orders') return res.json({ data: [] });
    if (p === '/allocations' && req.method === 'POST') {
      const b = req.json();
      const a = { id: W.newAlloc(), requestLineId: b.requestLineId, serialRefId: b.serialRefId, lotRefId: b.lotRefId, allocatedQty: b.allocatedQty, allocationStatus: 'ALLOCATED' };
      W.ALLOC.push(a);
      return res.json({ id: a.id }, 201);
    }
    if (p === '/allocations') return res.json({ data: allocOf(q.get('requestLineId')).map((a) => Object.assign({}, a)) });
    if ((m = /^\/serial-refs\/(\d+)$/.exec(p))) return res.json({ id: Number(m[1]) });
    if ((m = /^\/lot-refs\/(\d+)$/.exec(p))) {
      const lot = W.LOTS[m[1]];
      if (req.method === 'PATCH') { lot.atr = req.json().availableToReserve; return res.json({ id: Number(m[1]) }); }
      return res.json({ id: Number(m[1]), availableToReserve: lot.atr });
    }
    if (p === '/notifications' && req.method === 'POST') return res.json({ id: 1 }, 201);
    return undefined;
  };
}

const W2 = (env) => env.writes.map((w) => w.method + ' ' + w.path.replace('/equiprite/v1', ''));
/** Elements of the screen reaching past the window's right edge and not inside a scroller that fits. */
const sticksOut = (page) => page.evaluate(() => {
  const w = window.innerWidth;
  const out = [];
  document.querySelectorAll('.nx-approvals *').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || r.right <= w + 1) return;
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (/(auto|scroll|hidden)/.test(getComputedStyle(p).overflowX) && p.getBoundingClientRect().right <= w + 1) return;
    }
    out.push((el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0]) + '@' + Math.round(r.right));
  });
  return out.slice(0, 8);
});
const queueOrder = (page) => page.$$eval('.nx-ap-q', (r) => r.map((x) => x.dataset.number).join(','));
const settle = (page, ms) => page.waitForTimeout(ms || 400);
async function waitIdle(page) {
  await page.waitForFunction(() => !document.querySelector('.nx-ap-spin'), null, { timeout: 30000 });
  await settle(page, 300);
}

(async () => {
  const W = world();
  let env = await E.start({ port: 19310, handle: backend(W), app: 'next' });
  let page = env.page;
  try {
    T.section('the queue: what waits on the Equipment Manager, most urgent first');
    await env.open('/?open=approvals');
    await page.waitForSelector('.nx-ap-q', { timeout: 30000 });
    await settle(page, 600);
    T.eq('the tab is open and named', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId + '=' + t.innerText.trim()), 'approvals=Approve & allocate');
    T.eq('nothing is written on opening', env.writes.length, 0);
    T.eq('the summary', await env.text('#apSummary'), '3 requests to decide · 1 request with units to assign · 1 late');
    T.eq('most urgent first: the late one, then by start date (no draft, nothing allocated, nothing on site)', await queueOrder(page), 'REQ-509,REQ-501,REQ-502,REQ-503');
    const q509 = await env.text('.nx-ap-q[data-number="REQ-509"]');
    T.check('a late request says how late, and why', q509.includes('3 days late') && q509.includes('2 not shipped, due'), q509);
    T.check('a request to decide: what and how many', q509.includes('To decide') && q509.includes('2 lines waiting for your decision'), q509);
    const q503 = await env.text('.nx-ap-q[data-number="REQ-503"]');
    T.check('an approved request: lines with no unit yet, in words', q503.includes('Units to assign') && q503.includes('3 lines approved, no unit assigned yet')
      && q503.includes('Starts in 8 days'), q503);
    T.check('a customer request names its customer', (await env.text('.nx-ap-q[data-number="REQ-502"]')).includes('Customer') && (await env.text('.nx-ap-q[data-number="REQ-502"]')).includes('Gulf Coast Builders'));
    T.eq('chips', await page.$$eval('.nx-chips[aria-label="Waiting for"] .nx-chip', (c) => c.map((x) => x.dataset.value + ':' + x.querySelector('.nx-chip-count').innerText).join(' ')),
      'all:4 late:1 decide:3 allocate:1');
    T.check('the panel asks for a request', (await env.text('#apPanel')).includes('Pick a request from the queue'));
    await env.shot('next-approvals-queue.png');

    await page.click('.nx-chip[data-value="allocate"]');
    await settle(page);
    T.eq('Units to assign', await queueOrder(page), 'REQ-503');
    await page.click('.nx-chip[data-value="all"]');
    await page.fill('.nx-search input', 'generator');
    await settle(page);
    T.eq('the search finds a request by its equipment', await queueOrder(page), 'REQ-502');
    await page.fill('.nx-search input', '');
    await page.click('.nx-chip[data-value="EXTERNAL"]');
    await settle(page);
    T.eq('customer requests only', await queueOrder(page), 'REQ-502');
    await page.click('.nx-chip[data-value="EXTERNAL"]');
    await settle(page);

    T.section('export what is shown');
    await page.click('#apExport');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.nx-menu-item[data-format="csv"]')]);
    const csvFile = path.join(os.tmpdir(), 'next-' + dl.suggestedFilename());
    await dl.saveAs(csvFile);
    const csv = fs.readFileSync(csvFile, 'utf8').split('\r\n').filter(Boolean);
    T.check('CSV: a row per request, in the queue order, with what it waits for', csv.length === 5 && /^﻿Request,Type,Project or customer/.test(csv[0])
      && csv[1].startsWith('REQ-509,Project,Plant Expansion B') && csv[1].includes('To decide') && csv[1].includes('3 days late'), csv.slice(0, 2).join(' | '));

    T.section('bulk: approve two requests, as New EquipRite does, request by request');
    await page.check('.nx-ap-q[data-number="REQ-501"] input[type="checkbox"]');
    await page.check('.nx-ap-q[data-number="REQ-502"] input[type="checkbox"]');
    await settle(page);
    T.eq('ticking opens nothing', await page.$('.nx-ap-rec-head'), null);
    T.check('the bar says what the ticked requests add up to', (await env.text('#apBulk')).includes('2 requests ticked · 1 project, 1 customer · 3 lines'), await env.text('#apBulk'));
    T.eq('the buttons say what they do', [await env.text('#apBulkApprove'), await env.text('#apBulkAskReject')].join(' | '), 'Approve 2 requests | Send back 2 requests…');
    const before = env.calls.length;
    await page.click('#apBulkApprove');
    await page.waitForSelector('#apBulkResult', { timeout: 30000 });
    await waitIdle(page);
    T.eq('writes: the lines then the header, for each request', W2(env).join(' > '),
      'PATCH /equipment-requests/501/lines/batch > PATCH /equipment-requests/501 > PATCH /equipment-requests/502/lines/batch > PATCH /equipment-requests/502');
    T.eq('the lines move to IN_PROCESS', JSON.stringify(env.writes[0].body), '{"lines":[{"id":9011,"lineStatus":"IN_PROCESS"},{"id":9012,"lineStatus":"IN_PROCESS"}]}');
    T.eq('the header moves to IN_PROCESS', JSON.stringify(env.writes[1].body), '{"status":"IN_PROCESS"}');
    const bulkCalls = env.calls.slice(before).map((c) => c.replace('/equiprite/v1', '').split('?')[0] + (c.includes('requestId=') ? '?' + /requestId=(\d+)/.exec(c)[1] : ''));
    T.eq('each request: its lines, then their allocation, then the writes (New: bulkDecideChain)', bulkCalls.slice(0, 4).join(' > '),
      'GET /views/request-detail-lines?501 > GET /equipment-requests/501/lines > PATCH /equipment-requests/501/lines/batch > PATCH /equipment-requests/501');
    T.check('the result names both requests in words', (await env.text('#apBulkResult')).includes('2 of 2 requests approved')
      && (await env.text('#apBulkResult')).includes('REQ-501 Approved 2 lines on REQ-501. Every line is decided: the request moves on to unit assignment.'), await env.text('#apBulkResult'));
    T.eq('read back: both now wait for units', await page.$$eval('.nx-ap-q--allocate', (r) => r.map((x) => x.dataset.number).join(',')), 'REQ-501,REQ-502,REQ-503');
    T.eq('the queue was read again from the server', env.calls.slice(before).filter((c) => c.includes('/views/my-requests')).length >= 1, true);

    T.section('a request in the panel: send back one line with a reason, then approve the rest');
    env.writes.length = 0;
    await page.click('.nx-ap-q[data-number="REQ-509"] .nx-ap-q-main');
    await page.waitForSelector('#apDecide', { timeout: 30000 });
    await settle(page);
    T.eq('the panel heading', await env.text('#apRecTitle'), 'REQ-509 Waiting for approval');
    T.check('what is next, and what is not available', (await env.text('#apVerdict')).includes('Waiting for your decision: 2 of 2 lines')
      && (await env.text('#apVerdict')).includes('Line 2 (Plate Compactor) is not available for its dates'), await env.text('#apVerdict'));
    T.check('each line: availability and status in words; units wait for approval', (await env.text('.nx-ap-line[data-line="9092"]')).includes('Not available')
      && (await env.text('.nx-ap-line[data-line="9091"]')).includes('Waiting for approval')
      && (await env.text('.nx-ap-line[data-line="9091"]')).includes('Units can be assigned once the request is approved'));
    T.eq('Approve says what it will do', await env.text('#apApprove'), 'Approve all 2 lines');
    T.check('…and what follows', (await env.text('#apApproveNote')).includes('Every line is then decided, so the request moves on to unit assignment'));
    await page.check('.nx-ap-line[data-line="9092"] input[type="checkbox"]');
    await settle(page, 200);
    T.eq('one line ticked: the buttons act on it only', [await env.text('#apApprove'), await env.text('#apAskReject')].join(' | '), 'Approve 1 line | Send back 1 line…');
    T.check('approving only it would keep the request waiting', (await env.text('#apApproveNote')).includes('The request keeps waiting for 1 line still to decide'));
    await page.click('#apAskReject');
    await page.waitForSelector('#apReject');
    T.check('send back says what it will do, to whom', (await env.text('#apRejectNote')).includes('1 line will go back to Sam Ortiz with your reason')
      && (await env.text('#apRejectNote')).includes('The rest of the request stays open'), await env.text('#apRejectNote'));
    await page.click('#apConfirmReject');
    await settle(page, 300);
    T.check('no reason, nothing sent', (await env.text('#apReject')).includes('Write the reason first') && env.writes.length === 0);
    await page.fill('#apReason', 'The compactor is booked for the shutdown; ask for the 400 kg model instead.');
    await page.click('#apConfirmReject');
    await page.waitForSelector('#apResult', { timeout: 30000 });
    await waitIdle(page);
    T.eq('writes: the line, then the reason to the requester', W2(env).join(' > '), 'PATCH /equipment-requests/509/lines/batch > POST /notifications');
    T.eq('the line is sent back (REJECTED); the request stays open', JSON.stringify(env.writes[0].body), '{"lines":[{"id":9092,"lineStatus":"REJECTED"}]}');
    T.eq('the reason, to the requester', JSON.stringify(env.writes[1].body),
      '{"userId":77,"requestId":509,"requestNumber":"REQ-509","subject":"REQ-509: 1 line was sent back","message":"The compactor is booked for the shutdown; ask for the 400 kg model instead."}');
    T.eq('the result in words', await env.text('#apResult'), 'Sent back 1 line on REQ-509. Your reason was sent to Sam Ortiz.');
    T.check('read back: the line reads Sent back', (await env.text('.nx-ap-line[data-line="9092"]')).includes('Sent back'));
    T.eq('the rest can be approved', await env.text('#apApprove'), 'Approve the line');
    env.writes.length = 0;
    await page.click('#apApprove');
    await page.waitForFunction(() => /Approved 1 line/.test((document.querySelector('#apResult') || {}).innerText || ''), null, { timeout: 30000 });
    await waitIdle(page);
    T.eq('writes: the line, then the header, every line being decided (New: confirmRequestChain)', W2(env).join(' > '),
      'PATCH /equipment-requests/509/lines/batch > PATCH /equipment-requests/509');
    T.eq('bodies', JSON.stringify(env.writes.map((w) => w.body)), '[{"lines":[{"id":9091,"lineStatus":"IN_PROCESS"}]},{"status":"IN_PROCESS"}]');
    T.eq('the result in words', await env.text('#apResult'), 'Approved 1 line on REQ-509. Every line is decided: the request moves on to unit assignment.');
    T.check('read back: the decision buttons are gone, units can be assigned', !(await page.$('#apDecide')) && !!(await page.$('#apAuto')));
    T.check('the queue shows it waiting for units', (await env.text('.nx-ap-q[data-number="REQ-509"]')).includes('Units to assign'));

    T.section('auto-allocate: the suggested units of every line, as New saves each line');
    env.writes.length = 0;
    await page.click('.nx-ap-q[data-number="REQ-503"] .nx-ap-q-main');
    await page.waitForSelector('#apAskAuto:not([disabled])', { timeout: 30000 });
    await settle(page);
    T.check('suggested for the serial line: the free unit, not the booked one', (await env.text('.nx-ap-line[data-line="9031"]')).includes('Suggested: EX-2203 (Houston Yard)'),
      await env.text('.nx-ap-line[data-line="9031"]'));
    T.check('suggested for the lot line: from the lots in turn, up to its quantity',
      (await env.text('.nx-ap-line[data-line="9033"]')).includes('Suggested: 6 from LOT-A (Houston Yard) and 4 from LOT-B (Dallas Yard)'), await env.text('.nx-ap-line[data-line="9033"]'));
    T.check('free stock takes no unit', (await env.text('.nx-ap-line[data-line="9032"]')).includes('No unit needed') && (await env.text('.nx-ap-line[data-line="9032"]')).includes('Free stock'));
    T.eq('the verdict: what still needs units', await env.text('#apVerdict'),
      '0 of 2 lines have their units. Line 1 (CAT 320 Excavator) and line 3 (Traffic cones) still need units: assign them here, or leave them for the yard to pick on the Oracle mobile app.');
    T.eq('suggesting writes nothing', env.writes.length, 0);
    await page.click('#apAskAuto');
    await page.waitForSelector('#apAutoConfirm');
    T.check('it says what it will assign before it does', (await env.text('#apAutoConfirm')).includes('Line 1 · CAT 320 Excavator: EX-2203 (Houston Yard)')
      && (await env.text('#apAutoConfirm')).includes('Line 3 · Traffic cones: 6 from LOT-A (Houston Yard) and 4 from LOT-B (Dallas Yard)'), await env.text('#apAutoConfirm'));
    T.eq('the confirm button', await env.text('#apConfirmAuto'), 'Assign the suggested units to 2 lines');
    const autoBefore = env.calls.length;
    await page.click('#apConfirmAuto');
    await page.waitForFunction(() => /Auto-allocate assigned/.test((document.querySelector('#apResult') || {}).innerText || ''), null, { timeout: 30000 });
    await waitIdle(page);
    T.eq('writes, line by line (New: saveAllocationChain)', W2(env).join(' > '),
      'POST /allocations > PATCH /serial-refs/702 > PATCH /equipment-requests/503/lines/9031 > POST /allocations > PATCH /lot-refs/801 > POST /allocations > PATCH /lot-refs/802 > PATCH /equipment-requests/503/lines/9033');
    const posts = env.writes.filter((w) => w.path.endsWith('/allocations')).map((w) => w.body);
    T.check('the serial allocation: line, unit, quantity, status, date, its yard', posts[0].requestLineId === 9031 && posts[0].serialRefId === 702 && posts[0].allocatedQty === 1
      && posts[0].allocationStatus === 'ALLOCATED' && /^\d{4}-\d{2}-\d{2}T/.test(posts[0].allocatedDate) && posts[0].eqpInvOrgId === 300 && posts[0].eqpInvOrgName === 'Houston Yard', JSON.stringify(posts[0]));
    T.check('the lot allocations: each lot and its quantity', posts[1].lotRefId === 801 && posts[1].allocatedQty === 6 && posts[2].lotRefId === 802 && posts[2].allocatedQty === 4, JSON.stringify(posts.slice(1)));
    T.eq('the unit is out on rent', JSON.stringify(env.writes[1].body), '{"unitStatus":"RENTED"}');
    T.eq('what is free of each lot goes down', JSON.stringify(env.writes.filter((w) => w.path.includes('/lot-refs/')).map((w) => w.body)), '[{"availableToReserve":0},{"availableToReserve":6}]');
    T.eq('each line is allocated', JSON.stringify(env.writes.filter((w) => /\/lines\/\d+$/.test(w.path)).map((w) => w.body)),
      '[{"allocationStatus":"ALLOCATED","lineStatus":"ALLOCATED"},{"allocationStatus":"ALLOCATED","lineStatus":"ALLOCATED"}]');
    const autoCalls = env.calls.slice(autoBefore).map((c) => c.replace('/equiprite/v1', '').split('?')[0]);
    T.eq('the gate and the stale check are read before the first write', autoCalls.slice(0, 3).join(' > '), 'GET /transfer-orders > GET /allocations > POST /allocations');
    T.check('the result names each line', (await env.text('#apResult')).includes('Line 1 (CAT 320 Excavator): assign EX-2203 (Houston Yard). It has all its units.'), await env.text('#apResult'));
    T.check('read back: the lines have their units, the request is ready for picking', (await env.text('.nx-ap-line[data-line="9031"]')).includes('Unit assigned')
      && (await env.text('#apVerdict')).includes('Every line has its units'), await env.text('#apVerdict'));
    T.eq('picking is a Fusion step: it links to New EquipRite', await page.getAttribute('#apPickingLink', 'href'), env.newUrl + '/vp/shell/logistics/picking');
    T.check('nothing left to assign: REQ-503 leaves the queue, its panel stays', !(await page.$('.nx-ap-q[data-number="REQ-503"]')) && (await env.text('#apRecTitle')).startsWith('REQ-503'));
    await env.shot('next-approvals-auto.png');

    T.section('units by hand: the picker under a line');
    await page.click('.nx-ap-q[data-number="REQ-501"] .nx-ap-q-main');
    await page.waitForSelector('.nx-ap-line[data-line="9011"] button[data-line="9011"]', { timeout: 30000 });
    await waitIdle(page);
    env.writes.length = 0;
    await page.click('button[data-line="9011"]');
    await page.waitForSelector('.nx-ap-unit[data-unit="EX-2210"]', { timeout: 20000 });
    await settle(page);
    T.check('a unit booked over these dates shows the clash', (await env.text('.nx-ap-unit[data-unit="EX-2201"]')).includes('Clash'));
    T.eq('the clash is drawn on its schedule', await page.$$eval('.nx-ap-unit[data-unit="EX-2201"] .nx-ap-bar--conflict', (b) => b.length), 1);
    T.check('a unit given to another request is no longer free', (await env.text('.nx-ap-unit[data-unit="EX-2203"]')).includes('Booked elsewhere'));
    T.eq('nothing staged: Save is off', await page.$eval('#apSaveUnits', (b) => b.disabled), true);
    await page.click('.nx-ap-unit[data-unit="EX-2210"] button[data-action="assign"]');
    await settle(page, 200);
    T.eq('Save says what it will do', await env.text('#apPickerPlan'), 'Saving will: Assign EX-2210 (Dallas Yard). The line will have 1 of 1 unit.');
    T.check('staged only: nothing written', env.writes.length === 0 && (await env.text('.nx-ap-unit[data-unit="EX-2210"]')).includes('Assign on save'));
    await page.click('#apSaveUnits');
    await page.waitForFunction(() => /Line 1 \(CAT 320 Excavator\): assign EX-2210/.test((document.querySelector('#apResult') || {}).innerText || ''), null, { timeout: 30000 });
    await waitIdle(page);
    T.eq('writes: allocation, unit, line', W2(env).join(' > '), 'POST /allocations > PATCH /serial-refs/703 > PATCH /equipment-requests/501/lines/9011');
    T.check('read back: the picker shows the unit assigned', (await env.text('.nx-ap-unit[data-unit="EX-2210"]')).includes('Assigned'));
    await env.shot('next-approvals-picker.png');

    T.section('the request in its own tab');
    await page.click('#apOpenRecord');
    await page.waitForSelector('.nx-record-title', { timeout: 20000 });
    await settle(page, 500);
    T.eq('it opens in a tab of its own', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId), 'request:501');
    await page.click('.nx-tab-btn[data-id="approvals"]');
    await settle(page);
    T.check('back on the queue, as it was left', (await page.isVisible('#apRecTitle')) && (await env.text('#apRecTitle')).startsWith('REQ-501'));
    T.check('no sideways scroll on the page', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));

    T.section('a phone');
    await page.setViewportSize({ width: 390, height: 900 });
    await settle(page, 400);
    // The shell's top bar (Old / New / Next, the bell, the user) is wider than a phone on every screen; this screen's
    // own content must fit, a wide grid scrolling inside its card.
    T.eq('nothing of this screen sticks out sideways at 390px', (await sticksOut(page)).join(', '), '');
    T.check('the open request fills the screen, with the way back', (await page.isVisible('.nx-ap-back')) && !(await page.isVisible('.nx-ap-queue')));
    await env.shot('next-approvals-phone.png');
    await page.click('.nx-ap-back');
    await settle(page);
    T.check('back to the queue', (await page.isVisible('.nx-ap-queue')) && !(await page.isVisible('#apPanel')));
    T.eq('…which fits too', (await sticksOut(page)).join(', '), '');
    await env.shot('next-approvals-phone-queue.png');
    await page.setViewportSize({ width: 1440, height: 1000 });

    T.eq('no browser errors', env.errors.filter((e) => !e.startsWith('warning')).join('\n'), '');
    if (process.env.E2E_DEBUG) console.log(env.errors.join('\n'));
  } catch (e) {
    T.check('run finished', false, e.message);
    await env.shot('next-approvals-failed.png').catch(() => {});
  } finally {
    await env.close();
  }

  // ── A role with read-only access: the queue, no decisions ──────────────────────────────────────────────────
  try {
    const access = Object.fromEntries(E.ALL_CODES.map((c) => [c, 'FULL']));
    access.EQR_WORKBENCH = 'READ_ONLY';
    env = await E.start({ port: 19310, handle: backend(world()), app: 'next', access });
    page = env.page;
    T.section('read only (EQR_WORKBENCH READ_ONLY)');
    await env.open('/?open=approvals');
    await page.waitForSelector('.nx-ap-q', { timeout: 30000 });
    await settle(page, 500);
    T.check('it says so', (await env.text('.nx-approvals')).includes('Approving, sending back and assigning units need full access'));
    T.eq('no tick boxes', (await page.$$('.nx-ap-q input[type="checkbox"]')).length, 0);
    await page.click('.nx-ap-q[data-number="REQ-509"] .nx-ap-q-main');
    await page.waitForSelector('#apRecTitle', { timeout: 30000 });
    await settle(page);
    T.check('the request can be read, not decided', !(await page.$('#apDecide')) && !(await page.$('#apApprove')));
    T.eq('nothing written', env.writes.length, 0);
    T.eq('no browser errors', env.errors.filter((e) => !e.startsWith('warning')).join('\n'), '');
  } catch (e) {
    T.check('read-only run finished', false, e.message);
    await env.shot('next-approvals-readonly-failed.png').catch(() => {});
  } finally {
    await env.close();
    T.report();
  }
})();
