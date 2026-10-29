define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class loadEquipmentNamesChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const classId = $page.variables.currentLine.classId;
      const subclassId = $page.variables.currentLine.subclassId;

      // The eqp-v1 openapi declares these query params as equipmentClassId /
      // equipmentSubclassId (NOT classId / subclassId). VBCS only forwards
      // params whose names match the spec, so the old names were dropped and
      // the backend returned every master regardless of class/subclass.
      const queryParams = { equipmentClassId: classId, size: 200 };
      if (subclassId != null) {
        queryParams.equipmentSubclassId = subclassId;
      }

      const resp = await Actions.callRest(context, {
        endpoint: 'eqp-v1/getEquipriteV1EquipmentMaster',
        queryParams: queryParams,
      });

      if (resp.ok) {
        $page.variables.equipmentNamesArray = (resp.body.data || []).map(item => ({
          value: item.equipmentName,
          label: item.equipmentName,
        }));
      } else {
        $page.variables.equipmentNamesArray = [];
      }
    }
  }

  return loadEquipmentNamesChain;
});
