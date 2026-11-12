define([
  'vb/action/actionChain',
  'resources/js/storyAnalysisRun',
  'resources/js/fddClient',
  'resources/js/fddIndex',
  'resources/js/shellBus',
], (ActionChain, R, FC, FI, bus) => {
  'use strict';

  // The FDD on the analysis: open/close the FDD menu, pick another FDD (or none) — which re-runs the analysis on it —,
  // show the text of a section the AI read (a chip under the analysis), and open the FDD library.
  class fddChain extends ActionChain {
    async run(context, { act, id, i }) {
      const v = context.$page.variables;
      const base = context.$application.path;
      if (act === 'menu') { v.fddMenu = !v.fddMenu; return; }
      if (act === 'library') { v.fddMenu = false; bus.open({ navId: 'fdd-library' }); return; }
      if (act === 'close') { v.fddView = null; return; }
      if (act === 'pick') {
        v.fddMenu = false;
        const next = String(id || '');
        if (next === v.fddId && v.analysisHtml) return;
        v.fddId = next; v.fddChosen = true; v.fddView = null;
        if (!v.aiReady || !(v.story || (v.stories || []).length)) return;
        const r = await R.rerun(v, base);
        if (!r.ok && r.error) bus.toast(r.error, 'error');
        return;
      }
      if (act === 'view') {
        const p = (v.fddPicked || [])[parseInt(i, 10)];
        const d = ((v.fddLib && v.fddLib.docs) || []).filter((x) => x.id === v.fddId)[0];
        if (!p || !d) return;
        if (v.fddView && v.fddView.i === String(i)) { v.fddView = null; return; }
        const r = await FC.doc(base, d.id, d.uploadedAt);
        const s = r.ok ? FI.section(r.body, p.n || p.t) : null;
        v.fddView = s ? { i: String(i), n: s.n, t: s.t, x: s.x, parent: s.parent, why: p.why } : null;
      }
    }
  }
  return fddChain;
});
