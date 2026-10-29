define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The quote: Old EquipRite's customer-portal/pages/customer-quote-page-chains/QuoteInitChain.js, same reads in the
  // same order and the same line totals:
  //   1 views/customer-request-details (page 0, size 10000): the header row for this request number
  //   2 views/customer-my-requests (page 0, size 10000): the contract number and the quote PDF the manager sent
  //     (quoteDocument, base64), which the request-by-id endpoint does not return
  //   3 views/request-detail-lines (requestId, size 10000): the lines, each totalled as the old page does
  //     (estimatedCost, else rate × qty × days for a daily rate, else rate × qty)
  // acceptAllowed is isQuotingAllowed(..., 'CUSTOMER'): it gates Accept only; reading the quote stays open.
  class quoteInitChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const requestId        = $page.variables.requestId;
      const requestNumericId = $page.variables.requestNumericId;

      for (let i = 0; i < 60 && !$application.variables.flagsLoaded; i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      $page.variables.acceptAllowed = $application.functions.isQuotingAllowed(
        $application.variables.globalSettings,
        $application.variables.flagsLoaded,
        'CUSTOMER'
      );

      if (!requestId) {
        console.warn('[quoteInitChain] No requestId — cannot load quote.');
        $page.variables.isLoading = false;
        return;
      }

      try {
        // ── 1. Header from the customer-request-details view ───────────────────
        const headerResult = await Actions.callRest(context, {
          endpoint:  'eqp-v1/getEquipriteV1ViewsCustomerRequestDetails',
          uriParams: { page: 0, size: 10000 }
        });

        let first = null;
        let numericId = requestNumericId;

        if (headerResult && headerResult.ok && headerResult.body && Array.isArray(headerResult.body.data)) {
          const matching = headerResult.body.data.filter((r) => r.requestNumber === requestId);
          if (matching.length > 0) {
            first = matching[0];
            if (!numericId && first.eqrEquipmentRequestId != null) {
              numericId = first.eqrEquipmentRequestId;
            }
          }
        }

        // Store the resolved numeric id so acceptQuoteChain can use it.
        if (numericId) {
          $page.variables.requestNumericId = Number(numericId);
        }

        // ── 2. contractNumber + the persisted quote PDF (customer-my-requests) ─
        const toBlobUrl = (b64, mime) => {
          const byteChars = atob(b64);
          const bytes = new Uint8Array(byteChars.length);
          for (let bi = 0; bi < byteChars.length; bi++) { bytes[bi] = byteChars.charCodeAt(bi); }
          return URL.createObjectURL(new Blob([bytes], { type: mime || 'application/pdf' }));
        };

        let contractNumber = '';
        const viewResult = await Actions.callRest(context, {
          endpoint:  'eqp-v1/getEquipriteV1ViewsCustomerMyRequests',
          uriParams: { page: 0, size: 10000 }
        });
        if (viewResult && viewResult.ok && viewResult.body && Array.isArray(viewResult.body.data)) {
          const rows = viewResult.body.data.filter((r) =>
            (numericId && Number(r.eqrEquipmentRequestId) === Number(numericId)) ||
            (r.requestNumber === requestId)
          );
          if (rows.length) {
            const row = rows.find((r) => r.quoteDocument) || rows[0];
            contractNumber = row.contractNumber || '';
            if (row.quoteDocument) {
              try {
                $page.variables.quotePdfUrl   = toBlobUrl(row.quoteDocument, row.quoteMimeType);
                $page.variables.quoteFileName = row.quoteFileName || 'quote.pdf';
                $page.variables.hasQuoteDoc   = true;
              } catch (e) {
                console.warn('[quoteInitChain] quote PDF decode failed:', e);
              }
            }
          }
        }

        // ── 3. Lines from the enriched view (1 row per line) ───────────────────
        let lines = [];
        if (numericId) {
          const linesResult = await Actions.callRest(context, {
            endpoint:  'eqp-v1/getEquipriteV1ViewsRequestDetailLines',
            uriParams: { requestId: Number(numericId), size: 10000 }
          });
          if (linesResult && linesResult.ok && linesResult.body && Array.isArray(linesResult.body.data)) {
            lines = linesResult.body.data.map((r) => $page.functions.quoteLine(r));
          }
        }

        const grandTotal = lines.reduce((sum, l) => sum + (l.lineTotal || 0), 0);

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
        console.error('[quoteInitChain] failed to load quote:', e);
        $page.variables.fetchError = 'The quote could not be loaded.';
      } finally {
        $page.variables.isLoading = false;
      }
    }
  }

  return quoteInitChain;
});
