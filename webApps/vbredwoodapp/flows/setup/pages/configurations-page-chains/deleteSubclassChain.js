define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Soft-delete a subclass (backend sets EFFECTIVE_END_DATE; the GET then hides
  // ended rows). Reads the confirmed target from DeleteSubclassTarget, calls
  // DELETE /equipment-classes/{classId}/subclasses/{id}, closes the confirm
  // dialog, and reloads the grid so the row disappears.
  class deleteSubclassChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const target = $page.variables.DeleteSubclassTarget || {};
      const id = target.id;
      let classId = target.classId;

      if (id == null) return;
      if (classId == null) {
        const src = ($page.variables.AllSubclassesArray || [])
          .find(r => Number(r.id) === Number(id));
        classId = src ? src.classId : null;
      }
      if (classId == null) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Could not delete',
          message: 'Missing parent class for this subclass.',
          displayMode: 'transient', type: 'error'
        });
        return;
      }

      const result = await Actions.callRest(context, {
        endpoint: 'eqp-v1/deleteSubclass',
        uriParams: { classId: Number(classId), id: Number(id) }
      });

      const dlg = document.getElementById('subclassDeleteDialog');
      if (dlg) dlg.close();

      // 404 = already ended (someone else deleted it): treat as success — reload
      // will simply not show it.
      if (result.ok || result.statusCode === 404) {
        await Actions.callChain(context, { chain: 'loadEquipmentClassesChain' });
        await Actions.fireNotificationEvent(context, {
          summary: 'Subclass deleted',
          message: 'Deleted "' + (target.subclassName || 'subclass') + '".',
          displayMode: 'transient', type: 'confirmation'
        });
      } else {
        const detail = (result.body && result.body.detail)
          || (result.body && JSON.stringify(result.body))
          || ('status ' + result.statusCode);
        await Actions.fireNotificationEvent(context, {
          summary: 'Could not delete',
          message: 'Failed to delete "' + (target.subclassName || 'subclass') + '". ' + detail,
          displayMode: 'transient', type: 'error'
        });
      }
    }
  }

  return deleteSubclassChain;
});
