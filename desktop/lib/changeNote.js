'use strict';
/**
 * Change notes: a comment Build.Rite writes into the code beside each change it makes (Code fix, an issue's fix), so
 * whoever reads the code later sees why it is so — what was asked, who asked and when, who changed it (approved and
 * applied) and when, the issue and the Jira story, the change's id (its history in Code fix → Change history).
 *
 *   annotate(rel, oldText, newText, meta, ops?)  →  { text, notes, skipped }
 *
 * In the comment syntax of the file, and only where a comment is allowed:
 *   - HTML: <!-- … --> on its own lines, before the change — or, when the change is inside a tag (an attribute), before
 *     the line the tag starts on; inside <style>/<script>, a CSS/JS comment; never inside <textarea>/<title>.
 *   - JavaScript: // lines before the change (never inside a string, a template or a comment).
 *   - CSS: a block comment before the change.
 *   - JSON has no comments: never touched (the page's HTML or JS note names those files instead: meta.also).
 * The first change in a file gets the whole note; each other one, a line pointing to it. ops(a, b) (lines → [[' '|'-'|'+',
 * line]]) finds the changes; without it, one span from the first to the last line that differs.
 *
 * meta: { id, page, request, kind, askedBy, askedAt, changedBy, changedAt, how, proposedBy, issue, jira, also: [names] }
 */

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const RAW = { script: 1, style: 1, textarea: 1, title: 1 };
const str = (v) => (v == null ? '' : String(v));
const p2 = (n) => (n < 10 ? '0' : '') + n;

/** "15 Nov 2026 at 00:41 (UTC+03:00)": this PC's time, its offset said (the code is read anywhere). */
function when(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d.getTime())) return '';
  const off = -d.getTimezoneOffset(), a = Math.abs(off);
  return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear() + ' at ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ' (UTC' + (off < 0 ? '-' : '+') + p2(Math.floor(a / 60)) + ':' + p2(a % 60) + ')';
}
const oneLine = (s, max) => { const t = str(s).replace(/\s+/g, ' ').trim(); return t.length > max ? t.slice(0, max - 1) + '…' : t; };

/** The note's lines (no comment marks): the whole note, or the line pointing to it. */
function lines(meta, short) {
  const m = meta || {};
  if (short) return ['Build.Rite change ' + str(m.id) + ' (continued — see its note above): ' + oneLine(m.request, 90)];
  const by = (who, at) => (str(who) || 'someone') + (when(at) ? ' on ' + when(at) : '');
  const out = [
    'Build.Rite change ' + str(m.id) + (m.page ? ' — ' + oneLine(m.page, 60) : ''),
    'Request:      ' + oneLine(m.request, 160) + (m.kind ? ' (' + oneLine(m.kind, 20) + ')' : ''),
    'Requested by: ' + by(m.askedBy, m.askedAt),
    'Changed by:   ' + by(m.changedBy, m.changedAt) + (m.how ? ' — ' + oneLine(m.how, 90) : ''),
  ];
  if (m.proposedBy) out.push('Proposed by:  ' + oneLine(m.proposedBy, 60));
  out.push('Issue:        ' + (oneLine(m.issue, 60) || '—'));
  out.push('Jira story:   ' + (oneLine(m.jira, 80) || '—'));
  if ((m.also || []).length) out.push('Also changed: ' + m.also.map((x) => oneLine(x, 80)).join(', ') + ' (JSON files cannot hold comments)');
  return out;
}

