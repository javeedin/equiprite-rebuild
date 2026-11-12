define([
  'resources/js/storyAnalysis',
  'resources/js/minutesClient',
  'resources/js/fddClient',
  'resources/js/fddIndex',
  'resources/js/analysisStore',
  'resources/js/pagesClient',
  'resources/js/pageSheet',
], function (SA, M, FC, FI, AS, PC, PS) {
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
  //   keyOf(v)                                 where this page's analysis is saved: the story's key, or the set's
  //   restore(v)                               shows the last saved run (its text, FDD, sections read, chat, when and by
  //                                            whom) instead of asking the AI → true, or false when there is none
  //   saveChat(v)                              keeps the conversation with the saved analysis
  // Every successful run is saved (analysisStore), so the tab opens on it next time and the Jira lists mark the story.

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

  /** The technical sheets of the pages the story (or any story of the set) is mapped to, as the prompt carries them. */
  async function mappedText(v, base) {
    const keys = Array.isArray(v.stories) ? v.stories.map((x) => String(x.key).toUpperCase()) : (v.story ? [String(v.story.key).toUpperCase()] : []);
    const pages = (v.pgCat || []).filter((p) => p.sheet && (p.stories || []).some((k) => keys.indexOf(k) !== -1)).slice(0, 8);
    if (!pages.length) return '';
    const sheets = (await Promise.all(pages.map((p) => PC.sheet(base, p.id).catch(() => null))))
      .map((r) => (r && r.ok && r.body && r.body.sheet) || null).filter((sh) => sh && sh.facts);
    return PS.storyPagesText(sheets, Array.isArray(v.stories) ? 30000 : 24000);
  }

  // One analysis: the FDD sections for `story`, the mapped pages' sheets, the prompt `build` makes with them, the shared
  // Ask AI, the HTML.
  async function run(v, base, story, build, budget) {
    if (!story || v.analyzing) return { ok: false };
    v.analyzing = true;
    try {
      let mapped = '';
      try { mapped = await mappedText(v, base); } catch (e) { mapped = ''; }
      const f = await fddFor(v, base, '', story, budget);
      v.fddPicked = f ? f.picked : [];
      v.fddNote = !f ? '' : f.error ? f.error : (f.picked.length ? '' : 'Nothing in this FDD matched, so the analysis reads only the Jira stories.');
      v.fddView = null;
      const p = build(f && f.text ? { name: f.name, text: f.text } : '', mapped);
      const r = await M.aiChat(p.system, p.user);
      if (r.ok && r.body && r.body.ok && r.body.text) {
        v.analysisHtml = SA.renderHtml(r.body.text);
        v.analysisProvider = r.body.provider || 'AI';
        v.analysisFdd = f && f.text ? f.name : '';
        v.analysisAt = new Date().toISOString(); v.analysisBy = ''; v.analysisNote = '';
        try {
          const saved = await AS.save({ key: keyOf(v), text: r.body.text, provider: v.analysisProvider, model: r.body.model || '',
            fddId: v.fddId || '', fddNone: !!(v.fddChosen && !v.fddId), fddLabel: v.analysisFdd, picked: JSON.parse(JSON.stringify(v.fddPicked || [])),
            chat: (v.chat || []).map((m) => ({ role: m.role, text: m.text })), storyUpdated: updatedOf(v) });
          if (saved) { v.analysisAt = saved.at; v.analysisBy = saved.by || ''; }
        } catch (e) { /* shown, just not kept */ }
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
    return run(v, base, v.story, (f, mapped) => SA.prompt(v.story, v.pages, f, mapped));
  }

  function analyzeSet(v, base) {
    const list = v.stories || [];
    if (!list.length) return Promise.resolve({ ok: false });
    return run(v, base, merged(list), (f, mapped) => SA.promptSet(list, v.pages, f, mapped), 40000);
  }

  function keyOf(v) { return Array.isArray(v.stories) ? AS.setKey((v.stories || []).map((x) => x.key)) : ((v.story && v.story.key) || ''); }
  /** The latest a story (or any story of the set) was updated in Jira: YYYY-MM-DD. */
  function updatedOf(v) {
    const list = Array.isArray(v.stories) ? v.stories : (v.story ? [v.story] : []);
    return list.map((x) => x.updated || '').sort().pop() || '';
  }

  async function restore(v) {
    const it = await AS.get(keyOf(v));
    if (!it || !it.text) return false;
    v.analysisHtml = SA.renderHtml(it.text);
    v.analysisProvider = it.provider || 'AI';
    v.analysisFdd = it.fddLabel || '';
    v.analysisAt = it.at || ''; v.analysisBy = it.by || '';
    v.fddPicked = it.picked || [];
    v.chat = (it.chat || []).map((m) => ({ role: m.role, text: m.text, html: SA.renderHtml(m.text) }));
    const lib = v.fddLib || { docs: [] };
    const docs = lib.docs || [];
    if (it.fddId && docs.some((d) => d.id === it.fddId)) { v.fddId = it.fddId; v.fddChosen = it.fddId !== lib.latest; }
    else if (it.fddNone) { v.fddId = ''; v.fddChosen = true; } // "No FDD" was picked for it: Re-run keeps that
    // what changed since: a story updated after it, or another FDD now the latest
    const notes = [];
    const day = String(it.at || '').slice(0, 10);
    const list = Array.isArray(v.stories) ? v.stories : (v.story ? [v.story] : []);
    const newer = list.filter((x) => x.updated && day && x.updated > day).map((x) => x.key);
    if (newer.length) notes.push((newer.length === 1 ? newer[0] + ' was' : newer.join(', ') + ' were') + ' updated in Jira after this analysis.');
    const latest = docs.filter((d) => d.id === lib.latest)[0];
    if (latest && it.fddId !== latest.id && !it.fddNone) notes.push('The latest FDD is now ' + FI.label(latest) + (it.fddLabel ? '; this analysis read ' + it.fddLabel + '.' : '; this analysis read no FDD.'));
    v.analysisNote = notes.length ? notes.join(' ') + ' Re-run to bring it up to date.' : '';
    return true;
  }

  function saveChat(v) {
    return AS.saveChat(keyOf(v), (v.chat || []).filter((m) => m.text).map((m) => ({ role: m.role, text: m.text }))).catch(() => false);
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

  return { mappedText: mappedText, library: library, merged: merged, fddFor: fddFor, analyze: analyze, analyzeSet: analyzeSet, rerun: rerun, chatSet: chatSet,
    keyOf: keyOf, restore: restore, saveChat: saveChat };
});
