'use strict';
/*
 * Inspection and Inter-project transfer in a real browser, against fake data shaped like services/eqp-v1:
 *   - inspection at tablet size: the queue, one question at a time, a failed question logged as a defect with a
 *     camera photo, FAIL -> the calls that record it; then the next unit passes and is cleared to ship
 *   - transfer: From and To side by side, a submitted timesheet blocks a unit, the other one moves: plan,
 *     reserve, order, line, history
 * Needs `npm run build`. Run: node tests/e2e/operations.e2e.js   (screenshots go to the OS temp folder)
 */
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// ── Inspection data ──────────────────────────────────────────────────────────────────────────────────────────
const WB = (id, number, project) => ({ eqrEquipmentRequestId: id, requestNumber: number, requestStatus: 'IN_PROCESS', projectName: project,
  taskName: '2.1', requestor: 'John Dunbar', requestedStartDate: '2026-11-01T00:00:00Z', requestedEndDate: '2026-12-15T00:00:00Z', totalLines: 2 });
const DETAIL = {
  501: [
    { lineId: 9001, requestId: 501, requestNumber: 'REQ-10505', requestStatus: 'IN_PROCESS', projectName: 'Pipeline North', taskName: '2.1',
      equipmentMasterId: 61, equipmentClassId: 10, equipmentSubclassId: 101, equipmentName: 'Mobile Crane 50t', className: 'Cranes',
      quantity: 1, lineStatus: 'PICK_RELEASED', allocatedSerial: 'MC-11', startDate: '2026-11-03T00:00:00Z', endDate: '2026-12-15T00:00:00Z' },
    { lineId: 9002, requestId: 501, requestNumber: 'REQ-10505', requestStatus: 'IN_PROCESS', projectName: 'Pipeline North', taskName: '2.1',
      equipmentMasterId: 62, equipmentClassId: 20, equipmentSubclassId: 201, equipmentName: 'Generator 100 kVA', className: 'Power',
      quantity: 1, lineStatus: 'PICK_RELEASED', allocatedSerial: 'GN-0419', startDate: '2026-11-04T00:00:00Z', endDate: '2026-12-15T00:00:00Z' },
    { lineId: 9006, requestId: 501, requestNumber: 'REQ-10505', equipmentClassId: 10, equipmentName: 'Mobile Crane 50t', lineStatus: 'DEPLOYED' },
  ],
  502: [
    { lineId: 9003, requestId: 502, requestNumber: 'REQ-10510', projectName: 'Plant Expansion B', equipmentClassId: 30, equipmentName: 'Light tower',
      className: 'Lighting', quantity: 1, lineStatus: 'SHIPPED_TO_YARD', allocatedSerial: 'LT-0207' },
  ],
};
const MATRIX = [
  { id: 1, equipmentClassId: 10, equipmentSubclassId: 101, inspectionType: 'SHIP_OUT_YARD', frequencyDays: 0, isMandatoryFlag: 'Y', isActiveFlag: 'Y', equipmentClassName: 'Cranes' },
  { id: 2, equipmentClassId: 20, equipmentSubclassId: null, inspectionType: 'SHIP_OUT_YARD', frequencyDays: 0, isMandatoryFlag: 'Y', isActiveFlag: 'Y', equipmentClassName: 'Power' },
  { id: 3, equipmentClassId: 30, equipmentSubclassId: null, inspectionType: 'RECEIVE_YARD', frequencyDays: 0, isMandatoryFlag: 'N', isActiveFlag: 'Y', equipmentClassName: 'Lighting' },
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
};

