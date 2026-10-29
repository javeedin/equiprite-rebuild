define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/openDeleteSubclassChain.js. Unchanged except the
  // dialog: the confirmation is the page's confirm card (confirmChain runs the delete on OK).

  // Trash affordance on a subclass grid row: stash the row as the delete target
  // (id + classId + name for the path and the confirm message) and open the
  // confirm dialog. The actual delete runs from deleteSubclassChain on confirm.
  class openDeleteSubclassChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const { id } = params || {};
      if (id == null) return;

      const row = ($page.variables.AllSubclassesArray || [])
        .find(r => Number(r.id) === Number(id));
      if (!row) return;

      $page.variables.DeleteSubclassTarget = {
        id:           Number(row.id),
        classId:      row.classId != null ? Number(row.classId) : null,
        subclassName: row.subclassName || ''
      };

      $page.variables.confirm = {
        kind: 'deleteSubclass',
        section: 'classes',
        title: 'Delete subclass',
        okLabel: 'Delete',
        danger: true,
        message: 'Delete subclass "' + $page.variables.DeleteSubclassTarget.subclassName + '"? '
          + 'This deactivates it: it is hidden from the list but kept for history.'
      };
    }
  }

  return openDeleteSubclassChain;
});
