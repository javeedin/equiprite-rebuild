define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/tabs',
  'resources/js/shellTabs',
  'resources/js/nav',
  'resources/js/future/fxStore',
], (ActionChain, Actions, tabs, shellTabs, nav, store) => {
  'use strict';

  // Opens a screen (navId) or a record (record + params) in its tab, or shows the tab when it is open. A screen the
  // persona played may not open is refused in words, naming who could open it. Who is played is read from the store
  // itself (not the shell's copy), so "play as Ana and open Approve & allocate" works in one click. Over twelve tabs
  // the least recently used one is closed, and the toast says so.
  class openChain extends ActionChain {
    async run(context, { navId, record, params }) {
      const { $page } = context;
      const tab = record ? tabs.forRecord(record, params || {}) : tabs.forItem(navId);
      if (!tab) return;
      if (!record) {
        const me = store.view('me');
        const item = nav.item(tab.navId);
        if (!nav.itemVisible(item, me.roles)) {
          const who = nav.whoCanOpen(tab.navId, store.personas);
          const first = String(me.name || '').split(' ')[0];
          Actions.callChain(context, { chain: 'toastChain', params: {
            message: `${item ? item.label : 'That screen'} is not open to ${first}${who ? `: play as ${who.name} (${who.title}) to open it.` : '.'}`, tone: 'warning' } });
          return;
        }
      }
      $page.variables.navOpen = false;
      $page.variables.tabMenuOpen = false;
      $page.variables.profileOpen = false;
      $page.variables.personaOpen = false;
      $page.variables.clockOpen = false;
      $page.variables.bellOpen = false;
      let next = null;
      await shellTabs.update(context, Actions, (st) => { next = tabs.open(st, tab); return next; });
      if (next && next.evicted.length) {
        Actions.callChain(context, { chain: 'toastChain', params: {
          message: `Closed ${next.evicted.length === 1 ? 'the oldest tab' : next.evicted.length + ' older tabs'}: up to ${tabs.MAX_TABS} stay open.`, tone: 'info' } });
      }
    }
  }

  return openChain;
});
