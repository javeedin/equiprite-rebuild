define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/tabs',
  'resources/js/shellTabs',
  'resources/js/nav',
  'resources/js/alerts',
], (ActionChain, Actions, tabs, shellTabs, nav, alerts) => {
  'use strict';

  // Opening EquipRite Next: the tabs kept from last time (or My work), plus a deep link (?open=…); the menu as it was
  // left (full or icons). Once page access is known, tabs this role may not open are closed (fail closed), and when
  // nothing is left the first screen the role may open is shown. Then the bell is checked.
  const TRIES = 200;
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
      await shellTabs.update(context, Actions, () => state);
      $page.variables.readIds = alerts.loadRead();

      const v = $application.variables;
      for (let i = 0; i < TRIES && !(v.pageAccessLoaded && v.flagsLoaded); i++) {
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
      const visible = (t) => nav.itemVisible(nav.item(t.navId), v.pageAccessMap, v.pageAccessLoaded, v.featureFlags, v.flagsLoaded, v.buRateSources);
      await shellTabs.update(context, Actions, (now) => {
        let keep = now.tabs.filter(visible);
        if (!keep.length) {
          const groups = nav.visibleGroups(v.pageAccessMap, v.pageAccessLoaded, v.featureFlags, v.flagsLoaded, v.buRateSources);
          const first = groups.length ? tabs.forItem(groups[0].items[0].id) : null;
          keep = first ? [first] : [];
        }
        if (keep.length === now.tabs.length && keep.every((t, i) => t.id === now.tabs[i].id)) return null;
        return { tabs: keep, current: keep.some((t) => t.id === now.current) ? now.current : (keep[0] ? keep[0].id : '') };
      });
      await Actions.callChain(context, { chain: 'loadAlertsChain' });
    }
  }

  return shellEnterChain;
});
