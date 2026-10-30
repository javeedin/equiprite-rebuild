define([
  'vb/action/actionChain',
  'resources/js/catalogCart',
], (ActionChain, catalogCart) => {
  'use strict';

  // The cart (New's customer cartChain). One line per equipment, built by catalogCart.itemFromRow, the old catalog's
  // own builder, so a line carries the same rate, unit and period fields into requestLineBody.
  //   add          from the catalog (quantity 1, or one more when already in the cart)
  //   inc / dec    the stepper; down to 0 removes the line
  //   set          a typed quantity on Review (at least 1)
  //   remove       the line
  //   line         a line's own start date, end date or note; empty falls back to the request's
  const LINE_FIELDS = { startDate: true, endDate: true, notes: true };

  class cartChain extends ActionChain {
    async run(context, { action, id, value, field }) {
      const v = context.$page.variables;
      const key = Number(id);
      const cart = (v.cart || []).slice();
      const at = cart.findIndex((c) => Number(c.id) === key);

      if (action === 'add') {
        if (at !== -1) {
          cart[at] = Object.assign({}, cart[at], { quantity: (Number(cart[at].quantity) || 0) + 1 });
        } else {
          const row = (v.catalogRows || []).find((r) => Number(r.eqrEquipmentMasterId) === key);
          if (!row) return;
          const agr = v.agreementId != null && row.billRate != null ? { [key]: { billingRate: row.billRate, billingUnit: row.rateUom || 'DAY' } } : null;
          cart.push(catalogCart.itemFromRow(row, 1, agr));
        }
      } else if (at === -1) {
        return;
      } else if (action === 'inc' || action === 'dec') {
        const q = (Number(cart[at].quantity) || 0) + (action === 'inc' ? 1 : -1);
        if (q <= 0) cart.splice(at, 1);
        else cart[at] = Object.assign({}, cart[at], { quantity: q });
      } else if (action === 'set') {
        cart[at] = Object.assign({}, cart[at], { quantity: Math.max(1, Math.floor(Number(value) || 1)) });
      } else if (action === 'remove') {
        cart.splice(at, 1);
      } else if (action === 'line' && LINE_FIELDS[field]) {
        const next = Object.assign({}, cart[at]);
        const val = value == null ? '' : String(value);
        if (val === '') delete next[field];
        else next[field] = val;
        cart[at] = next;
      } else {
        return;
      }
      v.cart = cart;
      if (v.missing && v.missing.length) v.missing = [];
    }
  }

  return cartChain;
});
