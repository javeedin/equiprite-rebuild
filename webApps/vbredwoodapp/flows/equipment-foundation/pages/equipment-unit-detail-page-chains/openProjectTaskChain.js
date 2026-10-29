define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // "Edit Project & Task" - opens #projectTaskDialog on the unit's current
  // values. Opened by id, like the Attachments dialog.
  class openProjectTaskChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const unit = $page.variables.unit || {};
      $page.variables.ptForm = {
        projectNumber: unit.projectNumber || '',
        taskNumber: unit.taskNumber || ''
      };
      $page.variables.ptError = '';
      const dlg = document.getElementById('projectTaskDialog');
      if (dlg) dlg.open();
    }
  }

  return openProjectTaskChain;
});
