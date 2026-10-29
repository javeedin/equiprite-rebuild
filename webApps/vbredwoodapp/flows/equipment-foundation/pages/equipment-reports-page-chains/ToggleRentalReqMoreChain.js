define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /** Shows/hides the Rental Requests secondary filter drawer. */
  class ToggleRentalReqMoreChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      $page.variables.rentalReqShowMore = !$page.variables.rentalReqShowMore;
    }
  }

  return ToggleRentalReqMoreChain;
});
