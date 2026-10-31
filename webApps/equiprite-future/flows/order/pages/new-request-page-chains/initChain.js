define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/currentUser',
  'resources/js/draftResume',
  'resources/js/draftStorage',
  'resources/js/requestHeaderBody',
  'resources/js/orderForm',
  'resources/js/requestData',
  'resources/js/rules',
  'resources/js/shellBus',
], (ActionChain, Actions, cu, draftResume, draftStorage, hdr, order, requestData, rules, bus) => {
  'use strict';

  // Opens New request. New EquipRite's newRequestInitChain, step for step. The requestor is the signed-in user, as
  // the old SeedRequestorChain sets it (requestorName and requestorUsername; no EQR_USER id for INTERNAL). The rate,
  // hours and customer switches are read once the settings and roles have loaded.
  //
  // In a draft tab (id, or draftId) it reopens a saved DRAFT instead: draftResume loads the header and lines and
  // prices them from today's catalog, and requestHeaderBody.toFlowState turns the header back into the form. Submit
  // and Save draft then update that request in place (resume), so it keeps its number, as the old Edit Draft does.
  // A customer draft is edited in New EquipRite (its Fusion contract is made there).
  //
  // Without a draft it takes the hand-over from Rental agreements ("Create request from N lines"), as the old
  // HydrateDraftChain's agreement branch does: see fromAgreement below. Nothing is written on entry.
  const TRIES = 60;
  const GAP_MS = 50;
  const AGREEMENT_FLAG = 'eqr.agreement.active';

  class initChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const vars = $application.variables;
      for (let i = 0; i < TRIES && !(vars.flagsLoaded && vars.sessionRolesLoaded); i++) {
        await new Promise((r) => setTimeout(r, GAP_MS));
      }

      const actor = cu.auditActor(context);
      const name = actor ? (cu.displayName(context) || actor) : '';
      $page.variables.form = order.emptyForm(name, actor || '');
      $page.variables.hideRates = !!rules.isQuotingAllowed(vars.globalSettings, vars.flagsLoaded, 'INTERNAL');
      $page.variables.showHours = !!rules.isFeatureEnabled(vars.featureFlags, vars.flagsLoaded, 'TIMESHEETS_ENABLED');
      $page.variables.customerQuotes = !!rules.isQuotingAllowed(vars.globalSettings, vars.flagsLoaded, 'CUSTOMER');
      // canChooseCustomerType (a manager-tier role), and the tenant licensed for customer requests (the old create
      // page freezes the type when either says no).
      const projects = rules.isFeatureEnabled(vars.featureFlags, vars.flagsLoaded, 'PROJECTS_MODULE_ENABLED');
      const customers = rules.isFeatureEnabled(vars.featureFlags, vars.flagsLoaded, 'CUSTOMERS_MODULE_ENABLED');
      $page.variables.canCustomer = !!rules.isManager(vars.fusionRoles, vars.sessionRoles) && customers && projects;
      if (customers && !projects) {
        // Licensed for customer requests only (the old forcedCustomerType): there is no project request to raise.
        $page.variables.requestFor = 'customer';
      }

      let draftId = Number($page.variables.id) || Number($page.variables.draftId) || 0;
      if (!draftId && $page.variables.number) {
        // A draft tab opened by its number only: its id from the requests list, as a request's tab does.
        const data = await requestData.load(context, Actions, {});
        const hit = (data.rows || []).filter((r) => String(r.requestNumber).toUpperCase() === String($page.variables.number).toUpperCase())[0];
        draftId = hit ? Number(hit.eqrEquipmentRequestId) || 0 : 0;
        if (!draftId) {
          $page.variables.loadError = 'Draft ' + $page.variables.number + ' was not found among the requests you can see.';
        }
      }
      let review = false;
      if (draftId > 0) {
        review = await this.resume(context, draftId, name, actor);
      } else if (!$page.variables.number) {
        this.fromAgreement(context);
      }
      $page.variables.isLoading = false;
      if (review) {
        await Actions.callChain(context, { chain: 'reviewChain', params: { to: 'review' } });
      } else {
        await Actions.callChain(context, { chain: 'loadCatalogChain' });
      }
    }

    // The agreement hand-over, read once. Only with AGREEMENTS_ENABLED on, the tab flag set by the agreement page
    // and a stored fromAgreementId (the old branch (a) gate). The cart comes at the agreement's rates, then
    // loadCatalogChain prices it again with agreementId; the agreement and its line ids go on the request. Only the
    // customer is prefilled (fusionCustomerId, the Fusion CustomerId the customer picker holds): dates and notes
    // belong to this request, so the agreement's effective window is not copied. Then the flag and the stored keys
    // are cleared, as the old fresh entry (c) does, so the next New request starts empty.
    fromAgreement(context) {
      const { $page, $application } = context;
      const vars = $application.variables;
      let flagged = false;
      try { flagged = sessionStorage.getItem(AGREEMENT_FLAG) === '1'; } catch (e) { /* private mode */ }
      const on = !!rules.isFeatureEnabled(vars.featureFlags, vars.flagsLoaded, 'AGREEMENTS_ENABLED');
      const id = flagged && on && draftStorage.hasStoredDraft('fromAgreementId') ? Number(draftStorage.load('fromAgreementId')) : 0;
      if (id > 0) {
        const cart = (draftStorage.load('CartItemsArray') || []).filter((it) => it && it.id != null)
          .map((it) => Object.assign({}, it, { id: Number(it.id), equipmentId: Number(it.id), quantity: Number(it.quantity) || 1 }));
        $page.variables.cart = cart;
        $page.variables.agreementId = id;
        $page.variables.agreementLineMap = draftStorage.load('agreementLineIdByEquipmentId') || {};
        const customer = draftStorage.load('fromAgreementCustomer') || '';
        const fusionCustomerId = draftStorage.load('fromAgreementFusionCustomerId');
        if (fusionCustomerId != null && fusionCustomerId !== '') {
          $page.variables.form = Object.assign({}, $page.variables.form, { customerId: Number(fusionCustomerId), customerName: customer });
        }
        $page.variables.fromAgreement = { id, number: draftStorage.load('fromAgreementNumber') || '', customer, lines: cart.length };
      }
      try { sessionStorage.removeItem(AGREEMENT_FLAG); } catch (e) { /* private mode */ }
      draftStorage.clear();
    }

    /** Reopens a draft into the page. True when it should open on Review. */
    async resume(context, draftId, name, actor) {
      const { $page } = context;
      try {
        const loaded = await draftResume.load(context, Actions, draftId);
        if (!loaded.ok) {
          $page.variables.loadError = loaded.message;
          return false;
        }
        const h = loaded.header;
        if (String(h.requestType || '').toUpperCase() === 'EXTERNAL') {
          $page.variables.loadError = 'Draft ' + (h.requestNumber || draftId) + ' is a customer request. Customer requests are edited in '
            + 'New EquipRite, which also creates their Fusion contract.';
          $page.variables.externalDraftId = Number(h.id) || draftId;
          return false;
        }
        const priced = await draftResume.reprice(context, Actions, h, loaded.lines);
        if (!priced.ok) {
          $page.variables.loadError = priced.message;
          return false;
        }
        const state = hdr.toFlowState(h);
        const form = Object.assign(order.emptyForm(name, actor || ''), state.request);
        form.requestorName = state.request.requestorName || name;
        form.requestorUsername = state.request.requestorUsername || actor || '';
        form.locationType = form.locationType || 'DELIVERY_LOCATION';
        form.startDate = form.startDate || '';
        form.endDate = form.endDate || '';
        $page.variables.form = form;
        $page.variables.cart = priced.items;
        $page.variables.agreementId = h.eqrAgreementHeaderId != null ? Number(h.eqrAgreementHeaderId) : null;
        $page.variables.agreementLineMap = priced.agreementLineIdByEquipmentId || {};
        $page.variables.resume = {
          id: Number(h.id),
          requestNumber: h.requestNumber || '',
          attribute1: h.attribute1 || '',
          shipToSiteId: h.shipToSiteId != null ? Number(h.shipToSiteId) : null,
        };
        const tabKey = $page.variables.id || $page.variables.number;
        if (tabKey) bus.rename('draft:' + tabKey, 'Draft ' + (h.requestNumber || draftId));
        if (priced.missing && priced.missing.length) {
          const n = priced.missing.length;
          $page.variables.priceNote = n === 1
            ? '1 line of the draft is no longer in the catalog, so it was left out.'
            : n + ' lines of the draft are no longer in the catalog, so they were left out.';
        }
        if (form.projectId) {
          await Actions.callChain(context, { chain: 'loadProjectListsChain', params: { withBusinessUnit: !form.projectBuName } });
        }
        const start = String($page.variables.startStep || '').toLowerCase();
        return start === 'review' || start === '3';
      } catch (e) {
        console.error('[initChain] draft could not be reopened', e);
        $page.variables.loadError = 'The draft could not be reopened.';
        return false;
      }
    }
  }

  return initChain;
});
