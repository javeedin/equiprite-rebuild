define(['vb/action/actionChain', 'resources/js/future/fxPage'], (ActionChain, fx) => {
  'use strict';

  // New request's view model: store.view('me') + fxEngine.sourcing(...). Runs on vbEnter and on every fxRefresh; replaces v, never mutates it.
  class loadChain extends ActionChain {
    async run(context) {
      const v = fx.view('me');
      context.$page.variables.v = v;
    }
  }

  return loadChain;
});
