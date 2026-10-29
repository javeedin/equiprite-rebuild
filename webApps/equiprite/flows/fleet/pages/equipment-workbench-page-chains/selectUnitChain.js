define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Opens a unit's panel beside the board (key), or closes it (no key).
  class selectUnitChain extends ActionChain {
    async run(context, { key }) {
      const v = context.$page.variables;
      v.selected = key ? (v.units.find((u) => u.key === key) || null) : null;
    }
  }

  return selectUnitChain;
});
