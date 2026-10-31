define(['vb/action/actionChain', 'resources/js/future/fxPage', 'resources/js/future/fxOps'], (ActionChain, fx, fxOps) => {
  'use strict';

  // Receive, hours, moves: store.view('site') with each unit's hours grid (store.view('hours', lineId) by day on hire,
  // the site's weekend marked), its project segments and what each move means for the money (fxOps.site). Runs on
  // vbEnter and on every fxRefresh; replaces v, never mutates it. A confirmation left open is worked out again.
  class loadChain extends ActionChain {
    async run(context) {
      const $v = context.$page.variables;
      const base = fx.view('site');
      let v;
      try {
        v = Object.assign({ ready: true, error: base.error || '' }, fxOps.site(fx.store.get()));
      } catch (e) {
        v = Object.assign({ toReceive: [], onHire: [], counts: {}, can: {}, me: { roles: [] } }, base, { error: String((e && e.message) || e) });
      }
      $v.v = v;
      if ($v.askDef && $v.askDef.open) $v.ask = fxOps.ask(fx.store.get(), $v.askDef.kind, $v.askDef.ids, $v.form).preview;
    }
  }

  return loadChain;
});
