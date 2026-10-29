define([
  'vb/action/actionChain',
  'vb/action/actions',
], (
  ActionChain,
  Actions
) => {
  'use strict';

  // Loads the agreement header + view-lines + raw-lines for this page.
  // - View lines provide display fields (className, equipmentName, billRate…)
  //   but don't expose the agreement_line_id PK in the JSON shape.
  // - Raw lines (getAgreementLines) carry the id field but no display names.
  // We build a composite-key map (agreementNumber + lineNumber → agreement_line_id)
  // so the multi-select table can identify rows by a stable key and the
  // commit step can FK back to the real EQR_AGREEMENT_LINE_ID on the request line.
  // Opens one agreement and its lines: the old rental-agreement-lines-page-chains/vbEnterChain.js, call for call
  // (header by agreementNumber, the customer's name, the view lines and the raw lines in parallel, the composite-key
  // map to EQR_AGREEMENT_LINE_ID, sorted by line number). Changes: the agreement number comes from this page's
  // parameter; the old grid provider, cart and selection are this page's lines and `selected` map; a missing or
  // unknown agreement is said on the page. The customer look-up passes q as uriParams (the old queryParams).
  class agreementLinesInitChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      console.log('[rental-lines] vbEnter fired, requestId=', $page.variables.requestId);

      const agreementNumber = $page.variables.agreementNumber || '';

      $page.variables.pageTitle    = agreementNumber || 'Agreement Lines';
      $page.variables.pageSubtitle = 'Equipment lines for this rental agreement';

      if (!agreementNumber) {
        $page.variables.isLoading = false;
        $page.variables.loadError = 'No agreement was named. Open one from Rental agreements.';
        return;
      }

      // ── 1. Header lookup (resolves numeric header ID + status + customer + window)
      let agreementName = '';
      let headerId      = null;
      const headerLookup = await Actions.callRest(context, {
        endpoint:  'eqp-v1/getAgreementHeaders',
        uriParams: { agreementNumber: agreementNumber }
      });
      if (headerLookup && headerLookup.body && headerLookup.body.id) {
        headerId = headerLookup.body.id;
        $page.variables.agreementHeaderId = headerId;
        $page.variables.agreementStatus   = headerLookup.body.status || '';
        $page.variables.customerRefId     = headerLookup.body.customerRefId != null
          ? Number(headerLookup.body.customerRefId) : null;
        $page.variables.fusionCustomerId  = headerLookup.body.fusionCustomerId != null
          ? Number(headerLookup.body.fusionCustomerId) : null;
        $page.variables.effectiveFrom     = headerLookup.body.effectiveFrom || '';
        $page.variables.effectiveTo       = headerLookup.body.effectiveTo   || '';
        $page.variables.agreementNotes    = headerLookup.body.notes         || '';
        agreementName = headerLookup.body.agreementName || '';
        console.log('[rental-lines] header resolved id=', headerId,
                    'status=', headerLookup.body.status,
                    'customerRefId=', headerLookup.body.customerRefId);
      } else {
        console.warn('[rental-lines] no header for agreementNumber=', agreementNumber);
        $page.variables.loadError = 'Agreement ' + agreementNumber + ' could not be found.';
      }

      // ── 2. Customer name lookup (for the header strip + create-request handoff)
      // The customer now lives in fusionCustomerId (Fusion CustomerId), not the
      // legacy customerRefId seed-table FK (which is null on new agreements).
      // Resolve the display name via Fusion shippingCustomersLOV (q=CustomerId=N),
      // same one-shot pattern as the create page edit mode.
      if ($page.variables.fusionCustomerId != null) {
        try {
          const custResp = await Actions.callRest(context, {
            endpoint:    'ProjectLOV/getFscmRestApiResources11_13_18_05ShippingCustomersLOV',
            uriParams:   { q: 'CustomerId=' + $page.variables.fusionCustomerId, limit: 1 }
          });
          const item = custResp.ok && custResp.body && custResp.body.items && custResp.body.items[0];
          if (item) $page.variables.customerName = item.Customer || '';
        } catch (e) { /* non-fatal */ }
      } else if ($page.variables.customerRefId != null) {
        // Legacy fallback for old agreements that still have a seed-table customerRefId.
        try {
          const custResp = await Actions.callRest(context, { endpoint: 'eqp-v1/getCustomerRefs' });
          if (custResp.ok && custResp.body && Array.isArray(custResp.body.data)) {
            const match = custResp.body.data.find(c => Number(c.id) === Number($page.variables.customerRefId));
            if (match) $page.variables.customerName = match.customerName || '';
          }
        } catch (e) { /* non-fatal */ }
      }

      // ── 3. View lines (display fields) + raw lines (IDs) in parallel
      const [viewResp, rawResp] = await Promise.all([
        Actions.callRest(context, {
          endpoint:  'eqp-v1/getEquipriteV1ViewsRentalAgreementLines',
          uriParams: { agreementNumber: agreementNumber }
        }),
        headerId != null
          ? Actions.callRest(context, {
              endpoint:  'eqp-v1/getAgreementLines',
              uriParams: { agreementId: headerId }
            })
          : Promise.resolve({ ok: false, body: null })
      ]);

      const viewRows = (viewResp && viewResp.ok && viewResp.body && Array.isArray(viewResp.body.data))
        ? viewResp.body.data.filter(r => r != null) : [];
      const rawRows  = (rawResp  && rawResp.ok  && rawResp.body  && Array.isArray(rawResp.body.data))
        ? rawResp.body.data.filter(r => r != null) : [];

      console.log('[rental-lines] view rows=', viewRows.length, 'raw rows=', rawRows.length);

      // Map raw lineNumber → { id, equipmentClassId, equipmentMasterId }
      // (raw endpoint exposes the PK we need for the FK on the request line)
      const rawByLineNumber = new Map();
      rawRows.forEach(r => {
        if (r && r.lineNumber != null) {
          rawByLineNumber.set(Number(r.lineNumber), r);
        }
      });

      // ── 4. Build the display array. compositeKey = agreementNumber + ':' + lineNumber
      //    is stable + unique within the page and serves as oj-table keyAttribute.
      const agreementLineIdByCompositeKey = {};
      const lines = viewRows.map((r, idx) => {
        const lineNo = r.lineNumber != null ? Number(r.lineNumber) : (idx + 1);
        const compositeKey = agreementNumber + ':' + lineNo;
        const raw = rawByLineNumber.get(lineNo) || null;
        const agreementLineId = raw ? raw.id : null;

        if (agreementLineId != null) {
          agreementLineIdByCompositeKey[compositeKey] = {
            agreementLineId:    Number(agreementLineId),
            equipmentMasterId:  raw && raw.equipmentMasterId != null ? Number(raw.equipmentMasterId) : null,
            equipmentClassId:   raw && raw.equipmentClassId  != null ? Number(raw.equipmentClassId)  : null,
            unitPrice:          raw ? raw.unitPrice : null,
            priceUom:           raw ? raw.priceUom  : null,
            minCommitDays:      raw ? raw.minCommitDays : null
          };
        }

        return {
          compositeKey:   compositeKey,
          line_no:        lineNo,
          equipment_name: r.equipmentName  || r.description || '—',
          class_name:     r.className      || '—',
          subClassName:   r.subClassName   || '—',
          qty:            r.qty            != null ? r.qty : 0,
          availability:   r.availability   != null ? r.availability : 0,
          status:         r.status         || '—',
          bill_rate:      r.billRate       != null ? r.billRate : 0,
          price_uom:      r.priceUom       || '—',
          est_cost:       r.estCost        != null ? r.estCost : 0,
          util_pct:       r.utilPct        != null ? r.utilPct : 0,
          description:    r.description    || ''
        };
      });

      $page.variables.totalEstCost = viewRows.length > 0 ? (viewRows[0].totalAgreementCost || 0) : 0;

      // Header banner — built from the HEADER record (Step 1) so it renders even
      // when the agreement has no lines yet. View-row values only supplement the
      // line-derived fields (task/location) the header itself doesn't carry.
      // Previously this was gated on viewRows.length > 0, so a line-less header
      // (e.g. a freshly created agreement) showed a blank strip.
      const first = viewRows.length > 0 ? viewRows[0] : {};
      $page.variables.formData = {
        agreement_name:   agreementName || '—',
        project_customer: $page.variables.customerName || first.projectOrCustomer || first.vendor || '—',
        task:             first.taskName || '—',
        start_date:       $page.variables.effectiveFrom ? $page.variables.effectiveFrom.substring(0, 10)
                            : (first.startDate ? first.startDate.substring(0, 10) : '—'),
        end_date:         $page.variables.effectiveTo ? $page.variables.effectiveTo.substring(0, 10)
                            : (first.endDate ? first.endDate.substring(0, 10) : '—'),
        location:         first.location || '—'
      };

      // Sort by lineNumber so the grid displays in 1, 2, 3, ... order
      // regardless of the order the view returns rows (default Oracle
      // ordering is by primary key / creation order, which causes gaps
      // and reordering when lines were deleted + re-added).
      lines.sort((a, b) => (Number(a.line_no) || 0) - (Number(b.line_no) || 0));

      $page.variables.linesArray = lines;
      $page.variables.filteredLines = [...lines];
      $page.variables.agreementLineIdByCompositeKey = agreementLineIdByCompositeKey;
      $page.variables.agreementName = agreementName;

      // Reset the selection on (re-)enter so a navigation back into the page starts clean.
      $page.variables.selected = {};
      $page.variables.isLoading = false;

      console.log('[rental-lines] linesArray length=', lines.length,
                  'mapped agreement_line_ids=', Object.keys(agreementLineIdByCompositeKey).length);
    }
  }

  return agreementLinesInitChain;
});
