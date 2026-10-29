define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Billing is withdrawn when EXTERNAL_PROJECT_ASSIGN_ENABLED is on: external requests then bill through the assigned
  // internal project. From Old EquipRite's customer-my-billing-page-chains/externalProjectAssignGuardChain.js, with the
  // same accessor (isFeatureFlagOff, so "flags still loading" never counts as allowed). Two changes: it waits briefly
  // for the flags, and it sends the customer to the portal home rather than to the role's landing page, which for a
  // customer-only sign-in is a staff screen. Same copy in both billing pages.
  class billingGuardChain extends ActionChain {
    async run(context) {
      const { $application } = context;
      for (let i = 0; i < 60 && !$application.variables.flagsLoaded; i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      const allowed = $application.functions.isFeatureFlagOff(
        $application.variables.featureFlags,
        $application.variables.flagsLoaded,
        'EXTERNAL_PROJECT_ASSIGN_ENABLED'
      );
      if (allowed) {
        return true;
      }

      await Actions.fireNotificationEvent(context, {
        summary: 'Billing unavailable',
        message: 'Billing for external requests is handled through the assigned project.',
        displayMode: 'transient',
        type: 'warning'
      });
      await Actions.navigateToPage(context, { page: 'customer-home' });
      return false;
    }
  }

  return billingGuardChain;
});
