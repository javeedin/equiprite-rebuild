define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // A Redwood header action (oj-sp secondary action): "Set up transcription" opens the Whisper setup, "Daily progress" its
  // tab, anything else
  // (Export to Excel) exports.
  class rwActionChain extends ActionChain {
    async run(context, { id }) {
      if (id === 'setup') { await Actions.callChain(context, { chain: 'setupChain' }); return; }
      if (id === 'progress') { await Actions.callChain(context, { chain: 'openProgressChain' }); return; }
      await Actions.callChain(context, { chain: 'exportChain', params: { format: 'xlsx' } });
    }
  }

  return rwActionChain;
});
