define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // "+" in an empty period cell: a new line for that row of the grid and that period, with the old
  // addScheduleLineChain's defaults (newLine in the page module) and the row's equipment, location, rate type,
  // method and basis. It has no id until Save creates it (POST /rate-period-lines), and the lines stay sorted
  // Class -> Subclass -> Equipment as the old chain kept them.
  let seq = 0;

  class addLineChain extends ActionChain {
    async run(context, { groupKey, period }) {
      const { $page } = context;
      const v = $page.variables;
      const f = $page.functions;
      const lines = v.lines || [];
      const inGroup = lines.filter((l) => f.groupKey(l) === groupKey);
      if (!inGroup.length) return;
      const template = inGroup[0];
      if (!f.isPeriodAllowed(period, template.calcMethod, template.calcBasis)) return;
      seq += 1;
      const line = f.newLine(template, period, inGroup.length, 'new:' + Date.now() + ':' + seq);
      let next = lines.concat([line]);
      try { next = f.sortLines(next); } catch (e) { /* keep append order */ }
      v.lines = next;
      v.dirty = true;
      v.focusKey = line._key;
    }
  }

  return addLineChain;
});
