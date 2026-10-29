'use strict';
/*
 * Usage & cost in a real browser: Time entry (save a week, submit it), Timesheet approval (approve a week, adjust
 * hours with an audit entry), Post costs (preview, review, post a week to Fusion PPM) and Direct cost & inventory
 * (record a material issue), against a fake backend.
 * Needs `npm run build`. Run: node tests/e2e/usage.e2e.js   (screenshots go to the OS temp folder, or E2E_SHOTS)
 */
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const strip = (p) => p.replace('/equiprite/v1', '');

// ── fake data ──────────────────────────────────────────────────────────
const WEEK = '2026-10-26';
const PREV = '2026-10-19';
const TS_QUEUE = [
  { eqrTimeEntryId: 900, requestNumber: 'REQ-10482', projectName: 'Pipeline North', taskName: 'Trenching', equipCount: 2, totalHours: 40, billAmount: 7000, weekStartDate: WEEK, weekEndDate: '2026-11-01', timesheetStatus: 'DRAFT' },
  { eqrTimeEntryId: 870, requestNumber: 'REQ-10475', projectName: 'Plant Expansion B', taskName: 'Civil', equipCount: 1, totalHours: 0, billAmount: 0, weekStartDate: WEEK, weekEndDate: '2026-11-01', timesheetStatus: 'SUBMITTED' },
];
function tsDetails(week) {
  const base = { requestNumber: 'REQ-10482', projectName: 'Pipeline North', taskName: 'Trenching', isRentable: 'Y', className: 'Excavators',
    requestedStartDate: '2026-10-01T00:00:00Z', requestedEndDate: '2026-12-15T00:00:00Z', weekStartDate: week };
  if (week === PREV) {
    return [Object.assign({}, base, { eqrTimeEntryId: 880, requestLineId: 501, equipmentName: 'CAT 320 Excavator', hoursType: 'USAGE', entryStatus: 'APPROVED',
      day1Hours: 9, day2Hours: 9, day3Hours: 9, day4Hours: 9, day5Hours: 4, day6Hours: 0, day7Hours: 0, totalHours: 40 })];
  }
  return [
    Object.assign({}, base, { eqrTimeEntryId: 900, requestLineId: 501, equipmentName: 'CAT 320 Excavator', hoursType: 'USAGE', entryStatus: 'DRAFT',
      day1Hours: 8, day2Hours: 8, day3Hours: 8, day4Hours: 8, day5Hours: 8, day6Hours: 0, day7Hours: 0, totalHours: 40, totalBill: 7000 }),
    Object.assign({}, base, { eqrTimeEntryId: null, requestLineId: 502, equipmentName: 'Dump Truck 30t', className: 'Trucks', hoursType: '', entryStatus: null,
      requestedStartDate: '2026-10-28T00:00:00Z', defaultHours: 9, day1Hours: 0, day2Hours: 0, day3Hours: 0, day4Hours: 0, day5Hours: 0, day6Hours: 0, day7Hours: 0, totalHours: 0 }),
  ];
}

const day = (a) => ({ day1Hours: a[0], day2Hours: a[1], day3Hours: a[2], day4Hours: a[3], day5Hours: a[4], day6Hours: a[5], day7Hours: a[6] });
const APPROVALS = [
  Object.assign({ eqrTimeEntryId: 910, requestNumber: 'REQ-10482', projectName: 'Pipeline North', taskName: 'Trenching', requestLineId: 501, equipmentName: 'CAT 320 Excavator',
    hoursType: 'USAGE', entryStatus: 'SUBMITTED', timesheetStatus: 'SUBMITTED', weekStartDate: WEEK, requestedStartDate: '2026-10-01', requestedEndDate: '2026-12-15',
    totalHours: 50, totalBill: 8750, submittedByName: 'Sam Ortiz' }, day([8, 8, 18, 9, 7, 0, 0])),
  Object.assign({ eqrTimeEntryId: 911, requestNumber: 'REQ-10475', projectName: 'Plant Expansion B', taskName: 'Civil', requestLineId: 601, equipmentName: 'Mobile Crane MC-07',
    hoursType: 'USAGE', entryStatus: 'SUBMITTED', timesheetStatus: 'SUBMITTED', weekStartDate: WEEK, requestedStartDate: '2026-10-01', requestedEndDate: '2026-12-15',
    totalHours: 49, totalBill: 12838 }, day([8, 8, 8, 17, 8, 0, 0])),
  Object.assign({ eqrTimeEntryId: 880, requestNumber: 'REQ-10482', projectName: 'Pipeline North', taskName: 'Trenching', requestLineId: 501, equipmentName: 'CAT 320 Excavator',
    hoursType: 'USAGE', entryStatus: 'APPROVED', timesheetStatus: 'APPROVED', weekStartDate: PREV, requestedStartDate: '2026-10-01', requestedEndDate: '2026-12-15',
    totalHours: 40, totalBill: 7000 }, day([9, 9, 9, 9, 4, 0, 0])),
];

