define([], function () {
  'use strict';

  // Equipment master in EquipRite Next: the catalog of equipment items, found fast and read at a glance, and one item
  // with its units. Pure: the Equipment master screen (flows/equipment) calls these; tests/next-equipment.test.js
  // tests them.
  //
  // Rules kept from New EquipRite (flows/master/pages/equipment-page.js and equipment-detail-page.js):
  //   tracking  SERIAL when isSerialControlled is 'Y', else LOT when isLotControlled is 'Y', else INVENTORY
  //   source    Fusion when createdBy is FUSION_IMPORT (the import's stamp; the list carries no Fusion id), else Manual
  //   stock     serialUnitCount serials and onHandQty on hand (on hand includes lots)
  //   status    catalogStatus: INACTIVE is a Fusion item whose ENABLED_FLAG is N, RETIRED the old manual value
  //   map       one bubble per EQR_LOCATION with coordinates, sized by its items (equirectangular, fitted to them)
  //
  // Search. The words typed are matched at once, every word somewhere, against what the list holds: number, name,
  // class, subclass, type, manufacturer, model, location, maintenance asset and description. After a pause the server
  // is asked too (GET /equipment-master?q=, which matches serial numbers and unit locations, which the list does not
  // carry); an item either finds is shown, and one only the server found says so.

  var STATUS_LABELS = { ACTIVE: 'Active', INACTIVE: 'Inactive', AVAILABLE: 'Available', DEPLOYED: 'Deployed', MAINTENANCE: 'Maintenance', RETIRED: 'Retired' };
  var STATUS_TONE = { ACTIVE: 'ok', AVAILABLE: 'ok', DEPLOYED: 'busy', MAINTENANCE: 'warn', INACTIVE: 'off', RETIRED: 'off' };
  var TRACKING = [{ key: 'SERIAL', label: 'Serial' }, { key: 'LOT', label: 'Lot' }, { key: 'INVENTORY', label: 'Quantity' }];
  var TRACKING_LONG = { SERIAL: 'Serial-tracked equipment', LOT: 'Lot-tracked equipment', INVENTORY: 'Quantity-tracked equipment' };
  var CLASS_CHIPS = 10;

  // A unit's status in words, and its tone (New's STATUS_BUCKET: good, in use or held, blocked, anything else).
  var UNIT_WORDS = {
    AVAILABLE: 'Available', ACTIVE: 'Active', RENTED: 'Rented out', RESERVED: 'Reserved', IN_MAINTENANCE: 'In maintenance',
    MAINTENANCE: 'In maintenance', IN_TRANSIT: 'In transit', RETURN_INITIATED: 'Return started', IN_SERVICE: 'In service',
    RETIRED: 'Retired', LOST: 'Lost', EXPIRED: 'Expired', RECALLED: 'Recalled', REJECTED: 'Rejected'
  };
  var UNIT_TONE = {
    AVAILABLE: 'good', ACTIVE: 'good',
    RETIRED: 'blocked', LOST: 'blocked', EXPIRED: 'blocked', RECALLED: 'blocked', REJECTED: 'blocked',
    RENTED: 'progress', RESERVED: 'progress', IN_MAINTENANCE: 'progress', IN_TRANSIT: 'progress',
    RETURN_INITIATED: 'progress', IN_SERVICE: 'progress', MAINTENANCE: 'progress'
  };

  var MAP_W = 1000;
  var MAP_H = 460;
  var MAP_PAD = 60;
  var DAY = 86400000;
  var EXPIRING_DAYS = 30;

  function txt(v) { return v == null ? '' : String(v); }
  function num(v) { var n = Number(v); return v == null || v === '' || isNaN(n) ? 0 : n; }
  function cmp(a, b) { return txt(a).localeCompare(txt(b), undefined, { numeric: true, sensitivity: 'base' }); }
  function plural(n, one, many) { return Number(n).toLocaleString('en-US') + ' ' + (Number(n) === 1 ? one : (many || one + 's')); }

  function trackingOf(row) {
    if (row && row.isSerialControlled === 'Y') return 'SERIAL';
    if (row && row.isLotControlled === 'Y') return 'LOT';
    return 'INVENTORY';
  }

  function trackingLabel(key) { return (TRACKING.filter(function (t) { return t.key === key; })[0] || {}).label || ''; }

  /** "Serial-tracked equipment" for the item's tab. */
  function trackingLong(key) { return TRACKING_LONG[txt(key).toUpperCase()] || 'Equipment'; }

  function statusLabel(code) {
    var c = txt(code).toUpperCase();
    if (!c) return 'No status';
    return STATUS_LABELS[c] || (c.charAt(0) + c.slice(1).toLowerCase()).replace(/_/g, ' ');
  }

  function statusTone(code) { return STATUS_TONE[txt(code).toUpperCase()] || 'none'; }

  function sourceOf(createdBy) { return createdBy === 'FUSION_IMPORT' ? 'Fusion' : 'Manual'; }

  /** An equipment type in words: COMPANY_OWNED → "Company-owned", anything else sentence case. */
  function typeWords(code) {
    var c = txt(code).trim();
    if (!c) return '';
    if (c.toUpperCase() === 'COMPANY_OWNED') return 'Company-owned';
    var s = c.replace(/_/g, ' ').toLowerCase();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /** "From Fusion" / "Added in EquipRite". */
  function sourceWords(source) { return source === 'Fusion' ? 'From Fusion' : 'Added in EquipRite'; }

  /** "3 serials · 4 on hand"; '' when it has neither (New's stockLabel). */
  function stockText(serialUnitCount, onHandQty) {
    var parts = [];
    var s = Number(serialUnitCount);
    if (s > 0) parts.push(plural(s, 'serial'));
    if (onHandQty != null && onHandQty !== '' && !isNaN(Number(onHandQty))) parts.push(Number(onHandQty).toLocaleString('en-US') + ' on hand');
    return parts.join(' · ');
  }

  /** { id: name } for the locations (GET /locations). */
  function locationIndex(locations) {
    var out = {};
    (Array.isArray(locations) ? locations : []).forEach(function (l) {
      if (l && l.id != null) out[String(l.id)] = l.locationName || l.locationCode || ('Location ' + l.id);
    });
    return out;
  }

  /** The rows of the base list plus the ones only the server's search returned, each item once. */
  function mergeRows(base, extra) {
    var seen = {};
    var out = [];
    [base, extra].forEach(function (list) {
      (Array.isArray(list) ? list : []).forEach(function (r) {
        if (!r || r.id == null || seen[String(r.id)]) return;
        seen[String(r.id)] = true;
        out.push(r);
      });
    });
    return out;
  }

  /**
   * The list's items as the screen reads them: { key, id, num, title, cls, sub, clsKey, subKey, tracking, serials,
   * onHand, unitsText, where, locId, st (stored status), statusLabel, tone, source, maker, type, why, hay }. ref:
   * { classesById, subclassesById, locationsById }.
   */
  function decorate(rows, ref) {
    var r = ref || {};
    var classes = r.classesById || {};
    var subs = r.subclassesById || {};
    var locs = r.locationsById || {};
    return (Array.isArray(rows) ? rows : []).filter(function (x) { return x && x.id != null; }).map(function (row) {
      var cls = row.equipmentClassId != null ? txt(classes[row.equipmentClassId]) : '';
      var sub = row.equipmentSubclassId != null ? txt(subs[row.equipmentSubclassId]) : '';
      var where = row.currentLocationId != null ? txt(locs[String(row.currentLocationId)]) : '';
      var t = trackingOf(row);
      var st = txt(row.catalogStatus).toUpperCase();
      var onHand = row.onHandQty != null && row.onHandQty !== '' && !isNaN(Number(row.onHandQty)) ? Number(row.onHandQty) : null;
      var serials = num(row.serialUnitCount);
      var maker = [row.manufacturer, row.modelNumber || row.model].filter(Boolean).join(' ');
      var item = {
        key: String(row.id),
        id: row.id,
        num: txt(row.equipmentNumber),
        title: row.equipmentName || row.equipmentNumber || ('Item ' + row.id),
        cls: cls,
        sub: sub,
        clsText: [cls, sub].filter(Boolean).join(' · '),
        clsKey: row.equipmentClassId != null ? String(row.equipmentClassId) : 'none',
        subKey: row.equipmentSubclassId != null ? String(row.equipmentSubclassId) : 'none',
        tracking: t,
        trackingLabel: trackingLabel(t),
        serials: serials,
        onHand: onHand,
        units: serials + (onHand || 0),
        unitsText: stockText(serials, onHand),
        where: where,
        locId: row.currentLocationId != null ? String(row.currentLocationId) : '',
        st: st,
        statusLabel: statusLabel(st),
        tone: statusTone(st),
        source: sourceOf(row.createdBy),
        type: typeWords(row.equipmentType),
        maker: maker,
        why: ''
      };
      item.hay = [item.num, item.title, cls, sub, row.equipmentType, item.type, row.manufacturer, row.modelNumber, row.model, where,
        row.maintenanceAssetNumber, row.equipmentDescription].filter(Boolean).join(' ').toLowerCase();
      return item;
    });
  }

  function words(text) { return txt(text).toLowerCase().split(/\s+/).filter(Boolean); }

  /** The text the server is asked with (trimmed), and whether it is worth asking: two characters or more. */
  function serverQuery(text) { var q = txt(text).trim(); return q.length >= 2 ? q : ''; }

  /**
   * Items the search finds: every word in what the item holds, or the server matched it for this very text
   * (server: { q, ids: { id: true } }). One only the server found carries why 'server'.
   */
  function search(items, text, server) {
    var w = words(text);
    var list = Array.isArray(items) ? items : [];
    if (!w.length) return list.slice();
    var ids = server && server.q && server.q === txt(text).trim() ? (server.ids || {}) : null;
    var out = [];
    list.forEach(function (it) {
      var local = w.every(function (x) { return it.hay.indexOf(x) !== -1; });
      if (local) out.push(it);
      else if (ids && ids[it.key]) out.push(Object.assign({}, it, { why: 'server' }));
    });
    return out;
  }

  // Filters: { classId, subclassId, status, tracking, source } ('' = any). `except` leaves one out, for the counts of
  // that filter's own chips (the class chips ignore the subclass too: a subclass belongs to its class).
  function pass(it, f, except) {
    var x = f || {};
    if (except !== 'class' && x.classId && it.clsKey !== String(x.classId)) return false;
    if (except !== 'class' && except !== 'subclass' && x.subclassId && it.subKey !== String(x.subclassId)) return false;
    if (except !== 'status' && x.status && (it.st || 'NONE') !== x.status) return false;
    if (except !== 'tracking' && x.tracking && it.tracking !== x.tracking) return false;
    if (except !== 'source' && x.source && it.source !== x.source) return false;
    return true;
  }

  /** The items the filters leave, and then the map's picked location ('none' = no location on record). */
  function filter(items, f, location) {
    return (Array.isArray(items) ? items : []).filter(function (it) {
      if (!pass(it, f, null)) return false;
      return !location || (it.locId || 'none') === String(location);
    });
  }

  function counted(items, f, except, keyOf) {
    var counts = {};
    items.forEach(function (it) {
      if (!pass(it, f, except)) return;
      var k = keyOf(it);
      counts[k] = (counts[k] || 0) + 1;
    });
    return counts;
  }

  function chipList(counts, selected, labelOf, allLabel, total, order) {
    var keys = Object.keys(counts);
    if (selected && keys.indexOf(String(selected)) === -1) keys.push(String(selected));
    // Biggest first, by name on a tie; "none" (no class, no subclass, no status) always last.
    keys.sort(order || function (a, b) {
      var na = a === 'none' || a === 'NONE';
      var nb = b === 'none' || b === 'NONE';
      return (na ? 1 : 0) - (nb ? 1 : 0) || (counts[b] || 0) - (counts[a] || 0) || cmp(labelOf(a), labelOf(b));
    });
    return [{ key: '', label: allLabel, count: total }].concat(keys.map(function (k) {
      return { key: k, label: labelOf(k), count: counts[k] || 0 };
    }));
  }

  function sum(counts) { return Object.keys(counts).reduce(function (n, k) { return n + counts[k]; }, 0); }

  /**
   * The chips for what the search found, each counting what it would show with the other filters as they are:
   * { classes, moreClasses, subclasses, statuses, tracking, sources }. Classes: the ten biggest (and the one picked),
   * the rest behind "more" unless allClasses.
   */
  function chips(items, f, ref, allClasses) {
    var list = Array.isArray(items) ? items : [];
    var x = f || {};
    var r = ref || {};
    var cc = counted(list, x, 'class', function (it) { return it.clsKey; });
    var classes = chipList(cc, x.classId, function (k) { return k === 'none' ? 'No class' : (txt((r.classesById || {})[k]) || 'Class ' + k); }, 'All classes', sum(cc));
    var more = 0;
    if (!allClasses && classes.length - 1 > CLASS_CHIPS) {
      var keep = classes.slice(0, CLASS_CHIPS + 1);
      var picked = classes.filter(function (c) { return c.key && c.key === String(x.classId); })[0];
      if (picked && keep.indexOf(picked) === -1) keep.push(picked);
      more = classes.length - keep.length;
      classes = keep;
    }
    var subclasses = [];
    if (x.classId && x.classId !== 'none') {
      var sc = counted(list, x, 'subclass', function (it) { return it.subKey; });
      var named = Object.keys(sc).filter(function (k) { return k !== 'none'; }).length;
      if (named) {
        subclasses = chipList(sc, x.subclassId, function (k) { return k === 'none' ? 'No subclass' : (txt((r.subclassesById || {})[k]) || 'Subclass ' + k); },
          'Any subclass', sum(sc));
      }
    }
    var stc = counted(list, x, 'status', function (it) { return it.st || 'NONE'; });
    var tc = counted(list, x, 'tracking', function (it) { return it.tracking; });
    var soc = counted(list, x, 'source', function (it) { return it.source; });
    var order = function (keys) { return function (a, b) { return keys.indexOf(a) - keys.indexOf(b); }; };
    return {
      classes: classes,
      moreClasses: more,
      subclasses: subclasses,
      statuses: chipList(stc, x.status, function (k) { return k === 'NONE' ? 'No status' : statusLabel(k); }, 'Any status', sum(stc)),
      tracking: chipList(tc, x.tracking, trackingLabel, 'Any tracking', sum(tc), order(['SERIAL', 'LOT', 'INVENTORY'])),
      sources: chipList(soc, x.source, sourceWords, 'Any source', sum(soc), order(['Fusion', 'Manual']))
    };
  }

  /** How many filters (besides the search) are on. */
  function filtersOn(f, assetGroupId) {
    var x = f || {};
    return ['classId', 'subclassId', 'status', 'tracking', 'source'].filter(function (k) { return !!x[k]; }).length + (assetGroupId ? 1 : 0);
  }

  var SORTS = {
    name: function (a, b) { return cmp(a.title, b.title) || cmp(a.num, b.num); },
    number: function (a, b) { return cmp(a.num, b.num) || cmp(a.title, b.title); },
    class: function (a, b) { return (a.clsText ? 0 : 1) - (b.clsText ? 0 : 1) || cmp(a.clsText, b.clsText) || cmp(a.title, b.title); },
    units: function (a, b) { return a.units - b.units || cmp(a.title, b.title); },
    where: function (a, b) { return (a.where ? 0 : 1) - (b.where ? 0 : 1) || cmp(a.where, b.where) || cmp(a.title, b.title); },
    status: function (a, b) { return cmp(a.statusLabel, b.statusLabel) || cmp(a.title, b.title); }
  };

  /** Sorted (a new array); dir 'asc' | 'desc'. Items with no class or location go last either way. */
  function sort(items, key, dir) {
    var by = SORTS[key] || SORTS.name;
    var sign = dir === 'desc' ? -1 : 1;
    return (Array.isArray(items) ? items : []).slice().sort(function (a, b) {
      if (key === 'class' && !a.clsText !== !b.clsText) return a.clsText ? -1 : 1;
      if (key === 'where' && !a.where !== !b.where) return a.where ? -1 : 1;
      return sign * by(a, b);
    });
  }

  /** The direction a column starts in: the most units first, everything else A to Z. */
  function firstDir(key) { return key === 'units' ? 'desc' : 'asc'; }

  /**
   * The line under the title: "4 items · 6 serials · 4 on hand", "2 of 4 items · 4 serials", "Loading 200 of 412…".
   */
  function summary(all, shown, o) {
    var s = o || {};
    var total = Number(s.total) || 0;
    var loaded = Number(s.loaded) || 0;
    if (s.loading && total > loaded) return 'Loading ' + loaded.toLocaleString('en-US') + ' of ' + total.toLocaleString('en-US') + '…';
    if (s.loading && !loaded) return 'Loading the equipment…';
    var n = (all || []).length;
    var m = (shown || []).length;
    var head = m === n ? plural(n, 'item') : m.toLocaleString('en-US') + ' of ' + plural(n, 'item');
    var serials = (shown || []).reduce(function (t, it) { return t + it.serials; }, 0);
    var onHand = (shown || []).reduce(function (t, it) { return t + (it.onHand || 0); }, 0);
    return [head, serials ? plural(serials, 'serial') : '', onHand ? onHand.toLocaleString('en-US') + ' on hand' : ''].filter(Boolean).join(' · ');
  }

  /** "28 Oct 2026 06:15" from an ISO timestamp, '' when there is none (New's when). */
  function when(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(txt(v));
    if (!m) return '';
    var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return Number(m[3]) + ' ' + MON[Number(m[2]) - 1] + ' ' + m[1] + (m[4] ? ' ' + m[4] + ':' + m[5] : '');
  }

  /** "Fetched from Fusion 28 Oct 2026 22:00 · synced 28 Oct 2026 06:15", from the job log's latest runs. */
  function fusionLine(lastRuns) {
    var r = lastRuns || {};
    var parts = [];
    if (r.fetch) parts.push('Fetched from Fusion ' + when(r.fetch));
    if (r.sync) parts.push((parts.length ? 'synced ' : 'Synced from Fusion ') + when(r.sync));
    return parts.join(' · ');
  }

  // ── the map ──────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * One bubble per location with coordinates, sized by how many of these items sit there (currentLocationId);
   * items with no location, or a location with no coordinates, are counted in `unplaced` (New's mapPoints).
   */
  function mapPoints(items, locations) {
    var byId = {};
    (Array.isArray(locations) ? locations : []).forEach(function (l) {
      var lat = Number(l && l.latitude);
      var lon = Number(l && l.longitude);
      if (l && l.id != null && l.latitude != null && l.longitude != null && !isNaN(lat) && !isNaN(lon)) {
        byId[String(l.id)] = { id: String(l.id), name: l.locationName || l.locationCode || ('Location ' + l.id), lat: lat, lon: lon };
      }
    });
    var counts = {};
    var unplaced = 0;
    var list = Array.isArray(items) ? items : [];
    list.forEach(function (it) {
      var id = it && it.locId ? it.locId : '';
      if (id && byId[id]) counts[id] = (counts[id] || 0) + 1;
      else unplaced += 1;
    });
    var ids = Object.keys(counts);
    if (!ids.length) return { points: [], unplaced: unplaced, placed: 0 };
    var lats = ids.map(function (i) { return byId[i].lat; });
    var lons = ids.map(function (i) { return byId[i].lon; });
    var minLat = Math.min.apply(null, lats);
    var maxLat = Math.max.apply(null, lats);
    var minLon = Math.min.apply(null, lons);
    var maxLon = Math.max.apply(null, lons);
    var spanLat = maxLat - minLat || 1;
    var spanLon = maxLon - minLon || 1;
    var max = Math.max.apply(null, ids.map(function (i) { return counts[i]; }));
    var points = ids.map(function (i) {
      var p = byId[i];
      var x = maxLon === minLon ? MAP_W / 2 : MAP_PAD + ((p.lon - minLon) / spanLon) * (MAP_W - 2 * MAP_PAD);
      var y = maxLat === minLat ? MAP_H / 2 : MAP_PAD + ((maxLat - p.lat) / spanLat) * (MAP_H - 2 * MAP_PAD);
      return { id: p.id, name: p.name, count: counts[i], x: Math.round(x), y: Math.round(y), r: Math.round(10 + 22 * Math.sqrt(counts[i] / max)),
        label: p.name + ' · ' + plural(counts[i], 'item') };
    }).sort(function (a, b) { return b.count - a.count; });
    return { points: points, unplaced: unplaced, placed: list.length - unplaced };
  }

  /** Where a bubble sits, as a style object (JET's :style takes an object). */
  function dotStyle(p) {
    var d = p || {};
    return {
      left: ((Number(d.x) || 0) / MAP_W * 100).toFixed(2) + '%',
      top: ((Number(d.y) || 0) / MAP_H * 100).toFixed(2) + '%',
      width: (2 * (Number(d.r) || 0)) + 'px',
      height: (2 * (Number(d.r) || 0)) + 'px'
    };
  }

  // ── exports ──────────────────────────────────────────────────────────────────────────────────────────────────

  /** The list's columns in Excel: what a person reads, plus the stored status. */
  function exportColumns() {
    return [
      { key: 'num', label: 'Number' },
      { key: 'title', label: 'Equipment' },
      { key: 'cls', label: 'Class' },
      { key: 'sub', label: 'Subclass' },
      { key: 'type', label: 'Type' },
      { key: 'maker', label: 'Manufacturer and model' },
      { key: 'trackingLabel', label: 'Tracking' },
      { key: 'serials', label: 'Serial units', type: 'number' },
      { key: 'onHand', label: 'On hand', type: 'number', value: function (it) { return it.onHand == null ? '' : it.onHand; } },
      { key: 'where', label: 'Location' },
      { key: 'statusLabel', label: 'Status' },
      { key: 'source', label: 'Source' },
      { key: 'st', label: 'Stored status' }
    ];
  }

  /** The fetched items on the Import view's page, in Excel. fns: the import functions (names of classes, units). */
  function importColumns(fns, vars) {
    var f = fns;
    var v = vars || {};
    return [
      { key: 'itemNumber', label: 'Item' },
      { key: 'itemDescription', label: 'Description' },
      { key: 'importStatus', label: 'Status', value: function (r) { return f.statusLabel(r.importStatus); } },
      { key: 'categoryName', label: 'Category' },
      { key: 'itemClassCode', label: 'Item class' },
      { key: 'resolvedClassId', label: 'Class', value: function (r) { return f.classNameFor(r.resolvedClassId, v.classesById); } },
      { key: 'resolvedSubclassId', label: 'Subclass', value: function (r) { return f.subclassNameFor(r.resolvedSubclassId, v.subclassesById); } },
      { key: 'units', label: 'Units', value: function (r) { return f.unitPathwayFor(r); } },
      { key: 'rejectReason', label: 'Reason' },
      { key: 'resolvedSource', label: 'Classified by', value: function (r) { return f.sourceLabel(r.resolvedSource); } },
      { key: 'ticked', label: 'Ticked', value: function (r) { return (v.stagingSelectedRows || {})[r.fusionInventoryItemId] ? 'Yes' : ''; } }
    ];
  }

  // ── one item ─────────────────────────────────────────────────────────────────────────────────────────────────

  function unitWord(status) {
    var s = txt(status).toUpperCase();
    if (!s) return 'No status';
    return UNIT_WORDS[s] || (s.charAt(0) + s.slice(1).toLowerCase()).replace(/_/g, ' ');
  }

  function unitTone(status) { return UNIT_TONE[txt(status).toUpperCase()] || 'neutral'; }

  var TONE_ORDER = { good: 0, progress: 1, blocked: 2, neutral: 3 };

  /**
   * Units by status: what can go out first, then what is out or held, then what is gone; the most first within each:
   * [{ key, label, count, tone }]. statusOf(row) reads a row's status.
   */
  function unitCounts(rows, statusOf) {
    var counts = {};
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      var s = txt(statusOf(r)).toUpperCase() || 'UNKNOWN';
      counts[s] = (counts[s] || 0) + 1;
    });
    return Object.keys(counts).map(function (s) {
      return { key: s, label: s === 'UNKNOWN' ? 'No status' : unitWord(s), count: counts[s], tone: unitTone(s) };
    }).sort(function (a, b) { return TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || b.count - a.count || cmp(a.label, b.label); });
  }

  /** What the units tile says: { value, label, note }. */
  function unitsGlance(rows, controlType, statusOf) {
    var list = Array.isArray(rows) ? rows : [];
    var c = txt(controlType).toUpperCase();
    var label = c === 'LOT' ? 'Lots' : (c === 'INVENTORY' ? 'Stock rows' : 'Serial units');
    if (!list.length) return { value: '0', label: label, note: 'None on record yet: Sync from Fusion brings them in' };
    var parts = unitCounts(list, statusOf).map(function (u) { return u.count + ' ' + u.label.toLowerCase(); });
    return { value: String(list.length), label: label, note: parts.join(' · ') };
  }

  /** How many units can go out now (available or active). */
  function availableCount(rows, statusOf) {
    return (Array.isArray(rows) ? rows : []).filter(function (r) { return unitTone(statusOf(r)) === 'good'; }).length;
  }

  /** Days from today (UTC calendar days) to an ISO date; null for none. */
  function daysTo(iso, now) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(txt(iso));
    if (!m) return null;
    var t = new Date(now != null ? now : Date.now());
    var today = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
    return Math.round((Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - today) / DAY);
  }

  /**
   * The certificate light (FDD 7.2.5A: green, amber 30 days before expiry, red): { tone, text }, worst first. rows:
   * equipmentAttachments.toRow rows (status valid / expired / upcoming / none).
   */
  function certLight(rows, now) {
    var list = Array.isArray(rows) ? rows : [];
    var expired = list.filter(function (r) { return r.status === 'expired'; }).length;
    if (expired) return { tone: 'bad', text: expired === 1 ? '1 certificate expired' : expired + ' certificates expired' };
    var soon = list.filter(function (r) { var d = daysTo(r.validTo, now); return r.status === 'valid' && d != null && d <= EXPIRING_DAYS; })
      .map(function (r) { return daysTo(r.validTo, now); }).sort(function (a, b) { return a - b; });
    if (soon.length) {
      var d = soon[0];
      return { tone: 'warn', text: (soon.length === 1 ? 'A certificate expires ' : soon.length + ' certificates expire, the first ')
        + (d === 0 ? 'today' : (d === 1 ? 'tomorrow' : 'in ' + d + ' days')) };
    }
    var upcoming = list.filter(function (r) { return r.status === 'upcoming'; }).length;
    if (upcoming) return { tone: 'warn', text: upcoming === 1 ? '1 certificate not valid yet' : upcoming + ' certificates not valid yet' };
    if (list.some(function (r) { return r.status === 'valid'; })) return { tone: 'ok', text: 'Certificates valid' };
    return { tone: 'none', text: 'No certificates on file' };
  }

  /** A document's validity in words: "Valid to 19 Nov 2026", "Expired 2 Mar 2026", "Valid from …", ''. */
  function docValidity(row, dateFn) {
    var r = row || {};
    if (r.status === 'expired') return 'Expired ' + dateFn(r.validTo);
    if (r.status === 'upcoming') return 'Valid from ' + dateFn(r.validFrom);
    if (r.validTo) return 'Valid to ' + dateFn(r.validTo);
    return '';
  }

  /** The maintenance light: { tone, text } from the work orders (workOrderRows) and whether they were read. */
  function woLight(rows, loaded, loading) {
    if (loading) return { tone: 'none', text: 'Checking Fusion work orders…' };
    if (!loaded) return { tone: 'none', text: 'Work orders not checked' };
    var open = (Array.isArray(rows) ? rows : []).filter(function (r) { return r.open; }).length;
    return open ? { tone: 'warn', text: open === 1 ? '1 open work order' : open + ' open work orders' } : { tone: 'ok', text: 'No open work orders' };
  }

  /** This item in New EquipRite (its Equipment detail), or ''. */
  function newItemUrl(newBase, id) {
    if (!newBase || id == null || id === '') return '';
    return (newBase.slice(-1) === '/' ? newBase : newBase + '/') + 'vp/shell/master/equipment-detail?equipmentId=' + encodeURIComponent(id);
  }

  /** The units on the item tab, in Excel. fns: the item page's functions (unitId, unitWhere, unitQty, unitDates). */
  function unitColumns(fns, controlType) {
    var f = fns;
    return [
      { key: 'unit', label: 'Unit', value: function (r) { return f.unitId(r, controlType); } },
      { key: 'unitTagNumber', label: 'Tag' },
      { key: 'status', label: 'Status', value: function (r) { return unitWord(f.unitStatus(r)); } },
      { key: 'where', label: 'Where', value: function (r) { return f.unitWhere(r); } },
      { key: 'qty', label: 'Quantity', value: function (r) { return f.unitQty(r, controlType); } },
      { key: 'maintenanceAssetNumber', label: 'Maintenance asset' },
      { key: 'dates', label: 'Dates', value: function (r) { return f.unitDates(r, controlType); } },
      { key: 'stored', label: 'Stored status', value: function (r) { return f.unitStatus(r); } }
    ];
  }

  function docColumns() {
    return [
      { key: 'name', label: 'Document' }, { key: 'categoryLabel', label: 'Category' }, { key: 'validFrom', label: 'Valid from' },
      { key: 'validTo', label: 'Valid to' }, { key: 'statusLabel', label: 'Validity' }, { key: 'fileType', label: 'File type' },
      { key: 'uploadedBy', label: 'Uploaded by' }, { key: 'uploadDate', label: 'Uploaded' }
    ];
  }

  function workOrderColumns() {
    return [
      { key: 'number', label: 'Work order' }, { key: 'type', label: 'Type' }, { key: 'asset', label: 'Asset' }, { key: 'status', label: 'Status' },
      { key: 'open', label: 'Open', value: function (r) { return r.open ? 'Yes' : 'No'; } }, { key: 'start', label: 'Planned start' },
      { key: 'end', label: 'Planned end' }, { key: 'description', label: 'Description' }
    ];
  }

  return {
    TRACKING: TRACKING,
    trackingOf: trackingOf,
    trackingLabel: trackingLabel,
    trackingLong: trackingLong,
    statusLabel: statusLabel,
    statusTone: statusTone,
    sourceOf: sourceOf,
    sourceWords: sourceWords,
    typeWords: typeWords,
    stockText: stockText,
    locationIndex: locationIndex,
    mergeRows: mergeRows,
    decorate: decorate,
    serverQuery: serverQuery,
    search: search,
    filter: filter,
    chips: chips,
    filtersOn: filtersOn,
    sort: sort,
    firstDir: firstDir,
    summary: summary,
    when: when,
    fusionLine: fusionLine,
    mapPoints: mapPoints,
    dotStyle: dotStyle,
    exportColumns: exportColumns,
    importColumns: importColumns,
    unitWord: unitWord,
    unitTone: unitTone,
    unitCounts: unitCounts,
    unitsGlance: unitsGlance,
    availableCount: availableCount,
    daysTo: daysTo,
    certLight: certLight,
    docValidity: docValidity,
    woLight: woLight,
    newItemUrl: newItemUrl,
    unitColumns: unitColumns,
    docColumns: docColumns,
    workOrderColumns: workOrderColumns
  };
});
