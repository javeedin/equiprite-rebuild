define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // One field of the form changed (inputs carry data-field). The side effects are the old create page's:
  //   dates     reload the catalog, so availability, estimates and cart prices follow the new window
  //   task      keeps number and name with the id (TaskSelectedChain)
  //   contract  clears a contract site and loads that contract's ship-to sites (CaptureContractChain)
  //   site      the picked site's address is the delivery location (CaptureShipToSiteChain)
  //   locationType  switching between a contract site and a typed address clears the address
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

      if (field === 'taskId') {
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
      } else if (field === 'locationType') {
        if (form.locationType !== v) {
          form.location = '';
          form.locationLatitude = null;
          form.locationLongitude = null;
        }
        form.locationType = v || 'DELIVERY_LOCATION';
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
