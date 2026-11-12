define(['vb/action/actionChain', 'resources/js/shellBus'], (ActionChain, bus) => {
  'use strict';

  // The AI icon beside an item's key: its analysis in a tab of its own — the saved one (with when it ran), or a new run.
  class aiOpenChain extends ActionChain {
    async run(context, { key }) {
      const k = String(key || '');
      if (k) bus.open({ record: 'jira-analysis', params: { key: k } });
    }
  }
  return aiOpenChain;
});
