define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/dashboardRoleConfig',
  'resources/js/adminDashboard',
  'resources/js/integrationHealth',
  'resources/js/analyticsData',
], (ActionChain, Actions, dashConfig, adminDashboard, IntegrationHealth, analyticsData) => {
  'use strict';

  // New EquipRite Home: the old dashboard's data logic (main-equiprite-page's dashboardInitChain), copied so the
  // persona rules, endpoints and KPI counts stay exactly as they are proven in Old EquipRite. Changed here: no
  // redirect to a separate project or customer dashboard (Home is one page); a customer-only user is sent to the
  // customer portal. New here:
  //   - "View as": an Administrator previews any persona's Home, others switch between their own personas
  //     (dashboardPersonas). The choice is kept for the tab. Sign-out and redirect rules still follow the user's
  //     REAL persona, never the previewed one.
  //   - The Administrator has a Home of its own (loadAdmin, resources/js/adminDashboard.js) instead of the
  //     Requestor's: FDD 7.1.3 KPI bar, what needs attention, pipeline, fleet, integrations, settings.
  const VIEW_KEY = 'eqr.home.viewAs';
  function savedView() {
    try { return sessionStorage.getItem(VIEW_KEY) || ''; } catch (e) { return ''; }
  }
  function saveView(code) {
    try { sessionStorage.setItem(VIEW_KEY, code); } catch (e) { /* private mode */ }
  }

  const S = dashConfig.STATUSES;

  // Coerce a possibly-string/null numeric field to a finite number. View columns
  // arrive as JSON numbers, but null/'' must not become NaN — that is what
  // produced blank and 'NaN%' allocation cells on the workbench.
  const num = (v) => {
    if (v === null || v === undefined || v === '') return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const day = (v) => (v ? String(v).slice(0, 10) : '');

  /**
   * True when an ISO week starts AFTER today — i.e. nothing has been incurred
   * yet. A week straddling today is "in progress" and is NOT future.
   *
   * Mirrors post-cost-test-page's vbEnterChain exactly, because the finance
   * tiles link there and must not contradict it. Compared in UTC so the answer
   * does not shift with the viewer's timezone.
   *
   * No week date -> NOT future, so a missing date never silently hides cost.
   */
  const isFutureWeek = (weekStartDate) => {
    const iso = day(weekStartDate);
    if (!iso) return false;
    const ws = new Date(iso + 'T00:00:00Z');
    if (isNaN(ws.getTime())) return false;
    const n = new Date();
    const today = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
    return ws > today;
  };

  const rows = (res) =>
    (res && res.ok && res.body && Array.isArray(res.body.data)) ? res.body.data : [];

  // ── Row mappers, one per payload shape ────────────────────────────────────
  // Each turns a raw view row into the flat shape the table columns bind to.
  // Keyed by the `shape` field in dashboardRoleConfig so the chain never
  // branches on role — only on payload shape, which is what actually differs.
  //
  // Status field naming is NOT consistent across these views (requestStatus vs
  // status vs timesheetStatus vs lineStatus), and openapi3.json is known to lag
  // the live API, so every mapper reads its primary name with a fallback rather
  // than trusting one. A wrong guess here renders a blank Status column.
  const MAPPERS = {
    myRequests: (r) => ({
      requestNumber:         r.requestNumber,
      eqrEquipmentRequestId: r.eqrEquipmentRequestId,
      project:               r.projectName,
      task:                  r.taskName,
      requestor:             r.requestorName,
      status:                r.requestStatus || r.status,
      startDate:             day(r.startDate),
      endDate:               day(r.endDate)
    }),

    workbench: (r, fns) => {
      const isExt  = fns.isExternalSource(r.source);
      const lines  = num(r.totalLines);
      const alloc  = num(r.allocatedLines);
      return {
        requestNumber:         r.requestNumber || '—',
        eqrEquipmentRequestId: r.eqrEquipmentRequestId,
        // Raw origin, passed through UNMAPPED. The Source column's template
        // normalises it via sourceLabel() at render time, so a legacy
        // 'PROJECT'/'CUSTOMER' value still displays in the current vocabulary.
        // Normalising here instead would throw away what the backend actually
        // said, which is the value the pill's neutral fallback keys off.
        source:                r.source || '',
        // PROJECT vs CUSTOMER rows carry their party in different fields, and an
        // external row with no assigned project MIRRORS the customer name into
        // projectName. Falling back across both keeps the column populated.
        project:   isExt ? (r.customerName || r.projectName || '—')
                         : (r.projectName  || r.customerName || '—'),
        requestor: isExt ? (r.contactName || r.requestor   || '')
                         : (r.requestor   || r.contactName || ''),
        totalLines:    lines,
        // Prefer a server-computed pct when present; workbench-requests has no
        // ALLOCATION_PCT column so deriving is the normal path.
        allocationPct: r.allocationPct != null
          ? num(r.allocationPct)
          : (lines > 0 ? Math.round((alloc / lines) * 100) : 0),
        status:    r.requestStatus || r.status,
        startDate: day(r.requestedStartDate),
        endDate:   day(r.requestedEndDate)
      };
    },

    timesheets: (r) => ({
      requestNumber:  r.requestNumber || '—',
      eqrTimeEntryId: r.eqrTimeEntryId,
      project:        r.projectName || '—',
      weekLabel:      day(r.weekStartDate) && day(r.weekEndDate)
        ? day(r.weekStartDate) + ' – ' + day(r.weekEndDate)
        : '—',
      weekStartDate:  day(r.weekStartDate),
      equipCount:     num(r.equipCount),
      totalHours:     num(r.totalHours),
      status:         r.timesheetStatus || r.status || S.DRAFT
    }),

    timesheetApprovals: (r) => ({
      requestNumber: r.requestNumber || '—',
      project:       r.projectName   || '—',
      weekLabel:     day(r.weekStartDate) && day(r.weekEndDate)
        ? day(r.weekStartDate) + ' – ' + day(r.weekEndDate)
        : '—',
      weekStartDate: day(r.weekStartDate),
      equipCount:    num(r.equipCount),
      totalHours:    num(r.totalHours),
      status:        r.status || r.timesheetStatus || S.SUBMITTED
    }),

    // Receives rows ALREADY grouped to one-per-request by
    // groupPostCostByRequest, so totalBillCost is the request total and
    // weekCount/startDate/endDate describe the whole request rather than a
    // single week.
    postCost: (r) => ({
      requestNumber:         r.requestNumber || '—',
      eqrEquipmentRequestId: r.eqrEquipmentRequestId,
      project:               r.projectName || '—',
      task:                  r.taskName    || '—',
      weekCount:             num(r.weekCount),
      startDate:             day(r.requestedStartDate),
      endDate:               day(r.requestedEndDate),
      // Retained for sorting (see sortRows) though no column binds it.
      weekStartDate:         day(r.weekStartDate),
      totalBillCost:         num(r.totalBillCost),
      // Carried for the row-click drill-down only — no column binds these.
      // post-cost-test-detail takes ppm*/rateSchedule identifiers that this
      // flat shape drops; navigateDashboardRowChain reads them from here so a
      // dashboard click opens the same detail as a click on the full Post Cost
      // table. All are optional there (they default to 0/''), so an absent one
      // just means the detail page re-resolves it.
      _raw: {
        ppmProjectNumber: r.ppmProjectNumber,
        ppmTaskNumber:    r.ppmTaskNumber,
        ppmBusinessUnit:  r.ppmBusinessUnit,
        ppmProjectRefId:  r.ppmProjectRefId,
        ppmTaskRefId:     r.ppmTaskRefId,
        rateScheduleId:   r.rateScheduleId,
        weekEndDate:      day(r.weekEndDate)
      }
    })
  };

  // Sort newest-first. Request-grain payloads sort on the surrogate id (higher =
  // created later); week-grain payloads have no such id, so they sort by week.
  const sortRows = (list, shape) => {
    if (shape === 'timesheets' || shape === 'timesheetApprovals' || shape === 'postCost') {
      list.sort((a, b) => String(b.weekStartDate || '').localeCompare(String(a.weekStartDate || '')));
    } else {
      list.sort((a, b) =>
        num(b.eqrEquipmentRequestId) - num(a.eqrEquipmentRequestId) ||
        String(b.requestNumber || '').localeCompare(String(a.requestNumber || ''))
      );
    }
    return list;
  };

  // Count rows in `list` whose status field is in `set`.
  const countBy = (list, set) =>
    list.filter((r) => set.indexOf(r.status) !== -1).length;

  // ── KPI counters, one per persona ─────────────────────────────────────────
  // Each receives the persona's own mapped table rows plus the raw `extras`
  // responses it declared, and returns the { key: value } map the tiles bind to.
  // Keys MUST match the `key` fields in dashboardRoleConfig's kpis array.
  const COUNTERS = {
    EQUIP_MGR: (tableRows, extra) => {
      const master = extra.equipMaster;
      return {
        // recordCount is the server's total, NOT the page length — the call
        // deliberately asks for size:1 and reads the count off the envelope.
        totalEquipment: (master && master.ok && master.body
          && typeof master.body.recordCount === 'number') ? master.body.recordCount : 0,
        // Stage calls are request-grain but return one row per LINE, so the
        // distinct request ids are what the tile means by "requests".
        deployedRequests: distinctRequests(rows(extra.deployed)),
        inboundRequests:  distinctRequests(rows(extra.inbound)),
        // Outbound lines still awaiting allocation. Derived from the persona's
        // own table payload (totalLines − allocatedLines across the stage).
        allocationsPending: rows(extra.__self).reduce((sum, r) => {
          const lines = num(r.totalLines);
          const alloc = num(r.allocatedLines);
          return sum + Math.max(0, lines - alloc);
        }, 0)
      };
    },

    REQUESTOR: (tableRows) => ({
      pendingRequests:   countBy(tableRows, [S.SUBMITTED]),
      inProcessRequests: countBy(tableRows, [S.IN_PROCESS, S.ALLOCATED]),
      deployedEquipment: countBy(tableRows, [S.DEPLOYED])
    }),

    // Admin sees the requestor dashboard, so it shares the requestor counts.
    // Aliased rather than duplicated — assigned after this object is built.
    EQUIP_ADMIN: null,

    INSPECTION: (tableRows, extra) => {
      // Line-grain statuses are not exposed at request grain, so these come
      // from the workbench-lines view rather than the persona's own table.
      const lines = rows(extra.inboundLines);
      const byStatus = (codes) => lines.filter((l) =>
        codes.indexOf(l.lineStatus || l.status) !== -1).length;
      return {
        pickInitiated:  byStatus([S.PICK_INITIATED]),
        shippedToYard:  byStatus([S.SHIPPED_TO_YARD]),
        returnedClosed: byStatus([S.CLOSED])
      };
    },

    TIMEKEEPER: (tableRows) => ({
      tsDraft:     countBy(tableRows, [S.DRAFT]),
      tsSubmitted: countBy(tableRows, [S.SUBMITTED]),
      tsApproved:  countBy(tableRows, [S.APPROVED]),
      tsRejected:  countBy(tableRows, [S.REJECTED])
    }),

    TIME_APPROVER: (tableRows, extra) => {
      // The approval queue holds only pending items, so DRAFT/REJECTED must be
      // counted from the full timesheet view instead of the table.
      const all = rows(extra.allTimesheets)
        .map((r) => ({ status: r.timesheetStatus || r.status || S.DRAFT }));
      return {
        tsDraft:     countBy(all, [S.DRAFT]),
        tsSubmitted: countBy(all, [S.SUBMITTED]),
        tsApproved:  countBy(all, [S.APPROVED]),
        tsRejected:  countBy(all, [S.REJECTED])
      };
    },

    FINANCE_USER: (tableRows, extra) => {
      // See dashboardRoleConfig.FINANCE_USER for why there is no `costPosted`
      // tile: /views/post-cost carries no posted flag, and the only view that
      // does cannot be bulk-read.
      //
      // These tiles MUST agree with post-cost-test, which is where they
      // navigate. That page groups the week-grain payload by request and
      // EXCLUDES future weeks from the money (a week is future iff its start is
      // after today; a week straddling today still counts). Counting raw rows
      // and summing every week instead would have shown 263 "requests" against
      // a page listing 102, and $1,130,486 against a page totalling $988,466.
      //
      // The rows are already deduped to request grain by the mapper's caller,
      // so `requests` here counts cards, not week-rows.
      // Rows arrive ALREADY grouped to request grain and already future-week
      // filtered by groupPostCostByRequest, so cost just totals them. Summing
      // isFutureWeek again here would be wrong twice over: the weekly rows are
      // gone, and their money was withheld upstream.
      let cost = 0;
      tableRows.forEach((r) => { cost += num(r.totalBillCost); });

      // Weeks are counted off the RAW payload, not the grouped rows — grouping
      // collapsed them away. Only weeks that have been reached AND carry cost
      // count: a future week is not yet a backlog item, and a zero week is
      // nothing to post.
      const weeks = rows(extra.__self).filter((r) =>
        !isFutureWeek(r.weekStartDate) && num(r.totalBillCost) > 0).length;

      return {
        totalRequests: tableRows.length,
        weeksToPost:   weeks,
        costPending:   Math.round(cost * 100) / 100
      };
    }
  };

  // Sign-out delay. One minute, per the requirement — long enough to read the
  // warning toast, short enough that the user is not left in a dead app.
  const SIGN_OUT_DELAY_MS = 60 * 1000;

  // Guards against stacking timers. vbEnter fires again on every re-entry to
  // this page, and without this each visit would queue another sign-out — so a
  // user who navigated away and back would be logged out early by the FIRST
  // timer, not the one their latest visit started.
  let signOutTimer = null;

  /**
   * THE single test for "should this session be terminated".
   *
   * Sign-out and TIMESHEETS_ENABLED are one decision, not two: the ONLY reason
   * these roles are signed out is that timesheets are off. Both the scheduler
   * and the timer itself call this, so the flag cannot be true while a sign-out
   * is pending — there is no second copy of the rule to drift.
   *
   * FAILS SAFE toward keeping the session: isFeatureEnabled returns false while
   * settings are still in flight, so flagsLoaded is checked FIRST. Signing
   * someone out because a config fetch had not landed yet would be a serious
   * false positive, and this runs on vbEnter, exactly when that race is live.
   */
  function shouldSignOut($application, fns, role) {
    if (role !== 'TIMEKEEPER' && role !== 'TIME_APPROVER') { return false; }
    if (!$application.variables.flagsLoaded) { return false; }
    return !fns.isFeatureEnabled($application.variables.featureFlags,
                                 $application.variables.flagsLoaded,
                                 'TIMESHEETS_ENABLED');
  }

  /**
   * Signs the user out after SIGN_OUT_DELAY_MS.
   *
   * RE-CHECKS the flag when the timer fires, not only when it was scheduled.
   * The flag is read on vbEnter, but a minute is long enough for it to change
   * underneath us — an admin switching TIMESHEETS_ENABLED on, or flags simply
   * arriving late. Without the re-check the timer would sign out a user whose
   * timesheets are, by then, perfectly enabled. Cancelling instead keeps the
   * two strictly interlinked: no sign-out survives the flag going true.
   *
   * Not otherwise cancellable — while timesheets stay off there is no
   * interaction that would make staying signed in meaningful.
   *
   * Navigates to VB's standard logout endpoint, resolved from the RUNTIME
   * origin + rootURL rather than hardcoded, so it works unchanged in Designer
   * preview, dev and a deployed app (which sit on different hosts and base
   * paths). Falls back to reloading at the app root if the path cannot be
   * derived — that returns an unauthenticated user to the login screen.
   */
  function scheduleSignOut($application, fns, role) {
    if (signOutTimer) { return; }
    signOutTimer = setTimeout(() => {
      signOutTimer = null;
      // Re-read the flag at fire time — see above.
      if (!shouldSignOut($application, fns, role)) {
        console.warn('[homeInitChain] timesheets re-enabled before the'
          + ' sign-out fired - cancelling');
        return;
      }
      try {
        // rootURL is the first path segment of a deployed VB app URL.
        const seg = String(window.location.pathname || '').split('/').filter(Boolean);
        const root = seg.length ? '/' + seg[0] : '';
        window.location.assign(window.location.origin + root + '/logout');
      } catch (e) {
        console.error('[homeInitChain] sign-out navigation failed', e);
        window.location.reload();
      }
    }, SIGN_OUT_DELAY_MS);
  }

  /**
   * Cancels a pending sign-out. Called on every page entry that resolves
   * timesheets as ENABLED, so a timer scheduled by an earlier entry (when the
   * flag was off, or had not loaded) cannot outlive the condition that set it.
   */
  function cancelSignOut() {
    if (!signOutTimer) { return; }
    clearTimeout(signOutTimer);
    signOutTimer = null;
  }

  /**
   * Waits briefly for loadFusionRolesChain (app vbEnter) to populate
   * fusionRoles, which it does in parallel with page entry.
   *
   * Bounded on purpose: the roles come from a BIP report that can legitimately
   * return nothing (unmapped user), so an unbounded wait would hang the page on
   * exactly the accounts that need the fallback persona. ~2s at 50ms covers the
   * normal race without being perceptible; past that we proceed with whatever
   * is there and resolveDashboardRole defaults to REQUESTOR.
   */
  async function waitForRoles($application, tries = 40, gapMs = 50) {
    for (let i = 0; i < tries; i++) {
      if (($application.variables.fusionRoles || []).length) return;
      await new Promise((r) => setTimeout(r, gapMs));
    }
  }

  /**
   * Then waits for the server's session roles (loadPageAccessChain, GET
   * /rbac/session-roles). They are what resolve the persona for a customer
   * whose Fusion roles are not named RT_EQP_* (OII_RT_EQP_MANAGER_JR), so
   * resolving before they land would show such a user "no persona".
   *
   * sessionRolesLoaded is a SETTLED latch, set on success and failure alike, so
   * this normally returns the moment the call ends. The ~5s bound only covers a
   * hung call; past it resolveDashboardRole falls back to the RT_EQP_* map.
   */
  async function waitForSessionRoles($application, tries = 100, gapMs = 50) {
    for (let i = 0; i < tries; i++) {
      if ($application.variables.sessionRolesLoaded) return;
      await new Promise((r) => setTimeout(r, gapMs));
    }
  }

  /**
   * Collapses the week-grain post-cost payload to ONE ROW PER REQUEST, summing
   * each request's weekly timesheets/hours/cost.
   *
   * Mirrors post-cost-test-page's vbEnterChain, which is where this table's
   * View All goes: without grouping, a 5-week rental appears five times here
   * and once there.
   *
   * FUTURE weeks contribute nothing to the money but do NOT remove the request
   * — a request whose weeks are all in the future is real and still queued, it
   * simply reads $0. Same rule as the detail page, so the two agree.
   *
   * NOT replicated here: post-cost-test also folds in getMiscTransactions.
   * That is a second unfiltered call for a figure no tile on this dashboard
   * shows, so it is deliberately skipped — the Bill Cost column may therefore
   * read slightly LOW against the drill-down for requests carrying misc
   * charges. Add the call here if a misc-inclusive total is ever wanted.
   */
  function groupPostCostByRequest(raw) {
    const byRequest = new Map();
    raw.forEach((r) => {
      const key = r.requestNumber || '';
      if (!byRequest.has(key)) {
        byRequest.set(key, Object.assign({}, r, {
          timesheets: 0, totalHours: 0, totalBillCost: 0, weekCount: 0
        }));
      }
      // Row is created regardless, so an all-future request keeps its card;
      // only its money is withheld.
      if (isFutureWeek(r.weekStartDate)) return;
      const g = byRequest.get(key);
      // Counts INCURRED weeks only — consistent with the money beside it, so a
      // request cannot read 5 weeks against a future-dated $0.
      g.weekCount     += 1;
      g.timesheets    += num(r.timesheets);
      g.totalHours    += num(r.totalHours);
      g.totalBillCost += num(r.totalBillCost);
    });
    // Float noise from repeated addition, same rounding as the list page.
    const out = Array.from(byRequest.values());
    out.forEach((g) => { g.totalBillCost = Math.round(g.totalBillCost * 100) / 100; });
    return out;
  }

  // Admin === requestor, same counts. Assigned here rather than as a second
  // copy of the function so the two can never drift.
  COUNTERS.EQUIP_ADMIN = COUNTERS.REQUESTOR;

  // Distinct request ids in a line-grain workbench payload.
  function distinctRequests(list) {
    const seen = new Set();
    list.forEach((r) => {
      if (r.eqrEquipmentRequestId != null) seen.add(r.eqrEquipmentRequestId);
    });
    return seen.size;
  }

  class homeInitChain extends ActionChain {
    async run(context, params) {
      const { $page, $application } = context;
      const fns = $application.functions;
      const requested = params && params.role ? String(params.role) : '';

      $page.variables.isLoading = true;

      try {
        // Roles are resolved by loadFusionRolesChain on APP vbEnter, which runs
        // in parallel with page entry — so on a cold load fusionRoles can still
        // be empty here.
        //
        // We deliberately do NOT call that chain from this page. A bare chain id
        // resolves against THIS page's own -chains folder, so naming an
        // app-level chain here would 404 rather than run it. (loadPageAccessChain
        // can call it only because both live at app level.)
        //
        // Poll the variable instead, briefly. resolveDashboardRole falls back to
        // REQUESTOR when nothing resolves, so the worst case if roles arrive
        // late is the default persona rather than a broken page — and this is
        // the layout switch, not an authorisation gate.
        await waitForRoles($application);
        await waitForSessionRoles($application);

        // myRole is who the user IS; role is the Home being shown (the same unless "View as" picked another).
        const myRole = fns.resolveDashboardRole(
          $application.variables.fusionRoles,
          $application.variables.sessionRoles
        );
        const choices = fns.dashboardPersonas($application.variables.fusionRoles, $application.variables.sessionRoles);
        const allowed = (c) => choices.some((x) => x.code === c);
        let role = myRole;
        if (requested && allowed(requested)) {
          role = requested;
          saveView(role);
        } else if (!requested && allowed(savedView())) {
          role = savedView();
        }
        $page.variables.myRole = myRole;
        $page.variables.roleChoices = choices;
        const cfg  = dashConfig.forRole(role);

        // ── TESTING: no-persona path ──────────────────────────────────────
        // forRole returns null while its REQUESTOR fallback is disabled, so an
        // unresolved role surfaces LOUDLY here instead of quietly rendering a
        // requestor dashboard. Bail with an explicit message rather than
        // throwing on cfg.table below.
        // RESTORE: once both fallbacks are re-enabled cfg can never be null and
        // this whole block can be deleted.
        // EXTERNAL requestors do not belong on this page at all. They hold only
        // the EQR_CUST_* pages — no EQR_DASHBOARD grant — and have a
        // purpose-built customer dashboard whose tiles point at pages they can
        // actually open.
        //
        // The RBAC guard is supposed to catch this on vbBeforeEnter, but
        // canEnterPage FAILS OPEN while pageAccessMap is still loading, and the
        // map arrives after page entry on a cold load. So the guard admits them
        // and this chain is where it surfaces. Redirect rather than render an
        // error telling a customer user to go get an internal role.
        if (myRole === 'EXTERNAL_REQUESTOR'
            || (!cfg && fns.navVisible($application.variables.pageAccessMap,
                                       $application.variables.pageAccessLoaded,
                                       'EQR_CUST_DASHBOARD')
                     && !fns.hasInternalPageAccess($application.variables.pageAccessMap,
                                                   $application.variables.pageAccessLoaded))) {
          // Customer-only user: the customer portal's home (getRoleHomeTarget).
          // When the portal is off (CUSTOMERS_MODULE_ENABLED), Home says so and
          // links to Old EquipRite's portal instead.
          const target = fns.getRoleHomeTarget($application.variables.featureFlags, $application.variables.flagsLoaded,
            $application.variables.pageAccessMap, $application.variables.pageAccessLoaded);
          if (target && target.flow === 'customer') {
            await Actions.navigateToFlow(context, { flow: target.flow, page: target.page, target: 'parent' });
            return;
          }
          $page.variables.customerOnly = true;
          return;
        }

        if (!cfg) {
          console.error('[homeInitChain] no dashboard persona for role',
            JSON.stringify(role), '- fusionRoles:',
            $application.variables.fusionRoles, '- sessionRoles:',
            $application.variables.sessionRoles,
            '- sessionRolesLoaded:', $application.variables.sessionRolesLoaded);
          $page.variables.dashRole          = role || '(unresolved)';
          $page.variables.dashTitle         = 'Dashboard';
          $page.variables.dashSubtitle      = '';
          $page.variables.kpiCards          = [];
          $page.variables.kpis              = {};
          $page.variables.tableColumns      = [];
          $page.variables.dashRequestsArray = [];
          // View All must not outlive the persona. tableViewAllNav DEFAULTS to
          // equipment-requests, so leaving it set handed a user with no
          // persona a working button to a page nobody had cleared them for.
          // '' hides the button and gotoNavTargetChain no-ops on it.
          $page.variables.tableTitle        = '';
          $page.variables.tableViewAllNav   = '';
          $page.variables.fetchError =
            'No dashboard persona for your role. None of your Fusion roles is'
            + ' mapped in RBAC_ROLE_MAP to EQUIP_ADMIN, EQUIP_MGR, REQUESTOR,'
            + ' INSPECTION, TIMEKEEPER, TIME_APPROVER or FINANCE_USER.';
          return;
        }

        // ── TIMESHEETS OFF: notify, then sign the user out ──────────────────
        // TIMEKEEPER and TIME_APPROVER exist ONLY to work timesheets. With
        // TIMESHEETS_ENABLED off there is nothing in the app for them to do —
        // every page they hold is behind the same flag (projectsModuleGuardChain
        // bounces them straight back out), so leaving them signed in just loops
        // them between a dashboard and a rejection toast.
        //
        // The warning and the sign-out are BOTH bound to shouldSignOut(), which
        // is the one place TIMESHEETS_ENABLED is interpreted. With timesheets
        // ENABLED neither appears, and any timer a previous entry scheduled is
        // cancelled here — so the flag being true is sufficient to guarantee no
        // sign-out, whatever happened on an earlier load.
        if (shouldSignOut($application, fns, myRole)) {
          await Actions.fireNotificationEvent(context, {
            summary: 'Timesheets are not enabled',
            message: 'There is nothing available for your role while timesheets'
                   + ' are switched off. You will be signed out in 1 minute.',
            displayMode: 'transient',
            type: 'warning'
          });
          scheduleSignOut($application, fns, myRole);
          // Fall through and still render the dashboard: the user gets the full
          // minute to read the message rather than staring at a blank page.
        } else {
          cancelSignOut();
        }

        if (role === 'EQUIP_ADMIN') {
          await this.loadAdmin(context);
          return;
        }
        $page.variables.adminModel    = null;
        $page.variables.dashRole      = role;
        $page.variables.dashTitle     = cfg.title;
        $page.variables.dashSubtitle  = cfg.subtitle;
        $page.variables.tableTitle    = cfg.tableTitle;
        $page.variables.tableViewAllNav = cfg.tableViewAllNav;
        // Row-click routing key for navigateDashboardRowChain. Prefers an
        // explicit table.rowNav (INSPECTION: workbench-shaped rows that must
        // drill into picking) and falls back to the payload shape, which is the
        // right destination for every other persona.
        $page.variables.tableRowNav = cfg.table.rowNav || cfg.table.shape || '';
        // Columns drive the oj-table directly, so they must land before the
        // rows do — otherwise the table renders once with the OLD persona's
        // columns against the new persona's data.
        $page.variables.tableColumns  = cfg.table.columns;

        // One call for the table + one per declared extra, all in parallel.
        //
        // Each is individually caught. Promise.all REJECTS on the first throw,
        // so without this a single failing KPI call took down the whole page —
        // the table AND every tile — even though the table's own fetch had
        // succeeded. That is what made the Inspection dashboard render as bare
        // headers with "Unable to load dashboard data." and no KPI cards at all.
        //
        // A failed call resolves to null instead; the table reports its own
        // failure below, and a counter missing an extra just yields 0 for the
        // tiles that needed it rather than blanking the ones that did not.
        const safeCall = (endpoint, uriParams) =>
          Actions.callRest(context, { endpoint, uriParams })
            .catch((err) => {
              console.error('[homeInitChain] call failed:', endpoint, err);
              return null;
            });

        const extraDefs = cfg.extras || [];
        const responses = await Promise.all([
          safeCall(cfg.table.endpoint, cfg.table.uriParams),
          ...extraDefs.map((e) => safeCall(e.endpoint, e.uriParams))
        ]);

        const tableRes = responses[0];
        const extra = {};
        extraDefs.forEach((e, i) => { extra[e.key] = responses[i + 1]; });
        // Lets a counter read its own raw table payload (EQUIP_MGR needs the
        // line-grain rows, which the mapper collapses away).
        extra.__self = tableRes;

        if (!tableRes || !tableRes.ok) {
          console.warn('[homeInitChain] table fetch failed for', role,
            tableRes && tableRes.status, cfg.table.endpoint);
          $page.variables.dashRequestsArray = [];
          // Tiles are still rendered: their data comes from the `extras` calls,
          // which are independent of the table's. Blanking kpiCards here (as
          // this used to) hid every KPI whenever the TABLE alone failed.
          $page.variables.kpiCards = cfg.kpis;
          const c = COUNTERS[role];
          $page.variables.kpis = c ? (c([], extra) || {}) : {};
          $page.variables.fetchError = 'Unable to load the table for this dashboard.';
          return;
        }

        const mapper = MAPPERS[cfg.table.shape] || MAPPERS.myRequests;
        const raw    = rows(tableRes);

        // Both workbench and post-cost views FAN OUT below request grain, so
        // each needs collapsing before the table renders — but for different
        // reasons, so they are handled separately rather than by one flag.
        //
        //  • workbench — one row per LINE. totalLines/allocatedLines are
        //    analytic counts OVER (PARTITION BY request), so they already
        //    describe the whole request and taking them off the first row is
        //    correct, provided we don't recount rows ourselves. Dedupe.
        //
        //  • post-cost — one row per (request × ISO WEEK). Here the money is
        //    PER WEEK and must be summed, not taken from the first row. Group.
        let source = raw;
        if (cfg.table.shape === 'workbench') {
          source = dedupeByRequest(raw);
        } else if (cfg.table.shape === 'postCost') {
          source = groupPostCostByRequest(raw);
        }

        const mapped = source.map((r) => mapper(r, fns));
        sortRows(mapped, cfg.table.shape);

        $page.variables.dashRequestsArray = mapped;

        // No `|| COUNTERS.REQUESTOR` fallback: cfg is non-null by this point, so
        // the role IS a known persona and a missing counter would be a genuine
        // wiring bug (a config entry added with no matching counter). Silently
        // substituting requestor counts would render plausible WRONG numbers
        // under the new persona's labels — worse than empty tiles.
        const counter = COUNTERS[role];
        if (!counter) {
          console.error('[homeInitChain] no KPI counter for persona', role);
        }
        $page.variables.kpis = counter ? (counter(mapped, extra) || {}) : {};
        // Tiles are rendered from this array, so a persona with three KPIs
        // renders three cards without any per-role markup.
        $page.variables.kpiCards = cfg.kpis;
        $page.variables.fetchError = '';
      } catch (e) {
        console.error('[homeInitChain] unexpected error', e);
        $page.variables.dashRequestsArray = [];
        $page.variables.kpis = {};
        $page.variables.fetchError = 'Unable to load dashboard data.';
      } finally {
        $page.variables.isLoading = false;
      }
    }

    /**
     * The Administrator's Home: everything below in parallel, each call on its own (a failed one leaves its panel
     * empty, never the page), then adminDashboard.build(). Integration rows are read exactly as the Integration
     * health page reads them and graded by the same integrationHealth.model().
     */
    async loadAdmin(context) {
      const { $page, $application } = context;
      const fns = $application.functions;
      const vars = $application.variables;
      const on = (k) => !!fns.isFeatureEnabled(vars.featureFlags, vars.flagsLoaded, k);
      const safe = (endpoint, uriParams) => Actions.callRest(context, uriParams ? { endpoint, uriParams } : { endpoint })
        .catch((err) => { console.error('[homeInitChain] admin call failed:', endpoint, err); return null; });
      const none = Promise.resolve(null);
      const finance = dashConfig.ROLE_CONFIG.FINANCE_USER.table;
      const postCostsOn = on('PROJECTS_MODULE_ENABLED') && !on('PPM_RATES_ENABLED');

      $page.variables.dashRole = 'EQUIP_ADMIN';
      $page.variables.dashTitle = 'Administration';
      $page.variables.dashSubtitle = 'What needs an administrator across the whole operation, and how the system is running.';
      $page.variables.kpiCards = [];
      $page.variables.kpis = {};
      $page.variables.tableColumns = [];
      $page.variables.tableTitle = '';
      $page.variables.tableViewAllNav = '';
      $page.variables.dashRequestsArray = [];

      const names = ['requests', 'fleet', 'timesheets', 'postCost', 'events', 'errors', 'dlq', 'jobs', 'syncExceptions',
        'lock', 'certifications', 'portalUsers', 'audit', 'appRoles'];
      const res = await Promise.all([
        safe('eqp-v1/getEquipriteV1ViewsMyRequests', { size: 2000, filter: fns.myRequestsOriginFilter(vars.fusionRoles, vars.sessionRoles) }),
        safe('eqp-v1/getEquipriteV1ViewsYardStock', { groupBy: 'unitStatus' }),
        on('TIMESHEETS_ENABLED') ? safe('eqp-v1/getEquipriteV1ViewsTimesheetApprovals', { page: 0, size: 500 }) : none,
        postCostsOn ? safe(finance.endpoint, finance.uriParams) : none,
        safe('eqp-v1/getIntegrationEvents'),
        safe('eqp-v1/getErrorLogs'),
        safe('eqp-v1/getDeadLetterQueue'),
        safe('eqp-v1/getJobRunLogs', { orderBy: 'startedAt:desc', size: 200 }),
        safe('eqp-v1/getFusionSyncExceptions', { status: 'OPEN' }),
        safe('eqp-v1/getFusionSyncLock'),
        safe('eqp-v1/getEquipmentCertifications'),
        on('CUSTOMERS_MODULE_ENABLED') ? safe('eqp-v1/getCustomerPortalUsers') : none,
        safe('eqp-v1/getAuditTrail'),
        safe('eqp-v1/getRbacAppRoles'),
      ]);
      const r = {};
      names.forEach((n, i) => { r[n] = res[i]; });
      const ok = (x) => !!(x && x.ok);
      const failed = names.filter((n, i) => res[i] && !res[i].ok);

      const health = new IntegrationHealth();
      const healthModel = health.model({
        events: ok(r.events) ? health.rowsOf(r.events.body) : [],
        errors: ok(r.errors) ? health.rowsOf(r.errors.body) : [],
        dlq: ok(r.dlq) ? health.rowsOf(r.dlq.body) : [],
        jobs: ok(r.jobs) ? health.rowsOf(r.jobs.body) : [],
        syncExceptions: ok(r.syncExceptions) ? health.rowsOf(r.syncExceptions.body) : [],
        lock: ok(r.lock) ? (r.lock.body || null) : null,
      }, Date.now());

      let financeCounts = null;
      if (ok(r.postCost)) {
        const mapper = MAPPERS[finance.shape];
        // The Finance Home's own counter, given the raw payload too (it counts weeks off it), so both agree.
        financeCounts = COUNTERS.FINANCE_USER(groupPostCostByRequest(rows(r.postCost)).map((x) => mapper(x, fns)), { __self: r.postCost });
      }
      const modules = {};
      adminDashboard.MODULES.forEach((m) => { modules[m.key] = on(m.key); });

      $page.variables.adminModel = adminDashboard.build({
        requests: rows(r.requests),
        fleetGroups: rows(r.fleet),
        unitStatusLabel: analyticsData.unitStatusLabel,
        timesheetsSubmitted: rows(r.timesheets).filter((x) => {
          const st = String(x.timesheetStatus || x.status || '').toUpperCase();
          return !st || st === 'SUBMITTED';
        }).length,
        finance: financeCounts,
        health: healthModel,
        dlqOpen: (healthModel.kpis && healthModel.kpis.dlq) || 0,
        syncExceptions: ok(r.syncExceptions) ? health.rowsOf(r.syncExceptions.body).length : 0,
        certifications: rows(r.certifications),
        portalUsers: rows(r.portalUsers),
        audit: rows(r.audit),
        appRoles: rows(r.appRoles),
        modules,
      }, Date.now());
      $page.variables.fetchError = !ok(r.requests)
        ? 'Requests could not be loaded, so the request figures below are empty.'
        : (failed.length ? 'Some panels could not be loaded (' + failed.join(', ') + ').' : '');
    }
  }

  function dedupeByRequest(raw) {
    const byRequest = new Map();
    raw.forEach((r) => {
      const id = r.eqrEquipmentRequestId;
      if (id == null) return;
      if (!byRequest.has(id)) byRequest.set(id, r);
    });
    return Array.from(byRequest.values());
  }

  return homeInitChain;
});
