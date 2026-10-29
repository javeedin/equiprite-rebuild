define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestLineBody',
  'resources/js/currentUser',
], (ActionChain, Actions, lineBody, cu) => {
  'use strict';

  class AcceptQuoteChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const quoteData       = $page.variables.quoteData;
      const requestNumericId = $page.variables.requestNumericId;

      if (!quoteData || !quoteData.requestNumber) {
        console.warn('[AcceptQuoteChain] No quote data available.');
        return;
      }

      $page.variables.isAccepting = true;

      try {
      // ── 1. Build ContractLine array — one entry per equipment line ─────
      const contractLines = (quoteData.lines || []).map(function(line, idx) {
        return {
          LinePuid:        null,
          LineNumber:      String(idx + 1),
          LineTypeId:      300000000099381,
          LineTypeName:    'Free-form, project',
          ItemNameTxt:     line.equipmentName || '',
          ItemDescription: [line.equipmentName, line.equipmentClass]
                             .filter(function(v) { return !!v; })
                             .join(' - '),
          StartDate:       line.startDate || null
        };
      });

      const payload = {
        Cognomen:         quoteData.requestNumber,
        LegalEntityName:  'EPC UAE',
        OrgId:            300000334372921,
        PrimaryPartyId:   100000000395788,
        ContractTypeId:   300000048179116,
        InvOrgName:       'Operations',
        OrgName:          'EPC_UAE_BU',
        ContractTypeName: 'Sell Lines',
        PartyName:        'Stark Industries',
        StartDate:        quoteData.startDate  || null,
        EndDate:          quoteData.endDate    || null,
        EstimatedAmount:  quoteData.grandTotal || 0,
        CurrencyCode:     'USD',
        ContractLine:     contractLines
      };

      console.log('[AcceptQuoteChain] Sending contract payload:', JSON.stringify(payload));

      // ── 2. Create contract in Oracle Fusion ───────────────────────────
      // This is the contract path for when customer quoting is ENABLED
      // (ENABLE_QUOTES = CUSTOMER | BOTH) — the quoted total is the best
      // EstimatedAmount, so it's created here rather than at submit.
      // The MIRROR of this lives in request-cart-page-chains/SubmitRequestChain:
      // when quoting is OFF for customers there's no accept step, so submit
      // creates the contract instead. Exactly one of the two ever runs for a
      // given request — do not "consolidate" them without re-checking that, or a
      // request gets two contracts.
      const contractResult = await Actions.callRest(context, {
        endpoint: 'ProjectLOV/postFscmRestApiResources11_13_18_05Contracts',
        body:     payload
      });

      if (!contractResult.ok) {
        console.error('[AcceptQuoteChain] Contract creation failed:', contractResult.status, contractResult.body);
        await Actions.fireNotificationEvent(context, {
          summary: 'Failed to create contract. Please try again or contact support.',
          type:    'error'
        });
        $page.variables.isAccepting = false;
        return;
      }

      console.log('[AcceptQuoteChain] Contract created:', contractResult.body);

      // ── 3. Extract ContractNumber from response ────────────────────────
      const contractNumber = contractResult.body && contractResult.body.ContractNumber
        ? contractResult.body.ContractNumber
        : null;

      // ── 4. Move the request to QUOTE_ACCEPTED + store ContractNumber ───
      // Accepting the quote advances the customer lifecycle: header status →
      // QUOTE_ACCEPTED (contractNumber persisted alongside). QUOTE_ACCEPTED is
      // the customer-flow rename of the old IN_PROCESS — the project flow still
      // uses IN_PROCESS (confirmRequestChain). Lines cascade below: a line that
      // already has a purchase requisition raised goes to UNDER_PROCUREMENT
      // instead of QUOTE_ACCEPTED (it's being procured from a supplier); the
      // header stays QUOTE_ACCEPTED regardless (UNDER_PROCUREMENT is a line-only
      // status). BACKEND: QUOTE_ACCEPTED must be in CK_EQR_REQUEST_STATUS +
      // CK_EQR_RL_LINE_STATUS or these PATCHes 400.
      if (requestNumericId) {
        const headerBody = { status: 'QUOTE_ACCEPTED' };
        if (contractNumber) headerBody.contractNumber = String(contractNumber);

        const patchResult = await Actions.callRest(context, {
          endpoint:  'eqp-v1/patchEquipmentRequest',
          uriParams: { id: Number(requestNumericId) },
          body:      headerBody
        });
        if (patchResult.ok) {
          console.log('[AcceptQuoteChain] header → QUOTE_ACCEPTED (contractNumber:', contractNumber, ')');
        } else {
          console.warn('[AcceptQuoteChain] header PATCH (QUOTE_ACCEPTED) failed:', patchResult.status, patchResult.body);
        }

        // ── 4a. Which lines already have a PR raised? Those diverge to
        // UNDER_PROCUREMENT. PR mirror rows are keyed by eqrRequestLineId
        // (one line can have >1). Best-effort: on failure, treat all lines as
        // non-PR (→ QUOTE_ACCEPTED) so accept never breaks.
        const prLineIds = new Set();
        try {
          const prResp = await Actions.callRest(context, {
            endpoint:  'eqp-v1/getPurchaseRequisitions',
            uriParams: { requestId: Number(requestNumericId), size: 500 }
          });
          if (prResp && prResp.ok && prResp.body && Array.isArray(prResp.body.data)) {
            prResp.body.data.forEach(m => {
              if (m && m.eqrRequestLineId != null) prLineIds.add(Number(m.eqrRequestLineId));
            });
          } else {
            console.warn('[AcceptQuoteChain] PR mirror fetch not ok — treating all lines as non-PR');
          }
        } catch (ePr) {
          console.warn('[AcceptQuoteChain] PR mirror fetch failed — treating all lines as non-PR:', ePr);
        }

        // ── 4a-bis. The quoted prices, from the quote record ─────────────
        // ACCEPT is where a quoted price becomes an agreed price. Send only
        // records an offer; until the customer accepts it, nothing should be
        // billable. So the rates land on the request line HERE, copied from the
        // quote the customer actually saw — not re-derived from the catalog,
        // which would silently drop the manager's markup and per-line overrides
        // and bill a different number than the one on the PDF they accepted.
        //
        // Keyed by requestLineId. Empty map (older request quoted before
        // EQR_QUOTE existed, or a fetch failure) → we fall back to leaving
        // billRate alone, since SendQuoteChain still writes it today.
        const quotedByLineId = new Map();
        try {
          const qlResp = await Actions.callRest(context, {
            endpoint:  'eqp-v1/getCurrentQuoteLines',
            uriParams: { requestId: Number(requestNumericId) }
          });
          const qlRows = qlResp && qlResp.ok && qlResp.body
            ? (Array.isArray(qlResp.body) ? qlResp.body : qlResp.body.data)
            : null;
          if (Array.isArray(qlRows)) {
            qlRows.forEach(ql => {
              if (ql && ql.requestLineId != null) quotedByLineId.set(Number(ql.requestLineId), ql);
            });
          } else {
            console.warn('[AcceptQuoteChain] quote lines fetch not ok — keeping existing line rates');
          }
        } catch (eQl) {
          console.warn('[AcceptQuoteChain] quote lines fetch failed — keeping existing line rates:', eQl);
        }

        // ── 4b. Cascade lines (mirrors confirmRequestChain) ──────────────
        // At accept time lines are QUOTE_GENERATED; advance the pre-active ones
        // and skip anything already downstream (ALLOCATED, SHIPPED, …). Each
        // cascadable line goes to UNDER_PROCUREMENT if it has a PR raised
        // (prLineIds, from 4a) — it's being procured from a supplier — else
        // QUOTE_ACCEPTED. QUOTE_ACCEPTED is included in CASCADABLE so a re-run
        // is idempotent for the non-PR lines.
        const CASCADABLE = [null, '', 'SUBMITTED', 'QUOTE_GENERATED', 'QUOTE_ACCEPTED'];
        const linesResult = await Actions.callRest(context, {
          endpoint:  'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2',
          // size: without it the endpoint returns its default 20 rows, so a
          // larger request had only its first 20 lines accepted.
          uriParams: { requestId: Number(requestNumericId), size: 2000 }
        });
        if (linesResult.ok && linesResult.body && Array.isArray(linesResult.body.data)) {
          const targets = linesResult.body.data.filter(l => CASCADABLE.indexOf(l.lineStatus) !== -1);
          // ONE batch PATCH for every line (one transaction, all or nothing),
          // replacing a Promise.all of per-line PATCHes.
          const updates = targets.map(l => {
            const body = {
              id: Number(l.id),
              lineStatus: prLineIds.has(Number(l.id)) ? 'UNDER_PROCUREMENT' : 'QUOTE_ACCEPTED'
            };

            // Stamp the accepted price onto the line. Only when the quote
            // actually carried one — a zero/absent quotedRate must not
            // overwrite a real rate with 0.
            const ql = quotedByLineId.get(Number(l.id));
            if (ql) {
              if (ql.quotedRate      != null) body.billRate     = Number(ql.quotedRate);
              if (ql.quotedUom       != null) body.priceUom     = ql.quotedUom;
              if (ql.quotedLineTotal != null) body.estimatedCost = Number(ql.quotedLineTotal);
              if (ql.quotedQty       != null) body.quantity      = Number(ql.quotedQty);
              if (ql.billFrequency   != null) body.billFrequency = ql.billFrequency;
              if (ql.rateOverriddenFlag != null) body.rateOverriddenFlag = ql.rateOverriddenFlag;
            }
            return body;
          });
          // Best-effort, as before: the contract already exists, so a failed
          // cascade is logged rather than undoing an accept that has happened.
          const batch = await lineBody.updateLines(context, Actions, {
            requestId: Number(requestNumericId),
            headers:   cu.auditHeaders(context),
            updates:   updates
          });
          if (!batch.ok) {
            console.warn('[AcceptQuoteChain] line cascade failed, no line changed:', batch.message);
          }
        } else {
          console.warn('[AcceptQuoteChain] could not fetch lines for status cascade');
        }

        // ── 4c. Mark the quote itself ACCEPTED ───────────────────────────
        // Stamps ACCEPTED_DATE/ACCEPTED_BY on EQR_QUOTE. Last, and best-effort:
        // by this point the contract exists and the lines have moved, so a
        // failure here must not undo an accept that has effectively happened —
        // it leaves the quote record un-stamped, which is a reporting gap, not a
        // broken request.
        try {
          const acceptResp = await Actions.callRest(context, {
            endpoint:  'eqp-v1/acceptCurrentQuote',
            uriParams: { requestId: Number(requestNumericId) }
          });
          if (!acceptResp || !acceptResp.ok) {
            console.warn('[AcceptQuoteChain] acceptCurrentQuote not ok:',
              acceptResp && acceptResp.status, acceptResp && acceptResp.body);
          }
        } catch (eAcc) {
          console.warn('[AcceptQuoteChain] acceptCurrentQuote failed:', eAcc);
        }

        // NOTE: billing is NOT generated here. The schedule is materialized
        // per line by the DB trigger TRG_RL_BILLING_ON_DEPLOY when a line's
        // LINE_STATUS transitions to DEPLOYED (EQR_BILLING_PKG.
        // generate_for_line_on_deploy). Accepting a quote only moves lines to
        // QUOTE_ACCEPTED, so nothing should bill yet — undeployed lines must not
        // carry invoices.
      } else {
        console.warn('[AcceptQuoteChain] requestNumericId missing — cannot set QUOTE_ACCEPTED.');
      }

      // ── 5. Notify user and navigate back ──────────────────────────────
      await Actions.fireNotificationEvent(context, {
        summary: contractNumber
          ? 'Quote accepted — Contract ' + contractNumber + ' created successfully.'
          : 'Quote accepted — contract created successfully.',
        type: 'confirmation'
      });

      await Actions.navigateToPage(context, { page: 'customer-my-requests' });
      } catch (e) {
        console.error('[AcceptQuoteChain] accept failed:', e);
        await Actions.fireNotificationEvent(context, {
          summary: 'Could not accept the quote. Please try again or contact support.',
          type:    'error'
        });
      } finally {
        // Never leave the button stuck on "Processing…" — always reset it.
        $page.variables.isAccepting = false;
      }
    }
  }

  return AcceptQuoteChain;
});
