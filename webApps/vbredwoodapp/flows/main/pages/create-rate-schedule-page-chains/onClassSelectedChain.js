define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class onClassSelectedChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const classId = $page.variables.currentLine.classId;

      if (!classId) {
        $page.variables.subclassesArray = [];
        $page.variables.currentLine.subclassId = null;
        return;
      }

      const resp = await Actions.callRest(context, {
        endpoint: 'eqp-v1/getEquipmentSubclassesByClassId',
        uriParams: { classId: classId },
      });

      if (resp.ok) {
        $page.variables.subclassesArray = (resp.body.data || []).map(item => ({
          value: item.id,
          label: item.subclassName,
        }));
      } else {
        $page.variables.subclassesArray = [];
      }

      $page.variables.currentLine.subclassId = null;
      $page.variables.currentLine.equipmentName = null;
      $page.variables.equipmentNamesArray = [];
      await Actions.callChain(context, { chain: 'loadEquipmentNamesChain' });
    }
  }

  return onClassSelectedChain;
});
