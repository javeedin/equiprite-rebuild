define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // One field changed (inputs and pick buttons carry data-field). The side effects are the old customer pages':
  //   dates          reload the catalog, so availability, estimates and cart prices follow the new window
  //   customerRefId  the picked customer (CustomerSelectedChain: id and name); reloads the catalog, whose rates
  //                  depend on the customer (customerRefId). The contact is independent and kept (as there).
  //   requestorId    the picked contact (ContactSelectedChain: id and name)
  //   location       a typed address clears the delivery point; it is found again on the way to Review
  //   customerQuery, contactQuery  the pickers' search text
  //   termsAccepted  the rental terms checkbox (not posted; the terms gate of the old cart)
  class setFieldChain extends ActionChain {
    async run(context, { field, value, checked }) {
      const { $page } = context;
      if (!field) {
        return;
      }
      if (field === 'customerQuery' || field === 'contactQuery') {
        $page.variables[field] = value == null ? '' : String(value);
        return;
      }
      if (field === 'termsAccepted') {
        $page.variables.termsAccepted = checked === true || checked === 'true';
        if ($page.variables.missing && $page.variables.missing.length) {
          $page.variables.missing = [];
        }
        return;
      }
      const form = Object.assign({}, $page.variables.form || {});
      const v = value == null ? '' : String(value);

      if (field === 'customerRefId') {
        const c = ($page.variables.customers || []).find((o) => String(o.id) === v);
        const changed = String(form.customerRefId == null ? '' : form.customerRefId) !== String(c ? c.id : '');
        form.customerRefId = c ? Number(c.id) : null;
        form.customerName = c ? (c.customerName || '') : '';
        $page.variables.form = form;
        $page.variables.customerQuery = '';
        $page.variables.missing = [];
        if (changed && form.customerRefId != null) {
          await Actions.callChain(context, { chain: 'loadCatalogChain' });
        }
        return;
      }
      if (field === 'requestorId') {
        const u = ($page.variables.contacts || []).find((o) => String(o.id) === v);
        form.requestorId = u ? Number(u.id) : null;
        form.requestorName = u ? (u.contactName || '') : '';
        $page.variables.contactQuery = '';
      } else if (field === 'location') {
        form.location = v;
        form.locationLatitude = null;
        form.locationLongitude = null;
      } else {
        form[field] = v;
      }
      $page.variables.form = form;
      if ($page.variables.missing && $page.variables.missing.length) {
        $page.variables.missing = [];
      }

      if (field === 'startDate' || field === 'endDate') {
        await Actions.callChain(context, { chain: 'loadCatalogChain' });
      }
    }
  }

  return setFieldChain;
});
