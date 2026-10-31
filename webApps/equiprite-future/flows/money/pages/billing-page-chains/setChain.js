define(['vb/action/actionChain', 'vb/action/actions', 'resources/js/future/fxPage', 'resources/js/future/fxMoney'], (ActionChain, Actions, fx, money) => {
  'use strict';

  // The page's own state: which accounting is open, an export menu. Nothing here changes the story (fxMoney.pick).
  class setChain extends ActionChain {
    async run(context, { field, value }) {
      const vars = context.$page.variables;
      const ch = money.pick(vars, field, value, fx.store.get());
      Object.keys(ch.set).forEach((k) => { vars[k] = ch.set[k]; });
      if (ch.reload) await Actions.callChain(context, { chain: 'loadChain' });
    }
  }

  return setChain;
});
