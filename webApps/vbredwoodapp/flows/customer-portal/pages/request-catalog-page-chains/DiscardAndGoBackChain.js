define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/draftStorage',
], (ActionChain, Actions, draftStorage) => {
  'use strict';

  class DiscardAndGoBackChain extends ActionChain {
    async run(context) {
      const { $page, $flow } = context;

      const dialog = document.getElementById('unsavedSelectionsDialog');
      if (dialog && typeof dialog.close === 'function') dialog.close();

      $page.variables.unsavedSelectionsCount = 0;

      const parentPage = ($flow.variables.requestOrigin === 'project')
        ? 'project-create-request'
        : 'customer-create-req';

      // Reset the cart (flow variable + localStorage) so the next catalog
      // visit starts empty. CatalogInitChain reads from draftStorage on entry,
      // so both must be cleared — clearing only the flow variable is not enough.
      $flow.variables.CartItemsArray = [];
      draftStorage.save('CartItemsArray', null);

      // Mark this as a same-trip return so HydrateDraftChain knows to keep
      // the form state. Fresh entries (e.g. from the dashboard) won't set
      // this flag and will get a clean wipe.
      $flow.variables.isReturningToCreate = true;

      await Actions.navigateToPage(context, {
        page: parentPage
      });
    }
  }

  return DiscardAndGoBackChain;
});
