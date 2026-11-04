define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The Redwood look's header over the open request (Oracle's general overview page): each of its actions does what the
  // current look's button does, through the same chain.
  //   back     its in-flow back: one request in front (focus) goes back to the screen that opened it here (focusBack),
  //            or, opened for it alone, to the whole queue; otherwise back to the queue (the panel closes)
  //   queue    Show the whole queue (focusAll)
  //   tab      Open in a tab (openRecordChain)
  //   new      In New: the same request on New EquipRite's Approve & allocate
  //   refresh  Refresh (the queue, and the open request read again)
  class rwActionChain extends ActionChain {
    async run(context, { id }) {
      const { $page, $application } = context;
      const v = $page.variables;
      const head = (v.rec && v.rec.head) || {};
      if (id === 'back') {
        if (v.focus && v.focus.number) {
          if (v.focus.label && v.focus.open) {
            await Actions.callChain(context, { chain: 'setChain', params: { field: 'focusBack', value: '' } });
            return;
          }
          await Actions.callChain(context, { chain: 'setChain', params: { field: 'focusAll', value: '' } });
        }
        await Actions.callChain(context, { chain: 'selectChain', params: { key: '' } });
        return;
      }
      if (id === 'queue') {
        await Actions.callChain(context, { chain: 'setChain', params: { field: 'focusAll', value: '' } });
        return;
      }
      if (id === 'tab') {
        await Actions.callChain(context, { chain: 'openRecordChain', params: { id: head.id != null ? String(head.id) : '', number: head.number || '' } });
        return;
      }
      if (id === 'new') {
        const url = $page.functions.newUrl($application.variables.appUrls && $application.variables.appUrls.new, head);
        if (url) window.location.assign(url);
        return;
      }
      if (id === 'refresh') {
        await Actions.callChain(context, { chain: 'loadChain', params: { refresh: true, reopen: true } });
      }
    }
  }

  return rwActionChain;
});
