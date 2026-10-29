'use strict';
/*
 * Initiate picking and Receipt & returns in a real browser, against a stateful fake backend.
 *   picking: the queue renders, a request opens with its first transfer order's lines ticked, Release for picking
 *            sends the batch release then the line batch, Pick and ship sends the ship batch.
 *   receipt: the returns queue renders (one row per request), Receive at yard closes the ticked line with the
 *            date and returns its unit to stock, Direct Return finds a unit by serial and runs plan, reserve,
 *            the Fusion transfer order and record.
 * Needs `npm run build`. Run: node tests/e2e/logistics.e2e.js   (screenshots go to the OS temp folder)
 */
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const V1 = '/equiprite/v1';

// ── Fake data ───────────────────────────────────────────────────────────────────────────────────────────────
const PICK_QUEUE = [
  { eqrEquipmentRequestId: 501, requestNumber: 'REQ-10527', requestStatus: 'IN_PROCESS', source: 'INTERNAL', projectName: 'Plant Expansion B',
    taskName: '1.3 Foundations', requestor: 'John Dunbar', requestedStartDate: '2026-11-02T00:00:00Z', requestedEndDate: '2026-11-22T00:00:00Z',
    totalLines: 4, totalEstCost: 9800 },
  { eqrEquipmentRequestId: 502, requestNumber: 'REQ-10530', requestStatus: 'IN_PROCESS', source: 'INTERNAL', projectName: 'Pipeline North',
    taskName: '2.1 Trenching', requestor: 'Priya Raman', requestedStartDate: '2026-12-04T00:00:00Z', requestedEndDate: '2026-12-30T00:00:00Z',
    totalLines: 3, totalEstCost: 80000 },
  { eqrEquipmentRequestId: 503, requestNumber: 'REQ-10505', requestStatus: 'QUOTE_ACCEPTED', source: 'EXTERNAL', customerName: 'Gulf Coast Builders',
    contactName: 'Dana Ortiz', requestedStartDate: '2026-10-31T00:00:00Z', requestedEndDate: '2027-01-31T00:00:00Z', totalLines: 4, totalEstCost: 118400 },
];
// Request 501: TO-778402 (lines 7001, 7002, newest, so it opens ticked), TO-778399 (line 7003), an F&M line 7004
// with no transfer order, and a DRAFT line the page must not show.
const lineStatus = { 7001: 'SCHEDULED_FOR_PICKING', 7002: 'SCHEDULED_FOR_PICKING', 7003: 'SCHEDULED_FOR_PICKING', 7004: 'SCHEDULED_FOR_PICKING', 7005: 'DRAFT' };
const PICK_LINES = () => [
  { id: 7001, eqrEquipmentMasterId: 11, quantity: 1, lineStatus: lineStatus[7001], sourceOrgCode: '002', fulfilmentClass: 'S_AND_T' },
  { id: 7002, eqrEquipmentMasterId: 12, quantity: 1, lineStatus: lineStatus[7002], sourceOrgCode: '002', fulfilmentClass: 'S_AND_T' },
  { id: 7003, eqrEquipmentMasterId: 13, quantity: 2, lineStatus: lineStatus[7003], sourceOrgCode: '003', fulfilmentClass: 'S_AND_T' },
  { id: 7004, eqrEquipmentMasterId: 14, quantity: 1, lineStatus: lineStatus[7004], fulfilmentClass: 'F_AND_M' },
  { id: 7005, eqrEquipmentMasterId: 15, quantity: 1, lineStatus: lineStatus[7005] },
];
const UNITS = {
  7001: [{ equipmentName: 'CAT 320 Excavator', className: 'Excavators', allocationId: 1, unitNumber: 'EX-2201', unitStatus: 'RENTED',
    unitRefId: 31, unitType: 'SERIAL', allocationMethod: 'MANUAL', sourceInvOrgName: 'Houston Yard' }],
  7002: [{ equipmentName: 'Komatsu PC210 Excavator', className: 'Excavators', allocationId: 2, unitNumber: 'EX-2207', unitStatus: 'DAMAGED',
    unitRefId: 32, unitType: 'SERIAL', allocationMethod: 'MANUAL', sourceInvOrgName: 'Houston Yard' }],
  7003: [{ equipmentName: 'Light tower', className: 'Lighting', allocationId: 3, unitNumber: 'LT-0042', unitStatus: 'RENTED',
    unitRefId: 33, unitType: 'SERIAL', allocationMethod: 'AUTO', lineSourceInvOrgName: 'Atlanta Yard' }],
  7004: [{ equipmentName: 'Survey drone', className: 'Survey', allocationId: 4, unitNumber: 'DR-9', unitStatus: 'RENTED',
    unitRefId: 34, unitType: 'SERIAL', allocationMethod: 'MANUAL', sourceInvOrgName: 'Houston Yard' }],
};
const SERIAL_REFS = { 11: [{ id: 31, currentSubinventory: 'Available', currentLocator: 'A-12-04' }],
  12: [{ id: 32, currentSubinventory: 'Maintenance', currentLocator: 'M-01' }] };

