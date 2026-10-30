define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/currentUser',
  'resources/js/orderForm',
], (ActionChain, Actions, cu, order) => {
  'use strict';

  // Start another request: Next's resetChain. An empty form for the signed-in user, an empty cart, the catalog without
  // dates. After a submit this tab says what was sent (sent; view 'sent'). quiet: resumeChain fills the form itself and
  // asks the catalog then. The phone's copy goes too (keepChain: nothing is being raised). Nothing is written.
  class resetChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const v = $page.variables;
      const p = params || {};
      const actor = cu.auditActor(context);
      const name = actor ? (cu.displayName(context) || actor) : '';
      v.mode = 'build';
      v.step = 1;
      v.form = order.emptyForm(name, actor || '');
      v.cart = [];
      v.resume = null;
      v.agreementId = null;
      v.agreementLineMap = {};
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
      v.catalogLimit = 20;
      v.sent = p.sent || null;
      v.notice = '';
      v.sheet = '';
      v.lineOpen = 0;
      v.pending = null;
      v.view = p.sent && p.sent.mode === 'submit' ? 'sent' : 'form';
      // Native inputs keep what was typed in them: emptied with the form.
      if ($page.functions && $page.functions.syncInputs) $page.functions.syncInputs(v.form, '');
      if ($page.functions && $page.functions.toTop) $page.functions.toTop('');
      await Actions.callChain(context, { chain: 'keepChain' });
      if (!p.quiet) {
        await Actions.callChain(context, { chain: 'applyCatalogChain' });
        await Actions.callChain(context, { chain: 'loadCatalogChain' });
      }
    }
  }

  return resetChain;
});
