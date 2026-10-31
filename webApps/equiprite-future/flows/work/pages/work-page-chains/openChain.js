define(['vb/action/actionChain', 'resources/js/future/fxPage'], (ActionChain, fx) => {
  'use strict';

  // A queue, a request, a notification or a shortcut: open it in its tab (data-nav="<navId>", or data-record="request"
  // with data-id and data-number).
  class openChain extends ActionChain {
    async run(context, { data }) {
      fx.open(data);
    }
  }

  return openChain;
});
