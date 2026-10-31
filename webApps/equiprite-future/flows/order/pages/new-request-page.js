define(['resources/js/future/fxPage', 'resources/js/exportKit'], (fx, exportKit) => {
  'use strict';

  // New request: the page module. fx.Base subscribes the page to the store (fxRefresh → loadChain) and gives the shared
  // binding helpers; the steps, cards and payload come from resources/js/future/fxRequests.js.
  class PageModule extends fx.Base {
    constructor(context) {
      super(context);
    }

    /** The export formats (Excel, CSV, PDF, Copy). */
    formats() { return exportKit.FORMATS; }
  }

  return PageModule;
});
