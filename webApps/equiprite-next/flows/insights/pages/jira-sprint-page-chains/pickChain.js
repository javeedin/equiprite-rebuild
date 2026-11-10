define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // The "follow-up" selection on the items table: a row's checkbox toggles it (act 'row'), the header checkbox selects
  // or clears all shown items (act 'all'), act 'clear' empties it. $variables.selected is reassigned a new array each
  // time so the checkbox and row-highlight class bindings re-evaluate.
  class pickChain extends ActionChain {
    async run(context, { act, key }) {
      const v = context.$page.variables;
      const keys = (((v.report && v.report.rows) || []).map((r) => r.key));
      const cur = (v.selected || []).slice();
      if (act === 'all') {
        const allOn = keys.length > 0 && keys.every((k) => cur.indexOf(k) >= 0);
        v.selected = allOn ? [] : keys.slice();
      } else if (act === 'clear') {
        v.selected = [];
      } else if (key) {
        const i = cur.indexOf(key);
        if (i >= 0) cur.splice(i, 1); else cur.push(key);
        v.selected = cur;
      }
    }
  }

  return pickChain;
});
