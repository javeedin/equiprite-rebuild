define([
  'vb/action/actionChain',
  'vb/action/actions',
  'vb/action/actionUtils',
], (
  ActionChain,
  Actions,
  ActionUtils
) => {
  'use strict';

  class initPageChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      
      // Load demo data into the DataGrid
      const provider = await $page.functions.initProviderFromData();
      $page.variables.dataGridProvider = provider;
      
      // Set some summary values
      $page.variables.totalHours = 40;
      $page.variables.billAmount = 6000;
      $page.variables.headerStatus = 'SUBMITTED';
    }
  }

  return initPageChain;
});
