define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // vbBeforeExit: unsaved schedule changes are lost on leaving, so ask first. { cancelled: true } keeps the page.
  class BeforeExitChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      if ($page.variables.dirty && !window.confirm('Leave Rate schedules?\n\nYour changes to '
          + ($page.variables.formData.scheduleName || 'the schedule') + ' are not saved.')) {
        return { cancelled: true };
      }
      return undefined;
    }
  }

  return BeforeExitChain;
});
