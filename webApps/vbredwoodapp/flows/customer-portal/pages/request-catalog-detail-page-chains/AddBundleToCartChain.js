define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/draftStorage',
  'resources/js/catalogCart',
], (ActionChain, Actions, draftStorage, cart) => {
  'use strict';

  // "Add bundle" in the Frequently bundled with section: this item at the
  // header qty plus every bundled item at its stepper qty, in ONE cart write
  // with one toast. What's included is cart.bundleSelection — the same rule
  // the page uses for the toolbar text and the button's disabled state.
  class AddBundleToCartChain extends ActionChain {
    async run(context) {
      const $page = context.$page;
      const $flow = context.$flow;

      const equipmentId = Number($page.variables.equipmentId);
      if (isNaN(equipmentId)) return;

      const record = $page.variables.recordData || {};
      const sel = cart.bundleSelection(record, $page.variables.qty,
        $page.variables.bundleSuggestions, $page.variables.bundleQtyById);

      if (!sel.includeMain && sel.items.length === 0) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Nothing to add',
          message: 'Select your rental dates first so the bundle can be priced.',
          type: 'error', displayMode: 'transient'
        });
        return;
      }

      const agreementRateMap = ($flow.variables.fromAgreementId && draftStorage.hasStoredDraft('agreementRateByEquipmentId'))
        ? (draftStorage.load('agreementRateByEquipmentId') || {}) : null;

      const cartItems = [];
      if (sel.includeMain) {
        cartItems.push(cart.itemFromRow(cart.rowFromDetailRecord(equipmentId, record), sel.mainQty, agreementRateMap));
      }
      sel.items.forEach((x) => {
        cartItems.push(cart.itemFromRow(x.suggestion.row, x.qty, agreementRateMap));
      });

      await cart.commitItems(context, Actions, draftStorage, cartItems);
    }
  }

  return AddBundleToCartChain;
});
