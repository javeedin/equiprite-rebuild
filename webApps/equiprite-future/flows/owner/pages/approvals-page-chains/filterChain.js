define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // A relationship chip: show only those lines (All shows every one).
  class filterChain extends ActionChain {
    async run(context, { key }) {
      context.$page.variables.rel = key || 'all';
    }
  }

  return filterChain;
});
