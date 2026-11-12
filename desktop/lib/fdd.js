'use strict';
/**
 * The FDD library: the functional design documents "Analyze with AI" reads, kept in git so every user (and the app in
 * VBCS) has the same ones. Upload a document (Word, PDF, HTML, Markdown or text) and it is split into its numbered
 * sections ("7.2.5G Hire extensions" and the text under it), saved into the project, and — when asked — committed and
 * pushed. One document is the "latest", the one the analysis starts on; any other can be chosen there.
 *
 * In the project (all in git):
 *   docs/fdd/<id>.<ext>                                 the document as uploaded
 *   webApps/equiprite-next/resources/fdd/library.json   { latest, docs: [{ id, name, version, note, file, originalName,
 *                                                        kind, sections, chars, uploadedAt, uploadedBy }] }
 *   webApps/equiprite-next/resources/fdd/<id>.json      { id, name, version, sections: [{ n, t, l, x }] }
 *                                                        n: the section number ("7.2.5G", '' when it has none), t: its
 *                                                        title, l: its level (1 = chapter), x: the text under it
 * The two JSON files ship with the app (a build copies resources/), so the page reads them in the desktop app, in the
 * browser (npm run serve) and in VBCS alike. Only uploading needs the desktop app or npm run serve: it writes here.
 *
 *   open({ root, git, gitPath, now, mirror }) → store
 *     info()                         { ok, canUpload, latest, docs, paths }
 *     upload({ name, version, note, fileName, base64, latest, by })   → { ok, doc, warnings, files }
 *     setLatest(id)                  → { ok, latest, files }
 *     remove(id)                     → { ok, latest, files }
 *     outline(id)                    → { ok, doc, sections: [{ n, t, l, chars }] }
 *     original(id)                   → { ok, file, name, mime } (the document as uploaded, to download it)
 *     gitStatus()                    → { available, branch, upstream, pending: [paths], unpushed: [commits], reason }
 *     gitSave({ message, push })     → { ok, committed, pushed, branch, upstream, error, hint }
 *     setMirror(dir | () => dir)     also write the JSON files there (the running app's built copy of resources/fdd), and
 *                                    copy the project's into it now (so FDDs from a git pull show without a rebuild)
 *   parse(buffer, fileName)          → Promise<{ kind, sections, warnings }>      (pure, apart from PDF's library)
 *   parseDocx / parseHtml / parseText / parsePdf / unzip / headingNumber          (pure, exported for tests)
 *
 * Git: only the FDD paths are ever added, committed (`git commit -- <paths>`, so nothing else that is staged goes with
 * them) and pushed, to the branch the project is on. A push that is refused (someone pushed first) is said, with what
 * to do; nothing is rebased or forced.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DOCS_DIR = 'docs/fdd';
const RES_DIR = 'webApps/equiprite-next/resources/fdd';
const KINDS = { '.docx': 'docx', '.pdf': 'pdf', '.html': 'html', '.htm': 'html', '.md': 'md', '.markdown': 'md', '.txt': 'txt' };
const MIME = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pdf: 'application/pdf',
  html: 'text/html; charset=utf-8', md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8' };
const MAX_BYTES = 60 * 1024 * 1024;

function str(v) { return v == null ? '' : String(v); }
function clean(s) { return str(s).replace(/\r/g, '').replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim(); }
function slug(s) { return str(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60); }
function decodeXml(s) {
  return str(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&'; if (k === 'lt') return '<'; if (k === 'gt') return '>';
    if (k === 'quot') return '"'; if (k === 'apos') return "'"; if (k === 'nbsp') return ' ';
    const code = k.charAt(1) === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    try { return String.fromCodePoint(code); } catch (err) { return ''; }
  });
}

// ── Section numbers ─────────────────────────────────────────────────────────────────────────────────────────────────
// "7.2.5G Hire extensions", "7.14A. Rates", "3) Scope", "Section 7.2 – Agreements" → { n, t }. A number is one to six
// dotted parts of up to three digits, with an optional capital letter after it ("7.2.5G", not "7.2 Gantt").
const NUM_RE = /^\s*(?:(?:section|chapter)\s+)?((?:\d{1,3})(?:\.\d{1,3}){0,5}(?:[A-Z](?![A-Za-z]))?)(?:[.):]|\s*[-–—]\s*|\s+|$)\s*(.*)$/i;
function headingNumber(text) {
  const t = str(text).replace(/\s+/g, ' ').trim();
  const m = NUM_RE.exec(t);
  if (!m) return { n: '', t: t };
  // "2026 plan" or "15 minutes" are words, not numbers: a lone number must be small, and leave a title behind
  if (m[1].indexOf('.') === -1 && (parseInt(m[1], 10) > 60 || !m[2])) return { n: '', t: t };
  return { n: m[1].toUpperCase(), t: m[2].trim() || t };
}
function numParts(n) {
  const m = /^(\d+(?:\.\d+)*)([A-Z]?)$/.exec(str(n));
  return m ? { parts: m[1].split('.').map(Number), letter: m[2] } : null;
}
/**
 * Whether `cand` can follow `prev` in an outline: used for PDF and plain text, where a "heading" is only a line that
 * starts with a number, so a numbered list item or a cross-reference in the body must not open a section. A dotted
 * number must come later in the outline than the last heading, in the same chapter or the next (7.2 → 7.2.5, 7.3,
 * 8.1; 7.2.5 → 7.2.5G); a chapter number may jump ahead a few (2 → 7), never back.
 */
