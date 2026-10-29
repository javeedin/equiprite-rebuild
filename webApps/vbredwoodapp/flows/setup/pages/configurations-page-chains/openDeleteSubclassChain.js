define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

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

      const dlg = document.getElementById('subclassDeleteDialog');
      if (dlg) dlg.open();
    }
  }

  return openDeleteSubclassChain;
});
