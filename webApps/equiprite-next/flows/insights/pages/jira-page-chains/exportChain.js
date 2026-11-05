define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/jiraBacklog',
  'resources/js/shellBus',
], (ActionChain, exportKit, J, bus) => {
  'use strict';

  // Exports the items shown, with what the page found for each (checks, tester gaps, FDD sections).
  class exportChain extends ActionChain {
    async run(context, { format }) {
      const v = context.$page.variables;
      v.exportOpen = false;
      const res = await exportKit.run(format || 'xlsx', {
        name: 'jira-stories', title: 'Jira stories', subtitle: [v.jql, v.fLabel].filter(Boolean).join(' · '),
        rows: JSON.parse(JSON.stringify(v.shown || [])), columns: J.exportColumns(),
      });
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
