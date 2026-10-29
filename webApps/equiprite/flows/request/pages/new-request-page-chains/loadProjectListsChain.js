define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/bipLov',
  'resources/js/projectTaskTree',
  'resources/js/projectBusinessUnit',
], (ActionChain, Actions, bipLov, projectTaskTree, projectBusinessUnit) => {
  'use strict';

  // The lists that hang off the chosen project, fetched together as the old CaptureProjectNameChain does:
  //   tasks      Fusion projects/{id}/child/Tasks, chargeable leaves only (projectTaskTree; a summary task
  //              cannot take cost)
  //   contracts  BIP EQP_CONTRACTS_BY_PROJECT_LOV_RP
  //   business unit  projects/{id} (projectBusinessUnit), posted as PROJECT_BU_ID / PROJECT_BU_NAME
  // A reopened draft that already has a contract also gets that contract's sites.
  class loadProjectListsChain extends ActionChain {
    async run(context, { withBusinessUnit }) {
      const { $page } = context;
      const projectId = ($page.variables.form || {}).projectId;
      if (!projectId) {
        return;
      }
      $page.variables.tasksLoading = true;
      $page.variables.contractsLoading = true;

      const tasks = Actions.callRest(context, {
        endpoint: 'ProjectLOV/getFscmRestApiResources11_13_18_05ProjectTasks',
        uriParams: { ProjectId: projectId, fields: 'TaskId,TaskNumber,TaskName,ParentTaskId', limit: 500, onlyData: true, totalResults: false },
      }).then((res) => {
        if (!res || !res.ok || !res.body) return [];
        return projectTaskTree.leafTasks(res.body, projectTaskTree.buildTaskTree(res.body));
      }).catch((e) => { console.warn('[loadProjectListsChain] tasks', e); return []; });

      const contracts = Actions.callRest(context, {
        endpoint: 'bipService/runBIPReport',
        body: bipLov.buildSoapBody('/Custom/EquipRite/EQP_CONTRACTS_BY_PROJECT_LOV_RP.xdo', [{ name: 'P_PROJECT_ID', value: projectId }]),
      }).then((res) => bipLov.decodeReportRows(res && res.body, 'G_1', 'CONTRACT_ID', 'CONTRACT_NUMBER', 'STATUS'))
        .catch((e) => { console.warn('[loadProjectListsChain] contracts', e); return []; });

      const bu = withBusinessUnit ? projectBusinessUnit.fetchForProject(context, Actions, projectId) : Promise.resolve(null);

      const [taskRows, contractRows, unit] = await Promise.all([tasks, contracts, bu]);
      // The user may have picked another project while these were loading.
      if (String(($page.variables.form || {}).projectId) !== String(projectId)) {
        return;
      }
      $page.variables.taskOptions = taskRows;
      $page.variables.contractOptions = contractRows;
      $page.variables.tasksLoading = false;
      $page.variables.contractsLoading = false;
      if (unit && unit.name) {
        $page.variables.form = Object.assign({}, $page.variables.form, { projectBuId: unit.id, projectBuName: unit.name });
      }
      if (($page.variables.form || {}).contractId != null) {
        await Actions.callChain(context, { chain: 'loadSitesChain' });
      }
    }
  }

  return loadProjectListsChain;
});
