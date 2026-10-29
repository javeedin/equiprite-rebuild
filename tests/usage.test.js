/*
 * New EquipRite, Usage & cost (webApps/equiprite/flows/usage): Time entry, Timesheet approval, Post costs and Direct
 * cost & inventory.
 *
 * Loads the REAL page modules, chains and shared helpers (AMD, in a sandbox) and checks:
 *   - the pure page functions: week math, totals, variance, the split rule, the preview tree, the ledger body
 *   - every chain that writes, against a fake Actions: endpoint, body, order, and what happens on a failure
 *   - the old helpers are copied unchanged, every endpoint named exists in services/, and the menu leads here
 *
 * Run:  node tests/usage.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const ROOT = path.join(__dirname, '..');
const NEW = path.join(ROOT, 'webApps', 'equiprite');
const OLD = path.join(ROOT, 'webApps', 'vbredwoodapp');
const PAGES = path.join(NEW, 'flows', 'usage', 'pages');
const JS = path.join(NEW, 'resources', 'js');

function loadAmd(file, deps) {
  const sandbox = { console, setTimeout, clearTimeout, Promise, Date, window: {}, document: { querySelectorAll: () => [], body: {} },
    MutationObserver: function () { this.observe = () => {}; } };
  let mod;
  sandbox.define = (names, factory) => { mod = factory(...names.map((n) => (deps && n in deps ? deps[n] : {}))); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: path.basename(file) });
  return mod;
}

const weeks = loadAmd(path.join(JS, 'usageWeeks.js'));
const timesheetRows = loadAmd(path.join(JS, 'timesheetRows.js'));
const lineBody = loadAmd(path.join(JS, 'requestLineBody.js'));
const prPassThrough = loadAmd(path.join(JS, 'prPassThrough.js'));
const postCostToFusion = loadAmd(path.join(JS, 'postCostToFusion.js'));
const projectTaskTree = loadAmd(path.join(JS, 'projectTaskTree.js'));
const usageGuard = loadAmd(path.join(JS, 'usageGuard.js'));
const cu = { auditHeaders: () => ({ 'X-User-Id': 'pat.lee' }), auditActor: () => 'pat.lee' };
const expenditureTypes = { resolveRequestIdByNumber: async () => 4440, loadForRequest: async () => [], attachUnits: async (c, l) => l };

const TE = new (loadAmd(path.join(PAGES, 'time-entry-page.js'), { 'resources/js/timesheetRows': timesheetRows, 'resources/js/usageWeeks': weeks }))();
const TA = new (loadAmd(path.join(PAGES, 'timesheet-approval-page.js'), { 'resources/js/usageWeeks': weeks }))();
const PC = new (loadAmd(path.join(PAGES, 'post-costs-page.js'), { 'resources/js/prPassThrough': prPassThrough }))();
const DC = new (loadAmd(path.join(PAGES, 'project-costs-page.js')))();

function chain(page, name, Actions) {
  return loadAmd(path.join(PAGES, page + '-page-chains', name + '.js'), {
    'vb/action/actionChain': class {}, 'vb/action/actions': Actions,
    'resources/js/currentUser': cu, 'resources/js/requestLineBody': lineBody, 'resources/js/postCostToFusion': postCostToFusion,
    'resources/js/prPassThrough': prPassThrough, 'resources/js/projectTaskTree': projectTaskTree, 'resources/js/usageGuard': usageGuard,
    'resources/js/expenditureTypes': expenditureTypes,
  });
}

/** A fake backend: responder(o) answers each call; every call, toast, chain and navigation is recorded. */
function fake(responder) {
  const calls = [];
  const Actions = {
    async callRest(context, o) {
      calls.push({ endpoint: o.endpoint, uriParams: o.uriParams, body: o.body, headers: o.headers });
      const r = responder && responder(o, calls.length);
      return r || { ok: true, status: 200, body: {} };
    },
    async fireNotificationEvent(context, n) { calls.push({ toast: n.summary, type: n.type, message: n.message }); },
    async callChain(context, c) { calls.push({ chain: c.chain, params: c.params }); },
    async navigateToPage(context, n) { calls.push({ nav: n.page }); },
    async navigateToFlow(context, n) { calls.push({ nav: n.flow + '/' + n.page }); },
  };
  const rest = () => calls.filter((c) => c.endpoint);
  return { calls, Actions, rest, seq: () => rest().map((c) => c.endpoint.replace('eqp-v1/', '')).join(' > ') };
}

function appCtx(flags, extra) {
  const f = flags || {};
  return Object.assign({
    variables: { flagsLoaded: true, featureFlags: f, pageAccessMap: {}, pageAccessLoaded: true, buRateSources: {} },
    functions: {
      isFeatureEnabled: (fl, loaded, k) => !!loaded && !!fl && fl[k] === 'true',
      isPageReadOnly: () => false,
    },
  }, extra || {});
}

