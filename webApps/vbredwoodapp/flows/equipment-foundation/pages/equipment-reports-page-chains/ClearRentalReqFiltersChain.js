define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Resets every Rental Requests filter and re-fetches the unfiltered set.
   * oj-select-single needs null (not '') to clear; oj-select-many needs [].
   */
  class ClearRentalReqFiltersChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      $page.variables.rentalReqFilterQ           = '';
      $page.variables.rentalReqFilterRequest     = '';
      $page.variables.rentalReqFilterProject     = null;
      $page.variables.rentalReqFilterCustomer    = null;
      $page.variables.rentalReqFilterClass       = null;
      $page.variables.rentalReqFilterProcurement = null;
      $page.variables.rentalReqFilterLineStatus  = [];
      $page.variables.rentalReqFilterReqStatus   = [];
      $page.variables.rentalReqFilterFrom        = '';
      $page.variables.rentalReqFilterTo          = '';
      $page.variables.rentalReqActiveFilterCount = 0;

      var resp = await Actions.callRest(context, {
        endpoint: 'eqp-v1/getEquipriteV1ViewsRentalRequests',
        uriParams: { page: 0, size: 10000 }
      });
      $page.variables.rentalReqRows = (resp && resp.ok && resp.body && Array.isArray(resp.body.data))
        ? resp.body.data : [];
    }
  }

  return ClearRentalReqFiltersChain;
});
