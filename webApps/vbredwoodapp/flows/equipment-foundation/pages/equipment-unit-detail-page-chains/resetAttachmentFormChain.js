define([
  'vb/action/actionChain',
  'resources/js/equipmentAttachments',
], (ActionChain, ea) => {
  'use strict';

  // Clears the add form: fields, picked file and every inline error.
  //
  //   mode 'add'   "Add attachment" - a clean form
  //   mode 'list'  Cancel - discard the form, back to the list
  //   (no mode)    reset only; the caller decides the view
  //
  // Dates start empty: whether they exist at all depends on the category,
  // and attCategoryChangedChain fills them in when one that needs them is
  // picked.
  class resetAttachmentFormChain extends ActionChain {
    async run(context, { mode }) {
      const { $page } = context;
      ea.setPendingFile(null);
      $page.variables.attFileInfo = {};
      $page.variables.attForm = { name: '', category: null, validFrom: null, validTo: null, notes: '' };
      $page.variables.attNeedsDates = false;
      $page.variables.attErrors = {};
      $page.variables.attNotice = {};
      $page.variables.attConfirmRemoveId = null;
      if (mode === 'add' || mode === 'list') {
        $page.variables.attViewer = {};
        $page.variables.attMode = mode;
      }
    }
  }

  return resetAttachmentFormChain;
});
