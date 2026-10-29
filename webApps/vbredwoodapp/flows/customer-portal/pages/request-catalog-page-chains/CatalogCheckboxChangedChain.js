define([
  'vb/action/actionChain',
  'resources/js/catalogCart',
], function(ActionChain, cart) {
  'use strict';

  // Checkbox toggle → STAGING only (selectedEquipmentKeys + pendingQtyById).
  // Checking stages qty 1 (or keeps a higher staged qty); unchecking clears the
  // stage — UNLESS the item is already in the cart, in which case we hold the
  // uncheck behind a confirmation dialog (its Yes path removes from the cart).
  class CatalogCheckboxChangedChain extends ActionChain {
    async run(context, { event, key, row }) {
      const $page = context.$page;
      const $flow = context.$flow;
      const checked = event.target.checked;
      const equipmentId = Number(key);

      // Unchecking an item that's in the cart → confirm before removing.
      if (!checked) {
        const cartItems = $flow.variables.CartItemsArray || [];
        const inCartItem = cartItems.find(ci => Number(ci.id) === equipmentId);
        if (inCartItem) {
          event.target.checked = true; // re-check visually while the dialog is open
          $page.variables.pendingUncheckEquipmentIds  = [equipmentId];
          $page.variables.pendingUncheckDialogMessage =
            (inCartItem.name || 'This item') +
            ' is in your cart (qty ' + (inCartItem.quantity || 1) +
            '). Do you also want to remove it from the cart?';
          const dialog = document.getElementById('removeFromCartDialog');
          if (dialog && typeof dialog.open === 'function') dialog.open();
          return;
        }
      }

      // Normal path — update selection + staged qty (NOT the cart).
      let keys = ($page.variables.selectedEquipmentKeys || []).slice();
      let pendingQty = $page.variables.pendingQtyById || {};

      if (checked) {
        if (!keys.includes(equipmentId)) keys.push(equipmentId);
        const existing = cart.stagedQtyFor(pendingQty, equipmentId);
        const qty = existing > 0 ? existing : 1;
        $page.variables.pendingQtyById = cart.stageQty(pendingQty, equipmentId, qty);
        if (row) $page.variables.pendingRowById = cart.stageRow($page.variables.pendingRowById, equipmentId, row);
      } else {
        keys = keys.filter(k => Number(k) !== equipmentId);
        $page.variables.pendingQtyById = cart.stageQty(pendingQty, equipmentId, 0); // unstage
      }

      // Write BOTH selection shapes together. selectedEquipmentKeys stays the
      // ordered list the cart/nav chains read; selectedById is what the per-card
      // :checked bindings read. Keeping them in lockstep here is what lets the
      // bindings key on a single id instead of depending on a global tick --
      // with 306 cards loaded, a tick re-rendered every one of them at once.
      $page.variables.selectedEquipmentKeys = keys;
      $page.variables.selectedById = $page.functions.buildSelectedById(keys);
    }
  }

  return CatalogCheckboxChangedChain;
});
