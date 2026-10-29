define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class addAgreementLineChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const line = $page.variables.currentLine;

      if (!line.classId) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Incomplete Entry',
          message: 'Please select an Equipment Class before adding a line.',
          displayMode: 'transient',
          type: 'error'
        });
        return;
      }

      if (line.unitPrice == null || line.unitPrice <= 0) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Invalid Rate',
          message: 'Rate must be greater than 0.',
          displayMode: 'transient',
          type: 'error'
        });
        return;
      }

      // Prevent adding the same equipment twice. A line is a duplicate when it
      // points at the same equipment master record as an existing line.
      if (line.equipmentMasterId != null) {
        const isDuplicate = ($page.variables.equipmentLines || [])
          .some(l => Number(l.equipmentMasterId) === Number(line.equipmentMasterId));
        if (isDuplicate) {
          await Actions.fireNotificationEvent(context, {
            summary: 'Duplicate Equipment',
            message: 'This equipment is already on the agreement. The same equipment cannot be added twice.',
            displayMode: 'transient',
            type: 'error'
          });
          return;
        }
      }

      const classMatch    = ($page.variables.equipmentClassesArray    || []).find(c => c.value === line.classId);
      const subclassMatch = ($page.variables.equipmentSubclassesArray || []).find(s => s.value === line.subclassId);
      const equipMatch    = ($page.variables.equipmentNamesArray      || []).find(e => Number(e.value) === Number(line.equipmentMasterId));

      // Pick a lineNumber that doesn't collide with any existing line on
      // this agreement. UK_EQR_AGR_LINE_NUM is (header_id, line_number),
      // so we need max(existing) + 1 — NOT array.length + 1, because line
      // numbers from the DB can have gaps (lines were deleted earlier) or
      // not start at 1.
      const existingNumbers = ($page.variables.equipmentLines || [])
        .map(l => Number(l.lineNumber) || 0);
      const nextLineNumber = (existingNumbers.length > 0 ? Math.max.apply(null, existingNumbers) : 0) + 1;

      const newLine = {
        lineNumber:              nextLineNumber,
        equipmentClassId:        line.classId,
        equipmentClassName:      classMatch    ? classMatch.label    : (line.className    || ''),
        equipmentSubclassId:     line.subclassId || null,
        equipmentSubclassName:   subclassMatch ? subclassMatch.label : (line.subclassName || ''),
        equipmentMasterId:       line.equipmentMasterId != null ? Number(line.equipmentMasterId) : null,
        equipmentName:           equipMatch ? equipMatch.label : (line.equipmentName || ''),
        description:             line.description || '',
        unitPrice:               line.unitPrice,
        priceUom:                line.priceUom || 'DAY'
      };

      $page.variables.equipmentLines = [...$page.variables.equipmentLines, newLine];
      $page.variables.dataGridProvider = $page.functions.initGridData($page.variables.equipmentLines);

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
      $page.variables.isAddLineDrawerOpen = false;

      await Actions.fireNotificationEvent(context, {
        summary: 'Line Added',
        message: 'Equipment line added to the agreement.',
        displayMode: 'transient',
        type: 'confirmation'
      });

      console.log('[add-line] total lines:', $page.variables.equipmentLines.length);
    }
  }

  return addAgreementLineChain;
});
