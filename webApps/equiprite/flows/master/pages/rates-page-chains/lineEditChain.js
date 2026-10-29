define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // One typed value in the grid (threshold, period total, rate, bill) or the line panel (method, basis, period,
  // rate type, location, dates). The arithmetic is the old grid's handleEditEnd (applyLineEdit in the page module):
  // the total and the rate restate each other, a period the method cannot carry is refused, a refused value is
  // put back. Nothing is saved until Save; a NEW lines array each time, so the bindings and Save see the change.
  class lineEditChain extends ActionChain {
    async run(context, { key, field, value }) {
      const { $page } = context;
      const v = $page.variables;
      const f = $page.functions;
      const lines = v.lines || [];
      const i = lines.findIndex((l) => f.lineKey(l) === key);
      if (i < 0) return;
      const r = f.applyLineEdit(lines[i], field, value);
      if (!r.ok) {
        v.lineError = field === 'period'
          ? 'That period does not fit this line\'s method: ' + f.methodText(lines[i]) + '.'
          : 'Enter a number of zero or more.';
        v.lines = lines.slice();
        return;
      }
      v.lineError = '';
      const next = lines.slice();
      next[i] = r.line;
      v.lines = next;
      v.dirty = true;
    }
  }

  return lineEditChain;
});
