define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Discards pending edits (the old cancelEditsChain): matrixArray was never mutated, so clearing dirtyMap snaps
  // every row back to its server value.
  class cancelEditsChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      $page.variables.dirtyMap = {};
      $page.variables.saveError = '';
    }
  }

  return cancelEditsChain;
});
