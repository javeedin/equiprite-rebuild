define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // The list's search box and chips, and the simulator's inputs. Nothing here calls the server.
  class listChain extends ActionChain {
    async run(context, { action, value }) {
      const { $page } = context;
      const v = $page.variables;
      if (action === 'search') {
        v.listText = value == null ? '' : String(value);
      } else if (action === 'chip') {
        v.listChip = value && value !== v.listChip ? String(value) : 'all';
      } else if (action === 'hours' || action === 'daysWorked' || action === 'daysOnRent' || action === 'qty') {
        const n = Number(value);
        v.sim = Object.assign({}, v.sim, { [action]: isNaN(n) || n < 0 ? 0 : n });
      }
    }
  }

  return listChain;
});
