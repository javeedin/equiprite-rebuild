define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The schedule header (the old editor's Schedule Parameters): name, description, currency, dates, active, and
  // the tags (customer, project, task, yard). formData keeps the old editor's shape, so saveScheduleChain builds
  // the same body. Customer and project are searched in Fusion as the old pickers did ("<Field> LIKE '*text*'" on
  // ShippingCustomersLOV / ProjectsLOV); a project's tasks come from ProjectTasksLOV (q=ProjectId=). Picking a
  // project clears the task (old onProjectSelectedChain); clearing a tag clears its name with its id, so a stale
  // label can never be saved (the old save gates each name on its id too).
  const PAUSE_MS = 250;
  const typing = { customer: 0, project: 0 };

  class headerChain extends ActionChain {
    async run(context, { action, field, value, index }) {
      const { $page } = context;
      const v = $page.variables;
      const set = (patch) => { v.formData = Object.assign({}, v.formData, patch); v.dirty = true; };

      switch (action) {
        case 'toggle':
          v.headerOpen = !v.headerOpen;
          return;
        case 'field':
          if (field === 'activeStatus') { set({ activeStatus: value === true || value === 'true' }); return; }
          if (['scheduleName', 'description', 'startDate', 'endDate', 'currency'].indexOf(field) !== -1) {
            set({ [field]: value == null ? '' : String(value) });
          }
          return;
        case 'yard': {
          const y = (v.yardOptions || []).find((o) => String(o.invOrgId) === String(value));
          set(y && v.formData.yardOrgId !== y.invOrgId ? { yardOrgId: y.invOrgId, yardOrgName: y.invOrgName }
            : { yardOrgId: null, yardOrgName: null });
          return;
        }
        case 'clear':
          if (field === 'customer') set({ customerId: null, customerName: null });
          if (field === 'project') { set({ projectId: null, projectName: null, taskId: null, taskName: null }); v.taskOptions = []; }
          if (field === 'task') set({ taskId: null, taskName: null });
          return;
        case 'search':
          await this.search(context, field, value);
          return;
        case 'pick': {
          const i = Number(index);
          if (field === 'customer') {
            const c = (v.customerResults || [])[i];
            if (c) set({ customerId: Number(c.id), customerName: c.label });
            v.customerResults = [];
            v.customerQuery = '';
          } else if (field === 'project') {
            const p = (v.projectResults || [])[i];
            if (p) {
              set({ projectId: Number(p.id), projectName: p.label, taskId: null, taskName: null });
              await this.tasks(context, Number(p.id));
            }
            v.projectResults = [];
            v.projectQuery = '';
          } else if (field === 'task') {
            const t = $page.functions.taskMatches(v.taskOptions, v.taskQuery)[i];
            if (t) set({ taskId: Number(t.TaskId), taskName: t.TaskName || null });
            v.taskQuery = '';
          }
          return;
        }
        case 'taskQuery':
          v.taskQuery = value == null ? '' : String(value);
          if (!(v.taskOptions || []).length && v.formData.projectId) await this.tasks(context, v.formData.projectId);
          return;
        default:
      }
    }

    async search(context, kind, text) {
      const { $page } = context;
      const v = $page.variables;
      const q = String(text || '').trim().replace(/'/g, "''");
      v[kind + 'Query'] = String(text || '');
      const mine = ++typing[kind];
      if (q.length < 2) { v[kind + 'Results'] = []; return; }
      await new Promise((r) => setTimeout(r, PAUSE_MS));
      if (mine !== typing[kind]) return;
      const spec = kind === 'customer'
        ? { endpoint: 'ProjectLOV/getFscmRestApiResources11_13_18_05ShippingCustomersLOV', q: "Customer LIKE '*" + q + "*'",
            map: (r) => ({ id: r.CustomerId, label: r.Customer, sub: r.CustomerNumber || '' }) }
        : { endpoint: 'ProjectLOV/getFscmRestApiResources11_13_18_05ProjectsLOV', q: "ProjectName LIKE '*" + q + "*'",
            map: (r) => ({ id: r.ProjectId, label: r.ProjectName, sub: r.ProjectNumber || '' }) };
      try {
        const res = await Actions.callRest(context, { endpoint: spec.endpoint, uriParams: { q: spec.q, limit: 25 } });
        if (mine !== typing[kind]) return;
        const items = res && res.ok && res.body && Array.isArray(res.body.items) ? res.body.items : [];
        v[kind + 'Results'] = items.map(spec.map).filter((r) => r.id != null);
      } catch (e) {
        v[kind + 'Results'] = [];
      }
    }

    async tasks(context, projectId) {
      const { $page } = context;
      try {
        const res = await Actions.callRest(context, {
          endpoint: 'ProjectLOV/getFscmRestApiResources11_13_18_05ProjectTasksLOV',
          uriParams: { q: 'ProjectId=' + projectId, limit: 500 },
        });
        $page.variables.taskOptions = res && res.ok && res.body && Array.isArray(res.body.items) ? res.body.items : [];
      } catch (e) {
        $page.variables.taskOptions = [];
      }
    }
  }

  return headerChain;
});
