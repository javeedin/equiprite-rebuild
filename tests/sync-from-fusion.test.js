/*
 * Sync from Fusion — refresh what EquipRite already holds from Fusion.
 *
 * Pinned here (product decisions 2026-10-05):
 *   - FULL access only; the menu item says "Syncing from Fusion…" and is
 *     disabled while it runs, and a Sync counts as busy for the Import dialog
 *     (both write the same stock staging);
 *   - items run DELTA (fullSyncFlag 'N') on EQUIP_ITEM_REFRESH_SYNC;
 *   - gone units only on a complete stock snapshot: snapshot 'Y' is sent only
 *     when all three stock syncs succeeded, otherwise 'N';
 *   - a failed item stage changes nothing else;
 *   - held items (control type changed in Fusion) are named in the summary.
 *
 * WHAT THIS CANNOT TELL YOU: whether the PL/SQL compiles or the endpoints
 * exist. Those need the backend (docs/SYNC_FROM_FUSION_BACKEND_ASK_2026-10-05.md).
 *
 * Run:  node tests/sync-from-fusion.test.js
 */
'use strict';

const path = require('path');
const H = require('./_harness');
const T = H.makeAsserter();
const PM = H.loadPageModule();

const DECLARED = H.readJson(path.join(H.PAGES, 'equipment-master-page.json')).variables.secondaryActions.defaultValue;

function ctx(level, vars) {
  return {
    $application: {
      functions: { pageAccess: (m, l, c) => (l && m && m[c]) || 'HIDDEN' },
      variables: { pageAccessMap: level ? { EQR_EQUIPMENT_MASTER: level } : {}, pageAccessLoaded: true }
    },
    $page: { functions: PM, variables: Object.assign({ isSyncing: false }, vars || {}) }
  };
}

const okBatch = more => ({ ok: true, body: { statusCode: 'SUCCESS', rowsMerged: '', hasMoreData: more || '' } });
const COUNTS = { itemsChanged: 12, itemsHeld: 0, serials: 700, lots: 3, onhand: 290,
                 serialsGone: 2, lotsGone: 0, onhandGone: 5, stockWaiting: 0 };

function actions(opts) {
  const o = opts || {};
  const log = { rest: [], notes: [], chains: [] };
  let batch = 0;
  return { log, Actions: {
    callRest: async (_c, r) => {
      log.rest.push(r);
      if (r.endpoint === 'ics/runFusionTableSync') {
        batch++;
        if (o.busy) return { ok: true, body: { statusCode: 'E', statusMsg: 'BUSY: FETCH started 10:02' } };
        if (o.itemFail && !(o.failAtBatch && batch < o.failAtBatch)) return { ok: true, body: { statusCode: 'ERROR', statusMsg: 'ORA-00942' } };
        return okBatch(batch < (o.batches || 2) ? 'Y' : 'N');
      }
      if (r.endpoint === 'eqp-v1/refreshFusionSyncUnits') {
        if (o.units409) return { ok: false, status: 409 };
        return o.unitsFail ? { ok: false, status: 500 } : { ok: true, body: Object.assign({}, COUNTS, o.counts || {}) };
      }
      if (r.endpoint === 'eqp-v1/getFusionSyncExceptions') {
        return { ok: true, body: { items: [{ equipmentNumber: 'AS35001' }, { equipmentNumber: 'CM4751126' }] } };
      }
      return { ok: false };
    },
    fireNotificationEvent: async (_c, n) => { log.notes.push(n); },
    callChain: async (_c, ch) => {
      log.chains.push(ch.chain);
      if (ch.chain === 'RunInProgressChain') {
        return o.otherRun ? { running: true, label: 'An Import From Fusion fetch', startedAt: '2026-10-06T06:00:00Z' }
                          : { running: false };
      }
      if (ch.chain === 'ImportUnitsFromFusionChain') { log.stepAtStock = o.ctx && o.ctx.$page.variables.syncStep; log.stockParams = ch.params; }
      if (ch.chain === 'ReleaseSyncLockChain') log.released = ch.params;
      if (ch.chain === 'ImportUnitsFromFusionChain') {
        return o.stockFail ? { ok: false, message: 'the lots import failed: boom' } : { ok: true, total: 990 };
      }
      return { ok: true };
    }
  } };
}

async function run(level, opts, vars, confirmAnswer) {
  const c = ctx(level, vars);
  const a = actions(Object.assign({ ctx: c }, opts));
  const realWin = global.window;
  global.window = { confirm: () => confirmAnswer !== false };
  try { await new (H.loadChain('SyncFromFusionChain', a.Actions))().run(c); }
  finally { global.window = realWin; }
  return { a, c, last: a.log.notes[a.log.notes.length - 1] || {} };
}

