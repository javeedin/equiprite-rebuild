define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class openTransactionDrawerChain extends ActionChain {
    async run(context, { rowIndex } = {}) {
      const { $page } = context;

      // Default the material issue to a line so the picker is never blank on open.
      // A material issue is recorded against ONE line (that is what sets consumed
      // quantity). Preference order:
      //   1. rowIndex - the row whose Actions (hamburger) button was clicked. This is
      //      the authoritative one: the drawer is opened FROM a row, so that row is
      //      what the user means. Row selection checkboxes are a separate gesture and
      //      are usually untouched when they click Actions.
      //   2. exactly one row checkbox-selected -> that line
      //   3. neither -> the first line on the request, so the picker is never blank
      const allLines = ($page.functions.getAllLines && $page.functions.getAllLines()) || [];
      const selected = ($page.functions.getSelectedLines && $page.functions.getSelectedLines()) || [];

      let presetLine = null;
      if (rowIndex != null && allLines[rowIndex]) {
        presetLine = allLines[rowIndex];
      } else if (selected.length === 1) {
        presetLine = selected[0];
      } else {
        presetLine = allLines[0] || null;
      }

      $page.variables.transactionData = {
        expenditure_type: 'Equipment Usage',
        organization: 'Texas Operations',
        raw_cost_amount: 0,
        post_immediate_raw_cost: false,
        narrative_comments: null,
        oracle_item_number: null,
        quantity_issued: 0,
        unit_of_measure: 'EA',
        request_line_id: presetLine ? presetLine.lineId : null,
        subinventory_code: null
      };

      $page.variables.materialIssueLine = {
        lineId:        presetLine ? presetLine.lineId : null,
        equipmentName: presetLine ? presetLine.equipmentName : null,
        lineStatus:    presetLine ? presetLine.lineStatus : null,
        requestedQty:  presetLine ? presetLine.quantity : null,
        unitType:      null,
        onhandQty:     null,
        unitsLoading:  false,
        unitCount:     0,
        // Computed here, not in a binding: `new Date()` inside a VBCS expression
        // has zero precedent anywhere in this app (141 ADPs, 0 uses) and the
        // expression sandbox is not guaranteed to expose constructors.
        transactionDate: $page.functions.formatDate(new Date().toISOString())
      };
      $page.variables.materialIssueUnitsArray = [];

      // 16b = Material Issue. Set explicitly on every open so the drawer always
      // lands on Material Issue, not just the first time - the variable's default
      // only applies once, and a previous visit to Expense Details would otherwise
      // stick for the rest of the session.
      $page.variables.activeTransactionTab = '16b';
      $page.variables.isTransactionDrawerOpen = true;

      // Resolve item number / UOM / org / on-hand for the preset line.
      if (presetLine) {
        await Actions.callChain(context, { chain: 'loadMaterialIssueLineChain' });
      }
    }
  }

  return openTransactionDrawerChain;
});
