define([], () => {
  'use strict';

  /**
   * Dashboard persona definitions — the single source of truth for WHAT each
   * role sees on main-equiprite: which endpoint feeds its table, which columns
   * that table renders, and which KPI tiles sit above it.
   *
   * WHY THIS IS DATA AND NOT CODE. The six personas differ only in their inputs
   * (endpoint + params), their aggregation (which rows count toward which tile)
   * and their presentation (columns, labels). Expressing that as a table keeps
   * dashboardInitChain a single generic fetch-map-count loop rather than a
   * six-branch if/else, so adding a seventh persona is an entry here and no
   * change to the chain, the page HTML, or the navigation.
   *
   * The role codes are SESSION_ROLE values from COMMONRITE.RBAC_ROLE_MAP,
   * resolved by $application.functions.resolveDashboardRole(). See app-flow.js
   * for why the Oracle→session translation happens client-side.
   *
   * ── KPI CONTRACT ──────────────────────────────────────────────────────────
   * Each kpi entry is { key, label, hint, icon, accent, nav }, where `key`
   * matches a field the chain's counter produces. `nav` is the nav-list id to
   * route to on click, or null for a non-clickable tile. Tiles are rendered in
   * array order.
   *
   * ── TABLE CONTRACT ────────────────────────────────────────────────────────
   * `table.endpoint` + `table.uriParams` are passed straight to callRest.
   * uriParams names MUST match the OpenAPI spec exactly — an undeclared name is
   * silently DROPPED by callRest, which would quietly return an unfiltered list
   * rather than erroring. Every param below is verified present in
   * services/eqp-v1/openapi3.json.
   */

  // Status vocabularies. Named rather than inlined so a backend rename is one
  // edit here instead of a hunt through the counters.
  const S = {
    SUBMITTED:        'SUBMITTED',
    IN_PROCESS:       'IN_PROCESS',
    ALLOCATED:        'ALLOCATED',
    DEPLOYED:         'DEPLOYED',
    PICK_INITIATED:   'PICK_INITIATED',
    SHIPPED_TO_YARD:  'SHIPPED_TO_YARD',
    CLOSED:           'CLOSED',
    DRAFT:            'DRAFT',
    APPROVED:         'APPROVED',
    REJECTED:         'REJECTED',
    POSTED:           'POSTED'
  };

  // Shared column sets — several personas render the same request grid, so the
  // definition lives once. Column `field` names are the MAPPED shape the chain
  // produces, not the raw payload field names.
  const REQUEST_COLUMNS = [
    { headerText: 'Request #',      field: 'requestNumber', template: 'dashReqNumTpl', sortable: 'enabled', style: 'width:150px;' },
    { headerText: 'Project / Task', field: 'project',       template: 'dashProjectTpl', sortable: 'enabled' },
    { headerText: 'Requestor',      field: 'requestor',                                 sortable: 'enabled', style: 'width:150px;' },
    { headerText: 'Status',         field: 'status',        template: 'dashStatusTpl',  sortable: 'enabled', style: 'width:175px;' },
    { headerText: 'Start Date',     field: 'startDate',                                 sortable: 'enabled', style: 'width:115px;' },
    { headerText: 'End Date',       field: 'endDate',                                   sortable: 'enabled', style: 'width:115px;' }
  ];

  // `source` (INTERNAL | EXTERNAL) is NOT declared in the workbench-requests
  // response schema, but it does arrive — the equipment-workbench page reads and
  // renders it, and that spec is known to lag the live API. Rendered through
  // $application.functions.sourceLabel() so a legacy 'PROJECT'/'CUSTOMER' row
  // displays in the CURRENT vocabulary instead of showing two words for one
  // thing in the same table.
  const WORKBENCH_COLUMNS = [
    { headerText: 'Request #',  field: 'requestNumber', template: 'dashReqNumTpl',   sortable: 'enabled', style: 'width:150px;' },
    { headerText: 'Source',     field: 'source',        template: 'dashSourceTpl',   sortable: 'enabled', style: 'width:110px;' },
    { headerText: 'Project',    field: 'project',                                    sortable: 'enabled' },
    { headerText: 'Requestor',  field: 'requestor',                                  sortable: 'enabled', style: 'width:150px;' },
    { headerText: 'Lines',      field: 'totalLines',                                 sortable: 'enabled', style: 'width:90px;' },
    // Plain percentage — no progress bar. The bar competed with the status pill
    // for attention and read poorly at this column width.
    { headerText: 'Allocated',  field: 'allocationPct', template: 'dashAllocTpl',    sortable: 'enabled', style: 'width:110px;' },
    { headerText: 'Status',     field: 'status',        template: 'dashStatusTpl',   sortable: 'enabled', style: 'width:175px;' },
    { headerText: 'Needed By',  field: 'startDate',                                  sortable: 'enabled', style: 'width:115px;' }
  ];

  const TIMESHEET_COLUMNS = [
    { headerText: 'Request #', field: 'requestNumber', template: 'dashReqNumTpl', sortable: 'enabled', style: 'width:150px;' },
    { headerText: 'Project',   field: 'project',                                  sortable: 'enabled' },
    { headerText: 'Week',      field: 'weekLabel',                                sortable: 'enabled', style: 'width:200px;' },
    { headerText: 'Equipment', field: 'equipCount',                               sortable: 'enabled', style: 'width:110px;' },
    { headerText: 'Hours',     field: 'totalHours',                               sortable: 'enabled', style: 'width:100px;' },
    { headerText: 'Status',    field: 'status',        template: 'dashStatusTpl', sortable: 'enabled', style: 'width:150px;' }
  ];

  // Rows are grouped to ONE PER REQUEST by the chain, so there is no single
  // "Week" to show — the request spans several. Timesheets/Hours are omitted
  // because both are 0 on every row of EQP_POSTCOST in this environment (cost
  // is rate-driven, not accumulated from time entry), and a column of zeros is
  // worse than no column. Dates bracket the request; Weeks counts what it spans.
  const POST_COST_COLUMNS = [
    { headerText: 'Request #', field: 'requestNumber', template: 'dashReqNumTpl', sortable: 'enabled', style: 'width:150px;' },
    { headerText: 'Project',   field: 'project',                                  sortable: 'enabled' },
    { headerText: 'Task',      field: 'task',                                     sortable: 'enabled' },
    { headerText: 'Weeks',     field: 'weekCount',                                sortable: 'enabled', style: 'width:90px;' },
    { headerText: 'Start',     field: 'startDate',                                sortable: 'enabled', style: 'width:115px;' },
    { headerText: 'End',       field: 'endDate',                                  sortable: 'enabled', style: 'width:115px;' },
    { headerText: 'Bill Cost', field: 'totalBillCost', template: 'dashMoneyTpl',  sortable: 'enabled', style: 'width:130px;' }
  ];

  const ROLE_CONFIG = {

    // ── EQUIPMENT ADMINISTRATOR ─────────────────────────────────────────────
    // Admins get the REQUESTOR dashboard, by explicit product decision — an
    // admin is not an operational persona and has no dashboard of its own.
    //
    // This entry MUST exist even though it only aliases the requestor config.
    // RT_EQP_ADMINISTRATOR is priority 30 — the HIGHEST of the RT_EQP_* roles —
    // so for the many logins that hold it alongside another grant it always
    // wins the persona race. Leaving it unmapped made those users fall through
    // to whatever lower-priority role they happened to have (an admin who also
    // held RT_EQP_INSPECTION landed on the Inspection dashboard), or to no
    // persona at all.
    //
    // Defined via getter below (after REQUESTOR is declared) rather than as a
    // literal copy, so the two can never drift apart.
    EQUIP_ADMIN: null,   // ← populated immediately after this object literal

    // ── EQUIPMENT MANAGER ───────────────────────────────────────────────────
    // Table: workbench at the OUTBOUND stage (what is going out the door).
    // KPIs describe the whole outbound→deployed→inbound pipeline, so they are
    // counted from three separate stage calls rather than from the table alone.
    EQUIP_MGR: {
      title: 'Equipment Manager Dashboard',
      subtitle: 'Outbound pipeline, deployments and allocation backlog.',
      tableTitle: 'Outbound Requests',
      tableViewAllNav: 'workbench',
      table: {
        endpoint: 'eqp-v1/getEquipriteV1ViewsWorkbenchRequests',
        uriParams: { stage: 'OUTBOUND', size: 1000 },
        shape: 'workbench',
        columns: WORKBENCH_COLUMNS
      },
      // Extra fetches this persona's KPIs need beyond its own table.
      extras: [
        { key: 'equipMaster', endpoint: 'eqp-v1/getEquipriteV1ViewsEquipmentMaster', uriParams: { page: 0, size: 1 } },
        { key: 'deployed',    endpoint: 'eqp-v1/getEquipriteV1ViewsWorkbenchRequests', uriParams: { stage: 'DEPLOYED', size: 1000 } },
        { key: 'inbound',     endpoint: 'eqp-v1/getEquipriteV1ViewsWorkbenchRequests', uriParams: { stage: 'INBOUND',  size: 1000 } }
      ],
      kpis: [
        { key: 'totalEquipment',     label: 'TOTAL EQUIPMENT',      hint: 'Assets currently in registry',   icon: 'oj-ux-ico-truck',        accent: 'info',    nav: 'equipment' },
        { key: 'deployedRequests',   label: 'DEPLOYED REQUESTS',    hint: 'Currently out in the field',     icon: 'oj-ux-ico-location',     accent: 'success', nav: 'workbench' },
        { key: 'inboundRequests',    label: 'INBOUND REQUESTS',     hint: 'Returning to yard',              icon: 'oj-ux-ico-download',     accent: 'warning', nav: 'receipt' },
        { key: 'allocationsPending', label: 'ALLOCATIONS PENDING',  hint: 'Lines awaiting allocation',      icon: 'oj-ux-ico-clock',        accent: 'danger',  nav: 'workbench' }
      ]
    },

    // ── REQUESTOR ───────────────────────────────────────────────────────────
    // Table stays exactly as it was (my-requests) — confirmed correct.
    REQUESTOR: {
      title: 'My Dashboard',
      subtitle: 'Your equipment requests and their current status.',
      tableTitle: 'Recent Requests',
      tableViewAllNav: 'my-requests',
      table: {
        endpoint: 'eqp-v1/getEquipriteV1ViewsMyRequests',
        // size must exceed the row count: the KPI tiles are counted from THIS
        // payload, so a short page does not merely shorten the table, it makes
        // the numbers wrong. 302 rows live in paasdev today and size:200 was
        // silently dropping a third of them. The view endpoints clamp at 2000,
        // so that is the effective ceiling regardless of what is asked for.
        uriParams: { page: 0, size: 2000 },
        shape: 'myRequests',
        columns: REQUEST_COLUMNS
      },
      extras: [],
      kpis: [
        { key: 'pendingRequests',   label: 'PENDING REQUESTS',      hint: 'Awaiting approval',            icon: 'oj-ux-ico-clock',        accent: 'warning', nav: 'my-requests' },
        { key: 'inProcessRequests', label: 'REQUESTS IN PROCESS',   hint: 'Approved and being fulfilled', icon: 'oj-ux-ico-rotate-right', accent: 'info',    nav: 'my-requests' },
        { key: 'deployedEquipment', label: 'DEPLOYED EQUIPMENT',    hint: 'Units currently on site',      icon: 'oj-ux-ico-location',     accent: 'success', nav: 'my-requests' }
      ]
    },

    // ── INSPECTION ──────────────────────────────────────────────────────────
    // Table: the picking queue (stage=INITIATE) — same set the Initiate Picking
    // page shows. KPIs track the yard-return lifecycle.
    INSPECTION: {
      title: 'Inspection Dashboard',
      subtitle: 'Picking queue, yard receipts and closures.',
      tableTitle: 'Pick Initiate Requests',
      tableViewAllNav: 'picking',
      table: {
        endpoint: 'eqp-v1/getEquipriteV1ViewsWorkbenchRequests',
        uriParams: { stage: 'INITIATE', size: 1000 },
        shape: 'workbench',
        // Row-click destination, when it differs from what `shape` implies.
        // This persona's rows are workbench-SHAPED (same mapper, same columns as
        // the manager's outbound table) but they are the PICKING queue, so a
        // click belongs on initiate-picking, not on the request detail page.
        // Kept separate from `shape` deliberately: `shape` keys the row mapper
        // in dashboardInitChain, and forking it here would mean writing a
        // duplicate mapper just to change where a click goes.
        rowNav: 'workbenchPicking',
        columns: WORKBENCH_COLUMNS
      },
      // Line-grain statuses (PICK_INITIATED / SHIPPED_TO_YARD / CLOSED) do not
      // exist at request grain, so the KPIs need a LINE-grain source.
      //
      // That source is my-request-lines, NOT workbench-lines. Both views carry
      // LINE_STATUS in the database, but the workbench-lines RESPONSE SCHEMA in
      // openapi3.json does not declare `lineStatus` — and VBCS silently STRIPS
      // any field a schema omits. So every row arrived with lineStatus
      // undefined and all three tiles counted 0, with no error anywhere to show
      // for it. my-request-lines declares the field, so it survives the wire.
      //
      // Verified in paasdev: PICK_INITIATED 8, SHIPPED_TO_YARD 9, CLOSED 7.
      //
      // (If workbench-lines is ever preferred here, the fix is a BACKEND one —
      // add lineStatus to its schema — not a frontend workaround.)
      extras: [
        { key: 'inboundLines', endpoint: 'eqp-v1/getEquipriteV1ViewsMyRequestLines', uriParams: { page: 0, size: 2000 } }
      ],
      kpis: [
        { key: 'pickInitiated',  label: 'READY FOR PICK',      hint: 'Pick initiated, awaiting action', icon: 'oj-ux-ico-package',      accent: 'info',    nav: 'picking' },
        { key: 'shippedToYard',  label: 'SHIPPED TO YARD',     hint: 'In transit back to yard',         icon: 'oj-ux-ico-download',     accent: 'warning', nav: 'receipt' },
        { key: 'returnedClosed', label: 'RETURNED / CLOSED',   hint: 'Received and closed out',         icon: 'oj-ux-ico-check-circle-s', accent: 'success', nav: 'receipt' }
      ]
    },

    // ── TIMEKEEPER ──────────────────────────────────────────────────────────
    // Table: the keeper's own timesheet grid. KPIs are the four lifecycle
    // states, counted from that same payload — no extra call needed.
    TIMEKEEPER: {
      title: 'Timekeeper Dashboard',
      subtitle: 'Timesheet entry status across your requests.',
      tableTitle: 'My Timesheets',
      tableViewAllNav: 'time-entry',
      table: {
        endpoint: 'eqp-v1/getEquipriteV1ViewsTimesheets',
        uriParams: { page: 0, size: 500 },
        shape: 'timesheets',
        columns: TIMESHEET_COLUMNS
      },
      extras: [],
      kpis: [
        { key: 'tsDraft',     label: 'IN DRAFT',   hint: 'Not yet submitted',      icon: 'oj-ux-ico-edit',           accent: 'info',    nav: 'time-entry' },
        { key: 'tsSubmitted', label: 'SUBMITTED',  hint: 'Awaiting approval',      icon: 'oj-ux-ico-clock',          accent: 'warning', nav: 'time-entry' },
        { key: 'tsApproved',  label: 'APPROVED',   hint: 'Approved for costing',   icon: 'oj-ux-ico-check-circle-s', accent: 'success', nav: 'time-entry' },
        { key: 'tsRejected',  label: 'REJECTED',   hint: 'Returned for correction', icon: 'oj-ux-ico-error',         accent: 'danger',  nav: 'time-entry' }
      ]
    },

    // ── TIME APPROVER ───────────────────────────────────────────────────────
    // Same four KPIs as the keeper (per spec), but the table is the APPROVAL
    // queue rather than the entry grid — a different endpoint and payload.
    TIME_APPROVER: {
      title: 'Time Approver Dashboard',
      subtitle: 'Timesheets awaiting your review.',
      tableTitle: 'Timesheet Approvals',
      tableViewAllNav: 'timesheet-approval',
      table: {
        endpoint: 'eqp-v1/getEquipriteV1ViewsTimesheetApprovals',
        uriParams: { page: 0, size: 500 },
        shape: 'timesheetApprovals',
        columns: TIMESHEET_COLUMNS
      },
      // The approval queue holds only what is pending approval, so DRAFT and
      // REJECTED counts cannot come from it — they need the full timesheet view.
      extras: [
        { key: 'allTimesheets', endpoint: 'eqp-v1/getEquipriteV1ViewsTimesheets', uriParams: { page: 0, size: 500 } }
      ],
      kpis: [
        { key: 'tsDraft',     label: 'IN DRAFT',   hint: 'Not yet submitted',       icon: 'oj-ux-ico-edit',           accent: 'info',    nav: 'timesheet-approval' },
        { key: 'tsSubmitted', label: 'SUBMITTED',  hint: 'Awaiting your approval',  icon: 'oj-ux-ico-clock',          accent: 'warning', nav: 'timesheet-approval' },
        { key: 'tsApproved',  label: 'APPROVED',   hint: 'Approved for costing',    icon: 'oj-ux-ico-check-circle-s', accent: 'success', nav: 'timesheet-approval' },
        { key: 'tsRejected',  label: 'REJECTED',   hint: 'Returned for correction', icon: 'oj-ux-ico-error',          accent: 'danger',  nav: 'timesheet-approval' }
      ]
    },

    // ── FINANCE USER ────────────────────────────────────────────────────────
    // Table: post-cost. KPIs are articulated from that same payload, per spec.
    //
    // BACKEND GAP — "total cost posted". EQP_POSTCOST (behind /views/post-cost)
    // carries NO posted/pending flag, so a true split cannot be computed here.
    // POST_STATUS does exist on EQP_P_POST_COST_DETAILS, but its endpoint
    // (/views/post-cost-details) REQUIRES a requestNumber and exposes no
    // page/size, so covering the dashboard would take one call per request
    // (~102) — the N+1 fan-out this codebase already removed once from Request
    // Detail. The tiles below therefore report what post-cost can actually
    // support, and `costPosted` is intentionally absent rather than faked.
    //
    // TO ENABLE A REAL SPLIT, the backend needs EITHER:
    //   (a) POSTED_COST_AMOUNT / POST_STATUS surfaced on the post-cost view, or
    //   (b) page + size params on /views/post-cost-details so it can be bulk-read.
    // With either in place, add a `costPosted` counter and one more kpi entry.
    FINANCE_USER: {
      title: 'Finance Dashboard',
      subtitle: 'Cost posting backlog across all requests.',
      tableTitle: 'Post Cost',
      tableViewAllNav: 'post-costs',
      table: {
        endpoint: 'eqp-v1/getEquipriteV1ViewsPostCost',
        uriParams: { page: 0, size: 10000 },
        shape: 'postCost',
        columns: POST_COST_COLUMNS
      },
      extras: [],
      kpis: [
        { key: 'totalRequests', label: 'TOTAL REQUESTS',  hint: 'Requests in the costing queue',  icon: 'oj-ux-ico-file-text',       accent: 'info',    nav: 'post-costs' },
        // Deliberately NOT a timesheets/hours tile: TIMESHEETS and TOTAL_HOURS
        // are 0 on every row of EQP_POSTCOST in this environment (cost is
        // rate-driven, derived from the rate schedule rather than accumulated
        // from time entry), so either would render a permanent zero. Weeks
        // carrying cost is the honest measure of the posting backlog.
        { key: 'weeksToPost',   label: 'WEEKS TO POST',   hint: 'Incurred weeks awaiting posting',  icon: 'oj-ux-ico-clock',         accent: 'warning', nav: 'post-costs' },
        { key: 'costPending',   label: 'COST PENDING',    hint: 'Incurred cost not yet posted',   icon: 'oj-ux-ico-currency-dollar', accent: 'danger',  nav: 'post-costs', money: true }
      ]
    }
  };

  // Admin === requestor dashboard, but with its own title so the user can tell
  // which persona resolved. Derived from REQUESTOR rather than duplicated, so
  // any future change to the requestor tiles or table follows automatically.
  ROLE_CONFIG.EQUIP_ADMIN = Object.assign({}, ROLE_CONFIG.REQUESTOR, {
    title: 'Dashboard',
    subtitle: 'Equipment requests and their current status.'
  });

  return {
    STATUSES: S,
    ROLE_CONFIG: ROLE_CONFIG,

    /**
     * Config for a persona.
     *
     * ── TESTING: fallback DISABLED ──────────────────────────────────────────
     * Normally returns ROLE_CONFIG.REQUESTOR for an unknown role so the page
     * can never render with no table and no tiles. That is switched off in step
     * with resolveDashboardRole's own disabled fallback — leaving it here would
     * defeat that change entirely, since an unresolved role ('') would land on
     * the requestor config anyway and look like a working dashboard.
     *
     * Returns null instead, and the caller renders an explicit error.
     * RESTORE before release by uncommenting the line below and deleting the
     * one after it.
     */
    forRole(role) {
      // return ROLE_CONFIG[role] || ROLE_CONFIG.REQUESTOR;
      return ROLE_CONFIG[role] || null;
    }
  };
});
