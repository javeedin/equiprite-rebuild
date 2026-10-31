define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // Shows one of the request's tabs: flow (Approval & flow), equipment, money, accounting or history.
  class tabChain extends ActionChain {
    async run(context, { tab }) {
      const pv = context.$page.variables;
      if (['flow', 'equipment', 'money', 'accounting', 'history'].indexOf(tab) !== -1) pv.tab = tab;
      pv.exportOpen = false;
    }
  }

  return tabChain;
});
