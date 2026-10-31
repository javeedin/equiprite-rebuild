define(['resources/js/availability'], function (av) {
  'use strict';

  // Check availability, the toolbar's calendar button: "is there an excavator free next week, and where?", answered
  // at once without opening Availability. Pure: the shell's qaChain reads the fleet (searchData.js, one load shared
  // with the global search) and this works out what the panel shows.
  //
  // The rules are the Availability screen's own (availability.js), not a copy of them: the units, their bookings and
  // their planned maintenance are av.build's model, and a unit's state in the window is av.windowState (booked,
  // maintenance, free but with a tight turnaround, or free). Free counts free and tight, as Availability's capacity
  // does. An equipment item's units are the serial-refs with its equipmentId; a unit the master does not know is
  // listed under its name.
  //
  //   fleet = { model (av.build), serials (serial-refs rows), masterById, classes, maint, notes }

  var SHOW = 8;
  var UNITS = 12;
  var OPTIONS = 8;
  var STATE_ORDER = { free: 0, tight: 1, maint: 2, booked: 3 };

  function lc(v) { return String(v == null ? '' : v).toLowerCase(); }
  function cmp(a, b) { return a < b ? -1 : (a > b ? 1 : 0); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function wordsOf(text) { return lc(text).split(/\s+/).filter(Boolean); }
  /** Does a word of `s` start with `q`? */
  function wordStart(s, q) { return (' ' + lc(s).replace(/[^a-z0-9]+/g, ' ')).indexOf(' ' + lc(q).replace(/[^a-z0-9]+/g, ' ').trim()) !== -1; }

  // ── The window ────────────────────────────────────────────────────────────────────────────────────────────────
  /** Today, the rest of this week (to Sunday), next week (Monday to Sunday), two weeks from today. */
  function presets(today) {
    var t = av.d10(today) || av.todayKey();
    var mon = av.mondayOf(t);
    var next = av.addDays(mon, 7);
    return [
      { key: 'today', label: 'Today', from: t, to: t },
      { key: 'week', label: 'This week', from: t, to: av.addDays(mon, 6) },
      { key: 'next', label: 'Next week', from: next, to: av.addDays(next, 6) },
      { key: 'two', label: 'Two weeks', from: t, to: av.addDays(t, 13) }
    ];
  }

  /** The window the panel opens on: today and the six days after it. */
  function defaultWindow(today) {
    var t = av.d10(today) || av.todayKey();
    return { from: t, to: av.addDays(t, 6) };
  }

  /** The preset a window is, or ''. */
  function presetOf(from, to, today) {
    var hit = presets(today).filter(function (p) { return p.from === from && p.to === to; })[0];
    return hit ? hit.key : '';
  }

  // ── Equipment items and classes, from the model ───────────────────────────────────────────────────────────────
  var memo = { model: null, list: [], byKey: {}, units: {}, classes: [] };

  function build(fleet) {
    var f = fleet || {};
    var model = f.model || { units: [], byUnit: {} };
    if (memo.model === model) return memo;
    var classById = {};
    (f.classes || []).forEach(function (c) { if (c && c.id != null) classById[String(c.id)] = c.className || ''; });
    var itemOf = {};
    (f.serials || []).forEach(function (s) { if (s && s.serialNumber && s.equipmentId != null) itemOf[String(s.serialNumber)] = String(s.equipmentId); });
    var list = [];
    var byKey = {};
    var masters = f.masterById || {};
    Object.keys(masters).forEach(function (id) {
      var m = masters[id];
      if (!m) return;
      var it = {
        key: 'i:' + id, kind: 'item', equipmentId: String(id), name: m.equipmentName || m.equipmentNumber || 'Item ' + id, number: m.equipmentNumber || '',
        cls: (m.equipmentClassId != null ? classById[String(m.equipmentClassId)] : '') || m.className || '', manufacturer: m.manufacturer || '',
        model: m.model || m.modelNumber || '', unitIds: []
      };
      byKey[it.key] = it;
      list.push(it);
    });
    var units = {};
    (model.units || []).forEach(function (u) {
      units[u.id] = u;
      var id = itemOf[u.serial];
      var it = id != null ? byKey['i:' + id] : null;
      if (!it) {
        var k = 'n:' + lc(u.name);
        it = byKey[k];
        if (!it) {
          it = { key: k, kind: 'item', equipmentId: '', name: u.name, number: '', cls: u.cls === av.NO_CLASS ? '' : u.cls, manufacturer: u.manufacturer || '', model: '', unitIds: [] };
          byKey[k] = it;
          list.push(it);
        }
      }
      it.unitIds.push(u.id);
      if (!it.cls && u.cls && u.cls !== av.NO_CLASS) it.cls = u.cls;
    });
    list.forEach(function (it) { it.hay = [it.name, it.number, it.cls, it.manufacturer, it.model].filter(Boolean).join(' ').toLowerCase(); });
    list.sort(function (a, b) { return cmp(lc(a.name), lc(b.name)) || cmp(a.key, b.key); });
    var cls = {};
    list.forEach(function (it) {
      var c = it.cls || av.NO_CLASS;
      var row = cls[c] = cls[c] || { key: 'c:' + c, kind: 'class', name: c, unitIds: [], items: 0 };
      row.unitIds = row.unitIds.concat(it.unitIds);
      row.items += 1;
    });
    var classes = Object.keys(cls).map(function (k) { return cls[k]; }).filter(function (c) { return c.unitIds.length > 0; })
      .sort(function (a, b) { return Number(a.name === av.NO_CLASS) - Number(b.name === av.NO_CLASS) || cmp(lc(a.name), lc(b.name)); });
    memo = { model: model, list: list, byKey: byKey, units: units, classes: classes };
    return memo;
  }

  /** The equipment items: [{ key, equipmentId, name, number, cls, manufacturer, model, unitIds, hay }] by name. */
  function items(fleet) { return build(fleet).list; }

  /** The classes that have units: [{ key, name, unitIds, items }] by name, "No class" last. */
  function classes(fleet) { return build(fleet).classes; }

  /** A unit's yard as a person says it: "Houston Yard" (its name), else its code. */
  function yardName(u) {
    var y = String((u && u.yard) || av.NO_YARD);
    var at = y.indexOf(' · ');
    return at === -1 ? y : y.slice(at + 3);
  }

  // ── Counting ──────────────────────────────────────────────────────────────────────────────────────────────────
  var unitMemo = { model: null, units: {} };
  function unitsOf(model) {
    if (unitMemo.model !== model) {
      var u = {};
      ((model && model.units) || []).forEach(function (x) { u[x.id] = x; });
      unitMemo = { model: model, units: u };
    }
    return unitMemo.units;
  }

  /**
   * The units in the window: how many are free (free or tight), booked or in maintenance, free ones per yard, the first
   * tight turnaround and maintenance in words, and each unit's state.
   */
  function tally(model, unitIds, win) {
    var units = unitsOf(model);
    var c = { total: 0, free: 0, tight: 0, booked: 0, maint: 0 };
    var yards = {};
    var tight = [];
    var maint = [];
    var list = [];
    (unitIds || []).forEach(function (id) {
      var u = units[id];
      if (!u) return;
      var s = av.windowState(model.byUnit[id], win.from, win.to);
      c.total += 1;
      c[s.state] += 1;
      if (s.state === 'free' || s.state === 'tight') {
        var k = u.yardKey || '-';
        (yards[k] = yards[k] || { key: k, label: yardName(u), n: 0 }).n += 1;
      }
      if (s.state === 'tight') tight.push(u.serial + ' ' + s.why.charAt(0).toLowerCase() + s.why.slice(1));
      if (s.state === 'maint') maint.push(u.serial + ': ' + s.why);
      list.push({ id: u.id, serial: u.serial, name: u.name, yard: yardName(u), state: s.state, label: s.label, why: s.why });
    });
    var avail = c.free + c.tight;
    var pct = function (n) { return c.total ? Math.round((n / c.total) * 1000) / 10 + '%' : '0%'; };
    var ys = Object.keys(yards).map(function (k) { return yards[k]; })
      .sort(function (a, b) { return b.n - a.n || Number(a.key === '-') - Number(b.key === '-') || cmp(lc(a.label), lc(b.label)); });
    list.sort(function (a, b) { return STATE_ORDER[a.state] - STATE_ORDER[b.state] || cmp(lc(a.yard), lc(b.yard)) || cmp(a.serial, b.serial); });
    return {
      total: c.total, free: c.free, tight: c.tight, booked: c.booked, maint: c.maint, avail: avail,
      headline: avail + ' of ' + c.total + ' free',
      none: c.total > 0 && avail === 0,
      segs: [{ k: 'free', w: pct(c.free) }, { k: 'tight', w: pct(c.tight) }, { k: 'booked', w: pct(c.booked) }, { k: 'maint', w: pct(c.maint) }]
        .filter(function (s) { return s.w !== '0%'; }),
      yards: ys,
      yardText: ys.length ? ys.map(function (y) { return y.label + ' ' + y.n; }).join(' · ') : (c.total ? 'None free in your window' : 'No units on record'),
      notes: [c.tight ? plural(c.tight, 'tight turnaround') : '', c.booked ? c.booked + ' booked' : '', c.maint ? c.maint + ' in maintenance' : '']
        .filter(Boolean).join(' · '),
      tightWhy: tight[0] ? 'Tight turnaround: ' + tight[0] + (tight.length > 1 ? ' (+' + (tight.length - 1) + ' more)' : '') : '',
      maintWhy: maint[0] ? maint[0] + (maint.length > 1 ? ' (+' + (maint.length - 1) + ' more)' : '') : '',
      units: list
    };
  }

  /** A row of the answer: what it is, then its tally (without the units one by one). */
  function rowOf(base, t) {
    var r = Object.assign({}, base, t);
    delete r.units;
    return r;
  }

  function itemRow(model, it, win, t) {
    return rowOf({ key: it.key, kind: 'item', name: it.name, equipmentId: it.equipmentId, availText: it.name,
      sub: [it.cls, it.number, plural(it.unitIds.length, 'unit')].filter(Boolean).join(' · ') }, t || tally(model, it.unitIds, win));
  }

  function classRow(model, c, win) {
    return rowOf({ key: c.key, kind: 'class', name: c.name, equipmentId: '', availText: c.name === av.NO_CLASS ? '' : c.name,
      sub: 'Class · ' + plural(c.items, 'equipment item') + ' · ' + plural(c.unitIds.length, 'unit') }, tally(model, c.unitIds, win));
  }

  /** How well an equipment item matches the words typed: 0 its name starts with them, 1 a word of it does, 2 elsewhere. */
  function rank(it, q) {
    var name = lc(it.name);
    if (name.indexOf(q) === 0) return 0;
    if (wordStart(it.name, q) || (it.number && lc(it.number).indexOf(q) === 0)) return 1;
    return 2;
  }

  /**
   * Suggestions while typing: classes and equipment items whose words match, best first.
   * @returns [{ n, key, kind: class | item, label, sub }]
   */
  function options(fleet, text) {
    var ws = wordsOf(text);
    if (!ws.length || !fleet || !fleet.model) return [];
    var q = ws.join(' ');
    var out = [];
    classes(fleet).forEach(function (c) {
      if (c.name === av.NO_CLASS) return;
      if (!ws.every(function (w) { return lc(c.name).indexOf(w) !== -1; })) return;
      out.push({ key: c.key, kind: 'class', label: c.name, sub: 'Class · ' + plural(c.unitIds.length, 'unit'), s: lc(c.name).indexOf(q) === 0 ? 0 : 1 });
    });
    items(fleet).forEach(function (it) {
      if (!ws.every(function (w) { return it.hay.indexOf(w) !== -1; })) return;
      out.push({ key: it.key, kind: 'item', label: it.name, sub: [it.cls, plural(it.unitIds.length, 'unit')].filter(Boolean).join(' · '), s: rank(it, q) });
    });
    return out.sort(function (a, b) { return a.s - b.s || Number(a.kind === 'item') - Number(b.kind === 'item') || cmp(lc(a.label), lc(b.label)); })
      .slice(0, OPTIONS).map(function (o, i) { return { n: i, key: o.key, kind: o.kind, label: o.label, sub: o.sub }; });
  }

  /**
   * The answer for what is asked. o: { text, pick: { kind: item | class, key } | null, from, to, today }.
   *   picked item   that item, and its units one by one (free first)
   *   picked class  the equipment items of the class
   *   text          the equipment items whose words match, best first
   *   nothing       every class
   * @returns { kind: item | class | items | classes | none, win, headline, rows, units, more, moreText, availText }
   */
  function answer(fleet, o) {
    var opts = o || {};
    var model = fleet && fleet.model;
    var t = av.d10(opts.today) || (model && model.today) || av.todayKey();
    var win = av.windowOf(opts.from, opts.to, t);
    var when = av.range(win.from, win.to);
    var empty = { kind: 'none', win: win, headline: '', rows: [], units: [], more: 0, moreText: '', availText: '' };
    if (!model) return empty;
    var m = build(fleet);
    var pick = opts.pick && opts.pick.key ? opts.pick : null;
    var text = String(opts.text || '').trim();
    var res;
    if (pick && pick.kind === 'item' && m.byKey[pick.key]) {
      var it = m.byKey[pick.key];
      var t1 = tally(model, it.unitIds, win);
      var row = itemRow(model, it, win, t1);
      res = { kind: 'item', headline: it.name + ': ' + t1.headline + ', ' + when, rows: [row], units: t1.units.slice(0, UNITS), more: Math.max(0, t1.units.length - UNITS),
        availText: it.name };
      res.moreText = res.more ? plural(res.more, 'more unit') + ' in Availability' : '';
      return Object.assign(empty, res);
    }
    var list;
    var kind;
    var head;
    if (pick && pick.kind === 'class') {
      var c = m.classes.filter(function (x) { return x.key === pick.key; })[0];
      var name = c ? c.name : String(pick.key).replace(/^c:/, '');
      list = m.list.filter(function (x) { return (x.cls || av.NO_CLASS) === name && x.unitIds.length; })
        .map(function (x) { return itemRow(model, x, win); })
        .sort(function (a, b) { return b.avail - a.avail || cmp(lc(a.name), lc(b.name)); });
      var tc = tally(model, c ? c.unitIds : [], win);
      kind = 'class';
      head = name + ': ' + tc.headline + ', ' + when;
      res = { availText: name === av.NO_CLASS ? '' : name };
    } else if (text) {
      var ws = wordsOf(text);
      var q = ws.join(' ');
      var hits = m.list.filter(function (x) { return ws.every(function (w) { return x.hay.indexOf(w) !== -1; }); });
      list = hits.map(function (x) { return Object.assign(itemRow(model, x, win), { s: rank(x, q) }); })
        .sort(function (a, b) { return a.s - b.s || Number(b.total > 0) - Number(a.total > 0) || b.avail - a.avail || cmp(lc(a.name), lc(b.name)); });
      var all = tally(model, [].concat.apply([], hits.map(function (x) { return x.unitIds; })), win);
      kind = 'items';
      head = hits.length ? all.avail + ' of ' + plural(all.total, 'unit') + ' free, ' + when + ' · ' + plural(hits.length, 'equipment item') + ' match'
        : 'Nothing matches “' + text + '”: try a class, a name or a make.';
      res = { availText: text };
    } else {
      list = m.classes.map(function (x) { return classRow(model, x, win); });
      var tot = tally(model, Object.keys(m.units), win);
      kind = 'classes';
      head = 'All equipment: ' + tot.avail + ' of ' + plural(tot.total, 'unit') + ' free, ' + when;
      res = { availText: '' };
    }
    var more = Math.max(0, list.length - SHOW);
    return Object.assign(empty, res, {
      kind: kind, headline: head, rows: list.slice(0, SHOW), more: more,
      moreText: more ? plural(more, kind === 'classes' ? 'more class' : 'more equipment item', kind === 'classes' ? 'more classes' : 'more equipment items') + ': open it in Availability' : ''
    });
  }

  /** What the answer stands on, in words: free means; maintenance still loading; what could not be read. */
  function note(fleet) {
    var f = fleet || {};
    var out = ['Free means no booking and no planned maintenance in EquipRite on those days, as on Availability.'];
    if (f.maint === 'later' || f.maint === 'loading') out.push('Planned maintenance from Fusion is still loading: free counts may still drop.');
    else if (f.maint === 'partial') out.push('Planned maintenance could not be read for every unit.');
    return out.concat(f.notes || []).join(' ');
  }

  return {
    SHOW: SHOW, UNITS: UNITS, OPTIONS: OPTIONS,
    presets: presets, defaultWindow: defaultWindow, presetOf: presetOf,
    items: items, classes: classes, yardName: yardName, tally: tally, options: options, answer: answer, note: note
  };
});
