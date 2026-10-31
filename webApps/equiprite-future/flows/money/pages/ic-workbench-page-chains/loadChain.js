define(['vb/action/actionChain', 'resources/js/future/fxPage'], (ActionChain, fx) => {
  'use strict';

  // Intercompany workbench's view model: store.view('workbench'). Runs on vbEnter and on every fxRefresh; replaces v, never mutates it.
  class loadChain extends ActionChain {
    async run(context) {
      const v = fx.view('workbench');
      context.$page.variables.v = v;
    }
  }

  return loadChain;
});
