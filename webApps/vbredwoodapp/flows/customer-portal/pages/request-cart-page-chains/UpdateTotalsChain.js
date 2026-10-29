define([
  'vb/action/actionChain',
], function(ActionChain) {
  'use strict';

  class UpdateTotalsChain extends ActionChain {
    async run(context) {
      // Stub — totals are calculated inline in the data grid subtotal column
    }
  }

  return UpdateTotalsChain;
});
