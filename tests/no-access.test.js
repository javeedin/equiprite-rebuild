/*
 * No role -> no access.
 *
 * Before 2026-10-09 a user whose roles resolved to nothing could still use the
 * app: loadPageAccessChain left pageAccessLoaded false on every failure path,
 * canEnterPage ADMITS while that latch is false, and the Dashboard's View All
 * kept its default target (equipment-requests). So: Dashboard -> View All ->
 * a working Equipment Requests page. A role mapped to nothing landed on
 * Configuration Settings instead, whose guard found itself as the redirect
 * target and rendered it.
 *
 * Now the latch always settles, a user who can open nothing is sent to the
 * ungated No Access page, View All disappears without a persona, and the shell
 * re-checks the cold-load page once roles land.
 *
 * Runs the REAL app-flow functions and chains against a fake Actions layer.
 *
 * Run:  node tests/no-access.test.js
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
  const document = { querySelectorAll: () => [], body: {} };
  function MutationObserver() { this.observe = () => {}; }
  const setTimeout = () => 0;
  new Function('define', 'document', 'MutationObserver', 'setTimeout', src)(
    define, document, MutationObserver, setTimeout);
  return new Mod();
}

/** Load any chain by path under webApps/vbredwoodapp, with stubbed deps. */
function loadAppChain(rel, Actions, extra) {
  const src = fs.readFileSync(path.join(H.APP, rel), 'utf8');
  let mod;
  const define = (deps, factory) => {
    mod = factory.apply(null, deps.map(d =>
      d === 'vb/action/actionChain' ? class ActionChain {} :
      d === 'vb/action/actions' ? Actions :
      (extra && extra[d]) || {}));
  };
  new Function('define', src)(define);
  return mod;
}

function fakeActions(restReply) {
  const log = { nav: [], flows: [], notes: [], chains: [], rest: [] };
  return {
    log,
    Actions: {
      navigateToPage: async (_c, o) => { log.nav.push(o.page); },
      navigateToFlow: async (_c, o) => { log.flows.push(o); },
      fireNotificationEvent: async (_c, n) => { log.notes.push(n); },
      callChain: async (_c, o) => { log.chains.push(o.chain); },
      callRest: async (_c, o) => { log.rest.push(o.endpoint); return restReply ? restReply(o) : { ok: false }; }
    }
  };
}

const APPFN = loadAppFunctions();
const FLAGS = { PROJECTS_MODULE_ENABLED: 'true', CUSTOMERS_MODULE_ENABLED: 'true' };

function appCtx(pageId, map, loaded, extraVars) {
  return {
    $application: {
      functions: APPFN,
      currentPage: { id: pageId },
      user: { roles: [] },
      variables: Object.assign({
        pageAccessMap: map || {},
        pageAccessLoaded: loaded !== false,
        featureFlags: FLAGS,
        flagsLoaded: true,
        fusionRoles: [],
        sessionRoles: [],
        sessionRolesLoaded: true
      }, extraVars || {})
    }
  };
}

const GUARD = 'flows/main/pages/equipment-requests-page-chains/enforcePageAccessChain.js';
const CONFIG_GUARD = 'flows/setup/pages/configurations-page-chains/enforcePageAccessChain.js';
const RECHECK = 'pages/shell-page-chains/recheckPageAccessChain.js';
const LOADER = 'chains/loadPageAccessChain.js';

