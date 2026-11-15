define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // A field typed in (Run as: the user name).
  class setChain extends ActionChain {
    async run(context, { field, value }) {
      const v = context.$page.variables;
      if (field === 'asUser') { v.asUser = String(value == null ? '' : value); v.asTouched = true; }
    }
  }
  return setChain;
});
