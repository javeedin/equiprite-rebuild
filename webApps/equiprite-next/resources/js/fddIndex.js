define([], function () {
  'use strict';

  // The FDD for "Analyze with AI": which sections of the chosen FDD the AI reads for a story. Pure — no page, no DOM, no
  // network (resources/js/fddClient.js loads the library and the documents; desktop/lib/fdd.js writes them).
  //
  // A document is { id, name, version, sections: [{ n, t, l, x }] } (n: "7.2.5G" or '', t: title, l: level, x: text).
  //
  //   pick(doc, story, { question, budget })  { picked: [{ n, t, why, chars, cut }], text } — the sections the story
  //                                           names (its "FDD Section: 7.2, 7.2.5G" line, with their subsections, or
  //                                           the closest one when the exact number is not in the document; BR-012 /
  //                                           INT-03 style ids by where they are mentioned), then the sections whose
  //                                           words best match the story (and the chat question), until `budget` chars
  //   section(doc, n)                         one section { n, t, l, x, parent } (for the "read from the FDD" viewer)
  //   outline(doc)                            [{ n, t, l, chars }]
  //   label(entry)                            "EquipRite FDD · v1.7"
  //   options(library)                        the selector's options, latest first and marked

  var STOP = {};
  ('the and for with that this from are was were will shall should must can not but all any each per into onto when ' +
    'then than have has had its their there which who what where how also only such use used using able via within ' +
    'out our your you they them his her been being does done may might would could upon about after before more most ' +
    'other some same so too very just new add show page story user users system equiprite fdd section sections ' +
    'acceptance criteria given able need needs required requirement').split(' ').forEach(function (w) { STOP[w] = true; });

  function txt(v) { return v == null ? '' : String(v); }
  function key(n) { return txt(n).trim().toUpperCase().replace(/[.)]+$/, ''); }
  function isNum(r) { return /^\d{1,3}(\.\d{1,3})*[A-Z]?$/.test(r); }
  function words(s) {
    var m = txt(s).toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || [];
    return m.filter(function (w) { return !STOP[w]; });
  }
  function secs(doc) { return (doc && doc.sections) || []; }

  // Term statistics, computed once per document and kept on it (not enumerable, so it never goes back to a server).
  function stats(doc) {
    if (doc._ix) return doc._ix;
    var df = {}, tfs = [], lens = [], total = 0;
    secs(doc).forEach(function (s) {
      var tf = {}, ws = words(s.t + ' ' + s.t + ' ' + s.x); // the title counts twice
      ws.forEach(function (w) { tf[w] = (tf[w] || 0) + 1; });
      Object.keys(tf).forEach(function (w) { df[w] = (df[w] || 0) + 1; });
      tfs.push(tf); lens.push(ws.length); total += ws.length;
    });
    var ix = { df: df, tfs: tfs, lens: lens, avg: total / Math.max(1, lens.length), N: lens.length };
    try { Object.defineProperty(doc, '_ix', { value: ix, enumerable: false, configurable: true }); } catch (e) { /* frozen */ }
    return ix;
  }

  /** BM25 score of every section for these terms: [{ i, score, hits: [term] }], best first, only those with a hit. */
  function rank(doc, terms) {
    var ix = stats(doc), k1 = 1.4, b = 0.75, uniq = {};
    terms.forEach(function (t) { uniq[t] = true; });
    var q = Object.keys(uniq);
    var out = [];
    ix.tfs.forEach(function (tf, i) {
      var score = 0, hits = [];
      q.forEach(function (t) {
        var f = tf[t];
        if (!f) return;
        var idf = Math.log(1 + (ix.N - ix.df[t] + 0.5) / (ix.df[t] + 0.5));
        score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * ix.lens[i] / ix.avg));
        hits.push(t);
      });
      if (score > 0) out.push({ i: i, score: score, hits: hits });
    });
    return out.sort(function (a, c) { return c.score - a.score; });
  }

  function indexOf(doc, n) {
    var k = key(n), ss = secs(doc);
    for (var i = 0; i < ss.length; i++) if (key(ss[i].n) === k) return i;
    return -1;
  }
  /** The section a reference names, or the closest one the document has: 7.2.5G → 7.2.5 → 7.2 → 7. */
  function closest(doc, ref) {
    var r = key(ref), i = indexOf(doc, r);
    if (i !== -1) return { i: i, exact: true };
    var cand = r;
    while (cand) {
      cand = /[A-Z]$/.test(cand) ? cand.slice(0, -1) : (cand.indexOf('.') !== -1 ? cand.replace(/\.[^.]*$/, '') : '');
      if (cand && (i = indexOf(doc, cand)) !== -1) return { i: i, exact: false };
    }
    return null;
  }
  /** The subsections of section i, in document order (7.2 → 7.2.1, 7.2.5G; 7.2.5 → 7.2.5A). */
  function children(doc, i) {
    var n = key(secs(doc)[i].n), out = [];
    if (!n) return out;
    secs(doc).forEach(function (s, j) {
      var k = key(s.n);
      if (j !== i && k && (k.indexOf(n + '.') === 0 || (k.length === n.length + 1 && k.indexOf(n) === 0 && /[A-Z]$/.test(k)))) out.push(j);
    });
    return out;
  }
  function parentOf(doc, i) {
    var n = key(secs(doc)[i].n);
    while (n) {
      n = /[A-Z]$/.test(n) ? n.slice(0, -1) : (n.indexOf('.') !== -1 ? n.replace(/\.[^.]*$/, '') : '');
      var j = n ? indexOf(doc, n) : -1;
      if (j !== -1 && j !== i) return secs(doc)[j];
    }
    return null;
  }
  /** The lines of a section around an id (BR-012), with a line either side, when the section is long. */
  function around(x, id, max) {
    if (x.length <= max) return x;
    var lines = x.split('\n'), keep = {}, re = new RegExp('\\b' + id.replace(/[-.]/g, '\\$&') + '\\b', 'i');
    lines.forEach(function (l, j) { if (re.test(l)) { keep[j - 1] = keep[j] = keep[j + 1] = true; } });
    var out = lines.filter(function (l, j) { return keep[j]; }).join('\n');
    return out || x;
  }

  function pick(doc, story, opts) {
    var o = opts || {}, s = story || {};
    var budget = o.budget || 30000;
    var used = 0, picked = [], parts = [], have = {};
    var ss = secs(doc);
    if (!ss.length) return { picked: [], text: '' };

    function add(i, why, cap, body) {
      if (have[i] || used >= budget) return 0;
      var sec = ss[i], par = parentOf(doc, i);
      var head = '### FDD ' + (sec.n ? sec.n + ' ' : '') + sec.t + (par ? ' (in ' + (par.n ? par.n + ' ' : '') + par.t + ')' : '');
      var x = txt(body != null ? body : sec.x);
      var room = Math.min(cap || budget, budget - used) - head.length - 2;
      if (room < 160 && x.length > room) return 0;
      var cut = x.length > room;
      if (cut) x = x.slice(0, Math.max(0, room - 12)).replace(/\s+\S*$/, '') + ' … (cut)';
      have[i] = true;
      parts.push(head + '\n' + (x || '(no text under this heading)'));
      used += head.length + x.length + 2;
      picked.push({ n: sec.n, t: sec.t, why: why, chars: x.length, cut: cut });
      return head.length + x.length;
    }

    // 1. The sections the story names, each with its subsections, sharing most of the budget.
    var refs = (s.fdd || []).map(key).filter(Boolean);
    var share = refs.length ? Math.max(6000, Math.floor(budget * 0.7 / refs.length)) : 0;
    refs.forEach(function (ref) {
      if (isNum(ref)) {
        var c = closest(doc, ref);
        if (!c) return;
        var left = share - add(c.i, c.exact ? 'named by the story' : 'closest to ' + ref + ' (named by the story)', share);
        children(doc, c.i).forEach(function (j) { if (left > 400) left -= add(j, 'part of ' + (ss[c.i].n || ref), left); });
      } else {
        // an id (BR-012, INT-03, DP-01, S01): where the document mentions it, a heading first
        var re = new RegExp('\\b' + ref.replace(/[-.]/g, '\\$&') + '\\b', 'i');
        var hits = [];
        ss.forEach(function (sec, j) { if (re.test(sec.t)) hits.unshift(j); else if (re.test(sec.x)) hits.push(j); });
        hits.slice(0, 2).forEach(function (j) { add(j, 'mentions ' + ref, Math.min(share, 5000), re.test(ss[j].t) ? null : around(ss[j].x, ref, 3000)); });
      }
    });

    // 2. The sections whose words best match the story (and the question), a few, each kept short.
    var q = [s.summary, s.summary, s.ac, s.body, s.epicName, o.question, o.question, o.question].join(' ');
    var terms = words(q);
    if (terms.length) {
      var best = rank(doc, terms).filter(function (r) { return !have[r.i] && (r.hits.length >= 2 || r.score > 3); });
      var top = best.length ? best[0].score : 0;
      best.filter(function (r) { return r.score >= top * 0.35; }).slice(0, o.question ? 3 : 4).forEach(function (r) {
        add(r.i, 'matches ' + r.hits.slice(0, 4).join(', '), 4000);
      });
    }
    return { picked: picked, text: parts.join('\n\n') };
  }

  function section(doc, n) {
    var i = indexOf(doc, n);
    if (i === -1) {
      // by title, for a section without a number
      var t = txt(n).trim().toLowerCase();
      secs(doc).some(function (s, j) { if (!s.n && s.t.toLowerCase() === t) { i = j; return true; } return false; });
    }
    if (i === -1) return null;
    var s = secs(doc)[i], p = parentOf(doc, i);
    return { n: s.n, t: s.t, l: s.l, x: s.x, parent: p ? ((p.n ? p.n + ' ' : '') + p.t) : '' };
  }

  function outline(doc) {
    return secs(doc).map(function (s) { return { n: s.n, t: s.t, l: s.l, chars: txt(s.x).length }; });
  }

  function label(d) {
    if (!d) return '';
    return txt(d.name) + (txt(d.version) ? ' · v' + txt(d.version).replace(/^v/i, '') : '');
  }

  function options(lib) {
    var l = lib || {}, docs = (l.docs || []).slice();
    docs.sort(function (a, b) { return (b.id === l.latest) - (a.id === l.latest) || txt(b.uploadedAt).localeCompare(txt(a.uploadedAt)); });
    return docs.map(function (d) { return { id: d.id, label: label(d) + (d.id === l.latest ? ' (latest)' : ''), latest: d.id === l.latest }; });
  }

  return { pick: pick, section: section, outline: outline, label: label, options: options, rank: rank, closest: closest, words: words };
});
