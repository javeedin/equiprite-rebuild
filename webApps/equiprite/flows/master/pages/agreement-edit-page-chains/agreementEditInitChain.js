define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Opens New / Edit agreement. FULL access to EQR_RENTAL_AGREEMENTS first (the old create page had no access
  // check: FDD 16), then the agreement types (GET /conf-agreement-types?activeOnly=true, the old type picker's
  // data), then, when editing, the old rental-agreement-create-page-chains/vbEnterChain.js call for call: the
  // header by id (kept whole for the PUT), the customer's name from ShippingCustomersLOV, the raw lines (ids and
  // values) and the view lines (names), joined by line number and sorted. Changes: the old grid provider is this
  // page's lines; the customer look-up passes q as uriParams (the old queryParams); formData is replaced, not
  // mutated.
  class agreementEditInitChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const av = $application.variables;
      for (let i = 0; i < 60 && !av.pageAccessLoaded; i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      if ($application.functions.pageAccess(av.pageAccessMap, av.pageAccessLoaded, 'EQR_RENTAL_AGREEMENTS') !== 'FULL') {
        await Actions.fireNotificationEvent(context, {
          summary: 'No access',
          message: 'Creating and editing agreements needs full access to Rental agreements.',
          type: 'warning', displayMode: 'transient',
        });
        await Actions.navigateToPage(context, { page: 'agreements' });
        return;
      }

      // Clear any deletion tracker from a previous edit session
      $page.variables.deletedLineIds = [];
      try {
        const types = await Actions.callRest(context, { endpoint: 'eqp-v1/getConfAgreementTypes', uriParams: { activeOnly: true } });
        const list = types && types.ok && Array.isArray(types.body) ? types.body
          : (types && types.ok && types.body && Array.isArray(types.body.data) ? types.body.data : []);
        $page.variables.typeOptions = list.filter(t => t && t.typeCode)
          .map(t => ({ value: t.typeCode, label: t.typeLabel || t.typeCode, prefix: t.typePrefix || '' }));
      } catch (e) {
        $page.variables.typeOptions = [];
      }

      // Guard — numeric headerId passed from pencil button
      const headerId = $page.variables.agreementId ? Number($page.variables.agreementId) : null;
      if (!headerId) { $page.variables.isLoading = false; return; }

      // Fetch header by numeric ID
      const headerResp = await Actions.callRest(context, {
        endpoint: 'eqp-v1/getAgreementHeaderById',
        uriParams: { id: headerId }
      });

      const header = headerResp && headerResp.body;
      if (!header || !header.id) {
        console.warn('[vbEnter] header not found for id=', headerId);
        $page.variables.loadError = 'This agreement could not be loaded.';
        $page.variables.isLoading = false;
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
            uriParams: { q: 'CustomerId=' + header.fusionCustomerId, limit: 1 }
          });
          const custItem = custResp.ok && custResp.body && custResp.body.items && custResp.body.items[0];
          if (custItem) {
            $page.variables.formData = Object.assign({}, $page.variables.formData, { customerName: custItem.Customer || null });
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
      $page.variables.isLoading = false;
    }
  }

  return agreementEditInitChain;
});
