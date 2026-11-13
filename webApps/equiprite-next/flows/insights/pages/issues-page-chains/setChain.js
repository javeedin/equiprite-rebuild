define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // A field: a filter, the search, the new issue's form, a box of the write-up (edit.<field>), a detail (det.<field>:
  // severity, customer, …), a tick.
  class setChain extends ActionChain {
    async run(context, { field, value }) {
      const v = context.$page.variables;
      if (!field) return;
      if (field.indexOf('edit.') === 0) { v.edit = Object.assign({}, v.edit || {}, { [field.slice(5)]: value == null ? '' : String(value) }); return; }
      if (field.indexOf('det.') === 0) { v.det = Object.assign({}, v.det || {}, { [field.slice(4)]: value == null ? '' : String(value) }); return; }
      if (field === 'dToJira' || field === 'emailMe' || field === 'cEmail' || field === 'allowOld') { v[field] = value === true || value === 'true'; return; }
      // another build for the new issue: its page is chosen again, from that build's pages
      if (field === 'dApp') { const app = value == null ? '' : String(value); if (app !== v.dApp) { v.dPage = ''; v.pickQ = ''; } v.dApp = app; return; }
      v[field] = value == null ? '' : String(value);
    }
  }
  return setChain;
});
