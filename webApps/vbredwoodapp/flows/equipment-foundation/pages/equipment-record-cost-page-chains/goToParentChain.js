define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Back goes to the unit this cost was being recorded against.
  class goToParentChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const serialRefId = $page.variables.serialRefId;

      if (!serialRefId) {
        await Actions.navigateToPage(context, { page: 'equipment-master' });
        return;
      }

      await Actions.navigateToPage(context, {
        page: 'equipment-unit-detail',
        params: {
          equipmentId: String($page.variables.equipmentId || ''),
          serialRefId: String(serialRefId),
          controlType: $page.variables.controlType || 'SERIAL'
        }
      });
    }
  }

  return goToParentChain;
});
