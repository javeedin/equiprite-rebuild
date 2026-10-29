define([
  'vb/action/actionChain',
], function(ActionChain) {
  'use strict';

  // Cancel for the cart's small dialogs (Edit Line, Line Notes, Complete Request Details).
  class CartCancelEditChain extends ActionChain {
    async run(context) {
      var $page = context.$page;
      $page.variables.editingItemId = null;
      $page.variables.editingDateErrors = {};
      ['editQtyDialog', 'lineNotesDialog', 'completeDetailsDialog'].forEach(function(id) {
        var dialog = document.getElementById(id);
        if (dialog && dialog.isOpen && dialog.isOpen()) { dialog.close(); }
      });
    }
  }

  return CartCancelEditChain;
});
