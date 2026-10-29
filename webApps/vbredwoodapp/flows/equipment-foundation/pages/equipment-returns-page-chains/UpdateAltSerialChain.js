define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  class UpdateAltSerialChain extends ActionChain {
    async run(context, { event }) {
      const { $page } = context;
      const lineId = event.target.id.replace('alt-serial-', '');
      const value  = event.target.value;
      const updated = Object.assign({}, $page.variables.exceptionAltSerials);
      updated[lineId] = value;
      $page.variables.exceptionAltSerials = updated;
    }
  }

  return UpdateAltSerialChain;
});
