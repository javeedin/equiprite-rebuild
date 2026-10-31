/*
 * EquipRite Next, posting a request's costs to Fusion PPM (webApps/equiprite-next/flows/usage/pages/cost-page*,
 * resources/js/costPosting.js), beside New EquipRite's Post costs (webApps/equiprite/flows/usage/pages/post-costs-page*).
 *
 * Loads the REAL modules, page modules and chains of both apps (AMD, in a sandbox) and runs New's chains and Next's
 * side by side, each against its own copy of one stateful fake backend (the ledger marks a week POSTED once it is
 * recorded, a charge is added, a split is saved …), and checks they make the same calls: endpoints, parameters, bodies,
 * audit headers, in the same order, from opening the request to reading it again after the post, for:
 *   post everything ready, a selection, a split, excluded days, an added charge, the expenditure type, a charge
 *   removed, a split removed, a re-tier, a Fusion failure, the v1 fallback, a partial failure, nothing recorded, a
 *   second post (blocked), a double click, a role that may only look
 * and Next's own layer: what is ticked, the confirmation's words, the calls as shown before sending, each line's
 * result in words, the cards after the post, the list told.
 *
 * Run:  node tests/next-posting.test.js
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
const clone = (o) => JSON.parse(JSON.stringify(o));

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
const weeks = loadAmd(path.join(NJS, 'usageWeeks.js'), {});
const prPassThrough = loadAmd(path.join(NJS, 'prPassThrough.js'), {});
const lineBody = loadAmd(path.join(NJS, 'requestLineBody.js'), {});
const projectTaskTree = loadAmd(path.join(NJS, 'projectTaskTree.js'), {});
const exportKit = loadAmd(path.join(NJS, 'exportKit.js'), {});
const usageAccess = loadAmd(path.join(NJS, 'usageAccess.js'), { 'resources/js/rules': rules, 'resources/js/nav': nav });
const CPm = loadAmd(path.join(NJS, 'costPreview.js'), { 'resources/js/prPassThrough': prPassThrough, 'resources/js/usageWeeks': weeks, 'resources/js/fmt': fmt });
const expStub = { resolveRequestIdByNumber: async () => 4440, loadForRequest: async () => [], attachUnits: async (c, l) => l };
/** A fresh costPosting (its one-post-at-a-time guard and its listeners) and costData (its half-minute list cache). */
function nextModules() {
  const fusion = loadAmd(path.join(NJS, 'postCostToFusion.js'), {});
  const costPosting = loadAmd(path.join(NJS, 'costPosting.js'), { 'resources/js/costPreview': CPm, 'resources/js/postCostToFusion': fusion,
    'resources/js/usageWeeks': weeks, 'resources/js/fmt': fmt });
  const costData = loadAmd(path.join(NJS, 'costData.js'), { 'resources/js/costPreview': CPm, 'resources/js/prPassThrough': prPassThrough, 'resources/js/expenditureTypes': expStub });
  return { costPosting, costData };
}
const NX = nextModules();
const CPost = NX.costPosting;

const NEW_W = { prPassThrough: loadAmd(path.join(WJS, 'prPassThrough.js'), {}), requestLineBody: loadAmd(path.join(WJS, 'requestLineBody.js'), {}),
  postCostToFusion: loadAmd(path.join(WJS, 'postCostToFusion.js'), {}), projectTaskTree: loadAmd(path.join(WJS, 'projectTaskTree.js'), {}) };
const NewPC = loadAmd(path.join(WPAGES, 'post-costs-page.js'), { 'resources/js/prPassThrough': NEW_W.prPassThrough });
const pageDeps = (cp) => ({ 'resources/js/costPreview': CPm, 'resources/js/costPosting': cp, 'resources/js/exportKit': exportKit, 'resources/js/nav': nav,
  'resources/js/fmt': fmt, 'resources/js/usageWeeks': weeks });
const NextPR = loadAmd(path.join(NPAGES, 'cost-page.js'), pageDeps(CPost));
const NextPC = loadAmd(path.join(NPAGES, 'costs-page.js'), pageDeps(CPost));
const cu = { auditHeaders: () => ({ 'X-User-Id': 'pat.lee' }), auditActor: () => 'pat.lee' };

// ── dates: this week, as the screens see it (the cost rules read the real clock) ────────────────────────────────
const iso = (d) => d.toISOString().slice(0, 10);
const now = new Date();
const TODAY = iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())));
const addDays = (s, n) => iso(new Date(Date.parse(s + 'T00:00:00Z') + n * 86400000));
const dow = new Date(TODAY + 'T00:00:00Z').getUTCDay();
const WEEK = addDays(TODAY, dow === 0 ? -6 : 1 - dow);
const W = (n) => addDays(WEEK, 7 * n);
const compact = (s) => s.replace(/-/g, '');

// ── the request: a generator (one week posted, two ended, one running, one future) and a light tower, a charge ──
const REQ = 'REQ-10440';
const listRow = (o) => Object.assign({ eqrEquipmentRequestId: 4440, requestNumber: REQ, projectName: 'Plant Expansion B', taskName: 'Electrical',
  requestedStartDate: W(-3), requestedEndDate: W(9), timesheets: 1, totalHours: 40, ppmProjectNumber: 'PRJ-B', ppmTaskNumber: '4.2', ppmProjectRefId: 3001,
  ppmTaskRefId: 4001, rateScheduleId: 77 }, o);
const LIST = [listRow({ weekStartDate: W(-3), totalBillCost: 1400 }), listRow({ weekStartDate: W(-2), totalBillCost: 1400 }), listRow({ weekStartDate: W(-1), totalBillCost: 2100 }),
  listRow({ weekStartDate: W(0), totalBillCost: 1400 })];
const pcRow = (o) => Object.assign({ requestNumber: REQ, lineType: 'RENTABLE', qty: 1, applicableRate: 200, ratePeriod: 'DAILY', totalHours: 40, postStatus: 'APPROVED' }, o);
const gen = (week, o) => pcRow(Object.assign({ rowKey: '701:0:' + compact(week), requestLineId: 701, equipmentName: 'Generator 100 kVA', weekStartDate: week,
  weekEndDate: addDays(week, 6), costAmount: 1400, lineExpenditureType: 'Equipment Rental' }, o));
