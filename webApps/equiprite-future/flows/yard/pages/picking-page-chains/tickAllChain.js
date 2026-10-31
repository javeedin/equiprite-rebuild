define(['vb/action/actionChain', 'resources/js/yardWork'], (ActionChain, yw) => {
  'use strict';

  // The header box: every piece, or none when every piece is ticked.
  class tickAllChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const ticks = yw.toggleAll(v.work.lines, v.ticks);
      v.selectedTOId = yw.selectedTOIdFor(v.work.tos, v.work.lines, ticks);
      v.ticks = ticks;
    }
  }

  return tickAllChain;
});
