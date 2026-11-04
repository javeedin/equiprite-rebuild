define([], function () {
  'use strict';

  // EquipRite Next, the Redwood views of the Equipment screens (chosen in your menu: Redwood). Pure: the screens' chains
  // and page modules call these; tests/next-equipment-redwood.test.js tests them.
  //
  //   Fleet             Oracle's Smart Search page: a table row per unit, a filter per column (Unit, Equipment, Class,
  //                     Status, Request, Project or customer, Next booking, Yard). Class, Status and Yard are the page's
  //                     own cls, lane (and tight) and yard, so both looks filter alike; the others narrow the Redwood
  //                     table only (fleetByColumns).
  //   Equipment master  the same: a row per item, a filter per column (Equipment, Class, Subclass, Tracked by, Units,
  //                     Location, Status, Source) and Asset group. All but Equipment and Units are the page's own
  //                     filters (classId, subclassId, tracking, location, status, source, assetGroupId).
  //   An item, Equipment 360, Availability
  //                     Oracle's general overview page as the header: its badge and actions.
  //
  // Statuses use Oracle's own oj-badge classes (Redwood theme), as Requests does.

  var BADGE = {
    neutral: 'oj-badge oj-badge-subtle',
    info: 'oj-badge oj-badge-info oj-badge-subtle',
    warning: 'oj-badge oj-badge-warning oj-badge-subtle',
    success: 'oj-badge oj-badge-success oj-badge-subtle',
    danger: 'oj-badge oj-badge-danger oj-badge-subtle',
    strong: 'oj-badge oj-badge-info'
  };
  // A filter's choice for "none": a request number, a booking or a class cannot be this.
  var NONE = '-';

  function txt(v) { return v == null ? '' : String(v); }
  function cmp(a, b) { return txt(a).localeCompare(txt(b), undefined, { numeric: true, sensitivity: 'base' }); }

  /**
   * What Smart Search's criterion holds: the text typed, and the value picked for each field ({ field: value }). The
   * criterion is a tree: a text node, and $eq nodes whose value is on the node ({ attribute, value }) or inside an
   * object ({ value: { field: v } }), as Requests and Old read it.
   */
  function readCriterion(c) {
    var out = { text: '', picks: {} };
    function pick(field, val) { out.picks[field] = val === undefined || val === null ? '' : String(val); }
    function read(node) {
      if (!node) return;
      if (Array.isArray(node.criteria)) node.criteria.forEach(read);
      if (node.text !== undefined && node.text !== null) out.text = String(node.text);
      if (node.op === '$eq') {
        if (node.attribute) pick(node.attribute, node.value);
        else if (node.value && typeof node.value === 'object') Object.keys(node.value).forEach(function (k) { pick(k, node.value[k]); });
      }
    }
    read(c);
    out.text = out.text.trim();
    return out;
  }

  /** Options with their counts, by label: [{ value, label: 'Houston Yard (3)' }], A to Z (numbers in order). */
  function tally(items, keyOf, labelOf) {
    var counts = {};
    var labels = {};
    (items || []).forEach(function (it) {
      var k = keyOf(it);
      if (k === undefined || k === null || k === '') return;
      k = String(k);
      counts[k] = (counts[k] || 0) + 1;
      if (!labels[k]) labels[k] = labelOf ? labelOf(it, k) : k;
    });
    return Object.keys(counts).sort(function (a, b) {
      return (a === NONE ? 1 : 0) - (b === NONE ? 1 : 0) || cmp(labels[a], labels[b]);
    }).map(function (k) { return { value: k, label: labels[k] + ' (' + counts[k] + ')' }; });
  }

  // ── Fleet ────────────────────────────────────────────────────────────────────────────────────────────────────────
  // Where a unit is (equipmentBoard's lanes), as an Oracle badge.
  var LANE_TONE = { yard: 'success', going: 'info', out: 'strong', due: 'warning', overdue: 'danger', maint: 'neutral', other: 'neutral' };
  var FLEET_COLS = ['unit', 'name', 'request', 'party', 'next'];

  /**
   * The Redwood table's rows, one per unit shown, with what each cell says (fns: the Fleet page's laneLabel, place,
   * typeLabel, turnaroundText and range, so both looks say the same) and the step its row offers: the screen the unit's
   * panel sends it to (Receiving & returns when it is due back or overdue, Picking & shipping when it goes out this week).
   */
  function fleetRows(shown, fns) {
    var f = fns || {};
    return (Array.isArray(shown) ? shown : []).map(function (u) {
      var steps = [];
      if (u.lane === 'due' || u.lane === 'overdue') steps.push({ nav: 'returns', label: 'Receiving & returns', chroming: 'callToAction' });
      if (u.lane === 'going') steps.push({ nav: 'picking', label: 'Picking & shipping', chroming: 'callToAction' });
      var type = f.typeLabel ? f.typeLabel(u.type) : txt(u.type);
      return {
        key: txt(u.key),
        unit: txt(u.unit),
        unitSub: type + (u.asset ? (type ? ' · ' : '') + u.asset : ''),
        name: txt(u.name),
        cls: txt(u.cls),
        status: f.laneLabel ? f.laneLabel(u.lane) : txt(u.lane),
        badge: BADGE[LANE_TONE[u.lane]] || BADGE.neutral,
        place: f.place ? f.place(u) : '',
        when: txt(u.when),
        tight: u.tight && f.turnaroundText ? f.turnaroundText(u) : '',
        request: txt(u.requestNumber) || '—',
        party: txt(u.party),
        next: u.next ? u.next.requestNumber + ' · ' + (f.range ? f.range(u.next.start, '') : txt(u.next.start)) : '—',
        nextSub: u.next ? txt(u.next.project || u.next.location) : '',
        yard: txt(u.yard) || '—',
        steps: steps
      };
    });
  }

  /**
   * Every Fleet filter's options, from every unit (not only the ones shown, so a filter can be changed). Status is the
   * lane tiles: All, each lane, and Tight turnaround. lanes: equipmentBoard.LANES.
   */
  function fleetOptions(units, lanes) {
    var list = Array.isArray(units) ? units : [];
    var byLane = {};
    var tight = 0;
    list.forEach(function (u) { byLane[u.lane] = (byLane[u.lane] || 0) + 1; if (u.tight) tight++; });
    var status = [{ value: 'all', label: 'All (' + list.length + ')' }];
    (lanes || []).forEach(function (l) {
      if (l.key === 'other' && !byLane.other) return;
      status.push({ value: l.key, label: l.label + ' (' + (byLane[l.key] || 0) + ')' });
    });
    status.push({ value: 'tight', label: 'Tight turnaround (' + tight + ')' });
    return {
      unit: tally(list, function (u) { return u.key; }, function (u) { return u.unit + (u.name ? ' · ' + u.name : ''); }),
      name: tally(list, function (u) { return u.name; }),
      cls: tally(list, function (u) { return u.cls; }),
      status: status,
      request: tally(list, function (u) { return u.requestNumber || NONE; }, function (u, k) { return k === NONE ? 'Not on a request' : k; }),
      party: tally(list, function (u) { return u.party; }),
      next: tally(list, function (u) { return u.next ? u.next.requestNumber : NONE; }, function (u, k) { return k === NONE ? 'Nothing booked ahead' : k; }),
      yard: tally(list, function (u) { return u.yardId; }, function (u) { return u.yard || u.yardId; })
    };
  }

  /** The units that match every Redwood-only column filter: { unit, name, request, party, next } ('' = any). */
  function fleetByColumns(units, cols) {
    var c = cols || {};
    return (Array.isArray(units) ? units : []).filter(function (u) {
      if (c.unit && txt(u.key) !== c.unit) return false;
      if (c.name && u.name !== c.name) return false;
      if (c.request && (c.request === NONE ? !!u.requestNumber : u.requestNumber !== c.request)) return false;
      if (c.party && u.party !== c.party) return false;
      if (c.next && (c.next === NONE ? !!u.next : !u.next || u.next.requestNumber !== c.next)) return false;
      return true;
    });
  }

  /**
   * What a Fleet Smart Search criterion asks of the page: { text, lane, tight, cls, yard } (the page's own filters) and
   * cols (the Redwood-only ones).
   */
  function fleetCriterion(criterion) {
    var r = readCriterion(criterion);
    var p = r.picks;
    var cols = {};
    FLEET_COLS.forEach(function (k) { cols[k] = p[k] || ''; });
    var status = p.status || 'all';
    return { text: r.text, lane: status === 'tight' ? 'all' : status, tight: status === 'tight', cls: p.cls || '', yard: p.yard || '', cols: cols };
  }

  /** The unit's record: a serial-numbered unit opens as itself; a lot or stock line opens its equipment item. */
  function fleetRecord(u) {
    if (!u) return null;
    if (u.type && u.type !== 'SERIAL') return { record: 'equipment-360', params: { name: u.name } };
    return { record: 'equipment-360', params: { serial: u.unit } };
  }

  // ── Equipment master ─────────────────────────────────────────────────────────────────────────────────────────────
  // An item's stored status, as an Oracle badge (equipmentMaster.statusTone: ok, busy, warn, off, none).
  var STATUS_TONE = { ok: 'success', busy: 'info', warn: 'warning', off: 'neutral', none: 'neutral' };
  var MASTER_COLS = ['item', 'units'];

  /** The Redwood table's rows, one per item shown, with what each cell says (fns: the page's itemSub and sourceWords). */
  function masterRows(shown, fns) {
    var f = fns || {};
    return (Array.isArray(shown) ? shown : []).map(function (it) {
      return {
        key: txt(it.key),
        num: txt(it.num),
        title: txt(it.title),
        sub: f.itemSub ? f.itemSub(it) : txt(it.num),
        server: it.why === 'server',
        cls: txt(it.cls) || 'No class',
        subcls: txt(it.sub),
        tracking: txt(it.trackingLabel),
        units: txt(it.unitsText) || 'No units on record',
        hasUnits: !!it.unitsText,
        where: txt(it.where) || '—',
        status: txt(it.statusLabel),
        badge: BADGE[STATUS_TONE[it.tone]] || BADGE.neutral,
        source: f.sourceWords ? f.sourceWords(it.source) : txt(it.source)
      };
    });
  }

  /**
   * Every Equipment master filter's options, from every item (decorated). ref: { classesById, subclassesById,
   * locationsById }; groups: the asset group options ({ label, value }), which the server answers (no counts).
   */
  function masterOptions(items, ref, groups, labels) {
    var list = Array.isArray(items) ? items : [];
    var r = ref || {};
    var l = labels || {};
    return {
      item: list.slice().sort(function (a, b) { return cmp(a.title, b.title) || cmp(a.num, b.num); })
        .map(function (it) { return { value: txt(it.key), label: it.title + (it.num && it.num !== it.title ? ' · ' + it.num : '') }; }),
      cls: tally(list, function (it) { return it.clsKey; }, function (it, k) { return k === 'none' ? 'No class' : (txt((r.classesById || {})[k]) || 'Class ' + k); }),
      sub: tally(list, function (it) { return it.subKey; }, function (it, k) { return k === 'none' ? 'No subclass' : (txt((r.subclassesById || {})[k]) || 'Subclass ' + k); }),
      tracking: tally(list, function (it) { return it.tracking; }, function (it) { return it.trackingLabel; }),
      units: tally(list, function (it) { return it.unitsText ? 'some' : NONE; }, function (it, k) { return k === NONE ? 'No units on record' : 'With units on record'; }),
      location: tally(list, function (it) { return it.locId || 'none'; }, function (it, k) { return k === 'none' ? 'No location on record' : (txt((r.locationsById || {})[k]) || 'Location ' + k); }),
      status: tally(list, function (it) { return it.st || 'NONE'; }, function (it, k) { return k === 'NONE' ? 'No status' : (l.status ? l.status(k) : k); }),
      source: tally(list, function (it) { return it.source; }, function (it, k) { return l.source ? l.source(k) : k; }),
      group: (Array.isArray(groups) ? groups : []).map(function (g) { return { value: txt(g.value), label: txt(g.label) }; })
    };
  }

  /** The items that match every Redwood-only column filter: { item, units } ('' = any; units 'some' or NONE). */
  function masterByColumns(items, cols) {
    var c = cols || {};
    return (Array.isArray(items) ? items : []).filter(function (it) {
      if (c.item && txt(it.key) !== c.item) return false;
      if (c.units && (c.units === NONE ? !!it.unitsText : !it.unitsText)) return false;
      return true;
    });
  }

  /**
   * What an Equipment master Smart Search criterion asks of the page: its own filters { text, classId, subclassId,
   * tracking, location, status, source, assetGroupId } and cols (the Redwood-only ones).
   */
  function masterCriterion(criterion) {
    var r = readCriterion(criterion);
    var p = r.picks;
    var cols = {};
    MASTER_COLS.forEach(function (k) { cols[k] = p[k] || ''; });
    return { text: r.text, classId: p.cls || '', subclassId: p.sub || '', tracking: p.tracking || '', location: p.location || '', status: p.status || '',
      source: p.source || '', assetGroupId: p.group || '', cols: cols };
  }

  // ── Headers (the general overview page): its badge, its actions ──────────────────────────────────────────────────
  // Oracle's page templates redraw a part of their header (its toolbar, its badge) for every new object or array they
  // are given, and a second redraw before the first has finished throws ("Cannot access methods before element is
  // upgraded"). A binding gives them a new one each time the page's variables change, so the header's parts are kept:
  // the same object for the same content.
  var KEPT = {};
  function kept(value) {
    var key = JSON.stringify(value);
    if (!Object.prototype.hasOwnProperty.call(KEPT, key)) KEPT[key] = value;
    return KEPT[key];
  }

  /** An item's stored status as the header's badge: { text, status } (Oracle's statuses), or null. */
  function itemBadge(label, tone) {
    if (!label) return null;
    return kept({ text: label, status: STATUS_TONE[tone] || 'neutral' });
  }

  // Equipment 360: what a unit is doing today (equipment360.nowOf keys).
  var NOW_STATUS = { free: 'success', booked: 'info', out: 'info', onsite: 'info', back: 'warning', maint: 'warning' };
  function nowBadge(now) {
    if (!now || !now.label) return null;
    return kept({ text: now.label, status: now.late ? 'danger' : (NOW_STATUS[now.key] || 'neutral') });
  }

  return {
    BADGE: BADGE,
    NONE: NONE,
    readCriterion: readCriterion,
    tally: tally,
    fleetRows: fleetRows,
    fleetOptions: fleetOptions,
    fleetByColumns: fleetByColumns,
    fleetCriterion: fleetCriterion,
    fleetRecord: fleetRecord,
    masterRows: masterRows,
    masterOptions: masterOptions,
    masterByColumns: masterByColumns,
    masterCriterion: masterCriterion,
    kept: kept,
    itemBadge: itemBadge,
    nowBadge: nowBadge
  };
});