const SEED = {
  det: [gen(W(-3), { postStatus: 'POSTED' }), gen(W(-2)), gen(W(-1)), gen(W(0)), gen(W(10)),
    pcRow({ rowKey: '702:0:' + compact(W(-1)), requestLineId: 702, equipmentName: 'Light Tower LT-4', weekStartDate: W(-1), weekEndDate: addDays(W(-1), 6), costAmount: 700, applicableRate: 100 })],
  misc: [{ eqrLineMiscTxnId: 55, requestNumber: REQ, requestLineId: 701, expenditureType: 'Fuel', expenditureOrg: 'Applications and Services',
    expenditureItemDate: W(-3), quantity: 1, rawCost: 90, status: 'DRAFT', comments: 'Fuel top-up on return' }],
  splits: [
    { requestLineId: 701, weekStartDate: W(-1), projectRefId: 3001, projectNumber: 'PRJ-B', projectName: 'Plant Expansion B', taskId: 4001, taskNumber: '4.2', taskName: 'Electrical', splitPct: 60 },
    { requestLineId: 701, weekStartDate: W(-1), projectRefId: 3002, projectNumber: 'PRJ-C', projectName: 'Pipeline North', taskId: 5001, taskNumber: '2.1', taskName: 'Trenching', splitPct: 40 }],
  retier: [{ requestLineId: 701, weekStartDate: W(-3), rowKey: '701:0:' + compact(W(-3)), retierPeriod: 'WEEKLY', retierRate: 150, retierCost: 1050 }],
};
const PROJECTS = { items: [{ ProjectId: 3002, ProjectNumber: 'PRJ-C', ProjectName: 'Pipeline North' }] };
const TASKS = { items: [{ TaskId: 5000, TaskNumber: '2', TaskName: 'Pipeline', ParentTaskId: null }, { TaskId: 5001, TaskNumber: '2.1', TaskName: 'Trenching', ParentTaskId: 5000 }] };

/** A fake EquipRite and Fusion with state: what is recorded shows on the next read, as the views would show it. */
function backend(seed, override) {
  const st = { det: clone(seed.det), misc: clone(seed.misc), splits: clone(seed.splits), retier: clone(seed.retier || []), exceptions: [], nextMisc: 900 };
  let n = 0;
  function answer(o) {
    n++;
    const forced = override && override(o, n, st);
    if (forced) return forced;
    const e = o.endpoint;
    const b = o.body || {};
    const u = o.uriParams || {};
    const ok = (body, status) => ({ ok: true, status: status || 200, body: body || {} });
    if (e === 'eqp-v1/getEquipriteV1ViewsPostCost') return ok({ data: clone(LIST) });
    if (e === 'eqp-v1/getEquipriteV1ViewsPostCostDetails') return ok({ data: clone(st.det) });
    if (e === 'eqp-v1/getEquipriteV1ViewsLineRetierWeeks') return ok({ data: clone(st.retier) });
    if (e === 'eqp-v1/getBlackoutWeeks') return ok({ data: [] });
    if (e === 'eqp-v1/getMiscTransactions') return ok({ data: clone(u.requestNumber ? st.misc.filter((m) => m.requestNumber === u.requestNumber) : st.misc) });
    if (e === 'eqp-v1/getLineProjectSplits') return ok({ data: clone(st.splits) });
    if (e === 'eqp-v1/getPurchaseRequisitions') return ok({ data: [] });
    if (e === 'eqp-v1/createPostedWeek' || e === 'eqp-v1/createPostedWeekSplit') {
      const row = st.det.find((r) => r.rowKey === b.rowKey);
      if (row) row.postStatus = 'POSTED';
      return ok({ id: 100 + n }, 201);
    }
    if (e === 'eqp-v1/postMiscTransactions') {
      st.misc.forEach((m) => { if ((b.ids || []).indexOf(m.eqrLineMiscTxnId) >= 0) m.status = 'POSTED'; });
      return ok({ updated: (b.ids || []).length });
    }
    if (e === 'eqp-v1/createMiscTransaction') {
      const id = st.nextMisc++;
      st.misc.push(Object.assign({ eqrLineMiscTxnId: id, requestNumber: REQ }, clone(b), { expenditureItemDate: String(b.expenditureItemDate).slice(0, 10) }));
      return ok({ eqrLineMiscTxnId: id }, 201);
    }
    if (e === 'eqp-v1/deleteMiscTransactionById') { st.misc = st.misc.filter((m) => m.eqrLineMiscTxnId !== u.id); return ok({}); }
    if (e === 'eqp-v1/replaceLineProjectSplits') {
      const wk = String(b.weekStartDate).slice(0, 10);
      st.splits = st.splits.filter((s) => !(s.requestLineId === u.id && s.weekStartDate === wk))
        .concat((b.splits || []).map((s) => Object.assign({ requestLineId: u.id, weekStartDate: wk }, s)));
      return ok({});
    }
    if (e === 'eqp-v1/clearLineProjectSplits') { st.splits = st.splits.filter((s) => !(s.requestLineId === u.id && s.weekStartDate === u.weekStartDate)); return ok({}); }
    if (e === 'eqp-v1/createLineDayException') { st.exceptions.push(clone(b)); return ok({ id: 1 }, 201); }
    if (e === 'eqp-v1/reverseRequestLine') { return ok({ reversedCount: (b.weekStartDates || []).length }); }
    if (e === 'eqp-v1/patchRequestLinesBatch') return ok({ data: [] });
    if (e === 'ics/postCostToFusionProject' || e === 'ics/postCostToFusion') return ok({ status: 'OK' });
    if (e === 'ProjectLOV/getFscmRestApiResources11_13_18_05ProjectsLOV') return ok(clone(PROJECTS));
    if (e === 'ProjectLOV/getFscmRestApiResources11_13_18_05ProjectTasks') return ok(clone(TASKS));
    return ok({ data: [] });
  }
  return { answer, st };
}

