/*
 * Change Class on the Units page — re-classifying an item already imported.
 *
 * Decision 2026-10-05 (option A): imported rows leave staging, so the Class
 * Mapping rules cannot re-run on them; a person picks the class. Pinned here:
 *   - FULL access only;
 *   - a class with subclasses requires one, so a null subclass is only ever
 *     sent for a class that has none (whether PATCH clears on null is
 *     unverified);
 *   - the record is read back, and a change the server did not apply is
 *     reported as such, never as success;
 *   - the subclass list follows the class, and a subclass of another class is
 *     dropped -- but only on a USER change, not when the dialog loads.
 *
 * Run:  node tests/change-class.test.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const H    = require('./_harness');

const T = H.makeAsserter();
const UNITS = path.join(H.PAGES, 'equipment-units-page-chains');

function loadUnitsModule() {
  const src = fs.readFileSync(path.join(H.PAGES, 'equipment-units-page.js'), 'utf8');
  const sb = { console }; let M;
  sb.define = (deps, f) => { M = f(); };
  vm.createContext(sb); vm.runInContext(src, sb);
  return new M();
}
function loadChain(name, Actions, paging) {
  const src = fs.readFileSync(path.join(UNITS, name + '.js'), 'utf8');
  let mod;
  new Function('define', src)((deps, f) => {
    mod = f.apply(null, deps.map(d =>
      d === 'vb/action/actionChain' ? class {} :
      d === 'vb/action/actions' ? Actions :
      d === 'resources/js/fetchAllPages' ? paging : {}));
  });
  return mod;
}

const PM = loadUnitsModule();
const SUBS = [
  { value: 11, label: 'Tablet', classId: 1 },
  { value: 12, label: 'Laptop', classId: 1 },
  { value: 21, label: 'Drill',  classId: 2 }
];
const MASTER = { id: 500, equipmentNumber: 'EQ-1', equipmentClassId: 1, equipmentSubclassId: 11, objectVersionNumber: 3 };

function ctx(level, vars) {
  return {
    $application: {
      functions: { pageAccess: (m, l, c) => (l && m && m[c]) || 'HIDDEN' },
      variables: { pageAccessMap: level ? { EQR_EQUIPMENT_MASTER: level } : {}, pageAccessLoaded: true }
    },
    $page: { functions: PM, variables: Object.assign({ masterRecord: Object.assign({}, MASTER), equipmentId: '500' }, vars || {}) }
  };
}
function actions(responder) {
  const log = { rest: [], notes: [], chains: [] };
  return { log, Actions: {
    callRest: async (_c, o) => { log.rest.push(o); return responder(o); },
    fireNotificationEvent: async (_c, n) => { log.notes.push(n); },
    callChain: async (_c, o) => { log.chains.push(o.chain); }
  } };
}
function withDom(fn) {
  const dlg = { opened: 0, closed: 0, open() { this.opened++; }, close() { this.closed++; } };
  const real = global.document, realConfirm = global.window;
  global.document = { getElementById: () => dlg };
  global.window = { confirm: () => true };
  return Promise.resolve(fn(dlg)).finally(() => { global.document = real; global.window = realConfirm; });
}

(async () => {
  T.section('page functions');
  T.eq('subclasses of class 1', PM.subclassOptionsFor(SUBS, 1).map(o => o.value).join(','), '11,12');
  T.eq('no class -> none', PM.subclassOptionsFor(SUBS, null).length, 0);
  T.eq('ends yesterday -> end-dated', PM.isEndDated('2026-10-04', Date.parse('2026-10-05')), true);
  T.eq('ends tomorrow -> live', PM.isEndDated('2026-10-06', Date.parse('2026-10-05')), false);
  T.eq('no end date -> live', PM.isEndDated(null), false);
  const sub1 = PM.subclassOptionsFor(SUBS, 1);
  T.eq('class required', PM.canSaveClass({ classId: null }, MASTER, []).ok, false);
  T.eq('class with subclasses requires one', PM.canSaveClass({ classId: 1, subclassId: null }, { equipmentClassId: 2 }, sub1).ok, false);
  T.eq('class without subclasses: null subclass ok', PM.canSaveClass({ classId: 3, subclassId: null }, MASTER, []).ok, true);
  T.eq('unchanged -> nothing to save', PM.canSaveClass({ classId: 1, subclassId: 11 }, MASTER, sub1).ok, false);
  T.eq('new subclass -> ok', PM.canSaveClass({ classId: 1, subclassId: 12 }, MASTER, sub1).ok, true);

  T.section('opening the dialog');
  await withDom(async dlg => {
    const paging = { fetchAllPages: async (_cr, ep) => ep.includes('Classes')
      ? [{ id: 1, className: 'Computer' }, { id: 2, className: 'Tools' },
         { id: 9, className: 'Old', effectiveEndDate: '2020-01-01' }]
      : [{ id: 11, subclassName: 'Tablet', eqrEquipmentClassId: 1 }, { id: 21, subclassName: 'Drill', eqrEquipmentClassId: 2 }] };
    const c = ctx('FULL');
    await new (loadChain('openChangeClassChain', actions(() => ({})).Actions, paging))().run(c);
    T.eq('opens', dlg.opened, 1);
    T.eq('draft starts at the current class/subclass', JSON.stringify(c.$page.variables.classDraft), '{"classId":1,"subclassId":11}');
    T.eq('end-dated class left out', c.$page.variables.classOptions.map(o => o.value).join(','), '1,2');
    T.eq('subclasses narrowed to the current class', c.$page.variables.subclassOptions.map(o => o.value).join(','), '11');

    const r = ctx('READ_ONLY');
    await new (loadChain('openChangeClassChain', actions(() => ({})).Actions, paging))().run(r);
    T.eq('READ_ONLY: does not open', dlg.opened, 1);

    const failing = { fetchAllPages: async () => [] };
    const f = ctx('FULL');
    await new (loadChain('openChangeClassChain', actions(() => ({})).Actions, failing))().run(f);
    T.check('failed load is reported', /Could not load/.test(f.$page.variables.classChangeError));
  });

  T.section('changing the class in the dialog');
  {
    const C = loadChain('classDraftChangedChain', {});
    const c = ctx('FULL', { allSubclassOptions: SUBS, classDraft: { classId: 2, subclassId: 11 } });
    await new C().run(c, { event: { detail: { updatedFrom: 'external' } } });
    T.eq('programmatic set: subclass kept', c.$page.variables.classDraft.subclassId, 11);
    await new C().run(c, { event: { detail: { updatedFrom: 'internal' } } });
    T.eq('user change: list follows the class', c.$page.variables.subclassOptions.map(o => o.value).join(','), '21');
    T.eq('user change: other class\'s subclass dropped', c.$page.variables.classDraft.subclassId, null);
  }

  T.section('saving');
  const saveVars = () => ({ classDraft: { classId: 1, subclassId: 12 }, classOptions: [{ value: 1, label: 'Computer' }],
                           subclassOptions: PM.subclassOptionsFor(SUBS, 1) });
  await withDom(async dlg => {
    const a = actions(o => o.endpoint === 'eqp-v1/patchEquipment' ? { ok: true }
      : { ok: true, body: Object.assign({}, MASTER, { equipmentSubclassId: 12, objectVersionNumber: 4 }) });
    const c = ctx('FULL', saveVars());
    await new (loadChain('saveClassChangeChain', a.Actions))().run(c);
    const patch = a.log.rest[0];
    T.eq('PATCHes this item', patch.uriParams.id, 500);
    T.eq('sends both ids + version', JSON.stringify(patch.body), '{"equipmentClassId":1,"equipmentSubclassId":12,"objectVersionNumber":3}');
    T.eq('reads the record back', a.log.rest[1].endpoint, 'eqp-v1/getEquipriteV1EquipmentMasterById');
    T.eq('card shows the new subclass', c.$page.variables.masterRecord.equipmentSubclassName, 'Laptop');
    T.eq('card has the new version', c.$page.variables.masterRecord.objectVersionNumber, 4);
    T.eq('dialog closed', dlg.closed, 1);
    T.eq('says so', a.log.notes[0].summary, 'Class changed');
    T.eq('inherited expenditure types reloaded', a.log.chains.join(','), 'loadEquipExpTypesChain');
    T.eq('saving flag released', c.$page.variables.classChangeSaving, false);
  });

  await withDom(async dlg => {
    // PATCH says 200 but the server kept the old subclass
    const a = actions(o => o.endpoint === 'eqp-v1/patchEquipment' ? { ok: true } : { ok: true, body: Object.assign({}, MASTER) });
    const c = ctx('FULL', saveVars());
    await new (loadChain('saveClassChangeChain', a.Actions))().run(c);
    T.check('not applied -> reported, not success', /did not apply/.test(c.$page.variables.classChangeError), c.$page.variables.classChangeError);
    T.eq('  no success toast', a.log.notes.length, 0);
    T.eq('  dialog stays open', dlg.closed, 0);
    T.eq('  card unchanged', c.$page.variables.masterRecord.equipmentSubclassId, 11);
  });

  await withDom(async () => {
    const a = actions(() => ({ ok: false, status: 409 }));
    const c = ctx('FULL', saveVars());
    await new (loadChain('saveClassChangeChain', a.Actions))().run(c);
    T.check('409 -> someone else changed it', /Someone else/.test(c.$page.variables.classChangeError));
  });

  await withDom(async () => {
    const a = actions(() => ({ ok: true }));
    const c = ctx('FULL', { classDraft: { classId: 1, subclassId: null }, subclassOptions: PM.subclassOptionsFor(SUBS, 1) });
    await new (loadChain('saveClassChangeChain', a.Actions))().run(c);
    T.eq('missing subclass: nothing sent', a.log.rest.length, 0);
    T.check('  and says why', /Choose one/.test(c.$page.variables.classChangeError));

    const r = ctx('READ_ONLY', saveVars());
    await new (loadChain('saveClassChangeChain', a.Actions))().run(r);
    T.eq('READ_ONLY: nothing sent', a.log.rest.length, 0);
  });

  T.section('markup');
  const html = fs.readFileSync(path.join(H.PAGES, 'equipment-units-page.html'), 'utf8');
  T.check('button gated on FULL', /'EQR_EQUIPMENT_MASTER'\) === 'FULL' \]\]">\s*<oj-button[^>]*\s+disabled="\[\[ !\$variables\.masterRecord\.id \]\]"\s+on-oj-action="\[\[ \$listeners\.onChangeClassClicked/.test(html));
  T.check('dialog at top level (not inside the page component)',
    html.indexOf('id="changeClassDialog"') > html.lastIndexOf('</oj-sp-general-overview-page>'));
  const j = H.readJson(path.join(H.PAGES, 'equipment-units-page.json'));
  T.eq('class change listener passes the event',
    j.eventListeners.onClassDraftChanged.chains[0].parameters.event, '[[ $event ]]');

  T.section('inventory units table (EQR_INVENTORY_ITEM_REF)');
  // The API field is onHandQty (and availableToReserve); the column read
  // "quantity", which does not exist, so every row showed a blank Quantity.
  T.check('Quantity bound to onHandQty', /"headerText": "Quantity",\s+"field": "onHandQty"/.test(html));
  T.check('Available bound to availableToReserve', /"headerText": "Available",\s+"field": "availableToReserve"/.test(html));
  T.check('no column reads the non-existent "quantity" field', !/"field": "quantity"/.test(html));

  T.report();
})().catch(e => { console.error(e); process.exitCode = 1; });
