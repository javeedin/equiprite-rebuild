define([
  'resources/js/nav',
  'resources/js/future/fxStore',
], (nav, store) => {
  'use strict';

  // EquipRite Future's app module: what bindings call as $application.functions.x. Future has no page codes, flags or
  // Fusion roles: who sees what is the persona played (resources/js/future/fxStore.js, fxViews.me). None uses `this`:
  // a binding may call a function detached from the module.
  class AppModule {
    // ── menu ──
    navItem(id) { return nav.item(id); }
    /** Whether these persona roles may open a menu item's screen (nav.js). */
    canOpen(id, roles) { return nav.itemVisible(nav.item(id), roles); }

    // ── formatting, the one way fxViews writes it ──
    money(n, currency) { return store.fmt.money(n, currency); }
    date(iso) { return store.fmt.date(iso); }
    short(iso) { return store.fmt.short(iso); }
    period(p) { return store.fmt.period(p); }
  }

  return AppModule;
});
