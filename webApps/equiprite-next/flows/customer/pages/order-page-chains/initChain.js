define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/draftResume',
  'resources/js/requestHeaderBody',
  'resources/js/rules',
  'resources/js/customerPortal',
  'resources/js/customerOrder',
], (ActionChain, Actions, draftResume, hdr, rules, portal, O) => {
  'use strict';

  // Opens a customer's new request: New's customer New request initChain, the same reads in the same order:
  //   1 getCustomerRefs and getCustomerPortalUsers together (the old customer-create-req pickers, mapped the same way:
  //     { id, customerName } and { id, contactName, username, email }); a customer sign-in usually sees one of each, so
  //     they are picked
  //   2 for a draft tab: draftResume.load and reprice (customerRefId included) and toFlowState, so Submit and Save draft
  //     update that request in place; a project draft is refused here
  //   3 the catalog
  // hideRates: isQuotingAllowed(EXTERNAL), a quote is coming, so no price is shown or posted. contractAtSubmit:
  // isQuotingAllowed(CUSTOMER) false, so New's submit creates the Fusion sell contract (left to New, see submitChain).
  const TRIES = 60;
  const GAP_MS = 50;

  class initChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const v = $page.variables;
      const app = $application.variables;
      for (let i = 0; i < TRIES && !(app.flagsLoaded && app.pageAccessLoaded); i++) {
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
      v.form = O.emptyForm();
      v.hideRates = !!rules.isQuotingAllowed(app.globalSettings, app.flagsLoaded, 'EXTERNAL');
      v.contractAtSubmit = !rules.isQuotingAllowed(app.globalSettings, app.flagsLoaded, 'CUSTOMER');
      v.canCreate = !app.pageAccessLoaded || rules.pageAccess(app.pageAccessMap, app.pageAccessLoaded, 'EQR_CUST_CREATE_REQ') !== 'HIDDEN';
      v.behalf = !!portal.actsForCustomers(app.pageAccessMap, app.pageAccessLoaded);
      if (!v.canCreate) {
        v.isLoading = false;
        return;
      }

      const [custResp, usersResp] = await Promise.all([
        Actions.callRest(context, { endpoint: 'eqp-v1/getCustomerRefs' }),
        Actions.callRest(context, { endpoint: 'eqp-v1/getCustomerPortalUsers' }),
      ]);
      v.customers = (custResp && custResp.ok && custResp.body && Array.isArray(custResp.body.data))
        ? custResp.body.data.filter((c) => c != null && c.id != null).map((c) => ({ id: Number(c.id), customerName: c.customerName || ('Customer ' + c.id) }))
        : [];
      v.contacts = (usersResp && usersResp.ok && usersResp.body && Array.isArray(usersResp.body.data))
        ? usersResp.body.data.filter((u) => u != null && u.id != null).map((u) => ({
          id: Number(u.id),
          contactName: u.contactName || u.username || ('User ' + u.id),
          username: u.username || '',
          email: u.email || '',
        }))
        : [];

      const draftId = Number(v.draft) || 0;
      if (draftId > 0) {
        await this.resume(context, draftId);
      } else {
        const form = Object.assign({}, v.form);
        if (v.customers.length === 1) { form.customerRefId = v.customers[0].id; form.customerName = v.customers[0].customerName; }
        if (v.contacts.length === 1) { form.requestorId = v.contacts[0].id; form.requestorName = v.contacts[0].contactName; }
        v.form = form;
      }
      v.isLoading = false;
      await Actions.callChain(context, { chain: 'loadCatalogChain' });
    }

    async resume(context, draftId) {
      const v = context.$page.variables;
      try {
        const loaded = await draftResume.load(context, Actions, draftId);
        if (!loaded.ok) { v.loadError = loaded.message; return; }
        const h = loaded.header;
        if (String(h.requestType || '').toUpperCase() !== 'EXTERNAL') {
          v.loadError = 'This is a project draft. Open it from Requests.';
          v.wrongDraft = true;
          return;
        }
        const priced = await draftResume.reprice(context, Actions, h, loaded.lines);
        if (!priced.ok) { v.loadError = priced.message; return; }
        const r = hdr.toFlowState(h).request;
        v.form = Object.assign(O.emptyForm(), {
          customerRefId: r.customerRefId != null ? r.customerRefId : null,
          customerName: r.customerRefName || '',
          requestorId: r.requestorId != null ? r.requestorId : null,
          requestorName: r.requestorName || '',
          location: r.location || '',
          locationType: r.locationType || null,
          startDate: r.startDate || '',
          endDate: r.endDate || '',
          notes: r.notes || '',
        });
        v.cart = priced.items;
        v.agreementId = h.eqrAgreementHeaderId != null ? Number(h.eqrAgreementHeaderId) : null;
        v.agreementLineMap = priced.agreementLineIdByEquipmentId || {};
        v.resume = { id: Number(h.id), requestNumber: h.requestNumber || '', attribute1: h.attribute1 || '', shipToSiteId: h.shipToSiteId != null ? Number(h.shipToSiteId) : null };
        if (priced.missing && priced.missing.length) {
          const n = priced.missing.length;
          v.priceNote = n === 1 ? '1 line of the draft is no longer in the catalog, so it was left out.' : n + ' lines of the draft are no longer in the catalog, so they were left out.';
        }
        v.mode = String(v.startStep) === 'review' || String(v.startStep) === '3' ? 'review' : 'edit';
      } catch (e) {
        console.error('[customer order initChain] draft could not be reopened', e);
        v.loadError = 'The draft could not be reopened.';
      }
    }
  }

  return initChain;
});
