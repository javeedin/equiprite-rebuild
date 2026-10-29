define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestLineBody',
  'resources/js/currentUser',
], (ActionChain, Actions, lineBody, cu) => {
  'use strict';

  // Send Quote: build the PDF client-side (jsPDF, via $page.functions.buildQuotePdf),
  // PATCH it onto the request header, and PATCH every persisted line to
  // QUOTE_GENERATED. Requires the backend to have added 'QUOTE_GENERATED' to
  // both CK_EQR_REQUEST_STATUS and CK_EQR_RL_LINE_STATUS — until that lands,
  // OIC/the DB will reject these PATCH calls with a constraint violation.
  class SendQuoteChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const requestId = $page.variables.requestId;
      const q = $page.variables.quoteData || {};

      if (!requestId) {
        console.warn('[SendQuoteChain] no requestId in page variables');
        return;
      }

      $page.variables.sendingQuote = true;

      let pdf;
      try {
        pdf = $page.functions.buildQuotePdf($page);
      } catch (e) {
        console.error('[SendQuoteChain] PDF build failed:', e);
        $page.variables.sendingQuote = false;
        await Actions.fireNotificationEvent(context, {
          summary:     'Send Quote Failed',
          message:     'Could not generate the quote PDF.',
          type:        'error',
          displayMode: 'persist'
        });
        return;
      }

      let headerResp;
      try {
        headerResp = await Actions.callRest(context, {
          endpoint:  'eqp-v1/patchEquipmentRequest',
          uriParams: { id: Number(requestId) },
          body: {
            status:        'QUOTE_GENERATED',
            quoteDocument: pdf.base64,
            quoteMimeType: 'application/pdf',
            quoteFileName: pdf.fileName,
            quoteFileSize: pdf.fileSize
          }
        });
      } catch (e) {
        console.error('[SendQuoteChain] patchEquipmentRequest threw:', e);
      }

      if (!headerResp || !headerResp.ok) {
        $page.variables.sendingQuote = false;
        const serverMsg = headerResp && headerResp.body &&
          (headerResp.body.message || JSON.stringify(headerResp.body));
        await Actions.fireNotificationEvent(context, {
          summary:     'Send Quote Failed',
          message:     serverMsg
                       ? ('HTTP ' + headerResp.status + ': ' + serverMsg)
                       : 'The server rejected the quote update.',
          type:        'error',
          displayMode: 'persist'
        });
        return;
      }

      const lines = Array.isArray(q.lines) ? q.lines : [];

      // ── Record the quote itself (EQR_QUOTE + EQR_QUOTE_LINE) ───────────
      // This is what the quote WAS: the net rate the customer is being offered,
      // markup and per-line overrides included. Until this existed the offered
      // price lived only in BILL_RATE — which made a merely SENT quote look
      // like an agreed price — and in the PDF blob, which nothing can read.
      //
      // Superseded quotes are RETAINED. The backend stamps a new version,
      // marks the previous one SUPERSEDED and repoints
      // EQR_EQUIPMENT_REQUEST.QUOTE_ID in one atomic update, so there is never a
      // moment when two quotes both look current and no MAX() is needed on read.
      // Sending the same quote twice therefore produces v1 and v2, both kept.
      //
      // NET rate, not the list rate: netRate carries the BU margin and any
      // manual override, so it is the figure actually quoted. Re-deriving it
      // later from the catalog would silently discard both.
      //
      // Best-effort: the quote document and statuses are already committed by
      // this point, so a failure here is logged and surfaced in the summary
      // rather than aborting a send that has otherwise happened.
      let quoteRecorded = false;
      try {
        const quoteLines = lines
          .filter(l => l.lineId != null)
          .map(l => ({
            requestLineId:      Number(l.lineId),
            quotedRate:         Number(l.netRate != null ? l.netRate : l.billRate) || 0,
            quotedUom:          l.priceUom || l.rateUom || null,
            quotedQty:          Number(l.quantity) || 0,
            quotedLineTotal:    Number(l.lineTotal) || 0,
            billFrequency:      (['DAILY', 'WEEKLY', 'MONTHLY'].indexOf(l.rateFrequency) !== -1
                                  ? l.rateFrequency : 'DAILY'),
            rateOverriddenFlag: l._rateOverride ? 'Y' : 'N'
          }));

        if (quoteLines.length) {
          const quoteResp = await Actions.callRest(context, {
            endpoint:  'eqp-v1/createQuote',
            uriParams: { requestId: Number(requestId) },
            body: {
              quoteStatus:     'SENT',
              quoteTotal:      Number(q.grandTotal) || 0,
              currencyCode:    'USD',
              quoteDocument:   pdf.base64,
              quoteMimeType:   'application/pdf',
              quoteFileName:   pdf.fileName,
              quoteFileSize:   pdf.fileSize,
              lines:           quoteLines
            }
          });
          quoteRecorded = !!(quoteResp && quoteResp.ok);
          if (!quoteRecorded) {
            console.warn('[SendQuoteChain] createQuote not ok', quoteResp && quoteResp.status,
              quoteResp && quoteResp.body);
          }
        }
      } catch (e) {
        console.warn('[SendQuoteChain] createQuote failed — quote sent but not recorded', e);
      }

      // Best-effort per line — a line added via "Add Line" and never saved
      // has lineId: null (no persisted row to PATCH), so it's skipped.
      //
      // billRate is STILL written here, deliberately. The quote record above is
      // now the authoritative offer, but the customer quote page and the Fusion
      // contract's EstimatedAmount both still read the line — so removing this
      // write before those move over would render $0 on the page where the
      // customer accepts. It comes out in a follow-up once they read the quote.
      // Caveat: lines ADDED (lineId null) or REMOVED in the quote aren't
      // reflected back onto the request lines, so add/remove edits can still
      // drift from the PDF (rate/qty edits on existing lines are faithful).
      // ONE batch PATCH for every persisted line (one transaction, all or
      // nothing), replacing a Promise.all of per-line PATCHes. Still
      // best-effort for the send: the PDF and quote record already exist, so a
      // failed batch is reported (no line changed) rather than undoing the send.
      const persisted = lines.filter(l => l.lineId != null);
      const batch = await lineBody.updateLines(context, Actions, {
        requestId: Number(requestId),
        headers:   cu.auditHeaders(context),
        updates:   persisted.map(l => ({
          id:            Number(l.lineId),
          lineStatus:    'QUOTE_GENERATED',
          billRate:      Number(l.billRate) || 0,
          quantity:      Number(l.quantity) || 0,
          // 'Y' when the manager checked Override and edited Rate/Day on this
          // line; 'N' when the schedule-resolved rate stands. Backend column
          // EQR_REQUEST_LINE.RATE_OVERRIDDEN_FLAG (CK IN ('Y','N')).
          rateOverriddenFlag: l._rateOverride ? 'Y' : 'N',
          // Persist the cadence the EQR billing engine needs to iterate
          // cycles. Guarded to the CK_… allowed set so a stray value can't
          // trip the DB check constraint.
          billFrequency: (['DAILY', 'WEEKLY', 'MONTHLY'].indexOf(l.rateFrequency) !== -1 ? l.rateFrequency : 'DAILY')
        }))
      });
      if (!batch.ok) {
        console.warn('[SendQuoteChain] line batch failed, no line changed:', batch.message);
      }
      const failedLines = batch.ok ? [] : persisted.map(l => l.lineId);

      $page.variables.quoteData = Object.assign({}, q, { status: 'QUOTE_GENERATED' });
      $page.variables.sendingQuote = false;

      const failSuffix = failedLines.length
        ? (' (' + failedLines.length + ' line status update' + (failedLines.length === 1 ? '' : 's') + ' failed)')
        : '';
      // A quote that sent but wasn't RECORDED is worth saying out loud: the
      // customer has the PDF, but there is no retained record of what was
      // offered, so the audit trail has a hole for this version.
      const quoteRecSuffix = quoteRecorded
        ? ''
        : ' (warning: the quote record was not saved — the offer is not in the quote history)';
      const sendDegraded = failedLines.length > 0 || !quoteRecorded;
      await Actions.fireNotificationEvent(context, {
        summary:     'Quote Sent',
        message:     'Quote ' + pdf.fileName + ' saved and marked Quote Generated.' +
                     failSuffix + quoteRecSuffix,
        type:        sendDegraded ? 'warning' : 'confirmation',
        displayMode: sendDegraded ? 'persist' : 'transient'
      });
    }
  }

  return SendQuoteChain;
});
