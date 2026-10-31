define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/usageAccess',
  'resources/js/costData',
  'resources/js/costPosting',
  'resources/js/expenditureTypes',
  'resources/js/shellBus',
], (ActionChain, Actions, usageAccess, costData, costPosting, expenditureTypes, bus) => {
  'use strict';

  // Loads one request's costs: its Post costs list row (costData.list, shared with the list for half a minute; a
  // request not on the list is opened from its number alone, as New's openRequestChain does), then New's preview reads
  // in New's order (costData.preview). Works out what is ready, posted and running, ticks everything ready (less what
  // the person unticked) and what that would post (New's postingPlan). Then the tab is named after the request.
  //
  // On entry it also learns whether the role may post (usageAccess: New's isPageReadOnly on EQR_POST_COST) and, for one
  // who may, loads the expenditure types in the background (New's loadForRequest; the proven four until then).
  //
  // reread, after a write (no access check, the request's row kept):
  //   'preview'  New's loadPreviewChain alone (after a charge is added or removed, a re-tier)
  //   'post'     New's loadPreviewChain then listChain (after a post): the preview, then the list read anew
  // Reads only.
  class loadRecordChain extends ActionChain {
    async run(context, { refresh, reread }) {
      const { $page } = context;
      const v = $page.variables;
      const fns = $page.functions;
      const first = !refresh && !reread;
      v.isLoading = true;
      v.error = '';
      try {
        if (first) {
          const acc = await usageAccess.settle(context, 'costs');
          if (!acc.open) {
            v.closed = acc.reason;
            return;
          }
          v.readOnly = !!acc.readOnly;
        }
        const number = String(v.number || (v.row && v.row.requestNumber) || '').trim();
        if (!number) {
          v.error = 'No request to show.';
          return;
        }
        const same = (r) => String(r.requestNumber).toUpperCase() === number.toUpperCase();
        let row;
        if (reread && v.row && v.row.requestNumber) {
          row = Object.assign({}, v.row);
        } else {
          const data = await costData.list(context, Actions, { refresh: !!refresh });
          row = (data.list || []).find(same) || { requestNumber: number, eqrEquipmentRequestId: Number(v.id) || 0, projectName: '', taskName: '' };
        }
        const res = await costData.preview(context, Actions, row);
        if (res.error) {
          v.error = res.error;
          return;
        }
        if (reread === 'post') {
          const data = await costData.list(context, Actions, { refresh: true });
          const fresh = (data.list || []).find(same);
          if (fresh) row = Object.assign({}, fresh, row.eqrEquipmentRequestId ? { eqrEquipmentRequestId: row.eqrEquipmentRequestId } : {});
        }
        const hdr = fns.hdrOf(row);
        const readOnly = !!v.readOnly;
        const rows = readOnly ? res.out.rowsAll : costPosting.select(res.out.rowsAll, v.unticked);
        const plan = readOnly ? fns.readyPlan(rows, hdr, row.rateScheduleId) : costPosting.plan(rows, hdr, row.rateScheduleId);
        const facts = Object.assign(fns.summarize(res.out), { startDate: res.out.startDate, endDate: res.out.endDate });
        const table = fns.tableRows(rows, hdr);
        v.row = Object.assign({}, row, res.requestId ? { eqrEquipmentRequestId: res.requestId } : {});
        v.rowsAll = rows;
        v.facts = facts;
        v.plan = plan;
        v.table = table;
        bus.rename('cost:' + (v.number || v.id), row.requestNumber + ' costs');
        if (first && !readOnly) {
          const callRest = (o) => Actions.callRest(context, o);
          expenditureTypes.loadForRequest(callRest, { projectIdHint: row.ppmProjectRefId, requestId: res.requestId, requestNumber: row.requestNumber })
            .then((list) => { if (list && list.length) v.expTypeList = list; })
            .catch((e) => console.warn('[loadRecordChain] expenditure types kept at the proven values:', e && e.message));
        }
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
