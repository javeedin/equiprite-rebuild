define(['vb/action/actionChain', 'resources/js/future/fxPage', 'resources/js/future/fxRequests'], (ActionChain, fx, fxReq) => {
  'use strict';

  // Every action on this page through fxPage.act. Submit (data-act="createRequest") sends the form as fxRequests.payload
  // builds it; fxPage.act toasts what happened and opens the new request's tab (its result names it). Then the form
  // starts again for the same BU. When the engine refuses, its words stay on the page (failure) and nothing changes.
  class actChain extends ActionChain {
    async run(context, { data, type, payload }) {
      const pv = context.$page.variables;
      const submit = (data && data.act === 'createRequest') || type === 'createRequest';
      const body = submit ? fxReq.payload(fx.store.get(), pv.form) : payload;
      const res = fx.act({ data, type, payload: body });
      if (res && res.ok && submit) {
        const bu = (pv.v && pv.v.bu && pv.v.bu.name) || '';
        pv.form = fxReq.change(pv.form, 'reset');
        pv.failure = '';
        pv.sent = { id: res.result.id, number: res.result.number, bu: bu };
        pv.v = fxReq.form(fx.store.get(), pv.form);
      } else if (res && !res.ok && !res.cancelled) {
        pv.failure = res.error || 'It did not work.';
      }
    }
  }

  return actChain;
});
