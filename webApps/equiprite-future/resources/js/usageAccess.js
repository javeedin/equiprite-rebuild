define(['resources/js/rules', 'resources/js/nav'], function (rules, nav) {
  'use strict';

  // The entry check of the Usage & billing screens in EquipRite Next.
  //
  // New EquipRite's usageGuard (feature flags) and enforcePageAccessChain (page access) leave a page that is switched
  // off or closed to the role. In Next the shell already closes such a tab, with nav.itemVisible: the same rule as the
  // menu (group flag PROJECTS_MODULE_ENABLED, item flag TIMESHEETS_ENABLED, Post costs withdrawn under
  // PPM_RATES_ENABLED, the item's page codes). So a screen here only has to wait for the settings like usageGuard does,
  // say in words why it is closed (usageGuard's words), and learn whether the role may only look (READ_ONLY, New's
  // isPageReadOnly) and whether Fusion PPM prices the hours (PPM_RATES_ENABLED). It fails closed: settings that never
  // load leave the screen closed. Nothing is read or written until it answers open.
  var TRIES = 300;
  var GAP_MS = 50;

  function reason(v, it) {
    var flags = v.featureFlags;
    if (!rules.isFeatureEnabled(flags, true, 'PROJECTS_MODULE_ENABLED')) return 'Equipment for Projects is not enabled.';
    if ((it.flags || []).indexOf('TIMESHEETS_ENABLED') >= 0 && !rules.isFeatureEnabled(flags, true, 'TIMESHEETS_ENABLED')) {
      return 'Timesheets are not enabled.';
    }
    if ((it.hiddenWhenFlags || []).indexOf('PPM_RATES_ENABLED') >= 0 && !rules.isFeatureFlagOff(flags, true, 'PPM_RATES_ENABLED')) {
      return 'Rates come from Fusion PPM, so cost is calculated and posted there. '
        + 'Turn off Fusion PPM Rates in Configurations to use EquipRite costing.';
    }
    if (!rules.canSee(v.pageAccessMap, v.pageAccessLoaded, it.pageCodes)) return 'Your role cannot open this screen.';
    return 'This screen is switched off in Configurations.';
  }

  /**
   * For a menu item, once the settings are in: { settled, open, readOnly, ppmOn, reason }.
   * vars: $application.variables.
   */
  function answer(vars, navId) {
    var v = vars || {};
    var it = nav.item(navId);
    if (!it) return { settled: true, open: false, readOnly: true, ppmOn: false, reason: 'This screen is not known.' };
    if (!v.flagsLoaded || !v.pageAccessLoaded) {
      return { settled: false, open: false, readOnly: true, ppmOn: false, reason: 'The settings could not be loaded, so this screen stays closed.' };
    }
    var open = nav.itemVisible(it, v.pageAccessMap, v.pageAccessLoaded, v.featureFlags, v.flagsLoaded, v.buRateSources || {});
    return {
      settled: true,
      open: open,
      readOnly: rules.pageAccess(v.pageAccessMap, v.pageAccessLoaded, (it.pageCodes || []).join('|')) === 'READ_ONLY',
      ppmOn: rules.isFeatureEnabled(v.featureFlags, v.flagsLoaded, 'PPM_RATES_ENABLED'),
      reason: open ? '' : reason(v, it)
    };
  }

  /** Waits (up to 15 s, as usageGuard) for the settings and page access, then answers. */
  function settle(context, navId) {
    var vars = context.$application.variables;
    var i = 0;
    return new Promise(function (resolve) {
      (function tick() {
        if ((vars.flagsLoaded && vars.pageAccessLoaded) || i++ >= TRIES) resolve(answer(vars, navId));
        else setTimeout(tick, GAP_MS);
      }());
    });
  }

  return { answer: answer, settle: settle, reason: reason };
});
