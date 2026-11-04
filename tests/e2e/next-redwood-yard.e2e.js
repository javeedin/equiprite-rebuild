'use strict';
/*
 * EquipRite Next, the yard and the checks in the Redwood look (your menu, Look), in a real browser against fake data
 * shaped like services/eqp-v1. Each screen is Oracle's own template, on the same data and the same steps as the current
 * look:
 *   - Picking & shipping, Receiving & returns, Transfers and Inspections: Oracle's Smart Search page (oj-sp smart
 *     search page, Smart Search, collection container, oj-table, oj-c buttons, oj-badge), a filter per column (one
 *     narrows the rows), a row opens what it opens under Current (the picking dialog, the panel beside the list, the
 *     transfer's tab, the unit's checklist);
 *   - a transfer's tab, and a unit being inspected: Oracle's general overview page as the header, over the screen's own
 *     body (its badge, actions and in-flow back);
 *   - no browser errors; a screenshot of each screen; Current brings the current look back.
 * Needs `npm run build`. Run: node tests/e2e/next-redwood-yard.e2e.js   (screenshots go to the OS temp folder)
 */
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const ts = (n) => day(n) + 'T00:00:00Z';
const flags = E.ALL_FLAGS.concat(['SHIPPING_DOCUMENTS_ENABLED']);

