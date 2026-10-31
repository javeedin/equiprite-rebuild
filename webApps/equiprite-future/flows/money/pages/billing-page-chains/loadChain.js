define(['vb/action/actionChain', 'resources/js/future/fxPage', 'resources/js/future/fxMoney'], (ActionChain, fx, money) => {
  'use strict';

  // Customer billing: store.view('billing') with what the screen adds (fxMoney.billing): a dry run of each customer
  // invoice, deposit, project bill and payment, with the accounting Fusion makes. Runs on vbEnter and on every
  // fxRefresh; replaces v, never mutates it.
  class loadChain extends ActionChain {
    async run(context) {
      const vars = context.$page.variables;
      const base = fx.view('billing');
      let v = base;
      try {
        if (!base.error) v = Object.assign({ ready: true, error: '' }, money.billing(fx.store.get(), base, vars.ui || {}));
      } catch (e) {
        v = Object.assign({}, base, { error: 'This screen could not be shown: ' + ((e && e.message) || e) });
      }
      context.$page.variables.v = v;
    }
  }

  return loadChain;
});
