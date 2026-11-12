define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/jiraBacklog',
  'resources/js/shellBus',
], (ActionChain, Actions, J, bus) => {
  'use strict';

  // A story on the left: open/close its details (its images are read the first time), or analyse it alone in its own tab.
  class storyChain extends ActionChain {
    async run(context, { act, key }) {
      const v = context.$page.variables;
      const k = String(key || '');
      if (act === 'alone') { if (k) bus.open({ record: 'jira-analysis', params: { key: k } }); return; }
      if (act !== 'open') return;
      if (v.open === k) { v.open = ''; return; }
      v.open = k; v.actTab = 'all';
      const s = (v.stories || []).filter((x) => x.key === k)[0];
      if (!s || !(s.attachments || []).some((a) => a.image)) return;
      const got = await J.loadImages(context, Actions, JSON.parse(JSON.stringify(s)));
      v.images = Object.assign({}, v.images || {}, got);
    }
  }
  return storyChain;
});
