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
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEY = /^[A-Z][A-Z0-9_]{0,19}-\d{1,7}$/;
const VIDEO = /\.(webm|mp4|mkv)$/i;
const IMAGE = /\.(png|jpe?g|webp)$/i;
const MAX_CHUNK = 64 * 1024 * 1024;

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
  const item = (key, name) => {
    const st = fs.statSync(path.join(folder(key), name));
    return { name, kind: VIDEO.test(name) ? 'video' : 'image', size: st.size, created: st.mtime.toISOString(),
      url: `/__rec/file/${encodeURIComponent(key)}/${encodeURIComponent(name)}` };
  };

  return {
    dir,
    start(key, ext) {
      const name = unique(`${stamp(now())} recording`, String(ext || '').toLowerCase() === 'mp4' ? '.mp4' : '.webm', key);
      const file = path.join(folder(key), name);
      const fd = fs.openSync(file, 'w');
      const id = crypto.randomBytes(12).toString('hex');
      live.set(id, { key, file, name, fd });
      return { id, name };
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
      if (!fs.statSync(r.file).size) { fs.unlinkSync(r.file); return null; }
      return item(r.key, r.name);
    },
    image(key, buf, ext) {
      if (!buf || !buf.length) throw new Error('No image.');
      const e = /^(png|jpe?g|webp)$/i.test(String(ext || '')) ? '.' + String(ext).toLowerCase() : '.png';
      const name = unique(`${stamp(now())} screenshot`, e, key);
      fs.writeFileSync(path.join(folder(key), name), buf);
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
      return { ok: true };
    },
    /** Recordings still open when the app quits are closed as they are (what was written stays playable). */
    closeAll() {
      for (const [id, r] of live) { try { fs.closeSync(r.fd); } catch { /* already closed */ } live.delete(id); }
    },
  };
}

module.exports = { open, KEY };
