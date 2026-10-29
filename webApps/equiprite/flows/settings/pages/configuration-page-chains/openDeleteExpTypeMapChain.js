define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/openDeleteExpTypeMapChain.js. Unchanged except the
  // dialog: the confirmation is the page's confirm card (confirmChain runs the delete on OK).

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

      $page.variables.confirm = {
        kind: 'deleteExpType',
        section: 'exp-types',
        title: 'Remove mapping',
        okLabel: 'Remove',
        danger: true,
        message: 'Stop offering "' + $page.variables.DeleteExpTypeMapTarget.expenditureType + '" for "'
          + $page.variables.DeleteExpTypeMapTarget.scopeName + '"? Timesheets already saved keep the type they recorded. '
          + 'If this was the last mapping for that equipment, its picker goes back to showing every type the project may be charged under.'
      };
    }
  }

  return openDeleteExpTypeMapChain;
});
