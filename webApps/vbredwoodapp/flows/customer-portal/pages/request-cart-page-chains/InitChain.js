define([
  'vb/action/actionChain',
], function(ActionChain) {
  'use strict';

  class InitChain extends ActionChain {
    async run(context) {
      // Stub — cart is populated via CartItemsArray flow variable
    }
  }

  return InitChain;
});
