define(['vb/action/actionChain', 'resources/js/future/fxPage'], (ActionChain, fx) => {
  'use strict';

  // Every action on this page: a clicked element's data-act and data-… attributes ({ data }), or { type, payload }
  // from a page function. fxPage.act runs it through the store, toasts the error in plain words or what happened, and
  // opens the request a result names (and data-open's screen). The page refreshes through fxRefresh.
  class actChain extends ActionChain {
    async run(context, { data, type, payload }) {
      fx.act({ data, type, payload });
    }
  }

  return actChain;
});
