/*
 * EquipRite Next, Inspections and Transfers (webApps/equiprite-next/flows/checks). Loads the real modules.
 *
 *   - the rules are New EquipRite's: resources/js/inspectionRules.js and requestLineBody.js stay byte-identical to New's
 *   - the inspection chains make exactly New's calls: the same scenarios run through New's chains and Next's, side by
 *     side, and the calls and bodies are compared (FAIL with a defect and its photo, PASS at a receipt, an unfinished
 *     inspection continued, every failure and retry path, the line status retry, blocked saves)
 *   - the queue: points in words, late, chips, search, summary, what Complete will write, export columns
 *   - transfers: where each transfer is, read from its equipment; late only when read; inter-project waiting for Fusion
 *     and never shown as moved; the rules shared with New's transfers page give New's answers; reads only
 *   - the pages: listeners, functions, variables and chains line up, VB binding rules, the menu, the record kind
 *
 * Run:  node tests/next-checks.test.js
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
const JS = path.join(NEXT, 'resources', 'js');
const PAGES = path.join(NEXT, 'flows', 'checks', 'pages');
const NEW_PAGES = path.join(NEW, 'flows', 'operations', 'pages');

function loadAmd(file, deps) {
  const sandbox = {
    console, setTimeout, Promise, Blob, Date, Math, JSON, Number, String, Object, Array, isNaN, encodeURIComponent, TextEncoder, URLSearchParams, Intl,
    URL: { createObjectURL: () => 'blob:preview', revokeObjectURL() {} },
  };
  let mod;
  sandbox.define = (names, factory) => { mod = factory(...names.map((n) => (deps && n in deps ? deps[n] : {}))); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: path.basename(file) });
  return mod;
}
const js = (name, deps) => loadAmd(path.join(JS, name + '.js'), deps);

const rules = js('rules');
const fmt = js('fmt');
const Progress = js('requestProgress');
const nav = js('nav', { 'resources/js/rules': rules });
const tabs = js('tabs', { 'resources/js/nav': nav });
const exportKit = js('exportKit');
const lineBody = js('requestLineBody');
const Rules = js('inspectionRules');
const Q = js('inspectionQueue', { 'resources/js/inspectionRules': Rules, 'resources/js/fmt': fmt, 'resources/js/requestProgress': Progress });
const TL = js('transferList', { 'resources/js/fmt': fmt, 'resources/js/requestProgress': Progress });
const NextInspection = loadAmd(path.join(PAGES, 'inspection-page.js'), {
  'resources/js/inspectionRules': Rules, 'resources/js/inspectionQueue': Q, 'resources/js/exportKit': exportKit, 'resources/js/fmt': fmt,
});
const NextTransfers = loadAmd(path.join(PAGES, 'transfers-page.js'), { 'resources/js/exportKit': exportKit, 'resources/js/nav': nav, 'resources/js/transferList': TL });
const NextTransfer = loadAmd(path.join(PAGES, 'transfer-page.js'), {
  'resources/js/exportKit': exportKit, 'resources/js/fmt': fmt, 'resources/js/nav': nav, 'resources/js/transferList': TL,
});
const NewInspection = loadAmd(path.join(NEW_PAGES, 'inspection-page.js'));
const NewTransfers = loadAmd(path.join(NEW_PAGES, 'transfers-page.js'));

const cu = { auditHeaders: () => ({ 'X-User-Id': 'mia.ortiz' }), auditActor: () => 'mia.ortiz', displayName: () => 'Mia Ortiz' };
const busLog = [];
const bus = {
  open: (r) => busLog.push('open ' + JSON.stringify(r)),
  rename: (id, t) => busLog.push('rename ' + id + '=' + t),
  toast: (m, tone) => busLog.push('toast ' + tone + ': ' + m),
};
const requestData = { invalidated: 0, rows: [], invalidate() { this.invalidated++; }, async load() { return { rows: this.rows, linesByRequest: {} }; } };

/** A fake Actions that records every call; `answer(o, calls)` returns a response or undefined (200 {}). */
function fake(answer) {
  const calls = [];
  const Actions = {
    async callRest(ctx, o) {
      calls.push({ endpoint: o.endpoint, uriParams: o.uriParams || {}, body: o.body, headers: o.headers, contentType: o.contentType });
      const r = answer ? answer(o, calls) : undefined;
      return r === undefined ? { ok: true, status: 200, body: {} } : r;
    },
    async fireNotificationEvent(ctx, n) { calls.push({ toast: n.summary, type: n.type, message: n.message }); },
    async callChain(ctx, n) { calls.push({ chain: n.chain, params: n.params }); },
    async navigateToPage(ctx, n) { calls.push({ nav: n.page }); },
  };
  return { calls, Actions };
}
const ok = (body) => ({ ok: true, status: 200, body });
const fail = (status) => ({ ok: false, status: status || 500, body: { message: 'boom' } });
const rest = (calls) => calls.filter((c) => c.endpoint).map((c) => c.endpoint.replace(/^eqp-v1\//, ''));
const writes = (calls) => calls.filter((c) => c.endpoint && !/\/get[A-Z]/.test(c.endpoint));

const DEPS = {
  'vb/action/actionChain': class {}, 'resources/js/currentUser': cu, 'resources/js/requestLineBody': lineBody, 'resources/js/requestData': requestData,
  'resources/js/shellBus': bus, 'resources/js/inspectionQueue': Q, 'resources/js/transferList': TL, 'resources/js/exportKit': exportKit,
};
const nextChain = (page, name, Actions) => loadAmd(path.join(PAGES, page + '-page-chains', name + '.js'), Object.assign({}, DEPS, { 'vb/action/actions': Actions }));
const newChain = (name, Actions) => loadAmd(path.join(NEW_PAGES, 'inspection-page-chains', name + '.js'), Object.assign({}, DEPS, { 'vb/action/actions': Actions }));

function context(page, variables, appVars) {
  return {
    $page: { variables, functions: page },
    $application: {
      variables: Object.assign({ featureFlags: {}, flagsLoaded: true, appUrls: { old: '', new: '' }, fusionRoles: [], sessionRoles: [] }, appVars || {}),
      functions: { isFeatureEnabled: (f, l, k) => !!(l && f && f[k] === 'true') },
      user: {},
    },
  };
}

/** The calls as compared: endpoint, params, body (times and the photo's time stamp left out), headers, content type. */
async function norm(calls) {
  const out = [];
  for (const c of calls) {
    let body = c.body;
    if (body && body.metadata && typeof body.metadata.text === 'function') {
      const meta = JSON.parse(await body.metadata.text());
      meta.path = meta.path.replace(/\/\d+-/, '/STAMP-');
      body = { metadata: meta, file: body.file && body.file.name };
    } else if (body) {
      body = JSON.parse(JSON.stringify(body));
      if (body.scheduledDate) body.scheduledDate = 'D';
      if (body.completedDate) body.completedDate = 'D';
    }
    out.push(JSON.stringify([c.endpoint, c.uriParams, body, c.headers || {}, c.contentType || '']));
  }
  return out.join('\n');
}

const NOW = Date.UTC(2026, 9, 30, 9);
const day = (n) => new Date(NOW + n * 86400000).toISOString().slice(0, 10);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// Inspections
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

const LINES = [
  { lineId: 9001, requestId: 501, requestNumber: 'REQ-10505', projectName: 'Pipeline North', equipmentMasterId: 61, equipmentClassId: 10, equipmentSubclassId: 101,
    equipmentName: 'Mobile Crane 50t', className: 'Cranes', allocatedSerial: 'MC-11', lineStatus: 'PICK_RELEASED', startDate: day(-2) + 'T00:00:00Z' },
  { lineId: 9002, requestId: 501, requestNumber: 'REQ-10505', equipmentClassId: 20, equipmentSubclassId: 201, equipmentName: 'Generator 100 kVA',
    className: 'Power', allocatedSerial: 'GN-0419', lineStatus: 'PICK_RELEASED', startDate: day(4) },
  { lineId: 9003, requestId: 502, requestNumber: 'REQ-10510', equipmentClassId: 30, equipmentName: 'Light tower', allocatedSerial: 'LT-0207', lineStatus: 'SHIPPED_TO_YARD',
    endDate: day(-1) },
  { lineId: 9004, requestId: 502, equipmentClassId: 40, equipmentName: 'Compactor', lineStatus: 'INSPECTION_FAILED', startDate: day(1) },
  { lineId: 9005, requestId: 503, equipmentClassId: 10, equipmentSubclassId: 102, equipmentName: 'Tower crane', lineStatus: 'RETURN_INITIATED', endDate: day(3) },
];
const MATRIX = [
  { equipmentClassId: 10, equipmentSubclassId: 101, inspectionType: 'SHIP_OUT_YARD', isActiveFlag: 'Y', isMandatoryFlag: 'Y' },
  { equipmentClassId: 20, equipmentSubclassId: null, inspectionType: 'Ship out of yard', isActiveFlag: 'Y' },
  { equipmentClassId: 30, inspectionType: 'RECEIVE_AT_YARD', isActiveFlag: 'Y' },
  { equipmentClassId: 40, inspectionType: 'SHIP_OUT_YARD', isActiveFlag: 'Y' },
  { equipmentClassId: 10, equipmentSubclassId: 102, inspectionType: 'SHIP_OUT_SITE', isActiveFlag: 'N' },
];
const CHECK10 = [
  { id: 701, questionText: 'Load chart and certificate on board', responseType: 'YES_NO', isMandatoryFlag: 'Y', sequenceNumber: 1 },
  { id: 702, questionText: 'Wire rope and hook', responseType: 'PASS_FAIL', isMandatoryFlag: 'Y', sequenceNumber: 2 },
  { id: 703, questionText: 'Outrigger pad thickness', responseType: 'NUMERIC', minValue: 40, maxValue: 60, uom: 'mm', isMandatoryFlag: 'Y', sequenceNumber: 3 },
  { id: 704, questionText: 'Cab cleanliness', responseType: 'RATING', maxValue: 5, isMandatoryFlag: 'N', sequenceNumber: 4 },
  { id: 707, questionText: 'Retired check', isActiveFlag: 'N' },
];
const A = (v, note) => ({ value: v, note });
const ANS_FAIL = { 701: A('YES'), 702: A('FAIL', 'Two broken wires'), 703: A('52'), 704: A('4') };
const FILE = { name: 'wire.jpg', type: 'image/jpeg', size: 2048 };

T.section('the rules are New EquipRite\'s, unchanged');
T.eq('resources/js/inspectionRules.js is New\'s inspection page module, byte for byte',
  fs.readFileSync(path.join(JS, 'inspectionRules.js'), 'utf8') === fs.readFileSync(path.join(NEW_PAGES, 'inspection-page.js'), 'utf8'), true);
T.eq('resources/js/requestLineBody.js is New\'s, byte for byte',
  fs.readFileSync(path.join(JS, 'requestLineBody.js'), 'utf8') === fs.readFileSync(path.join(NEW, 'resources', 'js', 'requestLineBody.js'), 'utf8'), true);
T.eq('resources/js/currentUser.js is New\'s, byte for byte',
  fs.readFileSync(path.join(JS, 'currentUser.js'), 'utf8') === fs.readFileSync(path.join(NEW, 'resources', 'js', 'currentUser.js'), 'utf8'), true);
const np = new NextInspection();
const op = new NewInspection();
const ITEMS = np.checklistFor(CHECK10, LINES[0], 'SHIP_OUT_YARD');
T.eq('the screen\'s module is the rules plus its own helpers', [typeof np.result, typeof np.blockers, typeof np.lineStatusAfter, typeof np.willDo].join(), 'function,function,function,function');
T.eq('... and gives New\'s results', JSON.stringify([np.result(ITEMS, ANS_FAIL, []), np.blockers(ITEMS, { 701: A('YES') }, [], false), np.lineStatusAfter('SHIP_OUT_YARD', 'CONDITIONAL', true)]),
  JSON.stringify([op.result(ITEMS, ANS_FAIL, []), op.blockers(ITEMS, { 701: A('YES') }, [], false), op.lineStatusAfter('SHIP_OUT_YARD', 'CONDITIONAL', true)]));

T.section('inspections: the queue in words');
const entries = Q.entries(LINES, MATRIX, 'required', NOW);
T.eq('New\'s queue, every point: asked for, earliest needed first (no date first, as New sorts)', entries.map((e) => e.lineId).join(','), '9003,9001,9004,9002');
const E = (id) => entries.find((e) => e.lineId === id);
T.eq('everything waiting: the unit nobody asked for comes last', Q.entries(LINES, MATRIX, 'all', NOW).map((e) => e.lineId + (e.required ? '*' : '')).join(','), '9003*,9001*,9004*,9002*,9005');
T.eq('where each unit goes, in words', entries.map((e) => e.pointWords + (e.failed ? ' (failed)' : '')).join(' | '),
  'Back at the yard | Leaving the yard | Leaving the yard (failed) | Leaving the yard');
T.eq('late: still at the yard after its start date', entries.filter((e) => e.late).map((e) => e.lineId + ' ' + e.lateText).join(), '9001 Needed on site since 28 Oct · 2 days late');
T.eq('when, otherwise', entries.map((e) => e.when).join(' | '), 'Rental ends 29 Oct 2026 | Needed on site 28 Oct 2026 | Needed on site 31 Oct 2026 (tomorrow) | Needed on site 3 Nov 2026 (in 4 days)');
T.eq('a failed unit: its colour and its words', [E(9004).stage, E(9004).statusWords, Q.lineWords('PICK_RELEASED')].join(' | '), 'stopped | Failed inspection | Being picked at the yard');
T.eq('chips: everything, late, the four points (failed ones apart), failed', Q.chips(entries).map((c) => c.key + ':' + c.count).join(' '),
  'all:4 late:1 SHIP_OUT_YARD:2 RECEIVE_SITE:0 SHIP_OUT_SITE:0 RECEIVE_YARD:1 failed:1');
T.eq('filter by chip and search', [Q.filter(entries, 'failed', '').map((e) => e.lineId).join(), Q.filter(entries, 'SHIP_OUT_YARD', '').map((e) => e.lineId).join(),
  Q.filter(entries, 'all', 'gn-04').map((e) => e.lineId).join(), Q.filter(entries, 'late', '').map((e) => e.lineId).join()].join(' | '), '9004 | 9001,9002 | 9002 | 9001');
T.eq('summary', Q.summary(entries), '4 units to inspect · 2 leaving the yard · 1 back at the yard · 1 failed · 1 late');
T.eq('summary of nothing', Q.summary([]), 'Nothing waiting for an inspection');
const cols = Q.exportColumns();
T.eq('export columns', cols.map((c) => c.label).join(', '), 'Equipment, Serial, Class, Request, Project or customer, Inspection, Asked for by the matrix, Where it is, When, Days late, Stored line status');
T.eq('... a row', cols.map((c) => (c.value ? c.value(E(9001)) : E(9001)[c.key])).join(' | '),
  'Mobile Crane 50t | MC-11 | Cranes | REQ-10505 | Pipeline North | Leaving the yard | Yes | Being picked at the yard | Needed on site 28 Oct 2026 | 2 | PICK_RELEASED');

T.section('inspections: what Complete says it will write');
const D1 = Object.assign(np.newDefect('d1', ITEMS[1], ANS_FAIL[702]), { photo: { name: 'wire.jpg' } });
T.eq('FAIL at the yard', np.willDo(Object.assign({}, LINES[0], { point: 'SHIP_OUT_YARD' }), ITEMS, ANS_FAIL, [D1], false, {}),
  'Saves the inspection with 4 answers and 1 defect with its photo, completed as Fail. The line is marked Failed inspection and cannot ship.');
T.eq('PASS at the yard', Q.willDo('SHIP_OUT_YARD', 'PASS', true, false, 2, [], {}), 'Saves the inspection with 2 answers, completed as Pass. The line is marked Inspected, ready to ship.');
T.eq('CONDITIONAL, not yet acknowledged', Q.willDo('SHIP_OUT_YARD', 'CONDITIONAL', true, false, 2, [], {}),
  'Saves the inspection with 2 answers, completed as Conditional. The line stays as it is until the result is acknowledged.');
T.eq('a receipt: the line is not moved here', Q.willDo('RECEIVE_YARD', 'FAIL', true, false, 1, [], { inspectionId: 6950 }),
  'Finishes inspection 6950 with 1 answer, completed as Fail. The line status does not change here: the receipt itself is done in Receiving & returns.');
T.eq('nothing while not finished', Q.willDo('SHIP_OUT_YARD', 'FAIL', false, false, 1, [], {}), '');
T.eq('result colours', ['PASS', 'CONDITIONAL', 'FAIL'].map((c) => Q.tone(c, true)).concat(Q.tone('FAIL', false)).join(), 'onsite,ready,stopped,draft');

T.section('inspections: the page keeps its DOM still');
T.eq('answer buttons depend on the question only', JSON.stringify(np.options(ITEMS[1])), JSON.stringify([{ value: 'PASS', label: 'Pass', on: false, tone: 'ok' }, { value: 'FAIL', label: 'Fail', on: false, tone: 'fault' }]));
T.eq('... the given answer is a class bound in place', [np.optionOn(ANS_FAIL, ITEMS[1], 'FAIL'), np.optionClass(ANS_FAIL, ITEMS[1], np.options(ITEMS[1])[1])].join(' | '),
  'true | nx-insp-ans nx-insp-ans--fault nx-insp-ans--on');
const DEFS = [D1, { key: 'd2', itemId: '', description: 'Dent' }, { key: 'saved-9', itemId: '799', saved: true }];
T.eq('defect cards are bound to their keys', [np.defectKeys(DEFS, '702').join(), np.otherKeys(DEFS, ITEMS).join(), np.defectOf(DEFS, 'd2').description, JSON.stringify(np.defectOf(DEFS, 'x'))].join(' | '),
  'd1 | d2,saved-9 | Dent | {}');
T.eq('progress', np.progressText(ITEMS, ANS_FAIL), '4 of 4 answered · 1 failed · score 75%');
T.eq('verdict', np.verdictText(ITEMS, ANS_FAIL, [], 'SHIP_OUT_YARD') + ' / ' + np.verdictTone(ITEMS, ANS_FAIL, []), 'Fail: cannot ship / stopped');

// ── The inspection chains: Next's against New's ─────────────────────────────────────────────────────────────

function vars(extra) {
  const v = Object.assign({
    lineId: null, mode: 'out', point: '', scope: 'required', chip: 'all', text: '', lines: LINES.slice(), matrix: MATRIX, matrixNote: '', truncatedNote: '',
    isLoading: false, loadError: '', current: null, openToken: 0, checklist: [], checklistLoading: false, checklistError: '', history: [],
    answers: {}, defects: [], step: 0, notes: '', ack: false, saved: {}, photoError: '', isSaving: false, saveError: '', blocked: [], done: null, inspector: '',
  }, extra || {});
  v.shown = Q.filter(Q.entries(v.lines, v.matrix, v.scope, NOW), 'all', '');
  return v;
}
const CURRENT = Object.assign({}, LINES[0], { point: 'SHIP_OUT_YARD', pointLabel: 'Ship-out from yard', required: true });

function backend(fails) {
  let n = 0;
  return (o) => {
    const e = o.endpoint;
    if (fails && fails[e] && fails[e]()) return fail(503);
    if (e === 'eqp-v1/createInspection') return ok({ id: 7001 });
    if (e === 'eqp-v1/createInspectionResponse') return ok({ id: 8000 + (++n) });
    if (e === 'eqp-v1/createInspectionDefect') return ok({ id: 9101 });
    if (e === 'commonService/uploadCommonDocument') return ok({ doc_id: 55 });
    if (e === 'eqp-v1/patchRequestLinesBatch') return ok({ data: o.body.lines });
    if (e === 'eqp-v1/getInspections') return ok({ data: [{ id: 7001, inspectionStatus: 'COMPLETED', overallResult: 'FAIL', completedDate: '2026-10-30T09:00:00Z' }] });
    return undefined;
  };
}
const failTimes = (times) => { let left = times; return () => left-- > 0; };

function sheet(page, answers, withDefect) {
  const items = page.checklistFor(CHECK10, LINES[0], 'SHIP_OUT_YARD');
  const out = { checklist: items, answers: Object.assign({}, answers), defects: [], step: items.length };
  if (withDefect) {
    const d = page.newDefect('d1', items[1], answers[702]);
    d.photo = { name: 'wire.jpg', size: 2048, url: 'blob:preview' };
    page.holdFile('d1', FILE);
    out.defects = [d];
  }
  return out;
}

/** Runs one scenario through New's chain and Next's, from the same start, against the same backend. */
async function both(chainName, start, fails, rounds) {
  const res = {};
  for (const side of ['new', 'next']) {
    const { calls, Actions } = fake(backend(fails && fails()));
    const page = side === 'new' ? new NewInspection() : new NextInspection();
    const c = context(page, vars(start(page)));
    const Chain = side === 'new' ? newChain(chainName, Actions) : nextChain('inspection', chainName, Actions);
    const perRound = [];
    for (let i = 0; i < (rounds || 1); i++) {
      calls.length = 0;
      await new Chain().run(c, {});
      perRound.push({ calls: calls.slice(), saveError: c.$page.variables.saveError, saved: JSON.stringify(c.$page.variables.saved), blocked: (c.$page.variables.blocked || []).join('|') });
    }
    res[side] = { rounds: perRound, v: c.$page.variables, page };
  }
  return res;
}

(async () => {
  T.section('inspection chains: loading the queue, as New does');
  {
    const answer = (o) => {
      if (o.endpoint === 'eqp-v1/getConfInspectionDetails') return ok({ data: MATRIX });
      if (o.endpoint === 'eqp-v1/getEquipriteV1ViewsWorkbenchRequests') {
        return ok({ data: o.uriParams.stage === 'OUTBOUND' ? [{ eqrEquipmentRequestId: 501 }, { eqrEquipmentRequestId: 501 }] : [{ eqrEquipmentRequestId: 502 }] });
      }
      if (o.endpoint === 'eqp-v1/getEquipriteV1ViewsRequestDetailLines') {
        return ok({ data: LINES.filter((l) => l.requestId === o.uriParams.requestId).map((l) => Object.assign({}, l, { requestId: undefined })).concat([{ lineId: 1, lineStatus: 'DEPLOYED' }]) });
      }
      return undefined;
    };
    const out = {};
    for (const side of ['new', 'next']) {
      const { calls, Actions } = fake(answer);
      const c = context(side === 'new' ? new NewInspection() : new NextInspection(), vars({ lines: [] }));
      await new (side === 'new' ? newChain('loadQueueChain', Actions) : nextChain('inspection', 'loadQueueChain', Actions))().run(c, {});
      out[side] = { calls, v: c.$page.variables };
    }
    T.eq('the same calls: the matrix, both stages, then each request once', await norm(out.next.calls.filter((x) => x.endpoint)), await norm(out.new.calls.filter((x) => x.endpoint)));
    T.eq('the same units kept', out.next.v.lines.map((l) => l.lineId + '@' + l.requestId).join(), out.new.v.lines.map((l) => l.lineId + '@' + l.requestId).join());
    T.check('reads only, then the queue is worked out', writes(out.next.calls).length === 0 && out.next.calls[out.next.calls.length - 1].chain === 'applyChain');
    T.eq('the inspector is named for the sheet', out.next.v.inspector, 'Mia Ortiz');
  }
  for (const [what, answer] of [['no matrix', (o) => (o.endpoint === 'eqp-v1/getConfInspectionDetails' ? fail(500) : ok({ data: [] }))],
    ['both stages failing', (o) => (o.endpoint.indexOf('Workbench') !== -1 ? fail(502) : ok({ data: [] }))]]) {
    const out = {};
    for (const side of ['new', 'next']) {
      const { calls, Actions } = fake(answer);
      const c = context(side === 'new' ? new NewInspection() : new NextInspection(), vars({ lines: [] }));
      await new (side === 'new' ? newChain('loadQueueChain', Actions) : nextChain('inspection', 'loadQueueChain', Actions))().run(c, {});
      out[side] = { calls: rest(calls).join(), v: c.$page.variables };
    }
    T.eq(what + ': the same calls, scope, notes and error', JSON.stringify([out.next.calls, out.next.v.scope, out.next.v.matrixNote, out.next.v.loadError.replace('units', 'equipment')]),
      JSON.stringify([out.new.calls, out.new.v.scope, out.new.v.matrixNote.replace('line waiting', 'unit waiting'), out.new.v.loadError]));
  }

  T.section('inspection chains: opening a unit, as New does (an unfinished inspection is continued)');
  {
    const answer = (o) => {
      if (o.endpoint === 'eqp-v1/getInspectionChecklists') return ok({ data: CHECK10 });
      if (o.endpoint === 'eqp-v1/getInspections') {
        return ok({ data: [{ id: 6900, inspectionType: 'SHIP_OUT_YARD', inspectionStatus: 'COMPLETED', overallResult: 'FAIL', completedDate: '2026-10-20' },
          { id: 6950, inspectionType: 'SHIP_OUT_YARD', inspectionStatus: 'IN_PROGRESS' }] });
      }
      if (o.endpoint === 'eqp-v1/getInspectionResponses') return ok({ data: [{ id: 81, checklistId: 701, responseValue: 'YES' }] });
      if (o.endpoint === 'eqp-v1/getInspectionDefects') return ok({ data: [{ id: 91, checklistId: 702, defectDescription: 'Rope', severity: 'MAJOR' }] });
      return undefined;
    };
    const out = {};
    for (const side of ['new', 'next']) {
      const { calls, Actions } = fake(answer);
      const c = context(side === 'new' ? new NewInspection() : new NextInspection(), vars());
      await new (side === 'new' ? newChain('openLineChain', Actions) : nextChain('inspection', 'openLineChain', Actions))().run(c, { lineId: '9001' });
      out[side] = { calls, v: c.$page.variables };
    }
    T.eq('the same calls', await norm(out.next.calls), await norm(out.new.calls));
    const pick = (v) => JSON.stringify([v.current && v.current.point, v.current && v.current.required, v.checklist.map((i) => i.id), v.answers, v.defects, v.saved, v.history]);
    T.eq('the same sheet: point, checklist, answers and defects taken over, history', pick(out.next.v), pick(out.new.v));
    const { calls, Actions } = fake();
    const c = context(new NextInspection(), vars({ isSaving: true, current: CURRENT }));
    await new (nextChain('inspection', 'openLineChain', Actions))().run(c, { lineId: '9002' });
    T.check('no other unit is opened while a save runs', calls.length === 0 && c.$page.variables.current.lineId === 9001);
  }

  T.section('inspection chains: complete, FAIL at the yard: exactly New\'s calls');
  {
    const r = await both('completeInspectionChain', (page) => Object.assign({ current: CURRENT }, sheet(page, ANS_FAIL, true)));
    const nx = r.next.rounds[0];
    T.eq('the same writes, bodies and headers, in the same order', await norm(writes(nx.calls)), await norm(writes(r.new.rounds[0].calls)));
    T.eq('the calls', rest(nx.calls).join(' > '),
      'createInspection > createInspectionResponse > createInspectionResponse > createInspectionResponse > createInspectionResponse > createInspectionDefect'
      + ' > commonService/uploadCommonDocument > patchInspection > patchRequestLinesBatch > getInspections');
    T.eq('then the result is read back', JSON.stringify(r.next.v.done.recorded), '{"id":7001,"status":"COMPLETED","result":"FAIL","date":"2026-10-30"}');
    T.eq('the done card: as New\'s, the next unit from the queue as shown', JSON.stringify([r.next.v.done.code, r.next.v.done.lineStatus, r.next.v.done.nextLineId, r.next.v.done.unit]),
      '["FAIL","INSPECTION_FAILED","9003","Mobile Crane 50t · MC-11"]');
    T.check('the unit leaves the queue, the sheet is cleared, the photo let go', !r.next.v.lines.some((l) => l.lineId === 9001) && r.next.v.current === null
      && !r.next.v.defects.length && r.next.page.heldFile('d1') === null);
    T.check('the other tabs read the requests afresh', requestData.invalidated >= 1);
    T.eq('a warning toast', busLog.filter((l) => l.startsWith('toast')).pop(), 'toast warning: Mobile Crane 50t · MC-11: Fail: cannot ship.');
    T.eq('the queue is worked out again', nx.calls.filter((x) => x.chain).map((x) => x.chain).join(), 'applyChain');
  }
  {
    const pass = { 701: A('YES'), 702: A('PASS'), 703: A('50'), 704: A('5') };
    const r = await both('completeInspectionChain', (page) => Object.assign({ current: Object.assign({}, LINES[2], { point: 'RECEIVE_YARD', pointLabel: 'Receive at yard', required: true }) },
      sheet(page, pass, false)));
    T.eq('PASS at the yard receipt: the same writes, and no line status', await norm(writes(r.next.rounds[0].calls)), await norm(writes(r.new.rounds[0].calls)));
    T.check('... no lines/batch', !rest(r.next.rounds[0].calls).includes('patchRequestLinesBatch'));
  }
  {
    const r = await both('completeInspectionChain', (page) => Object.assign({ current: CURRENT, ack: true }, sheet(page, { 701: A('YES'), 702: A('PASS'), 703: A('50'), 704: A('1') }, false)));
    T.eq('CONDITIONAL acknowledged: the same writes (EQP_INSPECTION_COMPLETE, the acknowledgement in the notes)', await norm(writes(r.next.rounds[0].calls)), await norm(writes(r.new.rounds[0].calls)));
  }
  {
    const r = await both('completeInspectionChain', (page) => Object.assign({ current: CURRENT }, sheet(page, { 701: A('YES'), 702: A('PASS'), 703: A('50'), 704: A('1') }, false)));
    T.eq('CONDITIONAL not acknowledged: blocked as New is, nothing written', JSON.stringify([r.next.rounds[0].calls.length, r.next.rounds[0].blocked]),
      JSON.stringify([r.new.rounds[0].calls.length, r.new.rounds[0].blocked]));
    T.eq('... in words', r.next.rounds[0].blocked, 'Acknowledge the conditional result');
  }
  {
    const r = await both('completeInspectionChain', (page) => {
      const s = sheet(page, ANS_FAIL, true);
      page.holdFile('d1', null);
      s.defects[0].photo = null;
      return Object.assign({ current: CURRENT }, s);
    });
    T.eq('a defect without its photo: blocked as New is', r.next.rounds[0].blocked, r.new.rounds[0].blocked);
  }

  T.section('inspection chains: a failure stops the save, a retry continues it, as New does');
  for (const [what, fails] of [
    ['the inspection cannot start', () => ({ 'eqp-v1/createInspection': () => true })],
    ['the 2nd answer fails once', () => { let n = 0; return { 'eqp-v1/createInspectionResponse': () => ++n === 2 }; }],
    ['the defect fails once', () => ({ 'eqp-v1/createInspectionDefect': failTimes(1) })],
    ['the photo fails once', () => ({ 'commonService/uploadCommonDocument': failTimes(1) })],
    ['the completion fails once', () => ({ 'eqp-v1/patchInspection': failTimes(1) })],
  ]) {
    const r = await both('completeInspectionChain', (page) => Object.assign({ current: CURRENT }, sheet(page, ANS_FAIL, true)), fails, 2);
    T.eq(what + ': the same calls, error and what is kept', JSON.stringify([await norm(writes(r.next.rounds[0].calls)), r.next.rounds[0].saveError, r.next.rounds[0].saved]),
      JSON.stringify([await norm(writes(r.new.rounds[0].calls)), r.new.rounds[0].saveError, r.new.rounds[0].saved]));
    T.eq(what + ': the retry continues as New\'s does', await norm(writes(r.next.rounds[1].calls)), await norm(writes(r.new.rounds[1].calls)));
  }
  {
    const r = await both('completeInspectionChain', (page) => Object.assign({ current: CURRENT }, sheet(page, ANS_FAIL, true)), () => ({ 'eqp-v1/patchRequestLinesBatch': failTimes(1) }));
    const d = r.next.v.done;
    T.check('the line status fails: the inspection is done and the status can be retried', d && d.pendingStatus === 'INSPECTION_FAILED' && !!d.statusError && !d.lineStatus);
    T.eq('... the same as New', JSON.stringify([d.pendingStatus, d.statusError]), JSON.stringify([r.new.v.done.pendingStatus, r.new.v.done.statusError]));
    const out = {};
    for (const side of ['new', 'next']) {
      const { calls, Actions } = fake(backend());
      const c = context(r[side].page, r[side].v);
      await new (side === 'new' ? newChain('retryStatusChain', Actions) : nextChain('inspection', 'retryStatusChain', Actions))().run(c, {});
      out[side] = { calls, done: c.$page.variables.done };
    }
    T.eq('retry: the same single call', await norm(out.next.calls), await norm(out.new.calls));
    T.eq('... and the line is set', out.next.done.lineStatus + '|' + out.next.done.statusError, 'INSPECTION_FAILED|');
  }
  {
    const r = await both('completeInspectionChain', (page) => {
      const items = page.checklistFor(CHECK10, LINES[0], 'SHIP_OUT_YARD');
      return { current: CURRENT, checklist: items, step: 4, answers: { 701: A('YES'), 702: A('PASS'), 703: A('48'), 704: A('5') },
        saved: { inspectionId: 6950, responses: { 701: { id: 81, value: 'YES', note: '' }, 702: { id: 82, value: 'FAIL', note: '' } }, defects: {}, photos: {} } };
    });
    T.eq('continuing an open inspection: the same patch and posts on it', await norm(writes(r.next.rounds[0].calls)), await norm(writes(r.new.rounds[0].calls)));
    T.eq('... the calls', rest(writes(r.next.rounds[0].calls)).join(' > '), 'patchInspectionResponse > createInspectionResponse > createInspectionResponse > patchInspection > patchRequestLinesBatch');
  }
  {
    // A double tap: the second click while the first save runs does nothing.
    const { calls, Actions } = fake(backend());
    const page = new NextInspection();
    const c = context(page, vars(Object.assign({ current: CURRENT }, sheet(page, ANS_FAIL, true))));
    const Chain = nextChain('inspection', 'completeInspectionChain', Actions);
    await Promise.all([new Chain().run(c, {}), new Chain().run(c, {})]);
    T.eq('a double tap saves once', rest(calls).filter((x) => x === 'createInspection').length, 1);
  }

  T.section('inspection chains: answers, defects, photos (as New\'s)');
  {
    const { Actions } = fake();
    const page = new NextInspection();
    const c = context(page, vars({ current: CURRENT, checklist: ITEMS }));
    await new (nextChain('inspection', 'answerChain', Actions))().run(c, { id: '702', value: 'FAIL' });
    await new (nextChain('inspection', 'answerChain', Actions))().run(c, { id: '702', note: 'Two broken wires' });
    await new (nextChain('inspection', 'defectChain', Actions))().run(c, { action: 'add', item: '702' });
    const key = c.$page.variables.defects[0].key;
    await new (nextChain('inspection', 'defectChain', Actions))().run(c, { action: 'set', key, field: 'severity', value: 'CRITICAL' });
    await new (nextChain('inspection', 'photoChain', Actions))().run(c, { key, file: { name: 'a.pdf', type: 'application/pdf', size: 1 } });
    T.eq('a file that is not a photo is refused, in words', c.$page.variables.photoError, 'That file is not a photo.');
    await new (nextChain('inspection', 'photoChain', Actions))().run(c, { key, file: FILE });
    const d = c.$page.variables.defects[0];
    T.eq('the defect: from its question and note, the severity set, the photo held', JSON.stringify([c.$page.variables.answers['702'], d.description, d.severity, d.photo.name, page.heldFile(key) === FILE]),
      '[{"value":"FAIL","note":"Two broken wires"},"Wire rope and hook: Two broken wires","CRITICAL","wire.jpg",true]');
    T.eq('a tapped answer stays on screen (the whole checklist is shown)', c.$page.variables.step, 0);
    await new (nextChain('inspection', 'defectChain', Actions))().run(c, { action: 'remove', key });
    T.check('removed, and the photo let go', !c.$page.variables.defects.length && page.heldFile(key) === null);
    await new (nextChain('inspection', 'setFieldChain', Actions))().run(c, { field: 'ack', value: 'true' });
    T.eq('the acknowledgement', c.$page.variables.ack, true);
  }

  T.section('inspection chains: the list');
  {
    const { calls, Actions } = fake();
    const c = context(new NextInspection(), vars({ chip: 'all', text: '' }));
    await new (nextChain('inspection', 'applyChain', Actions))().run(c, {});
    T.eq('apply: chips, summary, shown', [c.$page.variables.chips.length, c.$page.variables.summary.split(' · ')[0], c.$page.variables.shown.length].join(' | '), '7 | 4 units to inspect | 4');
    await new (nextChain('inspection', 'setChain', Actions))().run(c, { field: 'chip', value: 'failed' });
    T.eq('a chip asks for the list again', calls.map((x) => x.chain).join(), 'applyChain');
    await new (nextChain('inspection', 'setChain', Actions))().run(c, { field: 'scope', value: 'everything' });
    T.eq('scope: only required or all', c.$page.variables.scope, 'required');
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════
  // Transfers
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════

  T.section('transfers: the rules shared with New\'s transfers page give New\'s answers');
  const tp = new NewTransfers();
  const ORGS = [{ invOrgId: 1, organizationId: 1001, organizationCode: 'YARD1', organizationName: 'Houston yard' },
    { invOrgId: 3, organizationId: 3001, organizationCode: 'TEXAS', organizationName: 'Texas project sites' }];
  T.eq('an org\'s name', [1001, 3001, 1, 999, null, ''].map((id) => TL.orgText(ORGS, id)).join(' | '), [1001, 3001, 1, 999, null, ''].map((id) => tp.siteText(ORGS, id)).join(' | '));
  const HIST = [
    { id: 41, transferOrderId: 880, orderNumber: 'INV-TX 882104', transferDate: '2026-10-22T00:00:00Z', equipmentName: 'Generator 60 kVA', serialNumber: 'GN-0388',
      sourceRequestNumber: 'REQ-10402', sourceProjectName: 'Pipeline North', destinationRequestNumber: 'REQ-10466', destinationProjectName: 'Plant Expansion B',
      transferStatus: 'COMPLETED', transferredBy: 'a.khan', sourceRequestId: 402, destinationRequestId: 466 },
    { id: 42, transferOrderId: 900, orderNumber: 'EQR-TRF-REQ-10527-1', transferDate: day(-3) + 'T00:00:00Z', equipmentName: 'Dump Truck 30t', serialNumber: 'DT-1108',
      sourceRequestId: 475, sourceRequestNumber: 'REQ-10475', sourceProjectName: 'Pipeline North', destinationRequestId: 527, destinationRequestNumber: 'REQ-10527',
      destinationProjectName: 'Plant Expansion B', sourceOrgId: 3001, destinationOrgId: 3002, transferStatus: 'PENDING' },
    { id: 43, destinationRequestId: 9, status: 'posted', createdDate: '2026-09-01' },
  ];
  T.eq('history rows', JSON.stringify(TL.historyRows(HIST)), JSON.stringify(tp.historyRows(HIST)));
  T.eq('history rows, limited', JSON.stringify(TL.historyRows(HIST, 1)), JSON.stringify(tp.historyRows(HIST, 1)));
  T.eq('status words', ['PENDING', 'COMPLETED', 'POSTED', 'FAILED', 'CANCELLED', 'ODD', ''].map(TL.historyStatusText).join(), ['PENDING', 'COMPLETED', 'POSTED', 'FAILED', 'CANCELLED', 'ODD', ''].map((s) => tp.statusText(s)).join());
  T.eq('the inter-project switch (default on)', [[{ ENABLE_INTER_PROJECT_TRANSFER: 'false' }, true], [{ ENABLE_INTER_PROJECT_TRANSFER: 'false' }, false], [{}, true], [{ ENABLE_INTER_PROJECT_TRANSFER: 'true' }, true]]
    .map(([f, l]) => TL.interProjectOff(f, l)).join(), [[{ ENABLE_INTER_PROJECT_TRANSFER: 'false' }, true], [{ ENABLE_INTER_PROJECT_TRANSFER: 'false' }, false], [{}, true], [{ ENABLE_INTER_PROJECT_TRANSFER: 'true' }, true]]
    .map(([f, l]) => tp.switchedOff(f, l)).join());

  T.section('transfers: where each one is, read from its equipment');
  const ORDERS = [
    { id: 300, equipmentRequestId: 475, orderNumber: 'TO-300', orderType: 'OUTBOUND', orderStatus: 'PENDING', sourceOrgId: 1001, destinationOrgId: 3001, needByDate: day(-30), createdDate: day(-36) },
    { id: 310, equipmentRequestId: 501, orderNumber: 'TO-310', orderType: 'OUTBOUND', orderStatus: 'PENDING', sourceOrgId: 1001, destinationOrgId: 3001, needByDate: day(-2), createdDate: day(-6) },
    { id: 320, equipmentRequestId: 510, orderNumber: 'TO-320', orderType: 'OUTBOUND', orderStatus: 'PENDING', needByDate: day(5), createdDate: day(-1) },
    { id: 330, equipmentRequestId: 560, orderNumber: 'TO-330', orderType: 'INBOUND', orderStatus: 'PENDING', sourceOrgId: 3001, destinationOrgId: 1001, needByDate: day(-1), createdDate: day(-4) },
    { id: 340, equipmentRequestId: 527, orderNumber: 'TO-340', orderType: 'OUTBOUND', orderStatus: 'CANCELLED', needByDate: day(-9), createdDate: day(-10) },
    { id: 350, equipmentRequestId: 527, orderNumber: 'TO-350', orderType: 'OUTBOUND', orderStatus: 'PENDING', needByDate: day(-20), createdDate: day(-40) },
    { id: 360, equipmentRequestId: 527, orderNumber: 'TO-360', orderType: 'OUTBOUND', orderStatus: 'FAILED', needByDate: day(-5), createdDate: day(-6) },
    { id: 900, equipmentRequestId: 527, orderNumber: 'EQR-TRF-REQ-10527-1', orderType: 'INTER_PROJECT', orderStatus: 'PENDING', sourceOrgId: 3001, destinationOrgId: 3002, requestedDate: day(-3), createdDate: day(-3) },
  ];
  const TO_LINES = {
    300: [{ requestLineId: 4751, serialNumber: 'DT-1108', quantity: 1 }, { requestLineId: 4752, serialNumber: 'DT-1112', quantity: 1 }],
    310: [{ requestLineId: 9001, serialNumber: 'MC-11', quantity: 1 }, { requestLineId: 9006, serialNumber: 'MC-07', quantity: 1 }],
    320: [{ requestLineId: 5101, serialNumber: 'EX-2201', quantity: 1 }],
    330: [{ requestLineId: 5601, serialNumber: 'LT-0300', quantity: 1 }],
  };
  const RLINES = TL.indexLines([
    { lineId: 4751, equipmentName: 'Dump Truck 30t', lineStatus: 'DEPLOYED' }, { lineId: 4752, equipmentName: 'Dump Truck 30t', lineStatus: 'RETURNED' },
    { lineId: 9001, equipmentName: 'Mobile Crane 50t', lineStatus: 'PICK_RELEASED' }, { lineId: 9006, equipmentName: 'Mobile Crane 50t', lineStatus: 'DEPLOYED' },
    { lineId: 5101, equipmentName: 'Excavator 20t', lineStatus: 'SHIP_TO_SITE' }, { lineId: 5601, equipmentName: 'Light tower', lineStatus: 'SHIPPED_TO_YARD' },
  ]);
  const REQS = TL.indexRequests([{ eqrEquipmentRequestId: 475, requestNumber: 'REQ-10475', projectName: 'Pipeline North' },
    { eqrEquipmentRequestId: 501, requestNumber: 'REQ-10505', customerName: 'Acme' }]);
  const ctx = { orgs: ORGS, requests: REQS, toLines: TO_LINES, lines: RLINES, history: HIST, now: NOW };
  const rows = ORDERS.concat(TL.historyOnly(ORDERS, HIST)).map((o) => TL.decorate(o, ctx));
  const by = (n) => rows.find((r) => r.number === n);
  const brief = (r) => [r.kindLabel, r.label, r.stage, r.detail, r.late ? r.lateText : '', r.read ? 'read' : 'not read'].join(' | ');
  T.eq('stored PENDING, every unit on site or back: arrived', brief(by('TO-300')), 'Out to site | Arrived on site | onsite |  |  | read');
  T.eq('one unit still at the yard: named by it, the rest counted, late', brief(by('TO-310')),
    'Out to site | Being picked at the yard | ready | 1 arrived · 1 not left yet | Due on site 28 Oct · 2 days late | read');
  T.eq('on the way, not yet due', brief(by('TO-320')) + ' | ' + by('TO-320').dueText, 'Out to site | On the way to site | out |  |  | read | Due on site 4 Nov 2026 (in 5 days)');
  T.eq('a return on its way back, late', brief(by('TO-330')), 'Back to the yard | On the way back to the yard | back |  | Due back at the yard 29 Oct · 1 day late | read');
  T.eq('cancelled', brief(by('TO-340')), 'Out to site | Cancelled | done |  |  | not read');
  T.eq('not read: never called late from a stored status', brief(by('TO-350')), 'Out to site | Open it to see where it is | draft |  |  | not read');
  T.eq('failed in Fusion', brief(by('TO-360')), 'Out to site | Failed in Fusion: retry it in New EquipRite | stopped |  |  | not read');
  T.eq('between projects, PENDING: waiting for Fusion, never moved', brief(by('EQR-TRF-REQ-10527-1')),
    'Between projects | Waiting for the inter-org transfer in Fusion | ready | The units stay on REQ-10475 until it completes | Transfer date 27 Oct · waiting 3 days for Fusion | read');
  T.eq('... from its history: the request it comes from, what moves', [by('EQR-TRF-REQ-10527-1').fromRequest, by('EQR-TRF-REQ-10527-1').what, by('EQR-TRF-REQ-10527-1').route].join(' | '),
    'REQ-10475 · Pipeline North | Dump Truck 30t · DT-1108 | TEXAS · Texas project sites → Org 3002');
  T.eq('an inter-project transfer with no order of its own is listed, completed', brief(by('INV-TX 882104')) + ' | ' + by('INV-TX 882104').key,
    'Between projects | Moved to the new project | onsite |  |  | read | h:880');
  T.eq('a third history row with no order or number is listed too', rows.filter((r) => r.synthetic).length, 2);
  T.eq('the request and its project or customer', [by('TO-300').requestNumber + ' · ' + by('TO-300').party, by('TO-310').party, by('TO-320').requestNumber].join(' | '),
    'REQ-10475 · Pipeline North | Acme | Request 510');
  T.eq('what is moving', by('TO-310').what + ' | ' + by('TO-310').units.map((u) => u.serial + ':' + u.state.words).join(', '),
    'Mobile Crane 50t · MC-11 +1 | MC-11:Being picked at the yard, MC-07:Arrived on site');
  T.eq('a unit\'s place, by leg', [['out', 'SCHEDULED_FOR_PICKING'], ['out', 'INSPECTION_FAILED'], ['out', 'SHIPPED'], ['back', 'DEPLOYED'], ['back', 'RETURN_INITIATED'],
    ['back', 'RETURN_IN_PROCESS'], ['back', 'CLOSED'], ['out', 'ODD_STATUS']].map(([k, s]) => TL.unitState(k, s).words).join(' | '),
  'Waiting to be picked | Failed inspection at the yard | On the way to site | Waiting for pickup at site | Return asked for, waiting for pickup | Being returned | Back at the yard | Odd status');
  T.eq('a failed inspection on an order stops it, first', TL.stateFromUnits('out', TL.unitsOf('out', [{ requestLineId: 1 }, { requestLineId: 2 }],
    TL.indexLines([{ lineId: 1, lineStatus: 'INSPECTION_FAILED' }, { lineId: 2, lineStatus: 'SHIPPED' }]))).label, 'Failed inspection at the yard');

  T.section('transfers: which orders are read, the list');
  T.eq('open orders are read, newest first (not cancelled, not received, not between projects)', TL.toRead(ORDERS.concat([{ id: 370, orderType: 'OUTBOUND', receivedDate: day(-1) }]), 60)
    .map((o) => o.id).join(), '320,330,360,310,300,350');
  T.eq('... at most so many', TL.toRead(ORDERS, 2).map((o) => o.id).join(), '320,330');
  T.eq('chips', TL.chips(rows).map((c) => c.key + ':' + c.count).join(' '), 'all:10 late:3 waiting:2 moving:2 arrived:2 stopped:1');
  T.eq('kinds', TL.kinds(rows).map((c) => c.key + ':' + c.count).join(' '), 'all:10 out:6 back:1 between:3');
  T.eq('filters', [TL.filter(rows, 'late', 'all', '').map((r) => r.number).join(), TL.filter(rows, 'all', 'back', '').map((r) => r.number).join(),
    TL.filter(rows, 'all', 'all', 'dt-1112').map((r) => r.number).join(), TL.filter(rows, 'all', 'all', 'houston').map((r) => r.number).join()].join(' | '),
  'TO-310,TO-330,EQR-TRF-REQ-10527-1 | TO-330 | TO-300 | TO-300,TO-310,TO-330');
  T.eq('sort by due: what is open first, most overdue first', TL.sort(rows, 'due', 'asc').map((r) => r.number).join(', '),
    'TO-360, EQR-TRF-REQ-10527-1, TO-310, TO-330, TO-320, TO-300, TO-350, TO-340, INV-TX 882104, Transfer');
  T.eq('sort by where it is', TL.sort(rows, 'state', 'asc').slice(0, 3).map((r) => r.state).join(), 'stopped,waiting,waiting');
  T.eq('sort by number, both ways', TL.sort(rows, 'number', 'asc').slice(0, 2).map((r) => r.number).join() + ' / ' + TL.sort(rows, 'number', 'desc')[0].number,
    'EQR-TRF-REQ-10527-1,INV-TX 882104 / Transfer');
  T.eq('summary', TL.summary(rows), '10 transfers · 2 not left yet · 2 on the way · 1 stopped · 3 late');
  const tcols = TL.exportColumns();
  T.eq('export: a row as a person reads it, the stored status kept', tcols.map((c) => (c.value ? c.value(by('TO-310')) : by('TO-310')[c.key])).join(' | '),
    'TO-310 | Out to site | REQ-10505 | Acme |  | YARD1 · Houston yard | TEXAS · Texas project sites | Mobile Crane 50t · MC-11; Mobile Crane 50t · MC-07 | 2 | Being picked at the yard'
    + ' | 1 arrived · 1 not left yet | ' + day(-2) + ' | 2 |  | ' + day(-2) + ' |  |  |  |  | PENDING');

  T.section('transfer chains: the list reads, and only reads');
  {
    requestData.rows = [{ eqrEquipmentRequestId: 475, requestNumber: 'REQ-10475', projectName: 'Pipeline North' }];
    const { calls, Actions } = fake((o) => {
      if (o.endpoint === 'eqp-v1/getTransferOrders') return ok({ data: ORDERS });
      if (o.endpoint === 'eqp-v1/getTransferHistory') return ok({ data: HIST });
      if (o.endpoint === 'eqp-v1/getInvOrgs') return ok({ data: ORGS });
      if (o.endpoint === 'eqp-v1/getTransferOrderLines') return ok({ data: TO_LINES[o.uriParams.transferOrderId] || [] });
      if (o.endpoint === 'eqp-v1/getEquipriteV1ViewsRequestDetailLines') return ok({ data: [{ lineId: 9001, requestNumber: 'REQ-10505', projectName: 'Pipeline North', lineStatus: 'PICK_RELEASED' }] });
      return undefined;
    });
    const v = { orders: [], history: [], orgs: [], requests: {}, toLines: {}, lines: {}, rows: [], shown: [], chips: [], kindChips: [], chip: 'all', kind: 'all', text: '',
      sortKey: 'due', sortDir: 'asc', summary: '', limit: 100, isLoading: true, detailLoading: false, loadToken: 0, error: '', note: '', exportOpen: false };
    const c = context(new NextTransfers(), v);
    await new (nextChain('transfers', 'loadChain', Actions))().run(c, { refresh: false });
    T.eq('first the orders, the history and the sites', rest(calls).slice(0, 3).join(), 'getTransferOrders,getTransferHistory,getInvOrgs');
    T.eq('then the open orders\' units and their requests', rest(calls).slice(3).join(),
      'getTransferOrderLines,getTransferOrderLines,getTransferOrderLines,getTransferOrderLines,getTransferOrderLines,getTransferOrderLines,'
      + 'getEquipriteV1ViewsRequestDetailLines,getEquipriteV1ViewsRequestDetailLines,getEquipriteV1ViewsRequestDetailLines,getEquipriteV1ViewsRequestDetailLines,getEquipriteV1ViewsRequestDetailLines');
    T.eq('... which orders', calls.filter((x) => x.endpoint === 'eqp-v1/getTransferOrderLines').map((x) => x.uriParams.transferOrderId).join(), '320,330,360,310,300,350');
    T.eq('nothing is written', writes(calls).length, 0);
    T.check('the list is worked out twice: at once, then with the units', calls.filter((x) => x.chain === 'applyChain').length === 2 && !v.isLoading && !v.detailLoading);
    T.eq('the requests named from their lines when the shared list lacks them', JSON.stringify(v.requests['501']), '{"number":"REQ-10505","party":"Pipeline North"}');
  }
  {
    const { calls, Actions } = fake((o) => (o.endpoint === 'eqp-v1/getTransferOrders' ? fail(503) : ok({ data: [] })));
    const v = { orders: [], history: [], orgs: [], requests: {}, toLines: {}, lines: {}, chip: 'all', kind: 'all', text: '', sortKey: 'due', sortDir: 'asc', loadToken: 0 };
    const c = context(new NextTransfers(), v);
    await new (nextChain('transfers', 'loadChain', Actions))().run(c, { refresh: true });
    T.eq('the orders failing: said in words, no lines asked for', v.error + ' | ' + rest(calls).filter((x) => /Lines/.test(x)).length, 'Could not load the transfer orders (HTTP 503). | 0');
  }
  {
    const opened = busLog.length;
    await new (nextChain('transfers', 'openRecordChain', fake().Actions))().run({}, { id: '880', number: 'INV-TX 882104', source: 'history' });
    await new (nextChain('transfers', 'openRecordChain', fake().Actions))().run({}, { id: '310', number: 'TO-310', source: '' });
    T.eq('a transfer opens in its own tab; one with no order of its own says so', busLog.slice(opened).join(' / '),
      'open {"record":"transfer","params":{"id":880,"number":"INV-TX 882104","source":"history"}} / open {"record":"transfer","params":{"id":310,"number":"TO-310"}}');
  }

  T.section('transfer chains: a transfer\'s tab');
  {
    const answer = (o) => {
      if (o.endpoint === 'eqp-v1/getTransferOrderById') return ORDERS.find((x) => x.id === o.uriParams.id) ? ok(ORDERS.find((x) => x.id === o.uriParams.id)) : fail(404);
      if (o.endpoint === 'eqp-v1/getTransferOrders') return ok({ data: ORDERS });
      if (o.endpoint === 'eqp-v1/getTransferOrderLines') return ok({ data: TO_LINES[o.uriParams.transferOrderId] || [] });
      if (o.endpoint === 'eqp-v1/getInvOrgs') return ok({ data: ORGS });
      if (o.endpoint === 'eqp-v1/getEquipriteV1ViewsRequestDetailLines') {
        return ok({ data: [{ lineId: 9001, requestNumber: 'REQ-10505', projectName: 'Pipeline North', equipmentName: 'Mobile Crane 50t', lineStatus: 'PICK_RELEASED' },
          { lineId: 9006, requestNumber: 'REQ-10505', equipmentName: 'Mobile Crane 50t', lineStatus: 'DEPLOYED' }] });
      }
      if (o.endpoint === 'eqp-v1/getTransferHistory') {
        const id = o.uriParams.equipmentRequestId;
        return ok({ data: id ? HIST.filter((h) => h.sourceRequestId === id || h.destinationRequestId === id) : HIST });
      }
      return undefined;
    };
    const rec = async (params) => {
      const { calls, Actions } = fake(answer);
      const v = Object.assign({ id: '', number: '', source: '', head: {}, units: [], historyRows: [], isLoading: true, error: '', note: '', exportOpen: false }, params);
      const c = context(new NextTransfer(), v);
      const before = busLog.length;
      await new (nextChain('transfer', 'loadRecordChain', Actions))().run(c, {});
      return { calls, v, bus: busLog.slice(before) };
    };
    const r310 = await rec({ id: '310', number: 'TO-310' });
    T.eq('by id: the order, its lines, the sites, then its request\'s lines and history', rest(r310.calls).join(),
      'getInvOrgs,getTransferOrderById,getTransferOrderLines,getEquipriteV1ViewsRequestDetailLines,getTransferHistory');
    T.eq('where it is, unit by unit', [r310.v.head.label, r310.v.units.map((u) => u.state.words).join(', '), r310.v.head.lateText].join(' | '),
      'Being picked at the yard | Being picked at the yard, Arrived on site | Due on site 28 Oct · 2 days late');
    T.eq('the tab is named after it', r310.bus.join(), 'rename transfer:310=TO-310');
    T.eq('nothing is written', writes(r310.calls).length, 0);
    const byNumber = await rec({ number: 'TO-320' });
    T.eq('by number: found among the orders', rest(byNumber.calls).slice(0, 3).join() + ' | ' + byNumber.v.head.number, 'getInvOrgs,getTransferOrders,getTransferOrderLines | TO-320');
    const h = await rec({ id: '880', number: 'INV-TX 882104', source: 'history' });
    T.eq('no order of its own: read from the history, never asked for', rest(h.calls).filter((x) => x === 'getTransferOrderById').length + ' | ' + h.v.head.label
      + ' | ' + h.v.units.length + ' unit | ' + h.v.historyRows.length + ' history row', '0 | Moved to the new project | 1 unit | 1 history row');
    const lost = await rec({ id: '999', number: 'TO-999' });
    T.eq('not found: said in words', lost.v.error, 'Transfer TO-999 was not found.');
    const tpage = new NextTransfer();
    T.eq('act on it in New: the same screen there, per kind', ['out', 'back', 'between'].map((k) => tpage.newUrl('http://new/', { newNav: TL.KINDS[{ out: 'OUTBOUND', back: 'INBOUND', between: 'INTER_PROJECT' }[k]].newNav })).join(' | '),
      'http://new/vp/shell/logistics/picking | http://new/vp/shell/logistics/receipt | http://new/vp/shell/operations/transfers');
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════
  // The pages
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════

  T.section('every endpoint the chains call exists in services/; Fusion is not written');
  const ops = {};
  ['eqp-v1', 'commonService'].forEach((svc) => {
    const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'services', svc, 'openapi3.json'), 'utf8'));
    Object.values(spec.paths || {}).forEach((p) => Object.values(p).forEach((op2) => { if (op2 && op2.operationId) ops[svc + '/' + op2.operationId] = true; }));
  });
  const chainDirs = ['inspection', 'transfers', 'transfer'].map((p) => path.join(PAGES, p + '-page-chains'));
  const usedBy = {};
  chainDirs.forEach((dir) => fs.readdirSync(dir).forEach((f) => {
    (fs.readFileSync(path.join(dir, f), 'utf8').match(/'[A-Za-z0-9_-]+\/[A-Za-z0-9_]+'/g) || []).filter((m) => /^'(eqp-v1|commonService|ics|fusion)/i.test(m))
      .forEach((m) => { (usedBy[path.basename(dir)] = usedBy[path.basename(dir)] || new Set()).add(m.slice(1, -1)); });
  }));
  const all = new Set([].concat(...Object.values(usedBy).map((s) => [...s])));
  [...all].sort().forEach((e) => T.check(e, !!ops[e]));
  T.eq('the inspection writes are New\'s, no more', [...usedBy['inspection-page-chains']].filter((e) => !/\/get/.test(e)).sort().join(),
    'commonService/uploadCommonDocument,eqp-v1/createInspection,eqp-v1/createInspectionDefect,eqp-v1/createInspectionResponse,eqp-v1/patchInspection,eqp-v1/patchInspectionResponse');
  T.check('... and the line status through requestLineBody (lines/batch)', /lineBody\.updateLines/.test(fs.readFileSync(path.join(PAGES, 'inspection-page-chains', 'completeInspectionChain.js'), 'utf8')));
  T.eq('transfers only read', [...usedBy['transfers-page-chains']].concat([...usedBy['transfer-page-chains']]).filter((e) => !/\/get/.test(e)).join(), '');
  T.check('nothing calls ICS or Fusion', ![...all].some((e) => /^(ics|fusion)/i.test(e)));

  T.section('pages: listeners, functions, variables and chains line up; VB binding rules');
  const flow = JSON.parse(fs.readFileSync(path.join(NEXT, 'flows', 'checks', 'checks-flow.json'), 'utf8'));
  T.eq('the flow: its pages, embeddable', flow.id + ':' + Object.keys(flow.pages).join(',') + ':' + flow.navigation.embeddable, 'checks:inspection,transfers,transfer:enabled');
  const modules = { inspection: new NextInspection(), transfers: new NextTransfers(), transfer: new NextTransfer() };
  Object.keys(modules).forEach((name) => {
    const html = fs.readFileSync(path.join(PAGES, name + '-page.html'), 'utf8');
    const json = JSON.parse(fs.readFileSync(path.join(PAGES, name + '-page.json'), 'utf8'));
    const dir = path.join(PAGES, name + '-page-chains');
    T.eq(name + ': embeddable', json.navigation && json.navigation.embeddable, 'enabled');
    const listeners = [...new Set((html.match(/\$listeners\.([A-Za-z]+)/g) || []).map((m) => m.split('.')[1]))];
    T.check(name + ': every listener in the HTML is declared (' + listeners.length + ')', listeners.every((l) => json.eventListeners[l]), listeners.filter((l) => !json.eventListeners[l]).join(', '));
    const named = [...new Set([].concat(...Object.values(json.eventListeners).map((l) => l.chains.map((c) => c.chain))))];
    const files = fs.readdirSync(dir).map((f) => f.replace(/\.js$/, ''));
    T.check(name + ': every chain the page names exists', named.every((c) => files.includes(c)), named.filter((c) => !files.includes(c)).join(', '));
    T.check(name + ': each chain is a class named like its file', files.every((f) => new RegExp('class ' + f + ' extends ActionChain').test(fs.readFileSync(path.join(dir, f + '.js'), 'utf8'))));
    const called = new Set();
    files.forEach((f) => (fs.readFileSync(path.join(dir, f + '.js'), 'utf8').match(/chain: '([A-Za-z]+)'/g) || []).forEach((m) => called.add(m.split("'")[1])));
    T.check(name + ': every chain the chains call exists', [...called].every((c) => files.includes(c)), [...called].filter((c) => !files.includes(c)).join(', '));
    const fns = [...new Set((html.match(/\$functions\.([A-Za-z]+)/g) || []).map((m) => m.split('.')[1]))];
    T.check(name + ': every function in the HTML exists (' + fns.length + ')', fns.every((f) => typeof modules[name][f] === 'function'), fns.filter((f) => typeof modules[name][f] !== 'function').join(', '));
    const fnsChains = new Set();
    files.forEach((f) => (fs.readFileSync(path.join(dir, f + '.js'), 'utf8').match(/fns\.([A-Za-z]+)\(/g) || []).forEach((m) => fnsChains.add(m.slice(4, -1))));
    T.check(name + ': every page function the chains call exists', [...fnsChains].every((f) => typeof modules[name][f] === 'function'), [...fnsChains].filter((f) => typeof modules[name][f] !== 'function').join(', '));
    const declared = new Set(Object.keys(json.variables));
    const usedVars = new Set();
    [html].concat(files.map((f) => fs.readFileSync(path.join(dir, f + '.js'), 'utf8'))).forEach((src) => {
      (src.match(/\$variables\.([A-Za-z]+)/g) || []).forEach((m) => usedVars.add(m.split('.')[1]));
      (src.match(/\bv\.([A-Za-z]+)\s*=[^=]/g) || []).forEach((m) => usedVars.add(m.slice(2).split(/\s*=/)[0]));
    });
    const missing = [...usedVars].filter((x) => !declared.has(x));
    T.check(name + ': every variable used is declared', missing.length === 0, missing.join(', '));
    const bindings = html.match(/\[\[[\s\S]*?\]\]/g) || [];
    T.check(name + ': no arrow functions, String(), Number(), Boolean() or object literals in bindings',
      !bindings.some((b) => /=>|function\s*\(|\bString\(|\bNumber\(|\bBoolean\(|\{\s*[A-Za-z]+\s*:/.test(b)), bindings.filter((b) => /=>|function\s*\(|\bString\(|\bNumber\(|\bBoolean\(|\{\s*[A-Za-z]+\s*:/.test(b)).join(' '));
    T.check(name + ': no oj-bind-for-each inside table, tbody or select', !/<(table|tbody|select)[\s\S]*?oj-bind-for-each[\s\S]*?<\/\1>/.test(html));
    T.check(name + ': no :style', !/:style=/.test(html));
  });
  T.check('the record takes its id and number from the tab', ['id', 'number', 'source'].every((k) => JSON.parse(fs.readFileSync(path.join(PAGES, 'transfer-page.json'), 'utf8')).variables[k].input === 'fromCaller'));
  T.check('nothing is written on page entry', ['inspection', 'transfers', 'transfer'].every((name) => {
    const json = JSON.parse(fs.readFileSync(path.join(PAGES, name + '-page.json'), 'utf8'));
    return json.eventListeners.vbEnter.chains.every((c) => !/complete|create|save|retry/i.test(c.chain));
  }));

  T.section('the menu, the record kind, the stylesheet');
  T.eq('Inspections and Transfers are built, in the checks flow', JSON.stringify([nav.routeOf(nav.item('inspection')), nav.routeOf(nav.item('transfers'))]),
    '[{"flow":"checks","page":"inspection","params":{}},{"flow":"checks","page":"transfers","params":{}}]');
  T.eq('a transfer opens in its own tab', JSON.stringify(tabs.forRecord('transfer', { id: 310, number: 'TO-310' })),
    '{"id":"transfer:310","flow":"checks","page":"transfer","params":{"id":310,"number":"TO-310"},"title":"TO-310","icon":"oj-ux-ico-inventory-transfer","navId":"transfers","pinned":false}');
  T.eq('... a deep link to one', tabs.fromQuery('?open=transfer&id=310&number=TO-310').id, 'transfer:310');
  T.eq('... restored after a restart', tabs.restore(JSON.stringify({ tabs: [{ id: 'transfer:880', params: { id: 880, number: 'INV-TX 882104', source: 'history' }, title: 'INV-TX 882104' }], current: 'transfer:880' }))
    .tabs.map((t) => t.id + '=' + t.title + ':' + t.params.source).join(), 'home=My work:undefined,transfer:880=INV-TX 882104:history');
  T.eq('the screens in New, for what Next does not do', [nav.newUrl('http://new', 'inspection'), nav.newUrl('http://new', 'transfers')].join(' | '),
    'http://new/vp/shell/operations/inspection | http://new/vp/shell/operations/transfers');
  const app = JSON.parse(fs.readFileSync(path.join(NEXT, 'app-flow.json'), 'utf8'));
  T.check('the stylesheet is imported and exists', app.imports.css.includes('resources/css/next-checks.css') && fs.existsSync(path.join(NEXT, 'resources', 'css', 'next-checks.css')));
  const css = fs.readFileSync(path.join(NEXT, 'resources', 'css', 'next-checks.css'), 'utf8');
  const selectors = (css.replace(/\/\*[\s\S]*?\*\//g, '').match(/(^|\})\s*([^{}@]+)\{/g) || []).map((m) => m.replace(/^\}?\s*/, '').replace(/\{$/, '').trim());
  T.check('the stylesheet only styles this area\'s own classes (nx-insp-*, nx-trf-*, its grids)', selectors.every((s) => s.split(',').every((part) => /\.nx-(insp|trf|grid--trf)/.test(part))),
    selectors.filter((s) => !s.split(',').every((part) => /\.nx-(insp|trf|grid--trf)/.test(part))).join(' | '));

  T.report();
})();
