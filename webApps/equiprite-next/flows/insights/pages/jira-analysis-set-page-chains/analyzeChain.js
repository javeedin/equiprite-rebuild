define([
  'vb/action/actionChain',
  'resources/js/storyAnalysisRun',
  'resources/js/minutesClient',
  'resources/js/shellBus',
], (ActionChain, R, M, bus) => {
  'use strict';

  // One analysis across the stories (with their activity, the chosen FDD's sections and the EquipRite screen list). The
  // re-run button forces it.
  class analyzeChain extends ActionChain {
    async run(context, { force }) {
      const v = context.$page.variables;
      if (!(v.stories || []).length || v.analyzing) return;
      if (v.analysisHtml && !force) return;
      if (!v.aiReady) {
        try { const a = await M.aiSettings(); v.aiReady = !!(a.ok && a.body && a.body.active); } catch (e) { /* keep */ }
        if (!v.aiReady) return;
      }
      const r = await R.analyzeSet(v, context.$application.path);
      if (!r.ok && r.error) bus.toast(r.error, 'error');
    }
  }
  return analyzeChain;
});
