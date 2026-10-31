define(['resources/js/future/fxPage', 'resources/js/exportKit', 'resources/js/future/fxMoney'], (fx, exportKit, money) => {
  'use strict';

  // Customer billing: fx.Base subscribes the page to the store (fxRefresh → loadChain) and gives the shared binding
  // helpers. The screen's own helpers are below (no `this`).
  class PageModule extends fx.Base {
    constructor(context) {
      super(context);
    }

    /** The export menu's formats. */
    formats() { return exportKit.FORMATS; }

    /** How many rows a list exports (as shown). */
    count(list, v) { return money.exportCount('billing', list, v); }

    /** Whether an invoice's (or a preview's) accounting is open. */
    isOpen(map, id) { return !!(map && map[id]); }

    /** Whether the last failure belongs here (a customer, a request's deposit, a project, an invoice). */
    failedAt(failure, ref) { return !!(failure && failure.text && failure.ref === ref); }
  }

  return PageModule;
});
