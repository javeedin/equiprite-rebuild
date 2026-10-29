define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/clearClassFilterChain.js, unchanged.

  // Reset the Equipment Classes tab filters (class + subclass) back to "show all".
  // Delegates to applyClassFilterChain with a null classId, which clears both the
  // selected class and the dependent subclass filter/LOV in one place.
  class clearClassFilterChain extends ActionChain {
    async run(context) {
      await Actions.callChain(context, {
        chain: 'applyClassFilterChain',
        params: { classId: null }
      });
    }
  }

  return clearClassFilterChain;
});
