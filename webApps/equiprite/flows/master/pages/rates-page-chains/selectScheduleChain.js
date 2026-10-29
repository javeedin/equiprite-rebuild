define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Opens one schedule on the right, or a new one (id 'new'). The old create-rate-schedule-page-chains/
  // vbEnterChain.js, call for call:
  //   edit   GET /rate-schedules/{id}; the project and task names from ProjectLOV when the record lacks them;
  //          GET /rate-period-lines?rateScheduleId=, kept only for this schedule, mapped and sorted
  //          Class -> Subclass -> Equipment exactly as the old chain maps them
  //   create the old empty formData, no lines
  // then the old LoadYardsChain (loadYardsChain here). One read the old page made through its customer picker:
  // the customer's name, from ShippingCustomersLOV by CustomerId.
  //
  // Unsaved changes on the schedule being left are asked about first (the page's question card). The old page
  // sent the ProjectLOV look-ups as queryParams; here they are uriParams, which VB sends as the same query string.

  class selectScheduleChain extends ActionChain {
    async run(context, { id, confirmed }) {
      const { $page } = context;
      const v = $page.variables;
      const target = id === 'new' ? 'new' : (Number(id) || null);
      if (!target) return;
      if (v.dirty && !confirmed) {
        v.ask = { kind: 'select', target: target, title: 'Leave this schedule without saving?',
          message: 'Your changes to ' + (v.formData.scheduleName || 'this schedule') + ' are not saved. They will be lost.',
          ok: 'Discard changes' };
        return;
      }
      v.ask = null;
      v.detailError = '';
      v.lineError = '';
      v.selectedId = String(target);
      v.dirty = false;
      v.headerOpen = target === 'new';
      v.addRowOpen = false;
      v.customerResults = [];
      v.projectResults = [];
      v.taskOptions = [];

      if (target === 'new') {
        // ── Create mode (old vbEnterChain) ─────────────────────────────
        v.formData = {
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
        v.lines = [];
        await Actions.callChain(context, { chain: 'loadYardsChain' });
        return;
      }

      v.detailLoading = true;
      try {
        const schedResp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getRateScheduleById',
          uriParams: { id: Number(target) },
        });
        if (!schedResp.ok) {
          v.detailError = 'This rate schedule could not be loaded (HTTP ' + schedResp.status + ').';
          v.formData = {};
          v.lines = [];
          return;
        }
        const body = schedResp.body;

        let projectName = body.projectName || null;
        let taskName    = body.taskName    || null;
        if (!projectName && body.projectRefId) {
          const projResp = await Actions.callRest(context, {
            endpoint: 'ProjectLOV/getFscmRestApiResources11_13_18_05ProjectsLOV',
            uriParams: { q: 'ProjectId=' + body.projectRefId, limit: 1 },
          });
          const projItem = projResp.ok && projResp.body.items && projResp.body.items[0];
          if (projItem) projectName = projItem.ProjectName || null;
        }
        if (!taskName && body.taskRefId) {
          const taskResp = await Actions.callRest(context, {
            endpoint: 'ProjectLOV/getFscmRestApiResources11_13_18_05ProjectTasksLOV',
            uriParams: { q: 'TaskId=' + body.taskRefId, limit: 1 },
          });
          const taskItem = taskResp.ok && taskResp.body.items && taskResp.body.items[0];
          if (taskItem) taskName = taskItem.TaskName || null;
        }

        v.formData = {
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

        const linesResp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getRatePeriodLines',
          uriParams: { rateScheduleId: Number(target) },
        });
        const rawLines = (linesResp.ok && linesResp.body.data) ? linesResp.body.data : [];
        const filteredLines = rawLines.filter(line => line.rateScheduleId === Number(target));
        const mappedLines = filteredLines.map(line => ({
          id:                  line.id,
          objectVersionNumber: line.objectVersionNumber || 1,
          periodSeq:           line.periodSeq,
          classId:      line.equipmentClassId || null,
          subclassId:   line.equipmentSubclassId || null,
          className:     line.equipmentClassName    || '',
          subclassName:  line.equipmentSubclassName || '',
          equipmentName: line.equipmentName         || '',
          calcBasis:     line.calcBasis || 'DAILY',
          calcMethod:    line.calcMethod || 'UTILIZED_DURATION',
          rateType:     line.rateType || 'USAGE',
          period:        line.periodType || line.rateUom || 'HOURLY',
          threshold:     line.fromUnit || 0,
          periodAmount:  line.periodAmount != null ? Number(line.periodAmount) : null,
          periodDivisor: line.periodDivisor != null ? Number(line.periodDivisor) : null,
          costRate:      line.costRate || 0,
          billRate:      line.billRate || line.rateAmount || 0,
          location:      line.location || '',
          startDate:     line.effectiveFrom ? line.effectiveFrom.slice(0, 10) : '',
          endDate:       line.effectiveTo ? line.effectiveTo.slice(0, 10) : '',
        }));
        let ordered = mappedLines;
        try {
          ordered = $page.functions.sortLines(mappedLines);
        } catch (e) {
          console.error('Schedule line sort failed — showing unsorted', e);
        }
        v.lines = ordered;

        await Promise.all([
          Actions.callChain(context, { chain: 'loadYardsChain' }),
          this.customerName(context, v.formData.customerId),
        ]);
      } finally {
        v.detailLoading = false;
      }
    }

    async customerName(context, customerId) {
      if (customerId == null) return;
      try {
        const r = await Actions.callRest(context, {
          endpoint: 'ProjectLOV/getFscmRestApiResources11_13_18_05ShippingCustomersLOV',
          uriParams: { q: 'CustomerId=' + customerId, limit: 1 },
        });
        const item = r && r.ok && r.body && r.body.items && r.body.items[0];
        if (item) {
          context.$page.variables.formData = Object.assign({}, context.$page.variables.formData, { customerName: item.Customer || null });
        }
      } catch (e) { /* the id still shows */ }
    }
  }

  return selectScheduleChain;
});
