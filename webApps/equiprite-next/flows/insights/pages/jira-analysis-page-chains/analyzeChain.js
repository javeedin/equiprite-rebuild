define([
  'vb/action/actionChain',
  'resources/js/storyAnalysis',
  'resources/js/minutesClient',
  'resources/js/shellBus',
], (ActionChain, SA, M, bus) => {
  'use strict';

  // Asks the shared Ask AI to analyse the loaded story (with its sub-tasks, comments and the EquipRite screen list) into
  // the fixed headings, and renders the Markdown to HTML. Runs on page enter (after loadChain) and on the re-run button.
  class analyzeChain extends ActionChain {
    async run(context, { force }) {
      const v = context.$page.variables;
      if (!v.story || !v.story.key) return;
      if (v.analyzing) return;
      if (v.analysisHtml && !force) return; // already analysed; the button forces a re-run
      if (!v.aiReady) {
        try { const a = await M.aiSettings(); v.aiReady = !!(a.ok && a.body && a.body.active); } catch (e) { /* keep */ }
        if (!v.aiReady) return; // the page shows a "set up AI" hint instead
      }
      v.analyzing = true;
      try {
        const p = SA.prompt(v.story, v.pages, '');
        const r = await M.aiChat(p.system, p.user);
        if (r.ok && r.body && r.body.ok && r.body.text) {
          v.analysisHtml = SA.renderHtml(r.body.text);
          v.analysisProvider = r.body.provider || 'AI';
        } else {
          const err = (r.body && r.body.error) || '';
          if (/choose the llm|not set up/i.test(err)) { v.aiReady = false; }
          else bus.toast(err || 'AI could not analyse this story.', 'error');
        }
      } finally {
        v.analyzing = false;
      }
    }
  }

  return analyzeChain;
});
