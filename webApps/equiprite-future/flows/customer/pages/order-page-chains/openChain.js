define(['vb/action/actionChain', 'resources/js/shellBus'], (ActionChain, bus) => {
  'use strict';

  // The request just sent or saved, in a tab of its own.
  class openChain extends ActionChain {
    async run(context, { id, number }) {
      if (!id && !number) return;
      bus.open({ record: 'customer-request', params: { id: id ? Number(id) : undefined, number: number || '' } });
    }
  }

  return openChain;
});
