define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/rateRules',
], (ActionChain, Actions, R) => {
  'use strict';

  // Opens one schedule on the right, or a new one (id 'new'): New EquipRite's selectScheduleChain (the old
  // create-rate-schedule vbEnterChain), call for call:
  //   edit   GET /rate-schedules/{id}; the project and task names from ProjectLOV when the record lacks them;
  //          GET /rate-period-lines?rateScheduleId=, kept only for this schedule, mapped (rateRules.lineFromRecord)
  //          and sorted Class -> Subclass -> Equipment
  //   create the old empty formData, no lines
  // then loadYardsChain, and the customer's name from ShippingCustomersLOV by CustomerId.
  // Unsaved changes on the schedule being left are asked about first (the page's question card).
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
      v.saveNote = '';
      v.exportOpen = '';
      v.selectedId = String(target);
      v.dirty = false;
      v.headerOpen = target === 'new';
      v.addRowOpen = false;
      v.customerResults = [];
      v.projectResults = [];
      v.taskOptions = [];
      v.simGroup = '';

      if (target === 'new') {
        v.formData = R.emptyForm();
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
        if (!schedResp || !schedResp.ok) {
          v.detailError = 'This rate schedule could not be loaded (HTTP ' + (schedResp && schedResp.status) + ').';
          v.formData = {};
          v.lines = [];
          return;
        }
        const body = schedResp.body || {};

        let projectName = body.projectName || null;
        let taskName    = body.taskName    || null;
        if (!projectName && body.projectRefId) {
          const projResp = await Actions.callRest(context, {
            endpoint: 'ProjectLOV/getFscmRestApiResources11_13_18_05ProjectsLOV',
            uriParams: { q: 'ProjectId=' + body.projectRefId, limit: 1 },
          });
          const projItem = projResp && projResp.ok && projResp.body && projResp.body.items && projResp.body.items[0];
          if (projItem) projectName = projItem.ProjectName || null;
        }
        if (!taskName && body.taskRefId) {
          const taskResp = await Actions.callRest(context, {
            endpoint: 'ProjectLOV/getFscmRestApiResources11_13_18_05ProjectTasksLOV',
            uriParams: { q: 'TaskId=' + body.taskRefId, limit: 1 },
          });
          const taskItem = taskResp && taskResp.ok && taskResp.body && taskResp.body.items && taskResp.body.items[0];
          if (taskItem) taskName = taskItem.TaskName || null;
        }

        v.formData = R.formFromSchedule(body, projectName, taskName);

        const linesResp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getRatePeriodLines',
          uriParams: { rateScheduleId: Number(target) },
        });
        const rawLines = (linesResp && linesResp.ok && linesResp.body && linesResp.body.data) ? linesResp.body.data : [];
        const mapped = rawLines.filter((line) => line.rateScheduleId === Number(target)).map(R.lineFromRecord);
        let ordered = mapped;
        try {
          ordered = R.sortLines(mapped);
        } catch (e) {
          console.error('Schedule line sort failed: showing unsorted', e);
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
