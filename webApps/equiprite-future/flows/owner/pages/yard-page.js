define(['resources/js/future/fxPage', 'resources/js/exportKit'], (fx, exportKit) => {
  'use strict';

  // Yard: the page module. fx.Base subscribes the page to the store (fxRefresh → loadChain) and gives the shared binding
  // helpers (money, date, plural, stageTone, …). These are the screen's own (no `this`: bindings call them detached).
  class PageModule extends fx.Base {
    constructor(context) {
      super(context);
    }

    /** The export formats (Excel, CSV, PDF, Copy). */
    formats() { return exportKit.FORMATS; }

    /** A confirmation's field shows (a field may show only for one answer of another, e.g. the damage amount). */
    shown(field, form) { return !field || !field.showIf || String((form || {})[field.showIf.key]) === String(field.showIf.value); }

    /** A choice field's option is the one chosen. */
    isOn(form, key, value) { return String((form || {})[key]) === String(value); }

    /** The confirm button's colour (fxOps.ask def.tone). */
    confirmClass(tone) { return 'nx-btn ' + ({ ok: 'nx-btn--primary nx-btn--ok', danger: 'nx-btn--primary nx-btn--danger' }[tone] || 'nx-btn--primary'); }

    /** A certificate's line: expired in red, ending within 30 days in amber. */
    certClass(c) { return c && c.expired ? 'fx-cert--expired' : (c && c.soon ? 'fx-cert--soon' : ''); }

    /** A section's count: amber when something waits. */
    countClass(n) { return 'fx-count' + (n > 0 ? ' fx-count--on' : ''); }
  }

  return PageModule;
});
