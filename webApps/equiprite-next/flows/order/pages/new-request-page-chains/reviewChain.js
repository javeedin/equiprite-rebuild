define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/deliveryCoords',
  'resources/js/orderForm',
], (ActionChain, Actions, deliveryCoords, order) => {
  'use strict';

  // Review and submit (step 3), or back to editing (step 2). New EquipRite's goStepChain: back is always allowed;
  // Review checks what the request needs first (the dates, equipment, project, task, customer and delivery location)
  // and lists what is missing instead of moving, on the first step that still needs something.
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
        if ($page.variables.step === 3) $page.variables.step = 2;
        return;
      }
      const missing = order.missingFor('review', $page.variables.form, $page.variables.cart);
      if (missing.length) {
        $page.variables.missing = missing;
        $page.variables.mode = 'build';
        // Stay on (or go back to) the first step that still needs something.
        $page.variables.step = order.missingFor(1, $page.variables.form, $page.variables.cart).length ? 1 : 2;
        return;
      }
      $page.variables.missing = [];
      $page.variables.saveError = '';
      $page.variables.mode = 'review';
      $page.variables.step = 3;
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
