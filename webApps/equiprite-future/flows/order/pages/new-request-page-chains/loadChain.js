define(['vb/action/actionChain', 'resources/js/future/fxPage', 'resources/js/future/fxRequests'], (ActionChain, fx, fxReq) => {
  'use strict';

  // New request's view model: fxRequests.form(state, form), the three steps for the persona played (their BUs, the
  // sourcing BUs they may borrow from, projects or customers, the units sourcing offers). Runs on vbEnter and on every
  // fxRefresh (another persona, the demo clock, another booking); replaces v, never mutates it. Writes nothing to the
  // store.
  class loadChain extends ActionChain {
    async run(context) {
      const pv = context.$page.variables;
      try {
        pv.v = fxReq.form(fx.store.get(), pv.form);
      } catch (e) {
        pv.v = { ready: true, error: 'New request could not be shown: ' + ((e && e.message) || e), steps: [], bus: [], sources: [], route: null, options: [], tasks: [], dateErrors: [], classes: [], groups: [], lines: [], review: [], reqNotes: [] };
      }
    }
  }

  return loadChain;
});
