define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/currentUser',
  'resources/js/requestLineBody',
  'resources/js/requestHeaderBody',
  'resources/js/rules',
  'resources/js/customerOrder',
  'resources/js/portalView',
  'resources/js/shellBus',
  'resources/js/portalSignal',
  'resources/js/requestData',
], (ActionChain, Actions, cu, lineBody, hdr, rules, O, V, bus, signal, requestData) => {
  'use strict';

  // Send, or Save draft, for a customer (EXTERNAL) request: New's customer submitChain, which is the old cart's EXTERNAL
  // path step for step, with the same shared builders:
  //   0 terms    send only: the rental terms must be accepted first; the tick is used up by this send
  //   1 header   requestHeaderBody.saveHeader: POST createEquipmentRequest as DRAFT (PATCH for a draft this tab holds),
  //              with the customer columns
  //   2 site     geocode the address, then createShipToSite and PATCH shipToSiteId (best effort)
  //   3 lines    requestLineBody.saveLines: one batch, each line IN_PROCESS (or DRAFT), unpriced when a quote is coming;
  //              a failed batch deletes a new header, so nothing half-saved is left
  //   4 status   PATCH the header to IN_PROCESS (send only): a customer request has no customer-side approver
  //   5 contract New's step 5, send only and only with customer quoting off: POST the Fusion sell contract. Next does
  //              not write to Fusion, so that send is not made here at all: Next saves the draft (steps 1 to 3 as DRAFT,
  //              mode 'handoff') and links to New's customer New request on that draft's Review, where it is sent and
  //              its contract created. With quoting on, steps 0 to 4 are all there is, and they are made here.
  // A sent request opens in a tab of its own; a saved draft stays here and the next save updates it in place.
  class submitChain extends ActionChain {
    async run(context, { mode }) {
      const v = context.$page.variables;
      // Checked and set before any await, so a double click cannot create two requests.
      if (v.isSubmitting || !v.canCreate) return;
      v.isSubmitting = true;
      v.submitMode = mode === 'submit' ? 'submit' : 'draft';
      v.saveError = '';
      try {
        await this.save(context, mode === 'submit' ? 'submit' : (mode === 'handoff' ? 'handoff' : 'draft'));
      } catch (e) {
        console.error('[customer submitChain] unexpected error', e);
        v.saveError = 'Saving was interrupted (' + ((e && e.message) || e) + '). The request may already be saved: check your requests in the portal before trying again.';
      } finally {
        try { v.isSubmitting = false; } catch (e2) { /* page already gone */ }
      }
    }

    async save(context, mode) {
      const { $page, $application } = context;
      const v = $page.variables;
      const app = $application.variables;
      const isDraft = mode !== 'submit';
      const form = v.form || {};
      const cart = v.cart || [];

      // Next's guard: with customer quoting off, sending creates the Fusion sell contract (New's step 5).
      if (!isDraft && !rules.isQuotingAllowed(app.globalSettings, app.flagsLoaded, 'CUSTOMER')) {
        v.saveError = 'Sending this request creates your rental contract in Oracle Fusion, which EquipRite Next does not do yet. '
          + 'Save it, then send it in New EquipRite.';
        return;
      }
      const missing = O.missingFor(isDraft ? 'draft' : 'submit', form, cart);
      if (missing.length) {
        v.missing = missing;
        return;
      }

      // ── 0. The terms gate (send only) ─────────────────────────────────────
      if (!isDraft) {
        if (!v.termsAccepted) {
          v.missing = ['Accept the rental terms'];
          return;
        }
        v.termsAccepted = false;
      }

      const detail = O.buildDetail(form);
      const hd = hdr.derive({
        request: O.buildRequest(form),
        ActiveRequestDetail: detail,
        CartItemsArray: cart,
        requestOrigin: 'customer',
        fromAgreementId: v.agreementId,
      });
      const postedRequestType = hd.requestType; // EXTERNAL
      const reqNum = 'REQ-' + Date.now();
      const resume = v.resume && v.resume.id != null ? v.resume : null;
      const tag = isDraft ? '[SaveDraft]' : '[Submit]';
      const geo = await hdr.geocode(hd.locationText, tag);

      // ── 1. Header ────────────────────────────────────────────────────────
      const headerResult = await hdr.saveHeader(context, Actions, { d: hd, reqNum, resume, headers: cu.auditHeaders(context) });
      if (!headerResult.ok) {
        v.saveError = (isDraft ? 'The draft was not saved: ' : 'The request was not sent: ')
          + (resume ? 'draft ' + (resume.requestNumber || '') + ' could not be updated' : (isDraft ? 'the draft could not be saved' : 'the request could not be created'))
          + ' (HTTP ' + headerResult.status + '). Your cart is unchanged.';
        return;
      }
      const requestId = headerResult.requestId;
      const number = headerResult.requestNumber || '';

      // ── 2. Ship-to-site (best effort) ────────────────────────────────────
      let siteId = resume ? resume.shipToSiteId : null;
      if (hdr.needsShipToSite(hd, resume)) {
        const made = await hdr.attachShipToSite(context, Actions, { requestId, reqNum, locationText: hd.locationText, geo, tag });
        if (made != null) siteId = made;
      }

      // ── 3. Lines ─────────────────────────────────────────────────────────
      const quotePending = !!rules.isQuotingAllowed(app.globalSettings, app.flagsLoaded, postedRequestType);
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
          agreementLineMap: v.agreementLineMap || {},
          quotePending,
        },
      });
      if (!linesResult.ok) {
        v.saveError = (isDraft ? 'The draft was not saved. ' : 'The request was not sent. ') + linesResult.message + (resume
          ? ' The draft is still saved and still a draft; its lines were not changed. Your cart is unchanged; fix it and try again.'
          : ' Nothing was saved. Your cart is unchanged; fix it and try again.');
        return;
      }

      const tabId = 'customer-order:' + (v.draft ? 'draft-' + v.draft : 'new');
      if (isDraft) {
        v.resume = { id: Number(requestId), requestNumber: number, attribute1: hd.locationText, shipToSiteId: siteId };
        v.sent = {
          mode,
          id: Number(requestId),
          number,
          link: mode === 'handoff' ? V.newPage((app.appUrls || {}).new, 'customer-new-request', { draftId: Number(requestId), startStep: 3 }) : '',
        };
        bus.rename(tabId, 'Draft ' + number);
        bus.toast('Draft ' + number + ' was saved. Nothing is reserved until it is sent.', 'info');
        signal.changed();
        requestData.invalidate();
        return;
      }

      // ── 4. Status ────────────────────────────────────────────────────────
      const patchResult = await Actions.callRest(context, {
        endpoint: 'eqp-v1/patchEquipmentRequest',
        uriParams: { id: requestId },
        body: { status: submittedStatus },
      });
      if (!patchResult || !patchResult.ok) {
        console.warn('[customer submitChain] status PATCH failed:', JSON.stringify(patchResult && patchResult.body));
      }

      signal.changed();
      requestData.invalidate();
      bus.toast('Request ' + number + ' was sent to your equipment manager.', 'info');
      bus.open({ record: 'customer-request', params: { id: Number(requestId), number } });
      if (v.draft) {
        // This draft is a request now: its tab has done its job.
        bus.close(tabId);
        return;
      }
      await Actions.callChain(context, { chain: 'resetChain', params: { sent: { mode: 'submit', id: Number(requestId), number, link: '' } } });
    }
  }

  return submitChain;
});
