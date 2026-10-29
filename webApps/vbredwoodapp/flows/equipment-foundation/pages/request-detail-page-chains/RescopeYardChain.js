define([
  'vb/action/actionChain',
  'vb/action/actions',
  'vb/action/actionUtils',
  'resources/js/requestDetailLines',
], (ActionChain, Actions, _au, rdl) => {
  'use strict';

  /**
   * Fired when the Yard LOV selection changes. Re-fetches the enriched
   * request-detail-lines scoped to the chosen inventory org (yardId) so the
   * per-line availability reflects that yard. Clearing the yard (yardId null)
   * re-fetches spanning all orgs.
   *
   * Only the lines + derived progress are rebuilt — the request header is
   * unaffected by yard scope, so it is left as-is.
   */
  class RescopeYardChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;

      const requestId = $page.variables.requestId;
      if (!requestId) {
        console.warn('[request-detail RescopeYardChain] No requestId in page variables.');
        return;
      }

      // yardId comes from the changed selection. Forwarded via the page-JSON
      // listener params ($event.detail.value); falls back to the page var.
      const yardId = (params && params.yardId != null)
        ? params.yardId
        : $page.variables.selectedYard;

      const result = await rdl.fetchAndBuild(context, Actions, requestId, yardId);
      if (!result.ok) {
        console.warn('[request-detail RescopeYardChain] Failed to re-fetch lines for yardId:', yardId);
        return;
      }

      rdl.applyLines($page, result.lines);
    }
  }

  return RescopeYardChain;
});
