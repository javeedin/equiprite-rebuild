define(['vb/action/actionChain', 'vb/action/actions', 'resources/js/jiraFeed', 'resources/js/shellBus', 'resources/js/nav'], (ActionChain, Actions, F, bus, nav) => {
  'use strict';

  // Build.Rite's Jira updates bell (resources/js/jiraFeed.js): read when the shell opens and every five minutes (the
  // bell counts what came since it was last opened), when it is opened, or for another number of days; a kind chosen;
  // an update opened (the story in Jira stories, its drawer).
  //   init · refresh · toggle · close · kind <k> · days <n> · open <key>
  const SEEN = 'eqr.build.jiraSeen';
  const clock = () => { const d = new Date(); const p2 = (n) => (n < 10 ? '0' : '') + n; return p2(d.getHours()) + ':' + p2(d.getMinutes()); };
  class jiraFeedChain extends ActionChain {
    async run(context, { act, key }) {
      const v = context.$page.variables;
      if (!(nav.product && nav.product.isBuild) || !act) return;
      const read = async (quiet) => {
        if (v.jiraBusy) return;
        v.jiraBusy = !quiet || !v.jiraEvents.length;
        try {
          const r = await F.load(context, Actions, { days: v.jiraDays });
          if (r.ok) { v.jiraEvents = r.events; v.jiraError = ''; v.jiraAt = clock(); } else v.jiraError = r.message;
          v.jiraNew = F.newSince(v.jiraEvents, v.jiraSeen);
        } finally { v.jiraBusy = false; }
      };
      if (act === 'init') {
        try { v.jiraSeen = localStorage.getItem(SEEN) || ''; } catch (e) { v.jiraSeen = ''; }
        await read(true);
        return;
      }
      if (act === 'refresh') { await read(true); return; }
      if (act === 'toggle' || act === 'close') {
        if (v.jiraOpen) {
          v.jiraOpen = false;
          // all of these are seen now: the count starts again from here
          const latest = Date.parse((v.jiraEvents[0] && v.jiraEvents[0].at) || '') || 0;
          v.jiraSeen = new Date(Math.max(latest, Date.now())).toISOString();
          try { localStorage.setItem(SEEN, v.jiraSeen); } catch (e) { /* private mode */ }
          v.jiraNew = 0;
          return;
        }
        if (act === 'close') return;
        v.bellOpen = false; v.profileOpen = false; v.tabMenuOpen = false;
        v.jiraOpen = true;
        await read(false);
        return;
      }
      if (act === 'kind') { v.jiraKind = key || 'all'; return; }
      if (act === 'days') { v.jiraDays = Number(key) || 2; v.jiraEvents = []; await read(false); return; }
      // day by day: Daily progress in a tab of its own (the panel closes)
      if (act === 'progress') { await this.run(context, { act: 'close' }); bus.open({ record: 'jira-progress', params: {} }); return; }
      // the story, in Jira stories (its drawer: the whole activity); the panel stays open, as it was
      if (act === 'open' && key) bus.focus('jira', { key: key });
    }
  }
  return jiraFeedChain;
});
