define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/jiraBacklog',
  'resources/js/nav',
  'resources/js/minutesClient',
  'resources/js/storyAnalysisRun',
], (ActionChain, Actions, J, N, M, R) => {
  'use strict';

  // Reads the stories (one JQL search, "key in (…)") with their sub-tasks and comments, then each one's whole activity
  // (every comment, change and work log entry, four stories at a time), the EquipRite screen list and the FDD library
  // (the latest FDD is chosen), checks the shared Ask AI — and asks it for one analysis across the stories.
  const MAX = 25;

  class loadChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      if (v.stories && v.stories.length) return; // the tab kept its stories
      const keys = [];
      String(v.keys || '').toUpperCase().split(/[\s,]+/).forEach((k) => { if (/^[A-Z][A-Z0-9]*-\d+$/.test(k) && keys.indexOf(k) === -1) keys.push(k); });
      if (!keys.length) { v.loading = false; v.error = 'No stories were given.'; return; }
      if (keys.length > MAX) { v.loading = false; v.error = 'That is ' + keys.length + ' stories: analyse ' + MAX + ' or fewer at a time.'; return; }
      v.loading = true; v.error = ''; v.notConnected = false; v.progress = 'Reading ' + keys.length + ' stories from Jira…';
      try { v.pages = Object.keys(N.ITEMS).map((id) => N.ITEMS[id]).filter((it) => it && it.label).map((it) => ({ label: it.label, keywords: it.keywords || '' })); } catch (e) { /* no nav */ }
      try { const a = await M.aiSettings(); v.aiReady = !!(a.ok && a.body && a.body.active); } catch (e) { v.aiReady = false; }
      try { await R.library(v, context.$application.path); } catch (e) { /* no library: the analysis reads only the stories */ }
      let rows = [];
      try {
        const today = new Date().toISOString().slice(0, 10);
        const res = await J.load(context, Actions, 'key in (' + keys.join(', ') + ')');
        if (!res.ok) { if (res.status === 401 || res.status === 403) v.notConnected = true; else v.error = res.message || 'Could not read the stories from Jira.'; v.loading = false; return; }
        J.peopleOf(res.issues || []);
        const byKey = {};
        (res.issues || []).forEach((i) => { const r = J.fromIssue(i, { today: today }); byKey[String(r.key).toUpperCase()] = r; });
        rows = keys.map((k) => byKey[k]).filter(Boolean);
        const lost = keys.filter((k) => !byKey[k]);
        v.missing = lost.length ? 'Not found in Jira: ' + lost.join(', ') : '';
        if (!rows.length) { v.error = 'None of ' + keys.join(', ') + ' was found in Jira.'; v.loading = false; return; }
      } catch (e) {
        v.error = String((e && e.message) || e); v.loading = false; return;
      }
      // each story's whole activity, four at a time, so the analysis reads all of it
      const acts = {};
      let done = 0;
      const queue = rows.slice();
      const worker = async () => {
        while (queue.length) {
          const r = queue.shift();
          const act = await J.loadActivity(context, Actions, r.key, JSON.parse(JSON.stringify(r.attachments || [])));
          act.loadedAt = Date.now();
          acts[r.key] = act.ok ? act : { ok: false, message: act.message };
          done++;
          v.progress = 'Reading the activity of ' + rows.length + ' stories… ' + done + ' of ' + rows.length;
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      v.activity = acts;
      v.stories = rows.map((r) => {
        const a = acts[r.key];
        return a && a.ok ? Object.assign({}, r, { history: a.history, worklog: a.worklog, spent: a.spent, comments: a.comments.slice().reverse() }) : r;
      });
      v.loading = false; v.progress = '';
      if (v.aiReady) await R.analyzeSet(v, context.$application.path); // a failure leaves the re-run button
    }
  }

  return loadChain;
});
