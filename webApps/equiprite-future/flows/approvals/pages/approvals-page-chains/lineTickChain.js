define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // A line's tick box on a request to decide (or 'all' / 'none'). Approve and Send back act on the ticked lines, in
  // the order they were ticked, or on every line when none is ticked (New EquipRite's selection rule).
  class lineTickChain extends ActionChain {
    async run(context, { id, checked }) {
      const v = context.$page.variables;
      const on = checked === true || checked === 'true';
      if (id === 'none') v.ticks = [];
      else if (id === 'all') v.ticks = on ? (v.lines || []).map((l) => l.lineId) : [];
      else if (id !== undefined && id !== null && id !== '') {
        const rest = (v.ticks || []).filter((t) => String(t) !== String(id));
        v.ticks = on ? rest.concat([String(id)]) : rest;
      }
    }
  }

  return lineTickChain;
});
