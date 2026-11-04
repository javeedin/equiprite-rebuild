define([
  'vb/action/actionChain',
  'resources/js/yardWork',
  'resources/js/rules',
], (ActionChain, yw, rules) => {
  'use strict';

  // What the list shows: each request with its pieces on the way back (yardWork.items), the stage tiles, the yards, then
  // the requests the tile, the yard and the search keep, in sections by the yard's job (overdue first).
  // The Redwood view (your menu, Look) shows the same requests as oj-table rows, narrowed further by the column filters
  // only it shows (rwCols), with every filter's options and their counts.
  class applyChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const now = Date.now();
      const items = yw.items('returns', v.records, v.linesBy, v.yards, now, { finding: v.yardsLoading });
      const shown = yw.filter(items, { stage: v.stage, yard: v.yard, text: v.text });
      const sections = yw.sections('returns', shown, v.collapsed);
      const tiles = yw.tiles('returns', items);
      const yardChips = yw.yardOptions(items);
      v.items = items;
      v.tiles = tiles;
      v.yardChips = yardChips;
      v.summary = yw.summary('returns', items);
      v.shown = shown;
      v.sections = sections;

      // The Redwood view. A row's Receive follows page access, as the panel's does (full access to Equipment returns).
      const app = context.$application.variables;
      const can = { act: rules.pageAccess(app.pageAccessMap, app.pageAccessLoaded, 'EQR_EQUIPMENT_RETURNS') === 'FULL' };
      const rwShown = yw.byColumns('returns', yw.redwoodOrder('returns', shown), v.rwCols, now);
      v.rwShown = rwShown;
      v.rwRows = yw.redwoodRows('returns', rwShown, v.linesBy, can);
      const opts = yw.columnOptions('returns', items, tiles, yardChips, now);
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      [['rwWhen', 'when'], ['rwNumbers', 'number'], ['rwParties', 'party'], ['rwStages', 'stage'], ['rwYards', 'yard'], ['rwNext', 'next'],
        ['rwTypes', 'type']].forEach(([name, key]) => {
        if (!same(v[name], opts[key])) v[name] = opts[key];
      });
    }
  }

  return applyChain;
});
