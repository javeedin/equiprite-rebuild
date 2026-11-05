define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // A filter: Current's own (status, epic, assignee, release, text), a check, an FDD section or a tester-gap row clicked
  // (field and value, with its label for the Showing chip), a finding clicked (its filter), or clear.
  const EMPTY = { text: '', status: '', epic: '', assignee: '', release: '', sprint: '', priority: '', type: '', check: '', only: '', fdd: '' };

  class filterChain extends ActionChain {
    async run(context, { field, value, label }) {
      const v = context.$page.variables;
      let f = JSON.parse(JSON.stringify(v.f || EMPTY));
      if (field === 'clear') {
        f = Object.assign({}, EMPTY);
        v.fLabel = '';
      } else if (field === 'finding') {
        const fd = ((v.analysis && v.analysis.findings) || [])[Number(value)];
        if (!fd) return;
        f = Object.assign({}, EMPTY, fd.filter || {});
        v.fLabel = fd.text;
      } else if (Object.prototype.hasOwnProperty.call(EMPTY, field)) {
        f[field] = value || '';
        if (label) v.fLabel = label;
        else if (['check', 'only', 'fdd'].indexOf(field) === -1 && !f.check && !f.only && !f.fdd) v.fLabel = '';
      } else {
        return;
      }
      v.f = f;
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return filterChain;
});
