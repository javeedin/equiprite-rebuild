define(['vb/action/actionChain', 'resources/js/future/fxPage'], (ActionChain, fx) => {
  'use strict';

  // Every action on this page (Play as …: data-act="setPersona" data-id="p-em" data-open="approvals"): fxPage.act runs
  // it through the store, toasts a failure in plain words, and opens data-open's screen once it worked.
  class actChain extends ActionChain {
    async run(context, { data, type, payload }) {
      fx.act({ data, type, payload });
    }
  }

  return actChain;
});
