define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/shellBus',
], (ActionChain, Actions, bus) => {
  'use strict';

  // stories: Jira stories (to connect, or back to the backlog); jira: the sprint in Jira (a browser tab); export: to
  // Excel (exportChain); exportMenu: the Export menu opens or closes.
  class openChain extends ActionChain {
    async run(context, { what }) {
      const v = context.$page.variables;
      if (what === 'stories') bus.open({ navId: 'jira' });
      else if (what === 'jira' && v.report && v.report.url && typeof window !== 'undefined') window.open(v.report.url, '_blank', 'noopener');
      else if (what === 'exportMenu') v.exportOpen = !v.exportOpen;
      else if (what === 'export') await Actions.callChain(context, { chain: 'exportChain', params: { format: 'xlsx' } });
    }
  }

  return openChain;
});
