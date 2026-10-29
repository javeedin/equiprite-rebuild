define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  class updateGridSelectionChain extends ActionChain {
    async run(context) {
      // gridSelection is two-way bound via selection="{{ $variables.gridSelection }}"
      // Nothing additional needed here.
    }
  }

  return updateGridSelectionChain;
});