const RET_QUEUE = [ // one row per LINE, as the view answers for the return stage
  { eqrEquipmentRequestId: 601, requestNumber: 'REQ-10440', requestStatus: 'DEPLOYED', source: 'INTERNAL', projectName: 'Plant Expansion B',
    taskName: '4.2 Steel', requestor: 'John Dunbar', className: 'Generators', requestedEndDate: '2026-09-15T00:00:00Z' },
  { eqrEquipmentRequestId: 601, requestNumber: 'REQ-10440', requestStatus: 'DEPLOYED', source: 'INTERNAL', projectName: 'Plant Expansion B',
    taskName: '4.2 Steel', requestor: 'John Dunbar', className: 'Generators', requestedEndDate: '2026-09-15T00:00:00Z' },
  { eqrEquipmentRequestId: 602, requestNumber: 'REQ-10431', requestStatus: 'DEPLOYED', source: 'EXTERNAL', customerName: 'Lone Star Paving',
    contactName: 'Ann Lee', className: 'Cranes', requestedEndDate: '2026-12-30T00:00:00Z' },
];
const retStatus = { 8001: 'SHIPPED_TO_YARD', 8002: 'RETURN_IN_PROCESS', 8003: 'DEPLOYED' };
const RET_LINES = () => [
  { id: 8001, eqrEquipmentMasterId: 21, quantity: 1, lineStatus: retStatus[8001] },
  { id: 8002, eqrEquipmentMasterId: 22, quantity: 1, lineStatus: retStatus[8002] },
  { id: 8003, eqrEquipmentMasterId: 23, quantity: 1, lineStatus: retStatus[8003] },
];
const RET_UNITS = {
  8001: [{ equipmentName: 'Generator 100 kVA', className: 'Generators', allocationId: 11, unitNumber: 'GN-0412', unitStatus: 'RENTED' }],
  8002: [{ equipmentName: 'Light tower', className: 'Lighting', allocationId: 12, unitNumber: 'LT-0050', unitStatus: 'RENTED' }],
  8003: [{ equipmentName: 'Air compressor', className: 'Compressors', allocationId: 13, unitNumber: 'AC-0007', unitStatus: 'RENTED' }],
};
const DEPLOYED = [{ requestLineId: 8003, unitRefId: 53, unitType: 'SERIAL', unitIdentifier: 'AC-0007', serialRefId: 53, serialNumber: 'AC-0007',
  lineStatus: 'DEPLOYED', requestId: 601, requestNumber: 'REQ-10440', requestType: 'INTERNAL', projectName: 'Plant Expansion B',
  equipmentName: 'Air compressor', className: 'Compressors', fulfilmentClass: 'S_AND_T', endDate: '2026-09-15T00:00:00Z', overdue: true,
  yardOrgName: 'Houston Yard' }];

