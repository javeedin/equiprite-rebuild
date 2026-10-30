define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/deliveryCoords',
  'resources/js/orderForm',
], (ActionChain, Actions, deliveryCoords, order) => {
  'use strict';

  // Review and submit, or back to editing. New EquipRite's goStepChain: back is always allowed; Review checks what
  // the request needs first (the dates, equipment, project, task, customer and delivery location) and lists what is
  // missing instead of moving.
  //
  // Arriving at Review resolves the delivery point (deliveryCoords, as NavigateToCatalogChain does before the old
  // catalog) and asks the catalog again with the project and that point, so every line shows the price this
  // project and the nearest yard give before anything is submitted.
  class reviewChain extends ActionChain {
    async run(context, { to }) {
      const { $page } = context;
      if (to !== 'review') {
        $page.variables.missing = [];
        $page.variables.mode = 'build';
        return;
      }
      const missing = order.missingFor('review', $page.variables.form, $page.variables.cart);
      if (missing.length) {
        $page.variables.missing = missing;
        $page.variables.mode = 'build';
        return;
      }
      $page.variables.missing = [];
      $page.variables.saveError = '';
      $page.variables.mode = 'review';
      try {
        // The top of this tab's page (another tab can hold a New request too; it is hidden).
        const shown = Array.prototype.filter.call(document.querySelectorAll('.nx-order'), (el) => el.offsetParent !== null)[0];
        if (shown) shown.scrollIntoView({ block: 'start', behavior: 'smooth' });
      } catch (e) { /* not in a browser */ }

      const form = $page.variables.form || {};
      let coords = { latitude: null, longitude: null };
      try {
        coords = await deliveryCoords.resolve(null, null, form.location);
      } catch (e) {
        console.warn('[reviewChain] delivery point not resolved', e);
      }
      $page.variables.form = Object.assign({}, $page.variables.form,
        { locationLatitude: coords.latitude, locationLongitude: coords.longitude });
      await Actions.callChain(context, { chain: 'loadCatalogChain' });
    }
  }

  return reviewChain;
});
