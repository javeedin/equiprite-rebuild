define([
  'vb/action/actionChain',
  'vb/action/actions',
  'vb/action/actionUtils',
  'resources/js/requestDetailLines',
  'resources/js/projectTaskTree',
], (ActionChain, Actions, _au, rdl, projectTaskTree) => {
  'use strict';

  // Toast helper — the shell's notification data-provider can fail with
  // "valid payload was not provided" depending on shell config, and a failed
  // toast must never break the save. Same swallow-as-warning pattern as
  // ActionChain.safeNotify.
  async function safeNotify(context, payload) {
    try {
      await Actions.fireNotificationEvent(context, payload);
    } catch (e) {
      console.warn('[AssignProjectChain] toast failed — continuing:', e);
    }
  }

  /**
   * Commit the project/task staged in the Assign Project drawer onto the
   * request HEADER (EQR_EQUIPMENT_REQUEST).
   *
   * The columns already exist and are NULL on every customer-raised request:
   * PROJECT_REF_ID / TASK_ID plus the denormalized PROJECT_NAME /
   * PROJECT_NUMBER / TASK_NAME / TASK_NUMBER. We write the ids AND the names
   * because every read path on this page (workbench-requests, the workbench
   * grid) surfaces the names, not the ids — writing ids alone would leave the
   * UI showing a blank project until someone re-derived them from Fusion.
   *
   * Deliberately does NOT touch the request's source/origin: assigning a
   * project is internal cost attribution, and the request stays CUSTOMER-
   * sourced (it is still billed to the customer). Flipping it would silently
   * re-route quoting, the PR drawer's project panel, and billing.
   */
  class AssignProjectChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const requestId = $page.variables.requestId;
      if (!requestId) {
        console.warn('[AssignProjectChain] no requestId in page variables');
        return;
      }

      // ── Re-check the gates authoritatively ─────────────────────────────
      // The button already enforces all of these, but the drawer can be open
      // across a refresh that allocates a line, so the state it was opened
      // under may no longer hold. Never trust the button alone for a write.
      //
      // The feature flag is checked first: with EXTERNAL_PROJECT_ASSIGN_ENABLED
      // off, no project should ever be written to a request.
      if (!$page.variables.externalProjectAssignEnabled) {
        console.warn('[AssignProjectChain] refusing to assign — EXTERNAL_PROJECT_ASSIGN_ENABLED is off');
        $page.variables.isAssignProjectOpen = false;
        return;
      }

      const fd = $page.variables.formData || {};
      // Origin is 'EXTERNAL' | 'INTERNAL' (was 'CUSTOMER' | 'PROJECT') — resolved
      // through the app-flow owner, which accepts both spellings.
      const isCustomer = context.$application.functions.isExternalSource(fd.source);
      if (!isCustomer) {
        console.warn('[AssignProjectChain] refusing to assign a project to a non-external request');
        $page.variables.isAssignProjectOpen = false;
        return;
      }

      const lines = $page.variables.linesArray || [];
      const anyAllocated = lines.some(
        l => String((l || {}).alloc_status || '').toUpperCase() === 'ALLOCATED'
      );
      if (anyAllocated) {
        await safeNotify(context, {
          summary: 'Project locked',
          message: 'This request already has allocated lines — the project can no longer be changed.',
          type:    'warning'
        });
        $page.variables.isAssignProjectOpen = false;
        return;
      }

      // ── Validate the staged selection ──────────────────────────────────
      // Project AND task are both required: confirm is gated on both, so
      // saving a project without a task would leave the request in a state
      // that still can't be confirmed with nothing on screen explaining why.
      const projectId = $page.variables.assignProjectId;
      const taskId    = $page.variables.assignTaskId;
      if (projectId == null || taskId == null) {
        await safeNotify(context, {
          summary: 'Project and Task required',
          message: 'Select both a project and a task before saving.',
          type:    'error'
        });
        return;
      }

      // A summary task cannot take cost in PPM. AssignTaskSelectedChain already
      // refuses to stage one, but this is the write — and TASK_NUMBER written
      // here is copied to EQP_POSTCOST.PPM_TASK_NUMBER and sent as the OIC
      // `taskNumber`, so a bad value survives long past this page. Same
      // never-trust-the-form rule as the gates above. Fails open when the tree
      // never loaded (see LoadTaskTreeChain).
      if (projectTaskTree.isSummaryTask({ TaskId: taskId }, $page.variables.assignTaskTree)) {
        await safeNotify(context, {
          summary: 'Summary task cannot take cost',
          message: 'Select a task at the lowest level of the project breakdown.',
          type:    'error'
        });
        return;
      }

      // Names/numbers are captured off the picked LOV rows by
      // AssignProjectSelectedChain / AssignTaskSelectedChain — neither
      // component's `value` carries them.
      const projectName   = $page.variables.assignProjectName   || null;
      const projectNumber = $page.variables.assignProjectNumber || null;
      const taskName      = $page.variables.assignTaskName      || null;
      const taskNumber    = $page.variables.assignTaskNumber    || null;
      // Fusion business unit of the project being assigned — staged by
      // AssignProjectSelectedChain, which fetches it from projects/{ProjectId}
      // because the LOV row does not carry it.
      const projectBuId   = $page.variables.assignProjectBuId != null
        ? Number($page.variables.assignProjectBuId) : null;
      const projectBuName = $page.variables.assignProjectBuName || null;

      $page.variables.assignProjectSaving = true;

      let resp;
      try {
        // PATCH accepts a free-form object (openapi3.json patchEquipmentRequest)
        // and VB's callRest passes a POST/PATCH body through as-is, so these
        // fields reach the backend without an openapi3.json change. The DTO
        // declares projectRefId/taskId; the denormalized name/number columns
        // exist on EQR_EQUIPMENT_REQUEST.
        resp = await Actions.callRest(context, {
          endpoint:  'eqp-v1/patchEquipmentRequest',
          uriParams: { id: Number(requestId) },
          body: {
            projectRefId:  Number(projectId),
            taskId:        Number(taskId),
            projectName:   projectName,
            projectNumber: projectNumber,
            taskName:      taskName,
            taskNumber:    taskNumber,
            // PROJECT_BU_ID / PROJECT_BU_NAME. Unlike the name/number columns
            // beside them these ARE declared on the served EquipmentRequestDto
            // and were exercised live over PATCH, so they persist by the DTO
            // rather than by passthrough. Assigning a project here has to set
            // the BU for the same reason creating one does — otherwise a
            // request that gets its project late posts with no business unit.
            projectBuId:   projectBuId,
            projectBuName: projectBuName
          }
        });
      } catch (e) {
        console.warn('[AssignProjectChain] PATCH threw:', e);
        resp = null;
      } finally {
        $page.variables.assignProjectSaving = false;
      }

      if (!resp || !resp.ok) {
        const status = resp ? resp.status : 'no response';
        console.warn('[AssignProjectChain] failed to assign project:', status, resp && resp.body);
        await safeNotify(context, {
          summary:     'Assign Project failed',
          message:     'The project could not be assigned (' + status + '). Please try again.',
          type:        'error',
          displayMode: 'persist'
        });
        return;
      }

      $page.variables.isAssignProjectOpen = false;

      // ── Re-read from the server ────────────────────────────────────────
      // Re-fetching (rather than patching page state by hand) is what makes
      // the Confirm gate correct: hasAssignedProject reads project_ref_id /
      // task_id off the LINE rows, and only request-detail-lines returns those
      // ids. applyLines also re-runs updateActionButtons, so Confirm unlocks
      // in the same tick the project lands.
      const linesResult = await rdl.fetchAndBuild(
        context, Actions, requestId, $page.variables.selectedYard
      );
      if (linesResult && linesResult.ok) {
        rdl.applyLines($page, linesResult.lines);
      }

      // Keep the header banner in step — it renders the project name, and the
      // workbench-requests row behind formData wasn't re-read here.
      $page.variables.formData = {
        ...$page.variables.formData,
        project_customer: projectName || $page.variables.formData.project_customer,
        task:             taskName    || $page.variables.formData.task
      };

      if ($page.functions && typeof $page.functions.updateActionButtons === 'function') {
        $page.functions.updateActionButtons($page);
      }

      await safeNotify(context, {
        summary: 'Project assigned',
        message: 'Assigned to ' + (projectName || projectId) +
                 ' / ' + (taskName || taskId) + '.',
        type:    'confirmation'
      });
    }
  }

  return AssignProjectChain;
});
