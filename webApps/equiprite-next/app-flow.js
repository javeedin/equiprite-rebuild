define([
  'resources/js/rules',
  'resources/js/nav',
  'resources/js/fmt',
], (rules, nav, fmt) => {
  'use strict';

  // EquipRite Next's app module: what bindings and the app loaders call ($application.functions.x). The rules live in
  // resources/js (rules.js, nav.js) so they are tested on their own; these only pass through. None uses `this`: a
  // binding may call a function detached from the module.
  class AppModule {
    // ── loaders (chains/) ──
    isFeatureEnabled(flags, loaded, key) { return rules.isFeatureEnabled(flags, loaded, key); }
    buRateSourceMap(rows) { return rules.buRateSourceMap(rows); }
    getLookupLabel(cache, loaded, type, code, fallback) { return rules.getLookupLabel(cache, loaded, type, code, fallback); }
    getLookupOptions(cache, loaded, type) { return loaded && cache && Array.isArray(cache[type]) ? cache[type].slice() : []; }

    // ── who and what ──
    pageAccess(map, loaded, pageCode) { return rules.pageAccess(map, loaded, pageCode); }
    canSee(map, loaded, pageCodes) { return rules.canSee(map, loaded, pageCodes); }
    persona(fusionRoles, sessionRoles, viewAs) { return viewAs || rules.persona(fusionRoles, sessionRoles); }
    personas(fusionRoles, sessionRoles) { return rules.personas(fusionRoles, sessionRoles); }
    personaLabel(code) { return rules.personaLabel(code); }
    isManager(fusionRoles, sessionRoles) { return rules.isManager(fusionRoles, sessionRoles); }
    isExternalSource(source) { return rules.isExternalSource(source); }
    isQuotingAllowed(settings, loaded, source) { return rules.isQuotingAllowed(settings, loaded, source); }
    userDisplayName(user) { return rules.userDisplayName(user); }
    userInitials(user) { return rules.userInitials(user); }

    // ── menu ──
    visibleGroups(map, loaded, flags, flagsLoaded, buRateSources) { return nav.visibleGroups(map, loaded, flags, flagsLoaded, buRateSources); }
    navItem(id) { return nav.item(id); }
    newUrl(newBase, navId) { return nav.newUrl(newBase, navId); }

    // ── formatting ──
    date(v, year) { return fmt.date(v, year); }
    range(a, b) { return fmt.range(a, b); }
    money(v, currency) { return fmt.money(v, currency); }
  }

  return AppModule;
});
