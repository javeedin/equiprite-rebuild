define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class loadEquipmentNamesByClassChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const classId = $page.variables.currentLine.classId;
      const subclassId = $page.variables.currentLine.subclassId;

      $page.variables.equipmentNamesArray = [];
      // Reset both — the masterId is the bound value, equipmentName is the display label
      $page.variables.currentLine.equipmentMasterId = null;
      $page.variables.currentLine.equipmentName = '';

      if (!classId) return;

      // The eqp-v1 openapi declares these query params as equipmentClassId /
      // equipmentSubclassId (NOT classId / subclassId). VBCS only forwards
      // params whose names match the spec, so the old names were dropped and
      // the backend returned every master regardless of class/subclass.
      const queryParams = { equipmentClassId: classId, size: 200 };
      if (subclassId != null) {
        queryParams.equipmentSubclassId = subclassId;
      }

      const result = await Actions.callRest(context, {
        endpoint: 'eqp-v1/getEquipriteV1EquipmentMaster',
        queryParams: queryParams,
      });

      if (!result || !result.body || !result.body.data) {
        console.warn('[load-equip-names] no data returned');
        return;
      }

      // value MUST be the numeric master id (e.id) so saveAgreementChain
      // can persist it as EQR_EQUIPMENT_MASTER_ID. The agreement-line
      // table doesn't store the equipment name — display names come back
      // via the view's JOIN through master_id on read. If we save the
      // name as the value (the previous bug), the master_id stays null
      // and the view returns blank subClassName / equipmentName.
      $page.variables.equipmentNamesArray = result.body.data
        .filter(e => e != null && e.id != null)
        .map(e => ({
          value: Number(e.id),
          label: e.equipmentName || String(e.id)
        }));
    }
  }

  return loadEquipmentNamesByClassChain;
});
