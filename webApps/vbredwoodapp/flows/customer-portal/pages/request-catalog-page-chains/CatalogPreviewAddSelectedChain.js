define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/draftStorage',
  'resources/js/catalogCart',
], function(ActionChain, Actions, draftStorage, cart) {
  'use strict';

  // "Add selected to cart" from the template-preview dialog. Takes the checked
  // preview lines and writes them straight into the CART (CartItemsArray) —
  // qty comes from the template line, display data from the row captured at
  // preview time. Mirrors CatalogAddCheckedToCartChain's write pattern. Lines
  // no longer in the catalog (no captured row) are skipped + reported.
  class CatalogPreviewAddSelectedChain extends ActionChain {
    async run(context) {
      var $page = context.$page;
      var $flow = context.$flow;

      var selectedKeys = ($page.variables.previewSelectedKeys || []).map(Number);
      if (selectedKeys.length === 0) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Nothing selected',
          message: 'Check at least one line before adding to cart.',
          type: 'warning', displayMode: 'transient'
        });
        return;
      }

      var lines = $page.variables.previewLinesArray || [];
      var lineById = {};
      lines.forEach(function(l) { lineById[Number(l.equipmentMasterId)] = l; });

      // Agreement rate wins for any agreement-covered item (see CardActionChain).
      var agreementRateMap = ($flow.variables.fromAgreementId && draftStorage.hasStoredDraft('agreementRateByEquipmentId'))
        ? (draftStorage.load('agreementRateByEquipmentId') || {}) : null;

      var cartItems = ($flow.variables.CartItemsArray || []).slice();
      var addedCount = 0, updatedCount = 0, unchangedCount = 0, skipped = 0;

      selectedKeys.forEach(function(id) {
        var line = lineById[id];
        if (!line || !line._row) { skipped++; return; }   // no display data → can't add

        var qty = Number(line.quantity) || 1;
        var cartItem = cart.itemFromRow(line._row, qty, agreementRateMap);
        if (cartItem.classId == null && line.classId != null) {
          cartItem.classId = Number(line.classId);
        }

        var i = cartItems.findIndex(function(ci) { return Number(ci.id) === Number(id); });
        if (i === -1) { cartItems.push(cartItem); addedCount++; }
        else if (cartItems[i].quantity !== qty) { cartItems[i] = cartItem; updatedCount++; }
        else { unchangedCount++; }
      });

      if (addedCount > 0 || updatedCount > 0) {
        $flow.variables.CartItemsArray = cartItems;
        draftStorage.save('CartItemsArray', cartItems);
      }

      var parts = [];
      if (addedCount   > 0) parts.push(addedCount   + ' added');
      if (updatedCount > 0) parts.push(updatedCount + ' updated');
      if (unchangedCount > 0) parts.push(unchangedCount + ' already in cart');
      if (skipped > 0) parts.push(skipped + ' no longer available');

      await Actions.fireNotificationEvent(context, {
        summary: (addedCount + updatedCount > 0) ? 'Cart Updated' : 'No Changes',
        message: 'Cart: ' + (parts.length ? parts.join(', ') : 'no changes') + '.',
        type: skipped > 0 ? 'warning' : 'confirmation', displayMode: 'transient'
      });

      // Close the preview after a successful add.
      if (addedCount + updatedCount > 0) {
        var dialog = document.getElementById('templatePreviewDialog');
        if (dialog && typeof dialog.close === 'function') dialog.close();
      }
    }
  }

  return CatalogPreviewAddSelectedChain;
});
