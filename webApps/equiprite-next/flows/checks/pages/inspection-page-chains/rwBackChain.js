define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The Redwood view's in-flow back, from a unit to the queue: while inspecting it, as the current look's "Back to the
  // queue" (openLineChain with no line; not while saving); once it is done, the done card is put away (the current look
  // shows the queue beside it instead).
  class rwBackChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      if (v.current) {
        await Actions.callChain(context, { chain: 'openLineChain', params: { lineId: '' } });
        return;
      }
      v.done = null;
    }
  }

  return rwBackChain;
});
