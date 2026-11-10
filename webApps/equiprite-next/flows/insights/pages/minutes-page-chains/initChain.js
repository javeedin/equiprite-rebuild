define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/minutesClient',
  'resources/js/minutes',
  'resources/js/jiraBacklog',
], (ActionChain, Actions, C, R, J) => {
  'use strict';

  // Opening the Minutes page: is it the desktop app (DuckDB on this PC)? Then read the past meetings, the settings and the
  // shared Ask AI setup, start a blank meeting, and (best effort, if Jira is connected) read the backlog so lines can be
  // tied to stories and tracking can resolve epics and customers.
  class initChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const info = await C.info();
      v.checked = true;
      v.available = !!info.available;
      if (!v.available) return;

      const st = await C.settings();
      if (st.ok && st.body) v.settings = st.body;
      const ai = await C.aiSettings();
      if (ai.ok && ai.body) { v.ai = { active: ai.body.active || '', providers: ai.body.providers || {} }; v.aiReady = !!ai.body.active; }

      const ls = await C.list();
      if (ls.ok && ls.body && ls.body.meetings) v.meetings = ls.body.meetings;

      const pc = await C.contacts('');
      if (pc.ok && pc.body) { v.people = pc.body.contacts || []; v.peopleReady = !!pc.body.available; }

      const m = R.blankMeeting();
      m.attendees = ((v.settings && v.settings.defaultAttendees) || []).slice();
      v.meeting = m;
      v.attendeesText = (m.attendees || []).join(', ');

      try {
        const res = await J.load(context, Actions, 'project = EQP AND issuetype = Story ORDER BY key ASC');
        if (res && res.ok && res.issues) { v.rows = res.issues.map((i) => J.fromIssue(i, {})); v.jiraReady = v.rows.length > 0; }
      } catch (e) { /* no Jira connection: tracking still works by key and customer */ }
    }
  }
  return initChain;
});
