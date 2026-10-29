define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  /**
   * Capture the contact picked in the EXTERNAL Customer Contact LOV.
   *
   * Mirrors customer-create-req-page ContactSelectedChain, writing to
   * $flow.variables.request so it survives the catalog round-trip.
   *
   * Reuses request.requestorId / requestorName — the SAME fields the INTERNAL
   * Requestor Contact picker uses — because SubmitRequestChain already routes
   * that one id to the correct column based on the flow's mode:
   *     requestorUserId          (EQR_USER)                 when internal
   *     eqrCustomerPortalUserId  (EQR_CUSTOMER_PORTAL_USER) when external
   * Both pickers are mutually exclusive on screen (one per request type), so
   * sharing the field can't produce an ambiguous value — and it means the
   * submit path needs no new branch.
   *
   * NOTE this differs from the customer field above, which DOES get its own
   * variable: there the two id spaces would both be posted (customerId vs
   * eqrCustomerRefId), so they must stay separate.
   */
  class CaptureExternalContactChain extends ActionChain {
    async run(context, params) {
      const { $flow } = context;
      const data = params && params.data;

      if (!data || data.id == null) {
        $flow.variables.request.requestorId   = null;
        $flow.variables.request.requestorName = '';
        return;
      }

      $flow.variables.request.requestorId   = Number(data.id);
      $flow.variables.request.requestorName = data.contactName || '';
    }
  }

  return CaptureExternalContactChain;
});
