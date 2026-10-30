define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/tabs',
  'resources/js/shellTabs',
  'resources/js/nav',
], (ActionChain, Actions, tabs, shellTabs, nav) => {
  'use strict';

  // Opens a screen (navId) or a record (record + params) in its tab, or shows the tab when it is open. A screen this
  // role may not open is refused in words. Over twelve tabs the least recently used one is closed, and the toast says so.
  class openChain extends ActionChain {
    async run(context, { navId, record, params }) {
      const { $page, $application } = context;
      const v = $application.variables;
      const tab = record ? tabs.forRecord(record, params || {}) : tabs.forItem(navId);
      if (!tab) return;
      const item = nav.item(tab.navId);
      if (v.pageAccessLoaded && !nav.itemVisible(item, v.pageAccessMap, v.pageAccessLoaded, v.featureFlags, v.flagsLoaded, v.buRateSources)) {
        await Actions.callChain(context, { chain: 'toastChain', params: { message: (item ? item.label : 'That screen') + ' is not open to your role.', tone: 'warning' } });
        return;
      }
      $page.variables.navOpen = false;
      $page.variables.showResults = false;
      $page.variables.tabMenuOpen = false;
      let next = null;
      await shellTabs.update(context, Actions, (st) => { next = tabs.open(st, tab); return next; });
      if (next && next.evicted.length) {
        await Actions.callChain(context, { chain: 'toastChain', params: {
          message: `Closed ${next.evicted.length === 1 ? 'the oldest tab' : next.evicted.length + ' older tabs'}: up to ${tabs.MAX_TABS} stay open.`, tone: 'info' } });
      }
    }
  }

  return openChain;
});
