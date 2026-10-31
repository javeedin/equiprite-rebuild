/*
 * EquipRite Next, Usage & billing (webApps/equiprite-next/flows/usage): Timesheets, Approve time, Post costs (and a
 * request's costs), Direct cost & inventory.
 *
 * Loads the REAL modules, page modules and chains of Next and of New EquipRite (AMD, in a sandbox) and checks:
 *   - the rules are New's: the copied helpers byte for byte, and every New page function carried into Next with the
 *     same source text (and the module constants it closes over)
 *   - every chain that writes sends what New's sends, in New's order: both chains run against one fake backend
 *   - Fusion stays in New: no Fusion call, no posting and no ledger write anywhere in Next's Usage screens; under
 *     Fusion PPM rates nothing is approved
 *   - Next's own layer: what is missing, what needs a look, what is ready and posted, words, export
 *   - the pages: embeddable, every chain present, every endpoint real, the binding rules, every class styled
 *
 * Run:  node tests/next-usage.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const ROOT = path.join(__dirname, '..');
const NEXT = path.join(ROOT, 'webApps', 'equiprite-next');
const NEW = path.join(ROOT, 'webApps', 'equiprite');
const NJS = path.join(NEXT, 'resources', 'js');
const WJS = path.join(NEW, 'resources', 'js');
const NPAGES = path.join(NEXT, 'flows', 'usage', 'pages');
const WPAGES = path.join(NEW, 'flows', 'usage', 'pages');
const read = (f) => fs.readFileSync(f, 'utf8');

function loadAmd(file, deps) {
  const sandbox = { console, setTimeout, clearTimeout, Promise, Date, Intl, TextEncoder, URLSearchParams, window: {}, document: { querySelectorAll: () => [], body: {} } };
  let mod;
  sandbox.define = (names, factory) => {
    mod = factory(...names.map((n) => {
      if (deps && n in deps) return deps[n];
      throw new Error(path.basename(file) + ' needs ' + n + ', not given');
    }));
  };
  vm.createContext(sandbox);
  vm.runInContext(read(file), sandbox, { filename: path.basename(file) });
  return mod;
}

// ── the real modules ───────────────────────────────────────────────────────────────────────────────────────────
const rules = loadAmd(path.join(NJS, 'rules.js'), {});
const nav = loadAmd(path.join(NJS, 'nav.js'), { 'resources/js/rules': rules });
const fmt = loadAmd(path.join(NJS, 'fmt.js'), {});
const Progress = loadAmd(path.join(NJS, 'requestProgress.js'), {});
const weeks = loadAmd(path.join(NJS, 'usageWeeks.js'), {});
const timesheetRows = loadAmd(path.join(NJS, 'timesheetRows.js'), {});
const prPassThrough = loadAmd(path.join(NJS, 'prPassThrough.js'), {});
const lineBody = loadAmd(path.join(NJS, 'requestLineBody.js'), {});
const exportKit = loadAmd(path.join(NJS, 'exportKit.js'), {});
const usageAccess = loadAmd(path.join(NJS, 'usageAccess.js'), { 'resources/js/rules': rules, 'resources/js/nav': nav });
const TEm = loadAmd(path.join(NJS, 'timeEntry.js'), { 'resources/js/timesheetRows': timesheetRows, 'resources/js/usageWeeks': weeks });
const TAm = loadAmd(path.join(NJS, 'timeApproval.js'), { 'resources/js/usageWeeks': weeks });
const CPm = loadAmd(path.join(NJS, 'costPreview.js'), { 'resources/js/prPassThrough': prPassThrough, 'resources/js/usageWeeks': weeks, 'resources/js/fmt': fmt });
const DCm = loadAmd(path.join(NJS, 'directCost.js'), { 'resources/js/requestProgress': Progress });
const expStub = { resolveRequestIdByNumber: async () => 4440, loadForRequest: async () => [], attachUnits: async (c, l) => l };
const costData = loadAmd(path.join(NJS, 'costData.js'), { 'resources/js/costPreview': CPm, 'resources/js/prPassThrough': prPassThrough, 'resources/js/expenditureTypes': expStub });
const postCostToFusion = loadAmd(path.join(NJS, 'postCostToFusion.js'), {});
const costPosting = loadAmd(path.join(NJS, 'costPosting.js'), { 'resources/js/costPreview': CPm, 'resources/js/postCostToFusion': postCostToFusion,
  'resources/js/usageWeeks': weeks, 'resources/js/fmt': fmt });
const projectTaskTree = loadAmd(path.join(NJS, 'projectTaskTree.js'), {});

const NEW_W = { usageWeeks: loadAmd(path.join(WJS, 'usageWeeks.js'), {}), timesheetRows: loadAmd(path.join(WJS, 'timesheetRows.js'), {}),
  prPassThrough: loadAmd(path.join(WJS, 'prPassThrough.js'), {}), requestLineBody: loadAmd(path.join(WJS, 'requestLineBody.js'), {}),
  postCostToFusion: loadAmd(path.join(WJS, 'postCostToFusion.js'), {}) };
const NewTE = loadAmd(path.join(WPAGES, 'time-entry-page.js'), { 'resources/js/timesheetRows': NEW_W.timesheetRows, 'resources/js/usageWeeks': NEW_W.usageWeeks });
const NewTA = loadAmd(path.join(WPAGES, 'timesheet-approval-page.js'), { 'resources/js/usageWeeks': NEW_W.usageWeeks });
const NewPC = loadAmd(path.join(WPAGES, 'post-costs-page.js'), { 'resources/js/prPassThrough': NEW_W.prPassThrough });
const NewDC = loadAmd(path.join(WPAGES, 'project-costs-page.js'), {});

// Next's page modules (the classes the chains call as $page.functions).
const pageDeps = { 'resources/js/timeEntry': TEm, 'resources/js/timeApproval': TAm, 'resources/js/costPreview': CPm, 'resources/js/directCost': DCm,
  'resources/js/exportKit': exportKit, 'resources/js/nav': nav, 'resources/js/fmt': fmt, 'resources/js/usageWeeks': weeks, 'resources/js/costPosting': costPosting };
const NextTE = loadAmd(path.join(NPAGES, 'timesheets-page.js'), pageDeps);
const NextTA = loadAmd(path.join(NPAGES, 'approve-time-page.js'), pageDeps);
const NextPC = loadAmd(path.join(NPAGES, 'costs-page.js'), pageDeps);
const NextPR = loadAmd(path.join(NPAGES, 'cost-page.js'), pageDeps);
const NextDC = loadAmd(path.join(NPAGES, 'direct-costs-page.js'), pageDeps);

// ── a fake backend shared by New's and Next's chains ──────────────────────────────────────────────────────────
const cu = { auditHeaders: () => ({ 'X-User-Id': 'pat.lee' }), auditActor: () => 'pat.lee' };
function fake(responder) {
  const calls = [];
  const toasts = [];
  const Actions = {
    async callRest(context, o) {
      calls.push({ endpoint: o.endpoint, uriParams: o.uriParams || null, body: o.body === undefined ? null : o.body, headers: o.headers || null });
      const r = responder && responder(o, calls.length);
      return r || { ok: true, status: 200, body: {} };
    },
    async fireNotificationEvent(context, n) { toasts.push(n.summary + ': ' + n.message); },
    async callChain(context, c) { calls.push({ chain: c.chain, params: c.params || null }); },
    async navigateToPage() {}, async navigateToFlow() {},
  };
  const bus = { toast: (m, tone) => toasts.push(tone + ': ' + m), open: (r) => calls.push({ open: r }), rename: (id, t) => calls.push({ rename: id + '=' + t }) };
  const rest = () => calls.filter((c) => c.endpoint);
  return { calls, toasts, Actions, bus, rest, log: () => JSON.stringify(rest()) };
}
function newChain(page, name, f) {
  return loadAmd(path.join(WPAGES, page + '-page-chains', name + '.js'), {
    'vb/action/actionChain': class {}, 'vb/action/actions': f.Actions, 'resources/js/currentUser': cu, 'resources/js/requestLineBody': NEW_W.requestLineBody,
    'resources/js/postCostToFusion': NEW_W.postCostToFusion, 'resources/js/prPassThrough': NEW_W.prPassThrough, 'resources/js/expenditureTypes': expStub,
    'resources/js/usageGuard': { allow: async () => true },
  });
}
function nextChain(page, name, f, extra) {
  return loadAmd(path.join(NPAGES, page + '-page-chains', name + '.js'), Object.assign({
    'vb/action/actionChain': class {}, 'vb/action/actions': f.Actions, 'resources/js/currentUser': cu, 'resources/js/requestLineBody': lineBody,
    'resources/js/shellBus': f.bus, 'resources/js/expenditureTypes': expStub, 'resources/js/exportKit': exportKit, 'resources/js/costData': costData,
    'resources/js/usageAccess': usageAccess, 'resources/js/requestData': { load: async () => ({ rows: [], error: '' }) },
    'resources/js/costPosting': costPosting, 'resources/js/projectTaskTree': projectTaskTree, 'resources/js/prPassThrough': prPassThrough,
  }, extra || {}));
}
const clone = (o) => JSON.parse(JSON.stringify(o));
function appCtx(flags) {
  return {
    variables: { flagsLoaded: true, featureFlags: flags || {}, pageAccessMap: {}, pageAccessLoaded: true, buRateSources: {} },
    functions: { isFeatureEnabled: (fl, loaded, k) => !!loaded && !!fl && fl[k] === 'true', isPageReadOnly: () => false },
  };
}
/** Runs New's chain and Next's chain on the same variables against the same responder; returns both. */
async function twin(page, newPage, name, vars, params, responder, flags, NewFns, NextFns) {
  const out = {};
  for (const side of ['new', 'next']) {
    const f = fake(responder);
    const C = side === 'new' ? newChain(newPage, name, f) : nextChain(page, name, f);
    const ctx = { $page: { variables: clone(vars), functions: side === 'new' ? new NewFns() : new NextFns() }, $application: appCtx(flags) };
    await new C().run(ctx, clone(params));
    out[side] = { f, ctx };
  }
  return out;
}

