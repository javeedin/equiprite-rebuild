define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The Redwood view's Smart Search: its criterion (what was typed, and a filter per column) becomes the page's own text,
  // chip (Where it is) and kind, so both looks filter alike, and the column filters only the Redwood view shows (rwCols:
  // Transfer, Request, From → to, What is moving, Due; transferList.byColumns, applyChain). The criterion is a tree: a
  // text node, and $eq nodes for a filter's field, the value either on the node or inside an object (Old's pages read it so).
  const COLS = ['number', 'request', 'route', 'what', 'due'];
  const PAGE = 100;

  class rwFilterChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      let text = '';
      let chip = 'all';
      let kind = 'all';
      const cols = { number: '', request: '', route: '', what: '', due: '' };
      const pick = (field, val) => {
        const value = val === undefined || val === null ? '' : String(val);
        if (field === 'chip') chip = value || 'all';
        else if (field === 'kind') kind = value || 'all';
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
      v.kind = kind;
      v.rwCols = cols;
      v.limit = PAGE;
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return rwFilterChain;
});
