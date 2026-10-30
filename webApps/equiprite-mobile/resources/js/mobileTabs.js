define(['resources/js/rules'], function (rules) {
  'use strict';

  // EquipRite Mobile's tabs, across the bottom of the phone. Each person gets the tabs their page access allows: the
  // same RBAC page codes as Old, New and Next gate each one, so access is configured once (Admin > Access) for all four
  // apps. Until access has loaded only Me shows (fail closed).
  //
  //   approve   decide requests: approve or send back                    EQR_WORKBENCH, FULL
  //   pick      the yard: pick, scan, ship confirm (read-only can look)  EQR_INITIATE_PICKING
  //   request   raise a request                                          EQR_PROJ_CREATE_REQUEST
  //   track     my requests: where each is, what is next, its history   EQR_EQUIPMENT_REQUESTS
  //   me        who you are, the other EquipRite versions, installing    everyone
  var TABS = [
    { id: 'approve', label: 'Approve', icon: 'oj-ux-ico-check-circle', codes: ['EQR_WORKBENCH'], full: true, flow: 'approve', page: 'approve',
      title: 'Approve' },
    { id: 'pick', label: 'Pick', icon: 'oj-ux-ico-fullfilment-box', codes: ['EQR_INITIATE_PICKING'], flow: 'pick', page: 'pick', title: 'Pick & ship' },
    { id: 'request', label: 'Request', icon: 'oj-ux-ico-cart-add', codes: ['EQR_PROJ_CREATE_REQUEST'], full: true, flow: 'request', page: 'request',
      title: 'New request' },
    { id: 'track', label: 'My requests', icon: 'oj-ux-ico-documents', codes: ['EQR_EQUIPMENT_REQUESTS'], flow: 'track', page: 'track', title: 'My requests' },
    { id: 'me', label: 'Me', icon: 'oj-ux-ico-avatar', codes: [], always: true, flow: 'me', page: 'me', title: 'Me' }
  ];
  var BY_ID = {};
  TABS.forEach(function (t) { BY_ID[t.id] = t; });

  /** Whether this role gets a tab: FULL for the tabs that act (approve, request), FULL or READ_ONLY for the others. */
  function allowed(tab, map, loaded) {
    if (!tab) return false;
    if (tab.always) return true;
    if (!loaded) return false;
    if (tab.full) return tab.codes.some(function (c) { return rules.pageAccess(map, loaded, c) === 'FULL'; });
    return rules.canSee(map, loaded, tab.codes);
  }

  /** The tabs this role gets, in order. */
  function visible(map, loaded) {
    return TABS.filter(function (t) { return allowed(t, map, loaded); });
  }

  /** The tab to open on: the first of the role's work tabs (approve, pick, request, track), else Me. */
  function first(map, loaded) {
    var v = visible(map, loaded);
    return v.length ? v[0].id : 'me';
  }

  /** The switcher's item for a tab (VB's oj-vb-switcher: id, name, flow, page, params). */
  function item(tab) {
    return { id: tab.id, name: 'tab_' + tab.id, flow: tab.flow, page: tab.page, params: {}, title: tab.title, icon: tab.icon };
  }

  /** "What you can do here", in words, for the Me tab: "Approve requests · Pick and ship · Raise requests". */
  function summary(map, loaded) {
    var words = { approve: 'Approve requests', pick: 'Pick and ship', request: 'Raise requests', track: 'Follow your requests' };
    return visible(map, loaded).filter(function (t) { return words[t.id]; }).map(function (t) { return words[t.id]; }).join(' · ');
  }

  return { TABS: TABS, tab: function (id) { return BY_ID[id] || null; }, allowed: allowed, visible: visible, first: first, item: item, summary: summary };
});
