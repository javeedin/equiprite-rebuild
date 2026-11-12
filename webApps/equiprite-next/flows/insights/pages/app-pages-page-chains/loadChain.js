define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/pagesClient',
  'resources/js/minutesClient',
  'resources/js/shellBus',
], (ActionChain, Actions, PC, M, bus) => {
  'use strict';

  // Opening Application pages (and Refresh): whether this app can write into the project and capture screenshots, the
  // catalog (a fresh scan of the code from the local server, else the one shipped with the app), git's state, and a page
  // handed over by a Jira story (bus.focus).
  class loadChain extends ActionChain {
    async run(context, { refresh }) {
      const v = context.$page.variables;
      v.busy = true;
      try {
        const [info, cat] = await Promise.all([PC.info(), PC.catalog(context.$application.path)]);
        v.info = info;
        v.pages = cat.body.pages;
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
