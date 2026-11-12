define(['vb/action/actionChain', 'vb/action/actions', 'resources/js/shellBus'], (ActionChain, Actions, bus) => {
  'use strict';

  // A Jira story handed this (already open) screen a page: open its sheet (and say which story asked, to map it).
  class focusChain extends ActionChain {
    async run(context) {
      const handed = bus.takeFocus('app-pages');
      if (!handed || !handed.id) return;
      const v = context.$page.variables;
      v.q = ''; v.appF = 'all'; v.onlyMapped = false; v.onlySheet = false;
      if (handed.story) v.mapKey = handed.story;
      await Actions.callChain(context, { chain: 'selectChain', params: { id: handed.id } });
    }
  }
  return focusChain;
});
