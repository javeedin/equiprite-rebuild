define(['vb/action/actionChain', 'resources/js/future/fxPage'], (ActionChain, fx) => {
  'use strict';

  // Every action on this page (approveRequest, Play as … and open …): a clicked element's data-act and data-…
  // attributes. fxPage.act runs it through the store and toasts what happened or the engine's error; the error also stays
  // on the page in words (failure) until the next action. The page refreshes through fxRefresh.
  class actChain extends ActionChain {
    async run(context, { data, type, payload }) {
      const res = fx.act({ data, type, payload });
      context.$page.variables.failure = res && !res.ok && !res.cancelled ? (res.error || 'It did not work.') : '';
    }
  }

  return actChain;
});
