define([
  'vb/action/actionChain',
  'resources/js/draftStorage',
], function(ActionChain, draftStorage) {
  'use strict';

  class CartRowMenuChain extends ActionChain {
    async run(context, { actionId, itemId }) {
      var $page = context.$page;
      var $flow = context.$flow;

      if (actionId === 'delete') {
        $flow.variables.CartItemsArray = ($flow.variables.CartItemsArray || []).filter(function(ci) {
          return String(ci.id) !== String(itemId);
        });
        draftStorage.save('CartItemsArray', $flow.variables.CartItemsArray);
        // Same arguments as InitCartChain — dropping the last two flipped the
        // RATE column from the PPM / quote text back to amounts.
        $page.variables.dataGridProvider = $page.functions.initGridData(
          $flow.variables.CartItemsArray,
          $flow.variables.ActiveRequestDetail || {},
          !$page.variables.showHoursColumn,
          $page.variables.hideRatesForQuote,
          $page.variables.ppmRateText
        );

      } else if (actionId === 'edit') {
        var item = ($flow.variables.CartItemsArray || []).find(function(ci) {
          return String(ci.id) === String(itemId);
        });
        if (!item) { return; }
        var req = $flow.variables.ActiveRequestDetail || {};
        var start = (item.startDate || req.requestedStartDate || '').slice(0, 10);
        var end   = (item.endDate   || req.requestedEndDate   || '').slice(0, 10);
        $page.variables.editingItemId    = itemId;
        $page.variables.editingQty       = item.quantity  || 1;
        $page.variables.editingStartDate = start;
        $page.variables.editingEndDate   = end;
        $page.variables.editingOrigStartDate = start;
        $page.variables.editingOrigEndDate   = end;
        $page.variables.editingIsConsumable = item.isConsumable === true ||
          String(item.billingUnit || '').toUpperCase() === 'EACH';
        $page.variables.editingDateErrors = {};
        // Hours: line value wins; else header default; else blank.
        $page.variables.editingHours =
          (item.hours != null && item.hours !== '') ? Number(item.hours) :
          (req.hours  != null && req.hours  !== '') ? Number(req.hours)  :
          null;
        var dialog = document.getElementById('editQtyDialog');
        if (dialog) { dialog.open(); }

      } else if (actionId === 'notes') {
        var noteItem = ($flow.variables.CartItemsArray || []).find(function(ci) {
          return String(ci.id) === String(itemId);
        });
        if (!noteItem) { return; }
        $page.variables.editingItemId   = itemId;
        $page.variables.editingItemName = noteItem.name || '';
        $page.variables.editingNotes    = noteItem.notes || '';
        var notesDialog = document.getElementById('lineNotesDialog');
        if (notesDialog) { notesDialog.open(); }
      }
    }
  }

  return CartRowMenuChain;
});
