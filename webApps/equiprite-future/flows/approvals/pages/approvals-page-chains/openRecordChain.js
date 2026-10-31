define(['vb/action/actionChain', 'resources/js/shellBus'], (ActionChain, bus) => {
  'use strict';

  // The request in a tab of its own (Requests' record tab); this queue stays as it is.
  class openRecordChain extends ActionChain {
    async run(context, { id, number }) {
      if (!id && !number) return;
      bus.open({ record: 'request', params: { id: id ? Number(id) : undefined, number: number || '' } });
    }
  }

  return openRecordChain;
});
