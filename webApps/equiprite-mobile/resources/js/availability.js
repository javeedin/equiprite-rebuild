define(['resources/js/requestProgress', 'resources/js/rules'], function (Progress, rules) {
  'use strict';

  // Availability: the equipment schedule read for two questions. "Can I have an excavator from the 8th to the
  // 20th?" (free capacity per class for a window) and "where are my clashes?" (two holds on one unit at once, and
  // turnarounds too tight to make). Pure: the page's loadChain reads the data (availabilityData.js) and this builds
  // what the page shows. Nothing here writes; bookings change on the request line, which every bar opens.
  //
  // The rules are New EquipRite's schedule (flows/schedule/pages/schedule-page.js, carried over from Old EquipRite's
  // equipment-schedule page), kept:
  //   - one row per serial-ref; its bookings are workbench-lines joined on allocatedSerial (a repeated view row,
  //     same eqrRequestLineId, counts once); a line with no start date has no place on a timeline;
  //   - a bar runs from the requested start to the requested end, both days counted, at least one day;
  //   - planned maintenance is one bar per Fusion work order on the unit's maintenance asset, planned start to
  //     planned completion;
  //   - a cancelled or rejected allocation holds nothing; any other allocation and planned maintenance hold the unit;
  //   - a clash is two holds on one unit sharing at least a day (two work orders together are not one), and only a
  //     clash still open today counts.
  // Added here, read from the same rows: the journey stage of each booking (requestProgress, from the line's status
  // in my-request-lines), so a line that is back at the yard or was stopped no longer holds the unit; a tight
  // turnaround (back and out again within TIGHT days, New's equipment board rule); and the window's capacity.

  var DAY = 86400000;
  var TIGHT = 2;
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var WD = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  var NO_CLASS = 'No class';
  var NO_YARD = 'No yard recorded';
  // Rows: about ROWS on screen at first, shared between the groups (at least MIN_ROWS each); "Show more" adds MORE_ROWS.
  var ROWS = 80;
  var MIN_ROWS = 6;
  var MORE_ROWS = 50;
  // The clash panel lists this many; the chips show every unit with one.
  var PROBLEMS = 40;

  // Week: four weeks, day by day. Month: thirteen weeks, week by week. Both start on a Monday.
  var ZOOMS = {
    week: { days: 28, step: 14, label: 'Week' },
    month: { days: 91, step: 28, label: 'Month' }
  };

  var STATES = {
    free: { label: 'Free', hint: 'Nothing booked and no planned maintenance in your window' },
    tight: { label: 'Free, tight', hint: 'Free, but back from or out to another job within ' + TIGHT + ' days of your window' },
    booked: { label: 'Booked', hint: 'Held by a booking in your window' },
    maint: { label: 'Maintenance', hint: 'Planned maintenance in your window' }
  };

  var CHIPS = [
    { key: 'all', label: 'All units' },
    { key: 'free', label: 'Free in your window' },
    { key: 'booked', label: 'Booked in your window' },
    { key: 'maint', label: 'Maintenance in your window' },
    { key: 'clash', label: 'Clashes' },
    { key: 'tight', label: 'Tight turnarounds' }
  ];

  // ── Dates: 'YYYY-MM-DD' strings and whole day numbers, no time zone involved ──────────────────────────────────
  function d10(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v == null ? '' : v));
    return m ? m[1] + '-' + m[2] + '-' + m[3] : '';
  }
  function num(s10) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s10 || ''));
    return m ? Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY) : null;
  }
  function key(n) { return new Date(n * DAY).toISOString().slice(0, 10); }
  function addDays(s10, n) { var x = num(s10); return x == null ? s10 : key(x + (n || 0)); }
  function diff(a, b) { return num(a) - num(b); }
  /** Monday of the week a day falls in. */
  function mondayOf(s10) {
    var n = num(s10);
    if (n == null) return s10;
    var dow = new Date(n * DAY).getUTCDay();
    return key(n - ((dow + 6) % 7));
  }
  /** Today in the browser's time zone (the person's calendar day). */
  function todayKey(now) {
    var d = now != null ? new Date(now) : new Date();
    var p = function (x) { return (x < 10 ? '0' : '') + x; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function parts(s10) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s10 || ''));
    return m ? { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) } : null;
  }
  /** '8 Nov' or '8 Nov 2026'. */
  function fmtDay(s10, year) {
    var p = parts(s10);
    return p ? p.d + ' ' + MON[p.m] + (year ? ' ' + p.y : '') : '';
  }
  /** '8 – 20 Nov 2026', '28 Nov – 4 Dec 2026', '20 Dec 2026 – 3 Jan 2027', '8 Nov 2026'. */
  function range(a, b) {
    var x = parts(a);
    var y = parts(b);
    if (!x) return y ? fmtDay(b, true) : '';
    if (!y || a === b) return fmtDay(a, true);
    if (x.y !== y.y) return fmtDay(a, true) + ' – ' + fmtDay(b, true);
    if (x.m !== y.m) return fmtDay(a) + ' – ' + fmtDay(b, true);
    return x.d + ' – ' + fmtDay(b, true);
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function up(v) { return String(v == null ? '' : v).trim().toUpperCase(); }
  function lc(v) { return String(v == null ? '' : v).toLowerCase(); }
  function cmp(a, b) { return a < b ? -1 : (a > b ? 1 : 0); }
  function pick(r, names) {
    for (var i = 0; i < names.length; i++) {
      var v = r && r[names[i]];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return undefined;
  }

  /** Bar length in days, both ends counted, at least one (the old builder's formula). */
  function spanDays(s10, e10) {
    return s10 && e10 ? Math.max(1, Math.abs(diff(e10, s10)) + 1) : 1;
  }

  // ── Bookings ─────────────────────────────────────────────────────────────────────────────────────────────────
  /** hard (ALLOCATED, MOBILIZATION), soft (PENDING, IN_PROCESS), cancelled (REJECTED, CANCELLED), other. */
  function reserveOf(alloc) {
    var s = up(alloc);
    if (s === 'ALLOCATED' || s === 'MOBILIZATION') return 'hard';
    if (s === 'PENDING' || s === 'IN_PROCESS') return 'soft';
    if (s === 'REJECTED' || s === 'CANCELLED') return 'cancelled';
    return 'other';
  }

  var RESERVE_WORDS = {
    hard: 'Unit assigned (hard reserve)',
    soft: 'Unit held, not confirmed (soft reserve)',
    other: 'Booked',
    cancelled: 'Cancelled'
  };

  /**
   * Where a booking is on its journey: the line's own status when my-request-lines has it, else the allocation
   * and the request's status. { code, stage, label }.
   */
  function stageOf(lineStatus, alloc, requestStatus, external, reserve) {
    var code = up(lineStatus);
    if (!code) code = reserve === 'hard' ? 'ALLOCATED' : (up(requestStatus) || 'IN_PROCESS');
    var info = Progress.line(code, external);
    var label = info.label;
    // An approved line with a unit on it is "Unit assigned", not "no unit assigned yet".
    if (/no unit assigned/i.test(label) && reserve === 'hard') label = 'Unit assigned';
    else if (/no unit assigned/i.test(label) && reserve === 'soft') label = 'Unit held, not confirmed yet';
    return { code: code, stage: info.stage || 'ready', label: label };
  }

  /** The request's line in my-request-lines (by line number, else by serial). */
  function findLine(list, lineNumber, serial) {
    var ls = Array.isArray(list) ? list : [];
    var n = lineNumber != null && lineNumber !== '' ? Number(lineNumber) : null;
    var s = up(serial);
    var byNumber = n == null ? [] : ls.filter(function (l) { return Number(l.lineNumber) === n; });
    if (byNumber.length === 1) return byNumber[0];
    var bySerial = (byNumber.length ? byNumber : ls).filter(function (l) { return s && up(l.serial || l.allocatedSerial) === s; });
    return bySerial[0] || byNumber[0] || null;
  }

  function yardLabel(code, name) {
    if (code) return name && name !== code ? code + ' · ' + name : code;
    return name || NO_YARD;
  }

  /**
   * The model: units, their bookings and maintenance, clashes and tight turnarounds.
   * @param {Object} input {
   *   serials            serial-refs rows
   *   classes            equipment-classes rows ({ id, className })
   *   lines              workbench-lines rows (the bookings)
   *   masterById         { equipmentId: equipment-master row }
   *   locationsById      { locationId: { locationName, locationCode } }
   *   workOrdersByAsset  { maintenanceAssetNumber: [Fusion work orders] }
   *   requests           my-requests rows (party, origin, id)
   *   linesByRequest     requestData.indexLines(my-request-lines) (each line's status)
   * }
   * @param {string} today 'YYYY-MM-DD'
   */
  function build(input, today) {
    var inp = input || {};
    var t = d10(today) || todayKey();
    var classById = {};
    (inp.classes || []).forEach(function (c) { if (c && c.id != null) classById[String(c.id)] = c.className || ''; });
    var masters = inp.masterById || {};
    var locs = inp.locationsById || {};
    var reqByNumber = {};
    (inp.requests || []).forEach(function (r) { if (r && r.requestNumber) reqByNumber[up(r.requestNumber)] = r; });
    var lineIndex = inp.linesByRequest || {};

    // The view repeats a line: the first per eqrRequestLineId counts.
    var seenLine = {};
    var linesBySerial = {};
    var lineOrder = [];
    (inp.lines || []).forEach(function (l) {
      if (!l) return;
      var lid = l.eqrRequestLineId;
      if (lid !== undefined && lid !== null) {
        if (seenLine[lid]) return;
        seenLine[lid] = true;
      }
      var s = l.allocatedSerial;
      if (!s) return;
      if (!linesBySerial[s]) { linesBySerial[s] = []; lineOrder.push(s); }
      linesBySerial[s].push(l);
    });

    var units = [];
    var byId = {};
    function addUnit(u) {
      if (byId[u.id]) return null;
      byId[u.id] = u;
      units.push(u);
      return u;
    }

    (inp.serials || []).forEach(function (s) {
      if (!s || !s.serialNumber) return;
      var eqId = s.equipmentId != null ? String(s.equipmentId) : '';
      var m = eqId ? masters[eqId] || masters[Number(eqId)] : null;
      var clsId = s.equipmentClassId != null ? s.equipmentClassId : (m && m.equipmentClassId != null ? m.equipmentClassId : null);
      var firstLine = (linesBySerial[s.serialNumber] || [])[0];
      var cls = (clsId != null ? classById[String(clsId)] : '') || (m && m.className) || (firstLine && firstLine.className) || '';
      var locId = s.currentLocationId != null ? s.currentLocationId : (m && m.currentLocationId != null ? m.currentLocationId : null);
      var loc = locId != null ? locs[String(locId)] || locs[Number(locId)] : null;
      var code = (loc && loc.locationCode) || '';
      var lname = (loc && loc.locationName) || '';
      addUnit({
        id: String(s.serialNumber),
        serial: String(s.serialNumber),
        name: s.equipmentName || (m && m.equipmentName) || (firstLine && firstLine.equipmentName) || String(s.serialNumber),
        cls: cls || NO_CLASS,
        yardKey: code || lname || '',
        yard: yardLabel(code, lname),
        fa: s.faAssetRefId || (m && m.faAssetRefId) || '',
        manufacturer: s.manufacturer || (m && m.manufacturer) || '',
        asset: s.maintenanceAssetNumber || '',
        known: true
      });
    });
    // An allocated serial the unit list does not have still gets a row, so no booking goes missing.
    lineOrder.forEach(function (s) {
      if (byId[String(s)]) return;
      var l = linesBySerial[s][0];
      addUnit({ id: String(s), serial: String(s), name: l.equipmentName || String(s), cls: l.className || NO_CLASS, yardKey: '', yard: NO_YARD,
        fa: '', manufacturer: '', asset: '', known: false });
    });

    var bookings = [];
    var seq = 0;
    units.forEach(function (u) {
      (linesBySerial[u.serial] || []).forEach(function (l) {
        var s10 = d10(pick(l, ['requestedStartDate', 'startDate']));
        if (!s10) return;
        var e10 = d10(pick(l, ['requestedEndDate', 'endDate']));
        var end = addDays(s10, spanDays(s10, e10) - 1);
        var alloc = up(pick(l, ['allocStatus', 'allocationStatus']));
        var reserve = reserveOf(alloc);
        var req = reqByNumber[up(l.requestNumber)] || null;
        var external = rules.isExternalSource(pick(l, ['requestOrigin']) || (req && req.requestOrigin));
        var mine = findLine(lineIndex[l.requestNumber] || lineIndex[up(l.requestNumber)], l.lineNumber, u.serial);
        var lineStatus = up(pick(l, ['lineStatus']) || (mine && mine.lineStatus));
        var requestStatus = up(pick(l, ['requestStatus']) || (req && (req.status || req.requestStatus)));
        var st = stageOf(lineStatus, alloc, requestStatus, external, reserve);
        var reqId = pick(l, ['eqrEquipmentRequestId']) != null ? Number(l.eqrEquipmentRequestId)
          : (req && req.eqrEquipmentRequestId != null ? Number(req.eqrEquipmentRequestId) : null);
        seq += 1;
        bookings.push({
          id: 'b' + seq, n: seq, unitId: u.id, kind: 'booking', start: s10, end: end, days: diff(end, s10) + 1,
          requestId: reqId, requestNumber: l.requestNumber || '', lineNumber: l.lineNumber != null ? l.lineNumber : null,
          lineId: l.eqrRequestLineId != null ? l.eqrRequestLineId : null,
          party: l.projectName || (req && (req.projectName || req.customerName || req.projectInternalCustomer)) || l.customerName || '',
          task: l.taskName || '', requestor: l.requestorName || (req && req.requestorName) || '', location: l.deploymentLocation || '',
          external: external, alloc: alloc, reserve: reserve, lineStatus: lineStatus, requestStatus: requestStatus,
          stage: st.stage, stageLabel: st.label,
          // New's rule (a cancelled or rejected allocation holds nothing), and a line back at the yard or stopped.
          holds: reserve !== 'cancelled' && st.stage !== 'stopped' && st.stage !== 'done',
          clash: false, tight: false
        });
      });
      var wos = (inp.workOrdersByAsset && u.asset) ? (inp.workOrdersByAsset[u.asset] || []) : [];
      wos.forEach(function (w) {
        var ws = d10(w && w.PlannedStartDate);
        if (!ws) return;
        var we = d10(w.PlannedCompletionDate);
        var wend = addDays(ws, spanDays(ws, we) - 1);
        seq += 1;
        bookings.push({
          id: 'm' + seq, n: seq, unitId: u.id, kind: 'maintenance', start: ws, end: wend, days: diff(wend, ws) + 1,
          wo: w.WorkOrderNumber || '', woType: w.WorkOrderType || '', woDesc: w.WorkOrderDescription || '', woStatus: w.WorkOrderStatus || '',
          stage: 'maint', stageLabel: 'Planned maintenance', reserve: '', holds: true, clash: false, tight: false
        });
      });
    });

    var byUnit = {};
    bookings.forEach(function (b) { (byUnit[b.unitId] = byUnit[b.unitId] || []).push(b); });
    Object.keys(byUnit).forEach(function (k) { byUnit[k].sort(function (a, b) { return cmp(a.start, b.start) || a.n - b.n; }); });

    var clashes = findClashes(bookings, t);
    var tight = findTight(bookings, t);
    var bById = {};
    bookings.forEach(function (b) { bById[b.id] = b; });
    clashes.forEach(function (c) { bById[c.a].clash = true; bById[c.b].clash = true; });
    tight.forEach(function (c) { bById[c.a].tight = true; bById[c.b].tight = true; });
    // Indexes, so a row or a bar finds its own clashes and turnarounds without scanning every one.
    var clashesByUnit = {};
    var tightByUnit = {};
    var marksOf = {};
    clashes.forEach(function (c) {
      (clashesByUnit[c.unitId] = clashesByUnit[c.unitId] || []).push(c);
      (marksOf[c.a] = marksOf[c.a] || []).push(c);
      (marksOf[c.b] = marksOf[c.b] || []).push(c);
    });
    tight.forEach(function (c) {
      (tightByUnit[c.unitId] = tightByUnit[c.unitId] || []).push(c);
      (marksOf[c.a] = marksOf[c.a] || []).push(c);
      (marksOf[c.b] = marksOf[c.b] || []).push(c);
    });
    units.forEach(function (u) {
      u.clashes = (clashesByUnit[u.id] || []).length;
      u.tight = (tightByUnit[u.id] || []).length;
      u.now = nowOf(byUnit[u.id] || [], t);
      var words = [u.serial, u.name, u.cls, u.yard, u.fa, u.manufacturer];
      (byUnit[u.id] || []).forEach(function (b) { words.push(b.requestNumber, b.party, b.task, b.requestor, b.location, b.wo); });
      u.hay = words.filter(Boolean).join(' ').toLowerCase();
    });

    return { units: units, bookings: bookings, byUnit: byUnit, byId: bById, clashes: clashes, tight: tight,
      clashesByUnit: clashesByUnit, tightByUnit: tightByUnit, marksOf: marksOf, today: t,
      maintenance: bookings.some(function (b) { return b.kind === 'maintenance'; }) };
  }

  /** Do two bars share at least one day? (Both ends count.) */
  function overlaps(a, b) {
    return !!(a && b && a.start && b.start && a.start <= b.end && b.start <= a.end);
  }

  /**
   * Two holds on one unit at once (New's findConflicts): bookings that hold the unit and planned maintenance; two
   * work orders together are not a clash; only clashes whose shared days end today or later count.
   * @returns [{ id, unitId, a, b, type: 'double' | 'maintenance', from, to, days }] earliest first
   */
  function findClashes(bookings, since) {
    var byRes = {};
    (bookings || []).forEach(function (e) {
      if (!e || !e.start || !e.end || !e.holds) return;
      (byRes[e.unitId] = byRes[e.unitId] || []).push(e);
    });
    var out = [];
    Object.keys(byRes).forEach(function (rid) {
      var list = byRes[rid].sort(function (x, y) { return cmp(x.start, y.start) || x.n - y.n; });
      for (var i = 0; i < list.length; i++) {
        for (var j = i + 1; j < list.length && list[j].start <= list[i].end; j++) {
          var a = list[i];
          var b = list[j];
          if (a.kind === 'maintenance' && b.kind === 'maintenance') continue;
          var from = b.start;
          var to = a.end < b.end ? a.end : b.end;
          if (since && to < since) continue;
          out.push({ id: a.id + '-' + b.id, unitId: rid, a: a.id, b: b.id,
            type: a.kind === 'maintenance' || b.kind === 'maintenance' ? 'maintenance' : 'double', from: from, to: to, days: diff(to, from) + 1 });
        }
      }
    });
    return out.sort(function (x, y) { return cmp(x.from, y.from) || cmp(x.id, y.id); });
  }

  /**
   * Back and out again within TIGHT days: for each booking that holds a unit, the booking before it on that unit
   * (the latest to end before it starts). Only turnarounds still ahead (the next one starts today or later).
   * @returns [{ id, unitId, a (back), b (out), back, out, gap }] earliest first
   */
  function findTight(bookings, since) {
    var byRes = {};
    (bookings || []).forEach(function (e) {
      if (!e || e.kind !== 'booking' || !e.holds) return;
      (byRes[e.unitId] = byRes[e.unitId] || []).push(e);
    });
    var out = [];
    Object.keys(byRes).forEach(function (rid) {
      var list = byRes[rid];
      list.forEach(function (b) {
        if (since && b.start < since) return;
        var prev = null;
        list.forEach(function (a) {
          if (a === b || a.end >= b.start) return;
          if (!prev || a.end > prev.end) prev = a;
        });
        if (!prev) return;
        var gap = diff(b.start, prev.end);
        if (gap >= 1 && gap <= TIGHT) {
          out.push({ id: prev.id + '>' + b.id, unitId: rid, a: prev.id, b: b.id, back: prev.end, out: b.start, gap: gap });
        }
      });
    });
    return out.sort(function (x, y) { return cmp(x.out, y.out) || cmp(x.id, y.id); });
  }

  /** What the unit is doing today, in words. { state: out | maint | free, text }. */
  function nowOf(list, t) {
    var hold = list.filter(function (b) { return b.holds && b.start <= t && b.end >= t; });
    var job = hold.filter(function (b) { return b.kind === 'booking'; })[0];
    var wo = hold.filter(function (b) { return b.kind === 'maintenance'; })[0];
    if (job) return { state: 'out', text: job.stageLabel + (job.party ? ' · ' + job.party : '') + ' · until ' + fmtDay(job.end) };
    if (wo) return { state: 'maint', text: 'In maintenance until ' + fmtDay(wo.end) + (wo.wo ? ' (' + wo.wo + ')' : '') };
    var next = list.filter(function (b) { return b.holds && b.start > t; })[0];
    return { state: 'free', text: next ? 'Free now · next ' + (next.kind === 'maintenance' ? 'maintenance' : next.requestNumber) + ' on ' + fmtDay(next.start)
      : 'Free now · nothing booked ahead' };
  }

  /**
   * The unit in a window: booked (a booking holds it), maint (planned maintenance), tight (free, but back from or out
   * to another job within TIGHT days of the window) or free. { state, label, why }.
   */
  function windowState(list, from, to) {
    var holds = (list || []).filter(function (b) { return b.holds; });
    var inWin = holds.filter(function (b) { return b.start <= to && b.end >= from; });
    var jobs = inWin.filter(function (b) { return b.kind === 'booking'; });
    var wos = inWin.filter(function (b) { return b.kind === 'maintenance'; });
    var res;
    if (jobs.length) {
      res = { state: 'booked', why: jobs[0].requestNumber + (jobs[0].party ? ' · ' + jobs[0].party : '') + ' · ' + range(jobs[0].start, jobs[0].end)
        + (jobs.length > 1 ? ' (+' + (jobs.length - 1) + ' more)' : '') };
    } else if (wos.length) {
      res = { state: 'maint', why: 'Maintenance' + (wos[0].wo ? ' ' + wos[0].wo : '') + ' · ' + range(wos[0].start, wos[0].end) };
    } else {
      var jobsOnly = holds.filter(function (b) { return b.kind === 'booking'; });
      var before = null;
      var after = null;
      jobsOnly.forEach(function (b) {
        if (b.end < from && (!before || b.end > before.end)) before = b;
        if (b.start > to && (!after || b.start < after.start)) after = b;
      });
      var tightBefore = before && diff(from, before.end) <= TIGHT;
      var tightAfter = after && diff(after.start, to) <= TIGHT;
      var nextHold = holds.filter(function (b) { return b.start > to; })[0];
      if (tightBefore || tightAfter) {
        res = { state: 'tight', why: [tightBefore ? 'Back from ' + before.requestNumber + ' on ' + fmtDay(before.end) : '',
          tightAfter ? 'Out to ' + after.requestNumber + ' on ' + fmtDay(after.start) : ''].filter(Boolean).join(' · ') };
      } else {
        res = { state: 'free', why: nextHold ? 'Free until ' + fmtDay(addDays(nextHold.start, -1)) : 'Free, nothing booked after' };
      }
    }
    res.label = STATES[res.state].label;
    return res;
  }

  /** The window as the person set it: a valid from, and a to on or after it. */
  function windowOf(from, to, today) {
    var t = d10(today) || todayKey();
    var f = d10(from) || t;
    var e = d10(to) || addDays(f, 13);
    if (e < f) e = f;
    return { from: f, to: e, days: diff(e, f) + 1, text: range(f, e) + ' · ' + plural(diff(e, f) + 1, 'day') };
  }

  function sameText(u, words) {
    return words.every(function (w) { return u.hay.indexOf(w) !== -1; });
  }

  function groupOf(u, groupBy) {
    return groupBy === 'yard' ? { key: 'y:' + (u.yardKey || ''), label: u.yard || NO_YARD, last: !u.yardKey }
      : { key: 'c:' + u.cls, label: u.cls, last: u.cls === NO_CLASS };
  }

  /** Free capacity per class in the window, over the given units. Sorted by class name, "No class" last. */
  function capacity(model, unitIds, win, stateOf) {
    var units = {};
    (model.units || []).forEach(function (u) { units[u.id] = u; });
    var groups = {};
    var total = { key: '', label: 'All classes', total: 0, free: 0, tight: 0, booked: 0, maint: 0 };
    (unitIds || []).forEach(function (id) {
      var u = units[id];
      if (!u) return;
      var g = groups[u.cls] = groups[u.cls] || { key: u.cls, label: u.cls, total: 0, free: 0, tight: 0, booked: 0, maint: 0 };
      var s = (stateOf ? stateOf(id) : windowState(model.byUnit[id], win.from, win.to)).state;
      g.total += 1; g[s] += 1;
      total.total += 1; total[s] += 1;
    });
    var list = Object.keys(groups).map(function (k) { return groups[k]; })
      .sort(function (a, b) { return Number(a.key === NO_CLASS) - Number(b.key === NO_CLASS) || cmp(lc(a.label), lc(b.label)); });
    return { classes: list.map(capRow), total: capRow(total) };
  }

  function capRow(g) {
    var avail = g.free + g.tight;
    var pct = function (n) { return g.total ? Math.round((n / g.total) * 1000) / 10 + '%' : '0%'; };
    return Object.assign({}, g, {
      avail: avail,
      headline: avail + ' of ' + g.total + ' free',
      note: [g.tight ? g.tight + ' tight' : '', g.booked ? g.booked + ' booked' : '', g.maint ? g.maint + ' in maintenance' : ''].filter(Boolean).join(' · ')
        || (g.total ? 'All free' : ''),
      none: g.total > 0 && avail === 0,
      segs: [{ k: 'free', w: pct(g.free) }, { k: 'tight', w: pct(g.tight) }, { k: 'booked', w: pct(g.booked) }, { k: 'maint', w: pct(g.maint) }]
        .filter(function (s) { return s.w !== '0%'; })
    });
  }

  /** The visible days: Monday viewStart, zoom week (28 days) or month (91). */
  function viewRange(viewStart, zoom) {
    var z = ZOOMS[zoom] || ZOOMS.week;
    var vs = mondayOf(d10(viewStart) || todayKey());
    var ve = addDays(vs, z.days - 1);
    return { start: vs, end: ve, days: z.days, zoom: ZOOMS[zoom] ? zoom : 'week', label: range(vs, ve) };
  }

  /** Where the view starts to show a window: a few days before it; month zoom when it is longer than three weeks. */
  function fitView(win, zoom) {
    var z = win.days > 21 ? 'month' : (zoom || 'week');
    return { zoom: z, viewStart: mondayOf(addDays(win.from, z === 'week' ? -3 : -7)) };
  }

  function pct(n) { return Math.round(n * 1000) / 1000 + '%'; }

  /** A span's place on the view, clipped: { l, w, cutL, cutR } or null when outside it. */
  function place(start, end, vr) {
    if (end < vr.start || start > vr.end) return null;
    var s = start < vr.start ? vr.start : start;
    var e = end > vr.end ? vr.end : end;
    return { l: pct((diff(s, vr.start) / vr.days) * 100), w: pct(((diff(e, s) + 1) / vr.days) * 100), cutL: start < vr.start, cutR: end > vr.end };
  }

  /** The header: months, then days (week zoom) or weeks (month zoom); today's line; the window's band. */
  function head(vr, win, today) {
    var months = [];
    var d = vr.start;
    while (d <= vr.end) {
      var p = parts(d);
      var last = key(Math.round(Date.UTC(p.y, p.m + 1, 1) / DAY) - 1);
      var e = last > vr.end ? vr.end : last;
      var at = place(d, e, vr);
      var span = diff(e, d) + 1;
      months.push({ key: d.slice(0, 7), label: span >= (vr.zoom === 'week' ? 6 : 12) ? MONTH[p.m] + ' ' + p.y : (span >= 3 ? MON[p.m] : ''), l: at.l, w: at.w });
      d = addDays(last, 1);
    }
    var ticks = [];
    if (vr.zoom === 'week') {
      for (var i = 0; i < vr.days; i++) {
        var day = addDays(vr.start, i);
        var at2 = place(day, day, vr);
        ticks.push({ key: day, label: String(parts(day).d), wd: WD[i % 7], l: at2.l, w: at2.w, weekend: i % 7 >= 5, today: day === today, mon: i % 7 === 0,
          win: day >= win.from && day <= win.to });
      }
    } else {
      for (var w = 0; w < vr.days; w += 7) {
        var mon = addDays(vr.start, w);
        var at3 = place(mon, addDays(mon, 6), vr);
        ticks.push({ key: mon, label: fmtDay(mon), wd: '', l: at3.l, w: at3.w, weekend: false, today: today >= mon && today <= addDays(mon, 6), mon: true,
          win: mon <= win.to && addDays(mon, 6) >= win.from });
      }
    }
    var tAt = place(today, today, vr);
    var band = place(win.from, win.to, vr);
    return {
      months: months, ticks: ticks,
      today: tAt ? pct(((diff(today, vr.start) + 0.5) / vr.days) * 100) : '',
      band: band ? { l: band.l, w: band.w } : null,
      // Day lines and weekend shading (week zoom) or week lines (month zoom), repeated across the track.
      lines: vr.zoom === 'week' ? pct(100 / vr.days) + ' 100%, ' + pct(700 / vr.days) + ' 100%' : pct(700 / vr.days) + ' 100%'
    };
  }

  function barTitle(b, model) {
    var lines = [];
    if (b.kind === 'maintenance') {
      lines.push('Planned maintenance' + (b.wo ? ' · ' + b.wo : ''));
      if (b.woType || b.woDesc) lines.push([b.woType, b.woDesc].filter(Boolean).join(' · '));
      lines.push(range(b.start, b.end) + ' (' + plural(b.days, 'day') + ')');
      if (b.woStatus) lines.push('Work order status: ' + b.woStatus);
    } else {
      lines.push(b.requestNumber + (b.party ? ' · ' + b.party : ''));
      lines.push(range(b.start, b.end) + ' (' + plural(b.days, 'day') + ')');
      lines.push(b.stageLabel + ' · ' + (RESERVE_WORDS[b.reserve] || 'Booked'));
      if (b.task || b.requestor) lines.push([b.task, b.requestor ? 'requested by ' + b.requestor : ''].filter(Boolean).join(' · '));
      if (!b.holds) lines.push('Holds nothing now: the unit is free for other work');
    }
    ((model.marksOf || {})[b.id] || []).forEach(function (c) {
      if (c.back) { lines.push('Tight turnaround: back ' + fmtDay(c.back) + ', out again ' + fmtDay(c.out)); return; }
      var other = model.byId[c.a === b.id ? c.b : c.a];
      if (other) lines.push('Clashes with ' + (other.kind === 'maintenance' ? 'maintenance' + (other.wo ? ' ' + other.wo : '') : other.requestNumber) + ' on ' + range(c.from, c.to));
    });
    if (b.kind === 'booking') lines.push('Stored: allocation ' + (b.alloc || '—') + (b.lineStatus ? ', line ' + b.lineStatus : ''));
    return lines.join('\n');
  }

  function barLabel(b) {
    if (b.kind === 'maintenance') return 'Maintenance' + (b.wo ? ' · ' + b.wo : '');
    return [b.requestNumber, b.party].filter(Boolean).join(' · ');
  }

  function barClass(b) {
    if (b.kind === 'maintenance') return 'nx-av-bar nx-av-bar--maint' + (b.clash ? ' nx-av-bar--clash' : '');
    return 'nx-av-bar nx-stage--' + b.stage + ' nx-av-bar--' + (b.reserve === 'soft' ? 'soft' : 'hard') + (b.holds ? '' : ' nx-av-bar--past')
      + (b.clash ? ' nx-av-bar--clash' : '') + (b.tight && !b.clash ? ' nx-av-bar--tight' : '');
  }

  /** One unit's row: its bars in the view (stacked in lanes when they overlap) and the clash and turnaround marks. */
  function unitRow(model, u, vr, win, groupBy, state) {
    var list = (model.byUnit[u.id] || []).filter(function (b) { return b.kind === 'maintenance' || (b.reserve !== 'cancelled' && b.stage !== 'stopped'); });
    var lanesEnd = [];
    var bars = [];
    list.forEach(function (b) {
      var at = place(b.start, b.end, vr);
      if (!at) return;
      var lane = 0;
      while (lane < lanesEnd.length && lanesEnd[lane] >= b.start) lane++;
      lanesEnd[lane] = b.end;
      bars.push({ id: b.id, kind: b.kind, l: at.l, w: at.w, t: (6 + lane * 24) + 'px', cutL: at.cutL, cutR: at.cutR, cls: barClass(b) + (at.cutL ? ' nx-av-bar--cutl' : '') + (at.cutR ? ' nx-av-bar--cutr' : ''),
        label: barLabel(b), title: barTitle(b, model), open: b.kind === 'booking' && !!(b.requestId || b.requestNumber),
        requestId: b.requestId != null ? String(b.requestId) : '', requestNumber: b.requestNumber || '' });
    });
    var marks = [];
    ((model.clashesByUnit || {})[u.id] || []).forEach(function (c) {
      var at = place(c.from, c.to, vr);
      if (at) marks.push({ key: c.id, cls: 'nx-av-mark nx-av-mark--clash', l: at.l, w: at.w, title: 'Clash ' + range(c.from, c.to) });
    });
    ((model.tightByUnit || {})[u.id] || []).forEach(function (c) {
      var at = place(c.back, c.out, vr);
      if (at) marks.push({ key: c.id, cls: 'nx-av-mark nx-av-mark--tight', l: at.l, w: at.w, title: 'Tight turnaround: back ' + fmtDay(c.back) + ', out again ' + fmtDay(c.out) });
    });
    var ws = state || windowState(model.byUnit[u.id], win.from, win.to);
    var lanes = Math.max(1, lanesEnd.length);
    return {
      type: 'unit', key: u.id, unitId: u.id, name: u.name, serial: u.serial,
      sub: [u.serial, groupBy === 'yard' ? u.cls : u.yard].filter(Boolean).join(' · ') + (u.known ? '' : ' · not in the unit list'),
      now: u.now.text, nowState: u.now.state,
      state: ws.state, stateLabel: ws.label, why: ws.why, stateTitle: STATES[ws.state].hint + ': ' + ws.why,
      clashes: u.clashes, tight: u.tight, h: (lanes * 24 + 10) + 'px', bars: bars, marks: marks
    };
  }

  /** Units that pass the search, yard and class (the chip comes after: capacity and chips count before it). */
  function baseIds(model, o) {
    var words = lc(o.text).split(/\s+/).filter(Boolean);
    return (model.units || []).filter(function (u) {
      if (o.yard && u.yardKey !== (o.yard === '-' ? '' : o.yard)) return false;
      return !words.length || sameText(u, words);
    }).map(function (u) { return u.id; });
  }

  /** Does a unit (in this window state) belong to a chip? */
  function chipOf(u, s, chip) {
    if (!chip || chip === 'all') return true;
    if (chip === 'clash') return u.clashes > 0;
    if (chip === 'tight') return u.tight > 0;
    if (chip === 'free') return s === 'free' || s === 'tight';
    return s === chip;
  }

  /**
   * Everything the page shows, in one go (so a template never sees half of it).
   * @param {Object} o { from, to, text, cls, yard, chip, groupBy: class | yard, zoom: week | month, viewStart, collapsed: { groupKey: true }, more: { groupKey: extra rows } }
   */
  function view(model, o) {
    var m = model || { units: [], bookings: [], byUnit: {}, clashes: [], tight: [], today: todayKey() };
    var opts = o || {};
    var t = m.today;
    var win = windowOf(opts.from, opts.to, t);
    var vr = viewRange(opts.viewStart || mondayOf(addDays(t, -7)), opts.zoom);
    var unitsById = {};
    m.units.forEach(function (u) { unitsById[u.id] = u; });

    // Each unit's state in the window, worked out once for this view.
    var states = {};
    var stateOf = function (id) { return states[id] || (states[id] = windowState(m.byUnit[id], win.from, win.to)); };

    var base = baseIds(m, opts);
    var cap = capacity(m, base, win, stateOf);
    var inClass = base.filter(function (id) { return !opts.cls || unitsById[id].cls === opts.cls; });
    var chips = CHIPS.map(function (c) {
      return { key: c.key, label: c.label, count: inClass.filter(function (id) { return chipOf(unitsById[id], stateOf(id).state, c.key); }).length };
    }).filter(function (c) { return c.key === 'all' || c.key === 'free' || c.count > 0 || c.key === opts.chip; });
    var chip = opts.chip || 'all';
    var matched = inClass.filter(function (id) { return chipOf(unitsById[id], stateOf(id).state, chip); });

    // Groups (class or yard), "No class" / "No yard" last; units with clashes first, then by name and serial.
    var groupBy = opts.groupBy === 'yard' ? 'yard' : 'class';
    var groups = {};
    matched.forEach(function (id) {
      var u = unitsById[id];
      var g = groupOf(u, groupBy);
      (groups[g.key] = groups[g.key] || { key: g.key, label: g.label, last: g.last, ids: [] }).ids.push(id);
    });
    var glist = Object.keys(groups).map(function (k) { return groups[k]; })
      .sort(function (a, b) { return Number(a.last) - Number(b.last) || cmp(lc(a.label), lc(b.label)); });
    var ordered = [];
    glist.forEach(function (g) {
      g.ids.sort(function (x, y) {
        var a = unitsById[x];
        var b = unitsById[y];
        return Number(b.clashes > 0) - Number(a.clashes > 0) || cmp(lc(a.name), lc(b.name)) || cmp(a.serial, b.serial);
      });
      ordered = ordered.concat(g.ids);
    });

    // Every group heading shows; each group shows a page of its rows (more of them when there are few groups), and
    // "Show more" inside the group adds MORE_ROWS. So no class disappears behind a long one.
    var collapsed = opts.collapsed || {};
    var extra = opts.more || {};
    var perGroup = Math.max(MIN_ROWS, Math.floor(ROWS / Math.max(1, glist.length)));
    var items = [];
    var hidden = 0;
    glist.forEach(function (g) {
      var free = 0;
      var clashUnits = 0;
      g.ids.forEach(function (id) {
        var s = stateOf(id).state;
        if (s === 'free' || s === 'tight') free += 1;
        if (unitsById[id].clashes) clashUnits += 1;
      });
      var isCollapsed = !!collapsed[g.key];
      items.push({ type: 'group', key: 'g|' + g.key, group: g.key, label: g.label, collapsed: isCollapsed,
        count: g.ids.length, free: free, clashes: clashUnits,
        text: plural(g.ids.length, 'unit') + ' · ' + free + ' free ' + range(win.from, win.to) + (clashUnits ? ' · ' + plural(clashUnits, 'with a clash', 'with clashes') : '') });
      if (isCollapsed) return;
      var cap = perGroup + (Number(extra[g.key]) || 0);
      g.ids.slice(0, cap).forEach(function (id) { items.push(unitRow(m, unitsById[id], vr, win, groupBy, stateOf(id))); });
      var left = g.ids.length - Math.min(cap, g.ids.length);
      if (left > 0) {
        hidden += left;
        items.push({ type: 'more', key: 'm|' + g.key, group: g.key, left: left,
          text: 'Show ' + Math.min(MORE_ROWS, left) + ' more of ' + g.label + ' (' + left + ' not shown)' });
      }
    });

    // Clashes and tight turnarounds on the units in the search, yard and class.
    var inScope = {};
    inClass.forEach(function (id) { inScope[id] = true; });
    var bById = m.byId || {};
    var item = function (b) {
      return { id: b.id, kind: b.kind, open: b.kind === 'booking', requestId: b.requestId != null ? String(b.requestId) : '', requestNumber: b.requestNumber || '',
        label: b.kind === 'maintenance' ? 'Maintenance' + (b.wo ? ' ' + b.wo : '') : b.requestNumber, party: b.kind === 'maintenance' ? (b.woType || b.woDesc || '') : b.party,
        dates: range(b.start, b.end), stage: b.kind === 'maintenance' ? 'maint' : b.stage, stageLabel: b.stageLabel };
    };
    var clashesIn = m.clashes.filter(function (c) { return inScope[c.unitId]; });
    var tightIn = m.tight.filter(function (c) { return inScope[c.unitId]; });
    // Clashes first, then turnarounds; only the first PROBLEMS are listed (the Clashes and Tight chips show them all).
    var problems = clashesIn.slice(0, PROBLEMS).map(function (c) {
      var u = unitsById[c.unitId];
      return { key: c.id, type: c.type === 'maintenance' ? 'maint' : 'clash', title: c.type === 'maintenance' ? 'Booked during maintenance' : 'Double booking',
        unitId: u.id, unit: u.name, sub: [u.serial, u.cls, u.yard].filter(Boolean).join(' · '), from: c.from,
        when: range(c.from, c.to) + ' · ' + plural(c.days, 'day') + ' at once', items: [item(bById[c.a]), item(bById[c.b])] };
    }).concat(tightIn.slice(0, Math.max(0, PROBLEMS - clashesIn.length)).map(function (c) {
      var u = unitsById[c.unitId];
      return { key: c.id, type: 'tight', title: 'Tight turnaround', unitId: u.id, unit: u.name, sub: [u.serial, u.cls, u.yard].filter(Boolean).join(' · '), from: c.back,
        when: 'Back ' + fmtDay(c.back) + ', out again ' + fmtDay(c.out) + ' · ' + plural(c.gap, 'day') + ' to turn it round', items: [item(bById[c.a]), item(bById[c.b])] };
    }));
    var unlisted = clashesIn.length + tightIn.length - problems.length;

    var shownBookings = bookingsIn(m, matched, vr).length;
    var clsText = opts.cls ? ' ' + opts.cls : '';
    var capFor = opts.cls ? cap.classes.filter(function (c) { return c.key === opts.cls; })[0] || capRow({ key: opts.cls, label: opts.cls, total: 0, free: 0, tight: 0, booked: 0, maint: 0 }) : cap.total;
    return {
      win: win,
      range: vr,
      head: head(vr, win, t),
      capacity: cap.classes,
      capTotal: cap.total,
      answer: capFor.total ? capFor.avail + ' of ' + plural(capFor.total, 'unit') + clsText + ' free ' + range(win.from, win.to)
        + (capFor.tight ? ' (' + capFor.tight + ' with a tight turnaround)' : '') : 'No units match',
      chips: chips,
      matched: matched.length,
      ordered: ordered,
      items: items,
      more: hidden,
      problems: problems,
      clashCount: clashesIn.length,
      tightCount: tightIn.length,
      unlisted: unlisted,
      unlistedText: unlisted ? unlisted + ' more not listed here: the Clashes and Tight turnarounds chips show every unit with one.' : '',
      shownBookings: shownBookings,
      groupBy: groupBy,
      zoom: vr.zoom
    };
  }

  /** The bookings (and maintenance) of these units that fall in the view, by unit order then start. */
  function bookingsIn(model, unitIds, vr) {
    var out = [];
    (unitIds || []).forEach(function (id) {
      (model.byUnit[id] || []).forEach(function (b) {
        if (b.kind === 'booking' && (b.reserve === 'cancelled' || b.stage === 'stopped')) return;
        if (b.end < vr.start || b.start > vr.end) return;
        out.push(b);
      });
    });
    return out;
  }

  /** Export: the bookings shown, one row each, with the unit and what the page says about it. */
  function exportRows(model, unitIds, vr) {
    var units = {};
    model.units.forEach(function (u) { units[u.id] = u; });
    var bById = {};
    model.bookings.forEach(function (b) { bById[b.id] = b; });
    var clashText = {};
    model.clashes.forEach(function (c) {
      [[c.a, c.b], [c.b, c.a]].forEach(function (p) {
        var other = bById[p[1]];
        var t = (other.kind === 'maintenance' ? ('maintenance ' + (other.wo || '')).trim() : other.requestNumber) + ' (' + range(c.from, c.to) + ')';
        clashText[p[0]] = (clashText[p[0]] ? clashText[p[0]] + '; ' : '') + t;
      });
    });
    var tightText = {};
    model.tight.forEach(function (c) {
      var t = 'back ' + fmtDay(c.back, true) + ', out ' + fmtDay(c.out, true);
      tightText[c.a] = t;
      tightText[c.b] = t;
    });
    return bookingsIn(model, unitIds, vr).map(function (b) {
      var u = units[b.unitId] || {};
      return {
        unit: u.serial, equipment: u.name, cls: u.cls, yard: u.yard,
        what: b.kind === 'maintenance' ? 'Planned maintenance' : 'Booking',
        ref: b.kind === 'maintenance' ? b.wo : b.requestNumber,
        party: b.kind === 'maintenance' ? [b.woType, b.woDesc].filter(Boolean).join(' · ') : b.party,
        where: b.stageLabel, reserve: b.kind === 'maintenance' ? '' : (RESERVE_WORDS[b.reserve] || ''),
        start: b.start, end: b.end, days: b.days,
        clash: clashText[b.id] || '', tight: tightText[b.id] || '',
        alloc: b.alloc || '', line: b.lineStatus || '', woStatus: b.woStatus || ''
      };
    });
  }

  function exportColumns() {
    return [
      { key: 'unit', label: 'Unit (serial)' }, { key: 'equipment', label: 'Equipment' }, { key: 'cls', label: 'Class' }, { key: 'yard', label: 'Yard' },
      { key: 'what', label: 'What' }, { key: 'ref', label: 'Request or work order' }, { key: 'party', label: 'Project or customer' },
      { key: 'where', label: 'Where it is' }, { key: 'reserve', label: 'Reserve' }, { key: 'start', label: 'Start' }, { key: 'end', label: 'End' },
      { key: 'days', label: 'Days', type: 'number' }, { key: 'clash', label: 'Clashes with' }, { key: 'tight', label: 'Tight turnaround' },
      { key: 'alloc', label: 'Stored allocation status' }, { key: 'line', label: 'Stored line status' }, { key: 'woStatus', label: 'Work order status' }
    ];
  }

  /** The line under the title: "120 units in 8 classes · 64 bookings ahead · 2 clashes · 1 tight turnaround". */
  function summary(model) {
    var m = model || { units: [], bookings: [], clashes: [], tight: [], today: todayKey() };
    var classes = {};
    m.units.forEach(function (u) { classes[u.cls] = true; });
    var ahead = m.bookings.filter(function (b) { return b.kind === 'booking' && b.holds && b.end >= m.today; }).length;
    return plural(m.units.length, 'unit') + ' in ' + plural(Object.keys(classes).length, 'class', 'classes') + ' · '
      + plural(ahead, 'booking') + ' now or ahead · ' + (m.clashes.length ? plural(m.clashes.length, 'clash', 'clashes') : 'no clashes')
      + (m.tight.length ? ' · ' + plural(m.tight.length, 'tight turnaround') : '');
  }

  /** The yards to filter by: [{ key, label, count }], "No yard" last. */
  function yards(model) {
    var out = {};
    ((model && model.units) || []).forEach(function (u) {
      var k = u.yardKey || '-';
      (out[k] = out[k] || { key: k, label: u.yardKey ? u.yard : NO_YARD, count: 0 }).count += 1;
    });
    return Object.keys(out).map(function (k) { return out[k]; })
      .sort(function (a, b) { return Number(a.key === '-') - Number(b.key === '-') || cmp(lc(a.label), lc(b.label)); });
  }

  /** The legend: journey colours of the bookings in view, the reserve fills, maintenance, clash, turnaround, window, today. */
  function legend() {
    return [
      { key: 'ready', label: 'Getting ready', cls: 'nx-av-key nx-stage--ready' },
      { key: 'out', label: 'On the way', cls: 'nx-av-key nx-stage--out' },
      { key: 'onsite', label: 'On site', cls: 'nx-av-key nx-stage--onsite' },
      { key: 'back', label: 'Coming back', cls: 'nx-av-key nx-stage--back' },
      { key: 'done', label: 'Back at the yard', cls: 'nx-av-key nx-stage--done nx-av-key--past' },
      { key: 'soft', label: 'Light: held, not confirmed', cls: 'nx-av-key nx-stage--ready nx-av-key--soft' },
      { key: 'maint', label: 'Planned maintenance', cls: 'nx-av-key nx-av-key--maint' },
      { key: 'clash', label: 'Clash', cls: 'nx-av-key nx-av-key--clash' },
      { key: 'tight', label: 'Tight turnaround', cls: 'nx-av-key nx-av-key--tight' },
      { key: 'window', label: 'Your window', cls: 'nx-av-key nx-av-key--window' },
      { key: 'today', label: 'Today', cls: 'nx-av-key nx-av-key--today' }
    ];
  }

  return {
    TIGHT: TIGHT, ROWS: ROWS, MIN_ROWS: MIN_ROWS, MORE_ROWS: MORE_ROWS, ZOOMS: ZOOMS, STATES: STATES, CHIPS: CHIPS, NO_CLASS: NO_CLASS, NO_YARD: NO_YARD,
    d10: d10, addDays: addDays, diff: diff, mondayOf: mondayOf, todayKey: todayKey, fmtDay: fmtDay, range: range, spanDays: spanDays,
    reserveOf: reserveOf, stageOf: stageOf, build: build, overlaps: overlaps, findClashes: findClashes, findTight: findTight,
    windowState: windowState, windowOf: windowOf, capacity: capacity, viewRange: viewRange, fitView: fitView, place: place, head: head,
    view: view, bookingsIn: bookingsIn, exportRows: exportRows, exportColumns: exportColumns, summary: summary, yards: yards, legend: legend,
    barLabel: barLabel, barTitle: barTitle
  };
});
