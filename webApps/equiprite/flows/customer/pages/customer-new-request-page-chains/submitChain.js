define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/currentUser',
  'resources/js/requestLineBody',
  'resources/js/requestHeaderBody',
  'resources/js/fusionContractDefaults',
], (ActionChain, Actions, cu, lineBody, hdr, fusion) => {
  'use strict';

  // Submit, or Save draft, for a customer (EXTERNAL) request. The old cart's EXTERNAL path, step for step, with the
  // same shared builders: Old EquipRite's customer-portal/pages/request-cart-page-chains/SubmitRequestChain.js for
  // Submit and SecondaryActionChain.js (saveAsDraft) for Save draft.
  //   0 terms    Submit only: the rental terms must be accepted first (the old T&C dialog's gate); the tick is used
  //              up by this submit, as the old chain resets it
  //   1 header   requestHeaderBody.saveHeader: POST createEquipmentRequest as DRAFT (PATCH for a reopened draft), with
  //              the customer columns (eqrCustomerRefId, customerName, contactName, eqrCustomerPortalUserId)
  //   2 site     geocode the address, then createShipToSite and PATCH shipToSiteId (best effort)
  //   3 lines    requestLineBody.saveLines: one batch, each line IN_PROCESS (or DRAFT), unpriced when a quote is coming
  //              (isQuotingAllowed EXTERNAL); a failed batch deletes a new header, so nothing half-saved is left
  //   4 status   PATCH the header to IN_PROCESS (submit only): a customer request has no customer-side approver
  //   5 contract submit only, and only when customer quoting is OFF (isQuotingAllowed CUSTOMER false): POST the Fusion
  //              sell contract, then PATCH contractNumber; best effort, a failure warns and the request stands. With
  //              quoting on, accepting the quote creates it instead (customer-quote acceptQuoteChain).
  // The fixed Fusion values in step 5 are TEST VALUES from resources/js/fusionContractDefaults.js (see there).
  class submitChain extends ActionChain {
    async run(context, { mode }) {
      const { $page } = context;
      // Checked and set before any await, so a double click cannot create two requests.
      if ($page.variables.isSubmitting) {
        return;
      }
      $page.variables.isSubmitting = true;
      $page.variables.submitMode = mode === 'draft' ? 'draft' : 'submit';
      try {
        await this.save(context, mode === 'draft');
      } catch (e) {
        console.error('[submitChain] unexpected error', e);
        await Actions.fireNotificationEvent(context, {
          summary: 'Submission interrupted',
          message: 'Something went wrong while submitting (' + ((e && e.message) || e) + '). '
            + 'The request may already have been saved: check My requests before submitting again.',
          type: 'error',
          displayMode: 'persist',
        });
      } finally {
        try { $page.variables.isSubmitting = false; } catch (e2) { /* page already left */ }
        try { $page.variables.isCreatingContract = false; } catch (e3) { /* page already left */ }
      }
    }

    async save(context, isDraft) {
      const { $page, $application } = context;
      const form = $page.variables.form || {};
      const cart = $page.variables.cart || [];
      const missing = $page.functions.missingFor(isDraft ? 'draft' : 'submit', form, cart);
      if (missing.length) {
        $page.variables.missing = missing;
        return;
      }

      // ── 0. The terms-and-conditions gate (submit only) ──────────────────
      if (!isDraft) {
        if (!$page.variables.termsAccepted) {
          $page.variables.missing = ['Accept the rental terms'];
          return;
        }
        // Terms accepted: reset for the next submit, as the old chain does.
        $page.variables.termsAccepted = false;
      }

      const detail = $page.functions.buildDetail(form);
      const hd = hdr.derive({
        request: $page.functions.buildRequest(form),
        ActiveRequestDetail: detail,
        CartItemsArray: cart,
        requestOrigin: 'customer',
        fromAgreementId: $page.variables.agreementId,
      });
      const postedRequestType = hd.requestType; // EXTERNAL
      const reqNum = 'REQ-' + Date.now();
      const resume = $page.variables.resume && $page.variables.resume.id != null ? $page.variables.resume : null;
      const tag = isDraft ? '[SaveDraft]' : '[Submit]';
      const geo = await hdr.geocode(hd.locationText, tag);

      // ── 1. Header ────────────────────────────────────────────────────────
      const headerResult = await hdr.saveHeader(context, Actions, { d: hd, reqNum, resume, headers: cu.auditHeaders(context) });
      if (!headerResult.ok) {
        await Actions.fireNotificationEvent(context, {
          summary: isDraft ? 'Save failed' : 'Submission failed',
          message: (resume ? 'Could not update the draft' : (isDraft ? 'Could not save the draft' : 'Could not create the request'))
            + ' (HTTP ' + headerResult.status + '). Your cart is unchanged.',
          type: 'error',
          displayMode: 'persist',
        });
        return;
      }
      const requestId = headerResult.requestId;
      const savedReqNum = headerResult.requestNumber;

      // ── 2. Ship-to-site (best effort) ────────────────────────────────────
      if (hdr.needsShipToSite(hd, resume)) {
        await hdr.attachShipToSite(context, Actions, { requestId, reqNum, locationText: hd.locationText, geo, tag });
      }

      // ── 3. Lines ─────────────────────────────────────────────────────────
      const quotePending = !!$application.functions.isQuotingAllowed(
        $application.variables.globalSettings, $application.variables.flagsLoaded, postedRequestType);
      const submittedStatus = 'IN_PROCESS';
      const linesResult = await lineBody.saveLines(context, Actions, {
        resume,
        items: cart,
        headers: cu.auditHeaders(context),
        ownerUserId: hd.pickedUserId,
        ctx: {
          requestId,
          lineStatus: isDraft ? 'DRAFT' : submittedStatus,
          detail: hd.detail,
          headerHours: hd.headerHours,
          agreementLineMap: $page.variables.agreementLineMap || {},
          quotePending,
        },
      });
      if (!linesResult.ok) {
        await Actions.fireNotificationEvent(context, {
          summary: isDraft ? 'Draft not saved' : 'Submission failed',
          message: linesResult.message + (resume
            ? ' The draft is still saved and still a draft; its lines were not changed. Your cart is unchanged; fix it and try again.'
            : ' Nothing was saved. Your cart is unchanged; fix it and try again.'),
          type: 'error',
          displayMode: 'persist',
        });
        return;
      }

      if (!isDraft) {
        // ── 4. Status ──────────────────────────────────────────────────────
        const patchResult = await Actions.callRest(context, {
          endpoint: 'eqp-v1/patchEquipmentRequest',
          uriParams: { id: requestId },
          body: { status: submittedStatus },
        });
        if (!patchResult || !patchResult.ok) {
          console.warn('[submitChain] Status PATCH failed:', JSON.stringify(patchResult && patchResult.body));
        }

        // ── 5. Fusion sell contract, only when customer quoting is off ─────
        const quotingOn = $application.functions.isQuotingAllowed(
          $application.variables.globalSettings, $application.variables.flagsLoaded, 'CUSTOMER');
        if (!quotingOn) {
          await this.createContract(context, { cart, detail: hd.detail, maxEffectiveEndDate: hd.maxEffectiveEndDate, reqNum, requestId });
        }
      }

      $page.variables.cart = [];
      $page.variables.resume = null;

      await Actions.fireNotificationEvent(context, isDraft
        ? { summary: 'Draft Saved', message: 'Draft ' + (savedReqNum || '') + ' was saved.', type: 'confirmation', displayMode: 'transient' }
        : { summary: 'Request Submitted', message: 'Your equipment request ' + savedReqNum + ' has been submitted successfully.',
            type: 'confirmation', displayMode: 'persist' });

      await Actions.navigateToPage(context, {
        page: 'customer-request',
        params: { requestId: String(savedReqNum || ''), requestNumericId: Number(requestId) },
      });
    }

    /** Step 5 of SubmitRequestChain, unchanged but for where the fixed values come from. */
    async createContract(context, { cart, detail, maxEffectiveEndDate, reqNum, requestId }) {
      const { $page } = context;
      const toISODate = hdr.toISODate;
      // Full-page "Creating your contract" while the Fusion round-trip runs; always cleared.
      $page.variables.isCreatingContract = true;
      try {
        // EstimatedAmount from the cart lines: sum(billRate × qty × days), both end dates counted (the quote page's
        // day count). The pre-markup rate total: there is no quote to mark up.
        const estimatedAmount = cart.reduce((sum, it) => {
          const r = Number(it.billingRate) || 0;
          const q = Number(it.quantity) || 1;
          const sd = toISODate(it.startDate || detail.requestedStartDate);
          const ed = toISODate(it.endDate || detail.requestedEndDate);
          let d = 0;
          if (sd && ed) {
            const s0 = new Date(sd);
            const e0 = new Date(ed);
            if (!isNaN(s0) && !isNaN(e0)) {
              d = Math.max(0, Math.round((e0 - s0) / (1000 * 60 * 60 * 24)) + 1);
            }
          }
          return sum + (r * q * d);
        }, 0);

        const contractLines = cart.map((it, idx) => fusion.contractLine({
          lineNumber:      idx + 1,
          itemName:        it.name || '',
          itemDescription: [it.name, it.className || it.equipmentClass].filter((v) => !!v).join(' - '),
          startDate:       toISODate(it.startDate || detail.requestedStartDate)
        }));

        const contractResult = await Actions.callRest(context, {
          endpoint: fusion.ENDPOINT,
          body: fusion.contractBody({
            cognomen:        reqNum,
            startDate:       toISODate(detail.requestedStartDate),
            endDate:         toISODate(maxEffectiveEndDate),
            estimatedAmount: estimatedAmount,
            lines:           contractLines
          })
        });

        if (contractResult && contractResult.ok && contractResult.body && contractResult.body.ContractNumber) {
          const cNum = String(contractResult.body.ContractNumber);
          const cPatch = await Actions.callRest(context, {
            endpoint:  'eqp-v1/patchEquipmentRequest',
            uriParams: { id: requestId },
            body:      { contractNumber: cNum }
          });
          if (!cPatch || !cPatch.ok) {
            // The contract exists in Fusion but is not recorded: a retry would create a duplicate.
            console.error('[submitChain] contract ' + cNum + ' created but contractNumber PATCH failed: record it manually'
              + ' to avoid a duplicate on retry.', cPatch && cPatch.status);
          }
        } else {
          console.error('[submitChain] contract creation failed:', contractResult && contractResult.status, contractResult && contractResult.body);
          await Actions.fireNotificationEvent(context, {
            summary:     'Contract not created',
            message:     'The request was submitted, but its contract could not be created. '
                       + 'Please notify support so it can be raised manually.',
            type:        'warning',
            displayMode: 'persist'
          });
        }
      } catch (eC) {
        console.error('[submitChain] contract creation threw:', eC);
        await Actions.fireNotificationEvent(context, {
          summary:     'Contract not created',
          message:     'The request was submitted, but its contract could not be created. '
                     + 'Please notify support so it can be raised manually.',
          type:        'warning',
          displayMode: 'persist'
        });
      } finally {
        $page.variables.isCreatingContract = false;
      }
    }
  }

  return submitChain;
});
