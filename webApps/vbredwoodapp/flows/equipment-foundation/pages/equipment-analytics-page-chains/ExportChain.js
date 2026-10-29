define([
  'vb/action/actionChain',
  'vb/action/actions',
], (
  ActionChain,
  Actions
) => {
  'use strict';

  class ExportChain extends ActionChain {

    /**
     * Handles the Export CSV Register secondary action.
     * @param {Object} context
     */
    async run(context) {
      console.log('[Equipment Analytics] Export CSV Register clicked — stub action (no REST).');
    }
  }

  return ExportChain;
});
