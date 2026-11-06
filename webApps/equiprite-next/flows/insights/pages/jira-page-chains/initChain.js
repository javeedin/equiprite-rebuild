define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/jiraBacklog',
  'resources/js/testRecorder',
], (ActionChain, Actions, J, R) => {
  'use strict';

  // Opening the page: is it in the desktop app (which keeps the Jira token on this PC), and does Jira answer? Then the
  // default search. Deployed, the jira backend's Basic authentication is the VBCS administrator's.
  class initChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      // The desktop app can record and transcribe; show "Set up transcription" in the header until Whisper is ready.
      if (R && typeof R.isDesktop === 'function' && R.isDesktop()) {
        v.desktopApp = true;
        const ti = typeof R.transcribeInfo === 'function' ? await R.transcribeInfo() : { engines: [] };
        v.transcribeReady = !!(ti.engines && ti.engines.length);
      } else { v.desktopApp = false; v.transcribeReady = true; }
      if (v.rows && v.rows.length) return; // the tab kept its stories
      await Actions.callChain(context, { chain: 'connectChain', params: { act: 'check' } });
      if (v.conn.connected) await Actions.callChain(context, { chain: 'loadChain', params: { preset: v.preset || 'stories' } });
    }
  }

  return initChain;
});
