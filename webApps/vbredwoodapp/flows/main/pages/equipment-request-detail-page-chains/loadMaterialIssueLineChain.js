define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Auto-fills the Material Issue drawer from the selected request LINE.
  //
  // Why a fetch is needed at all: the request line carries NO inventory item
  // reference — EQR_REQUEST_LINE.EQR_INVENTORY_ITEM_REF_ID / EQR_LOT_REF_ID /
  // EQP_INV_ORG_ID are null on every line (verified live), so the item number
  // cannot be read off the line. views/line-detail-units resolves it instead:
  // one row per physical unit (INVENTORY / LOT / SERIAL) of the line's equipment
  // master, each carrying unitNumber + uomCode + invOrgName + availableToReserve.
  //
  // That gives the drawer four auto-filled fields (item number, UOM,
  // organization, on-hand) that the user previously had to type from memory.
  //
  // Single unit  -> auto-filled outright.
  // Several units -> the picker is populated and the first is preselected; the
  //                  user narrows it. Still a constrained choice, never free text.
  class loadMaterialIssueLineChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const lineId = $page.variables.transactionData && $page.variables.transactionData.request_line_id;
      const requestId = $page.variables.requestNumericId || $page.variables.requestId;

      if (lineId == null || lineId === '' || requestId == null) {
        $page.variables.materialIssueUnitsArray = [];
        return;
      }

      // Line context from the grid's own row refs — same objects the table shows,
      // so the drawer can never disagree with the row the user picked.
      const refs = ($page.functions.getAllLines && $page.functions.getAllLines()) || [];
      const ref = refs.find(l => String(l.lineId) === String(lineId));

      $page.variables.materialIssueLine = Object.assign({}, $page.variables.materialIssueLine, {
        lineId:        lineId,
        equipmentName: ref ? ref.equipmentName : null,
        lineStatus:    ref ? ref.lineStatus : null,
        requestedQty:  ref ? ref.quantity : null,
        unitsLoading:  true
      });

      let rows = [];
      try {
        const res = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getEquipriteV1ViewsLineDetailUnits',
          uriParams: { requestId: Number(requestId), lineId: Number(lineId), size: 10000 }
        });
        if (res && res.ok) {
          rows = (res.body && res.body.data) || [];
        } else {
          console.warn('[loadMaterialIssueLine] line-detail-units failed', res && res.statusCode);
        }
      } catch (e) {
        // Non-fatal: the drawer stays usable, the user just types the item number.
        console.warn('[loadMaterialIssueLine] line-detail-units error', e);
      }

      // Write the ARRAY, not the provider - see initChain note.
      $page.variables.materialIssueUnitsArray = rows.map(u => ({
        value: u.unitNumber,
        label: u.unitNumber
          + (u.availableToReserve != null ? '  (on hand ' + u.availableToReserve + ')' : '')
          + (u.invOrgName ? '  - ' + u.invOrgName : ''),
        uomCode: u.uomCode,
        invOrgName: u.invOrgName,
        // carried so the manual material issue can persist INV_ORG_ID, matching
        // what the auto-consume path on acceptDeliveryChain writes. The drawer only
        // displays the org NAME, which is not what the consumption row stores.
        invOrgId: u.invOrgId,
        unitType: u.unitType,
        availableToReserve: u.availableToReserve
      }));

      const first = rows[0];

      // Auto-fill only fields the user has not already typed over, so re-picking
      // a line does not silently discard their edits.
      const td = Object.assign({}, $page.variables.transactionData);
      if (first) {
        if (!td.oracle_item_number) td.oracle_item_number = first.unitNumber || null;
        if (first.uomCode)          td.unit_of_measure   = first.uomCode;
        if (first.invOrgName)       td.organization      = first.invOrgName;
      }
      $page.variables.transactionData = td;

      $page.variables.materialIssueLine = Object.assign({}, $page.variables.materialIssueLine, {
        unitType:     first ? first.unitType : null,
        onhandQty:    first ? first.availableToReserve : null,
        unitCount:    rows.length,
        unitsLoading: false
      });
    }
  }

  return loadMaterialIssueLineChain;
});
