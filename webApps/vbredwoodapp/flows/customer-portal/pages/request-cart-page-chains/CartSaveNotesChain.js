define([
  'vb/action/actionChain',
  'resources/js/draftStorage',
], function(ActionChain, draftStorage) {
  'use strict';

  // Saves the Line Notes dialog onto the cart item as `notes`. requestLineBody
  // posts it as LINE_NOTES (VARCHAR2 2000) on submit / Save as Draft, and
  // draftResume reads it back, so nothing else is needed downstream.
  class CartSaveNotesChain extends ActionChain {
    async run(context) {
      var $page = context.$page;
      var $flow = context.$flow;

      var itemId = $page.variables.editingItemId;
      // Trimmed and capped at the column size; blank clears the note.
      var notes = String($page.variables.editingNotes || '').trim().slice(0, 2000);

      var cartItems = ($flow.variables.CartItemsArray || []).slice();
      var idx = cartItems.findIndex(function(ci) { return String(ci.id) === String(itemId); });
      if (idx !== -1) {
        cartItems[idx] = Object.assign({}, cartItems[idx], { notes: notes || null });
        $flow.variables.CartItemsArray = cartItems;
        draftStorage.save('CartItemsArray', cartItems);
      }

      $page.variables.editingItemId   = null;
      $page.variables.editingNotes    = '';
      $page.variables.editingItemName = '';
      var dialog = document.getElementById('lineNotesDialog');
      if (dialog) { dialog.close(); }
    }
  }

  return CartSaveNotesChain;
});
