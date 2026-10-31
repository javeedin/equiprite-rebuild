define(['vb/action/actionChain', 'resources/js/future/fxPage', 'resources/js/future/fxOps'], (ActionChain, fx, fxOps) => {
  'use strict';

  // Yard's view model: store.view('yard') with what Fusion does for each move, the fleet's certificates by country and
  // open customs (fxOps.yard). Runs on vbEnter and on every fxRefresh; replaces v, never mutates it. A confirmation
  // left open is worked out again on the new state.
  class loadChain extends ActionChain {
    async run(context) {
      const $v = context.$page.variables;
      const base = fx.view('yard');
      let v;
      try {
        v = Object.assign({ ready: true, error: base.error || '' }, fxOps.yard(fx.store.get()));
      } catch (e) {
        v = Object.assign({ toShip: [], out: [], toCollect: [], toInspect: [], repairs: [], fleet: [], counts: {}, me: { roles: [] } }, base, { error: String((e && e.message) || e) });
      }
      $v.v = v;
      if ($v.askDef && $v.askDef.open) $v.ask = fxOps.ask(fx.store.get(), $v.askDef.kind, $v.askDef.ids, $v.form).preview;
    }
  }

  return loadChain;
});