(async () => {

  T.section('getRoleHomeTarget: a role that can open nothing goes to No Access');
  for (const flags of [FLAGS, { CUSTOMERS_MODULE_ENABLED: 'true' }, {}]) {
    const home = APPFN.getRoleHomeTarget(flags, true, {}, true);
    T.eq('flags=' + JSON.stringify(flags) + ' -> main/no-access',
      home.flow + '/' + home.page, 'main/no-access');
  }
  const wb = APPFN.getRoleHomeTarget(FLAGS, true, { EQR_WORKBENCH: 'FULL' }, true);
  T.eq('a role WITH a page still lands on it', wb.page, 'equipment-workbench');
  const dash = APPFN.getRoleHomeTarget(FLAGS, true, { EQR_DASHBOARD: 'FULL' }, true);
  T.eq('a role with the Dashboard still lands on it', dash.page, 'main-equiprite');

  T.section('No Access page is ungated, registered, and in the main flow');
  T.eq('getPageCodeForPage(no-access) is "" (ungated)',
    APPFN.getPageCodeForPage({ id: 'no-access' }), '');
  T.check('isSameFlow(no-access, main)', APPFN.isSameFlow({ id: 'no-access' }, 'main'));
  const mainFlow = H.readJson(path.join(H.APP, 'flows', 'main', 'main-flow.json'));
  T.eq('main-flow.json registers no-access',
    (mainFlow.pages['no-access'] || {}).path, 'pages/no-access-page');
  const naJson = H.readJson(path.join(H.APP, 'flows', 'main', 'pages', 'no-access-page.json'));
  T.check('no-access page runs no page guard',
    !((naJson.eventListeners || {}).vbBeforeEnter));
  for (const ext of ['html', 'js']) {
    T.check('no-access-page.' + ext + ' exists',
      fs.existsSync(path.join(H.APP, 'flows', 'main', 'pages', 'no-access-page.' + ext)));
  }

  T.section('loadPageAccessChain: the latch settles in every outcome');
  {
    // No role at all: the BIP chain is faked out, the token carries nothing.
    const A = fakeActions();
    const C = loadAppChain(LOADER, A.Actions);
    const ctx = appCtx('main-equiprite', {}, false, { sessionRolesLoaded: false });
    await new C().run(ctx);
    T.check('no role -> pageAccessLoaded true', ctx.$application.variables.pageAccessLoaded === true);
    T.eq('no role -> map empty', JSON.stringify(ctx.$application.variables.pageAccessMap), '{}');
    T.check('no role -> sessionRolesLoaded true', ctx.$application.variables.sessionRolesLoaded === true);
    T.eq('no role -> no REST call made', A.log.rest.length, 0);
  }
  {
    // A role, but the page-access call fails.
    const A = fakeActions(() => ({ ok: false, statusCode: 500 }));
    const C = loadAppChain(LOADER, A.Actions);
    const ctx = appCtx('main-equiprite', {}, false, { fusionRoles: ['RT_EQP_UNMAPPED'] });
    await new C().run(ctx);
    T.check('failed call -> pageAccessLoaded true', ctx.$application.variables.pageAccessLoaded === true);
    T.eq('failed call -> map empty', JSON.stringify(ctx.$application.variables.pageAccessMap), '{}');
  }
  {
    // A role the backend does not recognise: {} back.
    const A = fakeActions(() => ({ ok: true, body: {} }));
    const C = loadAppChain(LOADER, A.Actions);
    const ctx = appCtx('main-equiprite', {}, false, { fusionRoles: ['RT_EQP_UNMAPPED'] });
    await new C().run(ctx);
    T.check('unmapped role -> pageAccessLoaded true', ctx.$application.variables.pageAccessLoaded === true);
    T.eq('unmapped role -> map empty', JSON.stringify(ctx.$application.variables.pageAccessMap), '{}');
  }
  {
    // Success is unchanged.
    const A = fakeActions(o => o.endpoint === 'eqp-v1/getRbacPageAccess'
      ? { ok: true, body: { EQR_WORKBENCH: 'FULL', EQR_BOGUS: 'ADMIN' } }
      : { ok: true, body: { data: [] } });
    const C = loadAppChain(LOADER, A.Actions);
    const ctx = appCtx('main-equiprite', {}, false, { fusionRoles: ['RT_EQP_MANAGER'] });
    await new C().run(ctx);
    T.eq('mapped role -> map populated (bad level dropped)',
      JSON.stringify(ctx.$application.variables.pageAccessMap), '{"EQR_WORKBENCH":"FULL"}');
    T.check('mapped role -> pageAccessLoaded true', ctx.$application.variables.pageAccessLoaded === true);
  }

  T.section('page guards: a settled empty map redirects to No Access');
  {
    const A = fakeActions();
    const C = loadAppChain(GUARD, A.Actions);
    await new C().run(appCtx('equipment-requests', {}, true));
    T.eq('Equipment Requests (same flow) -> navigateToPage no-access', A.log.nav.join(','), 'no-access');
  }
  {
    const A = fakeActions();
    const C = loadAppChain(CONFIG_GUARD, A.Actions);
    await new C().run(appCtx('configurations', {}, true));
    T.eq('Configuration Settings no longer renders for a no-role user',
      JSON.stringify(A.log.flows), JSON.stringify([{ flow: 'main', page: 'no-access', target: 'parent' }]));
  }
  {
    const A = fakeActions();
    const C = loadAppChain(GUARD, A.Actions);
    await new C().run(appCtx('equipment-requests', { EQR_EQUIPMENT_REQUESTS: 'READ_ONLY' }, true));
    T.eq('a role that holds the page still gets in', A.log.nav.length + A.log.flows.length, 0);
  }

  T.section('shell recheckPageAccessChain: cold-load page re-checked once roles land');
  {
    const A = fakeActions();
    const C = loadAppChain(RECHECK, A.Actions);
    await new C().run(appCtx('equipment-workbench', {}, true));
    T.eq('no role on Workbench -> sent to No Access',
      JSON.stringify(A.log.flows), JSON.stringify([{ flow: 'main', page: 'no-access' }]));
  }
  {
    const A = fakeActions();
    const C = loadAppChain(RECHECK, A.Actions);
    await new C().run(appCtx('no-access', {}, true));
    T.eq('already on No Access -> stays', A.log.flows.length + A.log.nav.length, 0);
  }
  {
    const A = fakeActions();
    const C = loadAppChain(RECHECK, A.Actions);
    await new C().run(appCtx('equipment-workbench', { EQR_WORKBENCH: 'FULL' }, true));
    T.eq('allowed page -> stays', A.log.flows.length + A.log.nav.length, 0);
  }
  const shellJson = H.readJson(path.join(H.APP, 'pages', 'shell-page.json'));
  T.check('shell runs recheckPageAccessChain on vbEnter',
    ((shellJson.eventListeners.vbEnter || {}).chains || []).some(c => c.chain === 'recheckPageAccessChain'));

  T.section('Dashboard: no persona -> no View All');
  {
    const A = fakeActions();
    const C = loadAppChain('flows/main/pages/main-equiprite-page-chains/dashboardInitChain.js',
      A.Actions, { 'resources/js/dashboardRoleConfig': { STATUSES: {}, forRole: () => null } });
    const ctx = appCtx('main-equiprite', { EQR_DASHBOARD: 'FULL' }, true, { fusionRoles: ['SOME_ROLE'] });
    const pageVars = { tableViewAllNav: 'equipment-requests', tableTitle: 'Recent Requests' };
    ctx.$page = { variables: pageVars };
    await new C().run(ctx);
    T.eq('tableViewAllNav cleared', pageVars.tableViewAllNav, '');
    T.check('no-persona message shown', /No dashboard persona/.test(pageVars.fetchError || ''));
  }
  const dashHtml = fs.readFileSync(path.join(H.APP, 'flows', 'main', 'pages', 'main-equiprite-page.html'), 'utf8');
  T.check('View All button is wrapped in a tableViewAllNav bind-if',
    /<oj-bind-if test="\[\[ !!\$variables\.tableViewAllNav \]\]">\s*<oj-button[^>]*onViewAllRecentRequests/.test(dashHtml));
  {
    const A = fakeActions();
    const C = loadAppChain('flows/main/pages/main-equiprite-page-chains/gotoNavTargetChain.js', A.Actions);
    await new C().run(appCtx('main-equiprite', {}, true), { navId: '' });
    T.eq('View All with an empty target navigates nowhere', A.log.nav.length + A.log.flows.length, 0);
  }

  T.section('guards stay byte-identical');
  const guards = [];
  for (const flow of fs.readdirSync(path.join(H.APP, 'flows'))) {
    const pagesDir = path.join(H.APP, 'flows', flow, 'pages');
    if (!fs.existsSync(pagesDir)) continue;
    for (const d of fs.readdirSync(pagesDir)) {
      const f = path.join(pagesDir, d, 'enforcePageAccessChain.js');
      if (fs.existsSync(f)) guards.push(fs.readFileSync(f, 'utf8'));
    }
  }
  T.check('found the generated guards (' + guards.length + ')', guards.length >= 20);
  T.check('all identical', guards.every(g => g === guards[0]));

  T.report();
})().catch(e => { console.error(e); process.exitCode = 1; });
