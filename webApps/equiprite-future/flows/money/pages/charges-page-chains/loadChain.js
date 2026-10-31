define(['vb/action/actionChain', 'resources/js/future/fxPage', 'resources/js/future/fxMoney'], (ActionChain, fx, money) => {
  'use strict';

  // Charges & statements: store.view('charges', { period }) with what the screen adds (fxMoney.charges): the charge
  // run and its dry run, each statement's lines and who may do what, the rules. Runs on vbEnter and on every
  // fxRefresh; replaces v, never mutates it.
  class loadChain extends ActionChain {
    async run(context) {
      const vars = context.$page.variables;
      const period = vars.period || '';
      const base = fx.view('charges', { period });
      let v = base;
      try {
        if (!base.error) v = Object.assign({ ready: true, error: '' }, money.charges(fx.store.get(), base, { period, runPeriod: vars.runPeriod || '' }));
      } catch (e) {
        v = Object.assign({}, base, { error: 'This screen could not be shown: ' + ((e && e.message) || e) });
      }
      context.$page.variables.v = v;
    }
  }

  return loadChain;
});
