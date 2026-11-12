'use strict';
/**
 * Saved AI analyses, for "Analyze with AI" in EquipRite Next: each run is kept on this PC (a JSON file in the app's data
 * folder), so opening a story's analysis again shows the last run — with when and by whom — instead of asking the AI
 * again, and the Jira lists can mark the stories that have one. Re-running replaces it. The chat about it is kept too.
 *
 *   open({ file, now, max }) → store
 *     index()          { ok, items: { KEY: { at, by, provider, fddLabel, kind, keys, storyUpdated, chat } } }  (no text)
 *     get(key)         { ok, item } | { ok: false }
 *     save(item)       { key, kind: 'story'|'set', keys, text, provider, model, fddId, fddLabel, picked, chat, by,
 *                        storyUpdated } → { ok, item }   (at is set here)
 *     chat(key, chat)  keeps the conversation with the saved analysis → { ok }
 *     remove(key)      { ok }
 *
 * A key is a story's key ("EQP-12") or a set's ("set:EQP-12,EQP-13", sorted). Text is Markdown, as the AI wrote it.
 * The newest `max` (2,000) are kept.
 */
const fs = require('fs');
const path = require('path');

function str(v) { return v == null ? '' : String(v); }
function cleanKey(k) {
  const s = str(k).trim().toUpperCase();
  if (/^[A-Z][A-Z0-9]*-\d+$/.test(s)) return s;
  const m = /^SET:(.+)$/.exec(s);
  if (!m) return '';
  const keys = m[1].split(/[\s,]+/).filter((x) => /^[A-Z][A-Z0-9]*-\d+$/.test(x));
  return keys.length > 1 ? 'SET:' + keys.sort().join(',') : '';
}
const cut = (s, n) => str(s).slice(0, n);

function open(opts) {
  const o = opts || {};
  const file = o.file;
  const now = o.now || (() => new Date());
  const max = o.max || 2000;
  let items = null;

  function load() {
    if (items) return items;
    try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); items = j && typeof j.items === 'object' ? j.items : {}; } catch (e) { items = {}; }
    return items;
  }
  function write() {
    const keys = Object.keys(items).sort((a, b) => str(items[b].at).localeCompare(str(items[a].at)));
    keys.slice(max).forEach((k) => { delete items[k]; });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, items: items }));
    fs.renameSync(tmp, file);
  }
  const summary = (it) => ({ at: it.at, by: it.by, provider: it.provider, fddLabel: it.fddLabel, kind: it.kind, keys: it.keys,
    storyUpdated: it.storyUpdated, chat: (it.chat || []).length });
  const chatOf = (list) => (Array.isArray(list) ? list : []).slice(-60).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', text: cut(m.text, 20000) }));

  return {
    index() {
      const all = load();
      const out = {};
      Object.keys(all).forEach((k) => { out[k] = summary(all[k]); });
      return { ok: true, items: out };
    },
    get(key) {
      const k = cleanKey(key);
      const it = k ? load()[k] : null;
      return it ? { ok: true, item: it } : { ok: false, error: 'No saved analysis for ' + (k || str(key)) + '.' };
    },
    save(b) {
      b = b || {};
      const k = cleanKey(b.key);
      if (!k) return { ok: false, error: 'An analysis is saved under a story key (EQP-12) or a set of them.' };
      if (!str(b.text).trim()) return { ok: false, error: 'There is no analysis to save.' };
      const it = {
        key: k, kind: k.indexOf('SET:') === 0 ? 'set' : 'story',
        keys: k.indexOf('SET:') === 0 ? k.slice(4).split(',') : [k],
        text: cut(b.text, 400000), provider: cut(b.provider, 120), model: cut(b.model, 120),
        fddId: cut(b.fddId, 100), fddNone: !!b.fddNone, fddLabel: cut(b.fddLabel, 200),
        picked: (Array.isArray(b.picked) ? b.picked : []).slice(0, 80).map((p) => ({ n: cut(p.n, 30), t: cut(p.t, 200), why: cut(p.why, 200), chars: Number(p.chars) || 0, cut: !!p.cut })),
        chat: chatOf(b.chat), by: cut(b.by, 120), storyUpdated: cut(b.storyUpdated, 40), at: now().toISOString(),
      };
      load()[k] = it;
      write();
      return { ok: true, item: it };
    },
    chat(key, list) {
      const k = cleanKey(key);
      const it = k ? load()[k] : null;
      if (!it) return { ok: false, error: 'No saved analysis for ' + (k || str(key)) + '.' };
      it.chat = chatOf(list);
      write();
      return { ok: true };
    },
    remove(key) {
      const k = cleanKey(key);
      if (k && load()[k]) { delete items[k]; write(); }
      return { ok: true };
    },
  };
}

module.exports = { open, cleanKey };
