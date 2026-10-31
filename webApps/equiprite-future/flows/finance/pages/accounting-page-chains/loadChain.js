define(['vb/action/actionChain', 'resources/js/future/fxPage'], (ActionChain, fx) => {
  'use strict';

  // Accounting (shown)'s view model: store.view('ledger', leId), store.view('consolidation'). Runs on vbEnter and on every fxRefresh; replaces v, never mutates it.
  class loadChain extends ActionChain {
    async run(context) {
      const v = fx.view('consolidation');
      context.$page.variables.v = v;
    }
  }

  return loadChain;
});
