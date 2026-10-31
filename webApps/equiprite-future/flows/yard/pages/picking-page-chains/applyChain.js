define([
  'vb/action/actionChain',
  'resources/js/yardWork',
], (ActionChain, yw) => {
  'use strict';

  // What the list shows: each request with its pieces (yardWork.items), the stage tiles, the yards, then the requests
  // the tile, the yard and the search keep, in sections by the day they are needed. Worked out first, set last.
  class applyChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const items = yw.items('picking', v.records, v.linesBy, v.yards, Date.now(), { finding: v.yardsLoading });
      const shown = yw.filter(items, { stage: v.stage, yard: v.yard, text: v.text });
      const sections = yw.sections('picking', shown, v.collapsed);
      v.items = items;
      v.tiles = yw.tiles('picking', items);
      v.yardChips = yw.yardOptions(items);
      v.summary = yw.summary('picking', items);
      v.shown = shown;
      v.sections = sections;
    }
  }

  return applyChain;
});
