define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class TimesheetInitChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const response = await Actions.callRest(context, {
        endpoint:  'eqp-v1/getEquipriteV1ViewsTimesheets',
        // uriParams, NOT parameters -- `parameters` is silently dropped in this
        // VB project, so this call was really running at Spring's default
        // size=20 and quietly truncating the timesheet list.
        uriParams: { page: 0, size: 200 }
      });

      if (!response || !response.ok || !response.body || !Array.isArray(response.body.data)) {
        console.warn('[TimesheetInitChain] Failed to load timesheets:', response && response.status);
        $page.variables.TimesheetAllArray      = [];
        $page.variables.TimesheetFilteredArray = [];
        return;
      }

      // View already returns one row per request, current week only.
      // No grouping needed — map directly to display shape.
      const data = response.body.data.map(r => ({
        rowKey:         String(r.eqrTimeEntryId || r.requestNumber),
        requestNumber:  r.requestNumber  || '—',
        projectName:    r.projectName    || '—',
        taskName:       r.taskName       || '—',
        equipCount:     r.equipCount     || 0,
        totalHours:     r.totalHours     || 0,
        billAmount:     r.billAmount     || 0,
        weekStartDate:  r.weekStartDate  ? String(r.weekStartDate).slice(0, 10) : '',
        weekEndDate:    r.weekEndDate    ? String(r.weekEndDate).slice(0, 10)   : '',
        thisWeekStatus: r.timesheetStatus || 'DRAFT',
        eqrTimeEntryId: r.eqrTimeEntryId || null
      }));

      data.sort((a, b) => {
        const dateDiff = b.weekStartDate.localeCompare(a.weekStartDate);
        if (dateDiff !== 0) return dateDiff;
        return (b.eqrTimeEntryId || 0) - (a.eqrTimeEntryId || 0);
      });

      $page.variables.TimesheetAllArray      = data;
      $page.variables.TimesheetFilteredArray = data;
    }
  }

  return TimesheetInitChain;
});
