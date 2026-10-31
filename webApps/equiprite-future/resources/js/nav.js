define([], function () {
  'use strict';

  // EquipRite Future's menu (FDD v2.0: many companies, intercompany hire). Who sees what comes from the persona being
  // played (resources/js/future/fxSeed.js PERSONAS): each item lists the roles that see it, and Admin sees everything.
  // No page codes and no feature flags: Future runs on the simulated store (resources/js/future/fxStore.js) alone.
  //
  // Item:
  //   id        the tab id of the screen (also the navId of fxViews.work() items and of notification links)
  //   roles     persona roles that see it (any one is enough); 'admin' sees every item
  //   route     { flow, page } of the screen: flows/<flow>/pages/<page>-page.*  (page = id, always)
  //   view      the fxViews view the screen reads (store.view(view, ...)), for the screen's builder
  //   built     false while the screen is the skeleton page (a dot in the menu); its builder sets it true
  //   does      what the screen is for, in a line (the skeleton page and the Guide say it)
  //   tab       the tab's title when the label is too long for a tab (else the label)
  //   player    who the Guide plays on this screen: the persona named when someone else asks to open it
  var ROLES = ['requester', 'site', 'receiver-review', 'finance', 'owner-em', 'yard', 'desk', 'owner-finance', 'ic-finance'];
  var HOME = 'work';

  var GROUPS = [
    { key: 'home', label: 'Home', items: [
      { id: 'work', label: 'My work', icon: 'oj-ux-ico-inbox', roles: ROLES, route: { flow: 'work', page: 'work' }, view: 'work', built: true,
        does: 'What waits for you now, your latest requests, your notifications and the story\'s next step.' }
    ] },
    { key: 'requests', label: 'Requests', items: [
      { id: 'requests', label: 'My requests', icon: 'oj-ux-ico-documents', player: 'p-pm', roles: ['requester', 'desk', 'site', 'receiver-review', 'finance', 'ic-finance'],
        route: { flow: 'requests', page: 'requests' }, view: 'requests', built: false,
        does: 'The requests of your business units (the requesting BU), where each one is, and whether all its money is done.' },
      { id: 'new-request', label: 'New request', icon: 'oj-ux-ico-cart-add', player: 'p-pm', roles: ['requester', 'desk'],
        route: { flow: 'order', page: 'new-request' }, view: 'me', built: false,
        does: 'Raise a request for one of your BU\'s projects (or, at the rental desk, a customer): the owner and the price come from the unit chosen.' }
    ] },
    { key: 'owner', label: 'Fleet owner', items: [
      { id: 'approvals', label: 'Approve & allocate', icon: 'oj-ux-ico-clipboard-check', player: 'p-em', roles: ['owner-em'],
        route: { flow: 'owner', page: 'approvals' }, view: 'approvals', built: false,
        does: 'The sourcing BU decides: approve or refuse each line that uses your fleet, and choose the unit.' },
      { id: 'yard', label: 'Yard', icon: 'oj-ux-ico-fullfilment-box', player: 'p-yard', roles: ['yard', 'owner-em'],
        route: { flow: 'owner', page: 'yard' }, view: 'yard', built: false,
        does: 'Ship what is approved, collect what is off hire, inspect what comes back; your fleet and where each unit is.' }
    ] },
    { key: 'site', label: 'On site', items: [
      // receiver-review too: whoever approves the hours (fxEngine approveHours) works them here, and My work sends them here.
      { id: 'site', label: 'Receive, hours, moves', icon: 'oj-ux-ico-location-pin', player: 'p-site', roles: ['site', 'requester', 'desk', 'receiver-review'],
        route: { flow: 'site', page: 'site' }, view: 'site', built: false,
        does: 'Receive what arrives (on hire), log and approve the hours, report a breakdown, move a unit, off hire.' }
    ] },
    { key: 'money', label: 'Money', items: [
      { id: 'charges', label: 'Charges & statements', icon: 'oj-ux-ico-currency-dollar', player: 'p-fin', roles: ['receiver-review', 'finance', 'owner-finance', 'ic-finance'],
        route: { flow: 'money', page: 'charges' }, view: 'charges', built: false,
        does: 'Run the month\'s charges, release the statement (owner), agree or dispute it (user).' },
      { id: 'ic-workbench', label: 'Intercompany workbench', icon: 'oj-ux-ico-invoice', player: 'p-fin', roles: ['ic-finance', 'finance'],
        route: { flow: 'money', page: 'ic-workbench' }, view: 'workbench', built: false,
        does: 'Create the intercompany AR and AP invoice pair, accrue what is late, settle by netting, post cross-charges.' },
      { id: 'billing', label: 'Customer billing', icon: 'oj-ux-ico-wallet-box', player: 'p-pcfin', roles: ['desk', 'owner-finance', 'ic-finance', 'finance', 'receiver-review'],
        route: { flow: 'money', page: 'billing' }, view: 'billing', built: false,
        does: 'Bill the outside customers: FleetCo\'s rentals (scenario 3) and ProjectCo\'s customer projects (scenario 2), deposits.' }
    ] },
    { key: 'finance', label: 'Finance', items: [
      { id: 'accounting', label: 'Accounting (shown)', icon: 'oj-ux-ico-tables-basic', player: 'p-fin', roles: ['finance', 'owner-finance', 'ic-finance'],
        route: { flow: 'finance', page: 'accounting' }, view: 'ledger', built: true,
        does: 'The accounting each company\'s Fusion makes for EquipRite\'s transactions, shown and never posted, and the group view.' },
      { id: 'reports', label: 'Reports', icon: 'oj-ux-ico-chart-bar', player: 'p-fin', roles: ['requester', 'receiver-review', 'owner-em', 'yard', 'desk', 'finance', 'owner-finance', 'ic-finance'],
        route: { flow: 'finance', page: 'reports' }, view: 'reports', built: true,
        does: 'Utilisation by owner and country, intercompany by pair, margins, customs permits, certificates, accruals, disputes.' }
    ] },
    { key: 'setup', label: 'Setup', items: [
      { id: 'setup', label: 'Companies & agreements', icon: 'oj-ux-ico-building', player: 'p-fin', roles: ROLES,
        route: { flow: 'setup', page: 'setup' }, view: 'setup', built: true,
        does: 'The companies, BUs, countries and orgs, who may source from whom, the intercompany agreements and the decisions (OD-…).' }
    ] },
    { key: 'help', label: 'Help', items: [
      { id: 'guide', label: 'Guide: the end-to-end story', tab: 'Guide', icon: 'oj-ux-ico-guided-process', roles: ROLES,
        route: { flow: 'guide', page: 'guide' }, view: 'guide', built: true,
        does: 'The thirteen steps from a request to the money settled, who plays each, the five scenarios and the FDD v2.0 rules.' }
    ] }
  ];

  var ITEMS = {};
  GROUPS.forEach(function (g) { g.items.forEach(function (it) { it.group = g.key; it.groupLabel = g.label; ITEMS[it.id] = it; }); });

  // Records that open in a tab of their own: the tab id is kind + ':' + key, so a record opens once. A record is not a
  // menu item: anyone may open one, and its page says when the persona played may not see it (fxViews.request: hidden).
  var RECORDS = {
    request: { flow: 'requests', page: 'request', icon: 'oj-ux-ico-file-text', navId: 'requests', view: 'request',
      key: function (p) { return p ? (p.id || p.number || '') : ''; },
      title: function (p) { return (p && (p.number || p.id)) || 'Request'; } }
  };

  function isAdmin(roles) { return (roles || []).indexOf('admin') !== -1; }

  /** Whether a persona with these roles sees a menu item (and may open its screen). Unknown items: no. */
  function itemVisible(it, roles) {
    if (!it) return false;
    if (isAdmin(roles)) return true;
    return (it.roles || []).some(function (r) { return (roles || []).indexOf(r) !== -1; });
  }

  /** Menu badges: fxViews.work(state).items summed per navId → { approvals: 2, yard: 3 }. */
  function badges(items) {
    var out = {};
    (items || []).forEach(function (i) { if (i && i.navId && i.count > 0) out[i.navId] = (out[i.navId] || 0) + i.count; });
    return out;
  }

  /** The menu for a persona: groups with the items they see (empty groups left out), each with its badge (0: none). */
  function visibleGroups(roles, counts) {
    var c = counts || {};
    var out = [];
    GROUPS.forEach(function (g) {
      var items = g.items.filter(function (it) { return itemVisible(it, roles); }).map(function (it) {
        return { id: it.id, label: it.label, icon: it.icon, built: !!it.built, badge: c[it.id] || 0 };
      });
      if (items.length) out.push({ key: g.key, label: g.label, items: items });
    });
    return out;
  }

  /** The tab of a menu item shows its own page (flows/<flow>/pages/<page>-page); a skeleton until it is built. */
  function routeOf(it) {
    return it ? { flow: it.route.flow, page: it.route.page, params: {} } : null;
  }

  /** Who could open a screen: its player (the Guide's), else the first persona whose roles fit (never Admin), or null. */
  function whoCanOpen(navId, personas) {
    var it = ITEMS[navId];
    var list = (personas || []).filter(function (p) { return !isAdmin(p.roles); });
    var player = it && it.player ? list.filter(function (p) { return p.id === it.player; })[0] : null;
    if (player && itemVisible(it, player.roles)) return player;
    for (var i = 0; i < list.length; i++) if (itemVisible(it, list[i].roles)) return list[i];
    return null;
  }

  return {
    ROLES: ROLES,
    HOME: HOME,
    GROUPS: GROUPS,
    ITEMS: ITEMS,
    RECORDS: RECORDS,
    item: function (id) { return ITEMS[id] || null; },
    itemVisible: itemVisible,
    visibleGroups: visibleGroups,
    badges: badges,
    routeOf: routeOf,
    whoCanOpen: whoCanOpen
  };
});
