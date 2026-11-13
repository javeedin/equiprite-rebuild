define(['vb/action/actionChain', 'resources/js/shellBus'], (ActionChain, bus) => {
  'use strict';

  // Daily progress: what moved in Jira day by day (closed, new, moved, touched, by whom), in a tab of its own
  // (insights/jira-progress).
  class openProgressChain extends ActionChain {
    async run() {
      bus.open({ record: 'jira-progress', params: {} });
    }
  }
  return openProgressChain;
});
