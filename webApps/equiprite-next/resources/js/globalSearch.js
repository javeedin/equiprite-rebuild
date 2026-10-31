define([
  'resources/js/requestProgress',
  'resources/js/rules',
  'resources/js/fmt',
  'resources/js/transferList',
  'resources/js/quickAvailability'
], function (Progress, rules, fmt, transferList, qav) {
  'use strict';

  // The toolbar's global search: everything this person may see, found as they type. Pure: the shell's chains read
  // the data (searchData.js) and pass the menu's matches (nav.search); this indexes the rest once per load and finds,
  // ranks and groups what is typed.
  //
  //   Screens     the menu this role has (nav.search, as before)
  //   Requests    number, project, customer, task, who asked, and the equipment on its lines (name, class, unit)
  //               -> the request's tab
  //   Equipment   equipment items (name, number, class, make, model) -> everything about it (equipment-360);
  //               classes and yards, with what is free now -> Availability on them
  //   Units       serial, maintenance asset, fixed asset -> everything about that unit (equipment-360)
  //   Transfers   order number, tracking number, its request, project, from and to -> the transfer's tab
  //
  // Only what the role may open is indexed (accessOf: the menu items it has), so a match never leads to a screen that
  // refuses it. A request number typed still offers "Open request …" when it is not among those read, as before.

  var GROUPS = [
    { key: 'screens', label: 'Screens', scope: 'screens', few: 3, one: 'screen', many: 'screens' },
    { key: 'requests', label: 'Requests', scope: 'requests', few: 4, one: 'request', many: 'requests' },
    { key: 'equipment', label: 'Equipment', scope: 'equipment', few: 4, one: 'equipment item or class', many: 'equipment items and classes' },
    { key: 'units', label: 'Units', scope: 'equipment', few: 4, one: 'unit', many: 'units' },
    { key: 'transfers', label: 'Transfers', scope: 'requests', few: 3, one: 'transfer', many: 'transfers' },
    { key: 'yards', label: 'Yards', scope: 'equipment', few: 2, one: 'yard', many: 'yards' }
  ];
  var SCOPES = [
    { key: 'all', label: 'Everything' },
    { key: 'screens', label: 'Screens' },
    { key: 'requests', label: 'Requests' },
    { key: 'equipment', label: 'Equipment' }
  ];
  // A group shows `few` rows under Everything, SCOPED once narrowed to its scope, EXPANDED after "N more".
  var SCOPED = 12;
  var EXPANDED = 40;
  var ICONS = {
    request: 'oj-ux-ico-file-text', item: 'oj-ux-ico-box-grid', cls: 'oj-ux-ico-tag', unit: 'oj-ux-ico-barcode',
    transfer: 'oj-ux-ico-inventory-transfer', yard: 'oj-ux-ico-location-pin', more: 'oj-ux-ico-chevron-down'
  };

  function lc(v) { return String(v == null ? '' : v).toLowerCase(); }
  function up(v) { return String(v == null ? '' : v).trim().toUpperCase(); }
  function has(v) { return v !== undefined && v !== null && v !== ''; }
  function cmp(a, b) { return a < b ? -1 : (a > b ? 1 : 0); }
  function norm(v) { return lc(v).replace(/\s+/g, ' ').trim(); }
  /** "REQ-1764" -> "req1764": what is typed and a key compared without spaces, dashes or dots. */
  function compact(v) { return lc(v).replace(/[^a-z0-9]+/g, ''); }
  function tokens(v) { return lc(v).split(/[^a-z0-9]+/).filter(Boolean); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

  // ── Who may see what ──────────────────────────────────────────────────────────────────────────────────────────
  /** From the menu this role has (nav.visibleGroups): which kinds of records it may open. */
  function accessOf(groups) {
    var ids = {};
    (groups || []).forEach(function (g) { (g.items || []).forEach(function (i) { ids[i.id] = true; }); });
    return { screens: (groups || []).length > 0, requests: !!ids.requests, fleet: !!ids.fleet, availability: !!ids.availability, transfers: !!ids.transfers };
  }

  function accessKey(a) {
    return ['screens', 'requests', 'fleet', 'availability', 'transfers'].map(function (k) { return a && a[k] ? 1 : 0; }).join('');
  }

  /**
   * What to read for it. The fleet (units, bookings) is read for Fleet or Availability; it is built with the requests
   * (where each booking is on its journey, as Availability does), and transfers name their requests, so the requests
   * are read for any of them.
   */
  function wants(a) {
    var x = a || {};
    var fleet = !!(x.fleet || x.availability);
    return { requests: !!(x.requests || x.transfers || fleet), fleet: fleet, transfers: !!x.transfers };
  }

  /** The scopes this role has: Everything, then Screens, Requests (with transfers), Equipment (with units and yards). */
  function scopesOf(a) {
    var x = a || {};
    return SCOPES.filter(function (s) {
      if (s.key === 'all' || s.key === 'screens') return true;
      if (s.key === 'requests') return !!(x.requests || x.transfers);
      return !!(x.fleet || x.availability);
    });
  }

  // ── The index: one entry per thing that can be found ─────────────────────────────────────────────────────────
  //   { group, kind, key, ord, keys: [ids typed whole], title, fields: [{ text, w, why }], label, sub, hint, tone, icon,
  //     open: { navId } | { record, params } | { focus, what }, hay }
  function entry(e) {
    var parts = (e.keys || []).concat([e.title]).concat((e.fields || []).map(function (f) { return f.text; }));
    e.keys = (e.keys || []).filter(has).map(String);
    e.fields = (e.fields || []).filter(function (f) { return has(f.text); });
    e.hay = parts.filter(has).join(' • ').toLowerCase();
    return e;
  }

  function requestEntries(R, now) {
    var out = [];
    (R.rows || []).forEach(function (r, i) {
      if (!r || !r.requestNumber) return;
      var lines = (R.linesByRequest || {})[r.requestNumber] || [];
      var external = rules.isExternalSource(r.requestOrigin);
      var p = Progress.summarize(up(r.status || r.requestStatus), lines, { start: r.startDate, end: r.endDate, external: external, now: now });
      var party = r.projectName || r.customerName || r.projectInternalCustomer || '';
      var fields = [
        { text: r.projectName, w: 0, why: 'Project' },
        { text: r.customerName || r.projectInternalCustomer, w: 0, why: 'Customer' },
        { text: r.projectNumber, w: 0, why: 'Project' },
        { text: r.taskName, w: 1, why: 'Task' },
        { text: r.requestorName || r.contactName, w: 1, why: 'Requested by' }
      ];
      var seen = {};
      lines.forEach(function (l) {
        [[l.name, 'Has'], [l.serial, 'Has unit'], [l.cls, 'Has']].forEach(function (x) {
          var k = lc(x[0]);
          if (!k || seen[k] || k === 'equipment') return;
          seen[k] = true;
          fields.push({ text: x[0], w: 2, why: x[1] });
        });
      });
      var params = { number: r.requestNumber };
      if (has(r.eqrEquipmentRequestId)) params.id = Number(r.eqrEquipmentRequestId);
      out.push(entry({
        group: 'requests', kind: 'request', key: 'r:' + r.requestNumber, ord: i, keys: [r.requestNumber], title: '', fields: fields,
        label: r.requestNumber, sub: [party, p.headline].filter(Boolean).join(' · '), hint: fmt.range(r.startDate, r.endDate),
        tone: p.late && p.late.length ? 'late' : '', icon: ICONS.request, open: { record: 'request', params: params }
      }));
    });
    return out;
  }

  /** "Out until 10 Nov", "In maintenance", "Free now". */
  function nowShort(u) {
    var n = u.now || {};
    if (n.state === 'free') return 'Free now';
    if (n.state === 'maint') return 'In maintenance';
    var until = /until (.+?)( \(|$)/.exec(n.text || '');
    return 'Out' + (until ? ' until ' + until[1] : '');
  }

  function fleetEntries(F, a) {
    var out = [];
    var model = F.model || { units: [] };
    var byId = {};
    (model.units || []).forEach(function (u) { byId[u.id] = u; });
    var free = function (ids) { return ids.filter(function (id) { return byId[id] && byId[id].now && byId[id].now.state === 'free'; }).length; };
    var freeHint = function (ids) { return ids.length ? free(ids) + ' of ' + ids.length + ' free now' : 'No units on record'; };
    var avail = function (text) { return { focus: 'availability', what: { text: text } }; };
    qav.items(F).forEach(function (it, i) {
      var f = free(it.unitIds);
      out.push(entry({
        group: 'equipment', kind: 'item', key: it.key, ord: 100 + i, keys: [it.number], title: it.name,
        fields: [{ text: it.cls, w: 0, why: 'Class' }, { text: it.manufacturer, w: 1, why: 'Make' }, { text: it.model, w: 1, why: 'Model' }],
        label: it.name, sub: [it.cls, it.number, plural(it.unitIds.length, 'unit')].filter(Boolean).join(' · '),
        hint: freeHint(it.unitIds), tone: f ? 'free' : (it.unitIds.length ? 'out' : ''), icon: ICONS.item,
        open: a.fleet ? { record: 'equipment-360', params: { name: it.name, equipmentId: it.equipmentId } } : avail(it.name)
      }));
    });
    if (a.availability) {
      qav.classes(F).forEach(function (c, i) {
        if (c.name === 'No class') return;
        var f = free(c.unitIds);
        out.push(entry({
          group: 'equipment', kind: 'class', key: c.key, ord: i, keys: [], title: c.name, fields: [],
          label: c.name, sub: 'Class · ' + plural(c.items, 'equipment item') + ' · ' + plural(c.unitIds.length, 'unit'),
          hint: freeHint(c.unitIds), tone: f ? 'free' : 'out', icon: ICONS.cls, open: avail(c.name)
        }));
      });
      var yards = {};
      (model.units || []).forEach(function (u) {
        if (!u.yardKey) return;
        (yards[u.yardKey] = yards[u.yardKey] || { key: u.yardKey, label: u.yard, name: qav.yardName(u), ids: [] }).ids.push(u.id);
      });
      Object.keys(yards).sort().forEach(function (k, i) {
        var y = yards[k];
        var f = free(y.ids);
        out.push(entry({
          group: 'yards', kind: 'yard', key: 'y:' + k, ord: i, keys: [k], title: y.name, fields: [{ text: y.label, w: 0, why: '' }],
          label: y.name, sub: [y.label !== y.name ? y.label : '', plural(y.ids.length, 'unit')].filter(Boolean).join(' · '),
          hint: freeHint(y.ids), tone: f ? 'free' : 'out', icon: ICONS.yard, open: avail(k)
        }));
      });
    }
    (model.units || []).slice().sort(function (x, y) { return cmp(x.serial, y.serial); }).forEach(function (u, i) {
      out.push(entry({
        group: 'units', kind: 'unit', key: 'u:' + u.serial, ord: i, keys: [u.serial, u.asset, u.fa], title: '',
        fields: [{ text: u.name, w: 0, why: '' }, { text: u.cls === 'No class' ? '' : u.cls, w: 1, why: '' }, { text: u.yardKey ? u.yard : '', w: 1, why: 'At' },
          { text: u.manufacturer, w: 2, why: 'Make' }],
        label: u.serial, sub: [u.name !== u.serial ? u.name : '', u.yardKey ? qav.yardName(u) : ''].filter(Boolean).join(' · '),
        hint: nowShort(u), tone: (u.now && u.now.state) || '', title2: (u.now && u.now.text) || '', icon: ICONS.unit,
        open: a.fleet ? { record: 'equipment-360', params: { serial: u.serial } } : avail(u.serial)
      }));
    });
    return out;
  }

  function transferEntries(T, R, now) {
    var requests = transferList.indexRequests((R && R.rows) || []);
    var orders = (T.orders || []).concat(transferList.historyOnly(T.orders, T.history));
    var out = [];
    orders.forEach(function (o, i) {
      if (!o) return;
      var row = transferList.decorate(o, { requests: requests, history: T.history, orgs: T.orgs, now: now });
      if (!has(row.id) && !o.orderNumber) return;
      var params = { number: o.orderNumber || '' };
      if (has(row.id)) params.id = Number(row.id);
      if (row.synthetic) params.source = 'history';
      var known = function (x) { return x && x !== 'not known' ? x : ''; };
      out.push(entry({
        group: 'transfers', kind: 'transfer', key: 't:' + row.key, ord: -Number(row.id || 0) || i, keys: [o.orderNumber, row.tracking], title: '',
        fields: [{ text: /^Request \d/.test(row.requestNumber) ? '' : row.requestNumber, w: 0, why: 'For' }, { text: row.party, w: 0, why: '' },
          { text: known(row.from), w: 2, why: 'From' }, { text: known(row.to), w: 2, why: 'To' }, { text: row.carrier, w: 2, why: 'Carrier' }],
        label: row.number, sub: [row.kindLabel, row.requestNumber, row.party].filter(Boolean).join(' · '),
        hint: row.state === 'unread' ? (row.dueText || '') : row.label, tone: row.late ? 'late' : '', icon: ICONS.transfer,
        open: { record: 'transfer', params: params }
      }));
    });
    return out;
  }

  /**
   * Everything that can be found, for this role: built once per load (the chain keeps it until the data changes).
   * src: searchData.snapshot() ({ requests, fleet, transfers }); a source that is missing (not read yet, failed, or
   * not this role's) is left out.
   */
  function index(src, access, now) {
    var s = src || {};
    var a = access || {};
    var t = now || Date.now();
    var entries = [];
    var loaded = { requests: false, fleet: false, transfers: false };
    if (a.requests && s.requests) { entries = entries.concat(requestEntries(s.requests, t)); loaded.requests = true; }
    if ((a.fleet || a.availability) && s.fleet && s.fleet.model) { entries = entries.concat(fleetEntries(s.fleet, a)); loaded.fleet = true; }
    if (a.transfers && s.transfers) { entries = entries.concat(transferEntries(s.transfers, s.requests, t)); loaded.transfers = true; }
    var n = {};
    entries.forEach(function (e) { n[e.kind] = (n[e.kind] || 0) + 1; });
    return { entries: entries, loaded: loaded, counts: n, access: a };
  }

  // ── Finding ───────────────────────────────────────────────────────────────────────────────────────────────────
  /**
   * How well an entry matches, lower is better, or -1: every word typed must be in it somewhere.
   *   0  the whole of an id (a number, a serial: "1764" is REQ-1764) or of its name
   *   1  the start of an id or name, or one part of an id ("2201" in EX-2201)
   *   2  the start of a word of it          3  inside it
   *   4+ what is typed is in another field (4 a project or class, 5 a task or yard, 6 the equipment on a request)
   *   8  the words are spread over several fields
   * @returns { s, why: the field it was found in, in words ('Requested by Pat Lee'), whyText: that field's text }
   */
  function score(e, q, qc, ws) {
    for (var i = 0; i < ws.length; i++) if (e.hay.indexOf(ws[i]) === -1) return { s: -1, why: '', whyText: '' };
    var best = 8;
    var why = '';
    var whyText = '';
    var digits = /^\d+$/.test(qc);
    e.keys.forEach(function (k) {
      var kc = compact(k);
      var ts = tokens(k);
      var s = 9;
      if (kc === qc || (digits && kc.replace(/^[a-z]+/, '') === qc)) s = 0;
      else if (kc.indexOf(qc) === 0 || ts.indexOf(qc) !== -1) s = 1;
      else if (ts.some(function (t) { return t.indexOf(qc) === 0; })) s = 2;
      else if (qc && kc.indexOf(qc) !== -1) s = 3;
      if (s < best) best = s;
    });
    if (e.title) {
      var t = lc(e.title);
      var s2 = 9;
      if (t === q) s2 = 0;
      else if (t.indexOf(q) === 0) s2 = 1;
      else if ((' ' + t.replace(/[^a-z0-9]+/g, ' ')).indexOf(' ' + q.replace(/[^a-z0-9]+/g, ' ').trim()) !== -1) s2 = 2;
      else if (t.indexOf(q) !== -1 || (ws.length > 1 && ws.every(function (w) { return t.indexOf(w) !== -1; }))) s2 = 3;
      if (s2 < best) best = s2;
    }
    if (best > 3) {
      e.fields.forEach(function (f) {
        var s3 = lc(f.text).indexOf(q) !== -1 ? 4 + f.w : 9;
        if (s3 < best) { best = s3; why = f.why ? f.why + ' ' + f.text : f.text; whyText = f.text; }
      });
    }
    return { s: best, why: why, whyText: whyText };
  }

  /** A match as the list shows it; found in a field the row does not show, it says where ("Has CAT 320 Excavator"). */
  function row(e, m) {
    var shows = !m.whyText || lc(e.sub + ' ' + e.label).indexOf(lc(m.whyText)) !== -1;
    return { type: 'row', key: e.key, group: e.group, kind: e.kind, s: m.s, ord: e.ord || 0, icon: e.icon, label: e.label,
      sub: shows ? e.sub : [e.sub, m.why].filter(Boolean).join(' · '),
      hint: e.hint || '', tone: e.tone || '', title: e.title2 || '', open: e.open };
  }

  /**
   * What is typed, found. o: { scope: all | screens | requests | equipment, expanded: a group key, screens: nav.search
   * matches, access }.
   * @returns {
   *   rows    [{ type: head, key, label, count } | { type: row, n, key, group, kind, icon, label, sub, hint, tone, open }
   *            | { type: more, n, key, group, label, scope, expand } | { type: note, key, label }] in order
   *   count   rows that can be chosen (n runs 0..count-1 across the groups, so ↑ ↓ move through all of them)
   *   counts  { all, screens, requests, equipment }; scopes [{ key, label, count, on }]; empty: the words, when nothing matched
   * }
   */
  function search(idx, text, o) {
    var opts = o || {};
    var a = opts.access || (idx && idx.access) || {};
    var q = norm(text);
    var scope = opts.scope && SCOPES.some(function (s) { return s.key === opts.scope; }) ? opts.scope : 'all';
    var scopes = scopesOf(a);
    if (!scopes.some(function (s) { return s.key === scope; })) scope = 'all';
    var none = { rows: [], count: 0, counts: { all: 0, screens: 0, requests: 0, equipment: 0 }, scope: scope, empty: '',
      scopes: scopes.map(function (s) { return { key: s.key, label: s.label, count: 0, on: s.key === scope }; }) };
    if (!q) return none;
    var qc = compact(q);
    var ws = q.split(' ');
    var hits = {};
    GROUPS.forEach(function (g) { hits[g.key] = []; });

    (opts.screens || []).forEach(function (r, i) {
      var s = r.score === 0 ? (lc(r.label) === q ? 0 : 1) : (r.score === 1 ? 3 : 5);
      hits.screens.push({ type: 'row', key: 'nav:' + r.id, group: 'screens', kind: 'nav', s: s, ord: i, icon: r.icon, label: r.label, sub: '',
        hint: r.group || 'Screen', tone: '', title: '', open: { navId: r.id } });
    });
    var exact = false;
    ((idx && idx.entries) || []).forEach(function (e) {
      var m = score(e, q, qc, ws);
      if (m.s < 0) return;
      var r = row(e, m);
      if (m.s === 0 && e.kind === 'request') r.label = 'Open request ' + e.label;
      if (m.s === 0) exact = true;
      hits[e.group].push(r);
    });
    // A request number typed: open it even when it is not among the requests read (newer than that read, or still
    // loading), as the command bar always has. After the near matches once the requests are read; first before.
    var t = String(text || '').trim();
    if (a.requests && /\d{3,}/.test(t) && !exact) {
      var number = /^\d+$/.test(t) ? 'REQ-' + t : t.toUpperCase();
      var read = !!(idx && idx.loaded && idx.loaded.requests);
      hits.requests.push({ type: 'row', key: 'r!' + number, group: 'requests', kind: 'request', s: read ? 2.5 : -1, ord: -1, icon: ICONS.request,
        label: 'Open request ' + number, sub: read ? 'Not among the requests you can see: it opens if it is there' : '', hint: 'Request', tone: '', title: '',
        open: { record: 'request', params: { number: number } } });
    }

    var counts = { all: 0, screens: 0, requests: 0, equipment: 0 };
    GROUPS.forEach(function (g) {
      hits[g.key].sort(function (x, y) { return x.s - y.s || x.ord - y.ord || cmp(lc(x.label), lc(y.label)); });
      counts[g.scope] += hits[g.key].length;
      counts.all += hits[g.key].length;
    });
    var order = GROUPS.map(function (g, i) { return { g: g, i: i, best: hits[g.key].length ? hits[g.key][0].s : 99 }; })
      .filter(function (x) { return hits[x.g.key].length && (scope === 'all' || x.g.scope === scope); })
      .sort(function (x, y) { return x.best - y.best || x.i - y.i; });

    var rows = [];
    var n = 0;
    order.forEach(function (x) {
      var g = x.g;
      var list = hits[g.key];
      var limit = opts.expanded === g.key ? EXPANDED : (scope === 'all' ? g.few : SCOPED);
      rows.push({ type: 'head', key: 'h:' + g.key, group: g.key, label: g.label, count: list.length });
      list.slice(0, limit).forEach(function (r) {
        var out = Object.assign({}, r, { n: n++ });
        delete out.s;
        delete out.ord;
        rows.push(out);
      });
      var left = list.length - limit;
      if (left <= 0) return;
      if (scope === 'all' || opts.expanded !== g.key) {
        rows.push({ type: 'more', key: 'm:' + g.key, group: g.key, n: n++, icon: ICONS.more, label: plural(left, 'more ' + g.one, 'more ' + g.many),
          sub: '', hint: '', tone: '', title: '', scope: scope === 'all' ? g.scope : '', expand: scope === 'all' ? '' : g.key });
      } else {
        rows.push({ type: 'note', key: 'x:' + g.key, group: g.key, label: plural(left, 'more ' + g.one, 'more ' + g.many) + ': add a word to narrow it down' });
      }
    });
    return {
      rows: rows, count: n, counts: counts, scope: scope,
      empty: rows.length ? '' : t,
      scopes: scopes.map(function (s) { return { key: s.key, label: s.label, count: counts[s.key], on: s.key === scope }; })
    };
  }

  /**
   * The dropdown's foot: what is searched (or still being read), and what could not be read (left out, in words).
   * snap: searchData.snapshot(); want: wants(access).
   */
  function foot(idx, snap, access) {
    var a = access || {};
    var w = wants(a);
    var s = snap || {};
    var pending = s.pending || {};
    var errors = s.errors || {};
    var reading = [];
    var failed = [];
    var parts = ['screens'];
    var n = (idx && idx.counts) || {};
    var num = function (k) { return Number(n[k] || 0).toLocaleString('en-US'); };
    if (a.requests) {
      if (s.requests) parts.push(num('request') + ' requests');
      else if (errors.requests && !pending.requests) failed.push('requests');
      else reading.push('requests');
    }
    if (w.fleet) {
      if (s.fleet) parts.push(num('item') + ' equipment items', num('unit') + ' units');
      else if (errors.fleet && !pending.fleet) failed.push('equipment and units');
      else reading.push('equipment');
    }
    if (a.transfers) {
      if (s.transfers) parts.push(num('transfer') + ' transfers');
      else if (errors.transfers && !pending.transfers) failed.push('transfers');
      else reading.push('transfers');
    }
    var join = function (l) { return l.length > 1 ? l.slice(0, -1).join(', ') + ' and ' + l[l.length - 1] : l[0]; };
    var out = [];
    if (parts.length > 1) out.push('Searching ' + join(parts));
    if (reading.length) out.push('Reading ' + join(reading) + '…');
    if (failed.length) out.push(join(failed).charAt(0).toUpperCase() + join(failed).slice(1) + ' could not be read, so ' + (failed.length > 1 ? 'they are' : 'it is') + ' left out');
    return out.join(' · ');
  }

  return {
    GROUPS: GROUPS, SCOPES: SCOPES, SCOPED: SCOPED, EXPANDED: EXPANDED,
    accessOf: accessOf, accessKey: accessKey, wants: wants, scopesOf: scopesOf, index: index, score: score, search: search, foot: foot,
    compact: compact, nowShort: nowShort
  };
});
