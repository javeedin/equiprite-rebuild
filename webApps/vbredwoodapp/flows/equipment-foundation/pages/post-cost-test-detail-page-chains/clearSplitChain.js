define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /*
   * Remove the split from ONE WEEK, reverting it to the request header's project.
   *
   * No confirmation prompt: nothing is deleted that was ever sent anywhere. A
   * posted week is locked and never reaches this chain, and re-authoring the
   * split is two clicks away.
   *
   * Scoped to the week, like the save -- clearing the whole line's splits from
   * here would silently undo weeks the user never opened.
   */
  class clearSplitChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const line = $page.variables.splitDrawerLine || {};
      if (line.locked) return;

      const lineId = line.requestLineId;
      const weekISO = line.weekStartISO;
      if (!lineId || !weekISO) {
        $page.variables.splitFormError = 'This week has no request line to save against.';
        return;
      }

      $page.variables.isSavingSplit = true;
      $page.variables.splitFormError = '';
      try {
        const resp = await Actions.callRest(context, {
          endpoint:  'eqp-v1/clearLineProjectSplits',
          uriParams: { id: Number(lineId), weekStartDate: weekISO }
        }).catch(function (e) { return { ok: false, error: e }; });

        // Same preview fallback as the save: a 404 means the endpoint is not
        // deployed, and there is then nothing persisted to remove -- so clearing
        // the row in-session IS the correct end state. Any other status is a real
        // failure and must refuse.
        if ((!resp || !resp.ok) && (resp && resp.status) !== 404) {
          const st = resp && resp.status;
          $page.variables.splitFormError = 'Could not remove the split'
            + (st ? ' (HTTP ' + st + ')' : '') + '. Nothing was changed.';
          return;
        }

        const rows = ($page.variables.rowsAll || []).map(function (r) {
          if (r.kind === 'week' && r.rowKey === line.rowKey) {
            const cleared = Object.assign({}, r, {
              splits: [], splitCount: 0, splitPcts: [], splitPersisted: undefined
            });
            return cleared;
          }
          return r;
        });
        // ONE call for everything derived from splits: the per-slice rows, the
        // equipment rollup and the Project/Task sort key. Shared with
        // vbEnterChain so the three cannot disagree about the row tree.
        $page.variables.rowsAll = $page.functions.applySplitDerived(rows, {
            projectNumber: $page.variables.ppmProjectNumber,
            projectName:   $page.variables.projectName,
            taskNumber:    $page.variables.ppmTaskNumber,
            taskName:      $page.variables.taskName,
          });
        $page.variables.rowsVisible = $page.functions.visibleRows($page.variables.rowsAll);
        $page.variables.splitSlices = [];
        $page.variables.splitDrawerLine = Object.assign({}, line, { splitCount: 0 });
        $page.variables.isSplitDrawerOpen = false;

        await Actions.fireNotificationEvent(context, {
          summary: 'Split removed',
          message: (line.weekLabel || 'This week') + " will post entirely to the request's "
                 + 'own project. Other weeks are unaffected.',
          type: 'confirmation',
        });
      } finally {
        $page.variables.isSavingSplit = false;
      }
    }
  }

  return clearSplitChain;
});
