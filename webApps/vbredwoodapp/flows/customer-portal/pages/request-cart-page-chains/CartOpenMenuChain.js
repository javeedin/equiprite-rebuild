define([
  'vb/action/actionChain',
], function(ActionChain) {
  'use strict';

  class CartOpenMenuChain extends ActionChain {
    async run(context, { event }) {
      var $page = context.$page;

      // Read item id from the button's data attribute (set via data-item-id binding)
      var launcher = event.currentTarget;
      var itemId = launcher ? launcher.getAttribute('data-item-id') : null;
      if (!itemId) { return; }

      $page.variables.editingItemId = itemId;

      var menu = document.getElementById('cartRowMenu');
      if (menu) {
        menu.open(event.detail.originalEvent, { launcher: launcher });
      }
    }
  }

  return CartOpenMenuChain;
});
