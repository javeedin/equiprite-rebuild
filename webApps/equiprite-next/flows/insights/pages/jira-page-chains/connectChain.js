define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/jiraBacklog',
], (ActionChain, Actions, J) => {
  'use strict';

  // The Jira connection:
  //   check    the desktop app's connection (null outside it) and who Jira signs in as (getJiraMyself)
  //   field    a field of the Connect form (site, email, token)
  //   save     Connect: the email and token to the desktop app (it keeps the token on this PC), then check and read
  //   forget   Disconnect: removed from this PC
  class connectChain extends ActionChain {
    async run(context, { act, field, value }) {
      const v = context.$page.variables;
      const conn = JSON.parse(JSON.stringify(v.conn || {}));
      if (act === 'field') {
        if (['site', 'email', 'token'].indexOf(field) !== -1) { conn[field] = value || ''; v.conn = conn; }
        return;
      }
      if (act === 'save') {
        conn.busy = true; conn.error = ''; v.conn = conn;
        const r = await J.desktopSave({ site: conn.site, email: conn.email, token: conn.token });
        const next = JSON.parse(JSON.stringify(v.conn));
        next.busy = false; next.token = '';
        if (!r || r.error) { next.error = (r && r.error) || 'The desktop app did not take it.'; v.conn = next; return; }
        v.conn = next;
        await this.check(context);
        if (v.conn.connected) await Actions.callChain(context, { chain: 'loadChain', params: { jql: v.jql } });
        return;
      }
      if (act === 'forget') {
        await J.desktopForget();
        const next = JSON.parse(JSON.stringify(v.conn));
        Object.assign(next, { connected: false, name: '', token: '', error: '' });
        v.conn = next;
        v.rows = [];
        await Actions.callChain(context, { chain: 'applyChain' });
        return;
      }
      await this.check(context);
    }

    async check(context) {
      const v = context.$page.variables;
      const conn = JSON.parse(JSON.stringify(v.conn || {}));
      const d = await J.desktopSettings();
      conn.desktop = !!d;
      if (d) { conn.site = d.site || conn.site; conn.email = d.email || conn.email; }
      const who = await J.whoAmI(context, Actions);
      conn.checked = true;
      conn.connected = who.ok; // only when Jira names the signed-in account (jiraBacklog.whoAmI)
      conn.name = who.ok ? who.name : '';
      conn.email = who.ok && who.email ? who.email : conn.email;
      // Not signed in: said when it is not the plain "never connected" case (a saved token Jira refuses, or not Jira)
      conn.error = who.ok ? '' : ((who.status === 401 || who.status === 403) && !(d && d.hasToken) ? '' : who.message);
      v.conn = conn;
    }
  }

  return connectChain;
});
