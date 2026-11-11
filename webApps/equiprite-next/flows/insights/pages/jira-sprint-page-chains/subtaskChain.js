define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/jiraBacklog',
], (ActionChain, Actions, J) => {
  'use strict';

  // Expand/collapse a subtask inline in the sprint item's drawer. On first expand it fetches the subtask's full issue
  // from Jira (description, acceptance criteria, assignee, priority, status) and caches it by key, so re-opening is instant.
  class subtaskChain extends ActionChain {
    async run(context, { key }) {
      const v = context.$page.variables;
      const k = String(key || '');
      if (!k) return;
      if (v.openSub === k) { v.openSub = ''; return; } // clicking the open one collapses it
      v.openSub = k;
      if (v.subDetails && v.subDetails[k]) return; // already loaded
      v.subBusy = k;
      try {
        const today = new Date().toISOString().slice(0, 10);
        const res = await J.load(context, Actions, 'key = ' + k);
        if (res && res.ok && res.issues && res.issues[0]) {
          const row = J.fromIssue(res.issues[0], { today: today });
          v.subDetails = Object.assign({}, v.subDetails || {}, { [k]: row });
        }
      } catch (e) { /* leave it unloaded; the panel shows "could not load" */ }
      finally { if (v.subBusy === k) v.subBusy = ''; }
    }
  }

  return subtaskChain;
});
