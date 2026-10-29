define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Cancel/close the Edit Line dialog — discard edits (nothing was persisted)
  // and clear the editing row.
  class CloseEditLineChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const dialog = document.getElementById('editLineDialog');
      if (dialog && typeof dialog.close === 'function') dialog.close();
      $page.variables.editLineRowIndex = -1;
    }
  }

  return CloseEditLineChain;
});
