/*
 * Staging review grid — the Fusion item import's class/subclass screen.
 *
 * Drives the REAL equipment-master-page.js. The two Oracle deps are stubbed
 * because they do not exist under node, but both are data sinks: every
 * decision under test lives in the page module itself.
 *
 * The invariants pinned here, each one a bug that actually happened:
 *
 *   - cells are WRAPPED as { data: value }. A bare value makes the template's
 *     cell.item.data.data undefined and the grid renders 100 blank rows while
 *     the REST call looks perfectly healthy. Shipped once.
 *   - the dirty map is keyed on fusionInventoryItemId, NEVER the row index.
 *     Indexes shift under sort and paging; the id is the merge key the PATCH
 *     wants.
 *   - subclasses narrow to the class chosen ON THAT ROW, and the provider is
 *     rebuilt per call — a cached one hands row 2 row 1's options.
 *   - a row's OWN saved subclass survives narrowing. oj-select-single is
 *     two-way bound: a value absent from its data renders blank AND writes
 *     null back, destroying a choice the user already made.
 *   - EDIT ORDER MUST NOT MATTER. The grid commits a cell on blur, so
 *     class-then-subclass can arrive either way round. Measuring "did the
 *     class change?" against the pending entry wiped a just-picked subclass.
 *     Shipped once; found because class 1000000101 "Tools" and subclass
 *     1000000101 "Hammers" share a number.
 *   - a MERGED row cannot be edited (the PATCH rejects it ALREADY_MERGED).
 *   - the PATCH body drops class-less entries: the endpoint sets
 *     IMPORT_STATUS='MAPPED' unconditionally, so a null class would mark a row
 *     "a human decided" while leaving promote unable to act on it.
 *   - unit pathway derives from control codes by "!= 1", never by testing for
 *     specific codes — 2, 5, 6, 7 and 8 all exist and all mean controlled.
 *
 * WHAT THIS CANNOT TELL YOU: whether oj-data-grid enters edit mode, whether
 * oj-bind-if re-renders on the view toggle, or whether the live PATCH accepts
 * the body. All three need the running app.
 *
 * Run:  node tests/staging-review-grid.test.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const H    = require('./_harness.js');

const { check, eq, section, report } = H.makeAsserter();

// ── Fixtures ─────────────────────────────────────────────────────────
// Shapes match the live DTO verified against paasdev 2026-09-24.

const CLASS_EXCAVATOR = 5;
const CLASS_TRUCK     = 9;

const CLASS_OPTIONS = [
  { label: 'Excavator', value: CLASS_EXCAVATOR },
  { label: 'Truck',     value: CLASS_TRUCK }
];

const SUBCLASS_OPTIONS = [
  { label: 'Mini Excavator',  value: 12, classId: CLASS_EXCAVATOR },
  { label: 'Large Excavator', value: 13, classId: CLASS_EXCAVATOR },
  { label: 'Light Truck',     value: 21, classId: CLASS_TRUCK }
];

function makeRows() {
  return [
    // 0: unclassified, serial-controlled
    { fusionInventoryItemId: 300000000000001, itemNumber: 'FIT3000',
      itemDescription: 'FIT 3000 Cardio-Fitness Machine', categoryName: 'Cardio Fitness',
      itemClassCode: 'ROOT', importStatus: 'ERRORED',
      rejectReason: 'NO_MAPPING_MATCH (INVENTORY)',
      resolvedClassId: null, resolvedSubclassId: null,
      serialNumControlCode: 2, lotControlCode: 1, inventoryItemFlag: 'Y' },
    // 1: already classified, lot-controlled
    { fusionInventoryItemId: 300000000000002, itemNumber: 'LOT-200001',
      itemDescription: 'Bulk Lubricant', categoryName: 'Fluids',
      itemClassCode: 'ROOT', importStatus: 'UNMAPPED',
      resolvedClassId: CLASS_EXCAVATOR, resolvedSubclassId: 12,
      serialNumControlCode: 1, lotControlCode: 2, inventoryItemFlag: 'Y' },
    // 2: already promoted — must be uneditable
    { fusionInventoryItemId: 300000000000003, itemNumber: 'EXC-900',
      itemDescription: 'Excavator 900', categoryName: 'Heavy Equipment',
      itemClassCode: 'ROOT', importStatus: 'MERGED',
      resolvedClassId: CLASS_EXCAVATOR, resolvedSubclassId: 13,
      serialNumControlCode: 2, lotControlCode: 1, inventoryItemFlag: 'Y' },
    // 3: no unit pathway — a valid definition with no units
    { fusionInventoryItemId: 300000000000004, itemNumber: 'WARRANTY-1',
      itemDescription: '1 Year Warranty', categoryName: 'Services',
      itemClassCode: 'ROOT', importStatus: 'NO_UNIT_PATHWAY',
      resolvedClassId: null, resolvedSubclassId: null,
      serialNumControlCode: 1, lotControlCode: 1, inventoryItemFlag: 'N' }
  ];
}

function makeVars(rows) {
  return {
    stagingArray: rows,
    classOptionsArray: CLASS_OPTIONS,
    subclassOptionsArray: SUBCLASS_OPTIONS,
    classesById:    { 5: 'Excavator', 9: 'Truck' },
    subclassesById: { 12: 'Mini Excavator', 13: 'Large Excavator', 21: 'Light Truck' },
    stagingChangedRows: {}
  };
}

const COL_SELECT = 0, COL_STATUS = 1, COL_ITEM_NO = 2, COL_ITEM_DESC = 3,
      COL_CLASS = 6, COL_SUBCLASS = 7, COL_PATHWAY = 8, COL_REASON = 9;

(function main() {
  const fns = H.loadPageModule();

  // ───────────────────────────────────────────────────────────────────
  section('grid construction');

  let rows = makeRows();
  let vars = makeVars(rows);
  const grid = fns.buildStagingGrid(rows, vars);

  eq('provider built', grid instanceof H.FakeGridProvider, true);
  eq('one grid row per staged row', grid.params.data.length, 4);
  eq('14 columns', grid.params.data[0].length, 14);
  eq('14 headers', grid.params.columnHeader[0].length, 14);
  eq('tick-box header is empty (template draws select-all there)', grid.params.columnHeader[0][COL_SELECT], '');
  eq('reason header last', grid.params.columnHeader[0][COL_REASON], 'Reason');

  // EVERY CELL MUST BE WRAPPED AS { data: value }. This is the shape the
  // template reads as cell.item.data.data, and what cellEdit two-way binds
  // into. A bare value renders blank rows against a healthy REST call.
  const c0 = grid.params.data[0][COL_STATUS];
  check('cells are wrapped objects, not bare values',
    c0 !== null && typeof c0 === 'object' && 'data' in c0,
    'got ' + JSON.stringify(c0));
  check('a cell is NOT a bare string',
    typeof grid.params.data[0][COL_ITEM_NO] !== 'string');
  check('every cell in every row is wrapped',
    grid.params.data.every(r => r.every(x => x !== null && typeof x === 'object' && 'data' in x)));

  // Read through a guard so a shape regression REPORTS rather than throwing
  // before the diagnostics print.
  const cv = (r, c) => {
    const x = grid.params.data[r][c];
    return (x !== null && typeof x === 'object' && 'data' in x) ? x.data : '<<UNWRAPPED>>';
  };

  eq('status in col 0', cv(0, COL_STATUS), 'ERRORED');
  eq('reason in col 8', cv(0, COL_REASON), 'NO_MAPPING_MATCH (INVENTORY)');
  eq('no reason renders blank', cv(1, COL_REASON), '');
  eq('reason column readonly', fns.getColumnType(COL_REASON), 'readonly');
  eq('item number in col 1', cv(0, COL_ITEM_NO), 'FIT3000');
  eq('description in col 2', cv(0, COL_ITEM_DESC), 'FIT 3000 Cardio-Fitness Machine');
  // The cell holds the ID; the template renders the name via displayFor.
  eq('class cell holds the id', cv(1, COL_CLASS), CLASS_EXCAVATOR);
  // null, not '': oj-select-single must render empty rather than match ''.
  eq('unset class is null not empty string', cv(0, COL_CLASS), null);

  // ───────────────────────────────────────────────────────────────────
  section('unit pathway derivation');

  eq('serial-controlled -> Serial', fns.unitPathwayFor(rows[0]), 'Serial');
  eq('lot-controlled -> Lot',       fns.unitPathwayFor(rows[1]), 'Lot');
  eq('neither, but stocked -> Inventory', fns.unitPathwayFor(
    { serialNumControlCode: 1, lotControlCode: 1, inventoryItemFlag: 'Y' }), 'Inventory');
  eq('neither and not stocked -> None', fns.unitPathwayFor(rows[3]), 'None');
  eq('both -> Serial + Lot', fns.unitPathwayFor(
    { serialNumControlCode: 2, lotControlCode: 2, inventoryItemFlag: 'Y' }), 'Serial + Lot');

  // Guards the IN (2,5,6) bug: codes 7 and 8 exist and also mean controlled.
  [2, 5, 6, 7, 8].forEach(code => {
    eq('serial control code ' + code + ' counts as controlled', fns.unitPathwayFor(
      { serialNumControlCode: code, lotControlCode: 1, inventoryItemFlag: 'Y' }), 'Serial');
  });
  eq('serial control code 1 is NOT controlled', fns.unitPathwayFor(
    { serialNumControlCode: 1, lotControlCode: 1, inventoryItemFlag: 'N' }), 'None');
  eq('missing codes default to uncontrolled',
     fns.unitPathwayFor({ inventoryItemFlag: 'N' }), 'None');
  eq('pathway of null row is blank', fns.unitPathwayFor(null), '');

  // ───────────────────────────────────────────────────────────────────
  section('column types, widths and row keys');

  eq('class column editable',    fns.getColumnType(COL_CLASS), 'editable');
  eq('subclass column editable', fns.getColumnType(COL_SUBCLASS), 'editable');
  eq('status column readonly',   fns.getColumnType(COL_STATUS), 'readonly');
  eq('pathway column readonly',  fns.getColumnType(COL_PATHWAY), 'readonly');

  // oj-data-grid takes column widths ONLY through this callback — there is no
  // columns[] array as on oj-table.
  check('header style sets a width',
    /width:\s*\d+px/.test(fns.stagingColumnHeaderStyle({ index: COL_ITEM_DESC })));
  check('description is the widest column',
    parseInt(fns.stagingColumnHeaderStyle({ index: COL_ITEM_DESC }).match(/width:(\d+)/)[1], 10) >
    parseInt(fns.stagingColumnHeaderStyle({ index: COL_STATUS }).match(/width:(\d+)/)[1], 10));
  check('an out-of-range column still gets a width',
    /width:\s*\d+px/.test(fns.stagingColumnHeaderStyle({ index: 99 })));
  check('a missing context does not throw',
    /width:\s*\d+px/.test(fns.stagingColumnHeaderStyle(null)));

  eq('row 0 key is the fusion id', fns.rowKeyAt(0), 300000000000001);
  eq('row 2 key is the fusion id', fns.rowKeyAt(2), 300000000000003);
  eq('out-of-range row key is null', fns.rowKeyAt(99), null);

  // ───────────────────────────────────────────────────────────────────
  section('navigation-mode display shows names, not ids');

  eq('class id renders as name', fns.displayFor(COL_CLASS, CLASS_EXCAVATOR, vars), 'Excavator');
  eq('subclass id renders as name', fns.displayFor(COL_SUBCLASS, 12, vars), 'Mini Excavator');
  eq('null renders blank', fns.displayFor(COL_CLASS, null, vars), '');
  // The cell template calls this without variables; buildStagingGrid captured them.
  eq('falls back to captured variables', fns.displayFor(COL_CLASS, CLASS_TRUCK), 'Truck');

  // ───────────────────────────────────────────────────────────────────
  section('cascade: subclasses narrow to the row\'s class');

  let p = fns.getStagingProvider(COL_SUBCLASS, 1, vars);
  eq('excavator row sees 2 subclasses', p.data.length, 2);
  check('excavator row sees only excavator subclasses',
    p.data.every(s => s.classId === CLASS_EXCAVATOR),
    JSON.stringify(p.data.map(s => s.label)));

  // No class chosen: show everything. An empty dropdown reads as "broken",
  // not as "choose a class first".
  p = fns.getStagingProvider(COL_SUBCLASS, 0, vars);
  eq('class-less row sees all subclasses', p.data.length, 3);

  p = fns.getStagingProvider(COL_CLASS, 0, vars);
  eq('class picker shows every class', p.data.length, 2);

  // NEVER cache. Comparing list LENGTHS is not enough — two classes can have
  // the same number of subclasses — so compare the values.
  const pA = fns.getStagingProvider(COL_SUBCLASS, 1, vars);
  const valsA = pA.data.map(s => s.value).sort().join(',');
  rows[1].resolvedClassId = CLASS_TRUCK;
  rows[1].resolvedSubclassId = null;
  const pB = fns.getStagingProvider(COL_SUBCLASS, 1, vars);
  const valsB = pB.data.map(s => s.value).sort().join(',');
  check('a fresh provider object is returned each call', pA !== pB);
  check('options actually differ when the class differs', valsA !== valsB,
    'A=[' + valsA + '] B=[' + valsB + ']');
  eq('truck row sees only the truck subclass', valsB, '21');
  rows[1].resolvedClassId = CLASS_EXCAVATOR;
  rows[1].resolvedSubclassId = 12;

  // ───────────────────────────────────────────────────────────────────
  section('cascade trap: the row\'s own saved value survives narrowing');

  rows[1].resolvedClassId    = CLASS_TRUCK;  // class says Truck
  rows[1].resolvedSubclassId = 12;           // subclass is an Excavator one
  p = fns.getStagingProvider(COL_SUBCLASS, 1, vars);
  check('out-of-class saved subclass is still offered',
    p.data.some(s => s.value === 12),
    'options: ' + JSON.stringify(p.data.map(s => s.value)));
  check('in-class options are still offered too',
    p.data.some(s => s.value === 21));
  eq('exactly the class list plus the saved one', p.data.length, 2);

  rows = makeRows(); vars = makeVars(rows); fns.buildStagingGrid(rows, vars);

  // ───────────────────────────────────────────────────────────────────
  section('edit permission');

  eq('unclassified row is editable',  fns.canEdit(0, COL_CLASS, vars), true);
  eq('classified row is editable',    fns.canEdit(1, COL_SUBCLASS, vars), true);
  eq('MERGED row is NOT editable',    fns.canEdit(2, COL_CLASS, vars), false);
  // NO_UNIT_PATHWAY is a description, not a gate: the definition is valid.
  eq('NO_UNIT_PATHWAY row IS editable', fns.canEdit(3, COL_CLASS, vars), true);
  eq('readonly column is never editable', fns.canEdit(0, COL_STATUS, vars), false);
  eq('missing row is not editable',   fns.canEdit(99, COL_CLASS, vars), false);

  // ───────────────────────────────────────────────────────────────────
  section('applyEdit keys on the fusion id, not the row index');

  let changed = fns.applyEdit(0, COL_CLASS, CLASS_EXCAVATOR, vars);
  const keys = Object.keys(changed);
  eq('one entry after one edit', keys.length, 1);
  eq('keyed on the fusion id', keys[0], '300000000000001');
  check('NOT keyed on the row index', keys[0] !== '0', 'key was ' + keys[0]);
  eq('entry carries the id', changed['300000000000001'].fusionInventoryItemId, 300000000000001);
  eq('entry carries the new class', changed['300000000000001'].resolvedClassId, CLASS_EXCAVATOR);

  vars.stagingChangedRows = changed;
  rows[0].resolvedClassId = CLASS_EXCAVATOR;
  changed = fns.applyEdit(0, COL_SUBCLASS, 12, vars);
  eq('same row still one entry', Object.keys(changed).length, 1);
  eq('subclass merged onto the same entry', changed['300000000000001'].resolvedSubclassId, 12);
  eq('class survived the second edit', changed['300000000000001'].resolvedClassId, CLASS_EXCAVATOR);

  // ───────────────────────────────────────────────────────────────────
  section('changing the class CLEARS an invalid subclass');

  rows = makeRows(); vars = makeVars(rows); fns.buildStagingGrid(rows, vars);
  changed = fns.applyEdit(1, COL_CLASS, CLASS_TRUCK, vars);
  eq('class changed', changed['300000000000002'].resolvedClassId, CLASS_TRUCK);
  eq('subclass cleared', changed['300000000000002'].resolvedSubclassId, null);

  rows = makeRows(); vars = makeVars(rows); fns.buildStagingGrid(rows, vars);
  changed = fns.applyEdit(1, COL_CLASS, CLASS_EXCAVATOR, vars);
  eq('re-picking the same class keeps the subclass',
     changed['300000000000002'].resolvedSubclassId, 12);

  // ───────────────────────────────────────────────────────────────────
  section('EDIT ORDER must not matter (regression)');

  // The grid commits a cell on BLUR, so class-then-subclass can arrive either
  // way round. An earlier version measured "did the class change?" against the
  // PENDING entry, which was still null when the class cell committed second --
  // so it read as a change and wiped a just-picked subclass. It shipped: a real
  // save sent resolvedSubclassId:null.
  //
  // The id collision that exposed it is real: on paasdev class 1000000101
  // "Tools" and subclass 1000000101 "Hammers" share a number, because class and
  // subclass ids are separate sequences.
  const COLLIDE = [
    { label: 'Hammers', value: 1000000101, classId: 1000000101 },
    { label: 'Mini Excavator', value: 12, classId: CLASS_EXCAVATOR },
    { label: 'Light Truck', value: 21, classId: CLASS_TRUCK }
  ];

  function applyInOrder(order, saved) {
    const r = [{ fusionInventoryItemId: 999, importStatus: 'UNMAPPED',
                 resolvedClassId: saved.c, resolvedSubclassId: saved.s }];
    const v = { stagingArray: r, classOptionsArray: CLASS_OPTIONS,
                subclassOptionsArray: COLLIDE, stagingChangedRows: {} };
    fns.buildStagingGrid(r, v);
    order.forEach(([col, val]) => {
      const c = fns.applyEdit(0, col, val, v);
      v.stagingChangedRows = c;
      v.stagingArray = fns.applyEditToRows(0, c[999], v.stagingArray);
    });
    return v.stagingChangedRows[999];
  }

  eq('class then subclass keeps the subclass',
     applyInOrder([[COL_CLASS, 1000000101], [COL_SUBCLASS, 1000000101]], { c: null, s: null })
       .resolvedSubclassId, 1000000101);

  const r2 = applyInOrder([[COL_SUBCLASS, 1000000101], [COL_CLASS, 1000000101]], { c: null, s: null });
  eq('subclass then class ALSO keeps the subclass', r2.resolvedSubclassId, 1000000101);
  eq('and the class is still set', r2.resolvedClassId, 1000000101);

  eq('a real class change still clears an out-of-class subclass',
     applyInOrder([[COL_CLASS, CLASS_TRUCK]], { c: CLASS_EXCAVATOR, s: 12 }).resolvedSubclassId, null);
  eq('re-picking the same class keeps a valid subclass',
     applyInOrder([[COL_CLASS, CLASS_EXCAVATOR]], { c: CLASS_EXCAVATOR, s: 12 }).resolvedSubclassId, 12);

  // subclassBelongsTo must compare PARENT to class, never id to id, or the
  // 1000000101 collision makes it self-matching.
  const vc = { subclassOptionsArray: COLLIDE };
  eq('subclass belongs to its parent class', fns.subclassBelongsTo(12, CLASS_EXCAVATOR, vc), true);
  eq('subclass does not belong to another class', fns.subclassBelongsTo(12, CLASS_TRUCK, vc), false);
  eq('colliding ids resolve by PARENT, not by equality',
     fns.subclassBelongsTo(1000000101, 1000000101, vc), true);
  eq('an unknown subclass belongs nowhere', fns.subclassBelongsTo(99999, CLASS_EXCAVATOR, vc), false);
  eq('null subclass belongs nowhere', fns.subclassBelongsTo(null, CLASS_EXCAVATOR, vc), false);

  rows = makeRows(); vars = makeVars(rows); fns.buildStagingGrid(rows, vars);

  // ───────────────────────────────────────────────────────────────────
  section('applyEditToRows mirrors the edit back');

  changed = fns.applyEdit(0, COL_CLASS, CLASS_TRUCK, vars);
  const newRows = fns.applyEditToRows(0, changed['300000000000001'], rows);
  eq('row 0 now carries the class', newRows[0].resolvedClassId, CLASS_TRUCK);
  check('a NEW array is returned, not a mutation', newRows !== rows);
  eq('other rows untouched', newRows[1].resolvedClassId, CLASS_EXCAVATOR);
  // Without this mirror the cascade keeps narrowing against the OLD class.
  p = fns.getStagingProvider(COL_SUBCLASS, 0, makeVars(newRows));
  check('cascade now narrows to the newly chosen class',
    p.data.every(s => s.classId === CLASS_TRUCK),
    JSON.stringify(p.data.map(s => s.label)));

  // ───────────────────────────────────────────────────────────────────
  section('PATCH body (buildImportBody: the ticked rows)');

  const ticked = { '1': true, '2': true, '3': true };
  const body = fns.buildImportBody(ticked, {
    '1': { fusionInventoryItemId: 1, resolvedClassId: CLASS_EXCAVATOR, resolvedSubclassId: 12 },
    // class-less: must be DROPPED. The endpoint sets IMPORT_STATUS='MAPPED'
    // unconditionally, so this would mark a row "a human decided" while
    // leaving promote unable to act on it.
    '2': { fusionInventoryItemId: 2, resolvedClassId: null, resolvedSubclassId: 21 },
    // class-only is legal: promote needs only RESOLVED_CLASS_ID.
    '3': { fusionInventoryItemId: 3, resolvedClassId: CLASS_TRUCK, resolvedSubclassId: null }
  }, [{ fusionInventoryItemId: 1 }, { fusionInventoryItemId: 2 }, { fusionInventoryItemId: 3 }]);

  eq('class-less entry dropped', body.assignments.length, 2);
  eq('and counted as noClass', body.noClass, 1);
  check('the dropped one is id 2', !body.assignments.some(a => a.fusionInventoryItemId === 2));
  check('class-only entry kept', body.assignments.some(a => a.fusionInventoryItemId === 3));
  eq('class-only sends explicit null subclass',
     body.assignments.find(a => a.fusionInventoryItemId === 3).resolvedSubclassId, null);
  check('every entry carries the three PATCH fields',
    body.assignments.every(a =>
      'fusionInventoryItemId' in a && 'resolvedClassId' in a && 'resolvedSubclassId' in a));
  eq('nothing ticked yields an empty array', fns.buildImportBody({}, {}, []).assignments.length, 0);
  eq('null inputs yield an empty array', fns.buildImportBody(null, null, null).assignments.length, 0);

  // ───────────────────────────────────────────────────────────────────
  section('empty and defensive inputs');

  const emptyGrid = fns.buildStagingGrid([], makeVars([]));
  eq('empty staging builds an empty grid', emptyGrid.params.data.length, 0);
  eq('headers still present when empty', emptyGrid.params.columnHeader[0].length, 14);
  eq('null staging does not throw',
     fns.buildStagingGrid(null, makeVars([])).params.data.length, 0);
  // A stale key map must refuse the write rather than land it on row 0.
  fns.buildStagingGrid([], makeVars([]));
  eq('edit against an empty grid writes nothing',
     Object.keys(fns.applyEdit(0, COL_CLASS, 5, makeVars([]))).length, 0);

  // ───────────────────────────────────────────────────────────────────
  section('wiring: what the HTML and JSON must declare');

  const html = H.readPageFile('equipment-master-page.html');
  const json = H.readJson(path.join(H.PAGES, 'equipment-master-page.json'));

  check('review grid present', html.indexOf('id="stagingReviewGrid"') !== -1);
  check('cellEdit mode set', html.indexOf('edit-mode="cellEdit"') !== -1);
  check('oj-data-grid imported', !!json.imports.components['oj-data-grid']);
  check('wide table kept as the evidence view', html.indexOf('id="stagingTable"') !== -1);

  // FETCH pulls Fusion -> staging; IMPORT commits staging -> master. The
  // labels were Import/Save, which understated what the second one does.
  check('the fetch button is labelled Fetch', />Fetch</.test(html),
    'the top button pulls into staging; calling it Import confused it with the commit');
  check('the commit button is labelled Import', /'Import'/.test(html) || /'Import '/.test(html));
  check('no stale Save label on the commit button', !/: 'Save' \]\]/.test(html));

  ['stagingChangedRows', 'stagingViewMode', 'stagingGridProvider', 'stagingPage',
   'stagingPageSize', 'stagingTotalElements', 'stagingSaving'].forEach(v => {
    check('variable declared: ' + v, !!json.variables[v]);
  });

  ['buildStagingGrid', 'getColumnType', 'getStagingProvider', 'displayFor',
   'canEdit', 'applyEdit', 'applyEditToRows', 'buildImportBody',
   'rowKeyAt', 'unitPathwayFor', 'subclassBelongsTo'].forEach(f => {
    check('function declared: ' + f, !!json.functions[f]);
  });

  ['onSaveStagingClasses', 'onStagingNextPage', 'onStagingPrevPage'].forEach(l => {
    check('listener declared: ' + l, !!json.eventListeners[l]);
  });

  // An unimported component renders nothing, silently.
  const used = new Set((html.match(/<(oj-[a-z0-9-]+)/g) || []).map(s => s.slice(1)));
  const missing = [...used].filter(c => !json.imports.components[c]);
  check('every oj- component used is imported', missing.length === 0,
        'missing: ' + missing.join(', '));

  // A chain named by a listener must exist, or callChain 404s at runtime.
  ['SaveStagingClassesChain', 'StagingPageChangeChain', 'LoadStagingChain',
   'ImportUnitsFromFusionChain', 'ClearStagingChain'].forEach(c =>
    check('chain file exists: ' + c, fs.existsSync(path.join(H.CHAINS, c + '.js'))));

  check('grid provider extracted to resources/js',
    fs.existsSync(path.join(H.APP, 'resources', 'js', 'arrayDataGridProvider.js')));

  report();
})();
