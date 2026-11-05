define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/jiraBacklog'
], (ActionChain, Actions, J) => {
  'use strict';

  // What to read: a preset chip (key: jiraBacklog.PRESETS) puts its JQL in the box and reads it; Run (key '') reads the
  // JQL typed, its chip lit when it is a preset's. A new read drops the finding picked: it was about the old one.
  class queryChain extends ActionChain {
    async run(context, { key }) {
      const { $page } = context;
      const v = $page.variables;
      if (key) {
        const preset = J.PRESETS.filter((p) => p.key === key)[0];
        if (!preset) return;
        v.preset = preset.key;
        v.jql = preset.jql;
      } else {
        const typed = ('' + (v.jql || '')).trim();
        const same = J.PRESETS.filter((p) => p.jql === typed)[0];
        v.preset = same ? same.key : '';
      }
      v.pick = {};
      v.pickLabel = '';
      await Actions.callChain(context, { chain: 'loadJiraChain' });
    }
  }

  return queryChain;
});
