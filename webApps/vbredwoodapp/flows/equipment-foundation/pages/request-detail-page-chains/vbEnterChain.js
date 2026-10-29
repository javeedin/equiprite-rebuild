define([
  'vb/action/actionChain',
  'vb/action/actions',
  'vb/action/actionUtils',
  'resources/js/requestDetailLines',
], (ActionChain, Actions, _au, rdl) => {
  'use strict';

  class vbEnterChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;

      const requestId     = $page.variables.requestId;
      const requestNumber = $page.variables.requestNumber;

      if (!requestId) {
        console.warn('[request-detail vbEnterChain] No requestId in page variables.');
        return;
      }

      // ── Fetch in parallel ───────────────────────────────────────────────
      // 1. workbench-requests (by id) → request-level HEADER fields only.
      // 2. request-detail-lines → fully-enriched LINES (one row per line,
      //    availability computed server-side via EQR_AVAILABILITY_PKG).
      //    Replaces the former 8-call fan-out + serial N+1 + TO two-hop.
      //    yardId is omitted on initial load → availability spans all orgs;
      //    the Yard LOV re-scopes via RescopeYardChain.
      const [headerResp, linesResult] = await Promise.all([
        Actions.callRest(context, {
          endpoint:  'eqp-v1/getEquipriteV1ViewsWorkbenchRequests',
          uriParams: { eqrEquipmentRequestId: Number(requestId) }
        }),
        rdl.fetchAndBuild(context, Actions, requestId, null)
      ]);

      // ── Header (request-level fields from workbench-requests row 0) ─────
      if (!headerResp || !headerResp.ok) {
        console.warn('[request-detail vbEnterChain] Failed to fetch workbench-requests for header.');
        return;
      }

      // Server-side scoped by eqrEquipmentRequestId — rows are already this
      // request's lines (one row per line). No client-side filter needed.
      const wbRows = headerResp.body.data || [];

      if (!wbRows.length) {
        console.warn('[request-detail vbEnterChain] No workbench rows for requestId:', requestId);
        return;
      }

      const header = wbRows[0];
      const formatDate = iso => iso ? iso.slice(0, 10) : '';

      $page.variables.pageTitle    = header.requestNumber || requestNumber || '';
      $page.variables.pageSubtitle = '';

      $page.variables.formData = {
        request_number:   header.requestNumber       || '',
        status:           header.requestStatus       || '',
        source:           header.source              || '',
        project_customer: header.projectOrCustomer   || header.projectName || header.customerName || '',
        task:             header.taskName            || '',
        requestor:        header.requestor           || header.contactName || '',
        location:         header.location            || '',
        start_date:       formatDate(header.requestedStartDate),
        end_date:         formatDate(header.requestedEndDate),
        total_est_cost:   header.totalEstCost        || 0
      };

      // Externally-sourced (customer) request? `source` is a server-derived
      // column carrying the request origin — 'EXTERNAL' | 'INTERNAL' (formerly
      // 'CUSTOMER' | 'PROJECT'). Resolved through the app-flow owner so the
      // vocabulary lives in exactly one place; it accepts both spellings.
      // The PR drawer reads this to hide all project-derived fields and the
      // submit chain re-checks it to never send a projectDFF — an external PR
      // is raised with our supplier and has no project applicability.
      $page.variables.isCustomerRequest = $application.functions.isExternalSource(
        ($page.variables.formData || {}).source
      );

      // Does the ENABLE_QUOTES global setting permit quoting for this request's
      // origin? Resolved HERE (not in updateActionButtons) because that's a
      // page-module method whose callers pass only $page — it can't reach
      // $application. The app-flow resolver owns the NONE/PROJECTS/CUSTOMER/BOTH
      // matrix; this is just where the answer is cached for the page. Must be set
      // BEFORE updateActionButtons runs below, or the quote button reads stale.
      $page.variables.quotingAllowed = $application.functions.isQuotingAllowed(
        $application.variables.globalSettings,
        $application.variables.flagsLoaded,
        ($page.variables.formData || {}).source
      );

      // Is External Project Assign switched on? Same reasoning as
      // quotingAllowed above: resolved HERE and cached on the page because
      // updateActionButtons is a page-module method whose callers pass only
      // $page, so it can't reach $application. isFeatureEnabled is the generic
      // FEATURE_FLAG accessor (no bespoke resolver to drift) and fails CLOSED,
      // so with the flag off — or still loading — the Assign Project button
      // stays hidden and Confirm keeps its pre-feature gate. Must be set BEFORE
      // updateActionButtons runs below.
      $page.variables.externalProjectAssignEnabled = $application.functions.isFeatureEnabled(
        $application.variables.featureFlags,
        $application.variables.flagsLoaded,
        'EXTERNAL_PROJECT_ASSIGN_ENABLED'
      );

      // ── Lines (from the enriched endpoint, built by the shared module) ──
      rdl.applyLines($page, linesResult.lines);

      // Derive the action-button state on load. Most gates need a selection and
      // so resolve to false here, but the quote button's VISIBILITY and LABEL
      // come from the header (source + status), not the selection: an already
      // quoted request must read "View Quote" enabled the moment the page opens,
      // and a project request must hide the button without the user touching a
      // row. Otherwise updateActionButtons only ever runs on selection change.
      if ($page.functions && typeof $page.functions.updateActionButtons === 'function') {
        $page.functions.updateActionButtons($page);
      }

      // Give the Assign Project drawer's Task picker a real (empty) data
      // provider before it is ever rendered. assignTasksDp is built in JS and
      // so defaults to null, and an oj-select-single bound to null data has no
      // provider to ask. With no project staged this chain resolves to an empty
      // provider immediately; the drawer-open path replaces it with the real
      // one. Cheap: no project id at page load means no fetch.
      await Actions.callChain(context, { chain: 'LoadTaskTreeChain' });
    }
  }

  return vbEnterChain;
});
