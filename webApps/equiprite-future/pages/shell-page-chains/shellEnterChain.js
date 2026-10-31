define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/tabs',
  'resources/js/shellTabs',
  'resources/js/future/fxStore',
  'resources/js/future/fxShell',
], (ActionChain, Actions, tabs, shellTabs, store, fxShell) => {
  'use strict';

  // Opening EquipRite Future: the persona, menu and bell from the store, then the tabs kept from last time (or My
  // work) that this persona may open, plus a deep link (?open=…), and the menu as it was left (full or icons). A deep
  // link to a screen this persona may not open is refused in words (openChain says who could open it).
  class shellEnterChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      try { $page.variables.navCollapsed = localStorage.getItem('eqr.future.nav') === 'rail'; } catch (e) { /* private mode */ }
      await Actions.callChain(context, { chain: 'refreshChain' });
      let saved = null;
      try { saved = localStorage.getItem(tabs.STORE_KEY); } catch (e) { saved = null; }
      let state = tabs.restore(saved);
      // VB moves ?open=… into the page's fromUrl inputs before this runs (and drops it from the address).
      const pv = $page.variables;
      const q = new URLSearchParams();
      if (pv.open) q.set('open', pv.open);
      if (pv.id) q.set('id', pv.id);
      if (pv.number) q.set('number', pv.number);
      const link = tabs.fromQuery('?' + q.toString());
      if (link) state = tabs.open(state, link);
      const me = store.view('me');
      const kept = fxShell.prune(state.tabs, me.roles).keep;
      const current = kept.some((t) => t.id === state.current) ? state.current : (kept[0] ? kept[0].id : '');
      // Anything opened in the meantime (a click while this ran) stays, after the restored tabs.
      await shellTabs.update(context, Actions, (now) => ({
        tabs: kept.concat(now.tabs.filter((t) => !kept.some((k) => k.id === t.id))),
        current: now.current && now.tabs.some((t) => t.id === now.current) ? now.current : current,
      }));
      $page.variables.shellReady = true;
      if (link && !kept.some((t) => t.id === link.id)) {
        await Actions.callChain(context, { chain: 'openChain', params: { navId: link.navId } });
      }
    }
  }

  return shellEnterChain;
});
