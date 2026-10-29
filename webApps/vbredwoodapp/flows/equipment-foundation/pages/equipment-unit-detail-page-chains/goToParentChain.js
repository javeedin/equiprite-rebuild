define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Back goes to the units grid this unit was opened from, not to the master
  // list - equipmentId/controlType are carried in the URL for exactly this.
  class goToParentChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const equipmentId = $page.variables.equipmentId;

      if (!equipmentId) {
        await Actions.navigateToPage(context, { page: 'equipment-master' });
        return;
      }

      await Actions.navigateToPage(context, {
        page: 'equipment-units',
        params: {
          equipmentId: String(equipmentId),
          controlType: $page.variables.controlType || 'SERIAL'
        }
      });
    }
  }

  return goToParentChain;
});
