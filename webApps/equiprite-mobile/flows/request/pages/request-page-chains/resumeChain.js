define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/currentUser',
  'resources/js/draftResume',
  'resources/js/requestHeaderBody',
  'resources/js/orderForm',
  'resources/js/requestData',
  'resources/js/mobileBus',
  'resources/js/mobileRequest',
], (ActionChain, Actions, cu, draftResume, hdr, order, requestData, bus, mr) => {
  'use strict';

  // Opens a request in the form (a draft card, Order again, or another tab through focusChain). How depends on what it
  // is, read from its row in the shared request list:
  //   draft  a DRAFT (Carry on): Next's initChain.resume step for step. draftResume loads the header and lines and
  //          prices them from today's catalog; requestHeaderBody.toFlowState turns the header back into the form.
  //          Submit and Save draft then update that request in place (resume), so it keeps its number. It opens on
  //          Review (Next's draft tab from a request: startStep 'review'), or on the step that still needs something.
  //   fix    one sent back (any request that is no longer a draft): draftResume reopens drafts only, so it is copied
  //          into a NEW request (mobileRequest.copyOf), its dates and notes too, from the same reads; it stays as it was.
  //   again  Order again: a past request's equipment, project and delivery copied into a new request, for new dates.
  // A customer request is edited in New EquipRite, which makes its Fusion contract (Next's words and link).
  // When something else is being raised here, the replace sheet asks first; it comes back with confirmed. Reads only.
  const up = (v) => String(v == null ? '' : v).trim().toUpperCase();

  class resumeChain extends ActionChain {
    async run(context, { id, number, mode, confirmed }) {
      const { $page } = context;
      const pv = $page.variables;
      let rid = Number(id) || 0;
      const num = String(number || '');
      let row = null;
      try {
        const data = await requestData.load(context, Actions, {});
        row = (data.rows || []).filter((r) => (rid && Number(r.eqrEquipmentRequestId) === rid) || (num && up(r.requestNumber) === up(num)))[0] || null;
      } catch (e) {
        row = null;
      }
      if (!rid && row) rid = Number(row.eqrEquipmentRequestId) || 0;
      const label = (row && row.requestNumber) || num || String(rid || '');
      if (!rid) {
        bus.toast('Request ' + label + ' was not found among the requests you can see.', 'warning');
        return;
      }
      const status = up(row && (row.status || row.requestStatus));
      const how = mode === 'again' ? 'again' : (status && status !== 'DRAFT' ? 'fix' : 'draft');
      if (how === 'draft' && pv.resume && Number(pv.resume.id) === rid) {
        pv.view = 'form';
        pv.sheet = '';
        bus.toast('Draft ' + label + ' is open here.', 'info');
        return;
      }
      if (!(confirmed === true || confirmed === 'true') && mr.started(pv.form, pv.cart)) {
        pv.pending = { id: rid, number: label, mode: how };
        pv.view = 'form';
        pv.sheet = 'replace';
        return;
      }

      await Actions.callChain(context, { chain: 'resetChain', params: { quiet: true } });
      pv.isLoading = true;
      let review = false;
      try {
        review = how === 'draft' ? await this.draft(context, rid) : await this.copy(context, rid, how, label);
      } catch (e) {
        console.error('[resumeChain] the request could not be opened', e);
        pv.loadError = how === 'draft' ? 'The draft could not be reopened.' : label + ' could not be copied into a new request.';
      } finally {
        pv.isLoading = false;
      }
      if (pv.loadError) return;
      if ($page.functions && $page.functions.syncInputs) $page.functions.syncInputs(pv.form, '');
      await Actions.callChain(context, { chain: 'keepChain' });
      if (review) {
        await Actions.callChain(context, { chain: 'reviewChain', params: { to: 'review' } });
      } else {
        await Actions.callChain(context, { chain: 'loadCatalogChain' });
      }
    }

    who(context) {
      const actor = cu.auditActor(context);
      return { actor: actor || '', name: actor ? (cu.displayName(context) || actor) : '' };
    }

    /** A saved DRAFT, reopened to be saved in place (Next's initChain.resume). True when it opens on Review. */
    async draft(context, draftId) {
      const pv = context.$page.variables;
      const me = this.who(context);
      const loaded = await draftResume.load(context, Actions, draftId);
      if (!loaded.ok) {
        pv.loadError = loaded.message;
        return false;
      }
      const h = loaded.header;
      if (up(h.requestType) === 'EXTERNAL') {
        pv.loadError = 'Draft ' + (h.requestNumber || draftId) + ' is a customer request. Customer requests are edited in '
          + 'New EquipRite, which also creates their Fusion contract.';
        pv.externalDraftId = Number(h.id) || draftId;
        return false;
      }
      const priced = await draftResume.reprice(context, Actions, h, loaded.lines);
      if (!priced.ok) {
        pv.loadError = priced.message;
        return false;
      }
      const state = hdr.toFlowState(h);
      const form = Object.assign(order.emptyForm(me.name, me.actor), state.request);
      form.requestorName = state.request.requestorName || me.name;
      form.requestorUsername = state.request.requestorUsername || me.actor;
      form.locationType = form.locationType || 'DELIVERY_LOCATION';
      form.startDate = form.startDate || '';
      form.endDate = form.endDate || '';
      pv.form = form;
      pv.cart = priced.items;
      pv.agreementId = h.eqrAgreementHeaderId != null ? Number(h.eqrAgreementHeaderId) : null;
      pv.agreementLineMap = priced.agreementLineIdByEquipmentId || {};
      pv.resume = {
        id: Number(h.id),
        requestNumber: h.requestNumber || '',
        attribute1: h.attribute1 || '',
        shipToSiteId: h.shipToSiteId != null ? Number(h.shipToSiteId) : null,
      };
      if (priced.missing && priced.missing.length) {
        const n = priced.missing.length;
        pv.priceNote = n === 1
          ? '1 line of the draft is no longer in the catalog, so it was left out.'
          : n + ' lines of the draft are no longer in the catalog, so they were left out.';
      }
      if (form.projectId) {
        await Actions.callChain(context, { chain: 'loadProjectListsChain', params: { withBusinessUnit: !form.projectBuName } });
      }
      return true;
    }

    /**
     * A request that is not a draft, copied into a new one: the same reads as draftResume.load (its header, its lines),
     * priced from today's catalog by draftResume.reprice. True when it opens on Review (fix); Order again opens on
     * the equipment, for new dates.
     */
    async copy(context, rid, how, label) {
      const pv = context.$page.variables;
      const hRes = await Actions.callRest(context, { endpoint: 'eqp-v1/getEquipriteV1EquipmentRequestById', uriParams: { id: rid } });
      const h = hRes && hRes.ok ? (hRes.body && (hRes.body.data || hRes.body)) : null;
      if (!h || h.id == null) {
        pv.loadError = label + ' could not be loaded (HTTP ' + (hRes && hRes.status) + ').';
        return false;
      }
      if (up(h.requestType) === 'EXTERNAL') {
        pv.loadError = (h.requestNumber || label) + ' is a customer request. Customer requests are raised in New EquipRite, which also creates '
          + 'their Fusion contract.';
        return false;
      }
      // size: the endpoint's default page is 20 rows.
      const lRes = await Actions.callRest(context, { endpoint: 'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2', uriParams: { requestId: rid, size: 2000 } });
      if (!lRes || !lRes.ok) {
        pv.loadError = 'The equipment on ' + (h.requestNumber || label) + ' could not be loaded (HTTP ' + (lRes && lRes.status) + ').';
        return false;
      }
      const lines = (lRes.body && Array.isArray(lRes.body.data)) ? lRes.body.data : [];
      const priced = await draftResume.reprice(context, Actions, h, lines);
      if (!priced.ok) {
        pv.loadError = priced.message;
        return false;
      }
      if (!priced.items.length) {
        pv.loadError = 'None of the equipment on ' + (h.requestNumber || label) + ' is in the catalog any more, so there is nothing to copy.';
        return false;
      }
      const c = mr.copyOf(hdr.toFlowState(h), priced, how, h, this.who(context));
      pv.form = c.form;
      pv.cart = c.cart;
      pv.agreementId = c.agreementId;
      pv.agreementLineMap = c.agreementLineMap;
      pv.notice = c.notice;
      if (c.form.projectId) {
        await Actions.callChain(context, { chain: 'loadProjectListsChain', params: { withBusinessUnit: !c.form.projectBuName } });
      }
      return how === 'fix';
    }
  }

  return resumeChain;
});
