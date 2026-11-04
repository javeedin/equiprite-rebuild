define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The Redwood view's header actions on a unit (the general overview page's secondary actions; the clicked one's id is
  // the event's secondaryItem): 'request' opens the unit's request in its own tab, as the current look's "Open REQ-…"
  // does (openRecordChain; this tab stays as it is, half-done checklist and all).
  class rwActionChain extends ActionChain {
    async run(context, { item }) {
      const id = item && typeof item === 'object' ? item.id : item;
      if (id !== 'request') return;
      const v = context.$page.variables;
      const line = v.current || (v.done && v.done.line) || {};
      await Actions.callChain(context, { chain: 'openRecordChain', params: { id: line.requestId == null ? '' : String(line.requestId), number: line.requestNumber || '' } });
    }
  }

  return rwActionChain;
});
