define(['vb/action/actionChain', 'resources/js/future/fxPage', 'resources/js/future/fxSetup'], (ActionChain, fx, fxSetup) => {
  'use strict';

  // Every action on this page: a clicked element's data-act and data-… ({ data }: setRelation, setSetting on a switch
  // or a choice, setPersona), or { type, payload } a page function built from the drafts (setAgreementRate, a number
  // setting). fxPage.act runs it through the store and toasts what happened or the engine's refusal; a refusal also
  // stays on the page in words (failure). Once saved, the drafts under `clear` go.
  class actChain extends ActionChain {
    async run(context, { data, type, payload, clear }) {
      const pv = context.$page.variables;
      const res = fx.act({ data, type, payload });
      if (res && res.cancelled) return;
      pv.failure = res && !res.ok ? (res.error || 'That did not work.') : '';
      if (res && res.ok && clear) pv.drafts = fxSetup.dropDrafts(pv.drafts, clear);
    }
  }

  return actChain;
});
