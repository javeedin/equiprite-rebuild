define(['vb/action/actionChain', 'resources/js/future/fxPage'], (ActionChain, fx) => {
  'use strict';

  // A step or scenario that is the persona's own: open its screen (data-nav="<navId>").
  class openChain extends ActionChain {
    async run(context, { data }) {
      fx.open(data);
    }
  }

  return openChain;
});
