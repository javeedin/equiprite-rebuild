define(['vb/action/actionChain', 'resources/js/shellBus'], (ActionChain, bus) => {
  'use strict';

  // Another screen in its tab (Receiving & returns after a receipt inspection).
  class openScreenChain extends ActionChain {
    async run(context, { navId }) {
      if (navId) bus.open({ navId });
    }
  }

  return openScreenChain;
});
