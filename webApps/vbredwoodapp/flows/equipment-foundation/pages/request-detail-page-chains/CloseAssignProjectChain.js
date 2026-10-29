define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  /**
   * Cancel/close the Assign Project drawer, discarding the staged selection.
   *
   * Clearing the staged ids matters: they are page-scoped and survive the
   * drawer closing, so leaving them set would make the next open show the
   * abandoned pick rather than what the request actually carries. The
   * assignProject branch of ActionChain re-seeds them from the saved values on
   * every open.
   */
  class CloseAssignProjectChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      $page.variables.isAssignProjectOpen = false;
      $page.variables.assignProjectId     = null;
      $page.variables.assignProjectName   = '';
      $page.variables.assignProjectNumber = '';
      $page.variables.assignTaskId        = null;
      $page.variables.assignTaskName      = '';
      $page.variables.assignTaskNumber    = '';
    }
  }

  return CloseAssignProjectChain;
});
