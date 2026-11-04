'use strict';
/*
 * EquipRite Next, Usage & billing in the Redwood look (your menu, Look), in a real browser against a fake backend:
 *   Timesheets      Oracle's Smart Search page over the requests on site: a row opens its week in the entry below,
 *                   the same entry as the current look (typing, totals); a filter per column
 *   Approve time    Oracle's Smart Search page over the week's lines: what needs a look as Oracle's badges, a click
 *                   ticks a line, Approve (the header's action) and Send back write what the current look writes, Adjust
 *   Post costs      Oracle's Smart Search page over the requests with cost: a row opens its costs in its own tab, the
 *                   header's Post opens the newest request with cost ready
 *   A request's costs   Oracle's general overview page as the header (badge, Post, back to Post costs) over the
 *                   record's own body, what will be posted as Oracle's table
 *   Direct cost     Oracle's general overview page as the header over the screen's own body, its lines as Oracle's table
 * Each: Oracle's components upgraded, the screen's data, no browser errors, a screenshot (rw-usage-<screen>.png); then
 * Current brings the current look back on every screen.
 * Needs `npm run build`. Run: node tests/e2e/next-redwood-usage.e2e.js   (screenshots go to the OS temp folder, or E2E_SHOTS)
 */
const fs = require('fs');
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
const W = (n) => addDays(WEEK, 7 * n);
const compact = (s) => s.replace(/-/g, '');
// The week's name as the screens write it (resources/js/usageWeeks.js, loaded as it is).
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
  if (request !== 'REQ-10482' || week !== WEEK) return [];
  const base = { requestNumber: 'REQ-10482', projectName: 'Pipeline North', taskName: 'Trenching', isRentable: 'Y', className: 'Excavators',
    requestedStartDate: addDays(WEEK, -30) + 'T00:00:00Z', requestedEndDate: addDays(WEEK, 45) + 'T00:00:00Z', weekStartDate: week };
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

// ── Post costs and a request's costs ──────────────────────────────────────────────────────────────────────────
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

// ── Direct cost & inventory ───────────────────────────────────────────────────────────────────────────────────
const MY_REQUESTS = [
  { eqrEquipmentRequestId: 4490, requestNumber: 'REQ-10490', projectName: 'Plant Expansion B', taskName: 'Civil', status: 'APPROVED' },
  { eqrEquipmentRequestId: 4491, requestNumber: 'REQ-10491', projectName: 'Pipeline North', taskName: 'Trenching', status: 'DEPLOYED' },
  { eqrEquipmentRequestId: 4499, requestNumber: 'REQ-10499', projectName: 'Plant Expansion B', taskName: 'Civil', status: 'DRAFT' },
];
const DC_LINES = [
  { lineId: 801, equipmentName: 'Hydraulic oil 20 L', quantity: 10, lineStatus: 'DELIVERED', consumableFlag: 'Y', deliveredQuantity: 10 },
  { lineId: 802, equipmentName: 'CAT 320 Excavator', quantity: 1, lineStatus: 'DEPLOYED', consumableFlag: 'N' },
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
  if (p.endsWith('/views/project-cost-detail')) return res.json({ data: COST_DETAIL[q('requestNumber')] || [] });
  if (p.endsWith('/views/post-cost')) return res.json({ data: PC_LIST });
  if (p.endsWith('/views/post-cost-details')) return res.json({ data: PC_DETAILS[q('requestNumber')] || [] });
  if (p.endsWith('/views/misc-transactions')) return res.json({ data: q('requestNumber') ? PC_MISC.filter((m) => m.requestNumber === q('requestNumber')) : PC_MISC });
  if (p.endsWith('/views/line-retier-weeks') || p.endsWith('/views/line-project-splits') || p.endsWith('/views/blackout-weeks')) return res.json({ data: [] });
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
  if (p.endsWith('/views/request-detail-lines') && q('requestId') === '4482') {
    return res.json({ data: [{ lineId: 501, billRate: 175, priceUom: 'HOUR' }, { lineId: 502, billRate: 900, priceUom: 'DAY' }] });
  }
  if (req.method === 'PATCH' && /\/time-entries\/\d+$/.test(p)) return res.json({ id: 1 });
  return undefined;
}

