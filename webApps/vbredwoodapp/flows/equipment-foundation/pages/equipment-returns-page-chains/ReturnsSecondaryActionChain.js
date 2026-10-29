define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Dispatch for the page's secondary actions.
   *
   * oj-sp-smart-search-page fires ONE on-sp-secondary-action event for every
   * entry in its secondary-actions array, so the handler has to branch on the
   * id it carries. Same shape as request-cart-page's secondaryActionDispatch.
   *
   * The page previously wired this event straight to onClearSelection, back
   * when no secondary actions were declared — so nothing ever rendered and the
   * handler never fired. Clear Selection keeps working through that path here.
   */
  class ReturnsSecondaryActionChain extends ActionChain {
    async run(context, params) {
      // The id arrives as detail.secondaryItem, NOT detail.id — verified
      // against request-cart-page's SecondaryActionChain, the one working
      // example of this event in the app. Reading detail.id silently yielded
      // '' and every click fell through to the else branch.
      const ev = params && params.event;
      const id = (ev && ev.detail && (ev.detail.secondaryItem || ev.detail.id)) || '';
      console.log('[ReturnsSecondaryActionChain] secondary action:', id);

      if (id === 'directReturn') {
        await Actions.callChain(context, { chain: 'OpenDirectReturnChain' });
        return;
      }

      // Anything else keeps the page's original behaviour.
      await Actions.callChain(context, { chain: 'ClearSelectionChain' });
    }
  }

  return ReturnsSecondaryActionChain;
});
