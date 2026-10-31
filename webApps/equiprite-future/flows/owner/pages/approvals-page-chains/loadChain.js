define(['vb/action/actionChain', 'resources/js/future/fxPage'], (ActionChain, fx) => {
  'use strict';

  // Approve & allocate's view model: store.view('approvals'). Runs on vbEnter and on every fxRefresh; replaces v, never mutates it.
  class loadChain extends ActionChain {
    async run(context) {
      const v = fx.view('approvals');
      context.$page.variables.v = v;
    }
  }

  return loadChain;
});
