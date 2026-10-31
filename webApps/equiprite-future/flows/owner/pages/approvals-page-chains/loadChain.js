define(['vb/action/actionChain', 'resources/js/future/fxPage', 'resources/js/future/fxOps'], (ActionChain, fx, fxOps) => {
  'use strict';

  // Approve & allocate's view model: store.view('approvals') with each line's facts, its unit options and what approving
  // sets off (fxOps.approvals). Runs on vbEnter and on every fxRefresh; replaces v, never mutates it. A confirmation
  // left open is worked out again on the new state (another tab may have changed it).
  class loadChain extends ActionChain {
    async run(context) {
      const $v = context.$page.variables;
      const base = fx.view('approvals');
      let v;
      try {
        v = Object.assign({ ready: true, error: base.error || '' }, fxOps.approvals(fx.store.get()));
      } catch (e) {
        v = Object.assign({ rows: [], chips: [], me: { roles: [] } }, base, { error: String((e && e.message) || e) });
      }
      $v.v = v;
      if ($v.askDef && $v.askDef.open) $v.ask = fxOps.ask(fx.store.get(), $v.askDef.kind, $v.askDef.ids, $v.form).preview;
    }
  }

  return loadChain;
});
