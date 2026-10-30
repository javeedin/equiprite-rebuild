define(['vb/action/actionChain', 'resources/js/shellBus'], (ActionChain, bus) => {
  'use strict';

  // The open request's number: the request in its own tab (journey, every line, the facts).
  class openRequestChain extends ActionChain {
    async run(context, { id, number }) {
      if (!id && !number) return;
      bus.open({ record: 'request', params: { id: id ? Number(id) : undefined, number: number || '' } });
    }
  }

  return openRequestChain;
});
