define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/usageAccess',
  'resources/js/costData',
  'resources/js/shellBus',
], (ActionChain, Actions, usageAccess, costData, bus) => {
  'use strict';

  // Loads one request's costs: its Post costs list row (costData.list, shared with the list for half a minute; a
  // request not on the list is opened from its number alone, as New's openRequestChain does), then New's preview reads
  // in New's order (costData.preview). Works out what is ready, posted and running, and what would be posted (New's
  // postingPlan over everything ready). Then the tab is named after the request. Reads only.
  class loadRecordChain extends ActionChain {
    async run(context, { refresh }) {
      const { $page } = context;
      const v = $page.variables;
      const fns = $page.functions;
      v.isLoading = true;
      v.error = '';
      try {
        if (!refresh) {
          const acc = await usageAccess.settle(context, 'costs');
          if (!acc.open) {
            v.closed = acc.reason;
            return;
          }
        }
        const number = String(v.number || '').trim();
        if (!number) {
          v.error = 'No request to show.';
          return;
        }
        const data = await costData.list(context, Actions, { refresh: !!refresh });
        const row = (data.list || []).find((r) => String(r.requestNumber).toUpperCase() === number.toUpperCase())
          || { requestNumber: number, eqrEquipmentRequestId: Number(v.id) || 0, projectName: '', taskName: '' };
        const res = await costData.preview(context, Actions, row);
        if (res.error) {
          v.error = res.error;
          return;
        }
        const hdr = fns.hdrOf(row);
        v.row = Object.assign({}, row, res.requestId ? { eqrEquipmentRequestId: res.requestId } : {});
        v.rowsAll = res.out.rowsAll;
        v.facts = Object.assign(fns.summarize(res.out), { startDate: res.out.startDate, endDate: res.out.endDate });
        v.plan = fns.readyPlan(res.out.rowsAll, hdr, row.rateScheduleId);
        v.table = fns.tableRows(res.out.rowsAll, hdr);
        bus.rename('cost:' + (v.number || v.id), row.requestNumber + ' costs');
      } catch (e) {
        console.error('[loadRecordChain] failed', e);
        v.error = 'The costs of ' + (v.number || 'this request') + ' could not be loaded.';
      } finally {
        v.isLoading = false;
      }
    }
  }

  return loadRecordChain;
});
