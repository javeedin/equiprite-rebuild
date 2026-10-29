define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class navigateToCreateChain extends ActionChain {
    async run(context) {
      // Cross-flow navigation: project-create-request lives in customer-portal,
      // which is a SIBLING of main (not a child). target: 'parent' tells VB to
      // resolve the flow at the parent container's level, so siblings become
      // reachable. See vbs-agent-skills cookbook/batch-editable-table.
      await Actions.navigateToFlow(context, {
        target: 'parent',
        flow:   'customer-portal',
        page:   'project-create-request',
      });
    }
  }

  return navigateToCreateChain;
});
