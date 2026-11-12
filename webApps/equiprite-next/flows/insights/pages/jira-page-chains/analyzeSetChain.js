define([
  'vb/action/actionChain',
  'resources/js/shellBus',
], (ActionChain, bus) => {
  'use strict';

  // "Analyze with AI" for several stories: the stories shown on Jira stories (the current filter), analysed together in a tab of their own (jira-analysis-set). One story
  // opens the one-story analysis; more than 25 asks to narrow them first.
  const MAX = 25;
  class analyzeSetChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const keys = (v.shown || []).map((r) => String(r.key || '')).filter(Boolean);
      if (!keys.length) { bus.toast('No stories are shown.', 'error'); return; }
      if (keys.length > MAX) { bus.toast('That is ' + keys.length + ' stories: ' + 'filter them' + ' to ' + MAX + ' or fewer to analyse them together.', 'error'); return; }
      if (keys.length === 1) { bus.open({ record: 'jira-analysis', params: { key: keys[0] } }); return; }
      bus.open({ record: 'jira-analysis-set', params: { keys: keys.join(',') } });
    }
  }
  return analyzeSetChain;
});
