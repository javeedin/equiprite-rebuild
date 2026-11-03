define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/orderForm',
], (ActionChain, Actions, order) => {
  'use strict';

  // One field of the form changed (inputs and buttons carry data-field). The side effects are New EquipRite's
  // setFieldChain, which are the old create page's:
  //   dates     reload the catalog, so availability, estimates and cart prices follow the new window
  //   length    a quick length (1, 2 or 4 weeks) sets the end date from the start date, then as dates
  //   task      keeps number and name with the id (TaskSelectedChain)
  //   contract  clears a contract site and loads that contract's ship-to sites (CaptureContractChain)
  //   site      the picked site's address is the delivery location (CaptureShipToSiteChain)
  //   locationType  switching between a contract site and a typed address clears the address
  //   requestFor    project, or customer (raised in New EquipRite)
  //   requestType   the project is for an INTERNAL or an EXTERNAL customer
  //   termsAccepted the rental terms ticked (an external customer's request; not posted)
  const NUMERIC = { hours: true };

  class setFieldChain extends ActionChain {
    async run(context, { field, value, from }) {
      const { $page } = context;
      // from: an oj-text-area's updatedFrom. Only what the user typed counts, not the page setting the value.
      if (!field || (from && from !== 'internal')) {
        return;
      }
      if (field === 'requestFor') {
        $page.variables.requestFor = value === 'customer' ? 'customer' : 'project';
        $page.variables.missing = [];
        return;
      }
      // Who the project is for (Old's Customer Type): INTERNAL (a Fusion customer) or EXTERNAL (EquipRite's customer and
      // their contact; sent straight to the Equipment Manager, with the rental terms). The other side's choice is kept,
      // so switching back and forth loses nothing; only the chosen side is posted.
      if (field === 'requestType') {
        if (!$page.variables.canCustomer && value === 'EXTERNAL') return;
        const f = Object.assign({}, $page.variables.form || {}, { requestType: value === 'EXTERNAL' ? 'EXTERNAL' : 'INTERNAL' });
        $page.variables.form = f;
        $page.variables.missing = [];
        $page.variables.termsAccepted = false;
        if (f.requestType === 'EXTERNAL') {
          if (f.customerRefId == null) Actions.callChain(context, { chain: 'searchChain', params: { kind: 'extCustomer', text: '' } });
          if (f.contactId == null) Actions.callChain(context, { chain: 'searchChain', params: { kind: 'contact', text: '' } });
        } else if (f.customerId == null || f.customerId === '') {
          Actions.callChain(context, { chain: 'searchChain', params: { kind: 'customer', text: '' } });
        }
        return;
      }
      if (field === 'termsAccepted') {
        $page.variables.termsAccepted = value === true || value === 'true';
        if ($page.variables.termsAccepted && ($page.variables.missing || []).indexOf('Accept the rental terms') !== -1) $page.variables.missing = [];
        return;
      }
      if (field === 'taskQuery') {
        $page.variables.taskQuery = value == null ? '' : String(value);
        return;
      }
      const form = Object.assign({}, $page.variables.form || {});
      let v = value == null ? '' : String(value);
      if (NUMERIC[field]) {
        v = v === '' || isNaN(Number(v)) ? null : Number(v);
      }

      if (field === 'length') {
        const end = order.endAfter(form.startDate, v);
        if (!end) {
          return;
        }
        form.endDate = end;
      } else if (field === 'taskId') {
        const t = ($page.variables.taskOptions || []).find((o) => String(o.TaskId) === v);
        form.taskId = t ? t.TaskId : null;
        form.taskNumber = t ? (t.TaskNumber || '') : '';
        form.taskName = t ? (t.TaskName || '') : '';
      } else if (field === 'contractId') {
        const c = ($page.variables.contractOptions || []).find((o) => String(o.id) === v);
        const changed = String(form.contractId == null ? '' : form.contractId) !== String(c ? c.id : '');
        form.contractId = c ? c.id : null;
        form.contractNumber = c ? (c.label || '') : '';
        if (changed && form.locationType === 'PROJECT_SITE') {
          form.location = '';
          form.locationLatitude = null;
          form.locationLongitude = null;
          form.locationPinned = false;
        }
        $page.variables.form = form;
        if (changed) {
          await Actions.callChain(context, { chain: 'loadSitesChain' });
        }
        return;
      } else if (field === 'siteAddress') {
        form.location = v;
        form.locationLatitude = null;
        form.locationLongitude = null;
        form.locationPinned = false;
      } else if (field === 'locationType') {
        if (form.locationType !== v) {
          form.location = '';
          form.locationLatitude = null;
          form.locationLongitude = null;
          form.locationPinned = false;
        }
        form.locationType = v || 'DELIVERY_LOCATION';
      } else if (field === 'location') {
        form.location = v;
        form.locationLatitude = null;
        form.locationLongitude = null;
        form.locationPinned = false;
      } else {
        form[field] = v;
      }
      $page.variables.form = form;
      if ($page.variables.missing && $page.variables.missing.length) {
        $page.variables.missing = [];
      }
      $page.variables.saveError = '';

      if (field === 'startDate' || field === 'endDate' || field === 'length') {
        await Actions.callChain(context, { chain: 'loadCatalogChain' });
      }
    }
  }

  return setFieldChain;
});
