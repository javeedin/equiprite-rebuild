define(['vb/action/actionChain', 'resources/js/shellBus'], (ActionChain, bus) => {
  'use strict';

  // A request's costs open in a tab of their own (record kind 'cost'); this list's tab stays as it is.
  class openRecordChain extends ActionChain {
    async run(context, { number }) {
      if (!number) return;
      bus.open({ record: 'cost', params: { number: String(number) } });
    }
  }

  return openRecordChain;
});
