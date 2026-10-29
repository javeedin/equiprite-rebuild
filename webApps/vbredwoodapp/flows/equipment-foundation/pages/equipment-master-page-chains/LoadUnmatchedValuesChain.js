define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Loads the "What to map next" popup (info icon) of the Import dialog: the
   * largest groups of staged items that no Class Mapping matched.
   *
   * WHY THIS EXISTS: thousands of staged rows sit at IMPORT_STATUS='ERRORED'
   * because no mapping matches them, and fixing them one row at a time in the
   * review grid does not scale. One Class Mapping on the right value
   * classifies every item in its group (Pharmaceuticals alone is 441 items on
   * paasdev), so the admin needs the GROUPS, largest first, not the rows.
   *
   * GET /equiprite/v1/equipment-import/unmatched-values, ordered by itemCount
   * DESC server-side.
   *
   * ── QUIET BY DESIGN ───────────────────────────────────────────────────
   * The popup is advice, not the work. It must never get in the way of the
   * grid, so a failure of ANY kind — 404 because the endpoint is not deployed
   * yet, 500, network, malformed body — leaves an empty list, which hides the
   * popup. No toast, no rethrow: a toast on every dialog open for an endpoint
   * that is merely late would teach users to ignore toasts.
   *
   * ── WHO CALLS IT ──────────────────────────────────────────────────────
   * OpenImportDialogChain (in parallel with LoadStagingChain), and after the
   * two things that change the groups: Fetch (ImportFromFusionChain) and
   * Import (SaveStagingClassesChain). NOT from LoadStagingChain: paging and
   * filter changes call that, and they do not change which values are
   * unmatched — every page turn would re-run the server-side GROUP BY.
   */
  const LIMIT = 20;

  // Callers overlap (open fires this, then a fast Fetch fires it again), and
  // the GROUP BY is not instant. Each run takes a ticket; only the newest
  // may write, so a slow earlier response cannot overwrite a fresher list.
  // Module scope because VB builds a new chain instance per call.
  let latest = 0;

  class LoadUnmatchedValuesChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const ticket = ++latest;

      $page.variables.unmatchedLoading = true;
      let groups = [];
      let totalGroups = 0;

      try {
        const resp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getEquipmentImportUnmatchedValues',
          uriParams: { limit: LIMIT },
        });

        if (resp && resp.ok && resp.body) {
          // Accept {items:[…]} or a bare array, same as LoadStagingChain.
          const raw = Array.isArray(resp.body)       ? resp.body
                    : Array.isArray(resp.body.items) ? resp.body.items
                    : [];
          // A group with no count is not something to act on, and would
          // render as "undefined items".
          groups = raw.filter(g => g && typeof g === 'object'
                                     && Number(g.itemCount) > 0);
          totalGroups = (typeof resp.body.totalGroups === 'number')
            ? resp.body.totalGroups : groups.length;
        }
      } catch (e) {
        // Deliberately swallowed — see QUIET BY DESIGN. The console line is
        // for whoever is wondering why the info icon never shows.
        console.warn('[LoadUnmatchedValuesChain] unmatched-values unavailable', e);
        groups = [];
        totalGroups = 0;
      }

      if (ticket !== latest) {
        return;   // a newer run owns the popup now
      }

      // Reassigned, never mutated: VB re-evaluates bindings on reassignment.
      $page.variables.unmatchedGroups      = groups;
      $page.variables.unmatchedTotalGroups = totalGroups;
      $page.variables.unmatchedLoading     = false;
    }
  }

  return LoadUnmatchedValuesChain;
});
