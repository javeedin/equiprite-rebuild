define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The Redwood view's Smart Search: its criterion (what was typed, and a filter per column) becomes the page's own text,
  // chip (Inspection) and scope (Which units: asked for by the matrix, or everything waiting), so both looks filter
  // alike, and the column filters only the Redwood view shows (rwCols: Equipment, Request, When;
  // inspectionQueue.byColumns, applyChain). With no Which units picked, the queue is what the matrix asks for, or every
  // unit waiting when the matrix could not be read or is empty (as loadQueueChain sets it). The criterion is a tree: a
  // text node, and $eq nodes for a filter's field, the value either on the node or inside an object (Old's pages read it so).
  const COLS = ['unit', 'request', 'when'];

  class rwFilterChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      let text = '';
      let chip = 'all';
      let scope = '';
      const cols = { unit: '', request: '', when: '' };
      const pick = (field, val) => {
        const value = val === undefined || val === null ? '' : String(val);
        if (field === 'chip') chip = value || 'all';
        else if (field === 'scope') scope = value;
        else if (COLS.indexOf(field) !== -1) cols[field] = value;
      };
      const read = (node) => {
        if (!node) return;
        if (Array.isArray(node.criteria)) node.criteria.forEach(read);
        if (node.text !== undefined && node.text !== null) text = String(node.text);
        if (node.op === '$eq') {
          if (node.attribute) pick(node.attribute, node.value);
          else if (node.value && typeof node.value === 'object') Object.keys(node.value).forEach((k) => pick(k, node.value[k]));
        }
      };
      read(v.rwCriterion);
      v.exportOpen = false;
      v.text = text.trim();
      v.chip = chip;
      v.scope = scope === 'all' || (!scope && !!v.matrixNote) ? 'all' : 'required';
      v.rwCols = cols;
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return rwFilterChain;
});
