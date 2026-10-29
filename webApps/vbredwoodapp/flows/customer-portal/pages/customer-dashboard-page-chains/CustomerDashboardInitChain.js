define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class CustomerDashboardInitChain extends ActionChain {

    async run(context) {
      const { $page } = context;

      // ── 1. Fire the two list endpoints in parallel ────────────────────────
      // Tile 1, table rows, and the seed list of IN_PROCESS request ids all
      // come from customer-my-requests. Tile 3 (pending invoices) comes
      // from customer-my-billing.
      // Query params MUST go under uriParams here — `parameters` is silently
      // dropped in this VB project (memory feedback_vb_callrest_uriparams.md).
      // Without uriParams the view defaults to size=20 and the tile counts
      // / Recent Activity table understate the actual data.
      const [requestsResult, invoicesResult] = await Promise.all([
        Actions.callRest(context, {
          endpoint:  'eqp-v1/getEquipriteV1ViewsCustomerMyRequests',
          uriParams: { page: 0, size: 200 }
        }),
        Actions.callRest(context, {
          endpoint:  'eqp-v1/getEquipriteV1ViewsCustomerMyBilling',
          uriParams: { page: 0, size: 200 }
        })
      ]);

      // ── 2. Map requests into the My Requests row shape ────────────────────
      const requests = (requestsResult.ok && requestsResult.body && Array.isArray(requestsResult.body.data))
        ? requestsResult.body.data.map(r => ({
            id:              r.eqrEquipmentRequestId || r.rowId,
            requestNumber:   r.requestNumber         || '',
            customerName:    r.customerName          || '',
            customerContact: r.customerContact       || '',
            agreementType:   r.agreementType         || '',
            status:          r.requestStatus         || '',
            startDate:       r.startDate    ? r.startDate.substring(0, 10)   : '',
            endDate:         r.endDate      ? r.endDate.substring(0, 10)     : '',
            lines:           r.lines        || 0,
            createdDate:     r.createdDate  ? r.createdDate.substring(0, 10) : '',
            // Raw createdDate kept for sorting; substring above loses time.
            _createdRaw:     r.createdDate  || null
          }))
        : [];

      // ── 3. Tile 1: Active = post-submit, pre-close header status ──────────
      // Customer submits now land the header at IN_PROCESS directly (see
      // SubmitRequestChain) — SUBMITTED is kept for legacy/project-origin rows
      // that still pass through it. Overlap with Tile 2's ACTIVE_HEADER set is
      // intentional: these tiles count different things (requests here vs.
      // DEPLOYED lines there), so a request can legitimately feed both.
      const ACTIVE_REQUEST_HEADER = ['SUBMITTED', 'IN_PROCESS'];
      const activeCount = requests
        .filter(r => ACTIVE_REQUEST_HEADER.indexOf(r.status) !== -1).length;

      // ── 4. Tile 2: Equipment On-Site
      // For every request in an active post-accept header status, hit the
      // per-request lines endpoint and count lines whose lineStatus is
      // DEPLOYED. Customer requests reach deployed lines via QUOTE_ACCEPTED
      // (the customer-flow rename of IN_PROCESS); IN_PROCESS is kept for any
      // legacy/project-origin rows. NOTE: UNDER_PROCUREMENT is a LINE-only
      // status — the request HEADER never carries it, so it is NOT a header
      // filter value here. Per project memory (project_request_line_status_
      // cascade.md) lineStatus is a separate column from allocationStatus and
      // is the authoritative request-line lifecycle. The OpenAPI spec omits it
      // (feedback_openapi_db_drift.md) but the column exists in the DB and
      // the GET returns it. Fire all per-request fetches in parallel.
      const ACTIVE_HEADER = ['IN_PROCESS', 'QUOTE_ACCEPTED'];
      const inProcessRequests = requests.filter(r => ACTIVE_HEADER.indexOf(r.status) !== -1);
      let deployedLineCount = 0;
      if (inProcessRequests.length > 0) {
        const lineResults = await Promise.all(
          inProcessRequests.map(r => Actions.callRest(context, {
            endpoint:  'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2',
            uriParams: { requestId: r.id, size: 2000 }
          }).catch(e => ({ ok: false, error: e })))
        );
        deployedLineCount = lineResults.reduce((sum, res) => {
          if (res && res.ok && res.body && Array.isArray(res.body.data)) {
            return sum + res.body.data.filter(l => l.lineStatus === 'DEPLOYED').length;
          }
          return sum;
        }, 0);
      }

      // ── 5. Tile 3: Pending / Overdue invoices ────────────────────────────
      const invoices = (invoicesResult.ok && invoicesResult.body && Array.isArray(invoicesResult.body.data))
        ? invoicesResult.body.data
        : [];
      const pendingCount = invoices.filter(i => i.status === 'PENDING').length;
      const overdueCount = invoices.filter(i => i.status === 'OVERDUE').length;

      // ── 6. Recent Activity: sort by createdDate desc, slice 10 ───────────
      const recent = requests
        .slice()
        .sort((a, b) => {
          const aT = a._createdRaw ? new Date(a._createdRaw).getTime() : 0;
          const bT = b._createdRaw ? new Date(b._createdRaw).getTime() : 0;
          return bT - aT;
        })
        .slice(0, 10)
        .map(r => {
          // Strip the sort-only field so the ADP rows stay clean.
          const { _createdRaw, ...rest } = r;
          return rest;
        });

      // ── 7. Publish to page variables ──────────────────────────────────────
      $page.variables.activeRequestsCount  = activeCount;
      $page.variables.totalRequestsCount   = requests.length;
      $page.variables.onSiteCount          = deployedLineCount;
      $page.variables.pendingInvoicesCount = pendingCount;
      $page.variables.overdueCount         = overdueCount;
      $page.variables.recentRequestsArray  = recent;
    }
  }

  return CustomerDashboardInitChain;
});