function handle(req, res) {
  const p = req.path;
  const q = req.query;
  if (p.endsWith('/views/workbench-requests')) {
    return res.json({ data: q.get('stage') === 'INITIATE' ? PICK_QUEUE : (q.get('stage') === 'RETURN' ? RET_QUEUE : []) });
  }
  if (p.endsWith('/transfer-orders')) {
    const rid = Number(q.get('equipmentRequestId'));
    if (rid === 501) {
      return res.json({ data: [
        { id: 9001, orderNumber: 'TO-778402', orderStatus: 'OPEN', createdDate: '2026-10-29T10:00:00Z' },
        { id: 9002, orderNumber: 'TO-778399', orderStatus: 'OPEN', createdDate: '2026-10-28T10:00:00Z' }] });
    }
    if (rid === 601) return res.json({ data: [{ id: 9101, orderNumber: 'TO-779010', orderStatus: 'OPEN', createdDate: '2026-10-20T10:00:00Z' }] });
    return res.json({ data: [] });
  }
  if (p.endsWith('/transfer-order-lines')) {
    const to = Number(q.get('transferOrderId'));
    const map = { 9001: [7001, 7002], 9002: [7003], 9101: [8001, 8002] };
    return res.json({ data: (map[to] || []).map((id) => ({ requestLineId: id })) });
  }
  if (req.method === 'GET' && p === `${V1}/equipment-requests/501/lines`) return res.json({ data: PICK_LINES() });
  if (req.method === 'GET' && p === `${V1}/equipment-requests/601/lines`) return res.json({ data: RET_LINES() });
  if (p.endsWith('/views/line-detail-units')) {
    const id = Number(q.get('lineId'));
    return res.json({ data: UNITS[id] || RET_UNITS[id] || [] });
  }
  if (req.method === 'GET' && p.endsWith('/serial-refs')) return res.json({ data: SERIAL_REFS[Number(q.get('equipmentId'))] || [] });
  if (p.endsWith('/releaseTOBatch')) {
    const body = req.json();
    return res.json({ results: body.transferOrders.map((t) => ({ toNumber: t.toNumber, status: 'RELEASED' })) });
  }
  if (req.method === 'PATCH' && /\/equipment-requests\/\d+\/lines\/batch$/.test(p)) {
    req.json().lines.forEach((l) => {
      if (l.id in lineStatus) lineStatus[l.id] = l.lineStatus;
      if (l.id in retStatus) retStatus[l.id] = l.lineStatus;
    });
    return res.json({ data: [] });
  }
  if (req.method === 'GET' && p.endsWith('/allocations')) {
    return res.json({ data: Number(q.get('requestLineId')) === 8001 ? [{ id: 1, eqrSerialRefId: 41, allocationStatus: 'ACTIVE' }] : [] });
  }
  if (req.method === 'PATCH' && /\/serial-refs\/\d+$/.test(p)) return res.json({ id: 41, unitStatus: 'AVAILABLE' });
  if (p.endsWith('/views/deployed-units')) {
    const term = q.get('serialNumber') || q.get('q') || '';
    return res.json({ data: DEPLOYED.filter((d) => d.serialNumber === term || (q.get('q') && d.equipmentName.toLowerCase().includes(term.toLowerCase()))),
      recordCount: 1, page: 0, pageSize: 50, totalPages: 1, hasMore: false });
  }
  if (p.endsWith('/returns/plan')) {
    return res.json({ buckets: [{ sourceOrgCode: '005', destOrgCode: '002',
      lines: [{ requestLineId: 8003, itemNumber: 'AC-100', qty: 1 }] }], blocks: [], fAndMLineIds: [] });
  }
  if (p.endsWith('/returns/reserve')) return res.json({ reservedLineIds: req.json().lineIds, replayed: false, rejectedLineIds: [] });
  if (p.endsWith('/transferorders/create')) return res.json({ status: 'ACCEPTED' }, 202);
  if (p.endsWith('/returns/record')) {
    req.json().lineIds.forEach((id) => { if (id in retStatus) retStatus[id] = 'RETURN_IN_PROCESS'; });
    return res.json({ linesPromoted: req.json().lineIds.length });
  }
  return undefined;
}

const short = (w) => `${w.method} ${w.path.replace(V1, '').replace(/^.*\/(releaseTOBatch|transferorders\/create)$/, 'OIC $1')}`;

