define(['resources/js/rules'], function (rules) {
  'use strict';

  // EquipRite Next's menu, designed around the work rather than the old screens: My work first, then requests, the
  // fleet, the yard, usage and billing, commercial terms, insights and admin. The same RBAC page codes as Old and New
  // EquipRite gate every item, so page access is configured once (Admin > Access) for all three apps.
  //
  // Item:
  //   id          the tab id of the screen, and what the menu and the command bar open
  //   pageCodes   shown when ANY is FULL or READ_ONLY
  //   flags       feature flags that must all be on; hiddenWhenFlags: hidden when any is on
  //   route       { flow, page } of the Next screen. Each area has a flow of its own (requests, order, approvals, fleet,
  //               availability, equipment, yard, checks, usage, commercial, insights, admin, customer)
  //   built       false: the screen is being built for Next; the tab says so and links to New and Old EquipRite
  //   newNav      the same screen's menu id in New EquipRite (for that link)
  //   keywords    extra words the command bar matches
  var GROUPS = [
    { key: 'work', label: '', items: [
      { id: 'home', label: 'My work', icon: 'oj-ux-ico-inbox', pageCodes: ['EQR_DASHBOARD'], route: { flow: 'home', page: 'home' },
        built: true, newNav: 'home', keywords: 'home dashboard tasks queue' }
    ] },
    { key: 'requests', label: 'Requests', items: [
      { id: 'requests', label: 'Requests', icon: 'oj-ux-ico-documents', pageCodes: ['EQR_EQUIPMENT_REQUESTS'],
        route: { flow: 'requests', page: 'requests' }, built: true, newNav: 'my-requests', keywords: 'my requests requisitions orders' },
      { id: 'new-request', label: 'New request', icon: 'oj-ux-ico-cart-add', pageCodes: ['EQR_PROJ_CREATE_REQUEST'],
        route: { flow: 'order', page: 'new-request' }, built: true, newNav: 'new-request', keywords: 'create order catalog cart' },
      { id: 'approvals', label: 'Approve & allocate', icon: 'oj-ux-ico-clipboard-check', pageCodes: ['EQR_WORKBENCH'],
        route: { flow: 'approvals', page: 'approvals' }, built: true, newNav: 'workbench', keywords: 'workbench approve allocate assign units' }
    ] },
    { key: 'fleet', label: 'Equipment', items: [
      { id: 'fleet', label: 'Fleet', icon: 'oj-ux-ico-truck', pageCodes: ['EQR_WORKBENCH', 'EQR_EQUIPMENT_MASTER'],
        route: { flow: 'fleet', page: 'fleet' }, built: true, newNav: 'equipment-workbench', keywords: 'units serials equipment workbench where' },
      { id: 'availability', label: 'Availability', icon: 'oj-ux-ico-calendar', pageCodes: ['EQR_EQUIPMENT_SCHEDULE'],
        route: { flow: 'availability', page: 'availability' }, built: true, newNav: 'schedule', keywords: 'schedule gantt calendar booking' },
      { id: 'equipment', label: 'Equipment master', icon: 'oj-ux-ico-box-grid', pageCodes: ['EQR_EQUIPMENT_MASTER'],
        route: { flow: 'equipment', page: 'equipment' }, built: true, newNav: 'equipment', keywords: 'catalog items classes import' }
    ] },
    { key: 'yard', label: 'Yard & logistics', items: [
      { id: 'picking', label: 'Picking & shipping', icon: 'oj-ux-ico-fullfilment-box', pageCodes: ['EQR_INITIATE_PICKING'],
        route: { flow: 'yard', page: 'picking' }, built: true, newNav: 'picking', keywords: 'pick ship transfer order outbound' },
      { id: 'returns', label: 'Receiving & returns', icon: 'oj-ux-ico-return-box', pageCodes: ['EQR_EQUIPMENT_RETURNS'],
        route: { flow: 'yard', page: 'returns' }, built: true, newNav: 'receipt', keywords: 'receipt receive return inbound' },
      { id: 'inspection', label: 'Inspections', icon: 'oj-ux-ico-check-square', pageCodes: ['EQR_WORKBENCH'],
        route: { flow: 'checks', page: 'inspection' }, built: true, newNav: 'inspection', keywords: 'inspect checklist damage' },
      { id: 'transfers', label: 'Transfers', icon: 'oj-ux-ico-inventory-transfer', pageCodes: ['EQR_WORKBENCH'],
        route: { flow: 'checks', page: 'transfers' }, built: true, newNav: 'transfer', keywords: 'move yard to yard' }
    ] },
    { key: 'usage', label: 'Usage & billing', flags: ['PROJECTS_MODULE_ENABLED'], items: [
      { id: 'timesheets', label: 'Timesheets', icon: 'oj-ux-ico-clock', pageCodes: ['EQR_TIMESHEETS'], flags: ['TIMESHEETS_ENABLED'],
        route: { flow: 'usage', page: 'timesheets' }, built: true, newNav: 'time-entry', keywords: 'time entry hours usage' },
      { id: 'approve-time', label: 'Approve time', icon: 'oj-ux-ico-check-circle', pageCodes: ['EQR_TIMESHEET_APPROVALS'], flags: ['TIMESHEETS_ENABLED'],
        route: { flow: 'usage', page: 'approve-time' }, built: true, newNav: 'timesheet-approval', keywords: 'timesheet approval' },
      { id: 'costs', label: 'Post costs', icon: 'oj-ux-ico-currency-dollar', pageCodes: ['EQR_POST_COST'], hiddenWhenFlags: ['PPM_RATES_ENABLED'],
        route: { flow: 'usage', page: 'costs' }, built: true, newNav: 'post-costs', keywords: 'cost posting billing finance' },
      { id: 'direct-costs', label: 'Direct cost & inventory', icon: 'oj-ux-ico-wallet-box', pageCodes: ['EQR_EQUIPMENT_MASTER'],
        route: { flow: 'usage', page: 'direct-costs' }, built: true, newNav: 'project-costs', keywords: 'project costs consumables' }
    ] },
    { key: 'commercial', label: 'Commercial', items: [
      { id: 'rates', label: 'Rates', icon: 'oj-ux-ico-tables-basic', pageCodes: ['EQR_RATE_SCHEDULE'], hiddenByRateSource: true,
        route: { flow: 'commercial', page: 'rates' }, built: true, newNav: 'rates', keywords: 'rate schedules pricing' },
      { id: 'agreements', label: 'Agreements', icon: 'oj-ux-ico-file-text', pageCodes: ['EQR_RENTAL_AGREEMENTS'], flags: ['AGREEMENTS_ENABLED', 'PROJECTS_MODULE_ENABLED'],
        route: { flow: 'commercial', page: 'agreements' }, built: true, newNav: 'agreements', keywords: 'rental agreements contracts' }
    ] },
    { key: 'insights', label: 'Insights', items: [
      { id: 'analytics', label: 'Analytics', icon: 'oj-ux-ico-chart-bar', pageCodes: ['EQR_ANALYTICS', 'EQR_REPORTS'],
        route: { flow: 'insights', page: 'analytics' }, built: false, newNav: 'analytics', keywords: 'reports utilization kpi' }
    ] },
    { key: 'admin', label: 'Admin', items: [
      { id: 'settings', label: 'Settings', icon: 'oj-ux-ico-settings', pageCodes: ['EQR_CONFIGURATIONS'],
        route: { flow: 'admin', page: 'settings' }, built: false, newNav: 'configuration', keywords: 'configuration flags lookups' },
      { id: 'access', label: 'Access', icon: 'oj-ux-ico-shield-user', pageCodes: ['EQR_RBAC_ADMIN'],
        route: { flow: 'admin', page: 'access' }, built: false, newNav: 'page-access', keywords: 'roles rbac page access security' },
      { id: 'integrations', label: 'Integrations', icon: 'oj-ux-ico-heartbeat', pageCodes: ['EQR_CONFIGURATIONS'],
        route: { flow: 'admin', page: 'integrations' }, built: false, newNav: 'integration-health', keywords: 'fusion sync health errors' }
    ] },
    { key: 'customers', label: 'Customers', flags: ['CUSTOMERS_MODULE_ENABLED'], items: [
      { id: 'customer-portal', label: 'Customer portal', icon: 'oj-ux-ico-customer-request', pageCodes: ['EQR_CUST_DASHBOARD'],
        route: { flow: 'customer', page: 'portal' }, built: false, newNav: 'customer-portal', keywords: 'customer portal external' }
    ] }
  ];

  // The same screen in New EquipRite (its flow/page), for the tab of a screen not built in Next yet.
  var NEW_ROUTES = {
    'home': 'home/home', 'new-request': 'request/new-request', 'my-requests': 'request/my-requests', 'workbench': 'workbench/workbench',
    'equipment-workbench': 'fleet/equipment-workbench', 'schedule': 'schedule/schedule', 'picking': 'logistics/picking',
    'inspection': 'operations/inspection', 'receipt': 'logistics/receipt', 'transfer': 'operations/transfers', 'time-entry': 'usage/time-entry',
    'timesheet-approval': 'usage/timesheet-approval', 'post-costs': 'usage/post-costs', 'project-costs': 'usage/project-costs',
    'equipment': 'master/equipment', 'rates': 'master/rates', 'agreements': 'master/agreements', 'analytics': 'insights/analytics',
    'configuration': 'settings/configuration', 'page-access': 'admin/page-access', 'integration-health': 'admin/integration-health',
    'customer-portal': 'customer/customer-home'
  };

  /** The address of a menu item's screen in New EquipRite, or '' when New's address or the screen is unknown. */
  function newUrl(newBase, navId) {
    var it = ITEMS[navId];
    var path = it && NEW_ROUTES[it.newNav];
    if (!newBase || !path) return '';
    return (newBase.slice(-1) === '/' ? newBase : newBase + '/') + 'vp/shell/' + path;
  }

  var ITEMS = {};
  GROUPS.forEach(function (g) { g.items.forEach(function (it) { it.group = g.key; ITEMS[it.id] = it; }); });

  // Screens that open a record in a tab of its own: the tab id is kind + ':' + key, so a record opens once.
  var RECORDS = {
    request: { flow: 'requests', page: 'request', icon: 'oj-ux-ico-file-text', navId: 'requests',
      title: function (p) { return (p && (p.number || p.id)) || 'Request'; } },
    unit: { flow: 'fleet', page: 'unit', icon: 'oj-ux-ico-truck', navId: 'fleet',
      title: function (p) { return (p && (p.unit || p.id)) || 'Unit'; } },
    // A saved project draft, reopened in New request to finish it: { id: request id, number }.
    draft: { flow: 'order', page: 'new-request', icon: 'oj-ux-ico-cart-add', navId: 'new-request',
      title: function (p) { return 'Draft ' + ((p && (p.number || p.id)) || ''); } },
    transfer: { flow: 'checks', page: 'transfer', icon: 'oj-ux-ico-inventory-transfer', navId: 'transfers',
      title: function (p) { return (p && (p.number || p.id)) || 'Transfer'; } },
    // A request started from an agreement's lines (Agreements, Create request): a New request tab of its own, which
    // reads the hand-off once, so a New request already open keeps what is in it. Not kept after a restart (its
    // hand-off has been read by then).
    'agreement-request': { flow: 'order', page: 'new-request', icon: 'oj-ux-ico-cart-add', navId: 'new-request', transient: true,
      key: function (p) { return p && p.agreement ? p.agreement + '-' + (p.at || '') : ''; },
      title: function (p) { return 'Request · ' + ((p && p.agreement) || 'agreement'); } },
    'equipment-item': { flow: 'equipment', page: 'item', icon: 'oj-ux-ico-box-grid', navId: 'equipment',
      title: function (p) { return (p && (p.number || p.id)) || 'Equipment'; } },
    // An agreement is keyed by its number ({ number: 'RNT-0002' }); { id: 'new' } is a new one.
    agreement: { flow: 'commercial', page: 'agreement', icon: 'oj-ux-ico-file-text', navId: 'agreements',
      title: function (p) { return (p && (p.number || (p.id === 'new' ? 'New agreement' : p.id))) || 'Agreement'; } },
    cost: { flow: 'usage', page: 'cost', icon: 'oj-ux-ico-currency-dollar', navId: 'costs',
      title: function (p) { return ((p && (p.number || p.id)) || 'Request') + ' costs'; } }
  };

  /** The page the tab of a menu item shows: its own screen, or the "being built" page for one not built yet. */
  function routeOf(it) {
    if (!it) return null;
    return it.built ? { flow: it.route.flow, page: it.route.page, params: {} } : { flow: 'home', page: 'soon', params: { navId: it.id } };
  }

  /** The menu for this role and these flags: groups with their visible items (empty groups left out). */
  function visibleGroups(map, loaded, flags, flagsLoaded, buRateSources) {
    var out = [];
    GROUPS.forEach(function (g) {
      if (!(g.flags || []).every(function (f) { return rules.isFeatureEnabled(flags, flagsLoaded, f); })) return;
      var items = g.items.filter(function (it) { return itemVisible(it, map, loaded, flags, flagsLoaded, buRateSources); });
      if (items.length) out.push({ key: g.key, label: g.label, items: items });
    });
    return out;
  }

  function itemVisible(it, map, loaded, flags, flagsLoaded, buRateSources) {
    if (!it) return false;
    var group = GROUPS.filter(function (g) { return g.key === it.group; })[0];
    if (group && !(group.flags || []).every(function (f) { return rules.isFeatureEnabled(flags, flagsLoaded, f); })) return false;
    if ((it.hiddenWhenFlags || []).some(function (f) { return !rules.isFeatureFlagOff(flags, flagsLoaded, f); })) return false;
    if (it.hiddenByRateSource && rules.isRateManagementHidden(flags, flagsLoaded, buRateSources)) return false;
    if (!(it.flags || []).every(function (f) { return rules.isFeatureEnabled(flags, flagsLoaded, f); })) return false;
    return rules.canSee(map, loaded, it.pageCodes);
  }

  /** Command bar: menu items matching the text (label, group, keywords), best first. */
  function search(text, groups) {
    var q = String(text || '').trim().toLowerCase();
    if (!q) return [];
    var out = [];
    (groups || []).forEach(function (g) {
      g.items.forEach(function (it) {
        var label = it.label.toLowerCase();
        var hay = label + ' ' + (g.label || '').toLowerCase() + ' ' + (it.keywords || '');
        var score = label.indexOf(q) === 0 ? 0 : (label.indexOf(q) !== -1 ? 1 : (hay.indexOf(q) !== -1 ? 2 : -1));
        if (score >= 0) out.push({ id: it.id, label: it.label, icon: it.icon, group: g.label, score: score });
      });
    });
    return out.sort(function (a, b) { return a.score - b.score || a.label.localeCompare(b.label); });
  }

  return {
    GROUPS: GROUPS,
    ITEMS: ITEMS,
    RECORDS: RECORDS,
    item: function (id) { return ITEMS[id] || null; },
    routeOf: routeOf,
    newUrl: newUrl,
    visibleGroups: visibleGroups,
    itemVisible: itemVisible,
    search: search
  };
});
