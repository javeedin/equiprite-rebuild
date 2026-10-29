define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestLineBody',
  'resources/js/currentUser',
  'resources/js/fusionContractDefaults',
], (ActionChain, Actions, lineBody, cu, fusion) => {
  'use strict';

  // Accept the quote: Old EquipRite's customer-portal/pages/customer-quote-page-chains/AcceptQuoteChain.js, step for
  // step, same endpoints, bodies and order:
  //   1 POST the Fusion sell contract (ProjectLOV .../contracts). The fixed legal entity, party and contract type are
  //     TEST VALUES, now read from resources/js/fusionContractDefaults.js (see the note there). A failure stops here.
  //   2 PATCH the request: status QUOTE_ACCEPTED (+ contractNumber from Fusion)
  //   3 GET purchase-requisitions for the request: lines with a PR go UNDER_PROCUREMENT (best effort)
  //   4 GET the current quote lines: the accepted price is stamped on each line (best effort)
  //   5 GET the request lines, then ONE PATCH .../lines/batch: QUOTE_ACCEPTED (or UNDER_PROCUREMENT) + quoted price
  //   6 POST quote/accept, which stamps ACCEPTED_DATE / ACCEPTED_BY on EQR_QUOTE (best effort)
  // Billing is not generated here: a line bills when it goes DEPLOYED (database trigger).
  // The mirror of step 1 is customer-new-request's submitChain: with customer quoting off there is no accept, so
  // submit creates the contract. Exactly one of the two runs for a request.
  class acceptQuoteChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const quoteData        = $page.variables.quoteData;
      const requestNumericId = $page.variables.requestNumericId;

      if (!quoteData || !quoteData.requestNumber) {
        console.warn('[acceptQuoteChain] No quote data available.');
        return;
      }
      // A second click while the first is running must not create a second contract.
      if ($page.variables.isAccepting) {
        return;
      }

      $page.variables.isAccepting = true;

      try {
        // ── 1. Build ContractLine array — one entry per equipment line ─────
        const contractLines = (quoteData.lines || []).map((line, idx) => fusion.contractLine({
          lineNumber:      idx + 1,
          itemName:        line.equipmentName || '',
          itemDescription: [line.equipmentName, line.equipmentClass].filter((v) => !!v).join(' - '),
          startDate:       line.startDate || null
        }));

        const payload = fusion.contractBody({
          cognomen:        quoteData.requestNumber,
          startDate:       quoteData.startDate  || null,
          endDate:         quoteData.endDate    || null,
          estimatedAmount: quoteData.grandTotal || 0,
          lines:           contractLines
        });

        // ── 2. Create the contract in Oracle Fusion ─────────────────────────
        const contractResult = await Actions.callRest(context, {
          endpoint: fusion.ENDPOINT,
          body:     payload
        });

        if (!contractResult || !contractResult.ok) {
          console.error('[acceptQuoteChain] Contract creation failed:', contractResult && contractResult.status, contractResult && contractResult.body);
          await Actions.fireNotificationEvent(context, {
            summary: 'Failed to create contract. Please try again or contact support.',
            type:    'error'
          });
          return;
        }

        // ── 3. ContractNumber from the response ─────────────────────────────
        const contractNumber = contractResult.body && contractResult.body.ContractNumber
          ? contractResult.body.ContractNumber
          : null;

        // ── 4. Request → QUOTE_ACCEPTED + ContractNumber; lines cascade ─────
        if (requestNumericId) {
          const headerBody = { status: 'QUOTE_ACCEPTED' };
          if (contractNumber) headerBody.contractNumber = String(contractNumber);

          const patchResult = await Actions.callRest(context, {
            endpoint:  'eqp-v1/patchEquipmentRequest',
            uriParams: { id: Number(requestNumericId) },
            body:      headerBody
          });
          if (!patchResult || !patchResult.ok) {
            console.warn('[acceptQuoteChain] header PATCH (QUOTE_ACCEPTED) failed:', patchResult && patchResult.status, patchResult && patchResult.body);
          }

          // ── 4a. Lines with a PR raised go UNDER_PROCUREMENT (best effort) ──
          const prLineIds = new Set();
          try {
            const prResp = await Actions.callRest(context, {
              endpoint:  'eqp-v1/getPurchaseRequisitions',
              uriParams: { requestId: Number(requestNumericId), size: 500 }
            });
            if (prResp && prResp.ok && prResp.body && Array.isArray(prResp.body.data)) {
              prResp.body.data.forEach((m) => {
                if (m && m.eqrRequestLineId != null) prLineIds.add(Number(m.eqrRequestLineId));
              });
            } else {
              console.warn('[acceptQuoteChain] PR mirror fetch not ok — treating all lines as non-PR');
            }
          } catch (ePr) {
            console.warn('[acceptQuoteChain] PR mirror fetch failed — treating all lines as non-PR:', ePr);
          }

          // ── 4a-bis. The quoted prices, from the quote record (best effort) ─
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
              qlRows.forEach((ql) => {
                if (ql && ql.requestLineId != null) quotedByLineId.set(Number(ql.requestLineId), ql);
              });
            } else {
              console.warn('[acceptQuoteChain] quote lines fetch not ok — keeping existing line rates');
            }
          } catch (eQl) {
            console.warn('[acceptQuoteChain] quote lines fetch failed — keeping existing line rates:', eQl);
          }

          // ── 4b. Cascade lines (mirrors confirmRequestChain) ────────────────
          const CASCADABLE = [null, '', 'SUBMITTED', 'QUOTE_GENERATED', 'QUOTE_ACCEPTED'];
          const linesResult = await Actions.callRest(context, {
            endpoint:  'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2',
            uriParams: { requestId: Number(requestNumericId), size: 2000 }
          });
          if (linesResult && linesResult.ok && linesResult.body && Array.isArray(linesResult.body.data)) {
            const targets = linesResult.body.data.filter((l) => CASCADABLE.indexOf(l.lineStatus) !== -1);
            const updates = targets.map((l) => {
              const body = {
                id: Number(l.id),
                lineStatus: prLineIds.has(Number(l.id)) ? 'UNDER_PROCUREMENT' : 'QUOTE_ACCEPTED'
              };
              // Stamp the accepted price onto the line, only when the quote carried one.
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
            // Best effort: the contract exists, so a failed cascade is logged, not undone.
            const batch = await lineBody.updateLines(context, Actions, {
              requestId: Number(requestNumericId),
              headers:   cu.auditHeaders(context),
              updates:   updates
            });
            if (!batch.ok) {
              console.warn('[acceptQuoteChain] line cascade failed, no line changed:', batch.message);
            }
          } else {
            console.warn('[acceptQuoteChain] could not fetch lines for status cascade');
          }

          // ── 4c. Mark the quote itself ACCEPTED (best effort, last) ─────────
          try {
            const acceptResp = await Actions.callRest(context, {
              endpoint:  'eqp-v1/acceptCurrentQuote',
              uriParams: { requestId: Number(requestNumericId) }
            });
            if (!acceptResp || !acceptResp.ok) {
              console.warn('[acceptQuoteChain] acceptCurrentQuote not ok:', acceptResp && acceptResp.status, acceptResp && acceptResp.body);
            }
          } catch (eAcc) {
            console.warn('[acceptQuoteChain] acceptCurrentQuote failed:', eAcc);
          }
        } else {
          console.warn('[acceptQuoteChain] requestNumericId missing — cannot set QUOTE_ACCEPTED.');
        }

        // ── 5. Tell the customer, then back to the request ─────────────────
        await Actions.fireNotificationEvent(context, {
          summary: contractNumber
            ? 'Quote accepted — Contract ' + contractNumber + ' created successfully.'
            : 'Quote accepted — contract created successfully.',
          type: 'confirmation'
        });

        $page.variables.quoteData = Object.assign({}, quoteData, { contractNumber: contractNumber ? String(contractNumber) : (quoteData.contractNumber || '') });
        await Actions.navigateToPage(context, {
          page: 'customer-request',
          params: { requestId: quoteData.requestNumber, requestNumericId: requestNumericId != null ? Number(requestNumericId) : null }
        });
      } catch (e) {
        console.error('[acceptQuoteChain] accept failed:', e);
        await Actions.fireNotificationEvent(context, {
          summary: 'Could not accept the quote. Please try again or contact support.',
          type:    'error'
        });
      } finally {
        // Never leave the button stuck — always reset it.
        $page.variables.isAccepting = false;
      }
    }
  }

  return acceptQuoteChain;
});
