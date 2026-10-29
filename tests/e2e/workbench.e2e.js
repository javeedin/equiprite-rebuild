'use strict';
/*
 * Workbench and Approve & allocate in a real browser: the stage tabs and their counts, a bulk approve of two
 * submitted requests, an approve on Approve & allocate, and a serial allocated to a line, each checked against the
 * calls the old app makes. Needs `npm run build`. Run: node tests/e2e/workbench.e2e.js
 * (screenshots go to the OS temp folder, equiprite-e2e/).
 */
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();

// ── A small stateful backend: request headers, lines and units that the writes change ───────────────────────────
const REQ = {
  501: { requestNumber: 'REQ-501', requestStatus: 'SUBMITTED', source: 'INTERNAL', projectName: 'Pipeline North', taskName: '2.1 Trenching',
    requestor: 'Priya Nair', requestedStartDate: '2026-11-04T00:00:00Z', requestedEndDate: '2026-11-30T00:00:00Z', totalLines: 2, allocatedLines: 0, totalEstCost: 80000 },
  502: { requestNumber: 'REQ-502', requestStatus: 'SUBMITTED', source: 'EXTERNAL', projectName: 'Gulf Coast Builders', customerName: 'Gulf Coast Builders',
    requestor: 'Dana Ruiz', requestedStartDate: '2026-11-06T00:00:00Z', requestedEndDate: '2027-01-06T00:00:00Z', totalLines: 1, allocatedLines: 0, totalEstCost: 37200 },
  509: { requestNumber: 'REQ-509', requestStatus: 'SUBMITTED', source: 'INTERNAL', projectName: 'Plant Expansion B', taskName: '1.3 Foundations',
    requestor: 'Sam Ortiz', requestedStartDate: '2026-11-12T00:00:00Z', requestedEndDate: '2026-12-12T00:00:00Z', totalLines: 1, allocatedLines: 0, totalEstCost: 9800 },
  503: { requestNumber: 'REQ-503', requestStatus: 'IN_PROCESS', source: 'INTERNAL', projectName: 'Plant Expansion B', taskName: '4.2 Steel',
    requestor: 'Sam Ortiz', requestedStartDate: '2026-11-08T00:00:00Z', requestedEndDate: '2026-11-22T00:00:00Z', totalLines: 2, allocatedLines: 0, totalEstCost: 40350, location: 'Plant B gate 2' },
  504: { requestNumber: 'REQ-504', requestStatus: 'IN_PROCESS', source: 'INTERNAL', projectName: 'Pipeline North', requestor: 'Priya Nair',
    requestedStartDate: '2026-11-02T00:00:00Z', requestedEndDate: '2026-11-20T00:00:00Z', totalLines: 1, allocatedLines: 1, totalEstCost: 12000 },
  505: { requestNumber: 'REQ-505', requestStatus: 'PICK_RELEASED', source: 'INTERNAL', projectName: 'Refinery Turnaround', requestor: 'Lee Chan',
    requestedStartDate: '2026-10-30T00:00:00Z', requestedEndDate: '2026-11-15T00:00:00Z', totalLines: 3, allocatedLines: 3, totalEstCost: 22000 },
  506: { requestNumber: 'REQ-506', requestStatus: 'DEPLOYED', source: 'EXTERNAL', customerName: 'Lone Star Paving', projectName: 'Lone Star Paving',
    requestedStartDate: '2026-10-01T00:00:00Z', requestedEndDate: '2026-12-31T00:00:00Z', totalLines: 2, allocatedLines: 2, totalEstCost: 61200 },
  507: { requestNumber: 'REQ-507', requestStatus: 'DEPLOYED', source: 'INTERNAL', projectName: 'Pipeline North',
    requestedStartDate: '2026-09-01T00:00:00Z', requestedEndDate: '2026-11-30T00:00:00Z', totalLines: 1, allocatedLines: 1, totalEstCost: 5000 },
  508: { requestNumber: 'REQ-508', requestStatus: 'DEPLOYED', source: 'INTERNAL', projectName: 'Plant Expansion B',
    requestedStartDate: '2026-08-01T00:00:00Z', requestedEndDate: '2026-10-28T00:00:00Z', totalLines: 1, allocatedLines: 1, totalEstCost: 4000 },
};
const STAGE = { OUTBOUND: [501, 502, 509, 503, 504, 505], INITIATE: [504], DEPLOYED: [506, 507], INBOUND: [508] };
const LINE = (id, name, extra) => Object.assign({ lineId: id, equipmentName: name, className: 'Excavators', quantity: 1, lineStatus: 'SUBMITTED',
  availabilityStatus: 'AVAILABLE', allocatedQty: 0, billRate: 1400, priceUom: 'DAY', estimatedCost: 20000,
  startDate: '2026-11-08T00:00:00Z', endDate: '2026-11-22T00:00:00Z', isSerialControlled: 'Y', isLotControlled: 'N', isInventoryTracked: 'Y', equipmentMasterId: 11 }, extra || {});
