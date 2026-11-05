define([
  'vb/action/actionChain',
  'vb/action/actions'
], (ActionChain, Actions) => {
  'use strict';

  // back: Jira Stories (the header's in-flow back); jira: the sprint in Jira, in a browser tab; csv: the sprint's items
  // to a CSV file (what Jira Stories exports, and where each stands in this sprint).
  const WHERE = { done: 'Done in this sprint', here: 'Still in this sprint', moved: 'Carried on' };
  const COLS = [['key', 'Key'], ['summary', 'Summary'], ['status', 'Status'], ['in', 'In this sprint'], ['assignee', 'Assignee'], ['epicKey', 'Epic'],
    ['due', 'Due'], ['resolved', 'Resolved'], ['carriedIn', 'Came in from an earlier sprint'], ['url', 'Link']];
  const cell = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';

  class sprintActionChain extends ActionChain {
    async run(context, { what }) {
      const v = context.$page.variables;
      if (what === 'back') {
        await Actions.navigateToPage(context, { page: 'jira-stories' });
        return;
      }
      if (what === 'jira') {
        if (v.report && v.report.url && typeof window !== 'undefined') window.open(v.report.url, '_blank', 'noopener');
        return;
      }
      if (what === 'csv' && typeof document !== 'undefined') {
        const r = JSON.parse(JSON.stringify(v.report || {}));
        const lines = [COLS.map((c) => cell(c[1])).join(',')].concat((r.rows || []).map((x) => COLS.map((c) => {
          if (c[0] === 'in') return cell(WHERE[x.in] + (x.sprintNow ? ' to ' + x.sprintNow : ''));
          if (c[0] === 'carriedIn') return cell(x.carriedIn ? 'Yes' : '');
          return cell(x[c[0]]);
        }).join(',')));
        const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'jira-sprint-' + String((r.sprint && r.sprint.name) || v.name || v.id).replace(/[^A-Za-z0-9-]+/g, '-') + '.csv';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
      }
    }
  }

  return sprintActionChain;
});
