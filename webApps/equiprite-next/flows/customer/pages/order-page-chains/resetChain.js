define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/customerOrder',
  'resources/js/shellBus',
], (ActionChain, Actions, O, bus) => {
  'use strict';

  // Start another request: an empty form (the one customer and contact picked again), an empty cart, the catalog
  // without dates. After a send the banner says what was sent. In a draft's own tab it opens New request instead, so
  // the tab named after the draft keeps showing the draft. Nothing is written.
  class resetChain extends ActionChain {
    async run(context, params) {
      const v = context.$page.variables;
      if (v.draft && !(params && params.sent)) {
        bus.open({ record: 'customer-order', params: {} });
        return;
      }
      const form = O.emptyForm();
      if ((v.customers || []).length === 1) { form.customerRefId = v.customers[0].id; form.customerName = v.customers[0].customerName; }
      if ((v.contacts || []).length === 1) { form.requestorId = v.contacts[0].id; form.requestorName = v.contacts[0].contactName; }
      v.mode = 'edit';
      v.form = form;
      v.cart = [];
      v.resume = null;
      v.agreementId = null;
      v.agreementLineMap = {};
      v.termsAccepted = false;
      v.missing = [];
      v.priceNote = '';
      v.saveError = '';
      v.loadError = '';
      v.customerQuery = '';
      v.contactQuery = '';
      v.catalogText = '';
      v.catalogClass = 'all';
      v.catalogAvail = '';
      v.catalogLimit = 48;
      v.sent = (params && params.sent) || null;
      bus.rename('customer-order:new', 'New request');
      await Actions.callChain(context, { chain: 'loadCatalogChain' });
    }
  }

  return resetChain;
});
