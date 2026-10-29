define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Status-group and source chips. Clicking the active source chip again clears it.
  class setGroupChain extends ActionChain {
    async run(context, { group, source }) {
      const { $page } = context;
      $page.variables.limit = 40;
      if (group) {
        $page.variables.group = group;
      }
      if (source !== undefined && source !== null && source !== '') {
        $page.variables.source = $page.variables.source === source ? '' : source;
      }
    }
  }

  return setGroupChain;
});
