define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The rental contract of one request. Old EquipRite's contract page reads nothing (its data is fixed sample
  // values), so this reads what the old customer request pages read: views/customer-request-details (page 0,
  // size 10000) for the header and contract number, then views/request-detail-lines for the equipment. Read only.
  class contractInitChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const requestId = $page.variables.requestId;
      let numericId = $page.variables.requestNumericId;
      $page.variables.isLoading = true;
      $page.variables.fetchError = '';
      if (!requestId) {
        $page.variables.isLoading = false;
        $page.variables.fetchError = 'No request was given. Open the contract from a request.';
        return;
      }
      try {
        const headerResult = await Actions.callRest(context, {
          endpoint:  'eqp-v1/getEquipriteV1ViewsCustomerRequestDetails',
          uriParams: { page: 0, size: 10000 }
        });
        let first = null;
        if (headerResult && headerResult.ok && headerResult.body && Array.isArray(headerResult.body.data)) {
          first = headerResult.body.data.find((r) => r.requestNumber === requestId) || null;
          if (first && !numericId && first.eqrEquipmentRequestId != null) {
            numericId = first.eqrEquipmentRequestId;
          }
        }
        if (numericId) {
          $page.variables.requestNumericId = Number(numericId);
        }
        $page.variables.formData = {
          requestNumber:   (first && first.requestNumber)   || requestId,
          customerName:    (first && first.customerName)    || '',
          customerContact: (first && first.customerContact) || '',
          status:          (first && first.requestStatus)   || '',
          startDate:       (first && first.startDate) ? first.startDate.substring(0, 10) : '',
          endDate:         (first && first.endDate)   ? first.endDate.substring(0, 10)   : '',
          location:        (first && (first.deploymentLocation || first.location)) || '',
          contractNumber:  (first && first.contractNumber)  || ''
        };
        if (!numericId) {
          $page.variables.fetchError = 'This request could not be found among yours.';
          return;
        }
        const linesResult = await Actions.callRest(context, {
          endpoint:  'eqp-v1/getEquipriteV1ViewsRequestDetailLines',
          uriParams: { requestId: Number(numericId), size: 10000 }
        });
        const rows = (linesResult && linesResult.ok && linesResult.body && Array.isArray(linesResult.body.data)) ? linesResult.body.data : [];
        $page.variables.lines = rows.map((r) => ({
          equipmentName:  r.equipmentName || '',
          equipmentClass: r.className || r.equipmentClass || '',
          quantity:       r.quantity != null ? r.quantity : '',
          startDate:      r.startDate ? r.startDate.substring(0, 10) : '',
          endDate:        r.endDate ? r.endDate.substring(0, 10) : '',
          billRate:       r.billRate != null ? r.billRate : '',
          priceUom:       r.priceUom || '',
          estimatedCost:  r.estimatedCost != null ? r.estimatedCost : null,
          lineStatus:     r.lineStatus || ''
        }));
        if (rows.length && rows[0].deploymentLocation) {
          $page.variables.formData = Object.assign({}, $page.variables.formData, { location: rows[0].deploymentLocation });
        }
      } catch (e) {
        console.error('[contractInitChain] failed', e);
        $page.variables.fetchError = 'The contract could not be loaded.';
      } finally {
        $page.variables.isLoading = false;
      }
    }
  }

  return contractInitChain;
});