const NEW_VARS = () => ({ request: REQ, list: [], listText: '', listLoading: true, listError: '', current: null, rowsAll: [], facts: {}, previewLoading: false, previewError: '',
  expTypeList: [], panel: '', misc: {}, isSavingMisc: false, exp: {}, isSavingExp: false, split: {}, isSavingSplit: false, isPosting: false, postError: '', postSuccess: '',
  readOnly: false, reverseAsk: '' });
const NEXT_VARS = () => ({ id: '', number: REQ, closed: '', row: {}, rowsAll: [], facts: {}, plan: [], table: [], isLoading: true, error: '', exportOpen: false, readOnly: true,
  unticked: [], expTypeList: [], panel: '', post: {}, result: {}, isPosting: false, postError: '', postNote: '', misc: {}, isSavingMisc: false, exp: {}, isSavingExp: false,
  split: {}, isSavingSplit: false, reverseAsk: '' });

/**
 * One app's side: its chains, its page variables and functions, its fake backend. callChain runs the named chain of the
 * same page (New's loadPreviewChain and listChain, Next's loadRecordChain), as VB does.
 */
function makeSide(kind, o) {
  const opts = o || {};
  const be = backend(opts.seed || SEED, opts.override);
  const calls = [];
  const toasts = [];
  const guards = [];
  const mods = kind === 'next' ? nextModules() : null;
  const bus = { toast: (m, t) => toasts.push(t + ': ' + m), open: () => {}, rename: () => {}, guard: (id, m) => guards.push(id + '=' + (m ? 'on' : 'off')) };
  const Actions = {
    async callRest(context, x) {
      calls.push({ endpoint: x.endpoint, uriParams: x.uriParams || null, body: x.body === undefined ? null : x.body, headers: x.headers || null });
      return be.answer(x);
    },
    async fireNotificationEvent(context, n) { toasts.push(n.type + ': ' + n.summary + ': ' + n.message); },
    async callChain(context, c) { calls.push({ chain: c.chain }); const C = chain(c.chain); await new C().run(context, c.params || {}); },
    async navigateToPage() {}, async navigateToFlow() {},
  };
  const deps = {
    'vb/action/actionChain': class {}, 'vb/action/actions': Actions, 'resources/js/currentUser': cu, 'resources/js/expenditureTypes': expStub,
    'resources/js/usageGuard': { allow: async () => true }, 'resources/js/shellBus': bus, 'resources/js/exportKit': exportKit, 'resources/js/usageAccess': usageAccess,
  };
  if (kind === 'new') {
    Object.assign(deps, { 'resources/js/requestLineBody': NEW_W.requestLineBody, 'resources/js/postCostToFusion': NEW_W.postCostToFusion,
      'resources/js/prPassThrough': NEW_W.prPassThrough, 'resources/js/projectTaskTree': NEW_W.projectTaskTree });
  } else {
    Object.assign(deps, { 'resources/js/requestLineBody': lineBody, 'resources/js/prPassThrough': prPassThrough, 'resources/js/projectTaskTree': projectTaskTree,
      'resources/js/costPosting': mods.costPosting, 'resources/js/costData': mods.costData });
  }
  const cache = {};
  function chain(name) {
    if (!cache[name]) cache[name] = loadAmd(path.join(kind === 'new' ? WPAGES : NPAGES, (kind === 'new' ? 'post-costs' : 'cost') + '-page-chains', name + '.js'), deps);
    return cache[name];
  }
  const access = opts.access || 'FULL';
  const map = { EQR_POST_COST: access };
  const ctx = {
    $page: { variables: kind === 'new' ? Object.assign(NEW_VARS(), { readOnly: access === 'READ_ONLY' }) : NEXT_VARS(),
      functions: kind === 'new' ? new NewPC() : new (loadAmd(path.join(NPAGES, 'cost-page.js'), pageDeps(mods.costPosting)))() },
    $application: {
      variables: { flagsLoaded: true, pageAccessLoaded: true, featureFlags: { PROJECTS_MODULE_ENABLED: 'true' }, pageAccessMap: map, buRateSources: {} },
      functions: { isFeatureEnabled: (fl, l, k) => !!l && !!fl && fl[k] === 'true', isPageReadOnly: (m, l, code) => !!l && !!m && m[code] === 'READ_ONLY' },
    },
  };
  const v = ctx.$page.variables;
  const run = (name, params) => new (chain(name))().run(ctx, params || {});
  const side = {
    kind, be, calls, toasts, guards, ctx, v, run, mods,
    rest: () => calls.filter((c) => c.endpoint),
    log: () => JSON.stringify(calls.filter((c) => c.endpoint)),
    writes: () => calls.filter((c) => c.endpoint && !/^(eqp-v1\/get|ProjectLOV\/get)/.test(c.endpoint)),
    mark: () => calls.length,
    since: (n) => calls.slice(n).filter((c) => c.endpoint),
    /** Opens the request: New's Post costs on ?request= (list, then the preview); Next's tab (list, then the preview). */
    async open() { if (kind === 'new') await run('postCostsInitChain'); else await run('loadRecordChain', { refresh: false }); },
    /** Ticks: New starts with nothing ticked; Next with everything ready. Both end with exactly `keys` ticked. */
    async tickOnly(keys) {
      if (kind === 'next') await run('treeChain', { action: 'none' });
      for (const k of keys) {
        const r = v.rowsAll.find((x) => x.rowKey === k);
        if (!r) throw new Error('no row ' + k);
        await run('treeChain', { action: r.kind === 'misc' ? 'misc' : 'week', key: k, checked: true });
      }
    },
    /** Ticks everything ready: New's Select all past weeks and each charge; Next has it ticked already. */
    async tickAll() {
      if (kind === 'next') { await run('treeChain', { action: 'all' }); return; }
      await run('treeChain', { action: 'selectAllPast' });
      for (const m of v.rowsAll.filter((r) => r.kind === 'misc' && r.status !== 'POSTED' && !r.selected)) await run('treeChain', { action: 'misc', key: m.rowKey });
    },
    /** Post: New's Review then Post to Fusion PPM; Next's Post (the confirmation) then Post. */
    async post() {
      if (kind === 'new') { await run('postSelectedChain'); await run('postSelectedChain'); return; }
      await run('panelChain', { panel: 'post' });
      await run('postChain', { step: 'go' });
    },
  };
  return side;
}

