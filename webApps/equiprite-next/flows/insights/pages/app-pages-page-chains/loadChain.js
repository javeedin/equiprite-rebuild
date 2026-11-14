define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/pagesClient',
  'resources/js/minutesClient',
  'resources/js/shellBus',
  'resources/js/nav',
], (ActionChain, Actions, PC, M, bus, N) => {
  'use strict';

  // Opening Application pages (and Refresh): whether this app can write into the project and capture screenshots, the
  // catalog (a fresh scan of the code from the local server, else the one shipped with the app), git's state, and a page
  // handed over by a Jira story (bus.focus).
  class loadChain extends ActionChain {
    async run(context, { refresh }) {
      const v = context.$page.variables;
      // your workspace set up or changed (the wizard, the top bar): its pages read again
      bus.on('vbs-changed', 'app-pages', (d) => { if (d && d.switched && !v.busy) Actions.callChain(context, { chain: 'loadChain', params: { refresh: true } }).catch(() => {}); });
      // the build in scope (Build.Rite's top bar): its pages first; All builds: every app
      if (!refresh && bus.scope()) v.appF = bus.scope();
      v.busy = true;
      try {
        // Refresh: what others pushed to the data branch first (a no-op without the local server or a data branch)
        if (refresh && v.info.canWrite) { try { await PC.gitPull(); } catch (e) { /* the catalog as it is */ } }
        const [info, cat] = await Promise.all([PC.info(), PC.catalog(context.$application.path)]);
        v.info = info;
        // Build.Rite: only your workspace's pages (its working folder) — none set up, none shown (never this project's)
        v.noWorkspace = !!(N.product && N.product.isBuild) && !(cat.body && cat.body.source);
        v.pages = v.noWorkspace ? [] : cat.body.pages;
        if (v.noWorkspace) { v.selId = ''; v.sheet = null; }
        // whose code: your workspace's working folder (Build.Rite's top bar), or this project
        v.codeFrom = cat.body && cat.body.source ? { source: cat.body.source, root: cat.body.root, space: cat.body.space || '' } : null;
        v.git = info.canWrite ? ((await PC.gitStatus()).body || null) : null;
        try { const a = await M.aiSettings(); v.aiReady = !!(a.ok && a.body && a.body.active); } catch (e) { v.aiReady = false; }
      } finally {
        v.checked = true;
        v.busy = false;
      }
      const handed = bus.takeFocus('app-pages');
      const id = (handed && handed.id) || (refresh && v.selId) || '';
      if (id) await Actions.callChain(context, { chain: 'selectChain', params: { id: id } });
    }
  }
  return loadChain;
});
