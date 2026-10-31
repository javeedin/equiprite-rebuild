define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/deliveryCoords',
  'resources/js/customerOrder',
], (ActionChain, Actions, deliveryCoords, O) => {
  'use strict';

  // Review and send, or back to editing: New's customer goStepChain. Back is always allowed; Review checks what the
  // first two steps need (the dates and equipment; the customer, contact and delivery address) and lists what is
  // missing instead of moving. Arriving at Review resolves the delivery point from the typed address (deliveryCoords)
  // and asks the catalog again with the customer and that point, so every line shows the price this customer and the
  // nearest yard give before anything is sent.
  class modeChain extends ActionChain {
    async run(context, { to }) {
      const v = context.$page.variables;
      if (to !== 'review') {
        v.missing = [];
        v.mode = 'edit';
        return;
      }
      const missing = O.missingFor(1, v.form, v.cart).concat(O.missingFor(2, v.form, v.cart));
      if (missing.length) {
        v.missing = missing;
        return;
      }
      v.missing = [];
      v.saveError = '';
      v.mode = 'review';
      try {
        const shown = Array.prototype.filter.call(document.querySelectorAll('.nx-cu-order'), (el) => el.offsetParent !== null)[0];
        if (shown) shown.scrollIntoView({ block: 'start', behavior: 'smooth' });
      } catch (e) { /* not in a browser */ }
      const form = v.form || {};
      let coords = { latitude: null, longitude: null };
      try {
        coords = await deliveryCoords.resolve(null, null, form.location);
      } catch (e) {
        console.warn('[customer modeChain] delivery point not resolved', e);
      }
      v.form = Object.assign({}, v.form, { locationLatitude: coords.latitude, locationLongitude: coords.longitude });
      await Actions.callChain(context, { chain: 'loadCatalogChain' });
    }
  }

  return modeChain;
});
