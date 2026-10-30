define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/mobilePick',
  'resources/js/offlineSnapshot',
  'resources/js/currentUser',
], (ActionChain, Actions, mp, snapshot, cu) => {
  'use strict';

  // A stage chip (again: every stage), the yard (kept on this phone for this person), the search, a section shown or
  // hidden (Next's setChain), or the unit number being typed.
  class setChain extends ActionChain {
    async run(context, { field, value }) {
      const { $application } = context;
      const v = context.$page.variables;
      if (field === 'unit') {
        v.unitText = String(value || '');
        return;
      }
      if (field === 'text') v.text = String(value || '');
      if (field === 'stage') {
        v.stage = !value || value === v.stage ? 'all' : value;
        // A chip for pieces in a hidden section shows that section.
        if (v.stage === 'shipped' && v.collapsed && v.collapsed.done) v.collapsed = Object.assign({}, v.collapsed, { done: false });
      }
      if (field === 'yard') {
        v.yard = value || 'all';
        v.sheet = '';
        const user = cu.auditActor(context) || ($application.user || {}).username || '';
        mp.keep(snapshot, user, (k) => mp.withYard(k, v.yard));
      }
      if (field === 'collapse' && value) v.collapsed = Object.assign({}, v.collapsed, { [value]: !(v.collapsed || {})[value] });
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return setChain;
});
