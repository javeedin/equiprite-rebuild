define(['vb/action/actionChain', 'resources/js/future/fxPage'], (ActionChain, fx) => {
  'use strict';

  // Open what a clicked element names in its tab: data-nav="<navId>", or data-record="request" data-id data-number.
  class openChain extends ActionChain {
    async run(context, { data }) {
      fx.open(data);
    }
  }

  return openChain;
});
