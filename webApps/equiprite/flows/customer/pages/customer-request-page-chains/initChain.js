define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Customer request loader: Old EquipRite's customer-portal/pages/customer-request-detail-page-chains/initChain.js,
  // same calls in the same order:
  //   1 views/customer-request-details (page 0, size 10000), the row for this request number (customer, contact,
  //     status, dates, delivery, contract); it also gives the numeric id when the link had none
  //   2 views/request-detail-lines (requestId, size 10000), one enriched row per line
  //   3 the safety-net rollup: every line on site but the header not DEPLOYED (nor CLOSED) → PATCH the header to
  //     DEPLOYED, as the old page does on every open
  // New here: isLoading / fetchError for the page, and display fields the old page did not show (contract number,
  // created date, the rate's unit). Customers never see serial numbers, as on the old page.
  class initChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const requestId = (params && params.requestId) || $page.variables.requestId;
      let requestNumericId = (params && params.requestNumericId) || $page.variables.requestNumericId;

      if (!requestId) {
        console.error('[initChain] No requestId found.');
        $page.variables.isLoading = false;
        $page.variables.fetchError = 'No request was given. Open one from My requests.';
        return;
      }
      $page.variables.isLoading = true;
      $page.variables.fetchError = '';

      try {
        // ── 1. Header data from the customer view (first matching row only) ────────
        const headerResult = await Actions.callRest(context, {
          endpoint:  'eqp-v1/getEquipriteV1ViewsCustomerRequestDetails',
          uriParams: { page: 0, size: 10000 }
        });

        let first = null;
        if (headerResult && headerResult.ok && headerResult.body && Array.isArray(headerResult.body.data)) {
          const matching = headerResult.body.data.filter((r) => r.requestNumber === requestId);
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
          location:        (first && (first.deploymentLocation || first.location)) || '',
          contractNumber:  (first && first.contractNumber) || '',
          createdDate:     (first && first.createdDate) ? String(first.createdDate).substring(0, 10) : ''
        };

        if (!requestNumericId) {
          console.error('[initChain] No requestNumericId — cannot load lines.');
          $page.variables.fetchError = 'This request could not be found among yours.';
          return;
        }

        // ── 2. Lines from the enriched view (1 row per line) ─────────────────────────
        const linesResult = await Actions.callRest(context, {
          endpoint:  'eqp-v1/getEquipriteV1ViewsRequestDetailLines',
          uriParams: { requestId: Number(requestNumericId), size: 10000 }
        });

        if (!linesResult || !linesResult.ok || !linesResult.body || !Array.isArray(linesResult.body.data)) {
          console.warn('[initChain] No lines returned from RequestDetailLines for requestId:', requestNumericId);
          $page.variables.fetchError = 'The equipment on this request could not be loaded (HTTP ' + (linesResult && linesResult.status) + ').';
          $page.variables.dataGridProvider = $page.functions.initGridData([]);
          return;
        }

        const rows = linesResult.body.data;

        // deploymentLocation lives on each line row — pick it from the first
        if (rows.length > 0 && rows[0].deploymentLocation) {
          $page.variables.formData = Object.assign({}, $page.variables.formData, { location: rows[0].deploymentLocation });
        }

        const mappedLines = rows.map((r, index) => ({
          lineId:         String(r.lineId !== undefined && r.lineId !== null ? r.lineId : (r.id !== undefined ? r.id : index + 1)),
          equipmentName:  r.equipmentName  || '',
          equipmentClass: r.className      || r.equipmentClass || '',
          quantity:       r.quantity       !== undefined && r.quantity !== null ? r.quantity : '',
          utilizationPct: r.targetUtilPercent !== undefined && r.targetUtilPercent !== null ? r.targetUtilPercent : '',
          lineStatus:     r.lineStatus     || '',
          consumableFlag:    r.consumableFlag || 'N',
          autoConsumeFlag:   r.autoConsumeFlag || 'N',
          deliveredQuantity: r.deliveredQuantity != null ? Number(r.deliveredQuantity) : null,
          consumedQuantity:  r.consumedQuantity  != null ? Number(r.consumedQuantity)  : null,
          startDate:      r.startDate      ? r.startDate.substring(0, 10)  : '',
          endDate:        r.endDate        ? r.endDate.substring(0, 10)    : '',
          billRate:       r.billRate       !== undefined && r.billRate !== null ? r.billRate : '',
          priceUom:       r.priceUom || ''
        }));

        // Per-line returnability, kept in step with initiateReturnChain's source filter: DEPLOYED only.
        mappedLines.forEach((l) => { l.isReturnable = l.lineStatus === 'DEPLOYED'; });

        $page.variables.dataGridProvider = await $page.functions.initGridData(mappedLines);

        // ── 3. Safety-net rollup on entry (unchanged from the old page) ───────────────
        // Every line on site but the header behind: reconcile the header to DEPLOYED. Forward-only; CLOSED excluded,
        // or a closed request whose lines were all consumed would be dragged back on every open.
        const ON_SITE_STATES = ['DEPLOYED', 'DELIVERED', 'CONSUMED'];
        const headerStatus = $page.variables.formData.status;
        const allDeployed = mappedLines.length > 0
          && mappedLines.every((l) => ON_SITE_STATES.indexOf(l.lineStatus) !== -1);

        if (allDeployed && headerStatus !== 'DEPLOYED' && headerStatus !== 'CLOSED') {
          const headerPatch = await Actions.callRest(context, {
            endpoint:  'eqp-v1/patchEquipmentRequest',
            uriParams: { id: Number(requestNumericId) },
            body:      { status: 'DEPLOYED' }
          }).catch((e) => ({ ok: false, error: e }));

          if (headerPatch && headerPatch.ok) {
            $page.variables.formData = Object.assign({}, $page.variables.formData, { status: 'DEPLOYED' });
          } else {
            console.warn('[initChain] header DEPLOYED reconcile PATCH failed:', headerPatch && headerPatch.status);
          }
        }
      } catch (e) {
        console.error('[initChain] failed', e);
        $page.variables.fetchError = 'This request could not be loaded.';
      } finally {
        $page.variables.isLoading = false;
        $page.variables.selectionTick = ($page.variables.selectionTick || 0) + 1;
      }
    }
  }

  return initChain;
});
