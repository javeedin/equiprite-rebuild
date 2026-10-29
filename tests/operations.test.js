/*
 * New EquipRite, Fulfil operations: Inspection and Inter-project transfer (webApps/equiprite/flows/operations).
 *
 * Neither screen exists in Old EquipRite, so these pin the rules and the calls against the backend contract
 * (services/eqp-v1/openapi3.json, services/commonService/openapi3.json):
 *   - inspection: points and the inspection matrix, the checklist, scoring, the PASS / CONDITIONAL / FAIL rule,
 *     what blocks Complete, the bodies, and the save sequence with every failure and retry path
 *   - transfer: request and line matching, the checks (equipment, dates, timesheets, one to one), plan / reserve /
 *     order / lines / history, and every failure path
 *   - every endpoint the chains call exists; the HTML only names listeners and functions that exist
 *
 * Run:  node tests/operations.test.js
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
const PAGES = path.join(NEW, 'flows', 'operations', 'pages');
const INSP = path.join(PAGES, 'inspection-page-chains');
const TRF = path.join(PAGES, 'transfers-page-chains');
const JS = path.join(NEW, 'resources', 'js');

function loadAmd(file, deps) {
  const sandbox = {
    console, setTimeout, Promise, Blob, Date, Math, JSON, Number, String, Object, Array, isNaN, encodeURIComponent,
    URL: { createObjectURL: () => 'blob:preview', revokeObjectURL() {} },
  };
  let mod;
  sandbox.define = (names, factory) => { mod = factory(...names.map((n) => (deps && n in deps ? deps[n] : {}))); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: path.basename(file) });
  return mod;
}

const lineBody = loadAmd(path.join(JS, 'requestLineBody.js'));
const InspectionPage = loadAmd(path.join(PAGES, 'inspection-page.js'));
const TransfersPage = loadAmd(path.join(PAGES, 'transfers-page.js'));
const cu = { auditHeaders: () => ({ 'X-User-Id': 'mia.ortiz' }), auditActor: () => 'mia.ortiz', displayName: () => 'Mia Ortiz' };

function chain(dir, name, Actions) {
  return loadAmd(path.join(dir, name + '.js'), {
    'vb/action/actionChain': class {}, 'vb/action/actions': Actions,
    'resources/js/currentUser': cu, 'resources/js/requestLineBody': lineBody,
  });
}

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

function context(page, variables, appVars) {
  return {
    $page: { variables, functions: page },
    $application: {
      variables: Object.assign({ featureFlags: { TIMESHEETS_ENABLED: 'true' }, flagsLoaded: true, oldAppUrl: '' }, appVars || {}),
      functions: { isFeatureEnabled: (f, l, k) => !!(l && f && f[k] === 'true') },
      user: {},
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// Inspection
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

const LINES = [
  { lineId: 9001, requestId: 501, requestNumber: 'REQ-10505', projectName: 'Pipeline North', equipmentMasterId: 61, equipmentClassId: 10, equipmentSubclassId: 101,
    equipmentName: 'Mobile Crane 50t', className: 'Cranes', allocatedSerial: 'MC-11', lineStatus: 'PICK_RELEASED', startDate: '2026-11-02' },
  { lineId: 9002, requestId: 501, requestNumber: 'REQ-10505', equipmentClassId: 20, equipmentSubclassId: 201, equipmentName: 'Generator 100 kVA',
    className: 'Power', allocatedSerial: 'GN-0419', lineStatus: 'PICK_RELEASED', startDate: '2026-11-01' },
  { lineId: 9003, requestId: 502, requestNumber: 'REQ-10510', equipmentClassId: 30, equipmentName: 'Light tower', allocatedSerial: 'LT-0207', lineStatus: 'SHIPPED_TO_YARD' },
  { lineId: 9004, requestId: 502, equipmentClassId: 40, equipmentName: 'Compactor', lineStatus: 'INSPECTION_FAILED' },
  { lineId: 9005, requestId: 503, equipmentClassId: 10, equipmentSubclassId: 102, equipmentName: 'Tower crane', lineStatus: 'RETURN_INITIATED' },
];
const MATRIX = [
  { equipmentClassId: 10, equipmentSubclassId: 101, inspectionType: 'SHIP_OUT_YARD', isActiveFlag: 'Y', isMandatoryFlag: 'Y' },
  { equipmentClassId: 20, equipmentSubclassId: null, inspectionType: 'Ship out of yard', isActiveFlag: 'Y' },
  { equipmentClassId: 30, inspectionType: 'RECEIVE_AT_YARD', isActiveFlag: 'Y' },
  { equipmentClassId: 10, equipmentSubclassId: 102, inspectionType: 'SHIP_OUT_SITE', isActiveFlag: 'N' },
];
const CHECK10 = [
  { id: 701, questionText: 'Load chart and certificate on board', responseType: 'YES_NO', isMandatoryFlag: 'Y', sequenceNumber: 1 },
  { id: 702, questionText: 'Wire rope and hook', responseType: 'PASS_FAIL', isMandatoryFlag: 'Y', sequenceNumber: 2 },
  { id: 703, questionText: 'Outrigger pad thickness', responseType: 'NUMERIC', minValue: 40, maxValue: 60, uom: 'mm', isMandatoryFlag: 'Y', sequenceNumber: 3 },
  { id: 704, questionText: 'Cab cleanliness', responseType: 'RATING', maxValue: 5, isMandatoryFlag: 'N', sequenceNumber: 4 },
  { id: 705, questionText: 'Tower jib bolts', responseType: 'PASS_FAIL', equipmentSubclassId: 102, sequenceNumber: 5 },
  { id: 706, questionText: 'Return-leg only check', responseType: 'TEXT', inspectionType: 'RECEIVE_YARD', sequenceNumber: 0 },
  { id: 707, questionText: 'Retired check', isActiveFlag: 'N' },
];

const ip = new InspectionPage();
T.section('inspection: points and the matrix');
T.eq('point codes as stored are read', ['SHIP_OUT_YARD', 'Ship out of yard', 'RECEIVE_AT_SITE', 'receive at yard', 'SHIP_OUT_OF_SITE', 'CHECKOUT', '']
  .map((c) => ip.pointKey(c)).join(','), 'SHIP_OUT_YARD,SHIP_OUT_YARD,RECEIVE_SITE,RECEIVE_YARD,SHIP_OUT_SITE,,');
T.eq('a picked line waits for the yard ship-out', ip.pointForLine(LINES[0]).key, 'SHIP_OUT_YARD');
T.eq('a failed line waits there again', ip.pointForLine(LINES[3]).key, 'SHIP_OUT_YARD');
T.eq('a line on its way back waits to be received at the yard', ip.pointForLine(LINES[2], 'in').key, 'RECEIVE_YARD');
T.eq('a deployed line waits nowhere', ip.pointForLine({ lineStatus: 'DEPLOYED' }), null);
T.check('the matrix row for class + subclass + point', !!ip.matrixRule(MATRIX, LINES[0], 'SHIP_OUT_YARD'));
T.check('a class-wide row covers every subclass', !!ip.matrixRule(MATRIX, LINES[1], 'SHIP_OUT_YARD'));
T.check('another subclass is not covered', !ip.matrixRule(MATRIX, Object.assign({}, LINES[0], { equipmentSubclassId: 199 }), 'SHIP_OUT_YARD'));
T.check('an inactive row asks for nothing', !ip.matrixRule(MATRIX, LINES[4], 'SHIP_OUT_SITE'));
T.check('another point is not covered', !ip.matrixRule(MATRIX, LINES[0], 'RECEIVE_SITE'));

T.section('inspection: the queue');
T.eq('check-out, required: only what the matrix asks for, earliest first',
  ip.queue(LINES, MATRIX, 'out', '', 'required').map((l) => l.lineId).join(','), '9002,9001');
T.eq('check-out, everything waiting: the required ones first',
  ip.queue(LINES, MATRIX, 'out', '', 'all').map((l) => l.lineId + (l.required ? '*' : '')).join(','), '9002*,9001*,9004,9005');
T.eq('check-in', ip.queue(LINES, MATRIX, 'in', '', 'required').map((l) => l.lineId + ':' + l.point).join(','), '9003:RECEIVE_YARD');
T.eq('one point', ip.queue(LINES, MATRIX, 'out', 'SHIP_OUT_SITE', 'all').map((l) => l.lineId).join(','), '9005');
T.eq('point chips with counts', ip.pointChips(LINES, MATRIX, 'out', 'all').map((c) => c.label + ':' + c.count).join(','),
  'All leaving:4,Ship-out from yard:3,Ship-out from site:1');
T.eq('mode counts for the band', ip.modeCount(LINES, MATRIX, 'out', 'required') + '/' + ip.modeCount(LINES, MATRIX, 'in', 'required'), '2/1');
T.eq('the next unit after one is done', ip.nextInQueue(ip.queue(LINES, MATRIX, 'out', '', 'required'), 9002).lineId, 9001);
T.eq('unit text', ip.unitText(LINES[0]), 'Mobile Crane 50t · MC-11');

T.section('inspection: the checklist');
const ITEMS = ip.checklistFor(CHECK10, LINES[0], 'SHIP_OUT_YARD');
T.eq('class checklist, narrowed to the subclass and the point, active only, in sequence', ITEMS.map((i) => i.checklistId).join(','), '701,702,703,704');
T.eq('types', ITEMS.map((i) => i.type).join(','), 'YES_NO,PASS_FAIL,NUMERIC,RATING');
T.eq('required from isMandatoryFlag', ITEMS.map((i) => (i.required ? 'R' : 'o')).join(''), 'RRRo');
T.eq('range and unit', JSON.stringify([ITEMS[2].min, ITEMS[2].max, ITEMS[2].unit, ip.rangeText(ITEMS[2])]), '[40,60,"mm","Allowed 40–60 mm"]');
const loose = ip.checklistItem({ question: 'Horn works' }, 0);
T.eq('a row without type or flag is a required pass / fail question', [loose.type, loose.required, loose.text].join('|'), 'PASS_FAIL|true|Horn works');
T.eq('other spellings: answerType, isRequired, displaySequence', JSON.stringify(ip.checklistItem({ id: 9, answerType: 'Yes/No', isRequired: false, displaySequence: 3 }, 1)
  ? [ip.checklistItem({ id: 9, answerType: 'Yes/No', isRequired: false, displaySequence: 3 }, 1).type, ip.checklistItem({ id: 9, answerType: 'Yes/No', isRequired: false }, 1).required]
  : null), '["YES_NO",false]');
T.eq('rating scale defaults to 5', ip.checklistItem({ responseType: 'RATING' }, 0).max, 5);

T.section('inspection: answers and the score');
const A = (v, note) => ({ value: v, note });
T.eq('yes / no against the expected answer', [ip.answerState(ITEMS[0], A('YES')), ip.answerState(ITEMS[0], A('NO')),
  ip.answerState(Object.assign({}, ITEMS[0], { expected: 'NO' }), A('NO'))].join(','), 'ok,fault,ok');
T.eq('pass / fail', ip.answerState(ITEMS[1], A('PASS')) + ',' + ip.answerState(ITEMS[1], A('FAIL')), 'ok,fault');
T.eq('a reading inside, outside, not a number', ['52', '38', '61', 'abc'].map((v) => ip.answerState(ITEMS[2], A(v))).join(','), 'ok,fault,fault,invalid');
T.eq('a rating of 2 of 5 or less is low', ['1', '2', '3', '5'].map((v) => ip.answerState(ITEMS[3], A(v))).join(','), 'marginal,marginal,ok,ok');
T.eq('text is noted, nothing is open', ip.answerState({ type: 'TEXT' }, A('scratched')) + ',' + ip.answerState(ITEMS[0], null), 'info,open');
T.eq('answer text', [ip.answerText(ITEMS[0], A('YES')), ip.answerText(ITEMS[1], A('FAIL')), ip.answerText(ITEMS[2], A('52')), ip.answerText(ITEMS[3], A('4'))].join('|'),
  'Yes|Fail|52 mm|4 of 5');
T.eq('answer buttons', ip.choices(ITEMS[1], A('FAIL')).map((c) => c.label + (c.on ? '*' : '') + ':' + c.tone).join(','), 'Pass:ok,Fail*:fault');
T.eq('rating buttons', ip.choices(ITEMS[3], null).map((c) => c.tone[0]).join(''), 'mmooo');
const ANS_FAIL = { 701: A('YES'), 702: A('FAIL', 'Two broken wires'), 703: A('52'), 704: A('4') };
const sc = ip.score(ITEMS, ANS_FAIL);
T.eq('score: answered, ok, fault, percent', [sc.answered, sc.ok, sc.fault, sc.requiredOpen, sc.percent].join(','), '4,3,1,0,75');
T.eq('score of an empty sheet', JSON.stringify([ip.score(ITEMS, {}).requiredOpen, ip.score(ITEMS, {}).percent]), '[3,null]');

T.section('inspection: pass / conditional / fail');
const ANS_PASS = { 701: A('YES'), 702: A('PASS'), 703: A('50'), 704: A('5') };
T.eq('everything fine: PASS', ip.result(ITEMS, ANS_PASS, []).code, 'PASS');
T.eq('optional question skipped is still PASS', ip.result(ITEMS, { 701: A('YES'), 702: A('PASS'), 703: A('50') }, []).code, 'PASS');
T.eq('a required question failed: FAIL', ip.result(ITEMS, ANS_FAIL, []).code, 'FAIL');
T.eq('a reading out of range on a required question: FAIL', ip.result(ITEMS, Object.assign({}, ANS_PASS, { 703: A('70') }), []).code, 'FAIL');
T.eq('a low rating: CONDITIONAL', ip.result(ITEMS, Object.assign({}, ANS_PASS, { 704: A('2') }), []).code, 'CONDITIONAL');
const OPT = [ITEMS[0], Object.assign({}, ITEMS[1], { required: false })];
T.eq('an optional question failed: CONDITIONAL', ip.result(OPT, { 701: A('YES'), 702: A('FAIL') }, []).code, 'CONDITIONAL');
T.eq('a minor or cosmetic defect: CONDITIONAL', ['MINOR', 'COSMETIC'].map((s) => ip.result(ITEMS, ANS_PASS, [{ severity: s, description: 'x' }]).code).join(','), 'CONDITIONAL,CONDITIONAL');
T.eq('a critical or major defect: FAIL, even with every answer fine', ['CRITICAL', 'MAJOR'].map((s) => ip.result(ITEMS, ANS_PASS, [{ severity: s, description: 'x' }]).code).join(','), 'FAIL,FAIL');
T.eq('the reasons say why', ip.result(ITEMS, ANS_FAIL, [{ severity: 'MINOR', description: 'Dent on door' }]).reasons.map((r) => r.level + ':' + r.text).join(' | '),
  'fail:Wire rope and hook: Fail | cond:Minor defect: Dent on door');
T.eq('not finished while a required question is open', ip.result(ITEMS, { 701: A('YES') }, []).finished, false);
T.eq('result text depends on the direction', [ip.resultText('FAIL', 'SHIP_OUT_YARD'), ip.resultText('PASS', 'RECEIVE_YARD'), ip.resultText('PASS', 'SHIP_OUT_YARD', false)].join(' | '),
  'Fail: cannot ship | Pass: received in good order | Not finished');
T.eq('line status: only the yard ship-out moves the line',
  [ip.lineStatusAfter('SHIP_OUT_YARD', 'PASS'), ip.lineStatusAfter('SHIP_OUT_YARD', 'FAIL'), ip.lineStatusAfter('SHIP_OUT_YARD', 'CONDITIONAL', false),
    ip.lineStatusAfter('SHIP_OUT_YARD', 'CONDITIONAL', true), ip.lineStatusAfter('RECEIVE_YARD', 'FAIL')].join(','),
  'EQP_INSPECTION_COMPLETE,INSPECTION_FAILED,,EQP_INSPECTION_COMPLETE,');

T.section('inspection: what blocks Complete');
T.eq('required answers', ip.blockers(ITEMS, { 701: A('YES') }, [], false).join('|'), 'Answer 2 required questions');
T.eq('one required answer is named', ip.blockers(ITEMS, { 701: A('YES'), 702: A('PASS') }, [], false).join('|'), 'Answer: Outrigger pad thickness');
T.eq('a reading that is not a number', ip.blockers(ITEMS, Object.assign({}, ANS_PASS, { 703: A('x') }), [], false).join('|'), 'Outrigger pad thickness: enter a number');
T.eq('a defect needs a description, a severity and a photo',
  ip.blockers(ITEMS, ANS_PASS, [{ key: 'd1', description: '', severity: '', photo: null }], false).join('|'),
  'Describe defect 1|Severity of defect 1|Photo of defect 1');
T.eq('a repair cost must be a number', ip.blockers(ITEMS, ANS_PASS, [{ description: 'Dent', severity: 'MINOR', photo: { name: 'a.jpg' }, cost: 'lots' }], true).join('|'),
  'Repair cost of "Dent" is not a number');
T.eq('a conditional result needs the acknowledgement', ip.blockers(ITEMS, Object.assign({}, ANS_PASS, { 704: A('1') }), [], false).join('|'),
  'Acknowledge the conditional result');
T.eq('... and passes with it', ip.blockers(ITEMS, Object.assign({}, ANS_PASS, { 704: A('1') }), [], true).length, 0);
T.eq('a defect saved by an earlier attempt is not asked again', ip.blockers(ITEMS, ANS_FAIL, [{ saved: true, description: 'old', severity: 'MAJOR' }], false).length, 0);
T.eq('defects shown: on a question its own, on review all', [ip.defectsShown([{ itemId: '702' }, { itemId: '' }], ITEMS, 1).length,
  ip.defectsShown([{ itemId: '702' }, { itemId: '' }], ITEMS, 0).length, ip.defectsShown([{ itemId: '702' }, { itemId: '' }], ITEMS, 4).length].join(','), '1,0,2');
T.eq('a defect logged on a question starts from it', JSON.stringify(ip.newDefect('k', ITEMS[1], A('FAIL', 'Two broken wires'))),
  JSON.stringify({ key: 'k', itemId: '702', checklistId: 702, description: 'Wire rope and hook: Two broken wires', severity: 'MAJOR', action: 'REPAIR', cost: '', photo: null, saved: false }));
T.eq('photo checks', [ip.photoProblem(null), ip.photoProblem({ type: 'application/pdf', size: 1 }), ip.photoProblem({ type: 'image/jpeg', size: 30e6 }),
  ip.photoProblem({ type: 'image/jpeg', size: 1000 })].join('|'), 'No photo was taken.|That file is not a photo.|The photo is larger than 20 MB.|');

T.section('inspection: request bodies');
T.eq('inspection opens IN_PROGRESS on the line', JSON.stringify(ip.inspectionBody(LINES[0], 'SHIP_OUT_YARD', '2026-10-29T08:15:00.000Z')),
  '{"requestLineId":9001,"inspectionType":"SHIP_OUT_YARD","inspectionStatus":"IN_PROGRESS","scheduledDate":"2026-10-29T00:00:00Z"}');
T.eq('response: value, how it scored, note', JSON.stringify(ip.responseBody(7001, ITEMS[1], A('FAIL', ' Two broken wires '))),
  '{"inspectionId":7001,"checklistId":702,"responseValue":"FAIL","responseResult":"FAIL","notes":"Two broken wires"}');
T.eq('a low rating scores CONDITIONAL', ip.responseBody(7001, ITEMS[3], A('2')).responseResult, 'CONDITIONAL');
T.eq('defect', JSON.stringify(ip.defectBody(7001, { checklistId: 702, description: ' Wire rope ', severity: 'major', action: 'replace', cost: '$1,800' })),
  '{"inspectionId":7001,"checklistId":702,"defectDescription":"Wire rope","severity":"MAJOR","recommendedAction":"REPLACE","estimatedRepairCost":1800,"defectStatus":"OPEN"}');
T.eq('completion records the acknowledgement of a conditional result', JSON.stringify(ip.completionBody('CONDITIONAL', 'Seat torn', true, 'Mia Ortiz', 'T')),
  '{"inspectionStatus":"COMPLETED","overallResult":"CONDITIONAL","completedDate":"T","notes":"Seat torn Conditional result acknowledged by Mia Ortiz."}');
T.eq('completion without notes', ip.completionBody('PASS', '', false, 'x', 'T').notes, null);
const meta = ip.photoMetadata(7001, 9101, 'wire rope (1).jpg', 'Wire rope', 1700000000000);
T.eq('photo document hangs off the defect, unique safe path', JSON.stringify([meta.application_code, meta.doc_type, meta.entity_type, meta.entity_id, meta.path]),
  '["EQUIP_RITE","DOCUMENT","EQR_INSPECTION_DEFECT",9101,"inspections/7001/defects/9101/1700000000000-wire_rope__1_.jpg"]');
T.check('photo path has no "..", no leading slash, no backslash', !/\.\.|^\/|\\/.test(ip.photoMetadata(1, 2, '../..\\x.png', '', 3).path));
const docReq = JSON.parse(fs.readFileSync(path.join(ROOT, 'services', 'commonService', 'openapi3.json'), 'utf8')).components.schemas.CommonDocumentRequest;
T.check('photo metadata has every field commonService requires', docReq.required.every((k) => meta[k] != null), docReq.required.join(','));

T.section('inspection: what is on record for the line');
const INSP_ROWS = [
  { id: 6900, requestLineId: 9001, inspectionType: 'SHIP_OUT_YARD', inspectionStatus: 'COMPLETED', overallResult: 'FAIL', completedDate: '2026-10-20T10:00:00Z' },
  { id: 6950, requestLineId: 9001, inspectionType: 'SHIP_OUT_YARD', inspectionStatus: 'IN_PROGRESS' },
  { id: 6960, requestLineId: 9001, inspectionType: 'RECEIVE_YARD', inspectionStatus: 'COMPLETED', overallResult: 'PASS', completedDate: '2026-09-01' },
];
T.eq('an unfinished inspection at the same point is continued', ip.openInspection(INSP_ROWS, 'SHIP_OUT_YARD').id, 6950);
T.eq('... not one at another point', ip.openInspection(INSP_ROWS, 'RECEIVE_SITE'), null);
T.eq('history: completed ones, newest first', ip.historyRows(INSP_ROWS).map((h) => h.id + ':' + h.result).join(','), '6900:FAIL,6960:PASS');
T.eq('already inspected here', ip.doneHere(ip.historyRows(INSP_ROWS), 'SHIP_OUT_YARD').id, 6900);
const prior = ip.savedAnswers([{ id: 81, checklistId: 701, responseValue: 'YES' }, { id: 82, checklistId: 999, responseValue: 'NO' }], ITEMS);
T.eq('saved answers fill the sheet', JSON.stringify(prior), '{"answers":{"701":{"value":"YES","note":""}},"saved":{"701":{"id":81,"value":"YES","note":""}}}');
T.eq('saved defects are read-only', JSON.stringify(ip.savedDefects([{ id: 91, checklistId: 702, defectDescription: 'Rope', severity: 'MAJOR' }], ITEMS).map((d) => [d.key, d.itemId, d.saved])),
  '[["saved-91","702",true]]');
T.eq('old line detail link', ip.oldLineLink('http://old/', LINES[0]),
  'http://old/vp/shell/equipment-foundation/line-detail?requestId=501&requestNumber=REQ-10505&lineId=9001&equipmentMasterId=61');
T.check('old line-detail page exists', fs.existsSync(path.join(OLD, 'flows', 'equipment-foundation', 'pages', 'line-detail-page.json')));
T.eq('no old link without the old app address', ip.oldLineLink('', LINES[0]), '');

// ── Inspection chains ─────────────────────────────────────────────────────────────────────────────────────

function inspectionVars(extra) {
  return Object.assign({
    lineId: null, mode: 'out', point: '', scope: 'required', lines: LINES.slice(), matrix: MATRIX, matrixNote: '', truncatedNote: '',
    isLoading: false, loadError: '', current: null, openToken: 0, checklist: [], checklistLoading: false, checklistError: '', history: [],
    answers: {}, defects: [], step: 0, notes: '', ack: false, saved: {}, photoError: '', isSaving: false, saveError: '', blocked: [], done: null,
  }, extra || {});
}
const CURRENT = Object.assign({}, LINES[0], { point: 'SHIP_OUT_YARD', pointLabel: 'Ship-out from yard', required: true });
const FILE = { name: 'wire.jpg', type: 'image/jpeg', size: 2048 };

function inspectionBackend(fails) {
  let n = 0;
  return (o) => {
    const e = o.endpoint;
    if (fails && fails[e] && fails[e]()) return fail(503);
    if (e === 'eqp-v1/createInspection') return ok({ id: 7001 });
    if (e === 'eqp-v1/createInspectionResponse') return ok({ id: 8000 + (++n) });
    if (e === 'eqp-v1/createInspectionDefect') return ok({ id: 9101 });
    if (e === 'commonService/uploadCommonDocument') return ok({ doc_id: 55 });
    return undefined;
  };
}
/** Fails the first `times` calls to an endpoint, then lets it through. */
const failTimes = (times) => { let left = times; return () => left-- > 0; };

