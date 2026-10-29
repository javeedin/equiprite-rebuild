define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class goToParentChain extends ActionChain {
    async run(context) {
      const { $page, $flow } = context;

      const selected = ($page.variables.selectedEquipmentKeys || []).map(Number);
      const cartIds  = new Set(($flow.variables.CartItemsArray || []).map((ci) => Number(ci.id)));
      const unsaved  = selected.filter((k) => !cartIds.has(k));

      if (unsaved.length > 0) {
        $page.variables.unsavedSelectionsCount = unsaved.length;
        const dialog = document.getElementById('unsavedSelectionsDialog');
        if (dialog && typeof dialog.open === 'function') dialog.open();
        return;
      }

      const parentPage = ($flow.variables.requestOrigin === 'project')
        ? 'project-create-request'
        : 'customer-create-req';

      // Cart is DELIBERATELY preserved across this back-navigation: the user is
      // stepping back to amend the request header (dates, address, contact) and
      // expects to return to the catalog with their selections intact. Clearing
      // here forced them to re-pick everything after editing one field.
      //
      // Stale carts are still prevented — CreateRequestInitChain wipes both the
      // flow variable and the draft on a FRESH entry (isReturningToCreate false,
      // e.g. arriving from the dashboard), so a genuinely new request always
      // starts empty. The clear here was redundant for that purpose.
      //
      // The explicit-discard path (DiscardAndGoBackChain, from the unsaved-
      // selections dialog) still clears — discard means discard.

      // Mark this as a same-trip return so CreateRequestInitChain keeps the form
      // state AND the cart. Fresh entries won't set this flag and get a clean wipe.
      $flow.variables.isReturningToCreate = true;

      await Actions.navigateToPage(context, {
        page: parentPage
      });
    }
  }

  return goToParentChain;
});
