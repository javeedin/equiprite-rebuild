define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/deleteClassChain.js. Unchanged except the
  // dialog: it closes the page's confirm card where the old chain closed the dialog.

  // Soft-delete an equipment class (backend sets EFFECTIVE_END_DATE). GUARDED:
  // the backend returns HTTP 409 with a readable `detail` if the class still has
  // active subclasses — we surface that message verbatim so the user knows to
  // remove the subclasses first. Reads the confirmed target from
  // DeleteClassTarget; on success resets the selection and reloads.
  class deleteClassChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const target = $page.variables.DeleteClassTarget || {};
      const id = target.id;
      if (id == null) return;

      const result = await Actions.callRest(context, {
        endpoint: 'eqp-v1/deleteEquipmentClass',
        uriParams: { id: Number(id) }
      });

      $page.variables.confirm = null;

      if (result.ok || result.statusCode === 404) {
        // Clear the class filter (the deleted class is the selected one) and reload.
        $page.variables.EquipmentClassSelectedId = null;
        $page.variables.EquipmentClassSelectedName = '';
        $page.variables.EquipmentSubclassSelectedId = null;
        await Actions.callChain(context, { chain: 'loadEquipmentClassesChain' });
        await Actions.fireNotificationEvent(context, {
          summary: 'Class deleted',
          message: 'Deleted "' + (target.className || 'class') + '".',
          displayMode: 'transient', type: 'confirmation'
        });
      } else if (result.statusCode === 409) {
        // Guard: active subclasses remain. Show the backend's exact guidance.
        const detail = (result.body && result.body.detail)
          || 'This class still has active subclasses. Remove them first.';
        await Actions.fireNotificationEvent(context, {
          summary: 'Cannot delete class',
          message: detail,
          displayMode: 'transient', type: 'error'
        });
      } else {
        const detail = (result.body && result.body.detail)
          || (result.body && JSON.stringify(result.body))
          || ('status ' + result.statusCode);
        await Actions.fireNotificationEvent(context, {
          summary: 'Could not delete class',
          message: 'Failed to delete "' + (target.className || 'class') + '". ' + detail,
          displayMode: 'transient', type: 'error'
        });
      }
    }
  }

  return deleteClassChain;
});
