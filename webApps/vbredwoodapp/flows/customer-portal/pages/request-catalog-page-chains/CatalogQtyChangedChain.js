define([
  'vb/action/actionChain',
  'resources/js/catalogCart',
], function(ActionChain, cart) {
  'use strict';

  // Per-card quantity stepper → STAGING only (pendingQtyById). Does NOT touch the
  // cart; the item enters the cart only on an explicit Add action. The checkbox
  // highlight follows the 0 ⇄ positive transition.
  class CatalogQtyChangedChain extends ActionChain {
    async run(context, { event, row }) {
      var $page = context.$page;

      var newQty = Number(event.detail.value);
      var equipmentId = Number(event.target.getAttribute('data-equipment-id'));
      if (isNaN(newQty) || isNaN(equipmentId)) return;

      var pendingQty = $page.variables.pendingQtyById || {};
      var oldQty = cart.stagedQtyFor(pendingQty, equipmentId);

      // Stage qty (and capture row display data for the later Add).
      $page.variables.pendingQtyById = cart.stageQty(pendingQty, equipmentId, newQty);
      if (newQty > 0 && row) {
        $page.variables.pendingRowById = cart.stageRow($page.variables.pendingRowById, equipmentId, row);
      }

      // Checkbox highlight follows 0 ⇄ positive.
      var keys = ($page.variables.selectedEquipmentKeys || []).slice();
      var changed = false;
      if (oldQty === 0 && newQty > 0 && !keys.includes(equipmentId)) {
        keys.push(equipmentId);
        $page.variables.selectedEquipmentKeys = keys;
        changed = true;
      } else if (oldQty > 0 && newQty === 0) {
        $page.variables.selectedEquipmentKeys = keys.filter(function(k) { return Number(k) !== equipmentId; });
        changed = true;
      }
      if (changed) {
        $page.variables.selectedById =
          $page.functions.buildSelectedById($page.variables.selectedEquipmentKeys);
      }
    }
  }

  return CatalogQtyChangedChain;
});
