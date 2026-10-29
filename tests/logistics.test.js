/*
 * New EquipRite, Initiate picking and Receipt & returns (webApps/equiprite/flows/logistics).
 *
 * Checks the two pages against the old ones they replace (initiate-picking, equipment-returns):
 *   - the chains copied unchanged ARE unchanged (byte for byte), the adapted ones call the same endpoints in the
 *     same order, and the resources/js helpers are the old files
 *   - every chain that writes, run with a fake Actions against a stateful fake backend: endpoint, body, headers,
 *     order, and what happens on a failure (nothing half-done, rollback, the message)
 *   - the page functions (queue filters, ticks, what each button may do, counts, labels)
 *   - every endpoint the pages call exists in services/
 *
 * Run:  node tests/logistics.test.js
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
const PAGES = path.join(NEW, 'flows', 'logistics', 'pages');
const PICK = path.join(PAGES, 'picking-page-chains');
const RET = path.join(PAGES, 'receipt-page-chains');
const OLD_PAGES = path.join(OLD, 'flows', 'equipment-foundation', 'pages');
const OLD_PICK = path.join(OLD_PAGES, 'initiate-picking-page-chains');
const OLD_RET = path.join(OLD_PAGES, 'equipment-returns-page-chains');
const JS = path.join(NEW, 'resources', 'js');

// ── Loading the real modules ───────────────────────────────────────────────────────────────────────────────

const revoked = [];
const GLOBALS = {
  document: {
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => ({ style: {}, click() {} }), body: { appendChild() {}, removeChild() {} },
  },
  window: {},
  URL: { revokeObjectURL: (u) => revoked.push(u) },
  MutationObserver: function MutationObserver() { this.observe = () => {}; },
};

// The chains log a lot (they did in Old EquipRite too); LOGISTICS_TEST_VERBOSE=1 shows it.
const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
const chainConsole = process.env.LOGISTICS_TEST_VERBOSE ? console : quiet;

function loadAmd(file, deps) {
  const sandbox = Object.assign({ console: chainConsole, setTimeout, clearTimeout, Promise }, GLOBALS);
  let mod;
  sandbox.define = (names, factory) => {
    mod = factory(...names.map((n) => {
      if (deps && n in deps) return deps[n];
      throw new Error(`${path.basename(file)}: no stand-in for dependency ${n}`);
    }));
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: path.basename(file) });
  return mod;
}

const lineStatusLabels = loadAmd(path.join(JS, 'lineStatusLabels.js'), {});
const cu = loadAmd(path.join(JS, 'currentUser.js'), {});
const lineBody = loadAmd(path.join(JS, 'requestLineBody.js'), {});
const rto = loadAmd(path.join(JS, 'releaseTransferOrder.js'), {});
const rdl = loadAmd(path.join(JS, 'requestDetailLines.js'), {});
const maint = loadAmd(path.join(JS, 'maintAssetLocation.js'), {});
const returnLeg = loadAmd(path.join(JS, 'returnLeg.js'), {});
const directReturn = loadAmd(path.join(JS, 'directReturn.js'), {});
const pickSlip = loadAmd(path.join(JS, 'pickSlip.js'), { jspdf: { jsPDF: function FakePdf() {} } });
const AppModule = loadAmd(path.join(NEW, 'app-flow.js'), {
  'oj-sp/spectra-shell/config/config': {}, 'resources/js/lineStatusLabels': lineStatusLabels,
  'ojs/ojarraydataprovider': function ADP(data) { this.data = data; }, 'css!resources/css/app': {},
});
const app = new AppModule();

/** AMD `require` stand-in: the async form loads from MODULES (or fails), the sync form only returns loaded ones. */
function makeRequire(modules, failIds) {
  const loaded = new Set();
  const loads = [];
  const req = (ids, ok, fail) => {
    if (Array.isArray(ids)) {
      loads.push(...ids);
      if (ids.some((id) => (failIds || []).includes(id))) { if (fail) fail(new Error('script error')); return undefined; }
      ids.forEach((id) => loaded.add(id));
      ok(...ids.map((id) => modules[id]));
      return undefined;
    }
    if (!loaded.has(ids)) throw new Error(`Module name "${ids}" has not been loaded yet`);
    return modules[ids];
  };
  req.loads = loads;
  return req;
}

/**
 * A fake VB runtime for one page: Actions records every call; callChain runs the page's real chain (or a stand-in
 * from `stubs`). `respond(o)` answers callRest; undefined -> { ok: true, body: { data: [] } }.
 */
function runtime(chainsDir, respond, opts) {
  const o = opts || {};
  const calls = [];
  const toasts = [];
  const chainCalls = [];
  const cache = {};
  const req = makeRequire({ 'resources/js/pickSlip': o.pickSlip || pickSlip }, o.failLoads);
  const Actions = {
    async callRest(context, r) {
      calls.push({ endpoint: r.endpoint, uriParams: r.uriParams, body: r.body ? JSON.parse(JSON.stringify(r.body)) : r.body, headers: r.headers });
      const a = await respond(r, calls);
      return a || { ok: true, status: 200, body: { data: [] } };
    },
    async fireNotificationEvent(context, n) { toasts.push(n); },
    async callChain(context, c) {
      chainCalls.push({ chain: c.chain, params: c.params });
      if (o.stubs && o.stubs[c.chain]) return o.stubs[c.chain](context, c.params || {});
      return new (load(c.chain))().run(context, c.params || {});
    },
    async navigateToPage() {}, async navigateToFlow() {},
  };
  const deps = {
    require: req,
    'vb/action/actionChain': class ActionChain {},
    'vb/action/actions': Actions,
    'ojs/ojkeyset': { KeySetImpl: function KeySetImpl() {} },
    'resources/js/currentUser': cu,
    'resources/js/requestLineBody': lineBody,
    'resources/js/releaseTransferOrder': rto,
    'resources/js/requestDetailLines': rdl,
    'resources/js/maintAssetLocation': maint,
    'resources/js/returnLeg': returnLeg,
    'resources/js/directReturn': directReturn,
    'resources/js/unitScanner': o.scanner || {},
    'resources/js/pickSlip': o.pickSlip || pickSlip,
  };
  function load(name) {
    if (!cache[name]) cache[name] = loadAmd(path.join(chainsDir, `${name}.js`), deps);
    return cache[name];
  }
  return {
    calls, toasts, chainCalls, req,
    run: (name, context, params) => new (load(name))().run(context, params || {}),
    writes: () => calls.filter((c) => /\/(patch|create|post|plan|reserve|record|release|reset)|ics\//i.test(c.endpoint)
      && !/getTransferOrder|Lines2$/.test(c.endpoint)),
  };
}

