/*
 * Import chains — EXECUTED, not just read.
 *
 * The grid suite checks source text (does a chain mention promote, does it
 * name the three sync codes). That catches a deleted line; it cannot catch a
 * loop that never terminates, a failure reported as success, or a counter that
 * does not increment. This suite RUNS each chain against a fake Actions layer
 * and asserts on what it actually did.
 *
 * Covers ImportUnitsFromFusionChain, SaveStagingClassesChain and
 * ClearStagingChain.
 *
 * The invariants pinned here, each one a real bug:
 *
 *   - THE LIVE RESPONSE DOES NOT MATCH THE OPENAPI CONTRACT. The spec says
 *     statusCode 'S'/'E', rowsMerged an integer, hasMoreData 'Y'/'N'. What
 *     actually comes back is { "statusCode": "SUCCESS", "rowsMerged": "",
 *     "hasMoreData": "" } — a WORD, and empty strings for both numerics.
 *     Testing statusCode === 'E' would read a returned "ERROR" as success.
 *   - "ran but reported nothing" is NOT "nothing to import". On 2026-09-25 all
 *     three unit syncs returned SUCCESS with no row count and wrote no
 *     EQR_INT_RUN_LOG row at all — the BIP payload was 156 MB and OIC
 *     discarded it. A reassuring "nothing to import" cost hours.
 *   - rowsMerged is SUMMED across batches, and numeric STRINGS must add, not
 *     concatenate ('10' + '25' = '1025').
 *   - MAX_BATCHES terminates a stuck hasMoreData='Y'.
 *   - a failing sync stops the rest, and says earlier steps were kept —
 *     the merge is insert-only, so partial progress is safe and real.
 *   - the unit run NEVER calls promote: that is item-only, and calling it
 *     would report ITEM counts as unit results.
 *   - saving MUST promote. PATCH alone writes IMPORT_STATUS='MAPPED' and
 *     puts nothing in EQR_EQUIPMENT_MASTER; rows sat in MAPPED forever.
 *   - Clear Staging confirms first and deletes only unclassified rows.
 *
 * WHAT THIS CANNOT TELL YOU: whether the OIC endpoint exists, whether the
 * merge inserts anything, or whether a button renders. Those need the running
 * app and a live database.
 *
 * Run:  node tests/import-chains.test.js
 */
'use strict';

const H = require('./_harness.js');
const { check, eq, section, report } = H.makeAsserter();

/**
 * The REAL page functions (equipment-master-page.js), bound to one fresh page
 * module instance per context -- so chains call isBusy, pendingWorkCount,
 * buildImportBody, etc. exactly as the page does. A test overrides just the
 * ones it needs with Object.assign(c.$page.functions, {...}).
 */
function realPageFunctions() {
  const m = H.loadPageModule();
  const o = {};
  Object.getOwnPropertyNames(Object.getPrototypeOf(m)).forEach(k => {
    if (k !== 'constructor' && typeof m[k] === 'function') o[k] = m[k].bind(m);
  });
  return o;
}

/** A context whose page variables are a plain object, so assertions can read them. */
function ctx() {
  return { $page: { variables: {
    isImportingUnits: false,
    stagingSaving: false, stagingClearing: false, stagingSaveMessage: '',
    stagingChangedRows: {}, stagingArray: [], stagingTotalElements: 0,
    stagingPage: 0, equipmentSDP: { fake: true },
    functions: null
  }, functions: realPageFunctions() } };
}

/**
 * The page functions SaveStagingClassesChain calls through $page.functions --
 * the REAL ones from the page module, so a test exercises the same rules the
 * grid uses. `changed` is the edit map; every edited row is also TICKED (the
 * pre-2026-10-03 tests imported edited rows). `opts.rows` / `opts.ticked`
 * override the staged rows and the tick map for the selection tests.
 */
const PAGE = H.loadPageModule();
function withPageFunctions(c, changed, opts) {
  const o = opts || {};
  c.$page.variables.stagingChangedRows = changed || {};
  c.$page.variables.stagingArray = o.rows || Object.keys(changed || {}).map(k => ({
    fusionInventoryItemId: Number(k), importStatus: 'ERRORED',
    resolvedClassId: null, resolvedSubclassId: null }));
  c.$page.variables.stagingSelectedRows = o.ticked ||
    Object.keys(changed || {}).reduce((m, k) => { m[k] = true; return m; }, {});
  Object.assign(c.$page.functions, {
    buildImportBody: (sel, ch, rows) => PAGE.buildImportBody(sel, ch, rows),
    selectedCount: (m) => PAGE.selectedCount(m)
  });
  return c;
}

// Class/subclass fixtures for the P1 grid tests: SUB_A_T belongs to CLASS_A_T only.
const CLASS_A_T = 5, CLASS_B_T = 9, SUB_A_T = 12;
const CLASS_OPTIONS_T = [{ label: 'Excavator', value: CLASS_A_T }, { label: 'Truck', value: CLASS_B_T }];
const SUBCLASS_OPTIONS_T = [{ label: 'Mini Excavator', value: SUB_A_T, classId: CLASS_A_T },
                            { label: 'Light Truck', value: 21, classId: CLASS_B_T }];

const ok = (rows, more) => ({ ok: true, body: {
  statusCode: 'S', rowsMerged: rows, hasMoreData: more || 'N' } });

