define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/draftResume',
  'resources/js/requestHeaderBody',
], (ActionChain, Actions, draftResume, hdr) => {
  'use strict';

  // Opens New request (customer). From Old EquipRite's customer-create-req-page-chains/CreateRequestInitChain.js: the
  // two pickers' lists, loaded together and mapped the same way (getCustomerRefs → { id, customerName },
  // getCustomerPortalUsers → { id, contactName, username, email }; independent lists, as there). Then the catalog.
  //
  // With ?draftId= it reopens a saved customer DRAFT, as New request does for project drafts: draftResume loads the
  // header and lines and prices them from today's catalog (customerRefId included), and toFlowState turns the header
  // back into the form. Submit and Save draft then update that request in place. A project draft is sent to New
  // request instead.
  const TRIES = 60;
  const GAP_MS = 50;

  class initChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const vars = $application.variables;
      const fns = $application.functions;
      for (let i = 0; i < TRIES && !(vars.flagsLoaded && vars.pageAccessLoaded); i++) {
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
      $page.variables.form = $page.functions.emptyForm();
      // The customer catalog and cart hide prices when a quote is coming for an EXTERNAL request (CatalogInitChain).
      $page.variables.hideRates = !!fns.isQuotingAllowed(vars.globalSettings, vars.flagsLoaded, 'EXTERNAL');
      // The old create page's own page code. The portal item opens on EQR_CUST_DASHBOARD; raising a request needs this.
      $page.variables.canCreate = !vars.pageAccessLoaded || !!fns.navVisible(vars.pageAccessMap, vars.pageAccessLoaded, 'EQR_CUST_CREATE_REQ');

      const [custResp, usersResp] = await Promise.all([
        Actions.callRest(context, { endpoint: 'eqp-v1/getCustomerRefs' }),
        Actions.callRest(context, { endpoint: 'eqp-v1/getCustomerPortalUsers' })
      ]);
      $page.variables.customers = (custResp && custResp.ok && custResp.body && Array.isArray(custResp.body.data))
        ? custResp.body.data
          .filter((c) => c != null && c.id != null)
          .map((c) => ({ id: Number(c.id), customerName: c.customerName || ('Customer ' + c.id) }))
        : [];
      $page.variables.contacts = (usersResp && usersResp.ok && usersResp.body && Array.isArray(usersResp.body.data))
        ? usersResp.body.data
          .filter((u) => u != null && u.id != null)
          .map((u) => ({
            id:          Number(u.id),
            contactName: u.contactName || u.username || ('User ' + u.id),
            username:    u.username || '',
            email:       u.email || ''
          }))
        : [];

      const draftId = Number($page.variables.draftId) || 0;
      if (draftId > 0) {
        await this.resume(context, draftId);
      } else {
        // A customer sign-in usually sees one customer and one contact: pick them, so the form starts filled.
        const form = Object.assign({}, $page.variables.form);
        if ($page.variables.customers.length === 1) {
          form.customerRefId = $page.variables.customers[0].id;
          form.customerName = $page.variables.customers[0].customerName;
        }
        if ($page.variables.contacts.length === 1) {
          form.requestorId = $page.variables.contacts[0].id;
          form.requestorName = $page.variables.contacts[0].contactName;
        }
        $page.variables.form = form;
      }
      $page.variables.isLoading = false;
      await Actions.callChain(context, { chain: 'loadCatalogChain' });
    }

    async resume(context, draftId) {
      const { $page } = context;
      try {
        const loaded = await draftResume.load(context, Actions, draftId);
        if (!loaded.ok) {
          $page.variables.loadError = loaded.message;
          return;
        }
        const h = loaded.header;
        if (String(h.requestType || '').toUpperCase() !== 'EXTERNAL') {
          $page.variables.loadError = 'This is a project draft. Open it from My requests in the Request menu.';
          $page.variables.wrongDraft = true;
          return;
        }
        const priced = await draftResume.reprice(context, Actions, h, loaded.lines);
        if (!priced.ok) {
          $page.variables.loadError = priced.message;
          return;
        }
        const state = hdr.toFlowState(h);
        const r = state.request;
        $page.variables.form = Object.assign($page.functions.emptyForm(), {
          customerRefId: r.customerRefId != null ? r.customerRefId : null,
          customerName:  r.customerRefName || '',
          requestorId:   r.requestorId != null ? r.requestorId : null,
          requestorName: r.requestorName || '',
          location:      r.location || '',
          locationType:  r.locationType || null,
          startDate:     r.startDate || '',
          endDate:       r.endDate || '',
          notes:         r.notes || '',
        });
        $page.variables.cart = priced.items;
        $page.variables.agreementId = h.eqrAgreementHeaderId != null ? Number(h.eqrAgreementHeaderId) : null;
        $page.variables.agreementLineMap = priced.agreementLineIdByEquipmentId || {};
        $page.variables.resume = {
          id: Number(h.id),
          requestNumber: h.requestNumber || '',
          attribute1: h.attribute1 || '',
          shipToSiteId: h.shipToSiteId != null ? Number(h.shipToSiteId) : null,
        };
        if (priced.missing && priced.missing.length) {
          const n = priced.missing.length;
          $page.variables.priceNote = n === 1
            ? '1 line of the draft is no longer in the catalog, so it was left out.'
            : n + ' lines of the draft are no longer in the catalog, so they were left out.';
        }
        const startStep = Number($page.variables.startStep) || 1;
        $page.variables.step = Math.min(3, Math.max(1, startStep));
      } catch (e) {
        console.error('[initChain] draft could not be reopened', e);
        $page.variables.loadError = 'The draft could not be reopened.';
      }
    }
  }

  return initChain;
});
