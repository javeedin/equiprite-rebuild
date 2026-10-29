define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Stepper on a Frequently bundled with card. Stores the qty per suggestion
  // in bundleQtyById (used by that card's Add and by "Add bundle"). Written as
  // a NEW object — VB publishes a change by reference, so mutating in place
  // would update nothing.
  class BundleQtyChangedChain extends ActionChain {
    async run(context, params) {
      const $page = context.$page;

      const equipmentId = Number(params && params.equipmentId);
      if (isNaN(equipmentId)) return;

      let qty = Number(params && params.value);
      if (isNaN(qty) || qty < 0) qty = 0;

      const next = Object.assign({}, $page.variables.bundleQtyById || {});
      next[equipmentId] = qty;
      $page.variables.bundleQtyById = next;
    }
  }

  return BundleQtyChangedChain;
});
