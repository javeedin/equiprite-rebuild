define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/usageAccess',
], (ActionChain, Actions, usageAccess) => {
  'use strict';

  // Opens Timesheets. Once the settings are in (usageAccess: the flags and page access New's usageGuard and
  // enforcePageAccessChain check; read-only for a READ_ONLY role, as New's isPageReadOnly), the requests on site
  // (loadQueueChain, New's views/timesheets call), then the week (loadWeekChain, New's) of the first request that still
  // needs its hours (in New's order, newest week first), on this week. Nothing is written on entry.
  class loadChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const v = $page.variables;
      const acc = await usageAccess.settle(context, 'timesheets');
      v.readOnly = !!acc.readOnly;
      v.ppmOn = !!acc.ppmOn;
      if (!acc.open) {
        v.closed = acc.reason;
        v.isLoading = false;
        v.queueLoading = false;
        return;
      }
      await Actions.callChain(context, { chain: 'loadQueueChain' });
      const queue = v.queue || [];
      const first = queue.find((q) => $page.functions.queueKind(q.status) === 'todo') || queue[0];
      if (!first) {
        v.isLoading = false;
        return;
      }
      await Actions.callChain(context, {
        chain: 'loadWeekChain',
        params: { requestNumber: first.requestNumber, weekStart: $page.functions.thisWeek(), initial: true },
      });
    }
  }

  return loadChain;
});
