define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // A unit chosen on a line's radio list: Approve and allocate (and what it sets off) follows it.
  class pickChain extends ActionChain {
    async run(context, { lineId, unitId }) {
      const $v = context.$page.variables;
      if (!lineId) return;
      const picks = Object.assign({}, $v.picks);
      picks[lineId] = unitId;
      $v.picks = picks;
    }
  }

  return pickChain;
});