(async () => {
  const env = await E.start({ port: 19120, handle });
  const { page } = env;
  try {
    // ── Initiate picking ─────────────────────────────────────────────────────────────────────────────────
    T.section('Initiate picking: the queue');
    await env.open('/vp/shell/logistics/picking');
    await page.waitForSelector('.er-pk-queue .er-lg-link');
    T.eq('one row per request in the queue', await page.$$eval('.er-pk-queue .er-lg-link', (b) => b.length), 3);
    T.check('the menu highlights Initiate picking', (await env.text('.er-nav-item--active')).includes('Initiate picking'));
    T.check('the queue was asked for the INITIATE stage', env.calls.some((c) => c.includes('/views/workbench-requests?') && c.includes('stage=INITIATE') && c.includes('size=1000')));
    T.check('a customer request reads as such', (await env.text('.er-pk-queue')).includes('Gulf Coast Builders Customer'));
    await page.fill('.er-search input', 'pipeline');
    await page.waitForTimeout(300);
    T.eq('search narrows the queue', await page.$$eval('.er-pk-queue .er-lg-link', (b) => b.length), 1);
    await page.fill('.er-search input', '');
    await page.waitForTimeout(300);
    await env.shot('picking-queue.png');

    T.section('Initiate picking: open a request');
    await page.click('.er-pk-queue .er-lg-link[data-id="501"]');
    await page.waitForSelector('.er-pk-lines .er-lg-lrow:not(.er-lg-qhead)');
    await page.waitForTimeout(800);
    const lineIds = await page.$$eval('.er-pk-lines input[data-line-id]:not([data-line-id="all"])', (x) => x.map((i) => i.dataset.lineId));
    T.eq('only the lines in picking show (the DRAFT one does not)', lineIds.slice().sort().join(','), '7001,7002,7003,7004');
    const ticked = await page.$$eval('.er-pk-lines input[data-line-id]:checked', (x) => x.map((i) => i.dataset.lineId));
    T.eq('the newest transfer order awaiting release opens ticked', ticked.sort().join(','), '7001,7002');
    T.check('it says what Release will release', (await env.text('.er-lg-actionbar')).includes('Release for picking will release TO-778402'));
    T.check('the damaged serial is an exception with Re-allocate',
      (await env.text('.er-lg-exc')).includes('Serial EX-2207 is DAMAGED') && (await page.$('.er-lg-exc a.er-btn')) !== null);
    T.check('where to pick from (yard, subinventory, locator)', (await env.text('.er-pk-lines')).includes('Houston Yard Available · A-12-04'));
    T.check('the fixed-asset line is marked', (await env.text('.er-pk-lines')).includes('Fixed asset'));
    await env.shot('picking-open.png');

    T.section('Initiate picking: Release for picking');
    env.writes.length = 0;
    await page.click('#pkRelease');
    await page.waitForFunction(() => /released for picking/.test((document.querySelector('.er-lg-banner') || {}).textContent || ''), null, { timeout: 20000 });
    T.eq('calls: Fusion batch release, then the line batch', env.writes.map(short).join(' > '),
      'POST OIC releaseTOBatch > PATCH /equipment-requests/501/lines/batch');
    T.eq('the release names the transfer order, its yard and stops at Pick initiated', JSON.stringify(env.writes[0].body),
      JSON.stringify({ transferOrders: [{ toNumber: 'TO-778402', sourceOrg: '002', autoPickConfirm: false, autoShipConfirm: false }], equipmentRequestId: 501 }));
    T.eq('every line on the released transfer order moves to Pick initiated', JSON.stringify(env.writes[1].body),
      JSON.stringify({ lines: [{ id: 7001, lineStatus: 'PICK_INITIATED' }, { id: 7002, lineStatus: 'PICK_INITIATED' }] }));
    await page.waitForTimeout(500);
    T.check('the released lines stay ticked and Pick and ship is their next step',
      await page.$eval('#pkShip', (b) => !b.disabled && b.classList.contains('er-btn--dark')));
    T.check('it says how many lines it will move', (await env.text('.er-lg-actionbar')).includes('Pick and ship will move 2 lines'));
    await env.shot('picking-released.png');

    T.section('Initiate picking: Pick and ship');
    env.writes.length = 0;
    await page.click('#pkShip');
    await page.waitForFunction(() => document.querySelectorAll('.er-pk-lines .er-lg-stage--shipped').length === 2, null, { timeout: 20000 });
    T.eq('calls: the ship batch only', env.writes.map(short).join(' > '), 'PATCH /equipment-requests/501/lines/batch');
    T.eq('the released lines ship to site', JSON.stringify(env.writes[0].body),
      JSON.stringify({ lines: [{ id: 7001, lineStatus: 'SHIP_TO_SITE' }, { id: 7002, lineStatus: 'SHIP_TO_SITE' }] }));

    // ── Receipt & returns ────────────────────────────────────────────────────────────────────────────────
    T.section('Receipt & returns: the queue');
    await env.open('/vp/shell/logistics/receipt');
    await page.waitForSelector('.er-rc-queue .er-lg-link');
    T.eq('one row per request though the view answers per line', await page.$$eval('.er-rc-queue .er-lg-link', (b) => b.length), 2);
    T.check('the queue was asked for the RETURN stage', env.calls.some((c) => c.includes('/views/workbench-requests?') && c.includes('stage=RETURN')));
    T.check('an overdue return is flagged', (await env.text('.er-rc-queue')).includes('overdue'));
    T.check('class chips', (await env.text('.er-chip-row')).includes('Generators'));
    await env.shot('receipt-queue.png');

    T.section('Receipt & returns: receive at the yard');
    await page.click('.er-rc-queue .er-lg-link[data-id="601"]');
    await page.waitForSelector('.er-rc-lines .er-lg-lrow:not(.er-lg-qhead)');
    await page.waitForTimeout(800);
    T.eq('only the line back at the yard can be ticked', await page.$$eval('.er-rc-lines input[data-line-id]:not([data-line-id="all"]):not(:disabled)', (x) => x.map((i) => i.dataset.lineId).join(',')), '8001');
    T.check('Receive waits for a tick', await page.$eval('#rcReceive', (b) => b.disabled));
    await page.click('.er-rc-lines input[data-line-id="8001"]');
    await page.fill('.er-rc-date input', '2026-10-20');
    await page.dispatchEvent('.er-rc-date input', 'change');
    await page.waitForTimeout(300);
    T.check('the button says how many', (await env.text('#rcReceive')).includes('Receive at yard (1)'));
    await env.shot('receipt-open.png');
    env.writes.length = 0;
    await page.click('#rcReceive');
    await page.waitForFunction(() => !document.querySelector('.er-rc-lines input[data-line-id="8001"]:not(:disabled)'), null, { timeout: 20000 });
    await page.waitForTimeout(500);
    T.eq('calls: close the line, then its unit back to stock', env.writes.map(short).join(' > '),
      'PATCH /equipment-requests/601/lines/batch > PATCH /serial-refs/41');
    T.eq('closed with the actual return date', JSON.stringify(env.writes[0].body),
      JSON.stringify({ lines: [{ id: 8001, lineStatus: 'CLOSED', actualReturnDate: '2026-10-20T00:00:00Z' }] }));
    T.eq('the serial is available again', JSON.stringify(env.writes[1].body), '{"unitStatus":"AVAILABLE"}');

    T.section('Receipt & returns: Direct Return');
    await page.click('#rcDirect');
    await page.waitForSelector('#drQuery input', { state: 'visible' });
    await page.fill('#drQuery input', 'AC-0007');
    await page.press('#drQuery input', 'Enter');
    await page.waitForSelector('.er-dr-grid input[data-row-key]');
    T.check('the scanned serial was looked up exactly first', env.calls.some((c) => c.includes('/views/deployed-units?') && c.includes('serialNumber=AC-0007')));
    T.eq('nothing is ticked for the operator', await page.$$eval('.er-dr-grid input[data-row-key]:checked', (x) => x.length), 0);
    T.check('Return waits for a tick', await page.$eval('#drSubmit', (b) => b.disabled));
    await page.click('.er-dr-grid input[data-row-key="8003:53"]');
    await env.shot('receipt-direct-return.png');
    env.writes.length = 0;
    await page.click('#drSubmit');
    await page.waitForSelector('#directReturnDialog', { state: 'hidden', timeout: 20000 });
    await page.waitForTimeout(500);
    T.eq('calls: plan, reserve, Fusion transfer order, record', env.writes.map(short).join(' > '),
      'POST /requests/601/returns/plan > POST /requests/601/returns/reserve > POST OIC transferorders/create > POST /requests/601/returns/record');
    const oic = env.writes[2].body;
    T.check('an inbound transfer order from the site back to the yard',
      oic.OrderType === 'INBOUND' && oic.supplyRequestLines[0].SourceOrganizationCode === '005' && oic.supplyRequestLines[0].DestinationOrganizationCode === '002'
      && oic.supplyRequestLines[0].requestLineId === 8003);
    T.eq('the reservation is idempotent on the intent', env.writes[1].body.leg + '|' + (env.writes[1].body.idempotencyKey || '').length, 'INBOUND|16');

    T.section('Receipt & returns: Scan from the band');
    await page.click('#rcScan');
    await page.waitForSelector('#drQuery input', { state: 'visible' });
    await page.waitForFunction(() => (document.querySelector('.er-dr-nocam') || {}).textContent, null, { timeout: 15000 });
    const camNote = await env.text('.er-dr-nocam');
    const leftQuery = await page.inputValue('#drQuery input');
    T.check('Direct Return opens cleared, and with no camera here it says why', leftQuery === '' && /camera|viewfinder/i.test(camNote),
      JSON.stringify([leftQuery, camNote]));
    T.check('the camera is not left running', (await page.$('#directReturnVideo')) === null);
    await page.click('#directReturnDialog .er-btn--plain:has-text("Cancel")');
    await page.waitForSelector('#directReturnDialog', { state: 'hidden' });

    T.eq('no browser errors', env.errors.filter((e) => !e.startsWith('warning')).join('\n'), '');
  } catch (e) {
    T.check('run finished', false, e.message);
    console.log('browser errors:\n' + env.errors.join('\n'));
    console.log('last calls:\n' + env.calls.slice(-8).join('\n'));
    await env.shot('logistics-failed.png').catch(() => {});
  } finally {
    console.log('\nscreenshots: ' + require('path').join(require('os').tmpdir(), 'equiprite-e2e'));
    await env.close();
    T.report();
  }
})();
