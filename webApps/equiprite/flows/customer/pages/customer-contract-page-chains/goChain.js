define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Opens another customer portal page, with the request when one is given (requestId = number, requestNumericId =
  // id, the old customer pages' parameters). Buttons carry data-page / data-id / data-number. Only the portal's own
  // pages; the billing pages only while EXTERNAL_PROJECT_ASSIGN_ENABLED is off (the old nav's hiddenWhenFlags and
  // navigateToMyBillingChain rule). Same copy in every customer page that links to another.
  const PAGES = ['customer-home', 'customer-requests', 'customer-request', 'customer-quote', 'customer-contract',
    'customer-billing', 'customer-invoice', 'customer-new-request'];
  const BILLING = ['customer-billing', 'customer-invoice'];

  class goChain extends ActionChain {
    async run(context, { page, id, number, extra }) {
      const { $application } = context;
      if (PAGES.indexOf(page) === -1) {
        return;
      }
      if (BILLING.indexOf(page) !== -1 && !$application.functions.isFeatureFlagOff(
        $application.variables.featureFlags, $application.variables.flagsLoaded, 'EXTERNAL_PROJECT_ASSIGN_ENABLED')) {
        return;
      }
      const params = {};
      if (id !== undefined && id !== null && id !== '') {
        params.requestNumericId = Number(id);
      }
      if (number) {
        params.requestId = String(number);
      }
      Object.assign(params, extra || {});
      // oj-table and list clicks: let the click finish before the page changes (see the old navigateToRequestDetailChain).
      await new Promise((r) => setTimeout(r, 0));
      await Actions.navigateToPage(context, { page, params });
    }
  }

  return goChain;
});
