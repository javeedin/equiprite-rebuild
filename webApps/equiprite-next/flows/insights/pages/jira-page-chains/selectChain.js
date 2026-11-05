define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // The item open in the drawer ('' closes it).
  class selectChain extends ActionChain {
    async run(context, { key }) {
      const v = context.$page.variables;
      const k = String(key || '');
      if (v.selKey !== k) v.selKey = k;
    }
  }

  return selectChain;
});
