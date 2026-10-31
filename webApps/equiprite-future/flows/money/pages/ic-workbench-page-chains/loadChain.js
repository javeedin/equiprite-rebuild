define(['vb/action/actionChain', 'resources/js/future/fxPage', 'resources/js/future/fxMoney'], (ActionChain, fx, money) => {
  'use strict';

  // Intercompany workbench: store.view('workbench') with what the screen adds (fxMoney.workbench): a dry run of each
  // invoice pair, settlement, accrual and internal posting, the reconciliation, and the transactions created with
  // their accounting. Runs on vbEnter and on every fxRefresh; replaces v, never mutates it.
  class loadChain extends ActionChain {
    async run(context) {
      const vars = context.$page.variables;
      const base = fx.view('workbench');
      let v = base;
      try {
        if (!base.error) v = Object.assign({ ready: true, error: '' }, money.workbench(fx.store.get(), base, vars.ui || {}));
      } catch (e) {
        v = Object.assign({}, base, { error: 'This screen could not be shown: ' + ((e && e.message) || e) });
      }
      context.$page.variables.v = v;
    }
  }

  return loadChain;
});