const LINES = {
  501: [LINE(9011, 'CAT 320 Excavator'), LINE(9012, 'Dump Truck 30t', { className: 'Trucks', equipmentMasterId: 31, availabilityStatus: 'PARTIAL QUANTITY' })],
  502: [LINE(9021, 'Generator 100 kVA', { className: 'Power', equipmentMasterId: 41 })],
  509: [LINE(9091, 'Vibratory Roller', { className: 'Compaction', equipmentMasterId: 51 })],
  503: [LINE(9031, 'CAT 320 Excavator', { lineStatus: 'IN_PROCESS', estimatedCost: 38400 }),
    LINE(9032, 'Trench safety kit', { className: 'Safety & consumables', lineStatus: 'IN_PROCESS', quantity: 10, billRate: 75, estimatedCost: 1950,
      isSerialControlled: 'N', isInventoryTracked: 'N', equipmentMasterId: 61 })],
};
const UNITS = [
  { unitRefId: 701, serialRefId: 701, unitNumber: 'EX-2201', availabilityStatus: 'NOT AVAILABLE', invOrgId: 300, invOrgName: 'Houston Yard' },
  { unitRefId: 702, serialRefId: 702, unitNumber: 'EX-2203', availabilityStatus: 'AVAILABLE', invOrgId: 300, invOrgName: 'Houston Yard' },
  { unitRefId: 703, serialRefId: 703, unitNumber: 'EX-2210', availabilityStatus: 'AVAILABLE', invOrgId: 310, invOrgName: 'Dallas Yard' },
];
const allocations = {}; // serialRefId -> allocation id

function headerRow(id) {
  return Object.assign({ eqrEquipmentRequestId: id }, REQ[id]);
}