// ── Transfer data ────────────────────────────────────────────────────────────────────────────────────────────
const DEPLOYED_ROWS = [
  { eqrEquipmentRequestId: 475, requestNumber: 'REQ-10475', requestStatus: 'DEPLOYED', projectName: 'Pipeline North', taskName: '2.1', location: 'Odessa TX',
    requestedStartDate: '2026-10-01T00:00:00Z', requestedEndDate: '2026-11-30T00:00:00Z', eqrRequestLineId: 4751, equipmentName: 'Dump Truck 30t', className: 'Trucks', quantity: 1, allocatedSerial: 'DT-1108' },
  { eqrEquipmentRequestId: 475, requestNumber: 'REQ-10475', requestStatus: 'DEPLOYED', projectName: 'Pipeline North', taskName: '2.1', location: 'Odessa TX',
    eqrRequestLineId: 4752, equipmentName: 'Dump Truck 30t', className: 'Trucks', quantity: 1, allocatedSerial: 'DT-1112' },
  { eqrEquipmentRequestId: 402, requestNumber: 'REQ-10402', requestStatus: 'DEPLOYED', projectName: 'Plant Expansion B', taskName: '1.1', location: 'Baton Rouge LA',
    eqrRequestLineId: 4021, equipmentName: 'Generator 60 kVA', className: 'Power', quantity: 1, allocatedSerial: 'GN-0388' },
];
const OUTBOUND_ROWS = [
  { eqrEquipmentRequestId: 527, requestNumber: 'REQ-10527', requestStatus: 'IN_PROCESS', projectName: 'Plant Expansion B', taskName: '1.3', location: 'Baton Rouge LA',
    requestedStartDate: '2026-11-03T00:00:00Z', requestedEndDate: '2026-12-20T00:00:00Z', eqrRequestLineId: 5271, equipmentName: 'Dump Truck 30t', className: 'Trucks', quantity: 1 },
  { eqrEquipmentRequestId: 530, requestNumber: 'REQ-10530', requestStatus: 'IN_PROCESS', projectName: 'Refinery C', taskName: '4', location: 'Corpus Christi TX',
    eqrRequestLineId: 5301, equipmentName: 'Excavator 20t', className: 'Excavators', quantity: 1 },
];
const TRF_DETAIL = {
  475: [
    { lineId: 4751, requestId: 475, requestNumber: 'REQ-10475', requestStatus: 'DEPLOYED', projectName: 'Pipeline North', equipmentMasterId: 77, equipmentClassId: 5,
      equipmentName: 'Dump Truck 30t', className: 'Trucks', quantity: 1, lineStatus: 'DEPLOYED', allocatedSerial: 'DT-1108', startDate: '2026-10-01T00:00:00Z', endDate: '2026-11-30T00:00:00Z' },
    { lineId: 4752, requestId: 475, requestNumber: 'REQ-10475', requestStatus: 'DEPLOYED', projectName: 'Pipeline North', equipmentMasterId: 77, equipmentClassId: 5,
      equipmentName: 'Dump Truck 30t', className: 'Trucks', quantity: 1, lineStatus: 'DEPLOYED', allocatedSerial: 'DT-1112', startDate: '2026-10-01T00:00:00Z', endDate: '2026-11-30T00:00:00Z' },
  ],
  527: [
    { lineId: 5271, requestId: 527, requestNumber: 'REQ-10527', requestStatus: 'IN_PROCESS', projectName: 'Plant Expansion B', equipmentMasterId: 77, equipmentClassId: 5,
      equipmentName: 'Dump Truck 30t', className: 'Trucks', quantity: 1, lineStatus: 'IN_PROCESS', startDate: '2026-11-03T00:00:00Z', endDate: '2026-12-20T00:00:00Z' },
  ],
};
const HISTORY = [
  { id: 41, transferOrderId: 880, orderNumber: 'INV-TX 882104', transferDate: '2026-10-22T00:00:00Z', equipmentName: 'Generator 60 kVA', serialNumber: 'GN-0388',
    sourceRequestNumber: 'REQ-10402', sourceProjectName: 'Pipeline North', destinationRequestNumber: 'REQ-10466', destinationProjectName: 'Plant Expansion B',
    transferStatus: 'COMPLETED', transferredBy: 'a.khan', sourceRequestId: 402 },
];

