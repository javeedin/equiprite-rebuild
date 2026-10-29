define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/deliveryCoords',
], (ActionChain, Actions, deliveryCoords) => {
  'use strict';

  // Moves between the three steps. Back is always allowed; forward checks every step on the way
  // (new-request-page.js missingFor) and lists what is missing instead of moving.
  //
  // Arriving at Review resolves the delivery point (deliveryCoords, as NavigateToCatalogChain does before the
  // old catalog) and reloads the catalog with the project and that point, so every line shows the price this
  // project and the nearest yard give before anything is submitted.
  class goStepChain extends ActionChain {
    async run(context, { step }) {
      const { $page } = context;
      const to = Math.min(3, Math.max(1, Number(step) || 1));
      const from = Number($page.variables.step) || 1;
      if (to <= from) {
        $page.variables.missing = [];
        $page.variables.step = to;
        return;
      }
      for (let s = from; s < to; s++) {
        const missing = $page.functions.missingFor(s, $page.variables.form, $page.variables.cart);
        if (missing.length) {
          $page.variables.step = s;
          $page.variables.missing = missing;
          return;
        }
      }
      $page.variables.missing = [];
      $page.variables.step = to;
      try {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (e) { /* not in a browser */ }

      if (to === 3) {
        const form = $page.variables.form || {};
        let coords = { latitude: null, longitude: null };
        try {
          coords = await deliveryCoords.resolve(null, null, form.location);
        } catch (e) {
          console.warn('[goStepChain] delivery point not resolved', e);
        }
        $page.variables.form = Object.assign({}, $page.variables.form,
          { locationLatitude: coords.latitude, locationLongitude: coords.longitude });
        await Actions.callChain(context, { chain: 'loadCatalogChain' });
      }
    }
  }

  return goStepChain;
});