function handle(req, res) {
  const p = req.path.replace('/equiprite/v1', '');
  const q = req.query;
  if (p === '/views/workbench-requests') {
    if (q.get('eqrEquipmentRequestId')) return res.json({ data: [headerRow(Number(q.get('eqrEquipmentRequestId')))] });
    const stage = q.get('stage');
    return res.json({ data: (STAGE[stage] || []).filter((id) => stage !== 'OUTBOUND' || REQ[id].requestStatus !== 'DEPLOYED').map(headerRow) });
  }
  if (p === '/views/pending-approval-lines') {
    return res.json({ data: q.get('lineStatus') === 'UNDER_PROCUREMENT' && q.get('includeAll') === 'Y'
      ? [{ requestNumber: 'REQ-503', lineNumber: 3, equipmentName: 'Tower Crane', lineStatus: 'UNDER_PROCUREMENT', estimatedCost: 264000,
        lineStartDate: '2026-11-12', lineEndDate: '2027-02-12', requestor: 'Sam Ortiz' }] : [] });
  }
  if (p === '/views/request-detail-lines') {
    const id = Number(q.get('requestId'));
    return res.json({ data: (LINES[id] || []).map((l) => Object.assign({}, l, { requestNumber: REQ[id].requestNumber, requestStatus: REQ[id].requestStatus })) });
  }
  let m = /^\/equipment-requests\/(\d+)\/lines$/.exec(p);
  if (m && req.method === 'GET') {
    return res.json({ data: (LINES[m[1]] || []).map((l) => ({ id: l.lineId, lineStatus: l.lineStatus, allocationStatus: l.allocatedQty >= l.quantity ? 'ALLOCATED' : 'PENDING' })) });
  }
  m = /^\/equipment-requests\/(\d+)\/lines\/batch$/.exec(p);
  if (m && req.method === 'PATCH') {
    const body = req.json();
    body.lines.forEach((u) => { const l = (LINES[m[1]] || []).find((x) => x.lineId === u.id); if (l) l.lineStatus = u.lineStatus; });
    return res.json({ data: body.lines });
  }
  m = /^\/equipment-requests\/(\d+)$/.exec(p);
  if (m && req.method === 'PATCH') {
    REQ[m[1]].requestStatus = req.json().status;
    return res.json({ id: Number(m[1]) });
  }
  if (p === '/views/line-detail-units') {
    const lineId = Number(q.get('lineId'));
    const line = LINES[503].find((l) => l.lineId === lineId);
    if (!line || lineId !== 9031) return res.json({ data: [] });
    return res.json({ data: UNITS.map((u) => Object.assign({
      lineId, requestNumber: 'REQ-503', requestStatus: REQ[503].requestStatus, source: 'INTERNAL', lineStatus: line.lineStatus,
      equipmentMasterId: 11, equipmentName: line.equipmentName, className: line.className, quantity: line.quantity,
      isSerialControlled: 'Y', isLotControlled: 'N', isInventoryTracked: 'Y', lineStartDate: '2026-11-08', lineEndDate: '2026-11-22', unitType: 'SERIAL',
    }, u, allocations[u.serialRefId] ? { allocationId: allocations[u.serialRefId], allocationStatus: 'ALLOCATED', allocatedQty: 1 } : {})) });
  }
  if (p === '/views/line-detail-bookings') {
    return res.json({ data: [{ unitRefId: 701, bookingRequestNumber: 'REQ-482', bookingStartDate: '2026-10-28', bookingEndDate: '2026-11-12', projectName: 'Pipeline North' },
      { unitRefId: 703, bookingRequestNumber: 'REQ-511', bookingStartDate: '2026-11-25', bookingEndDate: '2026-12-20', projectName: 'Plant Expansion B' }] });
  }
  if (p === '/allocations' && req.method === 'POST') {
    const body = req.json();
    allocations[body.serialRefId] = 8000 + body.serialRefId;
    return res.json({ id: allocations[body.serialRefId] }, 201);
  }
  if (p === '/allocations') return res.json({ data: [] });
  if (/^\/serial-refs\/\d+$/.test(p)) return res.json({ id: 1 });
  m = /^\/equipment-requests\/(\d+)\/lines\/(\d+)$/.exec(p);
  if (m && req.method === 'PATCH') {
    const l = (LINES[m[1]] || []).find((x) => x.lineId === Number(m[2]));
    const body = req.json();
    if (l && body.lineStatus) l.lineStatus = body.lineStatus;
    if (l && body.allocationStatus === 'ALLOCATED') l.allocatedQty = l.quantity;
    return res.json({ id: Number(m[2]) });
  }
  return undefined;
}

const W = (env) => env.writes.map((w) => w.method + ' ' + w.path.replace('/equiprite/v1', ''));
const counts = (env) => env.page.$$eval('.er-wb-tab', (tabs) => tabs.map((t) => t.innerText.replace(/\s+/g, ' ').trim()).join(' | '));

