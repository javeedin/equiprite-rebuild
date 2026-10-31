define(['resources/js/future/fxPage'], (fx) => {
  'use strict';

  // Receive, hours, moves (skeleton): fx.Base subscribes the page to the store (fxRefresh → loadChain) and gives the shared binding
  // helpers (money, date, label, canOpen, stageTone, outline, …). Add this screen's own helpers here.
  class PageModule extends fx.Base {
    constructor(context) {
      super(context);
    }
  }

  return PageModule;
});
