/*
 * New EquipRite, Master data (webApps/equiprite/flows/master): Equipment, Import from Fusion, Equipment detail,
 * Rate schedules, Rental agreements.
 *
 * Loads the REAL page modules and chains (AMD, in a sandbox) with a fake Actions and checks:
 *   - the page functions (chips, filters, map, rate rules, simulator, margin, previews);
 *   - every chain that writes: endpoint, body, order, and what happens on a failure;
 *   - that the chains copied from Old EquipRite are still the old files, and the functions carried over from the
 *     old page modules still give the old answers (the old suites test the old files; this pins the copies);
 *   - that every endpoint the master chains call exists in services/.
 *
 * Run:  node tests/master.test.js
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
const PAGES = path.join(NEW, 'flows', 'master', 'pages');
const JS = path.join(NEW, 'resources', 'js');
const OLD_EF = path.join(OLD, 'flows', 'equipment-foundation', 'pages');
const OLD_MAIN = path.join(OLD, 'flows', 'main', 'pages');

// ── loading ─────────────────────────────────────────────────────────────────

/** Loads an AMD file in a sandbox; `deps` maps a dependency name to its stand-in, `globals` adds sandbox globals. */
function loadAmd(file, deps, globals) {
  const sandbox = Object.assign({
    console: { log() {}, warn() {}, error() {}, info() {} }, setTimeout, Promise, Date, JSON, Math, Number, String,
    window: { confirm: () => true, open: () => null, addEventListener() {}, removeEventListener() {} },
    sessionStorage: { setItem() {}, getItem() { return null; }, removeItem() {} },
  }, globals || {});
  let mod;
  sandbox.define = (names, factory) => { mod = factory(...names.map((n) => (deps && n in deps ? deps[n] : {}))); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: path.basename(file) });
  return mod;
}

const paging = loadAmd(path.join(JS, 'fetchAllPages.js'));
const expenditureTypes = loadAmd(path.join(JS, 'expenditureTypes.js'));
const maintenanceWorkOrders = loadAmd(path.join(JS, 'maintenanceWorkOrders.js'));
const equipmentAttachments = loadAmd(path.join(JS, 'equipmentAttachments.js'));

const AppModule = loadAmd(path.join(NEW, 'app-flow.js'), {
  'ojs/ojarraydataprovider': function ADP(data) { this.data = data; },
  'resources/js/lineStatusLabels': { formatLabel: (c) => c },
}, { document: { querySelectorAll: () => [], body: {} }, MutationObserver: function () { this.observe = () => {}; } });
const app = new AppModule();

const page = (name, deps) => { const M = loadAmd(path.join(PAGES, name + '-page.js'), deps); return new M(); };
const EQ = page('equipment');
const IMP = page('equipment-import');
const DET = page('equipment-detail');
const RATES = page('rates');
const AGR = page('agreements');
const LINES = page('agreement-lines');
const EDIT = page('agreement-edit');

/** A chain of a master page, with a fake Actions and the real helper modules. */
function chain(pageName, name, Actions, extraDeps, globals) {
  const deps = Object.assign({
    'vb/action/actionChain': class {},
    'vb/action/actions': Actions,
    'resources/js/fetchAllPages': paging,
    'resources/js/expenditureTypes': expenditureTypes,
    'resources/js/maintenanceWorkOrders': maintenanceWorkOrders,
    'resources/js/equipmentAttachments': equipmentAttachments,
  }, extraDeps || {});
  return loadAmd(path.join(PAGES, pageName + '-page-chains', name + '.js'), deps, globals);
}

/** Fake Actions: `respond(opts)` answers callRest (default 200 {}), `chains(c)` answers callChain. */
function fake(respond, chains) {
  const log = [];
  const Actions = {
    async callRest(_c, o) {
      log.push({ rest: o.endpoint, uriParams: o.uriParams, body: o.body });
      const r = respond ? respond(o, log) : null;
      if (r instanceof Error) throw r;
      return r || { ok: true, status: 200, body: {} };
    },
    async fireNotificationEvent(_c, n) { log.push({ note: n }); },
    async callChain(_c, c) { log.push({ chain: c.chain, params: c.params }); return chains ? chains(c) : { ok: true }; },
    async navigateToPage(_c, n) { log.push({ nav: n.page, params: n.params }); },
    async navigateToFlow(_c, n) { log.push({ flow: n.flow, nav: n.page, params: n.params, target: n.target }); },
  };
  const rest = () => log.filter((x) => x.rest);
  const notes = () => log.filter((x) => x.note).map((x) => x.note);
  return { log, Actions, rest, notes, seq: () => rest().map((x) => x.rest).join(' > ') };
}

/** A chain context: the real app module, page access per code, the page's functions and variables. */
function ctx(pageFns, vars, access, appVars) {
  return {
    $application: {
      functions: app,
      variables: Object.assign({ pageAccessMap: access || {}, pageAccessLoaded: true, featureFlags: { PROJECTS_MODULE_ENABLED: 'true', AGREEMENTS_ENABLED: 'true' },
        flagsLoaded: true, buRateSources: {} }, appVars || {}),
      currentPage: { id: 'equipment' },
    },
    $page: { functions: pageFns, variables: vars },
  };
}
const FULL = (code) => ({ [code]: 'FULL' });

