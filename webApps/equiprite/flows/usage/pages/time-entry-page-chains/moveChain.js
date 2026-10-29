define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Changes the request or the week (the old page's week picker, onWeekChange → refreshGridByWeekChain, and the list's
  // CardClickChain). Hours that are typed but not saved are never dropped silently: the move waits in pendingMove
  // until the user picks Discard (or Keep editing).
  class moveChain extends ActionChain {
    async run(context, { requestNumber, dir, week, confirm }) {
      const { $page } = context;
      const v = $page.variables;
      const fns = $page.functions;

      if (confirm === 'stay') {
        v.pendingMove = null;
        return;
      }
      let move = null;
      if (confirm === 'discard') {
        // A copy: page variables are live, and the variable is cleared next.
        move = v.pendingMove ? Object.assign({}, v.pendingMove) : null;
        v.pendingMove = null;
        if (!move) return;
      } else if (requestNumber) {
        if (requestNumber === v.requestNumber) return;
        move = { requestNumber: String(requestNumber), weekStart: v.weekStart || fns.thisWeek(), initial: true };
      } else if (dir) {
        const next = fns.stepWeek(v.weeks, v.weekStart, dir === 'prev' ? -1 : 1);
        if (!next) return;
        move = { requestNumber: v.requestNumber, weekStart: next, initial: false };
      } else if (week === 'today') {
        const t = fns.clampWeek(fns.thisWeek(), v.weeks);
        if (!t || t === v.weekStart) return;
        move = { requestNumber: v.requestNumber, weekStart: t, initial: false };
      }
      if (!move || v.isSaving) return;

      if (!confirm && fns.dirtyCount(v.rows, v.edits) > 0) {
        v.pendingMove = move;
        return;
      }
      await Actions.callChain(context, { chain: 'loadWeekChain', params: move });
    }
  }

  return moveChain;
});
