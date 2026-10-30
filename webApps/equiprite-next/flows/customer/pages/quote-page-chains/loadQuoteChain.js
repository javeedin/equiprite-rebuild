define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/rules',
  'resources/js/portalView',
  'resources/js/shellBus',
], (ActionChain, Actions, rules, V, bus) => {
  'use strict';

  // The quote: New's quote page reads (quoteInitChain), in the same order, with the same line totals:
  //   1 views/customer-request-details (page 0, size 10000): the header row for this request
  //   2 views/customer-my-requests (page 0, size 10000): the contract number and the quote PDF the manager sent
  //     (quoteDocument, base64), from the row of this request that carries it
  //   3 views/request-detail-lines (requestId, size 10000): the lines, each totalled as New does (portalView.quoteLine)
  // acceptAllowed is isQuotingAllowed(..., 'CUSTOMER'). Next's guard: only a request the customer's own view returned is
  // read. Accepting is not done here (it creates the Fusion contract): the page links to New's quote page.
  const TRIES = 60;
  const GAP_MS = 50;
  let lastUrl = '';

  function toBlobUrl(b64, mime) {
    const byteChars = atob(b64);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: mime || 'application/pdf' }));
  }

  class loadQuoteChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const v = $page.variables;
      const app = $application.variables;
      v.isLoading = true;
      v.error = '';
      v.exportOpen = false;
      for (let i = 0; i < TRIES && !app.flagsLoaded; i++) {
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
      v.acceptAllowed = !!rules.isQuotingAllowed(app.globalSettings, app.flagsLoaded, 'CUSTOMER');
      try {
        const number = String(v.number || '');
        const given = Number(v.id) || 0;
        const headerResult = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getEquipriteV1ViewsCustomerRequestDetails',
          uriParams: { page: 0, size: 10000 },
        });
        const rows = headerResult && headerResult.ok && headerResult.body && Array.isArray(headerResult.body.data) ? headerResult.body.data : null;
        if (!rows) {
          v.error = 'Your quote could not be loaded (HTTP ' + (headerResult && headerResult.status) + ').';
          return;
        }
        const first = V.findOwn(rows, number, given);
        const numericId = first && first.eqrEquipmentRequestId != null ? Number(first.eqrEquipmentRequestId) : (first ? given : 0);
        if (!first || !numericId) {
          v.error = 'The quote of request ' + (number || given) + ' could not be found among your requests.';
          return;
        }
        v.requestId = numericId;
        const requestNumber = first.requestNumber || number;

        let contractNumber = '';
        let doc = null;
        const viewResult = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getEquipriteV1ViewsCustomerMyRequests',
          uriParams: { page: 0, size: 10000 },
        });
        if (viewResult && viewResult.ok && viewResult.body && Array.isArray(viewResult.body.data)) {
          const mine = viewResult.body.data.filter((r) => Number(r.eqrEquipmentRequestId) === numericId || r.requestNumber === requestNumber);
          if (mine.length) {
            const row = mine.find((r) => r.quoteDocument) || mine[0];
            contractNumber = row.contractNumber || '';
            if (row.quoteDocument) doc = row;
          }
        }
        if (lastUrl) { try { URL.revokeObjectURL(lastUrl); } catch (e) { /* gone */ } lastUrl = ''; }
        v.hasQuoteDoc = false;
        v.quotePdfUrl = '';
        if (doc) {
          try {
            lastUrl = toBlobUrl(doc.quoteDocument, doc.quoteMimeType);
            v.quotePdfUrl = lastUrl;
            v.quoteFileName = doc.quoteFileName || 'quote.pdf';
            v.hasQuoteDoc = true;
          } catch (e) {
            console.warn('[customer loadQuoteChain] quote PDF decode failed:', e);
          }
        }

        let lines = [];
        const linesResult = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getEquipriteV1ViewsRequestDetailLines',
          uriParams: { requestId: numericId, size: 10000 },
        });
        if (linesResult && linesResult.ok && linesResult.body && Array.isArray(linesResult.body.data)) {
          lines = linesResult.body.data.map((r) => V.quoteLine(r));
        }
        const grandTotal = lines.reduce((sum, l) => sum + (l.lineTotal || 0), 0);
        const head = V.headerOf(first, number);
        const quote = {
          requestNumber: head.requestNumber,
          customerName: head.customerName,
          customerContact: head.customerContact,
          status: head.status,
          startDate: head.startDate,
          endDate: head.endDate,
          location: head.location,
          contractNumber,
          grandTotal,
          lines,
        };
        v.state = V.quoteState(quote, v.hasQuoteDoc, v.acceptAllowed);
        v.quote = quote;
        bus.rename('quote:' + (v.id || v.number), 'Quote · ' + quote.requestNumber);
      } catch (e) {
        console.error('[customer loadQuoteChain] failed', e);
        v.error = 'The quote could not be loaded.';
      } finally {
        v.isLoading = false;
      }
    }
  }

  return loadQuoteChain;
});