// ── Picking & shipping (as in next-yard.e2e.js) ─────────────────────────────────────────────────────────────────
const PICK_QUEUE = [
  { eqrEquipmentRequestId: 501, requestNumber: 'REQ-10527', requestStatus: 'IN_PROCESS', source: 'INTERNAL', projectName: 'Plant Expansion B',
    taskName: '1.3 Foundations', requestor: 'John Dunbar', location: 'Pier A', requestedStartDate: ts(-3), requestedEndDate: ts(20) },
  { eqrEquipmentRequestId: 502, requestNumber: 'REQ-10530', requestStatus: 'IN_PROCESS', source: 'INTERNAL', projectName: 'Pipeline North',
    taskName: '2.1 Trenching', requestor: 'Priya Raman', location: 'Odessa camp', requestedStartDate: ts(0), requestedEndDate: ts(30) },
  { eqrEquipmentRequestId: 503, requestNumber: 'REQ-10505', requestStatus: 'IN_PROCESS', source: 'EXTERNAL', customerName: 'Gulf Coast Builders',
    contactName: 'Dana Ortiz', location: 'Galveston', requestedStartDate: ts(5), requestedEndDate: ts(60) },
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
const unit = (name, cls, n, yard, auto) => [Object.assign({ equipmentName: name, className: cls, allocationId: n, unitNumber: name.slice(0, 2).toUpperCase() + '-' + n,
  unitStatus: 'RENTED', unitRefId: 30 + n, unitType: 'SERIAL', allocationMethod: auto ? 'AUTO' : 'MANUAL' }, auto ? { lineSourceInvOrgName: yard } : { sourceInvOrgName: yard })];
const UNITS = {
  7001: unit('CAT 320 Excavator', 'Excavators', 1, 'Houston Yard'), 7002: unit('Komatsu PC210 Excavator', 'Excavators', 2, 'Houston Yard'),
  7003: unit('Light tower', 'Lighting', 3, 'Atlanta Yard', true), 7004: unit('Survey drone', 'Survey', 4, 'Houston Yard'),
  7006: unit('Site office cabin', 'Cabins', 6, 'Houston Yard'), 7101: unit('Trencher T-450', 'Trenchers', 7, 'Atlanta Yard'),
  7201: unit('Crawler crane 80t', 'Cranes', 8, 'Houston Yard'),
};
const PICK_TOS = { 501: [{ id: 9001, orderNumber: 'TO-778402', orderStatus: 'OPEN', createdDate: '2026-10-29T10:00:00Z' },
  { id: 9002, orderNumber: 'TO-778399', orderStatus: 'OPEN', createdDate: '2026-10-28T10:00:00Z' }] };

// ── Receiving & returns ──────────────────────────────────────────────────────────────────────────────────────────
const RET_QUEUE = [
  { eqrEquipmentRequestId: 601, requestNumber: 'REQ-10440', requestStatus: 'DEPLOYED', source: 'INTERNAL', projectName: 'Plant Expansion B',
    taskName: '4.2 Steel', requestor: 'John Dunbar', requestedStartDate: day(-80), requestedEndDate: ts(-45) },
  { eqrEquipmentRequestId: 602, requestNumber: 'REQ-10431', requestStatus: 'DEPLOYED', source: 'EXTERNAL', customerName: 'Lone Star Paving',
    contactName: 'Ann Lee', requestedStartDate: day(-30), requestedEndDate: ts(2) },
  { eqrEquipmentRequestId: 603, requestNumber: 'REQ-10450', requestStatus: 'DEPLOYED', source: 'INTERNAL', projectName: 'Survey West',
    requestor: 'Priya Raman', requestedStartDate: day(-10), requestedEndDate: ts(3) },
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

const YARD_LINES = Object.assign({}, PICK_LINES, RET_LINES);
const statusOf = (id) => pickStatus[id] || retStatus[id];
const yardReq = (rid) => PICK_QUEUE.concat(RET_QUEUE).filter((r) => r.eqrEquipmentRequestId === rid)[0];
const yardDetail = (rid) => {
  const req = yardReq(rid);
  return (YARD_LINES[rid] || []).map((l) => ({ requestId: rid, requestNumber: req.requestNumber, requestStatus: req.requestStatus, lineId: l.id,
    equipmentName: l.name, className: l.cls, quantity: l.qty || 1, lineStatus: statusOf(l.id), allocatedSerial: l.serial || '',
    startDate: (req.requestedStartDate || '').slice(0, 10), endDate: l.end || (req.requestedEndDate || '').slice(0, 10), toNumber: l.to || '',
    inboundToNumber: l.inbound || '', isTransactable: l.tx, isMaintenanceTracked: l.mt, deploymentLocation: req.location || '' }));
};

// ── Inspections: units waiting at a point (their own requests) ────────────────────────────────────────────────
const INSP_DETAIL = {
  901: [{ lineId: 99001, requestId: 901, requestNumber: 'REQ-20901', projectName: 'Pipeline North', equipmentClassId: 10, equipmentSubclassId: 101,
    equipmentName: 'Mobile Crane 50t', className: 'Cranes', quantity: 1, lineStatus: 'PICK_RELEASED', allocatedSerial: 'MC-11', startDate: ts(-2), endDate: ts(40) },
  { lineId: 99002, requestId: 901, requestNumber: 'REQ-20901', projectName: 'Pipeline North', equipmentClassId: 20, equipmentName: 'Generator 100 kVA',
    className: 'Power', quantity: 1, lineStatus: 'PICK_RELEASED', allocatedSerial: 'GN-0419', startDate: ts(4), endDate: ts(40) }],
  902: [{ lineId: 99003, requestId: 902, requestNumber: 'REQ-20902', projectName: 'Plant Expansion B', equipmentClassId: 30, equipmentName: 'Light tower',
    className: 'Lighting', quantity: 1, lineStatus: 'SHIPPED_TO_YARD', allocatedSerial: 'LT-0207', startDate: ts(-30), endDate: ts(-1) }],
};
const MATRIX = [
  { id: 1, equipmentClassId: 10, equipmentSubclassId: 101, inspectionType: 'SHIP_OUT_YARD', isMandatoryFlag: 'Y', isActiveFlag: 'Y' },
  { id: 2, equipmentClassId: 20, equipmentSubclassId: null, inspectionType: 'SHIP_OUT_YARD', isMandatoryFlag: 'Y', isActiveFlag: 'Y' },
  { id: 3, equipmentClassId: 30, equipmentSubclassId: null, inspectionType: 'RECEIVE_YARD', isMandatoryFlag: 'N', isActiveFlag: 'Y' },
];
const CHECKLISTS = {
  10: [{ id: 701, equipmentClassId: 10, questionText: 'Load chart and certificate on board', responseType: 'YES_NO', isMandatoryFlag: 'Y', sequenceNumber: 1 },
    { id: 702, equipmentClassId: 10, questionText: 'Wire rope and hook', responseType: 'PASS_FAIL', isMandatoryFlag: 'Y', sequenceNumber: 2 }],
  20: [{ id: 801, equipmentClassId: 20, questionText: 'Oil and coolant levels', responseType: 'PASS_FAIL', isMandatoryFlag: 'Y', sequenceNumber: 1 }],
  30: [{ id: 901, equipmentClassId: 30, questionText: 'Mast and lamps undamaged', responseType: 'PASS_FAIL', isMandatoryFlag: 'Y', sequenceNumber: 1 }],
};

// ── Transfers ────────────────────────────────────────────────────────────────────────────────────────────────────
const TRF_DETAIL = {
  475: [{ lineId: 4751, requestId: 475, requestNumber: 'REQ-10475', projectName: 'Pipeline North', equipmentName: 'Dump Truck 30t', className: 'Trucks', quantity: 1,
    lineStatus: 'DEPLOYED', allocatedSerial: 'DT-1108' }],
  510: [{ lineId: 5101, requestId: 510, requestNumber: 'REQ-10520', projectName: 'Refinery C', equipmentName: 'Excavator 20t', className: 'Excavators', quantity: 1,
    lineStatus: 'SHIP_TO_SITE', allocatedSerial: 'EX-2201' }],
  560: [{ lineId: 5601, requestId: 560, requestNumber: 'REQ-10560', projectName: 'Harbour Wall', equipmentName: 'Light tower', className: 'Lighting', quantity: 1,
    lineStatus: 'SHIPPED_TO_YARD', allocatedSerial: 'LT-0300' }],
};
const MY_REQUESTS = [
  { eqrEquipmentRequestId: 475, requestNumber: 'REQ-10475', status: 'IN_PROCESS', projectName: 'Pipeline North' },
  { eqrEquipmentRequestId: 510, requestNumber: 'REQ-10520', status: 'IN_PROCESS', projectName: 'Refinery C' },
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
  { id: 320, equipmentRequestId: 510, orderNumber: 'TO-320', orderType: 'OUTBOUND', orderStatus: 'PENDING', sourceOrgId: 1002, destinationOrgId: 3001,
    requestedDate: ts(-1), needByDate: ts(5), createdDate: ts(-1) },
  { id: 330, equipmentRequestId: 560, orderNumber: 'TO-330', orderType: 'INBOUND', orderStatus: 'PENDING', sourceOrgId: 3002, destinationOrgId: 1001,
    requestedDate: ts(-4), needByDate: ts(-1), createdDate: ts(-4) },
];
const TO_LINES = {
  9001: [7001, 7002].map((id) => ({ requestLineId: id })), 9002: [{ requestLineId: 7003 }],
  300: [{ id: 3001, transferOrderId: 300, requestLineId: 4751, lineNumber: 1, quantity: 1, serialNumber: 'DT-1108', lineStatus: 'PENDING' }],
  320: [{ id: 3201, transferOrderId: 320, requestLineId: 5101, lineNumber: 1, quantity: 1, serialNumber: 'EX-2201', lineStatus: 'PENDING' }],
  330: [{ id: 3301, transferOrderId: 330, requestLineId: 5601, lineNumber: 1, quantity: 1, serialNumber: 'LT-0300', lineStatus: 'PENDING' }],
};

function handle(req, res) {
  const p = req.path.replace('/equiprite/v1', '');
  const q = req.query;
  let m;
  if (p.endsWith('/conf-global-settings')) {
    return res.json({ data: flags.map((k) => ({ settingKey: k, settingValue: 'true', settingCategory: 'FEATURE_FLAG', isActiveFlag: 'Y' })) });
  }
  if (p === '/views/workbench-requests') {
    const stage = q.get('stage');
    if (stage === 'INITIATE') return res.json({ data: PICK_QUEUE });
    if (stage === 'RETURN') return res.json({ data: RET_QUEUE });
    if (stage === 'OUTBOUND') return res.json({ data: [{ eqrEquipmentRequestId: 901 }] });
    if (stage === 'INBOUND') return res.json({ data: [{ eqrEquipmentRequestId: 902 }] });
    return res.json({ data: [] });
  }
  if (p === '/views/request-detail-lines') {
    const id = Number(q.get('requestId'));
    return res.json({ data: YARD_LINES[id] ? yardDetail(id) : (INSP_DETAIL[id] || TRF_DETAIL[id] || []) });
  }
  if (p === '/transfer-orders' && req.method === 'GET') {
    if (q.get('equipmentRequestId')) return res.json({ data: PICK_TOS[Number(q.get('equipmentRequestId'))] || [] });
    return res.json({ data: ORDERS, recordCount: ORDERS.length });
  }
  if ((m = /^\/transfer-orders\/(\d+)$/.exec(p)) && req.method === 'GET') {
    const o = ORDERS.find((x) => x.id === Number(m[1]));
    return o ? res.json(o) : res.json({ message: 'Transfer order not found' }, 404);
  }
  if (p === '/transfer-order-lines') {
    const rows = TO_LINES[Number(q.get('transferOrderId'))] || [];
    return res.json({ data: rows, recordCount: rows.length, page: 0, pageSize: 20, totalPages: 1, hasMore: false });
  }
  if (p === '/transfer-history') return res.json({ data: [], recordCount: 0 });
  if (p === '/views/my-requests') return res.json({ data: MY_REQUESTS });
  if (p === '/inv-orgs') return res.json({ data: ORGS, recordCount: ORGS.length });
  if ((m = /^\/equipment-requests\/(\d+)\/lines$/.exec(p)) && req.method === 'GET') {
    return res.json({ data: (YARD_LINES[Number(m[1])] || []).map((l) => ({ id: l.id, eqrEquipmentMasterId: l.master, quantity: l.qty || 1, lineStatus: statusOf(l.id),
      fulfilmentClass: l.fc, isTransactable: l.tx, isMaintenanceTracked: l.mt })) });
  }
  if (p === '/views/line-detail-units') {
    const id = Number(q.get('lineId'));
    if (UNITS[id]) return res.json({ data: UNITS[id] });
    if (RET_UNITS[id]) {
      const l = Object.values(RET_LINES).flat().filter((x) => x.id === id)[0];
      return res.json({ data: [{ equipmentName: l.name, className: l.cls, allocationId: 100 + id, unitNumber: l.serial, unitStatus: 'RENTED',
        allocationMethod: 'MANUAL', sourceInvOrgName: RET_UNITS[id] }] });
    }
    return res.json({ data: [] });
  }
  if ((m = /^\/equipment-requests\/(\d+)$/.exec(p)) && req.method === 'GET') {
    const r = yardReq(Number(m[1])) || {};
    return res.json({ id: Number(m[1]), requestNumber: r.requestNumber || '', deliveryLocationType: 'SITE' });
  }
  if (p === '/allocations' && req.method === 'GET') return res.json({ data: [] });
  if (p === '/serial-refs' && req.method === 'GET') return res.json({ data: [] });
  if (p === '/conf-inspection-details') return res.json({ data: MATRIX, recordCount: MATRIX.length });
  if (p === '/inspection-checklists') {
    const rows = CHECKLISTS[Number(q.get('classId'))] || [];
    return res.json({ data: rows, recordCount: rows.length, page: 0, pageSize: 20, totalPages: 1, hasMore: false });
  }
  if (p === '/inspections' && req.method === 'GET') return res.json({ data: [], recordCount: 0 });
  return undefined;
}

const settle = (page, ms) => page.waitForTimeout(ms || 400);
const look = (page) => page.getAttribute('html', 'data-nx-look');
const css = (page, sel, prop) => page.$eval(sel, (el, p) => getComputedStyle(el).getPropertyValue(p), prop);
/** The visible rows of a Redwood table, as text. */
const tableRows = (page, table) => page.$$eval(table + ' tbody tr, ' + table + ' .oj-table-body-row', (r) => r.filter((x) => x.offsetParent !== null)
  .map((x) => x.innerText.replace(/\s+/g, ' ').trim()).filter((t) => t && !/^(Loading|Nothing)/.test(t)));
/** Oracle's components in a view, each upgraded (oj-complete), or what is missing. */
const upgraded = (page, root, tags) => page.evaluate(([r, ts]) => ts.map((t) => {
  const el = document.querySelector(r + ' ' + t);
  return el && el.classList.contains('oj-complete') ? '' : t + ':' + (el ? el.className : 'missing');
}).filter(Boolean).join(' | '), [root, tags]);
const LIST_TAGS = ['oj-sp-smart-search-page', 'oj-sp-smart-search', 'oj-sp-collection-container', 'oj-table', 'oj-c-button'];
/** The Smart Search filter chips of a view, once all of them are laid out (they show one by one). */
async function chips(page, root, n) {
  const sel = root + ' oj-sp-smart-search .oj-sp-filter-chip-container';
  await page.waitForFunction(([s, k]) => Array.from(document.querySelectorAll(s)).filter((x) => x.innerText.trim()).length >= k, [sel, n], { timeout: 15000 }).catch(() => {});
  await settle(page, 600);
  return (await page.$$eval(sel, (b) => b.map((x) => x.innerText.trim()))).join(',');
}
/** Picks a filter's option as a user does: open its chip, pick, then click the page title (Smart Search applies it as its list closes). */
async function pickFilter(page, root, label, option) {
  await page.click(root + ' oj-sp-smart-search .oj-sp-filter-chip-container:has-text("' + label + '")');
  await page.waitForSelector('text=' + option, { timeout: 10000 });
  const offered = await page.$$eval('[role=option], li', (o) => o.filter((x) => x.offsetParent !== null).map((x) => x.innerText.trim()).filter((t) => /\(\d+\)$/.test(t)));
  await page.click('text=' + option);
  await settle(page, 600);
  await page.click(root + ' oj-sp-smart-search-page h1');
  await settle(page, 800);
  return offered;
}

(async () => {
  const env = await E.start({ port: 19610, handle, app: 'next' });
  const { page } = env;
  const shots = [];
  const errs = () => env.errors.filter((e) => !/404|Failed to load resource/.test(e) && !e.startsWith('warning'));
  try {
    await env.open('/?open=picking');
    await page.waitForSelector('#ydPicking .nx-yd-row[data-id]', { timeout: 30000 });
    T.eq('Current, to start', await look(page), 'current');
    await env.setLook('redwood');

    // ════ Picking & shipping ═══════════════════════════════════════════════════════════════════════════════
    T.section('Picking & shipping: Oracle\'s Smart Search page');
    await page.waitForFunction(() => /REQ-10527/.test((document.querySelector('#ydRwTable') || {}).innerText || ''), null, { timeout: 30000 });
    await page.waitForFunction(() => !/Finding/.test((document.querySelector('#ydRwPicking') || {}).innerText || ''), null, { timeout: 20000 }).catch(() => {});
    await settle(page, 800);
    T.eq('Oracle\'s components, upgraded', await upgraded(page, '#ydRwPicking', LIST_TAGS), '');
    const head = await env.text('#ydRwPicking oj-sp-smart-search-page');
    T.check('the template\'s header: the title and the summary', head.includes('Picking & shipping') && head.includes('7 pieces to get out on 3 requests'), head.slice(0, 200));
    T.check('the current look steps aside', !(await page.$('#ydPicking .nx-yd-tiles')) && !(await page.$('#ydPicking .nx-yd-row[data-id]')));
    let rows = await tableRows(page, '#ydRwTable');
    T.eq('a row per request, late first', rows.map((r) => r.match(/REQ-\d+/)[0]).join(), 'REQ-10527,REQ-10530,REQ-10505');
    T.check('a row: when, request, project, its step as a badge, the yard, the next step', rows[0].includes('3 days late') && rows[0].includes('Plant Expansion B')
      && rows[0].includes('To pick') && rows[0].includes('4 to pick · 1 being picked') && rows[0].includes('Houston Yard, Atlanta Yard') && rows[0].includes('Release 4 pieces for picking'), rows[0]);
    T.eq('the steps are Oracle\'s badges', await page.$$eval('#ydRwTable .oj-badge', (b) => b.map((x) => x.innerText.trim()).join()), 'To pick,Being picked,Ready to ship');
    T.eq('the row steps, as oj-c buttons', await page.$$eval('#ydRwTable oj-c-button[data-act]', (b) => b.map((x) => x.getAttribute('data-number') + ':' + x.getAttribute('data-act')
      + ':' + x.getAttribute('chroming')).join(' ')), 'REQ-10527:release:callToAction REQ-10527:ship:outlined REQ-10530:ship:callToAction');
    T.check('every column fits: no table scrolling sideways', await page.$eval('#ydRwTable .oj-table-scroller', (sc) => sc.scrollWidth <= sc.clientWidth + 1));
    T.eq('the filters are the columns, then Type', await chips(page, '#ydRwPicking', 7), 'Needed,Request,Project or customer,Step,From yard,Next step,Type');
    shots.push(await env.shot('rw-yard-picking.png'));

    T.section('Picking & shipping: a filter narrows the rows');
    const offered = await pickFilter(page, '#ydRwPicking', 'From yard', 'Atlanta Yard (2)');
    T.check('From yard offers the yards, with how many requests', offered.includes('Houston Yard (2)') && offered.includes('Atlanta Yard (2)'), offered.join(' | '));
    await page.waitForFunction(() => !/REQ-10505/.test((document.querySelector('#ydRwTable') || {}).innerText || ''), null, { timeout: 10000 }).catch(() => {});
    await settle(page, 400);
    rows = await tableRows(page, '#ydRwTable');
    T.eq('picked: the requests shipping from that yard', rows.map((r) => r.match(/REQ-\d+/)[0]).join(), 'REQ-10527,REQ-10530');

    T.section('Picking & shipping: a row and its steps open the same dialog');
    await page.click('#ydRwTable oj-c-button[data-act="ship"][data-number="REQ-10530"]');
    await page.waitForSelector('#ydWork .nx-yd-line[data-line]', { timeout: 20000 });
    await settle(page, 300);
    T.eq('Ship: the request\'s dialog, at its step', [await env.text('#ydOpenRequest'), await env.text('#ydWorkTitle .nx-yd-steppill')].join(' | '), 'REQ-10530 | Pick, then ship');
    T.check('… with its step, as on the current look', (await env.text('#ydShip')).includes('Tick the pieces being picked') || (await env.text('#ydShip')).includes('Pick and ship'));
    await page.click('#ydWorkClose');
    await settle(page, 300);
    T.check('closed', !(await page.$('#ydWork')));
    await page.click('#ydRwTable .oj-table-body-row:has-text("REQ-10527") td:nth-child(3)');
    await page.waitForSelector('#ydWork .nx-yd-line[data-line]', { timeout: 20000 });
    await settle(page, 300);
    T.eq('a row: the same dialog, its pieces in picking', await page.$$eval('#ydWork .nx-yd-line[data-line]', (x) => x.map((r) => r.dataset.line).sort().join()), '7001,7002,7003,7004,7006');
    T.check('… its release step and the fixed-asset release, as on the current look', !!(await page.$('#ydStockRelease')) && !!(await page.$('#ydReleaseFm')));
    shots.push(await env.shot('rw-yard-picking-dialog.png'));
    await page.keyboard.press('Escape');
    await settle(page, 300);
    T.check('Escape closes it', !(await page.$('#ydWork')));
    await page.click('#ydRwTable .nx-yd-rw-num[data-number="REQ-10530"]');
    await page.waitForFunction(() => (document.querySelector('.nx-tab--on') || {}).dataset.tabId === 'request:502', null, { timeout: 15000 }).catch(() => {});
    T.eq('the request number opens the request in its own tab', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId), 'request:502');
    await page.click('.nx-tab-btn[data-id="picking"]');
    await settle(page, 400);
    T.check('… and not its dialog', !(await page.$('#ydWork')));

    T.section('Picking & shipping: the tools');
    const before = env.calls.filter((c) => /workbench-requests\?.*stage=INITIATE/.test(c)).length;
    await page.click('#ydRwRefresh');
    await page.waitForFunction((n) => true, before);
    await settle(page, 1200);
    T.check('Refresh reads the queue again', env.calls.filter((c) => /workbench-requests\?.*stage=INITIATE/.test(c)).length > before);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#ydRwExport')]);
    T.check('Export to Excel: what the table shows', /^equiprite-picking-\d{4}-\d{2}-\d{2}\.xlsx$/.test(dl.suggestedFilename()), dl.suggestedFilename());
    T.check('the header\'s action: Open in New EquipRite', (await env.text('#ydRwPicking oj-sp-smart-search-page')).includes('Open in New EquipRite'));

    // ════ Receiving & returns ═══════════════════════════════════════════════════════════════════════════════
    T.section('Receiving & returns: Oracle\'s Smart Search page');
    await page.click('[data-nav-id="returns"]');
    await page.waitForFunction(() => /REQ-10440/.test((document.querySelector('#ydrRwTable') || {}).innerText || ''), null, { timeout: 30000 });
    await page.waitForFunction(() => !/Finding/.test((document.querySelector('#ydRwReturns') || {}).innerText || ''), null, { timeout: 20000 }).catch(() => {});
    await settle(page, 800);
    T.eq('Oracle\'s components, upgraded', await upgraded(page, '#ydRwReturns', LIST_TAGS), '');
    const rhead = await env.text('#ydRwReturns oj-sp-smart-search-page');
    T.check('the header: the title, the summary, Back without notice', rhead.includes('Receiving & returns') && rhead.includes('6 pieces out or coming back on 3 requests')
      && rhead.includes('Back without notice'), rhead.slice(0, 240));
    T.check('the current look steps aside', !(await page.$('#ydReturns .nx-yd-tiles')) && !(await page.$('#ydReturns .nx-yd-row[data-id]')));
    rows = await tableRows(page, '#ydrRwTable');
    T.eq('a row per request, overdue first', rows.map((r) => r.match(/REQ-\d+/)[0]).join(), 'REQ-10440,REQ-10431,REQ-10450');
    T.check('a row: how overdue, request, project, its step, the yard, the next step', rows[0].includes('45 days overdue') && rows[0].includes('Plant Expansion B')
      && rows[0].includes('1 to receive · 1 on the way back · 1 on site') && rows[0].includes('Houston Yard, Atlanta Yard') && rows[0].includes('Receive 1 piece at the yard'), rows[0]);
    T.eq('the steps are Oracle\'s badges', await page.$$eval('#ydrRwTable .oj-badge', (b) => b.map((x) => x.innerText.trim()).join()), 'Overdue,Return requested,On site');
    T.eq('Receive, as an oj-c button', await page.$$eval('#ydrRwTable oj-c-button[data-act]', (b) => b.map((x) => x.getAttribute('data-number') + ':' + x.getAttribute('data-act')
      + ':' + x.getAttribute('chroming')).join(' ')), 'REQ-10440:receive:callToAction');
    T.check('every column fits', await page.$eval('#ydrRwTable .oj-table-scroller', (sc) => sc.scrollWidth <= sc.clientWidth + 1));
    T.eq('the filters are the columns, then Type', await chips(page, '#ydRwReturns', 7), 'Due back,Request,Project or customer,Step,Back to yard,Next step,Type');
    shots.push(await env.shot('rw-yard-returns.png'));

    T.section('Receiving & returns: a filter narrows the rows');
    const nextOffered = await pickFilter(page, '#ydRwReturns', 'Next step', 'Receive at the yard (1)');
    T.eq('Next step offers the yard\'s next steps, with how many requests', nextOffered.filter((t) => /^(Receive|Raise|Due|Record|Coming|Start)/.test(t)).join(' | '),
      'Due back (1) | Raise the return transfer order (1) | Receive at the yard (1)');
    await page.waitForFunction(() => !/REQ-10431/.test((document.querySelector('#ydrRwTable') || {}).innerText || ''), null, { timeout: 10000 }).catch(() => {});
    await settle(page, 400);
    T.eq('picked: the request with something to receive', (await tableRows(page, '#ydrRwTable')).map((r) => r.match(/REQ-\d+/)[0]).join(), 'REQ-10440');

    T.section('Receiving & returns: a row opens the same panel, as a drawer');
    await page.click('#ydrRwTable oj-c-button[data-act="receive"]');
    await page.waitForSelector('#ydrWork .nx-yd-line[data-line]', { timeout: 20000 });
    await settle(page, 400);
    T.eq('Receive 1: the request\'s panel, shipped back first', await page.$$eval('#ydrWork .nx-yd-line[data-line]', (x) => x.map((r) => r.dataset.line).join()), '8001,8002,8003');
    T.eq('… only what is back at the yard can be ticked, and received there', await page.$$eval('#ydrWork input[data-line-id]:not(:disabled)', (x) => x.map((i) => i.dataset.lineId).join())
      + ' | ' + (await page.$eval('#ydrReceive', (b) => b.disabled)), '8001 | true');
    T.check('… a drawer at the window\'s end edge, over the table', await page.$eval('#ydrWork', (s) => {
      const r = s.getBoundingClientRect();
      return getComputedStyle(s).position === 'fixed' && Math.abs(r.right - window.innerWidth) <= 1 && r.width > 400;
    }));
    shots.push(await env.shot('rw-yard-returns-open.png'));
    await page.click('#ydrRwTable oj-c-button[data-act="receive"]').catch(() => {});
    await settle(page, 300);
    T.check('its step again leaves it open', await page.isVisible('#ydrWork'));
    await page.click('#ydrClose');
    await settle(page, 300);
    T.check('Close shuts it', !(await page.$('#ydrWork')));
    await page.click('#ydrRwTable .oj-table-body-row:has-text("REQ-10440") td:nth-child(3)');
    await page.waitForSelector('#ydrWork .nx-yd-line[data-line]', { timeout: 20000 });
    T.check('a row opens it too', await page.isVisible('#ydrWork'));
    await page.click('#ydrRwTable .oj-table-body-row:has-text("REQ-10440") td:nth-child(3)');
    await settle(page, 400);
    T.check('… and the row again closes it, as on the current look', !(await page.$('#ydrWork')));

    T.section('Receiving & returns: the header\'s action');
    await page.click('#ydRwReturns oj-sp-smart-search-page button:has-text("Back without notice")');
    await page.waitForSelector('#ydrFind #ydrQuery input', { state: 'visible', timeout: 10000 });
    T.check('Back without notice: the unit search, in the drawer', (await env.text('#ydrFind')).includes('Back without notice'));
    shots.push(await env.shot('rw-yard-returns-find.png'));
    await page.click('#ydrFindClose');
    await settle(page, 300);
    T.check('closed', !(await page.$('#ydrFind')));

    // ════ Transfers ═════════════════════════════════════════════════════════════════════════════════════════
    T.section('Transfers: Oracle\'s Smart Search page');
    await page.click('[data-nav-id="transfers"]');
    await page.waitForFunction(() => /TO-330/.test((document.querySelector('#trfRwTable') || {}).innerText || ''), null, { timeout: 30000 });
    await page.waitForFunction(() => !document.querySelector('#trfRwReading'), null, { timeout: 20000 }).catch(() => {});
    await settle(page, 800);
    T.eq('Oracle\'s components, upgraded', await upgraded(page, '#trfRwList', LIST_TAGS), '');
    const thead = await env.text('#trfRwList oj-sp-smart-search-page');
    T.check('the header: the title, the summary, Move equipment between projects (in New)', thead.includes('Transfers') && thead.includes('3 transfers · 2 on the way · 1 late')
      && thead.includes('Move equipment between projects (in New)'), thead.slice(0, 240));
    T.check('the current look steps aside', !(await page.isVisible('.nx-trf-page .nx-pagehead')) && !(await page.$('.nx-grid--trf')));
    rows = await tableRows(page, '#trfRwTable');
    T.eq('a row per transfer, what is still open first, the most overdue first', rows.map((r) => r.match(/TO-\d+/)[0]).join(), 'TO-330,TO-320,TO-300');
    T.check('a row: the transfer and its kind, the request, from where to where, what is moving, where it is, how late', rows[0].includes('Back to the yard')
      && rows[0].includes('REQ-10560') && rows[0].includes('LOUISIANA') && rows[0].includes('Light tower · LT-0300') && rows[0].includes('1 unit')
      && rows[0].includes('On the way back to the yard') && rows[0].includes('1 day late'), rows[0]);
    T.eq('where it is: Oracle\'s badges', await page.$$eval('#trfRwTable .oj-badge', (b) => b.length), 3);
    T.check('every column fits', await page.$eval('#trfRwTable .oj-table-scroller', (sc) => sc.scrollWidth <= sc.clientWidth + 1));
    T.eq('the filters are the columns, then Kind', await chips(page, '#trfRwList', 7), 'Transfer,Request,From → to,What is moving,Where it is,Due,Kind');
    shots.push(await env.shot('rw-yard-transfers.png'));

    T.section('Transfers: a filter narrows the rows');
    const kindsOffered = await pickFilter(page, '#trfRwList', 'Kind', 'Back to the yard (1)');
    T.check('Kind offers the kinds, with how many', kindsOffered.includes('Out to site (2)') && kindsOffered.includes('Back to the yard (1)'), kindsOffered.join(' | '));
    await page.waitForFunction(() => !/TO-320/.test((document.querySelector('#trfRwTable') || {}).innerText || ''), null, { timeout: 10000 }).catch(() => {});
    await settle(page, 400);
    T.eq('picked: the returns', (await tableRows(page, '#trfRwTable')).map((r) => r.match(/TO-\d+/)[0]).join(), 'TO-330');

    // ════ A transfer ════════════════════════════════════════════════════════════════════════════════════════
    T.section('A transfer: a row opens it in its own tab, under Oracle\'s header');
    await page.click('#trfRwTable .oj-table-body-row:has-text("TO-330") td:nth-child(3)');
    await page.waitForFunction(() => (document.querySelector('.nx-tab--on') || {}).dataset.tabId === 'transfer:330', null, { timeout: 15000 });
    await page.waitForSelector('#trfRwHead:not([hidden]) oj-sp-general-overview-page.oj-complete', { timeout: 20000 });
    await page.waitForFunction(() => /TO-330/.test(Array.from(document.querySelectorAll('#trfRwHead')).filter((x) => x.offsetParent !== null).map((x) => x.innerText).join('')),
      null, { timeout: 15000 });
    await settle(page, 600);
    T.eq('as from the current look: the transfer\'s tab', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId + '=' + t.innerText.trim()), 'transfer:330=TO-330');
    const rec = await env.text('#trfRwHead:visible');
    T.check('Oracle\'s general overview page: the transfer, the kind and its request, where it is as its badge, Refresh', rec.includes('TO-330')
      && rec.includes('Back to the yard · REQ-10560 · Harbour Wall') && rec.includes('On the way back to the yard') && rec.includes('Refresh'), rec);
    T.check('… the badge is Oracle\'s', await page.$$eval('#trfRwHead', (hs) => hs.some((h) => h.offsetParent !== null && /On the way back/.test(
      Array.from(h.querySelectorAll('[class*="badge"]')).map((b) => b.innerText).join('|')))));
    T.check('the current head steps aside; the body stays: from where to where, what is moving', !(await page.$('#trfPill:visible'))
      && (await env.text('#trfFrom:visible')).includes('LOUISIANA') && (await env.text('#trfTo:visible')).includes('Houston yard')
      && (await page.$$eval('.nx-grid--trfunits:visible .nx-row[data-line]', (r) => r.length)) === 1);
    shots.push(await env.shot('rw-yard-transfer.png'));
    const reads = env.calls.filter((c) => /\/transfer-orders\/330/.test(c)).length;
    await page.click('#trfRwHead:visible button:has-text("Refresh")');
    await page.waitForFunction((n) => true, reads);
    await settle(page, 1200);
    T.check('the header\'s Refresh reads the transfer again', env.calls.filter((c) => /\/transfer-orders\/330/.test(c)).length > reads);
    // Oracle's header keeps its other actions in its overflow menu.
    const more = await page.$$('#trfRwHead:visible oj-sp-general-overview-page button[aria-label*="more" i], #trfRwHead:visible oj-sp-general-overview-page button[aria-label*="overflow" i]');
    T.check('the other actions in the header\'s overflow menu', more.length > 0, await page.$$eval('#trfRwHead button', (b) => b.map((x) => x.getAttribute('aria-label') + '/' + x.innerText.trim()).join(' | ')));
    if (more.length) {
      await more[0].click();
      await page.waitForSelector('text=Export to Excel', { state: 'visible', timeout: 10000 });
      const menu = await page.$$eval('[role=menuitem]', (m) => m.filter((x) => x.offsetParent !== null).map((x) => x.innerText.trim()).join(' | '));
      T.check('… Export to Excel, and its work in New EquipRite', menu.includes('Export to Excel') && menu.includes('Ship or receive the return in New'), menu);
      const [tdl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('[role=menuitem]:has-text("Export to Excel")')]);
      T.check('… Export to Excel: what is on the transfer', /to-330.*\.xlsx$/i.test(tdl.suggestedFilename()), tdl.suggestedFilename());
    }
    const back = await page.$$('#trfRwHead:visible oj-sp-general-overview-page [aria-label="Back"], #trfRwHead:visible oj-sp-general-overview-page [aria-label*="back" i]');
    T.check('in-flow back, as a record from a list', back.length > 0);
    if (back.length) {
      await back[0].click();
      await page.waitForFunction(() => (document.querySelector('.nx-tab--on') || {}).dataset.tabId === 'transfers', null, { timeout: 10000 }).catch(() => {});
      T.eq('… back to Transfers, as it was left', [await page.$eval('.nx-tab--on', (t) => t.dataset.tabId), (await tableRows(page, '#trfRwTable')).length].join(), 'transfers,1');
    }

    // ════ Inspections ═══════════════════════════════════════════════════════════════════════════════════════
    T.section('Inspections: the queue, Oracle\'s Smart Search page');
    await page.click('[data-nav-id="inspection"]');
    await page.waitForFunction(() => /Mobile Crane 50t/.test((document.querySelector('#inspRwTable') || {}).innerText || ''), null, { timeout: 30000 });
    await settle(page, 800);
    T.eq('Oracle\'s components, upgraded', await upgraded(page, '#inspRwQueue', LIST_TAGS), '');
    const ihead = await env.text('#inspRwQueue oj-sp-smart-search-page');
    T.check('the header: the title and the summary', ihead.includes('Inspections') && ihead.includes('3 units to inspect · 2 leaving the yard · 1 back at the yard · 1 late'), ihead.slice(0, 240));
    T.check('the current queue steps aside', !(await page.$('.nx-insp-unit')) && !(await page.isVisible('.nx-insp-page .nx-pagehead')));
    rows = await tableRows(page, '#inspRwTable');
    T.eq('a row per unit, in the queue\'s order', rows.map((r) => r.match(/(Light tower|Mobile Crane 50t|Generator 100 kVA)/)[0]).join(), 'Light tower,Mobile Crane 50t,Generator 100 kVA');
    const crane = rows.filter((r) => /Mobile Crane/.test(r))[0];
    T.check('a row: the unit, its request, its inspection as a badge, how late, asked for', crane.includes('Mobile Crane 50t · MC-11') && crane.includes('REQ-20901')
      && crane.includes('Leaving the yard') && crane.includes('2 days late') && crane.includes('Asked for') && crane.includes('Inspect'), crane);
    T.eq('the points are Oracle\'s badges', await page.$$eval('#inspRwTable .oj-badge', (b) => b.map((x) => x.innerText.trim()).join()), 'Back at the yard,Leaving the yard,Leaving the yard');
    T.eq('the filters are the columns, then Which units', await chips(page, '#inspRwQueue', 5), 'Equipment,Request,Inspection,When,Which units');
    shots.push(await env.shot('rw-yard-inspections.png'));

    T.section('Inspections: a filter narrows the rows');
    const pointsOffered = await pickFilter(page, '#inspRwQueue', 'Inspection', 'Leaving the yard (2)');
    T.check('Inspection offers the chips, with how many', pointsOffered.includes('Late (1)') && pointsOffered.includes('Back at the yard (1)'), pointsOffered.join(' | '));
    await page.waitForFunction(() => !/Light tower/.test((document.querySelector('#inspRwTable') || {}).innerText || ''), null, { timeout: 10000 }).catch(() => {});
    await settle(page, 400);
    T.eq('picked: the units leaving the yard', (await tableRows(page, '#inspRwTable')).map((r) => r.match(/(Light tower|Mobile Crane 50t|Generator 100 kVA)/)[0]).join(),
      'Mobile Crane 50t,Generator 100 kVA');

    T.section('Inspections: a row opens the unit\'s checklist, under Oracle\'s header');
    await page.click('#inspRwTable .oj-table-body-row:has-text("Mobile Crane 50t") td:nth-child(2)');
    await page.waitForSelector('.nx-insp-q[data-item="701"]', { timeout: 20000 });
    await page.waitForSelector('#inspRwUnit:not([hidden]) oj-sp-general-overview-page.oj-complete', { timeout: 20000 });
    await settle(page, 600);
    const unitHead = await env.text('#inspRwUnit');
    T.check('the header: the unit, the point and its request, the point as its badge, its request as an action', unitHead.includes('Mobile Crane 50t · MC-11')
      && unitHead.includes('Leaving the yard · asked for by the matrix · Cranes · REQ-20901 · Pipeline North') && unitHead.includes('Open REQ-20901'), unitHead);
    T.eq('as from the current look: the whole checklist', await page.$$eval('.nx-insp-q', (q) => q.map((x) => x.dataset.item).join()), '701,702');
    T.check('the queue steps aside, the checklist takes the width', !(await page.isVisible('#inspRwQueue')) && await page.isVisible('#inspComplete')
      && await page.$eval('.nx-insp-main', (m) => m.getBoundingClientRect().width > 800));
    await page.click('.nx-insp-ans[data-item="701"][data-value="YES"]');
    await settle(page, 200);
    T.check('an answer is taken, as on the current look', (await env.text('#inspProgress')).startsWith('1 of 2 answered'), await env.text('#inspProgress'));
    shots.push(await env.shot('rw-yard-inspection-unit.png'));
    await page.click('#inspRwUnit button:has-text("Open REQ-20901")');
    await page.waitForFunction(() => (document.querySelector('.nx-tab--on') || {}).dataset.tabId === 'request:901', null, { timeout: 15000 }).catch(() => {});
    T.eq('the header\'s action opens the request in its own tab', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId), 'request:901');
    await page.click('.nx-tab-btn[data-id="inspection"]');
    await settle(page, 400);
    T.check('… and the checklist is as it was left', (await env.text('#inspProgress')).startsWith('1 of 2 answered'));
    const iback = await page.$$('#inspRwUnit oj-sp-general-overview-page [aria-label="Back"], #inspRwUnit oj-sp-general-overview-page [aria-label*="back" i]');
    T.check('in-flow back to the queue', iback.length > 0);
    if (iback.length) {
      await iback[0].click();
      await page.waitForFunction(() => { const q = document.querySelector('#inspRwQueue'); return q && !q.hidden; }, null, { timeout: 10000 }).catch(() => {});
      T.check('… the queue again, the unit closed', await page.isVisible('#inspRwTable') && !(await page.$('.nx-insp-q')));
    }
    await page.click('#inspRwTable oj-c-button[data-line="99002"]');
    await page.waitForSelector('.nx-insp-q[data-item="801"]', { timeout: 20000 });
    T.check('Inspect opens the unit too', (await env.text('#inspRwUnit')).includes('Generator 100 kVA'));

    T.eq('no browser errors', errs().join(' | ').slice(0, 1500), '');

    T.section('Current brings the current look back');
    await env.setLook('current');
    await page.waitForSelector('.nx-insp-unit', { timeout: 15000 });
    T.check('Current: the current queue beside the unit, the Redwood views kept hidden', (await look(page)) === 'current' && !(await page.isVisible('#inspRwQueue'))
      && !(await page.isVisible('#inspRwUnit')) && await page.isVisible('.nx-insp-page .nx-pagehead') && await page.isVisible('#inspUnitTitle'));
    await page.click('.nx-tab-btn[data-id="picking"]');
    await page.waitForSelector('#ydPicking .nx-yd-row[data-id]', { state: 'visible', timeout: 15000 });
    T.check('… and on Picking & shipping: its tiles and list', !(await page.isVisible('#ydRwPicking')) && await page.isVisible('#ydPicking .nx-yd-tiles'));
    await page.click('.nx-tab-btn[data-id="transfers"]');
    await page.waitForSelector('.nx-grid--trf .nx-row--click', { state: 'visible', timeout: 15000 });
    T.check('… and on Transfers', !(await page.isVisible('#trfRwList')) && await page.isVisible('.nx-trf-page .nx-pagehead'));
    shots.push(await env.shot('rw-yard-current.png'));
    T.eq('no browser errors after switching back', errs().join(' | ').slice(0, 1500), '');
    console.log('\nscreenshots:\n  ' + shots.join('\n  '));
  } catch (e) {
    T.check('run finished', false, String((e && e.stack) || e).slice(0, 1500));
    console.log('browser errors:\n' + env.errors.join('\n'));
    await env.shot('rw-yard-failed.png').catch(() => {});
  } finally {
    await env.close();
    T.report();
  }
})();
