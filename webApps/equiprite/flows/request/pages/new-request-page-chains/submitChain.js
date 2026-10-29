define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/currentUser',
  'resources/js/requestLineBody',
  'resources/js/requestHeaderBody',
], (ActionChain, Actions, cu, lineBody, hdr) => {
  'use strict';

  // Submit for approval, or Save draft. The old cart's INTERNAL path, step for step (SubmitRequestChain and
  // SecondaryActionChain), with the same shared builders:
  //   1 header   requestHeaderBody.saveHeader: POST createEquipmentRequest as DRAFT (PATCH for a reopened draft)
  //   2 site     geocode the address, then createShipToSite and PATCH shipToSiteId (best effort)
  //   3 lines    requestLineBody.saveLines: one batch, each line SUBMITTED (or DRAFT); a failed batch deletes a
  //              new header, so nothing half-saved is left
  //   4 status   PATCH the header to SUBMITTED (submit only). SUBMITTED, not IN_PROCESS: a project request
  //              waits for its approver (FDD 7.6).
  // Customer requests are not raised here (see the page), so the old customer-only steps (terms dialog, Fusion
  // sell contract) do not apply.
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
          summary: 'Saving was interrupted',
          message: 'Something went wrong (' + ((e && e.message) || e) + '). '
            + 'The request may already be saved: check My requests before trying again.',
          type: 'error',
          displayMode: 'persist',
        });
      } finally {
        try { $page.variables.isSubmitting = false; } catch (e2) { /* page already left */ }
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

      const detail = $page.functions.buildDetail(form);
      const hd = hdr.derive({
        request: form,
        ActiveRequestDetail: detail,
        CartItemsArray: cart,
        requestOrigin: 'project',
        fromAgreementId: $page.variables.agreementId,
      });
      const reqNum = 'REQ-' + Date.now();
      const resume = $page.variables.resume && $page.variables.resume.id != null ? $page.variables.resume : null;
      const tag = isDraft ? '[SaveDraft]' : '[Submit]';
      const geo = await hdr.geocode(hd.locationText, tag);

      const headerResult = await hdr.saveHeader(context, Actions, { d: hd, reqNum, resume, headers: cu.auditHeaders(context) });
      if (!headerResult.ok) {
        await Actions.fireNotificationEvent(context, {
          summary: isDraft ? 'Draft not saved' : 'Request not submitted',
          message: (resume ? 'The draft could not be updated' : 'The request could not be created')
            + ' (HTTP ' + headerResult.status + '). Your cart is unchanged.',
          type: 'error',
          displayMode: 'persist',
        });
        return;
      }
      const requestId = headerResult.requestId;

      if (hdr.needsShipToSite(hd, resume)) {
        await hdr.attachShipToSite(context, Actions, { requestId, reqNum, locationText: hd.locationText, geo, tag });
      }

      const status = isDraft ? 'DRAFT' : 'SUBMITTED';
      const quotePending = !!$application.functions.isQuotingAllowed(
        $application.variables.globalSettings, $application.variables.flagsLoaded, 'INTERNAL');
      const linesResult = await lineBody.saveLines(context, Actions, {
        resume,
        items: cart,
        headers: cu.auditHeaders(context),
        ownerUserId: hd.pickedUserId,
        ctx: {
          requestId,
          lineStatus: status,
          detail: hd.detail,
          headerHours: hd.headerHours,
          agreementLineMap: $page.variables.agreementLineMap || {},
          quotePending,
        },
      });
      if (!linesResult.ok) {
        await Actions.fireNotificationEvent(context, {
          summary: isDraft ? 'Draft not saved' : 'Request not submitted',
          message: linesResult.message + (resume
            ? ' The draft is still saved as it was. Your cart is unchanged; fix it and try again.'
            : ' Nothing was saved. Your cart is unchanged; fix it and try again.'),
          type: 'error',
          displayMode: 'persist',
        });
        return;
      }

      if (!isDraft) {
        const patch = await Actions.callRest(context, {
          endpoint: 'eqp-v1/patchEquipmentRequest',
          uriParams: { id: requestId },
          body: { status: 'SUBMITTED' },
        });
        if (!patch || !patch.ok) {
          console.warn('[submitChain] status PATCH failed', patch && patch.status, patch && patch.body);
        }
      }

      $page.variables.cart = [];

      await Actions.fireNotificationEvent(context, isDraft
        ? { summary: 'Draft saved', message: 'Draft ' + (headerResult.requestNumber || '') + ' was saved.', type: 'confirmation', displayMode: 'transient' }
        : { summary: 'Request submitted', message: 'Request ' + (headerResult.requestNumber || '') + ' was sent for approval.', type: 'confirmation', displayMode: 'persist' });

      await Actions.navigateToPage(context, {
        page: 'request-detail',
        params: { requestId: String(headerResult.requestNumber || ''), requestNumericId: Number(requestId) },
      });
    }
  }

  return submitChain;
});
