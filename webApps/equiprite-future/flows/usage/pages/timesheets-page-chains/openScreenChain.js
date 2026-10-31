define(['vb/action/actionChain', 'resources/js/shellBus'], (ActionChain, bus) => {
  'use strict';

  class openScreenChain extends ActionChain {
    async run(context, { navId }) {
      bus.open({ navId });
    }
  }

  return openScreenChain;
});
