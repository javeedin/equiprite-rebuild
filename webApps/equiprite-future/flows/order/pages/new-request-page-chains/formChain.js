define(['vb/action/actionChain', 'resources/js/future/fxPage', 'resources/js/future/fxRequests'], (ActionChain, fx, fxReq) => {
  'use strict';

  // A choice on the form (the BU, what it is for, the task, the dates, the class, a unit added or removed, a step):
  // the form changes and the steps are shown again. Reads the store only; Submit (actChain) is what raises the request.
  class formChain extends ActionChain {
    async run(context, { field, value }) {
      const pv = context.$page.variables;
      if (!field) return;
      const base = (pv.v && pv.v.form) || pv.form || {};
      const next = fxReq.change(base, field, value);
      pv.failure = '';
      pv.exportOpen = false;
      if (field !== 'step') pv.sent = null;
      try {
        const v = fxReq.form(fx.store.get(), next);
        pv.form = v.form;
        pv.v = v;
      } catch (e) {
        pv.form = next;
        pv.v = Object.assign({}, pv.v, { error: 'New request could not be shown: ' + ((e && e.message) || e) });
      }
    }
  }

  return formChain;
});
