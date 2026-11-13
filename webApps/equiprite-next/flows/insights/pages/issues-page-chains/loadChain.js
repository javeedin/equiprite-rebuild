define(['vb/action/actionChain', 'vb/action/actions', 'resources/js/issuesClient', 'resources/js/pagesClient', 'resources/js/shellBus'], (ActionChain, Actions, IC, PC, bus) => {
  'use strict';

  // Opening Issues (and Refresh): whether it works here (the desktop app), Jira and Microsoft 365; the issues; every VB
  // page for the page picker; an issue handed over by another screen (bus.focus('issues', { id })).
  class loadChain extends ActionChain {
    async run(context, { refresh }) {
      const v = context.$page.variables;
      v.scope = bus.scope(); // the build in scope (the top bar)
      v.busy = true;
      try {
        const [i, l] = await Promise.all([IC.info(), IC.list('', 'all')]);
        v.info = i.ok ? i.body : { ok: false, error: (i.body && i.body.error) || 'Issues need the EquipRite desktop app.' };
        v.issues = (l.body && l.body.issues) || [];
        v.counts = (l.body && l.body.counts) || v.counts;
        if (!v.pages.length || refresh) {
          const cat = await PC.catalog(context.$application.path);
          v.pages = ((cat.body && cat.body.pages) || []).filter((p) => !p.deleted && !p.missing).map((p) => ({ id: p.id, app: p.app, label: p.label, appName: p.appName, flow: p.flow, page: p.page }));
        }
      } finally {
        v.checked = true;
        v.busy = false;
      }
      const handed = bus.takeFocus('issues');
      const id = (handed && handed.id) || (refresh && v.selId) || '';
      if (id) await Actions.callChain(context, { chain: 'selectChain', params: { id: id } });
    }
  }
  return loadChain;
});
