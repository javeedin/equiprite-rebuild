define([
  'vb/action/actionChain',
  'resources/js/sqlClient',
], (ActionChain, sql) => {
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
      const c = await sql.connections();
      v.conns = c.ok && Array.isArray(c.body) ? c.body : [];
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
