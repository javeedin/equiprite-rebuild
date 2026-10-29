define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // "Delete Class" button by the class selector: stash the currently-selected
  // class as the delete target and open the confirm dialog. The delete (with the
  // active-subclass guard) runs from deleteClassChain on confirm.
  // The Class Mapping grid passes the row's id instead of using the selection.
  class openDeleteClassChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const rowId = params && params.id;
      const id = rowId != null && rowId !== '' ? rowId : $page.variables.EquipmentClassSelectedId;
      if (id == null || id === '') return;

      // Resolve the class name from the LOV for the confirm message.
      const lov = $page.variables.EquipmentClassConfigLovArray || [];
      const match = lov.find(c => Number(c.value) === Number(id));
      const className = (match && match.label)
        || $page.variables.EquipmentClassSelectedName
        || 'this class';

      $page.variables.DeleteClassTarget = {
        id: Number(id),
        className: className
      };

      const dlg = document.getElementById('classDeleteDialog');
      if (dlg) dlg.open();
    }
  }

  return openDeleteClassChain;
});
