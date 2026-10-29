define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/draftStorage',
  'resources/js/catalogCart',
], function(ActionChain, Actions, draftStorage, cart) {
  'use strict';

  // Card body click → navigate to detail. addToCart action → move the STAGED
  // qty for this card into the cart (qty from pendingQtyById, display data from
  // the forwarded row or pendingRowById). Preserves the added / already-in /
  // updated notifications.
  class CardActionChain extends ActionChain {
    async run(context, { event, key, row }) {
      var $page = context.$page;
      var $flow = context.$flow;
      var actionId = event.detail.actionId || event.detail.id || event.detail.action;
      var itemKey = key || event.detail.key;

      // Card body click → detail page.
      if (!actionId) {
        if (itemKey) {
          await Actions.navigateToPage(context, {
            page: 'request-catalog-detail',
            params: { equipmentId: String(itemKey) }
          });
        }
        return;
      }

      if (actionId !== 'addToCart') return;

      var equipmentId = Number(itemKey);
      if (isNaN(equipmentId)) return;

      // Staged qty drives what we add; default to 1 if somehow unset.
      var qty = cart.stagedQtyFor($page.variables.pendingQtyById, equipmentId);
      if (!qty || qty <= 0) qty = 1;

      // Display data: prefer the live row, else the row captured when staged.
      var srcRow = row || ($page.variables.pendingRowById || {})[equipmentId]
                        || ($page.variables.pendingRowById || {})[String(equipmentId)];
      if (!srcRow) return; // nothing to build a cart line from
      // Agreement rate wins: if this item is covered by the active agreement,
      // price it at the agreement rate even when added from the full catalog.
      var agreementRateMap = ($flow.variables.fromAgreementId && draftStorage.hasStoredDraft('agreementRateByEquipmentId'))
        ? (draftStorage.load('agreementRateByEquipmentId') || {}) : null;
      var cartItem = cart.itemFromRow(srcRow, qty, agreementRateMap);

      var cartItems = ($flow.variables.CartItemsArray || []).slice();
      var existingIndex = cartItems.findIndex(function(ci) { return Number(ci.id) === equipmentId; });

      if (existingIndex === -1) {
        cartItems.push(cartItem);
        $flow.variables.CartItemsArray = cartItems;
        draftStorage.save('CartItemsArray', cartItems);
        await Actions.fireNotificationEvent(context, {
          summary: 'Added to Cart',
          message: cartItem.name + ' (qty ' + qty + ') added.',
          type: 'info', displayMode: 'transient'
        });
      } else {
        var oldQty = cartItems[existingIndex].quantity;
        if (oldQty === qty) {
          await Actions.fireNotificationEvent(context, {
            summary: 'Already in Cart',
            message: cartItem.name + ' is already in your cart (qty ' + oldQty + '). Change quantity here or in the cart to update.',
            type: 'info', displayMode: 'transient'
          });
        } else {
          cartItems[existingIndex] = cartItem;
          $flow.variables.CartItemsArray = cartItems;
          draftStorage.save('CartItemsArray', cartItems);
          await Actions.fireNotificationEvent(context, {
            summary: 'Cart Updated',
            message: cartItem.name + ' qty ' + oldQty + ' → ' + qty + '.',
            type: 'info', displayMode: 'transient'
          });
        }
      }
    }
  }

  return CardActionChain;
});
