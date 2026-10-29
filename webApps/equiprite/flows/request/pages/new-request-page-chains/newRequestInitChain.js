define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/currentUser',
  'resources/js/draftResume',
  'resources/js/requestHeaderBody',
], (ActionChain, Actions, cu, draftResume, hdr) => {
  'use strict';

  // Opens New request. The requestor is the signed-in user, as the old SeedRequestorChain sets it (requestorName
  // and requestorUsername; no EQR_USER id for INTERNAL). The rate, hours and customer switches use the same
  // app functions as the old create page and cart, once the settings and roles have loaded.
  //
  // With ?draftId= it reopens a saved DRAFT instead: draftResume loads the header and lines and prices them from
  // today's catalog, and requestHeaderBody.toFlowState turns the header back into the form. Submit and Save draft
  // then update that request in place (resume), so it keeps its number, as the old Edit Draft does.
  const TRIES = 60;
  const GAP_MS = 50;

  class newRequestInitChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const vars = $application.variables;
      const fns = $application.functions;
      for (let i = 0; i < TRIES && !(vars.flagsLoaded && vars.sessionRolesLoaded); i++) {
        await new Promise((r) => setTimeout(r, GAP_MS));
      }

      const actor = cu.auditActor(context);
      const name = actor ? (cu.displayName(context) || actor) : '';
      $page.variables.form = $page.functions.emptyForm(name, actor || '');
      $page.variables.hideRates = !!fns.isQuotingAllowed(vars.globalSettings, vars.flagsLoaded, 'INTERNAL');
      $page.variables.showHours = !!fns.isFeatureEnabled(vars.featureFlags, vars.flagsLoaded, 'TIMESHEETS_ENABLED');
      $page.variables.canCustomer = !!fns.canChooseCustomerType(vars.fusionRoles, vars.sessionRoles);

      const draftId = Number($page.variables.draftId) || 0;
      if (draftId > 0) {
        await this.resume(context, draftId, name, actor);
      }
      $page.variables.isLoading = false;
      await Actions.callChain(context, { chain: 'loadCatalogChain' });
    }

    async resume(context, draftId, name, actor) {
      const { $page } = context;
      try {
        const loaded = await draftResume.load(context, Actions, draftId);
        if (!loaded.ok) {
          $page.variables.loadError = loaded.message;
          return;
        }
        const h = loaded.header;
        if (String(h.requestType || '').toUpperCase() === 'EXTERNAL') {
          $page.variables.loadError = 'This is a customer draft. Customer requests are still edited in Old EquipRite.';
          $page.variables.externalDraft = true;
          return;
        }
        const priced = await draftResume.reprice(context, Actions, h, loaded.lines);
        if (!priced.ok) {
          $page.variables.loadError = priced.message;
          return;
        }
        const state = hdr.toFlowState(h);
        const form = Object.assign($page.functions.emptyForm(name, actor || ''), state.request);
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
        if (priced.missing && priced.missing.length) {
          const n = priced.missing.length;
          $page.variables.priceNote = n === 1
            ? '1 line of the draft is no longer in the catalog, so it was left out.'
            : n + ' lines of the draft are no longer in the catalog, so they were left out.';
        }
        const startStep = Number($page.variables.startStep) || 1;
        $page.variables.step = Math.min(3, Math.max(1, startStep));
        if (form.projectId) {
          await Actions.callChain(context, { chain: 'loadProjectListsChain', params: { withBusinessUnit: !form.projectBuName } });
        }
      } catch (e) {
        console.error('[newRequestInitChain] draft could not be reopened', e);
        $page.variables.loadError = 'The draft could not be reopened.';
      }
    }
  }

  return newRequestInitChain;
});
