define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/jiraProgress',
], (ActionChain, Actions, JP) => {
  'use strict';

  // Reading Jira for Daily progress: the stories changed in the window (with their history and comments), worked out
  // day by day, and the stuck ones. The day shown stays when it is still in the window, else the latest day with activity.
  const clock = () => { const d = new Date(); const p2 = (n) => (n < 10 ? '0' : '') + n; return p2(d.getHours()) + ':' + p2(d.getMinutes()); };
  class loadChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      v.isLoading = true;
      v.error = '';
      try {
        const r = await JP.load(context, Actions, { days: v.days });
        if (!r.ok) { v.error = r.message; v.notConnected = !!r.notConnected; return; }
        v.notConnected = false;
        v.prog = r.progress;
        v.stuck = r.stuck;
        v.stuckRead = !!r.stuckRead;
        v.more = !!r.more;
        v.readAt = clock();
        const days = r.progress.days;
        if (!days.some((d) => d.key === v.sel)) {
          const busy = days.filter((d) => d.touched > 0);
          v.sel = (busy[busy.length - 1] || days[days.length - 1]).key;
        }
      } finally {
        v.isLoading = false;
      }
    }
  }
  return loadChain;
});
