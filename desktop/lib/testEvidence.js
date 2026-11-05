'use strict';
/**
 * Test evidence for a Jira story (the Jira stories page in Old EquipRite and EquipRite Next, the story's panel: Record,
 * Screenshot): screen recordings and screenshots kept on this PC, one folder per story, by its key:
 *
 *   <dir>/EQP-196/2026-11-05 14-03-21 recording.webm
 *   <dir>/EQP-196/2026-11-05 14-04-02 screenshot.png
 *
 * The folder is the link: what is in a story's folder is its evidence (no separate index to fall out of step). A
 * recording is written as it is made, a few seconds at a time (start, chunk, finish), so a long test does not sit in
 * memory and a crash loses at most the last seconds.
 *
 *   open({ dir, reveal, now }) → store
 *   start(key, ext)             → { id, name }        a recording begun (its file created; ext webm or mp4)
 *   chunk(id, buffer)           → { size }            the next seconds appended
 *   finish(id)                  → item                the recording closed
 *   image(key, buffer, ext)     → item                a screenshot saved
 *   list(key)                   → { key, folder, items: [item] }   newest first
 *   file(key, name)             → absolute path or '' (only a file of that story's folder)
 *   reveal(key)                 → opens the folder (desktop: the file manager)
 *   remove(key, name)           → { ok }
 * An item: { name, kind: 'video' | 'image', size, created, url } (url: /__rec/file/<key>/<name>, served to this PC).
 *
 * The technical trace (lib/testTrace.js): a recording begun with { trace: true } also keeps, next to it, what happened
 * underneath while it ran ("… recording.trace.jsonl": the web service calls with their JSON, console errors, pages):
 *   tracing()                   → true while a traced recording runs (the server then records its calls)
 *   traceAdd(entry)             → written to every traced recording running
 *   status(id)                  → { calls, failed, console, errors } so far (the recording's bar)
 *   trace(key, name)            → { key, name, start, folder, video, entries (each with offset, ms into the video), summary }
 *   har(key, name), report(key, name)   the calls as a HAR file; the failure in words
 * A recording's item then also has trace: { calls, failed, errors, first, url, har }.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const TT = require('./testTrace');

const KEY = /^[A-Z][A-Z0-9_]{0,19}-\d{1,7}$/;
const VIDEO = /\.(webm|mp4|mkv)$/i;
const IMAGE = /\.(png|jpe?g|webp)$/i;
const MAX_CHUNK = 64 * 1024 * 1024;
const MAX_TRACE = 64 * 1024 * 1024;
const traceName = (video) => String(video).replace(/\.[a-z0-9]+$/i, '') + '.trace.jsonl';

function pad(n) { return (n < 10 ? '0' : '') + n; }
function stamp(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function open(o) {
  const dir = o.dir;
  const now = o.now || (() => new Date());
  const live = new Map(); // id -> { key, file, name, fd }

  const folder = (key) => {
    if (!KEY.test(String(key || ''))) throw new Error('Not a Jira key: ' + key);
    return path.join(dir, key);
  };
  const unique = (base, ext, key) => {
    const f = folder(key);
    fs.mkdirSync(f, { recursive: true });
    let name = `${base}${ext}`;
    for (let i = 2; fs.existsSync(path.join(f, name)); i++) name = `${base} (${i})${ext}`;
    return name;
  };
  const readTrace = (file) => {
    if (!fs.existsSync(file)) return null;
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
    const all = lines.map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
    const head = all.find((e) => e.kind === 'start') || { t: all.length ? all[0].t : 0 };
    const entries = all.filter((e) => e.kind !== 'start' && e.kind !== 'end').map((e) => Object.assign(e, { offset: Math.max(0, (e.t || 0) - (head.t || 0)) }));
    return { start: head.t || 0, entries, ended: all.some((e) => e.kind === 'end') };
  };
  const item = (key, name) => {
    const st = fs.statSync(path.join(folder(key), name));
    const it = { name, kind: VIDEO.test(name) ? 'video' : 'image', size: st.size, created: st.mtime.toISOString(),
      url: `/__rec/file/${encodeURIComponent(key)}/${encodeURIComponent(name)}` };
    if (it.kind === 'video') {
      const tr = readTrace(path.join(folder(key), traceName(name)));
      if (tr) {
        const s = TT.summary(tr.entries);
        const q = `${encodeURIComponent(key)}/${encodeURIComponent(name)}`;
        it.trace = { calls: s.calls, failed: s.failed, errors: s.errors, console: s.console, pages: s.pages, first: s.first, url: `/__rec/trace/${q}`, har: `/__rec/har/${q}` };
      }
    }
    return it;
  };
  const writeTrace = (r, entry) => {
    if (!r.trace || r.traceSize > MAX_TRACE) return;
    const line = JSON.stringify(entry) + '\n';
    r.traceSize += Buffer.byteLength(line);
    if (r.traceSize > MAX_TRACE) { fs.appendFileSync(r.trace, JSON.stringify({ kind: 'console', t: Date.now(), level: 'warning', message: 'The trace is full (64 MB): nothing more is kept.' }) + '\n'); return; }
    fs.appendFileSync(r.trace, line);
    if (entry.kind === 'call') { r.counts.calls++; if (entry.failed) r.counts.failed++; }
    if (entry.kind === 'console') { r.counts.console++; if (entry.level === 'error') r.counts.errors++; }
  };

  return {
    dir,
    start(key, ext, opts) {
      const name = unique(`${stamp(now())} recording`, String(ext || '').toLowerCase() === 'mp4' ? '.mp4' : '.webm', key);
      const file = path.join(folder(key), name);
      const fd = fs.openSync(file, 'w');
      const id = crypto.randomBytes(12).toString('hex');
      const r = { key, file, name, fd, trace: '', traceSize: 0, counts: { calls: 0, failed: 0, console: 0, errors: 0 } };
      if (opts && opts.trace) {
        r.trace = path.join(folder(key), traceName(name));
        fs.writeFileSync(r.trace, JSON.stringify({ kind: 'start', t: Date.now(), key, name }) + '\n');
      }
      live.set(id, r);
      return { id, name, trace: !!r.trace };
    },
    tracing() { return [...live.values()].some((r) => !!r.trace); },
    traceAdd(entry) {
      if (!entry) return 0;
      let n = 0;
      live.forEach((r) => { if (r.trace) { writeTrace(r, entry); n++; } });
      return n;
    },
    status(id) {
      const r = live.get(String(id));
      return r ? Object.assign({ trace: !!r.trace }, r.counts) : null;
    },
    chunk(id, buf) {
      const r = live.get(String(id));
      if (!r) throw new Error('No recording ' + id + ' in progress.');
      if (!buf || !buf.length) return { size: fs.fstatSync(r.fd).size };
      if (buf.length > MAX_CHUNK) throw new Error('Chunk too large.');
      fs.writeSync(r.fd, buf);
      return { size: fs.fstatSync(r.fd).size };
    },
    finish(id) {
      const r = live.get(String(id));
      if (!r) throw new Error('No recording ' + id + ' in progress.');
      fs.closeSync(r.fd);
      live.delete(String(id));
      if (r.trace) fs.appendFileSync(r.trace, JSON.stringify({ kind: 'end', t: Date.now() }) + '\n');
      if (!fs.statSync(r.file).size) {
        fs.unlinkSync(r.file);
        if (r.trace && fs.existsSync(r.trace)) fs.unlinkSync(r.trace);
        return null;
      }
      return item(r.key, r.name);
    },
    image(key, buf, ext) {
      if (!buf || !buf.length) throw new Error('No image.');
      const e = /^(png|jpe?g|webp)$/i.test(String(ext || '')) ? '.' + String(ext).toLowerCase() : '.png';
      const name = unique(`${stamp(now())} screenshot`, e, key);
      fs.writeFileSync(path.join(folder(key), name), buf);
      // On the timeline of a traced recording of this story.
      live.forEach((r) => { if (r.key === key && r.trace) writeTrace(r, { kind: 'shot', t: Date.now(), name, url: item(key, name).url }); });
      return item(key, name);
    },
    list(key) {
      const f = folder(key);
      const names = fs.existsSync(f) ? fs.readdirSync(f).filter((n) => VIDEO.test(n) || IMAGE.test(n)) : [];
      const busy = new Set([...live.values()].filter((r) => r.key === key).map((r) => r.name));
      const items = names.filter((n) => !busy.has(n)).map((n) => item(key, n)).sort((a, b) => b.name.localeCompare(a.name));
      return { key, folder: f, items };
    },
    file(key, name) {
      let f;
      try { f = folder(key); } catch { return ''; }
      const n = path.basename(String(name || ''));
      if (!n || n !== String(name) || !(VIDEO.test(n) || IMAGE.test(n))) return '';
      const p = path.join(f, n);
      return fs.existsSync(p) ? p : '';
    },
    reveal(key) {
      const f = folder(key);
      fs.mkdirSync(f, { recursive: true });
      if (o.reveal) o.reveal(f);
      return { folder: f };
    },
    remove(key, name) {
      const p = this.file(key, name);
      if (!p) return { ok: false };
      fs.unlinkSync(p);
      const t = path.join(path.dirname(p), traceName(path.basename(p)));
      if (VIDEO.test(p) && fs.existsSync(t)) fs.unlinkSync(t);
      return { ok: true };
    },
    trace(key, name) {
      const p = this.file(key, name);
      if (!p || !VIDEO.test(p)) return null;
      const tr = readTrace(path.join(path.dirname(p), traceName(path.basename(p))));
      if (!tr) return null;
      return { key, name, folder: path.dirname(p), start: tr.start, ended: tr.ended, video: item(key, path.basename(p)), entries: tr.entries, summary: TT.summary(tr.entries) };
    },
    har(key, name) { const tr = this.trace(key, name); return tr ? TT.toHar(tr) : null; },
    report(key, name) { const tr = this.trace(key, name); return tr ? TT.bugReport(tr, tr.folder) : ''; },
    /** Recordings still open when the app quits are closed as they are (what was written stays playable). */
    closeAll() {
      for (const [id, r] of live) {
        try { fs.closeSync(r.fd); } catch { /* already closed */ }
        try { if (r.trace) fs.appendFileSync(r.trace, JSON.stringify({ kind: 'end', t: Date.now() }) + '\n'); } catch { /* gone */ }
        live.delete(id);
      }
    },
  };
}

module.exports = { open, KEY };
