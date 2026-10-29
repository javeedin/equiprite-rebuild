define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  const SELECTABLE_STATUSES = ['ACTIVE'];

  /**
   * Loads the Rental Agreement LOV for the Transfer drawer, gated by
   * AGREEMENTS_ENABLED — exact mirror of LoadAgreementsChain, minus the
   * fromAgreementId seeding block (that's specific to the create-request
   * page's own agreement-driven navigation and doesn't apply here).
   */
  class TransferLoadAgreementsChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;

      const flags = ($application && $application.variables.featureFlags) || {};
      const flagsLoaded = $application && $application.variables.flagsLoaded === true;
      if (!flagsLoaded || flags.AGREEMENTS_ENABLED !== 'true') {
        $page.variables.transferAgreementOptionsArray = [];
        $page.variables.transferFilteredAgreementsArray = [];
        return;
      }

      const [headersResp, customersResp] = await Promise.all([
        Actions.callRest(context, {
          endpoint:  'eqp-v1/getAgreementHeaders',
          uriParams: { pageSize: 500 }
        }),
        Actions.callRest(context, {
          endpoint: 'eqp-v1/getCustomerRefs'
        })
      ]);

      const headers = (headersResp && headersResp.ok && headersResp.body && Array.isArray(headersResp.body.data))
        ? headersResp.body.data : [];

      const customerNameById = new Map();
      const custRows = (customersResp && customersResp.ok && customersResp.body && Array.isArray(customersResp.body.data))
        ? customersResp.body.data : [];
      custRows.forEach(function(c) {
        if (c && c.id != null) customerNameById.set(Number(c.id), c.customerName || String(c.id));
      });

      const options = headers
        .filter(function(h) {
          return h && h.id != null &&
                 SELECTABLE_STATUSES.indexOf((h.status || '').toUpperCase()) !== -1;
        })
        .map(function(h) {
          const custName = h.customerRefId != null
            ? (customerNameById.get(Number(h.customerRefId)) || ('Customer ' + h.customerRefId))
            : 'Customer';
          return {
            value:        Number(h.id),
            label:        (h.agreementNumber || ('Agreement ' + h.id)) + ' — ' + custName,
            agreementNumber:  h.agreementNumber || '',
            customerName:     custName,
            customerRefId:    h.customerRefId    != null ? Number(h.customerRefId)    : null,
            fusionCustomerId: h.fusionCustomerId != null ? Number(h.fusionCustomerId) : null,
            effectiveFrom:    h.effectiveFrom || '',
            effectiveTo:      h.effectiveTo   || '',
            notes:            h.notes || ''
          };
        })
        .sort(function(a, b) { return String(b.agreementNumber).localeCompare(String(a.agreementNumber)); });

      $page.variables.transferAgreementOptionsArray   = options;
      $page.variables.transferFilteredAgreementsArray = options;
      console.log('[TransferLoadAgreementsChain] options:', options.length);
    }
  }

  return TransferLoadAgreementsChain;
});