(async () => {
  T.section('menu');
  const shown = (lvl, syncing, step) => PM.actionsFor(DECLARED, lvl, syncing, step);
  const sync = (lvl, syncing, step) => shown(lvl, syncing, step).find(x => x.id === 'syncFusion');
  T.eq('declared label', DECLARED.find(x => x.id === 'syncFusion').label, 'Sync from Fusion');
  T.eq('FULL: on', sync('FULL').display, 'on');
  T.eq('READ_ONLY: off', sync('READ_ONLY').display, 'off');
  T.eq('not loaded: off', sync('HIDDEN').display, 'off');
  T.eq('while syncing: disabled', sync('FULL', true).display, 'disabled');
  T.eq('while syncing: says so', sync('FULL', true).label, 'Syncing from Fusion…');
  T.eq('declared item not mutated', DECLARED.find(x => x.id === 'syncFusion').label, 'Sync from Fusion');
  T.eq('a Sync counts as busy for the Import dialog', PM.isBusy({ isSyncing: true }), true);
  const html = H.readPageFile('equipment-master-page.html');
  T.check('menu binding passes isSyncing and the step', /actionsFor\(\$variables\.secondaryActions, [^)]*\), \$variables\.isSyncing, \$variables\.syncStep, \$variables\.isImporting\)/.test(html));
  T.eq('label shows the step', sync('FULL', true, 'stock').label, 'Syncing from Fusion… (stock)');
  {
    const a = actions();
    await new (H.loadChain('SecondaryActionChain', a.Actions))().run(ctx('FULL'), { event: { detail: { secondaryItem: 'syncFusion' } } });
    T.eq('menu item runs SyncFromFusionChain', a.log.chains.join(','), 'SyncFromFusionChain');
  }

  T.section('who and when');
  { const r = await run('READ_ONLY'); T.eq('READ_ONLY: nothing called', r.a.log.rest.length, 0); }
  { const r = await run('FULL', {}, { isImporting: true });
    T.eq('busy: nothing called', r.a.log.rest.length, 0);
    T.eq('  and says so', r.last.type, 'warning'); }
  { const r = await run('FULL', {}, {}, false); T.eq('confirm Cancel: nothing called', r.a.log.rest.length, 0); }

  { const r = await run('FULL', { otherRun: true });
    T.eq('another tab/user mid-run: nothing called', r.a.log.rest.length, 0);
    T.check('  says who and since when', /An Import From Fusion fetch started at .* is still running/.test(r.last.message), r.last.message); }

  T.section('happy path');
  {
    const r = await run('FULL', { batches: 3 });
    const items = r.a.log.rest.filter(x => x.endpoint === 'ics/runFusionTableSync');
    T.eq('item sync: all batches', items.length, 3);
    T.eq('  on the refresh row', items[0].body.syncCode, 'EQUIP_ITEM_REFRESH_SYNC');
    T.eq('  DELTA', items.every(x => x.body.fullSyncFlag === 'N'), true);
    T.eq('  batches numbered', items.map(x => x.body.batchNum).join(','), '1,2,3');
    T.check('stock syncs run', r.a.log.chains.includes('ImportUnitsFromFusionChain'));
    const units = r.a.log.rest.find(x => x.endpoint === 'eqp-v1/refreshFusionSyncUnits');
    T.eq('units refreshed with a full snapshot', units && units.body.snapshot, 'Y');
    T.eq('summary persists', r.last.displayMode, 'persist');
    T.eq('  confirmation', r.last.type, 'confirmation');
    T.check('  counts items and units', /12 items updated/.test(r.last.message) && /993 unit records refreshed/.test(r.last.message), r.last.message);
    T.check('  reports gone units', /7 no longer in Fusion yard stock/.test(r.last.message), r.last.message);
    T.check('list refreshed', r.a.log.chains.includes('RefreshEquipmentListChain'));
    T.eq('busy flag released', r.c.$page.variables.isSyncing, false);
    T.eq('step shown during the stock syncs', r.a.log.stepAtStock, 'stock');
    T.eq('step cleared at the end', r.c.$page.variables.syncStep, '');
    T.check('no held-items lookup when none held', !r.a.log.rest.some(x => x.endpoint === 'eqp-v1/getFusionSyncExceptions'));
  }

  T.section('partial stock read: refresh, but nothing marked gone');
  {
    const r = await run('FULL', { stockFail: true, counts: { serialsGone: 0, onhandGone: 0 } });
    const units = r.a.log.rest.find(x => x.endpoint === 'eqp-v1/refreshFusionSyncUnits');
    T.eq('snapshot N', units && units.body.snapshot, 'N');
    T.eq('warning', r.last.type, 'warning');
    T.check('says why', /read only partly \(the lots import failed: boom\), so nothing was marked as gone/.test(r.last.message), r.last.message);
  }

  T.section('failures');
  {
    const r = await run('FULL', { itemFail: true });
    T.check('item stage error: no stock, no units', !r.a.log.chains.includes('ImportUnitsFromFusionChain') &&
      !r.a.log.rest.some(x => x.endpoint === 'eqp-v1/refreshFusionSyncUnits'));
    T.eq('  error persists', r.last.type + '/' + r.last.displayMode, 'error/persist');
    T.check('  batch 1 failed (not BUSY): releases its lock', !!r.a.log.released);
    T.check('  engine text reaches the user', /ORA-00942/.test(r.last.message), r.last.message);
    T.eq('  busy flag released', r.c.$page.variables.isSyncing, false);
  }
  {
    const r = await run('FULL', { unitsFail: true });
    T.eq('units endpoint fails: error', r.last.type, 'error');
    T.check('  says items were updated', /Items were updated/.test(r.last.message) && /HTTP 500/.test(r.last.message), r.last.message);
  }

  T.section('group lock (V387)');
  {
    const r = await run('FULL', { batches: 2 });
    const items = r.a.log.rest.filter(x => x.endpoint === 'ics/runFusionTableSync');
    T.eq('stock step gets the run\'s startTime', r.a.log.stockParams && r.a.log.stockParams.startTime, items[0].body.startTime);
    T.eq('every item batch shares it', new Set(items.map(x => x.body.startTime)).size, 1);
    T.eq('success: refresh-units released it, no extra release', r.a.log.released, undefined);
  }
  {
    const r = await run('FULL', { busy: true });
    T.eq('refused BUSY at batch 1: warning', r.last.type, 'warning');
    T.check('  friendly text', /^Another import or sync is running \(FETCH started 10:02\)/.test(r.last.message), r.last.message);
    T.eq('  never held it, so no release', r.a.log.released, undefined);
  }
  {
    const r = await run('FULL', { itemFail: true, failAtBatch: 2, batches: 3 });
    const st = r.a.log.rest.find(x => x.endpoint === 'ics/runFusionTableSync').body.startTime;
    T.eq('failed after a batch was accepted: releases with its own startTime', r.a.log.released && r.a.log.released.startTime, st);
  }
  {
    const r = await run('FULL', { units409: true });
    T.eq('refresh-units 409: warning', r.last.type, 'warning');
    T.check('  says what happened', /another import or sync took over/.test(r.last.message), r.last.message);
    T.check('  releases its own lock', !!r.a.log.released);
  }
  {
    const r = await run('FULL', { unitsFail: true });
    T.check('refresh-units 500: releases its own lock', !!r.a.log.released);
  }

  T.section('held items');
  {
    const r = await run('FULL', { counts: { itemsHeld: 2 } });
    T.check('looks up the open exceptions', r.a.log.rest.some(x => x.endpoint === 'eqp-v1/getFusionSyncExceptions' && x.uriParams.status === 'OPEN'));
    T.eq('warning', r.last.type, 'warning');
    T.check('names them', /2 items held: serial\/lot control changed in Fusion while it has units \(AS35001, CM4751126\)/.test(r.last.message), r.last.message);
  }

  T.section('summary wording');
  {
    const s = PM.syncSummary({ itemsChanged: 1, serials: 1 }, true, '', []);
    T.check('singular', /^1 item updated · 1 unit record refreshed/.test(s.message), s.message);
    T.check('nothing gone -> not mentioned', !/yard stock/.test(s.message));
    const w = PM.syncSummary({ stockWaiting: 4 }, true, '', []);
    T.check('stock waiting for import is mentioned', /4 stock rows wait for their item to be imported/.test(w.message), w.message);
  }

  T.section('contract');
  const api = H.readJson(path.join(H.SERVICES, 'eqp-v1', 'openapi3.json'));
  const ops = [];
  Object.values(api.paths).forEach(p => Object.values(p).forEach(o => o && o.operationId && ops.push(o.operationId)));
  ['refreshFusionSyncUnits', 'getFusionSyncExceptions'].forEach(op => T.check('openapi declares ' + op, ops.includes(op)));
  const pj = H.readJson(path.join(H.PAGES, 'equipment-master-page.json'));
  T.check('isSyncing declared', !!pj.variables.isSyncing);
  T.check('syncSummary declared', !!pj.functions.syncSummary);

  T.report();
})().catch(e => { console.error(e); process.exitCode = 1; });
