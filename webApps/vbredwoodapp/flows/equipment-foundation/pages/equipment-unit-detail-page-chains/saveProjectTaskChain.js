define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/unitProjectStore',
], (ActionChain, Actions, ups) => {
  'use strict';

  // Saves the unit's project and task. There are no backend columns yet, so
  // this writes to this browser only (resources/js/unitProjectStore.js) and
  // lays the values over the unit so Overview updates at once; Record Cost
  // reads the same store. A task means nothing without its project, so it is
  // both or neither - both blank clears the assignment.
  class saveProjectTaskChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const form = $page.variables.ptForm || {};
      const projectNumber = String(form.projectNumber || '').trim();
      const taskNumber = String(form.taskNumber || '').trim();

      if (!!projectNumber !== !!taskNumber) {
        $page.variables.ptError = 'Enter both a project number and a task number, or clear both.';
        return;
      }
      $page.variables.ptError = '';

      const controlType = ($page.variables.controlType || 'SERIAL').toUpperCase();
      ups.save(controlType, $page.variables.serialRefId, projectNumber, taskNumber);
      $page.variables.unit = Object.assign({}, $page.variables.unit, { projectNumber, taskNumber });

      const dlg = document.getElementById('projectTaskDialog');
      if (dlg) dlg.close();

      await Actions.fireNotificationEvent(context, {
        summary: projectNumber ? 'Project & task saved' : 'Project & task cleared',
        message: projectNumber ? projectNumber + ' / ' + taskNumber : '',
        type: 'confirmation',
        displayMode: 'transient'
      });
    }
  }

  return saveProjectTaskChain;
});
