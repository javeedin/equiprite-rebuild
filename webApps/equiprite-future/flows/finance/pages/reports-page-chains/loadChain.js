define(['vb/action/actionChain', 'resources/js/future/fxPage', 'resources/js/future/fxFinance'], (ActionChain, fx, fxFinance) => {
  'use strict';

  // Reports' view model: fxFinance.reports() over fxViews.reports and fxViews.workbench (the reconciliation), scoped
  // to the persona's companies (the whole group for IC finance and Admin). Runs on vbEnter and on every fxRefresh;
  // replaces v, never mutates it; never throws.
  class loadChain extends ActionChain {
    async run(context) {
      let v;
      try {
        v = Object.assign({ ready: true, error: '' }, fxFinance.reports(fx.store.get()));
      } catch (e) {
        v = { ready: true, error: 'The reports could not be shown: ' + String((e && e.message) || e), scope: '', today: '', groupCurrency: '', kpis: {}, utilisation: [], icByPair: [],
          recon: [], margins: [], fleet: [], customs: [], certs: [], accruals: [], disputes: [], buckets: [] };
      }
      v.me = fx.view('me');
      context.$page.variables.v = v;
    }
  }

  return loadChain;
});
