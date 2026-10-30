/*
 * EquipRite Next, Equipment master (webApps/equiprite-next/flows/equipment, resources/js/equipmentMaster.js and
 * equipmentImport.js). Loads the real modules and chains (AMD, in a sandbox) with a fake Actions and checks:
 *   - what is carried over from New EquipRite is still New's: the helpers and the chains copied byte for byte, the page
 *     functions character for character, and the chains adapted for Next (toasts instead of VB notices, the list on the
 *     same screen) make exactly New's calls, in New's order, given the same answers;
 *   - Next's own logic: search (the list's words and the server's q), class chips and filters with their counts, sort,
 *     the summary, the map, export columns, an item's units, certificates and work orders in words;
 *   - the menu item is built, the record kind opens an item's tab, and ?open=equipment still opens the catalog;
 *   - the chains that write: guards, bodies, order, and what a person is told;
 *   - every endpoint the chains call exists in services/.
 *
 * Run:  node tests/next-equipment.test.js
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
const PAGES = path.join(NEXT, 'flows', 'equipment', 'pages');
const NEW_PAGES = path.join(NEW, 'flows', 'master', 'pages');

// Timers in the sandbox never keep the process alive (importInitChain races a 20 s timeout).
const timer = (f, ms) => { const t = setTimeout(f, ms); if (t.unref) t.unref(); return t; };

function loadAmd(file, deps, globals) {
  const sandbox = Object.assign({
    console: { log() {}, warn() {}, error() {}, info() {} }, setTimeout: timer, Promise, Date, JSON, Math, Number, String, URLSearchParams, Intl, TextEncoder,
    window: { confirm: () => true, open: () => null, addEventListener() {}, removeEventListener() {} },
  }, globals || {});
  let mod;
  sandbox.define = (names, factory) => { mod = factory(...names.map((n) => (deps && n in deps ? deps[n] : {}))); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: path.basename(file) });
  return mod;
}
const js = (name, deps) => loadAmd(path.join(JS, name + '.js'), deps);

const rules = js('rules');
const nav = js('nav', { 'resources/js/rules': rules });
const tabs = js('tabs', { 'resources/js/nav': nav });
const fmt = js('fmt');
const exportKit = js('exportKit');
const em = js('equipmentMaster');
const EquipmentImport = js('equipmentImport');
const paging = js('fetchAllPages');
const expenditureTypes = js('expenditureTypes');
const maintenanceWorkOrders = js('maintenanceWorkOrders');
const equipmentAttachments = js('equipmentAttachments');
const AppModule = loadAmd(path.join(NEXT, 'app-flow.js'), { 'resources/js/rules': rules, 'resources/js/nav': nav, 'resources/js/fmt': fmt });
const app = new AppModule();

const shellBus = loadAmd(path.join(NEXT, 'resources', 'js', 'shellBus.js'));
const EqPage = loadAmd(path.join(PAGES, 'equipment-page.js'), { 'resources/js/equipmentImport': EquipmentImport, 'resources/js/equipmentMaster': em, 'resources/js/exportKit': exportKit, 'resources/js/shellBus': shellBus });
const ItemPage = loadAmd(path.join(PAGES, 'item-page.js'), { 'resources/js/equipmentMaster': em, 'resources/js/exportKit': exportKit, 'resources/js/fmt': fmt });
const NewList = loadAmd(path.join(NEW_PAGES, 'equipment-page.js'));
const NewImport = loadAmd(path.join(NEW_PAGES, 'equipment-import-page.js'));
const NewDetail = loadAmd(path.join(NEW_PAGES, 'equipment-detail-page.js'));

/** A fake shell bus that records what a screen asked. */
function fakeBus() {
  const log = [];
  return { log, open: (r) => log.push(Object.assign({ action: 'open' }, r)), rename: (id, title) => log.push({ action: 'rename', id, title }),
    toast: (message, tone) => log.push({ action: 'toast', message, tone: tone || 'info' }), close: (id) => log.push({ action: 'close', id }) };
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
  };
  const rest = () => log.filter((x) => x.rest);
  return { log, Actions, rest, seq: () => rest().map((x) => x.rest).join(' > '), chains: () => log.filter((x) => x.chain).map((x) => x.chain) };
}

/** A chain from a page's chains folder, with the real helper modules, a fake Actions and a fake bus. */
function chainOf(dir, name, Actions, bus, globals) {
  return loadAmd(path.join(dir, name + '.js'), {
    'vb/action/actionChain': class {},
    'vb/action/actions': Actions,
    'resources/js/fetchAllPages': paging,
    'resources/js/expenditureTypes': expenditureTypes,
    'resources/js/maintenanceWorkOrders': maintenanceWorkOrders,
    'resources/js/equipmentAttachments': equipmentAttachments,
    'resources/js/equipmentMaster': em,
    'resources/js/exportKit': exportKit,
    'resources/js/shellBus': bus || fakeBus(),
  }, globals);
}
const LIST = path.join(PAGES, 'equipment-page-chains');
const ITEM = path.join(PAGES, 'item-page-chains');
const run = async (dir, name, Actions, ctx, params, bus, globals) => { const C = chainOf(dir, name, Actions, bus, globals); return new C().run(ctx, params || {}); };

function ctx(pageFns, vars, access) {
  return {
    $application: { functions: app, variables: { pageAccessMap: access || { EQR_EQUIPMENT_MASTER: 'FULL' }, pageAccessLoaded: true, appUrls: {} } },
    $page: { functions: pageFns, variables: vars },
  };
}

const CLASSES = { 1: 'Excavators', 2: 'Generators', 4: 'Rollers' };
const SUBS = { 11: 'Crawler', 12: 'Mini', 41: 'Vibratory' };
const LOCS = [{ id: 501, locationName: 'Houston Yard', latitude: 29.76, longitude: -95.37 }, { id: 502, locationName: 'Dallas Yard', latitude: 32.78, longitude: -96.8 }];
const ROWS = [
  { id: 101, equipmentNumber: 'EQ-2201', equipmentName: 'CAT 320 Excavator', equipmentClassId: 1, equipmentSubclassId: 11, catalogStatus: 'ACTIVE', createdBy: 'FUSION_IMPORT',
    isSerialControlled: 'Y', serialUnitCount: 3, currentLocationId: 501, manufacturer: 'Caterpillar', modelNumber: '320 GC', equipmentType: 'COMPANY_OWNED' },
  { id: 102, equipmentNumber: 'EQ-2202', equipmentName: 'Komatsu PC210', equipmentClassId: 1, equipmentSubclassId: 11, catalogStatus: 'ACTIVE', createdBy: 'admin',
    isSerialControlled: 'Y', serialUnitCount: 1, currentLocationId: 502 },
  { id: 103, equipmentNumber: 'EQ-3101', equipmentName: 'Generator 60 kVA', equipmentClassId: 2, catalogStatus: 'INACTIVE', createdBy: 'FUSION_IMPORT',
    isLotControlled: 'Y', onHandQty: 4, currentLocationId: 501 },
  { id: 104, equipmentNumber: 'EQ-4001', equipmentName: 'Vibratory roller CB2', equipmentClassId: 4, equipmentSubclassId: 41, catalogStatus: 'ACTIVE', createdBy: 'FUSION_IMPORT',
    isSerialControlled: 'Y', serialUnitCount: 2 },
  { id: 105, equipmentNumber: 'EQ-5001', equipmentName: 'Light tower', catalogStatus: 'ACTIVE', createdBy: 'admin' },
];
const REF = { classesById: CLASSES, subclassesById: SUBS, locationsById: em.locationIndex(LOCS) };

