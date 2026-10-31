define(['vb/action/actionChain', 'resources/js/future/fxPage'], (ActionChain, fx) => {
  'use strict';

  // My requests's view model: store.view('requests', filter). Runs on vbEnter and on every fxRefresh; replaces v, never mutates it.
  class loadChain extends ActionChain {
    async run(context) {
      const v = fx.view('requests', {});
      context.$page.variables.v = v;
    }
  }

  return loadChain;
});
