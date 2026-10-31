define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Opens a request of the queue in the panel (key ''), or closes the panel (back to the queue on a narrow screen).
  // What was ticked, staged or half confirmed on the previous request is dropped with it.
  class selectChain extends ActionChain {
    async run(context, { key }) {
      const { $page } = context;
      const v = $page.variables;
      if (v.busy) return;
      const item = key ? (v.items || []).filter((i) => i.key === String(key))[0] : null;
      v.ticks = [];
      v.confirm = '';
      v.reason = '';
      v.formError = '';
      v.result = null;
      v.pickNote = '';
      v.picker = { lineId: '' };
      $page.functions.clearPicker();
      $page.functions.setSuggestions({});
      v.sugg = { loading: false, byLine: {}, plan: { count: 0, lines: [], none: [], label: '' } };
      if (!item) {
        v.current = { key: '' };
        v.rec = { loading: false, error: '', head: {}, rows: [], verdict: { tone: '', text: '', next: '' } };
        v.lines = [];
        return;
      }
      v.current = item;
      await Actions.callChain(context, { chain: 'recordChain', params: {} });
    }
  }

  return selectChain;
});
