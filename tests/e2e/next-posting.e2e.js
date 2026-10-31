'use strict';
/*
 * EquipRite Next, posting a request's costs to Fusion PPM, in a real browser against a fake backend with state (what is
 * recorded shows on the next read):
 *   choose what to post (untick a week), exclude a day, split a week across projects, add a charge, set the expenditure
 *   type, see exactly what will be sent, the confirmation's words, then Post: the writes in New EquipRite's order
 *   (env.writes: method, path, body), each line's result, the record read again and its cards; a failure from EquipRite
 *   and one from Fusion, in words; the Post costs list told; a role that may only look sees no Post.
 * No sideways scroll, no browser errors, screenshots.
 * Needs `npm run build`. Run: node tests/e2e/next-posting.e2e.js   (screenshots go to the OS temp folder, or E2E_SHOTS)
 */
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
const W = (n) => addDays(WEEK, 7 * n);
const compact = (s) => s.replace(/-/g, '');
const kW = (n) => '701:0:' + compact(W(n));
const kLT = '702:0:' + compact(W(-1));
const FUSION = '/ic/api/integration/v2/flows/rest/project/EQUIPRITE_DEV/EQP_POST_COST_FLOW_TEST/1.0/eqp/post-cost';

// ── the request ───────────────────────────────────────────────────────────────────────────────────────────────
const listRow = (o) => Object.assign({ eqrEquipmentRequestId: 4440, requestNumber: 'REQ-10440', projectName: 'Plant Expansion B', taskName: 'Electrical',
  requestedStartDate: W(-3), requestedEndDate: W(9), timesheets: 1, totalHours: 40, ppmProjectNumber: 'PRJ-B', ppmTaskNumber: '4.2', ppmProjectRefId: 3001,
  ppmTaskRefId: 4001, rateScheduleId: 77 }, o);
const PC_LIST = [listRow({ weekStartDate: W(-3), totalBillCost: 1400 }), listRow({ weekStartDate: W(-2), totalBillCost: 1400 }),
  listRow({ weekStartDate: W(-1), totalBillCost: 2100 }), listRow({ weekStartDate: W(0), totalBillCost: 1400 })];
const pcRow = (o) => Object.assign({ requestNumber: 'REQ-10440', lineType: 'RENTABLE', qty: 1, applicableRate: 200, ratePeriod: 'DAILY', totalHours: 40, postStatus: 'APPROVED' }, o);
const gen = (week, o) => pcRow(Object.assign({ rowKey: '701:0:' + compact(week), requestLineId: 701, equipmentName: 'Generator 100 kVA', weekStartDate: week,
  weekEndDate: addDays(week, 6), costAmount: 1400, lineExpenditureType: 'Equipment Rental' }, o));

function freshState() {
  return {
    det: [gen(W(-3), { postStatus: 'POSTED' }), gen(W(-2)), gen(W(-1)), gen(W(0)), gen(W(10)),
      pcRow({ rowKey: kLT, requestLineId: 702, equipmentName: 'Light Tower LT-4', weekStartDate: W(-1), weekEndDate: addDays(W(-1), 6), costAmount: 700, applicableRate: 100 })],
    misc: [{ eqrLineMiscTxnId: 55, requestNumber: 'REQ-10440', requestLineId: 701, expenditureType: 'Fuel', expenditureOrg: 'Applications and Services',
      expenditureItemDate: W(-3), quantity: 1, rawCost: 90, status: 'DRAFT', comments: 'Fuel top-up on return' }],
    splits: [
      { requestLineId: 701, weekStartDate: W(-1), projectRefId: 3001, projectNumber: 'PRJ-B', projectName: 'Plant Expansion B', taskId: 4001, taskNumber: '4.2', taskName: 'Electrical', splitPct: 60 },
      { requestLineId: 701, weekStartDate: W(-1), projectRefId: 3002, projectNumber: 'PRJ-C', projectName: 'Pipeline North', taskId: 5001, taskNumber: '2.1', taskName: 'Trenching', splitPct: 40 }],
    blackout: {},
    nextMisc: 900,
    failLedger: null,
    failFusion: false,
  };
}
let S = freshState();