function canFollow(prev, cand) {
  const c = numParts(cand);
  if (!c) return false;
  const p = numParts(prev);
  if (!p) return c.parts[0] <= 3;
  const C = c.parts, P = p.parts;
  let cmp = 0;
  for (let i = 0; i < Math.max(C.length, P.length) && !cmp; i++) cmp = (C[i] === undefined ? -1 : P[i] === undefined ? 1 : C[i] - P[i]);
  if (cmp === 0) return !!c.letter && (!p.letter || c.letter > p.letter);
  if (cmp < 0) return false;
  if (C.length === 1) return C[0] - P[0] >= 1 && C[0] - P[0] <= 9;
  return C[0] - P[0] <= 1;
}

// ── Blocks → sections ───────────────────────────────────────────────────────────────────────────────────────────────
// blocks: [{ h: level, n, t } | { p: text }]. Text before the first heading becomes "(Front matter)" when there is any.
function sectionsFrom(blocks) {
  const out = [];
  let cur = { n: '', t: '(Front matter)', l: 0, lines: [] };
  const flush = () => {
    const x = clean(cur.lines.join('\n'));
    if (cur.l > 0 || x) out.push({ n: cur.n, t: cur.t, l: cur.l, x: x });
  };
  blocks.forEach((b) => {
    if (b.h) { flush(); cur = { n: b.n || '', t: str(b.t).trim() || b.n || 'Untitled', l: b.h, lines: [] }; }
    else if (str(b.p).trim()) cur.lines.push(str(b.p));
  });
  flush();
  return out;
}

// ── Word (.docx) ────────────────────────────────────────────────────────────────────────────────────────────────────
/** A .docx is a zip: the entries this needs ({ name: Buffer }), read with Node's own inflate. */
function unzip(buf, want) {
  const files = {};
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) { if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error('This is not a Word document (.docx): it is not a zip file.');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nlen = buf.readUInt16LE(off + 28), elen = buf.readUInt16LE(off + 30), clen = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + nlen).toString('utf8');
    off += 46 + nlen + elen + clen;
    if (want && want.indexOf(name) === -1) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.slice(start, start + csize);
    files[name] = method === 0 ? data : method === 8 ? zlib.inflateRawSync(data) : null;
  }
  return files;
}

function attr(tag, name) { const m = new RegExp('\\b' + name + '="([^"]*)"').exec(tag); return m ? m[1] : null; }

