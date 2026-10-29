define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Discards pending edits. Cheap because matrixArray was never mutated —
  // clearing dirtyMap is enough to snap every row back to its server value.
  class cancelEditsChain extends ActionChain {

    async run(context) {
      const { $page } = context;
      $page.variables.dirtyMap = {};
    }
  }

  return cancelEditsChain;
});
