define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/recordCostMock',
  'resources/js/unitProjectStore',
], (ActionChain, Actions, rc, ups) => {
  'use strict';

  // Reads the unit and its master - the same two GETs the serial page makes -
  // only to pre-fill the forms (serial, org, subinventory, expenditure org).
  // Project and task are the unit's own, set with "Edit Project & Task" on the
  // serial page and read here from the same store (unitProjectStore.js); this
  // page shows them but does not edit them. The page is a POC, so a failed
  // read still opens it with blank defaults rather than bouncing.
  class vbEnterChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const serialRefId = $page.variables.serialRefId;
      const controlType = ($page.variables.controlType || 'SERIAL').toUpperCase();

      $page.variables.isLoading = true;

      let unit = {};
      let master = {};
      if (serialRefId) {
        try {
          // The three unit id spaces are disjoint - ask the table the id came
          // from (same switch as equipment-unit-detail-page vbEnterChain).
          const endpoint =
            controlType === 'LOT'       ? 'eqp-v1/getLotRefById'           :
            controlType === 'INVENTORY' ? 'eqp-v1/getInventoryItemRefById' :
                                          'eqp-v1/getSerialRefById';
          const uResp = await Actions.callRest(context, {
            endpoint,
            uriParams: { id: Number(serialRefId) }
          });
          if (uResp.ok && uResp.body) unit = uResp.body;
        } catch (e) {
          console.warn('[record-cost] unit lookup failed:', e);
        }
      }

      const masterId = unit.equipmentId || $page.variables.equipmentId;
      if (masterId) {
        try {
          const mResp = await Actions.callRest(context, {
            endpoint:  'eqp-v1/getEquipriteV1EquipmentMasterById',
            uriParams: { id: Number(masterId) }
          });
          if (mResp.ok && mResp.body) master = mResp.body;
        } catch (e) {
          console.warn('[record-cost] master lookup failed:', e);
        }
      }

      unit = ups.apply(unit, controlType, serialRefId);

      const ctx = rc.buildContext(unit, master, {
        serialRefId: serialRefId,
        equipmentId: $page.variables.equipmentId,
        controlType: controlType
      });

      $page.variables.ctx = ctx;
      $page.variables.pageSubtitle = [ctx.serialNumber, ctx.equipmentName].filter(Boolean).join(' · ');
      $page.variables.projectForm       = rc.projectDefaults(ctx);
      $page.variables.rawCostForm       = rc.defaults('rawCost', ctx);
      $page.variables.materialIssueForm = rc.defaults('materialIssue', ctx);
      $page.variables.expenseReportForm = rc.defaults('expenseReport', ctx);
      $page.variables.apInvoiceForm     = rc.defaults('apInvoice', ctx);
      $page.variables.isLoading = false;
    }
  }

  return vbEnterChain;
});
