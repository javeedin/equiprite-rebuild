define(['vb/action/actionChain', 'resources/js/yardWork'], (ActionChain, yw) => {
  'use strict';

  // One tick box. The single ticked transfer order (or none) follows the ticks, as in New.
  class tickChain extends ActionChain {
    async run(context, { lineId, checked }) {
      const v = context.$page.variables;
      if (lineId === undefined || lineId === null || lineId === '') return;
      const ticks = yw.toggleTick(v.ticks, lineId, checked === true || checked === 'true');
      v.selectedTOId = yw.selectedTOIdFor(v.work.tos, v.work.lines, ticks);
      v.ticks = ticks;
    }
  }

  return tickChain;
});
