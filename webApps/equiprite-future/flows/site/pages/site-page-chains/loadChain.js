define(['vb/action/actionChain', 'resources/js/future/fxPage', 'resources/js/future/fxOps', 'resources/js/future/fxReturn'], (ActionChain, fx, fxOps, fxReturn) => {
  'use strict';

  // Receive, hours, moves: store.view('site') with each unit's hours grid (store.view('hours', lineId) by day on hire,
  // the site's weekend marked), its project segments and what each move means for the money (fxOps.site). Runs on
  // vbEnter and on every fxRefresh; replaces v, never mutates it. A confirmation or a Return dialog left open is worked
  // out again (the state may have changed in another tab, or the demo clock reached a planned return).
  class loadChain extends ActionChain {
    async run(context) {
      const $v = context.$page.variables;
      const base = fx.view('site');
      const s = fx.store.get();
      let v;
      try {
        v = Object.assign({ ready: true, error: base.error || '' }, fxOps.site(s));
      } catch (e) {
        v = Object.assign({ toReceive: [], onHire: [], returned: [], counts: {}, can: {}, me: { roles: [] } }, base, { error: String((e && e.message) || e) });
      }
      $v.v = v;
      if ($v.askDef && $v.askDef.open) $v.ask = fxOps.ask(s, $v.askDef.kind, $v.askDef.ids, $v.form).preview;
      if ($v.retDef && $v.retDef.open) {
        const draft = JSON.parse(JSON.stringify($v.ret || {}));
        const def = fxReturn.def(s, { requestId: $v.retDef.requestId, lineId: $v.retDef.lineId }, draft.date, draft);
        $v.retView = fxReturn.preview(s, def, draft);
        $v.retDef = def;
      }
    }
  }

  return loadChain;
});
