define(['vb/action/actionChain', 'resources/js/future/fxPage'], (ActionChain, fx) => {
  'use strict';

  // The page pattern's one action chain (data-act on a clicked element), through fxPage.act. FDD 2.0 only reads: the
  // document changes nothing in the demo, so nothing on this page acts yet.
  class actChain extends ActionChain {
    async run(context, { data, type, payload }) {
      fx.act({ data, type, payload });
    }
  }

  return actChain;
});
