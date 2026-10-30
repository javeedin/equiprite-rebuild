define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/mobileTabs',
], (ActionChain, Actions, mobileTabs) => {
  'use strict';

  // Opening EquipRite Mobile: once page access is known, the tabs this role gets go into the switcher and the tab
  // bar, and the app opens on a deep link's tab (?tab=…, when the role has it), else on the role's first work tab. No
  // tab's page is created before access is known (fail closed). Then the tabs' counts are read.
  // Page access can take a while on a slow sign-in (roles from Fusion first): wait up to a minute.
  const TRIES = 1200;
  const GAP_MS = 50;

  class shellEnterChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const v = $application.variables;
      const pv = $page.variables;
      pv.online = typeof navigator === 'undefined' || navigator.onLine !== false;
      // VB loads a chain the first time it runs: the toast's is loaded now, so "No connection" can still be said
      // when the connection has gone.
      await Actions.callChain(context, { chain: 'toastChain', params: { message: '' } });
      for (let i = 0; i < TRIES && !(v.pageAccessLoaded && v.flagsLoaded); i++) {
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
      const tabs = mobileTabs.visible(v.pageAccessMap, v.pageAccessLoaded);
      await Actions.fireDataProviderEvent(context, { target: pv.tabs, add: { data: tabs.map(mobileTabs.item), keys: tabs.map((t) => t.id) } });
      pv.tabBar = tabs.map((t) => ({ id: t.id, label: t.label, icon: t.icon, title: t.title }));
      const link = tabs.some((t) => t.id === pv.tab) ? pv.tab : '';
      pv.currentTab = link || mobileTabs.first(v.pageAccessMap, v.pageAccessLoaded);
      pv.shellReady = true;
      // A deep link to a request: its tab takes it once loaded (mobileBus.focus).
      if (link && (pv.id || pv.number)) {
        await Actions.callChain(context, { chain: 'shellRequestChain', params: { action: 'focus', tab: link, id: pv.id, number: pv.number } });
      }
      await Actions.callChain(context, { chain: 'countsChain' });
    }
  }

  return shellEnterChain;
});
