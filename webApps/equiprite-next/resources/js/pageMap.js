define([], function () {
  'use strict';

  // Application pages: the navigation maps, from the catalog (each page's `next` — the pages its code opens — and its
  // `menu` entry; desktop/lib/pageScan.js links()). Pure, apart from draw(), which lays the lines over the boxes.
  //
  //   pageMap(pages, id, via)   one page's map: { cols: [{ title, nodes }], edges: [[fromKey, toKey]] } —
  //                             Comes from (pages that open it, its menu entry) → This page → Goes to → Then
  //   appMap(pages, app, id)    the whole app: { cols, edges, counts } — from the menu, then one step, two steps…, and
  //                             the pages nothing links to
  //   draw(el) / redraw()       the lines between the boxes of a map (an SVG layer under them)
  //
  // A node: { key, id, label, sub, kind: 'menu' | 'self' | 'in' | 'out' | 'then' | 'page', via }.

  var kept = { key: '', g: null };

  function graph(pages) {
    var list = pages || [];
    var key = list.length + ':' + list.map(function (p) { return p.id + '>' + (p.next || []).join(',') + (p.deleted ? '!' : ''); }).join('|');
    if (kept.key === key) return kept.g;
    var byId = {}, next = {}, prev = {};
    list.forEach(function (p) { if (!p.deleted) { byId[p.id] = p; next[p.id] = []; prev[p.id] = []; } });
    list.forEach(function (p) {
      if (!byId[p.id]) return;
      (p.next || []).forEach(function (to) { if (byId[to] && next[p.id].indexOf(to) === -1) { next[p.id].push(to); prev[to].push(p.id); } });
    });
    kept = { key: key, g: { byId: byId, next: next, prev: prev } };
    return kept.g;
  }

  function node(g, id, key, kind, via) {
    var p = g.byId[id] || { label: id, flow: '', page: id, appName: '' };
    return { key: key, id: id, label: p.label || id, sub: (p.flow ? p.flow + '/' : '') + p.page, kind: kind, via: via || '' };
  }

  function pageMap(pages, id, via) {
    var g = graph(pages);
    var self = g.byId[id];
    if (!self) return { cols: [], edges: [] };
    var edges = [];
    var from = [];
    if (self.menu) { from.push({ key: 'f:menu', id: '', label: 'Menu', sub: self.menu, kind: 'menu', via: '' }); edges.push(['f:menu', 'self']); }
    (g.prev[id] || []).forEach(function (p) { from.push(node(g, p, 'f:' + p, 'in')); edges.push(['f:' + p, 'self']); });
    var to = (g.next[id] || []).map(function (n) {
      var v = (via || []).filter(function (x) { return x.id === n; })[0];
      edges.push(['self', 't:' + n]);
      return node(g, n, 't:' + n, 'out', v && v.via && v.via.length ? 'by ' + v.via.join(', ') : '');
    });
    var seen = {}; seen[id] = true;
    (g.next[id] || []).forEach(function (n) { seen[n] = true; });
    var then = [];
    (g.next[id] || []).forEach(function (n) {
      (g.next[n] || []).forEach(function (m) {
        if (m === id) { edges.push(['t:' + n, 'self']); return; } // comes back here
        if (to.some(function (x) { return x.id === m; })) { edges.push(['t:' + n, 't:' + m]); return; }
        if (!seen[m]) { seen[m] = true; if (then.length < 24) then.push(node(g, m, 'n:' + m, 'then')); }
        if (then.some(function (x) { return x.id === m; })) edges.push(['t:' + n, 'n:' + m]);
      });
    });
    return {
      cols: [
        { title: 'Comes from', nodes: from, empty: 'Nothing opens it (and it is not in the menu).' },
        { title: 'This page', nodes: [node(g, id, 'self', 'self')], empty: '' },
        { title: 'Goes to', nodes: to, empty: 'It opens no other page.' },
        { title: 'Then', nodes: then, empty: to.length ? 'Those pages go nowhere new.' : '' }
      ],
      edges: edges
    };
  }

  function appMap(pages, app, id) {
    var g = graph(pages);
    var ids = Object.keys(g.byId).filter(function (k) { return g.byId[k].app === app; });
    var depth = {};
    var queue = ids.filter(function (k) { return !!g.byId[k].menu; });
    var fromMenu = queue.length > 0;
    if (!fromMenu) queue = ids.filter(function (k) { return !(g.prev[k] || []).some(function (p) { return g.byId[p] && g.byId[p].app === app; }) && (g.next[k] || []).length; });
    queue.forEach(function (k) { depth[k] = 0; });
    while (queue.length) {
      var k = queue.shift();
      (g.next[k] || []).forEach(function (n) { if (g.byId[n] && g.byId[n].app === app && depth[n] === undefined) { depth[n] = depth[k] + 1; queue.push(n); } });
    }
    var maxCol = 4;
    var cols = [];
    var titles = [fromMenu ? 'From the menu' : 'Where links start', 'One step on', 'Two steps on', 'Three steps on', 'Four or more'];
    for (var c = 0; c <= maxCol; c++) cols.push({ title: titles[c], nodes: [], empty: '' });
    var loose = [];
    ids.forEach(function (k) {
      var n = node(g, k, k, k === id ? 'self' : 'page');
      if (g.byId[k].menu) n.via = g.byId[k].menu;
      if (depth[k] === undefined) loose.push(n);
      else cols[Math.min(depth[k], maxCol)].nodes.push(n);
    });
    cols.forEach(function (col) { col.nodes.sort(function (a, b) { return a.sub.localeCompare(b.sub); }); });
    cols = cols.filter(function (col) { return col.nodes.length; });
    if (loose.length) cols.push({ title: 'Not reached', nodes: loose.sort(function (a, b) { return a.sub.localeCompare(b.sub); }), empty: '', loose: true });
    var shown = {};
    cols.forEach(function (col) { col.nodes.forEach(function (n) { shown[n.id] = true; }); });
    var edges = [];
    ids.forEach(function (k) { (g.next[k] || []).forEach(function (n) { if (shown[k] && shown[n]) edges.push([k, n]); }); });
    var linked = ids.filter(function (k) { return (g.next[k] || []).length || (g.prev[k] || []).length; }).length;
    return { cols: cols, edges: edges, counts: { pages: ids.length, links: edges.length, linked: linked, menu: ids.filter(function (k) { return !!g.byId[k].menu; }).length } };
  }

  // ── the lines ──
  var NS = 'http://www.w3.org/2000/svg';
  function draw(el) {
    if (!el || typeof document === 'undefined') return;
    var edges = [];
    try { edges = JSON.parse(el.getAttribute('data-edges') || '[]'); } catch (e) { edges = []; }
    var svg = el.querySelector('svg.nx-pm-svg');
    if (!svg) { svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'nx-pm-svg'); el.insertBefore(svg, el.firstChild); }
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var box = el.getBoundingClientRect();
    svg.setAttribute('width', String(el.scrollWidth)); svg.setAttribute('height', String(el.scrollHeight));
    var defs = document.createElementNS(NS, 'defs');
    ['a', 'h', 'o'].forEach(function (k) {
      var mk = document.createElementNS(NS, 'marker');
      mk.setAttribute('id', 'nx-pm-arrow-' + k + '-' + (el.id || 'm')); mk.setAttribute('viewBox', '0 0 10 10'); mk.setAttribute('refX', '9'); mk.setAttribute('refY', '5');
      mk.setAttribute('markerWidth', '7'); mk.setAttribute('markerHeight', '7'); mk.setAttribute('orient', 'auto-start-reverse');
      var pth = document.createElementNS(NS, 'path'); pth.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z'); pth.setAttribute('class', 'nx-pm-head nx-pm-head--' + k);
      mk.appendChild(pth); defs.appendChild(mk);
    });
    svg.appendChild(defs);
    var pos = {};
    Array.prototype.forEach.call(el.querySelectorAll('[data-key]'), function (n) {
      var r = n.getBoundingClientRect();
      var l = r.left - box.left + el.scrollLeft, t = r.top - box.top + el.scrollTop;
      pos[n.getAttribute('data-key')] = { l: l, r: l + r.width, t: t, b: t + r.height, cy: t + r.height / 2 };
    });
    var hot = el.getAttribute('data-hot') || '';
    // Each line gets its own point on a box's side (spread along it, in the order of the boxes at the other end), so
    // lines into or out of a busy page fan out instead of meeting in one spot. Forward: right side → left side; back
    // to an earlier column: left → right; within a column: right → right (a loop in the gap).
    var lines = [];
    edges.forEach(function (e) {
      var A = pos[e[0]], B = pos[e[1]];
      if (!A || !B) return;
      var kind = B.l > A.r + 4 ? 'fwd' : (B.r < A.l - 4 ? 'back' : 'loop');
      lines.push({ a: e[0], b: e[1], A: A, B: B, kind: kind, sa: kind === 'back' ? 'l' : 'r', sb: kind === 'fwd' ? 'l' : 'r' });
    });
    var ports = {};
    lines.forEach(function (ln) {
      (ports[ln.a + '|' + ln.sa] = ports[ln.a + '|' + ln.sa] || []).push({ ln: ln, end: 'a', other: ln.B.cy });
      (ports[ln.b + '|' + ln.sb] = ports[ln.b + '|' + ln.sb] || []).push({ ln: ln, end: 'b', other: ln.A.cy });
    });
    Object.keys(ports).forEach(function (k) {
      var list = ports[k].sort(function (x, y) { return x.other - y.other; });
      list.forEach(function (pt, i) {
        var N = pt.end === 'a' ? pt.ln.A : pt.ln.B;
        var h = N.b - N.t, pad = Math.min(10, h / 4);
        pt.ln[pt.end === 'a' ? 'ya' : 'yb'] = list.length === 1 ? N.cy : N.t + pad + (h - 2 * pad) * (i + 0.5) / list.length;
      });
    });
    lines.forEach(function (ln, i) {
      var A = ln.A, B = ln.B, ya = ln.ya, yb = ln.yb, d;
      if (ln.kind === 'fwd') {
        var dx = Math.max(30, (B.l - A.r) * 0.55);
        d = 'M ' + A.r + ' ' + ya + ' C ' + (A.r + dx) + ' ' + ya + ', ' + (B.l - dx) + ' ' + yb + ', ' + (B.l - 2) + ' ' + yb;
      } else if (ln.kind === 'back') {
        var bx = Math.max(30, (A.l - B.r) * 0.55);
        d = 'M ' + A.l + ' ' + ya + ' C ' + (A.l - bx) + ' ' + ya + ', ' + (B.r + bx) + ' ' + yb + ', ' + (B.r + 2) + ' ' + yb;
      } else {
        var bulge = 22 + (i % 4) * 9 + Math.min(40, Math.abs(yb - ya) / 6);
        d = 'M ' + A.r + ' ' + ya + ' C ' + (A.r + bulge) + ' ' + ya + ', ' + (B.r + bulge) + ' ' + yb + ', ' + (B.r + 2) + ' ' + yb;
      }
      var isHot = hot && (ln.a === hot || ln.b === hot);
      var p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      p.setAttribute('data-a', ln.a); p.setAttribute('data-b', ln.b);
      p.setAttribute('class', 'nx-pm-edge' + (ln.kind !== 'fwd' ? ' nx-pm-edge--back' : '') + (isHot ? ' nx-pm-edge--hot' : ''));
      p.setAttribute('marker-end', 'url(#nx-pm-arrow-' + (isHot ? 'h' : 'a') + '-' + (el.id || 'm') + ')');
      svg.appendChild(p);
    });
    hoverable(el);
    if (el.classList.contains('nx-pm--hover') && el.getAttribute('data-hover') && el.__nxApply) el.__nxApply(el.getAttribute('data-hover'));
  }
  // Pointing at a page: only its lines stay bright (the others fade), and the pages at their other ends are marked.
  function hoverable(el) {
    if (el.__nxHover) return;
    el.__nxHover = true;
    var orange = 'url(#nx-pm-arrow-o-' + (el.id || 'm') + ')';
    var clear = function () {
      el.classList.remove('nx-pm--hover');
      Array.prototype.forEach.call(el.querySelectorAll('.is-hover'), function (x) { x.classList.remove('is-hover'); if (x.getAttribute('data-m')) x.setAttribute('marker-end', x.getAttribute('data-m')); });
      Array.prototype.forEach.call(el.querySelectorAll('.nx-pm-node--near'), function (x) { x.classList.remove('nx-pm-node--near'); });
    };
    // (also after a redraw while pointing: the new lines lit again)
    el.__nxApply = function (key) { apply(key); };
    el.addEventListener('mouseover', function (ev) {
      var n = ev.target && ev.target.closest ? ev.target.closest('[data-key]') : null;
      if (!n || !el.contains(n)) return;
      var key = n.getAttribute('data-key');
      if (el.getAttribute('data-hover') === key && el.classList.contains('nx-pm--hover')) return;
      apply(key);
    });
    function apply(key) {
      clear();
      el.setAttribute('data-hover', key);
      var near = {};
      Array.prototype.forEach.call(el.querySelectorAll('path.nx-pm-edge'), function (p) {
        var a = p.getAttribute('data-a'), b = p.getAttribute('data-b');
        if (a === key || b === key) { p.classList.add('is-hover'); p.setAttribute('data-m', p.getAttribute('marker-end')); p.setAttribute('marker-end', orange); near[a === key ? b : a] = true; }
      });
      Array.prototype.forEach.call(el.querySelectorAll('[data-key]'), function (x) { if (near[x.getAttribute('data-key')]) x.classList.add('nx-pm-node--near'); });
      el.classList.add('nx-pm--hover');
    }
    el.addEventListener('mouseout', function (ev) {
      var to = ev.relatedTarget;
      var n = to && to.closest ? to.closest('[data-key]') : null;
      if (!n || !el.contains(n)) { el.removeAttribute('data-hover'); clear(); }
    });
  }
  function redraw() {
    if (typeof document === 'undefined') return;
    [60, 350].forEach(function (ms) {
      setTimeout(function () { Array.prototype.forEach.call(document.querySelectorAll('.nx-pm[data-edges]'), function (el) { if (el.offsetParent !== null) draw(el); }); }, ms);
    });
  }

  return { graph: graph, pageMap: pageMap, appMap: appMap, draw: draw, redraw: redraw };
});