/** The fake EquipRite and Fusion: what is written shows on the next read, as the views would show it. */
function handle(req, res) {
  const p = req.path;
  const q = (k) => req.query.get(k);
  const m = req.method;
  if (p.endsWith('/views/post-cost')) return res.json({ data: PC_LIST });
  if (p.endsWith('/views/post-cost-details')) return res.json({ data: q('requestNumber') === 'REQ-10440' ? S.det : [] });
  if (p.endsWith('/views/misc-transactions')) return res.json({ data: S.misc });
  if (p.endsWith('/views/line-retier-weeks')) return res.json({ data: [] });
  if (p.endsWith('/views/line-project-splits')) return res.json({ data: S.splits });
  if (p.endsWith('/views/blackout-weeks')) {
    return res.json({ data: Object.keys(S.blackout).map((k) => ({ requestLineId: Number(k.split('|')[0]), weekStartDate: k.split('|')[1], blackoutDates: S.blackout[k],
      ignoredDates: [], blackoutDays: S.blackout[k].length, applicability: 'EDITABLE' })) });
  }
  if (p.endsWith('/purchase-requisitions')) return res.json({ data: [], hasMore: false });
  if (p.endsWith('/expenditureTypesLOV')) {
    return res.json({ items: ['Equipment', 'Equipment Hire', 'Equipment Rental', 'Fuel', 'Supplies'].map((n, i) => ({ ExpenditureTypeId: 300 + i, ExpenditureTypeName: n,
      UnitOfMeasure: 'Days', ExpenditureTypeStartDate: '2020-01-01' })), hasMore: false });
  }
  if (p.endsWith('/projectsLOV')) return res.json({ items: [{ ProjectId: 3002, ProjectNumber: 'PRJ-C', ProjectName: 'Pipeline North' }] });
  if (/\/projects\/3002\/child\/Tasks$/.test(p)) {
    return res.json({ items: [{ TaskId: 5000, TaskNumber: '2', TaskName: 'Pipeline', ParentTaskId: null }, { TaskId: 5001, TaskNumber: '2.1', TaskName: 'Trenching', ParentTaskId: 5000 }] });
  }
  if (m === 'POST' && (p.endsWith('/posted-weeks') || p.endsWith('/posted-weeks/split'))) {
    const b = req.json();
    if (S.failLedger && S.failLedger === b.rowKey) return res.json({ title: 'Conflict', detail: 'Week ' + b.rowKey + ' is locked by a period close' }, 409);
    const row = S.det.find((r) => r.rowKey === b.rowKey);
    if (row) row.postStatus = 'POSTED';
    if (S.slow) { setTimeout(() => res.json({ id: 1 }, 201), S.slow); return true; }
    return res.json({ id: 1 }, 201);
  }
  if (m === 'POST' && p.endsWith('/misc-transactions/post')) {
    const ids = req.json().ids || [];
    S.misc.forEach((x) => { if (ids.indexOf(x.eqrLineMiscTxnId) >= 0) x.status = 'POSTED'; });
    return res.json({ updated: ids.length });
  }
  if (m === 'POST' && p.endsWith('/misc-transactions')) {
    const b = req.json();
    S.misc.push(Object.assign({ eqrLineMiscTxnId: S.nextMisc++, requestNumber: 'REQ-10440' }, b, { expenditureItemDate: String(b.expenditureItemDate).slice(0, 10) }));
    return res.json({ id: S.nextMisc - 1 }, 201);
  }
  if (m === 'PUT' && /\/request-lines\/(\d+)\/project-splits$/.test(p)) {
    const id = Number(/\/request-lines\/(\d+)\//.exec(p)[1]);
    const b = req.json();
    const wk = String(b.weekStartDate).slice(0, 10);
    S.splits = S.splits.filter((s) => !(s.requestLineId === id && s.weekStartDate === wk)).concat(b.splits.map((s) => Object.assign({ requestLineId: id, weekStartDate: wk }, s)));
    return res.json({ ok: true });
  }
  if (m === 'POST' && p.endsWith('/line-day-exceptions')) {
    const b = req.json();
    const week = S.det.find((r) => r.requestLineId === b.requestLineId && r.weekStartDate <= b.exceptionDate && r.weekEndDate >= b.exceptionDate);
    const key = b.requestLineId + '|' + week.weekStartDate;
    S.blackout[key] = (S.blackout[key] || []).filter((d) => d !== b.exceptionDate).concat(b.rateType === 'BLACKOUT' ? [b.exceptionDate] : []);
    week.costAmount = 1400 - 200 * S.blackout[key].length; // the engine prices the week again
    return res.json({ id: 1 }, 201);
  }
  if (m === 'PATCH' && /\/equipment-requests\/4440\/lines\/batch$/.test(p)) {
    const lines = req.json().lines || [];
    lines.forEach((l) => S.det.forEach((r) => { if (r.requestLineId === l.id && r.postStatus !== 'POSTED') r.lineExpenditureType = l.expenditureType; }));
    return res.json({ data: [] });
  }
  if (p.endsWith('/eqp/post-cost')) {
    if (S.failFusion) return res.json({ title: 'Internal Server Error', detail: 'PPM import failed: task 4.2 is closed for charges' }, 500);
    return res.json({ status: 'OK' });
  }
  return undefined;
}

async function noSideways(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth
    && [...document.querySelectorAll('.nx-content')].every((c) => c.scrollWidth <= c.clientWidth + 1));
}
const writesSince = (env, n) => env.writes.slice(n).map((w) => w.method + ' ' + strip(w.path) + (w.body ? ' ' + JSON.stringify(w.body) : ''));
const money = (n) => '$' + n.toLocaleString('en-US');
const expectedErrors = (e) => /status of (409|500)/.test(e);

