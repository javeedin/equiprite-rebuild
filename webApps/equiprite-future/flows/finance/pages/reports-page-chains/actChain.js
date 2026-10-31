define(['vb/action/actionChain', 'resources/js/future/fxPage'], (ActionChain, fx) => {
  'use strict';

  // Every action on this page (the reports only read; Play as … would come here): fxPage.act runs it through the
  // store and toasts what happened or the refusal; a refusal also stays on the page in words (failure).
  class actChain extends ActionChain {
    async run(context, { data, type, payload }) {
      const res = fx.act({ data, type, payload });
      if (res && res.cancelled) return;
      context.$page.variables.failure = res && !res.ok ? (res.error || 'That did not work.') : '';
    }
  }

  return actChain;
});
