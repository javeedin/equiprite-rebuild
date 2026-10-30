define(['resources/js/requestProgress', 'resources/js/fmt', 'resources/js/rules'], function (Progress, fmt, rules) {
  'use strict';

  // The Requests screen's logic, pure: each request read from its equipment (requestProgress), the journey chips,
  // search, sort, the board's columns, the equipment rows, and what each view exports.
  //
  // A request belongs to every stage its equipment is in (one piece on the way and two being picked: On the way and
  // Getting ready), so chips need not add up to All. On the board it sits in the column of what holds it up (the
  // stage of its furthest-behind piece), with its bar showing the rest.

  var CHIPS = [
    { key: 'late', label: 'Late' },
    { key: 'action', label: 'Needs action' },
    { key: 'approval', label: 'Waiting for approval' },
    { key: 'ready', label: 'Getting ready' },
    { key: 'out', label: 'On the way' },
    { key: 'onsite', label: 'On site' },
    { key: 'back', label: 'Coming back' },
    { key: 'done', label: 'Done' }
  ];
  var LANES = [
    { key: 'action', label: 'Needs action', hint: 'Drafts, sent back, a quote to accept' },
    { key: 'approval', label: 'Waiting for approval', hint: 'With the Equipment Manager' },
    { key: 'ready', label: 'Getting ready', hint: 'Units assigned, bought, picked' },
    { key: 'out', label: 'On the way', hint: 'Shipped to site' },
    { key: 'onsite', label: 'On site', hint: 'In use' },
    { key: 'back', label: 'Coming back', hint: 'Returning to the yard' },
    { key: 'done', label: 'Done', hint: 'Returned, closed, cancelled' }
  ];

  function up(v) { return String(v == null ? '' : v).toUpperCase(); }
  function lc(v) { return String(v == null ? '' : v).toLowerCase(); }

  /** Each request with its progress and the fields the screen shows: { …row, p, external, party, pieces, lines }. */
  function decorate(rows, linesByRequest, now) {
    return (Array.isArray(rows) ? rows : []).map(function (r) {
      var lines = (linesByRequest || {})[r.requestNumber] || [];
      var external = rules.isExternalSource(r.requestOrigin);
      var p = Progress.summarize(up(r.status || r.requestStatus), lines, { start: r.startDate, end: r.endDate, external: external, now: now });
      return Object.assign({}, r, {
        p: p,
        external: external,
        party: r.projectName || r.customerName || r.projectInternalCustomer || '',
        partyFor: r.projectName ? (r.customerName || r.projectInternalCustomer || '') : '',
        pieces: lines.reduce(function (s, l) { return s + (Number(l.qty) || 1); }, 0) || Number(r.lines) || 0,
        lineCount: lines.length,
        segs: lines.map(function (l) { var i = Progress.line(l.lineStatus || l.status || r.status, external); return { stage: i.stage || 'ready', title: (l.name || 'Equipment') + ': ' + i.label }; }),
        lane: laneOf(p),
        dates: fmt.range(r.startDate, r.endDate)
      });
    });
  }

  /** The chips a request belongs to. */
  function keysOf(p) {
    if (!p) return [];
    var keys = p.late && p.late.length ? ['late'] : [];
    if (p.stage === 'draft' || p.headline === 'Sent back' || (p.next && p.next.who === 'Customer')) keys.push('action');
    if (p.stage === 'stopped' && p.headline !== 'Sent back') keys.push('done');
    return keys.concat(p.stages.filter(function (k) { return k !== 'draft' && k !== 'stopped'; }));
  }

  /** The board column: what holds the request up. */
  function laneOf(p) {
    if (!p) return 'approval';
    if (p.stage === 'draft' || p.headline === 'Sent back' || (p.next && p.next.who === 'Customer')) return 'action';
    if (p.stage === 'stopped') return 'done';
    var stages = (p.stages || []).filter(function (k) { return k !== 'draft' && k !== 'stopped'; });
    var open = stages.filter(function (k) { return k !== 'done'; });
    return open[0] || stages[0] || 'approval';
  }

  function chips(items, keysFn) {
    var counts = {};
    items.forEach(function (it) { keysFn(it).forEach(function (k) { counts[k] = (counts[k] || 0) + 1; }); });
    return [{ key: 'all', label: 'All', count: items.length }]
      .concat(CHIPS.map(function (c) { return { key: c.key, label: c.label, count: counts[c.key] || 0 }; }))
      .filter(function (c) { return c.key === 'all' || c.key !== 'late' || c.count > 0; });
  }

  /** Requests' chips (a request counts in each stage it is in). */
  function requestChips(items) { return chips(items, function (r) { return keysOf(r.p); }); }

  /** Search, chip and source. */
  function filter(items, text, stage, source, linesByRequest) {
    var q = lc(text).trim();
    return (items || []).filter(function (r) {
      if (stage && stage !== 'all' && keysOf(r.p).indexOf(stage) === -1) return false;
      if (source === 'EXTERNAL' && !r.external) return false;
      if (source === 'INTERNAL' && r.external) return false;
      if (!q) return true;
      if ([r.requestNumber, r.projectName, r.taskName, r.customerName, r.projectInternalCustomer, r.requestorName, r.contactName, r.p.headline]
        .some(function (v) { return lc(v).indexOf(q) !== -1; })) return true;
      var lines = (linesByRequest || {})[r.requestNumber] || [];
      return lines.some(function (l) { return lc(l.name).indexOf(q) !== -1 || lc(l.cls).indexOf(q) !== -1 || lc(l.serial).indexOf(q) !== -1; });
    });
  }

  var STAGE_ORDER = { action: 0, approval: 1, ready: 2, out: 3, onsite: 4, back: 5, done: 6 };
  var SORTS = {
    number: function (r) { return Number(r.eqrEquipmentRequestId) || 0; },
    party: function (r) { return lc(r.party); },
    stage: function (r) { return (STAGE_ORDER[r.lane] != null ? STAGE_ORDER[r.lane] : 9) * 10 - (r.p.late.length ? 1 : 0); },
    start: function (r) { return String(r.startDate || ''); },
    requestor: function (r) { return lc(r.requestorName || r.contactName); }
  };

  /** Sorted copy: key number | party | stage | start | requestor; dir asc | desc. */
  function sort(items, key, dir) {
    var f = SORTS[key] || SORTS.number;
    var sign = dir === 'asc' ? 1 : -1;
    return (items || []).slice().sort(function (a, b) {
      var x = f(a);
      var y = f(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sign || (Number(b.eqrEquipmentRequestId) || 0) - (Number(a.eqrEquipmentRequestId) || 0);
    });
  }

  /** The board: one column per lane, each with its requests (late first). Empty columns kept, so the board reads as a flow. */
  function board(items, max) {
    var cap = max || 50;
    return LANES.map(function (l) {
      var all = (items || []).filter(function (r) { return r.lane === l.key; })
        .sort(function (a, b) { return (b.p.late.length - a.p.late.length) || (Number(b.eqrEquipmentRequestId) || 0) - (Number(a.eqrEquipmentRequestId) || 0); });
      return { key: l.key, label: l.label, hint: l.hint, count: all.length, items: all.slice(0, cap), more: Math.max(0, all.length - cap) };
    });
  }

  /** One row per piece of equipment, joined to its request, each with its stage, words and whether it is late. */
  function equipmentRows(items, linesByRequest, now) {
    var out = [];
    (items || []).forEach(function (r) {
      ((linesByRequest || {})[r.requestNumber] || []).forEach(function (l) {
        var status = l.lineStatus || up(r.status || r.requestStatus);
        var one = Progress.summarize(status, [{ lineStatus: status, start: l.start, end: l.end }],
          { start: r.startDate, end: r.endDate, external: r.external, now: now });
        var info = Progress.line(status, r.external);
        out.push({
          key: r.requestNumber + ':' + l.key, requestId: r.eqrEquipmentRequestId, requestNumber: r.requestNumber,
          name: l.name, cls: l.cls, qty: l.qty, serial: l.serial, unit: unitText(l), status: status, stage: info.stage || 'ready', label: info.label,
          late: one.late.length ? one.late[0].text.replace(/^1 /, '') : '', start: l.start || String(r.startDate || '').slice(0, 10),
          end: l.end || String(r.endDate || '').slice(0, 10), location: l.location, party: r.party, external: r.external, util: l.util
        });
      });
    });
    return out;
  }

  /** The serial, else whether a unit is assigned yet, in words. */
  function unitText(l) {
    if (l.serial) return l.serial;
    return { ALLOCATED: 'Unit assigned', PARTIALLY_ALLOCATED: 'Partly assigned', PENDING: 'No unit assigned yet', UNALLOCATED: 'No unit assigned yet' }[l.allocation] || '';
  }

  /** Equipment chips: each piece counted by its own stage. */
  function equipmentChips(rows) {
    return chips(rows, function (e) {
      var keys = e.late ? ['late'] : [];
      if (e.stage === 'draft' || e.status === 'REJECTED' || e.status === 'QUOTE_GENERATED') keys.push('action');
      else keys.push(e.stage === 'stopped' ? 'done' : e.stage);
      return keys;
    });
  }

  function filterEquipment(rows, text, stage, source) {
    var q = lc(text).trim();
    return (rows || []).filter(function (e) {
      if (stage && stage !== 'all') {
        var keys = e.late ? ['late'] : [];
        keys.push(e.stage === 'draft' || e.status === 'REJECTED' || e.status === 'QUOTE_GENERATED' ? 'action' : (e.stage === 'stopped' ? 'done' : e.stage));
        if (keys.indexOf(stage) === -1) return false;
      }
      if (source === 'EXTERNAL' && !e.external) return false;
      if (source === 'INTERNAL' && e.external) return false;
      return !q || [e.name, e.cls, e.serial, e.requestNumber, e.party, e.location, e.label].some(function (v) { return lc(v).indexOf(q) !== -1; });
    });
  }

  /** What each view exports: the columns as people read them. */
  function exportColumns(view) {
    if (view === 'equipment') {
      return [
        { key: 'requestNumber', label: 'Request' }, { key: 'name', label: 'Equipment' }, { key: 'cls', label: 'Class' },
        { key: 'qty', label: 'Qty', type: 'number' }, { key: 'unit', label: 'Unit / serial' }, { key: 'label', label: 'Where it is' },
        { key: 'late', label: 'Late' }, { key: 'start', label: 'Start' }, { key: 'end', label: 'End' }, { key: 'location', label: 'Location' },
        { key: 'party', label: 'Project or customer' }
      ];
    }
    return [
      { key: 'requestNumber', label: 'Request' },
      { key: 'origin', label: 'Type', value: function (r) { return r.external ? 'Customer' : 'Project'; } },
      { key: 'party', label: 'Project or customer' }, { key: 'taskName', label: 'Task' },
      { key: 'status', label: 'Status', value: function (r) { return r.p.headline; } },
      { key: 'where', label: 'Where the equipment is', value: function (r) { return r.p.detail; } },
      { key: 'next', label: 'Next step', value: function (r) { return r.p.next ? r.p.next.text : ''; } },
      { key: 'late', label: 'Late', value: function (r) { return r.p.late.map(function (l) { return l.text; }).join('; '); } },
      { key: 'startDate', label: 'Start', value: function (r) { return String(r.startDate || '').slice(0, 10); } },
      { key: 'endDate', label: 'End', value: function (r) { return String(r.endDate || '').slice(0, 10); } },
      { key: 'pieces', label: 'Pieces', type: 'number' },
      { key: 'requestor', label: 'Requested by', value: function (r) { return r.requestorName || r.contactName || ''; } },
      { key: 'stored', label: 'Stored status', value: function (r) { return up(r.status || r.requestStatus); } }
    ];
  }

  /** The band under the title: "100 requests · 176 pieces · 3 late". */
  function summary(items) {
    var list = items || [];
    var pieces = list.reduce(function (s, r) { return s + (r.pieces || 0); }, 0);
    var late = list.filter(function (r) { return r.p.late.length; }).length;
    return fmt.count(list.length, 'request') + (pieces ? ' · ' + fmt.count(pieces, 'piece') + ' of equipment' : '') + (late ? ' · ' + late + ' late' : '');
  }

  return {
    CHIPS: CHIPS, LANES: LANES, decorate: decorate, keysOf: keysOf, laneOf: laneOf, requestChips: requestChips, filter: filter, sort: sort,
    board: board, equipmentRows: equipmentRows, equipmentChips: equipmentChips, filterEquipment: filterEquipment, exportColumns: exportColumns,
    summary: summary, unitText: unitText
  };
});
