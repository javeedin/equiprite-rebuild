define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/shellBus',
], (ActionChain, Actions, bus) => {
  'use strict';

  // A match chosen (a click, or Enter): a screen or a record opens in its tab (a request, everything about a piece of
  // equipment or a unit, a transfer); a class or a yard opens Availability on it. "N more" narrows the list to its
  // group's scope (or shows more of the group), and the box keeps the focus.
  class resultChain extends ActionChain {
    async run(context, { index }) {
      const pv = context.$page.variables;
      const n = Number(index);
      const r = (pv.results || []).filter((x) => x.n === n && (x.type === 'row' || x.type === 'more'))[0];
      const box = document.getElementById('nxCommand');
      if (r && r.type === 'more') {
        pv.search = Object.assign({}, pv.search, r.scope ? { scope: r.scope, expanded: '' } : { expanded: r.expand });
        await Actions.callChain(context, { chain: 'searchChain', params: {} });
        // More of the same group: the first row it adds is where "N more" was.
        if (!r.scope) pv.resultIndex = Math.min(n, Math.max(0, ((pv.search || {}).count || 1) - 1));
        if (box) box.focus();
        return;
      }
      pv.showResults = false;
      pv.query = '';
      if (box) { box.value = ''; box.blur(); }
      if (!r || !r.open) return;
      const o = r.open;
      if (o.focus) {
        bus.focus(o.focus, o.what || {});
        return;
      }
      await Actions.callChain(context, { chain: 'openChain', params: o.record ? { record: o.record, params: o.params || {} } : { navId: o.navId } });
    }
  }

  return resultChain;
});
