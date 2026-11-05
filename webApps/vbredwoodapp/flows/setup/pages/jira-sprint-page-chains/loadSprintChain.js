define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/jiraBacklog',
  'resources/js/testRecorder'
], (ActionChain, Actions, J, R) => {
  'use strict';

  // Reads every item ever in the sprint (jiraBacklog.sprintJql: "sprint = id", which also finds what moved on to a later
  // sprint) and works out its report (sprintReport). A 401 means Jira is not connected: Jira Stories is where to connect.
  class loadSprintChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      if (!v.id && !v.name) { v.loading = false; v.problem = 'No sprint was given.'; return; }
      v.loading = true;
      v.problem = '';
      v.notConnected = false;
      try {
        const today = new Date().toISOString().slice(0, 10);
        const res = await J.load(context, Actions, J.sprintJql({ id: v.id, name: v.name }));
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) v.notConnected = true;
          else v.problem = res.message;
          return;
        }
        // which items have recordings or screenshots on this PC (the icon after a summary)
        v.evidenceIndex = R && typeof R.index === 'function' ? await R.index() : {};
        v.report = J.sprintReport(res.issues.map((i) => J.fromIssue(i, { today })), { id: v.id, name: v.name }, today);
        v.readAt = new Date().toTimeString().slice(0, 5);
      } finally {
        v.loading = false;
      }
    }
  }

  return loadSprintChain;
});
