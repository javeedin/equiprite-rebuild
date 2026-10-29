define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class SaveChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const formData = $page.variables.formData;

      console.log('--- SAVING NEW EQUIPMENT ---');
      console.log('Form Data:', JSON.stringify(formData, null, 2));

      // In a real app, we'd call a REST API here.
      // For this demo, we simulate success and return to the list.
      
      await Actions.navigateToPage(context, {
        page: 'equipment-master'
      });
    }
  }

  return SaveChain;
});
