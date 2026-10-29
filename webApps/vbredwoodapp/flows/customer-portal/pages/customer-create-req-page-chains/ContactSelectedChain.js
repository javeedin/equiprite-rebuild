define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  class ContactSelectedChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const data = params && params.data;

      if (!data || data.id == null) {
        $page.variables.formData.requestorId   = null;
        $page.variables.formData.requestorName = '';
        return;
      }

      $page.variables.formData.requestorId   = Number(data.id);
      $page.variables.formData.requestorName = data.contactName || '';
    }
  }

  return ContactSelectedChain;
});
