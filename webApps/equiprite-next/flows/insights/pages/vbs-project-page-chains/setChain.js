define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // A field typed in: the workspaces' filter.
  class setChain extends ActionChain {
    async run(context, { field, value }) {
      if (field === 'wsQ') context.$page.variables.wsQ = String(value || '');
    }
  }
  return setChain;
});
