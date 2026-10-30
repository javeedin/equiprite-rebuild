define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/currentUser',
  'resources/js/orderForm',
  'resources/js/rules',
  'resources/js/offlineSnapshot',
  'resources/js/mobileRequest',
], (ActionChain, Actions, cu, order, rules, snapshot, mr) => {
  'use strict';

  // Opens the Request tab: Next's initChain, for a phone. The requestor is the signed-in user (requestorName and
  // requestorUsername, as Next and the old SeedRequestorChain set them; no EQR_USER id for INTERNAL). The rate, hours
  // and customer switches are read once the settings and roles have loaded, as Next reads them.
  //
  // What this phone kept of a request being raised (offlineSnapshot 'request', per user) comes back first, so nothing
  // typed is lost when the signal or the app goes. A draft or a request sent back asked for from My requests or a
  // deep link is taken at the end (focusChain). Your drafts and past requests are read for the start (draftsChain).
  // Nothing is written on entry. (Next's hand-over from a rental agreement has no screen in Mobile to start it.)
  const TRIES = 60;
  const GAP_MS = 50;

  class initChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const vars = $application.variables;
      const pv = $page.variables;
      for (let i = 0; i < TRIES && !(vars.flagsLoaded && vars.sessionRolesLoaded); i++) {
        await new Promise((r) => setTimeout(r, GAP_MS));
      }

      const actor = cu.auditActor(context);
      const name = actor ? (cu.displayName(context) || actor) : '';
      pv.online = typeof navigator === 'undefined' || navigator.onLine !== false;
      pv.form = order.emptyForm(name, actor || '');
      pv.hideRates = !!rules.isQuotingAllowed(vars.globalSettings, vars.flagsLoaded, 'INTERNAL');
      pv.showHours = !!rules.isFeatureEnabled(vars.featureFlags, vars.flagsLoaded, 'TIMESHEETS_ENABLED');
      pv.customerQuotes = !!rules.isQuotingAllowed(vars.globalSettings, vars.flagsLoaded, 'CUSTOMER');
      const projects = rules.isFeatureEnabled(vars.featureFlags, vars.flagsLoaded, 'PROJECTS_MODULE_ENABLED');
      const customers = rules.isFeatureEnabled(vars.featureFlags, vars.flagsLoaded, 'CUSTOMERS_MODULE_ENABLED');
      pv.canCustomer = !!rules.isManager(vars.fusionRoles, vars.sessionRoles) && customers && projects;
      if (customers && !projects) {
        // Licensed for customer requests only (the old forcedCustomerType): there is no project request to raise.
        pv.requestFor = 'customer';
      }

      // The request this phone kept, as it was left.
      const user = actor || ($application.user || {}).username || '';
      const kept = snapshot.read('request', user);
      const back = mr.restore(kept && kept.data, name, actor || '');
      if (back) {
        pv.form = back.form;
        pv.cart = back.cart;
        pv.resume = back.resume;
        pv.agreementId = back.agreementId;
        pv.agreementLineMap = back.agreementLineMap;
        pv.step = back.step;
        pv.mode = back.step === 3 ? 'review' : 'build';
        pv.notice = (back.resume ? 'Draft ' + back.resume.requestNumber + ' is back as you left it. ' : 'What you were raising is back as you left it. ')
          + snapshot.savedText(kept.at, Date.now()) + '.';
      }
      pv.isLoading = false;

      // VB loads a chain the first time it runs: the ones needed with no connection are loaded now, doing nothing.
      Actions.callChain(context, { chain: 'submitChain', params: { mode: '' } });
      Actions.callChain(context, { chain: 'uiChain', params: { action: '' } });
      Actions.callChain(context, { chain: 'cartChain', params: { action: '' } });
      Actions.callChain(context, { chain: 'setFieldChain', params: { field: '' } });
      Actions.callChain(context, { chain: 'mapChain', params: { action: '' } });

      if (back && back.form.projectId) {
        Actions.callChain(context, { chain: 'loadProjectListsChain', params: { withBusinessUnit: !back.form.projectBuName } });
      }
      if (back && back.step === 2) {
        if (back.form.customerId == null || back.form.customerId === '') Actions.callChain(context, { chain: 'searchChain', params: { kind: 'customer', text: '' } });
        if (!back.form.projectId) Actions.callChain(context, { chain: 'searchChain', params: { kind: 'project', text: '' } });
      }
      Actions.callChain(context, { chain: 'draftsChain', params: {} });
      if (back && back.step === 3) {
        await Actions.callChain(context, { chain: 'reviewChain', params: { to: 'review' } });
      } else {
        await Actions.callChain(context, { chain: 'loadCatalogChain' });
      }
      await Actions.callChain(context, { chain: 'focusChain' });
    }
  }

  return initChain;
});