/** The note as a comment, indented like the line it stands before. style: html | line (//) | block (/* *\/). */
function comment(ls, style, indent) {
  if (style === 'html') {
    const safe = ls.map((l) => l.replace(/--+/g, '—').replace(/[<>]/g, (c) => (c === '<' ? '‹' : '›')));
    return safe.length === 1 ? [indent + '<!-- ' + safe[0] + ' -->'] : safe.map((l, i) => indent + (i === 0 ? '<!-- ' : '     ') + l + (i === safe.length - 1 ? ' -->' : ''));
  }
  if (style === 'block') {
    const safe = ls.map((l) => l.replace(/\*\//g, '* /'));
    return safe.length === 1 ? [indent + '/* ' + safe[0] + ' */'] : safe.map((l, i) => indent + (i === 0 ? '/* ' : '   ') + l + (i === safe.length - 1 ? ' */' : ''));
  }
  return ls.map((l) => indent + '// ' + l);
}

// ── where a comment may go ────────────────────────────────────────────────────────────────────────────────────────
/** JavaScript (or CSS) read up to p: code | comment | string — a comment may start a line only in code. */
function jsStateAt(text, from, p) {
  let i = from, st = 'code', q = '';
  while (i < p) {
    const c = text[i], n = text[i + 1];
    if (st === 'code') {
      if (c === '/' && n === '/') { st = 'line'; i += 2; continue; }
      if (c === '/' && n === '*') { st = 'block'; i += 2; continue; }
      if (c === '"' || c === "'" || c === '`') { st = 'string'; q = c; i++; continue; }
      i++; continue;
    }
    if (st === 'line') { if (c === '\n') st = 'code'; i++; continue; }
    if (st === 'block') { if (c === '*' && n === '/') { st = 'code'; i += 2; continue; } i++; continue; }
    if (st === 'string') {
      if (c === '\\') { i += 2; continue; }
      if (c === q) { st = 'code'; i++; continue; }
      if (c === '\n' && q !== '`') st = 'code'; // an unclosed quote ends with its line (a regex like /'/, read loosely)
      i++; continue;
    }
  }
  return st;
}
/** HTML read up to p: text | tag (between < and >) | comment | raw (inside <script>/<style>/…), with where it started. */
function htmlStateAt(text, p) {
  let i = 0, st = 'text', q = '', start = -1, name = '', closing = false, raw = '', rawFrom = -1;
  while (i < p) {
    const c = text[i];
    if (st === 'text') {
      if (text.startsWith('<!--', i)) { st = 'comment'; start = i; i += 4; continue; }
      if (c === '<' && /[A-Za-z\/!?]/.test(text[i + 1] || '')) {
        const m = /^<(\/?)([A-Za-z][\w:-]*)/.exec(text.slice(i, i + 80));
        st = 'tag'; start = i; closing = !!(m && m[1]); name = m ? m[2].toLowerCase() : ''; i++; continue;
      }
      i++; continue;
    }
    if (st === 'comment') { if (text.startsWith('-->', i)) { st = 'text'; i += 3; continue; } i++; continue; }
    if (st === 'tag') {
      if (q) { if (c === q) q = ''; i++; continue; }
      if (c === '"' || c === "'") { q = c; i++; continue; }
      if (c === '>') { i++; st = 'text'; if (!closing && RAW[name] && text[i - 2] !== '/') { st = 'raw'; raw = name; rawFrom = i; } continue; }
      i++; continue;
    }
    if (st === 'raw') { if (c === '<' && text.slice(i, i + raw.length + 2).toLowerCase() === '</' + raw) { st = 'text'; continue; } i++; continue; }
  }
  return { st: st, start: start, raw: raw, rawFrom: rawFrom };
}

/** One span: from the first line that differs to the last (when no line diff is given). */
function spanOps(a, b) {
  let s = 0; while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0; while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const ops = [];
  for (let i = 0; i < s; i++) ops.push([' ', a[i]]);
  for (let i = s; i < a.length - e; i++) ops.push(['-', a[i]]);
  for (let i = s; i < b.length - e; i++) ops.push(['+', b[i]]);
  for (let i = a.length - e; i < a.length; i++) ops.push([' ', a[i]]);
  return ops;
}
/** Where each change starts, as a line of the new text (lines changed next to each other are one change). */
function hunksOf(ops) {
  const out = [];
  let nl = 0, gap = 99;
  ops.forEach((op) => {
    if (op[0] === ' ') { nl++; gap++; return; }
    if (gap > 0) out.push(nl);
    gap = 0;
    if (op[0] === '+') nl++;
  });
  return out;
}

function annotate(rel, oldText, newText, meta, ops) {
  const neu = str(newText);
  const ext = (/\.([a-z0-9]+)$/i.exec(str(rel)) || [])[1];
  const kind = { html: 'html', htm: 'html', js: 'js', css: 'css' }[str(ext).toLowerCase()];
  if (!kind || oldText === newText) return { text: neu, notes: 0, skipped: 0 };
  const L = neu.split('\n');
  const at = [0]; for (let i = 0; i < L.length; i++) at.push(at[i] + L[i].length + 1);
  const lineOf = (pos) => { let i = 0; while (i + 1 < at.length && at[i + 1] <= pos) i++; return i; };
  const indentOf = (i) => (/^[ \t]*/.exec(L[i] || '') || [''])[0];
  const hunks = hunksOf((ops || spanOps)(oldText == null ? [] : str(oldText).split('\n'), L));
  const places = [];
  let skipped = 0;
  hunks.forEach((h) => {
    const line = Math.min(h, L.length - (L[L.length - 1] === '' && L.length > 1 ? 2 : 1)); // not after the last newline
    let place = null;
    if (kind === 'js') { if (jsStateAt(neu, 0, at[line]) === 'code') place = { line: line, style: 'line' }; }
    else if (kind === 'css') { if (jsStateAt(neu, 0, at[line]) === 'code') place = { line: line, style: 'block' }; }
    else {
      const s = htmlStateAt(neu, at[line]);
      if (s.st === 'text') place = { line: line, style: 'html' };
      else if (s.st === 'tag' || s.st === 'comment') {
        const up = lineOf(s.start); // the line the tag (or comment) starts on — if that line starts between tags
        if (htmlStateAt(neu, at[up]).st === 'text' && !/\S/.test(L[up].slice(0, s.start - at[up]))) place = { line: up, style: 'html' };
      } else if (s.st === 'raw' && (s.raw === 'style' || s.raw === 'script')) {
        if (jsStateAt(neu, s.rawFrom, at[line]) === 'code') place = { line: line, style: 'block' };
      }
    }
    if (!place) { skipped++; return; }
    if (!places.some((x) => x.line === place.line)) places.push(place);
  });
  if (!places.length) return { text: neu, notes: 0, skipped: skipped };
  places.sort((a, b) => a.line - b.line);
  const out = L.slice();
  for (let k = places.length - 1; k >= 0; k--) {
    const pl = places[k];
    out.splice(pl.line, 0, ...comment(lines(meta, k > 0), pl.style, indentOf(pl.line)));
  }
  return { text: out.join('\n'), notes: places.length, skipped: skipped };
}

module.exports = { annotate, lines, when, htmlStateAt, jsStateAt, hunksOf };
