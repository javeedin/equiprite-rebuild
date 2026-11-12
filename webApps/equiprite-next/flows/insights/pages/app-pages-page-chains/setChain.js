define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // A filter, a tick or a tab.
  class setChain extends ActionChain {
    async run(context, { field, value }) {
      const v = context.$page.variables;
      if (!field) return;
      if (field === 'onlyMapped' || field === 'onlySheet' || field === 'commit' || field === 'showDeleted') v[field] = value === true || value === 'true';
      else v[field] = value == null ? '' : String(value);
    }
  }
  return setChain;
});
