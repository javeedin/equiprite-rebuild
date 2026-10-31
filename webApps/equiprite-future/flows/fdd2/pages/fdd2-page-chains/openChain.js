define(['vb/action/actionChain', 'resources/js/future/fxPage'], (ActionChain, fx) => {
  'use strict';

  // A link to another screen (data-nav="guide": the Guide, where each scenario of the document is played).
  class openChain extends ActionChain {
    async run(context, { data }) {
      fx.open(data);
    }
  }

  return openChain;
});
