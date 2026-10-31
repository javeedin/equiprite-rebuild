define(['vb/action/actionChain', 'resources/js/future/fxPage', 'resources/js/future/fxFinance'], (ActionChain, fx, fxFinance) => {
  'use strict';

  // Accounting (shown)'s view model: fxFinance.accounting() over fxViews.ledger(le) and fxViews.consolidation(), for the
  // company chosen (le) and the journal's kind filter (kind), limited to the persona's companies (Group for IC finance
  // and Admin). Runs on vbEnter, on every fxRefresh and after a pick; replaces v, never mutates it; never throws.
  class loadChain extends ActionChain {
    async run(context) {
      const pv = context.$page.variables;
      const me = fx.view('me');
      let v;
      try {
        v = fxFinance.accounting(fx.store.get(), { le: pv.le, kind: pv.kind, statementNav: fx.canOpen('ic-workbench', me.roles) ? 'ic-workbench' : 'charges' });
        v = Object.assign({ ready: true, error: '' }, v);
      } catch (e) {
        v = { ready: true, error: 'Accounting could not be shown: ' + String((e && e.message) || e), companies: [], current: '', isGroup: false, none: false,
          banner: '', subtitle: '', ledger: fxFinance.emptyLedger(), group: fxFinance.emptyGroup() };
      }
      v.me = me;
      pv.v = v;
    }
  }

  return loadChain;
});
