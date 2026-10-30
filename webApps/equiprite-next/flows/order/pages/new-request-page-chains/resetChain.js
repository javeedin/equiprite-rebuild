define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/currentUser',
  'resources/js/orderForm',
  'resources/js/shellBus',
], (ActionChain, Actions, cu, order, bus) => {
  'use strict';

  // Start another request: an empty form for the signed-in user, an empty cart, the catalog without dates. After a
  // submit the banner says what was sent (sent). In a draft's own tab it opens New request instead, so the tab named
  // after the draft keeps showing the draft. Nothing is written.
  class resetChain extends ActionChain {
    async run(context, params) {
      const v = context.$page.variables;
      if ((v.id || v.number) && !(params && params.sent)) {
        bus.open({ navId: 'new-request' });
        return;
      }
      const actor = cu.auditActor(context);
      const name = actor ? (cu.displayName(context) || actor) : '';
      v.mode = 'build';
      v.form = order.emptyForm(name, actor || '');
      v.cart = [];
      v.resume = null;
      v.agreementId = null;
      v.agreementLineMap = {};
      v.fromAgreement = null;
      if (v.canCustomer) v.requestFor = 'project';
      v.missing = [];
      v.priceNote = '';
      v.saveError = '';
      v.loadError = '';
      v.externalDraftId = 0;
      v.projectQuery = '';
      v.projectResults = [];
      v.customerQuery = '';
      v.customerResults = [];
      v.taskOptions = [];
      v.taskQuery = '';
      v.contractOptions = [];
      v.siteOptions = [];
      v.sitesLoaded = false;
      v.catalogText = '';
      v.catalogClass = 'all';
      v.catalogAvail = '';
      v.catalogLimit = 40;
      v.sent = (params && params.sent) || null;
      await Actions.callChain(context, { chain: 'loadCatalogChain' });
    }
  }

  return resetChain;
});