const posted = { inspection: 0, response: 0 };
function handle(req, res) {
  const p = req.path.replace('/equiprite/v1', '');
  const q = req.query;
  // inspection
  if (p === '/views/workbench-requests') {
    const stage = q.get('stage');
    if (stage === 'OUTBOUND') return res.json({ data: [WB(501, 'REQ-10505', 'Pipeline North'), WB(501, 'REQ-10505', 'Pipeline North')].concat(OUTBOUND_ROWS) });
    if (stage === 'INBOUND') return res.json({ data: [WB(502, 'REQ-10510', 'Plant Expansion B')] });
    if (stage === 'DEPLOYED') return res.json({ data: DEPLOYED_ROWS });
  }
  if (p === '/views/request-detail-lines') {
    const id = Number(q.get('requestId'));
    return res.json({ data: DETAIL[id] || TRF_DETAIL[id] || [] });
  }
  if (p === '/conf-inspection-details') return res.json({ data: MATRIX, recordCount: MATRIX.length });
  if (p === '/inspection-checklists') {
    const rows = CHECKLISTS[Number(q.get('classId'))] || [];
    return res.json({ data: rows, recordCount: rows.length, page: 0, pageSize: 20, totalPages: 1, hasMore: false });
  }
  if (p === '/inspections' && req.method === 'GET') return res.json({ data: [], recordCount: 0, page: 0, pageSize: 20, totalPages: 0, hasMore: false });
  if (p === '/inspections' && req.method === 'POST') return res.json(Object.assign({ id: 7000 + (++posted.inspection) }, req.json(), { objectVersionNumber: 1 }), 201);
  if (/^\/inspections\/\d+$/.test(p) && req.method === 'PATCH') return res.json(Object.assign({ id: Number(p.split('/')[2]) }, req.json()));
  if (p === '/inspection-responses' && req.method === 'POST') return res.json(Object.assign({ id: 80000 + (++posted.response) }, req.json()), 201);
  if (p === '/inspection-defects' && req.method === 'POST') return res.json(Object.assign({ id: 9101 }, req.json()), 201);
  if (req.path === '/common/documents/v1' && req.method === 'POST') return res.json({ doc_id: 55, application_code: 'EQUIP_RITE', entity_type: 'EQR_INSPECTION_DEFECT', entity_id: 9101 }, 201);
  if (/^\/equipment-requests\/\d+\/lines\/batch$/.test(p) && req.method === 'PATCH') return res.json({ data: req.json().lines });
  // transfers
  if (p === '/inv-orgs') return res.json({ data: [
    { invOrgId: 1, organizationId: 3001, organizationCode: 'TEXAS', organizationName: 'Texas project sites', status: 'ACTIVE' },
    { invOrgId: 2, organizationId: 3002, organizationCode: 'LOUISIANA', organizationName: 'Louisiana project sites', status: 'ACTIVE' }] });
  if (p === '/transfer-history' && req.method === 'GET') {
    const id = Number(q.get('equipmentRequestId') || 0);
    const rows = id ? HISTORY.filter((h) => h.sourceRequestId === id || h.destinationRequestId === id) : HISTORY;
    return res.json({ data: rows, recordCount: rows.length, page: 0, pageSize: 20, totalPages: 1, hasMore: false });
  }
  if (p === '/transfer-orders' && req.method === 'GET') {
    return res.json({ data: Number(q.get('equipmentRequestId')) === 475
      ? [{ id: 300, equipmentRequestId: 475, orderNumber: 'TO-300', orderType: 'OUTBOUND', orderStatus: 'RECEIVED', sourceOrgId: 1001, destinationOrgId: 3001, createdDate: '2026-09-28T00:00:00Z' }]
      : [], recordCount: 1 });
  }
  if (p === '/transfer-order-lines' && req.method === 'GET') {
    return res.json({ data: Number(q.get('transferOrderId')) === 300
      ? [{ id: 3001, transferOrderId: 300, requestLineId: 4751, lineNumber: 1, quantity: 1, serialNumber: 'DT-1108' },
        { id: 3002, transferOrderId: 300, requestLineId: 4752, lineNumber: 2, quantity: 1, serialNumber: 'DT-1112' }]
      : [], recordCount: 2, page: 0, pageSize: 20, totalPages: 1, hasMore: false });
  }
  if (p === '/views/timesheet-details') return res.json({ data: [
    { eqrTimeEntryId: 1000000007, timesheetStatus: 'SUBMITTED', entryStatus: 'SUBMITTED', weekStartDate: '2026-10-26', weekEndDate: '2026-11-01',
      requestNumber: 'REQ-10475', requestLineId: 4752, equipmentName: 'Dump Truck 30t', totalHours: 40 }] });
  if (/^\/requests\/527\/transfer-orders\/plan$/.test(p)) return res.json({
    buckets: [{ bucketKey: 'YARD1|LOUISIANA', sourceOrgId: 1001, sourceOrgCode: 'YARD1', sourceOrgName: 'Houston yard', destOrgId: 3002, destOrgCode: 'LOUISIANA',
      destOrgName: 'Louisiana project sites', fromFallbackYard: false, lines: [{ requestLineId: 5271, lineNumber: 1, equipmentName: 'Dump Truck 30t', itemNumber: 'EQ-DT30', lineClass: 'S_AND_T', qty: 1 }] }],
    blocks: [], empty: false, fAndMLineIds: [] });
  if (/^\/requests\/527\/transfer-orders\/reserve$/.test(p)) return res.json({ reservedLineIds: req.json().lineIds, rejectedLineIds: [], replayed: false });
  if (p === '/transfer-orders' && req.method === 'POST') return res.json(Object.assign({ id: 900 }, req.json()), 201);
  if (p === '/transfer-order-lines' && req.method === 'POST') return res.json(Object.assign({ id: 901 }, req.json()), 201);
  if (p === '/transfer-history' && req.method === 'POST') {
    const row = Object.assign({ id: 902 }, req.json());
    HISTORY.unshift(row);
    return res.json(row, 201);
  }
  return undefined;
}

