define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/jiraBacklog',
  'resources/js/testRecorder'
], (ActionChain, Actions, J, R) => {
  'use strict';

  // Reads the stories from Jira and works out what they say. Runs on vbEnter, on Refresh (the primary action), after a
  // preset or Run (queryChain) and after Connect / Disconnect (connectionChain).
  //
  //   jiraBacklog.desktopSettings()  the desktop app's saved connection; null deployed in VBCS (no /__jira there)
  //   jiraBacklog.whoAmI()           who the connection signs in as (services/jira getJiraMyself)
  //   jiraBacklog.load()             every page of the JQL search (services/jira searchJiraIssues)
  //
  // A 401/403 is "not connected" (the connection section says how to connect); anything else that fails is said in
  // words (jiraBacklog.problem) and in a toast. Only the newest read is applied when two overlap.
  let latest = 0;

  class loadJiraChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const v = $page.variables;
      const F = $page.functions;
      if (!v.jql) {
        v.jql = J.PRESETS[0].jql;
        v.preset = J.PRESETS[0].key;
      }
      const jql = ('' + v.jql).trim();
      const mine = ++latest;
      v.loading = true;

      let settings = null;
      let who = { ok: false, status: 0 };
      let res = { ok: false, issues: [], status: 0, message: '' };
      try {
        settings = await J.desktopSettings();
        const both = await Promise.all([J.whoAmI(context, Actions), J.load(context, Actions, jql)]);
        who = both[0];
        res = both[1];
      } catch (e) {
        res = { ok: false, issues: [], status: 0, message: J.problem({ status: 0, body: { message: e && e.message } }) };
      }
      if (mine !== latest) return;

      const site = (settings && settings.site) || J.SITE;
      // Connected only when Jira names the signed-in account (jiraBacklog.whoAmI): an anonymous call gets answers too,
      // just empty ones, which must not read as "no stories".
      const refused = !who.ok && (who.status === 401 || who.status === 403 || res.status === 401 || res.status === 403);
      const state = who.ok ? 'connected' : (refused ? 'refused' : 'unreachable');
      if (!who.ok) res = { ok: false, issues: [], status: who.status, message: who.message };
      v.conn = {
        state, desktop: !!settings, site, email: (settings && settings.email) || '', name: who.ok ? who.name : '',
        hasToken: !!(settings && settings.hasToken)
      };
      if (settings && !v.emailInput && settings.email) v.emailInput = settings.email;
      if (settings && settings.site) v.siteInput = settings.site;

      const today = F.today();
      const rows = res.ok ? res.issues.map((i) => F.decorate(J.fromIssue(i, { today, site }))) : [];
      const opts = F.filterOptions(rows);
      v.rows = rows;
      v.analysis = res.ok ? J.analyse(rows, today) : F.emptyAnalysis();
      // which stories have recordings or screenshots on this PC (the icon after a summary)
      v.evidenceIndex = R && typeof R.index === 'function' ? await R.index() : {};
      v.statusOptions = opts.status;
      v.epicOptions = opts.epic;
      v.assigneeOptions = opts.assignee;
      v.releaseOptions = opts.release;
      v.sprintOptions = opts.sprint;
      v.priorityOptions = opts.priority;
      v.typeOptions = opts.type;
      v.shownRows = F.shown(rows, JSON.parse(JSON.stringify(v.search || {})), JSON.parse(JSON.stringify(v.pick || {})));
      v.capped = !!res.capped;
      v.problem = res.ok ? '' : (refused ? '' : res.message);
      v.readAt = res.ok ? F.nowTime() : '';
      v.loading = false;

      if (!res.ok && !refused) {
        await Actions.fireNotificationEvent(context, {
          summary: 'The stories were not read', message: res.message, displayMode: 'transient', type: 'error'
        });
      }
    }
  }

  return loadJiraChain;
});
