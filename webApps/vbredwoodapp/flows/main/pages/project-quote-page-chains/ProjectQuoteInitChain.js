define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Load the project quote: header status + the persisted quote PDF.
  //
  // Deliberately does NOT rebuild a priced quote client-side. The PDF the
  // manager sent IS the quote (Option A, same as the customer page) — recomputing
  // totals here would risk showing the approver numbers that disagree with the
  // document they're accepting.
  //
  // BLOB SOURCE: ONE call — the by-id GET returns quoteDocument as base64
  // (format:byte on EquipmentRequestDto) alongside mime, filename and status, so
  // the whole quote loads from a request we're making anyway for the Accept gate.
  //
  // The blob was initially null here: EquipmentRequestMapper suppressed it
  // mapper-wide, which was right for list responses (one ~8KB blob per row) but
  // caught by-id as collateral. Backend fixed getById to populate it after
  // mapping (commit 996e4fb); getAll is still — correctly — lean, so do NOT
  // expect quoteDocument on any list or view endpoint.
  //
  // GET /{id}/quote-document still exists and streams raw application/pdf, but we
  // don't use it: VB's callRest pipeline is JSON-oriented and has no working
  // precedent for binary transport in this app. Base64-in-JSON is the path every
  // blob read here takes. We also do NOT read EQP_C_MYREQUEST like the customer
  // page does — that view repeats the PDF on every line row of a size=10000 fetch.
  class ProjectQuoteInitChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const numericId = $page.variables.requestNumericId;

      // acceptAllowed is resolved AFTER the header fetch below — it needs the
      // request's own origin, which arrives on that response. Closed until then
      // so a slow load never shows an enabled Accept it might have to withdraw.
      $page.variables.acceptAllowed = false;

      if (!numericId) {
        console.warn('[ProjectQuoteInitChain] No requestNumericId — cannot load quote.');
        $page.variables.isLoading = false;
        return;
      }

      // base64 → object URL (same decode the customer quote page uses).
      const toBlobUrl = function (b64, mime) {
        const byteChars = atob(b64);
        const bytes = new Uint8Array(byteChars.length);
        for (var i = 0; i < byteChars.length; i++) {
          bytes[i] = byteChars.charCodeAt(i);
        }
        return URL.createObjectURL(new Blob([bytes], { type: mime || 'application/pdf' }));
      };

      try {
        const headerResp = await Actions.callRest(context, {
          endpoint:  'eqp-v1/getEquipriteV1EquipmentRequestById',
          uriParams: { id: Number(numericId) }
        });

        if (!headerResp || !headerResp.ok) {
          console.warn('[ProjectQuoteInitChain] header fetch failed:',
            headerResp && headerResp.status);
          $page.variables.isLoading = false;
          return;
        }

        const h = headerResp.body || {};
        $page.variables.requestStatus = String(h.status || '').toUpperCase();

        // ── Can this approver ACCEPT? ──────────────────────────────────────
        // Gated by ENABLE_QUOTES, resolved against THIS REQUEST'S ORIGIN.
        //
        // The origin used to be hardcoded 'PROJECT', on the reasoning that this
        // page was project-sourced by definition. That stopped being true when
        // the Equipment Requests list started serving BOTH origins to managers
        // (filter=ALL): a manager opening the quote on an EXTERNAL request
        // landed here, the page asked "is quoting allowed for PROJECT?", and
        // under ENABLE_QUOTES=CUSTOMER — the current dev setting — got false.
        // Accept greyed out on exactly the requests the setting was meant to
        // permit.
        //
        // requestType is on the by-id response already fetched above (verified:
        // 'EXTERNAL' on request 1000001445), so this costs no extra call.
        // isExternalSource() owns the origin vocabulary and accepts the legacy
        // CUSTOMER/PROJECT spellings as well as EXTERNAL/INTERNAL, so a
        // half-migrated row still resolves correctly.
        //
        // Viewing and downloading stay open regardless of the setting — it
        // gates creation and acceptance, not reads.
        const quoteOrigin = $application.functions.isExternalSource(h.requestType)
          ? 'CUSTOMER'
          : 'PROJECT';
        $page.variables.acceptAllowed = $application.functions.isQuotingAllowed(
          $application.variables.globalSettings,
          $application.variables.flagsLoaded,
          quoteOrigin
        );

        const mime = h.quoteMimeType || 'application/pdf';
        const name = h.quoteFileName || 'quote.pdf';

        // quoteDocument is base64 on the by-id response. A data-URL prefix is
        // stripped defensively — the field is documented as bare base64, but a
        // prefixed value would otherwise decode to garbage silently.
        let url = '';
        if (h.quoteDocument) {
          const raw = String(h.quoteDocument);
          const b64 = (raw.indexOf(',') > -1 && raw.indexOf('base64') > -1)
            ? raw.substring(raw.indexOf(',') + 1)
            : raw;
          try {
            url = toBlobUrl(b64, mime);
          } catch (e) {
            // The request HAS a stored quote (quoteFileSize is populated), so a
            // decode failure here is a real defect, not a missing document —
            // loud rather than silently falling through to the empty state.
            console.error('[ProjectQuoteInitChain] quote PDF base64 decode failed ' +
              '(quoteFileSize=' + h.quoteFileSize + '):', e);
          }
        }

        if (url) {
          $page.variables.quotePdfUrl   = url;
          $page.variables.quoteFileName = name;
          $page.variables.hasQuoteDoc   = true;
        }
      } catch (e) {
        console.error('[ProjectQuoteInitChain] unexpected error:', e);
      } finally {
        $page.variables.isLoading = false;
      }
    }
  }

  return ProjectQuoteInitChain;
});
