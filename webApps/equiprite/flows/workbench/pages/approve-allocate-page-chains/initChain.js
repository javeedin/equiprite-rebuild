define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestDetailLines',
], (ActionChain, Actions, rdl) => {
  'use strict';

  // Loads the request. Carried over from the old Workbench's request page (equipment-foundation
  // request-detail-page-chains/vbEnterChain.js), which is where an old Workbench row lands:
  //   views/workbench-requests?eqrEquipmentRequestId=  the header (request-level fields)
  //   requestDetailLines.fetchAndBuild (copied unchanged) the lines: views/request-detail-lines, plus the old page's
  //                                     purchase-requisition and failed-Transfer-Order enrichment
  // in parallel, as there. Also called by the approve / reject chains (copied from Request detail) to refresh, with
  // { requestId: request number, requestNumericId }.
  const TRIES = 60;
  const GAP_MS = 50;

  class initChain extends ActionChain {
    async run(context, params) {
      const { $page, $application } = context;
      const fns = $application.functions;
      const vars = $application.variables;
      const p = params || {};
      const requestNumericId = p.requestNumericId || $page.variables.requestNumericId;
      if (!requestNumericId) {
        console.error('[approve-allocate initChain] No requestNumericId; cannot load', p.requestId);
        $page.variables.isLoading = false;
        $page.variables.fetchError = 'No request was given. Open it from the Workbench.';
        return;
      }
      $page.variables.requestNumericId = Number(requestNumericId);
      $page.variables.isLoading = true;
      $page.variables.fetchError = '';
      // Quoting and page access come with the app's settings; wait briefly for them.
      for (let i = 0; i < TRIES && !(vars.flagsLoaded && vars.pageAccessLoaded); i++) {
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
      $page.variables.isReadOnly = !!fns.isPageReadOnly(vars.pageAccessMap, vars.pageAccessLoaded, 'EQR_WORKBENCH');

      let headerResp;
      let linesResult;
      try {
        [headerResp, linesResult] = await Promise.all([
          Actions.callRest(context, {
            endpoint:  'eqp-v1/getEquipriteV1ViewsWorkbenchRequests',
            uriParams: { eqrEquipmentRequestId: Number(requestNumericId) }
          }),
          rdl.fetchAndBuild(context, Actions, requestNumericId, null)
        ]);
      } catch (e) {
        console.error('[approve-allocate initChain] load failed', e);
        $page.variables.isLoading = false;
        $page.variables.fetchError = 'This request could not be loaded.';
        return;
      }
      $page.variables.isLoading = false;

      const wbRows = (headerResp && headerResp.ok && headerResp.body && Array.isArray(headerResp.body.data))
        ? headerResp.body.data : [];
      if (!wbRows.length) {
        $page.variables.fetchError = headerResp && headerResp.ok
          ? 'This request is not on the Workbench.'
          : 'This request could not be loaded (HTTP ' + (headerResp && headerResp.status) + ').';
        return;
      }
      if (!linesResult || !linesResult.ok) {
        $page.variables.fetchError = 'The lines of this request could not be loaded.';
        return;
      }

      // Header: the old vbEnterChain's formData, in camelCase, plus the origin and a customer name.
      const header = wbRows[0];
      const day = (iso) => (iso ? String(iso).slice(0, 10) : '');
      const isCustomer = !!fns.isExternalSource(header.source);
      $page.variables.formData = {
        requestNumber:   header.requestNumber || p.requestId || $page.variables.requestId || '',
        status:          header.requestStatus || '',
        source:          header.source || '',
        isCustomer:      isCustomer,
        projectCustomer: header.projectOrCustomer || header.projectName || header.customerName || '',
        project:         header.projectName || '',
        customer:        header.customerName || '',
        task:            header.taskName || '',
        requestor:       header.requestor || header.contactName || '',
        location:        header.location || '',
        startDate:       day(header.requestedStartDate),
        endDate:         day(header.requestedEndDate),
        totalEstCost:    header.totalEstCost || 0
      };
      if (!$page.variables.requestId) {
        $page.variables.requestId = $page.variables.formData.requestNumber;
      }
      // ENABLE_QUOTES for this request's origin (the old vbEnterChain caches it the same way).
      $page.variables.quotingAllowed = !!fns.isQuotingAllowed(vars.globalSettings, vars.flagsLoaded, header.source);

      // Lines: requestDetailLines.mapRow's shape, plus the three names the copied approve / reject chains read.
      const lines = (linesResult.lines || []).map((l) => Object.assign(l, {
        lineId:        String(l.line_id !== undefined && l.line_id !== null ? l.line_id : l.line_no),
        lineStatus:    l.line_status || '',
        equipmentName: l.equipment_name || ''
      }));
      $page.variables.lines = $page.functions.initGridData(lines);
      $page.variables.selectionTick = ($page.variables.selectionTick || 0) + 1;
    }
  }

  return initChain;
});
