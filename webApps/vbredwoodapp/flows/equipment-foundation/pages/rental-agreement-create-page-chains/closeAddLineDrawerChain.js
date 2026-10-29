define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  class closeAddLineDrawerChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      $page.variables.isAddLineDrawerOpen = false;
      // Field names mirror the JSON default and what the form bindings + chains use:
      // classId / subclassId (not equipmentClassId / equipmentSubclassId).
      // Earlier mismatch meant the close-reset wasn't actually clearing the
      // form-bound fields — keep this consistent or selections leak between
      // openings of the drawer.
      $page.variables.currentLine = {
        classId:           null,
        className:         '',
        subclassId:        null,
        subclassName:      '',
        equipmentMasterId: null,
        equipmentName:     '',
        description:       '',
        unitPrice:         null,
        priceUom:          'DAY'
      };
    }
  }

  return closeAddLineDrawerChain;
});
