define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/jiraBacklog',
], (ActionChain, Actions, J) => {
  'use strict';

  // Opening the page: is it in the desktop app (which keeps the Jira token on this PC), and does Jira answer? Then the
  // default search. Deployed, the jira backend's Basic authentication is the VBCS administrator's.
  class initChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      if (v.rows && v.rows.length) return; // the tab kept its stories
      await Actions.callChain(context, { chain: 'connectChain', params: { act: 'check' } });
      if (v.conn.connected) await Actions.callChain(context, { chain: 'loadChain', params: { preset: v.preset || 'stories' } });
    }
  }

  return initChain;
});
