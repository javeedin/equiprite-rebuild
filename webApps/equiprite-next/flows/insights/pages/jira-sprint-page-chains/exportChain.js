define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/jiraBacklog',
  'resources/js/shellBus',
], (ActionChain, exportKit, J, bus) => {
  'use strict';

  // Exports the sprint's items: what Jira stories exports, and where each stands in this sprint.
  const WHERE = { done: 'Done in this sprint', here: 'Still in this sprint', moved: 'Carried on' };

  class exportChain extends ActionChain {
    async run(context, { format }) {
      const v = context.$page.variables;
      v.exportOpen = false;
      const r = JSON.parse(JSON.stringify(v.report || {}));
      const s = r.sprint || {};
      const res = await exportKit.run(format || 'xlsx', {
        name: 'jira-sprint-' + (s.name || v.name || v.id), title: 'Sprint ' + (s.name || v.name || v.id),
        subtitle: [s.state, s.start && s.end ? s.start + ' – ' + s.end : '', s.goal ? 'Goal: ' + s.goal : ''].filter(Boolean).join(' · '),
        rows: r.rows || [],
        columns: [{ key: 'in', label: 'In this sprint', value: (x) => WHERE[x.in] + (x.sprintNow ? ' to ' + x.sprintNow : '') },
          { key: 'carriedIn', label: 'Came in from an earlier sprint', value: (x) => (x.carriedIn ? 'Yes' : '') }].concat(J.exportColumns()),
      });
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
