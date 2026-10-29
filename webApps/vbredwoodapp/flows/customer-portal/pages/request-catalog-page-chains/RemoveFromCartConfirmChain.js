define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/draftStorage',
], function(ActionChain, Actions, draftStorage) {
  'use strict';

  // User confirmed "Yes, remove from cart". Handles both single-checkbox uncheck
  // and deselect-all, via pendingUncheckEquipmentIds (1+ ids).
  class RemoveFromCartConfirmChain extends ActionChain {
    async run(context) {
      var $page = context.$page;
      var $flow = context.$flow;

      var ids = ($page.variables.pendingUncheckEquipmentIds || []).map(Number);
      if (ids.length === 0) return;
      var idSet = new Set(ids);

      // 1. Remove from the cart.
      $flow.variables.CartItemsArray = ($flow.variables.CartItemsArray || [])
        .filter(function(ci) { return !idSet.has(Number(ci.id)); });
      draftStorage.save('CartItemsArray', $flow.variables.CartItemsArray);

      // 2. Drop from selection.
      $page.variables.selectedEquipmentKeys = ($page.variables.selectedEquipmentKeys || [])
        .filter(function(k) { return !idSet.has(Number(k)); });
      $page.variables.selectedById =
        $page.functions.buildSelectedById($page.variables.selectedEquipmentKeys);

      // 3. Unstage qty for these ids.
      var pendingQty = Object.assign({}, $page.variables.pendingQtyById || {});
      ids.forEach(function(id) { delete pendingQty[id]; delete pendingQty[String(id)]; });
      $page.variables.pendingQtyById = pendingQty;

      // 3b. Directly uncheck the DOM checkboxes. The CheckboxChanged chain forced
      // event.target.checked=true when it opened this dialog (to keep the box
      // checked while deciding), and that manual property set isn't reconciled by
      // the :checked binding re-eval — so set the DOM property ourselves.
      ids.forEach(function(id) {
        var el = document.querySelector('#equipmentListView .eq-card-checkbox[data-equipment-id="' + id + '"]');
        if (el) el.checked = false;
      });

      // 4. Close dialog + clear pending state.
      var dialog = document.getElementById('removeFromCartDialog');
      if (dialog && typeof dialog.close === 'function') dialog.close();
      $page.variables.pendingUncheckEquipmentIds  = [];
      $page.variables.pendingUncheckDialogMessage = '';

      // 5. Toast.
      await Actions.fireNotificationEvent(context, {
        summary: 'Removed from Cart',
        message: (ids.length === 1) ? '1 item removed from your cart.'
                                    : ids.length + ' items removed from your cart.',
        type: 'info', displayMode: 'transient'
      });
    }
  }

  return RemoveFromCartConfirmChain;
});
