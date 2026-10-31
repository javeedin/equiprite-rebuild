define(['vb/action/actionChain', 'resources/js/future/fxPage', 'resources/js/future/fxMoney', 'resources/js/shellBus'], (ActionChain, fx, money, bus) => {
  'use strict';

  // Every action on this page: a clicked element's data-act and data-… attributes ({ data }). fxPage.act runs it
  // through the store and toasts what happened (a failed invoice pair as a warning: its error stays on the statement);
  // what the engine refused stays on the page, where it happened (failure). The page refreshes through fxRefresh.
  class actChain extends ActionChain {
    async run(context, { data, type, payload }) {
      const vars = context.$page.variables;
      const req = money.withForm(fx.request({ data, type, payload }), vars.ui);
      const problem = money.check(fx.store.get(), req);
      if (problem) {
        vars.failure = money.failure(fx.store.get(), req, problem);
        bus.toast(problem, 'error');
        return;
      }
      const res = fx.act(req);
      const ch = money.afterAct(req, res, fx.store.get(), vars);
      Object.keys(ch.set).forEach((k) => { vars[k] = ch.set[k]; });
    }
  }

  return actChain;
});
