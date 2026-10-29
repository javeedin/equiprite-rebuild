define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Dashboard row click → the drill-down that MATCHES THE TABLE the row came
  // from.
  //
  // WHAT WAS WRONG: onRowAction was hardwired to navigateToRequestDetailChain
  // for every persona, with parameters read straight off the row as
  // requestNumber / eqrEquipmentRequestId. Each dashboard shows a DIFFERENT
  // table, so for four of the six personas that was the wrong destination, and
  // for two of them the parameters did not even exist on the row:
  //
  //   persona        table                 old result
  //   EQUIP_MGR      outbound workbench    request detail  (plausible, kept)
  //   REQUESTOR      my requests           request detail  (correct)
  //   INSPECTION     picking queue         request detail  (should be picking)
  //   TIMEKEEPER     my timesheets         request detail with requestNumericId
  //                                        UNDEFINED — the row carries
  //                                        eqrTimeEntryId, not a request id
  //   TIME_APPROVER  timesheet approvals   ditto, and that shape carries NO id
  //                                        at all — only requestNumber + week
  //   FINANCE_USER   post cost             request detail  (should be post-cost)
  //
  // That is the "snaggy" behaviour: a click that lands on a page the persona has
  // no business on, sometimes half-initialised because a required numeric id
  // arrived as undefined.
  //
  // ROUTES BY PAYLOAD SHAPE, NOT BY ROLE — the same principle dashboardInitChain
  // already follows for its row mappers ("the chain never branches on role, only
  // on payload shape, which is what actually differs"). Two personas sharing a
  // shape should drill down the same way, and a new persona reusing an existing
  // shape gets correct navigation for free.
  //
  // Each destination MIRRORS the chain the corresponding list page already uses,
  // so a row opens identically whether reached from the dashboard or from the
  // full table. Param names differ between those pages (timesheet-detail wants
  // `requestId`, timesheet-approval-detail wants `requestNumber`) and are
  // reproduced exactly rather than normalised.
  class navigateDashboardRowChain extends ActionChain {
    /**
     * @param {Object} context
     * @param {Object} params
     * @param {Object} params.row   the clicked row (already mapped by dashboardInitChain)
     * @param {string} params.shape dashboardRoleConfig table shape for this persona
     */
    async run(context, params) {
      // oj-table fires firstSelectedRowChanged PART WAY THROUGH its own
      // select-and-focus sequence. Navigating synchronously from here tore the
      // page down mid-sequence, and the dying table then tried to resolve the
      // key of a row whose data was already gone:
      //   TypeError: Cannot read properties of undefined (reading 'key')
      //     at GetKey / _fireBeforeSelectEvent / HandleSelectionOption
      // reported by VB as "Fatal exception delivering binding updates", which
      // aborts the rest of that binding-delivery cycle. Yield one macrotask so
      // the table finishes selecting before the route changes. Navigation
      // behaviour is unchanged.
      await new Promise(resolve => setTimeout(resolve, 0));

      const { $application } = context;
      const row   = (params && params.row) || null;
      const shape = String((params && params.shape) || '');

      if (!row) return;

      // Cross-flow navigation helper. This page lives in 'main' but four of the
      // five destinations are in 'equipment-foundation', so BOTH branches are
      // live — exactly the situation gotoNavTargetChain documents on this same
      // page: navigateToFlow + target:'parent' throws
      // "getLeafPageInstanceFromFlowId of null" when the target flow is already
      // displayed, while omitting 'parent' 404s on a genuine cross-flow hop.
      // isSameFlow() is the app's owner of that test; reusing it keeps this
      // chain correct if a destination ever moves between flows.
      const go = async (flow, page, pageParams) => {
        if ($application.functions.isSameFlow($application.currentPage, flow)) {
          await Actions.navigateToPage(context, { page: page, params: pageParams });
        } else {
          await Actions.navigateToFlow(context, {
            flow:   flow,
            page:   page,
            target: 'parent',
            params: pageParams
          });
        }
      };

      const requestNumber = row.requestNumber && row.requestNumber !== '—'
        ? String(row.requestNumber)
        : '';

      switch (shape) {

        // ── Picking queue → the picking drawer on its own page ─────────────
        // initiate-picking opens a DRAWER rather than a detail page
        // (openPickingDrawerChain takes the whole row). We cannot open that
        // drawer from here, so navigate to the page and let the user pick the
        // row there — still the right destination, which is the point.
        case 'workbenchPicking':
          await go('equipment-foundation', 'initiate-picking');
          return;

        // ── My timesheets → timesheet detail ──────────────────────────────
        // Mirrors equipment-timesheets-page's CardClickChain, including its
        // `requestId` param name (which carries the request NUMBER).
        case 'timesheets':
          if (!requestNumber) return;
          await go('equipment-foundation', 'timesheet-detail', {
            requestId:     requestNumber,
            projectName:   row.project       || '',
            weekStartDate: row.weekStartDate || ''
          });
          return;

        // ── Timesheet approvals → approval detail ─────────────────────────
        // Mirrors timesheet-approvals-page's CardClickChain. Note this one uses
        // `requestNumber`, not `requestId`.
        case 'timesheetApprovals':
          if (!requestNumber) return;
          await go('equipment-foundation', 'timesheet-approval-detail', {
            requestNumber: requestNumber,
            weekStartDate: String(row.weekStartDate || ''),
            projectName:   row.project || ''
          });
          return;

        // ── Post cost → the redesigned drill-down ─────────────────────────
        // Mirrors post-cost-test-page's CardClickChain. Everything except
        // requestNumber is optional there and defaults to 0/'', so the ppm*
        // and rateSchedule fields are passed when the row still carries them
        // (see the _raw passthrough in dashboardInitChain's postCost mapper)
        // and omitted otherwise — the detail page re-resolves what it needs.
        case 'postCost': {
          if (!requestNumber) return;
          const raw = row._raw || {};
          await go('equipment-foundation', 'post-cost-test-detail', {
            requestNumber:     requestNumber,
            internalRequestId: Number(row.eqrEquipmentRequestId) || 0,
            projectName:       row.project || '',
            taskName:          raw.taskName || '',
            ppmProjectNumber:  raw.ppmProjectNumber || '',
            ppmTaskNumber:     raw.ppmTaskNumber    || '',
            ppmBusinessUnit:   raw.ppmBusinessUnit  || '',
            ppmProjectRefId:   Number(raw.ppmProjectRefId) || 0,
            ppmTaskRefId:      Number(raw.ppmTaskRefId)    || 0,
            rateScheduleId:    Number(raw.rateScheduleId)  || 0,
            weekStartDate:     row.weekStartDate || '',
            weekEndDate:       raw.weekEndDate   || '',
            plannedStartDate:  row.startDate     || '',
            plannedEndDate:    row.endDate       || ''
          });
          return;
        }

        // ── Request-grain tables → request detail ─────────────────────────
        // 'myRequests' (REQUESTOR) and 'workbench' (EQUIP_MGR). Both rows carry
        // a real request number AND numeric id, which is what the detail page's
        // enriched-lines endpoint needs. This is the ONE case the old
        // hardwired behaviour got right.
        case 'myRequests':
        case 'workbench':
        default:
          if (!requestNumber) return;
          // equipment-request-detail lives in 'main', the same flow as this
          // dashboard, so go() takes its navigateToPage branch here.
          await go('main', 'equipment-request-detail', {
            requestId:        requestNumber,
            requestNumericId: row.eqrEquipmentRequestId,
            returnTo:         'main-equiprite',
            sourcePage:       'Equipment Requests'
          });
          return;
      }
    }
  }

  return navigateDashboardRowChain;
});
