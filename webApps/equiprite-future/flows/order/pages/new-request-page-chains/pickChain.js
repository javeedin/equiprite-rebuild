define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // A search result was picked (index into projectResults / customerResults), or cleared (index -1). As New
  // EquipRite's pickChain:
  //   project   writes id, number and name and clears the task, contract and contract site, then loads the
  //             project's tasks, contracts and business unit (CaptureProjectNameChain)
  //   customer  the Fusion CustomerId and name of the project's customer (CaptureFallbackCustomerChain)
  // Next also asks the catalog again when the project changes, so the list and the cart show this project's rates
  // straight away rather than only on Review; and Change shows the list from the report again.
  class pickChain extends ActionChain {
    async run(context, { kind, index }) {
      const { $page } = context;
      const i = Number(index);
      const list = $page.variables[kind + 'Results'] || [];
      const row = i >= 0 ? list[i] : null;
      if (i >= 0 && !row) {
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
        // Change: the list again, to pick another.
        if (!row) await Actions.callChain(context, { chain: 'searchChain', params: { kind: 'customer', text: '' } });
        return;
      }
      if (kind !== 'project') {
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
      if ($page.variables.missing && $page.variables.missing.length) {
        $page.variables.missing = [];
      }
      const lists = row ? Actions.callChain(context, { chain: 'loadProjectListsChain', params: { withBusinessUnit: true } })
        : Actions.callChain(context, { chain: 'searchChain', params: { kind: 'project', text: '' } });
      const prices = String(before == null ? '' : before) !== String(form.projectId == null ? '' : form.projectId)
        ? Actions.callChain(context, { chain: 'loadCatalogChain' }) : null;
      await Promise.all([lists, prices]);
    }
  }

  return pickChain;
});
