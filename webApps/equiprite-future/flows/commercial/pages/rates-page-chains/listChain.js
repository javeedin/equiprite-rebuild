define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The list's search box and chips, the export menus, and Try a rate's row and inputs. Nothing here calls the server.
  class listChain extends ActionChain {
    async run(context, { action, value }) {
      const { $page } = context;
      const v = $page.variables;
      if (action === 'search') {
        v.listText = value == null ? '' : String(value);
        await Actions.callChain(context, { chain: 'applyChain' });
      } else if (action === 'chip') {
        v.listChip = value && value !== v.listChip ? String(value) : 'all';
        await Actions.callChain(context, { chain: 'applyChain' });
      } else if (action === 'exportMenu') {
        v.exportOpen = v.exportOpen === value ? '' : String(value || '');
      } else if (action === 'simGroup') {
        v.simGroup = value ? String(value) : '';
      } else if (action === 'hours' || action === 'daysWorked' || action === 'daysOnRent' || action === 'qty') {
        const n = Number(value);
        v.sim = Object.assign({}, v.sim, { [action]: isNaN(n) || n < 0 ? 0 : n });
      }
    }
  }

  return listChain;
});
