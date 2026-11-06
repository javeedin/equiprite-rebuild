define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // A Redwood header action (oj-sp secondary action): "Set up transcription" opens the Whisper setup, anything else
  // (Export to Excel) exports.
  class rwActionChain extends ActionChain {
    async run(context, { id }) {
      if (id === 'setup') { await Actions.callChain(context, { chain: 'setupChain' }); return; }
      await Actions.callChain(context, { chain: 'exportChain', params: { format: 'xlsx' } });
    }
  }

  return rwActionChain;
});
