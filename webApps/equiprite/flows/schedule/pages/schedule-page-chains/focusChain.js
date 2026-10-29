define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // "Show on schedule" in the conflict panel and a unit in the list: scroll the Gantt to the bar or the row, select
  // it, and focus the map on it (the old page's eventClick / selectionChange behaviour).
  class focusChain extends ActionChain {
    async run(context, { eventId, unitId }) {
      const { $page } = context;
      const fns = $page.functions;
      if (eventId != null && eventId !== '') {
        await fns.focusEvent(Number(eventId));
      } else if (unitId != null && unitId !== '') {
        await fns.focusUnit(Number(unitId));
      }
    }
  }

  return focusChain;
});
