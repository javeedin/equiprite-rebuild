define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Row click on the master grid → navigate to equipment-units page.
  //
  // controlType resolution (read from master record fetched by id, not from
  // the grid row — the SDP can return a stripped projection that omits flags):
  //   isSerialControlled === 'Y'   → 'SERIAL'    (renders the serial-refs table)
  //   isLotControlled    === 'Y'   → 'LOT'       (renders the lot-refs table)
  //   neither                       → 'INVENTORY' (renders the inventory-item-refs table)
  class RowClickChain extends ActionChain {
    async run(context, params) {
      // oj-table fires firstSelectedRowChanged PART WAY THROUGH its own
      // select-and-focus sequence. Navigating synchronously from here tore the
      // page down mid-sequence, and the dying table then tried to resolve the
      // key of a row whose data was already gone:
      //   TypeError: Cannot read properties of undefined (reading 'key')
      //     at GetKey / _fireBeforeSelectEvent / HandleSelectionOption
      // reported by VB as "Fatal exception delivering binding updates", which
      // aborts the rest of that binding-delivery cycle. Yield one macrotask so
      // the table finishes selecting before the route changes. Navigation
      // behaviour is unchanged.
      await new Promise(resolve => setTimeout(resolve, 0));

      const rowData = params.rowData;

      if (!rowData || !rowData.id) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Details Unavailable',
          message: 'Could not resolve the equipment master ID for this row.',
          type: 'warning',
          displayMode: 'transient'
        });
        return;
      }

      const masterResp = await Actions.callRest(context, {
        endpoint:  'eqp-v1/getEquipriteV1EquipmentMasterById',
        uriParams: { id: Number(rowData.id) }
      });

      if (!masterResp.ok || !masterResp.body) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Details Unavailable',
          message: 'Could not load equipment master details.',
          type: 'error',
          displayMode: 'transient'
        });
        return;
      }

      const master = masterResp.body;
      let controlType = 'INVENTORY';
      if (master.isSerialControlled === 'Y')      controlType = 'SERIAL';
      else if (master.isLotControlled === 'Y')    controlType = 'LOT';

      await Actions.navigateToPage(context, {
        page:   'equipment-units',
        params: {
          equipmentId: String(rowData.id),
          controlType: controlType
        }
      });
    }
  }

  return RowClickChain;
});
