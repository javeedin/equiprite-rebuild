define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/shellBus',
], (ActionChain, exportKit, bus) => {
  'use strict';

  // Copy to follow-up: the ticked items (or all, when none is ticked) as a formatted HTML table on the clipboard, to
  // paste into an email body. The Key links to Jira; an overdue date is red. Columns are built here (not in the shared
  // jiraBacklog.js) so the email stays short — the few things a follow-up needs.
  const WHERE = { done: 'Done in this sprint', here: 'Still in this sprint', moved: 'Carried on' };

  class followupChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const rows = (v.report && v.report.rows) || [];
      const sel = v.selected || [];
      const picked = sel.length ? rows.filter((r) => sel.indexOf(r.key) >= 0) : rows;
      if (!picked.length) { bus.toast('There are no items to copy.', 'error'); return; }
      const s = (v.report && v.report.sprint) || {};
      const res = await exportKit.run('followup', {
        title: 'Follow-up — Sprint ' + (s.name || v.name || v.id),
        subtitle: [s.state, s.start && s.end ? s.start + ' – ' + s.end : '', s.goal ? 'Goal: ' + s.goal : ''].filter(Boolean).join(' · '),
        when: new Date().toLocaleString(),
        rows: picked,
        columns: [
          { key: 'key', label: 'Key', href: (r) => r.url },
          { key: 'summary', label: 'Summary' },
          { key: 'status', label: 'Status' },
          { key: 'in', label: 'In this sprint', value: (r) => WHERE[r.in] + (r.sprintNow ? ' to ' + r.sprintNow : '') },
          { key: 'assignee', label: 'Assignee', value: (r) => r.assignee || 'Nobody' },
          { key: 'due', label: 'Due', value: (r) => r.due || '—', tone: (r) => (r.overdue ? 'bad' : '') },
        ],
      });
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return followupChain;
});
