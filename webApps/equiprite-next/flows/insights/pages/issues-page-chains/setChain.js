define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // A field: a filter, the search, the new issue's form, a box of the write-up (edit.<field>), a tick.
  class setChain extends ActionChain {
    async run(context, { field, value }) {
      const v = context.$page.variables;
      if (!field) return;
      if (field.indexOf('edit.') === 0) { v.edit = Object.assign({}, v.edit || {}, { [field.slice(5)]: value == null ? '' : String(value) }); return; }
      if (field === 'dToJira' || field === 'emailMe') { v[field] = value === true || value === 'true'; return; }
      v[field] = value == null ? '' : String(value);
    }
  }
  return setChain;
});
