define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Expand / collapse one billing line group (mirrors post-cost-test-detail's
  // toggleGroupChain). The clicked group row carries its key in id="grp-<groupKey>";
  // read it off event.target (walk up, since the click may land on an inner span).
  class toggleGroupChain extends ActionChain {
    async run(context, { event }) {
      const { $page } = context;

      let el = event && event.target;
      while (el && !(el.id && el.id.indexOf('grp-') === 0)) { el = el.parentElement; }
      if (!el) return;
      const groupKey = el.id.replace('grp-', '');

      const all = ($page.variables.rowsAll || []).map(function (r) {
        if (r.kind === 'group' && r.groupKey === groupKey) {
          return Object.assign({}, r, { expanded: !r.expanded });
        }
        return r;
      });

      const visible = all.filter(function (row) {
        if (row.kind === 'group') return true;
        const g = all.find(function (x) { return x.kind === 'group' && x.groupKey === row.groupKey; });
        return g && g.expanded;
      });

      $page.variables.rowsAll = all;
      $page.variables.rowsVisible = visible;
    }
  }

  return toggleGroupChain;
});
