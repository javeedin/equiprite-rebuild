define(['vb/action/actionChain', 'resources/js/shellBus'], (ActionChain, bus) => {
  'use strict';
  class openListChain extends ActionChain {
    async run() { bus.open({ navId: 'transfers' }); }
  }
  return openListChain;
});