const short = (w) => w.method + ' ' + w.path.replace('/equiprite/v1', '');

(async () => {
  const env = await E.start({ port: 19130, handle, width: 1180 });
  const { page } = env;
  const shots = [];
  try {
    // ════ Inspection, at tablet size ═══════════════════════════════════════════════════════════════════════
    T.section('inspection: the queue');
    await page.setViewportSize({ width: 1180, height: 820 });
    await env.open('/vp/shell/operations/inspection');
    await page.waitForSelector('.er-insp-unit', { timeout: 30000 });
    T.eq('check-out lists the picked units the matrix asks for, earliest first',
      await page.$$eval('.er-insp-unit .er-insp-unit-name', (els) => els.map((e) => e.textContent.trim()).join(' | ')), 'Mobile Crane 50t · MC-11 | Generator 100 kVA · GN-0419');
    T.check('the band counts what is leaving', (await env.text('.er-band-sub')).startsWith('2 leaving'));
    T.check('the menu marks Inspection as the open item, without an Old or Planned tag',
      (await page.$eval('.er-nav-item[data-nav-id="inspection"]', (e) => e.className + '|' + e.textContent.trim())) === 'er-nav-item er-nav-item--active|Inspection');
    T.eq('Transfers is a built item too', await page.$eval('.er-nav-item[data-nav-id="transfer"]', (e) => e.textContent.trim()), 'Transfers');
    await page.click('.er-insp-modes button[data-mode="in"]');
    await page.waitForTimeout(300);
    T.eq('check-in lists the unit on its way back', await env.text('.er-insp-list'), 'Light tower · LT-0207 REQ-10510 · Receive at yard · Plant Expansion B Required');
    await page.click('.er-insp-modes button[data-mode="out"]');
    await page.waitForTimeout(300);

    T.section('inspection: one question at a time');
    await page.click('.er-insp-unit[data-line="9001"]');
    await page.waitForSelector('.er-insp-q');
    T.check('question 1 of 4, big buttons', (await env.text('.er-insp-q-count')).startsWith('QUESTION 1 OF 4') || (await env.text('.er-insp-q-count')).startsWith('Question 1 of 4'));
    const btn = await page.$eval('.er-insp-ans', (b) => b.getBoundingClientRect().height);
    T.check('answer buttons are at least 64px tall', btn >= 64, String(btn));
    await page.click('.er-insp-ans[data-value="YES"]');
    await page.waitForTimeout(250);
    T.eq('a good answer moves on', await env.text('.er-insp-q-text'), 'Wire rope and hook');
    await page.click('.er-insp-ans[data-value="FAIL"]');
    await page.waitForSelector('.er-insp-fault');
    await page.fill('.er-insp-fault input[type="text"]', 'Two broken wires near drum end');
    await page.dispatchEvent('.er-insp-fault input[type="text"]', 'change');
    await page.click('.er-insp-fault button');
    await page.waitForSelector('.er-insp-defect');
    T.eq('the defect starts from the question and its note',
      await page.$eval('.er-insp-defect input[data-field="description"]', (i) => i.value), 'Wire rope and hook: Two broken wires near drum end');
    T.eq('a required question\'s defect starts as major', await page.$eval('.er-insp-defect button[data-value="MAJOR"]', (b) => b.getAttribute('aria-pressed')), 'true');
    await page.setInputFiles('.er-insp-defect .er-insp-file', { name: 'wire-rope.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForSelector('.er-insp-photo img');
    T.check('the photo shows on the defect', !!(await page.$('.er-insp-photo img')));
    shots.push(await env.shot('operations-inspection-defect.png'));
    await page.click('.er-insp-nav button[data-step="next"]');
    await page.waitForTimeout(250);
    await page.fill('.er-insp-num', '52');
    await page.dispatchEvent('.er-insp-num', 'change');
    await page.waitForTimeout(150);
    await page.click('.er-insp-nav button[data-step="next"]');
    await page.waitForTimeout(250);
    await page.click('.er-insp-ans[data-value="4"]');
    await page.waitForSelector('.er-insp-review');

    T.section('inspection: review and complete (FAIL)');
    T.eq('the result follows the answers and the defect', await env.text('#resultTitle'), 'Fail: cannot ship');
    T.check('it says why, and where the work order is raised', (await env.text('.er-insp-reasons')).includes('Wire rope and hook: Fail')
      && (await env.text('.er-insp-fail-note')).includes('Oracle Maintenance'));
    T.check('the score', (await env.text('.er-insp-result')).includes('score 75%'));
    shots.push(await env.shot('operations-inspection-review.png'));
    env.writes.length = 0;
    await page.click('.er-insp-complete');
    await page.waitForSelector('.er-insp-done', { timeout: 20000 });
    await page.waitForTimeout(300);
    T.eq('calls: inspection, 4 answers, the defect, its photo, completed, the line',
      env.writes.map(short).join(' > '),
      'POST /inspections > POST /inspection-responses > POST /inspection-responses > POST /inspection-responses > POST /inspection-responses'
      + ' > POST /inspection-defects > POST /common/documents/v1 > PATCH /inspections/7001 > PATCH /equipment-requests/501/lines/batch');
    const w = env.writes;
    T.eq('the inspection: the line, the point, in progress', JSON.stringify([w[0].body.requestLineId, w[0].body.inspectionType, w[0].body.inspectionStatus]), '[9001,"SHIP_OUT_YARD","IN_PROGRESS"]');
    T.eq('the answers', w.slice(1, 5).map((x) => x.body.checklistId + '=' + x.body.responseValue + '/' + x.body.responseResult).join(','),
      '701=YES/PASS,702=FAIL/FAIL,703=52/PASS,704=4/PASS');
    T.eq('the defect', JSON.stringify([w[5].body.inspectionId, w[5].body.checklistId, w[5].body.severity, w[5].body.defectDescription]),
      '[7001,702,"MAJOR","Wire rope and hook: Two broken wires near drum end"]');
    T.check('the photo is a multipart upload on the defect', typeof w[6].body === 'string' && w[6].body.includes('"entity_type":"EQR_INSPECTION_DEFECT"')
      && w[6].body.includes('"entity_id":9101') && w[6].body.includes('wire-rope.png'));
    T.eq('completed FAIL', JSON.stringify([w[7].body.inspectionStatus, w[7].body.overallResult]), '["COMPLETED","FAIL"]');
    T.eq('the line is marked Inspection failed', JSON.stringify(w[8].body), '{"lines":[{"id":9001,"lineStatus":"INSPECTION_FAILED"}]}');
    T.check('the done card says what happens next', (await env.text('.er-insp-done')).includes('raise it in Oracle Maintenance'));
    shots.push(await env.shot('operations-inspection-done.png'));

    T.section('inspection: the next unit passes');
    await page.click('.er-insp-done button[data-line="9002"]');
    await page.waitForSelector('.er-insp-q');
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.waitForTimeout(300);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    T.check('portrait tablet: nothing runs off the side', wide <= 820, String(wide));
    shots.push(await env.shot('operations-inspection-portrait.png'));
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.waitForTimeout(200);
    await page.click('.er-insp-ans[data-value="PASS"]');
    await page.waitForTimeout(200);
    await page.click('.er-insp-ans[data-value="YES"]');
    await page.waitForSelector('.er-insp-review');
    T.eq('PASS', await env.text('#resultTitle'), 'Pass: cleared to ship');
    env.writes.length = 0;
    await page.click('.er-insp-complete');
    await page.waitForSelector('.er-insp-done', { timeout: 20000 });
    await page.waitForTimeout(300);
    T.eq('no defect calls; cleared to ship', env.writes.map(short).join(' > '),
      'POST /inspections > POST /inspection-responses > POST /inspection-responses > PATCH /inspections/7002 > PATCH /equipment-requests/501/lines/batch');
    T.eq('... EQP_INSPECTION_COMPLETE', env.writes[4].body.lines[0].lineStatus, 'EQP_INSPECTION_COMPLETE');
    T.check('the queue is empty now', (await env.text('.er-insp-queue')).includes('Nothing here needs an inspection'));

    // ════ Transfers ════════════════════════════════════════════════════════════════════════════════════════
    T.section('transfers: from and to side by side');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await env.open('/vp/shell/operations/transfers');
    await page.waitForSelector('.er-trf-req[data-side="source"]', { timeout: 30000 });
    T.eq('From lists the requests with deployed equipment', await page.$$eval('.er-trf-req[data-side="source"] strong', (e) => e.map((x) => x.textContent.trim()).join(' | ')),
      'REQ-10475 · Pipeline North · 2.1 | REQ-10402 · Plant Expansion B · 1.1');
    T.check('recent transfers are listed', (await env.text('.er-trf-grid')).includes('INV-TX 882104'));
    await page.click('.er-trf-req[data-id="475"]');
    await page.waitForSelector('.er-trf-unit');
    T.eq('both trucks, at their site', await page.$$eval('.er-trf-unit strong', (e) => e.map((x) => x.textContent.trim()).join(' | ')), 'Dump Truck 30t · DT-1108 | Dump Truck 30t · DT-1112');
    T.check('the site comes from the outbound transfer order', (await env.text('.er-trf-unit >> nth=0')).includes('TEXAS · Texas project sites'));
    T.check('the submitted timesheet is flagged on the unit', (await env.text('.er-trf-unit >> nth=1')).includes('Submitted timesheet'));
    T.eq('To lists only requests waiting for a dump truck', await page.$$eval('.er-trf-req[data-side="dest"] strong', (e) => e.map((x) => x.textContent.trim()).join(' | ')),
      'REQ-10527 · Plant Expansion B · 1.3');
    await page.check('.er-trf-unit input[data-line="4752"]');
    await page.waitForTimeout(250);
    await page.click('.er-trf-req[data-id="527"]');
    await page.waitForSelector('.er-trf-wait');
    await page.fill('input[data-field="date"]', '2026-11-05');
    await page.dispatchEvent('input[data-field="date"]', 'change');
    await page.waitForTimeout(300);
    T.check('a submitted timesheet stops that unit', (await env.text('.er-trf-problems')).includes('must be approved before this transfer can go through'));
    T.eq('... and the button', await page.$eval('.er-trf-go', (b) => b.disabled), true);
    await page.uncheck('.er-trf-unit input[data-line="4752"]');
    await page.check('.er-trf-unit input[data-line="4751"]');
    await page.fill('input[data-field="comments"]', 'Pipeline North finished early');
    await page.dispatchEvent('input[data-field="comments"]', 'change');
    await page.fill('input[data-field="locator"]', 'PRJ-2026-014');
    await page.dispatchEvent('input[data-field="locator"]', 'change');
    await page.waitForTimeout(300);
    T.eq('what moves', await env.text('.er-trf-pair'), 'Dump Truck 30t · DT-1108 REQ-10475 · 1 Oct – 30 Nov 2026 REQ-10527 · Dump Truck 30t 3 Nov – 20 Dec 2026');
    T.eq('the button says what it does', await env.text('.er-trf-go'), 'Transfer 1 item');
    T.eq('... and is ready', await page.$eval('.er-trf-go', (b) => b.disabled), false);
    shots.push(await env.shot('operations-transfer-ready.png'));
    env.writes.length = 0;
    await page.click('.er-trf-go');
    await page.waitForSelector('.er-trf-done', { timeout: 20000 });
    await page.waitForTimeout(300);
    T.eq('calls: plan, reserve, the order, its line, the history', env.writes.map(short).join(' > '),
      'POST /requests/527/transfer-orders/plan > POST /requests/527/transfer-orders/reserve > POST /transfer-orders > POST /transfer-order-lines > POST /transfer-history');
    const t = env.writes;
    T.eq('plan for the destination line', JSON.stringify(t[0].body), '{"lineIds":[5271],"fallbackYardOrgId":null}');
    T.check('reserve: OUTBOUND leg, a key and a batch', t[1].body.leg === 'OUTBOUND' && /^[0-9a-f]{16}$/.test(t[1].body.idempotencyKey) && /^EQR-TRF-REQ-10527-\d+$/.test(t[1].body.batchNumber));
    T.eq('the order: inter-project, pending, Texas site to Louisiana site', JSON.stringify([t[2].body.equipmentRequestId, t[2].body.orderType, t[2].body.orderStatus,
      t[2].body.sourceOrgId, t[2].body.destinationOrgId, t[2].body.requestedDate, t[2].body.shippingNotes]),
    '[527,"INTER_PROJECT","PENDING",3001,3002,"2026-11-05T00:00:00Z","Pipeline North finished early"]');
    T.eq('its line', JSON.stringify([t[3].body.transferOrderId, t[3].body.requestLineId, t[3].body.serialNumber, t[3].body.itemNumber]), '[900,5271,"DT-1108","EQ-DT30"]');
    T.eq('the history, on both requests', JSON.stringify([t[4].body.sourceRequestId, t[4].body.sourceRequestLineId, t[4].body.destinationRequestId,
      t[4].body.destinationRequestLineId, t[4].body.destinationLocator, t[4].body.transferStatus]), '[475,4751,527,5271,"PRJ-2026-014","PENDING"]');
    T.check('writes carry the audit header path through the dev server', t.length === 5);
    T.check('it says the move is pending in Fusion', (await env.text('.er-trf-done')).includes('pending the inter-org transfer in Fusion'));
    await page.waitForTimeout(300);
    T.eq('afterwards no unit is left ticked', await page.$$eval('.er-trf-unit input', (els) => els.filter((e) => e.checked).length), 0);
    T.check('the moved unit shows its pending transfer and cannot be ticked again',
      (await env.text('.er-trf-unit >> nth=0')).includes('Transfer pending') && await page.$eval('.er-trf-unit input[data-line="4751"]', (e) => e.disabled));
    T.check('the transfer is in the history of both requests and in the recent list',
      (await env.text('.er-trf-side >> nth=0')).includes('REQ-10475 Pipeline North → REQ-10527 Plant Expansion B')
      && (await env.text('.er-trf-side >> nth=1')).includes('REQ-10475 Pipeline North → REQ-10527 Plant Expansion B')
      && (await env.text('.er-trf-grid')).includes('Dump Truck 30t · DT-1108'));
    shots.push(await env.shot('operations-transfer-done.png'));

    T.eq('no browser errors', env.errors.filter((e) => !e.startsWith('warning')).join('\n'), '');
    console.log('\nscreenshots:\n  ' + shots.join('\n  '));
  } catch (e) {
    T.check('run finished', false, e.message);
    await env.shot('operations-failed.png').catch(() => {});
    console.log(env.errors.join('\n'));
  } finally {
    await env.close();
    T.report();
  }
})();