(async () => {
  // ═══ copies ═══════════════════════════════════════════════════════════════
  T.section('copied files are still the old ones');
  const same = (a, b) => fs.readFileSync(a, 'utf8') === fs.readFileSync(b, 'utf8');
  ['fetchAllPages', 'equipmentAttachments', 'expenditureTypes', 'maintenanceWorkOrders'].forEach((f) =>
    T.check('resources/js/' + f + '.js unchanged', same(path.join(JS, f + '.js'), path.join(OLD, 'resources', 'js', f + '.js'))));
  const OLD_EM = path.join(OLD_EF, 'equipment-master-page-chains');
  ['RunInProgressChain', 'ImportUnitsFromFusionChain', 'ReleaseSyncLockChain', 'BeforeExitChain'].forEach((c) =>
    T.check('equipment: ' + c + ' unchanged', same(path.join(PAGES, 'equipment-page-chains', c + '.js'), path.join(OLD_EM, c + '.js'))));
  ['RunInProgressChain', 'ImportUnitsFromFusionChain', 'ReleaseSyncLockChain', 'LoadUnmatchedValuesChain', 'StagingPageChangeChain', 'RefreshStagingChain'].forEach((c) =>
    T.check('import: ' + c + ' unchanged', same(path.join(PAGES, 'equipment-import-page-chains', c + '.js'), path.join(OLD_EM, c + '.js'))));
  T.check('detail: loadAttachmentsChain unchanged', same(path.join(PAGES, 'equipment-detail-page-chains', 'loadAttachmentsChain.js'),
    path.join(OLD_EF, 'equipment-units-page-chains', 'loadAttachmentsChain.js')));
  T.check('rates: rateManagementGuardChain unchanged', same(path.join(PAGES, 'rates-page-chains', 'rateManagementGuardChain.js'),
    path.join(OLD_MAIN, 'rate-schedule-page-chains', 'rateManagementGuardChain.js')));
  const guard = path.join(NEW, 'flows', 'request', 'pages', 'my-requests-page-chains', 'enforcePageAccessChain.js');
  ['equipment', 'equipment-import', 'equipment-detail', 'rates', 'agreements', 'agreement-lines', 'agreement-edit'].forEach((p) =>
    T.check(p + ': enforcePageAccessChain byte for byte', same(path.join(PAGES, p + '-page-chains', 'enforcePageAccessChain.js'), guard)));
  ['agreement-lines', 'agreement-edit'].forEach((p) =>
    T.check(p + ': the agreements guard is the same copy', same(path.join(PAGES, p + '-page-chains', 'agreementsFlagGuardChain.js'),
      path.join(PAGES, 'agreements-page-chains', 'agreementsFlagGuardChain.js'))));

  // The functions carried over from the old page modules must still give the old answers.
  const OldMaster = H.loadPageModule();
  const OldUnits = (() => { const M = loadAmd(path.join(OLD_EF, 'equipment-units-page.js')); return new M(); })();
  const OldRate = (() => {
    const M = loadAmd(path.join(OLD_MAIN, 'create-rate-schedule-page.js'), {
      'ojs/ojdatagridprovider': {}, 'ojs/ojeventtarget': { EventTargetMixin: { applyMixin() {} } },
      'ojs/ojarraydataprovider': function ADP(d) { this.data = d; },
    });
    return new M();
  })();
  const STG = [{ fusionInventoryItemId: 1, importStatus: 'AUTO_MAPPED', resolvedClassId: 5, resolvedSubclassId: 12, serialNumControlCode: 2 },
    { fusionInventoryItemId: 2, importStatus: 'MERGED', resolvedClassId: 5, resolvedSubclassId: null, lotControlCode: 7 },
    { fusionInventoryItemId: 3, importStatus: 'ERRORED', resolvedClassId: null, resolvedSubclassId: null, inventoryItemFlag: 'Y' }];
  const SUBS = [{ value: 12, label: 'Mini', classId: 5 }, { value: 13, label: 'Large', classId: 5 }, { value: 21, label: 'Light', classId: 9 }];
  const vOld = { stagingArray: STG, subclassOptionsArray: SUBS, stagingChangedRows: {}, stagingSelectedRows: { 1: true, 3: true } };
  const vNew = JSON.parse(JSON.stringify(vOld));
  OldMaster.buildStagingGrid(STG, vOld);
  IMP.indexRows(vNew.stagingArray, vNew);
  T.eq('applyEdit (class change clears an out-of-class subclass) as the old module',
    JSON.stringify(IMP.applyEdit(0, 6, 9, vNew)), JSON.stringify(OldMaster.applyEdit(0, 6, 9, vOld)));
  T.eq('applyEdit (re-picking the class keeps the subclass) as the old module',
    JSON.stringify(IMP.applyEdit(0, 6, 5, vNew)), JSON.stringify(OldMaster.applyEdit(0, 6, 5, vOld)));
  T.eq('buildImportBody as the old module', JSON.stringify(IMP.buildImportBody(vNew.stagingSelectedRows, {}, vNew.stagingArray)),
    JSON.stringify(OldMaster.buildImportBody(vOld.stagingSelectedRows, {}, vOld.stagingArray)));
  T.eq('unitPathwayFor as the old module', STG.map((r) => IMP.unitPathwayFor(r)).join(','), STG.map((r) => OldMaster.unitPathwayFor(r)).join(','));
  T.eq('subclassChoices = the old provider\'s data', IMP.subclassChoices(0, vNew).map((s) => s.value).join(','),
    OldMaster.getStagingProvider(7, 0, vOld).data.map((s) => s.value).join(','));
  T.eq('canEdit / canSelect as the old module', [0, 1, 2].map((i) => '' + IMP.canEdit(i, 6, vNew) + IMP.canSelect(i, vNew)).join(','),
    [0, 1, 2].map((i) => '' + OldMaster.canEdit(i, 6, vOld) + OldMaster.canSelect(i, vOld)).join(','));
  T.eq('pendingWorkText as the old module', IMP.pendingWorkText(vNew), OldMaster.pendingWorkText(vOld));
  ['unmatchedText', 'unmatchedAction'].forEach((fn) => {
    const g = { reason: 'SUBCLASS_NO_MATCH', className: 'Computer', dimType: 'CAT_SEGMENT2', dimValue: 'Tablet Cmp', itemCount: 4 };
    T.eq(fn + ' as the old module', IMP[fn](g), OldMaster[fn](g));
  });
  T.eq('dimTypeLabel as the old module', ['FA_ASSET_KEY', 'DFF_ATTRIBUTE7', 'MAJOR'].map((c) => IMP.dimTypeLabel(c)).join('|'),
    ['FA_ASSET_KEY', 'DFF_ATTRIBUTE7', 'MAJOR'].map((c) => OldMaster.dimTypeLabel(c)).join('|'));
  const counts = { itemsChanged: 12, serials: 700, lots: 3, onhand: 290, serialsGone: 2, onhandGone: 5, itemsHeld: 1 };
  T.eq('syncSummary as the old module', JSON.stringify(EQ.syncSummary(counts, false, 'boom', ['A1'])), JSON.stringify(OldMaster.syncSummary(counts, false, 'boom', ['A1'])));
  T.eq('stockLabel as the old module', EQ.stockLabel(12, 3) + '|' + EQ.stockLabel(null, 0), OldMaster.stockLabel(12, 3) + '|' + OldMaster.stockLabel(null, 0));
  T.eq('busyText as the old module', EQ.busyText('BUSY: FETCH started 10:02'), OldMaster.busyText('BUSY: FETCH started 10:02'));
  const MASTER = { equipmentClassId: 1, equipmentSubclassId: 11 };
  const subs1 = [{ value: 11, classId: 1 }, { value: 12, classId: 1 }];
  [[{ classId: null }, []], [{ classId: 1, subclassId: null }, subs1], [{ classId: 1, subclassId: 11 }, subs1], [{ classId: 1, subclassId: 12 }, subs1], [{ classId: 3, subclassId: null }, []]]
    .forEach(([d, s], i) => T.eq('canSaveClass case ' + (i + 1) + ' as the old module', JSON.stringify(DET.canSaveClass(d, MASTER, s)), JSON.stringify(OldUnits.canSaveClass(d, MASTER, s))));
  T.eq('subclassOptionsFor as the old module', JSON.stringify(DET.subclassOptionsFor(SUBS, 5)), JSON.stringify(OldUnits.subclassOptionsFor(SUBS, 5)));
  [['WEEKLY', 3400], ['MONTHLY', 12800], ['DAILY', 695], ['QUARTERLY', 1], ['nonsense', 50]].forEach(([p, a]) => {
    T.eq('deriveRate ' + p + ' as the old editor', RATES.deriveRate(a, p), OldRate.deriveRate(a, p));
    T.eq('derivePeriodAmount ' + p + ' as the old editor', RATES.derivePeriodAmount(a / 7, p), OldRate.derivePeriodAmount(a / 7, p));
  });
  [['HOURLY', 'COMPLETE_PERIOD', 'HOURLY'], ['WEEKLY', 'UTILIZED_DURATION', 'HOURLY'], ['WEEKLY', 'UTILIZED_DURATION', 'DAILY'], ['', 'COMPLETE_PERIOD', null]]
    .forEach(([p, m, b]) => T.eq('coercePeriod ' + [p, m, b].join('/') + ' as the old editor', RATES.coercePeriod(p, m, b), OldRate.coercePeriod(p, m, b)));

  // ═══ Equipment ════════════════════════════════════════════════════════════
  T.section('Equipment: chips, filters, map');
  const ROWS = [
    { id: 101, equipmentNumber: 'EQ-2201', equipmentName: 'CAT 320 Excavator', equipmentClassId: 1, equipmentSubclassId: 11, catalogStatus: 'ACTIVE',
      createdBy: 'FUSION_IMPORT', isSerialControlled: 'Y', isLotControlled: 'N', serialUnitCount: 3, currentLocationId: 501 },
    { id: 102, equipmentName: 'Komatsu PC210', equipmentClassId: 1, catalogStatus: 'ACTIVE', createdBy: 'admin', isSerialControlled: 'Y', currentLocationId: 502 },
    { id: 103, equipmentName: 'Trench kit', equipmentClassId: 2, catalogStatus: 'INACTIVE', createdBy: 'FUSION_IMPORT', isLotControlled: 'Y', currentLocationId: 501 },
    { id: 104, equipmentName: 'Diesel drum', equipmentClassId: 3, catalogStatus: null, createdBy: 'FUSION_IMPORT' },
  ];
  T.eq('status chips with counts, most common first', EQ.statusChips(ROWS).map((c) => c.label + ':' + c.count).join(','), 'All:4,Active:2,Inactive:1,No status:1');
  T.eq('tracking chips: the old RowClickChain rule', EQ.trackingChips(ROWS).map((c) => c.key + ':' + c.count).join(','), 'SERIAL:2,LOT:1,INVENTORY:1');
  T.eq('source chips', EQ.sourceChips(ROWS).map((c) => c.key + ':' + c.count).join(','), 'Fusion:3,Manual:1');
  T.eq('filter: status + tracking', EQ.filterRows(ROWS, 'ACTIVE', 'SERIAL', '', '').map((r) => r.id).join(','), '101,102');
  T.eq('filter: source Manual', EQ.filterRows(ROWS, 'all', '', 'Manual', '').map((r) => r.id).join(','), '102');
  T.eq('filter: a map location', EQ.filterRows(ROWS, 'all', '', '', '501').map((r) => r.id).join(','), '101,103');
  T.eq('filter: no status bucket', EQ.filterRows(ROWS, 'NONE', '', '', '').map((r) => r.id).join(','), '104');
  const LOCS = [{ id: 501, locationName: 'Houston Yard', latitude: 29.76, longitude: -95.37 }, { id: 502, locationName: 'Dallas Yard', latitude: 32.78, longitude: -96.8 },
    { id: 503, locationName: 'No coords' }];
  const map = EQ.mapPoints(ROWS, LOCS);
  T.eq('map: one bubble per location with items, biggest first', map.points.map((p) => p.name + ':' + p.count).join(','), 'Houston Yard:2,Dallas Yard:1');
  T.eq('map: items without a placed location are counted', map.unplaced + '/' + map.placed, '1/3');
  T.check('map: north is up, west is left (Dallas above and left of Houston)', map.points[1].y < map.points[0].y && map.points[1].x < map.points[0].x);
  T.eq('map: nothing placed', EQ.mapPoints(ROWS, []).points.length, 0);
  T.eq('map: a bubble\'s place and size as a style object', JSON.stringify(EQ.dotStyle({ x: 500, y: 230, r: 14 })), '{"left":"50.00%","top":"50.00%","width":"28px","height":"28px"}');
  T.check('same rows: same objects in the same order only', EQ.sameRows(ROWS, ROWS.slice()) && !EQ.sameRows(ROWS, ROWS.slice().reverse())
    && !EQ.sameRows(ROWS, ROWS.map((r) => Object.assign({}, r))));
  T.eq('count text while pages arrive', EQ.countText(200, 200, 412, true), 'Loading 200 of 412…');
  T.eq('count text narrowed by a chip', EQ.countText(38, 412, 412, false), '38 of 412 items');
  T.eq('sync button label (old actionsFor rule)', EQ.syncLabel(true, 'stock'), 'Syncing from Fusion… (stock)');
  T.eq('class text', EQ.classText(ROWS[0], { 1: 'Excavators' }, { 11: 'Crawler' }), 'Excavators · Crawler');

  T.section('Equipment: the list is read page by page with the old filters');
  {
    let call = 0;
    const f = fake((o) => {
      if (o.endpoint !== 'eqp-v1/getEquipriteV1EquipmentMaster') return null;
      call++;
      return { ok: true, body: { data: call === 1 ? new Array(200).fill(0).map((_, i) => ({ id: i })) : [{ id: 999 }], recordCount: 201 } };
    });
    const shown = [];
    const v = { searchText: ' cat ', classId: '1', subclassId: '', assetGroupId: '7' };
    let rowsNow = [];
    Object.defineProperty(v, 'allRows', { get: () => rowsNow, set: (x) => { rowsNow = x; shown.push(x.length); }, enumerable: true });
    await new (chain('equipment', 'loadEquipmentChain', f.Actions))().run(ctx(EQ, v));
    const calls = f.rest();
    T.eq('two pages read until recordCount', calls.length, 2);
    T.eq('first page: q, class, group, page, size (subclass not sent)', JSON.stringify(calls[0].uriParams), '{"page":0,"size":200,"q":"cat","equipmentClassId":1,"assetGroupId":7}');
    T.eq('all rows kept', v.allRows.length, 201);
    T.eq('the grid gets the first page at once and the rest together (not one replacement per page)', shown.join(), '200,201');
    T.eq('total from recordCount, loaded count for the band', v.total + '/' + v.loadedCount, '201/201');
  }
  {
    const f = fake(() => ({ ok: false, status: 503 }));
    const v = { searchText: '', classId: '', subclassId: '', assetGroupId: '', allRows: [{ id: 1 }] };
    await new (chain('equipment', 'loadEquipmentChain', f.Actions))().run(ctx(EQ, v));
    T.check('failed read: said, rows cleared', /HTTP 503/.test(v.fetchError) && v.allRows.length === 0 && v.isLoading === false, v.fetchError);
  }
  {
    const f = fake();
    const v = { classId: '1', subclassId: '11', statusFilter: 'all' };
    const C = chain('equipment', 'setFilterChain', f.Actions);
    await new C().run(ctx(EQ, v), { kind: 'class', value: '1' });
    T.check('clicking the class that is on clears it and its subclass, and reads again',
      v.classId === '' && v.subclassId === '' && f.log.some((x) => x.chain === 'loadEquipmentChain'));
    await new C().run(ctx(EQ, v), { kind: 'status', value: 'ACTIVE' });
    T.check('a status chip only narrows (no new read)', v.statusFilter === 'ACTIVE' && f.log.filter((x) => x.chain).length === 1);
    await new C().run(ctx(EQ, v), { kind: 'clear', value: '' });
    T.check('Clear filters with only chips on: all off, no new read', v.statusFilter === 'all' && f.log.filter((x) => x.chain).length === 1);
    v.assetGroupId = '7';
    await new C().run(ctx(EQ, v), { kind: 'clear', value: '' });
    T.check('Clear filters with a server filter on: read again', v.assetGroupId === '' && f.log.filter((x) => x.chain).length === 2);
  }
  {
    const f = fake();
    const v = {};
    await new (chain('equipment', 'openEquipmentChain', f.Actions))().run(ctx(EQ, v), { row: { id: 101 } });
    T.eq('a row opens Equipment detail', JSON.stringify(f.log[0]), '{"nav":"equipment-detail","params":{"equipmentId":"101"}}');
    await new (chain('equipment', 'openImportChain', f.Actions))().run(ctx(EQ, v, { EQR_EQUIPMENT_MASTER: 'READ_ONLY' }));
    T.eq('Import from Fusion: READ_ONLY goes nowhere', f.log.length, 1);
    await new (chain('equipment', 'openImportChain', f.Actions))().run(ctx(EQ, v, FULL('EQR_EQUIPMENT_MASTER')));
    T.eq('Import from Fusion: FULL opens the import page', f.log[1].nav, 'equipment-import');
  }

  T.section('Equipment: Sync from Fusion (the old chain, asked on the page)');
  const okBatch = (more) => ({ ok: true, body: { statusCode: 'SUCCESS', rowsMerged: '', hasMoreData: more || '' } });
  async function sync(level, opts, vars, confirmed) {
    const o = opts || {};
    let batch = 0;
    const f = fake((r) => {
      if (r.endpoint === 'ics/runFusionTableSync') {
        batch++;
        if (o.itemFail) return { ok: true, body: { statusCode: 'ERROR', statusMsg: 'ORA-00942' } };
        return okBatch(batch < (o.batches || 2) ? 'Y' : 'N');
      }
      if (r.endpoint === 'eqp-v1/refreshFusionSyncUnits') return o.unitsFail ? { ok: false, status: 500 } : { ok: true, body: { itemsChanged: 3, serials: 5 } };
      return null;
    }, (c) => (c.chain === 'RunInProgressChain' ? { running: !!o.otherRun, label: 'A Sync from Fusion', startedAt: new Date().toISOString() }
      : c.chain === 'ImportUnitsFromFusionChain' ? { ok: !o.stockFail, message: 'the lots import failed: boom' } : { ok: true }));
    const v = Object.assign({ isSyncing: false, ask: null }, vars || {});
    const c = ctx(EQ, v, level ? { EQR_EQUIPMENT_MASTER: level } : {});
    await new (chain('equipment', 'SyncFromFusionChain', f.Actions))().run(c, { confirmed: !!confirmed });
    return { f, v };
  }
  {
    const { f } = await sync('READ_ONLY', {}, {}, true);
    T.eq('READ_ONLY: nothing called', f.log.length, 0);
  }
  {
    const { f, v } = await sync('FULL', {}, {}, false);
    T.check('not confirmed: the guards run, then the page asks; no sync call', v.ask && v.ask.kind === 'sync' && f.rest().length === 0
      && f.log.some((x) => x.chain === 'RunInProgressChain'));
  }
  {
    const { f } = await sync('FULL', { otherRun: true }, {}, true);
    T.check('another run holds the lock: nothing called, says so', f.rest().length === 0 && /still running/.test(f.notes()[0].message));
  }
  {
    const { f } = await sync('FULL', {}, { isImporting: true }, true);
    T.eq('busy here: warning, nothing called', f.rest().length + ':' + f.notes()[0].type, '0:warning');
  }
  {
    const { f, v } = await sync('FULL', { batches: 3 }, {}, true);
    const items = f.rest().filter((x) => x.rest === 'ics/runFusionTableSync');
    T.eq('items: every batch, DELTA, on the refresh row', items.map((x) => x.body.batchNum + x.body.fullSyncFlag + x.body.syncCode).join(','),
      '1NEQUIP_ITEM_REFRESH_SYNC,2NEQUIP_ITEM_REFRESH_SYNC,3NEQUIP_ITEM_REFRESH_SYNC');
    T.eq('then stock, then units with a full snapshot', f.log.filter((x) => x.chain === 'ImportUnitsFromFusionChain' || x.rest === 'eqp-v1/refreshFusionSyncUnits')
      .map((x) => x.chain || x.rest + ':' + x.body.snapshot).join(' > '), 'ImportUnitsFromFusionChain > eqp-v1/refreshFusionSyncUnits:Y');
    T.eq('stock step shares the run\'s startTime', f.log.find((x) => x.chain === 'ImportUnitsFromFusionChain').params.startTime, items[0].body.startTime);
    T.check('the list is read again, the summary kept on the page', f.log.some((x) => x.chain === 'loadEquipmentChain') && v.syncResult.type === 'confirmation');
    T.check('no lock release on success (refresh-units released it)', !f.log.some((x) => x.chain === 'ReleaseSyncLockChain'));
    T.eq('busy flag cleared', v.isSyncing + '|' + v.syncStep, 'false|');
  }
  {
    const { f } = await sync('FULL', { stockFail: true }, {}, true);
    T.eq('partial stock: snapshot N', f.rest().find((x) => x.rest === 'eqp-v1/refreshFusionSyncUnits').body.snapshot, 'N');
  }
  {
    const { f } = await sync('FULL', { itemFail: true }, {}, true);
    T.check('item stage fails: no stock, no units, lock released, error persists',
      !f.log.some((x) => x.chain === 'ImportUnitsFromFusionChain') && f.log.some((x) => x.chain === 'ReleaseSyncLockChain')
      && f.notes().some((n) => n.type === 'error' && n.displayMode === 'persist' && /ORA-00942/.test(n.message)));
  }
  {
    const { f } = await sync('FULL', { unitsFail: true }, {}, true);
    T.check('units fail: error says items were updated, lock released',
      f.notes().some((n) => /Items were updated/.test(n.message)) && f.log.some((x) => x.chain === 'ReleaseSyncLockChain'));
  }
  {
    const f = fake(null, () => ({ ok: true }));
    const v = { ask: { kind: 'sync' } };
    await new (chain('equipment', 'answerChain', f.Actions))().run(ctx(EQ, v), { answer: 'ok' });
    T.eq('the card\'s OK runs the sync confirmed', JSON.stringify(f.log[0]), '{"chain":"SyncFromFusionChain","params":{"confirmed":true}}');
    await new (chain('equipment', 'answerChain', f.Actions))().run(ctx(EQ, v), { answer: 'cancel' });
    T.check('Cancel closes the card only', v.ask === null && f.log.length === 1);
  }

  // ═══ Import from Fusion ═══════════════════════════════════════════════════
  T.section('Import from Fusion: the review');
  const sv = () => ({ stagingArray: JSON.parse(JSON.stringify(STG)), subclassOptionsArray: SUBS, classesById: { 5: 'Excavator', 9: 'Truck' },
    subclassesById: { 12: 'Mini', 13: 'Large', 21: 'Light' }, stagingChangedRows: {}, stagingSelectedRows: {}, bulk: {}, editKey: '' });
  {
    const v = sv();
    IMP.indexRows(v.stagingArray, v);
    v.stagingSelectedRows = IMP.setPageSelection(true, v);
    T.eq('tick all: MERGED rows are left out', Object.keys(v.stagingSelectedRows).join(','), '1,3');
    const p = IMP.importPreview(v.stagingSelectedRows, {}, v.stagingArray, v.classesById);
    T.eq('the preview says what Import adds and what it skips', p.text, 'Import adds 1 item to the equipment master: 1 Excavator. 1 ticked row has no class and will be skipped.');
    const f = fake();
    const C = chain('equipment-import', 'classEditChain', f.Actions);
    await new C().run(ctx(IMP, v), { action: 'open', index: '2' });
    T.eq('the editor is keyed on the merge key', v.editKey, '3');
    await new C().run(ctx(IMP, v), { action: 'class', value: '9' });
    await new C().run(ctx(IMP, v), { action: 'subclass', value: '21' });
    T.eq('class and subclass go through applyEdit', JSON.stringify(v.stagingChangedRows['3']), '{"fusionInventoryItemId":3,"resolvedClassId":9,"resolvedSubclassId":21}');
    T.eq('... and onto the row', v.stagingArray[2].resolvedClassId + '/' + v.stagingArray[2].resolvedSubclassId, '9/21');
    T.eq('editIndex after a reload that dropped the row', IMP.editIndex(v.editKey, [{ fusionInventoryItemId: 8 }]), -1);
    await new C().run(ctx(IMP, v), { action: 'bulkClass', value: '5' });
    await new C().run(ctx(IMP, v), { action: 'bulkSubclass', value: '13' });
    await new C().run(ctx(IMP, v), { action: 'applyBulk' });
    T.eq('bulk: every ticked row gets the class and subclass', ['1', '3'].map((k) => v.stagingChangedRows[k].resolvedClassId + '/' + v.stagingChangedRows[k].resolvedSubclassId).join(','), '5/13,5/13');
    T.eq('bulk: the MERGED row is not touched', v.stagingChangedRows['2'], undefined);
    T.eq('import body after the edits', JSON.stringify(IMP.buildImportBody(v.stagingSelectedRows, v.stagingChangedRows, v.stagingArray).assignments.map((a) => a.fusionInventoryItemId + ':' + a.resolvedClassId)), '["1:5","3:5"]');
    T.eq('page text', IMP.pageText(1, 100, 5266, 100), '101–200 of 5,266');
    T.eq('item class search', IMP.itemClassMatches([{ value: 'ROOT_ICC', label: 'Root' }, { value: 'HEAVY', label: 'Heavy Equipment' }], 'heav').map((o) => o.value).join(), 'HEAVY');
  }

  T.section('Import from Fusion: Fetch (the old chain)');
  async function fetchRun(opts, vars) {
    const o = opts || {};
    let n = 0;
    const f = fake((r) => {
      if (r.endpoint === 'ics/runFusionTableSync') { n++; return o.busy ? { ok: true, body: { statusCode: 'E', statusMsg: 'BUSY: SYNC started 09:00' } }
        : { ok: true, body: { statusCode: 'SUCCESS', rowsMerged: '40', hasMoreData: n < 2 ? 'Y' : 'N' } }; }
      if (r.endpoint === 'eqp-v1/promoteEquipmentImport') return o.promoteFail ? { ok: false, status: o.promoteFail } : { ok: true, body: { promoted: 0, autoMapped: 12, notes: 'errored=3' } };
      return null;
    }, (c) => (c.chain === 'RunInProgressChain' ? { running: false } : { ok: true, total: 9 }));
    const v = Object.assign({ isImporting: false, isImportingUnits: false, stagingSaving: false, stagingClearing: false, stagingSelectedRows: {},
      stagingChangedRows: {}, importWarning: '', importDialogOpen: true, selectedItemClass: o.itemClass || null }, vars || {});
    await new (chain('equipment-import', 'ImportFromFusionChain', f.Actions, {}, { window: { confirm: () => o.confirm !== false, addEventListener() {}, removeEventListener() {} } }))().run(ctx(IMP, v));
    return { f, v };
  }
  {
    const { f, v } = await fetchRun({ itemClass: 'HEAVY' });
    T.eq('order: item batches, stock, promote', f.log.filter((x) => x.rest || x.chain === 'ImportUnitsFromFusionChain').map((x) => x.rest || x.chain).join(' > '),
      'ics/runFusionTableSync > ics/runFusionTableSync > ImportUnitsFromFusionChain > eqp-v1/promoteEquipmentImport');
    T.eq('FULL item sync, item class as extractFilter on every batch', f.rest().filter((x) => x.rest === 'ics/runFusionTableSync').map((x) => x.body.fullSyncFlag + x.body.extractFilter + x.body.syncCode).join(','),
      'YHEAVYEQUIP_ITEM_DEF_SYNC,YHEAVYEQUIP_ITEM_DEF_SYNC');
    T.check('the review and What to map next are read again', f.log.some((x) => x.chain === 'LoadStagingChain') && f.log.some((x) => x.chain === 'LoadUnmatchedValuesChain'));
    T.check('result: 80 rows, 12 auto-mapped, 3 to review', /80 Fusion item rows fetched\. 12 auto-mapped/.test(v.importMessage) && /3 need review/.test(v.importMessage), v.importMessage);
    T.check('the old SDP refresh is gone from the copy', !/equipmentSDP/.test(fs.readFileSync(path.join(PAGES, 'equipment-import-page-chains', 'ImportFromFusionChain.js'), 'utf8')));
  }
  {
    const { f } = await fetchRun({ promoteFail: 409 });
    T.check('promote 409: Busy, the review is read again anyway', f.notes().some((n) => n.summary === 'Busy') && f.log.some((x) => x.chain === 'LoadStagingChain'));
  }
  {
    const { f } = await fetchRun({ busy: true });
    T.check('refused BUSY at batch 1: no promote, no release (not our lock)',
      !f.rest().some((x) => x.rest === 'eqp-v1/promoteEquipmentImport') && !f.log.some((x) => x.chain === 'ReleaseSyncLockChain'));
  }
  {
    const { f, v } = await fetchRun({ confirm: false }, { stagingSelectedRows: { 1: true } });
    T.check('ticks pending and Cancel: nothing fetched, ticks kept', f.rest().length === 0 && v.stagingSelectedRows[1] === true);
  }

  T.section('Import from Fusion: Import the ticked rows (the old chain)');
  async function importRun(respond, vars) {
    const f = fake(respond);
    const v = Object.assign(sv(), { stagingSaving: false }, vars || {});
    IMP.indexRows(v.stagingArray, v);
    const r = await new (chain('equipment-import', 'SaveStagingClassesChain', f.Actions))().run(ctx(IMP, v));
    return { f, v, r };
  }
  {
    const { f, v } = await importRun((o) => (o.endpoint === 'eqp-v1/patchEquipmentImportStagingAssignments'
      ? { ok: true, body: { updated: 1, failed: [{ fusionInventoryItemId: 4, reason: 'ALREADY_MERGED' }] } }
      : { ok: true, body: { promoted: 1 } }), { stagingSelectedRows: { 1: true, 3: true, 4: true },
      stagingArray: JSON.parse(JSON.stringify(STG)).concat([{ fusionInventoryItemId: 4, importStatus: 'AUTO_MAPPED', resolvedClassId: 9 }]) });
    T.eq('PATCH the ticked rows with a class, then promote', f.seq(), 'eqp-v1/patchEquipmentImportStagingAssignments > eqp-v1/promoteEquipmentImport');
    T.eq('body: the class-less ticked row is left out', JSON.stringify(f.rest()[0].body), '{"assignments":[{"fusionInventoryItemId":1,"resolvedClassId":5,"resolvedSubclassId":12},{"fusionInventoryItemId":4,"resolvedClassId":9,"resolvedSubclassId":null}]}');
    T.eq('promote body is empty (everything eligible)', JSON.stringify(f.rest()[1].body), '{}');
    T.eq('the failed row stays ticked for a retry', Object.keys(v.stagingSelectedRows).join(','), '4');
    T.check('the message counts and groups the failures', /1 item confirmed\. 1 added/.test(v.stagingSaveMessage) && /1 ALREADY_MERGED/.test(v.stagingSaveMessage), v.stagingSaveMessage);
    T.eq('then the review is read again keeping ticks, and the groups', f.log.filter((x) => x.chain).map((x) => x.chain + (x.params && x.params.preserve ? '+keep' : '')).join(','), 'LoadStagingChain+keep,LoadUnmatchedValuesChain');
  }
  {
    const { f, v } = await importRun(() => ({ ok: false, status: 500 }), { stagingSelectedRows: { 1: true } });
    T.check('PATCH fails: no promote, nothing changed, ticks kept', f.seq() === 'eqp-v1/patchEquipmentImportStagingAssignments'
      && /Nothing was changed/.test(v.stagingSaveMessage) && v.stagingSelectedRows[1] === true && v.stagingSaving === false);
  }
  {
    const { f, v } = await importRun((o) => (o.endpoint === 'eqp-v1/promoteEquipmentImport' ? { ok: false, status: 409 } : { ok: true, body: { updated: 1, failed: [] } }),
      { stagingSelectedRows: { 1: true } });
    T.check('promote 409: classified, press Import again when the other run ends', /Another import or sync is running/.test(v.stagingSaveMessage) && f.notes()[0].type === 'warning');
  }
  {
    const { f, v } = await importRun(() => null, { stagingSelectedRows: { 3: true } });
    T.check('only class-less rows ticked: nothing sent, says why', f.rest().length === 0 && /no Class/.test(v.stagingSaveMessage));
  }

  T.section('Import from Fusion: Clear fetch (asked on the page)');
  {
    const f = fake((o) => (o.endpoint === 'eqp-v1/clearEquipmentImportStaging' ? { ok: true, body: { deleted: 40, keptMapped: 2, keptMerged: 0 } } : null));
    const v = Object.assign(sv(), { stagingTotalElements: 42, stagingClearing: false });
    const C = chain('equipment-import', 'ClearStagingChain', f.Actions);
    await new C().run(ctx(IMP, v), {});
    T.check('first it asks, with the count', v.ask && v.ask.kind === 'clear' && /42 fetched items/.test(v.ask.message) && f.rest().length === 0);
    await new C().run(ctx(IMP, v), { confirmed: true });
    T.eq('confirmed: DELETE staging, then read again', f.seq() + ' | ' + f.log.filter((x) => x.chain).map((x) => x.chain).join(','),
      'eqp-v1/clearEquipmentImportStaging | LoadStagingChain,LoadUnmatchedValuesChain');
    T.check('says what went and what stayed', /40 fetched items removed\. 2 kept — 2 already classified/.test(v.stagingSaveMessage), v.stagingSaveMessage);
  }
  {
    const f = fake(() => ({ ok: false, status: 500 }));
    const v = Object.assign(sv(), { stagingTotalElements: 5 });
    await new (chain('equipment-import', 'ClearStagingChain', f.Actions))().run(ctx(IMP, v), { confirmed: true });
    T.check('DELETE fails: nothing deleted, not read again', /Nothing was deleted/.test(v.stagingSaveMessage) && !f.log.some((x) => x.chain));
  }
  {
    let asked = 0;
    const B = chain('equipment-import', 'BeforeExitChain', {}, {}, { window: { confirm: () => { asked++; return false; } } });
    const r1 = await new B().run(ctx(IMP, { isImporting: true }));
    const r2 = await new B().run(ctx(IMP, { stagingSelectedRows: { 1: true }, stagingChangedRows: {} }));
    const r3 = await new B().run(ctx(IMP, { stagingSelectedRows: {}, stagingChangedRows: {} }));
    T.eq('leaving mid-Fetch or with ticks asks; idle leaves', [!!(r1 && r1.cancelled), !!(r2 && r2.cancelled), !!(r3 && r3.cancelled), asked].join(','), 'true,true,false,2');
  }
  {
    const f = fake();
    const v = { pageAccessMap: {} };
    await new (chain('equipment-import', 'importInitChain', f.Actions))().run(ctx(IMP, v, { EQR_EQUIPMENT_MASTER: 'READ_ONLY' }));
    T.eq('the import page sends READ_ONLY back to Equipment', f.log.filter((x) => x.nav).map((x) => x.nav).join(), 'equipment');
  }

  // ═══ Equipment detail ═════════════════════════════════════════════════════
  T.section('Equipment detail: what it shows');
  const UNITS = [{ id: 1, serialNumber: 'S1', unitStatus: 'AVAILABLE', maintenanceAssetNumber: 'MA-1', locationName: 'Houston', currentOrgName: 'HOU' },
    { id: 2, serialNumber: 'S2', unitStatus: 'RENTED', maintenanceAssetNumber: 'MA-2' }, { id: 3, serialNumber: 'S3', unitStatus: 'AVAILABLE' }];
  T.eq('control type from the master flags', [{ isSerialControlled: 'Y' }, { isLotControlled: 'Y' }, {}].map((m) => DET.controlTypeOf(m)).join(), 'SERIAL,LOT,INVENTORY');
  T.eq('unit summary', DET.unitSummary(UNITS).map((u) => u.label + ' ' + u.count).join(','), 'AVAILABLE 2,RENTED 1');
  T.eq('unit search', DET.filterUnits(UNITS, 'houston').map((u) => u.id).join(), '1');
  T.eq('lot quantity reads onHandQty', DET.unitQty({ onHandQty: 12, uomCode: 'EA' }, 'LOT'), '12 EA');
  T.eq('asset numbers, distinct, with the master\'s', DET.assetNumbers({ maintenanceAssetNumber: 'MA-1' }, UNITS).join(), 'MA-1,MA-2');
  T.eq('class change consequence', DET.classChangeText({ classId: 2, subclassId: 21 }, { equipmentNumber: 'EQ-1', equipmentClassName: 'Excavators', equipmentSubclassName: 'Crawler' },
    [{ value: 2, label: 'Tools' }], [{ value: 21, label: 'Drill' }]),
  'EQ-1 moves from Excavators · Crawler to Tools · Drill. Its units stay as they are; expenditure types it inherits from its class or subclass follow the new one.');
  T.eq('certificate light: expired first', DET.certLight([{ status: 'valid' }, { status: 'expired' }]).text, '1 certificate expired');
  T.eq('certificate light: none', DET.certLight([{ status: 'none' }]).text, 'No certificates on file');
  const WO = DET.workOrderRows({ 'MA-1': [{ WorkOrderNumber: 'WO-1', WorkOrderStatusCode: 'ORA_COMPLETED', PlannedStartDate: '2026-10-01' },
    { WorkOrderNumber: 'WO-2', WorkOrderStatus: 'Unreleased', PlannedStartDate: '2026-09-01' }] });
  T.eq('work orders: open first, status as words', WO.map((w) => w.number + ':' + w.status + ':' + w.open).join(','), 'WO-2:Unreleased:true,WO-1:Completed:false');
  T.eq('maintenance light', DET.woLight(WO, true).text, '1 open work order');
  T.eq('tracked in: the systems flagged Y', [DET.trackedIn({ isMaintenanceTracked: 'Y', isInventoryTracked: 'Y', isFixedAssetTracked: 'N' }),
    DET.trackedIn({ isMaintenanceTracked: 'N' }), DET.trackedIn({})].join('|'), 'Maintenance, Inventory|None|—');
  T.eq('old unit page link', DET.oldUnitLink('http://x/', '101', 7, 'SERIAL'), 'http://x/vp/shell/equipment-foundation/equipment-unit-detail?equipmentId=101&serialRefId=7&controlType=SERIAL');

  T.section('Equipment detail: the old units page\'s calls');
  {
    const f = fake((o) => {
      if (o.endpoint === 'eqp-v1/getEquipriteV1EquipmentMasterById') return { ok: true, body: { id: 101, isSerialControlled: 'N', isLotControlled: 'Y', equipmentClassId: 1, equipmentSubclassId: 11 } };
      if (o.endpoint === 'eqp-v1/getEquipmentClassById') return { ok: true, body: { className: 'Excavators' } };
      if (o.endpoint === 'eqp-v1/getSubclassById') return { ok: true, body: { subclassName: 'Crawler' } };
      if (o.endpoint === 'eqp-v1/getLotRefs') return { ok: true, body: { data: [{ id: 5, lotNumber: 'L1', currentLocationId: 501, invOrgId: 9 }] } };
      if (o.endpoint === 'eqp-v1/getLocationById') return { ok: true, body: { locationName: 'Houston Yard' } };
      if (o.endpoint === 'eqp-v1/getInvOrgs') return { ok: true, body: { data: [{ invOrgId: 9, organizationName: 'HOU-YARD' }] } };
      return null;
    });
    const v = { equipmentId: '101', controlType: '', attLevel: 'HEADER' };
    await new (chain('equipment-detail', 'detailInitChain', f.Actions))().run(ctx(DET, v, FULL('EQR_EQUIPMENT_MASTER')));
    T.eq('order: master, class, subclass, units, location, orgs', f.rest().map((x) => x.rest).slice(0, 6).join(' > '),
      'eqp-v1/getEquipriteV1EquipmentMasterById > eqp-v1/getEquipmentClassById > eqp-v1/getSubclassById > eqp-v1/getLotRefs > eqp-v1/getLocationById > eqp-v1/getInvOrgs');
    T.eq('lot units filtered by equipmentId (inventory takes eqrEquipmentMasterId)', JSON.stringify(f.rest()[3].uriParams), '{"equipmentId":101,"size":10000}');
    T.eq('control type from the master (the old RowClickChain rule)', v.controlType, 'LOT');
    T.eq('names and enrichment', [v.masterRecord.equipmentClassName, v.masterRecord.equipmentSubclassName, v.unitsArray[0].locationName, v.unitsArray[0].currentOrgName].join('|'),
      'Excavators|Crawler|Houston Yard|HOU-YARD');
    T.check('then documents and expenditure types', f.log.some((x) => x.chain === 'loadAttachmentsChain') && f.log.some((x) => x.chain === 'loadEquipExpTypesChain'));
  }
  {
    const f = fake(() => ({ ok: false, status: 404 }));
    const v = { equipmentId: '9' };
    await new (chain('equipment-detail', 'detailInitChain', f.Actions))().run(ctx(DET, v));
    T.check('a failed read is said on the page', /HTTP 404/.test(v.loadError) && f.rest().length === 1);
  }

  T.section('Equipment detail: Change class (the old chains)');
  const SUBS_C = [{ value: 11, label: 'Tablet', classId: 1 }, { value: 12, label: 'Laptop', classId: 1 }, { value: 21, label: 'Drill', classId: 2 }];
  const MREC = { id: 500, equipmentNumber: 'EQ-1', equipmentClassId: 1, equipmentSubclassId: 11, objectVersionNumber: 3 };
  {
    const f = fake((o) => (o.endpoint === 'eqp-v1/getEquipmentClasses'
      ? { ok: true, body: { data: [{ id: 1, className: 'Computer' }, { id: 2, className: 'Tools' }, { id: 9, className: 'Old', effectiveEndDate: '2020-01-01' }], hasMore: false } }
      : { ok: true, body: { data: [{ id: 11, subclassName: 'Tablet', eqrEquipmentClassId: 1 }, { id: 21, subclassName: 'Drill', eqrEquipmentClassId: 2 }], hasMore: false } }));
    const v = { masterRecord: Object.assign({}, MREC) };
    await new (chain('equipment-detail', 'openChangeClassChain', f.Actions))().run(ctx(DET, v, FULL('EQR_EQUIPMENT_MASTER')));
    T.check('opens the panel with the current class, end-dated classes left out', v.classPanelOpen && JSON.stringify(v.classDraft) === '{"classId":1,"subclassId":11}'
      && v.classOptions.map((o) => o.value).join() === '1,2');
    const P = chain('equipment-detail', 'classPickChain', {});
    await new P().run(ctx(DET, v), { kind: 'class', value: '2' });
    T.eq('picking another class drops the other class\'s subclass', JSON.stringify(v.classDraft), '{"classId":2,"subclassId":null}');
    T.eq('... and the subclass list follows', v.subclassOptions.map((o) => o.value).join(), '21');
    const r = fake();
    const vr = { masterRecord: Object.assign({}, MREC) };
    await new (chain('equipment-detail', 'openChangeClassChain', r.Actions))().run(ctx(DET, vr, { EQR_EQUIPMENT_MASTER: 'READ_ONLY' }));
    T.eq('READ_ONLY: does not open', !!vr.classPanelOpen, false);
  }
  const saveVars = () => ({ masterRecord: Object.assign({}, MREC), equipmentId: '500', classPanelOpen: true, classDraft: { classId: 1, subclassId: 12 },
    classOptions: [{ value: 1, label: 'Computer' }], subclassOptions: DET.subclassOptionsFor(SUBS_C, 1) });
  {
    const f = fake((o) => (o.endpoint === 'eqp-v1/patchEquipment' ? { ok: true }
      : { ok: true, body: Object.assign({}, MREC, { equipmentSubclassId: 12, objectVersionNumber: 4 }) }));
    const v = saveVars();
    await new (chain('equipment-detail', 'saveClassChangeChain', f.Actions))().run(ctx(DET, v, FULL('EQR_EQUIPMENT_MASTER')));
    T.eq('PATCH then read back', f.seq(), 'eqp-v1/patchEquipment > eqp-v1/getEquipriteV1EquipmentMasterById');
    T.eq('PATCH: this item, both ids and the version', JSON.stringify([f.rest()[0].uriParams, f.rest()[0].body]), '[{"id":500},{"equipmentClassId":1,"equipmentSubclassId":12,"objectVersionNumber":3}]');
    T.check('saved: card updated, panel closed, notice, expenditure types reloaded', v.masterRecord.equipmentSubclassName === 'Laptop' && v.masterRecord.objectVersionNumber === 4
      && v.classPanelOpen === false && f.notes()[0].summary === 'Class changed' && f.log.some((x) => x.chain === 'loadEquipExpTypesChain'));
  }
  {
    const f = fake((o) => (o.endpoint === 'eqp-v1/patchEquipment' ? { ok: true } : { ok: true, body: Object.assign({}, MREC) }));
    const v = saveVars();
    await new (chain('equipment-detail', 'saveClassChangeChain', f.Actions))().run(ctx(DET, v, FULL('EQR_EQUIPMENT_MASTER')));
    T.check('the server kept the old subclass: said, not reported as success', /did not apply/.test(v.classChangeError) && f.notes().length === 0 && v.classPanelOpen === true);
  }
  {
    const f = fake(() => ({ ok: false, status: 409 }));
    const v = saveVars();
    await new (chain('equipment-detail', 'saveClassChangeChain', f.Actions))().run(ctx(DET, v, FULL('EQR_EQUIPMENT_MASTER')));
    T.check('409: someone else changed it', /Someone else/.test(v.classChangeError) && f.rest().length === 1);
  }
  {
    const f = fake();
    const v = Object.assign(saveVars(), { classDraft: { classId: 1, subclassId: null } });
    await new (chain('equipment-detail', 'saveClassChangeChain', f.Actions))().run(ctx(DET, v, FULL('EQR_EQUIPMENT_MASTER')));
    const v2 = saveVars();
    await new (chain('equipment-detail', 'saveClassChangeChain', f.Actions))().run(ctx(DET, v2, { EQR_EQUIPMENT_MASTER: 'READ_ONLY' }));
    T.check('a class with subclasses needs one; READ_ONLY sends nothing', f.rest().length === 0 && /Choose one/.test(v.classChangeError));
  }

  // ═══ Rate schedules ═══════════════════════════════════════════════════════
  T.section('Rate schedules: the grid rules');
  const L = (o) => Object.assign({ classId: 1, className: 'Excavators', subclassId: null, subclassName: '', equipmentName: '', location: '', rateType: 'USAGE',
    calcMethod: 'COMPLETE_PERIOD', calcBasis: 'DAILY', periodAmount: null, costRate: 0, billRate: 0 }, o);
  const LINES_R = [
    L({ id: 1, period: 'DAILY', threshold: 0, periodAmount: 880, costRate: 880, billRate: 1240 }),
    L({ id: 2, period: 'WEEKLY', threshold: 5, periodAmount: 3900, costRate: 557.1429, billRate: 3800 }),
    L({ id: 3, period: 'MONTHLY', threshold: 20, periodAmount: null, costRate: 400, billRate: 0 }),
    L({ id: 4, className: 'Generators', classId: 2, period: 'HOURLY', calcMethod: 'UTILIZED_DURATION', calcBasis: 'HOURLY', threshold: 0, costRate: 120, periodAmount: 120 }),
    L({ id: 5, className: 'Generators', classId: 2, period: 'HOURLY', calcMethod: 'UTILIZED_DURATION', calcBasis: 'HOURLY', threshold: 40, costRate: 100, periodAmount: 100 }),
  ];
  {
    let r = RATES.applyLineEdit(LINES_R[1], 'periodAmount', '3500');
    T.eq('a typed total derives the rate (4 dp)', r.line.costRate, 500);
    r = RATES.applyLineEdit(LINES_R[1], 'costRate', '600');
    T.eq('a typed rate restates the total (2 dp)', r.line.periodAmount, 4200);
    r = RATES.applyLineEdit(LINES_R[0], 'period', 'WEEKLY');
    T.eq('a new period holds the rate and restates the total (DAILY 880 -> WEEKLY 6,160)', r.line.periodAmount, 6160);
    r = RATES.applyLineEdit(LINES_R[2], 'period', 'QUARTERLY');
    T.eq('... a line with no authored total stays inferred', r.line.periodAmount, null);
    T.eq('a period the method cannot carry is refused', RATES.applyLineEdit(LINES_R[0], 'period', 'HOURLY').ok, false);
    r = RATES.applyLineEdit(L({ period: 'WEEKLY', calcMethod: 'UTILIZED_DURATION', calcBasis: 'DAILY', costRate: 100, periodAmount: 700 }), 'calcBasis', 'HOURLY');
    T.eq('hourly basis strands a weekly period: coerced to HOURLY, total restated', r.line.period + ':' + r.line.periodAmount, 'HOURLY:100');
    T.eq('threshold is floored', RATES.applyLineEdit(LINES_R[0], 'threshold', '4.7').line.threshold, 4);
    T.eq('negative refused', RATES.applyLineEdit(LINES_R[0], 'billRate', '-1').ok, false);
    T.eq('clearing the total goes back to the inferred figure', RATES.shownTotal(RATES.applyLineEdit(LINES_R[1], 'periodAmount', '').line), 3900);
    T.eq('inferred total = rate x days', RATES.shownTotal(LINES_R[2]), 12000);
  }
  {
    const groups = RATES.groupLines(LINES_R);
    T.eq('one row per class/subclass/equipment/location/rate type', groups.map((g) => g.title).join(','), 'Excavators,Generators');
    T.eq('cells by period', groups[0].cells.map((c) => c.lines.length).join(''), '011100');
    T.eq('hourly tiers stack in the Hourly cell, lowest first', groups[1].cells[0].lines.map((l) => l.threshold).join(), '0,40');
    T.eq('a complete-period row cannot take Hourly; an hourly row only Hourly', groups[0].cells[0].allowed + ',' + groups[1].cells[2].allowed, 'false,false');
    T.eq('margin: bill below cost is flagged', RATES.margin(LINES_R[1]).state + ',' + RATES.margin(LINES_R[0]).text + ',' + RATES.margin(LINES_R[2]).state, 'low,+29%,none');
    T.eq('margin check wording', RATES.marginIssues(LINES_R).map((i) => i.text).join(), 'Excavators · Weekly: bill $3,800 is below cost $3,900.');
  }
  {
    const sim = RATES.simulate(LINES_R, { hours: 80, daysWorked: 10, daysOnRent: 14, qty: 1 });
    T.eq('14 days on rent reach the Weekly tier (from 5): 14 × $557.1429 (4 dp, as billed) = $7,800.00',
      sim.rows[0].text, '14 days on rent reach the Weekly tier (from 5 days) → 14 × $557.1429/day = $7,800.00 (2 weeks at $3,900)');
    T.eq('80 logged hours reach the 40 h tier: 80 × $100', sim.rows[1].cost, 8000);
    T.eq('total of the rows', sim.total, 15800);
    const sim2 = RATES.simulate(LINES_R, { hours: 0, daysWorked: 0, daysOnRent: 30, qty: 2 });
    T.eq('30 days reach Monthly (from 20); quantity 2', sim2.rows[0].cost, 24000);
    T.check('no hours: no line applies to the hourly row', sim2.rows[1].cost === null && /No line applies/.test(sim2.rows[1].text));
    T.eq('only Usage lines are priced', RATES.simulate([L({ period: 'DAILY', threshold: 0, costRate: 10, rateType: 'STANDBY' })], { daysOnRent: 3 }).rows.length, 0);
  }
  {
    const n = RATES.newLine(LINES_R[0], 'MONTHLY', 2, 'new:1');
    T.eq('a new line keeps the row and takes the old defaults', [n.className, n.calcMethod, n.calcBasis, n.period, n.threshold, n.periodAmount, n.costRate].join('|'), 'Excavators|COMPLETE_PERIOD|MONTHLY|MONTHLY|30||0');
    T.eq('... with no authored total (inferred)', n.periodAmount, null);
    T.eq('a first line starts at threshold 0, UTILIZED + DAILY by default', [RATES.newLine({}, 'DAILY', 0, 'k').threshold, RATES.newLine({}, 'DAILY', 0, 'k').calcMethod].join(), '0,UTILIZED_DURATION');
  }
  {
    const S = [{ id: 1, scheduleName: 'US Excavators', status: 'ACTIVE', customer: '—', project: '—', yard: 'Houston', endDate: '2026-11-15', description: 'x' },
      { id: 2, scheduleName: 'Default', status: 'INACTIVE', customer: '—', project: '—', yard: '—', endDate: '—' },
      { id: 3, scheduleName: 'Lone Star MSA', status: 'ACTIVE', customer: 'Lone Star Paving', project: 'Pipeline', task: '2.1', yard: '—', endDate: '2027-12-31' }];
    T.eq('list chips', RATES.listChips(S, '2026-10-29').map((c) => c.key + ':' + c.count).join(','), 'all:3,ACTIVE:2,INACTIVE:1,expiring:1,tagged:2,untagged:1');
    T.eq('keyword: any word (old filter), widened to customer', RATES.filterSchedules(S, 'lone zzz', 'all').map((s) => s.id).join(), '3');
    T.eq('tags text', RATES.tagText(S[2]), 'Customer Lone Star Paving · Project Pipeline · 2.1');
    T.eq('untagged reads as the fallback', RATES.tagText(S[1]), 'No tags: the fallback rates');
  }

  T.section('Rate schedules: Save (the old chain, body for body)');
  const FORM = { scheduleName: 'US Excavators 2026', scheduleCode: '', description: 'Base', customerId: 77, projectId: null, projectName: 'stale', taskId: null,
    yardOrgId: 300, currency: 'USD', startDate: '2026-01-01', endDate: '2026-12-31', activeStatus: true };
  async function saveRun(respond, vars, level) {
    const f = fake(respond);
    const v = Object.assign({ selectedId: '9', formData: FORM, lines: [LINES_R[1], Object.assign(L({ _key: 'new:1', period: 'HOURLY', threshold: 0, costRate: 50, calcMethod: 'COMPLETE_PERIOD', calcBasis: 'HOURLY' }))],
      saving: false, dirty: true }, vars || {});
    await new (chain('rates', 'saveScheduleChain', f.Actions))().run(ctx(RATES, v, { EQR_RATE_SCHEDULE: level || 'FULL' }));
    return { f, v };
  }
  {
    const { f, v } = await saveRun((o) => (o.endpoint === 'eqp-v1/updateRateSchedule' ? { ok: true, body: { id: 9 } } : null));
    T.eq('order: header PUT, then each line, then read again', f.seq(), 'eqp-v1/updateRateSchedule > eqp-v1/updateRatePeriodLine > eqp-v1/createRatePeriodLine');
    const hb = f.rest()[0].body;
    T.eq('header body as the old chain', JSON.stringify(hb), JSON.stringify({ scheduleName: 'US Excavators 2026', scheduleCode: 'RS-US-EXCAVATORS-2026', description: 'Base',
      currencyCode: 'USD', effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: '2026-12-31T00:00:00Z', isActiveFlag: 'Y', equipmentClassId: null, customerRefId: 77,
      projectRefId: null, projectName: null, taskRefId: null, taskName: null, yardOrgId: 300, rateType: 'STANDARD', agreementHeaderId: null }));
    const l1 = f.rest()[1];
    T.eq('existing line: PUT by id', l1.uriParams.id, 2);
    T.eq('line body: full DTO, period total kept, divisor cleared, WEEK uom, bill as rateAmount',
      [l1.body.rateScheduleId, l1.body.periodType, l1.body.rateUom, l1.body.costRate, l1.body.billRate, l1.body.rateAmount, l1.body.periodAmount, l1.body.periodDivisor, l1.body.calcBasis, l1.body.fromUnit].join('|'),
      '9|WEEKLY|WEEK|557.1429|3800|3800|3900||WEEKLY|5');
    const l2 = f.rest()[2].body;
    T.eq('new line: POST, HOURLY on complete-period coerced to DAILY, seq numbered on from the highest (the old rule)', [l2.periodType, l2.rateUom, l2.calcBasis, l1.body.periodSeq, l2.periodSeq].join('|'), 'DAILY|DAY|DAILY|1|2');
    T.check('then the list and the schedule are read again, nothing dirty', f.log.filter((x) => x.chain).map((x) => x.chain).join() === 'loadSchedulesChain,selectScheduleChain' && v.dirty === false);
    T.eq('success notice', f.notes().map((n) => n.summary).join(), 'Success');
  }
  {
    const { f } = await saveRun((o) => (o.endpoint === 'eqp-v1/createRateSchedule' ? { ok: true, body: { id: 55 } } : null), { selectedId: 'new' });
    T.eq('new schedule: POST header, lines carry its id', f.rest()[0].rest + ' ' + f.rest().slice(1).map((x) => x.body.rateScheduleId).join(), 'eqp-v1/createRateSchedule 55,55');
  }
  {
    const { f } = await saveRun(() => ({ ok: false, status: 500 }));
    T.check('header fails: no line is written', f.seq() === 'eqp-v1/updateRateSchedule' && /Failed to save rate schedule: 500/.test(f.notes()[0].message));
  }
  {
    const { f } = await saveRun((o) => (o.endpoint === 'eqp-v1/updateRatePeriodLine' ? { ok: false, status: 400 } : { ok: true, body: { id: 9 } }));
    T.check('a failed line is reported and the next one still saved', /Failed to save line 1: 400/.test(f.notes()[0].message) && f.rest().some((x) => x.rest === 'eqp-v1/createRatePeriodLine'));
  }
  {
    const { f } = await saveRun(null, { formData: Object.assign({}, FORM, { startDate: '' }) });
    T.check('no start date: nothing sent', f.rest().length === 0 && /required fields/.test(f.notes()[0].message));
    const r = await saveRun(null, {}, 'READ_ONLY');
    T.eq('READ_ONLY: nothing sent', r.f.log.length, 0);
  }

  T.section('Rate schedules: remove a line, delete a schedule');
  {
    const f = fake();
    const v = { lines: LINES_R.slice(), ask: null };
    const C = chain('rates', 'removeLineChain', f.Actions);
    await new C().run(ctx(RATES, v), { key: 'id:2' });
    T.check('asks first, saying the delete is immediate', /deleted from the schedule now/.test(v.ask.message) && f.rest().length === 0);
    await new C().run(ctx(RATES, v), { key: 'id:2', confirmed: true });
    T.eq('a saved line: DELETE at once', JSON.stringify(f.rest()[0]), '{"rest":"eqp-v1/deleteRatePeriodLine","uriParams":{"id":2}}');
    T.eq('... and it leaves the grid', v.lines.length, 4);
  }
  {
    const f = fake(() => ({ ok: false, status: 500 }));
    const v = { lines: LINES_R.slice() };
    await new (chain('rates', 'removeLineChain', f.Actions))().run(ctx(RATES, v), { key: 'id:1', confirmed: true });
    T.check('DELETE fails: the line stays, said', v.lines.length === 5 && f.notes()[0].summary === 'Delete Error');
    const f2 = fake();
    const v2 = { lines: [L({ _key: 'new:9', period: 'DAILY' })] };
    await new (chain('rates', 'removeLineChain', f2.Actions))().run(ctx(RATES, v2), { key: 'new:9', confirmed: true });
    T.check('a line never saved: dropped, no call', v2.lines.length === 0 && f2.rest().length === 0);
  }
  {
    const f = fake((o) => (o.endpoint === 'eqp-v1/deleteRateSchedule' ? { ok: true } : null));
    const v = { selectedId: '9', formData: { scheduleName: 'X' }, lines: [], schedules: [] };
    const C = chain('rates', 'deleteScheduleChain', f.Actions);
    await new C().run(ctx(RATES, v, FULL('EQR_RATE_SCHEDULE')), {});
    T.check('delete asks first', v.ask.kind === 'deleteSchedule' && f.rest().length === 0);
    await new C().run(ctx(RATES, v, FULL('EQR_RATE_SCHEDULE')), { confirmed: true });
    T.check('confirmed: DELETE, list read again', f.seq() === 'eqp-v1/deleteRateSchedule' && f.log.some((x) => x.chain === 'loadSchedulesChain') && v.selectedId === '');
  }
  {
    const f = fake();
    const v = { lines: LINES_R.slice(), dirty: false };
    await new (chain('rates', 'lineEditChain', f.Actions))().run(ctx(RATES, v), { key: 'id:2', field: 'periodAmount', value: '3500' });
    T.check('a typed total changes the line (not saved yet)', v.lines[1].costRate === 500 && v.dirty === true && f.log.length === 0);
    await new (chain('rates', 'addLineChain', f.Actions))().run(ctx(RATES, v), { groupKey: RATES.groupKey(LINES_R[0]), period: 'YEARLY' });
    T.check('+ adds a Yearly line to the row', v.lines.some((l) => l._key && l.period === 'YEARLY' && l.threshold === 365));
    const before = v.lines.length;
    await new (chain('rates', 'addLineChain', f.Actions))().run(ctx(RATES, v), { groupKey: RATES.groupKey(LINES_R[0]), period: 'HOURLY' });
    T.eq('+ for a period the row cannot carry does nothing', v.lines.length, before);
  }
  {
    const f = fake((o) => (o.endpoint === 'eqp-v1/getRateScheduleById' ? { ok: true, body: { id: 9, scheduleName: 'S', projectRefId: 300, isActiveFlag: 'Y', effectiveFrom: '2026-01-01T00:00:00Z', yardOrgId: 5 } }
      : o.endpoint === 'eqp-v1/getRatePeriodLines' ? { ok: true, body: { data: [{ id: 1, rateScheduleId: 9, periodType: 'WEEKLY', fromUnit: 5, costRate: 500, billRate: 0, rateAmount: 700 },
        { id: 2, rateScheduleId: 10, periodType: 'DAILY' }] } }
      : o.endpoint === 'ProjectLOV/getFscmRestApiResources11_13_18_05ProjectsLOV' ? { ok: true, body: { items: [{ ProjectName: 'Pipeline North' }] } } : null));
    const v = { dirty: false, formData: {} };
    await new (chain('rates', 'selectScheduleChain', f.Actions))().run(ctx(RATES, v), { id: '9' });
    T.eq('open: header, project name, lines (only this schedule), then yards', f.seq() + ' | ' + f.log.filter((x) => x.chain).map((x) => x.chain).join(),
      'eqp-v1/getRateScheduleById > ProjectLOV/getFscmRestApiResources11_13_18_05ProjectsLOV > eqp-v1/getRatePeriodLines | loadYardsChain');
    T.eq('mapped as the old editor (bill falls back to rateAmount, basis DAILY)', [v.lines.length, v.lines[0].billRate, v.lines[0].calcBasis, v.formData.projectName, v.formData.activeStatus].join('|'), '1|700|DAILY|Pipeline North|true');
    const v2 = { dirty: true, formData: { scheduleName: 'S' } };
    await new (chain('rates', 'selectScheduleChain', f.Actions))().run(ctx(RATES, v2), { id: '10' });
    T.check('unsaved changes: asks before leaving the schedule', v2.ask && v2.ask.kind === 'select' && v2.ask.target === 10);
  }

  // ═══ Rental agreements ════════════════════════════════════════════════════
  T.section('Rental agreements: the list');
  const AG = [{ agreementNumber: 'RNT-0002', agreementName: 'Lone Star MSA', customer: 'Lone Star Paving', statusCode: 'ACTIVE', endDate: '2026-12-15' },
    { agreementNumber: 'RNT-0001', agreementName: 'Old deal', customer: 'Acme', statusCode: 'EXPIRED', endDate: '2025-01-01' },
    { agreementNumber: 'ST-0001', agreementName: 'Short', customer: 'Acme', statusCode: 'DRAFT', endDate: '2027-01-01' }];
  T.eq('chips: statuses present, in lifecycle order, plus ending soon', AGR.chips(AG, '2026-10-29').map((c) => c.key + ':' + c.count).join(','), 'all:3,DRAFT:1,ACTIVE:1,EXPIRED:1,expiring:1');
  T.eq('search over number, name, customer, type', AGR.filterRows(AG, 'acme', 'all').map((r) => r.agreementNumber).join(), 'RNT-0001,ST-0001');
  T.eq('ending soon chip', AGR.filterRows(AG, '', 'expiring', '2026-10-29').map((r) => r.agreementNumber).join(), 'RNT-0002');
  T.eq('expiry text', AGR.expiryText(AG[0], '2026-10-29'), 'Ends in 47 days');
  T.eq('the old edit rule', ['ACTIVE', 'REJECTED', 'EXPIRED', 'DRAFT', 'PENDING'].map((s) => AGR.canEdit(s) ? 1 : 0).join(''), '00011');

  T.section('Agreement lines: approve, reject, request');
  const LN = [{ compositeKey: 'A:1', line_no: 1, equipment_name: 'CAT 320', class_name: 'Excavators', subClassName: 'Crawler', bill_rate: 1100, price_uom: 'DAY' },
    { compositeKey: 'A:2', line_no: 2, equipment_name: 'Any in class', class_name: 'Rollers', bill_rate: 720, price_uom: 'DAY', description: 'Vibratory roller' },
    { compositeKey: 'A:3', line_no: 3, equipment_name: 'No id', class_name: 'Pumps' }];
  const IDMAP = { 'A:1': { agreementLineId: 11, equipmentMasterId: 101, equipmentClassId: 1, unitPrice: 1050, priceUom: 'DAY' },
    'A:2': { agreementLineId: 12, equipmentMasterId: null, equipmentClassId: 4, unitPrice: null, priceUom: null } };
  T.eq('search: every word must appear (the old rule)', LINES.filterLines(LN, 'roller vibratory').map((l) => l.line_no).join(), '2');
  T.eq('a line without an agreement line id cannot be ticked', Object.keys(LINES.toggle({}, 'A:3', true, IDMAP)).length, 0);
  T.eq('tick the shown lines', Object.keys(LINES.toggleShown({}, LN, '', true, IDMAP)).join(), 'A:1,A:2');
  T.eq('request preview', LINES.requestPreview({ 'A:1': true, 'A:2': true }, LN, IDMAP),
    '2 lines go to New request at this agreement\'s rates. 1 line names only a class: it takes the first equipment of that class. You add the project, dates and delivery there.');
  {
    const f = fake();
    const v = { agreementHeaderId: 31, agreementNumber: 'RNT-0002', linesArray: [] };
    await new (chain('agreement-lines', 'approveAgreementChain', f.Actions))().run(ctx(LINES, v, FULL('EQR_RENTAL_AGREEMENTS')));
    T.check('no lines: approval refused, nothing sent', f.rest().length === 0 && /no equipment lines/.test(f.notes()[0].message));
    v.linesArray = LN;
    await new (chain('agreement-lines', 'approveAgreementChain', f.Actions))().run(ctx(LINES, v, FULL('EQR_RENTAL_AGREEMENTS')));
    T.eq('approve: PATCH status ACTIVE, back to the list', JSON.stringify([f.rest()[0], f.log[f.log.length - 1].nav]),
      '[{"rest":"eqp-v1/patchAgreementHeader","uriParams":{"id":31},"body":{"status":"ACTIVE"}},"agreements"]');
    const f2 = fake(() => ({ ok: false, status: 400, body: { message: 'bad' } }));
    await new (chain('agreement-lines', 'approveAgreementChain', f2.Actions))().run(ctx(LINES, v, FULL('EQR_RENTAL_AGREEMENTS')));
    T.check('approve fails: said, stays', f2.notes()[0].summary === 'Approve Failed' && !f2.log.some((x) => x.nav));
    const f3 = fake();
    await new (chain('agreement-lines', 'approveAgreementChain', f3.Actions))().run(ctx(LINES, v, { EQR_RENTAL_AGREEMENTS: 'READ_ONLY' }));
    T.eq('approve: READ_ONLY sends nothing', f3.log.length, 0);
  }
  {
    const f = fake();
    const v = { agreementHeaderId: 31, agreementNumber: 'RNT-0002' };
    const C = chain('agreement-lines', 'rejectAgreementChain', f.Actions);
    await new C().run(ctx(LINES, v, FULL('EQR_RENTAL_AGREEMENTS')), {});
    T.check('reject asks first', v.ask.kind === 'reject' && f.rest().length === 0);
    await new C().run(ctx(LINES, v, FULL('EQR_RENTAL_AGREEMENTS')), { confirmed: true });
    T.eq('confirmed: PATCH status REJECTED', JSON.stringify(f.rest()[0].body), '{"status":"REJECTED"}');
  }
  {
    const saved = {};
    let cleared = 0;
    const draftStorage = { clear: () => { cleared++; Object.keys(saved).forEach((k) => delete saved[k]); }, save: (k, val) => { saved[k] = val; } };
    let flag = null;
    const f = fake((o) => (o.endpoint === 'eqp-v1/getEquipriteV1EquipmentMaster' ? { ok: true, body: { data: [{ id: 101, equipmentName: 'taken' }, { id: 140, equipmentName: 'Roller CB2' }] } } : null));
    const v = { agreementStatus: 'ACTIVE', agreementHeaderId: 31, agreementNumber: 'RNT-0002', customerName: 'Lone Star', customerRefId: null, fusionCustomerId: 900,
      effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31', agreementNotes: 'Min 1 week', linesArray: LN, agreementLineIdByCompositeKey: IDMAP,
      selected: { 'A:1': true, 'A:2': true, 'A:3': true }, busy: false };
    const C = chain('agreement-lines', 'createRequestChain', f.Actions, { 'resources/js/draftStorage': draftStorage },
      { sessionStorage: { setItem: (k, val) => { flag = k + '=' + val; } } });
    const c = ctx(LINES, v, FULL('EQR_RENTAL_AGREEMENTS'));
    c.$application.currentPage = { id: 'agreement-lines' };
    await new C().run(c);
    T.eq('class-only line: first equipment of its class not already taken', JSON.stringify(f.rest()[0].uriParams), '{"equipmentClassId":4,"size":5}');
    T.eq('cart: the agreement rate (unitPrice, else bill rate), one item per equipment',
      saved.CartItemsArray.map((i) => i.id + ':' + i.billingRate + '/' + i.billingUnit).join(','), '101:1050/DAY,140:720/DAY');
    T.eq('the old hand-over keys', Object.keys(saved).sort().join(','), 'CartItemsArray,agreementLineIdByEquipmentId,agreementRateByEquipmentId,fromAgreementCustomer,fromAgreementCustomerRefId,'
      + 'fromAgreementEffectiveFrom,fromAgreementEffectiveTo,fromAgreementFusionCustomerId,fromAgreementId,fromAgreementNotes,fromAgreementNumber,requestOrigin');
    T.eq('line ids by equipment, origin, agreement id', JSON.stringify([saved.agreementLineIdByEquipmentId, saved.requestOrigin, saved.fromAgreementId]), '[{"101":11,"140":12},"agreement",31]');
    T.check('the draft store was cleared first and the tab flag set', cleared === 1 && flag === 'eqr.agreement.active=1');
    T.eq('then New request opens', JSON.stringify(f.log[f.log.length - 1]), '{"flow":"request","nav":"new-request","params":{},"target":"parent"}');
  }
  {
    const f = fake();
    const v = { agreementStatus: 'DRAFT', linesArray: LN, selected: { 'A:1': true } };
    await new (chain('agreement-lines', 'createRequestChain', f.Actions, { 'resources/js/draftStorage': { clear() {}, save() {} } }))().run(ctx(LINES, v));
    T.eq('not ACTIVE: nothing happens', f.log.length, 0);
  }

  T.section('Agreement edit: Save (the old chain, body for body)');
  T.eq('every missing field at once', EDIT.missingFields({ agreementName: ' ', customerId: 5 }).join(','), 'Agreement Name,Agreement Type,Start Date,End Date');
  T.eq('a line needs a class and a rate above 0', [EDIT.lineProblem({}, []), EDIT.lineProblem({ classId: 1, unitPrice: 0 }, [])].join('|'),
    'Please select an Equipment Class before adding a line.|Rate must be greater than 0.');
  T.check('the same equipment twice is refused', /cannot be added twice/.test(EDIT.lineProblem({ classId: 1, unitPrice: 5, equipmentMasterId: 7 }, [{ equipmentMasterId: 7 }])));
  T.eq('next line number: max + 1 (gaps allowed)', EDIT.nextLineNumber([{ lineNumber: 2 }, { lineNumber: 5 }]), 6);
  T.eq('save preview (edit)', EDIT.saveText(true, [{ lineId: 1 }, {}], [9]), 'Save updates the header, removes 1 line, updates 1 line, adds 1 line.');
  const AFORM = { agreementName: 'Lone Star MSA', agreementType: 'RENTAL', customerId: 900, startDate: '2026-01-01', endDate: '2026-12-31', currencyCode: 'USD', notes: 'Min 1 week' };
  {
    const f = fake((o) => (o.endpoint === 'eqp-v1/updateAgreementHeader' ? { ok: true, body: { agreementNumber: 'RNT-0002' } } : null));
    const v = { agreementId: '31', formData: AFORM, loadedHeader: { agreementNumber: 'RNT-0002', status: 'DRAFT', objectVersionNumber: 4, projectRefId: null, equipmentClassId: 2 },
      deletedLineIds: [77], equipmentLines: [{ lineId: 11, lineNumber: 1, equipmentClassId: 1, equipmentMasterId: 101, description: '', unitPrice: 1050, priceUom: 'DAY' },
        { lineNumber: 3, equipmentClassId: 4, equipmentMasterId: null, description: 'Roller', unitPrice: 720, priceUom: 'WEEK' }], saving: false, dirty: true };
    await new (chain('agreement-edit', 'saveAgreementChain', f.Actions))().run(ctx(EDIT, v, FULL('EQR_RENTAL_AGREEMENTS')));
    T.eq('edit order: PUT header, DELETE removed, PATCH kept, POST new', f.seq(), 'eqp-v1/updateAgreementHeader > eqp-v1/deleteAgreementLine > eqp-v1/patchAgreementLine > eqp-v1/createAgreementLine');
    T.eq('PUT: the full DTO from the loaded header', JSON.stringify(f.rest()[0].body), JSON.stringify({ id: 31, agreementNumber: 'RNT-0002', agreementName: 'Lone Star MSA',
      customerRefId: null, fusionCustomerId: 900, projectRefId: null, equipmentClassId: 2, agreementType: 'RENTAL', status: 'DRAFT', effectiveFrom: '2026-01-01T00:00:00Z',
      effectiveTo: '2026-12-31T00:00:00Z', currencyCode: 'USD', notes: 'Min 1 week', objectVersionNumber: 4 }));
    T.eq('DELETE the removed line', JSON.stringify(f.rest()[1].uriParams), '{"id":77}');
    T.eq('PATCH body', JSON.stringify(f.rest()[2].body), '{"equipmentClassId":1,"equipmentMasterId":101,"description":"","unitPrice":1050,"priceUom":"DAY"}');
    T.eq('POST body: quantity defaults to 1', JSON.stringify(f.rest()[3].body), '{"agreementHeaderId":31,"lineNumber":3,"equipmentClassId":4,"equipmentMasterId":null,"description":"Roller","unitPrice":720,"priceUom":"WEEK","quantity":1}');
    T.check('then the agreement\'s lines open', f.log[f.log.length - 1].nav === 'agreement-lines' && f.log[f.log.length - 1].params.agreementNumber === 'RNT-0002' && v.dirty === false);
  }
  {
    const f = fake((o) => {
      if (o.endpoint === 'eqp-v1/getConfAgreementTypes') return { ok: true, body: [{ typeCode: 'RENTAL', typePrefix: 'rnt' }] };
      if (o.endpoint === 'eqp-v1/getEquipriteV1ViewsRentalAgreements') return { ok: true, body: { data: [{ agreementNumber: 'RNT-0007' }, { agreementNumber: 'RNTX-0099' }, { agreementNumber: 'ST-0042' }] } };
      if (o.endpoint === 'eqp-v1/createAgreementHeader') return { ok: true, body: { id: 50 } };
      return null;
    });
    const v = { agreementId: '', formData: AFORM, equipmentLines: [{ lineNumber: 1, equipmentClassId: 4, unitPrice: 720, priceUom: 'DAY' }], saving: false };
    await new (chain('agreement-edit', 'saveAgreementChain', f.Actions))().run(ctx(EDIT, v, FULL('EQR_RENTAL_AGREEMENTS')));
    T.eq('create order: types, list, POST header, POST lines', f.seq(), 'eqp-v1/getConfAgreementTypes > eqp-v1/getEquipriteV1ViewsRentalAgreements > eqp-v1/createAgreementHeader > eqp-v1/createAgreementLine');
    T.eq('the number: the type\'s prefix, highest with that prefix + 1', f.rest()[2].body.agreementNumber, 'RNT-0008');
    T.eq('created as DRAFT with the Fusion customer', f.rest()[2].body.status + '|' + f.rest()[2].body.fusionCustomerId, 'DRAFT|900');
    T.eq('lines carry the new header id', f.rest()[3].body.agreementHeaderId, 50);
    T.eq('then its lines open', f.log[f.log.length - 1].params.agreementNumber, 'RNT-0008');
  }
  {
    const f = fake((o) => (o.endpoint === 'eqp-v1/createAgreementHeader' ? { ok: false, status: 500, body: null } : null));
    const v = { agreementId: '', formData: AFORM, equipmentLines: [{ lineNumber: 1, equipmentClassId: 4, unitPrice: 5 }] };
    await new (chain('agreement-edit', 'saveAgreementChain', f.Actions))().run(ctx(EDIT, v, FULL('EQR_RENTAL_AGREEMENTS')));
    T.check('header fails: no line is written, stays', !f.rest().some((x) => x.rest === 'eqp-v1/createAgreementLine') && f.notes()[0].summary === 'Save Failed' && !f.log.some((x) => x.nav));
  }
  {
    const f = fake();
    const v = { agreementId: '', formData: { agreementName: 'X' }, equipmentLines: [] };
    await new (chain('agreement-edit', 'saveAgreementChain', f.Actions))().run(ctx(EDIT, v, FULL('EQR_RENTAL_AGREEMENTS')));
    T.check('missing fields: nothing sent, listed on the page', f.rest().length === 0 && v.missing.join() === 'Agreement Type,Customer,Start Date,End Date');
    const v2 = { agreementId: '', formData: AFORM, equipmentLines: [] };
    await new (chain('agreement-edit', 'saveAgreementChain', f.Actions))().run(ctx(EDIT, v2, { EQR_RENTAL_AGREEMENTS: 'READ_ONLY' }));
    T.eq('READ_ONLY: nothing sent', f.rest().length, 0);
  }
  {
    const F = chain('agreement-edit', 'fieldChain', {});
    const v = { formData: { notes: 'Min 1 week' }, dirty: false, missing: [] };
    await new F().run(ctx(EDIT, v), { action: 'field', field: 'notes', value: 'Min 1 week', from: 'external' });
    T.check('the notes box echoing the loaded value is not a change', v.dirty === false);
    await new F().run(ctx(EDIT, v), { action: 'field', field: 'notes', value: 'Min 2 weeks', from: 'internal' });
    T.eq('typed notes are a change', v.formData.notes + '|' + v.dirty, 'Min 2 weeks|true');
  }
  {
    const f = fake();
    const v = { equipmentLines: [{ lineId: 11, lineNumber: 1 }, { lineNumber: 2 }], deletedLineIds: [], currentLine: { classId: 4, className: 'Rollers', unitPrice: 700, priceUom: 'WEEK' } };
    const C = chain('agreement-edit', 'lineDraftChain', f.Actions);
    await new C().run(ctx(EDIT, v), { action: 'add' });
    T.eq('add: max + 1, nothing sent', v.equipmentLines.map((l) => l.lineNumber).join() + '|' + f.rest().length, '1,2,3|0');
    await new C().run(ctx(EDIT, v), { action: 'remove', key: '1' });
    await new C().run(ctx(EDIT, v), { action: 'remove', key: '2' });
    T.eq('remove: a saved line is deleted on Save, a new one just dropped', JSON.stringify([v.deletedLineIds, v.equipmentLines.map((l) => l.lineNumber)]), '[[11],[3]]');
  }
  {
    const f = fake();
    const v = {};
    await new (chain('agreements', 'agreementsFlagGuardChain', f.Actions))().run(ctx(AGR, v, {}, { featureFlags: { PROJECTS_MODULE_ENABLED: 'true', AGREEMENTS_ENABLED: 'false' } }));
    T.check('agreements off: sent to the role\'s landing page with a notice', f.notes()[0].summary === 'Feature unavailable' && f.log.some((x) => x.nav));
    const f2 = fake();
    await new (chain('agreements', 'agreementsFlagGuardChain', f2.Actions))().run(ctx(AGR, v));
    T.eq('agreements on: stays', f2.log.length, 0);
  }

  // ═══ menu, pages, endpoints ═══════════════════════════════════════════════
  T.section('menu and pages');
  const items = [].concat(...app.visibleNavGroups(Object.fromEntries(['EQR_EQUIPMENT_MASTER', 'EQR_RATE_SCHEDULE', 'EQR_RENTAL_AGREEMENTS'].map((c) => [c, 'FULL'])), true,
    { AGREEMENTS_ENABLED: 'true', PROJECTS_MODULE_ENABLED: 'true' }, true, {}).map((g) => g.items)).filter((i) => ['equipment', 'rates', 'agreements'].includes(i.id));
  T.eq('Master data items are new, with their routes', items.map((i) => i.id + ':' + i.status + ':' + i.route.flow + '/' + i.route.page).join(','),
    'equipment:new:master/equipment,rates:new:master/rates,agreements:new:master/agreements');
  T.eq('detail pages belong to their item', ['equipment-detail', 'equipment-import', 'agreement-lines', 'agreement-edit'].map((p) => app.getNavIdForPage({ id: p })).join(),
    'equipment,equipment,agreements,agreements');
  T.eq('the old links are kept', ['equipment', 'rates', 'agreements'].map((id) => app.oldAppLink('http://x/', id).replace('http://x/vp/shell/', '')).join(),
    'equipment-foundation/equipment-master,main/rate-schedule,equipment-foundation/rental-agreements');
  const flow = H.readJson(path.join(NEW, 'flows', 'master', 'master-flow.json'));
  Object.keys(flow.pages).forEach((p) => {
    const j = H.readJson(path.join(PAGES, p + '-page.json'));
    T.check(p + ': vbBeforeEnter runs enforcePageAccessChain', j.eventListeners.vbBeforeEnter.chains.some((c) => c.chain === 'enforcePageAccessChain'));
    const html = fs.readFileSync(path.join(PAGES, p + '-page.html'), 'utf8');
    const used = new Set((html.match(/<(oj-[a-z0-9-]+)/g) || []).map((s) => s.slice(1)));
    T.check(p + ': every oj- component used is imported', [...used].every((c) => j.imports.components[c]), [...used].filter((c) => !j.imports.components[c]).join());
    T.check(p + ': no global String()/Number()/Boolean() or inline functions in bindings', !/\[\[[^\]]*\b(String|Number|Boolean)\(|\[\[[^\]]*function\s*\(/.test(html));
    T.check(p + ': no oj-bind-for-each inside a table or select', !/<(table|tbody|tr|select)[^>]*>[\s\S]*?oj-bind-for-each[\s\S]*?<\/\1>/.test(html));
    const listeners = new Set((html.match(/\$listeners\.([a-zA-Z]+)/g) || []).map((m) => m.split('.')[1]));
    T.check(p + ': every listener the page uses is declared', [...listeners].every((l) => j.eventListeners[l]), [...listeners].filter((l) => !j.eventListeners[l]).join());
    const chainDir = path.join(PAGES, p + '-page-chains');
    const chainSrc = fs.readdirSync(chainDir).map((f) => fs.readFileSync(path.join(chainDir, f), 'utf8')).join('\n');
    const named = new Set([...JSON.stringify(j).matchAll(/"chain":"([A-Za-z]+)"/g)].map((m) => m[1])
      .concat([...chainSrc.matchAll(/chain:\s*'([A-Za-z]+)'/g)].map((m) => m[1])));
    T.check(p + ': every chain it runs is in its chains folder', [...named].every((n) => fs.existsSync(path.join(chainDir, n + '.js'))),
      [...named].filter((n) => !fs.existsSync(path.join(chainDir, n + '.js'))).join());
    const M = loadAmd(path.join(PAGES, p + '-page.js'));
    const fns = new M();
    const called = new Set((html.match(/\$functions\.([a-zA-Z0-9]+)/g) || []).map((m) => m.split('.')[1]));
    fs.readdirSync(path.join(PAGES, p + '-page-chains')).forEach((f) => (fs.readFileSync(path.join(PAGES, p + '-page-chains', f), 'utf8')
      .match(/\$page\.functions\.([a-zA-Z0-9]+)|\bf\.([a-zA-Z0-9]+)\(/g) || []).forEach((m) => called.add(m.replace(/^\$page\.functions\.|^f\.|\($/g, ''))));
    T.check(p + ': every page function the html and chains call exists', [...called].every((fn) => typeof fns[fn] === 'function'), [...called].filter((fn) => typeof fns[fn] !== 'function').join());
  });

  T.section('every endpoint the master chains call exists in services/');
  const ops = {};
  ['eqp-v1', 'ProjectLOV', 'ics', 'commonService'].forEach((svc) => {
    const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'services', svc, 'openapi3.json'), 'utf8'));
    Object.values(spec.paths || {}).forEach((p) => Object.values(p).forEach((op) => { if (op && op.operationId) ops[svc + '/' + op.operationId] = true; }));
  });
  const used = new Set();
  const scan = (src) => (src.match(/endpoint:\s*'([^']+)'/g) || []).concat(src.match(/'eqp-v1\/[A-Za-z0-9_]+'/g) || [])
    .forEach((m) => used.add(m.replace(/endpoint:\s*'/, '').replace(/'/g, '')));
  Object.keys(flow.pages).forEach((p) => fs.readdirSync(path.join(PAGES, p + '-page-chains'))
    .forEach((f) => scan(fs.readFileSync(path.join(PAGES, p + '-page-chains', f), 'utf8'))));
  ['fetchAllPages', 'expenditureTypes', 'maintenanceWorkOrders'].forEach((f) => scan(fs.readFileSync(path.join(JS, f + '.js'), 'utf8')));
  [...used].sort().forEach((e) => T.check(e, !!ops[e]));

  T.report();
})().catch((e) => { console.error(e); process.exitCode = 1; });
