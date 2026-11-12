define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/jiraBacklog',
  'resources/js/nav',
  'resources/js/minutesClient',
  'resources/js/storyAnalysis',
], (ActionChain, Actions, J, N, M, SA) => {
  'use strict';

  // Reads the one story (JQL "key = …") with its sub-tasks and comments from the connected Jira, builds the EquipRite
  // screen list (for the "which page" suggestion), checks whether the shared Ask AI is set up, and — once the story is in
  // — asks the AI for the analysis. A 401/403 means Jira is not connected (Jira stories is where to connect).
  class loadChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      if (v.story && v.story.key) return; // the tab kept its story
      const key = String(v.key || '').trim().toUpperCase();
      if (!key) { v.loading = false; v.error = 'No story was given.'; return; }
      v.loading = true; v.error = ''; v.notConnected = false;
      try { v.pages = Object.keys(N.ITEMS).map((id) => N.ITEMS[id]).filter((it) => it && it.label).map((it) => ({ label: it.label, keywords: it.keywords || '' })); } catch (e) { /* no nav */ }
      try { const a = await M.aiSettings(); v.aiReady = !!(a.ok && a.body && a.body.active); } catch (e) { v.aiReady = false; }
      try {
        const today = new Date().toISOString().slice(0, 10);
        const res = await J.load(context, Actions, 'key = ' + key);
        if (!res.ok) { if (res.status === 401 || res.status === 403) v.notConnected = true; else v.error = res.message || 'Could not read the story from Jira.'; return; }
        const rows = (res.issues || []).map((i) => J.fromIssue(i, { today: today }));
        v.story = rows.filter((r) => String(r.key).toUpperCase() === key)[0] || rows[0] || null;
        if (!v.story) { v.error = key + ' was not found in Jira.'; return; }
      } catch (e) {
        v.error = String((e && e.message) || e); return;
      } finally {
        v.loading = false;
      }
      // The story is in: ask the AI for the analysis (if it is set up; else the page shows a "set up AI" hint).
      if (v.story && v.aiReady) {
        v.analyzing = true;
        try {
          const p = SA.prompt(v.story, v.pages, '');
          const r = await M.aiChat(p.system, p.user);
          if (r.ok && r.body && r.body.ok && r.body.text) { v.analysisHtml = SA.renderHtml(r.body.text); v.analysisProvider = r.body.provider || 'AI'; }
          else if (/choose the llm|not set up/i.test((r.body && r.body.error) || '')) v.aiReady = false;
        } catch (e) { /* leave the empty analysis; the re-run button is there */ } finally { v.analyzing = false; }
      }
    }
  }

  return loadChain;
});
