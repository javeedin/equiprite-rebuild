define([
  'vb/action/actionChain',
  'vb/action/actions',
  'vb/action/actionUtils',
], (ActionChain, Actions) => {
  'use strict';

  class SubmitCheckoutChain extends ActionChain {
    async run(context) {
      const { $flow } = context;

      // Simulate a network delay for submitting the cart
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Clear the cart
      $flow.variables.CartItemsArray = [];

      // Notify the user of success
      await Actions.fireNotificationEvent(context, {
        summary: 'Checkout Complete',
        message: 'Your rental contract has been successfully submitted.',
        type: 'confirmation'
      });

      // Navigate back to the dashboard or catalog
      await Actions.navigateToPage(context, {
        page: 'customer-dashboard'
      });
    }
  }

  return SubmitCheckoutChain;
});
