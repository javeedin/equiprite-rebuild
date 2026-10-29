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
        // stage=RETURN is a server-side lifecycle filter on this view:
        // header status IN_PROCESS or DEPLOYED AND at least one return line
        // (DEPLOYED / RETURN_INITIATED / RETURN_IN_PROCESS / SHIPPED_TO_YARD).
        // That is exactly the Equipment Return queue definition — no
        // client-side header/line status filtering needed.
        response = await Actions.callRest(context, {
          endpoint:  'eqp-v1/getEquipriteV1ViewsWorkbenchRequests',
          uriParams: { stage: 'RETURN', size: 1000 }
        });
      } catch (e) {
        console.error('[InitPickingQueueChain] callRest threw:', e);
        $page.variables.fetchError = (e && e.message) || 'Network error loading return queue.';
        $page.variables.isLoading  = false;
        return;
      }

      if (!response || !response.ok) {
        const msg =
              (response && response.body && response.body.message) ||
              ('HTTP ' + (response && response.status) + ' loading return queue.');
        console.error('[InitPickingQueueChain] non-OK response:', response && response.status, response && response.body);
        $page.variables.fetchError = msg;
        $page.variables.isLoading  = false;
        return;
      }

      const raw = response.body.data || [];
      console.log('[InitPickingQueueChain] received', raw.length, 'rows (stage=INBOUND, one row per line)');

      // ── Dedupe to one row per request ───────────────────────────────────
      // /views/workbench-requests returns one row per request LINE (see
      // project_workbench_endpoints memory), but this queue grid is
      // request-level. First line row for a given request wins for the
      // header-level fields; per-line detail still loads on demand when the
      // drawer opens (openPickingDrawerChain).
      const byRequest = new Map();
      raw.forEach(r => {
        const id = r.eqrEquipmentRequestId;
        if (id == null || byRequest.has(id)) return;
        byRequest.set(id, r);
      });

      // ── Map server rows → the shape the rest of the page consumes ──────
      // Server row (workbench-requests): eqrEquipmentRequestId, requestNumber,
      //   requestStatus, projectName, taskName, requestor, className,
      //   requestedStartDate, requestedEndDate, totalLines, allocatedLines,
      //   source, customerName, contactName.
      // No projectNumber / neededBy / pickingStatus on this view — mapped
      // from the closest available fields below.
      //
      // PROJECT vs CUSTOMER rows carry their party in different fields:
      //   PROJECT  → projectName  + requestor   (internal project request)
      //   CUSTOMER → customerName + contactName (outsourced/customer request)
      // customerName is the semantic equivalent of projectName, so both feed
      // the single "Project" column, and contactName stands in as the
      // requestor. Falling back across both keeps the column populated even
      // when `source` is absent or a row is mislabelled.
      const records = Array.from(byRequest.values()).map(r => {
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
          source:          r.source              || '',
          isCustomer:      isCustomer,
          project:         party,
          projectCode:     r.taskName            || '',
          requestor:       person,
          equipmentClass:  r.className           || '',
          status:          r.requestStatus       || '',
          neededByDate:    r.requestedEndDate ? r.requestedEndDate.slice(0, 10) : '',
          warehouse:       '',
          subInventory:    '',
          // Per-line detail arrives on demand via openPickingDrawerChain.
          lines:           [],
          pickingExceptions: [],
          rejectionReason: null,
        };
      });

      records.sort((a, b) => Number(b.eqrEquipmentRequestId || 0) - Number(a.eqrEquipmentRequestId || 0));

      $page.variables.PickingQueueAllArray      = records;
      $page.variables.PickingQueueFilteredArray = [...records];
      $page.variables.tabCountAll               = records.length;

      // Derive unique equipment classes (filter out null/empty)
      const classSet = new Set(records.map(r => r.equipmentClass).filter(Boolean));
      $page.variables.classesArray = Array.from(classSet).sort()
        .map(c => ({ value: c, label: c }));

      $page.variables.isLoading = false;
    }
  }

  return InitPickingQueueChain;
});
