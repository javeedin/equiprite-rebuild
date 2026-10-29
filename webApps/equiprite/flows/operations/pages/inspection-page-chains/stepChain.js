define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Back / Next / a progress pip / Review. The review step is checklist.length.
  class stepChain extends ActionChain {
    async run(context, { to }) {
      const { $page } = context;
      const v = $page.variables;
      const last = (v.checklist || []).length;
      const at = Number(v.step) || 0;
      let next = at;
      if (to === 'next') {
        next = at + 1;
      } else if (to === 'prev') {
        next = at - 1;
      } else if (to === 'review') {
        next = last;
      } else if (to !== undefined && to !== null && to !== '' && !isNaN(Number(to))) {
        next = Number(to);
      }
      v.step = Math.max(0, Math.min(last, next));
      v.blocked = [];
    }
  }

  return stepChain;
});
