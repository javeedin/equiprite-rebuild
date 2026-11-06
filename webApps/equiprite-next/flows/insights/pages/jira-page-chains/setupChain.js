define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/testRecorder',
], (ActionChain, Actions, R) => {
  'use strict';

  // The header's "Set up transcription" button: the Whisper setup helper, then re-check whether it is ready (so the
  // button hides once it is) and refresh the open story's evidence.
  class setupChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      await R.openSetup();
      const ti = await R.transcribeInfo();
      v.transcribeReady = !!(ti.engines && ti.engines.length);
      await Actions.callChain(context, { chain: 'evidenceChain', params: { act: 'list' } });
    }
  }

  return setupChain;
});
