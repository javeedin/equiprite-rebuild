define([
  'vb/action/actionChain',
  'vb/action/actions'
], (ActionChain, Actions) => {
  'use strict';

  // A sprint's name (By sprint): its own page (setup/jira-sprint), with in-flow back to Jira Stories.
  class openSprintChain extends ActionChain {
    async run(context, { id, name }) {
      if (!id && !name) return;
      await Actions.navigateToPage(context, { page: 'jira-sprint', params: { id: String(id || ''), name: String(name || '') } });
    }
  }

  return openSprintChain;
});
