define(['resources/js/future/fxPage', 'resources/js/exportKit'], (fx, exportKit) => {
  'use strict';

  // Accounting (shown): the page module. fx.Base subscribes the page to the store (fxRefresh → loadChain) and gives the
  // shared binding helpers (money, date, plural, canOpen, …); the view model is resources/js/future/fxFinance.js.
  class PageModule extends fx.Base {
    constructor(context) {
      super(context);
    }

    /** The export formats (Excel, CSV, PDF, Copy). */
    formats() { return exportKit.FORMATS; }

    /** aria-pressed / aria-expanded as VB wants them. */
    pressed(on) { return on ? 'true' : 'false'; }

    /** "3 of 12 transactions" or "12 transactions". */
    shownText(lg) {
      const l = lg || {};
      const all = fx.helpers.plural(l.count || 0, 'transaction');
      return l.kind ? (l.shown || 0) + ' of ' + all + ' · ' + l.kindLabel : all;
    }

    /** A request link's words: its number, or the number with "(not yours)" when the persona cannot open it. */
    requestTitle(r) { return r && r.visible ? 'Open ' + r.number : (r ? r.number + ' belongs to another business unit' : ''); }
  }

  return PageModule;
});
