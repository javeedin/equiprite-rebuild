define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // A field typed in: the project search, the folder.
  class setChain extends ActionChain {
    async run(context, { field, value }) {
      const v = context.$page.variables;
      if (field === 'pQ' || field === 'folder') v[field] = String(value || '');
      if (field === 'folder') v.plan = null;
    }
  }
  return setChain;
});
