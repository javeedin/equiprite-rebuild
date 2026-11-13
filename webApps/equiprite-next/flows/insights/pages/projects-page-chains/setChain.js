define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // A field typed in (the organization's form, the project's Git address).
  const FIELDS = ['oName', 'oUrl', 'oUser', 'oPass', 'pRepo', 'pName'];
  class setChain extends ActionChain {
    async run(context, { field, value }) {
      if (FIELDS.indexOf(field) === -1) return;
      context.$page.variables[field] = String(value || '');
    }
  }
  return setChain;
});
