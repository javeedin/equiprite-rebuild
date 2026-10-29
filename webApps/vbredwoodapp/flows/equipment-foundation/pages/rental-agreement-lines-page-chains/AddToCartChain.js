define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Appends the currently checked grid rows to pendingCart on this page.
  // Selection state lives on the PageModule instance (_selectedRows Set) so
  // we read it through the page function getSelectedRowIndices(); each index
  // maps directly into filteredLines (the array the grid is rendering).
  //
  // Deduplicates by agreementLineId — if a line is already in the cart,
  // skip it and surface a toast that counts the duplicates.
  //
  // After adding, we clear the page-module selection and reset selectedCount
  // so checkboxes uncheck visually for the next search-and-add iteration.
  // cartCount is updated explicitly to drive the badge binding on the
  // Create Request button.
  class AddToCartChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const indices = $page.functions.getSelectedRowIndices() || [];
      const filtered = $page.variables.filteredLines || [];
      const selectedRows = indices
        .map(i => filtered[i])
        .filter(r => r != null);

      if (selectedRows.length === 0) {
        await Actions.fireNotificationEvent(context, {
          summary: 'No selection',
          message: 'Check at least one row before adding to cart.',
          displayMode: 'transient',
          type: 'warning'
        });
        return;
      }

      const idMap        = $page.variables.agreementLineIdByCompositeKey || {};
      const existingCart = $page.variables.pendingCart || [];
      const existingAgreementLineIds = new Set(existingCart.map(c => c.agreementLineId));

      const toAdd = [];
      let dupCount = 0;
      let unresolvedCount = 0;

      selectedRows.forEach(line => {
        const idEntry = idMap[line.compositeKey];
        if (!idEntry || idEntry.agreementLineId == null) {
          unresolvedCount++;
          return;
        }
        if (existingAgreementLineIds.has(idEntry.agreementLineId)) {
          dupCount++;
          return;
        }
        existingAgreementLineIds.add(idEntry.agreementLineId);
        toAdd.push({
          compositeKey:      line.compositeKey,
          agreementLineId:   idEntry.agreementLineId,
          equipmentMasterId: idEntry.equipmentMasterId,
          equipmentClassId:  idEntry.equipmentClassId,
          equipment_name:    line.equipment_name,
          class_name:        line.class_name,
          subClassName:      line.subClassName,
          quantity:          1,
          billingRate:       idEntry.unitPrice != null ? idEntry.unitPrice : line.bill_rate,
          priceUom:          idEntry.priceUom || line.price_uom || 'DAY'
        });
      });

      if (toAdd.length > 0) {
        $page.variables.pendingCart = [...existingCart, ...toAdd];
        $page.variables.cartCount   = $page.variables.pendingCart.length;
      }

      // Reset the checkbox selection so the user can search again cleanly.
      $page.functions.clearSelection($page.variables);

      // Toast with a precise breakdown
      const parts = [];
      if (toAdd.length > 0)       parts.push(toAdd.length + ' added');
      if (dupCount > 0)           parts.push(dupCount + ' already in cart');
      if (unresolvedCount > 0)    parts.push(unresolvedCount + ' skipped (no ID)');
      await Actions.fireNotificationEvent(context, {
        summary: toAdd.length > 0 ? 'Added to Cart' : 'Nothing new',
        message: 'Cart: ' + parts.join(', ') + '. Total: ' + $page.variables.cartCount + ' line(s).',
        displayMode: 'transient',
        type: toAdd.length > 0 ? 'confirmation' : 'warning'
      });
    }
  }

  return AddToCartChain;
});
