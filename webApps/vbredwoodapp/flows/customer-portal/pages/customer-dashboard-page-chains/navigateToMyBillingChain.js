define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class navigateToMyBillingChain extends ActionChain {

    async run(context) {
      const { $application } = context;

      // Belt-and-braces with the tile's own oj-bind-if: the card is not rendered
      // when EXTERNAL_PROJECT_ASSIGN_ENABLED is on (external requests bill
      // through the assigned internal project), but this chain is also reachable
      // from a stale listener binding, so refuse rather than route to a page
      // whose guard would immediately bounce the user back.
      const allowed = $application.functions.isFeatureFlagOff(
        $application.variables.featureFlags,
        $application.variables.flagsLoaded,
        'EXTERNAL_PROJECT_ASSIGN_ENABLED'
      );
      if (!allowed) {
        console.warn('[navigateToMyBillingChain] refusing to navigate —'
          + ' EXTERNAL_PROJECT_ASSIGN_ENABLED is on, billing runs through the'
          + ' assigned project');
        return;
      }

      await Actions.navigateToPage(context, { page: 'customer-my-billing' });
    }
  }

  return navigateToMyBillingChain;
});
