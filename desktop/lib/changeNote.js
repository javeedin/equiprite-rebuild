'use strict';
/**
 * Change notes: a comment Code fix writes into the code beside each change it makes (Code fix, an issue's fix), so
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
 * The first change in a file gets the whole note; each other one, a line pointing to it. After each change, where a comment
 * may stand, a line closes it ("end of Code fix change fx…"): the change is bracketed, easy to see in any editor (VB
 * Studio's too) — for a change inside a tag, after the line the tag ends on. ops(a, b) (lines → [[' '|'-'|'+', line]])
 * finds the changes; without it, one span from the first to the last line that differs.
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
  if (short) return ['Code fix change ' + str(m.id) + ' (continued — see its note above): ' + oneLine(m.request, 90)];
  const by = (who, at) => (str(who) || 'someone') + (when(at) ? ' on ' + when(at) : '');
  const out = [
    'Code fix change ' + str(m.id) + (m.page ? ' — ' + oneLine(m.page, 60) : ''),
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
  return { st: st, start: start, raw: raw, rawFrom: rawFrom, q: q };
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
/** Each change as lines of the new text: { start, end } (end: the line after it; start = end when lines were only taken
 *  away). Lines changed next to each other are one change. */
function hunksOf(ops) {
  const out = [];
  let nl = 0, gap = 99;
  ops.forEach((op) => {
    if (op[0] === ' ') { nl++; gap++; return; }
    if (gap > 0) out.push({ start: nl, end: nl });
    gap = 0;
    if (op[0] === '+') { nl++; out[out.length - 1].end = nl; }
  });
  return out;
}

function annotate(rel, oldText, newText, meta, ops) {
  const neu = str(newText);
  const ext = (/\.([a-z0-9]+)$/i.exec(str(rel)) || [])[1];
  const kind = { html: 'html', htm: 'html', js: 'js', css: 'css' }[str(ext).toLowerCase()];
  if (!kind || oldText === newText) return { text: neu, notes: 0, ends: 0, skipped: 0 };
  const L = neu.split('\n');
  const at = [0]; for (let i = 0; i < L.length; i++) at.push(at[i] + L[i].length + 1);
  const lineOf = (pos) => { let i = 0; while (i + 1 < at.length && at[i + 1] <= pos) i++; return i; };
  const indentOf = (i) => (/^[ \t]*/.exec(L[i] || '') || [''])[0];
  const last = L.length - (L[L.length - 1] === '' && L.length > 1 ? 2 : 1); // the last line with text
  const restBlank = (pos) => !/\S/.test(neu.slice(pos, at[lineOf(pos) + 1] - 1 >= pos ? at[lineOf(pos) + 1] - 1 : pos));
  // where a comment may stand at the start of line i: its style, or '' (inside a string, a tag, a textarea…)
  const styleAt = (i) => {
    if (kind === 'js') return jsStateAt(neu, 0, at[i]) === 'code' ? 'line' : '';
    if (kind === 'css') return jsStateAt(neu, 0, at[i]) === 'code' ? 'block' : '';
    const st = htmlStateAt(neu, at[i]);
    if (st.st === 'text') return 'html';
    if (st.st === 'raw' && (st.raw === 'style' || st.raw === 'script')) return jsStateAt(neu, st.rawFrom, at[i]) === 'code' ? 'block' : '';
    return '';
  };
  // the line after the end of the tag (or comment) the position is inside, when a comment may start there
  const afterOf = (pos, st) => {
    let idx = -1;
    if (st.st === 'comment') { const e = neu.indexOf('-->', pos); idx = e === -1 ? -1 : e + 3; }
    else if (st.st === 'tag') { let q = st.q; for (let i = pos; i < neu.length; i++) { const c = neu[i]; if (q) { if (c === q) q = ''; } else if (c === '"' || c === "'") q = c; else if (c === '>') { idx = i + 1; break; } } }
    if (idx === -1 || !restBlank(idx)) return -1;
    const next = lineOf(idx) + 1;
    return next <= L.length && styleAt(Math.min(next, L.length - 1)) === 'html' ? next : -1;
  };
  const places = [];
  let skipped = 0;
  hunksOf((ops || spanOps)(oldText == null ? [] : str(oldText).split('\n'), L)).forEach((h) => {
    const line = Math.min(h.start, last);
    let place = null;
    const style = styleAt(line);
    if (style) place = { line: line, style: style };
    else if (kind === 'html') {
      const st = htmlStateAt(neu, at[line]);
      if (st.st === 'tag' || st.st === 'comment') {
        const up = lineOf(st.start); // the line the tag (or comment) starts on — if that line starts between tags
        if (htmlStateAt(neu, at[up]).st === 'text' && !/\S/.test(L[up].slice(0, st.start - at[up]))) place = { line: up, style: 'html' };
      }
    }
    if (!place) { skipped++; return; }
    // its end: the line after the change, where a comment may stand (inside a tag: after the line the tag ends on)
    let end = -1;
    if (h.end > h.start) {
      const e = Math.min(h.end, last + 1);
      const se = styleAt(Math.min(e, L.length - 1));
      if (se && (se === place.style || kind !== 'html')) end = e;
      else if (kind === 'html') { const st = htmlStateAt(neu, at[e]); if (st.st === 'tag' || st.st === 'comment') end = afterOf(at[e], st); else if (se) end = e; }
    }
    place.end = end > place.line ? end : -1;
    place.endStyle = place.end === -1 ? '' : (kind === 'html' ? (styleAt(Math.min(place.end, L.length - 1)) || 'html') : place.style);
    const same = places.filter((x) => x.line === place.line)[0];
    if (same) { if (place.end > same.end) { same.end = place.end; same.endStyle = place.endStyle; } } else places.push(place);
  });
  if (!places.length) return { text: neu, notes: 0, ends: 0, skipped: skipped };
  places.sort((a, b) => a.line - b.line);
  // the inserts, from the bottom up (so the lines above keep their numbers); at one line, an end above the next note
  const ins = [];
  places.forEach((pl, k) => {
    ins.push({ line: pl.line, order: 0, lines: comment(lines(meta, k > 0), pl.style, indentOf(pl.line)) });
    const next = places[k + 1];
    if (pl.end !== -1 && (!next || pl.end <= next.line)) ins.push({ line: pl.end, order: 1, lines: comment(['end of Code fix change ' + str(meta && meta.id)], pl.endStyle, indentOf(pl.line)) });
  });
  ins.sort((a, b) => b.line - a.line || a.order - b.order);
  const out = L.slice();
  ins.forEach((x) => out.splice(x.line, 0, ...x.lines));
  return { text: out.join('\n'), notes: places.length, ends: ins.filter((x) => x.order === 1).length, skipped: skipped };
}

module.exports = { annotate, lines, when, htmlStateAt, jsStateAt, hunksOf };
