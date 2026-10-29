define([
  'vb/action/actionChain',
  'resources/js/taskDataProvider',
], (ActionChain, taskDataProvider) => {
  'use strict';

  // Close the Project Split drawer, discarding the in-progress edit. Nothing has
  // been persisted at this point -- saveSplitChain is the only writer -- so the
  // group row still shows whatever was last applied.
  class closeSplitDrawerChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      $page.variables.isSplitDrawerOpen = false;
      $page.variables.splitSlices = [];
      $page.variables.splitFormError = '';
      $page.variables.splitTaskError = '';
      $page.variables.splitPickProjectId     = null;
      $page.variables.splitPickProjectName   = '';
      $page.variables.splitPickProjectNumber = '';
      $page.variables.splitPickTaskId        = null;
      $page.variables.splitPickTaskName      = '';
      $page.variables.splitPickTaskNumber    = '';
      $page.variables.splitPickPct           = null;
      $page.variables.splitTasksDp      = taskDataProvider.emptyTaskDataProvider();
      $page.variables.splitTaskTree     = {};
      $page.variables.splitTasksCacheKey = '';
    }
  }

  return closeSplitDrawerChain;
});
