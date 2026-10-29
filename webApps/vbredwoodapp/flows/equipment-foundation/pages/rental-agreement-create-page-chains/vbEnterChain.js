define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class vbEnterChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      $page.variables.dataGridProvider = $page.functions.initGridData([]);
      // Clear any deletion tracker from a previous edit session
      $page.variables.deletedLineIds = [];

      // Guard — numeric headerId passed from pencil button
      const headerId = $page.variables.agreementId ? Number($page.variables.agreementId) : null;
      if (!headerId) return;

      // Fetch header by numeric ID
      const headerResp = await Actions.callRest(context, {
        endpoint: 'eqp-v1/getAgreementHeaderById',
        uriParams: { id: headerId }
      });

      const header = headerResp && headerResp.body;
      if (!header || !header.id) {
        console.warn('[vbEnter] header not found for id=', headerId);
        return;
      }

      // Cache the full loaded header for save — we'll need agreementNumber,
      // status, objectVersionNumber, and the original date strings to
      // build the full DTO that updateAgreementHeader (PUT) requires.
      // We use PUT instead of PATCH on save because the generic-object
      // PATCH handler can't deserialize OffsetDateTime fields from JSON
      // strings (reflection-based setter throws IllegalArgumentException).
      $page.variables.loadedHeader = header;

      // Map header fields into formData, preserving existing defaults
      $page.variables.formData = Object.assign({}, $page.variables.formData, {
        agreementName: header.agreementName    || '',
        agreementType: header.agreementType    || '',
        customerRefId: null,
        customerId:    header.fusionCustomerId != null ? Number(header.fusionCustomerId) : null,
        startDate:     header.effectiveFrom ? header.effectiveFrom.substring(0, 10) : '',
        endDate:       header.effectiveTo   ? header.effectiveTo.substring(0, 10)   : '',
        currencyCode:  header.currencyCode  || 'USD',
        notes:         header.notes         || ''
      });

      // Resolve customer display name for edit mode using fusionCustomerId.
      if (header.fusionCustomerId) {
        try {
          const custResp = await Actions.callRest(context, {
            endpoint: 'ProjectLOV/getFscmRestApiResources11_13_18_05ShippingCustomersLOV',
            queryParams: { q: 'CustomerId=' + header.fusionCustomerId, limit: 1 }
          });
          const custItem = custResp.ok && custResp.body && custResp.body.items && custResp.body.items[0];
          if (custItem) {
            $page.variables.formData.customerName = custItem.Customer || null;
          }
        } catch (e) {
          console.warn('[vbEnter] could not resolve customer name', e);
        }
      }

      // Fetch raw lines (has IDs + editable fields) and view lines (has display names) in parallel
      const linesResp = await Actions.callRest(context, {
        endpoint: 'eqp-v1/getAgreementLines',
        uriParams: { agreementId: headerId }
      });

      const viewResp = await Actions.callRest(context, {
        endpoint: 'eqp-v1/getEquipriteV1ViewsRentalAgreementLines',
        uriParams: { agreementNumber: header.agreementNumber }
      });

      const rawLines  = (linesResp && linesResp.ok && linesResp.body.data)  ? linesResp.body.data  : [];
      const viewLines = (viewResp  && viewResp.ok  && viewResp.body.data)   ? viewResp.body.data   : [];

      // Build combined lines — raw for IDs/values, view for display names.
      const lines = rawLines.map(line => {
        const v = viewLines.find(vl => vl.lineNumber === line.lineNumber) || null;
        return {
          lineId:                line.id,
          lineNumber:            line.lineNumber,
          equipmentClassId:      line.equipmentClassId,
          equipmentMasterId:     line.equipmentMasterId  || null,
          description:           line.description        || '',
          unitPrice:             line.unitPrice,
          priceUom:              line.priceUom            || 'DAY',
          equipmentClassName:    v ? (v.className     || '—') : '—',
          equipmentSubclassName: v ? (v.subClassName  || '—') : '—',
          equipmentName:         v ? (v.equipmentName || '—') : '—'
        };
      });

      // Sort by lineNumber so the grid renders in 1, 2, 3, ... order.
      // The raw lines endpoint typically returns rows in PK / creation
      // order, which means deletes + re-adds produce out-of-order display
      // (e.g. lines [2, 3, 5, 4] instead of [2, 3, 4, 5]).
      lines.sort((a, b) => (Number(a.lineNumber) || 0) - (Number(b.lineNumber) || 0));

      $page.variables.equipmentLines = lines;
      $page.variables.dataGridProvider = $page.functions.initGridData(lines);
    }
  }

  return vbEnterChain;
});
