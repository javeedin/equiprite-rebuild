define([
  'resources/js/analysisStore',
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/jiraBacklog',
  'resources/js/testRecorder',
], (AS, ActionChain, Actions, J, R) => {
  'use strict';

  // Reads a JQL search from Jira, every page (jiraBacklog.load), makes the rows (fromIssue), the analysis (analyse)
  // and the Smart Search options (options), then applyChain. preset: one of jiraBacklog.PRESETS; jql: as typed ('' from
  // a key other than Enter: nothing to do).
  const OPTS = ['status', 'epic', 'assignee', 'release', 'sprint', 'priority', 'type'];

  class loadChain extends ActionChain {
    async run(context, { preset, jql }) {
      const v = context.$page.variables;
      let q = jql;
      if (preset) {
        const p = J.PRESETS.filter((x) => x.key === preset)[0];
        if (!p) return;
        v.preset = preset;
        q = p.jql;
      } else if (jql) {
        v.preset = (J.PRESETS.filter((x) => x.jql === jql)[0] || {}).key || '';
      }
      if (!q) return;
      v.jql = q;
      v.selKey = ''; // a new search: no item kept open (it may not be in the new results)
      v.isLoading = true;
      v.error = '';
      v.notice = '';
      try {
        const today = new Date().toISOString().slice(0, 10);
        const res = await J.load(context, Actions, q);
        if (!res.ok) {
          v.error = res.message;
          if (res.status === 401 || res.status === 403) {
            const conn = JSON.parse(JSON.stringify(v.conn));
            conn.connected = false; conn.checked = true;
            v.conn = conn;
          }
          return;
        }
        J.peopleOf(res.issues); // everyone on any story first, so a mention on one names someone seen on another
        const rows = res.issues.map((i) => J.fromIssue(i, { today: today, site: v.conn.site }));
        v.rows = rows;
        v.activity = {}; // read again when a story is opened
        // which stories have a saved AI analysis (the AI icon), kept current as analyses are run in other tabs
        AS.on('jira-page', (idx) => { try { v.aiIndex = Object.assign({}, idx); } catch (e) { /* the page is gone */ } });
        AS.index().catch(() => {});
        v.analysis = J.analyse(rows, today);
        // which of them have recordings or screenshots on this PC (the icon after a summary)
        v.evidenceIndex = R && typeof R.index === 'function' ? await R.index() : {};
        OPTS.forEach((f) => { v['rwOpt_' + f] = J.options(rows, f); });
        v.readAt = new Date().toTimeString().slice(0, 5);
        v.notice = res.capped ? res.message : (rows.length ? '' : 'Jira answered with no items for this search (as ' + (v.conn.name || 'the signed-in user') + ').');
      } finally {
        v.isLoading = false;
      }
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return loadChain;
});
