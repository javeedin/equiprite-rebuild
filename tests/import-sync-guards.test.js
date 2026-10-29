/*
 * Guards around the long runs (Fetch, Import, Sync) and the new columns.
 *
 *   - RunInProgressChain: a RUNNING job-log row from another tab or user
 *     blocks Fetch / Sync; an abandoned one (older than 20 min) does not; an
 *     unreadable log never blocks (fails open).
 *   - BeforeExitChain: leaving the page mid-run asks first; Cancel returns
 *     { cancelled: true }, which keeps the user on the page.
 *   - setLeaveGuard: the browser's own prompt on tab close / reload.
 *   - Stock column (list) and Catalog / Segment columns (review grid).
 *
 * Run:  node tests/import-sync-guards.test.js
 */
'use strict';

const path = require('path');
const H = require('./_harness');
const T = H.makeAsserter();
const PM = H.loadPageModule();

function loadPageModuleWith(extraGlobals) {
  const fs = require('fs'); const vm = require('vm');
  const src = fs.readFileSync(path.join(H.PAGES, 'equipment-master-page.js'), 'utf8');
  const sandbox = Object.assign({ console }, extraGlobals);
  sandbox.globalThis = sandbox;
  let M;
  sandbox.define = (deps, f) => { M = f.apply(null, deps.map(d =>
    d === 'ojs/ojarraydataprovider' ? H.FakeADP :
    d === 'resources/js/arrayDataGridProvider' ? H.FakeGridProvider : {})); };
  vm.createContext(sandbox); vm.runInContext(src, sandbox);
  return new M();
}

function logActions(rowsByJob, fail) {
  const calls = [];
  return { calls, Actions: {
    callRest: async (_c, r) => {
      calls.push(r);
      if (fail) throw new Error('down');
      return { ok: true, body: { data: rowsByJob[r.uriParams.jobName] || [] } };
    }
  } };
}
const minutesAgo = m => new Date(Date.now() - m * 60000).toISOString();

