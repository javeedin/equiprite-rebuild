/*
 * EquipRite Next, the Redwood views of the yard and the checks (Picking & shipping, Receiving & returns, Transfers,
 * Inspections): each list as flat oj-table rows with its status as an oj-badge and the steps it offers
 * (yardWork / transferList / inspectionQueue .redwoodRows), a Smart Search filter per column offering what the rows hold
 * with how many (columnOptions), the column filters only the Redwood view shows (byColumns); and, for each screen, the
 * search config, the page's search context, the Smart Search markup and the filter chain agree. Loads the real modules.
 *
 * Run:  node tests/next-redwood-yard.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const NEXT = path.join(__dirname, '..', 'webApps', 'equiprite-next');
const MOBILE = path.join(__dirname, '..', 'webApps', 'equiprite-mobile');
const JS = path.join(NEXT, 'resources', 'js');

function load(name, deps) {
  const sandbox = { console, Intl, Date, JSON, Math };
  let mod;
  sandbox.define = (names, factory) => { mod = factory(...names.map((n) => (deps || {})[n])); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(JS, name + '.js'), 'utf8'), sandbox, { filename: name + '.js' });
  return mod;
}
const rules = load('rules');
const fmt = load('fmt');
const Progress = load('requestProgress');
const requestData = load('requestData', { 'resources/js/rules': rules });
const rdl = load('requestDetailLines');
const yw = load('yardWork', { 'resources/js/requestProgress': Progress, 'resources/js/requestData': requestData, 'resources/js/requestDetailLines': rdl,
  'resources/js/fmt': fmt });
const TL = load('transferList', { 'resources/js/fmt': fmt, 'resources/js/requestProgress': Progress });
const Rules = load('inspectionRules');
const Q = load('inspectionQueue', { 'resources/js/inspectionRules': Rules, 'resources/js/fmt': fmt, 'resources/js/requestProgress': Progress });

const NOW = Date.UTC(2026, 10, 4, 10);
const d = (n) => new Date(NOW + n * 86400000).toISOString().slice(0, 10);
const labels = (a) => a.map((o) => o.label).join(' | ');
const isExternal = (s) => String(s || '').toUpperCase() === 'EXTERNAL';

// ── Picking & shipping ───────────────────────────────────────────────────────────────────────────────────────
T.section('Picking & shipping: a row per request, its step a badge, the steps it offers');
const line = (rid, id, status, extra) => Object.assign({ requestId: rid, lineId: id, equipmentName: 'Item ' + id, quantity: 1, lineStatus: status }, extra || {});
const PICK = yw.queueRows([
  { eqrEquipmentRequestId: 501, requestNumber: 'REQ-1', requestStatus: 'IN_PROCESS', source: 'INTERNAL', projectName: 'Plant B', taskName: '1.3', requestor: 'John',
    location: 'Pier A', requestedStartDate: d(-3), requestedEndDate: d(20) },
  { eqrEquipmentRequestId: 502, requestNumber: 'REQ-2', requestStatus: 'IN_PROCESS', source: 'INTERNAL', projectName: 'Pipeline', requestedStartDate: d(0), requestedEndDate: d(30) },
  { eqrEquipmentRequestId: 503, requestNumber: 'REQ-3', requestStatus: 'IN_PROCESS', source: 'EXTERNAL', customerName: 'Gulf', contactName: 'Dana',
    requestedStartDate: d(5), requestedEndDate: d(60) },
], isExternal);
const PICK_LINES = {
  501: [line(501, 1, 'SCHEDULED_FOR_PICKING', { equipmentName: 'Excavator', toNumber: 'TO-1' }), line(501, 2, 'PICK_INITIATED', { equipmentName: 'Drone' }),
    line(501, 3, 'ALLOCATED', { equipmentName: 'Bowser' })],
  502: [line(502, 4, 'PICK_INITIATED', { equipmentName: 'Trencher' })],
  503: [line(503, 5, 'EQP_INSPECTION_COMPLETE', { equipmentName: 'Crane' }), line(503, 6, 'SHIP_TO_SITE', { equipmentName: 'Generator' })],
};
const YARDS = { 1: 'Houston Yard', 2: 'Atlanta Yard', 4: 'Atlanta Yard', 5: 'Houston Yard', 6: 'Houston Yard' };
const pItems = yw.items('picking', PICK, PICK_LINES, YARDS, NOW, {});
const pRows = yw.redwoodRows('picking', yw.redwoodOrder('picking', pItems), PICK_LINES, { act: true, confirm: true });
T.eq('in the current look\'s order: late first, then by the day needed', pRows.map((r) => r.number).join(), 'REQ-1,REQ-2,REQ-3');
T.eq('a row: its key, how late, the step and its badge', [pRows[0].key, pRows[0].when, pRows[0].late, pRows[0].step, pRows[0].badge].join(' | '),
  '501 | 3 days late | true | To pick | oj-badge oj-badge-warning oj-badge-subtle');
T.eq('the steps a row offers, the first the main one', pRows[0].steps.map((s) => s.act + ':' + s.label + ':' + s.chroming).join(' '),
  'release:Release 1:callToAction ship:Ship 1:outlined confirm:Confirm 1:outlined');
T.eq('each request\'s step', pRows.map((r) => r.step + ' = ' + r.badge.replace(/oj-badge ?/g, '').trim()).join(' | '),
  'To pick = -warning -subtle | Being picked = -info -subtle | Ready to ship = -info');
T.eq('the yard and the type', pRows.map((r) => r.yard + ' / ' + r.type).join(' | '), 'Houston Yard, Atlanta Yard / Project | Atlanta Yard / Project | Houston Yard / Customer');
T.eq('no step without the access to take it', yw.redwoodRows('picking', pItems, PICK_LINES, {}).map((r) => r.steps.length).join(), '0,0,0');
T.eq('Confirm only for who may confirm', yw.redwoodRows('picking', [pItems.filter((it) => it.id === '501')[0]], PICK_LINES, { act: true })[0].steps.map((s) => s.act).join(),
  'release,ship');

T.section('Picking & shipping: a filter per column, what the rows hold, how many');
const pOpts = yw.columnOptions('picking', pItems, yw.tiles('picking', pItems), yw.yardOptions(pItems), NOW);
T.eq('Needed: the sections the requests sit in', labels(pOpts.when), 'Late (1) | Today (1) | Within a week (1)');
T.eq('Request: newest first, with its project or customer', labels(pOpts.number), 'REQ-3 · Gulf | REQ-2 · Pipeline | REQ-1 · Plant B');
T.eq('Project or customer', labels(pOpts.party), 'Gulf (1) | Pipeline (1) | Plant B (1)');
T.eq('Step: the step tiles, with how many requests', labels(pOpts.stage), 'All (3) | Late (1) | To pick (1) | Being picked (2) | Ready to ship (1) | Shipped (1)');
T.eq('From yard: the yard chips', labels(pOpts.yard), 'All yards (3) | Atlanta Yard (2) | Houston Yard (2)');
T.eq('Next step: the kind of step', labels(pOpts.next), 'Pick and ship (1) | Release for picking (1) | Ship confirm in Fusion (1)');
T.eq('Type', labels(pOpts.type), 'Project (2) | Customer (1)');
const pPick = (f) => yw.byColumns('picking', pItems, f, NOW).map((it) => it.requestNumber).sort().join();
T.eq('nothing picked: all', pPick({}), 'REQ-1,REQ-2,REQ-3');
T.eq('Needed', pPick({ when: 'today' }), 'REQ-2');
T.eq('Request', pPick({ number: 'REQ-3' }), 'REQ-3');
T.eq('Project or customer', pPick({ party: 'Plant B' }), 'REQ-1');
T.eq('Next step', pPick({ next: 'Pick and ship' }), 'REQ-2');
T.eq('Type', pPick({ type: 'Customer' }), 'REQ-3');
T.eq('two at once: both must hold', pPick({ type: 'Project', next: 'Release for picking' }), 'REQ-1');

// ── Receiving & returns ──────────────────────────────────────────────────────────────────────────────────────
T.section('Receiving & returns: rows, steps and filters');
const RET = yw.queueRows([
  { eqrEquipmentRequestId: 601, requestNumber: 'REQ-6', requestStatus: 'DEPLOYED', source: 'INTERNAL', projectName: 'Plant B', taskName: '4.2', requestedEndDate: d(-45) },
  { eqrEquipmentRequestId: 602, requestNumber: 'REQ-7', requestStatus: 'DEPLOYED', source: 'EXTERNAL', customerName: 'Lone Star', contactName: 'Ann', requestedEndDate: d(2) },
  { eqrEquipmentRequestId: 603, requestNumber: 'REQ-8', requestStatus: 'DEPLOYED', source: 'INTERNAL', projectName: 'Survey', requestor: 'Priya', requestedEndDate: d(30) },
], isExternal);
const RET_LINES = {
  601: [line(601, 11, 'SHIPPED_TO_YARD'), line(601, 12, 'RETURN_IN_PROCESS'), line(601, 13, 'DEPLOYED')],
  602: [line(602, 14, 'RETURN_INITIATED')],
  603: [line(603, 15, 'DEPLOYED')],
};
const rItems = yw.items('returns', RET, RET_LINES, {}, NOW, {});
const rRows = yw.redwoodRows('returns', yw.redwoodOrder('returns', rItems), RET_LINES, { act: true });
T.eq('overdue first, then by the yard\'s job', rRows.map((r) => r.number + ':' + r.step).join(' | '), 'REQ-6:Overdue | REQ-7:Return requested | REQ-8:On site');
T.eq('Overdue is a danger badge', rRows[0].badge, 'oj-badge oj-badge-danger oj-badge-subtle');
T.eq('Receive N where something is back at the yard', rRows.map((r) => r.steps.map((s) => s.act + ':' + s.label + ':' + s.chroming).join()).join(' | '),
  'receive:Receive 1:callToAction |  | ');
const rOpts = yw.columnOptions('returns', rItems, yw.tiles('returns', rItems), yw.yardOptions(rItems), NOW);
T.eq('Due back: where the date is', labels(rOpts.when), 'Overdue (1) | Due back in the next 7 days (1) | Due back later (1)');
T.eq('Step: the step tiles', labels(rOpts.stage), 'All (3) | Overdue (1) | To receive (1) | Return requested (1) | On the way back (1) | On site (2)');
T.eq('Next step', labels(rOpts.next), 'Due back (1) | Raise the return transfer order (1) | Receive at the yard (1)');
T.eq('Due back narrows', yw.byColumns('returns', rItems, { when: 'week' }, NOW).map((it) => it.requestNumber).join(), 'REQ-7');

// ── Transfers ────────────────────────────────────────────────────────────────────────────────────────────────
T.section('Transfers: rows, badges and filters');
const tctx = {
  orgs: [{ organizationId: 1001, organizationCode: 'YARD1', organizationName: 'Houston yard' }, { organizationId: 3001, organizationCode: 'TEXAS', organizationName: 'Texas sites' }],
  requests: { 475: { number: 'REQ-475', party: 'Pipeline' }, 560: { number: 'REQ-560', party: 'Harbour' } },
  toLines: { 300: [{ requestLineId: 4751, serialNumber: 'DT-1' }], 330: [{ requestLineId: 5601, serialNumber: 'LT-3' }] },
  lines: TL.indexLines([{ lineId: 4751, equipmentName: 'Dump truck', lineStatus: 'DEPLOYED', allocatedSerial: 'DT-1' },
    { lineId: 5601, equipmentName: 'Light tower', lineStatus: 'SHIPPED_TO_YARD', allocatedSerial: 'LT-3' }]),
  history: [],
  now: NOW,
};
const trf = [
  { id: 300, equipmentRequestId: 475, orderNumber: 'TO-300', orderType: 'OUTBOUND', orderStatus: 'PENDING', sourceOrgId: 1001, destinationOrgId: 3001, needByDate: d(-30) },
  { id: 330, equipmentRequestId: 560, orderNumber: 'TO-330', orderType: 'INBOUND', orderStatus: 'PENDING', sourceOrgId: 3001, destinationOrgId: 1001, needByDate: d(-1) },
  { id: 340, equipmentRequestId: 475, orderNumber: 'TO-340', orderType: 'OUTBOUND', orderStatus: 'CANCELLED', sourceOrgId: 1001, destinationOrgId: 3001 },
].map((o) => TL.decorate(o, tctx));
const tRows = TL.redwoodRows(TL.sort(trf, 'due', 'asc'));
T.eq('a row per transfer, what is still open first', tRows.map((r) => r.number).join(), 'TO-330,TO-300,TO-340');
T.eq('a row: kind, request, where it is, its badge, how late', [tRows[0].kind, tRows[0].request, tRows[0].status, tRows[0].badge, tRows[0].due, tRows[0].units].join(' | '),
  'Back to the yard | REQ-560 | On the way back to the yard | oj-badge oj-badge-info oj-badge-subtle | Due back at the yard 3 Nov · 1 day late | 1 unit');
T.eq('arrived: success; cancelled: neutral, nothing to read', [tRows[1].badge, tRows[2].badge, tRows[2].units].join(' | '),
  'oj-badge oj-badge-success oj-badge-subtle | oj-badge oj-badge-subtle | ');
T.eq('the header badge of a transfer\'s tab', JSON.stringify([TL.headerBadge(trf[1]), TL.headerBadge({})]), '[{"text":"On the way back to the yard","status":"info"},{}]');
const tOpts = TL.columnOptions(trf, TL.chips(trf), TL.kinds(trf), NOW);
T.eq('Transfer', labels(tOpts.number), 'TO-300 · Out to site | TO-330 · Back to the yard | TO-340 · Out to site');
T.eq('Request', labels(tOpts.request), 'REQ-475 (2) | REQ-560 (1)');
T.eq('What is moving: a transfer counted once', labels(tOpts.what), 'Dump truck (1) | Light tower (1)');
T.eq('Where it is: the chips', labels(tOpts.chip), 'All (3) | Late (1) | Not left yet (0) | On the way (1) | Arrived (1) | Stopped (0)');
T.eq('Due', labels(tOpts.due), 'Late (1) | Due date passed (1) | No due date (1)');
T.eq('Kind: the kinds', labels(tOpts.kind), 'Every kind (3) | Out to site (2) | Back to the yard (1) | Between projects (0)');
const tPick = (f) => TL.byColumns(trf, f, NOW).map((r) => r.number).join();
T.eq('Request narrows', tPick({ request: 'REQ-475' }), 'TO-300,TO-340');
T.eq('What is moving narrows', tPick({ what: 'Light tower' }), 'TO-330');
T.eq('Due narrows', tPick({ due: 'late' }), 'TO-330');
T.eq('From → to narrows', tPick({ route: trf[1].route }), 'TO-330');

// ── Inspections ──────────────────────────────────────────────────────────────────────────────────────────────
T.section('Inspections: rows, badges and filters');
const ILINES = [
  { lineId: 1, requestId: 9, requestNumber: 'REQ-9', projectName: 'Pipeline', equipmentClassId: 10, equipmentSubclassId: 101, equipmentName: 'Crane', className: 'Cranes',
    lineStatus: 'PICK_RELEASED', allocatedSerial: 'MC-1', startDate: d(-2) + 'T00:00:00Z', endDate: d(40) + 'T00:00:00Z' },
  { lineId: 2, requestId: 9, requestNumber: 'REQ-9', projectName: 'Pipeline', equipmentClassId: 20, equipmentName: 'Generator', className: 'Power',
    lineStatus: 'INSPECTION_FAILED', allocatedSerial: 'GN-1', startDate: d(4) + 'T00:00:00Z', endDate: d(40) + 'T00:00:00Z' },
  { lineId: 3, requestId: 8, requestNumber: 'REQ-8', projectName: 'Plant', equipmentClassId: 30, equipmentName: 'Light tower', className: 'Lighting',
    lineStatus: 'SHIPPED_TO_YARD', allocatedSerial: 'LT-1', startDate: d(-30) + 'T00:00:00Z', endDate: d(-1) + 'T00:00:00Z' },
];
const MATRIX = [
  { id: 1, equipmentClassId: 10, equipmentSubclassId: 101, inspectionType: 'SHIP_OUT_YARD', isMandatoryFlag: 'Y', isActiveFlag: 'Y' },
  { id: 2, equipmentClassId: 20, equipmentSubclassId: null, inspectionType: 'SHIP_OUT_YARD', isMandatoryFlag: 'Y', isActiveFlag: 'Y' },
];
const entries = Q.entries(ILINES, MATRIX, 'all', NOW);
const iRows = Q.redwoodRows(entries);
T.eq('a row per unit: its point (or Failed inspection) as a badge, asked for', iRows.map((r) => r.unit + ' | ' + r.point + ' | ' + r.badge.replace(/oj-badge ?/g, '').trim()
  + ' | ' + r.asked).join(' || '),
  'Crane · MC-1 | Leaving the yard | -warning -subtle | Asked for || Generator · GN-1 | Failed inspection | -danger -subtle | Asked for'
  + ' || Light tower · LT-1 | Back at the yard | -info -subtle | Optional');
T.eq('late, in words', iRows[0].when + ' / ' + iRows[0].late, 'Needed on site since 2 Nov · 2 days late / true');
const iOpts = Q.columnOptions(entries, Q.chips(entries), { required: 2, all: 3 }, NOW);
T.eq('Equipment', labels(iOpts.unit), 'Crane (1) | Generator (1) | Light tower (1)');
T.eq('Request', labels(iOpts.request), 'REQ-8 (1) | REQ-9 (2)');
T.eq('Inspection: the chips', labels(iOpts.chip), 'Everything waiting (3) | Late (1) | Leaving the yard (1) | Arriving on site (0) | Leaving a site (0) | Back at the yard (1)'
  + ' | Failed, needs a decision (1)');
T.eq('When', labels(iOpts.when), 'Late (1) | In the next 7 days (1) | Already past (1)');
T.eq('Which units', labels(iOpts.scope), 'Asked for by the matrix (2) | Everything waiting (3)');
const iPick = (f) => Q.byColumns(entries, f, NOW).map((e) => e.lineId).join();
T.eq('Equipment narrows', iPick({ unit: 'Generator' }), '2');
T.eq('Request narrows', iPick({ request: 'REQ-9' }), '1,2');
T.eq('When narrows', iPick({ when: 'past' }), '3');
T.eq('a unit\'s header badge', JSON.stringify(Q.headerBadge('Failed inspection', 'stopped')), '{"text":"Failed inspection","status":"danger"}');

// ── The config, the page, the markup and the filter chain agree ─────────────────────────────────────────────
const SCREENS = [
  { name: 'Picking & shipping', config: 'pickingSearchConfig.json', dir: 'yard', page: 'picking',
    labels: 'Needed,Request,Project or customer,Step,From yard,Next step,Type', fields: 'when,number,party,stage,yard,next,type' },
  { name: 'Receiving & returns', config: 'returnsSearchConfig.json', dir: 'yard', page: 'returns',
    labels: 'Due back,Request,Project or customer,Step,Back to yard,Next step,Type', fields: 'when,number,party,stage,yard,next,type' },
  { name: 'Transfers', config: 'transfersSearchConfig.json', dir: 'checks', page: 'transfers',
    labels: 'Transfer,Request,From → to,What is moving,Where it is,Due,Kind', fields: 'number,request,route,what,chip,due,kind' },
  { name: 'Inspections', config: 'inspectionSearchConfig.json', dir: 'checks', page: 'inspection',
    labels: 'Equipment,Request,Inspection,When,Which units', fields: 'unit,request,chip,when,scope' },
];
SCREENS.forEach((s) => {
  T.section(s.name + ': the config, the page and the markup agree');
  const pages = path.join(NEXT, 'flows', s.dir, 'pages');
  const cfg = JSON.parse(fs.readFileSync(path.join(NEXT, 'resources', 'data', s.config), 'utf8'));
  const pj = JSON.parse(fs.readFileSync(path.join(pages, s.page + '-page.json'), 'utf8'));
  const html = fs.readFileSync(path.join(pages, s.page + '-page.html'), 'utf8');
  const chain = fs.readFileSync(path.join(pages, s.page + '-page-chains', 'rwFilterChain.js'), 'utf8');
  const ids = Object.keys(cfg.filters);
  T.eq('the filters are the columns, in their order', ids.map((k) => cfg.filters[k].label).join(), s.labels);
  const ctx = pj.variables.rwSearchContext.defaultValue.$search.filters;
  T.eq('every filter has its search context (one without throws and blanks the table)', ids.filter((k) => !ctx[k]).join(), '');
  T.check('every context reads an options list the page fills', ids.every((k) => {
    const m = /\$page\.variables\.(\w+)ADP/.exec(ctx[k].options.optionsData);
    return m && pj.variables[m[1]] && pj.variables[m[1] + 'ADP'] && pj.variables[m[1] + 'ADP'].defaultValue.keyAttributes === 'value';
  }));
  const sugg = /suggestion-filters='(\[[^']*\])'/.exec(html);
  T.eq('Smart Search offers them all', sugg ? JSON.parse(sugg[1]).join() : '', ids.join());
  T.eq('the fields', ids.map((k) => cfg.filters[k].options.field).join(), s.fields);
  T.check('… each one read by the filter chain', s.fields.split(',').every((f) => chain.includes("'" + f + "'")));
  T.check('the search config is the page\'s', pj.variables.rwSearchConfig.defaultValue.url.includes(s.config));
  T.check('Oracle\'s components are imported', ['oj-sp-smart-search-page', 'oj-sp-smart-search', 'oj-sp-collection-container', 'oj-table', 'oj-c-button']
    .every((c) => pj.imports.components[c]));
  T.check('the Redwood view goes on the page once Redwood is shown, and is only hidden under Current',
    /<oj-bind-if test="\[\[ \$application\.variables\.lookSeen \]\]">\s*<div class="nx-rw" id="\w+" :hidden="\[\[ \$application\.variables\.look !== 'redwood'/.test(html));
});

T.section('A transfer\'s tab: Oracle\'s general overview page');
{
  const pj = JSON.parse(fs.readFileSync(path.join(NEXT, 'flows', 'checks', 'pages', 'transfer-page.json'), 'utf8'));
  const html = fs.readFileSync(path.join(NEXT, 'flows', 'checks', 'pages', 'transfer-page.html'), 'utf8');
  T.check('the header, its badge, actions and in-flow back', /<oj-sp-general-overview-page[^>]*badge="\[\[ \$functions\.rwBadge/.test(html)
    && /on-sp-secondary-action="\[\[ \$listeners\.onRwAction \]\]"/.test(html) && /display-options\.in-flow-back="true" on-sp-in-flow-back="\[\[ \$listeners\.onRwBack \]\]"/.test(html)
    && !!pj.imports.components['oj-sp-general-overview-page'] && pj.eventListeners.onRwBack.chains[0].chain === 'openListChain');
}

T.section('the modules shared with Mobile stay the same files');
['yardWork', 'transferList', 'inspectionQueue'].forEach((m) => {
  T.check(m + '.js', fs.readFileSync(path.join(JS, m + '.js'), 'utf8') === fs.readFileSync(path.join(MOBILE, 'resources', 'js', m + '.js'), 'utf8'));
});

T.report();
