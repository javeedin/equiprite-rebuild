define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/shellBus',
], (ActionChain, exportKit, bus) => {
  'use strict';

  // Copy to follow-up: the items shown (the current filter) as a formatted HTML table on the clipboard, to paste into
  // an email body. The Key links to Jira; an overdue date is red. A short, email-friendly set of columns.
  class followupChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const rows = JSON.parse(JSON.stringify(v.shown || []));
      if (!rows.length) { bus.toast('There are no items to copy.', 'error'); return; }
      const res = await exportKit.run('followup', {
        title: 'Follow-up — Jira stories',
        subtitle: [v.jql, v.fLabel].filter(Boolean).join(' · '),
        when: new Date().toLocaleString(),
        rows: rows,
        columns: [
          { key: 'key', label: 'Key', href: (r) => r.url },
          { key: 'summary', label: 'Summary' },
          { key: 'status', label: 'Status' },
          { key: 'assignee', label: 'Assignee', value: (r) => r.assignee || 'Nobody' },
          { key: 'labels', label: 'Customer', value: (r) => (r.labels || []).join(', ') },
          { key: 'due', label: 'Due', value: (r) => r.due || '—', tone: (r) => (r.overdue ? 'bad' : '') },
        ],
      });
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return followupChain;
});
