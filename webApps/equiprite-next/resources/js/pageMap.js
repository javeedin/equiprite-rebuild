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
    ['a', 'h'].forEach(function (k) {
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
    edges.forEach(function (e) {
      var A = pos[e[0]], B = pos[e[1]];
      if (!A || !B) return;
      var d, back = false;
      if (B.l > A.r + 4) { // on to a later column
        var dx = Math.max(24, (B.l - A.r) / 2);
        d = 'M ' + A.r + ' ' + A.cy + ' C ' + (A.r + dx) + ' ' + A.cy + ', ' + (B.l - dx) + ' ' + B.cy + ', ' + (B.l - 2) + ' ' + B.cy;
      } else if (B.r < A.l - 4) { // back to an earlier column
        back = true;
        var bx = Math.max(24, (A.l - B.r) / 2);
        d = 'M ' + A.l + ' ' + A.cy + ' C ' + (A.l - bx) + ' ' + A.cy + ', ' + (B.r + bx) + ' ' + B.cy + ', ' + (B.r + 2) + ' ' + B.cy;
      } else { // within one column: a loop on the right
        back = true;
        var bulge = 26 + Math.min(50, Math.abs(B.cy - A.cy) / 5);
        d = 'M ' + A.r + ' ' + A.cy + ' C ' + (A.r + bulge) + ' ' + A.cy + ', ' + (B.r + bulge) + ' ' + B.cy + ', ' + (B.r + 2) + ' ' + B.cy;
      }
      var isHot = hot && (e[0] === hot || e[1] === hot);
      var p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      p.setAttribute('class', 'nx-pm-edge' + (back ? ' nx-pm-edge--back' : '') + (isHot ? ' nx-pm-edge--hot' : ''));
      p.setAttribute('marker-end', 'url(#nx-pm-arrow-' + (isHot ? 'h' : 'a') + '-' + (el.id || 'm') + ')');
      svg.appendChild(p);
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
