define(['vb/action/actionChain', 'resources/js/shellBus'], (ActionChain, bus) => {
  'use strict';

  // The request just saved from here, in its own tab.
  class openRequestChain extends ActionChain {
    async run(context, { id, number }) {
      if (!id && !number) return;
      bus.open({ record: 'request', params: { id: id ? Number(id) : undefined, number: number || '' } });
    }
  }

  return openRequestChain;
});
