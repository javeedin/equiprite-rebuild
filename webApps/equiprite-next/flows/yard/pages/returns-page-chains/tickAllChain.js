define(['vb/action/actionChain', 'resources/js/yardWork'], (ActionChain, yw) => {
  'use strict';

  // The header box: every line shipped back to the yard, or none.
  class tickAllChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      v.ticks = yw.toggleAll(v.work.lines, v.ticks, yw.isReceivable);
    }
  }

  return tickAllChain;
});
