define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/draftStorage',
  'resources/js/geocoder',
  'resources/js/requestModel',
  'resources/js/currentUser',
  'resources/js/requestLineBody',
  'resources/js/requestHeaderBody',
], (ActionChain, Actions, draftStorage, geocoder, requestModel, cu, lineBody, hdr) => {
  'use strict';

  class SubmitRequestChain extends ActionChain {
    // Wrapper: owns the in-flight flag so the "Submitting your request…" overlay
    // can NEVER be left on. Before this, an unexpected error after the request
    // was already saved left the spinner up forever, and the user's retry
    // created a duplicate request (REQ-…731 / …732, 2026-10-12).
    async run(context) {
      const { $page } = context;

      // Reject immediately if a submit is already in flight (project-flow
      // double-click guard). Must be checked AND set synchronously before any
      // await so a second invocation that starts while the first is at an
      // async yield is blocked at the top of the chain, not inside it.
      if ($page.variables.isSubmitting) { return; }
      $page.variables.isSubmitting = true;
      try {
        await this.submit(context);
      } catch (e) {
        console.error('[Submit] unexpected error:', e);
        await Actions.fireNotificationEvent(context, {
          summary: 'Submission interrupted',
          message: 'Something went wrong while submitting (' + ((e && e.message) || e) + '). '
            + 'The request may already have been saved — check Equipment Requests before submitting again.',
          type: 'error',
          displayMode: 'persist'
        });
      } finally {
        // The success path has navigated away by now; the cart page (and its
        // variables) may already be gone, which is fine.
        try { $page.variables.isSubmitting = false; } catch (e2) { /* page disposed */ }
      }
    }

    async submit(context) {
      const { $page, $flow, $application } = context;

      // ── Is this a customer (EXTERNAL) request? ─────────────────────────
      // Resolved HERE, at the very top, because the T&C gate immediately below
      // depends on it — and the answer is no longer "which page did you come
      // from". project-create-request is a unified entry point: choosing
      // Request Type = External there raises a customer request that must
      // behave exactly like one raised in the customer flow, T&C dialog
      // included.
      //
      // The PICKER is the source of truth; requestOrigin is only the fallback
      // for customer-create-req-page, which has no picker and is EXTERNAL by
      // definition. Normalised to the two literals CK_EQR_REQ_REQUEST_TYPE
      // allows so an unexpected value can never 400 the POST further down.
      //
      // ONE derived flag drives everything customer-specific from here on:
      // the T&C gate, which user-id column is filled, whether the customer
      // identity is sent, the submitted status (IN_PROCESS vs SUBMITTED), the
      // contract creation, and the requestType actually posted. They must all
      // agree or a request ends up half customer, half project.
      var chosenType = String(
        ($flow.variables.request && $flow.variables.request.requestType) ||
        $flow.variables.requestType || ''
      ).toUpperCase();
      var postedRequestType = (chosenType === 'EXTERNAL' || chosenType === 'INTERNAL')
        ? chosenType
        : (($flow.variables.requestOrigin === 'customer') ? 'EXTERNAL' : 'INTERNAL');
      const isCustomerOrigin = (postedRequestType === 'EXTERNAL');

      // ── Soft reservation: complete before submit ────────────────────────
      // A soft reservation only had to give dates on the create page; it may
      // not be SUBMITTED until it has everything a firm request has. Checked
      // BEFORE the T&C gate so the user isn't asked to accept terms for a
      // request that cannot go yet. The popup sends them back to the create
      // form (CompleteDetailsChain) with the cart kept.
      const isSoftReservation =
        ($flow.variables.ActiveRequestDetail || {}).isSoftReservation === true ||
        ($flow.variables.request || {}).isSoftReservation === true;
      if (isSoftReservation) {
        const projectFieldsShown = !isCustomerOrigin ||
          $application.functions.isFeatureEnabled(
            $application.variables.featureFlags,
            $application.variables.flagsLoaded,
            'EXTERNAL_PROJECT_ASSIGN_ENABLED'
          );
        const missingFields = hdr.missingForSubmit(hdr.derive($flow.variables), projectFieldsShown);
        if (missingFields.length > 0) {
          $page.variables.missingForSubmit = missingFields;
          $page.variables.isSubmitting = false;
          const completeDlg = document.getElementById('completeDetailsDialog');
          if (completeDlg && typeof completeDlg.open === 'function') completeDlg.open();
          return;
        }
      }

      // Customer-mode requests must accept T&C first. Open the dialog and
      // return; the dialog's Submit button calls onTermsAcceptedChain which
      // sets termsAccepted = true and re-invokes this chain to proceed.
      if (isCustomerOrigin && !$page.variables.termsAccepted) {
        // Not actually submitting yet — re-enable so the dialog's own button
        // can call this chain again once T&C are accepted.
        $page.variables.isSubmitting = false;
        $page.variables.insurancePolicy    = '';
        $page.variables.issueAgency        = '';
        $page.variables.insuranceStartDate = '';
        $page.variables.insuranceEndDate   = '';
        $page.variables.termsAccepted      = false;
        $page.variables.isTermsDialogOpen  = true;
        const dlg = document.getElementById('termsDialog');
        if (dlg && typeof dlg.open === 'function') dlg.open();
        return;
      }
      // Terms accepted — close dialog, restore button, reset flag for next submit.
      $page.variables.isTermsDialogOpen = false;
      const termsDlg = document.getElementById('termsDialog');
      if (termsDlg && typeof termsDlg.close === 'function') termsDlg.close();
      if (isCustomerOrigin) $page.variables.termsAccepted = false;

      var cartItems = $flow.variables.CartItemsArray || [];
      if (cartItems.length === 0) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Cart is empty',
          message: 'Add equipment to your request before submitting.',
          type: 'warning',
          displayMode: 'transient'
        });
        $page.variables.isSubmitting = false;
        return;
      }

      // Header values, resolved once by the shared requestHeaderBody module —
      // the same one Save as Draft uses, so a draft and a submitted request
      // store the same fields. The locals below are the ones the rest of this
      // chain still reads (lines, ship-to-site, Fusion contract).
      var hd = hdr.derive($flow.variables);
      // A soft reservation that got this far is complete, so it is submitted
      // as a firm request (IS_SOFT_RESERVATION = N). Overridden on the derived
      // snapshot only: Save as Draft still stores it as soft.
      if (isSoftReservation) {
        hd.detail = Object.assign({}, hd.detail, { isSoftReservation: false });
      }
      var detail = hd.detail;
      var request = hd.request;
      var maxEffectiveEndDate = hd.maxEffectiveEndDate;
      var locationText = hd.locationText;
      var headerHours = hd.headerHours;
      var fromAgreementId = hd.fromAgreementId;
      var pickedUserId = hd.pickedUserId;
      const toISODate = hdr.toISODate;
      const reqNum = 'REQ-' + Date.now();

      // Geocode up-front so the round-trip overlaps the user's Submit intent;
      // the ship-to-site itself is created after the header (it needs the id).
      var geo = await hdr.geocode(locationText, '[Submit]');

      // isCustomerOrigin was resolved at the TOP of this chain (the T&C gate
      // needs it first) with the same rule derive() applies.
      var isCustomerMode = isCustomerOrigin;

      // A reopened DRAFT (Edit Draft / Submit Draft) is updated IN PLACE so it
      // keeps its request number; otherwise a new request is created. Either
      // way the header is DRAFT here and moves to SUBMITTED / IN_PROCESS only
      // after the lines are saved.
      var resume = ($flow.variables.resumeDraft && $flow.variables.resumeDraft.id != null)
        ? $flow.variables.resumeDraft : null;
      var headerResult = await hdr.saveHeader(context, Actions, {
        d: hd, reqNum: reqNum, resume: resume, headers: cu.auditHeaders(context)
      });
      console.log('[Submit] header', resume ? 'PATCH (resumed draft ' + resume.id + ')' : 'POST', 'status:', headerResult.status);

      if (!headerResult.ok) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Submission failed',
          message: (resume ? 'Could not update the draft' : 'Could not create the request')
            + ' (HTTP ' + headerResult.status + '). Your cart is unchanged.',
          type: 'error',
          displayMode: 'transient'
        });
        $page.variables.isSubmitting = false;
        return;
      }

      var requestId = headerResult.requestId;
      // The backend assigns the real request number from a sequence (it ignores
      // the reqNum placeholder), so this is the number the user sees elsewhere.
      var savedReqNum = headerResult.requestNumber;

      // ── Ship-to-site (best-effort, shared with Save as Draft) ──────────
      // A resumed draft keeps its site unless the address changed.
      if (hdr.needsShipToSite(hd, resume)) {
        await hdr.attachShipToSite(context, Actions, {
          requestId: requestId, reqNum: reqNum, locationText: locationText, geo: geo, tag: '[Submit]'
        });
      }

      // ── Is a quote coming for this request? ───────────────────────────
      // When ENABLE_QUOTES covers this origin the cart shows "Rate on request"
      // and no subtotal, because the price is settled on the quote by a manager
      // who can still adjust markup and per-line rates. Posting a price anyway
      // would contradict the screen the customer just submitted from: the line
      // would carry a figure nobody was shown and nobody agreed to.
      //
      // So the price fields are omitted entirely — BILL_RATE, PRICE_UOM and
      // ESTIMATED_COST stay null until SendQuoteChain writes the quoted values.
      // A null rate is the honest representation of "not priced yet"; a list
      // price sitting in BILL_RATE reads as an agreed one.
      //
      // Same resolver the cart and catalog use for hideRatesForQuote, so the
      // three cannot disagree about whether a quote is coming. Fails CLOSED to
      // false (price IS posted) while settings load — matching the display side,
      // where showing rates is the pre-existing behaviour.
      var quotePending = !!(
        $application &&
        $application.functions.isQuotingAllowed(
          $application.variables.globalSettings,
          $application.variables.flagsLoaded,
          postedRequestType
        )
      );

      // Submitted status is ORIGIN-DEPENDENT — this chain serves both portals.
      //   CUSTOMER → IN_PROCESS. There is no customer-side approver, so the
      //              request is live on submit.
      //   PROJECT  → SUBMITTED. A project approver must approve it
      //              (equipment-request-detail-page → confirmRequestChain) before
      //              it becomes IN_PROCESS. Landing a project request on
      //              IN_PROCESS here SKIPS that approval entirely and unlocks
      //              allocation early — allocation is gated on the header not
      //              being SUBMITTED.
      // Resolved BEFORE the lines so each line is created with it (see below).
      var submittedStatus = isCustomerOrigin ? 'IN_PROCESS' : 'SUBMITTED';

      // ── All lines in ONE call ──────────────────────────────────────────
      // POST .../lines/batch: one transaction, all or nothing, cart order kept,
      // up to 2000 lines. Every line is created WITH lineStatus =
      // submittedStatus (shared requestLineBody builder; Save as Draft uses it
      // with DRAFT), so no per-line status PATCH follows.
      //
      // The header is still DRAFT here, deliberately: if the batch fails,
      // createLines deletes it (DELETE only accepts DRAFT), so no empty request
      // is left behind. The header moves to submittedStatus only after the lines
      // exist. The cart is untouched on failure, so the user can just retry.
      //
      // A resumed draft instead REPLACES its lines (PUT .../lines/batch, DRAFT
      // only) and is never deleted on failure — it stays a draft, still DRAFT.
      var linesResult = await lineBody.saveLines(context, Actions, {
        resume:      resume,
        items:       cartItems,
        headers:     cu.auditHeaders(context),
        ownerUserId: pickedUserId,
        ctx: {
          requestId:        requestId,
          lineStatus:       submittedStatus,
          detail:           detail,
          headerHours:      headerHours,
          agreementLineMap: $flow.variables.agreementLineIdByEquipmentId || {},
          quotePending:     quotePending
        }
      });
      if (!linesResult.ok) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Submission failed',
          message: linesResult.message + (resume
            ? ' The draft is still saved and still a draft; its lines were not changed. Your cart is unchanged; fix it and submit again.'
            : ' Nothing was saved. Your cart is unchanged; fix it and submit again.'),
          type: 'error',
          displayMode: 'persist'
        });
        $page.variables.isSubmitting = false;
        return;
      }

      var patchResult = await Actions.callRest(context, {
        endpoint: 'eqp-v1/patchEquipmentRequest',
        uriParams: { id: requestId },
        body: { status: submittedStatus }
      });

      console.log('[Submit] PATCH status:', patchResult.status);
      if (!patchResult.ok) {
        console.warn('[Submit] Status PATCH failed:', JSON.stringify(patchResult.body));
      }

      // No per-line status PATCH: every line was created with submittedStatus.

      // ── Fusion sell contract — ONLY when customer quoting is switched off ───
      // Normally the contract is created when the customer ACCEPTS a quote
      // (customer-quote-page AcceptQuoteChain). But when ENABLE_QUOTES excludes
      // the customer flow (NONE / PROJECTS) there is no quote and therefore no
      // accept, so nothing would ever create one — a customer rental with no
      // commercial record. This is the only path that fills that gap.
      //
      // Deliberately NOT created when quoting IS enabled for customers
      // (CUSTOMER / BOTH): accept still owns it there, and creating one here too
      // would produce two contracts for the same request. The quoted (marked-up)
      // total is also the better EstimatedAmount when a quote exists.
      //
      // Customer-origin only — project requests never get a sell contract.
      //
      // BEST-EFFORT BY DESIGN: a Fusion outage must not stop a customer from
      // submitting a request, so a failure here is logged and surfaced as a
      // warning while the request itself stands. contractNumber stays null and
      // needs a follow-up; it does NOT roll back the submit.
      if (isCustomerOrigin) {
        const quotingOn = $application.functions.isQuotingAllowed(
          $application.variables.globalSettings,
          $application.variables.flagsLoaded,
          'CUSTOMER'
        );
        if (!quotingOn) {
          // Show the full-page loader for the duration of the Fusion round-trip —
          // it's the slow part of submit, and without this the page looks frozen.
          // Cleared in the finally below so it can never stay stuck on.
          $page.variables.isCreatingContract = true;
          try {
            // EstimatedAmount from the cart lines: sum(billRate × qty × days),
            // inclusive of both end dates (same day-count math as the quote page).
            // This is the pre-markup rate total — there is no quote to mark up.
            var estimatedAmount = cartItems.reduce(function (sum, it) {
              var r = Number(it.billingRate) || 0;
              var q = Number(it.quantity)    || 1;
              var sd = toISODate(it.startDate || detail.requestedStartDate);
              var ed = toISODate(it.endDate   || detail.requestedEndDate);
              var d = 0;
              if (sd && ed) {
                var s0 = new Date(sd);
                var e0 = new Date(ed);
                if (!isNaN(s0) && !isNaN(e0)) {
                  d = Math.max(0, Math.round((e0 - s0) / (1000 * 60 * 60 * 24)) + 1);
                }
              }
              return sum + (r * q * d);
            }, 0);

            var contractLines = cartItems.map(function (it, idx) {
              return {
                LinePuid:        null,
                LineNumber:      String(idx + 1),
                LineTypeId:      300000000099381,
                LineTypeName:    'Free-form, project',
                ItemNameTxt:     it.name || '',
                ItemDescription: [it.name, it.className || it.equipmentClass]
                                   .filter(function (v) { return !!v; })
                                   .join(' - '),
                StartDate:       toISODate(it.startDate || detail.requestedStartDate)
              };
            });

            // Same payload shape AcceptQuoteChain uses — the constants are the
            // configured Fusion sell-contract setup, not per-request values.
            var contractResult = await Actions.callRest(context, {
              endpoint: 'ProjectLOV/postFscmRestApiResources11_13_18_05Contracts',
              body: {
                Cognomen:         reqNum,
                LegalEntityName:  'EPC UAE',
                OrgId:            300000334372921,
                PrimaryPartyId:   100000000395788,
                ContractTypeId:   300000048179116,
                InvOrgName:       'Operations',
                OrgName:          'EPC_UAE_BU',
                ContractTypeName: 'Sell Lines',
                PartyName:        'Stark Industries',
                StartDate:        toISODate(detail.requestedStartDate),
                EndDate:          toISODate(maxEffectiveEndDate),
                EstimatedAmount:  estimatedAmount,
                CurrencyCode:     'USD',
                ContractLine:     contractLines
              }
            });

            if (contractResult && contractResult.ok && contractResult.body &&
                contractResult.body.ContractNumber) {
              var cNum = String(contractResult.body.ContractNumber);
              var cPatch = await Actions.callRest(context, {
                endpoint:  'eqp-v1/patchEquipmentRequest',
                uriParams: { id: requestId },
                body:      { contractNumber: cNum }
              });
              if (cPatch && cPatch.ok) {
                console.log('[Submit] contract created + stamped:', cNum);
              } else {
                // Contract exists in Fusion but we failed to record it — worse
                // than no contract, because a retry would create a duplicate.
                console.error('[Submit] contract ' + cNum + ' created but ' +
                  'contractNumber PATCH failed — record it manually to avoid a ' +
                  'duplicate on retry.', cPatch && cPatch.status);
              }
            } else {
              console.error('[Submit] contract creation failed:',
                contractResult && contractResult.status, contractResult && contractResult.body);
              await Actions.fireNotificationEvent(context, {
                summary:     'Contract not created',
                message:     'The request was submitted, but its contract could not be created. ' +
                             'Please notify support so it can be raised manually.',
                type:        'warning',
                displayMode: 'persist'
              });
            }
          } catch (eC) {
            console.error('[Submit] contract creation threw:', eC);
            await Actions.fireNotificationEvent(context, {
              summary:     'Contract not created',
              message:     'The request was submitted, but its contract could not be created. ' +
                           'Please notify support so it can be raised manually.',
              type:        'warning',
              displayMode: 'persist'
            });
          } finally {
            // Always drop the overlay — success, contract failure, or throw.
            // Leaving it up would trap the user behind a permanent loader on a
            // request that HAS been created.
            $page.variables.isCreatingContract = false;
          }
        }
      }

      // All lines succeeded — wipe both in-memory + persisted draft so the
      // next request starts clean across refresh / tabs.
      draftStorage.clear();
      $flow.variables.resumeDraft = null;
      try { sessionStorage.removeItem('eqr.agreement.active'); } catch (e) { /* silent */ }

      $flow.variables.CartItemsArray = [];
      $flow.variables.ActiveRequestDetail = {};
      $flow.variables.fromAgreementId = null;
      $flow.variables.fromAgreementNumber = '';
      $flow.variables.fromAgreementCustomer = '';
      $flow.variables.fromAgreementEffectiveFrom = '';
      $flow.variables.fromAgreementEffectiveTo = '';
      $flow.variables.agreementLineIdByEquipmentId = {};
      $flow.variables.agreementClassIds = [];
      $flow.variables.requestOrigin = '';
      $flow.variables.request = requestModel.defaultRequest();

      await Actions.fireNotificationEvent(context, {
        summary: 'Request Submitted',
        message: 'Your equipment request ' + savedReqNum + ' has been submitted successfully.',
        type: 'confirmation',
        displayMode: 'persist',
      });

      $page.variables.isSubmitting = false;

      if (isCustomerMode) {
        await Actions.navigateToPage(context, {
          page: 'customer-my-requests'
        });
      } else {
        await Actions.navigateToFlow(context, {
          target: 'parent',
          flow: 'main',
          page: 'equipment-requests'
        });
      }
    }
  }

  return SubmitRequestChain;
});