/** Word's styles: id → { name, level (0-based outline level, or null), numbered, basedOn }, with basedOn followed. */
function readStyles(xml) {
  const styles = {};
  const re = /<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g;
  let m;
  while ((m = re.exec(str(xml)))) {
    const id = attr(m[1], 'w:styleId');
    if (!id) continue;
    const body = m[2];
    const name = (/<w:name\b[^>]*w:val="([^"]*)"/.exec(body) || [])[1] || id;
    const lvl = /<w:outlineLvl\b[^>]*w:val="(\d+)"/.exec(body);
    const num = /<w:numPr>[\s\S]*?<w:numId\b[^>]*w:val="(\d+)"/.exec(body);
    styles[id] = { name: name, level: lvl ? parseInt(lvl[1], 10) : null, numbered: num ? num[1] !== '0' : null,
      basedOn: (/<w:basedOn\b[^>]*w:val="([^"]*)"/.exec(body) || [])[1] || '' };
  }
  const resolve = (id, key, seen) => {
    const s = styles[id];
    if (!s || (seen = seen || {})[id]) return null;
    seen[id] = true;
    return s[key] != null ? s[key] : resolve(s.basedOn, key, seen);
  };
  Object.keys(styles).forEach((id) => {
    const s = styles[id];
    const h = /^heading\s*(\d)$/i.exec(s.name);
    s.headLevel = h ? parseInt(h[1], 10) : (resolve(id, 'level') != null && resolve(id, 'level') < 9 ? resolve(id, 'level') + 1 : 0);
    s.isNumbered = !!resolve(id, 'numbered');
    s.toc = /^(toc|table of contents|toc heading)/i.test(s.name);
    if (/^(title|subtitle)$/i.test(s.name)) s.headLevel = 0;
  });
  return styles;
}

/** A .docx → { kind, sections, warnings }: headings from Word's heading styles (or outline levels), tables as rows. */
function parseDocx(buf) {
  const files = unzip(buf, ['word/document.xml', 'word/styles.xml']);
  const doc = files['word/document.xml'];
  if (!doc) throw new Error('This Word file has no document in it (word/document.xml).');
  const styles = readStyles(files['word/styles.xml'] ? files['word/styles.xml'].toString('utf8') : '');
  const xml = doc.toString('utf8');
  const blocks = [];
  const counters = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  let tblDepth = 0, rows = [], row = null, cell = null, para = null, inT = false, inRun = false;
  const tagRe = /<(\/?)(w:p|w:tbl|w:tr|w:tc|w:t|w:tab|w:br|w:cr|w:pStyle|w:outlineLvl|w:numId|w:delText|w:instrText|w:r)\b([^>]*?)(\/?)>/g;
  let last = 0, m;
  const endPara = () => {
    if (!para) return;
    const text = para.text.replace(/[ \t]+/g, ' ').trim();
    const st = styles[para.style] || {};
    if (tblDepth > 0) { if (cell && text) cell.push(text); para = null; return; }
    if (st.toc) { para = null; return; } // the table of contents repeats the headings
    let level = para.outline != null && para.outline < 9 ? para.outline + 1 : (st.headLevel || 0);
    if (level && text && text.length <= 200) {
      const numbered = para.numId != null ? para.numId !== '0' : st.isNumbered;
      const hn = headingNumber(text);
      let n = hn.n;
      if (numbered) {
        counters[level - 1]++;
        for (let i = level; i < counters.length; i++) counters[i] = 0;
        if (!n) n = counters.slice(0, level).map((c) => c || 1).join('.');
      }
      blocks.push({ h: level, n: n, t: hn.n ? hn.t : text });
    } else if (text) {
      blocks.push({ p: para.text.replace(/[ \t]+/g, ' ').trim() });
    }
    para = null;
  };
  while ((m = tagRe.exec(xml))) {
    if (inT && m.index > last) para && (para.text += decodeXml(xml.slice(last, m.index)));
    const close = m[1] === '/', name = m[2], self = m[4] === '/', a = m[3];
    last = tagRe.lastIndex;
    if (name === 'w:t') { inT = !close && !self; continue; }
    if (name === 'w:delText' || name === 'w:instrText') { inT = false; continue; }
    if (name === 'w:r') { inRun = !close && !self; continue; }
    if (name === 'w:p') {
      if (!close) { para = { text: '', style: '', outline: null, numId: null }; if (self) endPara(); }
      else endPara();
      continue;
    }
    if (name === 'w:tbl') {
      if (!close) { if (tblDepth === 0) rows = []; tblDepth++; }
      else { tblDepth = Math.max(0, tblDepth - 1); if (tblDepth === 0 && rows.length) blocks.push({ p: rows.join('\n') }); }
      continue;
    }
    if (tblDepth === 1 && name === 'w:tr') { if (!close) row = []; else if (row) { const r = row.filter(Boolean); if (r.length) rows.push(r.join(' | ')); row = null; } continue; }
    if (tblDepth === 1 && name === 'w:tc') { if (!close) cell = []; else if (cell && row) { row.push(cell.join(' ')); cell = null; } continue; }
    if (!para) continue;
    if ((name === 'w:tab') && inRun) para.text += '\t';
    else if ((name === 'w:br' || name === 'w:cr') && inRun) para.text += '\n';
    else if (name === 'w:pStyle') para.style = attr(a, 'w:val') || '';
    else if (name === 'w:outlineLvl') para.outline = parseInt(attr(a, 'w:val'), 10);
    else if (name === 'w:numId') para.numId = attr(a, 'w:val');
  }
  const sections = sectionsFrom(blocks);
  const warnings = [];
  if (!blocks.some((b) => b.h)) warnings.push('No headings were found: use Word\'s Heading 1, 2, 3 styles so the document splits into sections.');
  return { kind: 'docx', sections: sections, warnings: warnings };
}

