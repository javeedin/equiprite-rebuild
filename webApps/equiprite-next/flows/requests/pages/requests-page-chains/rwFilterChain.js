define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The Redwood look's Smart Search: its criterion (what was typed, and a filter per column) becomes the page's own text,
  // stage and source, so both looks filter alike, and the column filters (rwCols, requestList.byColumns) the Redwood
  // look adds (applyChain). The criterion is a tree: a text node, and $eq nodes for a filter's field, the value either on
  // the node or inside an object (Old's pages read it so).
  const COLS = ['number', 'party', 'equipment', 'dates', 'next', 'requester'];

  class rwFilterChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const c = v.rwCriterion;
      let text = '';
      let stage = 'all';
      let source = '';
      const cols = { number: '', party: '', equipment: '', dates: '', next: '', requester: '' };
      const pick = (field, val) => {
        const value = val === undefined || val === null ? '' : String(val);
        if (field === 'stage') stage = value || 'all';
        else if (field === 'source') source = value;
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
      read(c);
      v.text = text.trim();
      v.stage = stage;
      v.source = source;
      v.rwCols = cols;
      v.limit = 100;
      await Actions.callChain(context, { chain: 'applyChain', params: { view: 'list', ui: 'redwood' } });
    }
  }

  return rwFilterChain;
});
