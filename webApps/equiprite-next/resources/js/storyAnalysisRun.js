define([
  'resources/js/storyAnalysis',
  'resources/js/minutesClient',
  'resources/js/fddClient',
  'resources/js/fddIndex',
], function (SA, M, FC, FI) {
  'use strict';

  // "Analyze with AI" (flows/insights jira-analysis and jira-analysis-set pages), the steps their chains share: the FDD
  // library and which FDD is chosen (the latest, unless the person picked another), the FDD sections for the story — or
  // for a set of stories, or for a chat question —, and one analysis run through the shared Ask AI. Works on the page's
  // variables (v) directly: v.story on the one-story page, v.stories on the set page.
  //
  //   library(v, base)                         v.fddLib, v.fddOptions and v.fddId (the latest; a pick still in the library stays)
  //   merged(stories)                          one story-shaped object for a set: every FDD section any of them names, all
  //                                            their words (what the FDD sections are picked by)
  //   fddFor(v, base, question, story, budget) { name, text, picked } for v.fddId, or null when no FDD is chosen
  //   analyze(v, base)                         one story → v.analysisHtml / v.analysisProvider / v.fddPicked → { ok, error }
  //   analyzeSet(v, base)                      the same for v.stories, analysed together
  //   rerun(v, base)                           whichever of the two this page is
  //   chatSet(v, base, question, history)      a follow-up question about the set → { ok, text, error }

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

  function merged(stories) {
    const list = stories || [];
    const refs = [];
    list.forEach((s) => (s.fdd || []).forEach((r) => { if (refs.indexOf(r) === -1) refs.push(r); }));
    const join = (k) => list.map((s) => s[k] || '').filter(Boolean).join('\n');
    return { key: list.map((s) => s.key).join(','), fdd: refs, summary: join('summary'), ac: join('ac'), body: join('body'), epicName: join('epicName') };
  }

  async function fddFor(v, base, question, story, budget) {
    const lib = v.fddLib || {};
    const d = (lib.docs || []).filter((x) => x.id === v.fddId)[0];
    if (!d) return null;
    const r = await FC.doc(base, d.id, d.uploadedAt);
    if (!r.ok) return { name: FI.label(d), text: '', picked: [], error: (r.body && r.body.error) || 'Could not read the FDD.' };
    const p = FI.pick(r.body, story || v.story, { question: question || '', budget: budget || (question ? 18000 : 30000) });
    return { name: FI.label(d), text: p.text, picked: p.picked };
  }

  // One analysis: the FDD sections for `story`, the prompt `build` makes with them, the shared Ask AI, the HTML.
  async function run(v, base, story, build, budget) {
    if (!story || v.analyzing) return { ok: false };
    v.analyzing = true;
    try {
      const f = await fddFor(v, base, '', story, budget);
      v.fddPicked = f ? f.picked : [];
      v.fddNote = !f ? '' : f.error ? f.error : (f.picked.length ? '' : 'Nothing in this FDD matched, so the analysis reads only the Jira stories.');
      v.fddView = null;
      const p = build(f && f.text ? { name: f.name, text: f.text } : '');
      const r = await M.aiChat(p.system, p.user);
      if (r.ok && r.body && r.body.ok && r.body.text) {
        v.analysisHtml = SA.renderHtml(r.body.text);
        v.analysisProvider = r.body.provider || 'AI';
        v.analysisFdd = f && f.text ? f.name : '';
        return { ok: true };
      }
      const err = (r.body && r.body.error) || '';
      if (/choose the llm|not set up/i.test(err)) { v.aiReady = false; return { ok: false }; }
      return { ok: false, error: err || 'AI could not analyse this.' };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    } finally {
      v.analyzing = false;
    }
  }

  function analyze(v, base) {
    if (!v.story || !v.story.key) return Promise.resolve({ ok: false });
    return run(v, base, v.story, (f) => SA.prompt(v.story, v.pages, f));
  }

  function analyzeSet(v, base) {
    const list = v.stories || [];
    if (!list.length) return Promise.resolve({ ok: false });
    return run(v, base, merged(list), (f) => SA.promptSet(list, v.pages, f), 40000);
  }

  function rerun(v, base) { return Array.isArray(v.stories) ? analyzeSet(v, base) : analyze(v, base); }

  async function chatSet(v, base, question, history) {
    let f = null;
    try { f = await fddFor(v, base, question, merged(v.stories), 20000); } catch (e) { f = null; }
    const p = SA.chatPromptSet(v.stories, history, question, f && f.text ? { name: f.name, text: f.text } : '');
    const r = await M.aiChat(p.system, p.user);
    if (r.ok && r.body && r.body.ok && r.body.text) return { ok: true, text: r.body.text };
    return { ok: false, error: (r.body && r.body.error) || 'AI could not answer.' };
  }

  return { library: library, merged: merged, fddFor: fddFor, analyze: analyze, analyzeSet: analyzeSet, rerun: rerun, chatSet: chatSet };
});
