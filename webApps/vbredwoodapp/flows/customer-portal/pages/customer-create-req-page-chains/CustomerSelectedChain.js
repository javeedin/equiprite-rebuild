define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Customer Name picker → captures the chosen customer ref only.
  //
  // Customer Contact is an INDEPENDENT LOV (no DB relationship between a
  // customer and a contact), so picking a customer does NOT load, filter, or
  // clear the contact list. The full contact list is loaded once up front in
  // CreateRequestInitChain.
  class CustomerSelectedChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const data = params && params.data;

      if (!data || data.id == null) {
        $page.variables.formData.customerRefId = null;
        $page.variables.formData.customerName  = '';
        return;
      }

      $page.variables.formData.customerRefId = Number(data.id);
      $page.variables.formData.customerName  = data.customerName || '';
    }
  }

  return CustomerSelectedChain;
});
