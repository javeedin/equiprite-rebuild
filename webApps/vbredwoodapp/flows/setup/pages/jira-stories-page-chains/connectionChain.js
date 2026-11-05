define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/jiraBacklog'
], (ActionChain, Actions, J) => {
  'use strict';

  // Connect Jira / Disconnect, in the desktop app only (deployed in VBCS the administrator sets the jira backend's
  // Basic authentication, and the page only says so). Connect hands the site, email and API token to the desktop app
  // (jiraBacklog.desktopSave), which keeps the token on the PC and adds it to the calls to Jira; the page clears the
  // token it was typed into and reads the stories again. Disconnect removes the email and token from the PC.
  class connectionChain extends ActionChain {
    async run(context, { act }) {
      const { $page } = context;
      const v = $page.variables;
      v.connError = '';
      if (act === 'disconnect') {
        await J.desktopForget();
        v.tokenInput = '';
        await Actions.callChain(context, { chain: 'loadJiraChain' });
        await Actions.fireNotificationEvent(context, {
          summary: 'Jira disconnected', message: 'The email and API token were removed from this PC.', displayMode: 'transient', type: 'info'
        });
        return;
      }

      const site = ('' + (v.siteInput || '')).trim() || J.SITE;
      const email = ('' + (v.emailInput || '')).trim();
      const token = ('' + (v.tokenInput || '')).trim();
      if (!email || (!token && !(v.conn && v.conn.hasToken))) {
        v.connError = 'Enter the email you sign in to Jira with and an Atlassian API token.';
        return;
      }
      v.connecting = true;
      const saved = await J.desktopSave({ site, email, token });
      v.connecting = false;
      if (!saved) {
        v.connError = 'The desktop app did not answer. Connect Jira works in the EquipRite desktop app.';
        return;
      }
      if (saved.error) {
        v.connError = saved.error;
        return;
      }
      v.tokenInput = '';
      await Actions.callChain(context, { chain: 'loadJiraChain' });
      if (v.conn && v.conn.state === 'connected') {
        await Actions.fireNotificationEvent(context, {
          summary: 'Jira connected', message: v.conn.name ? 'Signed in as ' + v.conn.name + '.' : 'Connected to ' + site + '.',
          displayMode: 'transient', type: 'confirmation'
        });
      } else if (v.conn && v.conn.state === 'refused') {
        v.connError = 'Jira refused that email and API token. Check them (the token is the one made at id.atlassian.com) and connect again.';
      }
    }
  }

  return connectionChain;
});
