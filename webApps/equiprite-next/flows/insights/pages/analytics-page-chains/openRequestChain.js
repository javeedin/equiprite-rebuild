define(['vb/action/actionChain', 'resources/js/shellBus'], (ActionChain, bus) => {
  'use strict';

  // A request in a late or request row opens in a tab of its own.
  class openRequestChain extends ActionChain {
    async run(context, { id, number }) {
      if (!id && !number) return;
      bus.open({ record: 'request', params: { id: id ? Number(id) : undefined, number: number || '' } });
    }
  }

  return openRequestChain;
});
