define(['resources/js/nav'], function (nav) {
  'use strict';

  // The tabs of EquipRite Future (as Next's): every screen and every record opens in a tab of its own, and each tab
  // keeps its page alive while another is shown (oj-vb-switcher), so filters, scroll and half-typed forms survive
  // switching. Its own keys (eqr.future.*): under VBCS Next and Future share one origin, and so one localStorage.
  //
  // Pure: the shell keeps { tabs, current } and applies what these return. A tab:
  //   { id, flow, page, params, title, icon, navId, pinned, used }
  //   id      the menu item id ('requests'), or kind:key for a record ('request:R1001'): a screen opens once
  //   pinned  My work, which cannot be closed
  //   used    when it was last shown, to choose which tab to close when there are too many
  var MAX_TABS = 12;
  var STORE_KEY = 'eqr.future.tabs';
  var HOME = nav.HOME || 'work';

  function now(t) { return t != null ? t : Date.now(); }

  /** A tab for a menu item, or null for an unknown one. */
  function forItem(navId) {
    var it = nav.item(navId);
    if (!it) return null;
    var r = nav.routeOf(it);
    return { id: it.id, flow: r.flow, page: r.page, params: r.params, title: it.tab || it.label, icon: it.icon, navId: it.id, pinned: it.id === HOME };
  }

  /** A tab for a record ('request', { id: 'R1001', number: 'FR-1001' }), or null for an unknown kind or no key. */
  function forRecord(kind, params) {
    var rec = nav.RECORDS[kind];
    var p = params || {};
    var key = rec && rec.key ? rec.key(p) : (p.id != null && p.id !== '' ? p.id : p.number);
    if (!rec || key == null || key === '') return null;
    return { id: kind + ':' + key, flow: rec.flow, page: rec.page, params: p, title: String(rec.title(p)), icon: rec.icon, navId: rec.navId, pinned: false };
  }

  /**
   * Opens a tab, or shows it when it is already open. A new tab goes right after the current one, as in a browser.
   * Over MAX_TABS the least recently shown tab that is not pinned (and not the new one) is closed.
   * Returns { tabs, current, added, evicted: [ids] }.
   */
  function open(state, tab, t) {
    var s = state || { tabs: [], current: '' };
    var list = (s.tabs || []).slice();
    var at = indexOf(list, tab.id);
    if (at !== -1) {
      list[at] = Object.assign({}, list[at], { used: now(t) });
      return { tabs: list, current: tab.id, added: false, evicted: [] };
    }
    var cur = indexOf(list, s.current);
    var fresh = Object.assign({}, tab, { used: now(t) });
    list.splice(cur === -1 ? list.length : cur + 1, 0, fresh);
    var evicted = [];
    while (list.length > MAX_TABS) {
      var victim = null;
      list.forEach(function (x) {
        if (x.pinned || x.id === tab.id) return;
        if (!victim || (x.used || 0) < (victim.used || 0)) victim = x;
      });
      if (!victim) break;
      evicted.push(victim.id);
      list.splice(indexOf(list, victim.id), 1);
    }
    return { tabs: list, current: tab.id, added: true, evicted: evicted };
  }

  /** Shows a tab (marks it used). */
  function show(state, id, t) {
    var list = (state.tabs || []).map(function (x) { return x.id === id ? Object.assign({}, x, { used: now(t) }) : x; });
    return { tabs: list, current: indexOf(list, id) !== -1 ? id : state.current };
  }

  /**
   * Closes a tab (a pinned one stays). When it was the current tab the one to its right is shown, else its left.
   * Returns { tabs, current, closed: bool }.
   */
  function close(state, id) {
    var list = (state.tabs || []).slice();
    var at = indexOf(list, id);
    if (at === -1 || list[at].pinned) return { tabs: list, current: state.current, closed: false };
    list.splice(at, 1);
    var current = state.current;
    if (current === id) {
      var next = list[at] || list[at - 1] || list[0];
      current = next ? next.id : '';
    }
    return { tabs: list, current: current, closed: true };
  }

  /** Closes every tab but the pinned ones and `keep`. */
  function closeOthers(state, keep) {
    var list = (state.tabs || []).filter(function (x) { return x.pinned || x.id === keep; });
    return { tabs: list, current: indexOf(list, keep) !== -1 ? keep : (list[0] ? list[0].id : '') };
  }

  /** Renames a tab (a record's title once it has loaded). */
  function rename(state, id, title) {
    return {
      tabs: (state.tabs || []).map(function (x) { return x.id === id && title ? Object.assign({}, x, { title: String(title) }) : x; }),
      current: state.current
    };
  }

  /** What the switcher needs for a tab: id, a router name, the flow, page and params. */
  function switcherItem(tab) {
    return { id: tab.id, name: 'tab_' + String(tab.id).replace(/[^A-Za-z0-9]/g, '_'), flow: tab.flow, page: tab.page, params: tab.params || {},
      title: tab.title, icon: tab.icon, navId: tab.navId, pinned: !!tab.pinned };
  }

  /** The tabs to keep for the next start (no more than MAX_TABS, nothing but plain data; not a transient record's). */
  function serialize(state) {
    var kept = (state.tabs || []).filter(function (x) {
      var rec = nav.RECORDS[String(x.id).split(':')[0]];
      return !(String(x.id).indexOf(':') !== -1 && rec && rec.transient);
    });
    return JSON.stringify({
      current: kept.some(function (x) { return x.id === state.current; }) ? state.current : (kept[0] ? kept[0].id : ''),
      tabs: kept.slice(0, MAX_TABS).map(function (x) {
        return { id: x.id, flow: x.flow, page: x.page, params: x.params || {}, title: x.title, icon: x.icon, navId: x.navId, pinned: !!x.pinned };
      })
    });
  }

  /**
   * Tabs kept from last time, checked: menu tabs are rebuilt from the menu (a screen built since then opens for real),
   * records kept as they were; unknown or malformed entries are dropped. My work is always there, first.
   */
  function restore(text) {
    var data = null;
    try { data = JSON.parse(text || 'null'); } catch (e) { data = null; }
    var tabs = [];
    ((data && Array.isArray(data.tabs)) ? data.tabs : []).forEach(function (x) {
      if (!x || !x.id || indexOf(tabs, x.id) !== -1) return;
      var kind = String(x.id).split(':')[0];
      var tab = String(x.id).indexOf(':') === -1 ? forItem(x.id) : (nav.RECORDS[kind] ? forRecord(kind, x.params) : null);
      if (tab) tabs.push(Object.assign(tab, x.title && String(x.id).indexOf(':') !== -1 ? { title: x.title } : {}));
    });
    if (indexOf(tabs, HOME) === -1) tabs.unshift(forItem(HOME));
    else tabs.unshift(tabs.splice(indexOf(tabs, HOME), 1)[0]);
    var current = data && indexOf(tabs, data.current) !== -1 ? data.current : HOME;
    return { tabs: tabs.slice(0, MAX_TABS), current: current };
  }

  /** A deep link: ?open=requests, or ?open=request&id=R1001&number=FR-1001. Null when there is none. */
  function fromQuery(search) {
    var q = new URLSearchParams(String(search || ''));
    var what = q.get('open');
    if (!what) return null;
    if (nav.RECORDS[what]) {
      var p = {};
      q.forEach(function (v, k) { if (k !== 'open') p[k] = v; });
      return forRecord(what, p);
    }
    return forItem(what);
  }

  /** Which tabs to add and remove to go from one list to another (for the switcher's data provider). */
  function diff(before, after) {
    var b = {};
    var a = {};
    (before || []).forEach(function (x) { b[x.id] = x; });
    (after || []).forEach(function (x) { a[x.id] = x; });
    return {
      add: (after || []).filter(function (x) { return !b[x.id]; }),
      remove: (before || []).filter(function (x) { return !a[x.id]; }).map(function (x) { return x.id; }),
      update: (after || []).filter(function (x) { return b[x.id] && b[x.id].title !== x.title; })
    };
  }

  function indexOf(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return i;
    return -1;
  }

  return {
    MAX_TABS: MAX_TABS,
    STORE_KEY: STORE_KEY,
    HOME: HOME,
    forItem: forItem,
    forRecord: forRecord,
    open: open,
    show: show,
    close: close,
    closeOthers: closeOthers,
    rename: rename,
    switcherItem: switcherItem,
    serialize: serialize,
    restore: restore,
    fromQuery: fromQuery,
    diff: diff
  };
});