(async function main() {

  // ═══════════════════════════════════════════════════════════════════
  // ImportUnitsFromFusionChain
  // ═══════════════════════════════════════════════════════════════════

  section('unit import — one sync, single batch');
  {
    const a = H.makeActions(() => ok(7));
    const Chain = H.loadChain('ImportUnitsFromFusionChain', a.Actions);
    const c = ctx();
    const res = await new Chain().run(c, { syncCode: 'EQUIP_UNIT_ONHAND_SYNC' });

    eq('one REST call', a.calls.length, 1);
    eq('calls the OIC sync endpoint', a.calls[0].endpoint, 'ics/runFusionTableSync');
    eq('sends the requested syncCode', a.calls[0].body.syncCode, 'EQUIP_UNIT_ONHAND_SYNC');
    eq('batchNum starts at 1', a.calls[0].body.batchNum, 1);
    // FULL always: a delta watermark would strand any unit whose item was
    // classified AFTER the unit's own last change.
    eq('fullSyncFlag is Y', a.calls[0].body.fullSyncFlag, 'Y');
    check('startTime is sent', !!a.calls[0].body.startTime);
    eq('reports ok', res.ok, true);
    eq('reports the row count', res.total, 7);
    eq('raises no toast of its own', a.notifications.length, 0);
    eq('the busy flag is cleared', c.$page.variables.isImportingUnits, false);
  }

  section('unit import — batch loop');
  {
    // 3 batches: 10, 20, 5 -> 35. rowsMerged is documented as PER-BATCH, so
    // the chain must SUM rather than take the last value.
    const replies = [ok(10, 'Y'), ok(20, 'Y'), ok(5, 'N')];
    let i = 0;
    const a = H.makeActions(() => replies[i++]);
    const Chain = H.loadChain('ImportUnitsFromFusionChain', a.Actions);
    const res = await new Chain().run(ctx(), { syncCode: 'EQUIP_UNIT_SERIAL_SYNC' });

    eq('three calls', a.calls.length, 3);
    eq('batchNum increments', a.calls.map(x => x.body.batchNum).join(','), '1,2,3');
    eq('rows are SUMMED across batches', res.total, 35);
    check('startTime is shared by every batch',
      new Set(a.calls.map(x => x.body.startTime)).size === 1);
  }

  section('unit import — engine error inside HTTP 200');
  {
    // The engine returns 200 with an error in the BODY. A chain checking only
    // resp.ok would report a hollow success.
    const a = H.makeActions(() => ({ ok: true, body: {
      statusCode: 'E', statusMsg: 'ORA-30926 unable to get a stable set of rows' } }));
    const Chain = H.loadChain('ImportUnitsFromFusionChain', a.Actions);
    const c = ctx();
    const res = await new Chain().run(c, { syncCode: 'EQUIP_UNIT_SERIAL_SYNC' });

    eq('reports failure', res.ok, false);
    eq('stops after the failing batch', a.calls.length, 1);
    check('the engine message is returned for Fetch to show',
      /ORA-30926/.test(res.message || ''), res.message);
    eq('no toast of its own (Fetch reports it)', a.notifications.length, 0);
    eq('busy flag cleared even on failure', c.$page.variables.isImportingUnits, false);
  }

  section('unit import — transport failures');
  {
    const a = H.makeActions(() => null);
    const Chain = H.loadChain('ImportUnitsFromFusionChain', a.Actions);
    const c = ctx();
    const res = await new Chain().run(c, { syncCode: 'EQUIP_UNIT_LOT_SYNC' });
    eq('a null response is a failure', res.ok, false);
    check('says it could not reach the service', /could not reach/.test(res.message || ''), res.message);
  }
  {
    const a = H.makeActions(() => ({ ok: false, status: 500 }));
    const Chain = H.loadChain('ImportUnitsFromFusionChain', a.Actions);
    eq('a non-ok response is a failure',
       (await new Chain().run(ctx(), { syncCode: 'EQUIP_UNIT_LOT_SYNC' })).ok, false);
  }

  section('unit import — a stuck hasMoreData must terminate');
  {
    const a = H.makeActions(() => ok(1, 'Y'));
    const Chain = H.loadChain('ImportUnitsFromFusionChain', a.Actions);
    const c = ctx();
    const res = await new Chain().run(c, { syncCode: 'EQUIP_UNIT_SERIAL_SYNC' });
    eq('reports failure rather than hanging', res.ok, false);
    check('stopped at the guard', a.calls.length === 500, 'made ' + a.calls.length + ' calls');
    check('says it was stopped', /stopped after 500/.test(res.message || ''), res.message);
  }

  section('unit import — all three syncs in priority order');
  {
    const a = H.makeActions(o => ok(o.body.syncCode === 'EQUIP_UNIT_ONHAND_SYNC' ? 12 : 0));
    const Chain = H.loadChain('ImportUnitsFromFusionChain', a.Actions);
    const res = await new Chain().run(ctx(), {});
    eq('four calls: three stock syncs, then asset groups', a.calls.length, 4);
    eq('serial, then lot, then on-hand, then groups',
       a.calls.map(x => x.body.syncCode).join(' '),
       'EQUIP_UNIT_SERIAL_SYNC EQUIP_UNIT_LOT_SYNC EQUIP_UNIT_ONHAND_SYNC EQUIP_ASSET_GROUP_SYNC');
    eq('total is the sum across syncs', res.total, 12);
    check('startTime is shared across EVERY sync (group lock)',
      new Set(a.calls.map(x => x.body.startTime)).size === 1);
  }

  section('unit import — asset groups never change the stock result');
  {
    // Sync turns ok into its snapshot flag. A group failure must not stop
    // units being marked gone, and group rows are not stock rows.
    const a = H.makeActions(o => o.body.syncCode === 'EQUIP_ASSET_GROUP_SYNC'
      ? { ok: true, body: { statusCode: 'E', statusMsg: 'ORA-00942' } } : ok(5));
    const Chain = H.loadChain('ImportUnitsFromFusionChain', a.Actions);
    const res = await new Chain().run(ctx(), {});
    eq('stock still ok', res.ok, true);
    eq('total is stock only', res.total, 15);
    eq('groups reported apart', res.groups && res.groups.ok, false);
    check('group error kept for the caller', /ORA-00942/.test(res.groups && res.groups.message || ''));
  }
  {
    const a = H.makeActions(o => ok(o.body.syncCode === 'EQUIP_ASSET_GROUP_SYNC' ? 28 : 1));
    const Chain = H.loadChain('ImportUnitsFromFusionChain', a.Actions);
    const res = await new Chain().run(ctx(), {});
    eq('group rows not in the stock total', res.total, 3);
    eq('group rows returned on groups', res.groups && res.groups.rows, 28);
  }
  {
    const a = H.makeActions(() => ok(28));
    const Chain = H.loadChain('ImportUnitsFromFusionChain', a.Actions);
    const res = await new Chain().run(ctx(), { syncCode: 'EQUIP_ASSET_GROUP_SYNC' });
    eq('debug path can run the group sync alone', a.calls.map(x => x.body.syncCode).join(' '),
       'EQUIP_ASSET_GROUP_SYNC');
    eq('and reports its rows', res.total, 28);
  }
  {
    const a = H.makeActions(() => ok(2));
    const Chain = H.loadChain('ImportUnitsFromFusionChain', a.Actions);
    await new Chain().run(ctx(), { syncCode: 'EQUIP_UNIT_SERIAL_SYNC' });
    eq('a single stock sync does not drag in groups', a.calls.length, 1);
  }

  section('unit import — a failing sync stops the rest');
  {
    const a = H.makeActions(o => o.body.syncCode === 'EQUIP_UNIT_LOT_SYNC'
      ? { ok: true, body: { statusCode: 'E', statusMsg: 'boom' } } : ok(3));
    const Chain = H.loadChain('ImportUnitsFromFusionChain', a.Actions);
    const c = ctx();
    const res = await new Chain().run(c, {});
    eq('stops at the failure', a.calls.length, 2);
    eq('on-hand never runs',
       a.calls.filter(x => x.body.syncCode === 'EQUIP_UNIT_ONHAND_SYNC').length, 0);
    eq('nor asset groups',
       a.calls.filter(x => x.body.syncCode === 'EQUIP_ASSET_GROUP_SYNC').length, 0);
    eq('reports failure', res.ok, false);
    // Insert-only, so rows already written are safe to keep and a re-run skips
    // them. The message must not imply a rollback that did not happen.
    check('says earlier steps were kept', /kept/i.test(res.message || ''), res.message);
  }

  section('unit import — THE REAL RESPONSE SHAPE (measured 2026-09-25)');
  {
    // Exactly the body captured from the failing run.
    const a = H.makeActions(() => ({ ok: true, body: {
      statusCode: 'SUCCESS', statusMsg: 'Sync completed',
      rowsMerged: '', hasMoreData: '' } }));
    const Chain = H.loadChain('ImportUnitsFromFusionChain', a.Actions);
    const c = ctx();
    const res = await new Chain().run(c, { syncCode: 'EQUIP_UNIT_ONHAND_SYNC' });

    eq('one call, loop ended', a.calls.length, 1);
    // rowsMerged:'' means the merge never reported. NOT the same as a real
    // zero, and it must not read as "nothing to import".
    eq('reports failure, not a quiet zero', res.ok, false);
    eq('reason names the missing row count', res.reason, 'NO_ROW_COUNT');
    check('message points at the report path', /BI_DATA_MODEL_PATH/.test(res.message || ''), res.message);
  }
  {
    // A word-form error must abort. statusCode === 'E' would miss it.
    const a = H.makeActions(() => ({ ok: true, body: {
      statusCode: 'ERROR', statusMsg: 'ORA-00942: table or view does not exist' } }));
    const Chain = H.loadChain('ImportUnitsFromFusionChain', a.Actions);
    const c = ctx();
    const res = await new Chain().run(c, { syncCode: 'EQUIP_UNIT_LOT_SYNC' });
    eq('"ERROR" is treated as a failure', res.ok, false);
    check('the ORA- text is returned', /ORA-00942/.test(res.message || ''), res.message);
  }
  {
    // Numeric strings must add, not concatenate: '10' + '25' would be '1025'.
    const replies = [
      { ok: true, body: { statusCode: 'SUCCESS', rowsMerged: '10', hasMoreData: 'Y' } },
      { ok: true, body: { statusCode: 'SUCCESS', rowsMerged: '25', hasMoreData: 'N' } }];
    let i = 0;
    const a = H.makeActions(() => replies[i++]);
    const Chain = H.loadChain('ImportUnitsFromFusionChain', a.Actions);
    eq('numeric strings are ADDED, not concatenated',
       (await new Chain().run(ctx(), { syncCode: 'EQUIP_UNIT_ONHAND_SYNC' })).total, 35);
  }
  {
    const a = H.makeActions(() => ({ ok: true, body: {
      statusCode: 'SUCCESS', rowsMerged: 'n/a', hasMoreData: 'N' } }));
    const Chain = H.loadChain('ImportUnitsFromFusionChain', a.Actions);
    const c = ctx();
    const res = await new Chain().run(c, { syncCode: 'EQUIP_UNIT_ONHAND_SYNC' });
    check('a non-numeric count does not produce NaN', !isNaN(res.total), 'total was ' + res.total);
    check('and the progress line never says NaN',
      !/NaN/.test(c.$page.variables.importMessage || ''));
  }

  section('unit import — zero rows is ok, not an error');
  {
    // Stock is STAGED whether or not its item is classified, so zero means the
    // equipment yards hold no stock -- not "items are unclassified".
    const a = H.makeActions(() => ok(0));
    const Chain = H.loadChain('ImportUnitsFromFusionChain', a.Actions);
    const c = ctx();
    const res = await new Chain().run(c, {});
    eq('still reports ok', res.ok, true);
    eq('total is zero', res.total, 0);
    check('no failure message', !res.message, res.message);
    eq('no toast of its own', a.notifications.length, 0);
  }

  section('unit import — reports to Fetch, never on its own');
  {
    const a = H.makeActions(() => ok(7));
    const Chain = H.loadChain('ImportUnitsFromFusionChain', a.Actions);
    const c = ctx();
    c.$page.variables.importMessage = '';
    const res = await new Chain().run(c);
    eq('returns ok', res.ok, true);
    eq('returns the staged total (7 x 3 syncs)', res.total, 21);
    eq('raises no toast of its own', a.notifications.length, 0);
    check('progress went to Fetch\'s status line', /Importing/.test(c.$page.variables.importMessage),
      c.$page.variables.importMessage);
    eq('clears its busy flag', c.$page.variables.isImportingUnits, false);
  }
  {
    // A failure is RETURNED (Fetch reports it), never toasted.
    const a = H.makeActions(() => ({ ok: false }));
    const Chain = H.loadChain('ImportUnitsFromFusionChain', a.Actions);
    const c = ctx();
    const res = await new Chain().run(c);
    eq('failure is not ok', res.ok, false);
    check('failure carries a message', !!res.message, JSON.stringify(res));
    eq('failure raises no toast', a.notifications.length, 0);
  }

  section('unit import — re-entrancy and bad input');
  {
    const a = H.makeActions(() => ok(1));
    const Chain = H.loadChain('ImportUnitsFromFusionChain', a.Actions);
    const c = ctx();
    c.$page.variables.isImportingUnits = true;      // a run already in flight
    const res = await new Chain().run(c, {});
    eq('refuses to start a second run', res.ok, false);
    eq('reason is BUSY', res.reason, 'BUSY');
    eq('no REST call is made', a.calls.length, 0);
    // The guard must NOT clear a flag it did not set, or the next click runs
    // while the first is still going.
    eq('leaves the in-flight flag alone', c.$page.variables.isImportingUnits, true);
  }
  {
    const a = H.makeActions(() => ok(1));
    const Chain = H.loadChain('ImportUnitsFromFusionChain', a.Actions);
    const res = await new Chain().run(ctx(), { syncCode: 'NOT_A_REAL_SYNC' });
    eq('unknown syncCode is refused', res.ok, false);
    eq('reason is UNKNOWN_SYNC_CODE', res.reason, 'UNKNOWN_SYNC_CODE');
    eq('no REST call is made', a.calls.length, 0);
  }

  section('unit import — the item import is NOT touched');
  {
    // The stock chain only STAGES. Promotion (items, then their stock) is
    // Fetch's job (ImportFromFusionChain), done once after all four syncs.
    const a = H.makeActions(() => ok(4));
    const Chain = H.loadChain('ImportUnitsFromFusionChain', a.Actions);
    await new Chain().run(ctx(), {});
    check('never calls promoteEquipmentImport',
      !a.calls.some(x => /promote/i.test(x.endpoint || '')),
      a.calls.map(x => x.endpoint).join(', '));
    check('only ever calls the OIC sync endpoint',
      a.calls.every(x => x.endpoint === 'ics/runFusionTableSync'));
    check('source does not call promote either',
      H.chainCode('ImportUnitsFromFusionChain').indexOf('promoteEquipmentImport') === -1);
  }

  // ═══════════════════════════════════════════════════════════════════
  // SaveStagingClassesChain
  // ═══════════════════════════════════════════════════════════════════

  section('save — PATCH then PROMOTE');
  {
    // Saving writes IMPORT_STATUS='MAPPED'. That alone puts NOTHING in
    // EQR_EQUIPMENT_MASTER: promotion is a separate step, and this is the only
    // place that can call it after a human classifies. It shipped without it,
    // and rows sat in MAPPED forever.
    const a = H.makeActions(o => o.endpoint.indexOf('promote') !== -1
      ? { ok: true, body: { promoted: 1 } }
      : { ok: true, body: { updated: 1, failed: [] } });
    const Chain = H.loadChain('SaveStagingClassesChain', a.Actions);
    const c = withPageFunctions(ctx(), { '1': { fusionInventoryItemId: 1, resolvedClassId: 5 } });
    const res = await new Chain().run(c);

    eq('reports ok', res.ok, true);
    eq('two calls: patch then promote', a.calls.length, 2);
    check('first is the assignments PATCH',
      a.calls[0].endpoint.indexOf('patchEquipmentImportStagingAssignments') !== -1);
    check('second is promote', a.calls[1].endpoint.indexOf('promoteEquipmentImport') !== -1);
    eq('promoted count reported', res.promoted, 1);
    check('the grid is reloaded afterwards',
      a.chainCalls.some(x => x.chain === 'LoadStagingChain'));
  }

  section('save — a promote failure is not a save failure');
  {
    // The assignments ARE saved; only promotion failed. Saying "save failed"
    // would send the user to redo work that is already persisted.
    const a = H.makeActions(o => o.endpoint.indexOf('promote') !== -1
      ? { ok: false, status: 500 }
      : { ok: true, body: { updated: 2, failed: [] } });
    const Chain = H.loadChain('SaveStagingClassesChain', a.Actions);
    const c = withPageFunctions(ctx(), {
      '1': { fusionInventoryItemId: 1, resolvedClassId: 5 },
      '2': { fusionInventoryItemId: 2, resolvedClassId: 9 } });
    const res = await new Chain().run(c);

    eq('still reports ok', res.ok, true);
    check('says the rows were confirmed', /confirmed/i.test(c.$page.variables.stagingSaveMessage));
    check('tells the user to retry the import',
      /again to retry/i.test(c.$page.variables.stagingSaveMessage),
      c.$page.variables.stagingSaveMessage);
    check('warned, not errored', a.notifications.some(n => n.type === 'warning'));
  }

  section('save — promote refused because a Fetch / Sync holds the lock (409)');
  {
    const a = H.makeActions(o => o.endpoint.indexOf('promote') !== -1
      ? { ok: false, status: 409 }
      : { ok: true, body: { updated: 1, failed: [] } });
    const c = withPageFunctions(ctx(), { '1': { fusionInventoryItemId: 1, resolvedClassId: 5 } });
    await new (H.loadChain('SaveStagingClassesChain', a.Actions))().run(c);
    check('says another run is in progress and to Import again after',
      /Another import or sync is running — press Import again\s+when it finishes/.test(c.$page.variables.stagingSaveMessage),
      c.$page.variables.stagingSaveMessage);
  }

  section('save — nothing to do, and failures');
  {
    const a = H.makeActions(() => ok(1));
    const Chain = H.loadChain('SaveStagingClassesChain', a.Actions);
    // class-less entries are dropped by buildImportBody, so this is empty
    const c = withPageFunctions(ctx(), { '1': { fusionInventoryItemId: 1, resolvedClassId: null } });
    const res = await new Chain().run(c);
    eq('refuses an empty body', res.ok, false);
    eq('reason is EMPTY', res.reason, 'EMPTY');
    eq('no REST call is made', a.calls.length, 0);
    check('says what to do', /Set a Class/i.test(c.$page.variables.stagingSaveMessage),
      c.$page.variables.stagingSaveMessage);
  }
  {
    const a = H.makeActions(() => ({ ok: false, status: 500 }));
    const Chain = H.loadChain('SaveStagingClassesChain', a.Actions);
    const c = withPageFunctions(ctx(), { '1': { fusionInventoryItemId: 1, resolvedClassId: 5 } });
    const res = await new Chain().run(c);
    eq('a failed PATCH is a failure', res.ok, false);
    eq('promote is never reached', a.calls.length, 1);
    eq('busy flag cleared', c.$page.variables.stagingSaving, false);
  }

  section('save — failed rows keep their pending edit');
  {
    // A failed row must stay dirty so the user can see and retry it, rather
    // than being discarded along with the successful ones.
    const a = H.makeActions(o => o.endpoint.indexOf('promote') !== -1
      ? { ok: true, body: { promoted: 1 } }
      : { ok: true, body: { updated: 1, failed: [ { fusionInventoryItemId: 2,
                                                    reason: 'ALREADY_MERGED' } ] } });
    const Chain = H.loadChain('SaveStagingClassesChain', a.Actions);
    const c = withPageFunctions(ctx(), {
      '1': { fusionInventoryItemId: 1, resolvedClassId: 5 },
      '2': { fusionInventoryItemId: 2, resolvedClassId: 9 } });
    await new Chain().run(c);

    const left = Object.keys(c.$page.variables.stagingChangedRows);
    eq('only the failed row stays pending', left.join(','), '2');
    check('the reason reaches the user',
      /ALREADY_MERGED/.test(c.$page.variables.stagingSaveMessage),
      c.$page.variables.stagingSaveMessage);
  }

  section('import — exactly the TICKED rows, with their class');
  {
    // Fetch only suggests (AUTO_MAPPED). A ticked suggestion is imported with
    // the class already on the row; an edited row that is NOT ticked is not.
    const a = H.makeActions(o => o.endpoint.indexOf('promote') !== -1
      ? { ok: true, body: { promoted: 2 } }
      : { ok: true, body: { updated: 2, failed: [] } });
    const Chain = H.loadChain('SaveStagingClassesChain', a.Actions);
    const rows = [
      { fusionInventoryItemId: 1, importStatus: 'AUTO_MAPPED', resolvedClassId: 1000000137, resolvedSubclassId: 1000000133 },
      { fusionInventoryItemId: 2, importStatus: 'ERRORED',     resolvedClassId: null, resolvedSubclassId: null },
      { fusionInventoryItemId: 3, importStatus: 'ERRORED',     resolvedClassId: null, resolvedSubclassId: null },
      { fusionInventoryItemId: 4, importStatus: 'MERGED',      resolvedClassId: 5, resolvedSubclassId: null }
    ];
    const edits = {
      '2': { fusionInventoryItemId: 2, resolvedClassId: 9, resolvedSubclassId: 21 },   // ticked
      '3': { fusionInventoryItemId: 3, resolvedClassId: 9, resolvedSubclassId: null }  // NOT ticked
    };
    const c = withPageFunctions(ctx(), edits, { rows: rows, ticked: { '1': true, '2': true, '4': true } });
    await new Chain().run(c);

    const patch = a.calls.find(x => /patchEquipmentImportStagingAssignments/.test(x.endpoint));
    const sent = (patch && patch.body.assignments) || [];
    eq('two rows sent (the ticked, importable ones)', sent.length, 2);
    const r1 = sent.find(x => x.fusionInventoryItemId === 1) || {};
    eq('ticked auto-mapped row keeps its suggested class', r1.resolvedClassId, 1000000137);
    eq('... and subclass', r1.resolvedSubclassId, 1000000133);
    const r2 = sent.find(x => x.fusionInventoryItemId === 2) || {};
    eq('ticked edited row sends the edit', r2.resolvedClassId, 9);
    check('unticked edited row is NOT sent', !sent.some(x => x.fusionInventoryItemId === 3));
    check('MERGED row is never sent', !sent.some(x => x.fusionInventoryItemId === 4));
    check('promote follows the PATCH', a.calls.some(x => /promoteEquipmentImport/.test(x.endpoint)));
    check('unticked edit stays pending', !!c.$page.variables.stagingChangedRows['3']);
    eq('ticks cleared after a clean import', Object.keys(c.$page.variables.stagingSelectedRows).length, 0);
  }
  {
    // Ticked rows with no class: nothing sent, and the user is told why.
    const a = H.makeActions(() => ok(1));
    const Chain = H.loadChain('SaveStagingClassesChain', a.Actions);
    const rows = [{ fusionInventoryItemId: 7, importStatus: 'ERRORED', resolvedClassId: null }];
    const c = withPageFunctions(ctx(), {}, { rows: rows, ticked: { '7': true } });
    const res = await new Chain().run(c);
    eq('refused', res.reason, 'EMPTY');
    eq('no REST call', a.calls.length, 0);
    check('names the missing class', /no Class/.test(c.$page.variables.stagingSaveMessage),
      c.$page.variables.stagingSaveMessage);
  }

  section('selection helpers — the grid rules Import relies on');
  {
    const vars = { stagingArray: [
      { fusionInventoryItemId: 11, importStatus: 'AUTO_MAPPED' },
      { fusionInventoryItemId: 12, importStatus: 'MERGED' },
      { fusionInventoryItemId: 13, importStatus: 'ERRORED' } ], stagingSelectedRows: {} };
    PAGE.buildStagingGrid(vars.stagingArray, vars);      // builds the row-key map
    eq('MERGED row cannot be ticked', PAGE.canSelect(1, vars), false);
    eq('AUTO_MAPPED row can be ticked', PAGE.canSelect(0, vars), true);
    let sel = PAGE.toggleRowSelection(0, true, vars);
    eq('tick records the merge key', Object.keys(sel).join(','), '11');
    vars.stagingSelectedRows = PAGE.toggleRowSelection(1, true, Object.assign({}, vars, { stagingSelectedRows: sel }));
    eq('ticking a MERGED row is a no-op', Object.keys(vars.stagingSelectedRows).join(','), '11');
    vars.stagingSelectedRows = PAGE.setPageSelection(true, vars);
    eq('select-all skips MERGED', Object.keys(vars.stagingSelectedRows).sort().join(','), '11,13');
    eq('all-on-page detected', PAGE.allOnPageSelected(vars), true);
    vars.stagingSelectedRows = PAGE.setPageSelection(false, vars);
    eq('unselect-all clears', PAGE.selectedCount(vars.stagingSelectedRows), 0);
    const g = PAGE.buildStagingGrid(vars.stagingArray, Object.assign({}, vars, { stagingSelectedRows: { '13': true } }));
    eq('grid draws the tick from the map', g.params.data[2][0].data, true);
    eq('unticked row draws unticked', g.params.data[0][0].data, false);
    eq('tick column type', PAGE.getColumnType(0), 'select');
  }

  section('fetch — auto-mapped rows are reported, not merged');
  {
    const notes = 'mapped=0 ambiguous=0 unmapped=0 noUnitPath=0 errored=4775 autoMapped=44 ' +
                  'promoted=0 serials=0 lots=0 onhand=295 stockWaiting=17887 precedence=MAINTENANCE,INVENTORY';
    const a = H.makeActions((opts) =>
      /promote/.test(opts.endpoint) ? { ok: true, body: { mapped: 0, promoted: 0, notes: 'mapped=0 promoted=0' } }
      : /getJobRunLogs/.test(opts.endpoint) ? { ok: true, body: { data: [{ notes: notes }] } }
      : ok(3, 'N'));
    const Chain = H.loadChain('ImportFromFusionChain', a.Actions);
    const c = fetchCtx();
    await new Chain().run(c);
    const m = c.$page.variables.importMessage;
    check('says how many were auto-mapped and what to do', /44 auto-mapped .*tick them and click Import/.test(m), m);
    check('does not claim anything was imported', !/imported to the equipment master/.test(m), m);
  }

  // ═══════════════════════════════════════════════════════════════════
  // ClearStagingChain
  // ═══════════════════════════════════════════════════════════════════

  section('clear staging — confirms first, deletes only unclassified');
  {
    const a = H.makeActions(() => ({ ok: true, body:
      { deleted: 4770, keptMapped: 2, keptMerged: 136 } }));
    const Chain = H.loadChain('ClearStagingChain', a.Actions);
    const c = withPageFunctions(ctx(), {});
    c.$page.variables.stagingTotalElements = 4908;

    // window.confirm does not exist under node; the chain must be driven
    // through it explicitly.
    global.window = { confirm: () => true };
    const res = await new Chain().run(c);
    delete global.window;

    eq('reports ok', res.ok, true);
    eq('one REST call', a.calls.length, 1);
    check('calls the delete endpoint',
      a.calls[0].endpoint.indexOf('clearEquipmentImportStaging') !== -1);
    eq('reports what was deleted', res.deleted, 4770);
    // Reporting what was KEPT is the point: the user needs to see their
    // classified work survived.
    check('message names what was kept', /kept/i.test(c.$page.variables.stagingSaveMessage),
      c.$page.variables.stagingSaveMessage);
    check('reloads afterwards', a.chainCalls.some(x => x.chain === 'LoadStagingChain'));
    eq('pending edits dropped', Object.keys(c.$page.variables.stagingChangedRows).length, 0);
    eq('paging reset to the first page', c.$page.variables.stagingPage, 0);
  }

  section('clear staging — cancelling deletes nothing');
  {
    const a = H.makeActions(() => ({ ok: true, body: { deleted: 1 } }));
    const Chain = H.loadChain('ClearStagingChain', a.Actions);
    const c = withPageFunctions(ctx(), {});
    c.$page.variables.stagingTotalElements = 10;

    global.window = { confirm: () => false };
    const res = await new Chain().run(c);
    delete global.window;

    eq('refuses when cancelled', res.ok, false);
    eq('reason is CANCELLED', res.reason, 'CANCELLED');
    eq('NO delete call is made', a.calls.length, 0);
  }

  section('clear staging — empty staging is a no-op');
  {
    const a = H.makeActions(() => ({ ok: true, body: { deleted: 0 } }));
    const Chain = H.loadChain('ClearStagingChain', a.Actions);
    const c = withPageFunctions(ctx(), {});
    c.$page.variables.stagingTotalElements = 0;
    const res = await new Chain().run(c);
    eq('refuses on empty staging', res.ok, false);
    eq('reason is EMPTY', res.reason, 'EMPTY');
    eq('no REST call is made', a.calls.length, 0);
  }

  // ═══════════════════════════════════════════════════════════════════

  section('the FULL sync must not wipe classified rows');
  {
    // It was an unconditional DELETE until 2026-09-25 -- every nightly run
    // destroyed whatever a person had classified but not yet promoted, and it
    // took 5,266 staged rows with it.
    const fs = require('fs');
    const path = require('path');
    const pkg = path.join(__dirname, '..', 'db', 'item-import', 'EQR_ITEM_IMPORT_MERGE_PKG.sql');
    if (fs.existsSync(pkg)) {
      const src = fs.readFileSync(pkg, 'utf8');
      check('FULL sync DELETE is scoped to unclassified rows',
        /DELETE FROM EQR_EQUIPMENT_MASTER_T[\s\S]{0,40}?WHERE RESOLVED_CLASS_ID IS NULL/.test(src),
        'an unconditional DELETE here destroys human classification work');
      check('no unconditional DELETE of staging remains',
        !/DELETE FROM EQR_EQUIPMENT_MASTER_T\s*;/.test(src));
    } else {
      check('merge package present to check', false, pkg + ' not found');
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // FETCH (ImportFromFusionChain): items -> stock -> promote
  // ═══════════════════════════════════════════════════════════════════
  function fetchCtx() {
    const c = ctx();
    Object.assign(c.$page.variables, {
      isImporting: false, importDialogOpen: true, importPhase: '', importMessage: '',
      importWarning: '', selectedItemClass: 'ROOT_ICC', selectedItemType: 'FG'
    });
    return c;
  }
  const promoteBody = {
    mapped: 3, ambiguous: 0, unmapped: 1, noUnitPath: 0, promoted: 3,
    notes: 'mapped=3 ambiguous=0 unmapped=1 noUnitPath=0 errored=5 promoted=3 ' +
           'serials=4 lots=2 onhand=6 stockWaiting=9 precedence=MAINTENANCE,INVENTORY'
  };
  const fetchResponder = (items) => (opts) => /promote/.test(opts.endpoint)
    ? { ok: true, body: promoteBody }
    : ok(items, 'N');

  section('fetch — group lock (V387)');
  {
    const a = H.makeActions(fetchResponder(5));
    const c = fetchCtx();
    await new (H.loadChain('ImportFromFusionChain', a.Actions))().run(c);
    const st = a.calls.find(x => x.endpoint === 'ics/runFusionTableSync').body.startTime;
    const stock = a.chainCalls.find(x => x.chain === 'ImportUnitsFromFusionChain');
    eq('stock step gets the run\'s startTime', stock && stock.params && stock.params.startTime, st);
    check('success: promote released it, no extra release', !a.chainCalls.some(x => x.chain === 'ReleaseSyncLockChain'));
  }
  {
    const a = H.makeActions(() => ({ ok: true, body: { statusCode: 'E', statusMsg: 'BUSY: SYNC started 09:40' } }));
    const c = fetchCtx();
    await new (H.loadChain('ImportFromFusionChain', a.Actions))().run(c);
    check('BUSY at batch 1: friendly message', /^Another import or sync is running \(SYNC started 09:40\)/.test(c.$page.variables.importMessage),
      c.$page.variables.importMessage);
    check('  never held it, so no release', !a.chainCalls.some(x => x.chain === 'ReleaseSyncLockChain'));
  }
  {
    // 2026-10-09: the server takes the lock at the START of batch 1, then
    // batch 1 died on ORA-31011. The run must release it, or it blocks every
    // Fetch for 20 minutes.
    const a = H.makeActions(() => ({ ok: true, body: { statusCode: 'E', statusMsg: 'ORA-31011: XML parsing failed' } }));
    const c = fetchCtx();
    await new (H.loadChain('ImportFromFusionChain', a.Actions))().run(c);
    const st = a.calls.find(x => x.endpoint === 'ics/runFusionTableSync').body.startTime;
    const rel = a.chainCalls.find(x => x.chain === 'ReleaseSyncLockChain');
    eq('batch 1 fails (not BUSY): releases with its own startTime', rel && rel.params.startTime, st);
  }
  {
    const a = H.makeActions(() => null);
    const c = fetchCtx();
    await new (H.loadChain('ImportFromFusionChain', a.Actions))().run(c);
    check('batch 1 unreachable: releases too (the call may have reached the server)',
      a.chainCalls.some(x => x.chain === 'ReleaseSyncLockChain'));
  }
  {
    const a = H.makeActions(o => /promote/.test(o.endpoint) ? { ok: false, status: 500 } : ok(5, 'N'));
    const c = fetchCtx();
    await new (H.loadChain('ImportFromFusionChain', a.Actions))().run(c);
    const st = a.calls.find(x => x.endpoint === 'ics/runFusionTableSync').body.startTime;
    const rel = a.chainCalls.find(x => x.chain === 'ReleaseSyncLockChain');
    eq('promote failed: releases with its own startTime', rel && rel.params.startTime, st);
  }
  {
    const a = H.makeActions(o => /promote/.test(o.endpoint) ? { ok: false, status: 409 } : ok(5, 'N'));
    const c = fetchCtx();
    await new (H.loadChain('ImportFromFusionChain', a.Actions))().run(c);
    check('promote 409: says another run took over', /took over/.test(c.$page.variables.importMessage), c.$page.variables.importMessage);
  }
  {
    const r = H.makeActions(() => ({ ok: true }));
    await new (H.loadChain('ReleaseSyncLockChain', r.Actions))().run({}, { startTime: '2026-10-06T10:00:00' });
    eq('release calls DELETE /fusion-sync/lock', r.calls[0].endpoint, 'eqp-v1/releaseFusionSyncLock');
    eq('  with its own startTime', r.calls[0].uriParams.startTime, '2026-10-06T10:00:00');
    const n = H.makeActions(() => ({ ok: true }));
    await new (H.loadChain('ReleaseSyncLockChain', n.Actions))().run({}, {});
    eq('  never without one (it would drop someone else\'s lock)', n.calls.length, 0);
  }

  section('fetch — runs stock and promote even when no item rows came back');
  {
    // Items already in the master are never re-staged, so 0 item rows is normal
    // on a re-Fetch -- and their stock still has to be fetched and promoted.
    const a = H.makeActions(fetchResponder(0));
    const Chain = H.loadChain('ImportFromFusionChain', a.Actions);
    const c = fetchCtx();
    await new Chain().run(c);
    const stockCall = a.chainCalls.find(x => x.chain === 'ImportUnitsFromFusionChain');
    check('runs the stock stage', !!stockCall, JSON.stringify(a.chainCalls));
    check('promote is called with 0 item rows',
      a.calls.some(x => x.endpoint === 'eqp-v1/promoteEquipmentImport'),
      a.calls.map(x => x.endpoint).join(', '));
    // RunInProgressChain (the other-tab check) runs first; the stock stage is
    // the first chain of the run itself.
    check('stock runs BEFORE promote (FA / Maintenance values arrive with stock)',
      a.chainCalls.filter(x => x.chain !== 'RunInProgressChain').indexOf(stockCall) === 0);
    eq('phase is DONE', c.$page.variables.importPhase, 'DONE');
  }

  section('fetch — reports errored items and stock from the promote notes');
  {
    const a = H.makeActions(fetchResponder(12));
    const Chain = H.loadChain('ImportFromFusionChain', a.Actions);
    const c = fetchCtx();
    await new Chain().run(c);
    const m = c.$page.variables.importMessage;
    check('names the errored items', /5 errored/.test(m), m);
    check('counts errored as needing review (5 + 1 unmapped)', /6 need review/.test(m), m);
    check('reports promoted stock', /4 serials, 2 lots, 6 on-hand/.test(m), m);
    check('reports stock waiting for its item', /9 waiting/.test(m), m);
    check('warns, since rows need review',
      a.notifications.some(n => n.type === 'warning'));
  }

  section('fetch — extended counts come from the job log when promote omits them');
  {
    // Real shape, 2026-10-02: the promote endpoint returns its OWN notes, without
    // errored= or the stock counts; resolve_and_promote's job-log row has them.
    const realPromote = { mapped: 17, ambiguous: 0, unmapped: 0, noUnitPath: 0, promoted: 17,
      notes: 'mapped=17 ambiguous=0 unmapped=0 noUnitPath=0 promoted=17' };
    const jobNotes = 'mapped=17 ambiguous=0 unmapped=0 noUnitPath=0 errored=4802 promoted=17 ' +
      'serials=0 lots=0 onhand=247 stockWaiting=17935 precedence=FIXED_ASSET,INVENTORY';
    const a = H.makeActions((opts) =>
      /promote/.test(opts.endpoint) ? { ok: true, body: realPromote }
      : /getJobRunLogs/.test(opts.endpoint) ? { ok: true, body: { data: [{ notes: jobNotes }] } }
      : ok(3, 'N'));
    const Chain = H.loadChain('ImportFromFusionChain', a.Actions);
    const c = fetchCtx();
    await new Chain().run(c);
    const m = c.$page.variables.importMessage;
    check('reads the job log', a.calls.some(x => /getJobRunLogs/.test(x.endpoint)));
    check('reports the 247 promoted on-hand rows', /0 serials, 0 lots, 247 on-hand/.test(m), m);
    check('reports the errored items', /4802 errored/.test(m), m);
    check('reports stock waiting for its item', /17935 waiting/.test(m), m);
    check('typed promoted count still wins', /17 previously confirmed items imported/.test(m), m);
  }

  section('review grid — status filter is sent to the server and labelled');
  {
    const a = H.makeActions(() => ({ ok: true, body: { totalElements: 2, items: [
      { fusionInventoryItemId: 1, importStatus: 'ERRORED' },
      { fusionInventoryItemId: 2, importStatus: 'ERRORED' } ] } }));
    const Chain = H.loadChain('LoadStagingChain', a.Actions);
    const c = ctx();
    c.$page.variables.selectedImportStatus = 'ERRORED';
    Object.assign(c.$page.functions, { buildStagingGrid: () => ({}) });
    await new Chain().run(c);
    const call = a.calls.find(x => x.endpoint === 'eqp-v1/getEquipmentImportStaging');
    eq('importStatus sent as a server-side filter', call && call.uriParams.importStatus, 'ERRORED');
    check('no other filter sent when unset', call && !('itemClass' in call.uriParams) && !('itemType' in call.uriParams));
    check('summary names the status', /matching ERRORED/.test(c.$page.variables.stagingSummary),
      c.$page.variables.stagingSummary);
    check('no false "filter not applied" warning', !/not applied/.test(c.$page.variables.stagingSummary));
  }
  {
    // A server ignoring the filter returns other statuses: say so.
    const a = H.makeActions(() => ({ ok: true, body: { totalElements: 2, items: [
      { fusionInventoryItemId: 1, importStatus: 'ERRORED' },
      { fusionInventoryItemId: 2, importStatus: 'MERGED' } ] } }));
    const Chain = H.loadChain('LoadStagingChain', a.Actions);
    const c = ctx();
    c.$page.variables.selectedImportStatus = 'ERRORED';
    Object.assign(c.$page.functions, { buildStagingGrid: () => ({}) });
    await new Chain().run(c);
    check('warns when the server did not filter by status', /not applied/.test(c.$page.variables.stagingSummary),
      c.$page.variables.stagingSummary);
  }
  {
    const html = H.readPageFile('equipment-master-page.html');
    const sel = (html.match(/<oj-select-single id="importStatusFilter"[\s\S]*?<\/oj-select-single>/) || [''])[0];
    check('status dropdown reloads the grid on change', /onImportFilterChanged/.test(sel), sel);
    check('status dropdown does not wait on the Fusion LOVs', sel && !/lovsLoading/.test(sel), sel);
  }

  section('fetch — never sends the review filter to OIC');
  {
    const a = H.makeActions(fetchResponder(1));
    const Chain = H.loadChain('ImportFromFusionChain', a.Actions);
    await new Chain().run(fetchCtx());
    const syncCalls = a.calls.filter(x => x.endpoint === 'ics/runFusionTableSync');
    check('item sync called', syncCalls.length > 0);
    check('no itemClass / itemType in the sync body (OIC drops them)',
      syncCalls.every(x => !('itemClass' in x.body) && !('itemType' in x.body)),
      JSON.stringify(syncCalls.map(x => x.body)));
  }

  section('fetch — a failed stock stage still promotes, and says so');
  {
    const a = H.makeActions(fetchResponder(2));
    a.Actions.callChain = async (_c, ch) => {
      a.chainCalls.push(ch);
      return ch.chain === 'ImportUnitsFromFusionChain'
        ? { ok: false, message: 'the lots import failed: boom' } : { ok: true };
    };
    const Chain = H.loadChain('ImportFromFusionChain', a.Actions);
    const c = fetchCtx();
    await new Chain().run(c);
    check('promote still called', a.calls.some(x => /promote/.test(x.endpoint)));
    check('message says stock did not complete',
      /Stock import did not complete \(the lots import failed: boom\)/.test(c.$page.variables.importMessage),
      c.$page.variables.importMessage);
    check('notified as a warning', a.notifications.some(n => n.type === 'warning'));
  }

  section('open dialog — a hung Fusion LOV never blocks Fetch or the grid');
  {
    // Measured 2026-10-02: one Fusion LOV call never answered, so lovsLoading
    // stayed true, Fetch stayed disabled and the grid never loaded.
    const a = H.makeActions((opts) => /ItemClasses|StandardLookupsLOV/.test(opts.endpoint)
      ? new Promise(() => {})                       // never settles
      : ok(0));
    const Chain = H.loadChain('OpenImportDialogChain', a.Actions);
    const c = ctx();
    Object.assign(c.$page.variables, { isImporting: false, lovsLoading: false,
      importMessage: '', importWarning: '' });
    const realDoc = global.document, realTimeout = global.setTimeout;
    global.document = { getElementById: () => null };
    global.setTimeout = (fn) => { fn(); return 0; };   // the LOV cap fires at once
    try {
      await new Chain().run(c);
    } finally {
      global.document = realDoc; global.setTimeout = realTimeout;
    }
    check('staging grid is loaded even though the LOVs hung',
      a.chainCalls.some(x => x.chain === 'LoadStagingChain'));
    eq('lovsLoading is released by the timeout', c.$page.variables.lovsLoading, false);
    eq('a hung LOV yields an empty list', c.$page.variables.itemClassOptionsArray.length, 0);
    const html = H.readPageFile('equipment-master-page.html');
    const fetchBtn = (html.match(/<oj-button id="importRunBtn"[\s\S]*?<\/oj-button>/) || [''])[0];
    check('Fetch is not disabled by lovsLoading', fetchBtn && !/lovsLoading/.test(fetchBtn), fetchBtn);
  }

  section('imported rows leave staging (2026-10-05)');
  {
    const fs = require('fs'), path = require('path');
    const pkg = path.join(__dirname, '..', 'db', 'item-import', 'EQR_ITEM_IMPORT_MERGE_PKG.sql');
    if (fs.existsSync(pkg)) {
      const src = fs.readFileSync(pkg, 'utf8').split('\n')
        .filter(l => !/^\s*--/.test(l)).join('\n');
      check('promote deletes the imported staging rows',
        /DELETE FROM EQR_EQUIPMENT_MASTER_T T[\s\S]{0,400}?EXISTS \(SELECT 1 FROM EQR_EQUIPMENT_MASTER D/.test(src));
      check('promote no longer marks rows MERGED',
        !/SET T\.IMPORT_STATUS\s*=\s*'MERGED'/.test(src));
    } else {
      check('merge package present to check', false, pkg + ' not found');
    }
    const json = JSON.parse(H.readPageFile('equipment-master-page.json'));
    const opts = json.variables.importStatusOptionsArray.defaultValue.map(o => o.value);
    check('status filter offers no MERGED (such rows no longer exist)', opts.indexOf('MERGED') === -1, opts.join(','));
  }

  // ═══════════════════════════════════════════════════════════════════
  // "What to map next" — LoadUnmatchedValuesChain + its page functions
  // ═══════════════════════════════════════════════════════════════════

  // Real paasdev top rows (2026-10-05), so the wording is pinned against
  // values an admin will actually see.
  const UNMATCHED = [
    { sourceType: 'INVENTORY', reason: 'NO_MAPPING_MATCH', classId: null, className: null,
      dimType: 'ITEM_USER_TYPE', dimValue: 'FG', dimLabel: 'FG', isFallback: 'Y', itemCount: 1209 },
    { sourceType: 'INVENTORY', reason: 'NO_MAPPING_MATCH', classId: null, className: null,
      dimType: 'ITEM_CLASS', dimValue: 'MANF_TPIC', dimLabel: 'MANF_TPIC', isFallback: 'Y', itemCount: 832 },
    { sourceType: 'INVENTORY', reason: 'NO_MAPPING_MATCH', classId: null, className: null,
      dimType: 'CATEGORY', dimValue: '300000167938722', dimLabel: 'Pharmaceuticals', isFallback: 'Y', itemCount: 441 },
    { sourceType: 'INVENTORY', reason: 'SUBCLASS_NO_MATCH', classId: 1000000137, className: 'Computer',
      dimType: 'CAT_SEGMENT2', dimValue: 'Tablet Cmp', dimLabel: 'Tablet Cmp', isFallback: 'N', itemCount: 143 },
    { sourceType: 'INVENTORY', reason: 'SUBCLASS_NO_MATCH', classId: 1000000137, className: 'Computer',
      dimType: 'CAT_SEGMENT2', dimValue: 'Components', dimLabel: 'Components', isFallback: 'N', itemCount: 115 },
    { sourceType: 'INVENTORY', reason: 'NO_MAPPING_MATCH', classId: null, className: null,
      dimType: 'CAT_SEGMENT1', dimValue: 'Electronic', dimLabel: 'Electronic', isFallback: 'N', itemCount: 59 }
  ];
  function unmatchedCtx() {
    const c = ctx();
    Object.assign(c.$page.variables, {
      unmatchedGroups: [{ stale: true, itemCount: 1 }], unmatchedTotalGroups: 9,
      unmatchedLoading: false });
    return c;
  }

  section('unmatched values — 200 stores the groups');
  {
    const a = H.makeActions(() => ({ ok: true, body: { items: UNMATCHED, totalGroups: 118 } }));
    const Chain = H.loadChain('LoadUnmatchedValuesChain', a.Actions);
    const c = unmatchedCtx();
    const before = c.$page.variables.unmatchedGroups;
    await new Chain().run(c);
    eq('one REST call', a.calls.length, 1);
    eq('calls the unmatched-values operation', a.calls[0].endpoint,
      'eqp-v1/getEquipmentImportUnmatchedValues');
    eq('sends limit 20', a.calls[0].uriParams && a.calls[0].uriParams.limit, 20);
    eq('stores every group', c.$page.variables.unmatchedGroups.length, 6);
    check('reassigned, not mutated', c.$page.variables.unmatchedGroups !== before);
    eq('largest group first (server order kept)', c.$page.variables.unmatchedGroups[0].itemCount, 1209);
    eq('stores totalGroups', c.$page.variables.unmatchedTotalGroups, 118);
    eq('loading released', c.$page.variables.unmatchedLoading, false);
    eq('no toast', a.notifications.length, 0);
  }

  section('unmatched values — quiet on HTTP failure (endpoint not deployed yet)');
  for (const status of [404, 500]) {
    const a = H.makeActions(() => ({ ok: false, status: status, body: { message: 'Not Found' } }));
    const Chain = H.loadChain('LoadUnmatchedValuesChain', a.Actions);
    const c = unmatchedCtx();
    let threw = false;
    try { await new Chain().run(c); } catch (e) { threw = true; }
    check('HTTP ' + status + ': does not throw', !threw);
    eq('HTTP ' + status + ': list is empty (panel hidden)', c.$page.variables.unmatchedGroups.length, 0);
    eq('HTTP ' + status + ': totalGroups reset', c.$page.variables.unmatchedTotalGroups, 0);
    eq('HTTP ' + status + ': no toast', a.notifications.length, 0);
    eq('HTTP ' + status + ': loading released', c.$page.variables.unmatchedLoading, false);
  }

  section('unmatched values — quiet when callRest throws');
  {
    const a = H.makeActions(() => { throw new Error('network down'); });
    const Chain = H.loadChain('LoadUnmatchedValuesChain', a.Actions);
    const c = unmatchedCtx();
    const realWarn = console.warn; console.warn = () => {};
    let threw = false;
    try { await new Chain().run(c); } catch (e) { threw = true; } finally { console.warn = realWarn; }
    check('does not throw', !threw);
    eq('list is empty', c.$page.variables.unmatchedGroups.length, 0);
    eq('no toast', a.notifications.length, 0);
    eq('loading released', c.$page.variables.unmatchedLoading, false);
  }

  section('unmatched values — tolerates a bare array and drops count-less rows');
  {
    const a = H.makeActions(() => ({ ok: true,
      body: [UNMATCHED[3], null, { dimType: 'CATEGORY', dimValue: 'x' }] }));
    const Chain = H.loadChain('LoadUnmatchedValuesChain', a.Actions);
    const c = unmatchedCtx();
    await new Chain().run(c);
    eq('keeps only the real group', c.$page.variables.unmatchedGroups.length, 1);
    eq('totalGroups falls back to the list length', c.$page.variables.unmatchedTotalGroups, 1);
  }

  section('unmatched values — a slow older response cannot overwrite a newer one');
  {
    let release;
    const slow = new Promise(r => { release = r; });
    let n = 0;
    const a = H.makeActions(() => (++n === 1)
      ? slow.then(() => ({ ok: true, body: { items: [UNMATCHED[5]], totalGroups: 1 } }))
      : { ok: true, body: { items: UNMATCHED, totalGroups: 118 } });
    const Chain = H.loadChain('LoadUnmatchedValuesChain', a.Actions);
    const c = unmatchedCtx();
    const first = new Chain().run(c);
    await new Chain().run(c);
    release(); await first;
    eq('newest list wins', c.$page.variables.unmatchedGroups.length, 6);
  }

  section('unmatched values — refreshed on open, after Fetch and after Import');
  {
    const code = (n) => H.chainCode(n);
    check('OpenImportDialogChain calls LoadUnmatchedValuesChain',
      /chain:\s*'LoadUnmatchedValuesChain'/.test(code('OpenImportDialogChain')));
    check('ImportFromFusionChain calls LoadUnmatchedValuesChain',
      /chain:\s*'LoadUnmatchedValuesChain'/.test(code('ImportFromFusionChain')));
    check('SaveStagingClassesChain calls LoadUnmatchedValuesChain',
      /chain:\s*'LoadUnmatchedValuesChain'/.test(code('SaveStagingClassesChain')));
    // Paging calls LoadStagingChain; it must not re-run the GROUP BY.
    check('LoadStagingChain does NOT call it (paging would re-run the GROUP BY)',
      !/LoadUnmatchedValuesChain/.test(code('LoadStagingChain')));

    // Executed: the open path really starts it, alongside the grid.
    const a = H.makeActions(() => ({ ok: true, body: { items: [] } }));
    const Chain = H.loadChain('OpenImportDialogChain', a.Actions);
    const c = ctx();
    Object.assign(c.$page.variables, { isImporting: false, lovsLoading: false,
      importMessage: '', importWarning: '' });
    const realDoc = global.document, realTimeout = global.setTimeout;
    global.document = { getElementById: () => null };
    global.setTimeout = (fn) => { fn(); return 0; };
    try { await new Chain().run(c); }
    finally { global.document = realDoc; global.setTimeout = realTimeout; }
    check('open starts LoadUnmatchedValuesChain',
      a.chainCalls.some(x => x.chain === 'LoadUnmatchedValuesChain'));
    check('open still starts LoadStagingChain',
      a.chainCalls.some(x => x.chain === 'LoadStagingChain'));

    const spec = H.readJson(require('path').join(H.SERVICES, 'eqp-v1', 'openapi3.json'));
    const op = (spec.paths['/equiprite/v1/equipment-import/unmatched-values'] || {}).get || {};
    eq('openapi declares the operation', op.operationId, 'getEquipmentImportUnmatchedValues');
    // VB silently drops undeclared uriParams.
    check('openapi declares the limit param',
      (op.parameters || []).some(p => p.name === 'limit' && p.in === 'query'));
  }

  section('unmatched values — labels, text, action');
  {
    const L = (c) => PAGE.dimTypeLabel(c);
    eq('CAT_SEGMENT2', L('CAT_SEGMENT2'), 'Category Segment 2');
    eq('CAT_SEGMENT10', L('CAT_SEGMENT10'), 'Category Segment 10');
    eq('CATEGORY', L('CATEGORY'), 'Category');
    eq('CATALOG', L('CATALOG'), 'Catalog');
    eq('ITEM_CLASS', L('ITEM_CLASS'), 'Item Class');
    eq('ITEM_USER_TYPE', L('ITEM_USER_TYPE'), 'Item Type');
    eq('ITEM_STATUS', L('ITEM_STATUS'), 'Item Status');
    eq('ITEM_EQUIPMENT_TYPE', L('ITEM_EQUIPMENT_TYPE'), 'Equipment Type');
    eq('ITEM_ASSET_CLASS', L('ITEM_ASSET_CLASS'), 'Asset Class');
    eq('DFF_ATTRIBUTE3', L('DFF_ATTRIBUTE3'), 'Item Attribute 3');
    eq('CAT_ATTRIBUTE1', L('CAT_ATTRIBUTE1'), 'Category Attribute 1');
    eq('MAJOR', L('MAJOR'), 'Major Category');
    eq('MINOR', L('MINOR'), 'Minor Category');
    eq('WO_TYPE', L('WO_TYPE'), 'Work Order Type');
    eq('WO_SUB_TYPE', L('WO_SUB_TYPE'), 'Work Order Sub Type');
    eq('ITEM', L('ITEM'), 'Maintenance Item');
    eq('MNT_ATTRIBUTE4', L('MNT_ATTRIBUTE4'), 'Maintenance Attribute 4');
    eq('FA_ASSET_KEY title-cased', L('FA_ASSET_KEY'), 'FA Asset Key');
    eq('unknown code shown as is', L('SOMETHING_NEW'), 'SOMETHING_NEW');
    eq('null code', L(null), '');

    eq('fallback item type', PAGE.unmatchedText(UNMATCHED[0]), 'Item Type = FG');
    eq('category shows the LABEL, not the id', PAGE.unmatchedText(UNMATCHED[2]), 'Category = Pharmaceuticals');
    eq('subclass group names its class', PAGE.unmatchedText(UNMATCHED[3]),
      'Computer › Category Segment 2 = Tablet Cmp');
    eq('segment 1', PAGE.unmatchedText(UNMATCHED[5]), 'Category Segment 1 = Electronic');
    const noLabel = Object.assign({}, UNMATCHED[5], { dimLabel: null });
    eq('no label falls back to the value', PAGE.unmatchedText(noLabel), 'Category Segment 1 = Electronic');
    const nullVal = Object.assign({}, UNMATCHED[0], { dimValue: null, dimLabel: null, itemCount: 12 });
    eq('null value renders (no value)', PAGE.unmatchedText(nullVal), 'Item Type = (no value)');

    eq('class action', PAGE.unmatchedAction(UNMATCHED[2]), 'Add class');
    eq('subclass action', PAGE.unmatchedAction(UNMATCHED[3]), 'Add subclass under Computer');
    eq('null value suggests nothing', PAGE.unmatchedAction(nullVal), '');
    eq('unknown reason suggests nothing',
      PAGE.unmatchedAction(Object.assign({}, UNMATCHED[2], { reason: 'WHO_KNOWS' })), '');

    eq('fallback flag Y', PAGE.unmatchedIsFallback(UNMATCHED[0]), true);
    eq('fallback flag N', PAGE.unmatchedIsFallback(UNMATCHED[3]), false);

    eq('covered = sum of item counts', PAGE.unmatchedCoveredCount(UNMATCHED), 2799);
    eq('null-value groups are not covered', PAGE.unmatchedCoveredCount(UNMATCHED.concat([nullVal])), 2799);
    eq('covered of nothing', PAGE.unmatchedCoveredCount(null), 0);
    eq('summary', PAGE.unmatchedSummary(UNMATCHED, 118), '2799 items in the top 6 of 118 groups');
    eq('summary, all groups listed', PAGE.unmatchedSummary(UNMATCHED, 6), '2799 items in the top 6 groups');
    eq('summary of nothing', PAGE.unmatchedSummary([], 0), '');

    const twenty = Array.from({ length: 20 }, (_, i) => Object.assign({}, UNMATCHED[5], { itemCount: 20 - i }));
    eq('shows 8 by default', PAGE.unmatchedVisible(twenty, false).length, 8);
    eq('show all', PAGE.unmatchedVisible(twenty, true).length, 20);
    eq('has more', PAGE.unmatchedHasMore(twenty), true);
    eq('no more with 6', PAGE.unmatchedHasMore(UNMATCHED), false);
  }

  section('unmatched values — an info icon and popup, not a panel');
  {
    const html = H.readPageFile('equipment-master-page.html');
    const json = JSON.parse(H.readPageFile('equipment-master-page.json'));
    check('no inline panel', html.indexOf('id="unmatchedPanel"') === -1);
    check('no Open Class Mapping button', !/openClassMappingBtn|onOpenClassMapping/.test(html));
    check('no Open Class Mapping listener', !json.eventListeners.onOpenClassMapping);
    const refAt = html.indexOf('id="stagingRefreshBtn"'), infoAt = html.indexOf('id="unmatchedInfoBtn"');
    check('info icon right after Refresh', refAt > 0 && infoAt > refAt &&
      html.slice(refAt, infoAt).split('<oj-c-button').length === 2);
    check('info icon is icon-only with the information glyph',
      /<oj-c-button id="unmatchedInfoBtn"[^>]*display="icons"[\s\S]{0,400}oj-ux-ico-information/.test(html));
    check('info icon hidden when there are no groups',
      /<oj-bind-if test="\[\[ \$variables\.unmatchedGroups\.length > 0 \]\]">\s*<oj-c-button id="unmatchedInfoBtn"/.test(html));
    check('icon opens the popup on itself', /getElementById\('unmatchedPopup'\)[\s\S]{0,60}open\('#unmatchedInfoBtn'\)/.test(html));
    check('popup present', /<oj-popup id="unmatchedPopup"/.test(html));
    check('oj-popup imported', !!json.imports.components['oj-popup']);
    check('oj-bind-for-each imported', !!json.imports.components['oj-bind-for-each']);
    ['unmatchedGroups', 'unmatchedTotalGroups', 'unmatchedLoading', 'unmatchedShowAll']
      .forEach(v => check('variable ' + v + ' declared', !!json.variables[v]));
    check('unmatchedOpen removed', !json.variables.unmatchedOpen);
    const fns = (html.match(/\$page\.functions\.([A-Za-z]+)/g) || [])
      .map(m => m.split('.').pop()).filter(n => /^unmatched|^dimType/.test(n));
    fns.forEach(n => check('function ' + n + ' declared in json', !!json.functions[n]));
    fns.forEach(n => check('function ' + n + ' exists on the page module', typeof PAGE[n] === 'function'));
  }

  // ═══════════════════════════════════════════════════════════════════
  // P1 REGRESSIONS (review 2026-10-05) — sub-chains run FOR REAL here.
  // The original bugs passed because callChain was a stub that never ran the
  // reload; these route callChain to the actual chain files.
  // ═══════════════════════════════════════════════════════════════════
  function realChains(a) {
    a.Actions.callChain = async (c2, ch) => {
      a.chainCalls.push(ch);
      const C = H.loadChain(ch.chain, a.Actions);
      return new C().run(c2, ch.params || {});
    };
    return a;
  }
  const stagedRows = (n, extra) => Array.from({ length: n }, (_, i) => Object.assign({
    fusionInventoryItemId: 1000 + i, importStatus: 'AUTO_MAPPED',
    resolvedClassId: 5, resolvedSubclassId: 12 }, (extra || {})[1000 + i] || {}));
  function gridCtx(rows, total) {
    const c = ctx();
    Object.assign(c.$page.variables, {
      isImporting: false, stagingLoading: false, stagingPageSize: 2, stagingPage: 0,
      stagingArray: rows, stagingTotalElements: total || rows.length,
      stagingSelectedRows: {}, stagingChangedRows: {},
      classOptionsArray: CLASS_OPTIONS_T, subclassOptionsArray: SUBCLASS_OPTIONS_T,
      importDialogOpen: true, stagingAppliedFilters: { itemClass: null, itemType: null, importStatus: null }
    });
    c.$page.functions.buildStagingGrid(rows, c.$page.variables);
    return c;
  }
  const withConfirm = async (answer, fn) => {
    const realWin = global.window; let asked = null;
    global.window = { confirm: (m) => { asked = m; return answer; } };
    try { await fn(); } finally { global.window = realWin; }
    return asked;
  };

  section('P1 — paging NEVER imports; pending work needs a yes');
  {
    for (const answer of [false, true]) {
      const a = realChains(H.makeActions(o => /getEquipmentImportStaging/.test(o.endpoint)
        ? { ok: true, body: { items: stagedRows(2), totalElements: 4 } }
        : { ok: true, body: { updated: 1, failed: [], promoted: 1 } }));
      const c = gridCtx(stagedRows(2), 4);
      c.$page.variables.stagingSelectedRows = { 1000: true, 1001: true };
      c.$page.variables.stagingChangedRows  = { 1000: { fusionInventoryItemId: 1000, resolvedClassId: 9 } };
      const asked = await withConfirm(answer, () => new (H.loadChain('StagingPageChangeChain', a.Actions))().run(c, { direction: 'NEXT' }));
      check(`(${answer ? 'OK' : 'Cancel'}) asked before leaving`, /2 ticked and 1 edited/.test(asked || ''), asked);
      check(`(${answer ? 'OK' : 'Cancel'}) no PATCH, no promote`,
        !a.calls.some(x => /patchEquipmentImportStagingAssignments|promoteEquipmentImport/.test(x.endpoint)),
        a.calls.map(x => x.endpoint).join(','));
      if (answer) {
        eq('OK: moved to page 1', c.$page.variables.stagingPage, 1);
        eq('OK: ticks discarded', Object.keys(c.$page.variables.stagingSelectedRows).length, 0);
      } else {
        eq('Cancel: stays on page 0', c.$page.variables.stagingPage, 0);
        eq('Cancel: ticks kept', Object.keys(c.$page.variables.stagingSelectedRows).length, 2);
      }
    }
    // nothing pending: no prompt at all
    const a = realChains(H.makeActions(() => ({ ok: true, body: { items: stagedRows(2), totalElements: 4 } })));
    const c = gridCtx(stagedRows(2), 4);
    const asked = await withConfirm(true, () => new (H.loadChain('StagingPageChangeChain', a.Actions))().run(c, { direction: 'NEXT' }));
    eq('nothing pending: no prompt', asked, null);
  }

  section('P1 — Import keeps failed ticks and unticked edits through its reload');
  {
    // Server after Import: row 1000 failed (still staged), 1001 imported (gone),
    // 1002 untouched but carries a pending edit that was NOT ticked.
    const after = [
      { fusionInventoryItemId: 1000, importStatus: 'AUTO_MAPPED', resolvedClassId: 5, resolvedSubclassId: 12 },
      { fusionInventoryItemId: 1002, importStatus: 'ERRORED', resolvedClassId: null, resolvedSubclassId: null }];
    const a = realChains(H.makeActions(o =>
      /patchEquipmentImportStagingAssignments/.test(o.endpoint)
        ? { ok: true, body: { updated: 1, failed: [{ fusionInventoryItemId: 1000, reason: 'CONFLICT' }] } }
      : /promoteEquipmentImport/.test(o.endpoint) ? { ok: true, body: { promoted: 1 } }
      : /getEquipmentImportStaging/.test(o.endpoint) ? { ok: true, body: { items: after, totalElements: 2 } }
      : { ok: true, body: {} }));
    const rows = [
      { fusionInventoryItemId: 1000, importStatus: 'AUTO_MAPPED', resolvedClassId: 5, resolvedSubclassId: 12 },
      { fusionInventoryItemId: 1001, importStatus: 'AUTO_MAPPED', resolvedClassId: 5, resolvedSubclassId: 13 },
      { fusionInventoryItemId: 1002, importStatus: 'ERRORED', resolvedClassId: 9, resolvedSubclassId: null }];
    const c = gridCtx(rows, 3);
    c.$page.variables.stagingSelectedRows = { 1000: true, 1001: true };
    c.$page.variables.stagingChangedRows  = { 1002: { fusionInventoryItemId: 1002, resolvedClassId: 9, resolvedSubclassId: null } };
    c.$page.variables.equipmentSDP = { fake: true };
    await new (H.loadChain('SaveStagingClassesChain', a.Actions))().run(c);
    eq('the failed row stays ticked after the reload', Object.keys(c.$page.variables.stagingSelectedRows).join(','), '1000');
    check('the unticked edit survives the reload', !!c.$page.variables.stagingChangedRows['1002']);
    const r1002 = c.$page.variables.stagingArray.find(r => r.fusionInventoryItemId === 1002) || {};
    eq('... and is re-applied to its row', r1002.resolvedClassId, 9);
  }

  section('P1 — tick boxes read the live selection');
  {
    const c = gridCtx(stagedRows(2));
    const f = c.$page.functions;
    eq('unticked', f.isRowSelected(0, c.$page.variables), false);
    c.$page.variables.stagingSelectedRows = { 1000: true };
    eq('ticked without rebuilding the grid', f.isRowSelected(0, c.$page.variables), true);
    const html = H.readPageFile('equipment-master-page.html');
    check('row box binds isRowSelected, not the frozen cell value',
      /:checked="\[\[ \$functions\.isRowSelected\(cell\.item\.rowIndex, \$variables\) \]\]"/.test(html));
  }

  section('P1 — Fetch, Import and Clear lock each other out');
  {
    const a = H.makeActions(() => ok(1));
    let c = gridCtx(stagedRows(1)); c.$page.variables.isImporting = true;
    c.$page.variables.stagingSelectedRows = { 1000: true };
    let res = await new (H.loadChain('SaveStagingClassesChain', a.Actions))().run(c);
    eq('Import refuses during Fetch', res && res.reason, 'BUSY');
    c = gridCtx(stagedRows(1)); c.$page.variables.stagingSaving = true;
    res = await new (H.loadChain('ClearStagingChain', a.Actions))().run(c);
    eq('Clear refuses during Import', res && res.reason, 'BUSY');
    c = gridCtx(stagedRows(1)); c.$page.variables.stagingClearing = true;
    await new (H.loadChain('ImportFromFusionChain', a.Actions))().run(c);
    eq('Fetch does nothing during Clear', a.calls.length, 0);
    const html = H.readPageFile('equipment-master-page.html');
    // importCloseBtn is NOT here any more: Close works during a Fetch (it
    // runs on in the background) -- see 'Fetch in the background'.
    ['importRunBtn', 'stagingSaveBtn', 'clearStagingBtn'].forEach(id => {
      const btn = (html.match(new RegExp('<oj-button id="' + id + '"[\\s\\S]*?>')) || [''])[0];
      check(id + ' is disabled while busy', /isBusy\(\$variables\)/.test(btn), btn);
    });
  }

  section('P1 — a failed promote is reported as a failure, and the grid reloads');
  {
    const a = realChains(H.makeActions(o =>
      /promoteEquipmentImport/.test(o.endpoint) ? { ok: false, status: 500 }
      : /getEquipmentImportStaging/.test(o.endpoint) ? { ok: true, body: { items: [], totalElements: 0 } }
      : /getEquipmentImportUnmatchedValues/.test(o.endpoint) ? { ok: true, body: { items: [] } }
      : ok(5, 'N')));
    const c = fetchCtx();
    Object.assign(c.$page.variables, { stagingSelectedRows: {}, stagingChangedRows: {}, stagingPageSize: 100 });
    await new (H.loadChain('ImportFromFusionChain', a.Actions))().run(c);
    eq('phase is ERROR', c.$page.variables.importPhase, 'ERROR');
    check('says classification did not run', /classification did not run/.test(c.$page.variables.importMessage),
      c.$page.variables.importMessage);
    check('never announces completion', !a.notifications.some(n => /Complete/.test(n.summary || '')));
    check('the grid is reloaded anyway', a.chainCalls.some(x => x.chain === 'LoadStagingChain'));
    eq('busy flag released', c.$page.variables.isImporting, false);
  }

  section('P1 — Close and filter changes ask before discarding work');
  {
    let reopened = 0;
    const realDoc = global.document;
    global.document = { getElementById: () => ({ isOpen: () => false, open: () => { reopened++; }, close: () => {} }) };
    try {
      const c = gridCtx(stagedRows(1)); c.$page.variables.stagingSelectedRows = { 1000: true };
      await withConfirm(false, () => new (H.loadChain('CancelImportDialogChain', H.makeActions(() => ({ ok: true })).Actions))().run(c));
      eq('Close + Cancel: dialog reopened', reopened, 1);
      eq('Close + Cancel: ticks kept', Object.keys(c.$page.variables.stagingSelectedRows).length, 1);
      await withConfirm(true, () => new (H.loadChain('CancelImportDialogChain', H.makeActions(() => ({ ok: true })).Actions))().run(c));
      eq('Close + OK: ticks discarded', Object.keys(c.$page.variables.stagingSelectedRows).length, 0);
    } finally { global.document = realDoc; }

    const a = realChains(H.makeActions(() => ({ ok: true, body: { items: [], totalElements: 0 } })));
    const c = gridCtx(stagedRows(1)); c.$page.variables.stagingChangedRows = { 1000: { resolvedClassId: 9 } };
    c.$page.variables.selectedImportStatus = 'ERRORED';            // the user just changed it
    await withConfirm(false, () => new (H.loadChain('ClearImportWarningChain', a.Actions))().run(c));
    eq('filter + Cancel: dropdown snaps back', c.$page.variables.selectedImportStatus, null);
    eq('filter + Cancel: no reload', a.calls.length, 0);
    check('filter + Cancel: edit kept', !!c.$page.variables.stagingChangedRows['1000']);
    // snapping back fires value-changed again: must be a silent no-op
    const asked = await withConfirm(true, () => new (H.loadChain('ClearImportWarningChain', a.Actions))().run(c));
    eq('snap-back re-entry: no second prompt', asked, null);
  }

  section('Closing the dialog refreshes the Equipment Master list');
  {
    const realDoc = global.document;
    const dlgState = { open: true };
    global.document = { getElementById: () => ({
      isOpen: () => dlgState.open, open: () => { dlgState.open = true; }, close: () => { dlgState.open = false; } }) };
    try {
      const a = H.makeActions(() => ({ ok: true }));
      const c = gridCtx(stagedRows(1));
      c.$page.variables.importDialogOpen = true;
      await new (H.loadChain('CancelImportDialogChain', a.Actions))().run(c);
      // the oj-close that close() fires re-enters the chain
      await new (H.loadChain('CancelImportDialogChain', a.Actions))().run(c);
      eq('list refreshed exactly once per close',
        a.chainCalls.filter(x => x.chain === 'RefreshEquipmentListChain').length, 1);

      const b = H.makeActions(() => ({ ok: true }));
      const busy = gridCtx(stagedRows(1));
      Object.assign(busy.$page.variables, { importDialogOpen: true, isImporting: true });
      dlgState.open = false;
      await new (H.loadChain('CancelImportDialogChain', b.Actions))().run(busy);
      eq('busy: dialog reopened, no refresh', b.chainCalls.length, 0);
    } finally { global.document = realDoc; }

    let refreshed = null;
    const R = H.loadChain('RefreshEquipmentListChain', {
      fireDataProviderEvent: async (_c, o) => { refreshed = o; } });
    const sdp = { endpoint: 'eqp-v1/getEquipriteV1EquipmentMaster' };
    await new R().run({ $page: { variables: { equipmentSDP: sdp } } });
    check('refresh targets the list SDP', refreshed && refreshed.target === sdp && 'refresh' in refreshed);

    const m = H.makeActions(() => ({ ok: true }));
    await new (H.loadChain('SecondaryActionChain', m.Actions))().run(
      { $application: {} }, { event: { detail: { secondaryItem: 'refresh' } } });
    eq('header Refresh icon refreshes the list', m.chainCalls.map(x => x.chain).join(','), 'RefreshEquipmentListChain');

    const pj = H.readJson(require('path').join(H.PAGES, 'equipment-master-page.json'));
    const acts = pj.variables.secondaryActions.defaultValue.map(x => x.id);
    eq('Refresh sits right after Import From Fusion', acts[acts.indexOf('importFusion') + 1], 'refresh');
    check('  as plain text, no icon (menu items have none)',
      pj.variables.secondaryActions.defaultValue.every(x => !x.icon));
    const html = H.readPageFile('equipment-master-page.html');
    const allAt = html.indexOf('id="stagingViewAllBtn"'), refAt = html.indexOf('id="stagingRefreshBtn"');
    check('dialog Refresh comes right after All Columns', allAt > 0 && refAt > allAt &&
      html.slice(allAt, refAt).split('<oj-').length === 2);
    check('dialog Refresh is an icon-only oj-c-button',
      /<oj-c-button id="stagingRefreshBtn"[^>]*display="icons"/.test(html));
    check('oj-c-button is imported', !!pj.imports.components['oj-c-button']);

    // dialog Refresh: keeps ticks/edits, reloads both, idle only
    const s1 = H.makeActions(() => ({ ok: true }));
    const g = gridCtx(stagedRows(1));
    await new (H.loadChain('RefreshStagingChain', s1.Actions))().run(g);
    eq('dialog Refresh reloads grid and panel', s1.chainCalls.map(x => x.chain).sort().join(','), 'LoadStagingChain,LoadUnmatchedValuesChain');
    eq('  keeping ticks and edits', s1.chainCalls.find(x => x.chain === 'LoadStagingChain').params.preserve, true);
    const s2 = H.makeActions(() => ({ ok: true }));
    const b2 = gridCtx(stagedRows(1)); b2.$page.variables.isImporting = true;
    await new (H.loadChain('RefreshStagingChain', s2.Actions))().run(b2);
    eq('  does nothing while busy', s2.chainCalls.length, 0);
  }

  section('closing a popup inside the dialog does not close the dialog');
  {
    const realDoc = global.document;
    let closed = 0;
    global.document = { getElementById: () => ({ isOpen: () => true, open: () => {}, close: () => { closed++; } }) };
    try {
      const a = H.makeActions(() => ({ ok: true }));
      const c = gridCtx(stagedRows(1));
      await new (H.loadChain('CancelImportDialogChain', a.Actions))().run(c, { event: { target: { id: 'unmatchedPopup' } } });
      eq('popup ojClose: dialog stays open', closed, 0);
      eq('  and nothing refreshed', a.chainCalls.length, 0);
      await new (H.loadChain('CancelImportDialogChain', a.Actions))().run(c, { event: { target: { id: 'importFusionDialog' } } });
      eq('the dialog\'s own ojClose still closes it', closed, 1);
    } finally { global.document = realDoc; }
    const html = H.readPageFile('equipment-master-page.html');
    check('popup stops its ojClose from bubbling',
      /<oj-popup id="unmatchedPopup"[^>]*on-oj-close="\[\[ function\(event\) \{ event\.stopPropagation\(\); \} \]\]"/.test(html));
    check('dialog on-oj-close passes its event',
      /on-oj-close="\[\[ \$listeners\.onImportDialogClosed \]\]"/.test(html) &&
      JSON.parse(H.readPageFile('equipment-master-page.json')).eventListeners.onImportDialogClosed.chains[0].parameters.event === '[[ $event ]]');
  }

  section('Source columns');
  {
    const pm = H.loadPageModule();
    const g = pm.buildStagingGrid([
      { fusionInventoryItemId: 1, resolvedSource: 'FIXED_ASSET' },
      { fusionInventoryItemId: 2 },
      { fusionInventoryItemId: 3, resolvedSource: 'SOMETHING_NEW' }], {});
    eq('review grid header 10 is Source', g.params.columnHeader[0][10], 'Source');
    eq('FIXED_ASSET -> Fixed Asset', g.params.data[0][10].data, 'Fixed Asset');
    eq('no resolvedSource -> blank', g.params.data[1][10].data, '');
    eq('unknown code shown as-is', g.params.data[2][10].data, 'SOMETHING_NEW');
    eq('Source column is read-only', pm.getColumnType(10), 'readonly');
    eq('list: FUSION_IMPORT -> Fusion', pm.recordSourceLabel('FUSION_IMPORT'), 'Fusion');
    eq('list: anyone else -> Manual', pm.recordSourceLabel('rahul'), 'Manual');
  }

  section('P1 — a class change that clears the subclass redraws the row');
  {
    const c = gridCtx([{ fusionInventoryItemId: 1000, importStatus: 'AUTO_MAPPED', resolvedClassId: CLASS_A_T, resolvedSubclassId: SUB_A_T }]);
    const f = c.$page.functions;
    const grid = f.buildStagingGrid(c.$page.variables.stagingArray, c.$page.variables);
    const changed = f.applyEdit(0, 6, CLASS_B_T, c.$page.variables);   // COL_CLASS = 6
    c.$page.variables.stagingChangedRows = changed;
    c.$page.variables.stagingArray = f.applyEditToRows(0, changed[1000], c.$page.variables.stagingArray);
    eq('data: subclass cleared', c.$page.variables.stagingArray[0].resolvedSubclassId, null);
    eq('redraw reported', f.refreshRowCells(0, c.$page.variables), true);
    eq('grid cell: subclass cleared too', grid.dataParameters.data[0][7].data, null);   // COL_SUBCLASS = 7
    eq('grid cell: new class', grid.dataParameters.data[0][6].data, CLASS_B_T);
    eq('one cell-range update fired', grid.updates.length, 1);
  }


  report();
})();