(async () => {
  const env = await E.start({ port: 19100, handle });
  const { page } = env;
  try {
    T.section('Workbench: stages and counts');
    await env.open('/vp/shell/workbench/workbench');
    await page.waitForSelector('.er-wb-tab', { timeout: 30000 });
    await page.waitForSelector('.er-wb-row[data-request]', { timeout: 30000 });
    T.eq('tab counts: To approve, To pick, Outbound, Deployed, Inbound, Procurement',
      await counts(env), 'To approve 3 | To pick 1 | Outbound 2 | Deployed 2 | Inbound 1 | Procurement 1');
    T.check('the menu shows Request workbench as the open item', (await page.$eval('.er-nav-item--active', (e) => e.dataset.navId).catch(() => '')) === 'workbench');
    T.check('every stage call of the old app was made',
      ['stage=OUTBOUND', 'stage=INITIATE', 'stage=DEPLOYED', 'stage=INBOUND'].every((s) => env.calls.some((c) => c.includes('/views/workbench-requests') && c.includes(s)))
      && env.calls.some((c) => c.includes('/views/pending-approval-lines') && c.includes('lineStatus=UNDER_PROCUREMENT')));
    T.check('To approve says what it adds up to', (await env.text('.er-wb-stage')).includes('3 requests · 4 lines · $127,000 estimated'));
    T.check('a customer request shows its customer, not a project', (await env.text('.er-wb-row[data-request="REQ-502"]')).includes('Gulf Coast Builders'));
    await env.shot('workbench.png');

    await page.click('#wbTab-outbound');
    await page.waitForTimeout(300);
    T.check('Outbound: the next action of an unallocated in-process request is Allocate',
      (await env.text('.er-wb-row[data-request="REQ-503"] .er-wb-next')).includes('Allocate')
      && (await env.text('.er-wb-row[data-request="REQ-503"] .er-wb-next')).includes('2 of 2 lines not allocated'));
    T.check('Outbound leaves out what is in To pick', !(await page.$('.er-wb-row[data-request="REQ-504"]')));
    await page.click('#wbTab-pick');
    await page.waitForTimeout(300);
    T.check('To pick: the next action is Initiate picking', (await env.text('.er-wb-row[data-request="REQ-504"] .er-wb-next')).includes('Initiate picking'));
    await page.click('#wbTab-procurement');
    await page.waitForTimeout(300);
    T.check('Procurement: the request with a line under procurement, joined to its request',
      (await env.text('.er-wb-row[data-request="REQ-503"]')).includes('Tower Crane'));

    T.section('Workbench: bulk approve sends the old approve calls, request by request');
    await page.click('#wbTab-approve');
    await page.waitForTimeout(300);
    await page.check('input[type="checkbox"][data-id="501"]');
    await page.check('input[type="checkbox"][data-id="502"]');
    await page.waitForTimeout(300);
    T.check('the selection bar shows the consequence', (await env.text('.er-wb-selbar')).includes('2 selected · 1 project, 1 customer · 3 lines · $117,200 estimated'));
    env.writes.length = 0;
    const callsBefore = env.calls.length;
    await page.click('#wbBulkApprove');
    await page.waitForSelector('.er-wb-result', { timeout: 20000 });
    await page.waitForTimeout(800);
    T.eq('writes: lines then header, for each request',
      W(env).join(' > '),
      'PATCH /equipment-requests/501/lines/batch > PATCH /equipment-requests/501 > PATCH /equipment-requests/502/lines/batch > PATCH /equipment-requests/502');
    T.eq('lines move to IN_PROCESS', JSON.stringify(env.writes[0].body), '{"lines":[{"id":9011,"lineStatus":"IN_PROCESS"},{"id":9012,"lineStatus":"IN_PROCESS"}]}');
    T.eq('the header moves to IN_PROCESS', JSON.stringify(env.writes[1].body), '{"status":"IN_PROCESS"}');
    const bulkCalls = env.calls.slice(callsBefore).filter((c) => !c.includes('/views/workbench-requests') && !c.includes('pending-approval-lines'));
    T.check('each request: its lines, then the allocation lookup, before the writes',
      bulkCalls[0].startsWith('GET /equiprite/v1/views/request-detail-lines?requestId=501') && bulkCalls[1].startsWith('GET /equiprite/v1/equipment-requests/501/lines?'),
      bulkCalls.slice(0, 3).join(' ; '));
    T.check('the result names both requests', (await env.text('.er-wb-result')).includes('2 of 2 requests approved'));
    T.check('the approved requests left To approve', (await counts(env)).startsWith('To approve 1'));

    T.section('Approve & allocate: approve a submitted request');
    await page.click('.er-wb-row[data-request="REQ-509"] .er-wb-reqlink');
    await page.waitForSelector('#aaApprove', { timeout: 30000 });
    await page.waitForTimeout(500);
    T.check('opens on the request with its verdict', (await env.text('.er-band h1')).includes('Approve REQ-509')
      && (await env.text('.er-aa-verdict')).includes('Ready to approve'));
    T.check('the menu keeps Request workbench open', (await page.$eval('.er-nav-item--active', (e) => e.dataset.navId).catch(() => '')) === 'workbench');
    T.eq('Approve says what it will do', (await env.text('#aaApprove')), 'Approve the line');
    T.check('allocation waits for approval', (await env.text('.er-aa-row[data-line="9091"]')).includes('Opens once the request is approved'));
    env.writes.length = 0;
    await page.click('#aaReject');
    await page.waitForSelector('#aaConfirmReject', { state: 'visible', timeout: 10000 });
    T.check('Reject asks first and says what it will do', (await env.text('#rejectLinesDialog')).includes('1 line of REQ-509 will be rejected'));
    await page.click('#rejectLinesDialog .er-btn--plain');
    await page.waitForSelector('#aaConfirmReject', { state: 'hidden', timeout: 10000 });
    T.eq('Cancel writes nothing', W(env).filter((w) => !w.includes('/transfer-orders/failed')).length, 0);
    await page.click('#aaApprove');
    await page.waitForFunction(() => /Allocate REQ-509/.test(document.querySelector('.er-band h1').innerText), null, { timeout: 20000 });
    T.eq('writes: the line, then the header (confirmRequestChain)',
      W(env).filter((w) => !w.includes('/transfer-orders/failed')).join(' > '), 'PATCH /equipment-requests/509/lines/batch > PATCH /equipment-requests/509');
    T.eq('body', JSON.stringify(env.writes.find((w) => w.path.endsWith('/lines/batch')).body), '{"lines":[{"id":9091,"lineStatus":"IN_PROCESS"}]}');

    T.section('Approve & allocate: allocate a serial to a line');
    await env.open('/vp/shell/workbench/workbench');
    await page.click('#wbTab-outbound');
    await page.waitForSelector('.er-wb-row[data-request="REQ-503"]');
    await page.click('.er-wb-row[data-request="REQ-503"] .er-wb-next button');
    await page.waitForSelector('button[data-line="9031"]', { timeout: 30000 });
    await page.waitForTimeout(400);
    T.check('a free-stock line has nothing to allocate', (await env.text('.er-aa-row[data-line="9032"]')).includes('Free stock'));
    await page.click('button[data-line="9031"]');
    await page.waitForSelector('.er-aa-unit[data-unit="EX-2203"]', { timeout: 20000 });
    await page.waitForTimeout(300);
    T.check('a unit booked over these dates shows the clash', (await env.text('.er-aa-unit[data-unit="EX-2201"]')).includes('Clash'));
    T.eq('the clash is drawn on its schedule', await page.$$eval('.er-aa-unit[data-unit="EX-2201"] .er-aa-bar--conflict', (b) => b.length), 1);
    T.check('a unit booked after these dates is still free', (await env.text('.er-aa-unit[data-unit="EX-2210"]')).includes('Available'));
    T.eq('nothing staged: Save is disabled', await page.$eval('#aaSaveUnits', (b) => b.disabled), true);
    await page.click('.er-aa-unit[data-unit="EX-2203"] button[data-action="assign"]');
    await page.waitForTimeout(300);
    T.check('staged, not written', (await env.text('.er-aa-unit[data-unit="EX-2203"]')).includes('Assign on save')
      && !env.writes.some((w) => w.path.endsWith('/allocations')));
    T.check('the line is now full: the other free unit cannot be assigned', !(await page.$('.er-aa-unit[data-unit="EX-2210"] button[data-action="assign"]')));
    await env.shot('approve-allocate-units.png');
    env.writes.length = 0;
    await page.click('#aaSaveUnits');
    await page.waitForFunction(() => /Assigned/.test((document.querySelector('.er-aa-unit[data-unit="EX-2203"]') || {}).innerText || ''), null, { timeout: 20000 });
    await page.waitForTimeout(500);
    const allocWrites = W(env).filter((w) => !w.includes('/transfer-orders/failed'));
    T.eq('writes: allocation, unit, line (saveLineChain)', allocWrites.join(' > '),
      'POST /allocations > PATCH /serial-refs/702 > PATCH /equipment-requests/503/lines/9031');
    const post = env.writes.find((w) => w.path.endsWith('/allocations')).body;
    T.check('the allocation body', post.requestLineId === 9031 && post.serialRefId === 702 && post.allocatedQty === 1
      && post.allocationStatus === 'ALLOCATED' && /^\d{4}-\d{2}-\d{2}T/.test(post.allocatedDate) && post.eqpInvOrgId === 300 && post.eqpInvOrgName === 'Houston Yard',
      JSON.stringify(post));
    T.eq('the unit is rented', JSON.stringify(env.writes.find((w) => w.path.includes('/serial-refs/')).body), '{"unitStatus":"RENTED"}');
    T.eq('the line is allocated', JSON.stringify(env.writes.find((w) => w.path.endsWith('/lines/9031')).body), '{"allocationStatus":"ALLOCATED","lineStatus":"ALLOCATED"}');
    T.check('the gate and the line status were read first',
      env.calls.some((c) => c.includes('/transfer-orders?equipmentRequestId=503')) && env.calls.some((c) => c.includes('/allocations?requestLineId=9031')));
    T.check('the lines show the allocation after the save', (await env.text('.er-aa-row[data-line="9031"]')).includes('1 of 1 allocated'));
    await page.click('button[data-line="9031"]');
    await page.waitForTimeout(300);
    await env.shot('approve-allocate.png');

    T.section('phone width');
    await page.setViewportSize({ width: 390, height: 900 });
    await env.open('/vp/shell/workbench/workbench');
    await page.waitForSelector('.er-wb-row[data-request]', { timeout: 30000 });
    T.check('no sideways page scroll at 390px (the grid scrolls in its card)',
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), String(await page.evaluate(() => document.documentElement.scrollWidth)));
    T.check('…and the next action stays on screen', await page.$eval('.er-wb-row[data-request] .er-wb-next button',
      (b) => b.getBoundingClientRect().right <= window.innerWidth));
    T.check('rows become labelled cards: no column header row', await page.$eval('.er-wb-head', (h) => getComputedStyle(h).display === 'none'));
    await env.shot('workbench-phone.png');
    await env.open('/vp/shell/workbench/approve-allocate?requestId=REQ-503&requestNumericId=503');
    await page.waitForSelector('button[data-line="9031"]', { timeout: 30000 });
    await page.click('button[data-line="9031"]');
    await page.waitForSelector('.er-aa-unit[data-unit="EX-2203"]', { timeout: 20000 });
    T.check('Approve & allocate fits a phone too', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await env.shot('approve-allocate-phone.png');
    await page.setViewportSize({ width: 1440, height: 1000 });

    if (process.env.E2E_DEBUG) console.log(env.errors.join('\n'));
    T.eq('no browser errors', env.errors.filter((e) => !e.startsWith('warning')).join('\n'), '');
  } catch (e) {
    T.check('run finished', false, e.message);
    await env.shot('workbench-failed.png').catch(() => {});
  } finally {
    await env.close();
    T.report();
  }
})();
