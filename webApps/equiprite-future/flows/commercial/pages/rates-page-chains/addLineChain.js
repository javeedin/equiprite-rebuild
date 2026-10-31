define([
  'vb/action/actionChain',
  'resources/js/rateRules',
], (ActionChain, R) => {
  'use strict';

  // "+ Add" in an empty period cell: New EquipRite's addLineChain, unchanged. A new line for that row and period with
  // the old addScheduleLineChain's defaults (rateRules.newLine) and the row's equipment, location, rate type, method
  // and basis; refused when the row's method cannot carry the period. It has no id until Save creates it (POST
  // /rate-period-lines), and the lines stay sorted Class -> Subclass -> Equipment.
  let seq = 0;

  class addLineChain extends ActionChain {
    async run(context, { groupKey, period }) {
      const v = context.$page.variables;
      const lines = v.lines || [];
      const inGroup = lines.filter((l) => R.groupKey(l) === groupKey);
      if (!inGroup.length) return;
      const template = inGroup[0];
      if (!R.isPeriodAllowed(period, template.calcMethod, template.calcBasis)) return;
      seq += 1;
      const line = R.newLine(template, period, inGroup.length, 'new:' + Date.now() + ':' + seq);
      let next = lines.concat([line]);
      try { next = R.sortLines(next); } catch (e) { /* keep append order */ }
      v.lines = next;
      v.saveNote = '';
      v.dirty = true;
    }
  }

  return addLineChain;
});
