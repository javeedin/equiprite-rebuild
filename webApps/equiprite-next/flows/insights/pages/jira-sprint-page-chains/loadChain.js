define([
  'resources/js/analysisStore',
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/jiraBacklog',
  'resources/js/testRecorder',
], (AS, ActionChain, Actions, J, R) => {
  'use strict';

  // Reads every item ever in the sprint (jiraBacklog.sprintJql: "sprint = id", which also finds what moved on to a later
  // sprint), and works out its report (sprintReport). A 401 means Jira is not connected: Jira stories is where to connect.
  class loadChain extends ActionChain {
    async run(context, { refresh }) {
      const v = context.$page.variables;
      v.selected = []; // a fresh read drops any follow-up selection
      v.itemF = {}; v.itemSort = { col: '', dir: 'asc' }; // and any column filters / sort
      // which items have recordings or screenshots on this PC (the icon after a summary)
      if (R && typeof R.index === 'function') R.index().then((ix) => { v.evidenceIndex = ix; }).catch(() => {});
      if (!refresh && v.report && v.report.rows && v.report.rows.length) return; // the tab kept its report
      if (!v.id && !v.name) { v.isLoading = false; v.error = 'No sprint was given.'; return; }
      v.isLoading = true;
      v.error = '';
      v.notConnected = false;
      try {
        const today = new Date().toISOString().slice(0, 10);
        const res = await J.load(context, Actions, J.sprintJql({ id: v.id, name: v.name }));
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) v.notConnected = true;
          else v.error = res.message;
          return;
        }
        J.peopleOf(res.issues); // everyone on any item first, so mentions read as names
        const rows = res.issues.map((i) => J.fromIssue(i, { today: today }));
        v.activity = {};
        // which items have a saved AI analysis (the AI icon), kept current as analyses are run in other tabs
        AS.on('sprint:' + (v.id || v.name), (idx) => { try { v.aiIndex = Object.assign({}, idx); } catch (e) { /* the page is gone */ } });
        AS.index().catch(() => {});
        v.report = J.sprintReport(rows, { id: v.id, name: v.name }, today);
        v.readAt = new Date().toTimeString().slice(0, 5);
      } finally {
        v.isLoading = false;
      }
    }
  }

  return loadChain;
});
