define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // One field changed (the upload form, its two ticks, the outline filter).
  class setChain extends ActionChain {
    async run(context, { field, value }) {
      const v = context.$page.variables;
      if (!field) return;
      v[field] = (field === 'upLatest' || field === 'upCommit') ? (value === true || value === 'true') : value;
    }
  }
  return setChain;
});
