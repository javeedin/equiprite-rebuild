define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/agreementRules',
  'resources/js/shellBus',
], (ActionChain, Actions, A, bus) => {
  'use strict';

  // One agreement and its lines: New EquipRite's agreementLinesInitChain (the old rental-agreement-lines vbEnterChain),
  // call for call:
  //   1 the header by number, GET /agreement-headers?agreementNumber= (id, status, customer, window, notes)
  //   2 the customer's name: ShippingCustomersLOV by fusionCustomerId, else the legacy GET /customer-refs
  //   3 the view lines (names) and the raw lines (EQR_AGREEMENT_LINE_ID) in parallel, joined by line number
  //     (agreementRules.buildLines), sorted
  // A missing or unknown agreement is said on the page. The ticks start clean. The tab is named after the agreement.
  class viewLoadChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const v = $page.variables;
      v.isLoading = true;
      v.loadError = '';
      try {
        await this.load(context);
      } catch (e) {
        console.error('[agreement viewLoadChain] failed', e);
        v.loadError = 'The agreement could not be loaded.';
      } finally {
        v.isLoading = false;
      }
    }

    async load(context) {
      const v = context.$page.variables;
      const agreementNumber = v.number || v.agreementNumber || '';
      if (!agreementNumber) {
        v.loadError = 'No agreement was named. Open one from Agreements.';
        return;
      }

      // ── 1. the header ──────────────────────────────────────────────
      let agreementName = '';
      let headerId = null;
      const headerLookup = await Actions.callRest(context, {
        endpoint:  'eqp-v1/getAgreementHeaders',
        uriParams: { agreementNumber: agreementNumber }
      });
      if (headerLookup && headerLookup.body && headerLookup.body.id) {
        const h = headerLookup.body;
        headerId = h.id;
        v.agreementHeaderId = headerId;
        v.agreementNumber   = h.agreementNumber || agreementNumber;
        v.agreementStatus   = h.status || '';
        v.agreementType     = h.agreementType || '';
        v.currencyCode      = h.currencyCode || '';
        v.customerRefId     = h.customerRefId != null ? Number(h.customerRefId) : null;
        v.fusionCustomerId  = h.fusionCustomerId != null ? Number(h.fusionCustomerId) : null;
        v.effectiveFrom     = h.effectiveFrom || '';
        v.effectiveTo       = h.effectiveTo   || '';
        v.agreementNotes    = h.notes         || '';
        agreementName = h.agreementName || '';
      } else {
        v.loadError = 'Agreement ' + agreementNumber + ' could not be found.';
        return;
      }

      // ── 2. the customer's name ─────────────────────────────────────
      v.customerName = '';
      if (v.fusionCustomerId != null) {
        try {
          const custResp = await Actions.callRest(context, {
            endpoint:  'ProjectLOV/getFscmRestApiResources11_13_18_05ShippingCustomersLOV',
            uriParams: { q: 'CustomerId=' + v.fusionCustomerId, limit: 1 }
          });
          const item = custResp && custResp.ok && custResp.body && custResp.body.items && custResp.body.items[0];
          if (item) v.customerName = item.Customer || '';
        } catch (e) { /* non-fatal */ }
      } else if (v.customerRefId != null) {
        try {
          const custResp = await Actions.callRest(context, { endpoint: 'eqp-v1/getCustomerRefs' });
          if (custResp && custResp.ok && custResp.body && Array.isArray(custResp.body.data)) {
            const match = custResp.body.data.find((c) => Number(c.id) === Number(v.customerRefId));
            if (match) v.customerName = match.customerName || '';
          }
        } catch (e) { /* non-fatal */ }
      }

      // ── 3. the view lines and the raw lines, in parallel ───────────
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
        ? viewResp.body.data.filter((r) => r != null) : [];
      const rawRows  = (rawResp  && rawResp.ok  && rawResp.body  && Array.isArray(rawResp.body.data))
        ? rawResp.body.data.filter((r) => r != null) : [];

      const built = A.buildLines(agreementNumber, viewRows, rawRows);
      v.totalEstCost = viewRows.length > 0 ? (viewRows[0].totalAgreementCost || 0) : 0;
      const first = viewRows.length > 0 ? viewRows[0] : {};
      v.banner = {
        agreement_name:   agreementName || '—',
        project_customer: v.customerName || first.projectOrCustomer || first.vendor || '—',
        task:             first.taskName || '—',
        start_date:       v.effectiveFrom ? v.effectiveFrom.substring(0, 10) : (first.startDate ? first.startDate.substring(0, 10) : '—'),
        end_date:         v.effectiveTo ? v.effectiveTo.substring(0, 10) : (first.endDate ? first.endDate.substring(0, 10) : '—'),
        location:         first.location || '—'
      };
      v.linesArray = built.lines;
      v.idMap = built.idMap;
      v.agreementName = agreementName;
      v.selected = {};
      v.showLimit = A.SHOW_STEP;
      bus.rename('agreement:' + (v.id || v.number), v.agreementNumber);
    }
  }

  return viewLoadChain;
});
