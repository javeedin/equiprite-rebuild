define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // vbBeforeExit: unsaved agreement changes are lost on leaving, so ask first. { cancelled: true } keeps the page.
  // Save and Cancel clear `dirty` before they navigate.
  class BeforeExitChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      if ($page.variables.dirty && !$page.variables.saving
          && !window.confirm('Leave without saving?\n\nYour changes to this agreement are not saved.')) {
        return { cancelled: true };
      }
      return undefined;
    }
  }

  return BeforeExitChain;
});