function failedSheet(page) {
  const items = page.checklistFor(CHECK10, LINES[0], 'SHIP_OUT_YARD');
  const d = page.newDefect('d1', items[1], ANS_FAIL[702]);
  d.photo = { name: 'wire.jpg', size: 2048, url: 'blob:preview' };
  page.holdFile('d1', FILE);
  return { checklist: items, answers: Object.assign({}, ANS_FAIL), defects: [d], step: items.length };
}

(async () => {
  T.section('inspection chains: loading the queue');
  {
    const { calls, Actions } = fake((o) => {
      if (o.endpoint === 'eqp-v1/getConfInspectionDetails') return ok({ data: MATRIX });
      if (o.endpoint === 'eqp-v1/getEquipriteV1ViewsWorkbenchRequests') {
        return ok({ data: o.uriParams.stage === 'OUTBOUND' ? [{ eqrEquipmentRequestId: 501 }, { eqrEquipmentRequestId: 501 }] : [{ eqrEquipmentRequestId: 502 }] });
      }
      if (o.endpoint === 'eqp-v1/getEquipriteV1ViewsRequestDetailLines') {
        return ok({ data: LINES.filter((l) => l.requestId === o.uriParams.requestId).map((l) => Object.assign({}, l, { requestId: undefined }))
          .concat([{ lineId: 1, lineStatus: 'DEPLOYED' }]) });
      }
      return undefined;
    });
    const page = new InspectionPage();
    const c = context(page, inspectionVars({ lines: [] }));
    await new (chain(INSP, 'loadQueueChain', Actions))().run(c);
    T.eq('matrix, outbound and inbound requests, then the lines of each request once',
      rest(calls).join(' > '), 'getConfInspectionDetails > getEquipriteV1ViewsWorkbenchRequests > getEquipriteV1ViewsWorkbenchRequests > getEquipriteV1ViewsRequestDetailLines > getEquipriteV1ViewsRequestDetailLines');
    T.eq('stages', calls.filter((x) => x.uriParams.stage).map((x) => x.uriParams.stage).join(','), 'OUTBOUND,INBOUND');
    T.eq('only lines waiting at a point are kept, with their request id', c.$page.variables.lines.map((l) => l.lineId + '@' + l.requestId).join(','), '9001@501,9002@501,9003@502,9004@502');
    T.eq('loading flag cleared', c.$page.variables.isLoading, false);
  }
  {
    const { Actions } = fake((o) => (o.endpoint === 'eqp-v1/getConfInspectionDetails' ? fail(500) : (o.endpoint.indexOf('Workbench') !== -1 ? ok({ data: [] }) : undefined)));
    const c = context(new InspectionPage(), inspectionVars({ lines: [] }));
    await new (chain(INSP, 'loadQueueChain', Actions))().run(c);
    T.check('no matrix: every waiting line is listed, and it says so', c.$page.variables.scope === 'all' && /could not be read/.test(c.$page.variables.matrixNote));
  }
  {
    const { calls, Actions } = fake((o) => (o.endpoint.indexOf('Workbench') !== -1 ? fail(502) : ok({ data: [] })));
    const c = context(new InspectionPage(), inspectionVars({ lines: [] }));
    await new (chain(INSP, 'loadQueueChain', Actions))().run(c);
    T.check('both stages failing is an error, and no line call is made', /HTTP 502/.test(c.$page.variables.loadError) && !calls.some((x) => /RequestDetailLines/.test(x.endpoint || '')));
  }

  {
    const { calls, Actions } = fake();
    const c = context(new InspectionPage(), inspectionVars({ lineId: 9002 }));
    await new (chain(INSP, 'inspectionInitChain', Actions))().run(c);
    T.eq('opening the page loads the queue, then the line from the URL', calls.map((x) => x.chain + ':' + JSON.stringify(x.params || {})).join(' > '),
      'loadQueueChain:{} > openLineChain:{"lineId":"9002"}');
  }

  T.section('inspection chains: opening a line');
  {
    const { calls, Actions } = fake((o) => {
      if (o.endpoint === 'eqp-v1/getInspectionChecklists') return ok({ data: CHECK10 });
      if (o.endpoint === 'eqp-v1/getInspections') return ok({ data: INSP_ROWS });
      if (o.endpoint === 'eqp-v1/getInspectionResponses') return ok({ data: [{ id: 81, checklistId: 701, responseValue: 'YES' }] });
      if (o.endpoint === 'eqp-v1/getInspectionDefects') return ok({ data: [{ id: 91, checklistId: 702, defectDescription: 'Rope', severity: 'MAJOR' }] });
      return undefined;
    });
    const page = new InspectionPage();
    const c = context(page, inspectionVars({ mode: 'in' }));
    await new (chain(INSP, 'openLineChain', Actions))().run(c, { lineId: '9001' });
    const v = c.$page.variables;
    T.eq('checklist by class, inspections by line, then the unfinished one\'s answers and defects',
      rest(calls).join(' > '), 'getInspectionChecklists > getInspections > getInspectionResponses > getInspectionDefects');
    T.eq('params', JSON.stringify(calls.slice(0, 4).map((x) => x.uriParams)), '[{"classId":10},{"requestLineId":9001},{"inspectionId":6950},{"inspectionId":6950}]');
    T.eq('the line is open at its point, in its mode', [v.current.lineId, v.current.point, v.mode, v.current.required].join(','), '9001,SHIP_OUT_YARD,out,true');
    T.eq('four questions', v.checklist.length, 4);
    T.eq('the unfinished inspection is continued', JSON.stringify([v.saved.inspectionId, Object.keys(v.saved.responses), v.saved.defects['saved-91'], v.answers['701'].value]),
      '[6950,["701"],91,"YES"]');
    T.eq('history', v.history.length, 2);
  }
  {
    const { Actions } = fake((o) => (o.endpoint === 'eqp-v1/getInspectionChecklists' ? fail(500) : ok({ data: [] })));
    const c = context(new InspectionPage(), inspectionVars());
    await new (chain(INSP, 'openLineChain', Actions))().run(c, { lineId: '9002' });
    T.check('a checklist that cannot load is said, not inspected without', /could not be loaded/.test(c.$page.variables.checklistError) && !c.$page.variables.checklist.length);
  }
  {
    const { calls, Actions } = fake();
    const c = context(new InspectionPage(), inspectionVars({ current: CURRENT, answers: { 1: 'x' } }));
    await new (chain(INSP, 'openLineChain', Actions))().run(c, { lineId: '' });
    T.check('closing clears the sheet and calls nothing', c.$page.variables.current === null && !Object.keys(c.$page.variables.answers).length && !calls.length);
  }

  T.section('inspection chains: answering, defects, photos');
  {
    const page = new InspectionPage();
    const items = page.checklistFor(CHECK10, LINES[0], 'SHIP_OUT_YARD');
    const c = context(page, inspectionVars({ current: CURRENT, checklist: items }));
    const Answer = chain(INSP, 'answerChain', fake().Actions);
    await new Answer().run(c, { id: '701', value: 'YES' });
    T.eq('a good tap moves on', c.$page.variables.step, 1);
    await new Answer().run(c, { id: '702', value: 'FAIL' });
    T.eq('a failed answer stays for its note and defect', c.$page.variables.step, 1);
    await new Answer().run(c, { id: '702', note: 'Two broken wires' });
    T.eq('the note is kept with the answer', JSON.stringify(c.$page.variables.answers['702']), '{"value":"FAIL","note":"Two broken wires"}');
    await new Answer().run(c, { id: '703', value: '52', typed: true });
    T.eq('a typed reading does not jump', c.$page.variables.step, 1);
    const Step = chain(INSP, 'stepChain', fake().Actions);
    await new Step().run(c, { to: 'review' });
    T.eq('review is after the last question', c.$page.variables.step, 4);
    await new Step().run(c, { to: 'next' });
    T.eq('no step past review', c.$page.variables.step, 4);
    await new Step().run(c, { to: '0' });
    T.eq('a pip jumps', c.$page.variables.step, 0);

    const Defect = chain(INSP, 'defectChain', fake().Actions);
    await new Defect().run(c, { action: 'add', item: '702' });
    const key = c.$page.variables.defects[0].key;
    T.eq('log a defect on the failed question', c.$page.variables.defects[0].description, 'Wire rope and hook: Two broken wires');
    await new Defect().run(c, { action: 'set', key, field: 'severity', value: 'CRITICAL' });
    await new Defect().run(c, { action: 'set', key, field: 'nonsense', value: 'x' });
    T.eq('fields are set, unknown ones ignored', c.$page.variables.defects[0].severity + '|' + ('nonsense' in c.$page.variables.defects[0]), 'CRITICAL|false');
    const Photo = chain(INSP, 'photoChain', fake().Actions);
    await new Photo().run(c, { key, file: { name: 'doc.pdf', type: 'application/pdf', size: 10 } });
    T.check('a non-photo is refused', /not a photo/.test(c.$page.variables.photoError) && !c.$page.variables.defects[0].photo);
    await new Photo().run(c, { key, file: FILE });
    T.check('the photo is held by the page module, its name and preview on the defect',
      page.heldFile(key) === FILE && c.$page.variables.defects[0].photo.name === 'wire.jpg' && c.$page.variables.defects[0].photo.url === 'blob:preview');
    await new Defect().run(c, { action: 'remove', key });
    T.check('removing the defect drops its photo', !c.$page.variables.defects.length && page.heldFile(key) === null);
    c.$page.variables.defects = [{ key: 'saved-1', saved: true, description: 'Rope' }];
    await new Defect().run(c, { action: 'remove', key: 'saved-1' });
    T.eq('a saved defect is not removed', c.$page.variables.defects.length, 1);
    const Field = chain(INSP, 'setFieldChain', fake().Actions);
    await new Field().run(c, { field: 'ack', value: 'true' });
    T.eq('acknowledgement', c.$page.variables.ack, true);
  }

  T.section('inspection chains: complete, FAIL at the yard ship-out');
  {
    const { calls, Actions } = fake(inspectionBackend());
    const page = new InspectionPage();
    const c = context(page, inspectionVars(Object.assign({ current: CURRENT }, failedSheet(page))));
    await new (chain(INSP, 'completeInspectionChain', Actions))().run(c);
    const v = c.$page.variables;
    T.eq('inspection, 4 answers, the defect, its photo, completed, the line status',
      rest(calls).join(' > '),
      'createInspection > createInspectionResponse > createInspectionResponse > createInspectionResponse > createInspectionResponse > createInspectionDefect > commonService/uploadCommonDocument > patchInspection > patchRequestLinesBatch');
    T.eq('the inspection body', JSON.stringify(Object.assign({}, calls[0].body, { scheduledDate: 'D' })),
      '{"requestLineId":9001,"inspectionType":"SHIP_OUT_YARD","inspectionStatus":"IN_PROGRESS","scheduledDate":"D"}');
    T.eq('answers go to the new inspection', calls.filter((x) => x.endpoint === 'eqp-v1/createInspectionResponse').map((x) => x.body.inspectionId + ':' + x.body.checklistId + '=' + x.body.responseValue).join(','),
      '7001:701=YES,7001:702=FAIL,7001:703=52,7001:704=4');
    T.eq('the defect', JSON.stringify(calls[5].body),
      '{"inspectionId":7001,"checklistId":702,"defectDescription":"Wire rope and hook: Two broken wires","severity":"MAJOR","recommendedAction":"REPAIR","estimatedRepairCost":null,"defectStatus":"OPEN"}');
    const up = calls[6];
    T.check('the photo is a multipart upload of the held file, linked to the defect',
      up.contentType === 'multipart/form-data' && up.body.file === FILE && up.body.metadata instanceof Blob && up.body.metadata.type === 'application/json');
    const metaSent = JSON.parse(await up.body.metadata.text());
    T.eq('... on EQR_INSPECTION_DEFECT 9101', metaSent.entity_type + ' ' + metaSent.entity_id, 'EQR_INSPECTION_DEFECT 9101');
    T.eq('completed with the result', JSON.stringify([calls[7].uriParams.id, calls[7].body.inspectionStatus, calls[7].body.overallResult]), '[7001,"COMPLETED","FAIL"]');
    T.eq('the line is marked INSPECTION_FAILED', JSON.stringify([calls[8].uriParams.requestId, calls[8].body.lines]), '[501,[{"id":9001,"lineStatus":"INSPECTION_FAILED"}]]');
    T.check('writes carry the audit header', calls.filter((x) => x.endpoint && x.endpoint.indexOf('eqp-v1/') === 0).every((x) => x.headers && x.headers['X-User-Id'] === 'mia.ortiz'));
    T.eq('done card, next unit offered', JSON.stringify([v.done.code, v.done.lineStatus, v.done.nextLineId, v.done.unit]), '["FAIL","INSPECTION_FAILED","9002","Mobile Crane 50t · MC-11"]');
    T.check('the line leaves the queue, the sheet is cleared', !v.lines.some((l) => l.lineId === 9001) && v.current === null && !v.defects.length && page.heldFile('d1') === null);
    T.eq('a warning toast', calls[calls.length - 1].toast + '|' + calls[calls.length - 1].type, 'Inspection completed|warning');
    T.eq('busy flag cleared', v.isSaving, false);
  }

  T.section('inspection chains: complete, PASS and receive points');
  {
    const { calls, Actions } = fake(inspectionBackend());
    const page = new InspectionPage();
    const items = page.checklistFor(CHECK10, LINES[0], 'SHIP_OUT_YARD');
    const c = context(page, inspectionVars({ current: CURRENT, checklist: items, answers: ANS_PASS, step: 4 }));
    await new (chain(INSP, 'completeInspectionChain', Actions))().run(c);
    T.eq('PASS: no defect calls, the line is cleared to ship', rest(calls).filter((e) => !/Response/.test(e)).join(' > '), 'createInspection > patchInspection > patchRequestLinesBatch');
    T.eq('... EQP_INSPECTION_COMPLETE', calls.find((x) => x.endpoint === 'eqp-v1/patchRequestLinesBatch').body.lines[0].lineStatus, 'EQP_INSPECTION_COMPLETE');
    T.eq('confirmation toast', calls[calls.length - 1].type, 'confirmation');
  }
  {
    const { calls, Actions } = fake(inspectionBackend());
    const page = new InspectionPage();
    const items = page.checklistFor(CHECK10, LINES[0], 'RECEIVE_YARD');
    const recv = Object.assign({}, LINES[2], { point: 'RECEIVE_YARD', pointLabel: 'Receive at yard', required: true });
    const c = context(page, inspectionVars({ current: recv, checklist: items, answers: { 701: A('YES'), 702: A('FAIL'), 703: A('50'), 706: A('Scratches') }, step: 9 }));
    await new (chain(INSP, 'completeInspectionChain', Actions))().run(c);
    T.check('a receive point records the inspection and leaves the line status alone',
      calls.some((x) => x.endpoint === 'eqp-v1/patchInspection') && !calls.some((x) => x.endpoint === 'eqp-v1/patchRequestLinesBatch'));
    T.eq('... the text answer is saved too', calls.filter((x) => x.endpoint === 'eqp-v1/createInspectionResponse').length, 4);
  }
  {
    const { calls, Actions } = fake(inspectionBackend());
    const page = new InspectionPage();
    const items = page.checklistFor(CHECK10, LINES[0], 'SHIP_OUT_YARD');
    const c = context(page, inspectionVars({ current: CURRENT, checklist: items, answers: Object.assign({}, ANS_PASS, { 704: A('2') }), step: 4, ack: false }));
    await new (chain(INSP, 'completeInspectionChain', Actions))().run(c);
    T.check('conditional without the acknowledgement: nothing is called, it says why',
      !calls.length && c.$page.variables.blocked.join() === 'Acknowledge the conditional result');
    c.$page.variables.ack = true;
    await new (chain(INSP, 'completeInspectionChain', Actions))().run(c);
    const done = calls.find((x) => x.endpoint === 'eqp-v1/patchInspection');
    T.check('with it: CONDITIONAL, acknowledged in the notes, cleared to ship',
      done.body.overallResult === 'CONDITIONAL' && /acknowledged by Mia Ortiz/.test(done.body.notes)
      && calls.find((x) => x.endpoint === 'eqp-v1/patchRequestLinesBatch').body.lines[0].lineStatus === 'EQP_INSPECTION_COMPLETE');
  }
  {
    const { calls, Actions } = fake(inspectionBackend());
    const page = new InspectionPage();
    const sheet = failedSheet(page);
    sheet.defects[0].photo = null;
    const c = context(page, inspectionVars(Object.assign({ current: CURRENT }, sheet)));
    await new (chain(INSP, 'completeInspectionChain', Actions))().run(c);
    T.check('a defect without its photo blocks before any call', !calls.length && /Photo of/.test(c.$page.variables.blocked.join()));
  }
  {
    const { calls, Actions } = fake(inspectionBackend());
    const page = new InspectionPage();
    const c = context(page, inspectionVars(Object.assign({ current: CURRENT }, failedSheet(page))));
    const s = new (chain(INSP, 'completeInspectionChain', Actions))();
    await Promise.all([s.run(c), s.run(c)]);
    T.eq('a double tap creates one inspection', calls.filter((x) => x.endpoint === 'eqp-v1/createInspection').length, 1);
  }

  T.section('inspection chains: failures stop the save, a retry continues it');
  {
    const { calls, Actions } = fake(inspectionBackend({ 'eqp-v1/createInspection': () => true }));
    const page = new InspectionPage();
    const c = context(page, inspectionVars(Object.assign({ current: CURRENT }, failedSheet(page))));
    await new (chain(INSP, 'completeInspectionChain', Actions))().run(c);
    T.check('the inspection cannot start: nothing else is sent, the sheet stays', rest(calls).join() === 'createInspection'
      && /Nothing was saved/.test(c.$page.variables.saveError) && c.$page.variables.current && c.$page.variables.defects.length === 1);
  }
  {
    let n = 0;
    const flaky = () => ++n === 2;
    const { calls, Actions } = fake(inspectionBackend({ 'eqp-v1/createInspectionResponse': flaky }));
    const page = new InspectionPage();
    const c = context(page, inspectionVars(Object.assign({ current: CURRENT }, failedSheet(page))));
    const Complete = chain(INSP, 'completeInspectionChain', Actions);
    await new Complete().run(c);
    T.check('the 2nd answer fails: stop, say how many are saved', /1 of 4 answers are saved/.test(c.$page.variables.saveError)
      && !calls.some((x) => x.endpoint === 'eqp-v1/createInspectionDefect'));
    T.eq('... what is saved is kept', JSON.stringify([c.$page.variables.saved.inspectionId, Object.keys(c.$page.variables.saved.responses)]), '[7001,["701"]]');
    calls.length = 0;
    await new Complete().run(c);
    T.eq('retry: no second inspection, the saved answer is not sent again',
      rest(calls).join(' > '), 'createInspectionResponse > createInspectionResponse > createInspectionResponse > createInspectionDefect > commonService/uploadCommonDocument > patchInspection > patchRequestLinesBatch');
    T.eq('... it starts at the answer that failed', calls[0].body.checklistId, 702);
  }
  {
    const { calls, Actions } = fake(inspectionBackend({ 'commonService/uploadCommonDocument': failTimes(1) }));
    const page = new InspectionPage();
    const c = context(page, inspectionVars(Object.assign({ current: CURRENT }, failedSheet(page))));
    const Complete = chain(INSP, 'completeInspectionChain', Actions);
    await new Complete().run(c);
    T.check('the photo upload fails: the defect is saved, the inspection is not completed',
      /did not upload/.test(c.$page.variables.saveError) && c.$page.variables.saved.defects.d1 === 9101 && !calls.some((x) => x.endpoint === 'eqp-v1/patchInspection'));
    calls.length = 0;
    await new Complete().run(c);
    T.eq('retry: only the photo and the completion', rest(calls).join(' > '), 'commonService/uploadCommonDocument > patchInspection > patchRequestLinesBatch');
  }
  {
    const { calls, Actions } = fake(inspectionBackend({ 'eqp-v1/patchInspection': failTimes(1) }));
    const page = new InspectionPage();
    const c = context(page, inspectionVars(Object.assign({ current: CURRENT }, failedSheet(page))));
    const Complete = chain(INSP, 'completeInspectionChain', Actions);
    await new Complete().run(c);
    T.check('completion fails: said, the line status is not touched', /could not be completed/.test(c.$page.variables.saveError)
      && !calls.some((x) => x.endpoint === 'eqp-v1/patchRequestLinesBatch'));
    calls.length = 0;
    await new Complete().run(c);
    T.eq('retry: only the completion and the line', rest(calls).join(' > '), 'patchInspection > patchRequestLinesBatch');
  }
  {
    const { calls, Actions } = fake(inspectionBackend({ 'eqp-v1/patchRequestLinesBatch': failTimes(1) }));
    const page = new InspectionPage();
    const c = context(page, inspectionVars(Object.assign({ current: CURRENT }, failedSheet(page))));
    await new (chain(INSP, 'completeInspectionChain', Actions))().run(c);
    const d = c.$page.variables.done;
    T.check('the line status fails: the inspection is done and the status can be retried', d && d.pendingStatus === 'INSPECTION_FAILED' && !!d.statusError && !d.lineStatus);
    calls.length = 0;
    await new (chain(INSP, 'retryStatusChain', Actions))().run(c);
    T.check('retry sends only the line status', rest(calls).join() === 'patchRequestLinesBatch' && c.$page.variables.done.lineStatus === 'INSPECTION_FAILED'
      && !c.$page.variables.done.statusError);
  }
  {
    const { calls, Actions } = fake(inspectionBackend());
    const page = new InspectionPage();
    const items = page.checklistFor(CHECK10, LINES[0], 'SHIP_OUT_YARD');
    const c = context(page, inspectionVars({
      current: CURRENT, checklist: items, step: 4,
      answers: { 701: A('YES'), 702: A('PASS'), 703: A('48'), 704: A('5') },
      saved: { inspectionId: 6950, responses: { 701: { id: 81, value: 'YES', note: '' }, 702: { id: 82, value: 'FAIL', note: '' } }, defects: {}, photos: {} },
    }));
    await new (chain(INSP, 'completeInspectionChain', Actions))().run(c);
    T.eq('continuing an open inspection: unchanged answers skipped, changed ones patched, new ones posted',
      rest(calls).join(' > '), 'patchInspectionResponse > createInspectionResponse > createInspectionResponse > patchInspection > patchRequestLinesBatch');
    T.eq('... on the open inspection', JSON.stringify([calls[0].uriParams.id, calls[0].body.inspectionId, calls[3].uriParams.id]), '[82,6950,6950]');
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════
  // Transfers
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════

  const tp = new TransfersPage();
  const SRC_ROWS = [
    { eqrEquipmentRequestId: 475, requestNumber: 'REQ-10475', projectName: 'Pipeline North', taskName: '2.1', location: 'Odessa TX', equipmentName: 'Dump Truck 30t', className: 'Trucks' },
    { eqrEquipmentRequestId: 475, requestNumber: 'REQ-10475', projectName: 'Pipeline North', equipmentName: 'Dump Truck 30t', className: 'Trucks' },
    { eqrEquipmentRequestId: 402, requestNumber: 'REQ-10402', projectName: 'Plant Expansion B', equipmentName: 'Generator 60 kVA', className: 'Power' },
  ];
  const DST_ROWS = [
    { eqrEquipmentRequestId: 527, requestNumber: 'REQ-10527', projectName: 'Plant Expansion B', taskName: '1.3', equipmentName: 'Dump Truck 30t', className: 'Trucks',
      requestedStartDate: '2026-11-03T00:00:00Z', requestedEndDate: '2026-12-20T00:00:00Z' },
    { eqrEquipmentRequestId: 530, requestNumber: 'REQ-10530', projectName: 'Refinery C', equipmentName: 'Excavator 20t', className: 'Excavators' },
    { eqrEquipmentRequestId: 475, requestNumber: 'REQ-10475', projectName: 'Pipeline North', equipmentName: 'Dump Truck 30t', className: 'Trucks' },
  ];
  const SRC_LINES = [
    { lineId: 4751, requestNumber: 'REQ-10475', equipmentMasterId: 77, equipmentClassId: 5, equipmentName: 'Dump Truck 30t', className: 'Trucks', quantity: 1,
      allocatedSerial: 'DT-1108', lineStatus: 'DEPLOYED', startDate: '2026-10-01T00:00:00Z', endDate: '2026-11-30T00:00:00Z' },
    { lineId: 4752, requestNumber: 'REQ-10475', equipmentMasterId: 77, equipmentClassId: 5, equipmentName: 'Dump Truck 30t', className: 'Trucks', quantity: 1,
      allocatedSerial: 'DT-1112', lineStatus: 'DEPLOYED', startDate: '2026-10-01T00:00:00Z', endDate: '2026-11-30T00:00:00Z' },
    { lineId: 4753, requestNumber: 'REQ-10475', equipmentMasterId: 80, equipmentName: 'Light tower', lineStatus: 'RETURN_INITIATED' },
  ];
  const DST_LINES = [
    { lineId: 5271, equipmentMasterId: 77, equipmentClassId: 5, equipmentName: 'Dump Truck 30t', quantity: 1, lineStatus: 'IN_PROCESS',
      startDate: '2026-11-03T00:00:00Z', endDate: '2026-12-20T00:00:00Z' },
    { lineId: 5272, equipmentMasterId: 91, equipmentName: 'Water bowser', quantity: 1, lineStatus: 'ALLOCATED' },
    { lineId: 5273, equipmentMasterId: 77, equipmentName: 'Dump Truck 30t', quantity: 1, lineStatus: 'PICK_INITIATED' },
  ];
  const TIMESHEETS = [
    { requestLineId: 4752, timesheetStatus: 'SUBMITTED', weekEndDate: '2026-11-01' },
    { requestLineId: 4751, timesheetStatus: 'APPROVED', weekEndDate: '2026-10-25' },
    { requestLineId: 4751, timesheetStatus: 'DRAFT', weekEndDate: '2026-11-08' },
  ];

  T.section('transfers: requests and lines');
  T.eq('workbench rows become one entry per request', tp.requests(SRC_ROWS).map((r) => r.number + ':' + r.units).join(','), 'REQ-10475:2,REQ-10402:1');
  T.eq('request text', tp.requestText(tp.requests(SRC_ROWS)[0]), 'REQ-10475 · Pipeline North · 2.1');
  T.eq('search by project or equipment', tp.sources(SRC_ROWS, 'generator').map((r) => r.number).join(), 'REQ-10402');
  T.eq('destinations: same equipment as a ticked unit, never the source',
    tp.destinations(DST_ROWS, 475, SRC_LINES, { 4751: true }, '').map((r) => r.number).join(), 'REQ-10527');
  T.eq('nothing ticked: every deployed unit counts', tp.destinations(DST_ROWS, 475, SRC_LINES, {}, '').map((r) => r.number).join(), 'REQ-10527');
  T.eq('no destination for equipment nobody waits for', tp.destinations(DST_ROWS, 402, [{ lineId: 1, equipmentName: 'Crane', lineStatus: 'DEPLOYED' }], {}, '').length, 0);
  T.eq('deployed units only', tp.deployed(SRC_LINES).map((l) => l.lineId).join(), '4751,4752');
  T.eq('waiting destination lines only (not picked yet)', tp.waiting(DST_LINES).map((l) => l.lineId).join(), '5271,5272');
  T.check('same equipment: master, or class and name', tp.sameEquipment(SRC_LINES[0], DST_LINES[0]) && !tp.sameEquipment(SRC_LINES[0], DST_LINES[1])
    && tp.sameEquipment({ equipmentName: 'Dump truck 30T', equipmentClassId: 5 }, { equipmentName: 'dump truck 30t', equipmentClassId: 5 })
    && !tp.sameEquipment({ equipmentName: 'Dump truck', equipmentClassId: 5 }, { equipmentName: 'Dump truck', equipmentClassId: 6 }));
  const both = tp.pair(tp.selectedLines(SRC_LINES, { 4751: true, 4752: true }), DST_LINES);
  T.eq('one to one: the second unit has no line left', JSON.stringify([both.pairs.map((p) => p.source.lineId + '>' + p.dest.lineId), both.unmatched.map((u) => u.lineId)]),
    '[["4751>5271"],[4752]]');
  T.eq('a line for 2 takes two units', tp.pair(tp.selectedLines(SRC_LINES, { 4751: true, 4752: true }), [Object.assign({}, DST_LINES[0], { quantity: 2 })]).pairs.length, 2);
  T.eq('window text', tp.windowText(tp.windowOf(SRC_LINES[0])) + ' | ' + tp.windowText({ start: '2026-12-20', end: '2027-01-10' }), '1 Oct – 30 Nov 2026 | 20 Dec 2026 – 10 Jan 2027');
  T.eq('history rows, newest first', tp.historyRows([
    { id: 1, transferDate: '2026-10-09T00:00:00Z', equipmentName: 'Light tower', serialNumber: 'LT-0207', sourceRequestNumber: 'REQ-10390', destinationRequestNumber: 'REQ-10451', transferStatus: 'COMPLETED', transferredBy: 'a.khan' },
    { id: 2, transferDate: '2026-10-22T00:00:00Z', equipmentName: 'Generator 60 kVA', sourceRequestId: 402, destinationRequestNumber: 'REQ-10466', orderNumber: 'EQR-TRF-1' },
  ]).map((h) => [h.date, h.equipment, h.from, h.to, h.ref, h.status, h.by].join('/')).join(' | '),
  '22 Oct 2026/Generator 60 kVA/Request 402/REQ-10466/EQR-TRF-1/PENDING/ | 9 Oct 2026/Light tower · LT-0207/REQ-10390/REQ-10451//COMPLETED/a.khan');
  T.eq('site names from inv-orgs', [tp.siteText([{ organizationId: 3001, organizationCode: 'TEXAS', organizationName: 'Texas sites' }], 3001), tp.siteText([], 9), tp.siteText([], null)].join(' | '),
    'TEXAS · Texas sites | Org 9 | not known');
  T.eq('switched off only when explicitly false', [tp.switchedOff({ ENABLE_INTER_PROJECT_TRANSFER: 'false' }, true), tp.switchedOff({}, true), tp.switchedOff({ ENABLE_INTER_PROJECT_TRANSFER: 'false' }, false)].join(),
    'true,false,false');

  T.section('transfers: the checks (S28)');
  const SRC = tp.findRequest(SRC_ROWS, 475);
  const DST = tp.findRequest(DST_ROWS, 527);
  const S = (patch) => Object.assign({ switchedOff: false, source: SRC, dest: DST, sourceLines: SRC_LINES, destLines: DST_LINES, selected: { 4751: true },
    date: '2026-11-05', timesheets: TIMESHEETS, history: [], sites: { 4751: 3001, 4752: 3001 } }, patch || {});
  T.eq('a good transfer has no problem', tp.problems(S()).join(' | '), '');
  T.eq('nothing chosen', tp.problems(S({ source: null })).join(' | '), 'Choose the request the equipment is on.');
  T.eq('no unit, no destination, no date', tp.problems(S({ selected: {}, dest: null, date: '' })).join(' | '),
    'Tick the units that move. | Choose the request the equipment moves to. | Enter the transfer date.');
  T.eq('outside the source period', tp.problems(S({ date: '2026-12-05' })).join(' | '),
    'Dump Truck 30t · DT-1108 is on REQ-10475 1 Oct – 30 Nov 2026; the transfer date must fall in that period.');
  T.eq('before the destination period', tp.problems(S({ date: '2026-11-01' })).join(' | '),
    'REQ-10527 needs Dump Truck 30t 3 Nov – 20 Dec 2026; the transfer date must fall in that period.');
  T.eq('a submitted timesheet blocks (the wireframe message)', tp.problems(S({ selected: { 4752: true } })).join(' | '),
    'Dump Truck 30t · DT-1112 has 1 submitted timesheet on REQ-10475 for the week ending 1 Nov 2026. It must be approved before this transfer can go through.');
  T.eq('a draft timesheet is a warning', tp.warnings(S()).join(' | '),
    'Dump Truck 30t · DT-1108 has a draft timesheet on REQ-10475 for the week ending 8 Nov 2026; it stays on that request.');
  T.eq('two units, one waiting line', tp.problems(S({ selected: { 4751: true, 4752: true }, timesheets: [] })).join(' | '),
    'REQ-10527 has no waiting line left for Dump Truck 30t · DT-1112.');
  T.eq('a unit with a transfer pending cannot move twice', tp.problems(S({ history: [{ sourceRequestLineId: 4751, transferStatus: 'PENDING', orderNumber: 'EQR-TRF-9' }] })).join(' | '),
    'Dump Truck 30t · DT-1108 already has a transfer pending (EQR-TRF-9).');
  T.eq('units at two sites', tp.problems(S({ selected: { 4751: true, 4752: true }, timesheets: [], sites: { 4751: 3001, 4752: 3009 }, destLines: [Object.assign({}, DST_LINES[0], { quantity: 2 })] })).join(' | '),
    'The ticked units are at different sites; move them in separate transfers.');
  T.eq('the destination has nothing waiting', tp.problems(S({ destLines: [DST_LINES[2]] })).join(' | '), 'REQ-10527 has no line waiting for equipment.');
  T.eq('switched off', tp.problems(S({ switchedOff: true }))[0], 'Inter-project transfer is switched off in Configuration (ENABLE_INTER_PROJECT_TRANSFER).');
  T.eq('no known site is a warning', tp.warnings(S({ sites: {}, timesheets: [] })).join(), 'No transfer order brought Dump Truck 30t · DT-1108 to its site, so the transfer order is recorded without a source site.');
  T.eq('problems from page variables match', tp.problemsOf({}, true, SRC_ROWS, 475, DST_ROWS, 527, SRC_LINES, DST_LINES, { 4752: true }, '2026-11-05', TIMESHEETS, [], {}).length, 1);

  T.section('transfers: plan, reserve key, bodies');
  const PLAN = {
    buckets: [{ bucketKey: 'Y1|LA', sourceOrgId: 1001, destOrgId: 3002, destOrgCode: 'LOUISIANA', destOrgName: 'Louisiana sites',
      lines: [{ requestLineId: 5271, itemNumber: 'EQ-DT30', equipmentName: 'Dump Truck 30t' }] }],
    blocks: [{ requestLineId: 5271, reasonCode: 'NO_YARD', equipmentName: 'Dump Truck 30t' }], empty: false, fAndMLineIds: [],
  };
  T.eq('destination site from the bucket holding the line', JSON.stringify(tp.destSite(PLAN, [5271])), '{"orgId":3002,"code":"LOUISIANA","name":"Louisiana sites"}');
  T.eq('no bucket, no site', tp.destSite({ buckets: [] }, [5271]), null);
  T.eq('yard-only blocks do not stop a transfer', tp.planBlocks(PLAN, [5271]).length, 0);
  T.eq('a quote block does', tp.planBlocks({ blocks: [{ requestLineId: 5271, reasonCode: 'NEEDS_QUOTE', equipmentName: 'Dump Truck 30t' }] }, [5271]).join(),
    'Dump Truck 30t must be quoted and the quote accepted first.');
  T.eq('item number from the plan', tp.itemNumber(PLAN, 5271), 'EQ-DT30');
  const oldSrc = fs.readFileSync(path.join(OLD, 'flows', 'equipment-foundation', 'pages', 'request-detail-page-chains', 'ActionChain.js'), 'utf8');
  const start = oldSrc.indexOf('function buildIdempotencyKey(intent) {');
  const end = oldSrc.indexOf('return fnv(canonical, 0x811c9dc5) + fnv(canonical, 0x9dc5811c);', start);
  const oldKey = vm.runInNewContext('(' + oldSrc.slice(start, oldSrc.indexOf('}', end) + 1) + ')');
  const INTENT = tp.intent(SRC, DST, [{ source: SRC_LINES[0], dest: DST_LINES[0] }], 0);
  T.eq('intent: the destination lines\' outbound leg, sourced from these units', JSON.stringify(INTENT),
    '{"requestId":527,"lineIds":[5271],"leg":"OUTBOUND","sourceCode":"TRF475:4751","attempt":0}');
  T.check('the key is the old confirm\'s, unchanged', start > 0 && [INTENT, Object.assign({}, INTENT, { attempt: 2 }), { requestId: 1, lineIds: [3, 1, 2], leg: 'INBOUND' }]
    .every((i) => tp.idempotencyKey(i) === oldKey(i)), tp.idempotencyKey(INTENT));
  T.check('a retry is a new intent', tp.idempotencyKey(INTENT) !== tp.idempotencyKey(Object.assign({}, INTENT, { attempt: 1 })));
  const F = { source: SRC, dest: DST, batchNumber: 'EQR-TRF-REQ-10527-1', destSite: tp.destSite(PLAN, [5271]), sourceOrgId: 3001, date: '2026-11-05',
    comments: ' Pipeline North finished early ', subinventory: 'TEXAS', locator: 'PRJ-2026-014', actor: 'mia.ortiz' };
  T.eq('transfer order', JSON.stringify(tp.orderBody(F)),
    '{"equipmentRequestId":527,"orderNumber":"EQR-TRF-REQ-10527-1","orderType":"INTER_PROJECT","orderStatus":"PENDING","sourceOrgId":3001,"destinationOrgId":3002,'
    + '"requestedDate":"2026-11-05T00:00:00Z","needByDate":"2026-11-05T00:00:00Z","shippingNotes":"Pipeline North finished early"}');
  T.eq('transfer order line', JSON.stringify(tp.orderLineBody(900, { source: SRC_LINES[0], dest: DST_LINES[0] }, 0, 'EQ-DT30')),
    '{"transferOrderId":900,"requestLineId":5271,"lineNumber":1,"itemNumber":"EQ-DT30","quantity":1,"lineStatus":"PENDING","serialNumber":"DT-1108","notes":"From REQ-10475 line 4751"}');
  const hb = tp.historyBody(F, { source: SRC_LINES[0], dest: DST_LINES[0] }, 900);
  T.eq('history names both requests and lines', JSON.stringify([hb.sourceRequestNumber, hb.sourceRequestLineId, hb.destinationRequestNumber, hb.destinationRequestLineId,
    hb.serialNumber, hb.transferStatus, hb.destinationSubinventory, hb.destinationLocator, hb.transferredBy]),
  '["REQ-10475",4751,"REQ-10527",5271,"DT-1108","PENDING","TEXAS","PRJ-2026-014","mia.ortiz"]');
  const toDto = JSON.parse(fs.readFileSync(path.join(ROOT, 'services', 'eqp-v1', 'openapi3.json'), 'utf8')).components.schemas;
  T.check('order and line bodies only use fields of TransferOrderDto / ToLineDto',
    Object.keys(tp.orderBody(F)).every((k) => k in toDto.TransferOrderDto.properties)
    && Object.keys(tp.orderLineBody(900, { source: SRC_LINES[0], dest: DST_LINES[0] }, 0, 'x')).every((k) => k in toDto.ToLineDto.properties));
  T.check('inspection bodies only use fields of InspectionDto', Object.keys(ip.inspectionBody(LINES[0], 'SHIP_OUT_YARD', 'T'))
    .concat(Object.keys(ip.completionBody('PASS', 'n', false, 'a', 'T'))).every((k) => k in toDto.InspectionDto.properties));

  // ── Transfer chains ─────────────────────────────────────────────────────────────────────────────────────

  function transferVars(extra) {
    return Object.assign({
      sourceRequestId: null, sourceRows: SRC_ROWS, destRows: DST_ROWS, invOrgs: [], recent: [], sourceId: 475, destId: 527, sourceQuery: '', destQuery: '',
      sourceLines: SRC_LINES, destLines: DST_LINES, selected: { 4751: true }, sites: { 4751: 3001, 4752: 3001 }, timesheets: TIMESHEETS, sourceHistory: [], destHistory: [],
      date: '2026-11-05', subinventory: 'TEXAS', locator: 'PRJ-2026-014', comments: 'Finished early', isLoading: false, loadError: '', sourceLoading: false, destLoading: false,
      sourceError: '', destError: '', sourceToken: 0, destToken: 0, isSaving: false, saveError: '', attempt: 0, done: null,
    }, extra || {});
  }
  function transferBackend(over) {
    return (o) => {
      if (over) {
        const r = over(o);
        if (r !== undefined) return r;
      }
      const e = o.endpoint;
      if (e === 'eqp-v1/planConfirm') return ok(PLAN);
      if (e === 'eqp-v1/reserveConfirm') return ok({ reservedLineIds: o.body.lineIds, rejectedLineIds: [], replayed: false });
      if (e === 'eqp-v1/createTransferOrder') return ok({ id: 900, orderNumber: o.body.orderNumber });
      if (e === 'eqp-v1/createTransferOrderLine') return ok({ id: 901 });
      if (e === 'eqp-v1/createTransferHistory') return ok({ id: 902 });
      if (e === 'eqp-v1/getTransferHistory') return ok({ data: [{ id: 902, sourceRequestLineId: 4751, transferStatus: 'PENDING' }] });
      return undefined;
    };
  }

  T.section('transfer chains: opening and picking');
  {
    const { calls, Actions } = fake((o) => (o.endpoint === 'eqp-v1/getEquipriteV1ViewsWorkbenchRequests' ? ok({ data: o.uriParams.stage === 'DEPLOYED' ? SRC_ROWS : DST_ROWS }) : ok({ data: [] })));
    const c = context(new TransfersPage(), transferVars({ sourceRows: [], destRows: [], sourceRequestId: 475 }));
    await new (chain(TRF, 'transfersInitChain', Actions))().run(c);
    T.eq('deployed and outbound requests, sites, recent history; then the request from the URL',
      calls.map((x) => x.endpoint ? x.endpoint.replace('eqp-v1/', '') + (x.uriParams.stage ? ':' + x.uriParams.stage : '') : 'chain:' + x.chain + ':' + x.params.id).join(' > '),
      'getEquipriteV1ViewsWorkbenchRequests:DEPLOYED > getEquipriteV1ViewsWorkbenchRequests:OUTBOUND > getInvOrgs > getTransferHistory > chain:pickRequestChain:475');
    T.eq('rows kept', c.$page.variables.sourceRows.length + '/' + c.$page.variables.destRows.length, '3/3');
  }
  {
    const { calls, Actions } = fake((o) => {
      if (o.endpoint === 'eqp-v1/getEquipriteV1ViewsRequestDetailLines') return ok({ data: SRC_LINES });
      if (o.endpoint === 'eqp-v1/getTransferOrders') return ok({ data: [
        { id: 300, orderType: 'OUTBOUND', destinationOrgId: 3001, createdDate: '2026-09-28' },
        { id: 310, orderType: 'INBOUND', destinationOrgId: 1001, createdDate: '2026-10-28' }] });
      if (o.endpoint === 'eqp-v1/getTransferOrderLines') return ok({ data: [{ requestLineId: 4751 }, { requestLineId: 4752 }] });
      if (o.endpoint === 'eqp-v1/getEquipriteV1ViewsTimesheetDetails') return ok({ data: TIMESHEETS });
      if (o.endpoint === 'eqp-v1/getTransferHistory') return ok({ data: [{ id: 1 }] });
      return undefined;
    });
    const c = context(new TransfersPage(), transferVars({ sourceId: null, destId: 530, sourceLines: [], destLines: [{ lineId: 1 }], selected: { 9: true }, sites: {}, timesheets: [] }));
    await new (chain(TRF, 'pickRequestChain', Actions))().run(c, { side: 'source', id: '475' });
    const v = c.$page.variables;
    T.eq('From: lines, history, transfer orders, timesheets, then the outbound order\'s lines (not the inbound)',
      rest(calls).join(' > '), 'getEquipriteV1ViewsRequestDetailLines > getTransferHistory > getTransferOrders > getEquipriteV1ViewsTimesheetDetails > getTransferOrderLines');
    T.eq('params', JSON.stringify(calls.map((x) => x.uriParams)),
      '[{"requestId":475,"size":500},{"equipmentRequestId":475},{"equipmentRequestId":475},{"requestNumber":"REQ-10475","size":500},{"transferOrderId":300}]');
    T.eq('each unit is at its outbound order\'s destination', JSON.stringify(v.sites), '{"4751":3001,"4752":3001}');
    T.check('a new From clears the To and the ticks', v.destId === null && !v.destLines.length && !Object.keys(v.selected).length && v.sourceId === 475);
  }
  {
    const { calls, Actions } = fake(() => ok({ data: [] }));
    const c = context(new TransfersPage(), transferVars({ sourceId: null }), { featureFlags: {} });
    await new (chain(TRF, 'pickRequestChain', Actions))().run(c, { side: 'source', id: '475' });
    T.check('timesheets off: no timesheet call', !calls.some((x) => /Timesheet/.test(x.endpoint || '')));
  }
  {
    const { calls, Actions } = fake((o) => (o.endpoint === 'eqp-v1/getEquipriteV1ViewsRequestDetailLines' ? ok({ data: DST_LINES }) : ok({ data: [] })));
    const c = context(new TransfersPage(), transferVars({ destId: null, destLines: [] }));
    await new (chain(TRF, 'pickRequestChain', Actions))().run(c, { side: 'dest', id: '527' });
    T.eq('To: its lines and its history', rest(calls).join(' > ') + ' ' + JSON.stringify(calls[0].uriParams), 'getEquipriteV1ViewsRequestDetailLines > getTransferHistory {"requestId":527,"size":500}');
    T.check('... the From stays', c.$page.variables.sourceId === 475 && c.$page.variables.destLines.length === 3);
    const Toggle = chain(TRF, 'toggleUnitChain', fake().Actions);
    await new Toggle().run(c, { lineId: '4752', checked: 'true' });
    await new Toggle().run(c, { lineId: '4751', checked: false });
    T.eq('ticks', JSON.stringify(c.$page.variables.selected), '{"4752":true}');
    const Field = chain(TRF, 'setFieldChain', fake().Actions);
    await new Field().run(c, { field: 'date', value: '2026-11-06' });
    await new Field().run(c, { field: 'sourceRows', value: 'x' });
    T.check('fields, and only the known ones', c.$page.variables.date === '2026-11-06' && Array.isArray(c.$page.variables.sourceRows));
  }

  T.section('transfer chains: the transfer');
  {
    const { calls, Actions } = fake(transferBackend());
    const c = context(new TransfersPage(), transferVars());
    await new (chain(TRF, 'createTransferChain', Actions))().run(c);
    const v = c.$page.variables;
    T.eq('plan, reserve, the order, its line, the history, then fresh history and lines for both requests',
      rest(calls).join(' > '), 'planConfirm > reserveConfirm > createTransferOrder > createTransferOrderLine > createTransferHistory'
      + ' > getTransferHistory > getTransferHistory > getTransferHistory > getEquipriteV1ViewsRequestDetailLines > getEquipriteV1ViewsRequestDetailLines');
    T.eq('plan on the destination request, for its lines', JSON.stringify([calls[0].uriParams, calls[0].body]), '[{"requestId":527},{"lineIds":[5271],"fallbackYardOrgId":null}]');
    const r = calls[1];
    T.check('reserve: the destination lines\' OUTBOUND leg, deterministic key, batch, audit header',
      r.uriParams.requestId === 527 && r.body.leg === 'OUTBOUND' && JSON.stringify(r.body.lineIds) === '[5271]'
      && r.body.idempotencyKey === tp.idempotencyKey(INTENT) && /^EQR-TRF-REQ-10527-\d+$/.test(r.body.batchNumber) && r.headers['X-User-Id'] === 'mia.ortiz');
    const to = calls[2].body;
    T.eq('the order: inter-project, pending, site to site, batch as its number',
      JSON.stringify([to.equipmentRequestId, to.orderType, to.orderStatus, to.sourceOrgId, to.destinationOrgId, to.orderNumber === r.body.batchNumber, to.shippingNotes]),
      '[527,"INTER_PROJECT","PENDING",3001,3002,true,"Finished early"]');
    T.eq('its line', JSON.stringify([calls[3].body.transferOrderId, calls[3].body.requestLineId, calls[3].body.serialNumber, calls[3].body.itemNumber]), '[900,5271,"DT-1108","EQ-DT30"]');
    T.eq('the history', JSON.stringify([calls[4].body.transferOrderId, calls[4].body.sourceRequestId, calls[4].body.destinationRequestId, calls[4].body.transferDate]),
      '[900,475,527,"2026-11-05T00:00:00Z"]');
    T.eq('history reloaded for both requests', JSON.stringify(calls.filter((x) => x.endpoint).slice(5, 8).map((x) => x.uriParams)), '[{"equipmentRequestId":475},{"equipmentRequestId":527},{}]');
    T.check('done, ticks and comments cleared, the unit now shows its pending transfer',
      v.done && v.done.count === 1 && v.done.orderNumber === r.body.batchNumber && !Object.keys(v.selected).length && v.comments === ''
      && !!tp.pendingFor(v.sourceHistory, 4751));
    T.eq('confirmation toast', calls.find((x) => x.toast).toast + '|' + calls.find((x) => x.toast).type, 'Transfer recorded|confirmation');
    T.eq('busy flag cleared', v.isSaving, false);
  }
  {
    const { calls, Actions } = fake(transferBackend());
    const c = context(new TransfersPage(), transferVars({ selected: { 4752: true } }));
    await new (chain(TRF, 'createTransferChain', Actions))().run(c);
    T.check('a problem on screen: nothing is called', !calls.length && /submitted timesheet/.test(c.$page.variables.saveError));
  }
  {
    const { calls, Actions } = fake(transferBackend());
    const c = context(new TransfersPage(), transferVars());
    const s = new (chain(TRF, 'createTransferChain', Actions))();
    await Promise.all([s.run(c), s.run(c)]);
    T.eq('a double click plans once', calls.filter((x) => x.endpoint === 'eqp-v1/planConfirm').length, 1);
  }

  T.section('transfer chains: failure paths');
  const run = async (over, extra) => {
    const { calls, Actions } = fake(transferBackend(over));
    const c = context(new TransfersPage(), transferVars(extra));
    await new (chain(TRF, 'createTransferChain', Actions))().run(c);
    return { calls, v: c.$page.variables };
  };
  {
    const { calls, v } = await run((o) => (o.endpoint === 'eqp-v1/planConfirm' ? fail(500) : undefined));
    T.check('plan fails: stop before the reserve', rest(calls).join() === 'planConfirm' && /could not be worked out/.test(v.saveError));
  }
  {
    const { calls, v } = await run((o) => (o.endpoint === 'eqp-v1/planConfirm' ? ok({ buckets: PLAN.buckets, blocks: [{ requestLineId: 5271, reasonCode: 'NEEDS_QUOTE', equipmentName: 'Dump Truck 30t' }] }) : undefined));
    T.check('a quote block: stop, say why', rest(calls).join() === 'planConfirm' && /quoted/.test(v.saveError));
  }
  {
    const { calls, v } = await run((o) => (o.endpoint === 'eqp-v1/planConfirm' ? ok({ buckets: [], blocks: [], empty: true, fAndMLineIds: [5271] }) : undefined));
    T.check('no destination site: stop', rest(calls).join() === 'planConfirm' && /No site is mapped/.test(v.saveError));
  }
  {
    const { calls, v } = await run((o) => (o.endpoint === 'eqp-v1/reserveConfirm' ? ok({ reservedLineIds: [], rejectedLineIds: [], replayed: true }) : undefined));
    T.check('reserve says replayed: success, nothing created', !calls.some((x) => /createTransfer/.test(x.endpoint || '')) && v.done && v.done.replayed === true && !v.saveError);
  }
  {
    const { calls, v } = await run((o) => (o.endpoint === 'eqp-v1/reserveConfirm' ? ok({ reservedLineIds: [], rejectedLineIds: [5271], replayed: false }) : undefined));
    T.check('a line held by another confirm: stop, nothing to release', rest(calls).join() === 'planConfirm,reserveConfirm' && /someone else/.test(v.saveError));
  }
  {
    const { calls } = await run((o) => (o.endpoint === 'eqp-v1/reserveConfirm' ? fail(503) : undefined));
    T.check('reserve unreachable: the transfer still goes through (the old confirm\'s rule)', calls.some((x) => x.endpoint === 'eqp-v1/createTransferHistory'));
  }
  {
    const { calls, v } = await run((o) => (o.endpoint === 'eqp-v1/createTransferOrder' ? fail(500) : undefined));
    T.eq('the order fails: release the reservation, nothing else', rest(calls).join(' > '), 'planConfirm > reserveConfirm > createTransferOrder > releaseReservation');
    T.check('... the release names the batch; a retry is a new intent', calls[3].body.batchNumber === calls[1].body.batchNumber && calls[3].uriParams.requestId === 527
      && v.attempt === 1 && /Nothing was transferred/.test(v.saveError));
    const { calls: again } = await run(undefined, { attempt: v.attempt });
    T.check('... and the retry\'s key differs', again[1].body.idempotencyKey !== calls[1].body.idempotencyKey);
  }
  {
    const { calls, v } = await run((o) => (o.endpoint === 'eqp-v1/createTransferOrderLine' ? fail(400) : undefined));
    T.eq('a line fails: cancel the order, release, stop', rest(calls).join(' > '), 'planConfirm > reserveConfirm > createTransferOrder > createTransferOrderLine > patchTransferOrder > releaseReservation');
    T.check('... cancelled', JSON.stringify(calls[4].uriParams) === '{"id":900}' && calls[4].body.orderStatus === 'CANCELLED' && /was cancelled/.test(v.saveError) && !v.done);
  }
  {
    const { calls, v } = await run((o) => (o.endpoint === 'eqp-v1/createTransferHistory' ? fail(500) : undefined));
    T.check('history fails: the order stands, it is said', !calls.some((x) => x.endpoint === 'eqp-v1/releaseReservation') && v.done && /history entry of 1 unit/.test(v.done.historyError)
      && calls.find((x) => x.toast).type === 'warning');
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════
  // Wiring
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════

  T.section('every endpoint the chains call exists in services/');
  const ops = {};
  ['eqp-v1', 'commonService'].forEach((svc) => {
    const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'services', svc, 'openapi3.json'), 'utf8'));
    Object.values(spec.paths || {}).forEach((p) => Object.values(p).forEach((op) => { if (op && op.operationId) ops[svc + '/' + op.operationId] = true; }));
  });
  const used = new Set();
  [INSP, TRF].forEach((dir) => fs.readdirSync(dir).forEach((f) => {
    (fs.readFileSync(path.join(dir, f), 'utf8').match(/'(eqp-v1|commonService)\/[A-Za-z0-9_]+'/g) || []).forEach((m) => used.add(m.slice(1, -1)));
  }));
  T.check('the chains name endpoints', used.size >= 20, used.size + '');
  [...used].sort().forEach((e) => T.check(e, !!ops[e]));
  ['getInspections', 'createInspection', 'patchInspection', 'getInspectionChecklists', 'createInspectionResponse', 'patchInspectionResponse', 'getInspectionResponses',
    'createInspectionDefect', 'getInspectionDefects', 'createTransferOrder', 'createTransferOrderLine', 'createTransferHistory', 'getTransferHistory',
    'planConfirm', 'reserveConfirm'].forEach((op) => T.check('uses ' + op, used.has('eqp-v1/' + op)));

  T.section('pages: listeners, functions and chains line up');
  [['inspection', ip, INSP], ['transfers', tp, TRF]].forEach(([name, mod, dir]) => {
    const html = fs.readFileSync(path.join(PAGES, name + '-page.html'), 'utf8');
    const json = JSON.parse(fs.readFileSync(path.join(PAGES, name + '-page.json'), 'utf8'));
    const listeners = [...new Set((html.match(/\$listeners\.([A-Za-z]+)/g) || []).map((m) => m.split('.')[1]))];
    T.check(name + ': every listener in the HTML is declared', listeners.every((l) => json.eventListeners[l]), listeners.filter((l) => !json.eventListeners[l]).join(', '));
    const fnsHtml = [...new Set((html.match(/\$functions\.([A-Za-z]+)/g) || []).map((m) => m.split('.')[1]))];
    T.check(name + ': every function in the HTML exists (' + fnsHtml.length + ')', fnsHtml.every((f) => typeof mod[f] === 'function'), fnsHtml.filter((f) => typeof mod[f] !== 'function').join(', '));
    const fnsChains = new Set();
    // The guard and menu-jump chains are shared copies that call $application.functions, not the page's.
    fs.readdirSync(dir).filter((f) => !/^(enforcePageAccessChain|openNavChain)\.js$/.test(f))
      .forEach((f) => (fs.readFileSync(path.join(dir, f), 'utf8').match(/fns\.([A-Za-z]+)\(/g) || []).forEach((m) => fnsChains.add(m.slice(4, -1))));
    T.check(name + ': every page function the chains call exists', [...fnsChains].every((f) => typeof mod[f] === 'function'), [...fnsChains].filter((f) => typeof mod[f] !== 'function').join(', '));
    const vars = new Set(Object.keys(json.variables));
    const used2 = [...new Set((html.match(/\$variables\.([A-Za-z]+)/g) || []).map((m) => m.split('.')[1]))];
    T.check(name + ': every variable in the HTML is declared', used2.every((x) => vars.has(x)), used2.filter((x) => !vars.has(x)).join(', '));
    T.check(name + ': no function or object literals inside bindings', !/\[\[[^\]]*(function\s*\(|=>|\{\s*[a-zA-Z]+\s*:)/.test(html));
    T.check(name + ': the band\'s Old button only shows when the old app has the screen', /oj-bind-if test="\[\[ \$application\.functions\.oldAppLink\(/.test(html));
    T.eq(name + ': guard chain is the shared copy', fs.readFileSync(path.join(dir, 'enforcePageAccessChain.js'), 'utf8'),
      fs.readFileSync(path.join(NEW, 'flows', 'request', 'pages', 'my-requests-page-chains', 'enforcePageAccessChain.js'), 'utf8'));
  });
  const flow = JSON.parse(fs.readFileSync(path.join(NEW, 'flows', 'operations', 'operations-flow.json'), 'utf8'));
  T.eq('flow id and pages', flow.id + ':' + Object.keys(flow.pages).join(','), 'operations:inspection,transfers');
  // app-flow.js wants a little DOM (same stand-ins as tests/new-app.test.js).
  const appSandbox = {
    console, setTimeout, window: { location: { href: '' } }, document: { querySelectorAll: () => [], body: {} },
    MutationObserver: function MO() { this.observe = () => {}; },
  };
  let App;
  appSandbox.define = (names, factory) => {
    const deps = { 'ojs/ojarraydataprovider': function ADP() {}, 'resources/js/lineStatusLabels': { formatLabel: (x) => x } };
    App = factory(...names.map((n) => deps[n] || {}));
  };
  vm.createContext(appSandbox);
  vm.runInContext(fs.readFileSync(path.join(NEW, 'app-flow.js'), 'utf8'), appSandbox, { filename: 'app-flow.js' });
  const app = new App();
  T.eq('menu: both items are built and route to the flow', JSON.stringify([app.navItem('inspection').status, app.getNavRoute('inspection'), app.navItem('transfer').status, app.getNavRoute('transfer')]),
    '["new",{"flow":"operations","page":"inspection"},"new",{"flow":"operations","page":"transfers"}]');
  T.eq('menu: no old screen, so no Old link', app.oldAppLink('http://old/', 'inspection') + app.oldAppLink('http://old/', 'transfer'), '');
  T.eq('page access: both pages are gated by the workbench code', app.getPageCodeForPage({ id: 'inspection' }) + ',' + app.getPageCodeForPage({ id: 'transfers' }), 'EQR_WORKBENCH,EQR_WORKBENCH');

  T.report();
})();
