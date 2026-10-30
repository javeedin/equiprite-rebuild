define([
  'vb/action/actionChain',
  'resources/js/rateRules',
], (ActionChain, R) => {
  'use strict';

  // One typed value in the grid (from, cost per period, bill): New EquipRite's lineEditChain, unchanged. The arithmetic
  // is the old grid's handleEditEnd (rateRules.applyLineEdit): the total and the rate restate each other, a refused
  // value is put back. Nothing is saved until Save; a NEW lines array each time, so the bindings and Save see it.
  class lineEditChain extends ActionChain {
    async run(context, { key, field, value }) {
      const v = context.$page.variables;
      const lines = v.lines || [];
      const i = lines.findIndex((l) => R.lineKey(l) === key);
      if (i < 0) return;
      const r = R.applyLineEdit(lines[i], field, value);
      if (!r.ok) {
        v.lineError = field === 'period'
          ? 'That period does not fit this line\'s method: ' + R.methodText(lines[i]) + '.'
          : 'Enter a number of zero or more.';
        v.lines = lines.slice();
        return;
      }
      v.lineError = '';
      v.saveNote = '';
      const next = lines.slice();
      next[i] = r.line;
      v.lines = next;
      v.dirty = true;
    }
  }

  return lineEditChain;
});
