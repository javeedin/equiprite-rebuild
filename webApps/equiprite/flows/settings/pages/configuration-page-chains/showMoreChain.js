define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // New EquipRite: the long lists (expenditure type mappings, subclasses) draw 100 rows at a time.
  const LIMITS = { exp: 'expLimit', sub: 'subLimit' };

  class showMoreChain extends ActionChain {
    async run(context, { list }) {
      const name = LIMITS[list];
      if (name) {
        context.$page.variables[name] = Number(context.$page.variables[name] || 100) + 100;
      }
    }
  }

  return showMoreChain;
});
