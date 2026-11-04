define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The Redwood look's table (your menu, Look): a click on a line ticks it, or unticks it, as its tick box does on the
  // current look (filterChain pick). A line that cannot be approved (not waiting, or a role that may only look) has no
  // tick and is left alone. The table's row action gives the line's key only.
  class rwPickChain extends ActionChain {
    async run(context, { key }) {
      const { $page } = context;
      const v = $page.variables;
      const fns = $page.functions;
      const row = (v.rowsAll || []).find((r) => r.key === key);
      if (!row || !fns.canAct(row, v.readOnly) || v.isWorking) return;
      await Actions.callChain(context, { chain: 'filterChain', params: { action: 'pick', key, value: !fns.isPicked(v.picked, key) } });
    }
  }

  return rwPickChain;
});
