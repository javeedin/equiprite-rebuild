define([
  'resources/js/storyAnalysis',
  'resources/js/minutesClient',
  'resources/js/fddClient',
  'resources/js/fddIndex',
], function (SA, M, FC, FI) {
  'use strict';

  // "Analyze with AI" (flows/insights jira-analysis page), the steps its chains share: the FDD library and which FDD is
  // chosen (the latest, unless the person picked another), the FDD sections for the story (or for a chat question), and
  // one analysis run through the shared Ask AI. Works on the page's variables (v) directly.
  //
  //   library(v, base)           v.fddLib, v.fddOptions and v.fddId (the latest; a pick that is still in the library stays)
  //   fddFor(v, base, question)  { name, text, picked } for v.fddId, or null when no FDD is chosen
  //   analyze(v, base)           runs the analysis into v.analysisHtml / v.analysisProvider / v.fddPicked → { ok, error }

  async function library(v, base) {
    const r = await FC.library(base);
    const lib = r.body || { latest: '', docs: [] };
    v.fddLib = lib;
    v.fddOptions = FI.options(lib);
    // a choice made on this tab (another FDD, or none) stays while that FDD is still in the library
    const keep = v.fddChosen && (!v.fddId || lib.docs.some((d) => d.id === v.fddId));
    if (!keep) v.fddId = lib.latest || '';
    return lib;
  }

  async function fddFor(v, base, question) {
    const lib = v.fddLib || {};
    const d = (lib.docs || []).filter((x) => x.id === v.fddId)[0];
    if (!d) return null;
    const r = await FC.doc(base, d.id, d.uploadedAt);
    if (!r.ok) return { name: FI.label(d), text: '', picked: [], error: (r.body && r.body.error) || 'Could not read the FDD.' };
    const p = FI.pick(r.body, v.story, { question: question || '', budget: question ? 18000 : 30000 });
    return { name: FI.label(d), text: p.text, picked: p.picked };
  }

  async function analyze(v, base) {
    if (!v.story || !v.story.key || v.analyzing) return { ok: false };
    v.analyzing = true;
    try {
      const f = await fddFor(v, base, '');
      v.fddPicked = f ? f.picked : [];
      v.fddNote = !f ? '' : f.error ? f.error : (f.picked.length ? '' : 'Nothing in this FDD matched the story, so the analysis reads only the story.');
      v.fddView = null;
      const p = SA.prompt(v.story, v.pages, f && f.text ? { name: f.name, text: f.text } : '');
      const r = await M.aiChat(p.system, p.user);
      if (r.ok && r.body && r.body.ok && r.body.text) {
        v.analysisHtml = SA.renderHtml(r.body.text);
        v.analysisProvider = r.body.provider || 'AI';
        v.analysisFdd = f && f.text ? f.name : '';
        return { ok: true };
      }
      const err = (r.body && r.body.error) || '';
      if (/choose the llm|not set up/i.test(err)) { v.aiReady = false; return { ok: false }; }
      return { ok: false, error: err || 'AI could not analyse this story.' };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    } finally {
      v.analyzing = false;
    }
  }

  return { library: library, fddFor: fddFor, analyze: analyze };
});
