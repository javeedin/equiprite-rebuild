'use strict';
/*
 * EquipRite Mobile, the Approve tab, in a phone-sized browser (390 x 844, touch): the queue (most urgent first, chips
 * with counts, search, the tab's count), a request in words, sending back one line with a quick reason, approving the
 * rest, "next up" to clear the queue, assigning units (one line changed by hand, then the suggestions accepted in one
 * tap), a request handed over by My requests and by a deep link, and no connection (the saved queue, nothing sent).
 * Every write is checked (method, path, body) against what Next's Approve & allocate sends for the same steps.
 * Needs `npm run build`. Run: node tests/e2e/mobile-approve.e2e.js (screenshots: the OS temp folder, equiprite-e2e/).
 */
const os = require('os');
const path = require('path');
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const iso = (n) => day(n) + 'T00:00:00Z';

// ── A small stateful backend (Next's Approve & allocate e2e world): requests, lines, units, allocations ──────────────
function world() {
  const REQ = {
    509: { requestNumber: 'REQ-509', status: 'SUBMITTED', origin: 'Internal', projectName: 'Plant Expansion B', taskName: '1.3 Foundations', requestorName: 'Sam Ortiz',
      requestorUserId: 77, start: -3, end: 20, created: -6 },
    501: { requestNumber: 'REQ-501', status: 'SUBMITTED', origin: 'Internal', projectName: 'Pipeline North', taskName: '2.1 Trenching', requestorName: 'Priya Nair',
      requestorUserId: 71, start: 4, end: 30, created: -2 },
    502: { requestNumber: 'REQ-502', status: 'SUBMITTED', origin: 'External', customerName: 'Gulf Coast Builders', requestorName: 'Dana Ruiz', requestorUserId: 72,
      start: 6, end: 60, created: -1 },
    503: { requestNumber: 'REQ-503', status: 'IN_PROCESS', origin: 'Internal', projectName: 'Plant Expansion B', taskName: '4.2 Steel', requestorName: 'Sam Ortiz',
      requestorUserId: 77, start: 8, end: 22, created: -9 },
    504: { requestNumber: 'REQ-504', status: 'IN_PROCESS', origin: 'Internal', projectName: 'Pipeline North', requestorName: 'Priya Nair', start: 2, end: 20, created: -12 },
    505: { requestNumber: 'REQ-505', status: 'IN_PROCESS', origin: 'Internal', projectName: 'Refinery Turnaround', requestorName: 'Lee Chan', start: -10, end: 15, created: -20 },
    506: { requestNumber: 'REQ-506', status: 'DRAFT', origin: 'Internal', projectName: 'Pipeline North', requestorName: 'Priya Nair', start: 12, end: 40, created: 0 },
  };
  const serial = { isSerialControlled: 'Y', isLotControlled: 'N', isInventoryTracked: 'Y' };
  const L = (req, id, name, extra) => Object.assign({ req, lineId: id, equipmentName: name, className: 'Excavators', quantity: 1, lineStatus: 'SUBMITTED',
    availabilityStatus: 'AVAILABLE', billRate: 1400, priceUom: 'DAY', estimatedCost: 20000, equipmentMasterId: 11 }, serial, extra || {});
  const LINES = [
    L(509, 9091, 'Vibratory Roller', { className: 'Compaction', equipmentMasterId: 51, estimatedCost: 9800 }),
    L(509, 9092, 'Plate Compactor', { className: 'Compaction', equipmentMasterId: 52, estimatedCost: 1200, billRate: 120, availabilityStatus: 'NOT AVAILABLE' }),
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
  const ALLOC = [];
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
      taskName: r.taskName, customerName: r.customerName, requestorName: r.requestorName, requestOrigin: r.origin, createdDate: iso(r.created) };
  };
  const detail = (l) => {
    const r = W.REQ[l.req];
    return { lineId: l.lineId, equipmentName: l.equipmentName, className: l.className, quantity: l.quantity, lineStatus: l.lineStatus,
      availabilityStatus: l.availabilityStatus, allocatedQty: allocatedQty(l), billRate: l.billRate, priceUom: l.priceUom, estimatedCost: l.estimatedCost,
      startDate: iso(r.start), endDate: iso(r.end), isSerialControlled: l.isSerialControlled, isLotControlled: l.isLotControlled, isInventoryTracked: l.isInventoryTracked,
      equipmentMasterId: l.equipmentMasterId, requestNumber: r.requestNumber, requestStatus: r.status, projectName: r.projectName, taskName: r.taskName,
      requestorName: r.requestorName, deploymentLocation: 'Gate 2, 1200 Pipeline Rd', source: r.origin === 'External' ? 'EXTERNAL' : 'INTERNAL' };
  };
  return function handle(req, res) {
    const p = req.path.replace('/equiprite/v1', '');
    const q = req.query;
    let m;
    if (p === '/views/my-requests') return res.json({ data: Object.keys(W.REQ).map(reqRow) });
    if (p === '/views/my-request-lines') {
      return res.json({ data: W.LINES.map((l) => ({ requestNumber: W.REQ[l.req].requestNumber, lineId: l.lineId, lineNumber: W.LINES.filter((x) => x.req === l.req).indexOf(l) + 1,
        equipmentName: l.equipmentName, className: l.className, qty: l.quantity, lineStatus: l.lineStatus, allocationStatus: allocStatus(l) })) });
    }
    if (p === '/views/request-detail-lines') return res.json({ data: W.LINES.filter((l) => l.req === Number(q.get('requestId'))).map(detail) });
    if (p === '/request-status-history') return res.json({ data: [] });
    if ((m = /^\/equipment-requests\/(\d+)$/.exec(p))) {
      const r = W.REQ[m[1]];
      if (req.method === 'PATCH') { r.status = req.json().status; return res.json({ id: Number(m[1]) }); }
      return res.json({ id: Number(m[1]), requestNumber: r.requestNumber, status: r.status, requestorName: r.requestorName, requestorUserId: r.requestorUserId,
        customerName: r.customerName, requestType: r.origin === 'External' ? 'EXTERNAL' : 'INTERNAL', attribute1: 'Gate 2', createdDate: iso(r.created) });
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

const W2 = (env, from) => env.writes.slice(from || 0).map((w) => w.method + ' ' + w.path.replace('/equiprite/v1', ''));
const settle = (page, ms) => page.waitForTimeout(ms || 400);
const shown = (sel) => `${sel}:visible`;
const current = (page) => page.$eval('#mbTabbar .mb-tabbtn--on', (b) => b.dataset.tab).catch(() => '');
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const cards = (page) => page.$$eval('#apList .mb-approve-card', (b) => b.filter((x) => x.offsetParent).map((x) => x.dataset.number).join(','));
const chips = (page) => page.$$eval('#apChips .mb-chip', (c) => c.map((x) => x.dataset.key + ':' + x.querySelector('.mb-chip-count').innerText.trim()).join(' '));
const badge = (page) => page.$eval('.mb-tabbtn[data-tab="approve"] .mb-tabbadge', (b) => b.innerText.trim()).catch(() => '');
async function idle(page) {
  await page.waitForFunction(() => !document.querySelector('#mbApprove .mb-spin'), null, { timeout: 30000 });
  await settle(page, 250);
}
async function openCard(page, number) {
  await page.click(`#apList .mb-approve-card[data-number="${number}"]`);
  await page.waitForFunction((n) => { const h = document.querySelector('#apNumber'); return h && h.offsetParent && h.innerText.trim() === n; }, number, { timeout: 20000 });
  await page.waitForSelector('#apVerdict', { timeout: 20000 });
  await idle(page);
}
async function waitDone(page) {
  await page.waitForSelector(shown('#apDone'), { timeout: 30000 });
  await settle(page, 300);
}
const value = (page, sel) => page.$eval(sel, (n) => n.value);
/** The screen as the phone shows it (env.shot is the whole page, where the dock and the tab bar land mid-page). */
const vshot = (page, name) => page.screenshot({ path: path.join(os.tmpdir(), 'equiprite-e2e', name) });

(async () => {
  const W = world();
  const env = await E.start({ port: 20500, app: 'mobile', handle: backend(W) });
  const { page } = env;
  try {
    T.section('the queue: what waits on the Equipment Manager, most urgent first');
    await env.open('/');
    await page.waitForSelector('#apList .mb-approve-card', { timeout: 30000 });
    await settle(page, 800);
    T.eq('Approve is the tab it opens on', await current(page), 'approve');
    T.eq('nothing is written on opening', env.writes.length, 0);
    T.eq('the line under the title', await env.text('#apSummary'), '3 to decide · 1 with units to assign · 1 late');
    T.eq('chips with their counts', await chips(page), 'decide:3 allocate:1 late:1 all:4');
    T.eq('it opens on what waits for a decision', await env.text('#apChips .mb-chip--on'), 'To decide 3');
    T.eq('most urgent first: the late one, then by start date', await cards(page), 'REQ-509,REQ-501,REQ-502');
    const c509 = await env.text('#apList .mb-approve-card[data-number="REQ-509"]');
    T.check('a card: number, what it waits for, project and task', ['REQ-509', 'To decide', 'Plant Expansion B · 1.3 Foundations'].every((t) => c509.includes(t)), c509);
    T.check('…what they asked for, how many pieces, who', ['Vibratory Roller and Plate Compactor', '2 pieces · Sam Ortiz'].every((t) => c509.includes(t)), c509);
    T.check('…its dates, how late, and its age', c509.includes('3 days late') && c509.includes('Raised 6 days ago'), c509);
    const c502 = await env.text('#apList .mb-approve-card[data-number="REQ-502"]');
    T.check('a customer request says so and names the customer', c502.includes('Customer') && c502.includes('Gulf Coast Builders') && c502.includes('Starts in 6 days'), c502);
    await page.waitForFunction(() => { const b = document.querySelector('.mb-tabbtn[data-tab="approve"] .mb-tabbadge'); return b && b.innerText.trim() === '3'; }, null, { timeout: 15000 });
    T.eq('the tab counts the requests waiting for a decision', await badge(page), '3');
    T.eq('no sideways scroll', await sideways(page), false);
    await env.shot('mobile-approve-queue.png');

    await page.click('#apChips .mb-chip[data-key="allocate"]');
    await settle(page);
    T.eq('To assign units', await cards(page), 'REQ-503');
    T.check('an approved request: its lines with no unit yet, in words', (await env.text('#apList .mb-approve-card[data-number="REQ-503"]')).includes('3 lines approved, no unit assigned yet'));
    await page.click('#apChips .mb-chip[data-key="all"]');
    await page.fill('#apSearch', 'generator');
    await settle(page);
    T.eq('search reaches the equipment', await cards(page), 'REQ-502');
    await page.fill('#apSearch', '');
    await page.click('#apChips .mb-chip[data-key="decide"]');
    await settle(page);

    T.section('a request in words');
    await openCard(page, 'REQ-509');
    T.eq('it opens on itself, with where it is in the queue', [await env.text('#apNumber'), await env.text('#apPos')].join(' | '), 'REQ-509 | 1 of 3 in the queue shown');
    T.eq('where it is', await env.text('#apHeadline'), 'Waiting for approval');
    const verdict = await env.text('#apVerdict');
    T.check('what is next, and what is not available', verdict.includes('Waiting for your decision: 2 of 2 lines') && verdict.includes('Line 2 (Plate Compactor) is not available for its dates'), verdict);
    const facts = await env.text('#apFacts');
    T.check('the requester, the dates, the delivery, the estimate', ['Sam Ortiz', 'Raised 6 days ago', 'Started 3 days ago', 'Gate 2, 1200 Pipeline Rd', '$11,000']
      .every((t) => facts.includes(t)), facts);
    const l9091 = await env.text('#apLines [data-line="9091"]');
    T.check('a line: its name, class, what it is, its status, availability and cost', ['1. Vibratory Roller', 'Compaction', 'Serial', 'Waiting for approval', 'Available',
      '$1,400.00 / DAY · est. $9,800'].every((t) => l9091.includes(t)), l9091);
    T.check('a line not available for its dates says so', (await env.text('#apLines [data-line="9092"]')).includes('Not available'));
    T.eq('the main step says what it does', [await env.text('#apAskApprove'), await env.text('#apAskReject')].join(' | '), 'Approve all 2 lines | Send back…');
    T.eq('the dock is held above the tab bar', await page.$eval('#apDockDecide', (d) => Math.round(d.getBoundingClientRect().bottom) <= 844 - 62), true);
    T.eq('reading writes nothing', env.writes.length, 0);
    T.eq('no sideways scroll', await sideways(page), false);
    await env.shot('mobile-approve-request.png');
    await vshot(page, 'mobile-approve-request-screen.png');

    T.section('send back one line, with a quick reason');
    await page.click('#apLines [data-line="9092"] .mb-approve-tick');
    await settle(page, 250);
    T.eq('one line chosen: the steps act on it only', [await env.text('#apAskApprove'), await env.text('#apAskReject')].join(' | '), 'Approve 1 line | Send back 1…');
    await page.click('#apAskReject');
    await page.waitForSelector(shown('#apSheet'), { timeout: 10000 });
    await settle(page, 300);
    T.eq('the sheet says exactly what will happen, to whom', await env.text('#apSay'), 'Send back 1 piece to Sam Ortiz.');
    T.eq('…which line', await env.text('#apSheetLines'), 'Plate Compactor');
    T.check('…and what follows', (await env.text('#apSheetNote')).includes('1 line will go back to Sam Ortiz with your reason') && (await env.text('#apSheetNote')).includes('The rest of the request stays open'),
      await env.text('#apSheetNote'));
    await page.click('#apConfirm');
    await settle(page, 300);
    T.eq('no reason, nothing sent: it asks for one', [await env.text('#apFormError'), env.writes.length].join(' | '), 'Write the reason first: Sam Ortiz gets it with the request. | 0');
    await page.click('#apReasons .mb-chip[data-phrase="Not available for these dates"]');
    await settle(page, 200);
    T.eq('a quick reason goes into the reason', await value(page, '#apReason'), 'Not available for these dates.');
    T.eq('…and its chip is on', await page.$eval('#apReasons .mb-chip[data-phrase="Not available for these dates"]', (b) => b.getAttribute('aria-pressed')), 'true');
    await page.click('#apReason');
    await page.keyboard.press('End');
    await page.keyboard.type(' The 400 kg model is free.');
    await settle(page, 200);
    await page.click('#apReasons .mb-chip[data-phrase="Ask for another model"]');
    await settle(page, 200);
    T.eq('typed and tapped reasons together', await value(page, '#apReason'), 'Not available for these dates. The 400 kg model is free. Ask for another model.');
    T.eq('the sheet fits the phone', await sideways(page), false);
    await env.shot('mobile-approve-sendback.png');
    await vshot(page, 'mobile-approve-sendback-screen.png');
    await page.click('#apConfirm');
    await waitDone(page);
    T.eq('writes: the line, then the reason to the requester (Next: decideChain)', W2(env).join(' > '), 'PATCH /equipment-requests/509/lines/batch > POST /notifications');
    T.eq('only the chosen line is sent back', JSON.stringify(env.writes[0].body), '{"lines":[{"id":9092,"lineStatus":"REJECTED"}]}');
    T.eq('the reason, to the requester', JSON.stringify(env.writes[1].body),
      '{"userId":77,"requestId":509,"requestNumber":"REQ-509","subject":"REQ-509: 1 line was sent back","message":"Not available for these dates. The 400 kg model is free. Ask for another model."}');
    T.eq('what happened', [await env.text('#apDoneTitle'), await env.text('#apDoneText')].join(' | '), 'Sent back · REQ-509 | Sent back 1 line on REQ-509. Your reason was sent to Sam Ortiz.');
    T.eq('a toast says so too', await env.text('#mbToast .mb-toast-text'), 'Sent back 1 line on REQ-509. Your reason was sent to Sam Ortiz.');
    T.eq('its other line still waits: carry on with it', await env.text('#apAgain'), 'Decide the rest of REQ-509');
    T.eq('next up: the next request in the queue', await page.$eval('#apNextCard', (b) => b.dataset.key), '501');

    T.section('approve the rest');
    let mark = env.writes.length;
    await page.click('#apAgain');
    await page.waitForSelector(shown('#apAskApprove'), { timeout: 20000 });
    await idle(page);
    T.check('the line sent back reads so', (await env.text('#apLines [data-line="9092"]')).includes('Sent back'));
    T.eq('it can no longer be chosen', await page.$('#apLines [data-line="9092"] .mb-approve-tick'), null);
    T.eq('the rest can be approved', await env.text('#apAskApprove'), 'Approve the line');
    await page.click('#apAskApprove');
    await page.waitForSelector(shown('#apSheet'), { timeout: 10000 });
    await settle(page, 300);
    T.check('one line: what approving will do', /^Approve 1 piece for Plant Expansion B, .+ · est\. \$9,800\.$/.test(await env.text('#apSay')), await env.text('#apSay'));
    T.check('…and what follows', (await env.text('#apSheetNote')).includes('Every line is then decided, so the request moves on to unit assignment'), await env.text('#apSheetNote'));
    await env.shot('mobile-approve-approve-sheet.png');
    await page.click('#apConfirm');
    await waitDone(page);
    T.eq('writes: the line, then the request, every line being decided (Next: decideChain)', W2(env, mark).join(' > '),
      'PATCH /equipment-requests/509/lines/batch > PATCH /equipment-requests/509');
    T.eq('bodies', JSON.stringify(env.writes.slice(mark).map((w) => w.body)), '[{"lines":[{"id":9091,"lineStatus":"IN_PROCESS"}]},{"status":"IN_PROCESS"}]');
    T.eq('what happened', await env.text('#apDoneText'), 'Approved 1 line on REQ-509. Every line is decided: the request moves on to unit assignment.');
    T.eq('it now waits for units: assign them now', await env.text('#apAgain'), 'Assign REQ-509\'s units now');
    T.eq('next up', await page.$eval('#apNextCard', (b) => b.dataset.key), '501');
    await page.waitForFunction(() => { const b = document.querySelector('.mb-tabbtn[data-tab="approve"] .mb-tabbadge'); return b && b.innerText.trim() === '2'; }, null, { timeout: 15000 });
    T.eq('the tab\'s count goes down', await badge(page), '2');
    T.eq('no sideways scroll', await sideways(page), false);
    T.eq('"Next up" is on screen, clear of the toast and the tab bar', await page.evaluate(() => {
      const b = document.querySelector('#apOpenNext').getBoundingClientRect();
      const t = document.querySelector('#mbToast');
      const top = t ? t.getBoundingClientRect().top : window.innerHeight - 62;
      return b.top >= 0 && b.bottom <= top;
    }), true);
    await env.shot('mobile-approve-done.png');
    await vshot(page, 'mobile-approve-done-screen.png');

    T.section('next up: approve a whole request');
    mark = env.writes.length;
    const callMark = env.calls.length;
    await page.click('#apOpenNext');
    await page.waitForFunction(() => { const h = document.querySelector('#apNumber'); return h && h.offsetParent && h.innerText.trim() === 'REQ-501'; }, null, { timeout: 20000 });
    await page.waitForSelector(shown('#apAskApprove'), { timeout: 20000 });
    await idle(page);
    T.eq('every line, by default', await env.text('#apAskApprove'), 'Approve all 2 lines');
    await page.click('#apAskApprove');
    await page.waitForSelector(shown('#apConfirm'), { timeout: 10000 });
    await settle(page, 300);
    T.check('what approving will do, in one line', /^Approve 2 pieces for Pipeline North, .+ · est\. \$80,000\.$/.test(await env.text('#apSay')), await env.text('#apSay'));
    T.eq('…with what is not free', await env.text('#apSheetWarn'), 'Dump Truck 30t is only partly available.');
    await page.click('#apConfirm');
    await waitDone(page);
    T.eq('writes: both lines, then the request', W2(env, mark).join(' > '), 'PATCH /equipment-requests/501/lines/batch > PATCH /equipment-requests/501');
    T.eq('both lines approved', JSON.stringify(env.writes[mark].body), '{"lines":[{"id":9011,"lineStatus":"IN_PROCESS"},{"id":9012,"lineStatus":"IN_PROCESS"}]}');
    const reads = env.calls.slice(callMark).map((c) => c.replace('/equiprite/v1', '').split('?')[0]);
    const firstWrite = reads.indexOf('PATCH /equipment-requests/501/lines/batch');
    T.eq('the lines\' allocation is read just before the write (approveAllocate.approve)', reads[firstWrite - 1], 'GET /equipment-requests/501/lines');
    T.eq('next up after it: the next one to decide', await page.$eval('#apNextCard', (b) => b.dataset.key), '502');
    T.check('a count of what was done', /3 steps done/.test(await env.text('#apDone')), await env.text('#apDone'));

    T.section('assign units: change one line, then accept the suggestions in one tap');
    await page.click('#apToQueue');
    await page.waitForSelector(shown('#apList'), { timeout: 10000 });
    await page.click('#apChips .mb-chip[data-key="allocate"]');
    await settle(page);
    T.eq('now to assign units: the two approved, and REQ-503', await cards(page), 'REQ-509,REQ-501,REQ-503');
    mark = env.writes.length;
    await openCard(page, 'REQ-503');
    await page.waitForFunction(() => { const b = document.querySelector('#apAskAssign'); return b && !b.disabled; }, null, { timeout: 30000 });
    await idle(page);
    T.check('a serial line: the free unit is suggested, not the booked one', (await env.text('#apLines [data-line="9031"]')).includes('Suggested: EX-2203 (Houston Yard)'),
      await env.text('#apLines [data-line="9031"]'));
    T.check('a lot line: from the lots in turn, up to its quantity', (await env.text('#apLines [data-line="9033"]')).includes('Suggested: 6 from LOT-A (Houston Yard) and 4 from LOT-B (Dallas Yard)'),
      await env.text('#apLines [data-line="9033"]'));
    const l9032 = await env.text('#apLines [data-line="9032"]');
    T.check('free stock takes no unit, and says so', l9032.includes('Free stock') && l9032.includes('No unit needed') && l9032.includes('the yard picks the quantity'), l9032);
    T.eq('accept them all, in one tap', await env.text('#apAskAssign'), 'Assign suggested units · 2 lines');
    T.eq('suggesting writes nothing', env.writes.length - mark, 0);
    await env.shot('mobile-approve-units.png');
    await page.click('#apLines [data-line="9031"] .mb-approve-linebtn');
    await page.waitForSelector('#apUnits [data-unit="EX-2210"]', { timeout: 20000 });
    await settle(page, 300);
    T.check('a unit booked over these dates shows the clash', (await env.text('#apUnits [data-unit="EX-2201"]')).includes('Booked by REQ-482 · Pipeline North over these dates'),
      await env.text('#apUnits [data-unit="EX-2201"]'));
    T.check('the suggested unit is marked', (await env.text('#apUnits [data-unit="EX-2203"]')).includes('Suggested'));
    T.eq('nothing chosen: Save is off', await page.$eval('#apSaveUnits', (b) => b.disabled), true);
    await page.click('#apUnits [data-unit="EX-2210"] button[data-action="assign"]');
    await settle(page, 250);
    T.eq('Save says what it will do', await env.text('#apPickerPlan'), 'Saving will: Assign EX-2210 (Dallas Yard). The line will have 1 of 1 unit.');
    T.check('staged only: nothing written', env.writes.length === mark && (await env.text('#apUnits [data-unit="EX-2210"]')).includes('Assign on save'));
    T.eq('the unit sheet fits the phone', await sideways(page), false);
    await env.shot('mobile-approve-unit-sheet.png');
    await vshot(page, 'mobile-approve-unit-sheet-screen.png');
    await page.click('#apSaveUnits');
    await page.waitForFunction(() => !document.querySelector('#apSheet') && /Line 1 \(CAT 320 Excavator\): assign EX-2210/.test((document.querySelector('#apResult') || {}).innerText || ''),
      null, { timeout: 30000 });
    await idle(page);
    T.eq('writes: allocation, unit, line (Next: saveUnitsChain)', W2(env, mark).join(' > '),
      'POST /allocations > PATCH /serial-refs/703 > PATCH /equipment-requests/503/lines/9031');
    const post = env.writes[mark].body;
    T.check('the allocation: line, unit, quantity, status, date, its yard', post.requestLineId === 9031 && post.serialRefId === 703 && post.allocatedQty === 1
      && post.allocationStatus === 'ALLOCATED' && /^\d{4}-\d{2}-\d{2}T/.test(post.allocatedDate) && post.eqpInvOrgId === 310 && post.eqpInvOrgName === 'Dallas Yard', JSON.stringify(post));
    T.eq('the unit is out on rent, the line allocated', JSON.stringify(env.writes.slice(mark + 1).map((w) => w.body)),
      '[{"unitStatus":"RENTED"},{"allocationStatus":"ALLOCATED","lineStatus":"ALLOCATED"}]');
    T.check('read back: the line has its unit', (await env.text('#apLines [data-line="9031"]')).includes('Unit assigned'));
    await page.waitForFunction(() => { const b = document.querySelector('#apAskAssign'); return b && !b.disabled; }, null, { timeout: 30000 });
    T.eq('one line left to accept', await env.text('#apAskAssign'), 'Assign suggested units · 1 line');
    mark = env.writes.length;
    await page.click('#apAskAssign');
    await page.waitForSelector(shown('#apConfirmAssign'), { timeout: 10000 });
    await settle(page, 300);
    T.eq('the sheet lists what will be assigned', await env.text('#apPlan'), 'Line 3 · Traffic cones: 6 from LOT-A (Houston Yard) and 4 from LOT-B (Dallas Yard)');
    await env.shot('mobile-approve-assign-sheet.png');
    await page.click('#apConfirmAssign');
    await waitDone(page);
    T.eq('writes, as Next saves a line\'s units (autoChain)', W2(env, mark).join(' > '),
      'POST /allocations > PATCH /lot-refs/801 > POST /allocations > PATCH /lot-refs/802 > PATCH /equipment-requests/503/lines/9033');
    const lots = env.writes.slice(mark).filter((w) => w.path.endsWith('/allocations')).map((w) => w.body);
    T.check('each lot and its quantity', lots[0].lotRefId === 801 && lots[0].allocatedQty === 6 && lots[1].lotRefId === 802 && lots[1].allocatedQty === 4, JSON.stringify(lots));
    T.eq('what is free of each lot goes down', JSON.stringify(env.writes.slice(mark).filter((w) => w.path.includes('/lot-refs/')).map((w) => w.body)),
      '[{"availableToReserve":0},{"availableToReserve":6}]');
    T.eq('nothing left to assign: it leaves the queue', [await env.text('#apDoneTitle'), await page.$('#apAgain')].join(' | '), 'Units assigned · REQ-503 | ');
    T.check('…saying what was assigned', (await env.text('#apDone')).includes('Line 3 (Traffic cones): assign 6 from LOT-A (Houston Yard) and 4 from LOT-B (Dallas Yard)'),
      await env.text('#apDone'));
    T.eq('next up wraps to the top of the chip', await page.$eval('#apNextCard', (b) => b.dataset.key), '509');

    T.section('a request handed over by My requests');
    await page.click('.mb-tabbtn[data-tab="track"]');
    await page.waitForSelector(shown('#trAll'), { timeout: 20000 });
    await page.click('#trAll');
    await page.waitForSelector(shown('#trList .mb-item[data-number="REQ-502"]'), { timeout: 20000 }).catch(async () => {
      await page.click('#trChips .mb-chip[data-key="all"]');
      await page.waitForSelector(shown('#trList .mb-item[data-number="REQ-502"]'), { timeout: 10000 });
    });
    await page.click('#trList .mb-item[data-number="REQ-502"]');
    await page.waitForSelector(shown('#trApprove'), { timeout: 10000 });
    await page.click('#trApprove');
    await page.waitForFunction(() => { const h = document.querySelector('#apNumber'); return h && h.offsetParent && h.innerText.trim() === 'REQ-502'; }, null, { timeout: 20000 });
    T.eq('"Approve or send back" opens it here', [await current(page), await env.text('#apNumber')].join(), 'approve,REQ-502');
    await idle(page);
    T.check('a customer request: whose', (await env.text('#apDetail')).includes('Customer · Gulf Coast Builders'), await env.text('#apDetail'));

    T.section('no connection');
    const before = env.writes.length;
    const errorsBefore = env.errors.length;
    await page.context().setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.waitForSelector('#mbOffline', { timeout: 10000 });
    await page.click('#apAskApprove');
    await page.waitForSelector(shown('#apConfirm'), { timeout: 10000 });
    await page.click('#apConfirm');
    await page.waitForSelector(shown('#apFormError'), { timeout: 10000 });
    T.eq('a decision with no connection: nothing sent, said so', [await env.text('#apFormError'), env.writes.length - before].join(' | '), 'No connection: nothing was sent. | 0');
    await page.click('#apCancel');
    await page.click('#apBack');
    await page.waitForSelector(shown('#apList'), { timeout: 10000 });
    await page.click('#apRefresh');
    await page.waitForSelector(shown('#apSaved'), { timeout: 30000 });
    T.check('the queue saved on this phone, saying when', /Saved on this phone at \d\d:\d\d\. Deciding needs a connection\./.test(await env.text('#apSaved')), await env.text('#apSaved'));
    await page.click('#apChips .mb-chip[data-key="all"]');
    await settle(page);
    T.eq('the saved cards', await cards(page), 'REQ-509,REQ-501,REQ-502');
    await page.click('#apList .mb-approve-card[data-number="REQ-502"]');
    await page.waitForSelector(shown('#apVerdict'), { timeout: 10000 });
    T.check('a saved request: what the card knew, no decisions', (await env.text('#apVerdict')).includes('need a connection') && !(await page.$('#apAskApprove'))
      && (await env.text('#apOffline')).includes('Generator 100 kVA'), await env.text('#apVerdict'));
    T.eq('…and no estimate it does not know', await page.$('#apEst'), null);
    T.eq('nothing was sent with no connection', env.writes.length - before, 0);
    await env.shot('mobile-approve-offline.png');
    await page.context().setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForSelector('#mbOffline', { state: 'detached', timeout: 10000 });
    // Offline, the reads fail (and say so in the console); nothing the app needs may fail to load.
    const offlineErrors = env.errors.splice(errorsBefore);
    T.eq('offline: no part of the app failed to load', offlineErrors.filter((e) => /Script error|does not exist|pageerror/.test(e)).join(' | '), '');

    T.section('a deep link');
    await env.open('/?tab=approve&number=REQ-502');
    await page.waitForFunction(() => { const h = document.querySelector('#apNumber'); return h && h.offsetParent && h.innerText.trim() === 'REQ-502'; }, null, { timeout: 30000 });
    T.eq('?tab=approve&number= opens on the request', [await current(page), await env.text('#apNumber')].join(), 'approve,REQ-502');
    await idle(page);
    T.eq('no sideways scroll', await sideways(page), false);
    await env.open('/?tab=approve&number=REQ-505');
    await page.waitForSelector('#mbToast', { timeout: 30000 });
    T.eq('a request with nothing waiting: said so', await env.text('#mbToast .mb-toast-text'), 'REQ-505 has nothing waiting to approve or assign.');

    T.eq('no browser errors', env.errors.join(' | '), '');
  } catch (e) {
    T.check('run finished', false, e && e.stack);
    await env.shot('mobile-approve-failure.png').catch(() => {});
  } finally {
    await env.close();
  }
  T.report();
})();
