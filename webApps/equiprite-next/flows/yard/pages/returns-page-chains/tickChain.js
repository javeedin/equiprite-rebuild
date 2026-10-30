define(['vb/action/actionChain', 'resources/js/yardWork'], (ActionChain, yw) => {
  'use strict';

  // One tick box: only a line shipped back to the yard can be ticked (the box is disabled for the others too).
  class tickChain extends ActionChain {
    async run(context, { lineId, checked }) {
      const v = context.$page.variables;
      if (lineId === undefined || lineId === null || lineId === '') return;
      const line = (v.work.lines || []).filter((l) => String(l.lineId) === String(lineId))[0];
      if (!yw.isReceivable(line)) return;
      v.ticks = yw.toggleTick(v.ticks, lineId, checked === true || checked === 'true');
    }
  }

  return tickChain;
});