const PC_LIST = [
  { eqrEquipmentRequestId: 4440, requestNumber: 'REQ-10440', projectName: 'Plant Expansion B', taskName: 'Electrical', requestedStartDate: '2026-10-05', requestedEndDate: '2026-12-31',
    timesheets: 3, totalHours: 120, totalBillCost: 4900, weekStartDate: '2026-10-12', ppmProjectNumber: 'PRJ-B', ppmTaskNumber: '4.2', ppmProjectRefId: 3001, ppmTaskRefId: 4001, rateScheduleId: 77 },
  { eqrEquipmentRequestId: 4418, requestNumber: 'REQ-10418', projectName: 'Lone Star Paving', taskName: 'Paving', requestedStartDate: '2026-08-01', requestedEndDate: '2026-09-30',
    timesheets: 8, totalHours: 780, totalBillCost: 44330, weekStartDate: '2026-09-07', ppmProjectNumber: 'PRJ-L', ppmTaskNumber: '1.1' },
];
const pcRow = (o) => Object.assign({ requestNumber: 'REQ-10440', lineType: 'RENTABLE', qty: 1, applicableRate: 200, ratePeriod: 'DAILY', totalHours: 0, postStatus: 'APPROVED' }, o);
const PC_DETAILS = [
  pcRow({ rowKey: '701:0:20261005', requestLineId: 701, equipmentName: 'Generator 100 kVA', weekStartDate: '2026-10-05', weekEndDate: '2026-10-11', costAmount: 1400, postStatus: 'POSTED', lineExpenditureType: 'Equipment Rental' }),
  pcRow({ rowKey: '701:0:20261012', requestLineId: 701, equipmentName: 'Generator 100 kVA', weekStartDate: '2026-10-12', weekEndDate: '2026-10-18', costAmount: 1400, lineExpenditureType: 'Equipment Rental' }),
  pcRow({ rowKey: '701:0:20261019', requestLineId: 701, equipmentName: 'Generator 100 kVA', weekStartDate: '2026-10-19', weekEndDate: '2026-10-25', costAmount: 1400, lineExpenditureType: 'Equipment Rental' }),
  pcRow({ rowKey: '701:0:20270104', requestLineId: 701, equipmentName: 'Generator 100 kVA', weekStartDate: '2027-01-04', weekEndDate: '2027-01-10', costAmount: 1400, lineExpenditureType: 'Equipment Rental' }),
  pcRow({ rowKey: '702:0:20261012', requestLineId: 702, equipmentName: 'Light Tower LT-4', weekStartDate: '2026-10-12', weekEndDate: '2026-10-18', costAmount: 700, applicableRate: 100 }),
];
const PC_MISC = [{ eqrLineMiscTxnId: 55, requestNumber: 'REQ-10440', requestLineId: 701, expenditureType: 'Fuel', expenditureOrg: 'Applications and Services',
  expenditureItemDate: '2026-10-05', quantity: 1, rawCost: 90, status: 'DRAFT', comments: 'Fuel top-up on return' }];
const PC_SPLITS = [
  { requestLineId: 701, weekStartDate: '2026-10-19', projectRefId: 3001, projectNumber: 'PRJ-B', projectName: 'Plant Expansion B', taskId: 4001, taskNumber: '4.2', taskName: 'Electrical', splitPct: 60 },
  { requestLineId: 701, weekStartDate: '2026-10-19', projectRefId: 3002, projectNumber: 'PRJ-C', projectName: 'Pipeline North', taskId: 5001, taskNumber: '2.1', taskName: 'Trenching', splitPct: 40 },
];

