define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/usageGuard',
], (ActionChain, Actions, usageGuard) => {
  'use strict';

  // Opens Time entry. The request list is the old equipment-timesheets TimesheetInitChain's call
  // (views/timesheets, uriParams page 0 / size 200, newest week first); the grid then opens on ?request= (or the
  // newest request) and ?week= (or this week), which is what the old CardClickChain handed timesheet-detail.
  class timeEntryInitChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      if (!(await usageGuard.allow(context, Actions))) {
        return;
      }
      const fns = $application.functions;
      const vars = $application.variables;
      $page.variables.readOnly = !!fns.isPageReadOnly(vars.pageAccessMap, vars.pageAccessLoaded, 'EQR_TIMESHEETS');
      $page.variables.ppmOn = !!fns.isFeatureEnabled(vars.featureFlags, vars.flagsLoaded, 'PPM_RATES_ENABLED');

      let queue = [];
      try {
        const res = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getEquipriteV1ViewsTimesheets',
          uriParams: { page: 0, size: 200 },
        });
        if (res && res.ok && res.body && Array.isArray(res.body.data)) {
          queue = res.body.data.map((r) => ({
            requestNumber: r.requestNumber || '',
            projectName: r.projectName || '',
            taskName: r.taskName || '',
            equipCount: r.equipCount || 0,
            totalHours: r.totalHours || 0,
            billAmount: r.billAmount || 0,
            weekStartDate: r.weekStartDate ? String(r.weekStartDate).slice(0, 10) : '',
            status: r.timesheetStatus || 'DRAFT',
            eqrTimeEntryId: r.eqrTimeEntryId || null,
          })).filter((r) => r.requestNumber);
          queue.sort((a, b) => b.weekStartDate.localeCompare(a.weekStartDate) || (b.eqrTimeEntryId || 0) - (a.eqrTimeEntryId || 0));
        } else {
          $page.variables.loadError = 'The timesheet list could not be loaded (HTTP ' + (res && res.status) + ').';
        }
      } catch (e) {
        console.error('[timeEntryInitChain] list failed', e);
        $page.variables.loadError = 'The timesheet list could not be loaded.';
      }
      $page.variables.queue = queue;

      const requestNumber = String($page.variables.request || '').trim() || (queue[0] && queue[0].requestNumber) || '';
      if (!requestNumber) {
        $page.variables.isLoading = false;
        return;
      }
      const urlWeek = /^\d{4}-\d{2}-\d{2}$/.test(String($page.variables.week || '')) ? String($page.variables.week) : '';
      await Actions.callChain(context, {
        chain: 'loadWeekChain',
        params: { requestNumber, weekStart: urlWeek || $page.functions.thisWeek(), initial: true },
      });
    }
  }

  return timeEntryInitChain;
});