const APP_VARS = { featureFlags: {}, flagsLoaded: true, jwt: '' };
function appContext(flags) {
  return {
    variables: Object.assign({}, APP_VARS, { featureFlags: flags || {} }),
    functions: app,
    user: { username: 'priya.raman', isAuthenticated: true },
    currentPage: { id: 'picking' },
  };
}
const USER = { 'X-User-Id': 'priya.raman' };
const ok = (body, status) => ({ ok: true, status: status || 200, body });
const fail = (status, body) => ({ ok: false, status, body: body || { message: 'boom' } });
const eps = (calls) => calls.map((c) => c.endpoint.replace(/^eqp-v1\//, '')).join(' > ');
const endpointsIn = (file) => (fs.readFileSync(file, 'utf8').match(/endpoint:\s*'[^']+'/g) || []).map((m) => m.replace(/endpoint:\s*'/, '').replace("'", ''));
const same = (a, b) => fs.readFileSync(a, 'utf8') === fs.readFileSync(b, 'utf8');

// ── Parity with Old EquipRite ──────────────────────────────────────────────────────────────────────────────

T.section('parity: copied chains are the old chains, byte for byte');
['ReleaseTransferOrderChain', 'ShipConfirmStuckLinesChain', 'RefreshPickingDrawerChain', 'OpenPickSlipPreviewChain',
  'ClosePickSlipPreviewChain', 'closePickingDrawerChain'].forEach((c) => {
  T.check(`picking ${c} = old initiate-picking ${c}`, same(path.join(PICK, `${c}.js`), path.join(OLD_PICK, `${c}.js`)));
});
['InitPickingQueueChain', 'openPickingDrawerChain', 'AcceptReturnLinesChain', 'LineSelectionChangedChain', 'closePickingDrawerChain',
  'OpenDirectReturnChain', 'CloseDirectReturnChain', 'DirectReturnSearchChain', 'SubmitDirectReturnChain', 'DirectReturnChain',
  'OpenScannerChain', 'CloseScannerChain', 'ReadSerialTextChain', 'ToggleTorchChain'].forEach((c) => {
  T.check(`receipt ${c} = old equipment-returns ${c}`, same(path.join(RET, `${c}.js`), path.join(OLD_RET, `${c}.js`)));
});
['releaseTransferOrder', 'pickSlip', 'requestDetailLines', 'maintAssetLocation', 'returnLeg', 'directReturn', 'unitScanner',
  'requestLineBody', 'currentUser', 'lineStatusLabels'].forEach((f) => {
  T.check(`resources/js/${f}.js = the old file`, same(path.join(JS, `${f}.js`), path.join(OLD, 'resources', 'js', `${f}.js`)));
});

T.section('parity: adapted chains call the same endpoints in the same order');
[['openPickingDrawerChain', 'openPickingDrawerChain'], ['PrintPickSlipChain', 'PrintPickSlipChain'], ['InitPickingQueueChain', 'InitPickingQueueChain']]
  .forEach(([n, o]) => {
    const a = endpointsIn(path.join(PICK, `${n}.js`));
    const b = endpointsIn(path.join(OLD_PICK, `${o}.js`));
    T.eq(`picking ${n}: ${b.join(', ') || '(no REST)'}`, a.join(','), b.join(','));
  });
const drawerSrc = fs.readFileSync(path.join(PICK, 'openPickingDrawerChain.js'), 'utf8');
const oldDrawerSrc = fs.readFileSync(path.join(OLD_PICK, 'openPickingDrawerChain.js'), 'utf8');
const strip = (s) => s.replace(/^define\(\[[\s\S]*?\{\n  'use strict';\n/, '').replace(/\n  \/\/ NEW EQUIPRITE[\s\S]*?const loadPickSlip = [^\n]*\n/, '')
  .replace('(await loadPickSlip()).hasReleasedLines', 'pickSlip.hasReleasedLines');
T.check('picking openPickingDrawerChain: only the pickSlip loading differs from the old chain', strip(drawerSrc) === strip(oldDrawerSrc));

// ── Picking: fake data ────────────────────────────────────────────────────────────────────────────────────

const QUEUE_ROW = { id: '501', eqrEquipmentRequestId: 501, requestNumber: 'REQ-10527', project: 'Plant Expansion B', taskName: '1.3',
  requestor: 'John Dunbar', isCustomer: false, status: 'IN_PROCESS', neededByDate: '2026-11-02', lines: [], pickingExceptions: [] };

function pickBackend(extra) {
  const x = extra || {};
  const status = Object.assign({ 7001: 'SCHEDULED_FOR_PICKING', 7002: 'SCHEDULED_FOR_PICKING', 7003: 'SCHEDULED_FOR_PICKING',
    7004: 'SCHEDULED_FOR_PICKING', 7005: 'DRAFT' }, x.status || {});
  const lines = () => [
    { id: 7001, eqrEquipmentMasterId: 11, quantity: 1, lineStatus: status[7001], sourceOrgCode: '002', fulfilmentClass: 'S_AND_T' },
    { id: 7002, eqrEquipmentMasterId: 12, quantity: 1, lineStatus: status[7002], sourceOrgCode: '002', fulfilmentClass: 'S_AND_T' },
    { id: 7003, eqrEquipmentMasterId: 13, quantity: 2, lineStatus: status[7003], sourceOrgCode: x.noOrg ? null : '003', fulfilmentClass: 'S_AND_T' },
    { id: 7004, eqrEquipmentMasterId: 14, quantity: 1, lineStatus: status[7004], fulfilmentClass: 'F_AND_M' },
    { id: 7005, eqrEquipmentMasterId: 15, quantity: 1, lineStatus: status[7005] },
  ];
  const units = {
    7001: [{ equipmentName: 'CAT 320 Excavator', className: 'Excavators', allocationId: 1, unitNumber: 'EX-2201', unitStatus: 'RENTED', unitRefId: 31, unitType: 'SERIAL', sourceInvOrgName: 'Houston Yard' }],
    7002: [{ equipmentName: 'Komatsu PC210', className: 'Excavators', allocationId: 2, unitNumber: 'EX-2207', unitStatus: 'DAMAGED', unitRefId: 32, unitType: 'SERIAL', sourceInvOrgName: 'Houston Yard' }],
    7003: [{ equipmentName: 'Light tower', className: 'Lighting', allocationId: 3, unitNumber: 'LT-0042', unitStatus: 'RENTED', unitRefId: 33, unitType: 'SERIAL', allocationMethod: 'AUTO', lineSourceInvOrgName: 'Atlanta Yard' }],
    7004: [{ equipmentName: 'Survey drone', className: 'Survey', allocationId: 4, unitNumber: 'DR-9', unitStatus: 'RENTED', unitRefId: 34, unitType: 'SERIAL', sourceInvOrgName: 'Houston Yard' }],
  };
  const respond = (o) => {
    const u = o.uriParams || {};
    switch (o.endpoint) {
      case 'eqp-v1/getTransferOrders':
        return ok({ data: [{ id: 9001, orderNumber: 'TO-778402', orderStatus: 'OPEN', createdDate: '2026-10-29T10:00:00Z' },
          { id: 9002, orderNumber: 'TO-778399', orderStatus: 'OPEN', createdDate: '2026-10-28T10:00:00Z' }] });
      case 'eqp-v1/getTransferOrderLines':
        return ok({ data: ({ 9001: [7001, 7002], 9002: [7003] }[u.transferOrderId] || []).map((id) => ({ requestLineId: id })) });
      case 'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2':
        return ok({ data: lines() });
      case 'eqp-v1/getEquipriteV1ViewsLineDetailUnits':
        return ok({ data: units[u.lineId] || [] });
      case 'eqp-v1/getSerialRefs':
        return ok({ data: u.equipmentId === 11 ? [{ id: 31, currentSubinventory: 'Available', currentLocator: 'A-12-04' }] : [] });
      case 'ics/releaseTOBatch':
        if (x.releaseFails) return fail(500, { message: 'OIC down' });
        return ok({ results: o.body.transferOrders.map((t) => (x.failTO === t.toNumber
          ? { toNumber: t.toNumber, status: 'FAILED', message: 'No on-hand' } : { toNumber: t.toNumber, status: 'RELEASED' })) });
      case 'eqp-v1/patchRequestLinesBatch':
        if (x.batchFails) return fail(409, { message: 'stale line' });
        o.body.lines.forEach((l) => { status[l.id] = l.lineStatus; });
        return ok({ data: [] });
      default:
        return undefined;
    }
  };
  return { respond, status };
}

const PickPage = loadAmd(path.join(PAGES, 'picking-page.js'), { require: makeRequire({}), 'resources/js/lineStatusLabels': lineStatusLabels });

function pickContext(page, vars, flags) {
  return {
    $page: {
      variables: Object.assign({
        PickingQueueAllArray: [], queueText: '', queueChip: 'all', isLoading: true, fetchError: '', isDrawerOpen: false,
        selectedRequest: { lines: [], pickingExceptions: [] }, isLoadingDrawer: false, selectedRequestTOs: [], selectedTOId: '',
        selectionTick: 0, isReleasingTO: false, isRefreshingDrawer: false, isShipConfirming: false, pickInitiatedWarning: '',
        releaseMessage: '', releaseMessageType: 'confirmation', isPrintingPickSlip: false, pickSlipUrl: '', pickSlipFileName: '', pickSlipDocNumber: '',
      }, vars || {}),
      functions: page,
    },
    $application: appContext(flags),
  };
}

/** Opens REQ-10527 the way the page does, then lets the lines "render" (the binding syncs the page module). */
async function openRequest(be, flags, opts) {
  const page = new PickPage();
  const rt = runtime(PICK, be.respond, opts);
  const c = pickContext(page, {}, flags);
  await rt.run('openPickingDrawerChain', c, { rowData: QUEUE_ROW });
  page.syncLines(c.$page.variables.selectedRequest.lines);
  rt.calls.length = 0;
  rt.chainCalls.length = 0;
  return { page, rt, c, v: c.$page.variables };
}
const tick = (page, c, ids) => { ids.forEach((id) => page.toggleLine(String(id), true, c.$page)); };
const untickAll = (page, c) => { if (page.selectedLines().length) { page.toggleAll(c.$page); if (page.selectedLines().length) page.toggleAll(c.$page); } };

(async () => {
  // ── Picking: page functions ──────────────────────────────────────────────────────────────────────────────
  T.section('picking page: queue');
  const p = new PickPage();
  const Q = [
    { id: '1', requestNumber: 'REQ-1', project: 'Pipeline North', requestor: 'Ann', isCustomer: false, neededByDate: '2026-11-01' },
    { id: '2', requestNumber: 'REQ-2', project: 'Gulf Coast Builders', requestor: 'Dana', isCustomer: true, neededByDate: '2026-11-20', equipmentClass: 'Cranes' },
    { id: '3', requestNumber: 'REQ-3', project: 'Plant B', requestor: 'John', isCustomer: false, neededByDate: '2026-10-01' },
  ];
  T.eq('keyword: any word in request, project, requestor or class (old smart search)', p.queueRows(Q, 'cranes ann', 'all').map((r) => r.id).join(), '1,2');
  T.eq('starts within 7 days includes overdue starts', p.queueRows(Q, '', 'soon', '2026-10-29').map((r) => r.id).join(), '1,3');
  T.eq('customer chip', p.queueRows(Q, '', 'customer').map((r) => r.id).join(), '2');
  T.eq('chips with counts', p.queueChips(Q, '2026-10-29').map((x) => `${x.key}:${x.count}`).join(), 'all:3,soon:2,project:2,customer:1');
  T.eq('next request wraps', `${p.nextRequest(Q, '3').id},${p.nextRequest(Q, '1').id},${p.nextRequest(Q, 'x').id}`, '1,2,1');
  T.eq('a queue of one has no next', p.nextRequest([Q[0]], '1'), null);
  T.eq('dates and money read like a person wrote them', `${p.day('2026-11-08T00:00:00Z')}|${p.money(118400)}|${p.money(null)}`, '8 Nov|$118,400|');
  T.eq('status label blank for pre-allocation statuses (old page rule)', `${p.getLineStatusLabel('SUBMITTED')}|${p.getLineStatusLabel('PICK_INITIATED')}`,
    `|${lineStatusLabels.formatLineStatus('PICK_INITIATED')}`);

  T.section('picking: InitPickingQueueChain (views/workbench-requests?stage=INITIATE)');
  {
    const page = new PickPage();
    const rows = [
      { eqrEquipmentRequestId: 501, requestNumber: 'REQ-10527', requestStatus: 'IN_PROCESS', source: 'INTERNAL', projectName: 'Plant B', taskName: '1.3',
        requestor: 'John', requestedStartDate: '2026-11-02T00:00:00Z', requestedEndDate: '2026-11-22T00:00:00Z', totalLines: 2, totalEstCost: 9800 },
      { eqrEquipmentRequestId: 501, requestNumber: 'REQ-10527', requestStatus: 'IN_PROCESS', source: 'INTERNAL', projectName: 'Plant B' },
      { eqrEquipmentRequestId: 503, requestNumber: 'REQ-10505', requestStatus: 'QUOTE_ACCEPTED', source: 'CUSTOMER', projectName: 'ignored',
        customerName: 'Gulf Coast', contactName: 'Dana', requestor: 'ignored', taskName: 'n/a' },
    ];
    const rt = runtime(PICK, (o) => (o.endpoint.endsWith('WorkbenchRequests') ? ok({ data: rows }) : undefined));
    const c = pickContext(page);
    await rt.run('InitPickingQueueChain', c);
    T.eq('one call, the old endpoint and parameters', JSON.stringify(rt.calls.map((x) => [x.endpoint, x.uriParams])),
      JSON.stringify([['eqp-v1/getEquipriteV1ViewsWorkbenchRequests', { stage: 'INITIATE', size: 1000 }]]));
    const q = c.$page.variables.PickingQueueAllArray;
    T.eq('one row per request, newest first', q.map((r) => r.id).join(), '503,501');
    T.eq('customer row: customer and contact, no task (old party / person rule)', `${q[0].project}|${q[0].requestor}|${q[0].isCustomer}|${q[0].taskName}`, 'Gulf Coast|Dana|true|');
    T.eq('project row: needed by = requested start; end, lines, cost kept', `${q[1].neededByDate}|${q[1].endDate}|${q[1].totalLines}|${q[1].totalEstCost}`, '2026-11-02|2026-11-22|2|9800');
    T.eq('loaded', c.$page.variables.isLoading, false);
    const rt2 = runtime(PICK, () => fail(503, { message: 'Service unavailable' }));
    const c2 = pickContext(new PickPage());
    await rt2.run('InitPickingQueueChain', c2);
    T.eq('a failed load says why and keeps the page', `${c2.$page.variables.fetchError}|${c2.$page.variables.isLoading}`, 'Service unavailable|false');
  }

  T.section('picking: opening a request (openPickingDrawerChain, unchanged calls)');
  {
    const be = pickBackend();
    const page = new PickPage();
    const rt = runtime(PICK, be.respond);
    const c = pickContext(page);
    await rt.run('openPickingDrawerChain', c, { rowData: QUEUE_ROW });
    const order = rt.calls.map((x) => x.endpoint.replace('eqp-v1/', ''));
    T.eq('transfer orders, their lines, the request lines, then units and serial refs',
      order.slice(0, 4).join(' > '), 'getTransferOrders > getTransferOrderLines > getTransferOrderLines > getEquipriteV1EquipmentRequestsRequestIdLines2');
    T.eq('one units call per picking line (the DRAFT line costs none)', order.filter((e) => e === 'getEquipriteV1ViewsLineDetailUnits').length, 4);
    T.eq('one serial-ref call per distinct equipment', order.filter((e) => e === 'getSerialRefs').length, 4);
    const v = c.$page.variables;
    T.eq('lines in picking only', v.selectedRequest.lines.map((l) => l.lineId).join(), '7001,7002,7003,7004');
    const l1 = v.selectedRequest.lines[0];
    T.eq('line: transfer order, yard, subinventory, locator, serial', `${l1.toNumber}|${l1.yard}|${l1.subinventory}|${l1.locator}|${l1.serialNumber}`,
      'TO-778402|Houston Yard|Available|A-12-04|EX-2201');
    T.eq('AUTO allocation reads the yard stamped on the line', v.selectedRequest.lines[2].yard, 'Atlanta Yard');
    T.check('the F&M line is flagged and has no transfer order', v.selectedRequest.lines[3].isFAndM === true && v.selectedRequest.lines[3].toNumber === '');
    T.eq('a damaged serial is an exception', JSON.stringify(v.selectedRequest.pickingExceptions.map((e) => [e.lineId, e.severity, e.issue])),
      JSON.stringify([['7002', 'HIGH', 'Serial EX-2207 is DAMAGED. Assign an alternate serial.']]));
    T.eq('transfer orders, newest first, none released yet', v.selectedRequestTOs.map((t) => `${t.orderNumber}:${t.released}`).join(), 'TO-778402:false,TO-778399:false');
    page.syncLines(v.selectedRequest.lines);
    T.eq('the lines of the newest order awaiting release open ticked', page.selectedLines().map((l) => l.lineId).join(), '7001,7002');
    T.check('no pick slip without SHIPPING_DOCUMENTS_ENABLED (and jsPDF is never loaded)', !rt.chainCalls.length && !rt.req.loads.length);
    T.eq('workspace loaded', `${v.isLoadingDrawer}|${v.isDrawerOpen}`, 'false|true');
  }
  {
    const be = pickBackend({ status: { 7001: 'PICK_INITIATED', 7002: 'SHIP_TO_SITE' } });
    const { v, rt, page } = await openRequest(be, {}, {});
    T.eq('a transfer order whose lines are all past release reads as released (derived from the lines)',
      v.selectedRequestTOs.map((t) => `${t.orderNumber}:${t.released}`).join(), 'TO-778402:true,TO-778399:false');
    T.eq('and the workspace opens on the order still awaiting release', page.selectedLines().map((l) => l.lineId).join(), '7003');
    T.check('no calls left over', rt.calls.length === 0);
    const be2 = pickBackend({ status: { 7001: 'PICK_INITIATED' } });
    const page2 = new PickPage();
    const rt2 = runtime(PICK, be2.respond, { stubs: { PrintPickSlipChain: async () => {} } });
    await rt2.run('openPickingDrawerChain', pickContext(page2, {}, { SHIPPING_DOCUMENTS_ENABLED: 'true' }), { rowData: QUEUE_ROW });
    T.eq('with SHIPPING_DOCUMENTS_ENABLED and a released line, the slip is prepared without opening',
      JSON.stringify(rt2.chainCalls), JSON.stringify([{ chain: 'PrintPickSlipChain', params: { autoOpen: false } }]));
    T.eq('jsPDF is loaded only then', rt2.req.loads.join(), 'resources/js/pickSlip');
  }

  T.section('picking page: ticks and what each button may do');
  {
    const be = pickBackend();
    const { page, c, v } = await openRequest(be);
    const tos = v.selectedRequestTOs;
    T.eq('release names the ticked order', page.releasableTONumbers(tos, 0, v.selectedRequest.lines), 'TO-778402');
    T.eq('selectedTOId follows a single ticked order', (page.toggleLine('7001', true, c.$page), v.selectedTOId), '9001');
    T.check('Release is live, Pick and ship is not', page.canReleaseSelectedTO(tos, v.selectedTOId, 0) && !page.canShipSelectedTO(tos, v.selectedTOId, v.selectedRequest.lines, 0));
    T.eq('Release is the next action', page.nextAction(tos, v.selectedTOId, v.selectedRequest.lines, 0), 'release');
    tick(page, c, [7003]);
    T.eq('two orders ticked: both named, selectedTOId blank (old rule)', `${page.releasableTONumbers(tos)}|${v.selectedTOId}`, 'TO-778402, TO-778399|');
    const before = v.selectionTick;
    page.toggleAll(c.$page);
    T.eq('header box: partial -> all', page.selectedLines().length, 4);
    page.toggleAll(c.$page);
    T.eq('all -> none, and every change bumps selectionTick', `${page.selectedLines().length}|${v.selectionTick > before}`, '0|true');
    T.check('nothing ticked: Release is not live', !page.canReleaseSelectedTO(tos, '', 0));
    tick(page, c, [7004]);
    T.check('a ticked F&M line waiting for release makes Release live without any order', page.canReleaseSelectedTO(tos, v.selectedTOId, 0) && page.releasableTOOptions(tos).length === 0);
    T.eq('step counts', JSON.stringify(page.stageCounts(v.selectedRequest.lines)), '{"release":4,"picking":0,"shipped":0,"total":4}');
    T.eq('current step', page.currentStage(v.selectedRequest.lines), 'release');
    T.eq('yards on the request', page.yards(v.selectedRequest.lines), 'Houston Yard, Atlanta Yard');
    T.eq('where to pick from', page.whereText(v.selectedRequest.lines[0]), 'Available · A-12-04');
    T.eq('Re-allocate opens the line in Old EquipRite', page.oldLineLink('http://old/', v.selectedRequest, '7002', v.selectedRequest.lines),
      'http://old/vp/shell/equipment-foundation/line-detail?requestId=501&requestNumber=REQ-10527&lineId=7002&equipmentMasterId=12');
    T.check('old line-detail page exists', fs.existsSync(path.join(OLD_PAGES, 'line-detail-page.json')));
    const shown = page.lineRows([{ lineId: 'a', lineStatus: 'SHIP_TO_SITE' }, { lineId: 'b', lineStatus: 'PICK_INITIATED' }, { lineId: 'c', lineStatus: 'ALLOCATED' }]);
    T.eq('lines show waiting first, then picking, then shipped', shown.map((l) => l.lineId).join(), 'c,b,a');
    T.eq('...without changing the order the ticks are sent in', (page.toggleAll(c.$page), page.selectedLines().map((l) => l.lineId).join()), 'a,b,c');
    T.eq('a different line set clears the ticks', (page.syncLines([{ lineId: 'z' }]), page.selectedLines().length), 0);
    T.check('pick slip not offered before one exists', !page.canPrintPickSlip([{ lineStatus: 'PICK_INITIATED' }]));
  }

  // ── Picking: Release for picking ─────────────────────────────────────────────────────────────────────────
  T.section('picking: Release for picking (ReleaseTransferOrderChain, unchanged)');
  {
    const be = pickBackend();
    const { page, rt, v, c } = await openRequest(be);
    await rt.run('ReleaseTransferOrderChain', c);
    T.eq('source yard from the line, Fusion batch release, current statuses, the order lines, one line batch', eps(rt.calls),
      'getTransferOrderLines > getEquipriteV1EquipmentRequestsRequestIdLines2 > ics/releaseTOBatch > getEquipriteV1EquipmentRequestsRequestIdLines2 > getTransferOrderLines > patchRequestLinesBatch');
    T.eq('the release: per-order yard, stop at Pick initiated, the request id', JSON.stringify(rt.calls[2].body),
      JSON.stringify({ transferOrders: [{ toNumber: 'TO-778402', sourceOrg: '002', autoPickConfirm: false, autoShipConfirm: false }], equipmentRequestId: 501 }));
    const patch = rt.calls[5];
    T.eq('every line on the released order -> PICK_INITIATED, one batch, as the user', JSON.stringify([patch.uriParams, patch.body, patch.headers]),
      JSON.stringify([{ requestId: 501 }, { lines: [{ id: 7001, lineStatus: 'PICK_INITIATED' }, { id: 7002, lineStatus: 'PICK_INITIATED' }] }, USER]));
    T.eq('the order is flagged released, the other is not', v.selectedRequestTOs.map((t) => `${t.orderNumber}:${t.released}`).join(), 'TO-778402:true,TO-778399:false');
    T.eq('the lines move on screen without a reload', v.selectedRequest.lines.map((l) => l.lineStatus.slice(0, 4)).join(), 'PICK,PICK,SCHE,SCHE');
    T.check('confirmation names the order and what is left', v.releaseMessageType === 'confirmation'
      && v.releaseMessage.includes('TO TO-778402 released for picking.') && v.releaseMessage.includes('1 transfer order(s) left to release.'));
    T.eq('busy flag cleared', v.isReleasingTO, false);
    page.syncLines(v.selectedRequest.lines);
    T.eq('the released lines stay ticked for Pick and ship', page.selectedLines().map((l) => l.lineId).join(), '7001,7002');
    T.check('Release is spent, Pick and ship is next', page.nextAction(v.selectedRequestTOs, v.selectedTOId, v.selectedRequest.lines, 1) === 'ship');
    T.eq('Pick and ship says how many lines it will move', page.shipCount(v.selectedRequestTOs, v.selectedTOId, v.selectedRequest.lines), 2);

    T.section('picking: Pick and ship (ShipConfirmStuckLinesChain, unchanged)');
    rt.calls.length = 0;
    await rt.run('ShipConfirmStuckLinesChain', c);
    const writes = rt.calls.filter((x) => x.endpoint === 'eqp-v1/patchRequestLinesBatch');
    T.eq('reads the live statuses first, then one ship batch', eps(rt.calls.slice(0, 2)),
      'getEquipriteV1EquipmentRequestsRequestIdLines2 > patchRequestLinesBatch');
    T.eq('only the ticked order\'s lines at Pick initiated ship', JSON.stringify([writes.length, writes[0].body, writes[0].headers]),
      JSON.stringify([1, { lines: [{ id: 7001, lineStatus: 'SHIP_TO_SITE' }, { id: 7002, lineStatus: 'SHIP_TO_SITE' }] }, USER]));
    T.check('no Fusion asset write for lines that are not maintenance tracked', !rt.calls.some((x) => /installedBase|patchSerialRef|patchEquipmentRequest/.test(x.endpoint)));
    T.eq('confirmation', `${rt.toasts[0].summary}|${rt.toasts[0].message}`, 'Pick and Ship Complete|2 line(s) advanced to Shipped to Site.');
    T.check('then the workspace re-reads the request', rt.chainCalls.some((x) => x.chain === 'openPickingDrawerChain' && x.params.rowData.id === '501'));
    T.eq('busy flag cleared', v.isShipConfirming, false);
  }
  {
    const be = pickBackend();
    const { page, rt, v, c } = await openRequest(be);
    untickAll(page, c);
    tick(page, c, [7004, 7003]);
    await rt.run('ReleaseTransferOrderChain', c);
    const batches = rt.calls.filter((x) => x.endpoint === 'eqp-v1/patchRequestLinesBatch');
    T.eq('mixed tick: the fixed-asset line first (its own batch), then the transfer order', eps(rt.calls),
      'patchRequestLinesBatch > getTransferOrderLines > getEquipriteV1EquipmentRequestsRequestIdLines2 > ics/releaseTOBatch > getEquipriteV1EquipmentRequestsRequestIdLines2 > getTransferOrderLines > patchRequestLinesBatch');
    T.eq('F&M batch', JSON.stringify(batches[0].body), JSON.stringify({ lines: [{ id: 7004, lineStatus: 'PICK_INITIATED' }] }));
    T.eq('the order released from its own yard', rt.calls[3].body.transferOrders[0].sourceOrg + '|' + rt.calls[3].body.transferOrders[0].toNumber, '003|TO-778399');
    T.eq('order lines batch', JSON.stringify(batches[1].body), JSON.stringify({ lines: [{ id: 7003, lineStatus: 'PICK_INITIATED' }] }));
    T.check('one message for both halves', v.releaseMessage.includes('TO TO-778399 released') && v.releaseMessage.includes('1 fixed-asset line(s) released (no transfer order needed).'));
  }
  {
    const be = pickBackend();
    const { page, rt, v, c } = await openRequest(be);
    untickAll(page, c);
    tick(page, c, [7004]);
    await rt.run('ReleaseTransferOrderChain', c);
    T.eq('F&M only: one batch, no Fusion call', eps(rt.calls), 'patchRequestLinesBatch');
    T.check('and it says no transfer order is needed', v.releaseMessage.startsWith('1 fixed-asset line(s) released for picking.'));
    page.syncLines(v.selectedRequest.lines); // what the lines binding does once the statuses change on screen
    T.eq('the released F&M line stays ticked', page.selectedLines().map((l) => `${l.lineId}:${l.lineStatus}`).join(), '7004:PICK_INITIATED');
    rt.calls.length = 0;
    await rt.run('ReleaseTransferOrderChain', c);
    T.eq('releasing it again sends nothing (never walks a line backwards)', rt.calls.length, 0);
  }
  {
    const be = pickBackend({ releaseFails: true });
    const { rt, v, c } = await openRequest(be);
    await rt.run('ReleaseTransferOrderChain', c);
    T.check('Fusion refuses the batch: no line is moved', !rt.calls.some((x) => x.endpoint === 'eqp-v1/patchRequestLinesBatch'));
    T.check('...the order is not flagged, and the error is shown', !v.selectedRequestTOs[0].released && v.releaseMessageType === 'error'
      && v.releaseMessage.includes('No transfer orders were released. HTTP 500') && !v.isReleasingTO);
  }
  {
    const be = pickBackend({ failTO: 'TO-778399' });
    const { page, rt, v, c } = await openRequest(be);
    tick(page, c, [7003]);
    await rt.run('ReleaseTransferOrderChain', c);
    const batch = rt.calls.filter((x) => x.endpoint === 'eqp-v1/patchRequestLinesBatch');
    T.eq('partial batch: only the released order\'s lines move', JSON.stringify(batch.map((x) => x.body)),
      JSON.stringify([{ lines: [{ id: 7001, lineStatus: 'PICK_INITIATED' }, { id: 7002, lineStatus: 'PICK_INITIATED' }] }]));
    T.check('...and it is a warning naming the failed order', v.releaseMessageType === 'warning' && v.releaseMessage.includes('FAILED: TO TO-778399 (No on-hand)'));
  }
  {
    const be = pickBackend({ noOrg: true });
    const { page, rt, v, c } = await openRequest(be);
    untickAll(page, c);
    tick(page, c, [7003]);
    await rt.run('ReleaseTransferOrderChain', c);
    T.check('a yard that cannot be resolved is never guessed: nothing goes to Fusion', !rt.calls.some((x) => x.endpoint.startsWith('ics/'))
      && v.releaseMessageType === 'error' && v.releaseMessage.includes('Could not determine which yard TO TO-778399 ships from'));
  }
  {
    const be = pickBackend();
    const { page, rt, v, c } = await openRequest(be);
    untickAll(page, c);
    await rt.run('ReleaseTransferOrderChain', c);
    T.check('nothing ticked: no call, says to tick', rt.calls.length === 0 && v.releaseMessage.startsWith('Tick the lines you want to release'));
  }
  {
    const be = pickBackend({ batchFails: true });
    const { page, rt, v, c } = await openRequest(be);
    untickAll(page, c);
    tick(page, c, [7004]);
    await rt.run('ReleaseTransferOrderChain', c);
    T.check('F&M batch refused: nothing moves on screen, error shown', v.selectedRequest.lines[3].lineStatus === 'SCHEDULED_FOR_PICKING'
      && v.releaseMessageType === 'error' && v.releaseMessage.includes('1 failed'));
  }
  {
    const be = pickBackend({ status: { 7001: 'PICK_INITIATED', 7002: 'PICK_INITIATED' } });
    const { rt, c, v } = await openRequest(be);
    be.status[7001] = 'SHIP_TO_SITE'; // someone shipped it meanwhile
    be.status[7002] = 'SHIP_TO_SITE';
    v.selectedTOId = '9001';
    await rt.run('ShipConfirmStuckLinesChain', c);
    T.check('Pick and ship trusts the server, not the screen: nothing at Pick initiated, no write',
      !rt.calls.some((x) => x.endpoint === 'eqp-v1/patchRequestLinesBatch') && rt.toasts[0].type === 'info');
  }
  {
    const be = pickBackend({ status: { 7001: 'PICK_INITIATED', 7002: 'PICK_INITIATED' } });
    const { rt, c, v } = await openRequest(be);
    v.selectedTOId = '9001';
    const be2 = pickBackend({ status: { 7001: 'PICK_INITIATED', 7002: 'PICK_INITIATED' }, batchFails: true });
    const rt2 = runtime(PICK, be2.respond, { stubs: { openPickingDrawerChain: async () => {} } });
    await rt2.run('ShipConfirmStuckLinesChain', c);
    T.eq('a refused ship batch is reported as partial, nothing shipped', `${rt2.toasts[0].summary}|${rt2.toasts[0].message}`,
      'Pick and Ship — partially applied|0 line(s) advanced to Shipped to Site; 2 failed. Try again or check the request detail page.');
    T.check('busy flag cleared', !v.isShipConfirming && rt.calls.length === 0);
  }

  T.section('picking: refresh, close, pick slip, open and ticks chains');
  {
    const be = pickBackend();
    const { rt, c, v } = await openRequest(be);
    await rt.run('RefreshPickingDrawerChain', c);
    T.check('Refresh re-reads the open request through the same chain', rt.chainCalls[0].chain === 'openPickingDrawerChain' && !v.isRefreshingDrawer);
    v.pickSlipUrl = 'blob:slip';
    await rt.run('closePickingDrawerChain', c);
    T.check('Close empties the workspace and frees the slip', !v.selectedRequest.id && v.pickSlipUrl === '' && revoked.includes('blob:slip') && !v.isDrawerOpen);
  }
  {
    const fakeSlip = {
      hasReleasedLines: pickSlip.hasReleasedLines,
      buildModel: (header, lines) => ({ header, lines }),
      buildPickSlipPdf: (m) => { fakeSlip.last = m; return { base64: 'AA', fileName: 'PS-REQ.pdf', docNumber: 'PS-REQ-1', rowCount: 1 }; },
      toBlobUrl: () => 'blob:new',
    };
    const be = pickBackend({ status: { 7001: 'PICK_INITIATED' } });
    const page = new PickPage();
    const rt = runtime(PICK, be.respond, { pickSlip: fakeSlip });
    const c = pickContext(page, { selectedRequest: { requestNumber: 'REQ-10527', project: 'Plant B', neededByDate: '2026-11-02',
      lines: [{ yard: 'Houston Yard', lineStatus: 'PICK_INITIATED' }, { yard: 'Atlanta Yard' }] },
    selectedRequestTOs: [{ value: '9001', orderNumber: 'TO-778402' }], selectedTOId: '9001', pickSlipUrl: 'blob:old' });
    await rt.run('PrintPickSlipChain', c, { autoOpen: false });
    T.eq('pick slip header: the ticked order and every yard', JSON.stringify([fakeSlip.last.header.toNumber, fakeSlip.last.header.yard]), '["TO-778402","Houston Yard, Atlanta Yard"]');
    T.check('the old slip is freed, the new one kept', revoked.includes('blob:old') && c.$page.variables.pickSlipUrl === 'blob:new' && c.$page.variables.pickSlipDocNumber === 'PS-REQ-1');
    T.check('no REST call from the slip', rt.calls.length === 0);
    const reqLoaded = makeRequire({ 'resources/js/pickSlip': pickSlip });
    reqLoaded(['resources/js/pickSlip'], () => {});
    const PickPageLoaded = loadAmd(path.join(PAGES, 'picking-page.js'), { require: reqLoaded, 'resources/js/lineStatusLabels': lineStatusLabels });
    const withSlip = new PickPageLoaded();
    T.eq('once jsPDF is loaded the slip is offered for released lines only (pickSlip.hasReleasedLines)',
      `${withSlip.canPrintPickSlip([{ lineStatus: 'PICK_INITIATED' }])}|${withSlip.canPrintPickSlip([{ lineStatus: 'SCHEDULED_FOR_PICKING' }])}`, 'true|false');
    const rt2 = runtime(PICK, be.respond, { failLoads: ['resources/js/pickSlip'] });
    const c2 = pickContext(new PickPage());
    await rt2.run('PrintPickSlipChain', c2, { autoOpen: true });
    T.check('jsPDF unreachable: the slip fails on its own, said plainly, the release untouched',
      c2.$page.variables.releaseMessageType === 'warning' && c2.$page.variables.releaseMessage.includes('The release itself completed') && !c2.$page.variables.isPrintingPickSlip);
    const c3 = pickContext(new PickPage());
    await runtime(PICK, be.respond, { failLoads: ['resources/js/pickSlip'] }).run('PrintPickSlipChain', c3, { autoOpen: false });
    T.eq('...and silently when it was only the background preview', c3.$page.variables.releaseMessage, '');
  }
  {
    const page = new PickPage();
    const rt = runtime(PICK, () => undefined, { stubs: { openPickingDrawerChain: async (ctx, prm) => { ctx.$page.variables.selectedRequest = prm.rowData; } } });
    const c = pickContext(page, { PickingQueueAllArray: Q });
    await rt.run('openRequestChain', c, { id: '2' });
    T.eq('a queue row opens through the old drawer chain', rt.chainCalls.map((x) => `${x.chain}:${x.params.rowData.id}`).join(), 'openPickingDrawerChain:2');
    await rt.run('openRequestChain', c, { next: true });
    T.eq('Next request opens the following row', c.$page.variables.selectedRequest.id, '3');
    c.$page.variables.isReleasingTO = true;
    await rt.run('openRequestChain', c, { id: '1' });
    T.eq('not while a release is running', c.$page.variables.selectedRequest.id, '3');
    c.$page.variables.isReleasingTO = false;
    await rt.run('setQueueFilterChain', c, { text: 'gulf', chip: 'customer' });
    T.eq('filter chain', `${c.$page.variables.queueText}|${c.$page.variables.queueChip}`, 'gulf|customer');
    page.syncLines([{ lineId: '1', toNumber: 'T1' }, { lineId: '2', toNumber: 'T2' }]);
    await rt.run('toggleLineChain', c, { lineId: '2', checked: 'true' });
    T.eq('tick chain', page.selectedLines().map((l) => l.lineId).join(), '2');
    await rt.run('toggleLineChain', c, { lineId: 'all' });
    T.eq('header tick chain', page.selectedLines().length, 2);
    T.check('no REST from the display chains', rt.calls.length === 0);
  }

  // ── Receipt & returns ───────────────────────────────────────────────────────────────────────────────────
  const RetPage = loadAmd(path.join(PAGES, 'receipt-page.js'), { 'resources/js/lineStatusLabels': lineStatusLabels });
  function retContext(page, vars) {
    return {
      $page: {
        variables: Object.assign({
          PickingQueueAllArray: [], PickingQueueFilteredArray: [], classesArray: [], tabCountAll: 0, queueText: '', queueClass: 'all',
          isLoading: true, fetchError: '', isDrawerOpen: false, selectedRequest: { lines: [], pickingExceptions: [] }, isLoadingDrawer: false,
          selectedRequestTOs: [], selectedTOId: '', lineSelectionState: { count: 0 }, lineSelectionTick: 0, actualReturnDate: '', isAccepting: false,
          directReturnOpen: false, directReturnQuery: '', directReturnRows: [], directReturnSelected: [], directReturnSearching: false,
          directReturnMeta: { recordCount: 0, page: 0, hasMore: false, searched: false }, scanSupported: false, scanOpen: false, scanStatus: '',
          scanReadingText: false, scanTorchAvailable: false, scanTorchOn: false,
        }, vars || {}),
        functions: page,
      },
      $application: appContext({}),
    };
  }

  T.section('receipt page: queue, lines, ticks');
  {
    const r = new RetPage();
    const RQ = [
      { id: '601', requestNumber: 'REQ-10440', project: 'Plant B', requestor: 'John', equipmentClass: 'Generators', neededByDate: '2026-10-21' },
      { id: '602', requestNumber: 'REQ-10431', project: 'Lone Star', requestor: 'Ann', equipmentClass: 'Cranes', neededByDate: '2026-12-30' },
    ];
    T.eq('class chip (old Class filter)', r.queueRows(RQ, '', 'Cranes').map((x) => x.id).join(), '602');
    T.eq('keyword', r.queueRows(RQ, 'john', 'all').map((x) => x.id).join(), '601');
    T.eq('class chips with counts', r.classChips(RQ, [{ value: 'Cranes', label: 'Cranes' }, { value: 'Generators', label: 'Generators' }])
      .map((x) => `${x.label}:${x.count}`).join(), 'All classes:2,Cranes:1,Generators:1');
    T.eq('overdue due date', `${r.dueText('2026-10-21', '2026-10-29')}|${r.dueText('2026-12-30', '2026-10-29')}|${r.dueText('', '')}`, '21 Oct · 8 days overdue|30 Dec|—');
    const L = [
      { lineId: '8001', lineStatus: 'SHIPPED_TO_YARD', toNumber: 'TO-1' }, { lineId: '8002', lineStatus: 'RETURN_IN_PROCESS', toNumber: 'TO-1' },
      { lineId: '8003', lineStatus: 'DEPLOYED' }, { lineId: '8004', lineStatus: 'SHIPPED_TO_YARD', toNumber: 'TO-2' }, { lineId: '8005', lineStatus: 'CLOSED' },
    ];
    r.syncLines(L);
    r.toggleLine('8003', true);
    T.eq('a line not back at the yard cannot be ticked', r.getSelectedLines().length, 0);
    r.toggleAllLines();
    T.eq('header box ticks every line back at the yard', r.getSelectedLines().map((l) => l.lineId).join(), '8001,8004');
    T.eq('the Receive button count', JSON.stringify(r.getLineSelectionStateRaw()), '{"count":2}');
    T.check('all selected', r.isAllLinesSelected());
    T.eq('lines read: back first, closed last', r.lineRows(L).map((l) => l.lineId).join(), '8001,8004,8002,8003,8005');
    T.eq('counts', JSON.stringify(r.returnCounts(L)), '{"ready":2,"transit":1,"site":1,"closed":1,"other":0,"total":5}');
    T.eq('return transfer orders', r.inboundTOs(L), 'TO-1, TO-2');
    T.eq('any change to the lines clears the ticks (old rule)', (r.syncLines(L.map((l) => Object.assign({}, l, l.lineId === '8001' ? { lineStatus: 'CLOSED' } : {}))), r.getSelectedLines().length), 0);
    T.eq('a damaged unit is flagged', r.conditionNote({ condition: 'DAMAGED' }), 'Unit flagged damaged: check it before it goes back to stock.');
    const c = retContext(r, { directReturnRows: [{ rowKey: '1:2' }, { rowKey: '1:3' }], directReturnMeta: { searched: true, recordCount: 7 } });
    T.eq('direct return summary says when the list is cut short', r.directResultSummary(c.$page), 'Showing 2 of 7 matches — narrow the search to see the rest.');
    T.check('several matches warn about multiple rentals', r.directAmbiguityWarning(c.$page).includes('more than one rental'));
    r.toggleDirectRow('1:3', c.$page);
    T.eq('direct rows ticked by key', `${r.directSelectedCount(c.$page)}|${r.isDirectRowSelected('1:3', c.$page)}|${r.isDirectRowSelected('1:2', c.$page)}`, '1|true|false');
    T.eq('unit label falls back to the identifier', r.directUnitLabel({ unitIdentifier: 'LOT-9' }), 'LOT-9');
  }

  T.section('receipt: InitPickingQueueChain (views/workbench-requests?stage=RETURN, unchanged)');
  {
    const rows = [{ eqrEquipmentRequestId: 601, requestNumber: 'REQ-10440', requestStatus: 'DEPLOYED', source: 'INTERNAL', projectName: 'Plant B',
      taskName: '4.2', className: 'Generators', requestedEndDate: '2026-09-15T00:00:00Z' },
    { eqrEquipmentRequestId: 601, requestNumber: 'REQ-10440' },
    { eqrEquipmentRequestId: 602, requestNumber: 'REQ-10431', source: 'EXTERNAL', customerName: 'Lone Star', contactName: 'Ann', className: 'Cranes' }];
    const rt = runtime(RET, (o) => (o.endpoint.endsWith('WorkbenchRequests') ? ok({ data: rows }) : undefined));
    const c = retContext(new RetPage());
    await rt.run('InitPickingQueueChain', c);
    T.eq('one call', JSON.stringify(rt.calls.map((x) => x.uriParams)), JSON.stringify([{ stage: 'RETURN', size: 1000 }]));
    T.eq('one row per request, due back = requested end', c.$page.variables.PickingQueueAllArray.map((x) => `${x.id}:${x.neededByDate}`).join(), '602:,601:2026-09-15');
    T.eq('class chips source', c.$page.variables.classesArray.map((x) => x.value).join(), 'Cranes,Generators');
  }

  T.section('receipt: Receive at yard (receiveChain -> AcceptReturnLinesChain, unchanged)');
  function retBackend(opts) {
    const x = opts || {};
    const status = Object.assign({ 8001: 'SHIPPED_TO_YARD', 8002: 'SHIPPED_TO_YARD' }, x.status || {});
    const respond = (o) => {
      const u = o.uriParams || {};
      switch (o.endpoint) {
        case 'eqp-v1/patchRequestLinesBatch':
          if (x.batchFails) return fail(500);
          o.body.lines.forEach((l) => { status[l.id] = l.lineStatus; });
          return ok({ data: [] });
        case 'eqp-v1/getAllocations':
          return ok({ data: (x.allocs || {})[u.requestLineId] || [] });
        case 'eqp-v1/patchSerialRef': case 'eqp-v1/patchLotRef': case 'eqp-v1/patchInventoryItemRef':
          return x.unitFails && x.unitFails.includes(u.id) ? fail(500) : ok({});
        case 'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2':
          return ok({ data: Object.keys(status).map((id) => ({ id: Number(id), lineStatus: status[id] })) });
        case 'eqp-v1/patchEquipmentRequest':
          return ok({});
        default: return undefined;
      }
    };
    return { respond, status };
  }
  async function receive(be, tickIds, vars) {
    const page = new RetPage();
    const rt = runtime(RET, be.respond, { stubs: { openPickingDrawerChain: async () => {} } });
    const lines = [{ lineId: '8001', lineStatus: 'SHIPPED_TO_YARD', equipmentName: 'Generator' }, { lineId: '8002', lineStatus: 'SHIPPED_TO_YARD', equipmentName: 'Light tower' }];
    const c = retContext(page, Object.assign({ selectedRequest: { id: '601', eqrEquipmentRequestId: 601, lines } }, vars || {}));
    page.syncLines(lines);
    tickIds.forEach((id) => page.toggleLine(id, true));
    await rt.run('LineSelectionChangedChain', c);
    await rt.run('receiveChain', c);
    return { rt, c, v: c.$page.variables };
  }
  {
    const be = retBackend({ allocs: { 8001: [{ eqrSerialRefId: 41, allocationStatus: 'ACTIVE' }, { eqrSerialRefId: 41 }, { eqrLotRefId: 41 },
      { inventoryItemRefId: 77 }, { eqrSerialRefId: 99, allocationStatus: 'RELEASED' }] } });
    const { rt, v } = await receive(be, ['8001'], { actualReturnDate: '2026-10-20' });
    T.eq('close, find the units, release each, re-read, then the request', eps(rt.calls),
      'patchRequestLinesBatch > getAllocations > patchSerialRef > patchLotRef > patchInventoryItemRef > getEquipriteV1EquipmentRequestsRequestIdLines2');
    T.eq('one batch: CLOSED with the actual return date, as the user', JSON.stringify([rt.calls[0].uriParams, rt.calls[0].body, rt.calls[0].headers]),
      JSON.stringify([{ requestId: 601 }, { lines: [{ id: 8001, lineStatus: 'CLOSED', actualReturnDate: '2026-10-20T00:00:00Z' }] }, USER]));
    T.eq('each unit back to stock in its own table (serial, lot, item; the released one skipped, duplicates once)',
      JSON.stringify(rt.calls.slice(2, 5).map((x) => [x.endpoint.replace('eqp-v1/', ''), x.uriParams.id, x.body])),
      JSON.stringify([['patchSerialRef', 41, { unitStatus: 'AVAILABLE' }], ['patchLotRef', 41, { lotStatus: 'ACTIVE' }], ['patchInventoryItemRef', 77, { itemStatus: 'ACTIVE' }]]));
    T.check('a line still out keeps the request open (no header write)', !rt.calls.some((x) => x.endpoint === 'eqp-v1/patchEquipmentRequest'));
    T.eq('message', `${rt.toasts[0].summary}|${rt.toasts[0].message}`, 'Return Closed|1 line(s) closed. 3 unit(s) returned to stock.');
    T.check('the request is re-read, the ticks and date reset', rt.chainCalls.some((x) => x.chain === 'openPickingDrawerChain')
      && v.lineSelectionState.count === 0 && v.actualReturnDate === '' && !v.isAccepting);
  }
  {
    const be = retBackend();
    const { rt, v } = await receive(be, ['8001', '8002']);
    const today = new Date().toISOString().slice(0, 10);
    T.eq('blank date = today', rt.calls[0].body.lines.map((l) => l.actualReturnDate).join(), `${today}T00:00:00Z,${today}T00:00:00Z`);
    T.eq('the last lines in close the request', JSON.stringify(rt.calls.filter((x) => x.endpoint === 'eqp-v1/patchEquipmentRequest').map((x) => [x.uriParams, x.body])),
      JSON.stringify([[{ id: 601 }, { status: 'CLOSED' }]]));
    T.eq('and it says so', rt.toasts[0].summary, 'Return Closed — Request Closed');
    T.eq('busy flag cleared', v.isAccepting, false);
  }
  {
    const be = retBackend({ batchFails: true, allocs: { 8001: [{ eqrSerialRefId: 41 }] } });
    const { rt } = await receive(be, ['8001']);
    T.check('a refused close releases no unit and closes nothing', !rt.calls.some((x) => /patchSerialRef|patchEquipmentRequest/.test(x.endpoint)));
    T.eq('...and says so', `${rt.toasts[0].summary}|${rt.toasts[0].type}|${rt.toasts[0].message}`, 'Accepted With Errors|warning|0 line(s) closed. 1 failed to update.');
  }
  {
    const be = retBackend({ allocs: { 8001: [{ eqrSerialRefId: 41 }] }, unitFails: [41] });
    const { rt } = await receive(be, ['8001']);
    T.check('a unit that cannot be released is named as still Rented (discrepancy)', rt.toasts[0].type === 'warning'
      && rt.toasts[0].message.includes('1 unit(s) could not be returned to stock — they remain Rented and need manual release.'));
  }
  {
    const be = retBackend();
    const page = new RetPage();
    const rt = runtime(RET, be.respond, { stubs: { openPickingDrawerChain: async () => {} } });
    const lines = [{ lineId: '8001', lineStatus: 'SHIPPED_TO_YARD' }];
    const c = retContext(page, { selectedRequest: { id: '601', eqrEquipmentRequestId: 601, lines } });
    page.syncLines(lines);
    page.toggleLine('8001', true);
    await Promise.all([rt.run('receiveChain', c), rt.run('receiveChain', c)]);
    T.eq('a double click sends one close', rt.calls.filter((x) => x.endpoint === 'eqp-v1/patchRequestLinesBatch').length, 1);
    const rt2 = runtime(RET, be.respond);
    await rt2.run('toggleLineChain', c, { lineId: 'all' });
    T.eq('tick chain updates the Receive button through LineSelectionChangedChain', `${rt2.chainCalls[0].chain}|${c.$page.variables.lineSelectionState.count}`, 'LineSelectionChangedChain|0');
    await rt2.run('setReturnDateChain', c, { value: '2026-10-21' });
    T.eq('date chain', c.$page.variables.actualReturnDate, '2026-10-21');
  }

  T.section('receipt: Direct Return (search, then DirectReturnChain, unchanged)');
  {
    const found = [{ requestLineId: 8003, unitRefId: 53, unitIdentifier: 'AC-0007', serialNumber: 'AC-0007', lineStatus: 'DEPLOYED', requestId: 601,
      requestNumber: 'REQ-10440', projectName: 'Plant B', fulfilmentClass: 'S_AND_T' }];
    const rt = runtime(RET, (o) => (o.endpoint === 'eqp-v1/searchDeployedUnits' ? ok({ data: o.uriParams.q ? found : [], recordCount: 1 }) : undefined));
    const c = retContext(new RetPage(), { directReturnSelected: ['stale'], directReturnQuery: ' Air comp ' });
    await rt.run('DirectReturnSearchChain', c);
    T.eq('search: exact serial first, then the broad term', JSON.stringify(rt.calls.map((x) => x.uriParams)),
      JSON.stringify([{ page: 0, size: 50, lineStatus: 'DEPLOYED,RETURN_INITIATED', serialNumber: 'Air comp' },
        { page: 0, size: 50, lineStatus: 'DEPLOYED,RETURN_INITIATED', q: 'Air comp' }]));
    T.eq('candidates, never pre-selected', `${c.$page.variables.directReturnRows.map((x) => x.rowKey).join()}|${c.$page.variables.directReturnSelected.length}`, '8003:53|0');
    c.$page.variables.directReturnQuery = '  ';
    await rt.run('DirectReturnSearchChain', c);
    T.check('an empty box clears the results and calls nothing', rt.calls.length === 2 && c.$page.variables.directReturnRows.length === 0);
    const html = fs.readFileSync(path.join(PAGES, 'receipt-page.html'), 'utf8');
    T.check('the box is two-way bound (what the scanner fills in shows) and keys go to searchDirectChain',
      /value="\{\{ \$variables\.directReturnQuery \}\}" on-keydown="\[\[ \$listeners\.onDirectQueryKey \]\]"/.test(html));
    const c2 = retContext(new RetPage(), { directReturnQuery: '' });
    const before = rt.calls.length;
    await rt.run('searchDirectChain', c2, { value: 'AC-000', key: 'Shift' });
    T.check('typing does not search', rt.calls.length === before && c2.$page.variables.directReturnQuery === '');
    await rt.run('searchDirectChain', c2, { value: 'AC-0007', key: 'Enter' });
    T.check('Enter searches with the box\'s text, through the old search chain',
      c2.$page.variables.directReturnQuery === 'AC-0007' && rt.chainCalls.some((x) => x.chain === 'DirectReturnSearchChain')
      && rt.calls[before].uriParams.serialNumber === 'AC-0007');
  }
  function drBackend(opts) {
    const x = opts || {};
    return (o) => {
      switch (o.endpoint) {
        case 'eqp-v1/planReturn':
          return ok({ buckets: [{ sourceOrgCode: '005', destOrgCode: '002', lines: o.body.lineIds.map((id) => ({ requestLineId: id, itemNumber: 'AC-100', qty: 1 })) }],
            blocks: x.blocks || [], fAndMLineIds: [] });
        case 'eqp-v1/reserveReturn':
          return ok(x.replayed ? { replayed: true } : { reservedLineIds: o.body.lineIds, replayed: false, rejectedLineIds: [] });
        case 'ics/createSupplyRequest':
          return x.oicFails ? fail(500, { message: 'Fusion said no' }) : ok({ status: 'ACCEPTED' }, 202);
        case 'eqp-v1/recordReturn':
          return ok({ linesPromoted: o.body.lineIds.length });
        case 'eqp-v1/resetFailedReturn':
          return ok({ linesReset: o.body.lineIds.length });
        default: return undefined;
      }
    };
  }
  const ROWS = [
    { rowKey: '8003:53', lineId: 8003, requestId: 601, requestNumber: 'REQ-10440', fulfilmentClass: 'S_AND_T' },
    { rowKey: '8003:54', lineId: 8003, requestId: 601, requestNumber: 'REQ-10440', fulfilmentClass: 'S_AND_T' },
    { rowKey: '8101:nounit', lineId: 8101, requestId: 602, requestNumber: 'REQ-10431', fulfilmentClass: 'F_AND_M' },
  ];
  async function directReturnRun(opts, rows, selected) {
    const rt = runtime(RET, drBackend(opts), { stubs: { CloseScannerChain: async () => {}, InitPickingQueueChain: async () => {} } });
    const c = retContext(new RetPage(), { directReturnRows: rows || ROWS, directReturnSelected: selected || ROWS.map((r) => r.rowKey), directReturnQuery: 'AC' });
    await rt.run('SubmitDirectReturnChain', c);
    return { rt, c };
  }
  {
    const { rt, c } = await directReturnRun();
    T.eq('per request: plan, reserve, Fusion inbound transfer order, record; the F&M line is recorded with no transfer order', eps(rt.calls),
      'planReturn > reserveReturn > ics/createSupplyRequest > recordReturn > recordReturn');
    T.eq('two units on one line are one line to return', JSON.stringify(rt.calls[0].body), '{"lineIds":[8003]}');
    const resv = rt.calls[1];
    T.check('reserve: inbound leg, the route batch, an idempotency key, as the user',
      resv.body.leg === 'INBOUND' && /^EQR-RET-REQ-10440-\d+-002$/.test(resv.body.batchNumber) && /^[0-9a-f]{16}$/.test(resv.body.idempotencyKey)
      && JSON.stringify(resv.headers) === JSON.stringify(USER));
    const oic = rt.calls[2].body;
    T.check('the Fusion supply request travels site -> yard for that line', oic.OrderType === 'INBOUND' && oic.InterfaceBatchNumber === resv.body.batchNumber
      && oic.equipmentRequestId === 601 && oic.supplyRequestLines.length === 1 && oic.supplyRequestLines[0].SourceOrganizationCode === '005'
      && oic.supplyRequestLines[0].DestinationOrganizationCode === '002' && oic.supplyRequestLines[0].requestLineId === 8003);
    T.eq('record per request', JSON.stringify(rt.calls.slice(3).map((x) => [x.uriParams.requestId, x.body])), JSON.stringify([[601, { lineIds: [8003] }], [602, { lineIds: [8101] }]]));
    T.check('says what was created, including the F&M line', rt.toasts[0].summary === 'Return Requested'
      && rt.toasts[0].message.includes('1 return Transfer Order requested for 1 line.') && rt.toasts[0].message.includes('1 fixed-asset line returned without a Transfer Order.'));
    T.check('then the camera is released, the dialog cleared and the queue re-read',
      rt.chainCalls.map((x) => x.chain).join() === 'DirectReturnChain,CloseScannerChain,InitPickingQueueChain'
      && c.$page.variables.directReturnRows.length === 0 && c.$page.variables.directReturnSelected.length === 0 && c.$page.variables.directReturnQuery === '');
    const again = await directReturnRun();
    T.eq('the same return twice carries the same idempotency key (a double fire makes one transfer order)', again.rt.calls[1].body.idempotencyKey, resv.body.idempotencyKey);
  }
  {
    const { rt } = await directReturnRun({ oicFails: true }, [ROWS[0]], [ROWS[0].rowKey]);
    T.eq('Fusion refuses: the reservation is handed back, nothing recorded', eps(rt.calls), 'planReturn > reserveReturn > ics/createSupplyRequest > releaseReturnReservation');
    T.check('...for that route\'s batch, and the error names it', rt.calls[3].body.batchNumber === rt.calls[1].body.batchNumber
      && rt.toasts[0].summary === 'Return Failed' && rt.toasts[0].message.includes('005 → 002 — Fusion said no'));
  }
  {
    const { rt } = await directReturnRun({ replayed: true }, [ROWS[0]], [ROWS[0].rowKey]);
    T.check('a replayed intent creates nothing', eps(rt.calls) === 'planReturn > reserveReturn' && rt.toasts[0].summary === 'Already Requested');
  }
  {
    const row = Object.assign({}, ROWS[0], { to_needs_reset: true });
    const { rt } = await directReturnRun({}, [row], [row.rowKey]);
    T.eq('a failed earlier return is reset first', eps(rt.calls), 'resetFailedReturn > planReturn > reserveReturn > ics/createSupplyRequest > recordReturn');
  }
  {
    const { rt } = await directReturnRun({}, ROWS, []);
    T.eq('nothing ticked: nothing sent', rt.calls.length, 0);
  }
  {
    const scanner = { isCameraAvailable: () => ({ ok: false, message: 'Camera needs a secure address.' }) };
    const rt = runtime(RET, () => undefined, { scanner });
    const c = retContext(new RetPage(), { directReturnRows: [{ rowKey: 'old' }], directReturnQuery: 'old' });
    await rt.run('scanChain', c);
    T.check('Scan opens Direct Return cleared, and without a camera says why instead of starting one',
      rt.chainCalls.map((x) => x.chain).join() === 'OpenDirectReturnChain' && c.$page.variables.directReturnRows.length === 0
      && c.$page.variables.scanSupported === false && c.$page.variables.scanStatus === 'Camera needs a secure address.');
    const started = [];
    const rt2 = runtime(RET, () => undefined, { scanner: { isCameraAvailable: () => ({ ok: true }) }, stubs: { OpenScannerChain: async () => { started.push(1); } } });
    await rt2.run('scanChain', retContext(new RetPage()));
    T.eq('with a camera it starts scanning straight away', started.length, 1);
  }

  // ── Menu and endpoints ──────────────────────────────────────────────────────────────────────────────────
  T.section('menu');
  const nav = (id) => app.navItem(id);
  T.eq('Initiate picking is built here', JSON.stringify([nav('picking').status, nav('picking').route, nav('picking').old]),
    JSON.stringify(['new', { flow: 'logistics', page: 'picking' }, { flow: 'equipment-foundation', page: 'initiate-picking' }]));
  T.eq('Receipt & returns is built here', JSON.stringify([nav('receipt').status, nav('receipt').route, nav('receipt').old]),
    JSON.stringify(['new', { flow: 'logistics', page: 'receipt' }, { flow: 'equipment-foundation', page: 'equipment-returns' }]));
  T.eq('page access: the old page codes', `${app.getPageCodeForPage({ id: 'picking' })}|${app.getPageCodeForPage({ id: 'receipt' })}`, 'EQR_INITIATE_PICKING|EQR_EQUIPMENT_RETURNS');
  T.eq('Old version links', app.oldAppLink('http://old/', 'receipt'), 'http://old/vp/shell/equipment-foundation/equipment-returns');
  ['picking', 'receipt'].forEach((pg) => {
    const html = fs.readFileSync(path.join(PAGES, `${pg}-page.html`), 'utf8');
    T.check(`${pg}: has the Old version button`, html.includes(`oldAppLink($application.variables.oldAppUrl, '${pg}')`));
    T.check(`${pg}: enforcePageAccessChain is the shared copy`, same(path.join(PAGES, `${pg}-page-chains`, 'enforcePageAccessChain.js'),
      path.join(NEW, 'flows', 'request', 'pages', 'my-requests-page-chains', 'enforcePageAccessChain.js')));
    const fns = new Set();
    (html.match(/\$functions\.([a-zA-Z]+)/g) || []).forEach((m) => fns.add(m.split('.').pop()));
    fs.readdirSync(path.join(PAGES, `${pg}-page-chains`)).forEach((f) => {
      (fs.readFileSync(path.join(PAGES, `${pg}-page-chains`, f), 'utf8').match(/\$page\.functions\.([a-zA-Z]+)/g) || []).forEach((m) => fns.add(m.split('.').pop()));
    });
    const mod = pg === 'picking' ? new PickPage() : new RetPage();
    T.check(`${pg}: every page function the HTML and chains call exists`, [...fns].every((f) => typeof mod[f] === 'function'), [...fns].filter((f) => typeof mod[f] !== 'function').join());
  });

  T.section('every endpoint the pages call exists in services/');
  const ops = {};
  ['eqp-v1', 'ics', 'ProjectLOV'].forEach((svc) => {
    const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'services', svc, 'openapi3.json'), 'utf8'));
    Object.values(spec.paths || {}).forEach((pp) => Object.values(pp).forEach((op) => { if (op && op.operationId) ops[`${svc}/${op.operationId}`] = true; }));
  });
  const used = new Set();
  [PICK, RET].forEach((dir) => fs.readdirSync(dir).forEach((f) => endpointsIn(path.join(dir, f)).forEach((e) => used.add(e))));
  ['releaseTransferOrder', 'requestLineBody', 'maintAssetLocation', 'returnLeg', 'directReturn'].forEach((f) => endpointsIn(path.join(JS, `${f}.js`)).forEach((e) => used.add(e)));
  [...used].sort().forEach((e) => T.check(e, !!ops[e]));

  T.report();
})().catch((e) => { console.error(e); T.check('suite ran to the end', false, e && e.stack); T.report(); });