const MY_REQUESTS = [
  { eqrEquipmentRequestId: 4482, requestNumber: 'REQ-10482', projectName: 'Pipeline North', taskName: 'Trenching', status: 'DEPLOYED' },
  { eqrEquipmentRequestId: 4499, requestNumber: 'REQ-10499', projectName: 'Plant Expansion B', taskName: 'Civil', status: 'DRAFT' },
];
const DC_LINES = [
  { lineId: 801, equipmentName: 'Hydraulic oil 20 L', quantity: 10, lineStatus: 'DELIVERED', consumableFlag: 'Y', deliveredQuantity: 10 },
  { lineId: 802, equipmentName: 'CAT 320 Excavator', quantity: 1, lineStatus: 'DEPLOYED', consumableFlag: 'N' },
  { lineId: 803, equipmentName: 'Old pump', quantity: 1, lineStatus: 'REJECTED', consumableFlag: 'N' },
];

function handle(req, res) {
  const p = req.path;
  if (p.endsWith('/views/my-requests')) return res.json({ data: MY_REQUESTS });
  if (p.endsWith('/views/request-detail-lines') && req.query.get('requestId') === '4482') return res.json({ data: DC_LINES });
  if (p.endsWith('/views/line-detail-units')) return res.json({ data: [{ unitNumber: 'OIL-HYD-20', uomCode: 'EA', invOrgName: 'Houston Yard', invOrgId: 204, unitType: 'INVENTORY', availableToReserve: 40 }] });
  if (p.endsWith('/inventory-consumptions') && req.method === 'GET') return res.json({ data: [{ requestLineId: 801, itemNumber: 'OIL-HYD-20', quantityConsumed: 4, uomCode: 'EA', consumptionType: 'USAGE', transactionDate: '2026-10-29T00:00:00Z' }] });
  if (p.endsWith('/inventory-consumptions') && req.method === 'POST') return res.json({ id: 31 }, 201);
  if (p.endsWith('/direct-cost-txns')) return res.json({ data: [] });
  if (req.method === 'PATCH' && /\/equipment-requests\/\d+\/lines\/\d+$/.test(p)) return res.json({ id: 801 });
  if (p.endsWith('/views/post-cost'))return res.json({ data: PC_LIST });
  if (p.endsWith('/views/post-cost-details')) return res.json({ data: req.query.get('requestNumber') === 'REQ-10440' ? PC_DETAILS : [] });
  if (p.endsWith('/views/misc-transactions')) return res.json({ data: PC_MISC });
  if (p.endsWith('/views/line-retier-weeks')) return res.json({ data: [{ requestLineId: 701, weekStartDate: '2026-10-05', retierPeriod: 'WEEKLY', retierRate: 150, retierCost: 1050 }] });
  if (p.endsWith('/views/line-project-splits')) return res.json({ data: PC_SPLITS });
  if (p.endsWith('/views/blackout-weeks')) return res.json({ data: [] });
  if (p.endsWith('/purchase-requisitions')) return res.json({ data: [], hasMore: false });
  if (p.endsWith('/misc-transactions/post')) return res.json({ updated: 1 });
  if (p.includes('/eqp/post-cost')) return res.json({ status: 'OK' });
  if (p.endsWith('/views/timesheet-approval-details')) return res.json({ data: APPROVALS, hasMore: false });
  if (p.endsWith('/audit-trail') && req.method === 'GET') return res.json({ data: [{ id: 1, entityName: 'EQR_TIME_ENTRY', entityId: 911, action: 'ADJUST_HOURS',
    changedBy: 'lee.chan', changedDate: '2026-11-02T10:00:00Z', oldValues: JSON.stringify({ days: [8, 8, 8, 27, 8, 0, 0] }), changeSummary: 'Thu 29 Oct 27 → 17 h' }] });
  if (p.endsWith('/audit-trail') && req.method === 'POST') return res.json({ id: 2 }, 201);
  if (p.endsWith('/views/project-cost-detail')) return res.json({ data: req.query.get('requestNumber') === 'REQ-10482' ? [{ totalCost: 40000 }, { totalCost: 2300 }] : [{ totalCost: 12000 }] });
  if (p.endsWith('/views/timesheets')) return res.json({ data: TS_QUEUE });
  let m = /\/views\/timesheet-details\/(\d{4}-\d{2}-\d{2})\/([^/]+)$/.exec(p);
  if (m) return res.json({ data: m[2] === 'REQ-10482' ? tsDetails(m[1]) : [] });
  if (p.endsWith('/views/workbench-requests')) return res.json({ data: [{ eqrEquipmentRequestId: 7001, requestNumber: req.query.get('requestNumber') }] });
  if (p.endsWith('/views/request-detail-lines')) return res.json({ data: [{ lineId: 501, billRate: 175, priceUom: 'HOUR' }, { lineId: 502, billRate: 900, priceUom: 'DAY' }] });
  if (req.method === 'POST' && p.endsWith('/time-entries')) return res.json({ id: 901 }, 201);
  if (req.method === 'POST' && p.endsWith('/time-entry-days')) return res.json({ id: 1 }, 201);
  if (req.method === 'PATCH' && /\/time-entries\/\d+$/.test(p)) return res.json({ id: 1 });
  return undefined;
}

