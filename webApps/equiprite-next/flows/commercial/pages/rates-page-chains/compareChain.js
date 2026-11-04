define([
  'vb/action/actionChain',
  'resources/js/shellBus',
], (ActionChain, bus) => {
  'use strict';

  // Compare schedules: opens Compare rates (its own tab), with the open schedule as the base when one is open.
  class compareChain extends ActionChain {
    async run(context) {
      const id = String(context.$page.variables.selectedId || '');
      bus.focus('rate-compare', /^\d+$/.test(id) ? { base: id } : {});
    }
  }

  return compareChain;
});
