define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // The searches and the transfer fields (inputs carry data-field).
  const FIELDS = { sourceQuery: true, destQuery: true, date: true, subinventory: true, locator: true, comments: true };

  class setFieldChain extends ActionChain {
    async run(context, { field, value }) {
      const { $page } = context;
      if (!FIELDS[field]) {
        return;
      }
      $page.variables[field] = value == null ? '' : String(value);
      if (field !== 'sourceQuery' && field !== 'destQuery') {
        $page.variables.saveError = '';
      }
    }
  }

  return setFieldChain;
});
