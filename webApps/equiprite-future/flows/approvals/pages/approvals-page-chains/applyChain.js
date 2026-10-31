define([
  'vb/action/actionChain',
  'resources/js/approvalQueue',
  'resources/js/rules',
], (ActionChain, queue, rules) => {
  'use strict';

  // The queue from the requests: what waits on the Equipment Manager, most urgent first; then the chip, the source
  // and the search. A ticked request no longer to decide, or hidden by the search, drops out of the selection.
  class applyChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const v = $page.variables;
      const app = $application.variables;
      const items = queue.build(v.rows, v.linesByRequest, {
        now: Date.now(),
        quoting: (source) => rules.isQuotingAllowed(app.globalSettings, app.flagsLoaded, source),
        settled: v.settled,
      });
      const shown = queue.filter(items, v.text, v.stage, v.source);
      const ticked = (v.selectedIds || []).filter((id) => items.some((i) => i.key === String(id) && i.kind === 'decide'));
      v.items = items;
      v.chips = queue.chips(items);
      v.summary = queue.summary(items);
      v.selectedIds = ticked;
      v.selection = queue.selection(shown, ticked);
      v.shown = shown;
      // The open request keeps its place; its queue entry is refreshed (it may have moved on, or left the queue).
      if (v.current && v.current.key) {
        const now = items.filter((i) => i.key === v.current.key)[0];
        if (now) v.current = now;
      }
    }
  }

  return applyChain;
});
