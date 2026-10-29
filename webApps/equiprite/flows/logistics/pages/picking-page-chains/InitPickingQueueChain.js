define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The picking queue. From the old initiate-picking-page InitPickingQueueChain: the same call
  // (views/workbench-requests?stage=INITIATE&size=1000, requests with header IN_PROCESS and at least one line
  // ready to pick), the same party / person rule for project and customer rows, newest first.
  //
  // Changed here, display only: the row also keeps taskName, requestedEndDate, totalEstCost and className
  // from the same response, for the queue's Project / task, End and Est. cost columns (wireframe), and rows
  // are de-duplicated per request (first row wins), as the returns queue already does, in case the view
  // answers one row per line.
  class InitPickingQueueChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      $page.variables.isLoading = true;
      $page.variables.fetchError = '';

      let response;
      try {
        response = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getEquipriteV1ViewsWorkbenchRequests',
          uriParams: { stage: 'INITIATE', size: 1000 },
        });
      } catch (e) {
        console.error('[InitPickingQueueChain] callRest threw:', e);
        $page.variables.fetchError = (e && e.message) || 'Network error loading the picking queue.';
        $page.variables.isLoading = false;
        return;
      }

      if (!response || !response.ok) {
        const msg = (response && response.body && response.body.message)
          || ('HTTP ' + (response && response.status) + ' loading the picking queue.');
        console.error('[InitPickingQueueChain] non-OK response:', response && response.status, response && response.body);
        $page.variables.fetchError = msg;
        $page.variables.isLoading = false;
        return;
      }

      const raw = (response.body && response.body.data) || [];
      const byRequest = new Map();
      raw.forEach((r) => {
        const id = r.eqrEquipmentRequestId != null ? r.eqrEquipmentRequestId : r.requestNumber;
        if (id == null || byRequest.has(id)) {
          return;
        }
        byRequest.set(id, r);
      });

      const records = Array.from(byRequest.values()).map((r) => {
        // Origin is 'EXTERNAL' | 'INTERNAL' (legacy 'CUSTOMER' | 'PROJECT').
        const isCustomer = context.$application.functions.isExternalSource(r.source);
        const party = isCustomer ? (r.customerName || r.projectName || '') : (r.projectName || r.customerName || '');
        const person = isCustomer ? (r.contactName || r.requestor || '') : (r.requestor || r.contactName || '');
        return {
          id: String(r.eqrEquipmentRequestId || r.requestNumber || ''),
          eqrEquipmentRequestId: r.eqrEquipmentRequestId,
          requestNumber: r.requestNumber || '',
          project: party,
          projectCode: '',
          taskName: isCustomer ? '' : (r.taskName || ''),
          requestor: person,
          location: r.location || '',
          allocationPct: r.allocationPct != null ? r.allocationPct : null,
          totalLines: r.totalLines != null ? r.totalLines : null,
          totalEstCost: r.totalEstCost != null ? r.totalEstCost : null,
          equipmentClass: r.className || '',
          source: r.source || '',
          isCustomer,
          status: r.requestStatus || '',
          priority: '',
          // Needed by = the requested start (there is no needed-by date at request grain).
          neededByDate: r.requestedStartDate ? r.requestedStartDate.slice(0, 10) : '',
          endDate: r.requestedEndDate ? r.requestedEndDate.slice(0, 10) : '',
          warehouse: '',
          subInventory: '',
          lines: [],
          pickingExceptions: [],
          rejectionReason: null,
        };
      });

      records.sort((a, b) => Number(b.eqrEquipmentRequestId || 0) - Number(a.eqrEquipmentRequestId || 0));

      $page.variables.PickingQueueAllArray = records;
      $page.variables.isLoading = false;
    }
  }

  return InitPickingQueueChain;
});
