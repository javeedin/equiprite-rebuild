define(['vb/action/actionChain', 'resources/js/future/fxPage'], (ActionChain, fx) => {
  'use strict';

  // Every action on this page: a clicked element's data-act and data-… attributes ({ data }: Play as …), or the
  // confirmation's action and payload ({ type, payload, fromAsk }). fxPage.act runs it through the store and toasts what
  // happened or the error. A failure stays in words: in the dialog (askError) and on the page (failure) until an
  // action works or it is dismissed. The page refreshes through fxRefresh.
  class actChain extends ActionChain {
    async run(context, { data, type, payload, fromAsk }) {
      const $v = context.$page.variables;
      const what = fromAsk ? $v.askDef.title : '';
      const res = fx.act({ data, type, payload: payload ? JSON.parse(JSON.stringify(payload)) : payload });
      if (!res || res.cancelled) return;
      if (res.ok) {
        $v.failure = { text: '', what: '' };
        if (fromAsk) {
          $v.askError = '';
          $v.askDef = { open: false, kind: '', ids: {}, kicker: '', title: '', sub: '', confirm: '', tone: 'primary', fields: [] };
        }
      } else {
        $v.failure = { text: res.error || 'It did not go through.', what };
        if (fromAsk) $v.askError = res.error || 'It did not go through.';
      }
    }
  }

  return actChain;
});
