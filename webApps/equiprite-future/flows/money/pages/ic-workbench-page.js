define(['resources/js/future/fxPage', 'resources/js/exportKit', 'resources/js/future/fxMoney'], (fx, exportKit, money) => {
  'use strict';

  // Intercompany workbench: fx.Base subscribes the page to the store (fxRefresh → loadChain) and gives the shared
  // binding helpers. The screen's own helpers are below (no `this`).
  class PageModule extends fx.Base {
    constructor(context) {
      super(context);
    }

    /** The export menu's formats. */
    formats() { return exportKit.FORMATS; }

    /** How many rows a list exports (as shown). */
    count(list, v) { return money.exportCount('workbench', list, v); }

    /** Whether a transaction's (or a preview's) accounting is open. */
    isOpen(map, id) { return !!(map && map[id]); }

    /** Whether the last failure belongs here (a statement, the internal postings, the demo switch). */
    failedAt(failure, ref) { return !!(failure && failure.text && failure.ref === ref); }

    /** The demo switch's next value, as data-value. */
    flip(on) { return on ? 'false' : 'true'; }
  }

  return PageModule;
});