// ── HTML ────────────────────────────────────────────────────────────────────────────────────────────────────────────
function parseHtml(html) {
  let s = str(html).replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|svg|head|nav)\b[\s\S]*?<\/\1>/gi, ' ');
  const blocks = [];
  const re = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let last = 0, m;
  const text = (h) => decodeXml(h
    .replace(/<\/(td|th)>/gi, ' | ').replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|table|section|article|ul|ol|blockquote|pre|dd|dt|figcaption)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ').replace(/<[^>]+>/g, ''))
    .split('\n').map((l) => l.replace(/[ \t]+/g, ' ').replace(/\s*\|\s*$/, '').trim()).filter(Boolean).join('\n');
  while ((m = re.exec(s))) {
    const before = text(s.slice(last, m.index));
    if (before) blocks.push({ p: before });
    // a heading's parts are often spans ("<span>7.2</span>Rental agreements"): a tag there is a word break
    const title = text(m[2].replace(/<[^>]+>/g, ' ')).replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    const hn = headingNumber(title);
    blocks.push({ h: parseInt(m[1], 10), n: hn.n, t: hn.t });
    last = re.lastIndex;
  }
  const tail = text(s.slice(last));
  if (tail) blocks.push({ p: tail });
  const warnings = blocks.some((b) => b.h) ? [] : ['No headings (<h1>–<h6>) were found, so the whole page is one section.'];
  return { kind: 'html', sections: sectionsFrom(blocks), warnings: warnings };
}

