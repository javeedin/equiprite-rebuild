define(['vb/action/actionChain', 'resources/js/shellBus'], (ActionChain, bus) => {
  'use strict';

  // "Analyze with AI" on the open story (sprint tab): opens the jira-analysis tab for that story key.
  class openAnalysisChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const key = String(v.selKey || '').trim();
      if (!key) { bus.toast('Open a story first.', 'error'); return; }
      v.selKey = ''; // close the (modal) drawer so the new tab is on top
      bus.open({ record: 'jira-analysis', params: { key: key } });
    }
  }
  return openAnalysisChain;
});
