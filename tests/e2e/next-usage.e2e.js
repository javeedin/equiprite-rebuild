'use strict';
/*
 * EquipRite Next, Usage & billing, in a real browser against a fake backend:
 *   Timesheets      the requests on site, a week of hours from the keyboard, what is missing, Copy last week, Save and
 *                   Submit (exactly what New EquipRite writes, in its order), export
 *   Approve time    what needs a look first, select what looks right, approve, reject, adjust with an audit entry;
 *                   under Fusion PPM rates approving is left to New EquipRite (nothing written)
 *   Post costs      what is ready and what was posted per request, a request's costs in its own tab, what will be
 *                   posted (amounts, projects, splits), export; opening and reading writes nothing (posting itself:
 *                   tests/e2e/next-posting.e2e.js)
 *   Direct cost     what an active request has used and what is left; recording stays in New EquipRite
 * Each screen: no sideways scroll, no browser errors, a screenshot.
 * Needs `npm run build`. Run: node tests/e2e/next-usage.e2e.js   (screenshots go to the OS temp folder, or E2E_SHOTS)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const strip = (p) => p.replace('/equiprite/v1', '');

// ── dates: this week, as the screens see it ───────────────────────────────────────────────────────────────────
const iso = (d) => d.toISOString().slice(0, 10);
const now = new Date();
const TODAY = iso(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
const addDays = (s, n) => iso(new Date(Date.parse(s + 'T00:00:00Z') + n * 86400000));
const dow = new Date(TODAY + 'T00:00:00Z').getUTCDay();
const WEEK = addDays(TODAY, dow === 0 ? -6 : 1 - dow);
const PREV = addDays(WEEK, -7);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtDate = (s) => { const d = new Date(s + 'T00:00:00Z'); return d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); };
const label = (s) => { const d = new Date(s + 'T00:00:00Z'); return DOW[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MON[d.getUTCMonth()]; };
// The week's name as the screen writes it (resources/js/usageWeeks.js, loaded as it is).
const usageWeeks = (() => {
  let mod;
  const sandbox = { define: (n, f) => { mod = f(); }, Date };
  require('vm').runInNewContext(fs.readFileSync(path.join(E.ROOT, 'webApps', 'equiprite-next', 'resources', 'js', 'usageWeeks.js'), 'utf8'), sandbox);
  return mod;
})();

// ── Timesheets ────────────────────────────────────────────────────────────────────────────────────────────────
const TS_QUEUE = [
  { eqrTimeEntryId: 870, requestNumber: 'REQ-10475', projectName: 'Plant Expansion B', taskName: 'Civil', equipCount: 1, totalHours: 40, billAmount: 0,
    weekStartDate: WEEK, timesheetStatus: 'SUBMITTED' },
  { eqrTimeEntryId: 900, requestNumber: 'REQ-10482', projectName: 'Pipeline North', taskName: 'Trenching', equipCount: 2, totalHours: 40, billAmount: 7000,
    weekStartDate: WEEK, timesheetStatus: 'DRAFT' },
];
function tsDetails(week, request) {
  if (request !== 'REQ-10482') return [];
  const base = { requestNumber: 'REQ-10482', projectName: 'Pipeline North', taskName: 'Trenching', isRentable: 'Y', className: 'Excavators',
    requestedStartDate: addDays(WEEK, -30) + 'T00:00:00Z', requestedEndDate: addDays(WEEK, 45) + 'T00:00:00Z', weekStartDate: week };
  if (week === PREV) {
    return [Object.assign({}, base, { eqrTimeEntryId: 880, requestLineId: 501, equipmentName: 'CAT 320 Excavator', hoursType: 'USAGE', entryStatus: 'APPROVED',
      day1Hours: 9, day2Hours: 9, day3Hours: 9, day4Hours: 9, day5Hours: 4, day6Hours: 0, day7Hours: 0, totalHours: 40 })];
  }
  if (week !== WEEK) return [];
  return [
    Object.assign({}, base, { eqrTimeEntryId: 900, requestLineId: 501, equipmentName: 'CAT 320 Excavator', hoursType: 'USAGE', entryStatus: 'DRAFT',
      day1Hours: 8, day2Hours: 8, day3Hours: 8, day4Hours: 8, day5Hours: 8, day6Hours: 0, day7Hours: 0, totalHours: 40, totalBill: 7000 }),
    Object.assign({}, base, { eqrTimeEntryId: null, requestLineId: 502, equipmentName: 'Dump Truck 30t', className: 'Trucks', hoursType: '', entryStatus: null,
      requestedStartDate: addDays(WEEK, 2) + 'T00:00:00Z', defaultHours: 9, day1Hours: 0, day2Hours: 0, day3Hours: 0, day4Hours: 0, day5Hours: 0,
      day6Hours: 0, day7Hours: 0, totalHours: 0 }),
  ];
}

// ── Approve time ──────────────────────────────────────────────────────────────────────────────────────────────
const day7 = (a) => ({ day1Hours: a[0], day2Hours: a[1], day3Hours: a[2], day4Hours: a[3], day5Hours: a[4], day6Hours: a[5], day7Hours: a[6] });
const appr = (o, days) => Object.assign({ projectName: 'Pipeline North', taskName: 'Trenching', hoursType: 'USAGE', entryStatus: 'SUBMITTED', timesheetStatus: 'SUBMITTED',
  weekStartDate: WEEK, requestedStartDate: addDays(WEEK, -30), requestedEndDate: addDays(WEEK, 45) }, o, day7(days));
const APPROVALS = [
  appr({ eqrTimeEntryId: 910, requestNumber: 'REQ-10482', requestLineId: 501, equipmentName: 'CAT 320 Excavator', totalHours: 50, totalBill: 8750, submittedByName: 'Sam Ortiz' },
    [8, 8, 18, 9, 7, 0, 0]),
  appr({ eqrTimeEntryId: 911, requestNumber: 'REQ-10475', projectName: 'Plant Expansion B', taskName: 'Civil', requestLineId: 601, equipmentName: 'Mobile Crane MC-07',
    totalHours: 43, totalBill: 12838 }, [8, 8, 8, 11, 8, 0, 0]),
  appr({ eqrTimeEntryId: 912, requestNumber: 'REQ-10475', projectName: 'Plant Expansion B', taskName: 'Civil', requestLineId: 602, equipmentName: 'Light Tower LT-4',
    totalHours: 40, totalBill: 2000 }, [8, 8, 8, 8, 8, 0, 0]),
  appr({ eqrTimeEntryId: 913, requestNumber: 'REQ-10482', requestLineId: 503, equipmentName: 'Generator 100 kVA', totalHours: 30, totalBill: 1500 }, [6, 6, 6, 6, 6, 0, 0]),
  appr({ eqrTimeEntryId: 880, requestNumber: 'REQ-10482', requestLineId: 501, equipmentName: 'CAT 320 Excavator', entryStatus: 'APPROVED', timesheetStatus: 'APPROVED',
    weekStartDate: PREV, totalHours: 40, totalBill: 7000 }, [9, 9, 9, 9, 4, 0, 0]),
];
const AUDIT = [{ id: 1, entityName: 'EQR_TIME_ENTRY', entityId: 911, action: 'ADJUST_HOURS', changedBy: 'lee.chan', changedDate: addDays(WEEK, 4) + 'T10:00:00Z',
  oldValues: JSON.stringify({ days: [8, 8, 8, 21, 8, 0, 0] }), changeSummary: 'Thu 21 → 11 h. Reason: typo' }];

// ── Post costs ────────────────────────────────────────────────────────────────────────────────────────────────
const compact = (s) => s.replace(/-/g, '');
const W = (n) => addDays(WEEK, 7 * n);
const listRow = (o) => Object.assign({ eqrEquipmentRequestId: 4440, requestNumber: 'REQ-10440', projectName: 'Plant Expansion B', taskName: 'Electrical',
  requestedStartDate: W(-3), requestedEndDate: W(9), timesheets: 1, totalHours: 40, ppmProjectNumber: 'PRJ-B', ppmTaskNumber: '4.2', ppmProjectRefId: 3001,
  ppmTaskRefId: 4001, rateScheduleId: 77 }, o);
const PC_LIST = [
  listRow({ weekStartDate: W(-3), totalBillCost: 1400 }), listRow({ weekStartDate: W(-2), totalBillCost: 1400 }), listRow({ weekStartDate: W(-1), totalBillCost: 2100 }),
  listRow({ weekStartDate: W(0), totalBillCost: 1400 }), listRow({ weekStartDate: W(10), totalBillCost: 1400 }),
  { eqrEquipmentRequestId: 4418, requestNumber: 'REQ-10418', projectName: 'Lone Star Paving', taskName: 'Paving', requestedStartDate: W(-13), requestedEndDate: W(-5),
    timesheets: 8, totalHours: 320, totalBillCost: 44330, weekStartDate: W(-6), ppmProjectNumber: 'PRJ-L', ppmTaskNumber: '1.1' },
  { eqrEquipmentRequestId: 4401, requestNumber: 'REQ-10401', projectName: 'Harbour Wall', taskName: 'Piling', requestedStartDate: W(3), requestedEndDate: W(8),
    timesheets: 0, totalHours: 0, totalBillCost: 0, weekStartDate: W(3) },
];
const pcRow = (o) => Object.assign({ requestNumber: 'REQ-10440', lineType: 'RENTABLE', qty: 1, applicableRate: 200, ratePeriod: 'DAILY', totalHours: 40, postStatus: 'APPROVED' }, o);
const gen = (week, o) => pcRow(Object.assign({ rowKey: '701:0:' + compact(week), requestLineId: 701, equipmentName: 'Generator 100 kVA', weekStartDate: week,
  weekEndDate: addDays(week, 6), costAmount: 1400, lineExpenditureType: 'Equipment Rental' }, o));
const PC_DETAILS = {
  'REQ-10440': [
    gen(W(-3), { postStatus: 'POSTED' }), gen(W(-2)), gen(W(-1)), gen(W(0)), gen(W(10)),
    pcRow({ rowKey: '702:0:' + compact(W(-1)), requestLineId: 702, equipmentName: 'Light Tower LT-4', weekStartDate: W(-1), weekEndDate: addDays(W(-1), 6), costAmount: 700, applicableRate: 100 }),
  ],
  'REQ-10418': [pcRow({ requestNumber: 'REQ-10418', rowKey: '901:0:' + compact(W(-6)), requestLineId: 901, equipmentName: 'Asphalt Paver', weekStartDate: W(-6),
    weekEndDate: addDays(W(-6), 6), costAmount: 44330, applicableRate: 6333, postStatus: 'POSTED' })],
};
const PC_MISC = [{ eqrLineMiscTxnId: 55, requestNumber: 'REQ-10440', requestLineId: 701, expenditureType: 'Fuel', expenditureOrg: 'Applications and Services',
  expenditureItemDate: W(-3), quantity: 1, rawCost: 90, status: 'DRAFT', comments: 'Fuel top-up on return' }];
const PC_SPLITS = [
  { requestLineId: 701, weekStartDate: W(-1), projectRefId: 3001, projectNumber: 'PRJ-B', projectName: 'Plant Expansion B', taskId: 4001, taskNumber: '4.2', taskName: 'Electrical', splitPct: 60 },
  { requestLineId: 701, weekStartDate: W(-1), projectRefId: 3002, projectNumber: 'PRJ-C', projectName: 'Pipeline North', taskId: 5001, taskNumber: '2.1', taskName: 'Trenching', splitPct: 40 },
];

// ── Direct cost & inventory ───────────────────────────────────────────────────────────────────────────────────
const MY_REQUESTS = [
  { eqrEquipmentRequestId: 4490, requestNumber: 'REQ-10490', projectName: 'Plant Expansion B', taskName: 'Civil', status: 'APPROVED' },
  { eqrEquipmentRequestId: 4491, requestNumber: 'REQ-10491', projectName: 'Pipeline North', taskName: 'Trenching', status: 'DEPLOYED' },
  { eqrEquipmentRequestId: 4499, requestNumber: 'REQ-10499', projectName: 'Plant Expansion B', taskName: 'Civil', status: 'DRAFT' },
];
const DC_LINES = [
  { lineId: 801, equipmentName: 'Hydraulic oil 20 L', quantity: 10, lineStatus: 'DELIVERED', consumableFlag: 'Y', deliveredQuantity: 10 },
  { lineId: 802, equipmentName: 'CAT 320 Excavator', quantity: 1, lineStatus: 'DEPLOYED', consumableFlag: 'N' },
  { lineId: 803, equipmentName: 'Old pump', quantity: 1, lineStatus: 'REJECTED', consumableFlag: 'N' },
];
const COST_DETAIL = {
  'REQ-10482': [{ totalCost: 40000 }, { totalCost: 2300 }],
  'REQ-10475': [{ totalCost: 12000 }],
  'REQ-10491': [{ rowKey: 'h1', costDate: W(-1), equipmentName: 'CAT 320 Excavator', equipmentNumber: 'CAT-0320', quantity: 5, totalCost: 7000, postedStatus: 'POSTED' }],
};

function handle(req, res) {
  const p = req.path;
  const q = (k) => req.query.get(k);
  if (p.endsWith('/views/timesheet-approval-details')) return res.json({ data: APPROVALS, hasMore: false });
  if (p.endsWith('/audit-trail') && req.method === 'GET') return res.json({ data: AUDIT });
  if (p.endsWith('/audit-trail') && req.method === 'POST') return res.json({ id: 2 }, 201);
  if (p.endsWith('/views/project-cost-detail')) return res.json({ data: COST_DETAIL[q('requestNumber')] || [] });
  if (p.endsWith('/views/post-cost')) return res.json({ data: PC_LIST });
  if (p.endsWith('/views/post-cost-details')) return res.json({ data: PC_DETAILS[q('requestNumber')] || [] });
  if (p.endsWith('/views/misc-transactions')) return res.json({ data: q('requestNumber') ? PC_MISC.filter((m) => m.requestNumber === q('requestNumber')) : PC_MISC });
  if (p.endsWith('/views/line-retier-weeks')) return res.json({ data: [] });
  if (p.endsWith('/views/line-project-splits')) return res.json({ data: q('requestNumber') === 'REQ-10440' ? PC_SPLITS : [] });
  if (p.endsWith('/views/blackout-weeks')) return res.json({ data: [] });
  if (p.endsWith('/purchase-requisitions')) return res.json({ data: [], hasMore: false });
  if (p.endsWith('/views/my-requests')) return res.json({ data: MY_REQUESTS });
  if (p.endsWith('/views/request-detail-lines') && q('requestId') === '4491') return res.json({ data: DC_LINES });
  if (p.endsWith('/inventory-consumptions') && req.method === 'GET') {
    return res.json({ data: q('requestId') === '4491' ? [{ id: 31, requestLineId: 801, itemNumber: 'OIL-HYD-20', quantityConsumed: 4, uomCode: 'EA', consumptionType: 'USAGE',
      transactionDate: W(-1) + 'T00:00:00Z', notes: 'Subinventory: SITE' }] : [] });
  }
  if (p.endsWith('/direct-cost-txns')) {
    return res.json({ data: q('requestId') === '4491' ? [{ id: 3, transactionDate: W(-1), expenditureType: 'Fuel', description: 'Diesel delivery', rawCost: 420, status: 'POSTED' }] : [] });
  }
  if (p.endsWith('/views/timesheets')) return res.json({ data: TS_QUEUE });
  const m = /\/views\/timesheet-details\/(\d{4}-\d{2}-\d{2})\/([^/]+)$/.exec(p);
  if (m) return res.json({ data: tsDetails(m[1], m[2]) });
  if (p.endsWith('/views/workbench-requests')) return res.json({ data: [{ eqrEquipmentRequestId: 4482, requestNumber: req.query.get('requestNumber') }] });
  if (p.endsWith('/views/request-detail-lines') && req.query.get('requestId') === '4482' && req.query.get('size') === '10000') {
    return res.json({ data: [{ lineId: 501, billRate: 175, priceUom: 'HOUR' }, { lineId: 502, billRate: 900, priceUom: 'DAY' }] });
  }
  if (req.method === 'POST' && p.endsWith('/time-entries')) return res.json({ id: 901 }, 201);
  if (req.method === 'POST' && p.endsWith('/time-entry-days')) return res.json({ id: 1 }, 201);
  if (req.method === 'PATCH' && /\/time-entries\/\d+$/.test(p)) return res.json({ id: 1 });
  return undefined;
}

async function download(page, button, sel) {
  await page.click(button);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(sel)]);
  const file = path.join(os.tmpdir(), 'next-usage-' + dl.suggestedFilename());
  await dl.saveAs(file);
  return { name: dl.suggestedFilename(), text: fs.readFileSync(file, 'utf8') };
}

async function noSideways(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth
    && [...document.querySelectorAll('.nx-content')].every((c) => c.scrollWidth <= c.clientWidth + 1));
}

const writesSince = (env, n) => env.writes.slice(n).map((w) => w.method + ' ' + strip(w.path) + ' ' + JSON.stringify(w.body));

(async () => {
  const env = await E.start({ port: 19360, handle, app: 'next', flags: ['PROJECTS_MODULE_ENABLED', 'TIMESHEETS_ENABLED'], shots: process.env.E2E_SHOTS });
  const { page } = env;
  try {
    // ════════════════════════════════════════════════════════════════════════════════════════════════════════
    T.section('Timesheets: the requests on site and the week');
    await env.open('/?open=timesheets');
    await page.waitForSelector('.nx-grid--ts input.nx-ts-hours', { timeout: 30000 });
    await page.waitForTimeout(800);
    T.eq('it opens on the first request that still needs its hours, this week', await env.text('#tsSummary'),
      'Week of ' + usageWeeks.weekLabel(WEEK) + ' · REQ-10482 · Pipeline North');
    T.eq('each request says what it still needs', await page.$$eval('.nx-ts-qitem', (b) => b.map((x) => x.dataset.request + ': '
      + x.querySelector('.nx-ts-qnote').innerText.trim()).join(' | ')), 'REQ-10482: Draft, not submitted · 40 h | REQ-10475: Waiting for approval · 40 h');
    T.eq('chips by what is left to do', await page.$$eval('.nx-ts-queue .nx-chip', (c) => c.map((x) => x.innerText.replace(/\s+/g, ' ').trim()).join(' | ')),
      'All 2 | To fill in 1 | Waiting for approval 1 | Approved 0');
    T.check('both lines are rows', (await env.text('.nx-grid--ts')).includes('CAT 320 Excavator') && (await env.text('.nx-grid--ts')).includes('Dump Truck 30t'));
    T.eq('a day before the line starts is closed', await page.$eval('input.nx-ts-hours[data-key="L502"][data-d="0"]', (i) => i.disabled), true);
    T.eq('a new line is filled with its planned hours', await page.$eval('input.nx-ts-hours[data-key="L502"][data-d="2"]', (i) => i.value), '9');
    T.check('the rate comes from the request line', (await env.text('.nx-grid--ts')).includes('$175 / HOUR'));
    T.eq('week total before saving (40 + 5 × 9)', await env.text('#tsWeekTotal'), '85');
    T.check('the rows say where they are, in words', (await env.text('.nx-grid--ts')).includes('Draft, not submitted') && (await env.text('.nx-grid--ts')).includes('Not saved yet'));
    T.check('what is missing: a rate type on the new line', (await env.text('#tsMissing')).includes('Dump Truck 30t: choose a rate type; Submit needs one.'));
    T.check('the planned hours are pointed out', (await env.text('#tsNotice')).includes('planned hours'));
    await env.shot('next-timesheets.png');
    T.check('no sideways scroll', await noSideways(page));

    T.section('Timesheets: keyboard entry, totals, what is missing');
    await page.click('input.nx-ts-hours[data-key="L501"][data-d="2"]');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    T.eq('Enter moves to the same day on the next row', await page.evaluate(() => document.activeElement.dataset.key + '/' + document.activeElement.dataset.d), 'L502/2');
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(150);
    T.eq('Up moves back', await page.evaluate(() => document.activeElement.dataset.key + '/' + document.activeElement.dataset.d), 'L501/2');
    await page.click('input.nx-ts-hours[data-key="L501"][data-d="0"]');
    await page.keyboard.type('0');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    T.check('a weekday with no hours is missing, by name', (await env.text('#tsMissing')).includes('CAT 320 Excavator: no hours on ' + label(WEEK) + '.'));
    T.eq('and its box is marked', await page.$eval('input.nx-ts-hours[data-key="L501"][data-d="0"]', (i) => i.className.includes('nx-ts-hours--gap')), true);
    await page.click('input.nx-ts-hours[data-key="L501"][data-d="0"]');
    await page.keyboard.type('10');
    await page.keyboard.press('Tab');
    await page.click('input.nx-ts-hours[data-key="L501"][data-d="5"]');
    await page.keyboard.type('30');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    T.check('a day over 24 h is named before anything is sent', (await env.text('#tsProblems')).includes(label(addDays(WEEK, 5)) + ' on CAT 320 Excavator: 30 h; a day can\'t exceed 24 h.'));
    T.eq('Save stays shut while a box is wrong (it says why)', await page.$eval('#tsProblems', (e) => !!e), true);
    await page.click('input.nx-ts-hours[data-key="L501"][data-d="5"]');
    await page.keyboard.type('4');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    T.eq('totals follow the typing (10+8+8+8+8+4 + 45)', await env.text('#tsWeekTotal'), '91');
    T.eq('the save button says how many rows it saves', await env.text('#tsSave'), 'Save draft (2)');

    T.section('Timesheets: Save writes what New EquipRite writes, in its order');
    let n0 = env.writes.length;
    await page.click('#tsSave');
    await page.waitForTimeout(1500);
    const days = (id, hrs) => hrs.map((h, i) => 'POST /time-entry-days ' + JSON.stringify({ timeEntryId: id, workDate: addDays(WEEK, i) + 'T00:00:00Z', hoursWorked: h }));
    T.eq('PATCH the changed entry, its 7 days, then create the new line and its 7 days', writesSince(env, n0).join('\n'), [
      'PATCH /time-entries/900 ' + JSON.stringify({ totalHours: 46, billableHours: 46, entryType: 'USAGE', status: 'DRAFT' }),
      ...days(900, [10, 8, 8, 8, 8, 4, 0]),
      'POST /time-entries ' + JSON.stringify({ requestLineId: 502, entryDate: WEEK + 'T00:00:00Z', entryType: 'USAGE', totalHours: 45, billableHours: 45, status: 'DRAFT' }),
      ...days(901, [0, 0, 9, 9, 9, 9, 9]),
    ].join('\n'));
    T.eq('the week is read back, and the requests on site', [env.calls.filter((c) => c.includes('/views/timesheet-details/' + WEEK + '/REQ-10482')).length,
      env.calls.filter((c) => c.includes('/views/timesheets?')).length].join(), '2,2');

    T.section('Timesheets: Copy last week and Submit');
    await page.click('#tsCopy');
    await page.waitForTimeout(800);
    T.eq('last week\'s hours fill the same line', await page.$$eval('input.nx-ts-hours[data-key="L501"]', (b) => b.map((x) => x.value).join(',')), '9,9,9,9,4,0,0');
    T.eq('nothing is written by copying', env.writes.length, n0 + 16);
    await page.click('#tsUndo');
    await page.waitForTimeout(300);
    n0 = env.writes.length;
    await page.click('#tsSubmit');
    await page.waitForTimeout(600);
    T.check('Submit asks for the missing rate type first, and sends nothing', (await env.text('#tsSaveError')).includes('Rate Type is required for row 2')
      && env.writes.length === n0);
    await page.selectOption('select.nx-ts-select[data-key="L502"]', 'STANDBY');
    await page.waitForTimeout(300);
    T.check('the rate type is no longer missing', !(await env.text('#tsMissing')).includes('choose a rate type'));
    await page.click('#tsSubmit');
    await page.waitForTimeout(1500);
    T.eq('Submit saves first (New\'s order: the line with no entry yet), re-reads, then sends the ticked draft entries', writesSince(env, n0).join('\n'), [
      'POST /time-entries ' + JSON.stringify({ requestLineId: 502, entryDate: WEEK + 'T00:00:00Z', entryType: 'STANDBY', totalHours: 45, billableHours: 45, status: 'DRAFT' }),
      ...days(901, [0, 0, 9, 9, 9, 9, 9]),
      'PATCH /time-entries/900 ' + JSON.stringify({ status: 'SUBMITTED' }),
    ].join('\n'));

    T.section('Timesheets: export what is shown');
    const csv = await download(page, '#tsExport', '.nx-menu-item[data-what="week"][data-format="csv"]');
    T.check('CSV file name', /^equiprite-timesheet-req-10482-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/.test(csv.name), csv.name);
    const lines = csv.text.replace(/^﻿/, '').split('\r\n').filter(Boolean);
    T.eq('the CSV: a header with the days, a row per line', lines[0], 'Request,Equipment,Class,Task,Rate type,Expenditure type,'
      + [0, 1, 2, 3, 4, 5, 6].map((i) => label(addDays(WEEK, i))).join(',') + ',Total hours,Status,Stored status');
    T.eq('the CSV row', lines[1], 'REQ-10482,CAT 320 Excavator,Excavators,Trenching,Usage,,8,8,8,8,8,0,0,40,"Draft, not submitted",DRAFT');
    const q = await download(page, '#tsExport', '.nx-menu-item[data-what="queue"][data-format="csv"]');
    T.eq('the requests on site export too', q.text.replace(/^﻿/, '').split('\r\n').filter(Boolean).length, 3);

    T.section('Timesheets: moving with unsaved hours asks first');
    await page.click('input.nx-ts-hours[data-key="L501"][data-d="1"]');
    await page.keyboard.type('7');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    await page.click('.nx-ts-qitem[data-request="REQ-10475"]');
    await page.waitForTimeout(300);
    T.check('a move waits on Discard', (await env.text('#tsMove')).includes('This week has hours that are not saved.'));
    await page.click('#tsDiscard');
    await page.waitForTimeout(1000);
    T.check('then the other request opens', (await env.text('#tsSummary')).includes('REQ-10475'));
    T.check('no sideways scroll', await noSideways(page));

    // ════════════════════════════════════════════════════════════════════════════════════════════════════════
    T.section('Approve time: the week, and what needs a look first');
    await page.click('.nx-nav-item[data-nav-id="approve-time"]');
    await page.waitForSelector('.nx-grid--ta .nx-ta-block', { timeout: 30000 });
    await page.waitForTimeout(800);
    T.eq('the summary', await env.text('#taSummary'), 'Week of ' + usageWeeks.weekLabel(WEEK) + ' · 4 lines waiting for approval · 2 need a look');
    T.eq('waiting: lines, hours, cost', await env.text('#taKpiWaiting'), 'Waiting for approval 4 163 h · $25,088');
    const tags = async (key) => page.$$eval(`.nx-ta-block[data-key="${key}"] .nx-ts-tags span`, (s) => s.map((x) => x.innerText.trim()).filter(Boolean).join(' | '));
    T.eq('a day over 16 h and a big change on last week', await tags('E910'), '18 h on ' + label(addDays(WEEK, 2)) + ' | +10 h on last week');
    T.eq('a day over 10 h; an earlier adjustment is shown', await tags('E911'), '11 h on ' + label(addDays(WEEK, 3)) + ' | Adjusted');
    T.eq('the day cells are coloured', await page.$eval('.nx-ta-block[data-key="E910"] .nx-ta-day--high', (c) => c.innerText.trim()), '18');
    T.eq('the submitted value of an adjusted day is kept, struck', await page.$eval('.nx-ta-block[data-key="E911"] .nx-ta-was', (c) => c.innerText.trim()), '21');
    T.eq('week over week, in New\'s order (request, then equipment)', await page.$$eval('.nx-ta-wow', (c) => c.map((x) => x.innerText.trim()).join(',')), 'new,new,+10 h,new');
    await page.click('#taOnlyLook');
    await page.waitForTimeout(300);
    T.eq('"needs a look only"', await page.$$eval('.nx-ta-block', (b) => b.map((x) => x.dataset.key).join(',')), 'E911,E910');
    await page.click('#taOnlyLook');
    await page.waitForTimeout(300);
    await env.shot('next-approve-time.png');
    T.check('no sideways scroll', await noSideways(page));

    T.section('Approve time: select what looks right, approve in one go');
    await page.click('#taPickClean');
    await page.waitForTimeout(300);
    T.eq('the lines that look right are ticked', await page.$$eval('.nx-ta-block input[type="checkbox"]:checked', (b) => b.map((x) => x.dataset.key).join(',')), 'E912,E913');
    T.eq('the selection in figures', await env.text('#taSelection'), '2 lines selected · 70 h · $3,500');
    T.eq('the cost so far after approval (12,000 + 42,300 + 3,500)', await page.$eval('#taKpiAfter .nx-kpi-value', (e) => e.innerText.trim()), '$57,800');
    n0 = env.writes.length;
    await page.click('#taApprove');
    await page.waitForTimeout(300);
    T.check('Approve says what it will do first', (await env.text('#taConfirm')).includes('Approve 2 lines, 70 h, $3,500?') && env.writes.length === n0);
    await page.click('#taApproveGo');
    await page.waitForTimeout(1200);
    T.eq('request by request, entry by entry (New\'s approveChain)', writesSince(env, n0).join('\n'),
      'PATCH /time-entries/912 {"status":"APPROVED"}\nPATCH /time-entries/913 {"status":"APPROVED"}');
    T.check('it says what it did', (await env.text('#taNote')).includes('Approved: REQ-10475 (1), REQ-10482 (1).'));

    T.section('Approve time: send back, adjust with an audit entry');
    await page.check('.nx-ta-block[data-key="E911"] input[type="checkbox"]');
    await page.waitForTimeout(200);
    n0 = env.writes.length;
    await page.click('#taReject');
    await page.waitForTimeout(300);
    T.check('Send back asks first', (await env.text('#taConfirm')).includes('Send back 1 line?') && env.writes.length === n0);
    await page.click('#taRejectGo');
    await page.waitForTimeout(1000);
    T.eq('sent back: New\'s rejectChain', writesSince(env, n0).join('\n'), 'PATCH /time-entries/911 {"status":"REJECTED"}');
    await page.click('.nx-ta-block[data-key="E910"] .nx-ta-adjust-btn');
    await page.waitForSelector('#taAdjust');
    await page.fill('.nx-ta-block[data-key="E910"] input.nx-ts-hours[data-d="2"]', '10');
    await page.keyboard.press('Tab');
    n0 = env.writes.length;
    await page.click('#taAdjustSave');
    await page.waitForTimeout(400);
    T.check('an adjustment needs a reason, and nothing is sent without one', (await env.text('#taError')).includes('Say why the hours are adjusted') && env.writes.length === n0);
    await page.fill('#taAdjust input.nx-ta-input', '18 h on Wednesday was a typo for 10');
    await page.click('#taAdjustSave');
    await page.waitForTimeout(1500);
    const adj = env.writes.slice(n0);
    const after = [8, 8, 10, 9, 7, 0, 0];
    T.eq('the hours, then each day (New\'s adjustChain), the line stays submitted', adj.slice(0, 8).map((w) => w.method + ' ' + strip(w.path) + ' ' + JSON.stringify(w.body)).join('\n'),
      ['PATCH /time-entries/910 {"totalHours":42,"billableHours":42}'].concat(after.map((h, i) => 'POST /time-entry-days '
        + JSON.stringify({ timeEntryId: 910, workDate: addDays(WEEK, i) + 'T00:00:00Z', hoursWorked: h }))).join('\n'));
    const audit = adj[8] || {};
    T.eq('then the audit entry: what was submitted, what it is now, who and why', [strip(audit.path || ''), audit.body && audit.body.entityName, audit.body && audit.body.entityId,
      audit.body && audit.body.action, audit.body && audit.body.oldValues, audit.body && audit.body.newValues, audit.body && audit.body.changeSummary].join(' | '),
      ['/audit-trail', 'EQR_TIME_ENTRY', 910, 'ADJUST_HOURS',
        JSON.stringify({ requestNumber: 'REQ-10482', weekStartDate: WEEK, days: [8, 8, 18, 9, 7, 0, 0], totalHours: 50 }),
        JSON.stringify({ requestNumber: 'REQ-10482', weekStartDate: WEEK, days: after, totalHours: 42 }),
        'Hours adjusted at approval on REQ-10482 · CAT 320 Excavator: ' + label(addDays(WEEK, 2)) + ' 18 → 10 h. Reason: 18 h on Wednesday was a typo for 10'].join(' | '));
    T.eq('nothing else was written', adj.length, 9);

    T.section('Approve time: export what is shown');
    const ta = await download(page, '#taExport', '.nx-menu-item[data-format="csv"]');
    const taLines = ta.text.replace(/^﻿/, '').split('\r\n').filter(Boolean);
    T.eq('a row per line shown', taLines.length, 5);
    T.check('with what needs a look', taLines.some((l) => l.startsWith('REQ-10482,Pipeline North,Trenching,CAT 320 Excavator') && l.includes('18 h on ' + label(addDays(WEEK, 2)) + ' · +10 h on last week')));
    T.check('no sideways scroll', await noSideways(page));

    // ════════════════════════════════════════════════════════════════════════════════════════════════════════
    T.section('Post costs: what is ready and what was posted, request by request');
    const w0 = env.writes.length;
    await page.click('.nx-nav-item[data-nav-id="costs"]');
    await page.waitForSelector('.nx-grid--pc .nx-row--click', { timeout: 30000 });
    await page.waitForFunction(() => !document.querySelector('#pcSummary').innerText.includes('working out'), null, { timeout: 20000 });
    await page.waitForTimeout(500);
    T.eq('the summary', await env.text('#pcSummary'), '3 requests · $50,720 cost to date · $3,590 ready to post');
    T.eq('ready to post, across the requests', await env.text('#pcKpiReady'), 'Ready to post $3,590 1 request with weeks ended or charges not posted');
    T.eq('posted', await page.$eval('#pcKpiPosted .nx-kpi-value', (e) => e.innerText.trim()), '$45,730');
    T.eq('running, not ended', await page.$eval('#pcKpiRunning .nx-kpi-value', (e) => e.innerText.trim()), '$1,400');
    const pcRowText = async (n) => (await page.$eval(`.nx-grid--pc .nx-row--click[data-number="${n}"]`, (r) => r.innerText)).replace(/\s+/g, ' ').trim();
    const lastPosted = (() => { const d = new Date(addDays(W(-3), 6) + 'T00:00:00Z'); return d.getUTCDate() + ' ' + MON[d.getUTCMonth()]; })();
    T.check('a request: cost to date, posted, ready (3 weeks ended + 1 charge), running, last posted', (await pcRowText('REQ-10440'))
      .endsWith('$6,390 160 h $1,400 $3,590 3 weeks + 1 charge Review & post $1,400 1 week not ended ' + lastPosted), await pcRowText('REQ-10440'));
    T.check('a request with everything posted', (await pcRowText('REQ-10418')).includes('Rental over') && (await pcRowText('REQ-10418')).includes('$44,330 — '));
    T.eq('chips by what is left to post', await page.$$eval('.nx-pc .nx-chip', (c) => c.map((x) => x.innerText.replace(/\s+/g, ' ').trim()).join(' | ')),
      'All 3 | Ready to post 1 | Rental running 0 | All posted 1 | Nothing to post 1');
    T.eq('only the requests with cost were worked out (2 reads each)', env.calls.filter((c) => c.includes('/views/post-cost-details')).length, 2);
    await env.shot('next-post-costs.png');
    T.check('no sideways scroll', await noSideways(page));
    await page.click('.nx-pc .nx-chip[data-value="ready"]');
    await page.waitForTimeout(300);
    T.eq('"Ready to post"', await page.$$eval('.nx-grid--pc .nx-row--click', (r) => r.map((x) => x.dataset.number).join()), 'REQ-10440');
    const pcCsv = await download(page, '#pcExport', '.nx-menu-item[data-format="csv"]');
    const pcLines = pcCsv.text.replace(/^﻿/, '').split('\r\n').filter(Boolean);
    T.eq('the export: what is shown, with ready and posted', [pcLines.length, pcLines[0].endsWith(',Cost to date,Ready to post,Posted,"Running, not ended",Last posted')].join(' | '),
      '2 | true');
    T.check('the export row', pcLines[1].startsWith('REQ-10440,Plant Expansion B,Electrical,PRJ-B,4.2,') && pcLines[1].endsWith(',6390,3590,1400,1400,' + lastPosted), pcLines[1]);
    T.check('posting is done here, request by request (tests/e2e/next-posting.e2e.js posts)', (await env.text('#pcFusion')).startsWith('Post to Fusion PPM from here')
      && (await env.text('#pcPostNext')) === 'Post REQ-10440');

    T.section('A request\'s costs in its own tab: what would be posted');
    await page.click('.nx-grid--pc .nx-row--click[data-number="REQ-10440"]');
    await page.waitForSelector('#prPlanTotal', { timeout: 20000 });
    await page.waitForTimeout(600);
    T.eq('it opens in a tab named after the request', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId + '=' + t.innerText.trim()), 'cost:REQ-10440=REQ-10440 costs');
    T.eq('the heading says what is left to do', await env.text('#prHead'), '$3,590 ready to post');
    T.eq('ready, in figures', await env.text('#prKpiReady'), 'Ready to post $3,590 3 weeks ended + 1 charge not posted');
    T.eq('posted, and when', await env.text('#prKpiPosted'), 'Posted $1,400 Last posted ' + lastPosted);
    const plan = await page.$$eval('.nx-grid--plan .nx-row:not(.nx-row--head)', (r) => r.map((x) => [...x.querySelectorAll('[role="cell"]')].map((c) => c.innerText.replace(/\s+/g, ' ').trim()).join(' | ')));
    T.eq('what would be posted: each week and charge, its type, where it goes, its amount', plan.join('\n'), [
      'Generator 100 kVA · week of ' + usageWeeks.weekLabel(W(-2)) + ' | 7 days at $200/day daily | Equipment Rental | PRJ-B Plant Expansion B / task 4.2 | $1,400',
      'Generator 100 kVA · week of ' + usageWeeks.weekLabel(W(-1)) + ' | 7 days at $200/day daily | Equipment Rental | 60% PRJ-B / 4.2, 40% PRJ-C / 2.1 | $1,400',
      'Light Tower LT-4 · week of ' + usageWeeks.weekLabel(W(-1)) + ' | 7 days at $100/day daily | Equipment (default) | PRJ-B Plant Expansion B / task 4.2 | $700',
      'Generator 100 kVA · charge: Fuel top-up on return | 1 on ' + fmtDate(W(-3)) + ' | Fuel | PRJ-B Plant Expansion B / task 4.2 · Applications and Services | $90',
    ].join('\n'));
    T.eq('its total', await env.text('#prPlanTotal'), '$3,590');
    const weeksTable = await env.text('.nx-grid--pr');
    T.check('week by week: posted, ready, running, in words; a future week left out', weeksTable.includes('Posted') && weeksTable.includes('Ready to post')
      && weeksTable.includes('This week, not ended') && !weeksTable.includes(usageWeeks.weekLabel(W(10))));
    T.eq('everything ready is ticked, and posted from here', await env.text('#prPost'), 'Post 3 weeks and 1 charge · $3,590');
    const planCsv = await download(page, '#prExport', '.nx-menu-item[data-what="plan"][data-format="csv"]');
    const planLines = planCsv.text.replace(/^﻿/, '').split('\r\n').filter(Boolean);
    T.eq('the plan exports', [planLines.length, planLines[0]].join(' | '), '5 | What,Quantity,Expenditure type,Posts to,Amount,Note');
    await env.shot('next-request-costs.png');
    T.check('no sideways scroll', await noSideways(page));
    T.eq('opening and reading costs writes nothing', env.writes.length, w0);

    // ════════════════════════════════════════════════════════════════════════════════════════════════════════
    T.section('Direct cost & inventory: what a request has used and what is left');
    await page.click('.nx-nav-item[data-nav-id="direct-costs"]');
    await page.waitForSelector('.nx-grid--dcl .nx-row:not(.nx-row--head)', { timeout: 30000 });
    await page.waitForTimeout(600);
    T.eq('approved and active requests only, newest first; the first opens', await page.$$eval('.nx-dc .nx-ts-qitem', (b) => b.map((x) => x.dataset.request
      + (x.getAttribute('aria-pressed') === 'true' ? '*' : '')).join(',')), 'REQ-10491*,REQ-10490');
    T.eq('the consumable: delivered, used, left; the rejected line left out', await page.$$eval('.nx-grid--dcl .nx-row:not(.nx-row--head)', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ').trim()).join(' | ')),
      'Hydraulic oil 20 L Consumable 10 10 4 6 On site | CAT 320 Excavator Equipment 1 — — — On site');
    T.eq('the request in figures', [await env.text('#dcKpiCons'), await page.$eval('#dcKpiDirect .nx-kpi-value', (e) => e.innerText), await page.$eval('#dcKpiCost .nx-kpi-value', (e) => e.innerText)].join(' | '),
      'Consumables 1 4 used · 6 left to account for | $420 | $7,000');
    T.check('the material issue, the direct cost and the cost history', (await env.text('.nx-grid--dci')).includes('OIL-HYD-20') && (await env.text('.nx-grid--dcd')).includes('Fuel · Diesel delivery')
      && (await env.text('.nx-grid--dch')).includes('CAT 320 Excavator · CAT-0320'));
    T.eq('recording is done in New EquipRite, on this request', await page.getAttribute('#dcInNew', 'href'), env.newUrl + '/vp/shell/usage/project-costs?request=REQ-10491');
    const dcCsv = await download(page, '#dcExportLines', '.nx-menu-item[data-what="lines"][data-format="csv"]');
    T.eq('each list exports', dcCsv.text.replace(/^﻿/, '').split('\r\n').filter(Boolean)[1], 'Hydraulic oil 20 L,Consumable,10,10,4,6,On site,DELIVERED');
    await env.shot('next-direct-costs.png');
    await page.click('.nx-dc .nx-ts-qitem[data-request="REQ-10490"]');
    await page.waitForTimeout(800);
    T.check('another request, with nothing recorded', (await env.text('.nx-dc')).includes('Nothing used on this request yet.') && (await env.text('#dcSummary')).startsWith('REQ-10490'));
    T.check('no sideways scroll', await noSideways(page));
    T.eq('Direct cost writes nothing', env.writes.length, w0);
    T.eq('no browser errors', env.errors.filter((e) => !e.startsWith('warning')).join('\n'), '');
  } catch (e) {
    T.check('run finished', false, e.message);
    await env.shot('next-usage-failed.png').catch(() => {});
  } finally {
    await env.close();
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════
  // Fusion PPM prices the hours: approving sends them to Fusion, so it is left to New; Post costs is withdrawn.
  // In a narrow window (760 px, the shell's narrow layout): the wide grids scroll inside their cards, never the page.
  const ppm = await E.start({ port: 19360, handle, app: 'next', flags: ['PROJECTS_MODULE_ENABLED', 'TIMESHEETS_ENABLED', 'PPM_RATES_ENABLED'], width: 760,
    shots: process.env.E2E_SHOTS });
  try {
    const pg = ppm.page;
    T.section('Under Fusion PPM rates');
    await ppm.open('/?open=approve-time');
    await pg.waitForSelector('.nx-grid--ta .nx-ta-block', { timeout: 30000 });
    await pg.waitForTimeout(600);
    T.check('Approve time says why approving is done in New', (await ppm.text('#taPpm')).includes('approving a line also sends its hours to Fusion PPM'));
    T.eq('and links to it, on this week', await pg.getAttribute('#taInNew', 'href'), ppm.newUrl + '/vp/shell/usage/timesheet-approval?week=' + WEEK);
    T.eq('there is no Approve button', await pg.$('#taApprove'), null);
    T.check('sending back stays here', !!(await pg.$('#taReject')));
    T.eq('Post costs is withdrawn from the menu', await pg.$$eval('.nx-nav-item[data-nav-id="costs"]', (b) => b.length), 0);
    T.check('narrow window: no sideways scroll on Approve time', await noSideways(pg));
    await ppm.shot('next-approve-time-ppm.png');
    await ppm.open('/?open=timesheets');
    await pg.waitForSelector('#tsMissing', { timeout: 30000 });
    await pg.waitForTimeout(600);
    T.check('Timesheets: an expenditure type is missing on a line with hours', (await ppm.text('#tsMissing')).includes('CAT 320 Excavator: choose an expenditure type; the hours go to Fusion PPM under it.'));
    T.check('narrow window: no sideways scroll on Timesheets', await noSideways(pg));
    await ppm.shot('next-timesheets-narrow.png');
    await ppm.open('/?open=direct-costs');
    await pg.waitForSelector('.nx-grid--dcl', { timeout: 30000 });
    await pg.waitForTimeout(500);
    T.check('narrow window: no sideways scroll on Direct cost', await noSideways(pg));
    T.eq('nothing written', ppm.writes.length, 0);
    T.eq('no browser errors', ppm.errors.filter((e) => !e.startsWith('warning')).join('\n'), '');
  } catch (e) {
    T.check('PPM run finished', false, e.message);
    await ppm.shot('next-usage-ppm-failed.png').catch(() => {});
  } finally {
    await ppm.close();
    T.report();
  }
})();
