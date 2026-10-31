define(['vb/action/actionChain', 'resources/js/future/fxPage'], (ActionChain, fx) => {
  'use strict';

  // Receive, hours, moves's view model: store.view('site'). Runs on vbEnter and on every fxRefresh; replaces v, never mutates it.
  class loadChain extends ActionChain {
    async run(context) {
      const v = fx.view('site');
      context.$page.variables.v = v;
    }
  }

  return loadChain;
});