async function twin(o) {
  const out = { new: makeSide('new', o), next: makeSide('next', o) };
  for (const k of ['new', 'next']) {
    await out[k].open();
    if (o.act) await o.act(out[k]);
  }
  return out;
}

const ticked = (side) => side.v.rowsAll.filter((r) => (r.kind === 'week' || r.kind === 'misc') && r.selected).map((r) => r.rowKey).join(',');
const short = (c) => c.endpoint.replace('eqp-v1/', '') + (c.uriParams && c.endpoint.indexOf('get') < 0 ? ' ' + JSON.stringify(c.uriParams) : '');
const seq = (calls) => calls.filter((c) => !/^eqp-v1\/get|^ProjectLOV\/get/.test(c.endpoint)).map(short).join(' > ');
const kW = (n) => '701:0:' + compact(W(n));
const kLT = '702:0:' + compact(W(-1));

(async () => {
  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('New\'s rules and helper, carried');
  T.check('the Fusion send is New\'s postCostToFusion.js, copied unchanged', read(path.join(NJS, 'postCostToFusion.js')) === read(path.join(WJS, 'postCostToFusion.js')));
  T.check('it is Next\'s alone (the phone app does not post)', !fs.existsSync(path.join(ROOT, 'webApps', 'equiprite-mobile', 'resources', 'js', 'costPosting.js'))
    && !fs.existsSync(path.join(ROOT, 'webApps', 'equiprite-mobile', 'resources', 'js', 'postCostToFusion.js')));
  {
    const theirs = read(path.join(WPAGES, 'post-costs-page-chains', 'postSelectedChain.js'));
    const ours = read(path.join(NJS, 'costPosting.js'));
    const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    T.check('Next\'s post makes New\'s calls (the same endpoints, the same ledger body, the same charge ids, the same Fusion helper)',
      ["body.splits ? 'eqp-v1/createPostedWeekSplit' : 'eqp-v1/createPostedWeek'", "'eqp-v1/postMiscTransactions'", 'ledgerBody(r, cur.rateScheduleId)',
        "postCostToFusion.post(context, Actions, cur.requestNumber || '')"].every((s) => code(theirs).replace(/fns\./g, 'rules.').includes(s.replace('fns.', 'rules.'))
        && code(ours).includes(s)));
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('Post everything ready: New\'s calls, in New\'s order');
  let all;
  {
    const t = await twin({ act: async (s) => { await s.tickAll(); await s.post(); } });
    all = t;
    T.eq('the same set is ticked', ticked(t.next), ticked(t.new));
    T.eq('the same calls, parameters, bodies and order, from opening the request to reading it again', t.next.log(), t.new.log());
    T.eq('the writes: each week, the split week, the charges, then Fusion PPM', seq(t.next.rest()),
      'createPostedWeek > createPostedWeekSplit > createPostedWeek > postMiscTransactions > ics/postCostToFusionProject');
    const w = t.next.writes();
    T.eq('the week body is New\'s ledger body', JSON.stringify(w[0].body), JSON.stringify({ requestLineId: 701, weekStartDate: W(-2) + 'T00:00:00Z', rowKey: kW(-2),
      status: 'POSTED', entryKind: 'ORIGINAL', postedSource: 'CP', postedCostAmount: 1400, costRate: 200, periodType: 'DAILY', billableDuration: 7, rateScheduleId: 77,
      expenditureType: 'Equipment Rental', reversalRef: 'EQR-701-' + compact(W(-2)), ppmBatchName: null }));
    T.check('the split week sends percentages, no dollars, no reversal ref', w[1].body.reversalRef === null && JSON.stringify(w[1].body.splits.map((s) => s.splitPct)) === '[60,40]');
    T.eq('the charge ids; Fusion is sent the request number only', JSON.stringify([w[3].body, w[4].body]), '[{"ids":[55]},{"requestNumber":"REQ-10440"}]');
    T.eq('...then both read the preview, then the list', t.next.since(t.next.calls.findIndex((c) => c.endpoint === 'ics/postCostToFusionProject') + 1).map((c) => c.endpoint.replace('eqp-v1/', '')).join(','),
      'getEquipriteV1ViewsPostCostDetails,getEquipriteV1ViewsLineRetierWeeks,getBlackoutWeeks,getMiscTransactions,getLineProjectSplits,getPurchaseRequisitions,getEquipriteV1ViewsPostCost,getMiscTransactions');
    const v = t.next.v;
    T.eq('each line\'s result', v.result.lines.map((l) => l.state + ' ' + l.amount).join(' | ') + ' | charges ' + v.result.charges.state + ' | fusion ' + v.result.fusion.state,
      'posted 1400 | posted 1400 | posted 700 | charges posted | fusion posted');
    T.eq('...in words', v.result.summary, 'Posted 3 weeks ($3,500) and 1 charge ($90) of REQ-10440 to Fusion PPM.');
    T.eq('the cards follow the read: ready, posted', [v.facts.ready, v.facts.readyWeeks, v.facts.posted].join(' | '), '0 | 0 | 4990');
    T.eq('New\'s figures after its read are the same', t.new.v.facts.postedCost, 4990);
    T.check('nothing is left ticked or postable', !v.rowsAll.some((r) => CPost.tickable(r)));
    T.eq('the tab asked before closing while it posted, then stopped asking', t.next.guards.join(','), 'cost:REQ-10440=on,cost:REQ-10440=off');
    T.check('the dialog shows the result, the page keeps it', v.post.step === 'done' && v.result.number === REQ && !v.isPosting);
  }

  T.section('A second post is blocked');
  {
    const t = all;
    for (const k of ['new', 'next']) {
      const m = t[k].mark();
      await t[k].tickAll();
      await t[k].post();
      T.eq(k + ': posting again sends nothing (the ledger now says POSTED)', t[k].since(m).filter((c) => !/get/.test(c.endpoint)).length, 0);
    }
    const s = makeSide('next');
    await s.open();
    await s.run('panelChain', { panel: 'post' });
    await Promise.all([s.run('postChain', { step: 'go' }), s.run('postChain', { step: 'go' })]);
    T.eq('a double click posts once', s.rest().filter((c) => c.endpoint === 'eqp-v1/createPostedWeek').length, 2);
    const s2 = makeSide('next');
    await s2.open();
    await s2.run('panelChain', { panel: 'post' });
    s2.mods.costPosting.claim(REQ);
    await s2.run('postChain', { step: 'go' });
    T.eq('one post at a time per request, whatever the screen does', s2.writes().length, 0);
    s2.mods.costPosting.release(REQ);
    const s3 = makeSide('next');
    await s3.open();
    await s3.run('postChain', { step: 'go' });
    T.check('Post outside the confirmation only opens it (New\'s rule)', s3.writes().length === 0 && s3.v.panel === 'post' && s3.v.post.step === 'ask');
    const s4 = makeSide('next', { override: (o) => (o.endpoint === 'eqp-v1/getEquipriteV1ViewsPostCostDetails' && s4.writes().length ? { ok: false, status: 500 } : null) });
    await s4.open();
    await s4.post();
    T.check('if the read after the post fails, what was recorded stays posted on screen', s4.v.error && !s4.v.rowsAll.some((r) => CPost.tickable(r) && r.kind === 'week')
      && s4.v.rowsAll.filter((r) => r.kind === 'week' && r.posted).length === 4);
    const m4 = s4.mark();
    await s4.post();
    T.eq('...so posting again sends no week twice', s4.since(m4).filter((c) => /PostedWeek/.test(c.endpoint)).length, 0);
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('A selection');
  {
    const before = {};
    const t = await twin({ act: async (s) => { await s.tickOnly([kW(-2), 'misc_55']); before[s.kind] = ticked(s); await s.post(); } });
    T.eq('the same ticks', before.next + ' | ' + before.new, kW(-2) + ',misc_55 | ' + kW(-2) + ',misc_55');
    T.eq('the same calls as New', t.next.log(), t.new.log());
    T.eq('...the week and the charge only', seq(t.next.rest()), 'createPostedWeek > postMiscTransactions > ics/postCostToFusionProject');
    T.eq('what was not ticked stays ready, and stays unticked after the read', [t.next.v.facts.readyWeeks, ticked(t.next)].join(' | '), '2 | ');
    const s = makeSide('next');
    await s.open();
    await s.run('treeChain', { action: 'week', key: kLT, checked: false });
    T.eq('unticking one keeps the rest', ticked(s), [kW(-2), kW(-1), 'misc_55'].join(','));
    await s.run('loadRecordChain', { refresh: true });
    T.eq('...and a Refresh keeps it unticked', ticked(s), [kW(-2), kW(-1), 'misc_55'].join(','));
    await s.run('treeChain', { action: 'group', key: 'g0', checked: false });
    T.eq('the equipment\'s box unticks its ready weeks when all are on (New\'s group rule)', ticked(s), 'misc_55');
    await s.run('treeChain', { action: 'group', key: 'g0', checked: true });
    T.eq('...and ticks them all otherwise', ticked(s), [kW(-2), kW(-1), 'misc_55'].join(','));
    await s.run('treeChain', { action: 'week', key: kW(0), checked: true });
    T.eq('a week not ended cannot be ticked', ticked(s), [kW(-2), kW(-1), 'misc_55'].join(','));
    await s.run('treeChain', { action: 'week', key: kW(-3), checked: true });
    T.eq('nor a posted one', ticked(s), [kW(-2), kW(-1), 'misc_55'].join(','));
    await s.run('treeChain', { action: 'none' });
    await s.run('panelChain', { panel: 'post' });
    T.check('with nothing ticked, Post says so and opens nothing', s.v.panel === '' && s.v.postError === 'Tick the weeks or charges to post first.');
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('A split across projects');
  {
    const act = async (s) => {
      await s.run('panelChain', { panel: 'split', key: kW(-2) });
      await s.run('splitChain', { action: 'slicePct', index: '0', value: '70' });
      await s.run('splitChain', { action: 'search', value: 'Pipe' });
      await s.run('splitChain', { action: 'project', index: '0' });
      await s.run('splitChain', { action: 'task', index: '0' });
      await s.run('splitChain', { action: 'pickPct', value: '30' });
      await s.run('splitChain', { action: 'add' });
      await s.run('saveSplitChain');
      await s.tickOnly([kW(-2)]);
      await s.post();
    };
    const t = await twin({ act });
    T.eq('the same calls as New: the project search, its tasks, the split, then the post', t.next.log(), t.new.log());
    T.eq('...in order', t.next.rest().filter((c) => !/^eqp-v1\/get/.test(c.endpoint)).map((c) => c.endpoint.replace(/^ProjectLOV\/getFscmRestApiResources11_13_18_05/, 'Fusion ').replace('eqp-v1/', '')).join(' > '),
      'Fusion ProjectsLOV > Fusion ProjectTasks > replaceLineProjectSplits > createPostedWeekSplit > ics/postCostToFusionProject');
    const put = t.next.writes()[0];
    T.eq('the split: percentages for the week, project and task each', JSON.stringify([put.uriParams, put.body.weekStartDate, put.body.splits.map((x) => x.projectNumber + '/' + x.taskNumber + ' ' + x.splitPct)]),
      JSON.stringify([{ id: 701 }, W(-2) + 'T00:00:00Z', ['PRJ-B/4.2 70', 'PRJ-C/2.1 30']]));
    T.eq('...and the week posts split', JSON.stringify(t.next.writes()[1].body.splits.map((x) => x.projectRefId + ':' + x.taskId + ':' + x.splitPct)), '["3001:4001:70","3002:5001:30"]');
    const s = makeSide('next');
    await s.open();
    await s.run('panelChain', { panel: 'split', key: kW(-2) });
    await s.run('splitChain', { action: 'search', value: 'Pipe' });
    await s.run('splitChain', { action: 'project', index: '0' });
    await s.run('splitChain', { action: 'add' });
    T.eq('a slice needs a task first (New\'s words)', s.v.split.error, 'Pick a task. PPM can only take cost on a lowest-level task, so a project on its own cannot be posted to.');
    await s.run('saveSplitChain');
    T.check('a split short of two projects is refused before any call', !s.writes().length && /at least 2 projects/.test(s.v.split.error));
  }
  {
    const t = await twin({ act: async (s) => {
      await s.run('panelChain', { panel: 'split', key: kW(-1) });
      await s.run('clearSplitChain');
      await s.tickOnly([kW(-1)]);
      await s.post();
    } });
    T.eq('removing a split: New\'s DELETE scoped to the week, then the week posts whole', t.next.log(), t.new.log());
    T.eq('...in order', seq(t.next.rest()), 'clearLineProjectSplits {"id":701,"weekStartDate":"' + W(-1) + '"} > createPostedWeek > ics/postCostToFusionProject');
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('Excluded days');
  {
    const day = kW(-2) + '_d2';
    const t = await twin({ act: async (s) => {
      await s.run('blackoutChain', { key: day });
      await s.tickOnly([kW(-2)]);
      await s.post();
    } });
    T.eq('the same calls as New', t.next.log(), t.new.log());
    T.eq('the day: New\'s upsert', JSON.stringify(t.next.writes()[0].body), JSON.stringify({ requestLineId: 701, exceptionDate: addDays(W(-2), 2), rateType: 'BLACKOUT', reason: 'Excluded from post cost' }));
    T.eq('...and the week posts without it, as New posts it', [t.next.writes()[1].body.postedCostAmount, t.next.writes()[1].body.billableDuration].join(), '1200,6');
    const s = makeSide('next');
    await s.open();
    await s.run('blackoutChain', { key: day });
    T.eq('the cards follow at once: ready less the day, cost to date less the day', [s.v.facts.ready, s.v.facts.total].join(), '3390,6190');
    T.eq('...and what will be posted', s.v.plan.find((p) => p.key === kW(-2)).amount, 1200);
    await s.run('blackoutChain', { key: day });
    T.eq('billing it again writes USAGE', s.writes().map((c) => c.body.rateType).join(), 'BLACKOUT,USAGE');
    const m = s.mark();
    await s.run('blackoutChain', { key: kW(-3) + '_d1' });
    T.eq('a posted week\'s day is frozen: no call', s.since(m).length, 0);
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('An added charge');
  {
    const add = async (s) => {
      await s.run('panelChain', { panel: 'misc', key: 'g0' });
      await s.run('miscChain', { action: 'field', field: 'rawCost', value: '250' });
      await s.run('miscChain', { action: 'field', field: 'comments', value: 'Delivery by crane' });
      await s.run('miscChain', { action: 'save' });
    };
    const t = await twin({ act: async (s) => {
      await add(s);
      if (s.kind === 'new') await s.tickAll();
      await s.post();
    } });
    T.eq('the same calls as New: the charge, the preview read again, the post', t.next.log(), t.new.log());
    T.eq('the charge: New\'s createMiscTransaction body', JSON.stringify(t.next.writes()[0].body), JSON.stringify({ requestLineId: 701, expenditureType: 'Equipment',
      expenditureOrg: 'Applications and Services', expenditureItemDate: W(-1) + 'T00:00:00Z', quantity: 1, rawCost: 250, currencyCode: 'USD', comments: 'Delivery by crane', status: 'DRAFT' }));
    T.eq('...it is posted with the weeks, in one id list', JSON.stringify(t.next.writes().find((c) => c.endpoint === 'eqp-v1/postMiscTransactions').body), '{"ids":[55,900]}');
    const s = makeSide('next');
    await s.open();
    await s.run('panelChain', { panel: 'misc', key: 'g0' });
    await s.run('miscChain', { action: 'save' });
    T.check('a charge with no amount is refused before any call (New\'s words)', !s.writes().length && s.v.misc.error === 'Enter an amount greater than zero.');
    await s.run('panelChain', { panel: '' });
    await add(s);
    T.check('a new charge comes back from the read, ticked to post', s.v.rowsAll.some((r) => r.kind === 'misc' && r.miscId === 900 && r.selected));
  }
  {
    const t = await twin({ act: async (s) => { await s.run('miscChain', { action: 'delete', key: 'misc_55' }); } });
    T.eq('removing a draft charge: New\'s DELETE by id, then the preview', t.next.log(), t.new.log());
    T.eq('...by id', seq(t.next.rest()), 'deleteMiscTransactionById {"id":55}');
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('The expenditure type');
  {
    const t = await twin({ act: async (s) => {
      await s.run('panelChain', { panel: 'exptype', key: 'g0' });
      await s.run('expTypeChain', { action: 'pick', value: 'Equipment Hire' });
      await s.run('expTypeChain', { action: 'save' });
      await s.tickOnly([kW(-2)]);
      await s.post();
    } });
    T.eq('the same calls as New, with the audit header', t.next.log(), t.new.log());
    const b = t.next.writes()[0];
    T.eq('one batch for the equipment\'s line, with who did it', JSON.stringify([b.endpoint, b.uriParams, b.body, b.headers]),
      '["eqp-v1/patchRequestLinesBatch",{"requestId":4440},{"lines":[{"id":701,"expenditureType":"Equipment Hire"}]},{"X-User-Id":"pat.lee"}]');
    T.eq('...and the week posts under it', t.next.writes()[1].body.expenditureType, 'Equipment Hire');
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('Re-tier');
  {
    const t = await twin({ act: async (s) => {
      await s.run('reverseLineChain', { groupKey: 'g0' });
      await s.run('reverseLineChain', { confirm: 'go' });
    } });
    T.eq('New\'s reversal, after it asks, then the preview', t.next.log(), t.new.log());
    T.eq('...the changed posted weeks of the line', seq(t.next.rest()) + ' ' + JSON.stringify(t.next.writes()[0].body), 'reverseRequestLine {"id":701} {"weekStartDates":["' + W(-3) + '"]}');
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('When Fusion or EquipRite says no');
  {
    const fusionDown = (o) => (o.endpoint === 'ics/postCostToFusionProject' ? { ok: false, status: 500, body: { title: 'Internal Server Error', detail: 'PPM import failed: task 4.2 is closed for charges' } } : null);
    const t = await twin({ override: fusionDown, act: async (s) => { await s.tickAll(); await s.post(); } });
    T.eq('a Fusion failure: the same calls as New (no retry; the next post sends it)', t.next.log(), t.new.log());
    const v = t.next.v;
    T.eq('...each line is recorded, not yet sent', v.result.lines.map((l) => l.state).join(), 'recorded,recorded,recorded');
    T.eq('...Fusion\'s error in words', v.result.fusion.words, 'Fusion PPM did not take it: PPM import failed: task 4.2 is closed for charges (HTTP 500). What was recorded stays recorded and goes with the next post.');
    T.eq('...and the outcome', [v.result.tone, v.result.summary].join(' | '),
      'warn | Recorded 3 weeks ($3,500) and 1 charge ($90) of REQ-10440 in EquipRite, but the send to Fusion PPM failed. It goes again with the next post.');
    T.check('New says the same: recorded, not sent', /recorded in EquipRite, but the send to Fusion failed/.test(t.new.v.postSuccess));
  }
  {
    const v1 = (o) => (o.endpoint === 'ics/postCostToFusionProject' ? { ok: false, status: 404, body: {} } : null);
    const t = await twin({ override: v1, act: async (s) => { await s.tickOnly([kW(-2)]); await s.post(); } });
    T.eq('an integration server without the project URL: New\'s v1 fallback', t.next.log(), t.new.log());
    T.eq('...in order', seq(t.next.rest()), 'createPostedWeek > ics/postCostToFusionProject > ics/postCostToFusion');
    T.eq('...and it is posted', t.next.v.result.fusion.state, 'posted');
  }
  {
    const one = (o) => (o.endpoint === 'eqp-v1/createPostedWeek' && o.body.rowKey === kW(-2) ? { ok: false, status: 409, body: { message: 'Week already in the posting ledger' } } : null);
    const t = await twin({ override: one, act: async (s) => { await s.tickAll(); await s.post(); } });
    T.eq('a partial failure: the same calls as New', t.next.log(), t.new.log());
    const v = t.next.v;
    T.eq('...the line that failed says why; the others are posted', v.result.lines.map((l) => l.state).join(), 'failed,posted,posted');
    T.eq('...in words', v.result.lines[0].words, 'Not posted: EquipRite could not record it: Week already in the posting ledger (HTTP 409). It stays ready to post.');
    T.eq('...and the outcome', v.result.summary, 'Posted 2 weeks ($2,100) and 1 charge ($90) of REQ-10440 to Fusion PPM. 1 week was not recorded and stays ready to post.');
    T.eq('...which stays ready and ticked after the read', ticked(t.next), kW(-2));
    T.check('New counts it the same', /\(1 week\(s\) failed and stay ready to post\)/.test(t.new.v.postSuccess));
  }
  {
    const none = (o) => (/createPostedWeek|postMiscTransactions/.test(o.endpoint) ? { ok: false, status: 500, body: {} } : null);
    const t = await twin({ override: none, act: async (s) => { await s.tickAll(); await s.post(); } });
    T.eq('nothing recorded: the same calls as New, and nothing to Fusion', t.next.log(), t.new.log());
    T.check('...no Fusion call', !t.next.rest().some((c) => /^ics\//.test(c.endpoint)));
    T.eq('...in words', [t.next.v.postError, t.next.v.result.fusion.words].join(' | '),
      'Posting failed for 3 weeks. Nothing was recorded, so nothing was sent to Fusion PPM. | Not sent: nothing was recorded, so nothing went to Fusion PPM.');
    T.eq('...the failed charge in words', t.next.v.result.charges.words, 'Not posted: EquipRite could not mark them posted: the service failed (HTTP 500). They stay ready to post.');
    T.check('...New says nothing was recorded', /Nothing was recorded/.test(t.new.v.postError));
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('A role that may only look');
  {
    const t = await twin({ access: 'READ_ONLY', act: async (s) => {
      if (s.kind === 'new') { await s.tickAll(); await s.post(); return; }
      await s.run('treeChain', { action: 'none' });
      await s.run('panelChain', { panel: 'post' });
      s.v.panel = 'post';
      s.v.post = { step: 'ask' };
      await s.run('postChain', { step: 'go' });
      await s.run('panelChain', { panel: 'misc', key: 'g0' });
      await s.run('miscChain', { action: 'save' });
      await s.run('blackoutChain', { key: kW(-2) + '_d2' });
    } });
    T.eq('Next knows it, as New does (isPageReadOnly on EQR_POST_COST)', [t.next.v.readOnly, t.new.v.readOnly].join(), 'true,true');
    T.eq('neither writes anything', [t.next.writes().length, t.new.writes().length].join(), '0,0');
    T.eq('...it sees what would be posted, everything ready', t.next.v.plan.length, 4);
    T.check('...with nothing to tick or change', !CPost.gridRows(t.next.v.rowsAll, t.next.ctx.$page.functions.hdrOf(t.next.v.row), true)
      .some((r) => r.canTick || r.canAll || r.canCharge || r.canSplit || r.canDays || r.canRemove || r.expEdit || r.canRetier));
    T.eq('...and the list knows too', usageAccess.answer({ flagsLoaded: true, pageAccessLoaded: true, featureFlags: { PROJECTS_MODULE_ENABLED: 'true' },
      pageAccessMap: { EQR_POST_COST: 'READ_ONLY' } }, 'costs').readOnly, true);
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('Before sending: the confirmation and exactly what is sent');
  {
    const s = makeSide('next');
    await s.open();
    const fns = s.ctx.$page.functions;
    const say = fns.sentence(s.v.rowsAll, s.v.row);
    T.eq('the confirmation says what will happen', say.title, 'Post 3 weeks and 1 charge, $3,590, to PRJ-B Plant Expansion B / task 4.2 in Fusion PPM');
    T.eq('...and the split week', say.split, '1 week is split: Generator 100 kVA · ' + weeks.weekLabel(W(-1)) + ': 60% PRJ-B / 4.2, 40% PRJ-C / 2.1. '
      + 'Fusion PPM is sent the percentages; the amounts are worked out when the week posts.');
    T.eq('...the steps', fns.steps(s.v.rowsAll, s.v.row).join(' › '), 'Record 3 weeks in the posting ledger › Mark 1 charge posted › Send REQ-10440 to Fusion PPM');
    const calls = fns.calls(s.v.rowsAll, s.v.row);
    T.eq('the calls as shown, in order', calls.map((c) => c.n + ' ' + c.method + ' ' + c.path).join(' | '),
      '1 POST /equiprite/v1/posted-weeks | 2 POST /equiprite/v1/posted-weeks/split | 3 POST /equiprite/v1/posted-weeks | 4 POST /equiprite/v1/misc-transactions/post'
      + ' | 5 POST /ic/api/integration/v2/flows/rest/project/EQUIPRITE_DEV/EQP_POST_COST_FLOW_TEST/1.0/eqp/post-cost');
    await s.run('panelChain', { panel: 'post' });
    await s.run('postChain', { step: 'go' });
    const sent = s.writes();
    T.check('...are exactly what was then sent, body for body', calls.length === sent.length && calls.every((c, i) => JSON.stringify(JSON.parse(c.body)) === JSON.stringify(sent[i].body)));
    const spec = (svc) => JSON.parse(read(path.join(ROOT, 'services', svc, 'openapi3.json')));
    const pathOf = (svc, op) => { let p = ''; Object.entries(spec(svc).paths).forEach(([k, m]) => Object.values(m).forEach((x) => { if (x && x.operationId === op) p = k; })); return p; };
    T.eq('...on the services\' own paths', [pathOf('eqp-v1', 'createPostedWeek'), pathOf('eqp-v1', 'createPostedWeekSplit'), pathOf('eqp-v1', 'postMiscTransactions'),
      pathOf('ics', 'postCostToFusionProject'), pathOf('ics', 'postCostToFusion')].join(' | '),
    [CPost.PATHS.week, CPost.PATHS.split, CPost.PATHS.misc, CPost.PATHS.fusion, CPost.PATHS.fusionV1].join(' | '));
  }
  {
    // The user's example: three weeks to one project and task.
    const hdr = { projectNumber: '10011', projectName: 'EPC_MO_Operations', taskNumber: '1.2.1.1' };
    const wk = (k, cost) => ({ kind: 'week', rowKey: k, groupKey: 'g0', equipmentName: 'Crane', label: 'Oct 5 – Oct 11', requestLineId: 1, weekStartISO: '2026-10-05',
      postable: true, posted: false, reversed: false, selected: true, cost, splits: [] });
    T.eq('in the words asked for', CPost.sentence([wk('a', 700), wk('b', 700), wk('c', 685)], hdr).title,
      'Post 3 weeks, $2,085, to 10011 EPC_MO_Operations / task 1.2.1.1 in Fusion PPM');
    T.eq('...a charge alone', CPost.sentence([{ kind: 'misc', rowKey: 'misc_1', miscId: 1, status: 'DRAFT', selected: true, cost: 90 }], hdr).title,
      'Post 1 charge, $90, to 10011 EPC_MO_Operations / task 1.2.1.1 in Fusion PPM');
    T.eq('Fusion\'s and EquipRite\'s answers in words', [CPost.errorWords({ status: 400, body: { 'o:errorDetails': [{ title: 'Task 1.2 is a summary task' }] } }),
      CPost.errorWords({ status: 502, body: '<html>Bad gateway</html>' }), CPost.errorWords(null), CPost.errorWords({ status: 401, body: {} })].join(' | '),
    'Task 1.2 is a summary task (HTTP 400) | the service did not answer (HTTP 502) | there was no answer | the service did not accept the sign-in (HTTP 401)');
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('The grid and the list');
  {
    const s = makeSide('next');
    await s.open();
    const fns = s.ctx.$page.functions;
    await s.run('treeChain', { action: 'toggleDays', key: kW(-2) });
    const rows = fns.gridRows(s.v.rowsAll, s.v.row, false);
    T.eq('each equipment, its weeks (a week\'s days while it is open), its charges', rows.map((r) => r.kind[0]).join(''), 'gwwddddddd' + 'wwmgw');
    const g = rows[0];
    T.check('the equipment: tick its weeks, add a charge, set its type, re-tier', g.canAll && g.allOn && g.canCharge && g.expEdit && g.canRetier && g.expType === 'Equipment Rental');
    const w = rows.find((r) => r.key === kW(-1));
    T.check('a ready week: tick it, exclude days, change its split', w.canTick && w.on && w.canDays && w.canSplit && w.splitText === 'Split 60 / 40');
    T.check('a posted week: nothing to tick', !rows.find((r) => r.key === kW(-3)).canTick);
    T.eq('a day says what it is', rows.find((r) => r.kind === 'day').label, (() => { const d = new Date(W(-2) + 'T00:00:00Z'); return 'Mon ' + d.getUTCDate() + ' '
      + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]; })());
    T.eq('the head\'s Post says what it posts', fns.postLabel(s.v.rowsAll), 'Post 3 weeks and 1 charge · $3,590');
    const pc = new NextPC();
    T.eq('the list\'s Post opens the newest request with something ready', pc.nextReady([{ requestNumber: 'A', eqrEquipmentRequestId: 1 }, { requestNumber: 'B', eqrEquipmentRequestId: 2 },
      { requestNumber: 'C', eqrEquipmentRequestId: 3 }], { A: { ready: 5 }, B: { ready: 9 }, C: { ready: 0 } }), 'B');
    const told = [];
    s.mods.costPosting.onPosted('costs', (n) => told.push(n));
    await s.post();
    T.eq('after a post, the list is told to read again', told.join(), REQ);
  }

  T.report();
})().catch((e) => { console.error(e); process.exitCode = 1; });
