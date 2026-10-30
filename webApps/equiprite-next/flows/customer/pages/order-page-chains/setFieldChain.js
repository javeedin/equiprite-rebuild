define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // One field changed (inputs and pick buttons carry data-field). New's customer setFieldChain, the same side effects:
  //   dates          the catalog is asked again, so availability, estimates and cart prices follow the new window
  //   customerRefId  the picked customer (id and name); the catalog is asked again (its rates are the customer's).
  //                  The contact is independent and kept
  //   requestorId    the picked contact (id and name)
  //   location       a typed address clears the delivery point; it is found again on the way to Review
  //   customerQuery, contactQuery  the pickers' search text
  //   termsAccepted  the rental terms tick (not posted; the old cart's terms gate)
  class setFieldChain extends ActionChain {
    async run(context, { field, value, checked }) {
      const v = context.$page.variables;
      if (!field) return;
      if (field === 'customerQuery' || field === 'contactQuery') {
        v[field] = value == null ? '' : String(value);
        return;
      }
      if (field === 'termsAccepted') {
        v.termsAccepted = checked === true || checked === 'true';
        if (v.missing && v.missing.length) v.missing = [];
        return;
      }
      const form = Object.assign({}, v.form || {});
      const val = value == null ? '' : String(value);

      if (field === 'customerRefId') {
        const c = (v.customers || []).find((o) => String(o.id) === val);
        const changed = String(form.customerRefId == null ? '' : form.customerRefId) !== String(c ? c.id : '');
        form.customerRefId = c ? Number(c.id) : null;
        form.customerName = c ? (c.customerName || '') : '';
        v.form = form;
        v.customerQuery = '';
        v.missing = [];
        if (changed && form.customerRefId != null) await Actions.callChain(context, { chain: 'loadCatalogChain' });
        return;
      }
      if (field === 'requestorId') {
        const u = (v.contacts || []).find((o) => String(o.id) === val);
        form.requestorId = u ? Number(u.id) : null;
        form.requestorName = u ? (u.contactName || '') : '';
        v.contactQuery = '';
      } else if (field === 'location') {
        form.location = val;
        form.locationLatitude = null;
        form.locationLongitude = null;
      } else if (['startDate', 'endDate', 'notes'].indexOf(field) !== -1) {
        form[field] = val;
      } else {
        return;
      }
      v.form = form;
      if (v.missing && v.missing.length) v.missing = [];
      if (field === 'startDate' || field === 'endDate') await Actions.callChain(context, { chain: 'loadCatalogChain' });
    }
  }

  return setFieldChain;
});
