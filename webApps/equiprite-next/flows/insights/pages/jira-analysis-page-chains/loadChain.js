define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/jiraBacklog',
  'resources/js/nav',
  'resources/js/minutesClient',
  'resources/js/storyAnalysisRun',
], (ActionChain, Actions, J, N, M, R) => {
  'use strict';

  // Reads the one story (JQL "key = …") with its sub-tasks and comments from the connected Jira, builds the EquipRite
  // screen list (for the "which page" suggestion), reads the FDD library (the latest FDD is chosen), checks whether the
  // shared Ask AI is set up, and — once the story is in — asks the AI for the analysis. A 401/403 means Jira is not
  // connected (Jira stories is where to connect).
  class loadChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      if (v.story && v.story.key) return; // the tab kept its story
      const key = String(v.key || '').trim().toUpperCase();
      if (!key) { v.loading = false; v.error = 'No story was given.'; return; }
      v.loading = true; v.error = ''; v.notConnected = false;
      try { v.pages = Object.keys(N.ITEMS).map((id) => N.ITEMS[id]).filter((it) => it && it.label).map((it) => ({ label: it.label, keywords: it.keywords || '' })); } catch (e) { /* no nav */ }
      try { const a = await M.aiSettings(); v.aiReady = !!(a.ok && a.body && a.body.active); } catch (e) { v.aiReady = false; }
      try { await R.library(v, context.$application.path); } catch (e) { /* no library: the analysis reads only the story */ }
      try {
        const today = new Date().toISOString().slice(0, 10);
        const res = await J.load(context, Actions, 'key = ' + key);
        if (!res.ok) { if (res.status === 401 || res.status === 403) v.notConnected = true; else v.error = res.message || 'Could not read the story from Jira.'; return; }
        J.peopleOf(res.issues || []);
        const rows = (res.issues || []).map((i) => J.fromIssue(i, { today: today }));
        v.story = rows.filter((r) => String(r.key).toUpperCase() === key)[0] || rows[0] || null;
        if (!v.story) { v.error = key + ' was not found in Jira.'; return; }
      } catch (e) {
        v.error = String((e && e.message) || e); return;
      } finally {
        v.loading = false;
      }
      // The story is in: its whole activity (every comment, change and work log entry) and its images, so the analysis
      // reads all of it; then the AI (if it is set up; else the page shows a "set up AI" hint).
      if (!v.story) return;
      const plain = JSON.parse(JSON.stringify(v.story));
      v.activity = { loading: true };
      await Promise.all([
        J.loadActivity(context, Actions, plain.key, plain.attachments || []).then((act) => {
          act.loadedAt = Date.now();
          v.activity = act.ok ? act : { ok: false, message: act.message };
          if (act.ok) v.story = Object.assign({}, v.story, { history: act.history, worklog: act.worklog, spent: act.spent, comments: act.comments.slice().reverse() });
        }),
        (plain.attachments || []).some((a) => a.image)
          ? J.loadImages(context, Actions, plain).then((got) => { v.images = Object.assign({}, v.images || {}, got); }) : Promise.resolve()
      ]);
      if (v.aiReady) await R.analyze(v, context.$application.path); // a failure leaves the re-run button
    }
  }

  return loadChain;
});
