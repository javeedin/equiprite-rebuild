define(['vb/action/actionChain', 'resources/js/future/fxPage', 'resources/js/future/fxOps'], (ActionChain, fx, fxOps) => {
  'use strict';

  // A field of the confirmation typed in (data-field): keeps the value and works the preview out again (the payload
  // and what it would do follow what is typed; a refusal shown from the last Confirm goes, the preview says what is
  // still missing). The fields themselves (askDef) stay, so typing keeps its place.
  class fieldChain extends ActionChain {
    async run(context, { field, value }) {
      const $v = context.$page.variables;
      if (!field || !$v.askDef.open) return;
      const form = Object.assign({}, $v.form);
      form[field] = value;
      $v.form = form;
      $v.askError = '';
      $v.ask = fxOps.ask(fx.store.get(), $v.askDef.kind, $v.askDef.ids, form).preview;
    }
  }

  return fieldChain;
});
