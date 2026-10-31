define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // A unit's panel: its facts, now, next and every booking; empty key closes it.
  class selectChain extends ActionChain {
    async run(context, { key }) {
      const v = context.$page.variables;
      v.selected = key ? ((v.units || []).filter((u) => u.key === key)[0] || null) : null;
    }
  }

  return selectChain;
});
