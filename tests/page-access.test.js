/*
 * Equipment Master RBAC — who may Create and Import, and who may open the
 * Units and Create pages.
 *
 * Before 2026-10-05 the gating stopped at the master page itself: Create and
 * Import From Fusion showed for READ_ONLY users, and the Units and Create
 * pages had no guard, so anyone with the URL could open them. Create and
 * Import both write the equipment master, so they need FULL.
 *
 * Runs the REAL app-flow access functions (pageAccess, getPageCodeForPage)
 * and the real chains / page module, against a fake Actions layer.
 *
 * Run:  node tests/page-access.test.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const H    = require('./_harness');

const T = H.makeAsserter();

// ── loaders ──────────────────────────────────────────────────────────

function loadAppFunctions() {
  const src = fs.readFileSync(path.join(H.APP, 'app-flow.js'), 'utf8');
  let Mod;
  const define = (deps, factory) => { Mod = factory.apply(null, deps.map(() => ({}))); };
  // Module scope patches header strips in the DOM; give it an inert one.
  const document = { querySelectorAll: () => [], body: {} };
  function MutationObserver() { this.observe = () => {}; }
  const setTimeout = () => 0;
  new Function('define', 'document', 'MutationObserver', 'setTimeout', src)(
    define, document, MutationObserver, setTimeout);
  return new Mod();
}

function loadChainAt(file, Actions) {
  const src = fs.readFileSync(path.join(H.PAGES, file), 'utf8');
  let mod;
  const define = (deps, factory) => {
    mod = factory.apply(null, deps.map(d =>
      d === 'vb/action/actionChain' ? class ActionChain {} :
      d === 'vb/action/actions' ? Actions : {}));
  };
  new Function('define', src)(define);
  return mod;
}

function fakeActions() {
  const log = { nav: [], flows: [], notes: [], chains: [] };
  return {
    log,
    Actions: {
      navigateToPage: async (_c, o) => { log.nav.push(o.page); },
      navigateToFlow: async (_c, o) => { log.flows.push(o); },
      fireNotificationEvent: async (_c, n) => { log.notes.push(n); },
      callChain: async (_c, o) => { log.chains.push(o.chain); }
    }
  };
}

const APPFN = loadAppFunctions();
const appCtx = (level, loaded, pageId) => ({
  $application: {
    functions: APPFN,
    currentPage: { id: pageId || 'equipment-master' },
    variables: {
      pageAccessMap: level ? { EQR_EQUIPMENT_MASTER: level } : {},
      pageAccessLoaded: loaded !== false
    }
  }
});

(async () => {

  T.section('page codes: Units and Create are gated as Equipment Master');
  T.eq('equipment-units -> EQR_EQUIPMENT_MASTER',
    APPFN.getPageCodeForPage({ id: 'equipment-units' }), 'EQR_EQUIPMENT_MASTER');
  T.eq('equipment-create -> EQR_EQUIPMENT_MASTER',
    APPFN.getPageCodeForPage({ id: 'equipment-create' }), 'EQR_EQUIPMENT_MASTER');

  T.section('page json wiring');
  const unitsJson  = H.readJson(path.join(H.PAGES, 'equipment-units-page.json'));
  const createJson = H.readJson(path.join(H.PAGES, 'equipment-create-page.json'));
  const chainOf = j => (((j.eventListeners || {}).vbBeforeEnter || {}).chains || []).map(c => c.chain);
  T.check('units page runs enforcePageAccessChain on vbBeforeEnter',
    chainOf(unitsJson).includes('enforcePageAccessChain'));
  T.check('create page runs requireFullAccessChain on vbBeforeEnter',
    chainOf(createJson).includes('requireFullAccessChain'));
  const master = fs.readFileSync(path.join(H.PAGES, 'equipment-master-page-chains', 'enforcePageAccessChain.js'), 'utf8');
  const units  = fs.readFileSync(path.join(H.PAGES, 'equipment-units-page-chains', 'enforcePageAccessChain.js'), 'utf8');
  T.check('units guard is byte-identical to the generated template', master === units);

  T.section('Create page guard (requireFullAccessChain)');
  for (const [level, loaded, bounced] of [
    ['FULL', true, false], ['READ_ONLY', true, true], ['HIDDEN', true, true],
    [null, true, true], ['READ_ONLY', false, false]
  ]) {
    const A = fakeActions();
    const C = loadChainAt('equipment-create-page-chains/requireFullAccessChain.js', A.Actions);
    await new C().run(appCtx(level, loaded, 'equipment-create'));
    T.eq('level=' + level + ' loaded=' + loaded + ' -> ' + (bounced ? 'sent back to master' : 'stays'),
      A.log.nav.join(','), bounced ? 'equipment-master' : '');
    if (bounced) T.eq('  and says why', A.log.notes.length, 1);
  }

  T.section('Create button (GoToCreateChain)');
  for (const [level, goes] of [['FULL', true], ['READ_ONLY', false], [null, false]]) {
    const A = fakeActions();
    const C = H.loadChain('GoToCreateChain', A.Actions);
    await new C().run(appCtx(level));
    T.eq('level=' + level, A.log.nav.join(','), goes ? 'equipment-create' : '');
  }


  T.section('Import From Fusion menu item (SecondaryActionChain)');
  const ev = id => ({ event: { detail: { secondaryItem: id } } });
  for (const [level, opens] of [['FULL', true], ['READ_ONLY', false], [null, false]]) {
    const A = fakeActions();
    const C = H.loadChain('SecondaryActionChain', A.Actions);
    await new C().run(appCtx(level), ev('importFusion'));
    T.eq('level=' + level, A.log.chains.join(','), opens ? 'OpenImportDialogChain' : '');
  }

  T.section('menu as shown (actionsFor)');
  const pm = H.loadPageModule();
  const declared = H.readJson(path.join(H.PAGES, 'equipment-master-page.json'))
    .variables.secondaryActions.defaultValue;
  const shown = lvl => pm.actionsFor(declared, lvl).filter(a => a.display === 'on').map(a => a.id).join(',');
  T.eq('FULL sees Sync, Import From Fusion and Refresh', shown('FULL'), 'syncFusion,importFusion,refresh');
  T.eq('READ_ONLY sees Refresh only', shown('READ_ONLY'), 'refresh');
  T.eq('not loaded (HIDDEN) sees Refresh only', shown('HIDDEN'), 'refresh');
  T.eq('declared menu is not mutated',
    declared.find(a => a.id === 'importFusion').display, 'on');
  T.eq('Sync from Fusion declared on (gated to FULL by actionsFor)',
    declared.find(a => a.id === 'syncFusion').display, 'on');
  T.eq('Map View stays off (not implemented)',
    declared.find(a => a.id === 'mapView').display, 'off');

  T.section('master page html binds the gates');
  const html = H.readPageFile('equipment-master-page.html');
  T.check('Create display bound to FULL',
    /primary-action\.display="\[\[[^"]*'EQR_EQUIPMENT_MASTER'\) === 'FULL'/.test(html));
  T.check('secondary actions go through actionsFor',
    /secondary-actions="\[\[ \$functions\.actionsFor\(/.test(html));

  T.report();
})().catch(e => { console.error(e); process.exitCode = 1; });
