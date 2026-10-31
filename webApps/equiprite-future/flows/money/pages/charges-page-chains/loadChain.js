define(['vb/action/actionChain', 'resources/js/future/fxPage'], (ActionChain, fx) => {
  'use strict';

  // Charges & statements's view model: store.view('charges', filter). Runs on vbEnter and on every fxRefresh; replaces v, never mutates it.
  class loadChain extends ActionChain {
    async run(context) {
      const v = fx.view('charges', {});
      context.$page.variables.v = v;
    }
  }

  return loadChain;
});
