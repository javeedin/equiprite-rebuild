define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The Redwood view's Smart Search: its criterion (what was typed, and a filter per column) becomes the page's own text,
  // stage (the step tiles) and yard (the yard chips), so both looks filter alike, and the column filters only the Redwood
  // view shows (rwCols: Needed, Request, Project or customer, Next step, Type; yardWork.byColumns, applyChain). The
  // criterion is a tree: a text node, and $eq nodes for a filter's field, the value either on the node or inside an
  // object (Old's pages read it so).
  const COLS = ['when', 'number', 'party', 'next', 'type'];

  class rwFilterChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      let text = '';
      let stage = 'all';
      let yard = 'all';
      const cols = { when: '', number: '', party: '', next: '', type: '' };
      const pick = (field, val) => {
        const value = val === undefined || val === null ? '' : String(val);
        if (field === 'stage') stage = value || 'all';
        else if (field === 'yard') yard = value || 'all';
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
      v.exportOpen = '';
      v.text = text.trim();
      v.stage = stage;
      v.yard = yard;
      v.rwCols = cols;
      // A step tile for pieces in a folded section shows that section (as the tile does on the current look).
      if (stage === 'shipped' && v.collapsed && v.collapsed.done) v.collapsed = Object.assign({}, v.collapsed, { done: false });
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return rwFilterChain;
});
