define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // Choosing lines on a request to decide: a line's tick (its id) turns on or off; 'none' clears them. Approve and
  // Send back act on the lines chosen, in the order chosen, or on every line when none is (Next's lineTickChain, New
  // EquipRite's selection rule).
  class tickChain extends ActionChain {
    async run(context, { id }) {
      const pv = context.$page.variables;
      if (pv.busy || id === undefined || id === null || id === '') return;
      if (id === 'none') {
        pv.ticks = [];
        return;
      }
      const ticks = (pv.ticks || []).map(String);
      const on = ticks.indexOf(String(id)) === -1;
      const rest = ticks.filter((t) => t !== String(id));
      pv.ticks = on ? rest.concat([String(id)]) : rest;
    }
  }

  return tickChain;
});
