define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Ticks or unticks a deployed unit of the From request.
  class toggleUnitChain extends ActionChain {
    async run(context, { lineId, checked }) {
      const { $page } = context;
      const v = $page.variables;
      if (!lineId) {
        return;
      }
      const sel = Object.assign({}, v.selected || {});
      if (checked === true || checked === 'true') {
        sel[String(lineId)] = true;
      } else {
        delete sel[String(lineId)];
      }
      v.selected = sel;
      v.saveError = '';
      v.done = null;
    }
  }

  return toggleUnitChain;
});
