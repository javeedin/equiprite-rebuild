define([
  'vb/action/actionChain',
  'resources/js/usageRedwood',
], (ActionChain, rw) => {
  'use strict';

  // The Redwood look (your menu, Look): the request's equipment and consumables, the rows the current look lists
  // (lineRows), as Oracle's table with where each is as Oracle's badge. Runs whenever the lines or what was used change
  // (the variables' onValueChanged; a request picked sets both, one after the other, so the burst is taken in once it
  // settles, usageRedwood.latest). Sets only the Redwood look's own variable, and only when it changed.
  class rwApplyChain extends ActionChain {
    async run(context) {
      if (!(await rw.latest('direct-costs'))) return;
      const { $page } = context;
      const v = $page.variables;
      const fns = $page.functions;
      const rows = fns.lineRows(v.lines, v.consumptions).map((l) => ({
        key: String(l.lineId),
        name: l.equipmentName || '—',
        kind: l.kind,
        requested: fns.qty(l.requested),
        delivered: fns.qty(l.delivered),
        used: l.consumable || l.used ? String(l.used) : '—',
        left: fns.qty(l.left),
        none: !!(l.consumable && l.left === 0),
        word: l.word,
        badge: rw.badge(l.tone),
      }));
      if (!rw.same(v.rwLines, rows)) v.rwLines = rows;
    }
  }

  return rwApplyChain;
});
