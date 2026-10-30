define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // The request just sent from here, where it is followed: Next's openRequestChain opens it in its own tab; on a phone
  // it opens in My requests (mobileBus.focus('track', { id, number }), through the page module, which makes sure My
  // requests reads its list again first).
  class openRequestChain extends ActionChain {
    async run(context, { id, number }) {
      if (!id && !number) return;
      await context.$page.functions.showInTrack(id ? Number(id) : undefined, number || '');
    }
  }

  return openRequestChain;
});
