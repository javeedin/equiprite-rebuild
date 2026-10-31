define(['vb/action/actionChain', 'resources/js/future/fxPage', 'resources/js/future/fxRequests', 'resources/js/shellBus'], (ActionChain, fx, fxReq, bus) => {
  'use strict';

  // The request's view model: fxRequests.request(state, id) for the persona played (hidden when it is not theirs). Runs
  // on vbEnter and on every fxRefresh; replaces v, never mutates it.
  class loadChain extends ActionChain {
    async run(context) {
      const pv = context.$page.variables;
      let v;
      try {
        v = fxReq.request(fx.store.get(), pv.id);
      } catch (e) {
        v = { ready: true, error: 'This request could not be shown: ' + ((e && e.message) || e) };
      }
      // The tab's title: the request's number once it is known.
      if (v.number && v.number !== pv.number) bus.rename('request:' + pv.id, v.number);
      pv.v = v;
    }
  }

  return loadChain;
});
