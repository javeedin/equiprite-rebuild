define(['resources/js/future/fxPage'], (fx) => {
  'use strict';

  // FDD 2.0: the page module. fx.Base subscribes the page to the store (fxRefresh → loadChain) and gives the shared
  // binding helpers; the document's address and chapters come from resources/js/future/fxFdd2.js (loadChain).
  class PageModule extends fx.Base {
    constructor(context) {
      super(context);
    }
  }

  return PageModule;
});
