define(['resources/js/future/fxPage'], (fx) => {
  'use strict';

  // Guide: the page module. fx.Base subscribes the page to the store (fxRefresh → loadChain) and gives the shared
  // binding helpers; the steps' words and players come from resources/js/future/fxGuide.js (loadChain).
  class PageModule extends fx.Base {
    constructor(context) {
      super(context);
    }
  }

  return PageModule;
});
