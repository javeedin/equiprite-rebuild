define([
  'vb/action/actionChain',
  'resources/js/storyAnalysisRun',
  'resources/js/minutesClient',
  'resources/js/shellBus',
], (ActionChain, R, M, bus) => {
  'use strict';

  // Asks the shared Ask AI to analyse the loaded story (with its sub-tasks, comments, the chosen FDD's sections and the
  // EquipRite screen list) into the fixed headings, and renders the Markdown to HTML. The re-run button forces it.
  class analyzeChain extends ActionChain {
    async run(context, { force }) {
      const v = context.$page.variables;
      if (!v.story || !v.story.key || v.analyzing) return;
      if (v.analysisHtml && !force) return; // already analysed; the button forces a re-run
      if (!v.aiReady) {
        try { const a = await M.aiSettings(); v.aiReady = !!(a.ok && a.body && a.body.active); } catch (e) { /* keep */ }
        if (!v.aiReady) return; // the page shows a "set up AI" hint instead
      }
      const r = await R.analyze(v, context.$application.path);
      if (!r.ok && r.error) bus.toast(r.error, 'error');
    }
  }

  return analyzeChain;
});
