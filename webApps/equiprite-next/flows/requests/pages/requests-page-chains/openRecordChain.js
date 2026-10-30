define(['vb/action/actionChain', 'resources/js/shellBus'], (ActionChain, bus) => {
  'use strict';

  // A request opens in a tab of its own (the shell keeps this list's tab as it is).
  class openRecordChain extends ActionChain {
    async run(context, { id, number }) {
      if (!id && !number) return;
      bus.open({ record: 'request', params: { id: id ? Number(id) : undefined, number: number || '' } });
    }
  }

  return openRecordChain;
});