// ── Markdown, plain text and PDF text ───────────────────────────────────────────────────────────────────────────────
// Markdown: "#" headings. Plain/PDF text: a short line that starts with a section number that can follow the last one.
function looksLikeHeading(line) {
  if (line.length > 140 || /\.{4,}|…{2,}/.test(line)) return null;        // long, or a table-of-contents line
  const hn = headingNumber(line);
  if (!hn.n || !hn.t || !/^[A-Z(]/.test(hn.t)) return null;
  if (hn.n.indexOf('.') === -1 && (hn.t.split(' ').length > 9 || /[.;,]$/.test(hn.t))) return null; // "1. The user clicks…"
  if (/\s\d{1,4}$/.test(hn.t) && hn.t.split(' ').length > 2 && /\s{2,}\d+$|\t\d+$/.test(line)) return null;
  return hn;
}
function linesToBlocks(lines, markdown) {
  const blocks = [];
  let prev = '', para = [];
  const flushP = () => { if (para.length) { blocks.push({ p: para.join('\n') }); para = []; } };
  lines.forEach((raw) => {
    const line = raw.replace(/\s+$/, '');
    if (markdown) {
      const md = /^(#{1,6})\s+(.*)$/.exec(line.trim());
      if (md) { flushP(); const hn = headingNumber(md[2].replace(/#+\s*$/, '')); blocks.push({ h: md[1].length, n: hn.n, t: hn.t }); if (hn.n) prev = hn.n; return; }
    } else {
      const hn = looksLikeHeading(line.trim());
      if (hn && canFollow(prev, hn.n)) { flushP(); blocks.push({ h: hn.n.split('.').length, n: hn.n, t: hn.t }); prev = hn.n; return; }
    }
    if (!line.trim()) { flushP(); return; }
    para.push(line.trim());
  });
  flushP();
  return blocks;
}
function parseText(text, kind) {
  const blocks = linesToBlocks(str(text).replace(/\r/g, '').split('\n'), kind === 'md');
  const warnings = blocks.some((b) => b.h) ? [] : ['No numbered headings were found, so the whole document is one section.'];
  return { kind: kind || 'txt', sections: sectionsFrom(blocks), warnings: warnings };
}

/** PDF → text with Mozilla's pdf.js (pdfjs-dist), then as plain text. Running headers and footers are dropped. */
async function parsePdf(buf) {
  let pdfjs;
  try { pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'); }
  catch (e) { throw new Error('Reading a PDF needs pdfjs-dist: run npm install in the project, or upload the Word (.docx) version.'); }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), disableFontFace: true, isEvalSupported: false, verbosity: 0 }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    let s = '';
    tc.items.forEach((it) => { s += str(it.str) + (it.hasEOL ? '\n' : ''); });
    const ls = s.split('\n').map((l) => l.replace(/\s+/g, ' ').trim());
    // a contents page ("7.2 Rental agreements 45" line after line) repeats the headings: leave it out
    const filled = ls.filter(Boolean);
    const toc = filled.filter((l) => /^\d{1,3}(?:\.\d{1,3})*[A-Z]?\.?\s+\S.*?(?:\s|\.{2,})\d{1,4}$/.test(l)).length;
    if (/^(table of )?contents$/i.test(filled[0] || '') || (toc >= 5 && toc >= filled.length * 0.5)) { pages.push([]); continue; }
    pages.push(ls);
  }
  try { await doc.destroy(); } catch (e) { /* closed */ }
  // A line on most pages ("EquipRite FDD v1.7 · Confidential · Page 12 of 300") is a header or footer.
  const seen = {};
  const norm = (l) => l.replace(/\d+/g, '#');
  pages.forEach((ls) => { const once = {}; ls.forEach((l) => { const k = norm(l); if (l && !once[k]) { once[k] = true; seen[k] = (seen[k] || 0) + 1; } }); });
  const rep = pages.length >= 5 ? (l) => seen[norm(l)] >= pages.length * 0.4 : () => false;
  const text = pages.map((ls) => ls.filter((l) => !rep(l)).join('\n')).join('\n\n');
  const r = parseText(text, 'pdf');
  r.kind = 'pdf';
  r.pages = pages.length;
  if (text.replace(/\s/g, '').length < 200) r.warnings.push('Almost no text could be read: this PDF may be scanned images. Upload the Word (.docx) version.');
  else r.warnings.push('Read from a PDF: check the outline. A Word (.docx) file keeps the headings exactly.');
  return r;
}

/** Any supported file → { kind, sections, warnings }. */
async function parse(buf, fileName) {
  const ext = path.extname(str(fileName)).toLowerCase();
  const kind = KINDS[ext];
  if (!kind) throw new Error('Upload a Word (.docx), PDF, HTML, Markdown or text file; ' + (ext || 'this file') + ' is not one.');
  if (kind === 'docx') return parseDocx(buf);
  if (kind === 'pdf') return parsePdf(buf);
  const text = buf.toString('utf8').replace(/^﻿/, '');
  return kind === 'html' ? parseHtml(text) : parseText(text, kind);
}

// ── Git ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
function runGit(gitPath, cwd, args) {
  return new Promise((resolve) => {
    let cp;
    try { cp = require('child_process'); } catch (e) { resolve({ code: -1, stdout: '', stderr: 'No child_process here.' }); return; }
    cp.execFile(gitPath || 'git', args, { cwd: cwd, windowsHide: true, maxBuffer: 16 * 1024 * 1024, env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0' }) },
      (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout: str(stdout), stderr: str(stderr) || (err && err.code === 'ENOENT' ? 'git is not installed (or not on PATH).' : (err ? str(err.message) : '')) }));
  });
}

// ── The library ─────────────────────────────────────────────────────────────────────────────────────────────────────
function open(opts) {
  const o = opts || {};
  const root = path.resolve(o.root || path.join(__dirname, '..', '..'));
  const docsDir = path.join(root, DOCS_DIR);
  const resDir = path.join(root, RES_DIR);
  const libFile = path.join(resDir, 'library.json');
  const now = o.now || (() => new Date());
  const git = o.git || ((args) => runGit(o.gitPath, root, args));
  let mirror = o.mirror || '';
  const PATHS = [DOCS_DIR, RES_DIR];

  const canUpload = () => { try { return fs.statSync(path.join(root, 'webApps', 'equiprite-next')).isDirectory(); } catch (e) { return false; } };
  function readLib() {
    try {
      const j = JSON.parse(fs.readFileSync(libFile, 'utf8'));
      return { latest: str(j.latest), docs: Array.isArray(j.docs) ? j.docs : [] };
    } catch (e) { return { latest: '', docs: [] }; }
  }
  const mirrorDir = () => { try { return typeof mirror === 'function' ? mirror() : mirror; } catch (e) { return ''; } };
  function writeRes(name, obj) {
    const text = JSON.stringify(obj, null, name === 'library.json' ? 2 : 0) + '\n';
    fs.mkdirSync(resDir, { recursive: true });
    fs.writeFileSync(path.join(resDir, name), text);
    const m = mirrorDir();
    if (m) { try { fs.mkdirSync(m, { recursive: true }); fs.writeFileSync(path.join(m, name), text); } catch (e) { /* the build copy catches up on the next build */ } }
  }
  function removeRes(name) {
    [resDir, mirrorDir()].filter(Boolean).forEach((d) => { try { fs.unlinkSync(path.join(d, name)); } catch (e) { /* gone */ } });
  }
  // The project's FDD files into the build copy, as they are now (the server calls this as it starts): FDDs that came
  // with a git pull show at once, without a rebuild. A project with no library leaves the copy alone.
  function sync() {
    const m = mirrorDir();
    if (!m) return;
    try {
      const src = fs.existsSync(resDir) ? fs.readdirSync(resDir).filter((f) => /\.json$/.test(f)) : [];
      if (!src.length) return;
      fs.mkdirSync(m, { recursive: true });
      fs.readdirSync(m).filter((f) => /\.json$/.test(f) && src.indexOf(f) === -1).forEach((f) => fs.unlinkSync(path.join(m, f)));
      src.forEach((f) => fs.copyFileSync(path.join(resDir, f), path.join(m, f)));
    } catch (e) { /* the build copy catches up on the next build */ }
  }
  function writeLib(lib) {
    lib.docs.sort((a, b) => str(b.uploadedAt).localeCompare(str(a.uploadedAt)));
    if (lib.latest && !lib.docs.some((d) => d.id === lib.latest)) lib.latest = '';
    if (!lib.latest && lib.docs.length) lib.latest = lib.docs[0].id;
    writeRes('library.json', { latest: lib.latest, docs: lib.docs });
    return lib;
  }
  const rel = (p) => path.relative(root, p).split(path.sep).join('/');
  // library.json comes from git: an id is a slug, and a document's file must be inside docs/fdd
  const okId = (id) => /^[a-z0-9][a-z0-9-]{0,80}$/.test(str(id));
  const inDocs = (f) => { const abs = path.resolve(root, str(f)); return abs.indexOf(docsDir + path.sep) === 0 ? abs : ''; };

  async function upload(b) {
    b = b || {};
    if (!canUpload()) return { ok: false, error: 'The FDD library is saved into the project (git), and this app is not running from the project folder.' };
    const fileName = path.basename(str(b.fileName));
    const ext = path.extname(fileName).toLowerCase();
    if (!KINDS[ext]) return { ok: false, error: 'Upload a Word (.docx), PDF, HTML, Markdown or text file.' };
    const buf = Buffer.from(str(b.base64).replace(/^data:[^,]*,/, ''), 'base64');
    if (!buf.length) return { ok: false, error: 'The file is empty.' };
    if (buf.length > MAX_BYTES) return { ok: false, error: 'The file is larger than 60 MB.' };
    let parsed;
    try { parsed = await parse(buf, fileName); } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    const sections = parsed.sections.filter((s) => s.t || s.x);
    if (!sections.length) return { ok: false, error: 'No text could be read from this file.' };
    const name = str(b.name).trim() || fileName.replace(/\.[^.]+$/, '');
    const version = str(b.version).trim();
    const lib = readLib();
    const base = slug(name + (version ? ' v' + version : '')) || 'fdd';
    let id = base, k = 2;
    while (lib.docs.some((d) => d.id === id)) id = base + '-' + (k++);
    fs.mkdirSync(docsDir, { recursive: true });
    const docFile = path.join(docsDir, id + ext);
    fs.writeFileSync(docFile, buf);
    const chars = sections.reduce((a, s) => a + s.x.length, 0);
    writeRes(id + '.json', { id: id, name: name, version: version, sections: sections });
    const doc = { id: id, name: name, version: version, note: str(b.note).trim(), file: rel(docFile), originalName: fileName,
      kind: parsed.kind, sections: sections.length, numbered: sections.filter((s) => s.n).length, chars: chars,
      uploadedAt: now().toISOString(), uploadedBy: str(b.by).trim() };
    lib.docs.push(doc);
    if (b.latest !== false || !lib.latest) lib.latest = id;
    writeLib(lib);
    return { ok: true, doc: doc, latest: lib.latest, warnings: parsed.warnings || [], files: [doc.file, RES_DIR + '/' + id + '.json', RES_DIR + '/library.json'] };
  }

  function setLatest(id) {
    if (!okId(id)) return { ok: false, error: 'There is no FDD "' + str(id) + '" in the library.' };
    const lib = readLib();
    if (!lib.docs.some((d) => d.id === id)) return { ok: false, error: 'There is no FDD "' + id + '" in the library.' };
    lib.latest = id;
    writeLib(lib);
    return { ok: true, latest: id, files: [RES_DIR + '/library.json'] };
  }

  function remove(id) {
    if (!okId(id)) return { ok: false, error: 'There is no FDD "' + str(id) + '" in the library.' };
    const lib = readLib();
    const doc = lib.docs.filter((d) => d.id === id)[0];
    if (!doc) return { ok: false, error: 'There is no FDD "' + id + '" in the library.' };
    lib.docs = lib.docs.filter((d) => d.id !== id);
    if (lib.latest === id) lib.latest = '';
    writeLib(lib);
    removeRes(id + '.json');
    const docFile = inDocs(doc.file);
    if (docFile) { try { fs.unlinkSync(docFile); } catch (e) { /* gone */ } }
    return { ok: true, latest: lib.latest, files: [doc.file, RES_DIR + '/' + id + '.json', RES_DIR + '/library.json'] };
  }

  function outline(id) {
    if (!okId(id)) return { ok: false, error: 'There is no FDD "' + str(id) + '" in the library.' };
    const lib = readLib();
    const doc = lib.docs.filter((d) => d.id === id)[0];
    if (!doc) return { ok: false, error: 'There is no FDD "' + id + '" in the library.' };
    try {
      const j = JSON.parse(fs.readFileSync(path.join(resDir, id + '.json'), 'utf8'));
      return { ok: true, doc: doc, sections: (j.sections || []).map((s) => ({ n: s.n, t: s.t, l: s.l, chars: str(s.x).length })) };
    } catch (e) { return { ok: false, error: 'The sections of "' + id + '" are missing (' + RES_DIR + '/' + id + '.json).' }; }
  }

  function original(id) {
    const doc = okId(id) ? readLib().docs.filter((d) => d.id === id)[0] : null;
    const file = doc ? inDocs(doc.file) : '';
    if (!file) return { ok: false, error: 'No such document.' };
    if (!fs.existsSync(file)) return { ok: false, error: doc.file + ' is not in this copy of the project (git pull?).' };
    return { ok: true, file: file, name: doc.originalName || path.basename(file), mime: MIME[doc.kind] || 'application/octet-stream' };
  }

  async function gitStatus() {
    const inside = await git(['rev-parse', '--is-inside-work-tree']);
    if (inside.code !== 0 || !/true/.test(inside.stdout)) return { available: false, pending: [], unpushed: [], reason: /not installed|ENOENT/.test(inside.stderr) ? 'git is not installed on this PC.' : 'This project folder is not a git repository.' };
    const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
    const up = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    const upstream = up.code === 0 ? up.stdout.trim() : '';
    const st = await git(['status', '--porcelain', '--untracked-files=all', '--'].concat(PATHS));
    const pending = st.stdout.split('\n').map((l) => l.slice(3).trim()).filter(Boolean);
    let unpushed = [];
    if (upstream) {
      const lg = await git(['log', '--format=%h %s', upstream + '..HEAD', '--'].concat(PATHS));
      unpushed = lg.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    }
    return { available: true, branch: branch, upstream: upstream, pending: pending, unpushed: unpushed };
  }

  async function gitSave(b) {
    b = b || {};
    const st = await gitStatus();
    if (!st.available) return { ok: false, error: st.reason };
    let committed = '';
    if (st.pending.length) {
      const add = await git(['add', '-A', '--'].concat(PATHS));
      if (add.code !== 0) return { ok: false, error: 'git add failed: ' + add.stderr.trim() };
      const msg = str(b.message).trim() || 'FDD library: update';
      // the exact paths that changed (a rename "a -> b" is both), so nothing else that is staged goes into this commit
      const files = [];
      st.pending.forEach((p) => p.split(' -> ').forEach((f) => { f = f.replace(/^"|"$/g, ''); if (f && files.indexOf(f) === -1) files.push(f); }));
      const c = await git(['commit', '-m', msg, '--'].concat(files));
      if (c.code !== 0) {
        const why = (c.stderr || c.stdout).trim();
        return { ok: false, error: 'git commit failed: ' + why, hint: /user\.(name|email)|identity/i.test(why) ? 'Tell git who you are: git config --global user.name "Your Name" and git config --global user.email you@example.com' : '' };
      }
      committed = (await git(['rev-parse', '--short', 'HEAD'])).stdout.trim();
    }
    if (b.push === false) return { ok: true, committed: committed, pushed: false, branch: st.branch, upstream: st.upstream };
    if (!committed && !st.unpushed.length) return { ok: true, committed: '', pushed: false, nothing: true, branch: st.branch, upstream: st.upstream };
    const p = st.upstream ? await git(['push']) : await git(['push', '-u', 'origin', 'HEAD']);
    if (p.code !== 0) {
      const why = (p.stderr || p.stdout).trim();
      return { ok: false, committed: committed, pushed: false, branch: st.branch, upstream: st.upstream, error: 'git push failed: ' + why,
        hint: /rejected|fetch first|non-fast-forward/i.test(why) ? 'Someone pushed first. Run git pull in the project, then Commit & push again.'
          : /could not read|authentication|permission|403|denied/i.test(why) ? 'git could not sign in to the remote. Push once from a terminal (git push) to save your credentials, then try again.' : '' };
    }
    const after = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    return { ok: true, committed: committed, pushed: true, branch: st.branch, upstream: after.code === 0 ? after.stdout.trim() : st.upstream };
  }

  return {
    info: () => { const lib = readLib(); return { ok: true, canUpload: canUpload(), latest: lib.latest, docs: lib.docs, paths: { docs: DOCS_DIR, resources: RES_DIR } }; },
    upload: upload, setLatest: setLatest, remove: remove, outline: outline, original: original,
    gitStatus: gitStatus, gitSave: gitSave,
    setMirror: (dir) => { mirror = dir || ''; sync(); },
    root: root,
  };
}

module.exports = { open, parse, parseDocx, parseHtml, parseText, parsePdf, unzip, headingNumber, canFollow, sectionsFrom, DOCS_DIR, RES_DIR, KINDS };
