define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/draftStorage',
  'resources/js/catalogCart',
], (ActionChain, Actions, draftStorage, cart) => {
  'use strict';

  // Rate/class/availability were already fetched once by EquipmentDetailInitChain
  // (recordData) — reuse that instead of hitting the catalog endpoint again.
  // Qty comes from the page's quantity stepper. Same cart write + notification
  // behavior as CardActionChain, including updating an existing line if the
  // customer changes qty and clicks Add again.
  class AddToCartChain extends ActionChain {
    async run(context) {
      const $page = context.$page;
      const $flow = context.$flow;

      const equipmentId = Number($page.variables.equipmentId);
      if (isNaN(equipmentId)) return;

      let qty = Number($page.variables.qty);
      if (!qty || qty <= 0) qty = 1;

      const record = $page.variables.recordData || {};
      if (!record.catalogAvailable) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Could not add',
          message: 'Equipment details are unavailable right now. Try again from the catalog.',
          type: 'error', displayMode: 'transient'
        });
        return;
      }

      // Catalog-shaped row rebuilt from recordData — shared with AddBundleToCartChain.
      const row = cart.rowFromDetailRecord(equipmentId, record);

      const agreementRateMap = ($flow.variables.fromAgreementId && draftStorage.hasStoredDraft('agreementRateByEquipmentId'))
        ? (draftStorage.load('agreementRateByEquipmentId') || {}) : null;
      const cartItem = cart.itemFromRow(row, qty, agreementRateMap);

      // Add / already-in / qty-updated + toast — shared with BundleAddToCartChain.
      await cart.commitItem(context, Actions, draftStorage, cartItem);
    }
  }

  return AddToCartChain;
});
