define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // A filter of the shown question changed: a chip, a bar clicked in a chart (the same bar again clears it), the
  // search, a table view; or the export menu, or "show more".
  const PAGE = 100;
  // Fields a click toggles (picked again = cleared); the others are set.
  const TOGGLE = { yard: 1, cls: 1, party: 1, lane: 1, month: 1 };
  const FIELDS = {
    fleet: { show: 1, yard: 1, cls: 1, text: 1 },
    use: { yard: 1, view: 1 },
    late: { kind: 1, party: 1, text: 1 },
    flow: { months: 1, lane: 1, month: 1, text: 1 },
    cost: { posted: 1, party: 1, yard: 1, text: 1 },
  };
  const DEFAULTS = { show: 'all', kind: 'all', posted: 'all', view: 'yard', months: 6 };

  class setChain extends ActionChain {
    async run(context, { field, value, clear }) {
      const v = context.$page.variables;
      if (field === 'exportOpen') { v.exportOpen = value === 'toggle' ? !v.exportOpen : !!value; return; }
      if (field === 'limit') { v.limit += PAGE; return; }
      const key = v.report;
      if (!key || !FIELDS[key] || !FIELDS[key][field]) return;
      const cur = Object.assign({}, v.f[key] || {});
      let next = value === undefined || value === null ? '' : String(value);
      if (field === 'months') next = Number(next) === 12 ? 12 : 6;
      if (clear) next = DEFAULTS[field] !== undefined ? DEFAULTS[field] : '';
      else if (TOGGLE[field] && cur[field] === next) next = '';
      else if (next === '' && DEFAULTS[field] !== undefined) next = DEFAULTS[field];
      cur[field] = next;
      const all = Object.assign({}, v.f);
      all[key] = cur;
      v.f = all;
      v.exportOpen = false;
      if (field !== 'text') v.limit = PAGE;
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return setChain;
});
