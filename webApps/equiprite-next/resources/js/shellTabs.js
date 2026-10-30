define(['resources/js/tabs'], function (tabs) {
  'use strict';

  // Applies a tab state ({ tabs, current } from tabs.js) to the shell: the tab strip (tabList, in order, with
  // titles) and the switcher's data provider (tabs, one item per live page). Order matters to the switcher:
  // a new item is added before it is shown, and the tab to show next is shown before a closed one is removed,
  // so it never displays an item that is gone. The state is kept for the next start (localStorage).
  function apply(context, Actions, next) {
    var $page = context.$page;
    var before = ($page.variables.tabs && $page.variables.tabs.data) || [];
    var d = tabs.diff(before, next.tabs);
    var chain = Promise.resolve();
    if (d.add.length) {
      chain = chain.then(function () {
        return Actions.fireDataProviderEvent(context, { target: $page.variables.tabs,
          add: { data: d.add.map(tabs.switcherItem), keys: d.add.map(function (t) { return t.id; }) } });
      });
    }
    return chain.then(function () {
      $page.variables.tabList = next.tabs.map(function (t) {
        return { id: t.id, title: t.title, icon: t.icon, navId: t.navId, pinned: !!t.pinned, flow: t.flow, page: t.page, params: t.params || {}, used: t.used || 0 };
      });
      if (next.current) $page.variables.currentTab = next.current;
      if (d.remove.length) {
        return Actions.fireDataProviderEvent(context, { target: $page.variables.tabs, remove: { keys: d.remove } });
      }
      return null;
    }).then(function () {
      try { localStorage.setItem(tabs.STORE_KEY, tabs.serialize(next)); } catch (e) { /* private mode */ }
      return next;
    });
  }

  /** The shell's tab state as tabs.js reads it. */
  function state(context) {
    var v = context.$page.variables;
    return { tabs: (v.tabList || []).slice(), current: v.currentTab };
  }

  // Tab changes run one after another, each from the state the one before left: two quick clicks that both open a
  // tab must not both add it (the switcher refuses an item twice).
  var queue = Promise.resolve();

  /** Runs change(state) -> next state (or null for no change) after the changes before it, and applies it. */
  function update(context, Actions, change) {
    var step = queue.then(function () {
      var next = change(state(context));
      return next ? apply(context, Actions, next) : null;
    });
    queue = step.catch(function (e) { console.error('[shellTabs] tab change failed', e); });
    return step;
  }

  return { apply: apply, state: state, update: update };
});
