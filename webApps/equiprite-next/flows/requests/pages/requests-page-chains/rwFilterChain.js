define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The Redwood look's Smart Search: its criterion (what was typed, the stage and type picked) becomes the page's own
  // text, stage and source, so both looks filter alike (applyChain). The criterion is a tree: a text node, and $eq
  // nodes for a filter's field (stage, source), the value either on the node or inside an object (Old's pages read it so).
  class rwFilterChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const c = v.rwCriterion;
      let text = '';
      let stage = 'all';
      let source = '';
      const read = (node) => {
        if (!node) return;
        if (Array.isArray(node.criteria)) node.criteria.forEach(read);
        if (node.text !== undefined && node.text !== null) text = String(node.text);
        if (node.op === '$eq') {
          const pick = (field, val) => {
            if (field === 'stage') stage = val || 'all';
            if (field === 'source') source = val || '';
          };
          if (node.attribute) pick(node.attribute, node.value);
          else if (node.value && typeof node.value === 'object') Object.keys(node.value).forEach((k) => pick(k, node.value[k]));
        }
      };
      read(c);
      v.text = text.trim();
      v.stage = stage;
      v.source = source;
      v.limit = 100;
      await Actions.callChain(context, { chain: 'applyChain', params: { view: 'list' } });
    }
  }

  return rwFilterChain;
});
