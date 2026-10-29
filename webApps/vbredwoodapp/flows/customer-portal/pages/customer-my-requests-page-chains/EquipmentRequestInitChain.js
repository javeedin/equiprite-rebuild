define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class EquipmentRequestInitChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      // Query params under uriParams (NOT `parameters`) — see memory
      // feedback_vb_callrest_uriparams.md. `parameters` is silently dropped
      // so the view falls back to its size=20 default.
      const result = await Actions.callRest(context, {
        endpoint:  'eqp-v1/getEquipriteV1ViewsCustomerMyRequests',
        uriParams: { page: 0, size: 200 }
      });

      if (result.ok && result.body && result.body.data) {
        const mapped = result.body.data.map(r => ({
          id:              r.eqrEquipmentRequestId || r.rowId,
          requestNumber:   r.requestNumber         || '',
          customerName:    r.customerName          || '',
          customerContact: r.customerContact       || '',
          agreementType:   r.agreementType         || '',
          status:          r.requestStatus         || '',
          startDate:       r.startDate  ? r.startDate.substring(0, 10)  : '',
          endDate:         r.endDate    ? r.endDate.substring(0, 10)    : '',
          lines:           r.lines      || 0,
          createdDate:     r.createdDate ? r.createdDate.substring(0, 10) : '',
          contractNumber:  r.contractNumber         || ''
        }));
        $page.variables.RequestAllArray      = mapped;
        $page.variables.RequestFilteredArray = [...mapped];
      } else {
        $page.variables.RequestAllArray      = [];
        $page.variables.RequestFilteredArray = [];
      }
    }
  }

  return EquipmentRequestInitChain;
});
