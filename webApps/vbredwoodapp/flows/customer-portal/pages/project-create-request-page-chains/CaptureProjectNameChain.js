define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/projectBusinessUnit',
], (ActionChain, Actions, projectBusinessUnit) => {
  'use strict';

  class CaptureProjectNameChain extends ActionChain {
    async run(context, { data, updatedFrom } = {}) {
      const { $page, $flow } = context;
      // The Project oj-select-single's value-item is bound ONE-WAY from the
      // request's project fields, so any chain writing them fires
      // value-item-changed with updatedFrom 'external'. Only a user pick or
      // clear ('internal') is a new selection — re-running here would wipe the
      // task and re-fetch the BU for a project that did not change.
      if (updatedFrom === 'external') return;
      const name   = data ? (data.ProjectName   || '') : '';
      const number = data ? (data.ProjectNumber || '') : '';
      const id     = data ? (data.ProjectId     || null) : null;

      $page.variables.selectedProjectName = name;

      // Deep-set request fields — NEVER reassign $flow.variables.request wholesale (that broke
      // the project input-search's two-way binding and the task reload in an earlier attempt).
      $flow.variables.request.projectId     = id;
      $flow.variables.request.projectName   = name;
      $flow.variables.request.projectNumber = number;
      // The project's Fusion BUSINESS UNIT. Cleared here and re-fetched below,
      // because it belongs to the project that is being replaced — carrying the
      // old project's BU forward would post cost against the wrong one, which
      // is worse than posting none. Same reasoning as the task reset below.
      //
      // It is not on the picked row: projectsSDP requests only
      // ProjectId,ProjectNumber,ProjectName and projectsLOV does not expose
      // BusinessUnit at all, so it takes its own call — see
      // resources/js/projectBusinessUnit.js.
      $flow.variables.request.projectBuId   = null;
      $flow.variables.request.projectBuName = '';
      // Clear the task selection when the project changes — a task belongs to
      // exactly one project, so carrying one across would be wrong.
      //
      // The CUSTOMER is deliberately NOT cleared here. It used to be, grouped in
      // with the genuinely project-dependent fields below, but nothing about it
      // depends on the project: customerSDP queries Fusion ShippingCustomersLOV
      // with only the typed search text (no ProjectId), so the list is identical
      // whichever project is picked. Worse, the Customer field sits one ROW ABOVE
      // Project in the form, so clearing it wiped the field the user had just
      // filled in. Leaving it also keeps customerFilterId / filteredAgreementsArray
      // (which scope the Rental Agreement LOV) consistent with what is on screen —
      // this chain never reset those, so clearing the customer left the agreement
      // list still filtered to an invisible one.
      $flow.variables.request.taskId        = null;
      $flow.variables.request.taskName      = '';
      $flow.variables.request.taskNumber    = '';
      $page.variables.selectedTaskName      = '';
      // No task filter to reset: the Task oj-select-single's search text lives in
      // the component's own dropdown filter field and is cleared when the dropdown
      // closes — it is now matched locally against tasksDp's rows, not translated
      // to a Fusion q=. The task list itself does NOT reload on its own: tasksDp is
      // a plain provider with no ProjectId binding to react to (the SDP it replaced
      // re-fetched off its ProjectId path parameter). LoadTaskTreeChain below is
      // what replaces it — without that call the dropdown would keep listing the
      // OLD project's tasks.

      // Clear dependent Contract + Ship-to-Site selections. Reassign .data
      // to a new array (never `.data.length = 0` — that throws through VBCS's
      // Actions.assignVariable machinery on a $page.variables-nested array; see
      // LoadContractsChain.js for the full explanation).
      // Ship-to sites hang off project+contract, and the contract is being
      // cleared here, so the site list must go with it.
      $page.variables.selectedContractId  = null;
      $page.variables.selectedContractObj = null;
      // The contract is project-scoped, so the flow-model copy must be cleared
      // with the page one — otherwise the OLD project's contract id/number would
      // be submitted against the NEW project. (The CUSTOMER above is
      // deliberately NOT cleared — it does not depend on the project; see the
      // comment block higher up.)
      $flow.variables.request.contractId     = null;
      $flow.variables.request.contractNumber = '';
      $page.variables.shipToSitesAdp.data = [];
      // Back to "no contract chosen", so the Delivery Location placeholder must
      // revert to 'Choose a Contract' rather than keep claiming 'No Location
      // Found' from the previous project's lookup.
      $page.variables.shipToSitesLoaded   = false;

      // Reload Contract for the new project — see LoadContractsChain. Plain page
      // component (no oj-vb-fragment), data updated in place: no flicker.
      //
      // Repopulate the Task list alongside it. CONCURRENTLY, not in sequence:
      // both are independent Fusion round-trips on the same project id, and
      // running them back to back made the user wait out the contracts fetch
      // before the task fetch had even started. Each chain owns its own
      // variables and its own try/catch, so neither can be left half-applied by
      // the other failing.
      //
      // The business-unit lookup joins them for the same reason: a third
      // independent Fusion round-trip on the same project id, with its own
      // try/catch inside the helper, so it cannot leave the other two
      // half-applied and cannot fail the pick. Nothing on screen waits on it —
      // the BU is not rendered, it is only carried to submit — so a slow
      // response costs nothing here.
      const [, , bu] = await Promise.all([
        Actions.callChain(context, { chain: 'LoadContractsChain' }),
        Actions.callChain(context, { chain: 'LoadTaskTreeChain' }),
        projectBusinessUnit.fetchForProject(context, Actions, id)
      ]);

      // Guard against a slow lookup landing after the user has already moved to
      // another project: only apply it if the pick it belongs to is still the
      // current one. Without this, two quick picks can resolve out of order and
      // stamp the first project's BU onto the second.
      if (bu && $flow.variables.request.projectId === id) {
        $flow.variables.request.projectBuId   = bu.id;
        $flow.variables.request.projectBuName = bu.name;
      }
    }
  }

  return CaptureProjectNameChain;
});
