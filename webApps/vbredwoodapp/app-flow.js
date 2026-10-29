/* Copyright (c) 2025, Oracle and/or its affiliates */

define([
  'oj-sp/spectra-shell/config/config',
  'resources/js/lineStatusLabels',
  'ojs/ojarraydataprovider',
  'css!resources/css/app'
], function (_shellConfig, lineStatusLabels, ArrayDataProvider) {
  'use strict';

  const STRIP_URL = 'https://static.oracle.com/cdn/fnd/gallery/2601.0.0/images/color-strip-netsuite-2x.webp';

  function patchStrip(el) {
    el.style.setProperty('background-image', "url('" + STRIP_URL + "')", 'important');
    el.style.setProperty('background-size', '100% 100%', 'important');
    el.style.setProperty('background-repeat', 'no-repeat', 'important');
  }

  function patchAllStrips() {
    const selectors = [
      '.oj-sp-header-general-overview-header-strip',
      '.oj-sp-advanced-create-edit-header-strip',
      '.oj-sp-advanced-create-edit-color-strip',
      '.oj-sp-smart-search-page-color-strip'
    ];
    document.querySelectorAll(selectors.join(',')).forEach(patchStrip);
  }

  var observer = new MutationObserver(function () {
    patchAllStrips();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  [500, 1500, 3000, 5000].forEach(function (delay) {
    setTimeout(patchAllStrips, delay);
  });

  // ── Dashboard persona resolution ────────────────────────────────────────
  // Fusion ORACLE_ROLE_NAME → { session-role code, PRIORITY }.
  //
  // Both sides are copied from COMMONRITE.RBAC_ROLE_MAP (APPLICATION_CODE =
  // 'EQUIP_RITE'), which is the authority. FALLBACK ONLY now: the persona is
  // resolved first from $application.variables.sessionRoles, which GET
  // /rbac/session-roles returns from the map itself, so a customer whose roles
  // are named differently (OII_RT_EQP_MANAGER_JR) needs map rows, not an entry
  // here. This copy covers a backend that predates that endpoint, or a failed
  // call. Never add a customer's role codes to it. Delete it once every
  // environment serves /rbac/session-roles.
  //
  // PRIORITY decides the winner when a user holds several roles; the values are
  // the DB's, so the dashboard and the backend resolve the same persona rather
  // than disagreeing. Lower wins.
  //
  // Only RT_EQP_* Oracle roles appear here. The other RBAC_ROLE_MAP rows
  // (ADMIN 10, EQUIP_MANAGER/MANAGER/SUPERVISOR 20, CREW_TIMEKEEPER 30) map
  // from GENERIC Fusion job roles — ORA_AP_ACCOUNTS_PAYABLE_MANAGER_JOB alone
  // is shared by three different session roles — so including them would let an
  // unrelated finance job role silently outrank a purpose-built RT_EQP_* grant.
  // The RT_EQP_* roles below each identify an EquipRite persona unambiguously.
  //
  // NOTE RT_EQP_ADMINISTRATOR *is* included (priority 30). It is an RT_EQP_*
  // role and unambiguous; omitting it was a bug, because it is the highest
  // priority of the set, so admins who also hold an operational grant were
  // resolving to THAT persona instead (an admin with RT_EQP_INSPECTION landed
  // on the Inspection dashboard).
  const ORACLE_ROLE_TO_DASH_ROLE = {
    // Priority 30 — the HIGHEST here, so an admin holding other grants still
    // resolves to the admin (= requestor) dashboard rather than to whichever
    // operational role they also happen to hold. Admin is not an operational
    // persona; product decision is that it sees the requestor dashboard.
    RT_EQP_ADMINISTRATOR: { role: 'EQUIP_ADMIN',   priority: 30 },
    RT_EQP_MANAGER:       { role: 'EQUIP_MGR',     priority: 40 },
    RT_EQP_REQUESTOR:     { role: 'REQUESTOR',     priority: 50 },
    RT_EQP_INSPECTION:    { role: 'INSPECTION',    priority: 60 },
    RT_EQP_TIMEKEEPER:    { role: 'TIMEKEEPER',    priority: 70 },
    RT_EQP_TIME_APPROVER: { role: 'TIME_APPROVER', priority: 80 },
    // Mapped so it RESOLVES, but it has no ROLE_CONFIG entry on purpose: an
    // external requestor holds no EQR_DASHBOARD grant and belongs on the
    // customer dashboard. dashboardInitChain redirects this persona rather than
    // rendering. Priority 90 keeps it below every internal role, so a user who
    // somehow holds both still gets their internal dashboard.
    RT_EQP_EXTERNAL_REQUESTOR: { role: 'EXTERNAL_REQUESTOR', priority: 90 },
    RT_EQP_FINANCE:       { role: 'FINANCE_USER',  priority: 100 }
  };

  // Persona resolution, at MODULE scope so it can be called without depending on
  // `this`. resolveDashboardRole() below is the public entry point and simply
  // delegates here; dashboardRoleLabel() calls this directly, because a template
  // binding can invoke a class method detached from its instance and `this`
  // would then be undefined. One implementation, two safe callers.
  //
  // SERVER LIST FIRST. sessionRoles is RBAC_ROLE_MAP's own answer (GET
  // /rbac/session-roles, loaded by loadPageAccessChain), already in priority
  // order, so any customer's role names work with map rows alone. The first
  // code we have a persona for wins. Skipping unknown codes matters: generic
  // ORA_* job roles map to legacy session roles (ADMIN 10, EQUIP_MANAGER 20)
  // that outrank every RT_EQP_* role but have no dashboard, so "take the top
  // row" would strand an Equipment Manager who also holds AP Manager.
  //
  // The hard-coded ORACLE_ROLE_TO_DASH_ROLE below is now only the FALLBACK, for
  // when sessionRoles is empty (backend without the endpoint, failed call, or
  // the list not loaded yet). The deliberately-disabled REQUESTOR fallback
  // after it is unchanged.
  function resolveDashboardRoleFrom(fusionRoles, sessionRoles) {
    const fromServer = firstKnownPersona(sessionRoles);
    if (fromServer) {
      return fromServer;
    }

    const roles = Array.isArray(fusionRoles) ? fusionRoles : [];
    let best = null;

    roles.forEach(function (r) {
      const code = String(r || '').trim().toUpperCase();
      const hit = ORACLE_ROLE_TO_DASH_ROLE[code];
      if (hit && (best === null || hit.priority < best.priority)) {
        best = hit;
      }
    });

    if (best) {
      return best.role;
    }

    // ── TESTING: fallback DISABLED ──────────────────────────────────────────
    // Normally an unresolved role falls back to REQUESTOR (the least privileged
    // layout) so the page always renders something. That is switched off while
    // testing role-driven personas, because a silent fallback is
    // indistinguishable from a WORKING requestor dashboard — it hides the exact
    // failure being tested (BIP roles not resolving, a role missing from
    // ORACLE_ROLE_TO_DASH_ROLE, a login with no RT_EQP_* grant).
    //
    // Returning '' makes the dashboard render empty and log loudly instead.
    // RESTORE before release by uncommenting the line below and deleting the
    // two lines after it.
    // return DEFAULT_DASH_ROLE;
    console.warn('[resolveDashboardRole] no persona from sessionRoles',
      sessionRoles, 'or RT_EQP_* fusionRoles', roles,
      '- fallback is DISABLED for testing, so the dashboard will be'
      + ' empty. Re-enable DEFAULT_DASH_ROLE in app-flow.js before release.');
    return '';
  }

  /** Trimmed, upper-cased, non-empty codes from a role list (or [] for junk). */
  function normalizeRoleCodes(list) {
    return (Array.isArray(list) ? list : [])
      .map(function (r) { return String(r || '').trim().toUpperCase(); })
      .filter(Boolean);
  }

  /**
   * First session role in the (priority-ordered) server list that the
   * dashboard has a persona for, or '' when none.
   *
   * DASH_ROLE_LABELS is the persona registry here: it lists exactly the
   * personas the dashboard serves, the ROLE_CONFIG entries in
   * dashboardRoleConfig.js plus EXTERNAL_REQUESTOR, which dashboardInitChain
   * redirects. Adding a persona already means adding its label, so this needs
   * no list of its own.
   */
  function firstKnownPersona(sessionRoles) {
    const codes = normalizeRoleCodes(sessionRoles);
    for (let i = 0; i < codes.length; i++) {
      if (Object.prototype.hasOwnProperty.call(DASH_ROLE_LABELS, codes[i])) {
        return codes[i];
      }
    }
    return '';
  }

  // Session roles that count as MANAGER TIER for canChooseCustomerType. The
  // legacy ADMIN / EQUIP_MANAGER roles are deliberately absent: they are mapped
  // from generic ORA_* job roles, which the RT_EQP_* check this replaces never
  // honoured either. Granting the External option off an AP Manager job would
  // be a widening, not a port.
  const MANAGER_TIER_SESSION_ROLES = { EQUIP_MGR: 1, EQUIP_ADMIN: 1 };

  // Human-readable persona names for the shell header's role chip. The
  // ROLE_CONFIG titles can't serve this: they are dashboard headings ('My
  // Dashboard'), not role names, and REQUESTOR's says nothing about the role at
  // all. Keyed by SESSION_ROLE so it lines up with resolveDashboardRole's output.
  const DASH_ROLE_LABELS = {
    EQUIP_ADMIN:        'Administrator',
    EQUIP_MGR:          'Equipment Manager',
    REQUESTOR:          'Equipment Requestor',
    INSPECTION:         'Inspection',
    TIMEKEEPER:         'Timekeeper',
    TIME_APPROVER:      'Time Approver',
    EXTERNAL_REQUESTOR: 'External Requestor',
    FINANCE_USER:       'Finance'
  };

  // Persona shown when no RT_EQP_* role resolves. REQUESTOR is the safe default:
  // it is the least-privileged layout (own requests only) and its single
  // endpoint is user-scoped server-side, so an unrecognised role sees nothing
  // that isn't already theirs. See resolveDashboardRole for why this fails soft.
  const DEFAULT_DASH_ROLE = 'REQUESTOR';

  // Inverse map: $application.currentPage.id → nav-list <li id>.
  // Keep aligned with pages/shell-page-chains/navigateChain.js.
  const PAGE_ID_TO_NAV_ID = {
    // 'main-equiprite' deliberately absent: the Dashboard has no drawer entry
    // BY DESIGN, so mapping it here would hand oj-navigation-list a selection
    // key that isn't in the list. Resolving to '' instead is the same
    // well-defined "page has no drawer entry" path legacy post-cost uses.
    // It is still RBAC-gated — via PAGE_ID_TO_PAGE_CODE below, not this map.
    'configurations': 'setup-configurations',
    'rbac-admin': 'setup-rbac-admin',
    'project-create-request': 'project-create-request',
    'equipment-requests': 'equipment-requests',
    'equipment-schedule': 'equipment-schedule',
    'equipment-master': 'main-equipment-master',
    'equipment-workbench': 'main-equipment-workbench',
    'initiate-picking': 'initiate-picking',
    'equipment-returns': 'equipment-returns',
    'rate-schedule': 'rate-schedule',
    'timesheet-approvals': 'main-timesheet-approvals',
    // COSTING section — the menu label is "Post Cost" but the page/nav id is
    // still post-cost-test (the redesigned drill-down). Legacy post-cost-page
    // has no menu entry, so it is deliberately absent from this map.
    'post-cost-test': 'post-cost-test',
    'rental-agreements': 'main-rental-agreements',
    'customer-dashboard': 'customer-dashboard',
    'request-catalog': 'request-catalog',
    'customer-create-req': 'customer-create-req',
    'customer-my-requests': 'customer-my-requests',
    'customer-my-billing': 'customer-my-billing'
  };

  // Direct page id → RBAC page code, for pages that must be GATED but have no
  // drawer entry. getPageCodeForPage() normally derives the code by going
  // page id → nav id → NAV_ID_TO_PAGE_CODE, which is itself derived from
  // NAV_GROUPS — so a page absent from the menu resolves to '' and its
  // enforcePageAccessChain silently no-ops. That was harmless while the
  // Dashboard was reachable only via the header logo; it is NOT harmless now
  // that main-flow.json lands every user there, because it would mean RBAC is
  // off for the one page everybody sees.
  //
  // Adding the Dashboard to NAV_GROUPS would fix the code lookup but also put
  // it back in the drawer, which is explicitly not wanted. This map is the
  // alternative: gate without a menu entry. getRoleHomeTarget's HOME_CODES
  // already associates 'main-equiprite' with EQR_DASHBOARD the same way, so
  // this is the established pattern rather than a new one.
  const PAGE_ID_TO_PAGE_CODE = {
    'main-equiprite': 'EQR_DASHBOARD',
    // Equipment Master's child pages share its code (2026-10-05). Without an
    // entry they resolved to '' and their guards let anyone in -- including
    // a READ_ONLY user opening the Create page by URL. The Create page also
    // demands FULL (equipment-create-page-chains/requireFullAccessChain).
    'equipment-units': 'EQR_EQUIPMENT_MASTER',
    'equipment-create': 'EQR_EQUIPMENT_MASTER',
    // Record Cost (POC, 2026-10-13) - opened from a serial; demands FULL in
    // its own requireFullAccessChain, like equipment-create.
    'equipment-record-cost': 'EQR_EQUIPMENT_MASTER'
  };

  // Flow id for pages that have no nav entry, so isSameFlow() can still place
  // them. Menu pages resolve via NAV_ID_TO_ROUTE; this covers the rest.
  // Only pages that can be a redirect TARGET or SOURCE need listing — the
  // Dashboard is both, being the shared landing page.
  const PAGE_ID_TO_FLOW = {
    'main-equiprite': 'main',
    'no-access': 'main'
  };

  // Where a user who can open NO page is sent (getRoleHomeTarget step 4).
  // Deliberately UNGATED — absent from NAV_GROUPS and PAGE_ID_TO_PAGE_CODE, and
  // its page json runs no enforcePageAccessChain — because it is the one page a
  // user with no grants must still be able to render.
  const NO_ACCESS_PAGE_ID = 'no-access';

  // ── PAGE-LEVEL RBAC ────────────────────────────────────────────────────────
  // The COMPLETE, static nav definition. Never filtered in place and never
  // mutated — visibleNavGroups() derives the rendered menu from it on every
  // evaluation, so a role change always recomputes from the full list instead
  // of compounding on an already-filtered one.
  //
  // Each item's `id` is the nav-list <li id> that navigateChain routes on;
  // `pageCode` is the COMMONRITE RBAC_PAGES.PAGE_CODE for that page. Both must
  // stay in step with:
  //   pages/shell-page-chains/navigateChain.js  (id -> flow/page)
  //   PAGE_ID_TO_NAV_ID below                   (page id -> nav id)
  //   COMMONRITE.RBAC_PAGES                     (pageCode -> route)
  // An item whose pageCode has no seeded RBAC_PAGES row disappears for everyone
  // (fail-closed) — that is the usual cause of "the menu item vanished".
  const NAV_GROUPS = [
    {
      key: 'admin', label: 'Administrator',
      items: [
        // Dashboard is deliberately NOT listed: it has no drawer entry by
        // design, and the RBAC rewrite must not change what the menu shows.
        // It is reachable via the header logo (goToDashboardChain) and, since
        // main-flow.json's defaultPage change, as the landing page for every
        // role. Being absent here keeps it out of the menu WITHOUT leaving it
        // ungated — PAGE_ID_TO_PAGE_CODE supplies its EQR_DASHBOARD code.
        { id: 'setup-configurations', label: 'Configuration Settings', icon: 'oj-ux-ico-settings', pageCode: 'EQR_CONFIGURATIONS' },
        { id: 'setup-rbac-admin', label: 'Page Access', icon: 'oj-ux-ico-contact-permission', pageCode: 'EQR_RBAC_ADMIN' }
      ]
    },
    {
      key: 'projectSite', label: 'Requestor', flags: ['PROJECTS_MODULE_ENABLED'],
      items: [
        { id: 'project-create-request', label: 'Create Request', icon: 'oj-ux-ico-plus', pageCode: 'EQR_PROJ_CREATE_REQUEST' },
        { id: 'equipment-requests', label: 'Equipment Requests', icon: 'oj-ux-ico-education', pageCode: 'EQR_EQUIPMENT_REQUESTS' }
      ]
    },
    {
      key: 'equipMgr', label: 'Equipment Manager',
      items: [
        { id: 'equipment-schedule', label: 'Equipment Schedule', icon: 'oj-ux-ico-calendar', pageCode: 'EQR_EQUIPMENT_SCHEDULE' },
        { id: 'main-equipment-master', label: 'Equipment Master', icon: 'oj-ux-ico-bag', pageCode: 'EQR_EQUIPMENT_MASTER' },
        { id: 'main-equipment-workbench', label: 'Equipment Manager Workbench', icon: 'oj-ux-ico-build', pageCode: 'EQR_WORKBENCH' },
        { id: 'initiate-picking', label: 'Initiate Picking', icon: 'oj-ux-ico-cart', pageCode: 'EQR_INITIATE_PICKING' },
        { id: 'equipment-returns', label: 'Equipment Return', icon: 'oj-ux-ico-undo', pageCode: 'EQR_EQUIPMENT_RETURNS' },
        // hiddenByRateSource — withdrawn when no BU prices from EquipRite; see
        // isRateManagementHidden. Deep links are blocked by rateManagementGuardChain.
        { id: 'rate-schedule', label: 'Rate Management', icon: 'oj-ux-ico-tables-basic', pageCode: 'EQR_RATE_SCHEDULE',
          hiddenByRateSource: true }
      ]
    },
    {
      key: 'timeKeeper', label: 'Time Keeper', flags: ['PROJECTS_MODULE_ENABLED', 'TIMESHEETS_ENABLED'],
      items: [
        { id: 'main-equipment-timesheets', label: 'Equipment Timesheet', icon: 'oj-ux-ico-clock', pageCode: 'EQR_TIMESHEETS' },
        { id: 'main-timesheet-approvals', label: 'Timesheet Approvals', icon: 'oj-ux-ico-check-square', pageCode: 'EQR_TIMESHEET_APPROVALS' }
      ]
    },
    {
      key: 'costing', label: 'Finance', flags: ['PROJECTS_MODULE_ENABLED'],
      items: [
        // Label is "Post Cost" but the nav/page id is still post-cost-test (the
        // redesigned drill-down). Legacy post-cost-page has no menu entry.
        //
        // hiddenWhenFlags PPM_RATES_ENABLED — R14: under Fusion PPM rates the
        // Post Cost screen does not exist. Not simplified, not read-only:
        // withdrawn. EquipRite computes no rental cost in that mode, so every
        // figure on that page would be an EquipRite number for something Fusion
        // is pricing. Deep links are blocked separately by the page's own
        // ppmRatesGuardChain — hiding a menu entry removes the affordance, not
        // the route.
        {
          id: 'post-cost-test', label: 'Post Cost', icon: 'oj-ux-ico-chart-bar-v-alt',
          pageCode: 'EQR_POST_COST',
          hiddenWhenFlags: ['PPM_RATES_ENABLED']
        }
      ]
    },
    {
      // BOTH flags, like timeKeeper above: the module licence decides whether
      // Agreement Manager exists at all, AGREEMENTS_ENABLED decides whether it
      // is usable. Omitting the feature flag here left all three pages in the
      // nav with the feature off.
      key: 'rental', label: 'Agreement Manager', flags: ['PROJECTS_MODULE_ENABLED', 'AGREEMENTS_ENABLED'],
      items: [
        { id: 'main-rental-agreements', label: 'Rental Agreements', icon: 'oj-ux-ico-documents', pageCode: 'EQR_RENTAL_AGREEMENTS' },
        { id: 'create-rental-agreement', label: 'Create Rental Agreement', icon: 'oj-ux-ico-plus', pageCode: 'EQR_RENTAL_AGR_CREATE' },
        { id: 'rental-agreement-approval', label: 'Rental Agreement Approval', icon: 'oj-ux-ico-check-square', pageCode: 'EQR_RENTAL_AGR_APPROVAL' }
      ]
    },
    {
      key: 'analytics', label: 'Analytics',
      items: [
        { id: 'main-equipment-analytics', label: 'Equipment Analytics', icon: 'oj-ux-ico-chart-bar', pageCode: 'EQR_ANALYTICS' },
        { id: 'main-equipment-reports', label: 'Equipment Reports', icon: 'oj-ux-ico-table', pageCode: 'EQR_REPORTS' }
      ]
    },
    {
      key: 'customer', label: 'External Requestor', flags: ['CUSTOMERS_MODULE_ENABLED'],
      items: [
        { id: 'customer-dashboard', label: 'Customer Dashboard', icon: 'oj-ux-ico-dashboard', pageCode: 'EQR_CUST_DASHBOARD' },
        { id: 'request-catalog', label: 'Equipment Catalog', icon: 'oj-ux-ico-documents', pageCode: 'EQR_CUST_CATALOG' },
        { id: 'customer-create-req', label: 'Create Request', icon: 'oj-ux-ico-plus', pageCode: 'EQR_CUST_CREATE_REQ' },
        { id: 'customer-my-requests', label: 'My Requests', icon: 'oj-ux-ico-file-text', pageCode: 'EQR_CUST_MY_REQUESTS' },
        // hiddenWhenFlags — the INVERSE of a group's `flags` gate: this item is
        // hidden when the flag is ON. With EXTERNAL_PROJECT_ASSIGN_ENABLED on,
        // an external request is attributed to an internal project and costed
        // through it, so the customer-facing billing screen does not apply and
        // is withdrawn from the nav. Deep links are blocked separately by each
        // billing page's externalProjectAssignGuardChain — hiding a menu entry
        // removes the affordance, not the route.
        {
          id: 'customer-my-billing', label: 'My Billing', icon: 'oj-ux-ico-documents',
          pageCode: 'EQR_CUST_MY_BILLING',
          hiddenWhenFlags: ['EXTERNAL_PROJECT_ASSIGN_ENABLED']
        }
      ]
    }
  ];

  // Every page code that is NOT customer-facing. Derived from NAV_GROUPS (the
  // 'customer' group is the sole definition of what "customer-facing" means),
  // so seeding a new internal page needs no change here. Used by
  // hasInternalPageAccess() to tell a customer-ONLY role from an admin who
  // happens to also hold the customer pages.
  const INTERNAL_PAGE_CODES = [];
  NAV_GROUPS.forEach(function (g) {
    if (g.key === 'customer') { return; }
    g.items.forEach(function (it) {
      if (it.pageCode) { INTERNAL_PAGE_CODES.push(it.pageCode); }
    });
  });

  // Nav <li id> -> RBAC page code. Derived from NAV_GROUPS so the two can never
  // drift; used by the page-entry guard to gate deep links.
  const NAV_ID_TO_PAGE_CODE = {};
  NAV_GROUPS.forEach(function (g) {
    g.items.forEach(function (it) { NAV_ID_TO_PAGE_CODE[it.id] = it.pageCode; });
  });

  // Nav <li id> -> { flow, page }. Used by getRoleHomeTarget to land a role on
  // the first page it can actually see. MUST mirror the routing in
  // pages/shell-page-chains/navigateChain.js — that chain routes menu clicks,
  // this map routes the initial landing, and a divergence would send a user to
  // a different page than the menu item of the same name.
  const NAV_ID_TO_ROUTE = {
    'setup-configurations': { flow: 'setup', page: 'configurations' },
    'setup-rbac-admin': { flow: 'setup', page: 'rbac-admin' },
    'project-create-request': { flow: 'customer-portal', page: 'project-create-request' },
    'equipment-requests': { flow: 'main', page: 'equipment-requests' },
    'equipment-schedule': { flow: 'main', page: 'equipment-schedule' },
    'main-equipment-master': { flow: 'equipment-foundation', page: 'equipment-master' },
    'main-equipment-workbench': { flow: 'equipment-foundation', page: 'equipment-workbench' },
    'initiate-picking': { flow: 'equipment-foundation', page: 'initiate-picking' },
    'equipment-returns': { flow: 'equipment-foundation', page: 'equipment-returns' },
    'rate-schedule': { flow: 'main', page: 'rate-schedule' },
    'main-equipment-timesheets': { flow: 'equipment-foundation', page: 'equipment-timesheets' },
    'main-timesheet-approvals': { flow: 'equipment-foundation', page: 'timesheet-approvals' },
    'post-cost-test': { flow: 'equipment-foundation', page: 'post-cost-test' },
    'main-rental-agreements': { flow: 'equipment-foundation', page: 'rental-agreements' },
    'create-rental-agreement': { flow: 'equipment-foundation', page: 'rental-agreement-create' },
    'rental-agreement-approval': { flow: 'equipment-foundation', page: 'rental-agreements' },
    'main-equipment-analytics': { flow: 'equipment-foundation', page: 'equipment-analytics' },
    'main-equipment-reports': { flow: 'equipment-foundation', page: 'equipment-reports' },
    'customer-dashboard': { flow: 'customer-portal', page: 'customer-dashboard' },
    'request-catalog': { flow: 'customer-portal', page: 'request-catalog' },
    'customer-create-req': { flow: 'customer-portal', page: 'customer-create-req' },
    'customer-my-requests': { flow: 'customer-portal', page: 'customer-my-requests' },
    'customer-my-billing': { flow: 'customer-portal', page: 'customer-my-billing' }
  };

  class AppModule {
    /**
     * Line-status display label.
     *
     * `lookups` is OPTIONAL. Pass $application.variables.commonLookups and the
     * shared COMMONRITE LINE_STATUS labels win; omit it and the hardcoded map
     * in lineStatusLabels.js is used. Every pre-existing call site omits it and
     * is unaffected.
     *
     * @param {string} code - raw status code (e.g. 'SCHEDULED_FOR_PICKING')
     * @param {Object} [lookups] - $application.variables.commonLookups
     * @returns {string}
     */
    formatLineStatus(code, lookups) {
      return lineStatusLabels.formatLineStatus(code, null, lookups);
    }

    /**
     * Canonical pill class for a status code — pairs with formatLineStatus.
     * RESERVED FOR THE REQUEST HEADER STATUS ONLY. Line-level and other
     * module statuses must use statusTextClass() instead.
     * @param {string} code - raw status code (e.g. 'QUOTE_ACCEPTED')
     * @returns {string} e.g. 'status-pill status-pill--quote-accepted'
     */
    statusPillClass(code) {
      return lineStatusLabels.statusPillClass(code);
    }

    /**
     * Plain-text class for every non-header status (request lines,
     * allocation, invoices, timesheets, rental agreements, rate schedules).
     * No pill, no per-status colour — label text only.
     * @returns {string} 'status-text'
     */
    statusTextClass() {
      return lineStatusLabels.statusTextClass();
    }

    /**
     * Resolve a shared-lookup code to its display label.
     *
     * DEGRADES GRACEFULLY — deliberately the opposite of isFeatureEnabled()'s
     * fail-closed contract. Lookups are display data, so a dead common-service
     * must cost prettier labels and never functionality. Resolution order:
     *   1. the cached MEANING for (type, code)
     *   2. the caller's `fallback`, when supplied — this is how a page keeps
     *      its own hardcoded label map working as a safety net
     *   3. the raw code with underscores stripped, so DB tokens never leak to
     *      the UI as 'FOO_BAR'
     *
     * The cache and latch are passed in because app-module functions cannot
     * read $application.variables — the same convention isFeatureEnabled uses.
     *
     * Bind as:
     *   [[ $application.functions.getLookupLabel(
     *        $application.variables.commonLookups,
     *        $application.variables.lookupsLoaded,
     *        'LINE_STATUS', $current.row.lineStatus) ]]
     *
     * @param {Object}  cache      - $application.variables.commonLookups
     * @param {boolean} loaded     - $application.variables.lookupsLoaded
     * @param {string}  type       - LOOKUP_TYPE, e.g. 'LINE_STATUS'
     * @param {string}  code       - LOOKUP_CODE to resolve
     * @param {string} [fallback]  - label to use when the cache has no answer
     * @returns {string} '' for a null/empty code — never 'undefined'
     */
    getLookupLabel(cache, loaded, type, code, fallback) {
      if (code === undefined || code === null || code === '') {
        return '';
      }
      if (loaded && cache && cache[type]) {
        const list = cache[type];
        for (let i = 0; i < list.length; i++) {
          if (list[i] && list[i].value === code) {
            return list[i].label;
          }
        }
      }
      if (fallback !== undefined && fallback !== null && fallback !== '') {
        return fallback;
      }
      return String(code).replace(/_/g, ' ').toUpperCase();
    }

    /**
     * All active {value,label} options for a lookup type, ready to wrap in an
     * ArrayDataProvider for oj-select-single / oj-combobox.
     *
     * Returns a NEW array every call — never the cached array itself — so a
     * component that sorts or splices its options in place cannot corrupt the
     * session cache for every other page.
     *
     * Returns [] when the cache is cold or the type is unseeded. Call sites
     * that must still offer choices should coalesce against their own list:
     *   options.length ? options : LOCAL_FALLBACK
     *
     * @param {Object}  cache  - $application.variables.commonLookups
     * @param {boolean} loaded - $application.variables.lookupsLoaded
     * @param {string}  type   - LOOKUP_TYPE
     * @returns {Array<{value:string,label:string}>}
     */
    getLookupOptions(cache, loaded, type) {
      if (!loaded || !cache || !cache[type] || !Array.isArray(cache[type])) {
        return [];
      }
      return cache[type].slice();
    }

    /**
     * Maps the currently-active page to its corresponding nav-list <li id>
     * so the drawer highlight stays in sync with the URL (regardless of how
     * the user got there: drawer click, tile click, chain redirect, deep-link,
     * browser back/forward).
     *
     * RETURNS null — NOT '' — FOR A PAGE WITH NO DRAWER ENTRY, and the
     * difference is not cosmetic.
     *
     * This feeds oj-navigation-list's `selection` in shell-page.html, which is
     * rendered on EVERY page. To JET, '' is a KEY TO GO AND FIND, not "nothing
     * selected": it searches the list's data for an item keyed '', gets back
     * undefined, then reads .key off it —
     *
     *   GetKey → undefined.key
     *   → "Fatal exception delivering binding updates:
     *      TypeError: Cannot read properties of undefined (reading 'key')"
     *
     * fired once per expanded nav group, every time $application.currentPage
     * changed. Because the nav list is in the shell, that made it an
     * application-wide console error rather than a page-specific one, and it
     * showed up on exactly the pages that are menu-less by design — detail and
     * drill-down pages (equipment-units, line-detail, request-detail) and the
     * Dashboard, which PAGE_ID_TO_NAV_ID deliberately omits.
     *
     * null is JET's "no selection", so it skips the lookup entirely and the
     * drawer simply shows nothing highlighted — which is the correct rendering
     * for a page that has no drawer entry.
     *
     * SAFE FOR THE OTHER CALLER: getPageCodeForPage() guards with `navId ?`,
     * which is falsy for both '' and null, so its menu-less fallback to
     * PAGE_ID_TO_PAGE_CODE is unchanged. Any FUTURE caller must test
     * truthiness, never `=== ''`.
     *
     * @param {Object} currentPage - $application.currentPage
     * @returns {string|null} nav-list id, or null when the page is not in the drawer
     */
    getNavIdForPage(currentPage) {
      if (!currentPage || !currentPage.id) {
        return null;
      }
      return PAGE_ID_TO_NAV_ID[currentPage.id] || null;
    }

    /**
     * Resolved access level for one RBAC page code.
     *
     * FAILS CLOSED: returns 'HIDDEN' while the map is still loading, if the
     * load failed, or if the page has no row for the user's role. Callers must
     * never treat "unknown" as permitted.
     *
     * App-module functions can't read $application.variables, so the caller
     * passes them in (same pattern as isFeatureEnabled), e.g.:
     *   [[ $application.functions.pageAccess(
     *        $application.variables.pageAccessMap,
     *        $application.variables.pageAccessLoaded, 'EQR_DASHBOARD') ]]
     *
     * @param {Object}  map    - $application.variables.pageAccessMap
     * @param {boolean} loaded - $application.variables.pageAccessLoaded
     * @param {string}  pageCode - RBAC_PAGES.PAGE_CODE
     * @returns {string} 'FULL' | 'READ_ONLY' | 'HIDDEN'
     */
    pageAccess(map, loaded, pageCode) {
      if (!loaded || !map || !pageCode) {
        return 'HIDDEN';
      }
      return map[pageCode] || 'HIDDEN';
    }

    /**
     * True when a page may appear in the nav / be opened at all
     * (FULL or READ_ONLY). Anything else — including unknown — is hidden.
     * @returns {boolean}
     */
    navVisible(map, loaded, pageCode) {
      const lvl = this.pageAccess(map, loaded, pageCode);
      return lvl === 'FULL' || lvl === 'READ_ONLY';
    }

    /**
     * True when the role can open at least one NON-customer page.
     *
     * Distinguishes an external requestor (customer pages only) from an
     * administrator who also holds them — used by getRoleHomeTarget to send
     * the former to the customer dashboard while everyone else shares the
     * project one. EQR_DASHBOARD is excluded from the internal set by
     * construction: it is not in NAV_GROUPS, and every role now holds it, so
     * counting it would make this true for everybody.
     *
     * @param {Object}  map    - $application.variables.pageAccessMap
     * @param {boolean} loaded - $application.variables.pageAccessLoaded
     * @returns {boolean}
     */
    hasInternalPageAccess(map, loaded) {
      const self = this;
      return INTERNAL_PAGE_CODES.some(function (code) {
        return self.navVisible(map, loaded, code);
      });
    }

    /**
     * True when the page is readable but must suppress its edit affordances.
     * Bind a page's primary Save/Create/Delete `disabled` (or an isReadOnly
     * page flag) to this. PAGE-WIDE switch — not per-field RBAC.
     * @returns {boolean}
     */
    isPageReadOnly(map, loaded, pageCode) {
      return this.pageAccess(map, loaded, pageCode) === 'READ_ONLY';
    }

    /**
     * Same gate as navVisible but keyed by the nav-list <li id> rather than the
     * RBAC page code. Used by the page-entry guard, which knows the nav id.
     * Unknown nav id -> false (fail-closed).
     * @returns {boolean}
     */
    navIdVisible(map, loaded, navId) {
      const code = NAV_ID_TO_PAGE_CODE[navId];
      return code ? this.navVisible(map, loaded, code) : false;
    }

    /**
     * THE derived nav data provider. Returns a filtered COPY of NAV_GROUPS
     * containing only items the current role may open, with any group whose
     * items all resolved to hidden dropped entirely (so no empty expandable
     * group is ever rendered).
     *
     * Derived, never mutated: NAV_GROUPS stays intact, so re-evaluating after a
     * role change recomputes from the full definition rather than compounding
     * on a previously filtered list.
     *
     * @param {Object}  map    - $application.variables.pageAccessMap
     * @param {boolean} loaded - $application.variables.pageAccessLoaded
     * @param {Object}  [buRateSources] - $application.variables.buRateSources,
     *                  for items marked hiddenByRateSource
     * @returns {Array} [{ key, label, items: [{id,label,icon,pageCode}] }]
     */
    visibleNavGroups(map, loaded, flags, flagsLoaded, buRateSources) {
      const self = this;
      const out = [];
      NAV_GROUPS.forEach(function (g) {
        // TWO independent gates, both must pass.
        //
        // 1. Feature flag — whether the MODULE is switched on at all
        //    (PROJECTS_MODULE_ENABLED etc). Nothing to do with who you are.
        // 2. RBAC — whether THIS ROLE may open the page.
        //
        // Kept separate because they answer different questions and are owned
        // by different people: flags by configuration, access by RBAC_ROLE_MAP.
        // Both fail closed, so a group is shown only when every flag it needs
        // is on AND at least one of its pages resolves visible.
        const flagsOk = (g.flags || []).every(function (f) {
          return self.isFeatureEnabled(flags, flagsLoaded, f);
        });
        if (!flagsOk) {
          return;
        }
        const items = g.items.filter(function (it) {
          // Per-item INVERSE flag gate. Unlike the group gate above, an item
          // carrying hiddenWhenFlags is hidden when the flag is ON — see
          // customer-my-billing in NAV_GROUPS for the one live case.
          //
          // Deliberately NOT fail-closed, which is why it cannot reuse
          // isFeatureEnabled() directly. That helper returns false while flags
          // load; negating it would make "still loading" mean "flag is off" and
          // flash the item in before hiding it. isFeatureFlagOff() distinguishes
          // not-loaded from loaded-and-false, so the item stays hidden until the
          // flags positively say it belongs — the safe direction for a screen
          // that is being withdrawn.
          const hiddenByFlag = (it.hiddenWhenFlags || []).some(function (f) {
            return !self.isFeatureFlagOff(flags, flagsLoaded, f);
          });
          if (hiddenByFlag) {
            return false;
          }
          if (it.hiddenByRateSource
              && self.isRateManagementHidden(flags, flagsLoaded, buRateSources)) {
            return false;
          }
          return self.navVisible(map, loaded, it.pageCode);
        });
        if (items.length) {
          out.push({ key: g.key, label: g.label, items: items });
        }
      });
      return out;
    }

    /**
     * Wraps one visible group's items in an ArrayDataProvider for
     * oj-navigation-list's `data` attribute. Keyed by `id`, which is both the
     * nav-list selection key and what navigateChain routes on.
     * @param {Array} items - the already-filtered items of a single group
     * @returns {Object} ArrayDataProvider
     */
    navItemsDP(items) {
      return new ArrayDataProvider(items || [], { keyAttributes: 'id' });
    }

    /**
     * Deep-link guard decision (page-level RBAC, defence in depth).
     *
     * Hiding a nav entry is not enough — a user can still reach a page by
     * typing or bookmarking its URL, which bypasses navigateChain entirely.
     * Each gated page calls this from its own vbBeforeEnter guard chain and
     * redirects when it returns false.
     *
     * Lives here, as an application FUNCTION, rather than as an application
     * action chain: a page's eventListeners resolve a bare chain id against
     * that page's OWN <page>-chains folder, so an app-level chain referenced
     * by name 404s. $application.functions, by contrast, is reachable from
     * every page (same mechanism as getNavIdForPage, already used app-wide).
     *
     * FAILS CLOSED, with one deliberate exception: while pageAccessLoaded is
     * false this returns TRUE (allow), because vbBeforeEnter can fire before
     * the app-level loader resolves and bouncing every user to the dashboard
     * on a cold load would be worse than briefly rendering. The nav stays
     * empty during that window and navigateChain still blocks, so the gap is
     * narrow and only on direct URL entry. The backend remains the real
     * boundary.
     *
     * "Not loaded" must mean STILL LOADING and nothing else. loadPageAccessChain
     * used to leave the latch false when the user had no role or the call
     * failed, and this exception then admitted that user to every page for the
     * whole session. The latch now settles in every outcome (an empty map when
     * nothing resolved), and the shell's recheckPageAccessChain re-runs this
     * decision on the cold-load page once it does.
     *
     * @param {Object}  map      - $application.variables.pageAccessMap
     * @param {boolean} loaded   - $application.variables.pageAccessLoaded
     * @param {string}  pageCode - the calling page's RBAC_PAGES.PAGE_CODE
     * @returns {boolean} true = render the page, false = redirect away
     */
    /**
     * The RBAC page code for whichever page is currently loading.
     *
     * Lets the per-page guard chains be BYTE-IDENTICAL: each one asks "what is
     * my page code?" at runtime instead of having it baked in at generation
     * time. Without this every guard differs by one string, so 23 files have to
     * be reviewed and maintained separately rather than diffed as one.
     *
     * currentPage.id -> nav id -> page code, reusing the maps that already
     * exist, so there is no third place for the mapping to drift.
     *
     * Menu-less pages fall back to PAGE_ID_TO_PAGE_CODE: the nav route derives
     * from NAV_GROUPS, so a page with no drawer entry has no nav id and would
     * otherwise resolve to '' — which the guards read as "not gated" and let
     * through. That is right for detail/child pages and wrong for the
     * Dashboard, which is menu-less but IS gated.
     *
     * @param {Object} currentPage - $application.currentPage
     * @returns {string} RBAC_PAGES.PAGE_CODE, or '' when the page is not gated
     */
    getPageCodeForPage(currentPage) {
      const navId = this.getNavIdForPage(currentPage);
      const viaNav = navId ? (NAV_ID_TO_PAGE_CODE[navId] || '') : '';
      if (viaNav) {
        return viaNav;
      }
      const pageId = (currentPage || {}).id;
      return (pageId && PAGE_ID_TO_PAGE_CODE[pageId]) || '';
    }

    /**
     * True when `page` lives in the SAME flow as the page currently showing.
     *
     * Decides which navigation action a redirect must use, which is not a
     * stylistic choice — the wrong one throws:
     *
     *   same flow      -> navigateToPage
     *   different flow -> navigateToFlow with target:'parent'
     *
     * navigateToFlow + 'parent' asks the PARENT router to switch flows. When
     * the destination flow is the one already displayed there is nothing for
     * it to switch, and VB throws "Cannot read properties of null (reading
     * 'getLeafPageInstanceFromFlowId')". Omitting 'parent' has the mirror
     * problem: VB resolves the flow id relative to the CURRENT flow and 404s
     * on a genuine cross-flow hop.
     *
     * The current flow is derived from the page id via NAV_ID_TO_ROUTE (plus
     * the menu-less pages in PAGE_ID_TO_FLOW) rather than read off
     * $application.currentPage: only `.id` is relied on anywhere else in this
     * app, and inventing a `.flow`/`.parent` accessor that happens to be
     * undefined would fail silently and re-introduce exactly this bug.
     *
     * Unknown page id -> false, so the caller takes the cross-flow path. That
     * is the safe default: a detail/child page is never a redirect TARGET, and
     * treating an unknown page as same-flow would throw.
     *
     * @param {Object} currentPage - $application.currentPage
     * @param {string} flow        - destination flow id
     * @returns {boolean}
     */
    isSameFlow(currentPage, flow) {
      const pageId = (currentPage || {}).id;
      if (!pageId || !flow) {
        return false;
      }
      const navId = PAGE_ID_TO_NAV_ID[pageId];
      const route = navId ? NAV_ID_TO_ROUTE[navId] : null;
      const currentFlow = (route && route.flow) || PAGE_ID_TO_FLOW[pageId] || '';
      return !!currentFlow && currentFlow === flow;
    }

    /**
     * Nav-list id → { flow, page }, so a caller holding only a nav id can
     * navigate without duplicating the route table.
     *
     * Exists because the Dashboard's KPI tiles and its table's View All button
     * are DATA-driven: each persona declares a nav id in dashboardRoleConfig,
     * and one generic chain routes it. The alternative was a per-destination
     * goto*Chain for every tile of every persona.
     *
     * Returns null for an unknown id, so the caller can no-op instead of
     * navigating somewhere arbitrary.
     *
     * @param {string} navId - nav-list <li id>
     * @returns {?{flow: string, page: string}}
     */
    getNavRoute(navId) {
      return (navId && NAV_ID_TO_ROUTE[navId]) || null;
    }

    canEnterPage(map, loaded, pageCode) {
      if (!pageCode) {
        console.warn('[canEnterPage] no pageCode supplied - not gating');
        return true;
      }
      if (!loaded) {
        return true; // map not resolved yet — see note above
      }
      const level = this.pageAccess(map, loaded, pageCode);
      const ok = (level === 'FULL' || level === 'READ_ONLY');
      if (!ok) {
        console.warn('[canEnterPage] blocked', pageCode, '- level', level);
      }
      return ok;
    }

    /**
     * Feature-flag gate (UX layer). Returns true only when flags are loaded AND
     * the named flag is the string 'true'. FAILS CLOSED: while flags are still
     * loading (or failed to load) this returns false, so gated UI stays disabled
     * rather than briefly exposing a feature that may be off.
     *
     * App-module functions can't read $application.variables directly, so callers
     * pass them in (same pattern as getNavIdForPage), e.g.:
     *   disabled="[[ !$application.functions.isFeatureEnabled(
     *       $application.variables.featureFlags,
     *       $application.variables.flagsLoaded, 'AGREEMENTS_ENABLED') ]]"
     *
     * @param {Object}  flags  - $application.variables.featureFlags map
     * @param {boolean} loaded - $application.variables.flagsLoaded
     * @param {string}  key    - the SETTING_KEY to check
     * @returns {boolean}
     */
    isFeatureEnabled(flags, loaded, key) {
      if (!loaded || !flags || !key) {
        return false;
      }
      return flags[key] === 'true';
    }

    /**
     * Positively "this flag is loaded AND is not on" — for UI that must be
     * WITHDRAWN when a flag is on, rather than enabled when it is on.
     *
     * NOT !isFeatureEnabled(). That helper fails closed by returning false while
     * flags are still loading, so its negation reports true for "not loaded
     * yet" — which for an inverse gate means the thing being withdrawn appears
     * during the load and then vanishes. This requires `loaded` before
     * answering true, so both accessors fail in the SAME safe direction: the
     * gated affordance is absent until the flags positively justify showing it.
     *
     * Used by visibleNavGroups' hiddenWhenFlags and by the billing pages'
     * externalProjectAssignGuardChain, so nav and guard agree by construction.
     *
     * @param {Object}  flags  - $application.variables.featureFlags map
     * @param {boolean} loaded - $application.variables.flagsLoaded
     * @param {string}  key    - the SETTING_KEY to check
     * @returns {boolean} true only when flags are loaded and the flag is not 'true'
     */
    isFeatureFlagOff(flags, loaded, key) {
      if (!loaded || !flags || !key) {
        return false;
      }
      return flags[key] !== 'true';
    }

    /**
     * Rate source — THE single owner of "does this BU take its rates from Fusion
     * PPM?". Hierarchical:
     *
     *   PPM_RATES_ENABLED (global feature flag) ON → every BU is PPM.
     *   OFF → each BU's own EQR_CONF_EQUIPMENT_SETTING.RATE_SOURCE decides
     *         (PPM_RATES | EQUIPRITE_RATES).
     *
     * RATE_SOURCE is a required choice in BU Settings. A BU with no row, or a
     * row saved before it was enforced, is read as EQUIPRITE_RATES — the
     * behaviour before the setting meant anything.
     *
     * @param {Object}  flags         - $application.variables.featureFlags
     * @param {boolean} flagsLoaded   - $application.variables.flagsLoaded
     * @param {Object}  buRateSources - $application.variables.buRateSources
     * @param {*}       buId          - Fusion business unit id
     * @returns {boolean}
     */
    usesPpmRates(flags, flagsLoaded, buRateSources, buId) {
      if (this.isFeatureEnabled(flags, flagsLoaded, 'PPM_RATES_ENABLED')) {
        return true;
      }
      return buId != null && (buRateSources || {})[String(buId)] === 'PPM_RATES';
    }

    /**
     * Rate Management is EquipRite's rate-schedule screen, so it is withdrawn
     * when no BU prices from EquipRite: the global flag is on, or every
     * configured BU has RATE_SOURCE = PPM_RATES. One EquipRite BU keeps it.
     *
     * Hidden until flags load (same safe direction as isFeatureFlagOff). An
     * empty BU map — none configured, or the load failed — keeps it visible,
     * which is the behaviour before rate source was honoured.
     *
     * Shared by visibleNavGroups and the Rate Management guard chains, so the
     * menu entry and the deep-link guard cannot disagree.
     */
    isRateManagementHidden(flags, flagsLoaded, buRateSources) {
      if (!flagsLoaded) {
        return true;
      }
      if (this.isFeatureEnabled(flags, flagsLoaded, 'PPM_RATES_ENABLED')) {
        return true;
      }
      const buIds = Object.keys(buRateSources || {});
      return buIds.length > 0 && buIds.every(function (id) {
        return buRateSources[id] === 'PPM_RATES';
      });
    }

    /**
     * What a requester sees in place of a price when Fusion PPM prices rentals:
     * the text when the GLOBAL PPM_RATES_ENABLED flag is on, else ''. The
     * catalog, catalog detail and cart show it instead of an EquipRite list
     * rate, which would not be what Fusion bills. Global only for now — per-BU
     * Rate Source is not applied to requester pricing yet.
     *
     * '' while flags load, so prices stay visible (the pre-existing behaviour).
     */
    ppmRateText(flags, flagsLoaded) {
      return this.isFeatureEnabled(flags, flagsLoaded, 'PPM_RATES_ENABLED')
        ? 'Fusion PPM'
        : '';
    }

    /**
     * conf-equipment-settings rows → { buId: 'PPM_RATES' | 'EQUIPRITE_RATES' }.
     * Rows without a BU or marked inactive are skipped; anything but PPM_RATES
     * reads as EQUIPRITE_RATES (see usesPpmRates).
     *
     * @param {Array} rows - body.data of eqp-v1/getConfEquipmentSettings
     * @returns {Object}
     */
    buRateSourceMap(rows) {
      const out = {};
      (rows || []).forEach(function (r) {
        if (!r || r.businessUnitId == null || r.isActiveFlag === 'N') return;
        out[String(r.businessUnitId)] =
          String(r.rateSource || '').toUpperCase() === 'PPM_RATES' ? 'PPM_RATES' : 'EQUIPRITE_RATES';
      });
      return out;
    }

    /**
     * Request-origin gate — THE single owner of "is this an external request?".
     *
     * The origin vocabulary CHANGED: requests used to be 'PROJECT' | 'CUSTOMER'
     * and are now 'INTERNAL' | 'EXTERNAL' (EQR_EQUIPMENT_REQUEST.REQUEST_TYPE).
     * That rename silently broke every `source === 'CUSTOMER'` test in the app —
     * they didn't error, they just quietly evaluated false, so customer-only
     * affordances stopped appearing. Centralising the test here means the next
     * vocabulary change touches ONE function instead of a dozen call sites.
     *
     * Callers must use this and never re-derive the rule inline.
     *
     * The legacy 'CUSTOMER' spelling is still accepted so a backend that has not
     * yet been migrated (or historical rows) keeps working — the two vocabularies
     * can coexist safely because no value means "customer" in one and
     * "not customer" in the other.
     *
     * Anything not recognised as external is treated as INTERNAL, which matches
     * the old behaviour where anything not 'CUSTOMER' fell through to project.
     *
     * @param {string} source - the request's origin ('EXTERNAL' | 'INTERNAL' | legacy 'CUSTOMER' | 'PROJECT')
     * @returns {boolean} true when the request is customer/externally sourced
     */
    isExternalSource(source) {
      const s = String(source || '').toUpperCase();
      return s === 'EXTERNAL' || s === 'CUSTOMER';
    }

    /**
     * Display label for a request origin. Renders the CURRENT vocabulary
     * regardless of which spelling the backend sent, so a page showing a legacy
     * 'CUSTOMER' row and a migrated 'EXTERNAL' row doesn't display two different
     * words for the same thing. Empty in, empty out — a blank origin renders
     * nothing rather than a misleading default.
     *
     * @param {string} source - the request's origin
     * @returns {string} 'EXTERNAL' | 'INTERNAL' | ''
     */
    sourceLabel(source) {
      if (source === null || source === undefined || String(source).trim() === '') {
        return '';
      }
      return this.isExternalSource(source) ? 'EXTERNAL' : 'INTERNAL';
    }

    /**
     * Quote gate (UX layer) — THE single owner of the ENABLE_QUOTES matrix.
     * Consumers must call this and never re-derive the rule, so changing the
     * policy touches exactly one function (same discipline as the
     * CONSUMABLE_RETURNS_ENABLED resolver note).
     *
     *   NONE     → quoting off everywhere
     *   PROJECTS → internal project-sourced requests only
     *   CUSTOMER → external customer-sourced requests only (legacy behaviour)
     *   BOTH     → both flows
     *
     * FAILS CLOSED: returns false while settings are still loading or failed to
     * load, so the quote affordance stays hidden rather than briefly appearing
     * for a flow that may be switched off. NOTE this means an environment where
     * the ENABLE_QUOTES row was never seeded hides the quote button for
     * customers too — the row must exist (default 'CUSTOMER') to preserve
     * today's behaviour.
     *
     * Gates GENERATION and ACCEPTANCE only — an already-generated quote stays
     * viewable even if the setting later excludes its flow, so callers should
     * apply this to the Generate/Accept paths, not to the read path.
     *
     * App-module functions can't read $application.variables directly, so
     * callers pass them in, e.g.:
     *   [[ $application.functions.isQuotingAllowed(
     *        $application.variables.globalSettings,
     *        $application.variables.flagsLoaded, $page.variables.formData.source) ]]
     *
     * @param {Object}  settings - $application.variables.globalSettings map
     * @param {boolean} loaded   - $application.variables.flagsLoaded
     * @param {string}  source   - the request's origin ('CUSTOMER' | 'PROJECT'/…)
     * @returns {boolean}
     */
    isQuotingAllowed(settings, loaded, source) {
      if (!loaded || !settings) {
        return false;
      }
      const mode = String(settings.ENABLE_QUOTES || '').toUpperCase();
      if (mode === 'BOTH') return true;
      // NOTE two different vocabularies meet here, and they are NOT the same:
      //   • `mode` is the ENABLE_QUOTES SETTING value — NONE | PROJECTS |
      //     CUSTOMER | BOTH. Unchanged; it names the policy, not the request.
      //   • `source` is the REQUEST ORIGIN — 'EXTERNAL' | 'INTERNAL' (formerly
      //     'CUSTOMER' | 'PROJECT').
      // Only the second one was renamed. Resolving it through isExternalSource
      // is what keeps the setting working after the switch: the old inline
      // `=== 'CUSTOMER'` test silently returned false for every EXTERNAL
      // request, which hid the quote button on exactly the requests
      // ENABLE_QUOTES=CUSTOMER is meant to enable.
      // Anything not external is treated as internal/project-sourced.
      const isCustomer = this.isExternalSource(source);
      if (mode === 'CUSTOMER') return isCustomer;
      if (mode === 'PROJECTS') return !isCustomer;
      // 'NONE', empty, or an unrecognised value → closed.
      return false;
    }

    /**
     * Home/landing resolver — THE single owner of "where does Dashboard go".
     * Consumers must call this and never re-derive the rule, so a future module
     * (or a third landing page) touches exactly one function.
     *
     * Projects on               → main / main-equiprite      (project dashboard)
     * Projects off, Customers on → customer-portal / customer-dashboard
     *
     * INVARIANT: at most ONE of PROJECTS_MODULE_ENABLED / CUSTOMERS_MODULE_ENABLED
     * may be off at a time — each owns one of the two landing pages, so both-off
     * leaves no reachable home. The Configuration Settings tab enforces this at
     * the source (it refuses to switch off the last enabled module).
     *
     * WHILE FLAGS LOAD both checks return false, which would fall through to the
     * both-off branch. That is a transient state, not a misconfiguration, so it
     * resolves to the project dashboard rather than the setup page — the project
     * dashboard is the historical default and its own guard re-runs once the
     * flags land. Distinguishing 'still loading' from 'genuinely both off' is why
     * `loaded` is tested explicitly rather than relying on isFeatureEnabled alone.
     *
     * BOTH GENUINELY OFF (invariant violated, e.g. hand-edited DB rows) falls back
     * to Configuration Settings so an admin can repair it, rather than bouncing
     * between two disabled dashboards.
     *
     * @param {Object}  flags  - $application.variables.featureFlags map
     * @param {boolean} loaded - $application.variables.flagsLoaded
     * @returns {{flow: string, page: string}}
     */
    getHomeTarget(flags, loaded) {
      if (this.isFeatureEnabled(flags, loaded, 'PROJECTS_MODULE_ENABLED')) {
        return { flow: 'main', page: 'main-equiprite' };
      }
      if (this.isFeatureEnabled(flags, loaded, 'CUSTOMERS_MODULE_ENABLED')) {
        return { flow: 'customer-portal', page: 'customer-dashboard' };
      }
      // Flags not in yet — transient, not a misconfiguration.
      if (!loaded) {
        return { flow: 'main', page: 'main-equiprite' };
      }
      // Invariant violated: nothing licensed. Land somewhere an admin can fix it.
      return { flow: 'setup', page: 'configurations' };
    }

    /**
     * Role-aware landing page — wraps getHomeTarget with an RBAC layer.
     *
     * WHY THIS EXISTS: the flag-based home above resolves to the Dashboard,
     * but only EQUIP_ADMIN has access to it. Every other role would land on a
     * page its own vbBeforeEnter guard immediately redirects away from — and
     * the redirect target IS the dashboard, so it bounces. A role with no
     * dashboard access previously got a loop or a blank page on login.
     *
     * Resolution order:
     *   1. The flag-based home, if the role can actually open it.
     *   2. An explicit preference for a page this role can open (below).
     *   3. The first page the role CAN see, by menu order — data-driven, so a
     *      newly seeded role lands somewhere sensible with no code change.
     *   4. The No Access page, when the role can open nothing at all.
     *
     * Steps 1-3 all verify access before returning, so this can never hand back
     * a page the guard will bounce. Step 4 is ungated, so it cannot bounce
     * either.
     *
     * ORDER NOTE: the home target is tried FIRST. It used to run after the
     * PREFERRED list, which meant an admin or a workbench holder was diverted
     * to Configuration Settings / Workbench and never saw the Dashboard at all
     * — the same divergence would defeat main-flow.json's defaultPage, since
     * this function (not the router) decides where a guard redirect and the
     * header logo land. The Dashboard is now the shared landing page for every
     * role that can open it, per the Fusion/Fiori one-home-page model, and
     * PREFERRED covers only the roles it does not serve.
     *
     * @param {Object}  flags  - $application.variables.featureFlags
     * @param {boolean} loaded - $application.variables.flagsLoaded
     * @param {Object}  map    - $application.variables.pageAccessMap
     * @param {boolean} rbacLoaded - $application.variables.pageAccessLoaded
     * @returns {{flow: string, page: string}}
     */
    /**
     * Resolves the signed-in user's DASHBOARD PERSONA from their Fusion job
     * roles — the single switch the Dashboard uses to pick its KPI set and its
     * table.
     *
     * WHY A SEPARATE MAP FROM RBAC. pageAccessMap answers "may this role OPEN
     * page X". That is a different question from "which of several dashboards
     * should this role SEE", and every role here holds EQR_DASHBOARD, so the
     * access map cannot discriminate between them. Keying off job roles is what
     * makes the personas distinguishable.
     *
     * ORACLE ROLE, NOT SESSION ROLE. $application.variables.fusionRoles carries
     * ORACLE_ROLE_NAME values (RT_EQP_MANAGER), because that is what the
     * ROLES_RP BIP report returns — NOT the SESSION_ROLE codes (EQUIP_MGR) that
     * COMMONRITE.RBAC_ROLE_MAP translates them into. The mapping below is that
     * translation, mirrored client-side; the session-role code is what the rest
     * of the dashboard switches on.
     *
     * PRIORITY ORDER IS THE DB'S, NOT INVENTED. A user can legitimately hold
     * several job roles, so the winner must be deterministic. RBAC_ROLE_MAP has
     * a PRIORITY column for exactly this, and the numbers below are copied from
     * it (lower wins): EQUIP_MGR 40, REQUESTOR 50, INSPECTION 60, TIMEKEEPER 70,
     * TIME_APPROVER 80, FINANCE_USER 100. Keeping the same ordering means the
     * dashboard agrees with whatever the backend resolves the session role to,
     * instead of the two silently disagreeing for a multi-role user.
     *
     * FAILS SOFT, NOT CLOSED — deliberately, and unlike the RBAC gates. This
     * picks a LAYOUT, not a permission: every endpoint behind it is still
     * independently authorised, so an unresolved role showing the default
     * requestor view leaks nothing. Returning '' here instead would render a
     * dashboard with no KPIs and no table for any role we failed to recognise.
     *
     * @param {string[]} fusionRoles - $application.variables.fusionRoles
     * @returns {string} session-role code, or DEFAULT_DASH_ROLE when unresolved
     */
    /**
     * May this user choose the request's Customer Type, or is it fixed to
     * INTERNAL? Managers (and admins) pick; a plain equipment requestor cannot
     * raise an external request, so the Customer Type LOV is frozen to Internal
     * for them.
     *
     * DELIBERATELY NOT resolveDashboardRole(). That function picks a LAYOUT and
     * fails SOFT — and with its DEFAULT_DASH_ROLE fallback currently disabled
     * for testing it returns '' for an unresolved role. Gating on it would mean
     * "role didn't resolve" renders the same as "manager", handing the External
     * option to anyone whose roles failed to load.
     *
     * This asks the narrower question and FAILS CLOSED: the answer is false
     * unless a manager-tier role is positively present. An unresolved role, a
     * BIP fetch that hasn't landed, or a login with no RT_EQP_* grant all get
     * the frozen-to-Internal treatment, which is the safe direction — the worst
     * case is a manager who must wait for roles to load, not a requestor who
     * can post an external request.
     *
     * ADMIN COUNTS. RT_EQP_ADMINISTRATOR outranks every operational role
     * (priority 30) and is the highest-trust grant in the map, so it would be
     * odd for it to have fewer options than a manager. Note this differs from
     * the dashboard, where admin deliberately gets the REQUESTOR layout — that
     * is a layout choice, this is a capability.
     *
     * UX layer only: SubmitRequestChain posts requestType, and the backend must
     * do its own check. Freezing a picker does not stop a crafted payload.
     *
     * @param {string[]} fusionRoles - $application.variables.fusionRoles
     * @returns {boolean} true when the user may select a Customer Type
     */
    /**
     * Display name for the shell header's role chip, e.g. 'Equipment Manager'.
     *
     * Resolves through resolveDashboardRole so the chip names the SAME persona
     * the dashboard rendered — showing one role in the header while the page
     * below is built for another would be worse than showing nothing.
     *
     * Returns '' when no role resolves (fusionRoles not yet loaded, or a login
     * with no RT_EQP_* grant). The header hides the chip on '' rather than
     * captioning the user as something they may not be; resolveDashboardRole
     * currently has its DEFAULT_DASH_ROLE fallback disabled for testing, so ''
     * is a live case, not a theoretical one.
     *
     * @param {string[]} fusionRoles  - $application.variables.fusionRoles
     * @param {string[]} [sessionRoles] - $application.variables.sessionRoles;
     *   pass it, or the chip can name a different persona than the dashboard
     * @returns {string} human-readable role name, or '' when unresolved
     */
    dashboardRoleLabel(fusionRoles, sessionRoles) {
      // resolveDashboardRoleFrom(), not this.resolveDashboardRole(): a template
      // binding can invoke this detached from the module instance, and `this`
      // would then be undefined. The class method delegates to the same
      // module-scope helper, so both callers share one implementation and
      // neither depends on how it was invoked.
      const code = resolveDashboardRoleFrom(fusionRoles, sessionRoles);
      return code ? (DASH_ROLE_LABELS[code] || code) : '';
    }

    /**
     * Best available display name for the signed-in user.
     *
     * Same candidate walk as loadFusionRolesChain's fusionUsername: providers
     * populate different identity fields and VBCS versions differ, so `login`
     * and `userName` alone are not enough — both come back empty in this
     * environment while VB still logs "User <name> is authenticated".
     *
     * Presentation only. Nothing is authorised off this.
     *
     * @param {Object} user - $application.user
     * @returns {string} display name, or '' if none of the fields carry one
     */
    userDisplayName(user) {
      const CANDIDATES = [
        'fullName', 'displayName', 'name', 'login', 'userName', 'username',
        'preferred_username', 'email', 'userId'
      ];
      if (!user) { return ''; }
      for (let i = 0; i < CANDIDATES.length; i++) {
        const v = user[CANDIDATES[i]];
        if (v && typeof v === 'string' && v.trim()) { return v.trim(); }
      }
      return '';
    }

    /**
     * Initials for the header's oj-avatar, e.g. 'RP' for "Rahul Pangan".
     *
     * oj-avatar renders a generic person silhouette when `initials` is empty, so
     * returning '' is a valid, deliberate outcome rather than a failure — a user
     * whose identity fields carry nothing usable still gets a sensible avatar.
     *
     * Handles the shapes these identity fields actually arrive in:
     *   "Rahul Pangan"            → RP   (two words)
     *   "rahul.pangan@rite..."    → RP   (email local part, dot-separated)
     *   "rahul.pangan"            → RP
     *   "jdunbar"                 → J    (single token — first letter only)
     * Splitting on space, dot, underscore and hyphen covers all of them without
     * needing to know which field the value came from.
     *
     * @param {Object} user - $application.user
     * @returns {string} 1–2 uppercase letters, or '' when none can be derived
     */
    userInitials(user) {
      const name = this.userDisplayName(user);
      if (!name) { return ''; }

      // Drop the domain before splitting: 'rahul@rite.digital' must not yield
      // 'RR' by picking up the 'rite' from the host.
      const local = name.split('@')[0];

      const parts = local.split(/[\s._-]+/).filter(function (p) {
        // Letters only: a token like '2' or '' contributes nothing readable.
        return p && /[a-z]/i.test(p);
      });

      if (!parts.length) { return ''; }
      if (parts.length === 1) { return parts[0].charAt(0).toUpperCase(); }
      return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    }

    canChooseCustomerType(fusionRoles, sessionRoles) {
      // Server list first (any customer's role names), then the hard-coded
      // RT_EQP_* codes as the fallback. Either way true needs a manager-tier
      // role POSITIVELY present, so this still fails closed. Bindings must pass
      // sessionRoles as an argument, not have it read here, or they will not
      // re-evaluate when it lands.
      if (normalizeRoleCodes(sessionRoles).some(function (c) {
        return MANAGER_TIER_SESSION_ROLES[c] === 1;
      })) {
        return true;
      }
      return normalizeRoleCodes(fusionRoles).some(function (code) {
        return code === 'RT_EQP_MANAGER' || code === 'RT_EQP_ADMINISTRATOR';
      });
    }

    /**
     * Which Customer Types this tenant is LICENSED for.
     *
     * The two module flags each own one request type, so licensing — not role —
     * decides which types legally exist here:
     *
     *   PROJECTS_MODULE_ENABLED  → INTERNAL
     *   CUSTOMERS_MODULE_ENABLED → EXTERNAL
     *
     * These are PROVISIONING-TIME product flags, fixed per tenant at
     * implementation, so for any given tenant this answer is effectively static.
     *
     * Distinct from canChooseCustomerType(), which answers "may THIS USER pick".
     * The two gates are deliberately independent: role and licence say no for
     * different reasons, and collapsing them into one boolean loses which one
     * fired. The field is frozen when EITHER says no.
     *
     * FAILS CLOSED to ['INTERNAL'] while flags load. isFeatureEnabled() already
     * returns false until flagsLoaded, so an empty result is the natural
     * outcome — but an empty list would render a Customer Type field with no
     * legal value at all. INTERNAL is the same default SeedCustomerTypeChain has
     * always applied, so the load window behaves exactly as it did before.
     *
     * @param {Object}  flags  - $application.variables.featureFlags
     * @param {boolean} loaded - $application.variables.flagsLoaded
     * @returns {string[]} some non-empty subset of ['INTERNAL', 'EXTERNAL']
     */
    licensedCustomerTypes(flags, loaded) {
      const types = [];
      if (this.isFeatureEnabled(flags, loaded, 'PROJECTS_MODULE_ENABLED')) {
        types.push('INTERNAL');
      }
      if (this.isFeatureEnabled(flags, loaded, 'CUSTOMERS_MODULE_ENABLED')) {
        types.push('EXTERNAL');
      }
      // Not loaded yet (or, impossibly, both modules off) — see FAILS CLOSED above.
      return types.length ? types : ['INTERNAL'];
    }

    /**
     * The Customer Type this tenant's licence FORCES, or '' when it forces none.
     *
     * THE single owner of "is Customer Type a choice or a fact here". The page
     * markup, the seed chain and the readonly label all read this one value, so
     * what is displayed, what is seeded and what is posted cannot disagree.
     *
     *   Projects only  → 'INTERNAL'   (field is readonly)
     *   Customers only → 'EXTERNAL'   (field is readonly)
     *   both licensed  → ''           (field is a picker, subject to role)
     *
     * updateSettingChain's last-module-standing guard makes "neither licensed"
     * unreachable, so the three states above are exhaustive.
     *
     * @param {Object}  flags  - $application.variables.featureFlags
     * @param {boolean} loaded - $application.variables.flagsLoaded
     * @returns {string} 'INTERNAL' | 'EXTERNAL' | ''
     */
    forcedCustomerType(flags, loaded) {
      const types = this.licensedCustomerTypes(flags, loaded);
      return types.length === 1 ? types[0] : '';
    }

    /**
     * Display label for a Customer Type code.
     *
     * Exists so the readonly field and the picker's LOV read the same strings.
     * The readonly oj-input-text binds through here rather than hardcoding a
     * label: it used to say "Internal" literally, which on a Customers-only
     * tenant would have displayed "Internal" while posting EXTERNAL.
     *
     * Unknown/empty returns '' — the field renders blank rather than inventing a
     * type, which is the honest outcome while the value is still being seeded.
     *
     * @param {string} type - 'INTERNAL' | 'EXTERNAL' | '' | undefined
     * @returns {string} 'Internal' | 'External' | ''
     */
    customerTypeLabel(type) {
      const code = String(type || '').trim().toUpperCase();
      if (code === 'INTERNAL') { return 'Internal'; }
      if (code === 'EXTERNAL') { return 'External'; }
      return '';
    }

    /**
     * Default `filter` for GET /views/my-requests on the Equipment Requests
     * page — THE single owner of "which request origins does this role see".
     *
     *   manager / administrator → 'ALL'      (both origins: 391 rows on dev)
     *   everyone else           → 'Internal' (project-sourced only: 326)
     *
     * ORIGIN IS THE ONLY SCOPING. The endpoint filters by requestOrigin, NOT by
     * who raised the request — there is no requestorId parameter — so an
     * internal requestor sees every INTERNAL request, not just their own. That
     * is the agreed behaviour, not an oversight; do not read 'my-requests' as
     * per-user.
     *
     * FAILS TO 'Internal', deliberately. fusionRoles arrives from a BIP report
     * in parallel with page entry, so it is empty for the first moments of a
     * load. Defaulting to ALL during that window would flash the full
     * cross-origin list — including 65 external requests — to a requestor who
     * may not be entitled to it. Narrow-then-widen is the safe direction: the
     * binding re-evaluates when the roles land.
     *
     * Reuses the manager-tier test that canChooseCustomerType already applies,
     * so "who counts as a manager" is answered the same way in both places.
     *
     * @param {string[]} fusionRoles - $application.variables.fusionRoles
     * @returns {string} 'ALL' | 'Internal'
     */
    myRequestsOriginFilter(fusionRoles, sessionRoles) {
      return this.canChooseCustomerType(fusionRoles, sessionRoles) ? 'ALL' : 'Internal';
    }

    resolveDashboardRole(fusionRoles, sessionRoles) {
      // Implementation lives at module scope (resolveDashboardRoleFrom) so it is
      // callable without `this`. See the note there.
      return resolveDashboardRoleFrom(fusionRoles, sessionRoles);
    }

    getRoleHomeTarget(flags, loaded, map, rbacLoaded) {
      // Until the access map lands there is nothing to personalise against;
      // the flag-based home is the historical default and the page's own guard
      // re-runs once the map arrives.
      if (!rbacLoaded || !map) {
        return this.getHomeTarget(flags, loaded);
      }

      const self = this;
      const canOpen = function (code) {
        return self.navVisible(map, rbacLoaded, code);
      };

      // 0. Customer-only roles land on the CUSTOMER dashboard, not the shared
      //    one. External requestors have their own purpose-built dashboard
      //    (its tiles point at the customer pages they actually hold), so the
      //    project dashboard would be a downgrade — every one of its tiles
      //    targets an internal page they cannot open.
      //
      //    The test is "holds customer pages and NO internal ones", not simply
      //    "can open EQR_CUST_DASHBOARD": the three admin roles hold that code
      //    too (alongside 14-18 internal pages), and keying off it alone would
      //    divert them here as well. Being customer-ONLY is what identifies an
      //    external requestor, and it stays true for any future role seeded the
      //    same way without needing a role-code list here.
      if (canOpen('EQR_CUST_DASHBOARD') && !this.hasInternalPageAccess(map, rbacLoaded)) {
        return { flow: 'customer-portal', page: 'customer-dashboard' };
      }

      // 1. The flag-based home, but only if this role may actually open it.
      //    This is the universal landing page: the project Dashboard with the
      //    Projects module on, the customer Dashboard with it off. Roles
      //    without the matching grant fall through to the preferences below.
      const home = this.getHomeTarget(flags, loaded);
      const HOME_CODES = {
        'main-equiprite': 'EQR_DASHBOARD',
        'customer-dashboard': 'EQR_CUST_DASHBOARD',
        'configurations': 'EQR_CONFIGURATIONS'
      };
      const homeCode = HOME_CODES[home.page];
      if (homeCode && canOpen(homeCode)) {
        return home;
      }

      // 2. Explicit preferences, highest-privilege first, for roles the shared
      //    home does not serve. A user holding several roles resolves to the
      //    first one they qualify for.
      const PREFERRED = [
        { code: 'EQR_RBAC_ADMIN', flow: 'setup', page: 'configurations',
          via: 'EQR_CONFIGURATIONS' },
        { code: 'EQR_WORKBENCH', flow: 'equipment-foundation',
          page: 'equipment-workbench' }
      ];
      for (let i = 0; i < PREFERRED.length; i++) {
        const p = PREFERRED[i];
        // `via` lets a preference key off one page (the role marker) while
        // landing on another: admins are identified by Page Access rights but
        // land on Configuration Settings.
        if (canOpen(p.code) && canOpen(p.via || p.code)) {
          return { flow: p.flow, page: p.page };
        }
      }

      // 3. First visible page in menu order. Derived from NAV_GROUPS so it
      //    honours both the feature-flag and RBAC gates already applied there.
      const groups = this.visibleNavGroups(map, rbacLoaded, flags, loaded);
      for (let g = 0; g < groups.length; g++) {
        const items = groups[g].items || [];
        if (items.length) {
          const route = NAV_ID_TO_ROUTE[items[0].id];
          if (route) {
            return { flow: route.flow, page: route.page };
          }
        }
      }

      // 4. The role can open nothing — no role, an unmapped role, or a failed
      //    lookup. It used to land on Configuration Settings, whose guard then
      //    found itself as the redirect target and rendered the page rather
      //    than loop: a user with no role ended up on the admin settings
      //    screen. No Access is ungated and says why.
      return { flow: 'main', page: NO_ACCESS_PAGE_ID };
    }

    getFormattedDate() {
      const now = new Date();
      const day = now.getUTCDay(); // 0 is Sunday, 1 is Monday...

      // Calculate Monday of current ISO week using UTC
      const diffToMonday = (day === 0 ? -6 : 1 - day);
      const monday = new Date(now);
      monday.setUTCDate(now.getUTCDate() + diffToMonday);

      // Calculate Sunday of current ISO week using UTC
      const sunday = new Date(monday);
      sunday.setUTCDate(monday.getUTCDate() + 6);

      const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const fromStr = `${monthNames[monday.getUTCMonth()]} ${monday.getUTCDate()}, ${monday.getUTCFullYear()}`;
      const toStr   = `${monthNames[sunday.getUTCMonth()]} ${sunday.getUTCDate()}, ${sunday.getUTCFullYear()}`;

      return `${fromStr} – ${toStr}`;
    }
  }

  return AppModule;
});
