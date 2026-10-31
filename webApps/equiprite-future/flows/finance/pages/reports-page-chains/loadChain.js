define(['vb/action/actionChain', 'resources/js/future/fxPage'], (ActionChain, fx) => {
  'use strict';

  // Reports's view model: store.view('reports'). Runs on vbEnter and on every fxRefresh; replaces v, never mutates it.
  class loadChain extends ActionChain {
    async run(context) {
      const v = fx.view('reports');
      context.$page.variables.v = v;
    }
  }

  return loadChain;
});
