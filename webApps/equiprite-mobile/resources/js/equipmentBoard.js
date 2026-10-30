define([], function () {
  'use strict';

  // Equipment workbench: the fleet seen unit by unit, not request by request. Pure: the page's chain loads three
  // views and this joins them (FDD 6.1 EQR_EQUIPMENT_MASTER + Fusion serial/lot/item units; FDD 7.10 schedule):
  //
  //   views/yard-stock           every unit and its status (Analytics' Stock tab rows): unitNumber, unitType,
  //                              assetNumber, equipmentName, className, invOrgName/invOrgId, unitStatus, onhandQty,
  //                              projectName, currentStartDate, currentEndDate
  //   views/deployed-units       units out with a customer or project (directReturn.findDeployedUnits): the request,
  //                              line status, dates, and the server's own overdue flag
  //   views/workbench-lines      allocated lines (allocatedSerial): the bookings, current and next, per unit
  //
  // A unit is matched across the three by its identifier (serial, lot or item number), case-insensitively.

  var DAY = 86400000;
  var SOON = 7;          // "this week": due back / going out within 7 days
  var TIGHT = 2;         // back and out again within 2 days: turnaround risk

  var LANES = [
    { key: 'yard', label: 'In the yard', hint: 'Available, nothing booked this week' },
    { key: 'going', label: 'Going out this week', hint: 'Booked to start within 7 days' },
    { key: 'out', label: 'Out on rent', hint: 'With a project or customer' },
    { key: 'due', label: 'Due back this week', hint: 'Ends within 7 days' },
    { key: 'overdue', label: 'Overdue', hint: 'Past the end date and not back' },
    { key: 'maint', label: 'Maintenance', hint: 'In maintenance or repair' },
    { key: 'other', label: 'Other', hint: 'In transit, retired or another status' }
  ];

  var OUT_STATUSES = { RENTED: 1, DEPLOYED: 1, ON_RENT: 1, ISSUED: 1, IN_USE: 1 };
  var YARD_STATUSES = { AVAILABLE: 1, ACTIVE: 1, IN_STOCK: 1, ALLOCATED: 1, RESERVED: 1 };
  var MAINT = /MAINT|REPAIR|INSPECT|DAMAGE|QUARANTINE|UNAVAILABLE|DOWN/;

  function up(v) { return String(v || '').trim().toUpperCase(); }
  function d10(v) { return v ? String(v).slice(0, 10) : ''; }
  function dayMs(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  }
  function today(now) {
    var d = new Date(now);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  function pick(r, names) {
    for (var i = 0; i < names.length; i++) {
      if (r && r[names[i]] !== undefined && r[names[i]] !== null && r[names[i]] !== '') return r[names[i]];
    }
    return undefined;
  }
  function days(a, b) { return Math.round((a - b) / DAY); }

  /** The unit's identifier as the views carry it (serial, lot or item number), for matching. */
  function idOf(r) {
    return up(pick(r, ['unitNumber', 'unitIdentifier', 'serialNumber', 'allocatedSerial', 'lotNumber', 'itemNumber']));
  }

  /** Bookings per unit from workbench-lines: { UNIT: [{ requestNumber, status, start, end, project, location }] }, by start. */
  function bookingsByUnit(lines) {
    var out = {};
    (lines || []).forEach(function (l) {
      var id = up(l.allocatedSerial);
      if (!id) return;
      (out[id] = out[id] || []).push({
        requestNumber: l.requestNumber || '', status: up(l.requestStatus || l.lineStatus),
        start: d10(l.startDate), end: d10(l.endDate), project: l.projectName || '', location: l.deploymentLocation || ''
      });
    });
    Object.keys(out).forEach(function (k) { out[k].sort(function (a, b) { return a.start.localeCompare(b.start); }); });
    return out;
  }

  /**
   * One unit, joined: its stock row, its deployment (if out) and its bookings, placed in a lane with what to say.
   * @param {Object} s     yard-stock row
   * @param {Object} dep   deployed-units row (directReturn mapRow shape) or undefined
   * @param {Array}  books bookings for this unit or undefined
   */
  function unitOf(s, dep, books, t) {
    var id = idOf(s) || (dep ? up(dep.serialNumber || dep.unitIdentifier) : '');
    var status = up(s.unitStatus || (dep && dep.unitStatus));
    var start = d10(dep ? dep.startDate : s.currentStartDate);
    var end = d10(dep ? dep.endDate : s.currentEndDate);
    var endMs = dayMs(end);
    var isOut = !!dep || !!OUT_STATUSES[status];
    var next = null;
    (books || []).forEach(function (b) {
      var bs = dayMs(b.start);
      if (next || bs === null) return;
      // The next booking is one that starts after today and is not the current rental.
      if (bs > t && !(dep && b.requestNumber === dep.requestNumber)) next = b;
    });
    var nextIn = next ? days(dayMs(next.start), t) : null;
    var lane;
    if (MAINT.test(status)) lane = 'maint';
    else if (isOut && endMs !== null && (dep ? dep.overdue : endMs < t)) lane = 'overdue';
    else if (isOut && endMs !== null && days(endMs, t) <= SOON) lane = 'due';
    else if (isOut) lane = 'out';
    else if (YARD_STATUSES[status] || !status) lane = next && nextIn <= SOON ? 'going' : 'yard';
    else lane = 'other';

    var turnaround = null;
    if (isOut && next && endMs !== null) {
      turnaround = days(dayMs(next.start), endMs);
    }
    var when = '';
    if (lane === 'overdue') when = days(t, endMs) === 0 ? 'Due back today' : days(t, endMs) + (days(t, endMs) === 1 ? ' day overdue' : ' days overdue');
    else if (lane === 'due') when = days(endMs, t) === 0 ? 'Due back today' : 'Back in ' + days(endMs, t) + (days(endMs, t) === 1 ? ' day' : ' days');
    else if (lane === 'out') when = endMs !== null ? 'Back ' + fmtDay(end) : 'Out';
    else if (lane === 'going') when = nextIn === 0 ? 'Goes out today' : 'Goes out in ' + nextIn + (nextIn === 1 ? ' day' : ' days');
    else if (lane === 'yard') when = next ? 'Free until ' + fmtDay(next.start) : 'Nothing booked';
    else if (lane === 'maint') when = 'In maintenance';

    return {
      key: id || (s.assetNumber ? 'A:' + s.assetNumber : ''),
      id: id,
      unit: pick(s, ['unitNumber']) || (dep && (dep.serialNumber || dep.unitIdentifier)) || '—',
      type: up(pick(s, ['unitType']) || (dep && dep.unitType)),
      asset: s.assetNumber || '',
      name: s.equipmentName || (dep && dep.equipmentName) || 'Equipment',
      cls: s.className || (dep && dep.className) || '',
      qty: s.onhandQty != null ? Number(s.onhandQty) : null,
      status: status,
      lane: lane,
      yard: s.invOrgName || (dep && dep.yardOrgName) || '',
      yardId: s.invOrgId != null ? String(s.invOrgId) : (dep && dep.yardOrgId != null ? String(dep.yardOrgId) : ''),
      party: (dep && dep.partyName) || s.projectName || '',
      requestNumber: dep ? dep.requestNumber : '',
      requestId: dep ? dep.requestId : null,
      lineStatus: dep ? up(dep.lineStatus) : '',
      start: start,
      end: end,
      when: when,
      next: next,
      turnaround: turnaround,
      tight: turnaround !== null && turnaround <= TIGHT,
      bookings: books || []
    };
  }

  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDay(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
    return m ? Number(m[3]) + ' ' + MON[Number(m[2]) - 1] : '';
  }

  /**
   * Every unit, joined across the three views. A deployed unit the stock view does not list still appears (built
   * from its deployment), so nothing that is out goes missing.
   */
  function build(stockRows, deployedRows, workbenchLines, now) {
    var t = today(now || Date.now());
    var books = bookingsByUnit(workbenchLines);
    var depById = {};
    (deployedRows || []).forEach(function (d) {
      var id = up(d.serialNumber || d.unitIdentifier);
      if (id && !depById[id]) depById[id] = d;
    });
    var seen = {};
    var units = (stockRows || []).map(function (s) {
      var id = idOf(s);
      if (id) seen[id] = true;
      return unitOf(s, id ? depById[id] : undefined, id ? books[id] : undefined, t);
    });
    Object.keys(depById).forEach(function (id) {
      if (seen[id]) return;
      var d = depById[id];
      units.push(unitOf({ unitNumber: d.serialNumber || d.unitIdentifier, unitType: d.unitType, equipmentName: d.equipmentName,
        className: d.className, invOrgName: d.yardOrgName, invOrgId: d.yardOrgId, unitStatus: d.unitStatus }, d, books[id], t));
    });
    // A unit with neither identifier nor asset number (a quantity of an item) still needs a stable key.
    units.forEach(function (u, i) { if (!u.key) u.key = 'row-' + i; });
    return units;
  }

  /** The order a lane reads in: most urgent first. */
  var LANE_SORT = {
    overdue: function (a, b) { return a.end.localeCompare(b.end); },
    due: function (a, b) { return a.end.localeCompare(b.end); },
    going: function (a, b) { return (a.next ? a.next.start : '').localeCompare(b.next ? b.next.start : ''); },
    out: function (a, b) { return Number(b.tight) - Number(a.tight) || a.end.localeCompare(b.end); },
    yard: function (a, b) { return a.name.localeCompare(b.name) || a.unit.localeCompare(b.unit); },
    maint: function (a, b) { return a.name.localeCompare(b.name); },
    other: function (a, b) { return a.status.localeCompare(b.status) || a.name.localeCompare(b.name); }
  };

  /** Units filtered by search, class, yard, lane and "tight turnaround only". */
  function filter(units, f) {
    var o = f || {};
    var q = String(o.text || '').trim().toLowerCase();
    return (units || []).filter(function (u) {
      if (o.cls && u.cls !== o.cls) return false;
      if (o.yard && u.yardId !== o.yard) return false;
      if (o.lane && o.lane !== 'all' && u.lane !== o.lane) return false;
      if (o.tightOnly && !u.tight) return false;
      if (!q) return true;
      return [u.unit, u.asset, u.name, u.cls, u.yard, u.party, u.requestNumber, u.next && u.next.requestNumber]
        .some(function (v) { return v && String(v).toLowerCase().indexOf(q) !== -1; });
    });
  }

  /** The board: a column per lane with its count and its first `max` units, most urgent first. Empty lanes stay. */
  function lanes(units, max) {
    var n = max || 30;
    return LANES.filter(function (l) {
      return l.key !== 'other' || (units || []).some(function (u) { return u.lane === 'other'; });
    }).map(function (l) {
      var list = (units || []).filter(function (u) { return u.lane === l.key; });
      list.sort(LANE_SORT[l.key]);
      return { key: l.key, label: l.label, hint: l.hint, count: list.length, units: list.slice(0, n), more: Math.max(0, list.length - n) };
    });
  }

  /** Headline counts for the band and the KPI tiles. */
  function summary(units) {
    var s = { total: 0, yard: 0, going: 0, out: 0, due: 0, overdue: 0, maint: 0, other: 0, tight: 0, utilizationPct: null };
    (units || []).forEach(function (u) { s.total++; s[u.lane]++; if (u.tight) s.tight++; });
    var outNow = s.out + s.due + s.overdue;
    s.outNow = outNow;
    s.utilizationPct = s.total ? Math.round((outNow / s.total) * 100) : null;
    return s;
  }

  /** Chip options with counts, biggest first: field 'cls' or 'yard'. */
  function options(units, field, max) {
    var counts = {};
    var labels = {};
    (units || []).forEach(function (u) {
      var k = field === 'yard' ? u.yardId : u.cls;
      if (!k) return;
      counts[k] = (counts[k] || 0) + 1;
      labels[k] = field === 'yard' ? (u.yard || k) : k;
    });
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || labels[a].localeCompare(labels[b]); })
      .slice(0, max || 12).map(function (k) { return { key: k, label: labels[k], count: counts[k] }; });
  }

  return {
    LANES: LANES,
    SOON: SOON,
    TIGHT: TIGHT,
    bookingsByUnit: bookingsByUnit,
    build: build,
    filter: filter,
    lanes: lanes,
    summary: summary,
    options: options,
    fmtDay: fmtDay
  };
});
