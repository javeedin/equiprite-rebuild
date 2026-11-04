define([
  'vb/action/actionChain',
  'resources/js/yardWork',
  'resources/js/rules',
], (ActionChain, yw, rules) => {
  'use strict';

  // What the list shows: each request with its pieces (yardWork.items), the stage tiles, the yards, then the requests
  // the tile, the yard and the search keep, in sections by the day they are needed. Worked out first, set last.
  // The Redwood view (your menu, Look) shows the same requests as oj-table rows, narrowed further by the column filters
  // only it shows (rwCols), with every filter's options and their counts.
  class applyChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const now = Date.now();
      const items = yw.items('picking', v.records, v.linesBy, v.yards, now, { finding: v.yardsLoading });
      const shown = yw.filter(items, { stage: v.stage, yard: v.yard, text: v.text });
      const sections = yw.sections('picking', shown, v.collapsed);
      const tiles = yw.tiles('picking', items);
      const yardChips = yw.yardOptions(items);
      v.items = items;
      v.tiles = tiles;
      v.yardChips = yardChips;
      v.summary = yw.summary('picking', items);
      v.shown = shown;
      v.sections = sections;

      // The Redwood view. A row's steps follow page access, as the dialog's do: the yard's steps need full access to
      // Initiate picking, Confirm for picking full access to Approve & allocate.
      const app = context.$application.variables;
      const can = {
        act: rules.pageAccess(app.pageAccessMap, app.pageAccessLoaded, 'EQR_INITIATE_PICKING') === 'FULL',
        confirm: rules.pageAccess(app.pageAccessMap, app.pageAccessLoaded, 'EQR_WORKBENCH') === 'FULL',
      };
      const rwShown = yw.byColumns('picking', yw.redwoodOrder('picking', shown), v.rwCols, now);
      v.rwShown = rwShown;
      v.rwRows = yw.redwoodRows('picking', rwShown, v.linesBy, can);
      const opts = yw.columnOptions('picking', items, tiles, yardChips, now);
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      [['rwWhen', 'when'], ['rwNumbers', 'number'], ['rwParties', 'party'], ['rwStages', 'stage'], ['rwYards', 'yard'], ['rwNext', 'next'],
        ['rwTypes', 'type']].forEach(([name, key]) => {
        if (!same(v[name], opts[key])) v[name] = opts[key];
      });
    }
  }

  return applyChain;
});