(async () => {
  const env = await E.start({ port: 19470, app: 'next', handle, flags: ['PROJECTS_MODULE_ENABLED', 'TIMESHEETS_ENABLED'], shots: process.env.E2E_SHOTS });
  const { page } = env;
  const grid = (sel) => '.nx-grid--pr ' + sel;
  const settle = async (ms) => page.waitForTimeout(ms || 500);
  /** The post dialog's kicker, as written (it is shown in capitals). */
  const kicker = async () => page.$eval('#prPostDialog .nx-kicker', (e) => e.textContent.replace(/\s+/g, ' ').trim());
  try {
    // ════════════════════════════════════════════════════════════════════════════════════════════════════════
    T.section('Post costs: posting starts from here');
    await env.open('/?open=costs');
    await page.waitForSelector('#pcPostNext', { timeout: 30000 });
    await settle(400);
    T.check('the list says posting is done here', (await env.text('#pcFusion')).startsWith('Post to Fusion PPM from here, request by request.'));
    T.check('a request with cost ready offers Review & post', (await env.text('.nx-grid--pc .nx-row--click[data-number="REQ-10440"]')).includes('Review & post'));
    const w0 = env.writes.length;
    await page.click('#pcPostNext');
    await page.waitForSelector('#prPlanTotal', { timeout: 20000 });
    await page.waitForSelector('#prPost:not([disabled])', { timeout: 20000 });
    await settle(600);
    T.eq('the request opens in its own tab, everything ready ticked', [await page.$eval('.nx-tab--on', (t) => t.dataset.tabId), await env.text('#prPost')].join(' | '),
      'cost:REQ-10440 | Post 3 weeks and 1 charge · $3,590');
    T.eq('opening writes nothing', env.writes.length, w0);

    T.section('Choose what to post');
    await page.click(grid(`input[data-action="week"][data-key="${kLT}"]`));
    await settle();
    T.eq('unticking the light tower leaves 2 weeks and the charge', await env.text('#prTicked'), '2 weeks and 1 charge ticked, $2,890 · tick or untick the weeks and charges below');
    T.eq('what will be posted follows', [await env.text('#prPlanTitle'), await env.text('#prPlanTotal')].join(' | '), 'What will be posted (3) | $2,890');
    await page.click('#prSelectNone');
    await settle();
    T.eq('Select none: nothing to post, and Post is shut', [await env.text('#prPost'), await page.$eval('#prPost', (b) => b.disabled)].join(' | '), 'Tick what to post | true');
    await page.click('#prSelectAll');
    await settle();
    T.eq('Select all ready', await env.text('#prPost'), 'Post 3 weeks and 1 charge · $3,590');
    await page.click(grid(`input[data-action="week"][data-key="${kLT}"]`));
    await settle();

    T.section('Exclude a day');
    await page.click(grid(`button[data-action="toggleDays"][data-key="${kW(-2)}"]`));
    await page.waitForSelector(grid('.nx-pr-row--day'));
    T.eq('the week\'s days open', await page.$$eval('.nx-grid--pr .nx-pr-row--day', (r) => r.length), 7);
    let wx = env.writes.length;
    const day = kW(-2) + '_d2';
    await page.click(grid(`.nx-pr-row--day[data-key="${day}"] input`));
    await settle(800);
    T.eq('New\'s blackout upsert', writesSince(env, wx).join('\n'), 'POST /line-day-exceptions ' + JSON.stringify({ requestLineId: 701, exceptionDate: addDays(W(-2), 2),
      rateType: 'BLACKOUT', reason: 'Excluded from post cost' }));
    T.eq('the week costs a day less, and so does the plan', [await page.$eval(grid(`.nx-row[data-key="${kW(-2)}"] > span:last-child`), (e) => e.innerText.trim()),
      await env.text('#prPlanTotal'), await page.$eval('#prKpiReady .nx-kpi-value', (e) => e.innerText.trim())].join(' | '), '$1,200 | $2,690 | $3,390');

    T.section('Split a week across projects');
    await page.click(grid(`button[data-panel="split"][data-key="${kW(-2)}"]`));
    await page.waitForSelector('#prSplitDialog');
    T.check('it starts with the request\'s own project', (await env.text('#prSplitDialog .nx-pp-slices')).includes('PRJ-B / task 4.2'));
    await page.fill('.nx-pp-pct[data-index="0"]', '70');
    await page.keyboard.press('Tab');
    await page.fill('#prSplitFind', 'Pipe');
    await page.waitForSelector('#prSplitDialog .nx-pp-opt[data-index="0"]');
    await page.click('#prSplitDialog .nx-pp-opt[data-index="0"]');
    await page.waitForSelector('#prSplitPicked');
    await page.waitForFunction(() => [...document.querySelectorAll('#prSplitDialog .nx-pp-opt')].some((b) => b.innerText.includes('2.1')));
    T.check('only the chargeable task is offered (the summary task is not)', !(await env.text('#prSplitDialog .nx-pp-opts')).includes('2 Pipeline'));
    await page.click('#prSplitDialog .nx-pp-opt[data-index="0"]');
    await page.fill('#prSplitPct', '30');
    await page.keyboard.press('Tab');
    await page.click('#prSplitAdd');
    await settle();
    T.eq('the split adds up', await env.text('#prSplitTotal'), 'Total 100%');
    await env.shot('next-posting-split.png');
    wx = env.writes.length;
    await page.click('#prSplitSave');
    await page.waitForSelector('#prSplitDialog', { state: 'detached' });
    await settle();
    T.eq('New\'s split write: percentages for the week', writesSince(env, wx).map((w) => w.split(' {')[0]).join() + ' ' + JSON.stringify(env.writes[wx].body.splits.map((s) => s.projectNumber
      + '/' + s.taskNumber + ' ' + s.splitPct)), 'PUT /request-lines/701/project-splits ["PRJ-B/4.2 70","PRJ-C/2.1 30"]');
    T.check('the plan shows where the week goes', (await env.text(`.nx-grid--plan .nx-row[data-key="${kW(-2)}"]`)).includes('70% PRJ-B / 4.2, 30% PRJ-C / 2.1'));

    T.section('Add a charge');
    await page.click(grid('button[data-panel="misc"][data-key="g0"]'));
    await page.waitForSelector('#prMiscDialog');
    await page.fill('#prMiscAmount', '250');
    await page.keyboard.press('Tab');
    await page.fill('#prMiscComments', 'Delivery by crane');
    await page.keyboard.press('Tab');
    wx = env.writes.length;
    await page.click('#prMiscSave');
    await page.waitForSelector('#prMiscDialog', { state: 'detached' });
    await page.waitForSelector(grid('.nx-row[data-key="misc_900"]'), { timeout: 10000 });
    await settle(600);
    T.eq('New\'s charge write', writesSince(env, wx).join('\n'), 'POST /misc-transactions ' + JSON.stringify({ requestLineId: 701, expenditureType: 'Equipment',
      expenditureOrg: 'Applications and Services', expenditureItemDate: W(-1) + 'T00:00:00Z', quantity: 1, rawCost: 250, currencyCode: 'USD', comments: 'Delivery by crane', status: 'DRAFT' }));
    T.check('the record is read again: the charge is there, ticked, and the excluded day stays out', await page.$eval(grid('input[data-key="misc_900"]'), (i) => i.checked)
      && (await env.text('#prPlanTotal')) === '$2,940');
    T.eq('...and the light tower stays unticked', await page.$eval(grid(`input[data-key="${kLT}"]`), (i) => i.checked), false);

    T.section('The expenditure type');
    await page.click(grid('button[data-panel="exptype"][data-key="g0"]'));
    await page.waitForSelector('#prExpDialog .nx-pp-opt[data-value="Equipment Hire"]', { timeout: 10000 });
    await page.click('#prExpDialog .nx-pp-opt[data-value="Equipment Hire"]');
    wx = env.writes.length;
    await page.click('#prExpSave');
    await page.waitForSelector('#prExpDialog', { state: 'detached' });
    await settle();
    T.eq('one batch for the equipment\'s line', writesSince(env, wx).join('\n'), 'PATCH /equipment-requests/4440/lines/batch {"lines":[{"id":701,"expenditureType":"Equipment Hire"}]}');
    T.check('its weeks post under it', (await env.text(`.nx-grid--plan .nx-row[data-key="${kW(-2)}"]`)).includes('Equipment Hire'));

    T.section('Exactly what is sent, then the confirmation');
    await page.click('#prCalls summary');
    await settle(300);
    const shown = await page.$$eval('#prCalls .nx-pp-code', (c) => c.map((x) => x.innerText.trim()));
    T.eq('the calls, in order', shown.join(' | '), 'POST /equiprite/v1/posted-weeks/split | POST /equiprite/v1/posted-weeks/split | POST /equiprite/v1/misc-transactions/post | POST ' + FUSION);
    await page.click('#prPost');
    await page.waitForSelector('#prPostDialog');
    await settle(400);
    T.eq('the confirmation says what will happen', await env.text('#prPostTitle'), 'Post 2 weeks and 2 charges, $2,940, to PRJ-B Plant Expansion B / task 4.2 in Fusion PPM');
    T.check('...which weeks are split, and how', (await env.text('#prSplitNote')).startsWith('2 weeks are split: Generator 100 kVA · ')
      && (await env.text('#prSplitNote')).includes('70% PRJ-B / 4.2, 30% PRJ-C / 2.1'));
    T.eq('...the steps', await env.text('#prSteps'), 'Record 2 weeks in the posting ledger Mark 2 charges posted Send REQ-10440 to Fusion PPM');
    T.eq('...and the button', await env.text('#prGo'), 'Post $2,940 to Fusion PPM');
    T.check('the confirmation wrote nothing', env.writes.length === wx + 1);
    await env.shot('next-posting-confirm.png');

    T.section('Post: New\'s calls, in New\'s order');
    wx = env.writes.length;
    const c0 = env.calls.length;
    S.slow = 700;
    await page.dblclick('#prGo');
    await page.waitForSelector('#prPostLines li[data-state="posting"]', { timeout: 5000 });
    T.eq('progress: line by line, and the dialog cannot be closed meanwhile', [await kicker(), await env.text('#prPostDone'),
      await page.$eval('#prPostDone', (b) => b.disabled), await page.$$eval('#prPostLines li', (l) => l.map((x) => x.dataset.state).join(' '))].join(' | '),
    'Posting… | Posting… | true | posting waiting waiting waiting');
    await page.waitForFunction(() => { const b = document.querySelector('#prPostDone'); return b && !b.disabled && b.innerText.trim() === 'Close'; }, null, { timeout: 20000 });
    S.slow = 0;
    await settle(500);
    const sent = env.writes.slice(wx);
    T.eq('each week to the posting ledger, the charges, then Fusion PPM', sent.map((w) => w.method + ' ' + strip(w.path)).join(' > '),
      'POST /posted-weeks/split > POST /posted-weeks/split > POST /misc-transactions/post > POST ' + FUSION);
    T.eq('the first week: New\'s ledger body, a day excluded, split, under the new type', JSON.stringify(sent[0].body), JSON.stringify({ requestLineId: 701,
      weekStartDate: W(-2) + 'T00:00:00Z', rowKey: kW(-2), status: 'POSTED', entryKind: 'ORIGINAL', postedSource: 'CP', postedCostAmount: 1200, costRate: 200, periodType: 'DAILY',
      billableDuration: 6, rateScheduleId: 77, expenditureType: 'Equipment Hire', reversalRef: null, ppmBatchName: null,
      splits: [{ projectRefId: 3001, projectNumber: 'PRJ-B', taskId: 4001, taskNumber: '4.2', splitPct: 70 }, { projectRefId: 3002, projectNumber: 'PRJ-C', taskId: 5001, taskNumber: '2.1', splitPct: 30 }] }));
    T.eq('the charges as one id list; Fusion is sent the request number', JSON.stringify([sent[2].body, sent[3].body]), '[{"ids":[55,900]},{"requestNumber":"REQ-10440"}]');
    T.eq('each line\'s result', await page.$$eval('#prPostLines li', (l) => l.map((x) => x.dataset.key.replace(/^701:0:\d+$/, 'week') + ':' + x.dataset.state).join(' ')),
      'week:posted week:posted charges:posted fusion:posted');
    T.eq('...in words', [await kicker(), await env.text('#prPostSummary')].join(' | '),
      'Posted | Posted 2 weeks ($2,600) and 2 charges ($340) of REQ-10440 to Fusion PPM.');
    T.check('the record was read again', env.calls.slice(c0).some((c) => /views\/post-cost-details/.test(c)) && env.calls.slice(c0).some((c) => /views\/post-cost\?/.test(c)));
    await env.shot('next-posting-result.png');
    await page.click('#prPostDone');
    await page.waitForSelector('#prPostDialog', { state: 'detached' });
    await settle(500);
    T.eq('the cards follow: ready, posted', [await page.$eval('#prKpiReady .nx-kpi-value', (e) => e.innerText.trim()), await page.$eval('#prKpiPosted .nx-kpi-value', (e) => e.innerText.trim()),
      await env.text('#prHead')].join(' | '), '$700 | ' + money(1400 + 2600 + 340) + ' | $700 ready to post');
    T.check('the result stays on the page', (await env.text('#prResult')).includes('Posted 2 weeks ($2,600) and 2 charges ($340) of REQ-10440 to Fusion PPM.'));
    T.eq('the posted weeks read Posted, with nothing to tick', await page.$$eval(`.nx-grid--pr .nx-row[data-key="${kW(-2)}"], .nx-grid--pr .nx-row[data-key="${kW(-1)}"]`,
      (r) => r.map((x) => (x.querySelector('input[data-action]') ? 'tick ' : '') + x.querySelector('.nx-pill').innerText.trim()).join(', ')), 'Posted, Posted');
    T.eq('...and only the light tower is left to post, unticked', [await env.text('#prPost'), await page.$eval('#prPost', (b) => b.disabled)].join(' | '), 'Tick what to post | true');
    await page.click('#prPostBottom').catch(() => {});
    T.check('no double post: nothing ticked, nothing sent', env.writes.length === wx + 4);
    T.check('no sideways scroll', await noSideways(page));
    T.eq('no browser errors so far', env.errors.filter((e) => !e.startsWith('warning')).join('\n'), '');

    T.section('When EquipRite or Fusion says no');
    S.failLedger = kLT;
    await page.click(grid(`input[data-action="week"][data-key="${kLT}"]`));
    await settle();
    await page.click('#prPost');
    await page.waitForSelector('#prGo');
    wx = env.writes.length;
    await page.click('#prGo');
    await page.waitForFunction(() => { const b = document.querySelector('#prPostDone'); return b && !b.disabled; }, null, { timeout: 20000 });
    await settle(400);
    T.eq('the ledger refuses: nothing recorded, so nothing goes to Fusion', writesSince(env, wx).map((w) => w.split(' {')[0]).join(' > '), 'POST /posted-weeks');
    T.eq('...the line says why, in EquipRite\'s words', await env.text(`#prPostLines li[data-key="${kLT}"] .nx-pp-line-words`),
      'Not posted: EquipRite could not record it: Week ' + kLT + ' is locked by a period close (HTTP 409). It stays ready to post.');
    T.eq('...and the outcome', [await kicker(), await env.text('#prPostSummary')].join(' | '),
      'Not posted | Posting failed for 1 week. Nothing was recorded, so nothing was sent to Fusion PPM.');
    await page.click('#prPostDone');
    await settle(300);
    T.check('the failure stays on the page', (await env.text('#prPostError')).startsWith('Posting failed for 1 week.'));
    S.failLedger = null;
    S.failFusion = true;
    await page.click('#prPost');
    await page.waitForSelector('#prGo');
    wx = env.writes.length;
    await page.click('#prGo');
    await page.waitForFunction(() => { const b = document.querySelector('#prPostDone'); return b && !b.disabled; }, null, { timeout: 20000 });
    await settle(600);
    T.eq('Fusion refuses: the week is recorded, and the send is said to have failed', writesSince(env, wx).map((w) => w.split(' {')[0]).join(' > '), 'POST /posted-weeks > POST ' + FUSION);
    T.eq('...the line: recorded, not sent', await page.$eval(`#prPostLines li[data-key="${kLT}"]`, (l) => l.dataset.state + ': ' + l.querySelector('.nx-pp-line-words').innerText.trim()),
      'recorded: Recorded; not sent to Fusion PPM yet (it goes with the next post)');
    T.eq('...said at the top', await kicker(), 'Recorded, not sent to Fusion PPM yet');
    T.eq('...Fusion\'s error in words', await env.text('#prPostLines li[data-key="fusion"] .nx-pp-line-words'),
      'Fusion PPM did not take it: PPM import failed: task 4.2 is closed for charges (HTTP 500). What was recorded stays recorded and goes with the next post.');
    await env.shot('next-posting-fusion-failed.png');
    await page.click('#prPostDone');
    await settle(400);
    T.eq('the week is recorded in EquipRite; nothing is left ready but this week, still running', [await page.$eval('#prKpiReady .nx-kpi-value', (e) => e.innerText.trim()),
      await env.text('#prHead')].join(' | '), '$0 | Running, nothing ready yet');
    T.eq('no browser errors (the refused calls\' own 409 and 500 left out)', env.errors.filter((e) => !e.startsWith('warning') && !expectedErrors(e)).join('\n'), '');

    T.section('The list reads again after a post');
    await page.click('.nx-tab-btn[data-id="costs"]');
    await page.waitForFunction(() => !document.querySelector('#pcSummary').innerText.includes('working out'), null, { timeout: 20000 });
    await settle(600);
    T.eq('the request is all posted on the list too', [await page.$eval('#pcKpiReady .nx-kpi-value', (e) => e.innerText.trim()),
      (await env.text('.nx-grid--pc .nx-row--click[data-number="REQ-10440"]')).includes('Review & post')].join(' | '), '$0 | false');
    T.check('no sideways scroll', await noSideways(page));
  } catch (e) {
    T.check('run finished', false, e.message);
    if (process.env.E2E_DEBUG) console.log(env.calls.slice(-30).join('\n') + '\n' + env.errors.join('\n'));
    await env.shot('next-posting-failed.png').catch(() => {});
  } finally {
    if (process.env.E2E_DEBUG) console.log('browser said:\n' + env.errors.join('\n'));
    await env.close();
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════
  // A role that may only look (Post costs READ_ONLY): the preview as before, no Post.
  S = freshState();
  const access = Object.fromEntries(E.ALL_CODES.map((c) => [c, 'FULL']));
  access.EQR_POST_COST = 'READ_ONLY';
  const ro = await E.start({ port: 19470, app: 'next', handle, access, flags: ['PROJECTS_MODULE_ENABLED', 'TIMESHEETS_ENABLED'], shots: process.env.E2E_SHOTS });
  try {
    const pg = ro.page;
    T.section('A role that may only look');
    await ro.open('/?open=cost&number=REQ-10440');
    await pg.waitForSelector('#prPlanTotal', { timeout: 30000 });
    await pg.waitForTimeout(800);
    T.eq('no Post, no ticks, no changes', [await pg.$$eval('#prPost, #prPostBottom, #prSelectAll', (b) => b.length), await pg.$$eval('.nx-grid--pr input', (i) => i.length),
      await pg.$$eval('.nx-grid--pr button[data-panel]', (b) => b.length)].join(','), '0,0,0');
    T.check('it says so, and shows what would be posted', (await ro.text('#prReadOnly')).startsWith('Your role can see these costs, not post them.')
      && (await ro.text('#prPlanTitle')) === 'What would be posted (4)' && (await ro.text('#prPlanTotal')) === '$3,590');
    await ro.shot('next-posting-read-only.png');
    T.check('no sideways scroll', await noSideways(pg));
    await ro.open('/?open=costs');
    await pg.waitForSelector('.nx-grid--pc .nx-row--click', { timeout: 30000 });
    await pg.waitForTimeout(800);
    T.check('the list offers no posting either', !(await pg.$('#pcPostNext')) && !(await pg.$('.nx-pc-post'))
      && (await ro.text('#pcFusion')).startsWith('Your role can see what is ready and what was posted, not post it.'));
    T.eq('nothing written', ro.writes.length, 0);
    T.eq('no browser errors', ro.errors.filter((e) => !e.startsWith('warning')).join('\n'), '');
  } catch (e) {
    T.check('read-only run finished', false, e.message);
    await ro.shot('next-posting-read-only-failed.png').catch(() => {});
  } finally {
    await ro.close();
    T.report();
  }
})();
