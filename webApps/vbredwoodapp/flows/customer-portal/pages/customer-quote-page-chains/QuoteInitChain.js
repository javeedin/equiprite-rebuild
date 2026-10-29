define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class QuoteInitChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const requestId        = $page.variables.requestId;
      const requestNumericId = $page.variables.requestNumericId;

      // Can this customer still ACCEPT a quote? Gated by the ENABLE_QUOTES global
      // setting (true only under CUSTOMER or BOTH) — this page is customer-sourced
      // by definition, so the origin is hardcoded. Viewing/downloading stays open
      // regardless: the setting gates creation and acceptance, not reads. Without
      // this the Accept button would stay live under NONE/PROJECTS and the
      // customer would get a raw 403 from the backend on click.
      $page.variables.acceptAllowed = $application.functions.isQuotingAllowed(
        $application.variables.globalSettings,
        $application.variables.flagsLoaded,
        'CUSTOMER'
      );

      if (!requestId) {
        console.warn('[QuoteInitChain] No requestId — cannot load quote.');
        $page.variables.isLoading = false;
        return;
      }

      try {
      // ── 1. Header from customer-request-details view ───────────────────
      const headerResult = await Actions.callRest(context, {
        endpoint:  'eqp-v1/getEquipriteV1ViewsCustomerRequestDetails',
        uriParams: { page: 0, size: 10000 }
      });

      var first = null;
      var numericId = requestNumericId;

      if (headerResult.ok && headerResult.body && Array.isArray(headerResult.body.data)) {
        const matching = headerResult.body.data.filter(r => r.requestNumber === requestId);
        if (matching.length > 0) {
          first = matching[0];
          if (!numericId && first.eqrEquipmentRequestId != null) {
            numericId = first.eqrEquipmentRequestId;
          }
        }
      }

      // Store resolved numeric ID back so AcceptQuoteChain can use it
      if (numericId) {
        $page.variables.requestNumericId = Number(numericId);
      }

      // ── 2. contractNumber + persisted quote PDF (from the my-requests view) ─
      // The manager's SendQuoteChain PATCHes the quote PDF onto the request
      // header (quoteDocument = base64, format:byte). The request-by-id endpoint
      // does NOT return the BLOB, so EQP_C_MYREQUEST (getEquipriteV1ViewsCustomer-
      // MyRequests) is the source of truth for BOTH the blob and contractNumber.
      // It's one row per line, so the blob repeats — take the first matching row.
      const toBlobUrl = (b64, mime) => {
        const byteChars = atob(b64);
        const bytes = new Uint8Array(byteChars.length);
        for (var bi = 0; bi < byteChars.length; bi++) { bytes[bi] = byteChars.charCodeAt(bi); }
        return URL.createObjectURL(new Blob([bytes], { type: mime || 'application/pdf' }));
      };

      var contractNumber = '';
      const viewResult = await Actions.callRest(context, {
        endpoint:  'eqp-v1/getEquipriteV1ViewsCustomerMyRequests',
        uriParams: { page: 0, size: 10000 }
      });
      if (viewResult.ok && viewResult.body && Array.isArray(viewResult.body.data)) {
        const rows = viewResult.body.data.filter(r =>
          (numericId && Number(r.eqrEquipmentRequestId) === Number(numericId)) ||
          (r.requestNumber === requestId)
        );
        if (rows.length) {
          // Prefer a row that actually carries the blob; fall back to the first.
          const row = rows.find(r => r.quoteDocument) || rows[0];
          contractNumber = row.contractNumber || '';
          if (row.quoteDocument) {
            try {
              $page.variables.quotePdfUrl   = toBlobUrl(row.quoteDocument, row.quoteMimeType);
              $page.variables.quoteFileName = row.quoteFileName || 'quote.pdf';
              $page.variables.hasQuoteDoc   = true;
            } catch (e) {
              console.warn('[QuoteInitChain] quote PDF decode failed:', e);
            }
          }
        }
      }

      // ── 3. Lines from enriched view (1 row per line) ───────────────────
      var lines = [];
      if (numericId) {
        const linesResult = await Actions.callRest(context, {
          endpoint:  'eqp-v1/getEquipriteV1ViewsRequestDetailLines',
          uriParams: { requestId: Number(numericId), size: 10000 }
        });
        if (linesResult.ok && linesResult.body && Array.isArray(linesResult.body.data)) {
          lines = linesResult.body.data.map(function(r) {
            var startStr = r.startDate ? r.startDate.substring(0, 10) : '';
            var endStr   = r.endDate   ? r.endDate.substring(0, 10)   : '';
            var days = 0;
            if (startStr && endStr) {
              var s = new Date(startStr);
              var e = new Date(endStr);
              days = Math.max(0, Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1);
            }
            var qty  = r.quantity != null ? r.quantity : 1;
            var rate = r.billRate != null ? r.billRate : 0;

            // BILL_RATE is the price AS QUOTED, and PRICE_UOM says what it
            // covers — 'DAY', but also 'WEEK' / 'MONTH' / 'EACH'. So it CANNOT
            // be multiplied by days unconditionally: a $3,200 / WEEK line over
            // 5 days would quote as $16,000.
            //
            // Order of preference:
            //   1. ESTIMATED_COST — the line total computed at submit from the
            //      per-day rate over the line's own window, i.e. exactly what
            //      the cart's Subtotal showed the customer. Authoritative, and
            //      immune to the uom question entirely.
            //   2. rate × qty × days — only when the uom is DAY (or absent, the
            //      legacy shape), where that arithmetic is still correct.
            //   3. rate × qty — for a period- or unit-priced line with no stored
            //      total: the amount already covers its period, so multiplying
            //      by days would inflate it. Understates a multi-week rental
            //      rather than overstating it, which is the safer error and only
            //      applies to lines created before estimatedCost was stored.
            // PRICE_UOM holds the period's own vocabulary — 'DAILY' | 'WEEKLY' |
            // 'MONTHLY' from PERIOD_TYPE, or 'EACH' for a consumable. Older
            // lines carry the legacy 'DAY'. Both daily spellings are accepted so
            // the per-day arithmetic still applies to each.
            var uom = String(r.priceUom || '').toUpperCase();
            var isPerDay = !uom || uom === 'DAY' || uom === 'DAILY';
            var lineTotal;
            if (r.estimatedCost != null) {
              lineTotal = Number(r.estimatedCost);
            } else if (isPerDay) {
              lineTotal = rate * qty * days;
            } else {
              lineTotal = rate * qty;
            }
            return {
              equipmentName:  r.equipmentName  || '',
              equipmentClass: r.className      || r.equipmentClass || '',
              quantity:       qty,
              startDate:      startStr,
              endDate:        endStr,
              billRate:       rate,
              // Carried so the quote can label the rate with what it covers
              // ("$3,200 / WEEK"). Without it a period-priced line reads as a
              // bare number and looks like a daily rate.
              priceUom:       r.priceUom || null,
              lineTotal:      lineTotal
            };
          });
        }
      }

      var grandTotal = lines.reduce(function(sum, l) { return sum + (l.lineTotal || 0); }, 0);

      $page.variables.quoteData = {
        requestNumber:   (first && first.requestNumber)                          || requestId,
        customerName:    (first && first.customerName)                           || '',
        customerContact: (first && first.customerContact)                        || '',
        status:          (first && first.requestStatus)                          || '',
        startDate:       (first && first.startDate)  ? first.startDate.substring(0, 10)  : '',
        endDate:         (first && first.endDate)    ? first.endDate.substring(0, 10)    : '',
        location:        (first && (first.deploymentLocation || first.location)) || '',
        contractNumber:  contractNumber,
        grandTotal:      grandTotal,
        lines:           lines
      };
      } catch (e) {
        console.error('[QuoteInitChain] failed to load quote:', e);
      } finally {
        // Always resolve the loading state so the page shows either the PDF
        // or the "no quote document" message — never a stuck blank page.
        $page.variables.isLoading = false;
      }
    }
  }

  return QuoteInitChain;
});