(async () => {
  // ── week math ──────────────────────────────────────────────────────
  T.section('week math (usageWeeks)');
  T.eq('Monday of a Thursday', weeks.mondayOf('2026-10-29'), '2026-10-26');
  T.eq('Monday of a Sunday is the Monday before', weeks.mondayOf('2026-11-01'), '2026-10-26');
  T.eq('a week across months', weeks.weekLabel('2026-10-26'), '26 Oct – 1 Nov 2026');
  T.eq('a week across years', weeks.weekLabel('2025-12-29'), '29 Dec 2025 – 4 Jan 2026');
  T.eq('seven days from Monday', weeks.weekDays('2026-10-28').map((d) => d.dow + d.num).join(' '), 'Mon26 Tue27 Wed28 Thu29 Fri30 Sat31 Sun1');
  T.eq('the rental span in weeks', weeks.weeksBetween('2026-10-01', '2026-10-20').join(','), '2026-09-28,2026-10-05,2026-10-12,2026-10-19');
  T.eq('a week before the span clamps to its first', weeks.clampWeek('2026-09-01', ['2026-09-28', '2026-10-05']), '2026-09-28');
  T.eq('a week after the span clamps to its last', weeks.clampWeek('2027-01-01', ['2026-09-28', '2026-10-05']), '2026-10-05');
  T.check('inside the dates, both ends counted', weeks.inSpan('2026-10-28', '2026-10-28', '2026-10-30') && !weeks.inSpan('2026-10-27', '2026-10-28', '2026-10-30'));
  T.eq('no daylight-saving drift', weeks.addDays('2026-03-28', 7), '2026-04-04');

  // ── time entry: rows and totals ─────────────────────────────────────
  T.section('time entry: rows, totals, checks');
  const WEEK = '2026-10-26';
  const API = [
    { eqrTimeEntryId: 900, requestNumber: 'REQ-1', requestLineId: 501, equipmentName: 'CAT 320', hoursType: 'USAGE', entryStatus: 'DRAFT', isRentable: 'Y',
      requestedStartDate: '2026-10-01T00:00:00Z', requestedEndDate: '2026-12-15T00:00:00Z', day1Hours: 8, day2Hours: 8, day3Hours: 8, day4Hours: 8, day5Hours: 8, expenditureType: 'Equipment' },
    { eqrTimeEntryId: null, requestNumber: 'REQ-1', requestLineId: 502, equipmentName: 'Dump Truck', hoursType: '', entryStatus: null, isRentable: null,
      requestedStartDate: '2026-10-28T00:00:00Z', requestedEndDate: '2026-12-15T00:00:00Z', defaultHours: 9 },
    { eqrTimeEntryId: 905, requestNumber: 'REQ-1', requestLineId: 503, equipmentName: 'Cones', entryStatus: 'DRAFT', isRentable: 'N' },
    { eqrTimeEntryId: 906, requestNumber: 'REQ-1', requestLineId: 504, equipmentName: 'Crane', hoursType: 'STANDBY', entryStatus: 'SUBMITTED', isRentable: 'Y',
      requestedStartDate: '2026-10-01', requestedEndDate: '2026-12-15', day1Hours: 4 },
  ];
  const rows = TE.buildRows(API, WEEK);
  const days = TE.weekDays(WEEK);
  T.eq('a non-rentable line is never a timesheet row', rows.map((r) => r.lineId).join(','), '501,502,504');
  T.eq('a new line takes its planned hours inside its dates only', rows[1].hours.join(','), '0,0,9,9,9,9,9');
  T.check('...and says so', rows[1].prefilled && !rows[0].prefilled);
  T.eq('a day before the line starts is closed', TE.cellEditable(rows[1], days[1], false), false);
  T.eq('a submitted row is closed', TE.isEditable(rows[2], false), false);
  T.eq('read-only access closes every row', TE.isEditable(rows[0], true), false);
  let edits = { 'L501|d0': '10', 'L501|d5': '2.5' };
  T.eq('row total with typing', TE.rowTotal(rows[0], edits), 44.5);
  T.eq('day totals', TE.dayTotals(rows, edits).join(','), '14,8,17,17,17,11.5,9');
  T.eq('week total', TE.weekTotal(rows, edits), 44.5 + 45 + 4);
  T.eq('totals by hours type (no type counts as Usage, as saved)', TE.typeTotalsText(rows, edits), 'usage 89.5 · standby 4');
  T.check('the typed row is dirty, the others not', TE.isRowDirty(rows[0], edits) && !TE.isRowDirty(rows[1], edits));
  T.eq('a day over 24 h is a problem', TE.problems(rows, { 'L501|d2': '26' }, days, []).join(' '), 'Wed 28 Oct on CAT 320: 26 h; a day can\'t exceed 24 h.');
  T.eq('text is a problem', TE.problems(rows, { 'L501|d2': 'x' }, days, []).length, 1);
  T.eq('a day-unit type caps a box at 1', TE.hoursMax(rows[0], {}, [{ value: 'Equipment', uom: 'Day' }]), 1);
  T.eq('cell state shows the bad box', TE.cellState(rows[0], 2, { 'L501|d2': '26' }, []), 'bad');
  T.eq('rate type required on the rows being submitted (old sentence)', TE.validateRateTypes(rows, {}, ['L501', 'L502']),
    'Rate Type is required for row 2. Please select a Rate Type before submitting.');
  T.eq('...not on rows left out', TE.validateRateTypes(rows, {}, ['L501']), null);
  T.check('PPM: a line with hours needs an expenditure type', /required for rows 2, 3\./.test(TE.validateExpenditureTypes(rows, {}, [{ value: 'Equipment' }])));
  T.eq('header status of the week', TE.headerStatus(API), 'DRAFT');
  T.eq('rate from the request line', TE.rateText(rows[0], { 501: { billRate: 1400, priceUom: 'day' } }), '$1,400 / DAY');
  T.eq('the week arrows stay in the span', TE.stepWeek(['2026-10-19', WEEK], WEEK, 1), '');

  T.section('time entry: what Save sends');
  const cs = TE.changeSet(rows, edits);
  T.eq('an update for the changed entry only', cs.updates.map((u) => u.id).join(','), '900');
  T.eq('...in the old grid body shape', JSON.stringify(cs.updates[0].body),
    '{"hours_type":"USAGE","request_line_id":501,"hours_day1":10,"hours_day2":8,"hours_day3":8,"hours_day4":8,"hours_day5":8,"hours_day6":2.5,"hours_day7":0}');
  T.eq('a create for the line with no entry', cs.creates.map((c) => c.body.request_line_id).join(','), '502');
  T.eq('expenditure type changes per line, never cleared, only listed values',
    JSON.stringify(TE.expTypeChanges(rows, { 'L502|exp': 'Supplies', 'L501|exp': '' }, [{ value: 'Supplies' }])), '[{"requestLineId":502,"expenditureType":"Supplies"}]');
  T.eq('submit ids: picked entries not already submitted', TE.submitIds(API, [906], [501]).join(','), '900');
  const copied = TE.copyFrom([{ requestLineId: 501, eqrTimeEntryId: 880, hoursType: 'USAGE', day1Hours: 9, day2Hours: 9, day3Hours: 9, day4Hours: 9, day5Hours: 4 },
    { requestLineId: 502, eqrTimeEntryId: 881, hoursType: 'STANDBY', day1Hours: 5, day2Hours: 5, day3Hours: 5 }], rows, {}, WEEK);
  T.eq('copy last week: two rows filled', copied.copied, 2);
  T.eq('...only on days inside the line\'s dates', [0, 1, 2].map((i) => copied.edits['L502|d' + i]).join(','), ',,5');
  T.eq('...with last week\'s rate type where none is set', copied.edits['L502|type'], 'STANDBY');
  T.check('...never onto a submitted row', !('L504|d0' in copied.edits));
  T.check('CSV has a header and a line per row', TE.csv(rows, edits, days).split('\r\n').length === 4);

  // ── time entry: Save and Submit chains ──────────────────────────────
  T.section('time entry: Save and Submit (old saveTimesheetChain / submitTimesheetChain)');
  function teCtx(over, flags) {
    const variables = Object.assign({ requestNumber: 'REQ-1', weekStart: WEEK, weekDays: days, rows, edits: Object.assign({}, edits), picked: { L501: true, L502: true },
      expTypeList: [{ value: 'Equipment' }, { value: 'Supplies' }], internalRequestId: 7001, isSaving: false, readOnly: false, saveError: '' }, over || {});
    return { $page: { variables, functions: TE }, $application: appCtx(flags || {}) };
  }
  const teResponder = (o) => {
    if (o.endpoint === 'eqp-v1/createTimeEntry') return { ok: true, status: 201, body: { id: 901 } };
    if (o.endpoint === 'eqp-v1/getEquipriteV1ViewsTimesheetDetailsByWeek') {
      return { ok: true, body: { data: [Object.assign({}, API[0]), Object.assign({}, API[1], { eqrTimeEntryId: 901, entryStatus: 'DRAFT' }), API[3]] } };
    }
    return null;
  };
  {
    const f = fake(teResponder);
    const Save = chain('time-entry', 'saveTimesheetChain', f.Actions);
    const c = teCtx({ edits: Object.assign({ 'L502|exp': 'Supplies' }, edits) });
    await new Save().run(c, { mode: 'save' });
    T.eq('save: PATCH entry, 7 days, POST new entry, 7 days, then the expenditure-type batch', f.seq(),
      ['patchTimeEntry'].concat(Array(7).fill('createTimeEntryDay'), ['createTimeEntry'], Array(7).fill('createTimeEntryDay'), ['patchRequestLinesBatch']).join(' > '));
    const r = f.rest();
    T.eq('PATCH body: totals, USAGE, back to DRAFT', JSON.stringify(r[0].body), '{"totalHours":44.5,"billableHours":44.5,"entryType":"USAGE","status":"DRAFT"}');
    T.eq('day bodies: entry, date at midnight UTC, hours', JSON.stringify(r[6].body), '{"timeEntryId":900,"workDate":"2026-10-31T00:00:00Z","hoursWorked":2.5}');
    T.eq('POST body for a new line', JSON.stringify(r[8].body), '{"requestLineId":502,"entryDate":"2026-10-26T00:00:00Z","entryType":"USAGE","totalHours":45,"billableHours":45,"status":"DRAFT"}');
    T.eq('...its days go to the new entry', r[9].body.timeEntryId, 901);
    T.eq('expenditure type: one batch on the internal request id, with audit headers', JSON.stringify([r[16].uriParams, r[16].body, r[16].headers]),
      '[{"requestId":7001},{"lines":[{"id":502,"expenditureType":"Supplies"}]},{"X-User-Id":"pat.lee"}]');
    T.check('then the week is read again', f.calls.some((x) => x.chain === 'loadWeekChain'));
    T.eq('the busy flag is cleared', c.$page.variables.isSaving, false);
  }
  {
    const f = fake((o) => (o.endpoint === 'eqp-v1/patchTimeEntry' ? { ok: false, status: 500, body: {} } : teResponder(o)));
    const Save = chain('time-entry', 'saveTimesheetChain', f.Actions);
    const c = teCtx();
    await new Save().run(c, { mode: 'save' });
    T.check('a failed PATCH writes none of that entry\'s days', f.rest()[1].endpoint === 'eqp-v1/createTimeEntry');
    T.eq('...and says how many rows failed', c.$page.variables.saveError, '1 row(s) failed to save. The others were saved.');
  }
  {
    const f = fake(teResponder);
    const Save = chain('time-entry', 'saveTimesheetChain', f.Actions);
    const c = teCtx({ rows: [rows[0], Object.assign({}, rows[1], { hours: [0, 0, 0, 0, 0, 0, 0] })], edits: {} });
    await new Save().run(c, { mode: 'save' });
    T.eq('save skips a new row with no hours and says so', f.rest().length, 0);
    T.check('...with the old message', /no hours and were not saved/.test(c.$page.variables.saveError));
  }
  {
    const f = fake(teResponder);
    const Save = chain('time-entry', 'saveTimesheetChain', f.Actions);
    const c = teCtx({ edits: Object.assign({ 'L502|type': 'STANDBY' }, edits) });
    await new Save().run(c, { mode: 'submit' });
    const seq = f.seq();
    T.check('submit saves first (same calls as save)', seq.startsWith('patchTimeEntry > createTimeEntryDay'));
    T.check('...re-reads the week, then PATCHes each ticked draft to SUBMITTED',
      seq.endsWith('getEquipriteV1ViewsTimesheetDetailsByWeek > patchTimeEntry > patchTimeEntry'), seq);
    const subs = f.rest().filter((x) => x.body && x.body.status === 'SUBMITTED').map((x) => x.uriParams.id);
    T.eq('...the saved entry and the newly created one', subs.join(','), '900,901');
    T.check('a confirmation follows', f.calls.some((x) => x.toast === 'Timesheet Submitted'));
  }
  {
    const f = fake(teResponder);
    const Save = chain('time-entry', 'saveTimesheetChain', f.Actions);
    const c = teCtx();
    await new Save().run(c, { mode: 'submit' });
    T.check('submit with a ticked row lacking a rate type calls nothing', f.rest().length === 0 && /Rate Type is required/.test(c.$page.variables.saveError));
  }
  {
    const f = fake(teResponder);
    const Save = chain('time-entry', 'saveTimesheetChain', f.Actions);
    const c = teCtx({ edits: Object.assign({ 'L502|type': 'USAGE' }, edits) }, { PPM_RATES_ENABLED: 'true' });
    await new Save().run(c, { mode: 'submit' });
    T.check('under PPM rates a line with hours and no expenditure type blocks submit', f.rest().length === 0 && /Expenditure Type is required/.test(c.$page.variables.saveError));
  }
  {
    const f = fake(teResponder);
    const Save = chain('time-entry', 'saveTimesheetChain', f.Actions);
    const c = teCtx({ edits: Object.assign({ 'L502|type': 'USAGE' }, edits) });
    c.$application.variables.flagsLoaded = false;
    await new Save().run(c, { mode: 'submit' });
    T.check('submit refuses while settings load', f.rest().length === 0 && /still loading/.test(c.$page.variables.saveError));
  }
  {
    const f = fake((o) => (o.endpoint === 'eqp-v1/createTimeEntry' ? { ok: false, status: 400 } : teResponder(o)));
    const Save = chain('time-entry', 'saveTimesheetChain', f.Actions);
    const c = teCtx({ edits: Object.assign({ 'L502|type': 'USAGE' }, edits) });
    await new Save().run(c, { mode: 'submit' });
    T.check('a failed save aborts submit: nothing is set SUBMITTED', !f.rest().some((x) => x.body && x.body.status === 'SUBMITTED')
      && c.$page.variables.saveError === '1 row(s) failed to save. Submit aborted.');
  }
  {
    const f = fake(teResponder);
    const Save = chain('time-entry', 'saveTimesheetChain', f.Actions);
    const c = teCtx({ problemsFree: true, edits: { 'L501|d0': '30' } });
    await new Save().run(c, { mode: 'save' });
    T.check('a bad box blocks the save before any call', f.rest().length === 0 && /can't exceed 24 h/.test(c.$page.variables.saveError));
  }
  {
    const f = fake(teResponder);
    const Save = chain('time-entry', 'saveTimesheetChain', f.Actions);
    const c = teCtx();
    const s = new Save();
    await Promise.all([s.run(c, { mode: 'save' }), s.run(c, { mode: 'save' })]);
    T.eq('a double click saves once', f.rest().filter((x) => x.endpoint === 'eqp-v1/createTimeEntry').length, 1);
  }

  T.section('time entry: a week change never drops unsaved hours');
  {
    const f = fake();
    const Move = chain('time-entry', 'moveChain', f.Actions);
    const c = teCtx({ weeks: ['2026-10-19', WEEK, '2026-11-02'], pendingMove: null });
    await new Move().run(c, { dir: 'next' });
    T.check('typed hours hold the move and ask', !f.calls.some((x) => x.chain) && c.$page.variables.pendingMove && c.$page.variables.pendingMove.weekStart === '2026-11-02');
    await new Move().run(c, { confirm: 'discard' });
    T.eq('Discard moves with a copy of the held move (the variable is cleared first)', JSON.stringify(f.calls.filter((x) => x.chain)),
      '[{"chain":"loadWeekChain","params":{"requestNumber":"REQ-1","weekStart":"2026-11-02","initial":false}}]');
    T.eq('...and clears it', c.$page.variables.pendingMove, null);
    await new Move().run(c, { dir: 'next' });
    await new Move().run(c, { confirm: 'stay' });
    T.check('Keep editing stays', f.calls.filter((x) => x.chain).length === 1 && c.$page.variables.pendingMove === null);
    const clean = teCtx({ weeks: ['2026-10-19', WEEK], edits: {}, pendingMove: null });
    await new Move().run(clean, { dir: 'prev' });
    T.eq('nothing typed: the week moves at once', f.calls.filter((x) => x.chain).length, 2);
  }

  // ── timesheet approval ──────────────────────────────────────────────
  T.section('timesheet approval: variance, week over week, money');
  const day = (a) => ({ day1Hours: a[0], day2Hours: a[1], day3Hours: a[2], day4Hours: a[3], day5Hours: a[4], day6Hours: a[5], day7Hours: a[6] });
  const AP = TA.mapRows([
    Object.assign({ eqrTimeEntryId: 910, requestNumber: 'REQ-1', requestLineId: 501, equipmentName: 'CAT', entryStatus: 'SUBMITTED', weekStartDate: WEEK, totalHours: 50, totalBill: 8750,
      requestedStartDate: '2026-10-01', requestedEndDate: '2026-12-15' }, day([8, 8, 18, 9, 7, 0, 0])),
    Object.assign({ eqrTimeEntryId: 911, requestNumber: 'REQ-2', requestLineId: 601, equipmentName: 'Crane', entryStatus: 'SUBMITTED', weekStartDate: WEEK, totalHours: 49, totalBill: 12838 }, day([8, 8, 8, 17, 8, 0, 0])),
    Object.assign({ eqrTimeEntryId: 912, requestNumber: 'REQ-1', requestLineId: 502, equipmentName: 'Truck', entryStatus: 'APPROVED', weekStartDate: WEEK, totalHours: 10, totalBill: 1000 }, day([5, 5, 0, 0, 0, 0, 0])),
    Object.assign({ eqrTimeEntryId: 880, requestNumber: 'REQ-1', requestLineId: 501, equipmentName: 'CAT', entryStatus: 'APPROVED', weekStartDate: '2026-10-19', totalHours: 40, totalBill: 7000 }, day([9, 9, 9, 9, 4, 0, 0])),
  ]);
  T.eq('the newest week with lines waiting opens', TA.defaultWeek(AP), WEEK);
  T.eq('week chips with waiting counts', TA.weekChips(AP).map((c) => c.week + ':' + c.waiting).join(','), WEEK + ':2,2026-10-19:0');
  T.eq('To approve shows submitted lines of the week', TA.visible(AP, WEEK, 'SUBMITTED', '').map((r) => r.entryId).join(','), '910,911');
  T.eq('search over equipment', TA.visible(AP, WEEK, 'all', 'crane').length, 1);
  T.eq('over 10 h is amber, over 16 h red', [10, 10.5, 16, 16.5].map((h) => TA.dayLevel(h)).join(','), ',long,long,high');
  T.eq('week over week', TA.wowText(AP, AP[0]), '+10 h vs last week');
  T.eq('a line with no last week', TA.wowText(AP, AP[1]), 'new this week');
  T.eq('last week\'s day', TA.prevDay(AP, AP[0], 4), '4');
  T.eq('billed rate per hour', TA.rateText(AP[0]), '$175/h');
  const picked = { E910: true, E911: true, E912: true };
  T.eq('selection counts only submitted lines', JSON.stringify(TA.selection(AP, picked)), '{"lines":2,"hours":99,"cost":21588,"requests":["REQ-1","REQ-2"]}');
  T.eq('approval runs request by request', JSON.stringify(TA.byRequest(AP, picked)), '[{"requestNumber":"REQ-1","entryIds":[910]},{"requestNumber":"REQ-2","entryIds":[911]}]');
  T.eq('cost to date sums the project cost rows', TA.sumCostRows([{ totalCost: 100 }, { cost: 50 }]), 150);
  T.eq('an adjustment needs a reason', TA.adjustProblems(AP[0], { key: 'E910', days: ['8', '8', '10', '9', '7', '0', '0'], reason: '' }).join(' '),
    'Say why the hours are adjusted; the submitter sees it in the audit trail.');
  T.eq('...and a change', TA.adjustProblems(AP[0], { key: 'E910', days: ['8', '8', '18', '9', '7', '0', '0'], reason: 'x' }).join(' '), 'No hours were changed.');
  const audit = TA.auditBody(AP[0], [8, 8, 10, 9, 7, 0, 0], 'typo', 'pat.lee', TA.weekDays(WEEK));
  T.eq('the audit entry names the change and the reason', audit.changeSummary, 'Hours adjusted at approval on REQ-1 · CAT: Wed 28 Oct 18 → 10 h. Reason: typo');
  T.check('...keeps both the submitted and the new hours', JSON.parse(audit.oldValues).totalHours === 50 && JSON.parse(audit.newValues).totalHours === 42);
  const amap = TA.auditMap([{ id: 2, entityName: 'EQR_TIME_ENTRY', entityId: 910, action: 'ADJUST_HOURS', changedDate: '2026-11-03', oldValues: JSON.stringify({ days: [8, 8, 10, 9, 7, 0, 0] }) },
    { id: 1, entityName: 'EQR_TIME_ENTRY', entityId: 910, action: 'ADJUST_HOURS', changedDate: '2026-11-02', oldValues: JSON.stringify({ days: [8, 8, 18, 9, 7, 0, 0] }) },
    { id: 3, entityName: 'EQR_CONF_SETTING', entityId: 910, action: 'UPDATE' }]);
  T.eq('an adjusted line shows the hours as first submitted', TA.originalDay(amap, Object.assign({}, AP[0], { days: [8, 8, 10, 9, 7, 0, 0] }), 2), '18');
  T.eq('...only on days that changed', TA.originalDay(amap, AP[0], 0), '');

  T.section('timesheet approval: Approve, Reject, Adjust');
  function taCtx(flags, over) {
    return { $page: { variables: Object.assign({ rowsAll: AP, picked: { E910: true, E911: true }, weekKey: WEEK, weekDays: TA.weekDays(WEEK), isWorking: false, readOnly: false,
      confirm: '', actionError: '', actionNote: '', adjust: null }, over || {}), functions: TA }, $application: appCtx(flags) };
  }
  {
    const f = fake();
    const A = chain('timesheet-approval', 'approveChain', f.Actions);
    const c = taCtx({});
    await new A().run(c, { step: 'ask' });
    T.check('approve asks first and calls nothing', c.$page.variables.confirm === 'approve' && f.rest().length === 0);
    await new A().run(c, { step: 'go' });
    T.eq('without PPM rates: PATCH APPROVED per entry, request by request', f.rest().map((x) => x.endpoint + ' ' + x.uriParams.id + ' ' + x.body.status).join(' > '),
      'eqp-v1/patchTimeEntry 910 APPROVED > eqp-v1/patchTimeEntry 911 APPROVED');
    T.check('then the week is read again', f.calls.some((x) => x.chain === 'loadApprovalsChain'));
  }
  {
    const f = fake();
    const A = chain('timesheet-approval', 'approveChain', f.Actions);
    await new A().run(taCtx({ PPM_RATES_ENABLED: 'true' }), { step: 'go' });
    T.eq('under PPM rates each request is sent to Fusion after its approval', f.seq(),
      'patchTimeEntry > ics/postCostToFusionProject > patchTimeEntry > ics/postCostToFusionProject');
    T.eq('...with the request number only', JSON.stringify(f.rest()[1].body), '{"requestNumber":"REQ-1"}');
  }
  {
    const f = fake((o) => (o.endpoint === 'ics/postCostToFusionProject' ? { ok: false, status: 404 } : null));
    const A = chain('timesheet-approval', 'approveChain', f.Actions);
    await new A().run(taCtx({ PPM_RATES_ENABLED: 'true' }, { picked: { E910: true } }), { step: 'go' });
    T.eq('a 404 on the project URL falls back to the v1 URL (it cannot post twice)', f.seq(), 'patchTimeEntry > ics/postCostToFusionProject > ics/postCostToFusion');
  }
  {
    const f = fake((o) => (o.endpoint.startsWith('ics/') ? { ok: false, status: 400, body: { detail: 'Invalid task' } } : null));
    const A = chain('timesheet-approval', 'approveChain', f.Actions);
    const c = taCtx({ PPM_RATES_ENABLED: 'true' }, { picked: { E910: true } });
    await new A().run(c, { step: 'go' });
    T.eq('a Fusion refusal puts the entry back to SUBMITTED', f.rest().map((x) => x.endpoint + (x.body && x.body.status ? ' ' + x.body.status : '')).join(' > '),
      'eqp-v1/patchTimeEntry APPROVED > ics/postCostToFusionProject > eqp-v1/patchTimeEntry SUBMITTED');
    T.check('...and says why', /NOT approved.*Invalid task/.test(c.$page.variables.actionError));
  }
  {
    const f = fake((o, n) => (n === 2 ? { ok: false, status: 409 } : null));
    const A = chain('timesheet-approval', 'approveChain', f.Actions);
    const c = taCtx({}, { picked: { E910: true, E911: true }, rowsAll: AP.map((r) => Object.assign({}, r, { requestNumber: 'REQ-1' })) });
    await new A().run(c, { step: 'go' });
    T.eq('a failed PATCH stops the request and reverts what this run approved', f.rest().map((x) => x.uriParams.id + ' ' + x.body.status).join(' > '),
      '910 APPROVED > 911 APPROVED > 910 SUBMITTED');
  }
  {
    const f = fake();
    const A = chain('timesheet-approval', 'approveChain', f.Actions);
    const c = taCtx({});
    c.$application.variables.flagsLoaded = false;
    await new A().run(c, { step: 'go' });
    T.check('approve refuses while settings load', f.rest().length === 0 && /still loading/.test(c.$page.variables.actionError));
  }
  {
    const f = fake((o, n) => (n === 1 ? { ok: false, status: 500 } : null));
    const R = chain('timesheet-approval', 'rejectChain', f.Actions);
    const c = taCtx({});
    await new R().run(c, { step: 'go' });
    T.eq('reject stops at the first failure', f.rest().length, 1);
    T.check('...and names it', /Failed to reject entry 910/.test(c.$page.variables.actionError));
  }
  {
    const f = fake();
    const R = chain('timesheet-approval', 'rejectChain', f.Actions);
    await new R().run(taCtx({}), { step: 'go' });
    T.eq('reject: PATCH REJECTED per entry', f.rest().map((x) => x.body.status).join(','), 'REJECTED,REJECTED');
  }
  {
    const f = fake();
    const Adj = chain('timesheet-approval', 'adjustChain', f.Actions);
    const c = taCtx({});
    await new Adj().run(c, { action: 'start', key: 'E910' });
    await new Adj().run(c, { action: 'day', day: '2', value: '10' });
    await new Adj().run(c, { action: 'reason', value: 'Typo' });
    await new Adj().run(c, { action: 'save' });
    T.eq('adjust: PATCH the hours, the 7 days, then the audit entry', f.seq(),
      ['patchTimeEntry'].concat(Array(7).fill('createTimeEntryDay'), ['createAuditTrailEntry']).join(' > '));
    T.eq('...the PATCH leaves the status alone', JSON.stringify(f.rest()[0].body), '{"totalHours":42,"billableHours":42}');
    T.eq('...Wednesday is 10', f.rest()[3].body.hoursWorked, 10);
    T.check('...the audit entry carries the actor\'s headers', f.rest()[8].headers['X-User-Id'] === 'pat.lee' && f.rest()[8].body.entityId === 910);
  }
  {
    const f = fake((o) => (o.endpoint === 'eqp-v1/patchTimeEntry' ? { ok: false, status: 500 } : null));
    const Adj = chain('timesheet-approval', 'adjustChain', f.Actions);
    const c = taCtx({}, { adjust: { key: 'E910', days: ['8', '8', '10', '9', '7', '0', '0'], reason: 'x' } });
    await new Adj().run(c, { action: 'save' });
    T.check('a failed PATCH writes nothing else', f.rest().length === 1 && /Nothing was changed/.test(c.$page.variables.actionError));
  }
  {
    const f = fake((o) => (o.endpoint === 'eqp-v1/createAuditTrailEntry' ? { ok: false, status: 500 } : null));
    const Adj = chain('timesheet-approval', 'adjustChain', f.Actions);
    const c = taCtx({}, { adjust: { key: 'E910', days: ['8', '8', '10', '9', '7', '0', '0'], reason: 'x' } });
    await new Adj().run(c, { action: 'save' });
    T.check('a failed audit write is an error naming the change', /audit entry was not written.*Record it by hand/.test(c.$page.variables.actionError));
  }
  {
    const f = fake();
    const Adj = chain('timesheet-approval', 'adjustChain', f.Actions);
    const c = taCtx({}, { adjust: { key: 'E910', days: ['8', '8', '10', '9', '7', '0', '0'], reason: '' } });
    await new Adj().run(c, { action: 'save' });
    T.eq('no reason: no call', f.rest().length, 0);
  }

  // ── post costs ─────────────────────────────────────────────────────
  T.section('post costs: list and preview (old post-cost-test list and detail)');
  const NOW = new Date('2026-10-29T12:00:00Z');
  const list = PC.buildList([
    { eqrEquipmentRequestId: 10, requestNumber: 'REQ-A', weekStartDate: '2026-10-05', totalBillCost: 100, totalHours: 8, timesheets: 1 },
    { eqrEquipmentRequestId: 10, requestNumber: 'REQ-A', weekStartDate: '2026-12-07', totalBillCost: 500, totalHours: 40, timesheets: 1 },
    { eqrEquipmentRequestId: 12, requestNumber: 'REQ-B', weekStartDate: '2027-01-04', totalBillCost: 900 },
  ], [{ requestNumber: 'REQ-A', rawCost: 25.5 }, { requestNumber: 'REQ-X', rawCost: 1 }], NOW);
  T.eq('one row per request, newest first', list.map((r) => r.requestNumber).join(','), 'REQ-B,REQ-A');
  T.eq('future weeks are not in the money; charges are', list[1].totalBillCost, 125.5);
  T.eq('a request with only future weeks keeps its row at $0', list[0].totalBillCost, 0);

  const pcRow = (o) => Object.assign({ requestNumber: 'REQ-10440', lineType: 'RENTABLE', qty: 1, applicableRate: 200, ratePeriod: 'DAILY', totalHours: 0, postStatus: 'APPROVED' }, o);
  const DETAILS = [
    pcRow({ rowKey: '701:0:20261005', requestLineId: 701, equipmentName: 'Generator', weekStartDate: '2026-10-05', weekEndDate: '2026-10-11', costAmount: 1400, postStatus: 'POSTED', lineExpenditureType: 'Equipment Rental' }),
    pcRow({ rowKey: '701:0:20261012', requestLineId: 701, equipmentName: 'Generator', weekStartDate: '2026-10-12', weekEndDate: '2026-10-18', costAmount: 1400, lineExpenditureType: 'Equipment Rental' }),
    pcRow({ rowKey: '701:0:20261019', requestLineId: 701, equipmentName: 'Generator', weekStartDate: '2026-10-19', weekEndDate: '2026-10-25', costAmount: 1400, lineExpenditureType: 'Equipment Rental' }),
    pcRow({ rowKey: '701:0:20261026', requestLineId: 701, equipmentName: 'Generator', weekStartDate: '2026-10-26', weekEndDate: '2026-11-01', costAmount: 1400, lineExpenditureType: 'Equipment Rental' }),
    pcRow({ rowKey: '701:0:20270104', requestLineId: 701, equipmentName: 'Generator', weekStartDate: '2027-01-04', weekEndDate: '2027-01-10', costAmount: 1400 }),
    pcRow({ rowKey: '702:0:20261012', requestLineId: 702, equipmentName: 'Light Tower', weekStartDate: '2026-10-12', weekEndDate: '2026-10-18', costAmount: 700, applicableRate: 100 }),
    pcRow({ rowKey: '703:0:20261020', requestLineId: 703, equipmentName: 'Cones', lineType: 'DIRECT', weekStartDate: '2026-10-19', weekEndDate: '2026-10-25', costAmount: 60, postStatus: 'IN_PROGRESS' }),
  ];
  const HDR = { plannedStartDate: '2026-10-05', plannedEndDate: '2026-12-31', projectNumber: 'PRJ-B', projectName: 'Plant B', taskNumber: '4.2', taskName: 'Electrical' };
  const COMP = {
    retier: { data: [{ requestLineId: 701, weekStartDate: '2026-10-05', retierPeriod: 'WEEKLY', retierRate: 150, retierCost: 1050 }] },
    blackout: [{ requestLineId: 701, weekStartDate: '2026-10-12', blackoutDates: ['2026-10-14'], ignoredDates: [], blackoutDays: 1, applicability: 'EDITABLE' }],
    misc: { data: [{ eqrLineMiscTxnId: 55, requestLineId: 701, expenditureType: 'Fuel', expenditureOrg: 'Applications and Services', expenditureItemDate: '2026-10-05', quantity: 1, rawCost: 90, status: 'DRAFT', comments: 'Fuel' }] },
    splits: { data: [
      { requestLineId: 701, weekStartDate: '2026-10-19', projectRefId: 3001, projectNumber: 'PRJ-B', taskId: 4001, taskNumber: '4.2', splitPct: 60 },
      { requestLineId: 701, weekStartDate: '2026-10-19', projectRefId: 3002, projectNumber: 'PRJ-C', taskId: 5001, taskNumber: '2.1', splitPct: 40 }] },
    prLineIds: {}, prPoPrices: {},
  };
  const pv = PC.buildPreview(DETAILS, COMP, HDR, NOW);
  const wk = (k) => pv.rowsAll.find((r) => r.kind === 'week' && r.rowKey === k);
  T.check('a future week is dropped from the bill', !wk('701:0:20270104'));
  T.eq('posted / ended / current week', [wk('701:0:20261005').whenTag, wk('701:0:20261012').whenTag, wk('701:0:20261026').whenTag].join(','), 'Posted,Draft,In progress');
  T.eq('only an ended, unposted week is postable', ['701:0:20261005', '701:0:20261012', '701:0:20261026'].map((k) => wk(k).postable).join(','), 'false,true,false');
  T.check('a consumable waiting for its material issue is Pending, never postable', pv.rowsAll.some((r) => r.kind === 'week' && r.whenTag === 'Pending' && !r.postable));
  T.eq('totals: everything, posted, incurred (incl. the draft charge and the ended consumable)', [pv.totalCost, pv.postedCost, pv.incurredToDate].join(','),
    [1400 * 4 + 90 + 700 + 60, 1400, 1400 + 1400 + 700 + 90 + 60].join(','));
  T.eq('last posted', pv.lastPostedLabel, 'Oct 11');
  T.check('a posted week whose tier changed offers re-tier', pv.rowsAll.find((r) => r.kind === 'group' && r.label === 'Generator').tierChanged);
  T.eq('days = cost ÷ day rate', wk('701:0:20261012').days, 7);
  T.eq('a split week carries its slices, and the tree shows them', pv.rowsAll.filter((r) => r.kind === 'split').map((r) => r.projectNumber + ' ' + r.cost).join(','), 'PRJ-B 840,PRJ-C 560');
  T.eq('blackout day rows (only days in the line\'s span)', pv.rowsAll.filter((r) => r.kind === 'day' && r.weekKey === '701:0:20261012').length, 7);
  T.check('...the marked day is excluded and costs nothing', pv.rowsAll.some((r) => r.kind === 'day' && r.dayISO === '2026-10-14' && r.blackout && r.dayCost === 0));
  T.check('a misc charge row', pv.rowsAll.some((r) => r.kind === 'misc' && r.miscId === 55 && r.postable));
  T.eq('the first equipment opens', pv.rowsAll.filter((r) => r.kind === 'group' && r.expanded).length, 1);
  T.check('visible rows: day rows wait for their week, charges for their group', !PC.visibleRows(pv.rowsAll).some((r) => r.kind === 'day' || r.kind === 'misc'));

  T.section('post costs: the split rule (basis points)');
  const sl = (pct, p, t) => ({ projectRefId: p || 1, taskId: t || 1, pct });
  T.eq('one slice is refused', /at least 2/.test(PC.splitFormError([sl(100)])), true);
  T.eq('5 + 63.02 + 31.98 is exactly 100 here (it is not in floating point)', PC.splitFormError([sl(5, 1, 1), sl(63.02, 2, 2), sl(31.98, 3, 3)]), '');
  T.eq('short is named', PC.splitFormError([sl(50, 1, 1), sl(40, 2, 2)]), 'Percentages must add up to 100%. They currently total 90% — 10% short.');
  T.check('a repeated project + task is refused', /appears twice/.test(PC.splitFormError([sl(50, 1, 1), sl(50, 1, 1)])));
  T.check('a slice without a task is refused', /needs a task/.test(PC.splitFormError([sl(50, 1, 1), { projectRefId: 2, pct: 50 }])));
  T.eq('split evenly: three ways total exactly 100', PC.splitEvenly([sl(0, 1, 1), sl(0, 2, 2), sl(0, 3, 3)]).map((s) => s.pct).join(','), '33.34,33.33,33.33');

  T.section('post costs: what Post sends (old postSelectedChain body)');
  const w1 = wk('701:0:20261012');
  T.eq('the ledger body for a week, field for field', JSON.stringify(PC.ledgerBody(w1, 77)),
    '{"requestLineId":701,"weekStartDate":"2026-10-12T00:00:00Z","rowKey":"701:0:20261012","status":"POSTED","entryKind":"ORIGINAL","postedSource":"CP",'
    + '"postedCostAmount":1400,"costRate":200,"periodType":"DAILY","billableDuration":7,"rateScheduleId":77,"expenditureType":"Equipment Rental",'
    + '"reversalRef":"EQR-701-20261012","ppmBatchName":null}');
  const split = PC.ledgerBody(wk('701:0:20261019'), 77);
  T.check('a split week adds percentages only and drops the bare reversal ref', split.reversalRef === null && split.splits.length === 2
    && split.postedCostAmount === 1400 && JSON.stringify(split.splits[1]) === '{"projectRefId":3002,"projectNumber":"PRJ-C","taskId":5001,"taskNumber":"2.1","splitPct":40}');
  T.check('an unsaved (preview) split posts whole', !PC.ledgerBody(Object.assign({}, wk('701:0:20261019'), { splitPersisted: false }), 77).splits);
  T.check('a PR line never posts as a split', !PC.ledgerBody(Object.assign({}, wk('701:0:20261019'), { isPrLine: true }), 77).splits);
  T.eq('a one-time charge posts EACH with its quantity', JSON.stringify((({ postedSource, periodType, billableDuration }) => ({ postedSource, periodType, billableDuration }))(
    PC.ledgerBody(Object.assign({}, w1, { direct: true, qty: 3 }), 77))), '{"postedSource":"DIRECT","periodType":"EACH","billableDuration":3}');
  const ticked = PC.restampSelection(pv.rowsAll.map((r) => (r.kind === 'week' && ['701:0:20261012', '701:0:20261019', '701:0:20261005'].indexOf(r.rowKey) >= 0
    ? Object.assign({}, r, { selected: true }) : (r.kind === 'misc' ? Object.assign({}, r, { selected: true }) : r))));
  T.eq('a posted week is never sent, even if ticked', PC.weeksToPost(ticked).map((r) => r.rowKey).join(','), '701:0:20261012,701:0:20261019');
  T.eq('selection money', JSON.stringify(PC.selection(ticked)), '{"weeks":2,"misc":1,"items":3,"cost":2890}');
  const plan = PC.postingPlan(ticked, HDR, 77);
  T.eq('the review lists each line', plan.map((p) => p.kind + ':' + p.amount).join(','), 'week:1400,week:1400,misc:90');
  T.eq('...where a split week goes', plan[1].destination, '60% PRJ-B / 4.2, 40% PRJ-C / 2.1');
  T.eq('...and the total', PC.planTotal(plan), 2890);

  T.section('post costs: posting and the other writes');
  function pcCtx(over) {
    return { $page: { variables: Object.assign({ rowsAll: ticked, panel: 'review', isPosting: false, readOnly: false, postError: '', postSuccess: '',
      current: { requestNumber: 'REQ-10440', eqrEquipmentRequestId: 4440, rateScheduleId: 77, ppmProjectNumber: 'PRJ-B' } }, over || {}), functions: PC },
      $application: appCtx({}) };
  }
  {
    const f = fake();
    const P = chain('post-costs', 'postSelectedChain', f.Actions);
    const c = pcCtx({ panel: '' });
    await new P().run(c);
    T.check('Post outside the review only opens the review', f.rest().length === 0 && c.$page.variables.panel === 'review');
    await new P().run(c);
    T.eq('record (week, split week, charges), then send to Fusion', f.seq(),
      'createPostedWeek > createPostedWeekSplit > postMiscTransactions > ics/postCostToFusionProject');
    T.eq('the charges go as one id list', JSON.stringify(f.rest()[2].body), '{"ids":[55]}');
    T.check('then the preview and the list are read again', ['loadPreviewChain', 'listChain'].every((n) => f.calls.some((x) => x.chain === n)));
    T.check('and the result is stated', /Posted 2 week\(s\).*sent to Fusion PPM/.test(c.$page.variables.postSuccess));
  }
  {
    const f = fake((o) => (o.endpoint.indexOf('createPostedWeek') >= 0 || o.endpoint === 'eqp-v1/postMiscTransactions' ? { ok: false, status: 500 } : null));
    const P = chain('post-costs', 'postSelectedChain', f.Actions);
    const c = pcCtx();
    await new P().run(c);
    T.check('nothing recorded: nothing is sent to Fusion', !f.rest().some((x) => x.endpoint.startsWith('ics/')) && /Nothing was recorded/.test(c.$page.variables.postError));
  }
  {
    const f = fake((o) => (o.endpoint.startsWith('ics/') ? { ok: false, status: 500 } : null));
    const P = chain('post-costs', 'postSelectedChain', f.Actions);
    const c = pcCtx();
    await new P().run(c);
    T.check('a failed send is a warning, the post stands (the next post retries it)', /recorded in EquipRite, but the send to Fusion failed/.test(c.$page.variables.postSuccess)
      && f.calls.some((x) => x.toast === 'Posted, not yet sent to Fusion'));
  }
  {
    const f = fake();
    const P = chain('post-costs', 'postSelectedChain', f.Actions);
    const c = pcCtx();
    const p = new P();
    await Promise.all([p.run(c), p.run(c)]);
    T.eq('a double click posts once', f.rest().filter((x) => x.endpoint === 'eqp-v1/createPostedWeek').length, 1);
  }
  {
    const f = fake();
    const M = chain('post-costs', 'miscChain', f.Actions);
    const c = pcCtx({ panel: 'misc', misc: { line: { groupKey: 'g0', equipmentName: 'Generator', requestLineId: 701 },
      draft: { expenditureType: 'Fuel', expenditureOrg: 'Applications and Services', expItemDate: '2026-10-12', quantity: 2, rawCost: null, currency: 'USD', comments: 'Top-up' } } });
    await new M().run(c, { action: 'save' });
    T.check('a charge with no amount is refused before any call', f.rest().length === 0 && /an amount greater than zero/.test(c.$page.variables.misc.error));
    await new M().run(c, { action: 'field', field: 'rawCost', value: '120.5' });
    await new M().run(c, { action: 'save' });
    T.eq('misc charge: the old createMiscTransaction body', JSON.stringify(f.rest()[0].body),
      '{"requestLineId":701,"expenditureType":"Fuel","expenditureOrg":"Applications and Services","expenditureItemDate":"2026-10-12T00:00:00Z","quantity":2,"rawCost":120.5,"currencyCode":"USD","comments":"Top-up","status":"DRAFT"}');
    T.check('...then the preview is read again', f.calls.some((x) => x.chain === 'loadPreviewChain'));
    const f2 = fake();
    const M2 = chain('post-costs', 'miscChain', f2.Actions);
    const c2 = pcCtx({ rowsAll: ticked.map((r) => (r.kind === 'misc' ? Object.assign({}, r, { status: 'POSTED' }) : r)) });
    await new M2().run(c2, { action: 'delete', key: 'misc_55' });
    T.eq('a posted charge is never deleted', f2.rest().length, 0);
    await new M2().run(pcCtx(), { action: 'delete', key: 'misc_55' });
    T.eq('a draft charge is deleted by id', JSON.stringify(f2.rest().map((x) => [x.endpoint, x.uriParams])), '[["eqp-v1/deleteMiscTransactionById",{"id":55}]]');
  }
  {
    const f = fake();
    const X = chain('post-costs', 'expTypeChain', f.Actions);
    const rowsTwoLines = pv.rowsAll.map((r) => (r.kind === 'group' && r.label === 'Generator' ? Object.assign({}, r, { requestLineIds: [701, 799] }) : r));
    const c = pcCtx({ rowsAll: rowsTwoLines, exp: { line: { groupKey: 'g0', equipmentName: 'Generator', current: 'Equipment Rental' }, choice: 'Equipment' } });
    await new X().run(c, { action: 'save' });
    T.eq('expenditure type: one batch for every line of the equipment', JSON.stringify([f.rest()[0].endpoint, f.rest()[0].uriParams, f.rest()[0].body]),
      '["eqp-v1/patchRequestLinesBatch",{"requestId":4440},{"lines":[{"id":701,"expenditureType":"Equipment"},{"id":799,"expenditureType":"Equipment"}]}]');
    T.check('...and unposted weeks post with the new type', c.$page.variables.rowsAll.filter((r) => r.kind === 'week' && r.groupKey === 'g0' && !r.posted)
      .every((r) => r.lineExpenditureType === 'Equipment'));
  }
  {
    const f = fake();
    const S = chain('post-costs', 'saveSplitChain', f.Actions);
    const line = { rowKey: '701:0:20261012', requestLineId: 701, weekStartISO: '2026-10-12', weekLabel: 'Oct 12 – Oct 18', equipmentName: 'Generator', locked: false };
    const c = pcCtx({ split: { line, slices: [sl(60, 3001, 4001), sl(30, 3002, 5001)], tree: {} } });
    await new S().run(c);
    T.check('a split short of 100% is refused before any call', f.rest().length === 0 && /10% short/.test(c.$page.variables.split.error));
    c.$page.variables.split = { line, tree: {}, slices: [Object.assign(sl(60, 3001, 4001), { projectNumber: 'PRJ-B', taskNumber: '4.2' }), Object.assign(sl(40, 3002, 5001), { projectNumber: 'PRJ-C', taskNumber: '2.1' })] };
    await new S().run(c);
    T.eq('split: one PUT for the week, percentages only', JSON.stringify([f.rest()[0].endpoint, f.rest()[0].uriParams, f.rest()[0].body.weekStartDate, f.rest()[0].body.splits.map((x) => x.splitPct)]),
      '["eqp-v1/replaceLineProjectSplits",{"id":701},"2026-10-12T00:00:00Z",[60,40]]');
    T.check('...and the week shows it', c.$page.variables.rowsAll.some((r) => r.kind === 'week' && r.rowKey === '701:0:20261012' && r.splitCount === 2 && r.splitPersisted === true));
    const f404 = fake(() => ({ ok: false, status: 404 }));
    const S404 = chain('post-costs', 'saveSplitChain', f404.Actions);
    const c404 = pcCtx({ split: c.$page.variables.split });
    c404.$page.variables.split = { line, tree: {}, slices: c.$page.variables.split.slices || [Object.assign(sl(60, 3001, 4001), { projectNumber: 'PRJ-B' }), Object.assign(sl(40, 3002, 5001), { projectNumber: 'PRJ-C' })] };
    await new S404().run(c404);
    T.check('a 404 applies the split on screen only, so Post sends the week whole',
      c404.$page.variables.rowsAll.some((r) => r.kind === 'week' && r.rowKey === '701:0:20261012' && r.splitPersisted === false));
    const fc = fake();
    const C = chain('post-costs', 'clearSplitChain', fc.Actions);
    await new C().run(pcCtx({ split: { line } }));
    T.eq('remove split: one DELETE scoped to the week', JSON.stringify([fc.rest()[0].endpoint, fc.rest()[0].uriParams]), '["eqp-v1/clearLineProjectSplits",{"id":701,"weekStartDate":"2026-10-12"}]');
  }
  {
    const f = fake();
    const B = chain('post-costs', 'blackoutChain', f.Actions);
    const dayRow = pv.rowsAll.find((r) => r.kind === 'day' && r.dayISO === '2026-10-15');
    const c = pcCtx({ rowsAll: pv.rowsAll, facts: { totalCost: pv.totalCost, incurredToDate: pv.incurredToDate } });
    await new B().run(c, { key: dayRow.rowKey });
    T.eq('blackout: the old upsert body', JSON.stringify(f.rest()[0].body), '{"requestLineId":701,"exceptionDate":"2026-10-15","rateType":"BLACKOUT","reason":"Excluded from post cost"}');
    T.eq('...the week loses one day', c.$page.variables.rowsAll.find((r) => r.kind === 'week' && r.rowKey === '701:0:20261012').days, 6);
    const posted = pv.rowsAll.find((r) => r.kind === 'day' && r.locked);
    const f2 = fake();
    const B2 = chain('post-costs', 'blackoutChain', f2.Actions);
    await new B2().run(pcCtx({ rowsAll: pv.rowsAll }), { key: posted.rowKey });
    T.eq('a posted week\'s day is frozen: no call', f2.rest().length, 0);
  }
  {
    const f = fake(() => ({ ok: true, body: { reversedCount: 1 } }));
    const R = chain('post-costs', 'reverseLineChain', f.Actions);
    const g0 = pv.rowsAll.find((r) => r.kind === 'group' && r.label === 'Generator').groupKey;
    const c = pcCtx({ rowsAll: pv.rowsAll, reverseAsk: '' });
    await new R().run(c, { groupKey: g0 });
    T.check('re-tier asks first', f.rest().length === 0 && c.$page.variables.reverseAsk === g0);
    T.eq('...and states what it will credit and re-draft', JSON.stringify((({ weeks: w, credit, redraft }) => ({ w, credit, redraft }))(PC.reversePreview(pv.rowsAll, g0))), '{"w":1,"credit":1400,"redraft":1050}');
    await new R().run(c, { confirm: 'go' });
    T.eq('re-tier: one reversal for the line, with the changed posted weeks', JSON.stringify([f.rest()[0].endpoint, f.rest()[0].uriParams, f.rest()[0].body]),
      '["eqp-v1/reverseRequestLine",{"id":701},{"weekStartDates":["2026-10-05"]}]');
  }

  // ── direct cost & inventory ─────────────────────────────────────────
  T.section('direct cost & inventory: material issue (old submitTransactionChain)');
  T.eq('only approved and active requests', DC.activeRequests([{ eqrEquipmentRequestId: 1, status: 'DEPLOYED' }, { eqrEquipmentRequestId: 2, status: 'DRAFT' },
    { eqrEquipmentRequestId: 3, status: 'APPROVED' }]).map((r) => r.id).join(','), '3,1');
  const LINES = DC.issuableLines([{ lineId: 801, equipmentName: 'Oil', quantity: 10, lineStatus: 'DELIVERED', consumableFlag: 'Y', deliveredQuantity: 6 },
    { lineId: 802, equipmentName: 'CAT', quantity: 1, lineStatus: 'DEPLOYED' }, { lineId: 803, lineStatus: 'REJECTED' }]);
  T.eq('a rejected line is never offered', LINES.map((l) => l.lineId).join(','), '801,802');
  const units = DC.unitOptions([{ unitNumber: 'OIL-1', uomCode: 'EA', invOrgId: 204, availableToReserve: 5 }]);
  T.eq('the old checks, in one sentence', DC.issueProblems(4482, { lineId: 801, itemNumber: 'OIL-1', quantity: 7 }, units).join(', '), 'quantity consumed (7) exceeds the 5 on hand for OIL-1');
  T.eq('...unknown on-hand does not block', DC.issueProblems(4482, { lineId: 801, itemNumber: 'X', quantity: 7 }, units).length, 0);
  T.eq('...missing fields', DC.issueProblems(4482, { lineId: null, itemNumber: '', quantity: 0 }, units).length, 3);
  T.eq('consumed: a consumable is done at its DELIVERED quantity', JSON.stringify(DC.consumedState([{ requestLineId: 801, quantityConsumed: 4 }, { requestLineId: 801, quantityConsumed: 2 }], LINES[0])),
    '{"total":6,"fullyConsumed":true}');
  function dcCtx(over) {
    return { $page: { variables: Object.assign({ current: { id: 4482, requestNumber: 'REQ-10482' }, issue: { lineId: 801, itemNumber: 'OIL-1', quantity: 2, uom: 'EA', subinventory: 'S1' },
      units, lines: LINES, isSubmitting: false, readOnly: false, formError: '', note: '', consumptions: [] }, over || {}), functions: DC }, $application: appCtx({}) };
  }
  const dcResponder = (o) => (o.endpoint === 'eqp-v1/getInventoryConsumptions' ? { ok: true, body: { data: [{ requestLineId: 801, quantityConsumed: 4 }, { requestLineId: 801, quantityConsumed: 2 }] } } : null);
  {
    const f = fake(dcResponder);
    const S = chain('project-costs', 'submitConsumptionChain', f.Actions);
    const c = dcCtx({ lines: [LINES[0], Object.assign({}, LINES[1], { lineStatus: 'CLOSED' })] });
    await new S().run(c);
    T.eq('consumption, re-read, line counter + CONSUMED, then the header CLOSED (last open line)', f.seq(),
      'createInventoryConsumption > getInventoryConsumptions > patchRequestLine > patchEquipmentRequest');
    const r = f.rest();
    T.eq('the old consumption body', JSON.stringify(Object.assign({}, r[0].body, { transactionDate: r[0].body.transactionDate.slice(10) })),
      '{"equipmentRequestId":4482,"requestLineId":801,"itemNumber":"OIL-1","quantityConsumed":2,"uomCode":"EA","invOrgId":204,"consumptionType":"USAGE","transactionDate":"T00:00:00Z","notes":"Subinventory: S1"}');
    T.eq('the line counter from the full set', JSON.stringify([r[2].uriParams, r[2].body]), '[{"requestId":4482,"id":801},{"consumedQuantity":6,"lineStatus":"CONSUMED"}]');
    T.eq('the header', JSON.stringify([r[3].uriParams, r[3].body]), '[{"id":4482},{"status":"CLOSED"}]');
    T.check('the note names what was recorded', /^2 × OIL-1 recorded against Oil/.test(c.$page.variables.note));
  }
  {
    const f = fake(dcResponder);
    const S = chain('project-costs', 'submitConsumptionChain', f.Actions);
    await new S().run(dcCtx());
    T.eq('another line still open: the request stays open', f.seq(), 'createInventoryConsumption > getInventoryConsumptions > patchRequestLine');
  }
  {
    const f = fake((o) => (o.endpoint === 'eqp-v1/createInventoryConsumption' ? { ok: false, status: 400, body: { detail: 'Data integrity violation' } } : null));
    const S = chain('project-costs', 'submitConsumptionChain', f.Actions);
    const c = dcCtx();
    await new S().run(c);
    T.check('a refused consumption stops there and keeps the form', f.rest().length === 1 && /could not be saved: Data integrity violation/.test(c.$page.variables.formError)
      && c.$page.variables.issue.quantity === 2);
  }
  {
    const f = fake();
    const S = chain('project-costs', 'submitConsumptionChain', f.Actions);
    const c = dcCtx({ issue: { lineId: 801, itemNumber: '', quantity: 2 } });
    await new S().run(c);
    T.check('an incomplete issue calls nothing', f.rest().length === 0 && /item \/ lot \/ serial number is empty/.test(c.$page.variables.formError));
  }

  // ── the feature guard ───────────────────────────────────────────────
  T.section('the feature guard (old projectsModuleGuardChain / ppmRatesGuardChain)');
  const AppModule = loadAmd(path.join(NEW, 'app-flow.js'), { 'ojs/ojarraydataprovider': function ADP(d) { this.data = d; }, 'resources/js/lineStatusLabels': {} });
  const app = new AppModule();
  async function guard(pageId, flags) {
    const f = fake();
    const ctx = { $application: { currentPage: { id: pageId }, functions: app,
      variables: { flagsLoaded: true, featureFlags: flags, pageAccessMap: { EQR_DASHBOARD: 'FULL' }, pageAccessLoaded: true, buRateSources: {} } } };
    const ok = await usageGuard.allow(ctx, f.Actions);
    return { ok, calls: f.calls };
  }
  const ON = { PROJECTS_MODULE_ENABLED: 'true', TIMESHEETS_ENABLED: 'true' };
  T.eq('everything on: the page opens', (await guard('time-entry', ON)).ok, true);
  const off = await guard('time-entry', { PROJECTS_MODULE_ENABLED: 'true' });
  T.check('timesheets off: time entry leaves for the role\'s home, saying why', !off.ok && off.calls.some((c) => c.message === 'Timesheets are not enabled.') && off.calls.some((c) => c.nav === 'home/home'));
  const ppm = await guard('post-costs', Object.assign({ PPM_RATES_ENABLED: 'true' }, ON));
  T.check('PPM rates on: Post costs does not exist (R14)', !ppm.ok && ppm.calls.some((c) => /Rates come from Fusion PPM/.test(c.message || '')));
  T.eq('timesheets off does not close Post costs', (await guard('post-costs', { PROJECTS_MODULE_ENABLED: 'true' })).ok, true);
  T.eq('projects module off closes the area', (await guard('project-costs', {})).ok, false);

  // ── menu, files, endpoints ──────────────────────────────────────────
  T.section('the menu leads to the new pages');
  ['time-entry', 'timesheet-approval', 'post-costs', 'project-costs'].forEach((id) => {
    const it = app.navItem(id);
    T.check(id + ': new, routed to usage/' + id, it && it.status === 'new' && it.route.flow === 'usage' && it.route.page === id
      && fs.existsSync(path.join(PAGES, id + '-page.json')));
    T.eq(id + ': the page is gated by the item\'s page code', app.getPageCodeForPage({ id }), it.pageCodes[0]);
  });
  T.check('the old screens are still linked', app.navItem('time-entry').old.page === 'equipment-timesheets' && app.navItem('post-costs').old.page === 'post-cost-test'
    && app.navItem('timesheet-approval').old.page === 'timesheet-approvals');

  T.section('old helpers are copied unchanged');
  ['timesheetRows.js', 'expenditureTypes.js', 'prPassThrough.js', 'postCostToFusion.js', 'requestLineBody.js', 'projectTaskTree.js', 'currentUser.js'].forEach((f) => {
    T.check(f, fs.readFileSync(path.join(JS, f), 'utf8') === fs.readFileSync(path.join(OLD, 'resources', 'js', f), 'utf8'));
  });

  T.section('every chain a page names exists, and the access guard is the shared copy');
  const guardSrc = fs.readFileSync(path.join(NEW, 'flows', 'request', 'pages', 'my-requests-page-chains', 'enforcePageAccessChain.js'), 'utf8');
  ['time-entry', 'timesheet-approval', 'post-costs', 'project-costs'].forEach((p) => {
    const json = JSON.parse(fs.readFileSync(path.join(PAGES, p + '-page.json'), 'utf8'));
    const named = new Set();
    Object.values(json.eventListeners).forEach((l) => (l.chains || []).forEach((c) => named.add(c.chain)));
    const dir = path.join(PAGES, p + '-page-chains');
    const src = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
    (src.match(/chain: '([A-Za-z]+)'/g) || []).forEach((m) => named.add(m.replace(/chain: '|'/g, '')));
    [...named].forEach((n) => T.check(p + ': ' + n, fs.existsSync(path.join(dir, n + '.js'))));
    T.check(p + ': enforcePageAccessChain is byte-identical', fs.readFileSync(path.join(dir, 'enforcePageAccessChain.js'), 'utf8') === guardSrc);
  });

  T.section('every endpoint the usage pages call exists in services/');
  const ops = {};
  ['eqp-v1', 'ProjectLOV', 'ics'].forEach((svc) => {
    const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'services', svc, 'openapi3.json'), 'utf8'));
    Object.values(spec.paths || {}).forEach((p) => Object.values(p).forEach((op) => { if (op && op.operationId) ops[svc + '/' + op.operationId] = true; }));
  });
  const used = new Set();
  // Every service/operation string, wherever it sits (a ternary, a helper's argument), not only after "endpoint:".
  const scan = (file) => (fs.readFileSync(file, 'utf8').match(/'(?:eqp-v1|ics|ProjectLOV)\/[A-Za-z0-9_]+'/g) || []).forEach((m) => used.add(m.slice(1, -1)));
  ['time-entry', 'timesheet-approval', 'post-costs', 'project-costs'].forEach((p) => {
    const dir = path.join(PAGES, p + '-page-chains');
    fs.readdirSync(dir).forEach((f) => scan(path.join(dir, f)));
  });
  ['expenditureTypes.js', 'postCostToFusion.js', 'requestLineBody.js'].forEach((f) => scan(path.join(JS, f)));
  T.check('the scan found the money calls', ['eqp-v1/createPostedWeek', 'eqp-v1/createPostedWeekSplit', 'eqp-v1/postMiscTransactions', 'ics/postCostToFusionProject',
    'eqp-v1/createTimeEntry', 'eqp-v1/createInventoryConsumption'].every((e) => used.has(e)));
  [...used].sort().forEach((e) => T.check(e, !!ops[e]));

  T.report();
})();
