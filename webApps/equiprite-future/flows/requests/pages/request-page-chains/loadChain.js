define(['vb/action/actionChain', 'resources/js/future/fxPage', 'resources/js/shellBus'], (ActionChain, fx, bus) => {
  'use strict';

  // Request's view model: store.view('request', id). Runs on vbEnter and on every fxRefresh; replaces v, never mutates it.
  class loadChain extends ActionChain {
    async run(context) {
      const v = fx.view('request', context.$page.variables.id);
      // The tab's title: the request's number once it is known.
      const pv = context.$page.variables;
      if (v.number && v.number !== pv.number) bus.rename('request:' + pv.id, v.number);
      context.$page.variables.v = v;
    }
  }

  return loadChain;
});
