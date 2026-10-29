define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  class addTimeEntryRowChain extends ActionChain {
    async run(context) {
      // TODO: Open drawer to select DEPLOYED request line + hours type, then POST time-entry
      console.log('[addTimeEntryRowChain] Add row not yet implemented for equipment timesheets');
    }
  }

  return addTimeEntryRowChain;
});
