define([
  'vb/action/actionChain',
  'resources/js/shellBus',
], (ActionChain, bus) => {
  'use strict';

  // A sprint's name (By sprint): its report in a tab of its own (insights/jira-sprint), keyed by the sprint's Jira id.
  class openSprintChain extends ActionChain {
    async run(context, { id, name }) {
      if (!id && !name) return;
      bus.open({ record: 'jira-sprint', params: { id: String(id || ''), name: String(name || '') } });
    }
  }

  return openSprintChain;
});
