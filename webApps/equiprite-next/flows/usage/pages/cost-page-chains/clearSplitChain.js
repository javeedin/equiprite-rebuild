define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/costPosting',
  'resources/js/shellBus',
], (ActionChain, Actions, costPosting, bus) => {
  'use strict';

  // Remove ONE WEEK's split, so the week posts wholly to the request's project again: New's Post costs clearSplitChain,
  // DELETE clearLineProjectSplits for the line, scoped to the week. A 404 means nothing was ever stored, so clearing the
  // screen is the right end state; any other failure changes nothing.
  class clearSplitChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const v = $page.variables;
      // a plain copy: it is read again once v.split has been replaced (set)
      const line = Object.assign({}, (v.split && v.split.line) || {});
      if (line.locked || v.isSavingSplit || v.readOnly) return;
      const set = (patch) => { v.split = Object.assign({}, v.split, patch); };
      if (!line.requestLineId || !line.weekStartISO) {
        set({ error: 'This week has no request line to save against.' });
        return;
      }
      v.isSavingSplit = true;
      set({ error: '' });
      try {
        const resp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/clearLineProjectSplits',
          uriParams: { id: Number(line.requestLineId), weekStartDate: line.weekStartISO },
        }).catch((e) => ({ ok: false, error: e }));
        if ((!resp || !resp.ok) && (resp && resp.status) !== 404) {
          set({ error: 'Could not remove the split' + (resp && resp.status ? ' (HTTP ' + resp.status + ')' : '') + '. Nothing was changed.' });
          return;
        }
        const fns = $page.functions;
        const hdr = fns.hdrOf(v.row);
        const rows = (v.rowsAll || []).map((r) => (r.kind === 'week' && r.rowKey === line.rowKey
          ? Object.assign({}, r, { splits: [], splitCount: 0, splitPcts: [], splitPersisted: undefined })
          : r));
        const next = fns.applySplitDerived(rows, hdr);
        const plan = costPosting.plan(next, hdr, v.row && v.row.rateScheduleId);
        const table = fns.tableRows(next, hdr);
        v.rowsAll = next;
        v.plan = plan;
        v.table = table;
        v.panel = '';
        bus.toast((line.weekLabel || 'This week') + " will post entirely to the request's own project. Other weeks are unaffected.", 'info');
      } finally {
        v.isSavingSplit = false;
      }
    }
  }

  return clearSplitChain;
});
