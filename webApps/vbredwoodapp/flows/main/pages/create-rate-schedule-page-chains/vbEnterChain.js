define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Schedule Line Summary display order: Class -> Subclass -> Equipment.
  // Deliberately defined LOCAL to this chain rather than called off
  // $page.functions: routing the sort through a newly-added page-module function
  // left the grid empty ("No items to display") while the header still
  // populated — the chain threw here and never reached the dataGridProvider
  // assignment at the end. Ordering is cosmetic, loading the rates is not, so
  // this must never be able to break the load.
  var compareLineText = function (a, b) {
    var left  = (a == null ? '' : String(a)).trim();
    var right = (b == null ? '' : String(b)).trim();
    if (left === right) return 0;
    if (left === '') return -1;   // blanks first: class-level line heads its group
    if (right === '') return 1;
    return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
  };

  var sortLines = function (lines) {
    return (lines || []).slice().sort(function (a, b) {
      return compareLineText(a.className, b.className)
        || compareLineText(a.subclassName, b.subclassName)
        || compareLineText(a.equipmentName, b.equipmentName);
    });
  };

  class vbEnterChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const scheduleId = $page.variables.scheduleId;

      // Customer LOV is a live Fusion ServiceDataProvider (fetches on demand).
      // The Yard LOV is loaded by LoadYardsChain (fired right after this chain)
      // straight from the BU & Org Mapping rows, orgRole=EQUIPMENT_YARD.

      if (scheduleId) {
        // ── Edit mode ──────────────────────────────────────────────────
        const schedResp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getRateScheduleById',
          uriParams: { id: Number(scheduleId) },
        });

        if (!schedResp.ok) {
          await Actions.fireNotificationEvent(context, {
            summary: 'Error',
            message: 'Failed to load rate schedule',
            displayMode: 'transient',
            type: 'error',
          });
          return;
        }

        const body = schedResp.body;

        // Resolve project/task display names when missing from the stored record
        let projectName = body.projectName || null;
        let taskName    = body.taskName    || null;

        if (!projectName && body.projectRefId) {
          const projResp = await Actions.callRest(context, {
            endpoint: 'ProjectLOV/getFscmRestApiResources11_13_18_05ProjectsLOV',
            queryParams: { q: 'ProjectId=' + body.projectRefId, limit: 1 },
          });
          const projItem = projResp.ok && projResp.body.items && projResp.body.items[0];
          if (projItem) projectName = projItem.ProjectName || null;
        }

        if (!taskName && body.taskRefId) {
          const taskResp = await Actions.callRest(context, {
            endpoint: 'ProjectLOV/getFscmRestApiResources11_13_18_05ProjectTasksLOV',
            uriParams: {},
            queryParams: { q: 'TaskId=' + body.taskRefId, limit: 1 },
          });
          const taskItem = taskResp.ok && taskResp.body.items && taskResp.body.items[0];
          if (taskItem) taskName = taskItem.TaskName || null;
        }

        $page.variables.formData = {
          scheduleName:   body.scheduleName || '',
          scheduleCode:   body.scheduleCode || '',
          equipmentClass: body.equipmentClassId ? String(body.equipmentClassId) : 'HEAVY',
          description:    body.description || '',
          customerId:     body.customerRefId ? Number(body.customerRefId) : null,
          customerName:   null,
          project:        '',
          task:           '',
          projectId:      body.projectRefId ? Number(body.projectRefId) : null,
          projectName:    projectName,
          taskId:         body.taskRefId    ? Number(body.taskRefId)    : null,
          taskName:       taskName,
          yardOrgId:      body.yardOrgId ? Number(body.yardOrgId) : null,
          yardOrgName:    null,
          currency:       body.currencyCode || 'USD',
          startDate:      body.effectiveFrom ? body.effectiveFrom.slice(0, 10) : '',
          endDate:        body.effectiveTo ? body.effectiveTo.slice(0, 10) : '',
          activeStatus:   body.isActiveFlag === 'Y',
        };

        // Yard display on edit is handled by LoadYardsChain (fired right after
        // this chain from the vbEnter listener): it loads every mapped
        // EQUIPMENT_YARD into yardOrgArray, and the Yard oj-select-single —
        // backed by that local ADP — resolves the saved value's label.

        const linesResp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getRatePeriodLines',
          uriParams: { rateScheduleId: Number(scheduleId) },
        });

        const rawLines = (linesResp.ok && linesResp.body.data) ? linesResp.body.data : [];
        const filteredLines = rawLines.filter(line => line.rateScheduleId === Number(scheduleId));

        const mappedLines = filteredLines.map(line => ({
          id:                  line.id,
          objectVersionNumber: line.objectVersionNumber || 1,
          periodSeq:           line.periodSeq,
          classId:      line.equipmentClassId || null,
          subclassId:   line.equipmentSubclassId || null,
          className:     line.equipmentClassName    || '',
          subclassName:  line.equipmentSubclassName || '',
          equipmentName: line.equipmentName         || '',
          // 'DAILY' not 'HOURLY': an HOURLY basis bills hours x the per-day
          // rate and re-denominates FROM_UNIT into hours. See
          // addScheduleLineChain for the measured numbers.
          calcBasis:     line.calcBasis || 'DAILY',
          calcMethod:    line.calcMethod || 'UTILIZED_DURATION',
          rateType:     line.rateType || 'USAGE',
          period:        line.periodType || line.rateUom || 'HOURLY',
          threshold:     line.fromUnit || 0,
          // Deliberately NOT defaulted to 0 or inferred here. Null means "no one
          // ever authored a total for this line" — true of the 73 pre-existing
          // rows — and the grid renders an inferred "≈" figure for those instead
          // of inventing an authoring intent nobody expressed. Until the backend
          // migration lands these are always null, so every line shows inferred.
          periodAmount:  line.periodAmount != null ? Number(line.periodAmount) : null,
          periodDivisor: line.periodDivisor != null ? Number(line.periodDivisor) : null,
          costRate:      line.costRate || 0,
          billRate:      line.billRate || line.rateAmount || 0,
          location:      line.location || '',
          startDate:     line.effectiveFrom ? line.effectiveFrom.slice(0, 10) : '',
          endDate:       line.effectiveTo ? line.effectiveTo.slice(0, 10) : '',
        }));

        // Sort for display, but never let ordering cost us the rates themselves.
        let orderedLines = mappedLines;
        try {
          orderedLines = sortLines(mappedLines);
        } catch (e) {
          console.error('Schedule line sort failed — showing unsorted', e);
        }
        $page.variables.equipmentLines = orderedLines;

      } else {
        // ── Create mode ────────────────────────────────────────────────
        $page.variables.formData = {
          scheduleName:   '',
          scheduleCode:   '',
          equipmentClass: 'HEAVY',
          description:    '',
          customerId:     null,
          customerName:   null,
          project:        '',
          task:           '',
          yardOrgId:      null,
          yardOrgName:    null,
          currency:       'USD',
          startDate:      '',
          endDate:        '',
          activeStatus:   true,
        };

        $page.variables.equipmentLines = [];
      }

      $page.variables.dataGridProvider = $page.functions.initGridData($page.variables.equipmentLines);
    }
  }

  return vbEnterChain;
});
