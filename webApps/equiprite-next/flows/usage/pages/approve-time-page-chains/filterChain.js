define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // New EquipRite's Timesheet approval filterChain, with Next's additions marked: "needs a look only", "select the
  // lines that look right", Refresh and the export menu. Tick-all ticks what is on screen (New's visible(), narrowed
  // by "needs a look only" when it is on).
  //
  // Week, status, search, compare and the ticks. A week change clears the ticks and any adjustment (they belong to
  // the week on screen) and reads the new week's cost so far.
  class filterChain extends ActionChain {
    async run(context, { action, key, value }) {
      const { $page } = context;
      const v = $page.variables;
      const fns = $page.functions;
      if (action === 'exportOpen') {
        v.exportOpen = !v.exportOpen;
        return;
      }
      v.actionError = '';
      if (action === 'refresh') {
        // Next: read the week again (New's loadApprovalsChain).
        if (v.isWorking) return;
        await Actions.callChain(context, { chain: 'loadApprovalsChain', params: { week: v.weekKey } });
      } else if (action === 'week') {
        if (!value || value === v.weekKey) return;
        v.weekKey = String(value);
        v.weekDays = fns.weekDays(v.weekKey);
        v.picked = {};
        v.adjust = null;
        v.confirm = '';
        await Actions.callChain(context, { chain: 'loadCostChain' });
      } else if (action === 'status') {
        v.statusKey = value ? String(value) : 'SUBMITTED';
        v.picked = {};
        v.confirm = '';
      } else if (action === 'text') {
        v.searchText = value == null ? '' : String(value);
      } else if (action === 'compare') {
        v.compare = value === true || value === 'true';
      } else if (action === 'onlyLook') {
        // Next: only the lines that need a look.
        v.onlyLook = !v.onlyLook;
      } else if (action === 'pick') {
        const picked = Object.assign({}, v.picked || {});
        if (value === true || value === 'true') picked[key] = true; else delete picked[key];
        v.picked = picked;
      } else if (action === 'pickClean') {
        // Next: tick the lines on screen that can be approved and need no look.
        v.picked = fns.cleanKeys(v.rowsAll, fns.shown(v.rowsAll, v.weekKey, v.statusKey, v.searchText, v.onlyLook, v.weekDays), v.readOnly, v.weekDays);
        v.confirm = '';
        v.rowsAll = (v.rowsAll || []).map((r) => Object.assign({}, r));
      } else if (action === 'pickAll') {
        const picked = {};
        if (value === true || value === 'true') {
          fns.shown(v.rowsAll, v.weekKey, v.statusKey, v.searchText, v.onlyLook, v.weekDays)
            .filter((r) => fns.canAct(r, v.readOnly)).forEach((r) => { picked[r.key] = true; });
        }
        v.picked = picked;
        v.confirm = '';
        // Redraw the rows so boxes the user ticked by hand follow the new state.
        v.rowsAll = (v.rowsAll || []).map((r) => Object.assign({}, r));
      }
    }
  }

  return filterChain;
});
