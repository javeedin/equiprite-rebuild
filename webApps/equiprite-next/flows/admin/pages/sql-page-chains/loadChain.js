define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/sqlClient',
], (ActionChain, Actions, sql) => {
  'use strict';

  // Opening the worksheet: is the desktop app there to connect (not in VBCS), the saved connections, the worksheet's
  // text and history (this PC), and a session still open in the desktop app when the page was reloaded.
  class loadChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      try { v.sql = window.localStorage.getItem('equiprite-next:sql-worksheet') || ''; } catch (e) { /* no storage */ }
      try { v.history = JSON.parse(window.localStorage.getItem('equiprite-next:sql-history') || '[]'); } catch (e) { v.history = []; }
      const info = await sql.info();
      v.info = Object.assign({ checked: true }, info);
      if (!info.available) return;
      try { v.connsOpen = window.localStorage.getItem('equiprite-next:sql-conns-open') !== '0'; } catch (e) { /* no storage */ }
      // Ask AI: which LLM it uses (the bar says it).
      await Actions.callChain(context, { chain: 'aiChain', params: { op: 'load' } });
      const c = await sql.connections();
      v.conns = c.ok && Array.isArray(c.body) ? c.body : [];
      // Said, not shown as "No connection yet", when the saved connections cannot be read.
      v.connsError = c.ok && Array.isArray(c.body) ? '' : 'The saved connections could not be read: ' + ((c.body && c.body.error) || 'no answer from the desktop app') + '.';
      let last = null;
      try { last = JSON.parse(window.sessionStorage.getItem('equiprite-next:sql-session') || 'null'); } catch (e) { last = null; }
      if (last && last.id) {
        const s = await sql.sessions();
        const live = (s.ok && Array.isArray(s.body) ? s.body : []).filter((x) => x.session === last.id)[0];
        if (live) v.session = Object.assign({}, last, { pending: !!live.pending });
        else window.sessionStorage.removeItem('equiprite-next:sql-session');
      }
    }
  }

  return loadChain;
});
