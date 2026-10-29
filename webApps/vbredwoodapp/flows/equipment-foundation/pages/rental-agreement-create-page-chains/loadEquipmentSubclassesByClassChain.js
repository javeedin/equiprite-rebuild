define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class loadEquipmentSubclassesByClassChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const classId = $page.variables.currentLine.classId;

      $page.variables.equipmentSubclassesArray = [];
      $page.variables.equipmentNamesArray = [];
      $page.variables.currentLine.subclassId = null;
      $page.variables.currentLine.subclassName = '';
      $page.variables.currentLine.equipmentMasterId = null;
      $page.variables.currentLine.equipmentName = '';

      if (!classId) return;

      const result = await Actions.callRest(context, {
        endpoint: 'eqp-v1/getEquipmentSubclassesByClassId',
        uriParams: { classId: classId }
      });

      if (!result || !result.body || !result.body.data) {
        console.warn('[load-subclasses] no data returned');
        return;
      }

      $page.variables.equipmentSubclassesArray = result.body.data
        .filter(s => s != null)
        .map(s => ({
          value: s.id,
          label: s.subclassName || s.subclassCode || String(s.id)
        }));

      await Actions.callChain(context, { chain: 'loadEquipmentNamesByClassChain' });
    }
  }

  return loadEquipmentSubclassesByClassChain;
});
