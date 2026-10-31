define(['vb/action/actionChain', 'resources/js/future/fxPage', 'resources/js/future/fxRequests'], (ActionChain, fx, fxReq) => {
  'use strict';

  // My requests' view model: fxRequests.list(state, { chip, text }) for the persona played. Runs on vbEnter and on every
  // fxRefresh (the store changed: an action, the persona, the demo clock); replaces v, never mutates it.
  class loadChain extends ActionChain {
    async run(context) {
      const pv = context.$page.variables;
      try {
        pv.v = Object.assign({ ready: true, error: '' }, fxReq.list(fx.store.get(), { chip: pv.chip, text: pv.text }));
      } catch (e) {
        pv.v = { ready: true, error: 'My requests could not be shown: ' + ((e && e.message) || e), chips: [], rows: [] };
      }
    }
  }

  return loadChain;
});
