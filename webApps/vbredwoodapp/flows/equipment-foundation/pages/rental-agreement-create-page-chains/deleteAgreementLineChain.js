define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Removes selected lines from the in-memory grid. For lines that have a
  // server-side lineId (i.e. they came from the DB on edit-mode load), we
  // record the id in deletedLineIds so saveAgreementChain can issue a
  // DELETE for each one at commit time. Lines added in this session
  // (no lineId yet) just get dropped — they were never persisted.
  //
  // This batches deletions with the rest of the save, matching the
  // existing chain's "commit everything on Save" semantics. If the user
  // clicks Cancel after deleting, no DELETE was issued — the agreement
  // is unchanged in the DB.
  class deleteAgreementLineChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const { updatedLines, deletedLines } = $page.functions.deleteSelectedLines(
        $page.variables.equipmentLines,
        $page.variables.gridSelection
      );

      // Collect the persisted IDs of removed lines so the next save
      // DELETEs them on the backend.
      const newlyDeletedIds = deletedLines
        .filter(line => line.lineId != null)
        .map(line => Number(line.lineId));

      if (newlyDeletedIds.length > 0) {
        const existing = $page.variables.deletedLineIds || [];
        $page.variables.deletedLineIds = existing.concat(newlyDeletedIds);
      }

      $page.variables.equipmentLines = updatedLines;
      $page.variables.dataGridProvider = $page.functions.initGridData(updatedLines);
      $page.variables.gridSelection = [];

      if (deletedLines.length > 0) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Lines Removed',
          message: 'Removed ' + deletedLines.length + ' line(s). Click Save to commit.',
          displayMode: 'transient',
          type: 'confirmation',
        });
      }
    }
  }

  return deleteAgreementLineChain;
});
