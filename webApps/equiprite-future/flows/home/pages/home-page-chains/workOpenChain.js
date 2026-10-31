define(['vb/action/actionChain', 'resources/js/shellBus'], (ActionChain, bus) => {
  'use strict';

  // A tile, a shortcut, a "needs you" row or a request: open it in its tab.
  class workOpenChain extends ActionChain {
    async run(context, { navId, id, number }) {
      if (id || number) bus.open({ record: 'request', params: { id: id ? Number(id) : undefined, number: number || '' } });
      else if (navId) bus.open({ navId });
    }
  }

  return workOpenChain;
});