const methodsOf = (C) => Object.getOwnPropertyNames(C.prototype).filter((k) => k !== 'constructor');
const preClass = (text, cls) => text.slice(text.search(/\n {2}(const|function) /), text.indexOf('\n  class ' + cls + ' {'));

(async () => {
  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('the rules are New EquipRite\'s');
  ['timesheetRows', 'usageWeeks', 'expenditureTypes', 'requestLineBody', 'prPassThrough'].forEach((m) => {
    T.check('helper copied unchanged: ' + m, read(path.join(NJS, m + '.js')) === read(path.join(WJS, m + '.js')));
  });
  [['timeEntry', 'TimeEntryRules', 'time-entry-page', TEm.TimeEntryRules, NewTE],
    ['timeApproval', 'TimeApprovalRules', 'timesheet-approval-page', TAm.TimeApprovalRules, NewTA],
    ['costPreview', 'CostRules', 'post-costs-page', CPm.CostRules, NewPC],
    ['directCost', 'DirectCostRules', 'project-costs-page', DCm.DirectCostRules, NewDC]].forEach(([file, cls, page, Ours, Theirs]) => {
    const theirs = methodsOf(Theirs);
    const ours = methodsOf(Ours);
    T.eq(file + ': every New page function is carried', theirs.filter((k) => ours.indexOf(k) < 0).join(','), '');
    T.eq(file + ': each one with New\'s source text', theirs.filter((k) => String(Ours.prototype[k]) !== String(Theirs.prototype[k])).join(','), '');
    T.check(file + ': the module constants they close over are New\'s', preClass(read(path.join(NJS, file + '.js')), cls)
      === preClass(read(path.join(WPAGES, page + '.js')), 'PageModule'));
  });
  T.check('the week loader is New\'s loadWeekChain, unchanged', read(path.join(NPAGES, 'timesheets-page-chains', 'loadWeekChain.js'))
    === read(path.join(WPAGES, 'time-entry-page-chains', 'loadWeekChain.js')));
  T.check('the approval loaders are New\'s, unchanged', ['loadApprovalsChain', 'loadCostChain'].every((c) =>
    read(path.join(NPAGES, 'approve-time-page-chains', c + '.js')) === read(path.join(WPAGES, 'timesheet-approval-page-chains', c + '.js'))));

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('Timesheets: Save and Submit send what New sends');
  const WEEK = '2026-10-26';
  const API = [
    { eqrTimeEntryId: 900, requestNumber: 'REQ-1', requestLineId: 501, equipmentName: 'CAT 320', hoursType: 'USAGE', entryStatus: 'DRAFT', isRentable: 'Y',
      requestedStartDate: '2026-10-01T00:00:00Z', requestedEndDate: '2026-12-15T00:00:00Z', day1Hours: 8, day2Hours: 8, day3Hours: 8, day4Hours: 8, day5Hours: 8, expenditureType: 'Equipment' },
    { eqrTimeEntryId: null, requestNumber: 'REQ-1', requestLineId: 502, equipmentName: 'Dump Truck', hoursType: '', entryStatus: null, isRentable: null,
      requestedStartDate: '2026-10-28T00:00:00Z', requestedEndDate: '2026-12-15T00:00:00Z', defaultHours: 9 },
    { eqrTimeEntryId: 906, requestNumber: 'REQ-1', requestLineId: 504, equipmentName: 'Crane', hoursType: 'STANDBY', entryStatus: 'SUBMITTED', isRentable: 'Y',
      requestedStartDate: '2026-10-01', requestedEndDate: '2026-12-15', day1Hours: 4 },
    { eqrTimeEntryId: 907, requestNumber: 'REQ-1', requestLineId: 505, equipmentName: 'Loader', hoursType: 'USAGE', entryStatus: 'REJECTED', isRentable: 'Y',
      requestedStartDate: '2026-10-01', requestedEndDate: '2026-12-15', day1Hours: 8, day2Hours: 8 },
  ];
  const te = new NextTE();
  const rows = te.buildRows(API, WEEK);
  const days = te.weekDays(WEEK);
  const edits = { 'L501|d0': '10', 'L501|d5': '2.5' };
  const teVars = (over) => Object.assign({ requestNumber: 'REQ-1', weekStart: WEEK, weekDays: days, rows, edits: Object.assign({}, edits),
    picked: { L501: true, L502: true }, expTypeList: [{ value: 'Equipment' }, { value: 'Supplies' }], internalRequestId: 7001, isSaving: false,
    readOnly: false, saveError: '' }, over || {});
  const teResponder = (o) => {
    if (o.endpoint === 'eqp-v1/createTimeEntry') return { ok: true, status: 201, body: { id: 901 } };
    if (o.endpoint === 'eqp-v1/patchRequestLinesBatch') return { ok: true, body: { data: (o.body.lines || []).map((l) => ({ id: l.id, expenditureType: l.expenditureType })) } };
    if (o.endpoint === 'eqp-v1/getEquipriteV1ViewsTimesheetDetailsByWeek') {
      return { ok: true, body: { data: [API[0], Object.assign({}, API[1], { eqrTimeEntryId: 901, entryStatus: 'DRAFT' }), API[2], API[3]] } };
    }
    return null;
  };
  const scenarios = [
    ['save: a changed entry, a new line, an expenditure type', { edits: Object.assign({ 'L502|exp': 'Supplies' }, edits) }, { mode: 'save' }, teResponder, {}],
    ['submit: saved first, re-read, then SUBMITTED', { edits: Object.assign({ 'L502|type': 'STANDBY' }, edits) }, { mode: 'submit' }, teResponder, {}],
    ['submit with a ticked row lacking a rate type', {}, { mode: 'submit' }, teResponder, {}],
    ['submit under PPM rates without an expenditure type', { edits: Object.assign({ 'L502|type': 'USAGE' }, edits) }, { mode: 'submit' }, teResponder, { PPM_RATES_ENABLED: 'true' }],
    ['a failed PATCH', {}, { mode: 'save' }, (o) => (o.endpoint === 'eqp-v1/patchTimeEntry' ? { ok: false, status: 500, body: {} } : teResponder(o)), {}],
    ['a failed create aborts submit', { edits: Object.assign({ 'L502|type': 'USAGE' }, edits) }, { mode: 'submit' },
      (o) => (o.endpoint === 'eqp-v1/createTimeEntry' ? { ok: false, status: 400 } : teResponder(o)), {}],
    ['a bad box blocks the save', { edits: { 'L501|d0': '30' } }, { mode: 'save' }, teResponder, {}],
    ['a read-only role', { readOnly: true }, { mode: 'save' }, teResponder, {}],
  ];
  for (const [title, over, params, responder, flags] of scenarios) {
    const t = await twin('timesheets', 'time-entry', 'saveTimesheetChain', teVars(over), params, responder, flags, NewTE, NextTE);
    T.eq(title + ': same calls, bodies, headers, order', t.next.f.log(), t.new.f.log());
    T.eq(title + ': same message on the page', t.next.ctx.$page.variables.saveError, t.new.ctx.$page.variables.saveError);
  }
  {
    const t = await twin('timesheets', 'time-entry', 'saveTimesheetChain', teVars({ edits: Object.assign({ 'L502|type': 'STANDBY' }, edits) }), { mode: 'submit' },
      teResponder, {}, NewTE, NextTE);
    const seq = t.next.f.rest().map((c) => c.endpoint.replace('eqp-v1/', ''));
    T.eq('submit, in full', seq.join(' > '), ['patchTimeEntry'].concat(Array(7).fill('createTimeEntryDay'), ['createTimeEntry'], Array(7).fill('createTimeEntryDay'),
      ['getEquipriteV1ViewsTimesheetDetailsByWeek', 'patchTimeEntry', 'patchTimeEntry']).join(' > '));
    T.eq('...and the week and the requests on site are read back', t.next.f.calls.filter((c) => c.chain).map((c) => c.chain).join(','), 'loadWeekChain,loadQueueChain');
    T.check('...and it says so in a toast', t.next.f.toasts.some((m) => /2 rows of the week of 26 Oct – 1 Nov 2026 sent for approval/.test(m)));
  }
  {
    const f = fake(teResponder);
    const Save = nextChain('timesheets', 'saveTimesheetChain', f);
    const ctx = { $page: { variables: teVars(), functions: new NextTE() }, $application: appCtx({}) };
    const s = new Save();
    await Promise.all([s.run(ctx, { mode: 'save' }), s.run(ctx, { mode: 'save' })]);
    T.eq('a double click saves once', f.rest().filter((x) => x.endpoint === 'eqp-v1/createTimeEntry').length, 1);
  }
  {
    const prev = [Object.assign({}, API[0], { eqrTimeEntryId: 880, day1Hours: 9, day2Hours: 9, day3Hours: 9, day4Hours: 9, day5Hours: 4 })];
    const t = await twin('timesheets', 'time-entry', 'copyLastWeekChain', teVars({ edits: {} }), {},
      (o) => (o.endpoint === 'eqp-v1/getEquipriteV1ViewsTimesheetDetailsByWeek' ? { ok: true, body: { data: prev } } : null), {}, NewTE, NextTE);
    T.eq('Copy last week: the same read', t.next.f.log(), t.new.f.log());
    T.eq('...and the same boxes filled, nothing written', JSON.stringify(t.next.ctx.$page.variables.edits), JSON.stringify(t.new.ctx.$page.variables.edits));
  }
  {
    const vars = teVars({ weeks: ['2026-10-19', WEEK, '2026-11-02'], pendingMove: null });
    const t = await twin('timesheets', 'time-entry', 'moveChain', vars, { dir: 'next' }, null, {}, NewTE, NextTE);
    T.check('a week change with typed hours waits, as in New', !!t.next.ctx.$page.variables.pendingMove
      && JSON.stringify(t.next.ctx.$page.variables.pendingMove) === JSON.stringify(t.new.ctx.$page.variables.pendingMove));
    const f = fake();
    const Move = nextChain('timesheets', 'moveChain', f);
    const ctx = { $page: { variables: teVars({ edits: {}, weeks: [WEEK] }), functions: new NextTE() }, $application: appCtx({}) };
    await new Move().run(ctx, { refresh: 'yes' });
    T.eq('Refresh reads the requests on site and the week again', f.calls.map((c) => c.chain).join(','), 'loadQueueChain,loadWeekChain');
  }

  T.section('Timesheets: what is missing, in words');
  {
    const today = '2026-10-29';
    const miss = te.missing(rows, { 'L501|d1': '0' }, days, false, today).map((m) => m.text);
    T.eq('a weekday with no hours up to today, a missing rate type, a line sent back', miss.join(' | '),
      'CAT 320: no hours on Tue 27 Oct. | Dump Truck: choose a rate type; Submit needs one. | Loader: sent back by the approver. Correct the hours, then submit again. | Loader: no hours on Wed 28 Oct, Thu 29 Oct.');
    T.check('the day not yet come, the weekend and a closed day are never missing', !miss.join().includes('Fri 30') && !miss.join().includes('Sat') && !miss.join().includes('Mon 26 Oct on Dump'));
    T.check('under PPM rates, a line with hours needs an expenditure type', te.missing(rows, {}, days, true, today).some((m) => m.text === 'Dump Truck: choose an expenditure type; the hours go to Fusion PPM under it.'));
    T.eq('a submitted row is never missing anything', te.missing([rows[2]], {}, days, true, today).length, 0);
    T.eq('the box of a missing day is marked', JSON.stringify(te.gapDays(rows[0], { 'L501|d1': '' }, days, today)), '{"1":true}');
    T.eq('statuses in words', ['', 'DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'POSTED'].map((s) => te.statusWord(s)).join(' | '),
      'Not saved yet | Draft, not submitted | Waiting for approval | Approved | Sent back to correct | Approved and posted');
    T.eq('totals by rate type, in words (a row with no type counts as Usage, as New saves it)', te.typeTotalsWords(rows, edits), 'Usage 105.5 h · Standby 4 h');
    const queue = [{ requestNumber: 'R1', status: 'DRAFT', totalHours: 40, eqrTimeEntryId: 1 }, { requestNumber: 'R2', status: 'SUBMITTED', totalHours: 8, eqrTimeEntryId: 2 },
      { requestNumber: 'R3', status: 'DRAFT', totalHours: 0, eqrTimeEntryId: null }, { requestNumber: 'R4', status: 'APPROVED', totalHours: 9, eqrTimeEntryId: 4 }];
    T.eq('the request list\'s chips', te.queueChips(queue).map((c) => c.key + ':' + c.count).join(' '), 'all:4 todo:2 waiting:1 approved:1');
    T.eq('what each request needs', queue.map((q) => te.queueNote(q)).join(' | '), 'Draft, not submitted · 40 h | Waiting for approval · 8 h | Not started | Approved · 9 h');
    T.eq('the export: the week as typed, days as numbers', JSON.stringify(exportKit.table(te.exportRows([rows[0]], edits), te.exportColumns(days)).body[0]),
      '["REQ-1","CAT 320","","","Usage","Equipment",10,8,8,8,8,2.5,0,44.5,"Draft, not submitted","DRAFT"]');
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('Approve time: Approve, Send back and Adjust send what New sends');
  const day7 = (a) => ({ day1Hours: a[0], day2Hours: a[1], day3Hours: a[2], day4Hours: a[3], day5Hours: a[4], day6Hours: a[5], day7Hours: a[6] });
  const ta = new NextTA();
  const APR = ta.mapRows([
    Object.assign({ eqrTimeEntryId: 910, requestNumber: 'REQ-2', requestLineId: 501, equipmentName: 'CAT 320', entryStatus: 'SUBMITTED', weekStartDate: WEEK,
      requestedStartDate: '2026-10-01', requestedEndDate: '2026-12-15', totalHours: 50, totalBill: 8750 }, day7([8, 8, 18, 9, 7, 0, 0])),
    Object.assign({ eqrTimeEntryId: 911, requestNumber: 'REQ-1', requestLineId: 601, equipmentName: 'Crane', entryStatus: 'SUBMITTED', weekStartDate: WEEK,
      requestedStartDate: '2026-10-01', requestedEndDate: '2026-12-15', totalHours: 43, totalBill: 12838 }, day7([8, 8, 8, 11, 8, 0, 0])),
    Object.assign({ eqrTimeEntryId: 912, requestNumber: 'REQ-1', requestLineId: 602, equipmentName: 'Light Tower', entryStatus: 'SUBMITTED', weekStartDate: WEEK,
      requestedStartDate: '2026-10-01', requestedEndDate: '2026-12-15', totalHours: 40, totalBill: 2000 }, day7([8, 8, 8, 8, 8, 0, 0])),
    Object.assign({ eqrTimeEntryId: 913, requestNumber: 'REQ-2', requestLineId: 503, equipmentName: 'Generator', entryStatus: 'SUBMITTED', weekStartDate: WEEK,
      requestedStartDate: '2026-10-01', requestedEndDate: '2026-12-15', totalHours: 30, totalBill: 1500 }, day7([6, 6, 6, 6, 6, 0, 0])),
    Object.assign({ eqrTimeEntryId: 880, requestNumber: 'REQ-2', requestLineId: 501, equipmentName: 'CAT 320', entryStatus: 'APPROVED', weekStartDate: '2026-10-19',
      totalHours: 40, totalBill: 7000 }, day7([9, 9, 9, 9, 4, 0, 0])),
  ]);
  const taVars = (over) => Object.assign({ rowsAll: APR, weekKey: WEEK, weekDays: days, statusKey: 'SUBMITTED', searchText: '', picked: { E910: true, E911: true, E913: true },
    confirm: '', isWorking: false, readOnly: false, actionError: '', actionNote: '', adjust: null, onlyLook: false }, over || {});
  const failOn = (id) => (o) => (o.endpoint === 'eqp-v1/patchTimeEntry' && o.uriParams.id === id && o.body.status === 'APPROVED' ? { ok: false, status: 409, body: { detail: 'locked' } } : null);
  for (const [title, responder] of [['approve, request by request', null], ['a failed entry puts its request\'s approved entries back', failOn(913)]]) {
    const t = await twin('approve-time', 'timesheet-approval', 'approveChain', taVars(), { step: 'go' }, responder, {}, NewTA, NextTA);
    T.eq(title + ': same calls and order as New', t.next.f.log(), t.new.f.log());
    T.eq(title + ': same words on the page', t.next.ctx.$page.variables.actionError + '|' + t.next.ctx.$page.variables.actionNote,
      t.new.ctx.$page.variables.actionError + '|' + t.new.ctx.$page.variables.actionNote);
  }
  {
    const t = await twin('approve-time', 'timesheet-approval', 'approveChain', taVars(), { step: 'go' }, failOn(913), {}, NewTA, NextTA);
    T.eq('...the calls, written out', t.next.f.rest().map((c) => c.uriParams.id + ':' + c.body.status).join(' '), '910:APPROVED 913:APPROVED 910:SUBMITTED 911:APPROVED');
  }
  {
    const t = await twin('approve-time', 'timesheet-approval', 'approveChain', taVars(), { step: 'go' }, null, { PPM_RATES_ENABLED: 'true' }, NewTA, NextTA);
    T.check('under PPM rates New also sends the request to Fusion', t.new.f.rest().some((c) => /^ics\//.test(c.endpoint)));
    T.eq('...so Next approves nothing and calls nothing', t.next.f.rest().length, 0);
    T.check('...and says to approve in New', /approve these lines in New EquipRite/.test(t.next.ctx.$page.variables.actionError));
    const ask = await twin('approve-time', 'timesheet-approval', 'approveChain', taVars(), { step: 'ask' }, null, {}, NewTA, NextTA);
    T.eq('Approve asks first and writes nothing', [ask.next.ctx.$page.variables.confirm, ask.next.f.rest().length].join(), 'approve,0');
    const f = fake();
    const A = nextChain('approve-time', 'approveChain', f);
    const ctx = { $page: { variables: taVars(), functions: new NextTA() }, $application: appCtx({}) };
    ctx.$application.variables.flagsLoaded = false;
    await new A().run(ctx, { step: 'go' });
    T.check('Approve refuses while the settings load (the PPM check would read as off)', f.rest().length === 0 && /still loading/.test(ctx.$page.variables.actionError));
  }
  {
    const t = await twin('approve-time', 'timesheet-approval', 'rejectChain', taVars(), { step: 'go' },
      (o) => (o.uriParams && o.uriParams.id === 913 ? { ok: false, status: 500 } : null), {}, NewTA, NextTA);
    T.eq('Send back: New\'s rejectChain, stopping at a failure', t.next.f.log(), t.new.f.log());
    T.eq('...in words', t.next.ctx.$page.variables.actionError, t.new.ctx.$page.variables.actionError);
  }
  {
    const vars = taVars({ adjust: { key: 'E910', days: ['8', '8', '10', '9', '7', '0', '0'], reason: '18 h was a typo' } });
    const t = await twin('approve-time', 'timesheet-approval', 'adjustChain', vars, { action: 'save' }, null, {}, NewTA, NextTA);
    T.eq('Adjust: the hours, each day, then the audit entry, as New', t.next.f.log(), t.new.f.log());
    const audit = t.next.f.rest().pop();
    T.eq('...the audit entry keeps what was submitted', [audit.endpoint, audit.body.entityId, JSON.parse(audit.body.oldValues).days.join(','), JSON.parse(audit.body.newValues).totalHours].join(' | '),
      'eqp-v1/createAuditTrailEntry | 910 | 8,8,18,9,7,0,0 | 42');
    const noReason = await twin('approve-time', 'timesheet-approval', 'adjustChain', taVars({ adjust: { key: 'E910', days: ['8', '8', '10', '9', '7', '0', '0'], reason: '' } }),
      { action: 'save' }, null, {}, NewTA, NextTA);
    T.check('...and refuses without a reason, writing nothing', noReason.next.f.rest().length === 0 && /Say why/.test(noReason.next.ctx.$page.variables.actionError));
  }

  T.section('Approve time: what needs a look first');
  {
    T.eq('a day over 16 h, then a change of 8 h or more on last week', ta.exceptions(APR, APR[0], days).map((e) => e.tone + ':' + e.text).join(' | '),
      'high:18 h on Wed 28 Oct | change:+10 h on last week');
    T.eq('a day over 10 h', ta.exceptions(APR, APR[1], days).map((e) => e.tone + ':' + e.text).join(' | '), 'long:11 h on Thu 29 Oct');
    T.eq('a line that looks right', ta.exceptions(APR, APR[2], days).length, 0);
    T.eq('"needs a look only" (New\'s order: request, then equipment)', ta.shown(APR, WEEK, 'SUBMITTED', '', true, days).map((r) => r.key).join(','), 'E911,E910');
    T.eq('"select the lines that look right"', Object.keys(ta.cleanKeys(APR, ta.shown(APR, WEEK, 'SUBMITTED', '', false, days), false, days)).join(','), 'E912,E913');
    T.eq('...none for a read-only role', Object.keys(ta.cleanKeys(APR, APR, true, days)).length, 0);
    T.eq('the week waiting', JSON.stringify(ta.waiting(APR, WEEK, days)), '{"lines":4,"hours":163,"cost":25088,"look":2}');
    const f = fake();
    const Filter = nextChain('approve-time', 'filterChain', f);
    const ctx = { $page: { variables: taVars({ picked: {} }), functions: new NextTA() }, $application: appCtx({}) };
    await new Filter().run(ctx, { action: 'pickClean' });
    T.eq('the chain ticks them', Object.keys(ctx.$page.variables.picked).join(','), 'E912,E913');
    T.eq('the export: what is shown, with what needs a look', exportKit.table(ta.exportRows([APR[0]], APR, days, {}), ta.exportColumns(days)).body[0].slice(-7).join(' | '),
      '50 | +10 h vs last week | 8750 | 18 h on Wed 28 Oct · +10 h on last week |  | Waiting for approval | SUBMITTED');
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('Post costs: New\'s reads, what is ready and what was posted');
  const TODAY = new Date(Date.UTC(2026, 9, 29));
  const cp = new NextPC();
  const pcRow = (o) => Object.assign({ requestNumber: 'REQ-10440', lineType: 'RENTABLE', qty: 1, applicableRate: 200, ratePeriod: 'DAILY', totalHours: 40, postStatus: 'APPROVED' }, o);
  const gen = (w, o) => pcRow(Object.assign({ rowKey: '701:0:' + w.replace(/-/g, ''), requestLineId: 701, equipmentName: 'Generator', weekStartDate: w,
    weekEndDate: weeks.addDays(w, 6), costAmount: 1400, lineExpenditureType: 'Equipment Rental' }, o));
  const DET = [gen('2026-10-05', { postStatus: 'POSTED' }), gen('2026-10-12'), gen('2026-10-19'), gen('2026-10-26'), gen('2027-01-04'),
    pcRow({ rowKey: '702:0:20261019', requestLineId: 702, equipmentName: 'Light Tower', weekStartDate: '2026-10-19', weekEndDate: '2026-10-25', costAmount: 700, applicableRate: 100 })];
  const MISC = [{ eqrLineMiscTxnId: 55, requestNumber: 'REQ-10440', requestLineId: 701, expenditureType: 'Fuel', expenditureOrg: 'Org', expenditureItemDate: '2026-10-05',
    quantity: 1, rawCost: 90, status: 'DRAFT', comments: 'Fuel top-up' }];
  const SPLITS = [
    { requestLineId: 701, weekStartDate: '2026-10-19', projectRefId: 3001, projectNumber: 'PRJ-B', taskId: 4001, taskNumber: '4.2', splitPct: 60 },
    { requestLineId: 701, weekStartDate: '2026-10-19', projectRefId: 3002, projectNumber: 'PRJ-C', taskId: 5001, taskNumber: '2.1', splitPct: 40 },
  ];
  const ROW = { requestNumber: 'REQ-10440', eqrEquipmentRequestId: 4440, projectName: 'Plant B', taskName: 'Electrical', ppmProjectNumber: 'PRJ-B', ppmTaskNumber: '4.2',
    startDate: '2026-10-05', endDate: '2026-12-31', rateScheduleId: 77 };
  const pcResponder = (o) => {
    const e = o.endpoint.replace('eqp-v1/', '');
    if (e === 'getEquipriteV1ViewsPostCost') return { ok: true, body: { data: [{ eqrEquipmentRequestId: 4440, requestNumber: 'REQ-10440', projectName: 'Plant B', weekStartDate: '2026-10-12', totalBillCost: 1400 }] } };
    if (e === 'getEquipriteV1ViewsPostCostDetails') return { ok: true, body: { data: DET } };
    if (e === 'getMiscTransactions') return { ok: true, body: { data: MISC } };
    if (e === 'getLineProjectSplits') return { ok: true, body: { data: SPLITS } };
    if (e === 'getPurchaseRequisitions') return { ok: true, body: { data: [] } };
    return { ok: true, body: { data: [] } };
  };
  {
    const fN = fake(pcResponder);
    const NewList = newChain('post-costs', 'listChain', fN);
    const nctx = { $page: { variables: { list: [] }, functions: new NewPC() }, $application: appCtx({}) };
    await new NewList().run(nctx);
    const fX = fake(pcResponder);
    const got = await costData.list({}, fX.Actions, { refresh: true });
    T.eq('the list: New\'s listChain reads', fX.log(), fN.log());
    T.eq('...grouped by New\'s buildList', JSON.stringify(got.list), JSON.stringify(nctx.$page.variables.list));

    const fP = fake(pcResponder);
    const NewPrev = newChain('post-costs', 'loadPreviewChain', fP);
    const pctx = { $page: { variables: { current: clone(ROW), rowsAll: [], facts: {} }, functions: new NewPC() }, $application: appCtx({}) };
    await new NewPrev().run(pctx);
    const fQ = fake(pcResponder);
    const prev = await costData.preview({}, fQ.Actions, clone(ROW));
    T.eq('a request\'s preview: New\'s loadPreviewChain reads, in its order', fQ.log(), fP.log());
    T.eq('...and New\'s tree', JSON.stringify(prev.out.rowsAll), JSON.stringify(pctx.$page.variables.rowsAll));
  }
  {
    const out = cp.buildPreview(DET, { misc: MISC, splits: SPLITS }, cp.hdrOf(ROW), TODAY);
    const s = cp.summarize(out);
    T.eq('ready: the weeks that have ended and the charge; posted; running', [s.ready, s.readyWeeks, s.readyCharges, s.posted, s.running, s.runningWeeks, s.lastPosted].join(' | '),
      '3590 | 3 | 1 | 1400 | 1400 | 1 | 11 Oct');
    const plan = cp.readyPlan(out.rowsAll, cp.hdrOf(ROW), 77);
    T.eq('what would be posted: New\'s postingPlan over everything ready', plan.map((p) => p.what + ' → ' + p.destination + ' ' + p.amount).join(' | '),
      'Generator · week of 12 – 18 Oct 2026 → PRJ-B Plant B / task 4.2 1400 | Generator · week of 19 – 25 Oct 2026 → 60% PRJ-B / 4.2, 40% PRJ-C / 2.1 1400'
      + ' | Light Tower · week of 19 – 25 Oct 2026 → PRJ-B Plant B / task 4.2 700 | Generator · charge: Fuel top-up → PRJ-B Plant B / task 4.2 · Org 90');
    const sel = cp.everythingReady(out.rowsAll);
    T.eq('...it is what New\'s Post would write, ledger body for body', JSON.stringify(cp.weeksToPost(sel).map((r) => cp.ledgerBody(r, 77).postedCostAmount)), '[1400,1400,700]');
    T.check('a posted week, a running week and a future one are never in it', !plan.some((p) => /5 – 11 Oct|26 Oct|Jan/.test(p.what)));
    T.eq('the week by week table, in words', cp.tableRows(out.rowsAll, cp.hdrOf(ROW)).filter((r) => r.kind !== 'group').map((r) => r.word).join(', '),
      'Posted, Ready to post, Ready to post, This week, not ended, Ready to post, Ready to post');
    const list = [{ requestNumber: 'A', eqrEquipmentRequestId: 3, startDate: '2026-10-01', endDate: '2026-12-31', totalBillCost: 10 },
      { requestNumber: 'B', eqrEquipmentRequestId: 2, startDate: '2026-08-01', endDate: '2026-09-30', totalBillCost: 50 },
      { requestNumber: 'C', eqrEquipmentRequestId: 1, startDate: '2026-11-20', endDate: '2026-12-30', totalBillCost: 0 }];
    const bd = { A: { ready: 0, posted: 5, running: 5 }, B: { ready: 0, posted: 50, running: 0 }, C: { ready: 0, posted: 0, running: 0 } };
    T.eq('the list\'s chips, once worked out', cp.listChips(list, bd, TODAY).map((c) => c.key + ':' + c.count).join(' '), 'all:3 ready:0 running:1 posted:1 none:1');
    T.eq('...a request still being worked out is in "All" only', cp.listChips(list, {}, TODAY).map((c) => c.count).join(), '3,0,0,0,0');
    T.eq('the figures across the list', JSON.stringify(cp.totals(list, bd)), '{"requests":3,"known":3,"cost":60,"ready":0,"readyRequests":0,"posted":55,"running":5,"pending":0}');
    T.eq('sort by what was posted', cp.listShown(list, '', 'all', bd, 'posted', 'desc', TODAY).map((r) => r.requestNumber).join(), 'B,A,C');
  }
  {
    const f = fake(pcResponder);
    const Break = nextChain('costs', 'breakdownChain', f);
    const ctx = { $page: { variables: { gen: 1, list: [Object.assign({}, ROW, { totalBillCost: 6300 }), { requestNumber: 'REQ-0', totalBillCost: 0 }], misc: MISC, breakdown: {}, progress: {} },
      functions: new NextPC() }, $application: appCtx({}) };
    await new Break().run(ctx, { gen: 1 });
    T.eq('the list works out only the requests with cost (2 reads each)', f.rest().map((c) => c.endpoint.replace('eqp-v1/', '')).join(','), 'getEquipriteV1ViewsPostCostDetails,getPurchaseRequisitions');
    T.eq('...one with no cost has nothing to post', JSON.stringify([ctx.$page.variables.breakdown['REQ-0'].ready, ctx.$page.variables.progress]), '[0,{"done":1,"total":1,"failed":0}]');
    T.check('...and the list\'s figures are the tab\'s', ctx.$page.variables.breakdown['REQ-10440'].posted === 1400);
  }
  {
    const f = fake(pcResponder);
    const Rec = nextChain('cost', 'loadRecordChain', f);
    const ctx = { $page: { variables: { number: 'REQ-10440', id: '', row: {}, facts: {}, plan: [], table: [] }, functions: new NextPR() },
      $application: { variables: { flagsLoaded: true, pageAccessLoaded: true, featureFlags: { PROJECTS_MODULE_ENABLED: 'true' }, pageAccessMap: { EQR_POST_COST: 'FULL' } } } };
    await new Rec().run(ctx, { refresh: false });
    T.eq('a request\'s tab is named after it', f.calls.filter((c) => c.rename).map((c) => c.rename).join(), 'cost:REQ-10440=REQ-10440 costs');
    T.check('...and holds what would be posted', ctx.$page.variables.plan.length > 0 && !ctx.$page.variables.error);
    const prf = new NextPR();
    const ticked = prf.selection(ctx.$page.variables.rowsAll).items;
    T.check('a role with Post costs may post (New\'s isPageReadOnly), and everything ready is ticked', ctx.$page.variables.readOnly === false
      && ticked > 0 && ticked === prf.selection(prf.everythingReady(ctx.$page.variables.rowsAll)).items, ctx.$page.variables.readOnly + '/' + ticked);
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('Direct cost & inventory: what is used and what is left');
  {
    const dc = new NextDC();
    const reqs = dc.activeRequests([{ eqrEquipmentRequestId: 1, requestNumber: 'R1', status: 'DEPLOYED' }, { eqrEquipmentRequestId: 2, requestNumber: 'R2', status: 'DRAFT' },
      { eqrEquipmentRequestId: 3, requestNumber: 'R3', status: 'APPROVED' }]);
    T.eq('approved and active requests only (New\'s rule), newest first', reqs.map((r) => r.requestNumber).join(), 'R3,R1');
    const lines = dc.issuableLines([{ lineId: 801, equipmentName: 'Oil', quantity: 10, lineStatus: 'DELIVERED', consumableFlag: 'Y', deliveredQuantity: 8 },
      { lineId: 802, equipmentName: 'Excavator', quantity: 1, lineStatus: 'DEPLOYED', consumableFlag: 'N' }, { lineId: 803, equipmentName: 'Pump', lineStatus: 'REJECTED' }]);
    const cons = [{ requestLineId: 801, quantityConsumed: 3 }, { requestLineId: 801, quantityConsumed: 2.5 }];
    T.eq('used and left, against the delivered quantity', dc.lineRows(lines, cons).map((l) => l.equipmentName + ':' + l.used + '/' + l.left + ':' + l.word).join(' '),
      'Oil:5.5/2.5:On site Excavator:0/null:On site');
    T.eq('the request in figures', JSON.stringify(dc.facts(lines, cons, [{ rawCost: 420 }], [{ totalCost: 7000 }])),
      '{"lines":2,"consumables":1,"used":5.5,"left":2.5,"issues":2,"direct":420,"directCount":1,"cost":7000}');
    const f = fake((o) => (o.endpoint === 'eqp-v1/getEquipriteV1ViewsRequestDetailLines' ? { ok: true, body: { data: lines } } : { ok: true, body: { data: [] } }));
    const Pick = nextChain('direct-costs', 'pickRequestChain', f);
    const ctx = { $page: { variables: { requests: reqs, current: null }, functions: dc }, $application: appCtx({}) };
    await new Pick().run(ctx, { id: '1' });
    const fN = fake((o) => (o.endpoint === 'eqp-v1/getEquipriteV1ViewsRequestDetailLines' ? { ok: true, body: { data: lines } } : { ok: true, body: { data: [] } }));
    const NewPick = newChain('project-costs', 'pickRequestChain', fN);
    await new NewPick().run({ $page: { variables: { requests: reqs, current: null, isSubmitting: false }, functions: new NewDC() } }, { id: '1' });
    T.eq('a request: New\'s pickRequestChain reads, in its order', f.log(), fN.log());
    T.eq('New\'s Direct cost & inventory, opened on the request', dc.newUrl('https://x/equiprite', 'R1'), 'https://x/equiprite/vp/shell/usage/project-costs?request=R1');
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('Fusion: only a request\'s costs posts, with New\'s calls (tests/next-posting.test.js runs them beside New\'s)');
  const files = [];
  (function walk(d) { fs.readdirSync(d).forEach((n) => { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.js$/.test(n)) files.push(p); }); }(NPAGES));
  ['timeEntry', 'timeApproval', 'costPreview', 'directCost', 'costData', 'usageAccess', 'costPosting', 'postCostToFusion'].forEach((m) => files.push(path.join(NJS, m + '.js')));
  const endpoints = {};
  files.forEach((f) => { (read(f).match(/'(eqp-v1|ics|ProjectLOV)\/[A-Za-z0-9_]+'/g) || []).forEach((e) => { (endpoints[e.slice(1, -1)] = endpoints[e.slice(1, -1)] || []).push(path.relative(NPAGES, f)); }); });
  const spec = JSON.parse(read(path.join(ROOT, 'services', 'eqp-v1', 'openapi3.json')));
  const ops = {};
  Object.values(spec.paths).forEach((m) => Object.values(m).forEach((o) => { if (o && o.operationId) ops[o.operationId] = 1; }));
  T.eq('every eqp-v1 endpoint named exists', Object.keys(endpoints).filter((e) => e.startsWith('eqp-v1/') && !ops[e.slice(7)]).join(','), '');
  T.eq('the only Fusion writes are New\'s OIC post-cost flow, through New\'s postCostToFusion (copied unchanged)',
    Object.keys(endpoints).filter((e) => e.startsWith('ics/')).sort().join(',') + '|' + (read(path.join(NJS, 'postCostToFusion.js')) === read(path.join(WJS, 'postCostToFusion.js'))),
    'ics/postCostToFusion,ics/postCostToFusionProject|true');
  const allNext = [];
  (function walk(d) { fs.readdirSync(d).forEach((n) => { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.js$/.test(n)) allNext.push(p); }); }(NEXT));
  T.eq('...sent only by costPosting.post, which only a request\'s Post runs', [allNext.filter((f) => read(f).includes('resources/js/postCostToFusion\'')),
    allNext.filter((f) => /costPosting\.post\(/.test(read(f)))].map((l) => l.map((f) => path.relative(NEXT, f)).join('+')).join(' | '),
    'resources/js/costPosting.js | flows/usage/pages/cost-page-chains/postChain.js');
  T.eq('...and the Fusion reads are the split\'s project and task lists', Object.keys(endpoints).filter((e) => e.startsWith('ProjectLOV/')).map((e) => e + '<' + endpoints[e].join('+')).sort().join(','),
    'ProjectLOV/getFscmRestApiResources11_13_18_05ProjectTasks<cost-page-chains/splitChain.js,ProjectLOV/getFscmRestApiResources11_13_18_05ProjectsLOV<cost-page-chains/splitChain.js');
  const WRITES = /^eqp-v1\/(create|patch|post|put|delete|update|replace|unpost|clear|reverse)/i;
  const writers = Object.keys(endpoints).filter((e) => WRITES.test(e)).sort();
  T.eq('the writes: New\'s timesheet writes, and New\'s posting writes', writers.join(','),
    'eqp-v1/clearLineProjectSplits,eqp-v1/createAuditTrailEntry,eqp-v1/createLineDayException,eqp-v1/createMiscTransaction,eqp-v1/createPostedWeek,eqp-v1/createPostedWeekSplit,'
    + 'eqp-v1/createTimeEntry,eqp-v1/createTimeEntryDay,eqp-v1/deleteMiscTransactionById,eqp-v1/patchTimeEntry,eqp-v1/postMiscTransactions,eqp-v1/replaceLineProjectSplits,eqp-v1/reverseRequestLine');
  T.eq('...the posting writes only from a request\'s costs (none from the list or Direct cost)', writers.filter((e) => endpoints[e].some((f) => /^(costs|direct-costs)-page/.test(f))).join(','), '');
  T.check('the expenditure-type batch goes through New\'s requestLineBody (patchRequestLinesBatch)', read(path.join(NPAGES, 'timesheets-page-chains', 'saveTimesheetChain.js')).includes('lineBody.updateLines')
    && read(path.join(NPAGES, 'cost-page-chains', 'expTypeChain.js')).includes('lineBody.updateLines'));

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('who may open what (usageAccess, the menu\'s rule)');
  {
    const ALL = { EQR_TIMESHEETS: 'FULL', EQR_TIMESHEET_APPROVALS: 'READ_ONLY', EQR_POST_COST: 'FULL', EQR_EQUIPMENT_MASTER: 'FULL' };
    const vars = (flags, map) => ({ flagsLoaded: true, pageAccessLoaded: true, featureFlags: flags, pageAccessMap: map || ALL, buRateSources: {} });
    const on = { PROJECTS_MODULE_ENABLED: 'true', TIMESHEETS_ENABLED: 'true' };
    T.eq('open, and read-only where the role is', ['timesheets', 'approve-time', 'costs', 'direct-costs'].map((n) => { const a = usageAccess.answer(vars(on), n); return n + ':' + a.open + '/' + a.readOnly; }).join(' '),
      'timesheets:true/false approve-time:true/true costs:true/false direct-costs:true/false');
    T.eq('Post costs is withdrawn under PPM rates, in usageGuard\'s words', usageAccess.answer(vars(Object.assign({ PPM_RATES_ENABLED: 'true' }, on)), 'costs').reason,
      'Rates come from Fusion PPM, so cost is calculated and posted there. Turn off Fusion PPM Rates in Configurations to use EquipRite costing.');
    T.eq('...while the others stay, knowing PPM is on', [usageAccess.answer(vars(Object.assign({ PPM_RATES_ENABLED: 'true' }, on)), 'approve-time').open,
      usageAccess.answer(vars(Object.assign({ PPM_RATES_ENABLED: 'true' }, on)), 'approve-time').ppmOn].join(), 'true,true');
    T.eq('timesheets need their flag', usageAccess.answer(vars({ PROJECTS_MODULE_ENABLED: 'true' }), 'timesheets').reason, 'Timesheets are not enabled.');
    T.eq('the module needs its flag', usageAccess.answer(vars({}), 'direct-costs').reason, 'Equipment for Projects is not enabled.');
    T.eq('a role without the page code', usageAccess.answer(vars(on, {}), 'timesheets').reason, 'Your role cannot open this screen.');
    T.eq('closed until the settings load', usageAccess.answer({ flagsLoaded: false }, 'timesheets').open, false);
    const ctx = { $application: { variables: vars(on) } };
    T.eq('settle answers at once once loaded', (await usageAccess.settle(ctx, 'timesheets')).open, true);
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('the menu and the pages');
  const usage = nav.GROUPS.filter((g) => g.key === 'usage')[0];
  T.eq('the four screens are built, on the usage flow', usage.items.map((i) => i.id + (i.built ? '' : '(not built)') + '=' + i.route.flow + '/' + i.route.page).join(' '),
    'timesheets=usage/timesheets approve-time=usage/approve-time costs=usage/costs direct-costs=usage/direct-costs');
  T.eq('a request\'s costs is a record kind, under Post costs', JSON.stringify([nav.RECORDS.cost.flow, nav.RECORDS.cost.page, nav.RECORDS.cost.navId, nav.RECORDS.cost.title({ number: 'REQ-1' })]),
    '["usage","cost","costs","REQ-1 costs"]');
  T.eq('New\'s screens for the links', ['timesheets', 'approve-time', 'costs', 'direct-costs'].map((n) => nav.newUrl('https://x/eq', n).replace('https://x/eq/vp/shell/', '')).join(' '),
    'usage/time-entry usage/timesheet-approval usage/post-costs usage/project-costs');
  const flow = JSON.parse(read(path.join(NEXT, 'flows', 'usage', 'usage-flow.json')));
  T.eq('the flow is embeddable and holds the five pages', flow.navigation.embeddable + ' ' + Object.keys(flow.pages).join(','), 'enabled timesheets,approve-time,costs,cost,direct-costs');
  const css = read(path.join(NEXT, 'resources', 'css', 'next.css')) + read(path.join(NEXT, 'resources', 'css', 'next-usage.css'));
  const app = JSON.parse(read(path.join(NEXT, 'app-flow.json')));
  T.check('the stylesheet is imported', app.imports.css.indexOf('resources/css/next-usage.css') >= 0);
  Object.keys(flow.pages).forEach((pg) => {
    const base = path.join(NEXT, 'flows', 'usage', flow.pages[pg].path);
    const json = JSON.parse(read(base + '.json'));
    const html = read(base + '.html');
    const chains = [];
    Object.values(json.eventListeners || {}).forEach((l) => (l.chains || []).forEach((c) => chains.push(c.chain)));
    const missing = chains.filter((c) => !fs.existsSync(path.join(base + '-chains', c + '.js')));
    const misnamed = fs.readdirSync(base + '-chains').filter((f) => !new RegExp('class ' + f.replace('.js', '') + ' extends ActionChain').test(read(path.join(base + '-chains', f))));
    T.check(pg + ': embeddable, every chain present and named like its file', json.navigation.embeddable === 'enabled' && !missing.length && !misnamed.length, missing.concat(misnamed).join());
    T.check(pg + ': every listener the page uses exists', (html.match(/\$listeners\.(\w+)/g) || []).every((l) => json.eventListeners[l.split('.')[1]]));
    const bindings = (html.match(/\[\[[\s\S]*?\]\]/g) || []).join('\n');
    T.check(pg + ': bindings: no arrow functions, no String()/Number()/Boolean()', !/=>/.test(bindings) && !/(^|[^.\w])(String|Number|Boolean)\(/.test(bindings));
    T.check(pg + ': no for-each inside a table or a select', !/<(table|tbody|select)[^>]*>(?:(?!<\/\1>)[\s\S])*oj-bind-for-each/.test(html));
    // The page's own root class (nx-ts, nx-ta, nx-pc, nx-pr, nx-dc, and the shared nx-record) only scopes it.
    const used = new Set((html.match(/nx-[a-z0-9-]+/g) || []).filter((c) => !/-$/.test(c) && !/^nx-(ts|ta|pc|pr|dc|record)$/.test(c)));
    const unstyled = [...used].filter((c) => !new RegExp('\\.' + c.replace(/[-]/g, '\\-') + '(?![\\w-])').test(css));
    T.eq(pg + ': every nx- class it uses is styled', unstyled.join(','), '');
  });

  T.report();
})().catch((e) => { console.error(e); process.exitCode = 1; });
