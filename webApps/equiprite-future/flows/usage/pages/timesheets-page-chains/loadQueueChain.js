define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The requests on site: New's timeEntryInitChain list call, unchanged (views/timesheets, uriParams page 0 / size 200,
  // one row per request with its current week, newest week first). Read again after a save, so each request's state
  // follows what was written.
  class loadQueueChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const v = $page.variables;
      v.queueLoading = true;
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
          v.queue = queue;
        } else {
          v.loadError = 'The requests on site could not be loaded (HTTP ' + (res && res.status) + ').';
        }
      } catch (e) {
        console.error('[loadQueueChain] list failed', e);
        v.loadError = 'The requests on site could not be loaded.';
      } finally {
        v.queueLoading = false;
      }
    }
  }

  return loadQueueChain;
});
