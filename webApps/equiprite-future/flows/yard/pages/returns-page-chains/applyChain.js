define([
  'vb/action/actionChain',
  'resources/js/yardWork',
], (ActionChain, yw) => {
  'use strict';

  // What the list shows: each request with its pieces on the way back (yardWork.items), the stage tiles, the yards, then
  // the requests the tile, the yard and the search keep, in sections by the yard's job (overdue first).
  class applyChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const items = yw.items('returns', v.records, v.linesBy, v.yards, Date.now(), { finding: v.yardsLoading });
      const shown = yw.filter(items, { stage: v.stage, yard: v.yard, text: v.text });
      const sections = yw.sections('returns', shown, v.collapsed);
      v.items = items;
      v.tiles = yw.tiles('returns', items);
      v.yardChips = yw.yardOptions(items);
      v.summary = yw.summary('returns', items);
      v.shown = shown;
      v.sections = sections;
    }
  }

  return applyChain;
});
