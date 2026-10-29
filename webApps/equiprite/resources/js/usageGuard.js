define([], function () {
  'use strict';

  /*
   * Feature-flag guard for the Usage & cost pages, called first by each page's init chain.
   *
   * The old pages ran projectsModuleGuardChain on vbEnter (Equipment for Projects licensed, and TIMESHEETS_ENABLED
   * for the two timesheet pages) and Post Cost also ran ppmRatesGuardChain (withdrawn while PPM_RATES_ENABLED is on,
   * requirement R14). Hiding a menu entry removes the affordance, not the route, so a bookmark has to be refused too.
   *
   * Here the rule is read off the page's own menu item (group flags, item flags, hiddenWhenFlags) through
   * visibleNavGroups, with the item's page codes treated as open, so this guard answers ONLY the flag question (the
   * page-access question belongs to enforcePageAccessChain) and the menu and the guard cannot disagree.
   *
   * Fails closed like the old guards: if the settings never load, the page is left.
   */
  var TRIES = 300;
  var GAP_MS = 50;

  function reason(fns, vars, item) {
    if (!fns.isFeatureEnabled(vars.featureFlags, vars.flagsLoaded, 'PROJECTS_MODULE_ENABLED')) {
      return { summary: 'Module unavailable', message: 'Equipment for Projects is not enabled.' };
    }
    if ((item.flags || []).indexOf('TIMESHEETS_ENABLED') >= 0
        && !fns.isFeatureEnabled(vars.featureFlags, vars.flagsLoaded, 'TIMESHEETS_ENABLED')) {
      return { summary: 'Module unavailable', message: 'Timesheets are not enabled.' };
    }
    if ((item.hiddenWhenFlags || []).indexOf('PPM_RATES_ENABLED') >= 0) {
      return {
        summary: 'Post Cost unavailable',
        message: 'Rates come from Fusion PPM, so cost is calculated and posted there. '
          + 'Turn off Fusion PPM Rates in Configurations to use EquipRite costing.'
      };
    }
    return { summary: 'Not available', message: 'This screen is switched off in Configurations.' };
  }

  /**
   * @returns Promise<boolean> true to render the page; false after redirecting away.
   */
  async function allow(context, Actions) {
    var app = context.$application;
    var vars = app.variables;
    var fns = app.functions;
    for (var i = 0; i < TRIES && !vars.flagsLoaded; i++) {
      await new Promise(function (r) { setTimeout(r, GAP_MS); });
    }
    var item = fns.navItem(fns.getNavIdForPage(app.currentPage));
    if (!item) { return true; }
    if (vars.flagsLoaded) {
      var open = {};
      (item.pageCodes || []).forEach(function (c) { open[c] = 'FULL'; });
      var groups = fns.visibleNavGroups(open, true, vars.featureFlags, true, vars.buRateSources || {});
      var shown = groups.some(function (g) { return g.items.some(function (x) { return x.id === item.id; }); });
      if (shown) { return true; }
    }
    var why = vars.flagsLoaded ? reason(fns, vars, item)
      : { summary: 'Settings not loaded', message: 'The settings could not be loaded, so this screen stays closed.' };
    await Actions.fireNotificationEvent(context, { summary: why.summary, message: why.message, displayMode: 'transient', type: 'warning' });
    var home = fns.getRoleHomeTarget(vars.featureFlags, vars.flagsLoaded, vars.pageAccessMap, vars.pageAccessLoaded);
    if (fns.isSameFlow(app.currentPage, home.flow)) {
      await Actions.navigateToPage(context, { page: home.page, params: home.params || {} });
    } else {
      await Actions.navigateToFlow(context, { flow: home.flow, page: home.page, params: home.params || {}, target: 'parent' });
    }
    return false;
  }

  return { allow: allow };
});
