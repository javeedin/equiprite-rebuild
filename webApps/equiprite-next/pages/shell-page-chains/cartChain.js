define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestData',
  'resources/js/cartDrafts',
  'resources/js/currentUser',
], (ActionChain, Actions, requestData, cartDrafts, cu) => {
  'use strict';

  // Your carts: the requests saved as drafts.
  //   toggle   opens or closes the panel (the bell, your menu and the tab menu close); opening reads the drafts again
  //   mine | all   only yours, or everyone's too (a manager sees everyone's requests)
  //   load     reads them (the shared request list, half a minute fresh) and keeps the count on the cart
  //   open     a draft in its own tab, on Review: what it still needs shows there (id, number)
  class cartChain extends ActionChain {
    async run(context, { action, id, number }) {
      const { $page } = context;
      const v = $page.variables;
      if (action === 'mine' || action === 'all') { v.draftsAll = action === 'all'; return; }
      if (action === 'open') {
        v.cartOpen = false;
        if (!id && !number) return;
        await Actions.callChain(context, { chain: 'openChain', params: { record: 'draft', params: { id: Number(id) || undefined, number: number || '', startStep: 'review' } } });
        return;
      }
      if (action === 'toggle') {
        v.cartOpen = !v.cartOpen;
        v.phoneOpen = false;
        v.bellOpen = false;
        v.profileOpen = false;
        v.tabMenuOpen = false;
        v.showResults = false;
        if (!v.cartOpen) return;
      }
      v.draftsLoading = true;
      try {
        const data = await requestData.load(context, Actions, {});
        const who = [cu.auditActor(context), cu.displayName(context), (context.$application.user || {}).username];
        v.drafts = cartDrafts.list(data.rows, data.linesByRequest, who, Date.now());
      } catch (e) {
        console.warn('[cartChain] drafts not read', e);
      } finally {
        v.draftsLoading = false;
      }
    }
  }

  return cartChain;
});
