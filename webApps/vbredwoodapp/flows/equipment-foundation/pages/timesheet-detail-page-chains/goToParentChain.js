define([
  'vb/action/actionChain',
  'vb/action/actions',
  'vb/action/actionUtils',
], (
  ActionChain,
  Actions,
  ActionUtils
) => {
  'use strict';

  class goToParentChain extends ActionChain {

    /**
     * @param {Object} context
     */
    async run(context) {
      await Actions.navigateToPage(context, {
        page: 'equipment-timesheets',
      });
    }
  }

  return goToParentChain;
});
