define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // New EquipRite's Time entry moveChain, unchanged but for Refresh (marked Next): it reads the requests on site and
  // the week again, and waits on Discard like any other move when the week has unsaved hours.
  //
  // Changes the request or the week (the old page's week picker, onWeekChange → refreshGridByWeekChain, and the list's
  // CardClickChain). Hours that are typed but not saved are never dropped silently: the move waits in pendingMove
  // until the user picks Discard (or Keep editing).
  class moveChain extends ActionChain {
    async run(context, { requestNumber, dir, week, confirm, refresh }) {
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
      } else if (refresh) {
        // Next: Refresh.
        move = { requestNumber: v.requestNumber, weekStart: v.weekStart || fns.thisWeek(), initial: false, refresh: true };
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
      if (move.refresh) {
        // Next: the requests on site again; with none open yet, the first that still needs its hours.
        await Actions.callChain(context, { chain: 'loadQueueChain' });
        if (!move.requestNumber) {
          const q = v.queue || [];
          const first = q.find((x) => fns.queueKind(x.status) === 'todo') || q[0];
          if (!first) return;
          move = { requestNumber: first.requestNumber, weekStart: fns.thisWeek(), initial: true };
        }
      }
      await Actions.callChain(context, {
        chain: 'loadWeekChain',
        params: { requestNumber: move.requestNumber, weekStart: move.weekStart, initial: !!move.initial },
      });
    }
  }

  return moveChain;
});
