define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/orderForm',
], (ActionChain, Actions, order) => {
  'use strict';

  // Moves between the three steps, as New EquipRite's goStepChain: back is always allowed; forward checks each step on
  // the way (orderForm.missingFor: 1 the dates and the equipment, 2 the project, task, customer and delivery) and lists
  // what is missing instead of moving. Arriving at the Project step lists the customers and projects (searchChain).
  // Review (3) is reviewChain: it checks both, finds the delivery point and prices every line again for the project
  // and the nearest yard.
  class goStepChain extends ActionChain {
    async run(context, { step }) {
      const v = context.$page.variables;
      const to = Math.min(3, Math.max(1, Number(step) || 1));
      const from = Number(v.step) || 1;
      if (to === 3 && from !== 3) {
        await Actions.callChain(context, { chain: 'reviewChain', params: { to: 'review' } });
        return;
      }
      if (to > from) {
        const missing = order.missingFor(from, v.form, v.cart);
        if (missing.length) {
          v.missing = missing;
          return;
        }
      }
      v.missing = [];
      v.saveError = '';
      v.step = to;
      v.mode = to === 3 ? 'review' : 'build';
      // The Project step lists the customers and projects from their BIP reports straight away (nothing to type
      // first); not awaited, so the step shows at once.
      if (to === 2) {
        const f = v.form || {};
        if (f.customerId == null || f.customerId === '') {
          Actions.callChain(context, { chain: 'searchChain', params: { kind: 'customer', text: '' } });
        }
        if (!f.projectId) {
          Actions.callChain(context, { chain: 'searchChain', params: { kind: 'project', text: '' } });
        }
      }
      try {
        // The top of this tab's page (another tab can hold a New request too; it is hidden).
        const shown = Array.prototype.filter.call(document.querySelectorAll('.nx-order'), (el) => el.offsetParent !== null)[0];
        if (shown) shown.scrollIntoView({ block: 'start', behavior: 'smooth' });
      } catch (e) { /* not in a browser */ }
    }
  }

  return goStepChain;
});
