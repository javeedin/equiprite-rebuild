define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Customer-mode request detail loader.
  // Header fields (customerName, customerContact) come from the
  // customer-request-details view (first row only — used only for the banner).
  // Line rows come from getEquipriteV1ViewsRequestDetailLines, which returns
  // exactly one fully-enriched row per line (equipmentName, className,
  // lineStatus, qty, dates, billRate all included — no join inflation).
  class initChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const requestId = params.requestId || $page.variables.requestId;
      var requestNumericId = params.requestNumericId || $page.variables.requestNumericId;

      if (!requestId) {
        console.error('[initChain] No requestId found.');
        return;
      }

      // ── 1. Header data from customer view (first matching row only) ────────
      const headerResult = await Actions.callRest(context, {
        endpoint:  'eqp-v1/getEquipriteV1ViewsCustomerRequestDetails',
        uriParams: { page: 0, size: 10000 }
      });

      var first = null;
      if (headerResult.ok && headerResult.body && Array.isArray(headerResult.body.data)) {
        const matching = headerResult.body.data.filter(r => r.requestNumber === requestId);
        if (matching.length > 0) {
          first = matching[0];
          if (!requestNumericId && first.eqrEquipmentRequestId != null) {
            requestNumericId = first.eqrEquipmentRequestId;
          }
        }
      }

      if (requestNumericId) {
        $page.variables.requestNumericId = Number(requestNumericId);
      }

      $page.variables.formData = {
        requestNumber:   (first && first.requestNumber)       || requestId,
        customerName:    (first && first.customerName)        || '',
        customerContact: (first && first.customerContact)     || '',
        status:          (first && first.requestStatus)       || '',
        startDate:       (first && first.startDate)  ? first.startDate.substring(0, 10)  : '',
        endDate:         (first && first.endDate)    ? first.endDate.substring(0, 10)    : '',
        location:        (first && (first.deploymentLocation || first.location)) || ''
      };

      if (!requestNumericId) {
        console.error('[initChain] No requestNumericId — cannot load lines.');
        return;
      }

      // ── 2. Lines from the enriched view (1 row per line, no inflation) ─────
      const linesResult = await Actions.callRest(context, {
        endpoint:  'eqp-v1/getEquipriteV1ViewsRequestDetailLines',
        uriParams: { requestId: Number(requestNumericId), size: 10000 }
      });

      if (!linesResult.ok || !linesResult.body || !Array.isArray(linesResult.body.data)) {
        console.warn('[initChain] No lines returned from RequestDetailLines for requestId:', requestNumericId);
        return;
      }

      const rows = linesResult.body.data;

      // deploymentLocation lives on each line row — pick it from the first
      if (rows.length > 0 && rows[0].deploymentLocation) {
        $page.variables.formData = Object.assign({}, $page.variables.formData, {
          location: rows[0].deploymentLocation
        });
      }

      const mappedLines = rows.map(function(r, index) {
        return {
          lineId:         String(r.lineId !== undefined && r.lineId !== null ? r.lineId : (r.id !== undefined ? r.id : index + 1)),
          equipmentName:  r.equipmentName  || '',
          equipmentClass: r.className      || r.equipmentClass || '',
          quantity:       r.quantity       !== undefined && r.quantity !== null ? r.quantity : '',
          utilizationPct: r.targetUtilPercent !== undefined && r.targetUtilPercent !== null ? r.targetUtilPercent : '',
          lineStatus:     r.lineStatus     || '',
          // Consumable identity + V243 counters, same as the project-mode page.
          // Resolved server-side off the SUBCLASS - never from className (a taxonomy
          // accident) nor the master's own drifted IS_CONSUMABLE_FLAG.
          consumableFlag:    r.consumableFlag || 'N',
          // Per-subclass auto-consume (V312) - same provenance as consumableFlag.
          // acceptDeliveryChain gates on this per line; absent => 'N' => manual issue.
          autoConsumeFlag:   r.autoConsumeFlag || 'N',
          deliveredQuantity: r.deliveredQuantity != null ? Number(r.deliveredQuantity) : null,
          consumedQuantity:  r.consumedQuantity  != null ? Number(r.consumedQuantity)  : null,
          startDate:      r.startDate      ? r.startDate.substring(0, 10)  : '',
          endDate:        r.endDate        ? r.endDate.substring(0, 10)    : '',
          billRate:       r.billRate       !== undefined && r.billRate !== null ? r.billRate : ''
        };
      });

      // Per-line returnability, kept in step with InitiateReturnChain's own source
      // filter so the Initiate Return button and the chain never disagree — change
      // one, change the other.
      // DEPLOYED ONLY. DELIVERED was previously also returnable (to cover
      // consumables settling at DELIVERED), but returns are now restricted to
      // DEPLOYED lines.
      mappedLines.forEach(function (l) {
        l.isReturnable = l.lineStatus === 'DEPLOYED';
      });

      $page.variables.dataGridProvider = await $page.functions.initGridData(mappedLines);

      // ── 3. Safety-net rollup on entry ─────────────────────────────────────
      // If EVERY line is DEPLOYED but the header status hasn't caught up,
      // reconcile the header to DEPLOYED. This is the passive counterpart to
      // acceptDeliveryChain's action-time rollup, and covers the case where
      // that PATCH was silently skipped (known read-after-write race, see
      // memory project_request_line_status_cascade). Reading the lines fresh
      // on vbEnter means there's no race here — they are the authoritative
      // current state. Forward-only: returns/rejects leave lines off DEPLOYED
      // so this never fires wrongly and never downgrades an existing status.
      // CONSUMED counts as on-site so a finished consumable does not block a mixed
      // request from reconciling to DEPLOYED.
      const ON_SITE_STATES = ['DEPLOYED', 'DELIVERED', 'CONSUMED'];
      const headerStatus = $page.variables.formData.status;
      const allDeployed = mappedLines.length > 0 &&
        mappedLines.every(function (l) { return ON_SITE_STATES.indexOf(l.lineStatus) !== -1; });

      // CLOSED must be excluded explicitly. The guard used to be `!== 'DEPLOYED'`,
      // which is not rank-aware despite the "forward-only" comment above: once
      // CONSUMED counts as on-site, a legitimately CLOSED request (every line
      // consumed) satisfies allDeployed and would be dragged back to DEPLOYED on
      // every single page open.
      if (allDeployed && headerStatus !== 'DEPLOYED' && headerStatus !== 'CLOSED') {
        const headerPatch = await Actions.callRest(context, {
          endpoint:  'eqp-v1/patchEquipmentRequest',
          uriParams: { id: Number(requestNumericId) },
          body:      { status: 'DEPLOYED' }
        }).catch(function (e) { return { ok: false, error: e }; });

        if (headerPatch.ok) {
          // Reassign the whole object so reactive bindings (the banner's
          // headerIsConfirmed gate) pick up the new status without a reload.
          $page.variables.formData = Object.assign({}, $page.variables.formData, { status: 'DEPLOYED' });
        } else {
          console.warn('[initChain] header DEPLOYED reconcile PATCH failed:', headerPatch.status);
        }
      }
    }
  }

  return initChain;
});
