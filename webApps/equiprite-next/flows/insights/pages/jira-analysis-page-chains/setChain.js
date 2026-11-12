define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // One field changed (the chat box). Mutate the live variable in place so the input keeps focus while typing.
  class setChain extends ActionChain {
    async run(context, { field, value }) {
      const v = context.$page.variables;
      if (field) v[field] = value;
    }
  }
  return setChain;
});