(async () => {
  T.section('RunInProgressChain (server lock, V387)');
  const lockRun = async (body, fail) => {
    const calls = [];
    const A = { callRest: async (_c, r) => { calls.push(r); if (fail) throw new Error('down'); return { ok: true, body: body }; } };
    const r = await new (H.loadChain('RunInProgressChain', A))().run({});
    return { r, calls };
  };
  {
    const { r, calls } = await lockRun({ held: true, runLabel: 'FETCH', acquiredAt: minutesAgo(3), idleSeconds: 30, staleAfterSeconds: 1200 });
    T.eq('reads GET /fusion-sync/lock', calls[0].endpoint, 'eqp-v1/getFusionSyncLock');
    T.eq('a held lock blocks', r.running, true);
    T.eq('  named: Fetch', r.label, 'An Import From Fusion fetch');
  }
  T.eq('  named: Sync', (await lockRun({ held: true, runLabel: 'SYNC', idleSeconds: 1, staleAfterSeconds: 1200 })).r.label, 'A Sync from Fusion');
  T.eq('free lock: not running', (await lockRun({ held: false })).r.running, false);
  T.eq('stale lock (idle past limit): not running', (await lockRun({ held: true, runLabel: 'FETCH', idleSeconds: 1500, staleAfterSeconds: 1200 })).r.running, false);
  T.eq('lock unreadable: fails open', (await lockRun(null, true)).r.running, false);

  T.section('BUSY refusal text');
  T.eq('not BUSY -> empty', PM.busyText('ORA-00942'), '');
  T.check('BUSY -> friendly, keeps the detail',
    /^Another import or sync is running \(FETCH started 10:02\)\. Try again when it finishes\.$/.test(PM.busyText('BUSY: FETCH started 10:02')),
    PM.busyText('BUSY: FETCH started 10:02'));

  T.section('Fetch refuses while another run is live');
  {
    const calls = [];
    const Actions = {
      callChain: async (_c, ch) => (ch.chain === 'RunInProgressChain'
        ? { running: true, label: 'A Sync from Fusion', startedAt: minutesAgo(2) } : { ok: true }),
      callRest: async (_c, r) => { calls.push(r); return { ok: true, body: {} }; },
      fireNotificationEvent: async () => {}
    };
    const v = { isImporting: false, isImportingUnits: false, stagingSaving: false, stagingClearing: false,
                stagingSelectedRows: {}, stagingChangedRows: {}, importWarning: '' };
    await new (H.loadChain('ImportFromFusionChain', Actions))().run({ $page: { functions: PM, variables: v } });
    T.eq('no sync call made', calls.length, 0);
    T.check('says why in the dialog', /A Sync from Fusion started at .* is still running/.test(v.importWarning), v.importWarning);
    T.eq('not marked busy', v.isImporting, false);
  }

  T.section('leaving the page');
  T.eq('idle: nothing to warn about', PM.busyLeaveMessage({}), '');
  T.check('Sync running', /Sync from Fusion is still running/.test(PM.busyLeaveMessage({ isSyncing: true })));
  T.check('Fetch running', /still fetching/.test(PM.busyLeaveMessage({ isImporting: true })));
  T.check('Import running', /still merging/.test(PM.busyLeaveMessage({ stagingSaving: true })));
  for (const [answer, expected] of [[false, true], [true, false]]) {
    const realWin = global.window;
    global.window = { confirm: () => answer };
    try {
      const r = await new (H.loadChain('BeforeExitChain', {}))().run({ $page: { functions: PM, variables: { isSyncing: true } } });
      T.eq('mid-Sync, confirm=' + answer + ' -> cancelled ' + expected, !!(r && r.cancelled), expected);
    } finally { global.window = realWin; }
  }
  {
    const realWin = global.window; let asked = 0;
    global.window = { confirm: () => { asked++; return false; } };
    try {
      const r = await new (H.loadChain('BeforeExitChain', {}))().run({ $page: { functions: PM, variables: {} } });
      T.eq('idle: leaves without asking', asked + (r && r.cancelled ? 1 : 0), 0);
    } finally { global.window = realWin; }
  }
  {
    // The page module runs in a vm sandbox, so its `window` is the sandbox's:
    // load a copy with a fake window inside it.
    const added = []; const removed = [];
    const win = { addEventListener: (n) => added.push(n), removeEventListener: (n) => removed.push(n) };
    const W = loadPageModuleWith({ window: win });
    T.eq('guard on', W.setLeaveGuard(true), true);
    T.eq('  registers beforeunload', added.join(','), 'beforeunload');
    W.setLeaveGuard(false);
    T.check('guard off removes it', removed.includes('beforeunload') && added.length === 1);
    T.eq('no window (node): harmless no-op', PM.setLeaveGuard(true), false);
  }
  const pj = H.readJson(path.join(H.PAGES, 'equipment-master-page.json'));
  T.eq('vbBeforeExit runs BeforeExitChain', pj.eventListeners.vbBeforeExit.chains[0].chain, 'BeforeExitChain');
  ['stockLabel', 'busyLeaveMessage', 'setLeaveGuard'].forEach(f => T.check(f + ' declared', !!pj.functions[f]));

  T.section('Stock column (list)');
  T.eq('serials and on hand', PM.stockLabel(12, 3), '12 serials · 3 on hand');
  T.eq('one serial', PM.stockLabel(1, null), '1 serial');
  T.eq('on hand only', PM.stockLabel(null, 1200), (1200).toLocaleString() + ' on hand');
  T.eq('zero on hand is shown', PM.stockLabel(null, 0), '0 on hand');
  T.eq('nothing -> blank', PM.stockLabel(null, null), '');
  const html = H.readPageFile('equipment-master-page.html');
  T.check('column bound to stockLabel', /stockLabel\(cell\.row\.serialUnitCount, cell\.row\.onHandQty\)/.test(html));

  T.section('Catalog / segment columns (review grid)');
  const g = PM.buildStagingGrid([{ fusionInventoryItemId: 1, catalogCode: 'Inv_Items', catSegment1: 'Computer', catSegment2: 'Tablet Cmp' }], {});
  T.eq('headers', g.params.columnHeader[0].slice(11).join(','), 'Catalog,Segment 1,Segment 2');
  T.eq('values', g.params.data[0].slice(11).map(c => c.data).join(','), 'Inv_Items,Computer,Tablet Cmp');
  T.eq('read-only', [11, 12, 13].every(i => PM.getColumnType(i) === 'readonly'), true);
  const all = pj.variables.stagingColumns.defaultValue.map(c => c.field);
  T.check('All Columns view has them too', ['catalogCode', 'catSegment1', 'catSegment2'].every(f => all.includes(f)));

  T.section('Fetch in the background');
  T.eq('can close during a Fetch', PM.canCloseImportDialog({ isImporting: true }), true);
  T.eq('can close during the stock stage', PM.canCloseImportDialog({ isImportingUnits: true }), true);
  T.eq('not during Import', PM.canCloseImportDialog({ stagingSaving: true }), false);
  T.eq('not during Clear', PM.canCloseImportDialog({ stagingClearing: true }), false);
  T.check('Close button bound to canCloseImportDialog',
    /<oj-button id="importCloseBtn"\s+disabled="\[\[ !\$functions\.canCloseImportDialog\(\$variables\) \]\]"/.test(html));
  {
    const notes = []; const chains = []; let closed = 0, reopened = 0;
    const Actions = { fireNotificationEvent: async (_c, n) => notes.push(n), callChain: async (_c, ch) => chains.push(ch.chain) };
    const realDoc = global.document;
    global.document = { getElementById: () => ({ isOpen: () => true, open: () => { reopened++; }, close: () => { closed++; } }) };
    try {
      const v = { importDialogOpen: true, isImporting: true, stagingSelectedRows: {}, stagingChangedRows: {} };
      await new (H.loadChain('CancelImportDialogChain', Actions))().run({ $page: { functions: PM, variables: v } });
      T.eq('mid-Fetch Close: dialog closes', closed, 1);
      T.eq('  not reopened', reopened, 0);
      T.check('  says it carries on', notes.some(n => /continues in the background/.test(n.summary)));
      T.check('  list not refreshed yet (the Fetch does that when done)', !chains.includes('RefreshEquipmentListChain'));
    } finally { global.document = realDoc; }
  }
  {
    const fetching = PM.actionsFor(H.readJson(path.join(H.PAGES, 'equipment-master-page.json')).variables.secondaryActions.defaultValue,
      'FULL', false, '', true).find(a => a.id === 'importFusion');
    T.eq('menu says it is fetching', fetching.label, 'Import From Fusion (fetching…)');
    T.eq('  and stays enabled (reopens the dialog)', fetching.display, 'on');
  }
  {
    // result toast persists when the dialog was closed
    const notes = [];
    const Actions = {
      callChain: async (_c, ch) => ch.chain === 'RunInProgressChain' ? { running: false } : { ok: true },
      callRest: async (_c, r) => /promote/.test(r.endpoint) ? { ok: false, status: 500 }
        : { ok: true, body: { statusCode: 'SUCCESS', rowsMerged: '3', hasMoreData: 'N' } },
      fireNotificationEvent: async (_c, n) => notes.push(n)
    };
    const v = { isImporting: false, isImportingUnits: false, stagingSaving: false, stagingClearing: false,
                stagingSelectedRows: {}, stagingChangedRows: {}, importWarning: '', importDialogOpen: true };
    const ctxF = { $page: { functions: PM, variables: v } };
    const C = H.loadChain('ImportFromFusionChain', Object.assign({}, Actions, {
      callRest: async (c, r) => { if (r.endpoint === 'ics/runFusionTableSync') v.importDialogOpen = false; return Actions.callRest(c, r); }
    }));
    await new C().run(ctxF);
    T.eq('dialog closed mid-run: the result notice persists', notes[notes.length - 1].displayMode, 'persist');
  }

  T.section('search box');
  T.check('search box in the dialog', /<oj-c-input-text id="stagingSearch"[\s\S]*?value="\{\{ \$variables\.stagingSearch \}\}"/.test(html));
  T.check('  reloads through the filter chain', /id="stagingSearch"[\s\S]*?on-value-changed="\[\[ \$listeners\.onImportFilterChanged \]\]"/.test(html));
  T.check('oj-c-input-text imported', !!pj.imports.components['oj-c-input-text']);
  const api = H.readJson(path.join(H.SERVICES, 'eqp-v1', 'openapi3.json'));
  T.check('openapi declares ?search= (VB drops undeclared params)',
    api.paths['/equiprite/v1/equipment-import/staging'].get.parameters.some(p => p.name === 'search'));
  {
    const sent = [];
    const Actions = { callRest: async (_c, r) => { sent.push(r); return { ok: true, body: { items: [
      { fusionInventoryItemId: 1, itemNumber: 'Manitowoc 2250 Crawler Crane', itemDescription: 'EQUIP#1106017' }], totalElements: 1 } }; } };
    const v = { stagingSearch: '  manitowoc ', stagingPageSize: 100, stagingPage: 0, stagingSelectedRows: {}, stagingChangedRows: {} };
    await new (H.loadChain('LoadStagingChain', Actions))().run({ $page: { functions: PM, variables: v } }, {});
    T.eq('sends the trimmed search', sent[0].uriParams.search, 'manitowoc');
    T.eq('recorded as applied', v.stagingAppliedFilters.search, 'manitowoc');
    T.check('summary says what matched', /matching "manitowoc"/.test(v.stagingSummary), v.stagingSummary);
    T.check('no "not applied" warning when rows match', !/not applied/.test(v.stagingSummary), v.stagingSummary);
  }
  {
    const Actions = { callRest: async () => ({ ok: true, body: { items: [{ fusionInventoryItemId: 2, itemNumber: 'WATER' }], totalElements: 4763 } }) };
    const v = { stagingSearch: 'manitowoc', stagingPageSize: 100, stagingPage: 0, stagingSelectedRows: {}, stagingChangedRows: {} };
    await new (H.loadChain('LoadStagingChain', Actions))().run({ $page: { functions: PM, variables: v } }, {});
    T.check('server ignoring the search is called out', /Filter not applied by the server yet/.test(v.stagingSummary), v.stagingSummary);
  }
  {
    const realWin = global.window;
    global.window = { confirm: () => false };
    try {
      const v = { stagingSearch: 'crane', stagingAppliedFilters: { search: null }, stagingSelectedRows: { 1: true }, stagingChangedRows: {},
                  stagingArray: [{ fusionInventoryItemId: 1, importStatus: 'AUTO_MAPPED', resolvedClassId: 5 }] };
      await new (H.loadChain('ClearImportWarningChain', { callChain: async () => {} }))().run({ $page: { functions: PM, variables: v } });
      T.eq('search change with ticks + Cancel: search snaps back', v.stagingSearch, '');
    } finally { global.window = realWin; }
  }

  T.section('Item Class narrows the Fetch (extractFilter)');
  const runFetch = async (itemClass) => {
    const sent = [];
    const Actions = {
      callChain: async (_c, ch) => ch.chain === 'RunInProgressChain' ? { running: false } : { ok: true },
      callRest: async (_c, r) => { sent.push(r); return /promote/.test(r.endpoint)
        ? { ok: true, body: { promoted: 0, notes: 'errored=0' } }
        : { ok: true, body: { statusCode: 'SUCCESS', rowsMerged: '3', hasMoreData: sent.length < 2 ? 'Y' : 'N' } }; },
      fireNotificationEvent: async () => {}
    };
    const v = { isImporting: false, isImportingUnits: false, stagingSaving: false, stagingClearing: false,
                stagingSelectedRows: {}, stagingChangedRows: {}, importWarning: '', importDialogOpen: true,
                selectedItemClass: itemClass };
    await new (H.loadChain('ImportFromFusionChain', Actions))().run({ $page: { functions: PM, variables: v } });
    return sent.filter(r => r.endpoint === 'ics/runFusionTableSync');
  };
  {
    const b = await runFetch('ROOT_ICC');
    T.eq('class picked: sent as extractFilter', b[0].body.extractFilter, 'ROOT_ICC');
    T.eq('  on every item batch', b.every(x => x.body.extractFilter === 'ROOT_ICC'), true);
    T.eq('  still a FULL run', b[0].body.fullSyncFlag, 'Y');
  }
  {
    const b = await runFetch(null);
    T.eq('no class: field omitted (not sent as empty)', 'extractFilter' in b[0].body, false);
  }
  const ics = H.readJson(path.join(H.SERVICES, 'ics', 'openapi3.json'));
  T.check('OIC request schema declares extractFilter', !!ics.components.schemas.FusionTableSyncRequest.properties.extractFilter);

  T.report();
})().catch(e => { console.error(e); process.exitCode = 1; });
