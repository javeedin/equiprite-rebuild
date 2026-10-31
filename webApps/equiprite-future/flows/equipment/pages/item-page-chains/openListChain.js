define(['vb/action/actionChain', 'resources/js/shellBus'], (ActionChain, bus) => {
  'use strict';

  // Back to the catalog: the Equipment master's tab (opened, or shown when it is open).
  class openListChain extends ActionChain {
    async run() { bus.open({ navId: 'equipment' }); }
  }

  return openListChain;
});