// ── helpers ───────────────────────────────────────────────────────────────────────────────────────────────────
const settle = (page, ms) => page.waitForTimeout(ms || 400);
const ORACLE = ['oj-sp-smart-search-page', 'oj-sp-smart-search', 'oj-sp-collection-container', 'oj-table', 'oj-c-button'];
/** Every Oracle component in a Redwood view upgraded (.oj-complete): 'tag:true …'. */
const upgraded = (page, root, tags) => page.evaluate(([r, t]) => t.map((tag) => {
  const el = document.querySelector(r + ' ' + tag);
  return tag + ':' + (el ? el.classList.contains('oj-complete') : 'missing');
}).join(' '), [root, tags]);
const allUpgraded = (s, tags) => tags.every((t) => s.indexOf(t + ':true') !== -1);
/** The table's rows, as text. */
const rows = (page, table) => page.$$eval(table + ' tbody tr', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ').trim()).filter((t) => /REQ-|\w/.test(t)));
const reqs = (list) => list.map((r) => (r.match(/REQ-\d+/) || [''])[0]).join(',');
/** Smart Search's filter chips, in order. */
const chips = async (page, root, n) => {
  await page.waitForFunction(([r, k]) => Array.from(document.querySelectorAll(r + ' oj-sp-smart-search .oj-sp-filter-chip-container'))
    .filter((x) => x.innerText.trim()).length === k, [root, n], { timeout: 15000 }).catch(() => {});
  await settle(page, 600);
  return (await page.$$eval(root + ' oj-sp-smart-search .oj-sp-filter-chip-container', (b) => b.map((x) => x.innerText.trim()))).join(',');
};
/** Picks a filter's option, then closes its list (Smart Search applies a pick as its list closes, as Oracle's does). */
async function pick(page, root, chip, option) {
  await page.click(root + ' oj-sp-smart-search .oj-sp-filter-chip-container:has-text("' + chip + '")');
  await page.waitForSelector('text=' + option, { timeout: 10000 });
  const offered = await page.$$eval('[role=option], li', (o) => o.filter((x) => x.offsetParent !== null).map((x) => x.innerText.trim()).filter((t) => /\(\d+\)$/.test(t)));
  await page.click('text=' + option);
  await settle(page, 600);
  await page.click(root + ' oj-sp-smart-search-page h1, ' + root + ' .oj-sp-header-general-overview-title');
  await settle(page, 800);
  return offered;
}
/** A whole screen in one picture (the shell's content scrolls inside the window). */
async function shot(env, name) {
  const { page } = env;
  await page.setViewportSize({ width: 1440, height: 1700 });
  await settle(page, 900);
  const f = await env.shot(name);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await settle(page, 300);
  return f;
}
const activeTab = (page) => page.$eval('.nx-tab--on', (t) => t.dataset.tabId);
async function noSideways(page) {
  return page.evaluate(() => [...document.querySelectorAll('.nx-content')].every((c) => c.scrollWidth <= c.clientWidth + 1));
}
const writesSince = (env, n) => env.writes.slice(n).map((w) => w.method + ' ' + strip(w.path) + ' ' + JSON.stringify(w.body));

(async () => {
  const env = await E.start({ port: 19620, handle, app: 'next', flags: ['PROJECTS_MODULE_ENABLED', 'TIMESHEETS_ENABLED'], shots: process.env.E2E_SHOTS });
  const { page } = env;
  const errs = () => env.errors.filter((e) => !/404|Failed to load resource/.test(e));
  try {
    await env.open('/?open=timesheets');
    await page.waitForSelector('.nx-grid--ts input.nx-ts-hours', { timeout: 30000 });
    await settle(page, 800);
    T.section('Current, to start');
    T.check('Timesheets as it was: its head and its list of requests, no Redwood view', await page.isVisible('.nx-ts .nx-pagehead') && await page.isVisible('.nx-ts-queue')
      && !(await page.$('#tsRedwood')));

    // ════════════════════════════════════════════════════════════════════════════════════════════════════════
    T.section('Timesheets: Oracle\'s Smart Search page over the requests on site');
    await env.setLook('redwood');
    await page.waitForSelector('#tsRedwood oj-sp-smart-search-page', { timeout: 20000 });
    await page.waitForFunction(() => /REQ-10482/.test((document.querySelector('#tsRwTable') || {}).innerText || ''), null, { timeout: 30000 });
    await settle(page, 800);
    const tsUp = await upgraded(page, '#tsRedwood', ORACLE);
    T.check('Oracle\'s components, upgraded: smart search page, Smart Search, collection container, oj-table, oj-c buttons', allUpgraded(tsUp, ORACLE), tsUp);
    T.eq('the template\'s header: the title and the summary', await env.text('#tsRedwood oj-sp-smart-search-page h1'), 'Timesheets');
    T.check('…the summary: the requests on site and the week open below', (await env.text('#tsRedwood oj-sp-smart-search-page')).includes('2 requests on site · Week of '
      + usageWeeks.weekLabel(WEEK) + ' · REQ-10482 · Pipeline North'));
    T.check('the current head and list of requests step aside', !(await page.isVisible('.nx-ts .nx-pagehead')) && !(await page.$('.nx-ts-queue')));
    let tsRows = await rows(page, '#tsRwTable');
    T.eq('a table row per request on site, in the current look\'s order (newest week, newest entry first)', reqs(tsRows), 'REQ-10482,REQ-10475');
    T.check('a row: request, project, task, equipment, week, hours, status; the one open below marked', tsRows.some((r) => r.includes('REQ-10482') && r.includes('Open below')
      && r.includes('Pipeline North') && r.includes('Trenching') && r.includes('2 pieces') && r.includes(usageWeeks.weekLabel(WEEK)) && r.includes('40 h')
      && r.includes('Draft, not submitted')), tsRows.join(' || '));
    T.eq('the status is Oracle\'s oj-badge', await page.$$eval('#tsRwTable .oj-badge', (b) => b.map((x) => x.innerText.trim()).sort().join(' | ')),
      'Draft, not submitted | Open below | Waiting for approval');
    T.check('every column fits: no table scrolling sideways', await page.$eval('#tsRwTable .oj-table-scroller', (sc) => sc.scrollWidth <= sc.clientWidth + 1));
    T.check('the week entry follows the table, as one page', await page.isVisible('.nx-grid--ts input.nx-ts-hours[data-key="L501"]'));

    T.section('Timesheets: a row opens its week in the same entry as the current look');
    await page.click('#tsRwTable .nx-rw-num:has-text("REQ-10475")');
    await page.waitForFunction(() => /REQ-10475/.test((document.querySelector('#tsRedwood oj-sp-smart-search-page') || {}).innerText || ''), null, { timeout: 15000 });
    await settle(page, 800);
    T.check('REQ-10475 opens (moveChain): its week is read, the row marked', env.calls.some((c) => c.includes('/views/timesheet-details/' + WEEK + '/REQ-10475'))
      && (await rows(page, '#tsRwTable')).some((r) => r.includes('REQ-10475') && r.includes('Open below')));
    await page.click('#tsRwTable .nx-rw-num:has-text("REQ-10482")');
    await page.waitForSelector('.nx-grid--ts input.nx-ts-hours[data-key="L501"]', { timeout: 15000 });
    await settle(page, 800);
    T.eq('REQ-10482 again: the week\'s rows, its total', [await page.$$eval('.nx-grid--ts .nx-ts-row[data-key] .nx-cell-main', (c) => c.map((x) => x.innerText.trim()).join(',')),
      await env.text('#tsWeekTotal')].join(' | '), 'CAT 320 Excavator,Dump Truck 30t | 85');
    await page.click('input.nx-ts-hours[data-key="L501"][data-d="0"]');
    await page.keyboard.type('10');
    await page.keyboard.press('Tab');
    await settle(page, 400);
    T.eq('typing in it works as on the current look: the total follows, Save counts the row', [await env.text('#tsWeekTotal'), await env.text('#tsSave')].join(' | '),
      '87 | Save draft (2)');
    await page.click('#tsUndo');
    await settle(page, 300);

    T.section('Timesheets: a filter per column');
    T.eq('the filters are the columns', await chips(page, '#tsRedwood', 7), 'Request,Project,Task,Equipment,Week,Hours,Status');
    const tsOffered = await pick(page, '#tsRedwood', 'Project', 'Plant Expansion B (1)');
    T.eq('Project offers what the requests hold, with how many', tsOffered.join(','), 'Pipeline North (1),Plant Expansion B (1)');
    await page.waitForFunction(() => !/REQ-10482/.test((document.querySelector('#tsRwTable') || {}).innerText || ''), null, { timeout: 10000 }).catch(() => {});
    T.eq('picked: the requests of that project', reqs(await rows(page, '#tsRwTable')), 'REQ-10475');
    let n = env.calls.filter((c) => c.includes('/views/timesheets?')).length;
    await page.click('#tsRwRefresh');
    await page.waitForFunction((k) => true, n);
    await settle(page, 1200);
    T.check('Refresh (the table\'s tools) reads the requests on site again', env.calls.filter((c) => c.includes('/views/timesheets?')).length > n);
    T.check('the header\'s colour runs on behind the top of the table, as in Old', /linear-gradient\(rgb\(44, 82, 102\)/.test(await page.$eval('.nx-ts', (e) => getComputedStyle(e).backgroundImage)));
    T.check('no sideways scroll', await noSideways(page));
    await shot(env, 'rw-usage-timesheets.png');

    // ════════════════════════════════════════════════════════════════════════════════════════════════════════
    T.section('Approve time: Oracle\'s Smart Search page over the week\'s lines');
    await page.click('.nx-nav-item[data-nav-id="approve-time"]');
    await page.waitForSelector('#taRedwood oj-sp-smart-search-page', { timeout: 20000 });
    await page.waitForFunction(() => /Light Tower/.test((document.querySelector('#taRwTable') || {}).innerText || ''), null, { timeout: 30000 });
    await settle(page, 800);
    const taUp = await upgraded(page, '#taRedwood', ORACLE);
    T.check('Oracle\'s components, upgraded', allUpgraded(taUp, ORACLE), taUp);
    T.check('the header: the title and the week\'s summary', (await env.text('#taRedwood oj-sp-smart-search-page h1')) === 'Approve time'
      && (await env.text('#taRedwood oj-sp-smart-search-page')).includes('Week of ' + usageWeeks.weekLabel(WEEK) + ' · 4 lines waiting for approval · 2 need a look'));
    T.check('the current head, figures and grid step aside', !(await page.isVisible('.nx-ta .nx-pagehead')) && !(await page.$('.nx-grid--ta')));
    const taRows = await rows(page, '#taRwTable');
    T.eq('a table row per line, in the current look\'s order', taRows.map((r) => r.match(/REQ-\d+ \S+ \S+/)[0]).join(','),
      'REQ-10475 Light Tower,REQ-10475 Mobile Crane,REQ-10482 CAT 320,REQ-10482 Generator 100');
    T.check('what needs a look as Oracle\'s badges: a day over 16 h (danger), over 10 h (warning), a change on last week; the earlier adjustment',
      (await page.$$eval('#taRwTable .oj-badge-danger', (b) => b.map((x) => x.innerText.trim()).join())) === '18 h on ' + usageWeeks.weekDays(WEEK)[2].label
      && (await page.$$eval('#taRwTable .oj-badge-warning', (b) => b.map((x) => x.innerText.trim()).join())) === '11 h on ' + usageWeeks.weekDays(WEEK)[3].label
      && taRows.some((r) => r.includes('+10 h on last week')) && taRows.some((r) => r.includes('Mobile Crane') && r.includes('Adjusted')));
    T.eq('the week\'s figures, as on the current look', await env.text('#taRwKpiWaiting'), 'Waiting for approval 4 163 h · $25,088');
    T.eq('Approve, the header\'s action, is shut with nothing selected',
      await page.locator('#taRedwood oj-sp-smart-search-page button', { hasText: /^Approve/ }).first().isDisabled(), true);

    T.section('Approve time: a click ticks a line; Approve and Send back are the current look\'s');
    await page.click('#taRwTable tbody tr:has-text("Light Tower") .nx-rw-num');
    await settle(page, 500);
    T.eq('a click on the line ticks it (as its tick box does)', [await env.text('#taRwSelection'), await page.$$eval('#taRwTable .nx-ta-rwtick--on', (t) => t.length)].join(' | '),
      '1 line selected · 40 h · $2,000 | 1');
    const approve = page.locator('#taRedwood oj-sp-smart-search-page button', { hasText: /^Approve 1/ }).first();
    T.check('the header\'s Approve says what it approves', await approve.isEnabled());
    await approve.click();
    await page.waitForSelector('#taRwConfirm', { timeout: 10000 });
    T.check('it asks first, as the current look does (approveChain)', (await env.text('#taRwConfirm')).includes('Approve 1 line, 40 h, $2,000?'));
    let w0 = env.writes.length;
    await page.click('#taRwApproveGo');
    await page.waitForSelector('#taRwNote', { timeout: 15000 });
    T.eq('Approve writes what the current look writes', writesSince(env, w0).join('\n'), 'PATCH /time-entries/912 {"status":"APPROVED"}');
    T.eq('…and says so', await env.text('#taRwNote'), 'Approved: REQ-10475 (1).');
    await page.click('#taRwTable tbody tr:has-text("Generator 100") .nx-rw-num');
    await settle(page, 400);
    await page.click('#taRwReject');
    await page.waitForSelector('#taRwConfirm', { timeout: 10000 });
    w0 = env.writes.length;
    await page.click('#taRwRejectGo');
    await page.waitForSelector('#taRwNote', { timeout: 15000 });
    await settle(page, 600);
    T.eq('Send back writes what the current look writes (rejectChain)', writesSince(env, w0).join('\n'), 'PATCH /time-entries/913 {"status":"REJECTED"}');
    await page.click('#taRwTable tbody tr:has-text("CAT 320") oj-c-button[data-key="E910"]');
    await page.waitForSelector('#taRwAdjust input.nx-ts-hours[data-d="2"]', { timeout: 10000 });
    T.eq('Adjust opens the line\'s days to correct, as submitted', await page.$eval('#taRwAdjust input.nx-ts-hours[data-d="2"]', (i) => i.value), '18');
    await page.click('#taRwAdjust oj-c-button:has-text("Cancel")');
    await settle(page, 300);
    T.check('…and Cancel closes it', !(await page.$('#taRwAdjust')));

    T.section('Approve time: a filter per column');
    T.eq('the filters are the columns, then Week, Equipment and Submitted by', await chips(page, '#taRedwood', 9),
      'Request,Project,Rate type,Hours,On last week,Status,Week,Equipment,Submitted by');
    const taOffered = await pick(page, '#taRedwood', 'On last week', 'More than last week (1)');
    T.eq('On last week offers what the lines hold, with how many', taOffered.join(','), 'New this week (3),More than last week (1),Less than last week (0),Same as last week (0)');
    await page.waitForFunction(() => !/Light Tower/.test((document.querySelector('#taRwTable') || {}).innerText || ''), null, { timeout: 10000 }).catch(() => {});
    T.eq('picked: the line with more hours than last week', (await rows(page, '#taRwTable')).map((r) => r.match(/REQ-\d+ \S+ \S+/)[0]).join(), 'REQ-10482 CAT 320');
    T.check('no sideways scroll', await noSideways(page));
    await shot(env, 'rw-usage-approve-time.png');

    // ════════════════════════════════════════════════════════════════════════════════════════════════════════
    T.section('Post costs: Oracle\'s Smart Search page over the requests with cost');
    await page.click('.nx-nav-item[data-nav-id="costs"]');
    await page.waitForSelector('#pcRedwood oj-sp-smart-search-page', { timeout: 20000 });
    await page.waitForSelector('#pcRwTable oj-c-button:has-text("Review & post")', { timeout: 30000 });
    await settle(page, 800);
    const pcUp = await upgraded(page, '#pcRedwood', ORACLE);
    T.check('Oracle\'s components, upgraded', allUpgraded(pcUp, ORACLE), pcUp);
    T.check('the header: the title and the summary', (await env.text('#pcRedwood oj-sp-smart-search-page h1')) === 'Post costs'
      && (await env.text('#pcRedwood oj-sp-smart-search-page')).includes('3 requests · $50,720 cost to date · $3,590 ready to post'));
    T.check('the current head and list step aside', !(await page.isVisible('.nx-pc .nx-pagehead')) && !(await page.$('.nx-grid--pc')));
    const pcRows = await rows(page, '#pcRwTable');
    T.eq('a table row per request, newest first', reqs(pcRows), 'REQ-10440,REQ-10418,REQ-10401');
    T.eq('what is left to post as Oracle\'s badges', await page.$$eval('#pcRwTable .oj-badge', (b) => b.map((x) => x.innerText.trim()).join(' | ')),
      'Ready to post | All posted | Nothing to post');
    T.check('a row: cost to date, ready to post with its Review & post, posted', pcRows[0].includes('$6,390') && pcRows[0].includes('$3,590')
      && pcRows[0].includes('3 weeks + 1 charge') && pcRows[0].includes('Review & post') && pcRows[0].includes('Last posted'));
    T.eq('the filters are the columns, then Task', await chips(page, '#pcRedwood', 8), 'Request,Project,Rental,Status,Cost to date,Ready to post,Posted,Task');
    const pcOffered = await pick(page, '#pcRedwood', 'Rental', 'Rental over (1)');
    T.eq('Rental offers where each rental is, with how many', pcOffered.join(','), 'Rental over (1),Rental running (1),Not started (1)');
    await page.waitForFunction(() => !/REQ-10440/.test((document.querySelector('#pcRwTable') || {}).innerText || ''), null, { timeout: 10000 }).catch(() => {});
    T.eq('picked: the rental that is over', reqs(await rows(page, '#pcRwTable')), 'REQ-10418');
    T.check('no sideways scroll', await noSideways(page));
    await shot(env, 'rw-usage-costs.png');

    T.section('Post costs: a row opens the request\'s costs in its own tab, as on the current look');
    await page.click('#pcRwTable .nx-rw-num:has-text("REQ-10418")');
    await page.waitForFunction(() => (document.querySelector('.nx-tab--on') || {}).dataset.tabId === 'cost:REQ-10418', null, { timeout: 15000 });
    T.eq('the row opens its costs', await activeTab(page), 'cost:REQ-10418');
    await page.waitForSelector('#prRedwood oj-sp-general-overview-page.oj-complete', { timeout: 20000 });
    await page.waitForFunction(() => /All posted/.test((document.querySelector('#prRedwood') || {}).innerText || ''), null, { timeout: 20000 });
    T.check('…in Redwood: Oracle\'s header for REQ-10418, all posted', (await env.text('#prRedwood')).includes('REQ-10418') && (await env.text('#prRedwood')).includes('All posted'));
    await page.click('#prRedwood .oj-sp-header-general-overview-back-button, #prRedwood [aria-label="Back"], #prRedwood button[title="Back"]');
    await page.waitForFunction(() => (document.querySelector('.nx-tab--on') || {}).dataset.tabId === 'costs', null, { timeout: 15000 });
    T.eq('Back (Oracle\'s in-flow back) goes to Post costs', await activeTab(page), 'costs');
    await page.click('.nx-tab[data-tab-id="cost:REQ-10418"] .nx-tab-close');
    await page.waitForSelector('.nx-tab[data-tab-id="cost:REQ-10418"]', { state: 'detached', timeout: 10000 });
    await settle(page, 600);
    const post = page.locator('#pcRedwood oj-sp-smart-search-page button', { hasText: 'Post REQ-10440' }).first();
    T.check('the header\'s action: Post the newest request with cost ready', await post.isVisible());
    await post.click();
    await page.waitForFunction(() => (document.querySelector('.nx-tab--on') || {}).dataset.tabId === 'cost:REQ-10440', null, { timeout: 15000 });
    T.eq('…it opens that request\'s costs, as the current look\'s Post does', await activeTab(page), 'cost:REQ-10440');

    // ════════════════════════════════════════════════════════════════════════════════════════════════════════
    T.section('A request\'s costs: Oracle\'s general overview page as the header over the record');
    await page.waitForSelector('#prRedwood oj-sp-general-overview-page.oj-complete', { timeout: 20000 });
    await page.waitForFunction(() => /ready to post/.test((document.querySelector('#prRedwood') || {}).innerText || ''), null, { timeout: 20000 });
    await page.waitForSelector('#prRwPlan.oj-complete', { timeout: 20000 });
    await settle(page, 800);
    const head = await env.text('#prRedwood');
    T.check('the header: the request, its state as Oracle\'s badge, what it is', head.includes('REQ-10440') && head.includes('$3,590 ready to post')
      && head.includes('Request costs · Plant Expansion B / Electrical · PPM PRJ-B / 4.2'), head);
    T.check('the current head steps aside; the record\'s own body stays', !(await page.isVisible('.nx-pr .nx-pagehead')) && await page.isVisible('#prKpiReady')
      && await page.isVisible('.nx-grid--pr'));
    const plan = await page.$$eval('#prRwPlan tbody tr', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
    T.eq('what will be posted as Oracle\'s table: the three weeks and the charge, with where each posts', plan.map((r) => r.split(' · ')[0] + ' ' + r.slice(r.lastIndexOf('$'))).join(' | '),
      'Generator 100 kVA $1,400 | Generator 100 kVA $1,400 | Light Tower LT-4 $700 | Generator 100 kVA $90');
    T.check('…each to the request\'s project in Fusion PPM', plan.every((r) => r.includes('PRJ-B Plant Expansion B / task 4.2')), plan.join(' || '));
    const postBtn = page.locator('#prRedwood button', { hasText: 'Post 3 weeks and 1 charge · $3,590' }).first();
    w0 = env.writes.length;
    await postBtn.click();
    await page.waitForSelector('#prPostDialog', { timeout: 10000 });
    T.check('the header\'s Post opens the current look\'s post review, nothing sent yet', (await env.text('#prPostDialog')).includes('Post 3 weeks and 1 charge')
      && env.writes.length === w0);
    await shot(env, 'rw-usage-cost-post.png');
    await page.click('#prPostDialog .nx-dialog-head .nx-iconbtn');
    await page.waitForSelector('#prPostDialog', { state: 'detached', timeout: 10000 });
    await page.click('#prRedwood button[aria-label="More Actions"]');
    await page.waitForSelector('[role=menuitem]:has-text("Refresh")', { timeout: 10000 });
    T.eq('the header\'s other actions: the current look\'s Refresh and exports', await page.$$eval('[role=menuitem]', (m) => m.filter((x) => x.offsetParent !== null)
      .map((x) => x.innerText.trim()).join(' | ')), 'Refresh | Export what will be posted | Export the cost week by week');
    n = env.calls.filter((c) => c.includes('/views/post-cost-details') && c.includes('REQ-10440')).length;
    await page.click('[role=menuitem]:has-text("Refresh")');
    await page.waitForFunction(() => /ready to post/.test((document.querySelector('#prRedwood') || {}).innerText || ''), null, { timeout: 15000 });
    await settle(page, 1500);
    T.check('…Refresh reads the request\'s costs again (loadRecordChain)', env.calls.filter((c) => c.includes('/views/post-cost-details') && c.includes('REQ-10440')).length > n);
    T.check('no sideways scroll', await noSideways(page));
    await shot(env, 'rw-usage-cost.png');

    // ════════════════════════════════════════════════════════════════════════════════════════════════════════
    T.section('Direct cost & inventory: Oracle\'s general overview page as the header over the screen');
    await page.click('.nx-nav-item[data-nav-id="direct-costs"]');
    await page.waitForSelector('#dcRedwood oj-sp-general-overview-page.oj-complete', { timeout: 20000 });
    await page.waitForFunction(() => /REQ-10491/.test((document.querySelector('#dcRedwood') || {}).innerText || ''), null, { timeout: 20000 });
    await page.waitForSelector('#dcRwLines.oj-complete', { timeout: 20000 });
    await page.waitForFunction(() => /Hydraulic oil/.test((document.querySelector('#dcRwLines') || {}).innerText || ''), null, { timeout: 15000 });
    await settle(page, 600);
    T.check('the header: the title and the request open (the newest, as on the current look)', (await env.text('#dcRedwood')).includes('Direct cost & inventory')
      && (await env.text('#dcRedwood')).includes('REQ-10491 · Pipeline North / Trenching'));
    T.check('the current head steps aside; the screen\'s own body stays', !(await page.isVisible('.nx-dc .nx-pagehead')) && await page.isVisible('#dcFusion')
      && await page.isVisible('#dcKpiCons') && await page.isVisible('.nx-grid--dci'));
    const lines = await page.$$eval('#dcRwLines tbody tr', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
    T.eq('its equipment and consumables as Oracle\'s table, where each is as Oracle\'s badge', lines.join(' || '),
      'Hydraulic oil 20 L Consumable 10 10 4 6 On site || CAT 320 Excavator Equipment 1 — — — On site');
    T.eq('…badges', await page.$$eval('#dcRwLines .oj-badge-success', (b) => b.length), 2);
    T.check('…and the current grid steps aside', !(await page.$('.nx-grid--dcl')));
    await shot(env, 'rw-usage-direct-costs.png');
    await page.click('.nx-ts-qitem[data-request="REQ-10490"]');
    await page.waitForFunction(() => /REQ-10490/.test((document.querySelector('#dcRedwood') || {}).innerText || ''), null, { timeout: 15000 });
    await settle(page, 800);
    T.check('a request picked in the body (the current look\'s picker, pickRequestChain) opens in the header too',
      (await env.text('#dcRedwood')).includes('REQ-10490 · Plant Expansion B / Civil'));
    n = env.calls.filter((c) => c.includes('/views/my-requests')).length;
    await page.locator('#dcRedwood button', { hasText: 'Refresh' }).first().click();
    await page.waitForFunction((k) => true, n);
    await settle(page, 1500);
    T.check('the header\'s Refresh reads the requests again', env.calls.filter((c) => c.includes('/views/my-requests')).length > n);
    T.check('…keeping the request open; Record in New EquipRite is there for it', (await env.text('#dcRedwood')).includes('REQ-10490')
      && await page.locator('#dcRedwood button', { hasText: 'Record in New EquipRite' }).first().isVisible());
    T.check('no sideways scroll', await noSideways(page));

    T.eq('no browser errors while working in Redwood', errs().join(' | ').slice(0, 1500), '');

    // ════════════════════════════════════════════════════════════════════════════════════════════════════════
    T.section('Current brings the current look back on every screen');
    const from = errs().length;
    await env.setLook('current');
    await page.waitForSelector('.nx-dc .nx-pagehead', { timeout: 15000 });
    T.check('Direct cost: its head again, on the request open, the Redwood view kept, hidden', await page.isVisible('.nx-dc .nx-pagehead')
      && (await env.text('#dcSummary')).includes('REQ-10490') && await page.isVisible('#dcInNew') && !(await page.isVisible('#dcRedwood')) && !!(await page.$('#dcRedwood')));
    await page.click('.nx-ts-qitem[data-request="REQ-10491"]');
    await page.waitForSelector('.nx-grid--dcl', { timeout: 15000 });
    T.check('…its lines as its own grid, not Oracle\'s table', await page.isVisible('.nx-grid--dcl') && !(await page.isVisible('#dcRwLines')));
    await page.click('.nx-tab[data-tab-id="cost:REQ-10440"] .nx-tab-btn');
    await page.waitForSelector('.nx-pr .nx-pagehead', { timeout: 15000 });
    T.check('A request\'s costs: its head and its plan grid again', await page.isVisible('#prPost') && await page.isVisible('.nx-grid--plan') && !(await page.isVisible('#prRedwood')));
    await page.click('.nx-tab[data-tab-id="costs"] .nx-tab-btn');
    await page.waitForSelector('.nx-grid--pc .nx-row--click', { timeout: 15000 });
    T.check('Post costs: its head, chips and list again', await page.isVisible('#pcPostNext') && await page.isVisible('.nx-pc .nx-chips') && !(await page.isVisible('#pcRedwood')));
    await page.click('.nx-tab[data-tab-id="approve-time"] .nx-tab-btn');
    await page.waitForSelector('.nx-grid--ta .nx-ta-block', { timeout: 15000 });
    T.check('Approve time: its head, figures and grid again', await page.isVisible('#taKpiWaiting') && await page.isVisible('#taBulk') && !(await page.isVisible('#taRedwood')));
    await page.click('.nx-tab[data-tab-id="timesheets"] .nx-tab-btn');
    await page.waitForSelector('.nx-ts-queue .nx-ts-qitem', { timeout: 15000 });
    T.check('Timesheets: its head and list of requests again, the week entry where it was', await page.isVisible('#tsSummary') && await page.isVisible('.nx-ts-queue')
      && await page.isVisible('.nx-grid--ts') && !(await page.isVisible('#tsRedwood')));
    T.eq('Current on every screen', await page.getAttribute('html', 'data-nx-look'), 'current');
    T.eq('no browser errors switching back', errs().slice(from).join(' | ').slice(0, 1500), '');
  } catch (e) {
    T.check('run finished', false, String((e && e.stack) || e).slice(0, 1500));
    await env.shot('rw-usage-failed.png').catch(() => {});
  } finally {
    await env.close();
  }
  T.report();
})();