(async () => {
  const env = await E.start({ port: 19140, handle, flags: ['PROJECTS_MODULE_ENABLED', 'TIMESHEETS_ENABLED'], shots: process.env.E2E_SHOTS });
  const { page } = env;
  const shots = [];
  try {
    T.section('time entry: the week renders from the timesheet view');
    await env.open('/vp/shell/usage/time-entry?request=REQ-10482&week=' + WEEK);
    await page.waitForSelector('.er-te-row input.er-te-hours', { timeout: 30000 });
    await page.waitForTimeout(800);
    T.check('the week is in the band', (await env.text('.er-band')).includes('26 Oct – 1 Nov 2026'));
    T.check('both lines are rows', (await env.text('.er-te-grid')).includes('CAT 320 Excavator') && (await env.text('.er-te-grid')).includes('Dump Truck 30t'));
    T.eq('a day before the line starts is closed', await page.$eval('input.er-te-hours[data-key="L502"][data-d="0"]', (i) => i.disabled), true);
    T.eq('a new line is filled with its planned hours', await page.$eval('input.er-te-hours[data-key="L502"][data-d="2"]', (i) => i.value), '9');
    T.check('the rate comes from the request line', (await env.text('.er-te-grid')).includes('$175 / HOUR'));
    T.check('week total before saving (40 + 5 × 9)', (await env.text('.er-te-foot')).includes('85'));

    T.section('time entry: keyboard entry and totals before saving');
    await page.click('input.er-te-hours[data-key="L501"][data-d="2"]');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    T.eq('Enter moves to the same day on the next row', await page.evaluate(() => document.activeElement.dataset.key + '/' + document.activeElement.dataset.d), 'L502/2');
    await page.click('input.er-te-hours[data-key="L501"][data-d="0"]');
    await page.keyboard.type('10');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    await page.click('input.er-te-hours[data-key="L501"][data-d="5"]');
    await page.keyboard.type('30');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    T.check('a day over 24 h is flagged before saving', (await env.text('.er-te-problems')).includes('can\'t exceed 24 h'));
    T.eq('...and Save is refused with it', (await page.$$('.er-te-hours--bad')).length, 1);
    await page.click('input.er-te-hours[data-key="L501"][data-d="5"]');
    await page.keyboard.type('0');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    T.check('row total follows the typing', (await env.text('.er-te-row--dirty')).includes('42'));
    T.check('week total follows too', (await env.text('.er-te-foot')).includes('87'));
    shots.push(await env.shot('usage-time-entry.png'));

    T.section('time entry: Save sends the old save chain\'s calls');
    env.writes.length = 0;
    await page.click('.er-te-toolbar button:has-text("Save")');
    await page.waitForFunction(() => !document.querySelector('.er-te-row--dirty'), null, { timeout: 15000 });
    await page.waitForTimeout(500);
    const seq = env.writes.map((w) => w.method + ' ' + strip(w.path));
    T.eq('PATCH the changed entry, its 7 days, then POST the new line and its 7 days',
      seq.join(' > '), ['PATCH /time-entries/900'].concat(Array(7).fill('POST /time-entry-days'), ['POST /time-entries'], Array(7).fill('POST /time-entry-days')).join(' > '));
    T.eq('the changed entry: totals, USAGE, back to DRAFT', JSON.stringify(env.writes[0].body), '{"totalHours":42,"billableHours":42,"entryType":"USAGE","status":"DRAFT"}');
    T.eq('day 1 carries the typed 10', JSON.stringify(env.writes[1].body), '{"timeEntryId":900,"workDate":"2026-10-26T00:00:00Z","hoursWorked":10}');
    T.eq('the new line is created for the week', JSON.stringify(env.writes[8].body),
      '{"requestLineId":502,"entryDate":"2026-10-26T00:00:00Z","entryType":"USAGE","totalHours":45,"billableHours":45,"status":"DRAFT"}');
    T.eq('...and its days go to the new entry id', env.writes[9].body.timeEntryId, 901);

    T.section('time entry: Submit');
    await page.selectOption('select.er-te-select[data-key="L502"]', 'STANDBY');
    await page.waitForTimeout(300);
    env.writes.length = 0;
    await page.click('button:has-text("for approval")');
    await page.waitForTimeout(2500);
    const subs = env.writes.filter((w) => w.method === 'PATCH' && w.body && w.body.status === 'SUBMITTED');
    T.eq('the ticked draft entry is sent as SUBMITTED, after the save pass', subs.map((w) => strip(w.path)).join(','), '/time-entries/900');
    T.check('submit saved the new line first, with the chosen rate type', env.writes.some((w) => strip(w.path) === '/time-entries' && w.body.entryType === 'STANDBY'));
    T.check('a confirmation is shown', (await page.content()).includes('Timesheet Submitted'));

    T.section('time entry: unsaved hours are never dropped by a week change');
    await page.click('input.er-te-hours[data-key="L501"][data-d="1"]');
    await page.keyboard.type('11');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    await page.click('button[aria-label="Next week"]');
    await page.waitForSelector('.er-te-confirm');
    T.check('moving asks first', (await env.text('.er-te-confirm')).includes('not saved'));
    await page.click('.er-te-confirm button:has-text("Discard changes")');
    await page.waitForTimeout(1200);
    T.check('Discard moves to the next week', (await env.text('.er-band')).includes('2 – 8 Nov 2026'));

    T.section('timesheet approval: variance, week over week, cost impact');
    await env.open('/vp/shell/usage/timesheet-approval');
    await page.waitForSelector('.er-ta-row[role="row"]:not(.er-ta-head)', { timeout: 30000 });
    await page.waitForTimeout(800);
    T.check('the newest week with lines waiting opens', (await env.text('.er-band')).includes('26 Oct – 1 Nov 2026') && (await env.text('.er-band')).includes('2 lines to approve'));
    T.eq('a day over 16 h is red', await page.$$eval('.er-ta-grid .er-ta-day--high', (c) => c.length), 2);
    T.check('an earlier adjustment shows the submitted hours struck through', (await env.text('.er-ta-grid')).includes('27'));
    await page.check('.er-filters input[type="checkbox"]');
    await page.waitForTimeout(300);
    T.check('compare shows the change against last week', (await env.text('.er-ta-grid')).includes('+10 h vs last week'));
    await page.check('input[data-key="E910"]');
    await page.check('input[data-key="E911"]');
    await page.waitForTimeout(500);
    T.check('the band states what approving costs', (await env.text('.er-band')).includes('Approve 2 · $21,588'));
    T.check('cost to date of the ticked requests', (await env.text('.er-u-kpis')).includes('$54,300'));
    shots.push(await env.shot('usage-timesheet-approval.png'));

    T.section('timesheet approval: adjust hours keeps an audit entry');
    await page.click('button[data-key="E910"]');
    await page.waitForSelector('.er-ta-adjust');
    await page.fill('.er-ta-day--edit input[data-d="2"]', '10');
    await page.dispatchEvent('.er-ta-day--edit input[data-d="2"]', 'change');
    await page.fill('.er-ta-reason input', '18 was a typo for 10');
    env.writes.length = 0;
    await page.click('button:has-text("Save adjustment")');
    await page.waitForTimeout(1500);
    const adj = env.writes.map((w) => w.method + ' ' + strip(w.path));
    T.eq('PATCH the hours (no status), the 7 days, then the audit entry',
      adj.join(' > '), ['PATCH /time-entries/910'].concat(Array(7).fill('POST /time-entry-days'), ['POST /audit-trail']).join(' > '));
    T.eq('the line keeps its status', JSON.stringify(env.writes[0].body), '{"totalHours":42,"billableHours":42}');
    const audit = env.writes[8] && env.writes[8].body;
    T.check('the audit entry holds the submitted and the new hours and the reason',
      audit && audit.entityName === 'EQR_TIME_ENTRY' && audit.entityId === 910 && JSON.parse(audit.oldValues).days[2] === 18
      && JSON.parse(audit.newValues).days[2] === 10 && audit.changeSummary.includes('18 was a typo for 10'), JSON.stringify(audit));

    T.section('timesheet approval: approve sends the old approve chain\'s calls');
    await page.check('input[data-key="E910"]');
    await page.check('input[data-key="E911"]');
    await page.click('.er-band button:has-text("Approve")');
    await page.waitForSelector('.er-u-confirm');
    T.check('approving asks first, with the money', (await env.text('.er-u-confirm')).includes('$21,588'));
    env.writes.length = 0;
    await page.click('.er-u-confirm button:has-text("Approve")');
    await page.waitForTimeout(1500);
    T.eq('one PATCH to APPROVED per entry, request by request',
      env.writes.map((w) => w.method + ' ' + strip(w.path) + ' ' + JSON.stringify(w.body)).join(' > '),
      'PATCH /time-entries/910 {"status":"APPROVED"} > PATCH /time-entries/911 {"status":"APPROVED"}');

    T.section('post costs: the list and the preview render from the views');
    await env.open('/vp/shell/usage/post-costs?request=REQ-10440');
    await page.waitForSelector('.er-pc-row--week', { timeout: 30000 });
    await page.waitForTimeout(800);
    T.check('the list has a row per request with its cost to date', (await env.text('.er-pc-list')).includes('REQ-10418') && (await env.text('.er-pc-list')).includes('$44,330'));
    T.check('the list adds the misc charge to the request', (await env.text('.er-pc-list')).includes('$4,990'));
    const tree = await env.text('.er-pc-tree');
    T.check('a posted week reads Posted, a past week Ready', tree.includes('Posted') && tree.includes('Ready'));
    T.check('a future week is not on the bill', !tree.includes('Jan 4'));
    T.check('a posted week whose tier changed offers Re-tier', tree.includes('Re-tier (reverse)'));
    T.check('a split week shows its split', tree.includes('Split 60 / 40'));
    T.eq('nothing can be posted before ticking', await page.$eval('.er-band .er-btn--primary', (b) => b.disabled), true);

    T.section('post costs: tick, review exactly what goes to Fusion, post');
    await page.check('input[data-action="week"][data-key="701:0:20261012"]');
    await page.check('input[data-action="week"][data-key="701:0:20261019"]');
    await page.click('button[data-action="toggleMiscGroup"]');
    await page.waitForSelector('input[data-action="misc"]');
    await page.check('input[data-action="misc"]');
    await page.waitForTimeout(400);
    T.check('the band states the selection and its money', (await env.text('.er-band')).includes('2 weeks + 1 charge · $2,890'));
    await page.click('.er-band button[data-panel="review"]');
    await page.waitForSelector('.er-pc-review');
    const review = await env.text('.er-pc-review');
    T.check('the review lists each ledger line with days, rate and type', review.includes('7 days at $200/day daily') && review.includes('Equipment Rental'));
    T.check('...where a split week goes', review.includes('60% PRJ-B / 4.2, 40% PRJ-C / 2.1'));
    T.check('...the charge and the total', review.includes('Fuel top-up on return') && review.includes('$2,890'));
    shots.push(await env.shot('usage-post-costs-review.png'));
    env.writes.length = 0;
    await page.click('.er-pc-review button:has-text("Post to Fusion PPM")');
    await page.waitForFunction(() => !document.querySelector('.er-pc-review'), null, { timeout: 15000 });
    await page.waitForTimeout(800);
    T.eq('ledger week, ledger split week, the charges, then the OIC flow',
      env.writes.map((w) => w.method + ' ' + strip(w.path)).join(' > '),
      'POST /posted-weeks > POST /posted-weeks/split > POST /misc-transactions/post > POST /ic/api/integration/v2/flows/rest/project/EQUIPRITE_DEV/EQP_POST_COST_FLOW_TEST/1.0/eqp/post-cost');
    T.eq('the week body is the old ledger body', JSON.stringify(env.writes[0].body),
      '{"requestLineId":701,"weekStartDate":"2026-10-12T00:00:00Z","rowKey":"701:0:20261012","status":"POSTED","entryKind":"ORIGINAL","postedSource":"CP",'
      + '"postedCostAmount":1400,"costRate":200,"periodType":"DAILY","billableDuration":7,"rateScheduleId":77,"expenditureType":"Equipment Rental",'
      + '"reversalRef":"EQR-701-20261012","ppmBatchName":null}');
    T.check('the split week sends percentages, no dollars, and no reversal ref', env.writes[1].body.reversalRef === null
      && JSON.stringify(env.writes[1].body.splits.map((s) => s.splitPct)) === '[60,40]' && !('postedCostAmount' in env.writes[1].body.splits[0]));
    T.eq('the charge ids', JSON.stringify(env.writes[2].body), '{"ids":[55]}');
    T.eq('Fusion is sent the request number only', JSON.stringify(env.writes[3].body), '{"requestNumber":"REQ-10440"}');
    T.check('the result is stated', (await env.text('.er-pc-preview')).includes('sent to Fusion PPM'));
    shots.push(await env.shot('usage-post-costs.png'));

    T.section('direct cost & inventory: record a material issue');
    await env.open('/vp/shell/usage/project-costs?request=REQ-10482');
    await page.waitForSelector('.er-dc-lines .er-result', { timeout: 30000 });
    await page.waitForTimeout(600);
    T.check('only approved or active requests are offered', (await env.text('.er-dc-reqs')).includes('REQ-10482') && !(await env.text('.er-dc-reqs')).includes('REQ-10499'));
    T.eq('a rejected line is not offered', await page.$$eval('.er-dc-lines .er-result', (b) => b.length), 2);
    await page.click('.er-dc-lines .er-result[data-line="801"]');
    await page.waitForTimeout(600);
    T.eq('the line\'s unit fills the item', await page.$eval('input[data-field="itemNumber"]', (i) => i.value), 'OIL-HYD-20');
    await page.fill('input[data-field="quantity"]', '6');
    await page.dispatchEvent('input[data-field="quantity"]', 'change');
    await page.fill('input[data-field="subinventory"]', 'SITE-01');
    await page.dispatchEvent('input[data-field="subinventory"]', 'change');
    await page.waitForTimeout(300);
    T.check('what will be recorded is stated before the click', (await env.text('.er-dc-submit')).includes('Records 6 EA of OIL-HYD-20'));
    env.writes.length = 0;
    await page.click('button:has-text("Record material issue")');
    await page.waitForTimeout(1500);
    T.eq('consumption, then the line\'s consumed quantity', env.writes.map((w) => w.method + ' ' + strip(w.path)).join(' > '),
      'POST /inventory-consumptions > PATCH /equipment-requests/4482/lines/801');
    const cons = env.writes[0] && env.writes[0].body;
    T.check('the old consumption body', cons && cons.equipmentRequestId === 4482 && cons.requestLineId === 801 && cons.itemNumber === 'OIL-HYD-20'
      && cons.quantityConsumed === 6 && cons.uomCode === 'EA' && cons.invOrgId === 204 && cons.consumptionType === 'USAGE'
      && /T00:00:00Z$/.test(cons.transactionDate) && cons.notes === 'Subinventory: SITE-01', JSON.stringify(cons));
    T.eq('consumed quantity is the full set\'s total', JSON.stringify(env.writes[1] && env.writes[1].body), '{"consumedQuantity":4}');
    T.check('the result names what was recorded', (await env.text('.er-dc-form')).includes('6 × OIL-HYD-20 recorded against Hydraulic oil 20 L'));
    await page.click('button[data-tab="direct"]');
    await page.waitForTimeout(300);
    T.check('direct cost says plainly it is not available yet', (await env.text('.er-dc-form')).includes('not available yet'));
    shots.push(await env.shot('usage-project-costs.png'));
  } catch (e) {
    T.check('run finished', false, e.stack || e.message);
    await env.shot('usage-failed.png').catch(() => {});
  } finally {
    T.eq('no browser errors', env.errors.filter((e) => !e.startsWith('warning')).join('\n'), '');
    console.log('screenshots:\n  ' + shots.join('\n  '));
    await env.close();
    T.report();
  }
})();
