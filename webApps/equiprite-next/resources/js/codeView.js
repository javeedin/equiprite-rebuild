define([], function () {
  'use strict';

  // The Page code tab: one file of a page, read only — line numbers, colours (comments, strings, keywords; HTML tags,
  // attributes and JET bindings), and what is searched for marked. doc() is the document for a sandboxed iframe (no
  // scripts; the page scrolls it to the first match with scrollTo()). Pure apart from scrollTo().
  //
  //   doc(text, path, find) → '<!doctype html>…'     hits(text, find) → number     scrollTo(frameId, line)

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function langOf(path) { var m = /\.([a-z0-9]+)$/i.exec(path || ''); var x = m ? m[1].toLowerCase() : ''; return x === 'html' || x === 'htm' ? 'html' : (x === 'js' || x === 'json' || x === 'ts' ? 'js' : 'text'); }
  var KW = 'const|let|var|function|return|if|else|for|while|do|switch|case|default|break|continue|class|extends|new|this|async|await|try|catch|finally|throw|typeof|instanceof|in|of|define|require|true|false|null|undefined|static|get|set|super|delete|void|yield';
  var JS = new RegExp('(\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*)|("(?:[^"\\\\\\n]|\\\\.)*"|\'(?:[^\'\\\\\\n]|\\\\.)*\'|`(?:[^`\\\\]|\\\\.)*`)|\\b(' + KW + ')\\b|\\b(\\d+(?:\\.\\d+)?)\\b', 'g');
  var HTML = /(<!--[\s\S]*?-->)|(\[\[[\s\S]*?\]\]|\{\{[\s\S]*?\}\})|(<\/?[a-zA-Z][\w:.-]*|\/?>)|([:@]?[a-zA-Z_][\w:.-]*)(?=\s*=)|("[^"]*"|'[^']*')/g;
  var BIND = /(\[\[[\s\S]*?\]\]|\{\{[\s\S]*?\}\})/g;

  /** [{ c: class, t: text }] for the whole file. */
  function segments(text, lang) {
    var out = [], re = lang === 'html' ? HTML : (lang === 'js' ? JS : null);
    if (!re) return [{ c: '', t: text }];
    re.lastIndex = 0;
    var last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push({ c: '', t: text.slice(last, m.index) });
      var cls = '';
      if (lang === 'js') cls = m[1] ? 'c' : m[2] ? 's' : m[3] ? 'k' : 'num';
      else cls = m[1] ? 'c' : m[2] ? 'b' : m[3] ? 'g' : m[4] ? 'a' : 's';
      if (lang === 'html' && cls === 's' && BIND.test(m[0])) { // a binding inside an attribute's value
        BIND.lastIndex = 0;
        m[0].split(BIND).forEach(function (part, i) { if (part) out.push({ c: i % 2 ? 'b' : 's', t: part }); });
      } else out.push({ c: cls, t: m[0] });
      BIND.lastIndex = 0;
      last = m.index + m[0].length;
      if (m[0].length === 0) re.lastIndex++;
    }
    if (last < text.length) out.push({ c: '', t: text.slice(last) });
    return out;
  }
  function finder(find) {
    var f = String(find || '').trim();
    return f.length >= 2 ? new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi') : null;
  }
  function hits(text, find) { var re = finder(find); return re ? (String(text || '').match(re) || []).length : 0; }

  function doc(text, path, find) {
    var t = String(text || '').replace(/\r\n/g, '\n');
    var re = finder(find);
    var lines = [[]];
    segments(t, langOf(path)).forEach(function (s) {
      s.t.split('\n').forEach(function (piece, i) { if (i > 0) lines.push([]); if (piece) lines[lines.length - 1].push({ c: s.c, t: piece }); });
    });
    var first = true;
    var body = lines.map(function (segs, n) {
      var html = segs.map(function (s) {
        var inner;
        if (re) {
          re.lastIndex = 0;
          var parts = [], at = 0, m;
          while ((m = re.exec(s.t))) { parts.push(esc(s.t.slice(at, m.index))); parts.push('<mark' + (first ? ' id="hit" class="first"' : '') + '>' + esc(m[0]) + '</mark>'); first = false; at = m.index + m[0].length; if (!m[0].length) re.lastIndex++; }
          parts.push(esc(s.t.slice(at)));
          inner = parts.join('');
        } else inner = esc(s.t);
        return s.c ? '<span class="' + s.c + '">' + inner + '</span>' : inner;
      }).join('');
      return '<div class="l" id="L' + (n + 1) + '"><span class="n">' + (n + 1) + '</span><span class="t">' + (html || ' ') + '</span></div>';
    }).join('');
    return '<!doctype html><meta charset="utf-8"><style>'
      + 'html,body{margin:0;background:#fff}body{font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#16212c;padding:6px 0 18px}'
      + '.l{display:flex;min-width:max-content}.l:hover{background:#f6f9fb}.n{position:sticky;left:0;flex:none;width:48px;padding-right:12px;margin-right:12px;text-align:right;color:#9aa6b2;background:#f6f8fa;border-right:1px solid #e2e7ed;user-select:none}'
      + '.t{white-space:pre;padding-right:24px}.c{color:#6a737d;font-style:italic}.s{color:#0a7d3e}.k{color:#7c3aed;font-weight:600}.num{color:#b3311f}.g{color:#00688c;font-weight:600}.a{color:#b45309}'
      + '.b{background:#eaf4fa;color:#00506c;border-radius:3px}mark{background:#ffe58a;color:inherit;border-radius:2px}mark.first{outline:2px solid #e8a400}'
      + '</style><body>' + body + '</body>';
  }
  /** Scroll the code frame to the first match (or a line). */
  function scrollTo(frameId, line) {
    if (typeof document === 'undefined') return;
    [80, 300].forEach(function (ms) {
      setTimeout(function () {
        try {
          var f = document.getElementById(frameId);
          var d = f && f.contentDocument;
          var el = d && (line ? d.getElementById('L' + line) : d.getElementById('hit'));
          if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
        } catch (e) { /* not ready */ }
      }, ms);
    });
  }

  return { doc: doc, hits: hits, segments: segments, langOf: langOf, scrollTo: scrollTo };
});
