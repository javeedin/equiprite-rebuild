define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/draftStorage',
  'resources/js/catalogCart',
], (ActionChain, Actions, draftStorage, cart) => {
  'use strict';

  // "Add" on a bundle suggestion card. Builds the cart line from the
  // suggestion's OWN catalog row (joined in EquipmentDetailInitChain), so it is
  // priced exactly like adding that item from its catalog card — rentable vs
  // consumable branch and agreement-rate override included. Qty is the link's
  // suggestedQuantity (DEFAULT_QUANTITY from the anchor side, 1 from the
  // reverse side).
  class BundleAddToCartChain extends ActionChain {
    async run(context, params) {
      const $page = context.$page;
      const $flow = context.$flow;

      const equipmentId = Number(params && params.equipmentId);
      if (isNaN(equipmentId)) return;

      const suggestion = ($page.variables.bundleSuggestions || [])
        .find((s) => Number(s.id) === equipmentId);
      if (!suggestion) return;

      if (!suggestion.row) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Could not add',
          message: 'Select your rental dates first so ' + suggestion.name + ' can be priced.',
          type: 'error', displayMode: 'transient'
        });
        return;
      }

      const agreementRateMap = ($flow.variables.fromAgreementId && draftStorage.hasStoredDraft('agreementRateByEquipmentId'))
        ? (draftStorage.load('agreementRateByEquipmentId') || {}) : null;
      // Qty from this card's stepper; it starts at the link's suggestedQuantity.
      const qtyById = $page.variables.bundleQtyById || {};
      const qty = qtyById[equipmentId] != null ? Number(qtyById[equipmentId]) : suggestion.suggestedQty;
      if (!(qty > 0)) return;
      const cartItem = cart.itemFromRow(suggestion.row, qty, agreementRateMap);

      await cart.commitItem(context, Actions, draftStorage, cartItem);
    }
  }

  return BundleAddToCartChain;
});
