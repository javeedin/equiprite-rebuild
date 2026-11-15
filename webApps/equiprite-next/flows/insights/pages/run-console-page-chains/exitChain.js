define(['vb/action/actionChain', 'resources/js/runConsoleView'], (ActionChain, RC) => {
  'use strict';

  // The Run console closed: its log no longer read.
  class exitChain extends ActionChain {
    async run() { RC.stop(); }
  }
  return exitChain;
});
