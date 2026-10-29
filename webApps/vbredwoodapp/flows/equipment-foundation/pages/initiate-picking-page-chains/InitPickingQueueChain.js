define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class InitPickingQueueChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      $page.variables.isLoading  = true;
      $page.variables.fetchError = '';

      let response;
      try {
        // The picking queue is the "requests ready to initiate picking" set:
        // workbench-requests?stage=INITIATE returns exactly that (header IN_PROCESS
        // + at least one ALLOCATED line), request-grain — same view the workbench
        // uses. (Was views/in-process.)
        response = await Actions.callRest(context, {
          endpoint:  'eqp-v1/getEquipriteV1ViewsWorkbenchRequests',
          uriParams: { stage: 'INITIATE', size: 1000 }
        });
      } catch (e) {
        console.error('[InitPickingQueueChain] callRest threw:', e);
        $page.variables.fetchError = (e && e.message) || 'Network error loading picking queue.';
        $page.variables.isLoading  = false;
        return;
      }

      if (!response || !response.ok) {
        const msg =
              (response && response.body && response.body.message) ||
              ('HTTP ' + (response && response.status) + ' loading picking queue.');
        console.error('[InitPickingQueueChain] non-OK response:', response && response.status, response && response.body);
        $page.variables.fetchError = msg;
        $page.variables.isLoading  = false;
        return;
      }

      const raw = response.body.data || [];
      console.log('[InitPickingQueueChain] received', raw.length, 'rows');

      // ── Map server rows → the shape the rest of the page consumes ──────
      // Server row (workbench-requests): eqrEquipmentRequestId, source,
      //   requestNumber, requestStatus, projectName, taskName, requestor,
      //   requestedStartDate, requestedEndDate, location, totalLines,
      //   allocationPct, totalEstCost, customerName, contactName.
      // One row per request — no per-line detail (lines arrive on demand when
      // the drawer opens, which derives its own per-line picking status).
      //
      // neededBy doesn't exist at request grain, so Needed By → requestedStartDate.
      //
      // PROJECT vs CUSTOMER rows carry their party in different fields:
      //   PROJECT  → projectName  + requestor   (internal project request)
      //   CUSTOMER → customerName + contactName (outsourced/customer request)
      // customerName is the semantic equivalent of projectName, so both feed
      // the single "Project" column, and contactName stands in as the
      // requestor. Falling back across both keeps the column populated even
      // when `source` is absent or a row is mislabelled.
      const records = raw.map(r => {
        // Origin is 'EXTERNAL' | 'INTERNAL' (was 'CUSTOMER' | 'PROJECT').
        const isCustomer = context.$application.functions.isExternalSource(r.source);
        const party = isCustomer
          ? (r.customerName || r.projectName  || '')
          : (r.projectName  || r.customerName || '');
        const person = isCustomer
          ? (r.contactName || r.requestor   || '')
          : (r.requestor   || r.contactName || '');

        return {
          id:              String(r.eqrEquipmentRequestId || r.requestNumber || ''),
          eqrEquipmentRequestId: r.eqrEquipmentRequestId,
          requestNumber:   r.requestNumber       || '',
          project:         party,
          projectCode:     '',
          requestor:       person,
          location:        r.location            || '',
          allocationPct:   r.allocationPct != null ? r.allocationPct : null,
          totalLines:      r.totalLines != null ? r.totalLines : null,
          source:          r.source              || '',
          isCustomer:      isCustomer,
          status:          r.requestStatus       || '',
          priority:        '',
          neededByDate:    r.requestedStartDate ? r.requestedStartDate.slice(0, 10) : '',
          warehouse:       '',
          subInventory:    '',
          lines:           [],
          pickingExceptions: [],
          rejectionReason: null,
        };
      });

      records.sort((a, b) => Number(b.eqrEquipmentRequestId || 0) - Number(a.eqrEquipmentRequestId || 0));

      $page.variables.PickingQueueAllArray      = records;
      $page.variables.PickingQueueFilteredArray = [...records];

      $page.variables.isLoading = false;
    }
  }

  return InitPickingQueueChain;
});
