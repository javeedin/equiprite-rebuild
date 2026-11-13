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
  // Which product this build is shown as. EquipRite Next is the business app. Build.Rite is the same build shown as the
  // team's own tools, apart from the business product: the Insights screens only (Jira stories, analytics, standup
  // minutes, follow-ups, the FDD, application pages with code fix, the FDD library), Issues first. The desktop
  // app serves it on a port of its own and says so (window.EQP_PRODUCT); elsewhere ?product=buildrite (kept for the
  // session; ?product=next goes back).
  var BUILD_GROUPS = ['insights'];
  function detectProduct() {
    try {
      var w = typeof window !== 'undefined' ? window : {};
      var q = w.location && w.location.search && typeof URLSearchParams !== 'undefined' ? new URLSearchParams(w.location.search).get('product') : '';
      if (q && w.sessionStorage) w.sessionStorage.setItem('eqp.product', q);
      var s = w.EQP_PRODUCT || q || (w.sessionStorage ? w.sessionStorage.getItem('eqp.product') : '') || '';
      return /^build/i.test(String(s)) ? 'buildrite' : 'next';
    } catch (e) { return 'next'; }
  }
  var PRODUCT_ID = detectProduct();
  var PRODUCT = { id: PRODUCT_ID, isBuild: PRODUCT_ID === 'buildrite', name: PRODUCT_ID === 'buildrite' ? 'Build.Rite' : 'EquipRite',
    home: PRODUCT_ID === 'buildrite' ? 'issues' : 'home', groups: BUILD_GROUPS };
  var inProduct = function (groupKey) { return !PRODUCT.isBuild || BUILD_GROUPS.indexOf(groupKey) !== -1; };
  // an item of another group that is also one of the team's tools (buildRite: true, e.g. SQL): in Build.Rite too, listed
  // with them (after Flows explained); in EquipRite it stays where it is
  var itemInProduct = function (it) { return !!it && (inProduct(it.group) || (PRODUCT.isBuild && !!it.buildRite)); };

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
      // Rate schedules side by side (flows/commercial rate-compare): each tier's Rate / day, or a rental priced by each.
      { id: 'rate-compare', label: 'Compare rates', icon: 'oj-ux-ico-split', pageCodes: ['EQR_RATE_SCHEDULE'], hiddenByRateSource: true,
        route: { flow: 'commercial', page: 'rate-compare' }, built: true, keywords: 'compare rate schedules side by side cheapest dearest difference price rental' },
      { id: 'agreements', label: 'Agreements', icon: 'oj-ux-ico-file-text', pageCodes: ['EQR_RENTAL_AGREEMENTS'], flags: ['AGREEMENTS_ENABLED', 'PROJECTS_MODULE_ENABLED'],
        route: { flow: 'commercial', page: 'agreements' }, built: true, newNav: 'agreements', keywords: 'rental agreements contracts' }
    ] },
    { key: 'insights', label: 'Insights', items: [
      // Issues (Build.Rite's first screen): an issue logged against a page, written up and analyzed by the AI against the
      // page's code and the FDD, approved, then applied by the agent on a branch of its own with a pull request; Jira kept
      // up to date (flows/insights issues; desktop/lib/issues.js, the desktop app). Gated like Jira stories.
      { id: 'issues', label: 'Issues', icon: 'oj-ux-ico-clipboard-list', pageCodes: ['EQR_CONFIGURATIONS'],
        route: { flow: 'insights', page: 'issues' }, built: true,
        keywords: 'issues bugs defects log report fix approve approval ai branch pull request triage out of scope jira' },
      // The EquipRite backlog read from Jira and analysed (flows/insights jira; services/jira, read only). Gated like
      // Settings for now: an existing page code, so it shows without a new COMMONRITE.RBAC_PAGES row.
      { id: 'jira', label: 'Jira stories', icon: 'oj-ux-ico-list', pageCodes: ['EQR_CONFIGURATIONS'],
        route: { flow: 'insights', page: 'jira' }, built: true, keywords: 'jira stories backlog epics sprint release analysis acceptance criteria tester gaps' },
      { id: 'analytics', label: 'Analytics', icon: 'oj-ux-ico-chart-bar', pageCodes: ['EQR_ANALYTICS', 'EQR_REPORTS'],
        route: { flow: 'insights', page: 'analytics' }, built: true, newNav: 'analytics', keywords: 'reports utilization kpi' },
      // The daily standup on the Jira backlog, written down and kept in DuckDB on this PC (flows/insights minutes page):
      // a meeting's header and lines (tied to a story or generic) with a next action, voice→text and Format by AI, tracked
      // by epic and customer, sent as an email or to Teams. Gated like Jira stories (an existing page code).
      { id: 'minutes', label: 'Standup minutes', icon: 'oj-ux-ico-note', pageCodes: ['EQR_CONFIGURATIONS'],
        route: { flow: 'insights', page: 'minutes' }, built: true, keywords: 'minutes standup meeting notes mom action items attendees epic customer daily scrum voice ai teams email' },
      // Follow-ups drafted on the Jira pages (Copy to follow-up -> Save), kept in DuckDB on this PC (flows/insights
      // followups page): a header (title, scope, recipients, when) and the stories. Gated like Jira stories.
      { id: 'followups', label: 'Follow-ups', icon: 'oj-ux-ico-email', pageCodes: ['EQR_CONFIGURATIONS'],
        route: { flow: 'insights', page: 'followups' }, built: true, keywords: 'follow-ups followup email stories sprint reminder close chase saved' },
      // The FDD, its flows across the Fusion modules and how much of it is built (flows/fdd). Like Help, for everyone
      // signed in (no page code), but not a customer-only role: their menu stays the portal.
      { id: 'fdd', label: 'EquipRite FDD', icon: 'oj-ux-ico-document-check', pageCodes: [], everyone: true, staff: true,
        route: { flow: 'fdd', page: 'fdd' }, built: true,
        keywords: 'fdd functional design document requirements business mapping development status progress swimlane diagrams scenarios integrations' },
      // Every VB page of the project with its technical sheet — screenshot, features, business logic, integrations — and
      // the Jira stories mapped to it, kept in git (flows/insights app-pages). Gated like Jira stories.
      { id: 'app-pages', label: 'Application pages', icon: 'oj-ux-ico-layers', pageCodes: ['EQR_CONFIGURATIONS'],
        route: { flow: 'insights', page: 'app-pages' }, built: true,
        keywords: 'application pages vb page code technical sheet screenshot business logic integrations rest fusion oic bip chains jira map story developer' },
      // The FDD documents "Analyze with AI" reads (flows/fdd library page): uploaded into the project and committed and
      // pushed to git, so every user has them; one is the latest. Gated like Jira stories (an existing page code).
      { id: 'fdd-library', label: 'FDD library', icon: 'oj-ux-ico-upload', pageCodes: ['EQR_CONFIGURATIONS'],
        route: { flow: 'fdd', page: 'library' }, built: true,
        keywords: 'fdd library upload document word pdf version latest git analyze ai sections outline functional design' },
      // Flows explained (Build.Rite): every flow of the team's tools, step by step (flows/insights flows; resources/js/flowsGuide.js).
      // Gated like Jira stories: the team's, not a business user's.
      { id: 'flows', label: 'Flows explained', icon: 'oj-ux-ico-network-flow-diagram', pageCodes: ['EQR_CONFIGURATIONS'],
        route: { flow: 'insights', page: 'flows' }, built: true,
        keywords: 'flows explained guide steps issues code fix approval branch pull request data branch who does what' }
    ] },
    { key: 'admin', label: 'Admin', items: [
      { id: 'settings', label: 'Settings', icon: 'oj-ux-ico-settings', pageCodes: ['EQR_CONFIGURATIONS'],
        route: { flow: 'admin', page: 'settings' }, built: true, newNav: 'configuration', keywords: 'configuration flags lookups' },
      { id: 'access', label: 'Access', icon: 'oj-ux-ico-shield-user', pageCodes: ['EQR_RBAC_ADMIN'],
        route: { flow: 'admin', page: 'access' }, built: true, newNav: 'page-access', keywords: 'roles rbac page access security' },
      { id: 'integrations', label: 'Integrations', icon: 'oj-ux-ico-heartbeat', pageCodes: ['EQR_CONFIGURATIONS'],
        route: { flow: 'admin', page: 'integrations' }, built: true, newNav: 'integration-health', keywords: 'fusion sync health errors' },
      // SQL against an Oracle database from this PC, as in SQL Developer (flows/admin sql page): the desktop app connects
      // for it (desktop/lib/oracleSql.js), so it works in the desktop app only. For admins (the Settings page code).
      // Also one of the team's tools: in Build.Rite's menu too (buildRite), after Flows explained.
      { id: 'sql', label: 'SQL', icon: 'oj-ux-ico-database', pageCodes: ['EQR_CONFIGURATIONS'], buildRite: true,
        route: { flow: 'admin', page: 'sql' }, built: true, keywords: 'query database oracle developer tns select statement worksheet' }
    ] },
    // Help is for everyone, once their access has loaded. It sits at the foot of the menu and in the top bar, not in a
    // group of its own (foot).
    { key: 'help', label: 'Help', foot: true, items: [
      { id: 'help', label: 'Help', icon: 'oj-ux-ico-help', pageCodes: [], everyone: true, route: { flow: 'help', page: 'help' }, built: true,
        keywords: 'help guide how flow diagram process status statuses lifecycle steps approve pick ship return what next' }
    ] },
    { key: 'customers', label: 'Customers', flags: ['CUSTOMERS_MODULE_ENABLED'], items: [
      { id: 'customer-portal', label: 'Customer portal', icon: 'oj-ux-ico-customer-request', pageCodes: ['EQR_CUST_DASHBOARD'],
        route: { flow: 'customer', page: 'portal' }, built: true, newNav: 'customer-portal', keywords: 'customer portal external' }
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
    // Everything about a piece of equipment: an equipment item ({ name, equipmentId }) with all its units, or one unit
    // ({ serial }): where each is, its availability ahead, and its full history (flows/fleet equipment page). Opened
    // from the global search, Availability's yard grid and Check availability. A unit ({ unit }) opens the same page.
    'equipment-360': { flow: 'fleet', page: 'equipment', icon: 'oj-ux-ico-truck', navId: 'fleet',
      key: function (p) { return p && (p.serial || p.unit) ? 'unit-' + (p.serial || p.unit) : 'item-' + ((p && (p.equipmentId || p.name)) || ''); },
      title: function (p) { return (p && (p.serial || p.unit || p.name || p.equipmentId)) || 'Equipment'; } },
    unit: { flow: 'fleet', page: 'equipment', icon: 'oj-ux-ico-truck', navId: 'fleet',
      key: function (p) { return p ? (p.unit || p.serial || p.id || '') : ''; },
      title: function (p) { return (p && (p.unit || p.serial || p.id)) || 'Unit'; } },
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
    // One Jira sprint ({ id: Jira's sprint id, name }), from Jira stories' By sprint: its report in a tab of its own.
    'jira-sprint': { flow: 'insights', page: 'jira-sprint', icon: 'oj-ux-ico-list', navId: 'jira',
      key: function (p) { return p ? String(p.id || p.name || '') : ''; },
      title: function (p) { return 'Sprint ' + ((p && (p.name || p.id)) || ''); } },
    // "Analyze with AI" for one Jira story ({ key }): the story + its sub-tasks and comments, an AI analysis and a chatbot,
    // in a tab of its own (flows/insights jira-analysis). Opened by the AI icon on a story.
    'jira-analysis': { flow: 'insights', page: 'jira-analysis', icon: 'oj-ux-ico-brain', navId: 'jira',
      key: function (p) { return p ? String(p.key || '') : ''; },
      title: function (p) { return 'AI · ' + ((p && p.key) || 'Story'); } },
    // "Analyze with AI" for several stories at once ({ keys: 'EQP-23,EQP-36' }): the stories, their activity, one AI
    // analysis across them and a chatbot (flows/insights jira-analysis-set). Opened from a sprint's ticked items or the
    // stories shown on Jira stories; the same set opens the same tab.
    'jira-analysis-set': { flow: 'insights', page: 'jira-analysis-set', icon: 'oj-ux-ico-brain', navId: 'jira',
      key: function (p) { return p ? String(p.keys || '').toUpperCase().split(/[\s,]+/).filter(Boolean).sort().join(',') : ''; },
      title: function (p) {
        var k = p ? String(p.keys || '').split(/[\s,]+/).filter(Boolean) : [];
        return 'AI · ' + (k.length <= 2 ? k.join(', ') : k.length + ' stories');
      } },
    // An agreement is keyed by its number ({ number: 'RNT-0002' }); { id: 'new' } is a new one.
    agreement: { flow: 'commercial', page: 'agreement', icon: 'oj-ux-ico-file-text', navId: 'agreements',
      title: function (p) { return (p && (p.number || (p.id === 'new' ? 'New agreement' : p.id))) || 'Agreement'; } },
    cost: { flow: 'usage', page: 'cost', icon: 'oj-ux-ico-currency-dollar', navId: 'costs',
      title: function (p) { return ((p && (p.number || p.id)) || 'Request') + ' costs'; } },
    // The customer portal's records ({ id: request id, number: request number }): a request tracked, its quote, its
    // invoices; and a customer's new request ({} for a new one, { draft: id, number } to finish a saved draft).
    'customer-request': { flow: 'customer', page: 'request', icon: 'oj-ux-ico-customer-request', navId: 'customer-portal',
      title: function (p) { return (p && (p.number || p.id)) || 'Request'; } },
    quote: { flow: 'customer', page: 'quote', icon: 'oj-ux-ico-document-check', navId: 'customer-portal',
      title: function (p) { return 'Quote · ' + ((p && (p.number || p.id)) || ''); } },
    invoice: { flow: 'customer', page: 'invoice', icon: 'oj-ux-ico-invoice', navId: 'customer-portal',
      title: function (p) { return 'Invoices · ' + ((p && (p.number || p.id)) || ''); } },
    'customer-order': { flow: 'customer', page: 'order', icon: 'oj-ux-ico-cart-add', navId: 'customer-portal',
      key: function (p) { return p && p.draft ? 'draft-' + p.draft : 'new'; },
      title: function (p) { return p && p.draft ? 'Draft ' + (p.number || p.draft) : 'New request'; } }
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
      if (g.foot || !inProduct(g.key)) return;
      if (!(g.flags || []).every(function (f) { return rules.isFeatureEnabled(flags, flagsLoaded, f); })) return;
      var items = g.items.filter(function (it) { return itemVisible(it, map, loaded, flags, flagsLoaded, buRateSources); });
      if (items.length) out.push({ key: g.key, label: g.label, items: items });
    });
    // Build.Rite: the team's tools kept in other groups (SQL) join its own list, after Flows explained
    if (PRODUCT.isBuild && out.length) {
      GROUPS.forEach(function (g) {
        if (g.foot || inProduct(g.key)) return;
        g.items.forEach(function (it) { if (it.buildRite && itemVisible(it, map, loaded, flags, flagsLoaded, buRateSources)) out[out.length - 1].items.push(it); });
      });
    }
    return out;
  }

  /**
   * A customer's role: it opens the customer pages and no internal screen (EQR_DASHBOARD aside, which customers may
   * hold). Such a role lands on the portal and does not see My work, as New sends customer-only roles to the portal.
   */
  function customerOnly(map, loaded) {
    if (!rules.canSee(map, loaded, ['EQR_CUST_DASHBOARD'])) return false;
    var internal = [];
    GROUPS.forEach(function (g) {
      if (g.key === 'customers') return;
      g.items.forEach(function (it) { if (it.id !== 'home') internal = internal.concat(it.pageCodes); });
    });
    return !rules.canSee(map, loaded, internal);
  }

  /**
   * True when this role holds an internal page code (any page outside the customer portal). An item marked `staff`
   * (EquipRite FDD) shows only then: a role with no page still gets "no EquipRite screens yet", and a customer's menu
   * stays the portal. Page codes only, not feature flags, so switching a module off does not move it.
   */
  function staffScreens(map, loaded) {
    if (!loaded || customerOnly(map, loaded)) return false;
    var internal = [];
    GROUPS.forEach(function (g) {
      if (g.key === 'customers') return;
      g.items.forEach(function (x) { internal = internal.concat(x.pageCodes || []); });
    });
    return rules.canSee(map, loaded, internal);
  }

  function itemVisible(it, map, loaded, flags, flagsLoaded, buRateSources) {
    if (it && !itemInProduct(it)) return false;
    if (!it) return false;
    if (it.everyone) return !!loaded && (!it.staff || staffScreens(map, loaded));
    if (it.id === 'home' && customerOnly(map, loaded)) return false;
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
    // Help (the menu's foot) is found too, for anyone with a menu.
    var all = (groups || []).length ? groups.concat(GROUPS.filter(function (g) { return g.foot && inProduct(g.key); })) : [];
    all.forEach(function (g) {
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
    product: PRODUCT,
    routeOf: routeOf,
    newUrl: newUrl,
    visibleGroups: visibleGroups,
    itemVisible: itemVisible,
    customerOnly: customerOnly,
    search: search
  };
});
