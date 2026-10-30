define(['vb/action/actionChain', 'resources/js/shellBus'], (ActionChain, bus) => {
  'use strict';

  // A request (its own tab) or a screen (Receiving & returns, Picking & shipping, Availability) from the unit panel.
  class openChain extends ActionChain {
    async run(context, { id, number, navId }) {
      if (navId) { bus.open({ navId }); return; }
      if (id || number) bus.open({ record: 'request', params: { id: id ? Number(id) : undefined, number: number || '' } });
    }
  }

  return openChain;
});
