define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/jiraBacklog',
], (ActionChain, Actions, J) => {
  'use strict';

  // Reads every item ever in the sprint (jiraBacklog.sprintJql: "sprint = id", which also finds what moved on to a later
  // sprint), and works out its report (sprintReport). A 401 means Jira is not connected: Jira stories is where to connect.
  class loadChain extends ActionChain {
    async run(context, { refresh }) {
      const v = context.$page.variables;
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
        const rows = res.issues.map((i) => J.fromIssue(i, { today: today }));
        v.report = J.sprintReport(rows, { id: v.id, name: v.name }, today);
        v.readAt = new Date().toTimeString().slice(0, 5);
      } finally {
        v.isLoading = false;
      }
    }
  }

  return loadChain;
});