(async () => {
  // ═══ carried over from New ════════════════════════════════════════════════════════════════════════════════════
  T.section('copied from New EquipRite, byte for byte');
  const same = (a, b) => fs.readFileSync(a, 'utf8') === fs.readFileSync(b, 'utf8');
  ['fetchAllPages', 'equipmentAttachments', 'expenditureTypes', 'maintenanceWorkOrders'].forEach((f) =>
    T.check('resources/js/' + f + '.js', same(path.join(JS, f + '.js'), path.join(NEW, 'resources', 'js', f + '.js'))));
  [['equipment-page-chains', ['ImportUnitsFromFusionChain', 'RunInProgressChain', 'ReleaseSyncLockChain']],
    ['equipment-import-page-chains', ['LoadStagingChain', 'LoadUnmatchedValuesChain', 'ClearImportWarningChain', 'RefreshStagingChain', 'StagingPageChangeChain',
      'setStagingFilterChain', 'tickChain', 'classEditChain']]].forEach(([dir, names]) => names.forEach((n) =>
    T.check('equipment-page-chains/' + n + ' is New\'s ' + dir + '/' + n, same(path.join(LIST, n + '.js'), path.join(NEW_PAGES, dir, n + '.js')))));
  ['loadAttachmentsChain', 'loadEquipExpTypesChain', 'loadWorkOrdersChain', 'openChangeClassChain', 'classPickChain', 'unitFilterChain'].forEach((n) =>
    T.check('item-page-chains/' + n + ' is New\'s equipment-detail-page-chains/' + n, same(path.join(ITEM, n + '.js'), path.join(NEW_PAGES, 'equipment-detail-page-chains', n + '.js'))));

  T.section('page functions: New\'s, character for character');
  const src = (C, n) => C.prototype[n] && C.prototype[n].toString();
  const importNames = Object.getOwnPropertyNames(EquipmentImport.prototype).filter((n) => n !== 'constructor' && n !== 'syncSummary' && n !== 'syncLabel');
  T.eq('every function of New\'s import page module is here', Object.getOwnPropertyNames(NewImport.prototype).filter((n) => n !== 'constructor' && !importNames.includes(n)).join(), '');
  T.eq('and unchanged', importNames.filter((n) => src(EquipmentImport, n) !== src(NewImport, n)).join(), '');
  T.check('its constructor (the row-key map) too', EquipmentImport.toString().includes(NewImport.toString().match(/constructor\(\) \{[\s\S]*?\n {4}\}/)[0]));
  T.eq('syncSummary and syncLabel: New\'s Equipment page\'s', ['syncSummary', 'syncLabel'].filter((n) => src(EquipmentImport, n) !== src(NewList, n)).join(), '');
  const DETAIL = ['formatNumber', 'yesNo', 'subclassOptionsFor', 'isEndDated', 'canSaveClass', 'filterAttachments', 'attExpiredCount', 'controlTypeOf', 'controlLabel',
    'unitId', 'unitStatus', 'unitWhere', 'unitDates', 'filterUnits', 'unitQty', 'makerModel', 'trackedIn', 'classText', 'classChangeText', 'woStatus',
    'isOpenWorkOrder', 'workOrderRows', 'assetNumbers', 'autoWorkOrderAssets', 'certSummary', 'expTypeText', 'oldUnitLink', 'oldUnitsLink'];
  T.eq('the item\'s: New\'s Equipment detail\'s', DETAIL.filter((n) => src(ItemPage, n) !== src(NewDetail, n)).join(), '');
  const item = new ItemPage();
  T.eq('formatDate is Next\'s (8 Oct 2026), so unit dates read like every Next screen', item.unitDates({ inServiceDate: '2024-03-01', retiredDate: '2026-10-08' }, 'SERIAL'),
    'In service 1 Mar 2024, retired 8 Oct 2026');
  const page = new EqPage();
  const imp = new NewImport();
  const vars0 = { stagingArray: [{ fusionInventoryItemId: 9, importStatus: 'AUTO_MAPPED', resolvedClassId: 1, resolvedSubclassId: 11 },
    { fusionInventoryItemId: 10, importStatus: 'MERGED', resolvedClassId: 2 }], subclassOptionsArray: [{ value: 11, classId: 1 }, { value: 12, classId: 1 }],
  stagingSelectedRows: {}, stagingChangedRows: {} };
  page.indexRows(vars0.stagingArray, vars0);
  imp.indexRows(vars0.stagingArray, vars0);
  T.eq('the same answers: a class change keeps a subclass of that class', JSON.stringify(page.applyEdit(0, 6, 1, vars0)), JSON.stringify(imp.applyEdit(0, 6, 1, vars0)));
  T.eq('a merged row cannot be ticked', [page.canSelect(1, vars0), imp.canSelect(1, vars0)].join(), 'false,false');

  T.section('chains adapted for Next make New\'s calls, in New\'s order');
  const compare = async (label, mine, theirs, respond, chains, vars, pageMine, pageNew, globals) => {
    const a = fake(respond, chains);
    const b = fake(respond, chains);
    await run(mine[0], mine[1], a.Actions, ctx(pageMine || page, Object.assign({}, vars)), mine[2], fakeBus(), globals).catch(() => null);
    await run(theirs[0], theirs[1], b.Actions, ctx(pageNew || new NewList(), Object.assign({}, vars)), theirs[2], fakeBus(), globals).catch(() => null);
    const norm = (f) => JSON.stringify(f.rest().map((x) => [x.rest, x.uriParams, x.body]).map((x) => JSON.stringify(x).replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g, 'T')));
    T.eq(label, norm(a), norm(b));
    if (!a.rest().length) T.check(label + ': calls were made', false);
    return { a, b };
  };
  const ICS_OK = (o) => (o.endpoint === 'ics/runFusionTableSync' ? { ok: true, body: { statusCode: 'SUCCESS', rowsMerged: '3', hasMoreData: 'N' } } : null);
  const syncAnswers = (o) => ICS_OK(o) || (o.endpoint === 'eqp-v1/refreshFusionSyncUnits' ? { ok: true, body: { itemsChanged: 1, serials: 2, itemsHeld: 1 } } : null)
    || (o.endpoint === 'eqp-v1/getFusionSyncExceptions' ? { ok: true, body: [{ equipmentNumber: 'EQ-9' }] } : null);
  const syncChains = (c) => (c.chain === 'RunInProgressChain' ? { running: false } : (c.chain === 'ImportUnitsFromFusionChain' ? { ok: true } : { ok: true }));
  const NEW_EQ = path.join(NEW_PAGES, 'equipment-page-chains');
  const NEW_IMP = path.join(NEW_PAGES, 'equipment-import-page-chains');
  const NEW_DET = path.join(NEW_PAGES, 'equipment-detail-page-chains');
  await compare('Sync from Fusion', [LIST, 'SyncFromFusionChain', { confirmed: true }], [NEW_EQ, 'SyncFromFusionChain', { confirmed: true }], syncAnswers, syncChains, {});
  await compare('Sync from Fusion, the item step failing', [LIST, 'SyncFromFusionChain', { confirmed: true }], [NEW_EQ, 'SyncFromFusionChain', { confirmed: true }],
    (o) => (o.endpoint === 'ics/runFusionTableSync' ? { ok: true, body: { statusCode: 'ERROR', statusMsg: 'ORA-1' } } : null), syncChains, {});
  const stagingVars = () => ({ stagingArray: [{ fusionInventoryItemId: 9, importStatus: 'AUTO_MAPPED', resolvedClassId: 1, resolvedSubclassId: 11 },
    { fusionInventoryItemId: 10, importStatus: 'UNMAPPED', resolvedClassId: null }], stagingSelectedRows: { 9: true, 10: true }, stagingChangedRows: {},
  stagingTotalElements: 2, importDialogOpen: true });
  const pImp = () => { const p = new EqPage(); p.indexRows(stagingVars().stagingArray, stagingVars()); return p; };
  const nImp = () => { const p = new NewImport(); p.indexRows(stagingVars().stagingArray, stagingVars()); return p; };
  const promote = (o) => (o.endpoint === 'eqp-v1/patchEquipmentImportStagingAssignments' ? { ok: true, body: { updated: 1, failed: [] } }
    : (o.endpoint === 'eqp-v1/promoteEquipmentImport' ? { ok: true, body: { promoted: 1 } } : null));
  await compare('Import the ticked rows', [LIST, 'SaveStagingClassesChain'], [NEW_IMP, 'SaveStagingClassesChain'], promote, null, stagingVars(), pImp(), nImp());
  await compare('Clear fetch, confirmed', [LIST, 'ClearStagingChain', { confirmed: true }], [NEW_IMP, 'ClearStagingChain', { confirmed: true }],
    () => ({ ok: true, body: { deleted: 2, keptMapped: 1 } }), null, stagingVars(), pImp(), nImp());
  await compare('Fetch, an item class picked', [LIST, 'ImportFromFusionChain'], [NEW_IMP, 'ImportFromFusionChain'],
    (o) => ICS_OK(o) || (o.endpoint === 'eqp-v1/promoteEquipmentImport' ? { ok: true, body: { promoted: 0, autoMapped: 2 } } : null),
    (c) => (c.chain === 'RunInProgressChain' ? { running: false } : { ok: true }), Object.assign(stagingVars(), { stagingSelectedRows: {}, selectedItemClass: 'HEAVY' }), pImp(), nImp());
  await compare('Fetch, classification failing', [LIST, 'ImportFromFusionChain'], [NEW_IMP, 'ImportFromFusionChain'],
    (o) => ICS_OK(o) || (o.endpoint === 'eqp-v1/promoteEquipmentImport' ? { ok: false, status: 500 } : null),
    (c) => (c.chain === 'RunInProgressChain' ? { running: false } : { ok: true }), Object.assign(stagingVars(), { stagingSelectedRows: {} }), pImp(), nImp());
  const master = { id: 101, equipmentNumber: 'EQ-2201', equipmentClassId: 1, equipmentSubclassId: 11, objectVersionNumber: 3 };
  const classVars = () => ({ masterRecord: Object.assign({}, master), equipmentId: '101', classDraft: { classId: 1, subclassId: 12 },
    classOptions: [{ value: 1, label: 'Excavators' }], subclassOptions: [{ value: 11, label: 'Crawler' }, { value: 12, label: 'Mini' }] });
  const readBack = (sub) => (o) => (o.endpoint === 'eqp-v1/getEquipriteV1EquipmentMasterById' ? { ok: true, body: Object.assign({}, master, { equipmentSubclassId: sub }) } : null);
  await compare('Change class', [ITEM, 'saveClassChangeChain'], [NEW_DET, 'saveClassChangeChain'], readBack(12), null, classVars(), item, new NewDetail());
  await compare('Change class, 409', [ITEM, 'saveClassChangeChain'], [NEW_DET, 'saveClassChangeChain'],
    (o) => (o.endpoint === 'eqp-v1/patchEquipment' ? { ok: false, status: 409 } : null), null, classVars(), item, new NewDetail());
  const docGlobals = { window: { open: () => ({ location: {}, close() {} }), confirm: () => true } };
  await compare('Open a document', [ITEM, 'openAttachmentChain', { id: '71' }], [NEW_DET, 'openAttachmentChain', { id: '71' }],
    () => ({ ok: true, body: { url: 'https://doc' } }), null, { attRows: [{ id: 71, commonDocId: 900 }] }, item, new NewDetail(), docGlobals);
  const detailAnswers = (o) => {
    if (o.endpoint === 'eqp-v1/getEquipriteV1EquipmentMasterById') return { ok: true, body: Object.assign({ isSerialControlled: 'Y', maintenanceAssetNumber: 'MA-1' }, master) };
    if (o.endpoint === 'eqp-v1/getSerialRefs') return { ok: true, body: { data: [{ id: 7, serialNumber: 'S1', currentLocationId: 501, invOrgId: 9 }, { id: 8, serialNumber: 'S2', currentLocationId: 502 }] } };
    if (o.endpoint === 'eqp-v1/getInvOrgs') return { ok: true, body: { data: [{ invOrgId: 9, organizationName: 'HOU' }] } };
    return { ok: true, body: { locationName: 'Yard', className: 'Excavators', subclassName: 'Crawler' } };
  };
  const det = await compare('Opening an item: New\'s detailInitChain, call for call', [ITEM, 'loadRecordChain'], [NEW_DET, 'detailInitChain'], detailAnswers, null,
    { id: '101', equipmentId: '101', number: 'EQ-2201', attLevel: 'HEADER' }, item, new NewDetail());
  T.eq('and the same chains after it', det.a.chains().join(), det.b.chains().join());
  const eqInit = async (dir, name, pageFns) => {
    const f = fake((o) => (o.endpoint === 'eqp-v1/getEquipmentImportStaging' ? { ok: true, body: { totalElements: 4 } } : null));
    const vars = { canWrite: true };
    await run(dir, name, f.Actions, ctx(pageFns, vars), { refresh: false });
    if (dir === LIST) await run(LIST, 'refreshListChain', f.Actions, ctx(pageFns, vars), { list: true });
    return f.rest().map((x) => x.rest + ' ' + JSON.stringify(x.uriParams || {})).sort().join('\n');
  };
  T.eq('Opening the catalog: New\'s equipmentInitChain\'s side reads (the list is loadListChain)', await eqInit(LIST, 'loadChain', page), await eqInit(NEW_EQ, 'equipmentInitChain', new NewList()));

  // ═══ Next's own ═══════════════════════════════════════════════════════════════════════════════════════════════
  T.section('the menu, the record kind, the links');
  T.eq('Equipment master is built: its tab opens the screen', JSON.stringify(nav.routeOf(nav.item('equipment'))), '{"flow":"equipment","page":"equipment","params":{}}');
  T.eq('an item opens in a tab of its own, titled by its number', JSON.stringify(tabs.forRecord('equipment-item', { id: 101, number: 'EQ-2201' })),
    '{"id":"equipment-item:101","flow":"equipment","page":"item","params":{"id":101,"number":"EQ-2201"},"title":"EQ-2201","icon":"oj-ux-ico-box-grid","navId":"equipment","pinned":false}');
  T.eq('?open=equipment opens the catalog, ?open=equipment-item&id= an item', [tabs.fromQuery('?open=equipment').id, tabs.fromQuery('?open=equipment-item&id=101').id].join(),
    'equipment,equipment-item:101');
  T.eq('an item\'s tab is gated by the catalog\'s page code', nav.itemVisible(nav.item(nav.RECORDS['equipment-item'].navId), { EQR_EQUIPMENT_MASTER: 'READ_ONLY' }, true, {}, true, {}), true);
  T.eq('this item in New', em.newItemUrl('http://n/', 101), 'http://n/vp/shell/master/equipment-detail?equipmentId=101');

  T.section('the list read at a glance');
  const items = em.decorate(ROWS, REF);
  const cat = items[0];
  T.eq('what an item is', [cat.title, cat.num, cat.clsText, cat.trackingLabel, cat.unitsText, cat.where, cat.statusLabel, cat.tone, cat.source, cat.type, cat.maker].join(' | '),
    'CAT 320 Excavator | EQ-2201 | Excavators · Crawler | Serial | 3 serials | Houston Yard | Active | ok | Fusion | Company-owned | Caterpillar 320 GC');
  T.eq('a lot item: on hand; no units, said so by the screen', [items[2].trackingLabel, items[2].unitsText, items[2].statusLabel, items[2].tone, items[4].unitsText, items[4].clsKey].join(' | '),
    'Lot | 4 on hand | Inactive | off |  | none');
  T.eq('the summary', em.summary(items, items, {}), '5 items · 6 serials · 4 on hand');
  T.eq('the summary, narrowed and loading', [em.summary(items, items.slice(0, 2), {}), em.summary([], [], { loading: true, loaded: 200, total: 412 }), em.summary([], [], { loading: true })].join(' | '),
    '2 of 5 items · 4 serials | Loading 200 of 412… | Loading the equipment…');
  T.eq('the job log\'s latest runs', em.fusionLine({ fetch: '2026-10-28T22:00:00Z', sync: '2026-10-29T06:15:00Z' }), 'Fetched from Fusion 28 Oct 2026 22:00 · synced 29 Oct 2026 06:15');
  T.eq('only a Sync on record', em.fusionLine({ sync: '2026-10-29T06:15:00Z' }), 'Synced from Fusion 29 Oct 2026 06:15');

  T.section('search: the list at once, the server for serials');
  const ids = (list) => list.map((x) => x.num).join();
  T.eq('number, any case', ids(em.search(items, 'eq-3101')), 'EQ-3101');
  T.eq('class name', ids(em.search(items, 'generators')), 'EQ-3101');
  T.eq('every word somewhere (location and maker)', ids(em.search(items, 'houston caterpillar')), 'EQ-2201');
  T.eq('type in words', ids(em.search(items, 'company-owned')), 'EQ-2201');
  T.eq('a serial: nothing on the list alone', ids(em.search(items, 'CAT0320A2')), '');
  const found = em.search(items, 'CAT0320A2', { q: 'CAT0320A2', ids: { 101: true } });
  T.eq('the server\'s answer joins, and says why', found.map((x) => x.num + ':' + x.why).join(), 'EQ-2201:server');
  T.eq('an answer for other text is ignored', ids(em.search(items, 'CAT0320A3', { q: 'CAT0320A2', ids: { 101: true } })), '');
  T.eq('a match on the list is not marked', em.search(items, 'cat', { q: 'cat', ids: { 101: true } }).map((x) => x.num + ':' + (x.why || '-')).join(), 'EQ-2201:-');
  T.eq('the server is asked from two characters', [em.serverQuery(' a '), em.serverQuery(' ab ')].join('|'), '|ab');
  T.eq('server rows not on the list join once', em.mergeRows([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }]).map((r) => r.id).join(), '1,2,3');

  T.section('chips and filters: each counts what it would show');
  let ch = em.chips(items, {}, REF);
  T.eq('classes, biggest first, no class last', ch.classes.map((c) => c.label + ' ' + c.count).join(', '), 'All classes 5, Excavators 2, Generators 1, Rollers 1, No class 1');
  T.eq('statuses, tracking, sources', [ch.statuses, ch.tracking, ch.sources].map((l) => l.map((c) => c.label + ' ' + c.count).join(', ')).join(' | '),
    'Any status 5, Active 4, Inactive 1 | Any tracking 5, Serial 3, Lot 1, Quantity 1 | Any source 5, From Fusion 3, Added in EquipRite 2');
  ch = em.chips(items, { classId: '1' }, REF);
  T.eq('a class shows its subclasses', ch.subclasses.map((c) => c.label + ' ' + c.count).join(', '), 'Any subclass 2, Crawler 2');
  T.eq('class chips ignore the class picked; the others count within it', [ch.classes[0].count, ch.statuses[0].count, ch.sources.map((c) => c.label + ' ' + c.count).join(', ')].join(' | '),
    '5 | 2 | Any source 2, From Fusion 1, Added in EquipRite 1');
  T.eq('a class with no subclasses shows none', em.chips(items, { classId: '2' }, REF).subclasses.length, 0);
  T.eq('a chip that is on stays, at 0 (its own row counts without it)', em.chips(items, { status: 'RETIRED' }, REF).statuses.map((c) => c.key + ':' + c.count).join(), ':5,ACTIVE:4,INACTIVE:1,RETIRED:0');
  T.eq('filters', [ids(em.filter(items, { classId: '1', source: 'Manual' })), ids(em.filter(items, { tracking: 'LOT' })), ids(em.filter(items, { classId: 'none' }))].join(' | '),
    'EQ-2202 | EQ-3101 | EQ-5001');
  T.eq('the map\'s location, and "no location on record"', [ids(em.filter(items, {}, '501')), ids(em.filter(items, {}, 'none'))].join(' | '), 'EQ-2201,EQ-3101 | EQ-4001,EQ-5001');
  const many = em.decorate(Array.from({ length: 14 }, (_, i) => ({ id: i + 1, equipmentNumber: 'X' + i, equipmentClassId: 100 + i, catalogStatus: 'ACTIVE' })),
    { classesById: Object.fromEntries(Array.from({ length: 14 }, (_, i) => [100 + i, 'C' + String(i).padStart(2, '0')])) });
  const manyRef = { classesById: Object.fromEntries(Array.from({ length: 14 }, (_, i) => [100 + i, 'C' + String(i).padStart(2, '0')])) };
  const few = em.chips(many, { classId: '113' }, manyRef);
  T.eq('ten classes and the one picked, the rest behind "more"', [few.classes.length, few.moreClasses, few.classes[few.classes.length - 1].label].join(), '12,3,C13');
  T.eq('all of them on request', em.chips(many, {}, {}, true).classes.length, 15);
  T.eq('filters on (the search aside)', em.filtersOn({ classId: '1', status: 'ACTIVE' }, '7'), 3);

  T.section('sort');
  T.eq('name, A to Z (default)', ids(em.sort(items, 'name', 'asc')), 'EQ-2201,EQ-3101,EQ-2202,EQ-5001,EQ-4001');
  T.eq('units, the most first', [em.firstDir('units'), ids(em.sort(items, 'units', 'desc'))].join(' '), 'desc EQ-3101,EQ-2201,EQ-4001,EQ-2202,EQ-5001');
  T.eq('location: none last, either way', [ids(em.sort(items, 'where', 'asc')), ids(em.sort(items, 'where', 'desc'))].join(' | '),
    'EQ-2202,EQ-2201,EQ-3101,EQ-5001,EQ-4001 | EQ-3101,EQ-2201,EQ-2202,EQ-4001,EQ-5001');
  T.eq('class: none last', ids(em.sort(items, 'class', 'asc')), 'EQ-2201,EQ-2202,EQ-3101,EQ-4001,EQ-5001');
  T.eq('number, natural order', ids(em.sort(em.decorate([{ id: 1, equipmentNumber: 'EQ-10' }, { id: 2, equipmentNumber: 'EQ-9' }]), 'number', 'asc')), 'EQ-9,EQ-10');

  T.section('the map');
  const map = em.mapPoints(items, LOCS);
  T.eq('a bubble per location with items, the rest counted', JSON.stringify([map.points.map((p) => p.label), map.placed, map.unplaced]),
    '[["Houston Yard · 2 items","Dallas Yard · 1 item"],3,2]');
  T.eq('fitted: Dallas north-west, Houston south-east; bigger for more', JSON.stringify(map.points.map((p) => [p.x, p.y, p.r])), '[[940,400,32],[60,60,26]]');
  T.eq('where a bubble sits, as a style object', JSON.stringify(em.dotStyle(map.points[0])), '{"left":"94.00%","top":"86.96%","width":"64px","height":"64px"}');
  T.eq('no coordinates: no bubbles', JSON.stringify(em.mapPoints(items, [{ id: 501, locationName: 'X' }])), '{"points":[],"unplaced":5,"placed":0}');

  T.section('export');
  const csv = exportKit.csv(em.sort(items, 'name', 'asc'), em.exportColumns()).split('\r\n');
  T.eq('the list in Excel: what a person reads, plus the stored status', csv[0], '﻿Number,Equipment,Class,Subclass,Type,Manufacturer and model,Tracking,Serial units,On hand,Location,Status,Source,Stored status');
  T.eq('a row', csv[1], 'EQ-2201,CAT 320 Excavator,Excavators,Crawler,Company-owned,Caterpillar 320 GC,Serial,3,,Houston Yard,Active,Fusion,ACTIVE');
  const stg = [{ fusionInventoryItemId: 9, itemNumber: 'EXC-330', itemDescription: 'CAT 330', importStatus: 'AUTO_MAPPED', categoryName: 'Excavators', itemClassCode: 'HEAVY',
    resolvedClassId: 1, resolvedSubclassId: 11, serialNumControlCode: 2, resolvedSource: 'INVENTORY' }];
  T.eq('the fetched items in Excel', exportKit.csv(stg, em.importColumns(page, { classesById: CLASSES, subclassesById: SUBS, stagingSelectedRows: { 9: true } })).split('\r\n')[1],
    'EXC-330,CAT 330,Auto-mapped,Excavators,HEAVY,Excavators,Crawler,Serial,,Inventory,Yes');
  const units = [{ id: 7, serialNumber: 'S1', unitStatus: 'AVAILABLE', locationName: 'Houston Yard', currentOrgName: 'HOU', inServiceDate: '2024-03-01' }];
  T.eq('an item\'s units in Excel', exportKit.csv(units, em.unitColumns(item, 'SERIAL')).split('\r\n').slice(0, 2).join(' | '),
    '﻿Unit,Tag,Status,Where,Quantity,Maintenance asset,Dates,Stored status | S1,,Available,Houston Yard · HOU,1,,In service 1 Mar 2024,AVAILABLE');

  T.section('an item: units, certificates, work orders in words');
  const U = [{ unitStatus: 'AVAILABLE' }, { unitStatus: 'RENTED' }, { unitStatus: 'RENTED' }, { unitStatus: 'IN_MAINTENANCE' }, { unitStatus: 'RETIRED' }, {}];
  T.eq('units by status: what can go out first', item.unitCounts(U).map((u) => u.count + ' ' + u.label + ':' + u.tone).join(', '),
    '1 Available:good, 2 Rented out:progress, 1 In maintenance:progress, 1 Retired:blocked, 1 No status:neutral');
  T.eq('the units tile', JSON.stringify(item.unitsGlance(U.slice(0, 3), 'SERIAL')), '{"value":"3","label":"Serial units","note":"1 available · 2 rented out"}');
  T.eq('no units yet', item.unitsGlance([], 'LOT').note, 'None on record yet: Sync from Fusion brings them in');
  T.eq('available now', [item.availableGlance(U).value, item.availableGlance([{ unitStatus: 'RENTED' }]).note].join(' | '), '1 | every unit is out, held or retired');
  const NOW = Date.UTC(2026, 9, 30, 9);
  const d = (n) => new Date(NOW + n * 86400000).toISOString().slice(0, 10);
  T.eq('certificates: red, then amber 30 days before expiry, then green', [
    em.certLight([{ status: 'expired' }, { status: 'valid', validTo: d(5) }], NOW).text,
    em.certLight([{ status: 'valid', validTo: d(21) }, { status: 'valid', validTo: d(200) }], NOW).text,
    em.certLight([{ status: 'valid', validTo: d(1) }, { status: 'valid', validTo: d(9) }], NOW).text,
    em.certLight([{ status: 'upcoming' }], NOW).text,
    em.certLight([{ status: 'valid', validTo: d(31) }], NOW).text,
    em.certLight([{ status: 'none' }], NOW).text].join(' | '),
  '1 certificate expired | A certificate expires in 21 days | 2 certificates expire, the first tomorrow | 1 certificate not valid yet | Certificates valid | No certificates on file');
  T.eq('a document\'s validity', [item.docStatus({ status: 'expired' }).label, item.docStatus({ status: 'valid', validTo: '2999-01-01' }).label,
    item.docLine({ categoryLabel: 'Load test', status: 'valid', validTo: '2026-11-19', fileType: 'PDF' })].join(' | '), 'Expired | Valid | Load test · valid to 19 Nov 2026 · PDF');
  T.eq('work orders', [em.woLight([], false).text, em.woLight([{ open: false }], true).text, em.woLight([{ open: true }, { open: true }], true).text, em.woLight([], false, true).text].join(' | '),
    'Work orders not checked | No open work orders | 2 open work orders | Checking Fusion work orders…');
  T.eq('under the name', item.subline({ equipmentNumber: 'EQ-1', equipmentClassName: 'Excavators', manufacturer: 'CAT' }), 'EQ-1 · Excavators · CAT');
  T.eq('no class is left out of the line', item.subline({ equipmentNumber: 'EQ-1' }), 'EQ-1');

  // ═══ the chains that write, and how they speak ════════════════════════════════════════════════════════════════
  T.section('Sync from Fusion: guards, the question, the result on the page');
  let f = fake(syncAnswers, syncChains);
  let v = {};
  await run(LIST, 'SyncFromFusionChain', f.Actions, ctx(page, v, { EQR_EQUIPMENT_MASTER: 'READ_ONLY' }), {});
  T.eq('below full access: nothing', f.log.length + (v.ask ? 1 : 0), 0);
  let bus = fakeBus();
  f = fake(syncAnswers, syncChains);
  await run(LIST, 'SyncFromFusionChain', f.Actions, ctx(page, v), {}, bus);
  T.eq('unconfirmed: it asks, after checking no run is going, and sends nothing', [v.ask && v.ask.kind, f.seq(), f.chains().join()].join(' | '), 'sync |  | RunInProgressChain');
  f = fake(syncAnswers, (c) => (c.chain === 'RunInProgressChain' ? { running: true, label: 'A Sync from Fusion', startedAt: '2026-10-30T08:00:00Z' } : { ok: true }));
  bus = fakeBus();
  v = {};
  await run(LIST, 'SyncFromFusionChain', f.Actions, ctx(page, v), {}, bus);
  T.check('another run going: told, nothing asked', !v.ask && bus.log[0].tone === 'warning' && bus.log[0].message.startsWith('Busy: A Sync from Fusion started at'));
  f = fake(syncAnswers, syncChains);
  bus = fakeBus();
  v = { ask: { kind: 'sync' } };
  await run(LIST, 'SyncFromFusionChain', f.Actions, ctx(page, v), { confirmed: true }, bus);
  T.eq('confirmed: items, stock, units; then the list and the counts read again', f.chains().join(), 'RunInProgressChain,ImportUnitsFromFusionChain,refreshListChain');
  T.eq('the result stays on the page (held items named)', JSON.stringify(v.syncResult),
    '{"title":"Sync finished with warnings","message":"1 item updated · 2 unit records refreshed (serials 2, lots 0, on-hand 0) · 1 item held: serial/lot control changed in Fusion while it has units (EQ-9).","type":"warning"}');
  T.eq('and toasts: started, then the result', bus.log.map((x) => x.tone + ':' + x.message.split(':')[0]).join(), 'info:Sync started,warning:Sync finished with warnings');
  T.eq('the run is over, and the Fetch card does not take its line', [v.isSyncing, v.syncStep, v.importPhase].join(), 'false,,SYNC');
  f = fake((o) => (o.endpoint === 'ics/runFusionTableSync' ? { ok: true, body: { statusCode: 'E', statusMsg: 'ORA-1 boom' } } : null), syncChains);
  v = {};
  await run(LIST, 'SyncFromFusionChain', f.Actions, ctx(page, v), { confirmed: true }, fakeBus());
  T.eq('a failure stays on the page in words, and our lock is released', [v.syncResult.type, v.syncResult.message, f.chains().pop()].join(' | '),
    'error | Item sync failed: ORA-1 boom Nothing else was changed. | ReleaseSyncLockChain');

  T.section('Import from Fusion: the toasts, and the list read again');
  bus = fakeBus();
  v = stagingVars();
  const pi = pImp();
  f = fake(promote);
  await run(LIST, 'SaveStagingClassesChain', f.Actions, ctx(pi, v), {}, bus);
  T.eq('PATCH the ticked rows with a class, then promote', f.seq(), 'eqp-v1/patchEquipmentImportStagingAssignments > eqp-v1/promoteEquipmentImport');
  T.eq('the body', JSON.stringify(f.rest()[0].body), '{"assignments":[{"fusionInventoryItemId":9,"resolvedClassId":1,"resolvedSubclassId":11}]}');
  T.eq('what happened stays on the page', v.stagingSaveMessage, '1 item confirmed. 1 added to the equipment master and removed from this list. 1 ticked row was skipped: no Class set.');
  T.eq('then the grid, the groups and the list', f.chains().join(), 'LoadStagingChain,LoadUnmatchedValuesChain,refreshListChain');
  T.eq('a toast', bus.log.map((x) => x.tone).join(), 'info');
  f = fake((o) => (o.endpoint === 'eqp-v1/promoteEquipmentImport' ? { ok: false, status: 409 } : { ok: true, body: { updated: 1, failed: [] } }));
  v = stagingVars();
  bus = fakeBus();
  await run(LIST, 'SaveStagingClassesChain', f.Actions, ctx(pImp(), v), {}, bus);
  T.check('promote refused (a run holds the lock): classified, not added; the list is not read again',
    v.stagingSaveMessage.includes('Another import or sync is running') && !f.chains().includes('refreshListChain') && bus.log[0].tone === 'warning');
  v = stagingVars();
  f = fake();
  await run(LIST, 'ClearStagingChain', f.Actions, ctx(pImp(), v), {});
  T.eq('Clear asks first, sends nothing', [v.ask && v.ask.kind, f.seq()].join('|'), 'clear|');
  f = fake(() => ({ ok: true, body: { deleted: 2 } }));
  await run(LIST, 'ClearStagingChain', f.Actions, ctx(pImp(), v), { confirmed: true });
  T.eq('confirmed: DELETE, then the grid, the groups and the count waiting', [f.seq(), f.chains().join(), JSON.stringify(f.log.filter((x) => x.chain === 'refreshListChain')[0].params)].join(' | '),
    'eqp-v1/clearEquipmentImportStaging | LoadStagingChain,LoadUnmatchedValuesChain,refreshListChain | {"list":false}');
  f = fake((o) => ICS_OK(o) || (o.endpoint === 'eqp-v1/promoteEquipmentImport' ? { ok: false, status: 500 } : null), (c) => (c.chain === 'RunInProgressChain' ? { running: false } : { ok: true }));
  v = Object.assign(stagingVars(), { stagingSelectedRows: {} });
  bus = fakeBus();
  await run(LIST, 'ImportFromFusionChain', f.Actions, ctx(pImp(), v), {}, bus);
  T.eq('Fetch failing: in words on the page and in a toast; the grid read again', [v.importPhase, v.importMessage.slice(0, 40), bus.log[0].tone, bus.log[0].message.slice(0, 29),
    f.chains().filter((c) => c === 'LoadStagingChain').length].join(' | '), 'ERROR | 3 item rows fetched, but classification  | error | Classification Failed: 3 item | 1');
  T.eq('the item class narrows the Fetch (extractFilter)', JSON.stringify(Object.keys(f.rest()[0].body)), '["syncCode","startTime","fullSyncFlag","batchNum"]');
  f = fake((o) => ICS_OK(o) || { ok: true, body: { promoted: 0, autoMapped: 2 } }, (c) => (c.chain === 'RunInProgressChain' ? { running: false } : { ok: true }));
  v = Object.assign(stagingVars(), { stagingSelectedRows: {}, selectedItemClass: 'HEAVY' });
  await run(LIST, 'ImportFromFusionChain', f.Actions, ctx(pImp(), v), {}, fakeBus());
  T.eq('Fetch done: the item class sent, the result on the page, the list read again', [f.rest()[0].body.extractFilter, v.importPhase, f.chains().pop()].join(),
    'HEAVY,DONE,refreshListChain');
  f = fake();
  v = { importReady: true };
  bus = fakeBus();
  await run(LIST, 'importInitChain', f.Actions, ctx(page, v, { EQR_EQUIPMENT_MASTER: 'READ_ONLY' }), {}, bus);
  T.eq('the Import view below full access: told, back to the list, Fusion not called', [bus.log[0].message, JSON.stringify(f.log.filter((x) => x.chain)[0].params), f.seq(), v.importReady].join(' | '),
    'Importing from Fusion needs full access to Equipment. | {"view":"list"} |  | false');

  T.section('Change class: the toast, and the read-back');
  f = fake(readBack(12));
  v = classVars();
  bus = fakeBus();
  await run(ITEM, 'saveClassChangeChain', f.Actions, ctx(item, v), {}, bus);
  T.eq('PATCH with the version, then read back', f.seq() + ' ' + JSON.stringify(f.rest()[0].body),
    'eqp-v1/patchEquipment > eqp-v1/getEquipriteV1EquipmentMasterById {"equipmentClassId":1,"equipmentSubclassId":12,"objectVersionNumber":3}');
  T.eq('saved: the panel closes, a toast, expenditure types read again', [v.classPanelOpen, bus.log[0].message, f.chains().join()].join(' | '),
    'false | Class changed: Excavators / Mini saved. | loadEquipExpTypesChain');
  f = fake(readBack(11));
  v = classVars();
  await run(ITEM, 'saveClassChangeChain', f.Actions, ctx(item, v), {}, fakeBus());
  T.eq('the server kept the old subclass: said so, not saved', v.classChangeError, 'The server did not apply the change as sent (it kept the old subclass). Nothing else was changed.');
  f = fake((o) => (o.endpoint === 'eqp-v1/patchEquipment' ? { ok: false, status: 409 } : null));
  v = classVars();
  await run(ITEM, 'saveClassChangeChain', f.Actions, ctx(item, v), {}, fakeBus());
  T.eq('409: someone else changed it', v.classChangeError, 'Someone else changed this item. Close, reopen the page and try again.');
  f = fake();
  v = classVars();
  await run(ITEM, 'saveClassChangeChain', f.Actions, ctx(item, v, { EQR_EQUIPMENT_MASTER: 'READ_ONLY' }), {}, fakeBus());
  T.eq('below full access: nothing sent', f.log.length, 0);

  T.section('an item\'s tab');
  f = fake(detailAnswers);
  v = { id: '101', number: 'EQ-2201', attLevel: 'HEADER' };
  bus = fakeBus();
  await run(ITEM, 'loadRecordChain', f.Actions, ctx(item, v), {}, bus);
  T.eq('named after the item', JSON.stringify(bus.log[0]), '{"action":"rename","id":"equipment-item:101","title":"EQ-2201"}');
  T.eq('units with their location and org', v.unitsArray.map((u) => item.unitWhere(u)).join(' | '), 'Yard · HOU | Yard');
  f = fake((o) => (o.endpoint === 'eqp-v1/getEquipriteV1EquipmentMaster' ? { ok: true, body: { data: ROWS, recordCount: 5 } } : detailAnswers(o)));
  v = { id: '', number: 'eq-2202', attLevel: 'HEADER' };
  await run(ITEM, 'loadRecordChain', f.Actions, ctx(item, v), {}, fakeBus());
  T.eq('a tab opened by number finds its id', [v.equipmentId, f.rest()[1].rest, JSON.stringify(f.rest()[1].uriParams)].join(' '), '102 eqp-v1/getEquipriteV1EquipmentMasterById {"id":"102"}');
  f = fake(() => ({ ok: true, body: { data: [] } }));
  v = { id: '', number: 'NOPE', attLevel: 'HEADER' };
  await run(ITEM, 'loadRecordChain', f.Actions, ctx(item, v), {}, fakeBus());
  T.eq('not found: said so', v.loadError, 'Equipment NOPE was not found in the equipment master.');
  f = fake(() => ({ ok: false, status: 404 }));
  v = { id: '7', attLevel: 'HEADER' };
  await run(ITEM, 'loadRecordChain', f.Actions, ctx(item, v), {}, fakeBus());
  T.eq('a failed read: said so', v.loadError, 'This equipment could not be loaded (HTTP 404).');

  T.section('the catalog\'s chains');
  bus = fakeBus();
  await run(LIST, 'openRecordChain', fake().Actions, ctx(page, {}), { id: '101', number: 'EQ-2201' }, bus);
  T.eq('a row opens the item\'s tab', JSON.stringify(bus.log[0]), '{"action":"open","record":"equipment-item","params":{"id":101,"number":"EQ-2201"}}');
  const pages = [{ ok: true, body: { data: ROWS.slice(0, 3), recordCount: 5, hasMore: true } }, { ok: true, body: { data: ROWS.slice(3), recordCount: 5, hasMore: false } }];
  f = fake((o) => pages[o.uriParams.page]);
  v = { assetGroupId: '' };
  await run(LIST, 'loadListChain', f.Actions, ctx(page, v), {});
  T.eq('every page, until the count is reached', [f.rest().map((x) => JSON.stringify(x.uriParams)).join(' '), v.rows.length, v.total, v.isLoading].join(' | '),
    '{"page":0,"size":200} {"page":1,"size":200} | 5 | 5 | false');
  T.eq('shown after the first page and at the end', f.chains().join(), 'applyChain,applyChain');
  f = fake(() => ({ ok: true, body: { data: [], recordCount: 0 } }));
  await run(LIST, 'loadListChain', f.Actions, ctx(page, { assetGroupId: '7' }), {});
  T.eq('the asset group is the server\'s', JSON.stringify(f.rest()[0].uriParams), '{"page":0,"size":200,"assetGroupId":7}');
  f = fake(() => ({ ok: false, status: 503 }));
  v = {};
  await run(LIST, 'loadListChain', f.Actions, ctx(page, v), {});
  T.eq('a failed list: said so', v.error, 'The equipment list could not be loaded (HTTP 503).');
  f = fake(() => ({ ok: true, body: { data: [ROWS[0]], recordCount: 1 } }));
  v = { text: '  CAT0320A2 ', assetGroupId: '' };
  await run(LIST, 'searchChain', f.Actions, ctx(page, v), {});
  T.eq('the search asks the server with q', [JSON.stringify(f.rest()[0].uriParams), JSON.stringify(v.server.ids), v.server.failed, v.searching].join(' | '),
    '{"page":0,"size":200,"q":"CAT0320A2"} | {"101":true} | false | false');
  f = fake(() => ({ ok: false, status: 500 }));
  v = { text: 'CAT0320A2' };
  await run(LIST, 'searchChain', f.Actions, ctx(page, v), {});
  T.eq('a failed server search: marked, so the screen says so', [v.server.failed, page.searchNote('CAT0320A2', v.server, false)].join(' | '),
    'true | Serial numbers could not be searched just now; these match the number, name, class or location.');
  f = fake();
  v = { text: 'a', server: { q: 'ab', ids: {} } };
  await run(LIST, 'searchChain', f.Actions, ctx(page, v), {});
  T.eq('one character: the server is not asked', [f.log.length, v.server.q].join('|'), '0|');
  v = { rows: ROWS, server: { q: 'CAT0320A2', ids: { 101: true }, rows: [ROWS[0]] }, text: 'CAT0320A2', classesById: CLASSES, subclassesById: SUBS,
    locationsById: REF.locationsById, locations: LOCS, classId: '', subclassId: '', status: '', tracking: '', source: '', location: '', sortKey: 'name', sortDir: 'asc', view: 'list' };
  await run(LIST, 'applyChain', fake().Actions, ctx(page, v), { view: 'map' });
  T.eq('apply: what the view shows, the chips, the map, the summary', [v.view, ids(v.shown), v.shown[0].why, v.chips.classes.map((c) => c.label).join('/'), v.map.placed, v.summary].join(' | '),
    'map | EQ-2201 | server | All classes/Excavators | 1 | 1 of 5 items · 3 serials');
  bus = fakeBus();
  v = { view: 'list', shown: em.decorate(ROWS.slice(0, 2), REF), chips: em.chips(items, { classId: '1' }, REF), classId: '1', text: 'cat', location: '501', locationsById: REF.locationsById };
  const kitCalls = [];
  const kit = { run: (format, o) => { kitCalls.push([format, o]); return Promise.resolve({ ok: true, message: '2 rows exported to CSV.' }); }, FORMATS: exportKit.FORMATS };
  const Exp = loadAmd(path.join(LIST, 'exportChain.js'), { 'vb/action/actionChain': class {}, 'resources/js/exportKit': kit, 'resources/js/equipmentMaster': em, 'resources/js/shellBus': bus });
  await new Exp().run(ctx(page, v), { format: 'csv' });
  T.eq('export: what is shown, the filters in words, a toast', [kitCalls[0][1].name, kitCalls[0][1].subtitle, kitCalls[0][1].rows.length, bus.log[0].message].join(' | '),
    'equipment-master | Excavators · at Houston Yard · "cat" | 2 | 2 rows exported to CSV.');

  T.section('every endpoint the chains call exists in services/');
  const ops = {};
  ['eqp-v1', 'ProjectLOV', 'ics', 'commonService'].forEach((svc) => {
    const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'services', svc, 'openapi3.json'), 'utf8'));
    Object.values(spec.paths || {}).forEach((p) => Object.values(p).forEach((op) => { if (op && op.operationId) ops[svc + '/' + op.operationId] = true; }));
  });
  const used = new Set();
  const scan = (s) => (s.match(/endpoint:\s*'([^']+)'/g) || []).concat(s.match(/'eqp-v1\/[A-Za-z0-9_]+'/g) || [])
    .forEach((m) => used.add(m.replace(/endpoint:\s*'/, '').replace(/'/g, '')));
  [LIST, ITEM].forEach((dir) => fs.readdirSync(dir).forEach((f2) => scan(fs.readFileSync(path.join(dir, f2), 'utf8'))));
  ['fetchAllPages', 'expenditureTypes', 'maintenanceWorkOrders'].forEach((f2) => scan(fs.readFileSync(path.join(JS, f2 + '.js'), 'utf8')));
  [...used].sort().forEach((e) => T.check(e, !!ops[e]));

  T.section('the pages: every chain they name exists, embeddable');
  const flow = JSON.parse(fs.readFileSync(path.join(NEXT, 'flows', 'equipment', 'equipment-flow.json'), 'utf8'));
  T.eq('the flow is embeddable', flow.navigation.embeddable, 'enabled');
  Object.keys(flow.pages).forEach((p) => {
    const json = JSON.parse(fs.readFileSync(path.join(PAGES, p + '-page.json'), 'utf8'));
    const named = new Set();
    Object.values(json.eventListeners).forEach((l) => l.chains.forEach((c) => named.add(c.chain)));
    const dir = path.join(PAGES, p + '-page-chains');
    fs.readdirSync(dir).forEach((f2) => (fs.readFileSync(path.join(dir, f2), 'utf8').match(/chain: '([A-Za-z]+)'/g) || []).forEach((m) => named.add(m.slice(8, -1))));
    T.eq(p + ': embeddable', json.navigation.embeddable, 'enabled');
    T.eq(p + ': every chain it names has its file', [...named].filter((c) => !fs.existsSync(path.join(dir, c + '.js'))).join(), '');
  });
  const appFlow = JSON.parse(fs.readFileSync(path.join(NEXT, 'app-flow.json'), 'utf8'));
  T.check('the stylesheet is imported', appFlow.imports.css.includes('resources/css/next-equipment.css'));

  T.report();
})().catch((e) => { console.error(e); process.exitCode = 1; });
