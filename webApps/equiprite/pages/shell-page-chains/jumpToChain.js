define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The header's "Jump to" box: Enter opens the first menu item whose label matches what was typed, through the
  // same navigateChain (and RBAC check) as a menu click.
  class jumpToChain extends ActionChain {
    async run(context, { text }) {
      const { $application } = context;
      const q = String(text || '').trim().toLowerCase();
      if (!q) {
        return;
      }
      const vars = $application.variables;
      const groups = $application.functions.visibleNavGroups(vars.pageAccessMap, vars.pageAccessLoaded,
        vars.featureFlags, vars.flagsLoaded, vars.buRateSources);
      const items = [].concat(...groups.map((g) => g.items));
      const hit = items.find((it) => it.label.toLowerCase().startsWith(q))
        || items.find((it) => it.label.toLowerCase().includes(q));
      if (hit) {
        await Actions.callChain(context, { chain: 'navigateChain', params: { navId: hit.id } });
      }
    }
  }

  return jumpToChain;
});
