define(['resources/js/future/fxPage', 'resources/js/exportKit'], (fx, exportKit) => {
  'use strict';

  // My requests: the page module. fx.Base subscribes the page to the store (fxRefresh → loadChain) and gives the shared
  // binding helpers (money, date, plural, arr, stageTone, …). The rows come from resources/js/future/fxRequests.js.
  class PageModule extends fx.Base {
    constructor(context) {
      super(context);
    }

    /** The export formats (Excel, CSV, PDF, Copy). */
    formats() { return exportKit.FORMATS; }
  }

  return PageModule;
});
