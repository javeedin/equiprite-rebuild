define(['vb/action/actionChain', 'resources/js/future/fxPage', 'resources/js/future/fxOps'], (ActionChain, fx, fxOps) => {
  'use strict';

  // Opens an action's confirmation (data-ask="ship" | "return" | "inspect" with data-request-id and data-line-id, or
  // "repair" with data-unit-id): what
  // EquipRite does, the money, what Fusion would do and who is told, from a dry run of the engine (fxOps.ask). Nothing
  // changes until Confirm. { close: true } closes it.
  class askChain extends ActionChain {
    async run(context, { data, close }) {
      const $v = context.$page.variables;
      $v.exportOpen = '';
      if (close) {
        $v.askError = '';
        $v.askDef = { open: false, kind: '', ids: {}, kicker: '', title: '', sub: '', confirm: '', tone: 'primary', fields: [] };
        return;
      }
      const d = data || {};
      const ids = {};
      Object.keys(d).forEach((k) => { if (k !== 'ask') ids[k] = d[k]; });
      const a = fxOps.ask(fx.store.get(), d.ask, ids, null);
      $v.form = a.form;
      $v.ask = a.preview;
      $v.askError = '';
      $v.askDef = a.def;
    }
  }

  return askChain;
});
