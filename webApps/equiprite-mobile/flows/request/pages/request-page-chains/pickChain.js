define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // A search result was picked in its sheet (index into projectResults / customerResults), or cleared (index -1). As
  // Next's pickChain (New EquipRite's):
  //   project   writes id, number and name and clears the task, contract and contract site, then loads the
  //             project's tasks, contracts and business unit (CaptureProjectNameChain)
  //   customer  the Fusion CustomerId and name of the project's customer (CaptureFallbackCustomerChain)
  // The catalog is asked again when the project changes, so the cards and the cart show this project's rates
  // straight away (Next). On a phone the sheet closes once picked, and the phone keeps the form (keepChain).
  class pickChain extends ActionChain {
    async run(context, { kind, index }) {
      const { $page } = context;
      const i = Number(index);
      const list = $page.variables[kind + 'Results'] || [];
      const row = i >= 0 ? list[i] : null;
      if (i >= 0 && !row) {
        return;
      }
      if (kind !== 'customer' && kind !== 'project') {
        return;
      }
      const form = Object.assign({}, $page.variables.form || {});
      $page.variables.saveError = '';

      if (kind === 'customer') {
        form.customerId = row ? row.id : null;
        form.customerName = row ? (row.label || '') : '';
        $page.variables.form = form;
        $page.variables.customerResults = [];
        $page.variables.customerQuery = '';
        if (row) $page.variables.sheet = '';
        if ($page.variables.missing && $page.variables.missing.length) {
          $page.variables.missing = [];
        }
        await Actions.callChain(context, { chain: 'keepChain' });
        // Change: the list again, to pick another.
        if (!row) await Actions.callChain(context, { chain: 'searchChain', params: { kind: 'customer', text: '' } });
        return;
      }
      const before = form.projectId;
      form.projectId = row ? row.id : null;
      form.projectName = row ? (row.label || '') : '';
      form.projectNumber = row ? (row.sub || '') : '';
      form.projectBuId = null;
      form.projectBuName = '';
      form.taskId = null;
      form.taskNumber = '';
      form.taskName = '';
      form.contractId = null;
      form.contractNumber = '';
      if (form.locationType === 'PROJECT_SITE') {
        form.location = '';
        form.locationLatitude = null;
        form.locationLongitude = null;
      }
      $page.variables.form = form;
      $page.variables.projectResults = [];
      $page.variables.projectQuery = '';
      $page.variables.taskOptions = [];
      $page.variables.taskQuery = '';
      $page.variables.contractOptions = [];
      $page.variables.siteOptions = [];
      $page.variables.sitesLoaded = false;
      if (row) $page.variables.sheet = '';
      if ($page.variables.missing && $page.variables.missing.length) {
        $page.variables.missing = [];
      }
      await Actions.callChain(context, { chain: 'keepChain' });
      const lists = row ? Actions.callChain(context, { chain: 'loadProjectListsChain', params: { withBusinessUnit: true } })
        : Actions.callChain(context, { chain: 'searchChain', params: { kind: 'project', text: '' } });
      const prices = String(before == null ? '' : before) !== String(form.projectId == null ? '' : form.projectId)
        ? Actions.callChain(context, { chain: 'loadCatalogChain' }) : null;
      await Promise.all([lists, prices]);
    }
  }

  return pickChain;
});
