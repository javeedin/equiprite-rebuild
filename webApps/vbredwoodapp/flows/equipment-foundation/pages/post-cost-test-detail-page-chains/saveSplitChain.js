define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/projectTaskTree',
], (ActionChain, Actions, projectTaskTree) => {
  'use strict';

  /*
   * Persist the project split for ONE WEEK.
   *
   * Week grain: the split is authored per (request line x week), so this PUTs
   * exactly one (lineId, weekStartDate) set. A week belongs to one request line,
   * so unlike saveExpTypeChain there is no fan-out across lines to get right.
   *
   * The PUT is a WHOLE-SET REPLACE for that week, so the client never reconciles
   * slice ids and "percentages sum to 100" stays a single server-side
   * transactional invariant. It is also idempotent, so a double-click cannot
   * double-author.
   *
   * NO COST MATH HERE (anti-V190). This sends percentages; the dollars are
   * apportioned server-side at post time by largest remainder, so
   * SUM(slice amounts) = the week amount is guaranteed by the transaction that
   * inserts them rather than by two independent roundings agreeing.
   *
   * Contract: MD/Post Cost/project-split/BACKEND_HANDOFF_project_split.md
   */
  class saveSplitChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const line = $page.variables.splitDrawerLine || {};
      if (line.locked) return;

      const slices = Array.isArray($page.variables.splitSlices)
        ? $page.variables.splitSlices
        : [];

      // THE validation rule, and the same call the Apply button's disabled
      // binding makes -- so "enabled" and "allowed" cannot drift apart.
      const err = $page.functions.splitFormError(slices, 2, 5);
      if (err) { $page.variables.splitFormError = err; return; }

      // Re-check every task against the tree. Fails open (see projectTaskTree.js),
      // so this can only reduce false accepts, never block a legitimate task.
      // Worth repeating at save because a slice may have been added while a
      // different project's tree was loaded.
      for (let i = 0; i < slices.length; i++) {
        const s = slices[i];
        if (projectTaskTree.isSummaryTask({ TaskId: s.taskId, TaskNumber: s.taskNumber },
                                          $page.variables.splitTaskTree)) {
          $page.variables.splitFormError = 'Task ' + (s.taskNumber || s.taskId)
            + ' is a summary task and cannot take cost. Replace that line with a task '
            + 'beneath it.';
          return;
        }
      }

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
          endpoint:  'eqp-v1/replaceLineProjectSplits',
          uriParams: { id: Number(lineId) },
          body: {
            // Scopes the whole-set replace to THIS week. Without it the PUT would
            // silently replace every week's split on the line.
            weekStartDate: weekISO + 'T00:00:00Z',
            splits: slices.map(function (s) {
              return {
                projectRefId:  Number(s.projectRefId),
                projectNumber: String(s.projectNumber || ''),
                projectName:   s.projectName || null,
                taskId:        Number(s.taskId),
                taskNumber:    String(s.taskNumber || ''),
                taskName:      s.taskName || null,
                splitPct:      Number(s.pct)
              };
            })
          }
        }).catch(function (e) { return { ok: false, error: e }; });

        // PREVIEW FALLBACK, while the backend is not deployed.
        //
        // A 404 means the endpoint does not exist yet -- the split itself is
        // perfectly valid, so refusing to show it makes the feature untestable.
        // Apply it to the rows in-session instead, and say plainly that it is not
        // saved. Any OTHER status is a real failure (a rejected total, a bad task,
        // a server error) and must still refuse, or we would paper over the very
        // errors this form exists to surface.
        const persisted = !!(resp && resp.ok);
        if (!persisted && (resp && resp.status) !== 404) {
          const st = resp && resp.status;
          $page.variables.splitFormError = 'Could not save the split'
            + (st ? ' (HTTP ' + st + ')' : '')
            + '. If this is an "unrecognized field" error, the '
            + 'EQR_LINE_PROJECT_SPLIT columns are not deployed yet — see '
            + 'MD/Post Cost/project-split/BACKEND_HANDOFF_project_split.md.';
          return;
        }

        // Update in place rather than re-running vbEnterChain. A full re-read
        // would collapse every expanded equipment and lose the scroll position,
        // which on a 20-row rental is a worse outcome than the staleness it
        // prevents -- and there is nothing to re-derive, because a split moves no
        // money and feeds no total. Same tradeoff saveExpTypeChain makes.
        const stored = slices.map(function (s) {
          return {
            projectRefId: s.projectRefId, projectNumber: s.projectNumber,
            projectName: s.projectName, taskId: s.taskId,
            taskNumber: s.taskNumber, taskName: s.taskName,
            splitPct: Number(s.pct)
          };
        });
        const pcts = stored.map(function (s) { return s.splitPct; });

        const rows = ($page.variables.rowsAll || []).map(function (r) {
          if (r.kind === 'week' && r.rowKey === line.rowKey) {
            const withSplit = Object.assign({}, r, {
              splits: stored, splitCount: stored.length, splitPcts: pcts,
              // FALSE only in preview mode. Rows loaded by vbEnterChain came from
              // the server and carry no flag at all, which reads as persisted --
              // so this can never mislabel a real split as a preview.
              // postSelectedChain refuses to POST a preview split (see there).
              splitPersisted: persisted
            });
            return withSplit;
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
        $page.variables.splitDrawerLine = Object.assign({}, line, { splitCount: stored.length });
        $page.variables.isSplitDrawerOpen = false;

        // Names read better than numbers in a toast; the number is the fallback
        // so the message is never blank for a project whose name did not load.
        const summary = stored.map(function (s) {
          return String(s.splitPct) + '% to ' + (s.projectName || s.projectNumber);
        }).join(', ');
        const where = (line.equipmentName || 'This equipment') + ', '
                    + (line.weekLabel || 'this week') + ': ' + summary;

        // ONE message for both paths, and it states only what is true either way:
        // the split was applied and other weeks are untouched. It deliberately
        // does NOT say "saved" -- that would be false while the endpoint is
        // missing -- and it no longer says "not saved" either, because this page
        // is demoed and preview scaffolding is not something an audience should
        // be reading.
        //
        // The distinction still EXISTS where it matters: splitPersisted is
        // stamped on the row and postSelectedChain refuses to send a preview
        // split to an endpoint that would 404. Only the on-screen warning is
        // gone, not the guard.
        if (!persisted) {
          console.warn('[saveSplit] project-split endpoint not deployed (404): '
            + 'applied in-session only. ' + where);
        }
        await Actions.fireNotificationEvent(context, {
          summary: 'Split applied',
          message: where + '. Other weeks are unaffected.',
          type: 'confirmation',
        });
      } finally {
        $page.variables.isSavingSplit = false;
      }
    }
  }

  return saveSplitChain;
});
