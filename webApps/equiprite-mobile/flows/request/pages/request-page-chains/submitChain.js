define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/currentUser',
  'resources/js/requestLineBody',
  'resources/js/requestHeaderBody',
  'resources/js/orderForm',
  'resources/js/requestData',
  'resources/js/rules',
  'resources/js/mobileBus',
  'resources/js/mobileRequest',
], (ActionChain, Actions, cu, lineBody, hdr, order, requestData, rules, bus, mr) => {
  'use strict';

  // Submit for approval, or Save draft. Next's submitChain step for step (New EquipRite's, which is the old cart's
  // INTERNAL path: SubmitRequestChain and SecondaryActionChain), with the same shared builders:
  //   1 header   requestHeaderBody.saveHeader: POST createEquipmentRequest as DRAFT (PATCH for a draft this page
  //              holds, so it keeps its number), with the audit headers
  //   2 site     geocode the address (a point pinned on the map is used as it is), then createShipToSite and PATCH
  //              shipToSiteId (best effort)
  //   3 lines    requestLineBody.saveLines: one batch, each line SUBMITTED (or DRAFT), with the audit headers; a
  //              failed batch deletes a new header, so nothing half-saved is left (a held draft's lines are replaced,
  //              or left as they were)
  //   4 status   PATCH the header to SUBMITTED (submit only). SUBMITTED, not IN_PROCESS: a project request waits for
  //              its approver (FDD 7.6).
  // Then the shared requests are refreshed (requestData.invalidate) so every tab shows it. A failure stays on the page
  // in words, and in a toast.
  //
  // A phone's own: with no connection nothing is sent at all (navigator.onLine), and it says so; what was entered is
  // kept on the phone. After a submit this tab says what was sent and offers it in My requests, or another request
  // (resetChain, view 'sent'); a saved draft stays here and the next save updates it in place. Either way the count of
  // your drafts on the tab is read again (draftsChain).
  class submitChain extends ActionChain {
    async run(context, { mode }) {
      const { $page } = context;
      // VB loads a chain the first time it runs: initChain runs this once with no mode, so it is there offline.
      if (mode !== 'submit' && mode !== 'draft') {
        return;
      }
      // Checked and set before any await, so a double tap cannot create two requests.
      if ($page.variables.isSubmitting) {
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        const msg = mr.offlineText(mode === 'draft');
        $page.variables.saveError = msg;
        $page.variables.online = false;
        bus.toast(msg, 'warning');
        return;
      }
      $page.variables.isSubmitting = true;
      $page.variables.submitMode = mode === 'draft' ? 'draft' : 'submit';
      $page.variables.saveError = '';
      try {
        await this.save(context, mode === 'draft');
      } catch (e) {
        console.error('[submitChain] unexpected error', e);
        requestData.invalidate();
        this.fail(context, 'Saving was interrupted (' + ((e && e.message) || e) + '). The request may already be saved: '
          + 'check My requests before trying again.');
      } finally {
        try { $page.variables.isSubmitting = false; } catch (e2) { /* page already gone */ }
      }
    }

    fail(context, message) {
      context.$page.variables.saveError = message;
      bus.toast(message, 'error');
      const fns = context.$page.functions;
      if (fns && fns.toTop) fns.toTop('#rqSaveError');
    }

    async save(context, isDraft) {
      const { $page, $application } = context;
      const form = $page.variables.form || {};
      const cart = $page.variables.cart || [];
      const missing = order.missingFor(isDraft ? 'draft' : 'submit', form, cart);
      if (missing.length) {
        $page.variables.missing = missing;
        const fns = $page.functions;
        if (fns && fns.toTop) fns.toTop('#rqMissing');
        return;
      }

      const detail = order.buildDetail(form);
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
      // The delivery point: pinned on the map (its own coordinates), else looked up from the words (New's rule).
      const pinned = form.locationPinned && form.locationLatitude != null && form.locationLongitude != null && form.location === hd.locationText;
      const geo = pinned ? { latitude: Number(form.locationLatitude), longitude: Number(form.locationLongitude), formattedAddress: hd.locationText }
        : await hdr.geocode(hd.locationText, tag);

      const headerResult = await hdr.saveHeader(context, Actions, { d: hd, reqNum, resume, headers: cu.auditHeaders(context) });
      if (!headerResult.ok) {
        this.fail(context, (isDraft ? 'Draft not saved: ' : 'Request not submitted: ')
          + (resume ? 'draft ' + (resume.requestNumber || '') + ' could not be updated' : 'the request could not be created')
          + ' (HTTP ' + headerResult.status + '). Your cart is unchanged.');
        return;
      }
      const requestId = headerResult.requestId;

      let siteId = resume ? resume.shipToSiteId : null;
      if (hdr.needsShipToSite(hd, resume)) {
        const made = await hdr.attachShipToSite(context, Actions, { requestId, reqNum, locationText: hd.locationText, geo, tag });
        if (made != null) siteId = made;
      }

      const status = isDraft ? 'DRAFT' : 'SUBMITTED';
      const quotePending = !!rules.isQuotingAllowed($application.variables.globalSettings, $application.variables.flagsLoaded, 'INTERNAL');
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
        this.fail(context, (isDraft ? 'Draft not saved. ' : 'Request not submitted. ') + linesResult.message + (resume
          ? ' The draft is still saved as it was. Your cart is unchanged; fix it and try again.'
          : ' Nothing was saved. Your cart is unchanged; fix it and try again.'));
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

      requestData.invalidate();
      const number = headerResult.requestNumber || '';
      const about = [mr.cartCount(cart), form.projectName || ''].filter((x) => !!x && x !== 'Empty').join(' · ');

      if (isDraft) {
        $page.variables.resume = { id: Number(requestId), requestNumber: number, attribute1: hd.locationText, shipToSiteId: siteId };
        $page.variables.sent = { id: Number(requestId), number, mode: 'draft', about };
        bus.toast('Draft ' + number + ' was saved. Nothing was sent for approval.', 'info');
        await Actions.callChain(context, { chain: 'keepChain' });
        await Actions.callChain(context, { chain: 'draftsChain', params: { refresh: true } });
        return;
      }

      bus.toast('Request ' + number + ' was sent for approval.', 'info');
      await Actions.callChain(context, { chain: 'resetChain', params: { sent: { id: Number(requestId), number, mode: 'submit', about } } });
      await Actions.callChain(context, { chain: 'draftsChain', params: { refresh: true } });
    }
  }

  return submitChain;
});
