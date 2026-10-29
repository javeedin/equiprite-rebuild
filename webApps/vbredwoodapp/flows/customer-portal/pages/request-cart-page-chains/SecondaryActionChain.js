define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestModel',
  'resources/js/currentUser',
  'resources/js/requestLineBody',
  'resources/js/requestHeaderBody',
  'resources/js/draftStorage',
], (ActionChain, Actions, requestModel, cu, lineBody, hdr, draftStorage) => {
  'use strict';

  class SecondaryActionChain extends ActionChain {
    async run(context, { event }) {
      const { $page, $flow, $application } = context;
      const actionId = event && event.detail && event.detail.secondaryItem;

      // ────────────────────────────────────────────────────────────────
      // SAVE AS DRAFT
      // ────────────────────────────────────────────────────────────────
      if (actionId === 'saveAsDraft') {
        var cartItems = $flow.variables.CartItemsArray || [];
        if (cartItems.length === 0) {
          await Actions.fireNotificationEvent(context, {
            summary: 'Cart is empty',
            message: 'Add equipment to your request before saving a draft.',
            type: 'warning',
            displayMode: 'transient'
          });
          return;
        }

        // Header built by the SAME shared module Submit uses
        // (requestHeaderBody), so a draft stores everything a submitted request
        // stores: customer, project contract, delivery mode/ids, default hours,
        // dates. The old hand-written draft body dropped 11 of those fields.
        var hd = hdr.derive($flow.variables);
        var detail  = hd.detail;
        var request = hd.request;
        var draftRequestType = hd.requestType;
        var pickedUserId = hd.pickedUserId;
        const reqNum = 'REQ-' + Date.now();
        var geo = await hdr.geocode(hd.locationText, '[SaveDraft]');

        // A reopened DRAFT (Edit Draft) is updated IN PLACE so it keeps its
        // request number; otherwise a new DRAFT request is created.
        var resume = ($flow.variables.resumeDraft && $flow.variables.resumeDraft.id != null)
          ? $flow.variables.resumeDraft : null;
        var headerResult = await hdr.saveHeader(context, Actions, {
          d: hd, reqNum: reqNum, resume: resume, headers: cu.auditHeaders(context)
        });
        console.log('[SaveDraft] header', resume ? 'PATCH (resumed draft ' + resume.id + ')' : 'POST', 'status:', headerResult.status);

        if (!headerResult.ok) {
          await Actions.fireNotificationEvent(context, {
            summary: 'Save failed',
            message: 'Could not save the draft (HTTP ' + headerResult.status + '). Your cart is unchanged.',
            type: 'error',
            displayMode: 'transient'
          });
          return;
        }

        var requestId = headerResult.requestId;

        // Ship-to-site, same as Submit (best-effort; a failed lines batch on a
        // NEW draft deletes the header and its ship-to-site with it). A resumed
        // draft keeps its site unless the address changed.
        if (hdr.needsShipToSite(hd, resume)) {
          await hdr.attachShipToSite(context, Actions, {
            requestId: requestId, reqNum: reqNum, locationText: hd.locationText, geo: geo, tag: '[SaveDraft]'
          });
        }

        // Lines are built EXACTLY as Submit builds them (shared requestLineBody
        // module): same dates, hours, quoted price and estimated cost, so a
        // draft loses nothing a submitted request keeps. Only the status
        // differs — DRAFT, for INTERNAL and EXTERNAL alike.
        //
        // Header default hours and the quote rule are resolved the same way
        // SubmitRequestChain resolves them.
        var draftQuotePending = !!(
          $application &&
          $application.functions.isQuotingAllowed(
            $application.variables.globalSettings,
            $application.variables.flagsLoaded,
            draftRequestType
          )
        );
        // All lines in ONE call (POST .../lines/batch: one transaction, all or
        // nothing, cart order kept, up to 2000 lines), each with lineStatus
        // DRAFT. On failure createLines deletes the empty DRAFT header, so no
        // half-saved draft is left behind, and the cart is kept for a retry.
        var linesResult = await lineBody.saveLines(context, Actions, {
          resume:      resume,
          items:       cartItems,
          headers:     cu.auditHeaders(context),
          ownerUserId: pickedUserId,
          ctx: {
            requestId:        requestId,
            lineStatus:       'DRAFT',
            detail:           detail,
            headerHours:      hd.headerHours,
            agreementLineMap: $flow.variables.agreementLineIdByEquipmentId || {},
            quotePending:     draftQuotePending
          }
        });
        if (!linesResult.ok) {
          await Actions.fireNotificationEvent(context, {
            summary: 'Draft not saved',
            message: linesResult.message + (resume
              ? ' The draft\'s lines were not changed. Your cart is unchanged; fix it and try again.'
              : ' Nothing was saved. Your cart is unchanged; fix it and try again.'),
            type: 'error',
            displayMode: 'persist'
          });
          return;
        }

        try { sessionStorage.removeItem('eqr.agreement.active'); } catch (e) { /* silent */ }

        // Clear the persisted draft too (as Submit does), so neither a refresh
        // nor the next request picks this one back up — in particular
        // resumeDraft, which would otherwise make the next save PATCH it.
        draftStorage.clear();
        $flow.variables.resumeDraft = null;
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
          summary: 'Draft Saved',
          message: 'Draft ' + (headerResult.requestNumber || '') + ' was saved.',
          type: 'confirmation',
          displayMode: 'transient'
        });

        await Actions.navigateToFlow(context, {
          target: 'parent',
          flow: 'main',
          page: 'equipment-requests'
        });
        return;
      }

      // ────────────────────────────────────────────────────────────────
      // SAVE AS TEMPLATE (open dialog)
      // ────────────────────────────────────────────────────────────────
      if (actionId === 'saveAsTemplate') {
        const cartItems = $flow.variables.CartItemsArray || [];
        if (cartItems.length === 0) {
          await Actions.fireNotificationEvent(context, {
            summary: 'Cart is empty',
            message: 'Add equipment to your cart before saving a template.',
            type: 'warning',
            displayMode: 'transient'
          });
          return;
        }

        $page.variables.templateName        = '';
        $page.variables.templateDescription = '';
        $page.variables.templateNameError   = '';

        const dialog = document.getElementById('saveTemplateDialog');
        if (dialog && typeof dialog.open === 'function') dialog.open();
        return;
      }
    }
  }

  return SecondaryActionChain;
});
