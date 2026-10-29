define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Trash affordance on a mapping row: stash the row as the delete target and
  // open the confirm dialog. The delete itself runs from deleteExpTypeMapChain.
  //
  // Deletion is a HARD delete -- the table has no soft-delete column, because a
  // soft-deleted row would keep occupying the unique key and block re-adding the
  // same type to the same equipment. So it is worth a confirmation even though
  // re-authoring is cheap.
  class openDeleteExpTypeMapChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const { id } = params || {};
      if (id == null) return;

      const row = ($page.variables.ExpTypeMapAllArray || [])
        .find(r => Number(r.eqrExpTypeMapId) === Number(id));
      if (!row) return;

      $page.variables.DeleteExpTypeMapTarget = {
        id:              Number(row.eqrExpTypeMapId),
        scopeName:       row.scopeName || '',
        expenditureType: row.expenditureType || '',
        isDefault:       row.isDefault || 'N'
      };

      const dlg = document.getElementById('expTypeMapDeleteDialog');
      if (dlg) dlg.open();
    }
  }

  return openDeleteExpTypeMapChain;
});
