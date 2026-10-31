define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/tabs',
  'resources/js/shellTabs',
  'resources/js/nav',
  'resources/js/alerts',
], (ActionChain, Actions, tabs, shellTabs, nav, alerts) => {
  'use strict';

  // Opening EquipRite Next: the tabs kept from last time (or My work), plus a deep link (?open=…), and the menu as it
  // was left (full or icons). No tab is opened before page access is known: the tabs this role may not open are left
  // out first (fail closed), so no page the role cannot open is ever created (and reads nothing). When nothing is
  // left, the first screen the role may open is shown. Then the bell is checked.
  // Page access can take a while on a slow sign-in (roles from Fusion first): wait up to a minute.
  const TRIES = 1200;
  const GAP_MS = 50;

  class shellEnterChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      try { $page.variables.navCollapsed = localStorage.getItem('eqr.next.nav') === 'rail'; } catch (e) { /* private mode */ }
      let saved = null;
      try { saved = localStorage.getItem(tabs.STORE_KEY); } catch (e) { saved = null; }
      let state = tabs.restore(saved);
      // VB moves ?open=… into the page's fromUrl inputs before this runs (and drops it from the address).
      const pv = $page.variables;
      const q = new URLSearchParams();
      if (pv.open) q.set('open', pv.open);
      if (pv.id) q.set('id', pv.id);
      if (pv.number) q.set('number', pv.number);
      const link = tabs.fromQuery('?' + q.toString() || window.location.search);
      if (link) state = tabs.open(state, link);
      $page.variables.readIds = alerts.loadRead();

      const v = $application.variables;
      for (let i = 0; i < TRIES && !(v.pageAccessLoaded && v.flagsLoaded); i++) {
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
      if (!v.pageAccessLoaded) return;
      const visible = (t) => nav.itemVisible(nav.item(t.navId), v.pageAccessMap, v.pageAccessLoaded, v.featureFlags, v.flagsLoaded, v.buRateSources);
      let keep = state.tabs.filter(visible);
      if (!keep.length) {
        const groups = nav.visibleGroups(v.pageAccessMap, v.pageAccessLoaded, v.featureFlags, v.flagsLoaded, v.buRateSources);
        const first = groups.length ? tabs.forItem(groups[0].items[0].id) : null;
        keep = first ? [first] : [];
      }
      const current = keep.some((t) => t.id === state.current) ? state.current : (keep[0] ? keep[0].id : '');
      // Anything opened in the meantime (a click while access loaded) stays, after the restored tabs.
      await shellTabs.update(context, Actions, (now) => ({
        tabs: keep.concat(now.tabs.filter((t) => !keep.some((k) => k.id === t.id))),
        current: now.current && now.tabs.some((t) => t.id === now.current) ? now.current : current,
      }));
      $page.variables.shellReady = true;
      await Actions.callChain(context, { chain: 'loadAlertsChain' });
    }
  }

  return shellEnterChain;
});
