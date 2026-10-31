define(['resources/js/availability', 'resources/js/availabilityData', 'resources/js/requestProgress', 'resources/js/requestHistory'],
  function (av, avData, Progress, RH) {
  'use strict';

  // Everything about a piece of equipment (EquipRite Next, record equipment-360, flows/fleet equipment page): an
  // equipment item with all its units, or one unit. Where each unit is and what it is doing now, its availability
  // ahead (Availability's rules and colours: availability.js build, windowState, head, place, barLabel, barTitle), and
  // its full history, newest first. Reads only; nothing here writes.
  //
  // What is read, filtered to this equipment wherever the endpoint allows it (services/eqp-v1/openapi3.json):
  //   the item          equipment-master/{id} (or, given only a name, equipment-master?q=name), equipment-classes/{id}
  //   its units         serial-refs?equipmentId, locations/{id} (each yard once)
  //   its bookings      views/equipment-history?equipmentMasterId | serialNumber   every request line it was on: dates,
  //                                                                                 allocation and line status, project
  //                     views/deployed-units?equipmentMasterId | serialNumber      each line's request (number and id),
  //                       (every line status, not only the returnable ones)        its origin and the unit's yard
  //                     views/line-detail-bookings?equipmentMasterId               the active bookings, with their request
  //   per request       request-status-history?requestId                           status changes (its lines, the request)
  //                     transfer-orders?equipmentRequestId, then                   out to site and back: raised, shipped,
  //                       transfer-order-lines?transferOrderId (which units)       received
  //                     transfer-history?equipmentRequestId                        moves between projects
  //   per request line  allocations?requestLineId                                  units assigned and released
  //                     inspections?requestLineId                                  inspections and their results
  //   the item / units  equipment-certifications?equipmentId, equipment-attachments (the master's and each unit's)
  //   Fusion            installed-base asset, then its maintenance work orders (availabilityData.workOrders)
  // A read that fails leaves its part out and is named on the page; a date is shown only when a record holds it.

  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // The window opens on the next four weeks (today and 27 days after it).
  var WINDOW_DAYS = 28;
  var PRESETS = [{ days: 7, label: 'Next 7 days' }, { days: 28, label: 'Next 4 weeks' }, { days: 91, label: 'Next 3 months' }];
  // The per-request and per-line reads cover the most recent bookings; older ones show their dates only.
  var MAX_REQUESTS = 40;
  var MAX_LINES = 80;
  var MAX_ORDERS = 60;
  var MAX_DOC_UNITS = 25;
  var POOL = 8;

  // deployed-units answers only DEPLOYED and RETURN_INITIATED unless asked: every status a unit can be on a line in.
  var LINE_STATUSES = ['IN_PROCESS', 'APPROVED', 'QUOTE_ACCEPTED', 'UNDER_PROCUREMENT', 'ALLOCATED', 'SCHEDULED_FOR_PICKING', 'PICK_INITIATED',
    'PICK_RELEASED', 'EQP_INSPECTION_COMPLETE', 'INSPECTION_FAILED', 'SHIP_TO_SITE', 'SHIPPED', 'DELIVERED', 'DEPLOYED', 'RETURN_INITIATED',
    'RETURN_IN_PROCESS', 'SHIPPED_TO_YARD', 'RETURNED', 'CLOSED', 'CONSUMED', 'REJECTED', 'CANCELLED'].join(',');

  var EP = {
    master: 'eqp-v1/getEquipriteV1EquipmentMasterById',
    masters: 'eqp-v1/getEquipriteV1EquipmentMaster',
    cls: 'eqp-v1/getEquipmentClassById',
    serials: 'eqp-v1/getSerialRefs',
    location: 'eqp-v1/getLocationById',
    history: 'eqp-v1/getEquipriteV1ViewsEquipmentHistory2',
    deployed: 'eqp-v1/searchDeployedUnits',
    bookings: 'eqp-v1/getEquipriteV1ViewsLineDetailBookings',
    status: 'eqp-v1/getRequestStatusHistory',
    orders: 'eqp-v1/getTransferOrders',
    orderLines: 'eqp-v1/getTransferOrderLines',
    moves: 'eqp-v1/getTransferHistory',
    allocations: 'eqp-v1/getAllocations',
    inspections: 'eqp-v1/getInspections',
    certs: 'eqp-v1/getEquipmentCertifications',
    docs: 'eqp-v1/listEquipmentAttachments'
  };

  // What the unit is doing today: its words and the pill's colour (the journey colours, maintenance as Availability).
  var NOW = {
    free: { label: 'Free', cls: 'nx-pill nx-e3-pill--free' },
    booked: { label: 'Booked', cls: 'nx-pill nx-stage--ready' },
    out: { label: 'On the way to site', cls: 'nx-pill nx-stage--out' },
    onsite: { label: 'On site', cls: 'nx-pill nx-stage--onsite' },
    back: { label: 'Coming back', cls: 'nx-pill nx-stage--back' },
    maint: { label: 'In maintenance', cls: 'nx-pill nx-av-pill--maint' }
  };
  var STAGE_RANK = { ready: 1, out: 2, onsite: 3, back: 4 };

  var KIND_LABEL = {
    booking: 'Booking', allocation: 'Unit assigned', status: 'Status', stopped: 'Status', transfer: 'Transfer', shipped: 'Transfer',
    received: 'Transfer', move: 'Between projects', inspection: 'Inspection', maint: 'Maintenance', cert: 'Certificate', doc: 'Document', record: 'Record'
  };

  // ── Small helpers ───────────────────────────────────────────────────────────────────────────────────────────────
  function up(v) { return String(v == null ? '' : v).trim().toUpperCase(); }
  function has(v) { return v !== undefined && v !== null && v !== ''; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function pick(r, names) {
    for (var i = 0; i < names.length; i++) {
      var v = r && r[names[i]];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return undefined;
  }
  function rowsOf(body) {
    if (Array.isArray(body)) return body;
    if (body && Array.isArray(body.data)) return body.data;
    if (body && Array.isArray(body.items)) return body.items;
    return [];
  }
  function words(code) {
    var s = up(code);
    return s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ') : '';
  }
  function uniq(list) {
    var seen = {};
    return (list || []).filter(function (x) { var k = String(x); if (!has(x) || seen[k]) return false; seen[k] = true; return true; });
  }
  var d10 = av.d10;

  /** "8 Oct 2026, 14:05" when the record holds a time (shown in local time), "8 Oct 2026" for a bare date; '' for none. */
  function whenText(raw) {
    var ms = RH.msOf(raw);
    if (ms == null) return '';
    var s = String(raw);
    var timed = /[T ]\d{2}:\d{2}/.test(s) && !/[T ]00:00(:00(\.0+)?)?(Z|[+-]00:?00)?$/.test(s);
    var d = new Date(ms);
    if (!timed) return d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear() + ', ' + hh + ':' + mm;
  }

  /** The page's inputs: a unit ({ serial } or { unit }) or an item ({ equipmentId, name }). */
  function target(p) {
    var o = p || {};
    var serial = String(o.serial || o.unit || '').trim();
    return { mode: serial ? 'unit' : 'item', serial: serial, equipmentId: has(o.equipmentId) ? String(o.equipmentId).trim() : '', name: String(o.name || '').trim() };
  }

  // ── Bookings: the request lines it was on, each with its request ────────────────────────────────────────────────

  /** Which request each line is on: deployed-units by line, line-detail-bookings by serial and start day. */
  function identity(deployed, ldb) {
    var byLine = {};
    var bySerialDay = {};
    (deployed || []).forEach(function (d) {
      if (!d || !has(d.requestLineId)) return;
      byLine[String(d.requestLineId)] = {
        requestId: has(d.requestId) ? Number(d.requestId) : null, requestNumber: d.requestNumber || '', requestOrigin: d.requestType || '',
        projectName: d.projectName || '', customerName: d.customerName || '', lineStatus: d.lineStatus || ''
      };
    });
    (ldb || []).forEach(function (b) {
      if (!b || !b.serialNumber) return;
      bySerialDay[up(b.serialNumber) + '|' + d10(b.bookingStartDate)] = {
        requestId: has(b.bookingRequestId) ? Number(b.bookingRequestId) : null, requestNumber: b.bookingRequestNumber || '', requestOrigin: b.source || '',
        projectName: b.projectName || '', taskName: b.taskName || '', requestor: b.requestor || '', location: b.location || b.shipToSiteName || '', alloc: b.allocStatus || ''
      };
    });
    return { byLine: byLine, bySerialDay: bySerialDay };
  }

  /**
   * The bookings as Availability reads them (workbench-lines' shape, so availability.build places them): the
   * equipment-history rows, then the deployed-units and line-detail-bookings rows it does not have (a source that
   * failed costs its own rows only). Given a serial, that unit's alone.
   */
  function bookings(o) {
    var idx = identity(o.deployed, o.ldb);
    var out = [];
    var seenLine = {};
    var seenDay = {};
    var only = up(o.serial);
    function mark(lid, serial, start) {
      if (lid) seenLine[lid] = true;
      if (serial && start) seenDay[up(serial) + '|' + start] = true;
    }
    (o.history || []).forEach(function (r) {
      if (!r) return;
      var lid = has(r.requestLineId) ? String(r.requestLineId) : '';
      if (lid && seenLine[lid]) return;
      var serial = r.serialNumber || '';
      var start = d10(r.startDate);
      var id = (lid && idx.byLine[lid]) || (serial && idx.bySerialDay[up(serial) + '|' + start]) || {};
      var day = (serial && idx.bySerialDay[up(serial) + '|' + start]) || {};
      out.push({
        eqrRequestLineId: lid ? Number(lid) : null, eqrEquipmentRequestId: has(id.requestId) ? id.requestId : (has(day.requestId) ? day.requestId : null),
        requestNumber: id.requestNumber || day.requestNumber || '', allocatedSerial: serial, allocStatus: r.allocationStatus || '', lineStatus: r.lineStatus || id.lineStatus || '',
        requestedStartDate: start, requestedEndDate: d10(r.endDate), projectName: r.projectName || id.projectName || day.projectName || '',
        customerName: r.customerName || id.customerName || '', taskName: day.taskName || '', requestorName: day.requestor || '', deploymentLocation: day.location || '',
        requestOrigin: id.requestOrigin || day.requestOrigin || '', equipmentName: r.equipmentName || '', projectNumber: r.projectNumber || '', source: 'history'
      });
      mark(lid, serial, start);
    });
    (o.deployed || []).forEach(function (d) {
      if (!d) return;
      var lid = has(d.requestLineId) ? String(d.requestLineId) : '';
      var serial = d.serialNumber || d.unitIdentifier || '';
      var start = d10(d.startDate);
      if ((lid && seenLine[lid]) || (!lid && serial && seenDay[up(serial) + '|' + start])) return;
      out.push({
        eqrRequestLineId: lid ? Number(lid) : null, eqrEquipmentRequestId: has(d.requestId) ? Number(d.requestId) : null, requestNumber: d.requestNumber || '',
        allocatedSerial: serial, allocStatus: '', lineStatus: d.lineStatus || '', requestedStartDate: start, requestedEndDate: d10(d.endDate),
        projectName: d.projectName || '', customerName: d.customerName || '', taskName: '', requestorName: '', deploymentLocation: '',
        requestOrigin: d.requestType || '', equipmentName: d.equipmentName || '', projectNumber: '', source: 'deployed'
      });
      mark(lid, serial, start);
    });
    (o.ldb || []).forEach(function (b) {
      if (!b || !b.serialNumber) return;
      var start = d10(b.bookingStartDate);
      if (seenDay[up(b.serialNumber) + '|' + start]) return;
      out.push({
        eqrRequestLineId: null, eqrEquipmentRequestId: has(b.bookingRequestId) ? Number(b.bookingRequestId) : null, requestNumber: b.bookingRequestNumber || '',
        allocatedSerial: b.serialNumber, allocStatus: b.allocStatus || 'ALLOCATED', lineStatus: '', requestedStartDate: start, requestedEndDate: d10(b.bookingEndDate),
        projectName: b.projectName || '', customerName: '', taskName: b.taskName || '', requestorName: b.requestor || '', deploymentLocation: b.location || b.shipToSiteName || '',
        requestOrigin: b.source || '', equipmentName: '', projectNumber: '', source: 'bookings'
      });
      mark('', b.serialNumber, start);
    });
    return only ? out.filter(function (l) { return up(l.allocatedSerial) === only; }) : out;
  }

  /** Availability's model of these units and bookings (availability.build), with Fusion's work orders when read. */
  function modelOf(core, workOrdersByAsset, today) {
    var c = core || {};
    var masterById = {};
    if (c.master && has(c.master.id)) masterById[String(c.master.id)] = c.master;
    var classes = c.master && has(c.master.equipmentClassId) && c.className ? [{ id: c.master.equipmentClassId, className: c.className }] : [];
    return av.build({ serials: c.serials || [], classes: classes, lines: c.lines || [], masterById: masterById, locationsById: c.locationsById || {},
      workOrdersByAsset: workOrdersByAsset || {}, requests: [], linesByRequest: {} }, today);
  }

  // ── Units: where each is, what it is doing now, what is next, free or not in the window ─────────────────────────

  function overdueDays(end, t) { return Math.max(0, av.diff(t, end)); }

  /** What the unit is doing today: { key: free | booked | out | onsite | back | maint, label, text, cls, requestId, requestNumber }. */
  function nowOf(list, t, yard) {
    var holds = (list || []).filter(function (b) { return b.holds; });
    // A job holds the unit today when it covers today, or when it has left the yard and is not back yet (late).
    var jobs = holds.filter(function (b) {
      return b.kind === 'booking' && b.start <= t && (b.end >= t || (STAGE_RANK[b.stage] || 0) >= 2);
    }).sort(function (a, b) { return (STAGE_RANK[b.stage] || 0) - (STAGE_RANK[a.stage] || 0) || (a.start < b.start ? 1 : (a.start > b.start ? -1 : 0)); });
    var wo = holds.filter(function (b) { return b.kind === 'maintenance' && b.start <= t && b.end >= t; })[0];
    var job = jobs[0];
    var out;
    if (job) {
      var key = { out: 'out', onsite: 'onsite', back: 'back' }[job.stage] || 'booked';
      var late = job.end < t ? overdueDays(job.end, t) : 0;
      var party = job.party ? ' · ' + job.party : '';
      var text;
      if (key === 'booked') text = (job.requestNumber || 'A request') + party + ' · ' + job.stageLabel;
      else if (late) text = (job.requestNumber || 'A request') + party + ' · due back ' + av.fmtDay(job.end) + ' (' + plural(late, 'day') + ' late)';
      else text = (job.requestNumber || 'A request') + party + ' · until ' + av.fmtDay(job.end);
      out = { key: key, text: text, late: late, requestId: job.requestId != null ? String(job.requestId) : '', requestNumber: job.requestNumber || '' };
    } else if (wo) {
      out = { key: 'maint', text: (wo.wo || 'Work order') + ' · until ' + av.fmtDay(wo.end), late: 0, requestId: '', requestNumber: '' };
    } else {
      out = { key: 'free', text: yard && yard !== av.NO_YARD ? 'At ' + yard : 'In the yard', late: 0, requestId: '', requestNumber: '' };
    }
    out.label = NOW[out.key].label;
    out.cls = NOW[out.key].cls;
    return out;
  }

  /** The next booking that holds the unit and starts after today, or null. */
  function nextOf(list, t) {
    var next = (list || []).filter(function (b) { return b.kind === 'booking' && b.holds && b.start > t; })
      .sort(function (a, b) { return a.start < b.start ? -1 : (a.start > b.start ? 1 : a.n - b.n); })[0];
    if (!next) return null;
    return { requestNumber: next.requestNumber || '', requestId: next.requestId != null ? String(next.requestId) : '', start: next.start,
      text: (next.requestNumber || 'A request') + ' · ' + av.range(next.start, next.end) + (next.party ? ' · ' + next.party : ''), stage: next.stage };
  }

  /** "from 4 Nov to 1 Dec", the years only when they differ from each other or from this year. */
  function spanText(a, b, t) {
    var year = a.slice(0, 4) !== b.slice(0, 4) || a.slice(0, 4) !== String(t || '').slice(0, 4);
    return a === b ? 'on ' + av.fmtDay(a, year) : 'from ' + av.fmtDay(a, year) + ' to ' + av.fmtDay(b, year);
  }

  /** One unit's row: serial, yard, now, next, its state in the window. `yards` names a yard when no location is held. */
  function unitRow(model, u, win, t, yards) {
    var list = model.byUnit[u.id] || [];
    var yard = u.yardKey ? u.yard : ((yards || {})[up(u.serial)] || u.yard);
    var ws = av.windowState(list, win.from, win.to);
    return {
      key: u.id, serial: u.serial, name: u.name, cls: u.cls, yard: yard, known: u.known,
      now: nowOf(list, t, yard), next: nextOf(list, t),
      win: { state: ws.state, label: ws.label, why: ws.why, title: av.STATES[ws.state].hint + ': ' + ws.why },
      clashes: u.clashes, tight: u.tight
    };
  }

  /** "3 of 5 free from 4 Nov to 1 Dec" (an item), "Free from …" / "Not free from …: why" (a unit). */
  function answer(rows, win, mode, t) {
    var span = spanText(win.from, win.to, t);
    var free = rows.filter(function (r) { return r.win.state === 'free' || r.win.state === 'tight'; }).length;
    var tight = rows.filter(function (r) { return r.win.state === 'tight'; }).length;
    if (!rows.length) return { text: 'No units of this equipment are recorded in EquipRite, so none can be booked ' + span, tone: 'none', free: 0, total: 0 };
    if (mode === 'unit') {
      var r = rows[0];
      if (r.win.state === 'free') return { text: 'Free ' + span, tone: 'free', free: 1, total: 1 };
      if (r.win.state === 'tight') return { text: 'Free ' + span + ', with a tight turnaround: ' + r.win.why, tone: 'tight', free: 1, total: 1 };
      return { text: 'Not free ' + span + ': ' + r.win.why, tone: 'none', free: 0, total: 1 };
    }
    return { text: free + ' of ' + rows.length + ' free ' + span + (tight ? ' (' + tight + ' with a tight turnaround)' : ''),
      tone: free ? (free === tight ? 'tight' : 'free') : 'none', free: free, total: rows.length };
  }

  // ── The compact timeline: the window's weeks, Monday to Sunday ─────────────────────────────────────────────────

  /** The weeks the window touches: day by day up to six weeks, week by week beyond (availability.head's zooms). */
  function rangeOf(win) {
    var start = av.mondayOf(win.from);
    var end = av.addDays(av.mondayOf(win.to), 6);
    var days = av.diff(end, start) + 1;
    return { start: start, end: end, days: days, zoom: days > 42 ? 'month' : 'week', label: av.range(start, end) };
  }

  /** A bar's classes: Availability's (journey colour; light when only held; faded when back; clash; tight). */
  function barClass(b) {
    if (b.kind === 'maintenance') return 'nx-av-bar nx-av-bar--maint' + (b.clash ? ' nx-av-bar--clash' : '');
    return 'nx-av-bar nx-stage--' + b.stage + ' nx-av-bar--' + (b.reserve === 'soft' ? 'soft' : 'hard') + (b.holds ? '' : ' nx-av-bar--past')
      + (b.clash ? ' nx-av-bar--clash' : '') + (b.tight && !b.clash ? ' nx-av-bar--tight' : '');
  }

  /** One unit on the timeline: its bars in view (stacked in lanes when they overlap) and its clash and turnaround marks. */
  function barRow(model, u, vr, row) {
    var list = (model.byUnit[u.id] || []).filter(function (b) { return b.kind === 'maintenance' || (b.reserve !== 'cancelled' && b.stage !== 'stopped'); });
    var lanesEnd = [];
    var bars = [];
    list.forEach(function (b) {
      var at = av.place(b.start, b.end, vr);
      if (!at) return;
      var lane = 0;
      while (lane < lanesEnd.length && lanesEnd[lane] >= b.start) lane++;
      lanesEnd[lane] = b.end;
      bars.push({ id: b.id, kind: b.kind, l: at.l, w: at.w, t: (5 + lane * 24) + 'px',
        cls: barClass(b) + (at.cutL ? ' nx-av-bar--cutl' : '') + (at.cutR ? ' nx-av-bar--cutr' : ''),
        label: av.barLabel(b), title: av.barTitle(b, model), open: b.kind === 'booking' && !!(b.requestId || b.requestNumber),
        requestId: b.requestId != null ? String(b.requestId) : '', requestNumber: b.requestNumber || '' });
    });
    var marks = [];
    ((model.clashesByUnit || {})[u.id] || []).forEach(function (c) {
      var at = av.place(c.from, c.to, vr);
      if (at) marks.push({ key: c.id, cls: 'nx-av-mark nx-av-mark--clash', l: at.l, w: at.w, title: 'Clash ' + av.range(c.from, c.to) });
    });
    ((model.tightByUnit || {})[u.id] || []).forEach(function (c) {
      var at = av.place(c.back, c.out, vr);
      if (at) marks.push({ key: c.id, cls: 'nx-av-mark nx-av-mark--tight', l: at.l, w: at.w, title: 'Tight turnaround: back ' + av.fmtDay(c.back) + ', out again ' + av.fmtDay(c.out) });
    });
    return { key: u.id, serial: u.serial, name: u.name, sub: row ? row.yard : u.yard, state: row ? row.win.state : '', stateLabel: row ? row.win.label : '',
      stateTitle: row ? row.win.title : '', h: (Math.max(1, lanesEnd.length) * 24 + 8) + 'px', bars: bars, marks: marks, count: bars.length };
  }

  /**
   * Everything the units and availability parts show, in one go (so a template never sees half of it).
   * @param {Object} o { from, to, mode: item | unit, yards: { SERIAL: yard name } }
   */
  function view(model, o) {
    var m = model || { units: [], byUnit: {}, today: av.todayKey() };
    var opts = o || {};
    var t = m.today;
    var win = av.windowOf(opts.from || t, opts.to || av.addDays(t, WINDOW_DAYS - 1), t);
    var units = (m.units || []).slice().sort(function (a, b) { return a.serial < b.serial ? -1 : (a.serial > b.serial ? 1 : 0); });
    var rows = units.map(function (u) { return unitRow(m, u, win, t, opts.yards); });
    var vr = rangeOf(win);
    var ans = answer(rows, win, opts.mode, t);
    var byKey = {};
    rows.forEach(function (r) { byKey[r.key] = r; });
    return {
      win: win, from: win.from, to: win.to, winText: win.text, answer: ans.text, tone: ans.tone, free: ans.free, total: ans.total,
      units: rows,
      range: vr,
      head: av.head(vr, win, t),
      rows: units.map(function (u) { return barRow(m, u, vr, byKey[u.id]); }),
      zoom: vr.zoom
    };
  }

  /** What the colours mean: Availability's legend. */
  function legend() { return av.legend(); }

  // ── The head: name, class, how many units and where; a picture ─────────────────────────────────────────────────

  function headOf(core, model, rows) {
    var c = core || {};
    var m = c.master || {};
    var first = (model && model.units && model.units[0]) || {};
    // The master's name, else the name it was opened with, else a unit's (never a serial standing in for a name).
    var unitName = first.name && up(first.name) !== up(first.serial) ? first.name : '';
    var name = m.equipmentName || c.name || unitName || (c.serial ? '' : 'Equipment');
    var cls = c.className || (first.cls && first.cls !== av.NO_CLASS ? first.cls : '');
    var facts = uniq([m.equipmentNumber, m.manufacturer, m.modelNumber, m.mfgYear != null ? String(m.mfgYear) : '', m.capacity, words(m.equipmentType)]);
    var image = m.equipmentImage || m.imageUrl || '';
    var list = rows || [];
    if (c.mode === 'unit') {
      var r = list[0] || null;
      var others = c.unitsAll || 0;
      return {
        mode: 'unit', kicker: 'Unit' + (cls ? ' · ' + cls : ''), title: c.serial, name: name || (r && r.name) || '', cls: cls,
        sub: [name || (r && r.name), cls].filter(Boolean).join(' · '),
        where: r ? (r.yard && r.yard !== av.NO_YARD ? 'Kept at ' + r.yard : 'No yard recorded') : '',
        now: r ? r.now : null, facts: facts, image: image, equipmentId: c.equipmentId || '',
        allText: others > 1 ? 'All ' + others + ' units of this equipment' : 'All units of this equipment',
        tabTitle: c.serial + (name && up(name) !== up(c.serial) ? ' · ' + name : '')
      };
    }
    var yards = {};
    var states = {};
    list.forEach(function (x) {
      yards[x.yard] = (yards[x.yard] || 0) + 1;
      states[x.now.key] = (states[x.now.key] || 0) + 1;
    });
    var where = Object.keys(yards).sort(function (a, b) {
      return Number(a === av.NO_YARD) - Number(b === av.NO_YARD) || yards[b] - yards[a] || (a < b ? -1 : 1);
    }).map(function (y) { return yards[y] + (y === av.NO_YARD ? ' with no yard recorded' : ' at ' + y); });
    var nowText = ['free', 'booked', 'out', 'onsite', 'back', 'maint'].filter(function (k) { return states[k]; })
      .map(function (k) { return states[k] + ' ' + { free: 'free', booked: 'booked', out: 'on the way to site', onsite: 'on site', back: 'coming back', maint: 'in maintenance' }[k]; })
      .join(' · ');
    return {
      mode: 'item', kicker: 'Equipment' + (cls ? ' · ' + cls : ''), title: name, name: name, cls: cls,
      sub: plural(list.length, 'unit') + (where.length ? ': ' + where.join(', ') : ''),
      where: list.length ? 'Now: ' + nowText : '', now: null, facts: facts, image: image, equipmentId: c.equipmentId || '', allText: '',
      tabTitle: name
    };
  }

  // ── History: everything that happened, newest first ────────────────────────────────────────────────────────────

  var seq = 0;
  /** An entry: when (only from a date a record holds), what, who, which units, and the record it opens. */
  function entry(o) {
    var ms = RH.msOf(o.at);
    seq += 1;
    var when = whenText(o.at);
    var e = {
      id: 'h' + seq, n: seq, at: o.at || '', ms: ms, when: when, kind: o.kind, kindLabel: o.kindLabel || KIND_LABEL[o.kind] || '', stage: o.stage || 'draft',
      title: o.title, text: o.text || '', who: o.who || '', recorded: o.recorded !== false, units: uniq(o.units || []),
      rec: (o.open && o.open.record) || '', recId: o.open && has(o.open.id) ? String(o.open.id) : '', recNumber: (o.open && o.open.number) || '',
      recSource: (o.open && o.open.source) || '', ref: o.ref || '', ahead: false
    };
    e.unitText = e.units.join(', ');
    e.meta = [when ? (o.whenWord ? o.whenWord + ' ' + when : when) : 'Date not recorded', e.who, e.recorded ? '' : (o.dated || 'from its dates')]
      .filter(Boolean).join(' · ');
    e.open = !!e.rec && (!!e.recId || !!e.recNumber);
    return e;
  }

  /** request lines and requests of these bookings: { lines: { id: info }, requests: { id: info }, serialSet }. */
  function indexCore(core) {
    var lines = {};
    var requests = {};
    (core.lines || []).forEach(function (l) {
      var info = { lineId: l.eqrRequestLineId, serial: l.allocatedSerial || '', requestId: l.eqrEquipmentRequestId, number: l.requestNumber || '',
        party: l.projectName || l.customerName || '', start: l.requestedStartDate || '', external: up(l.requestOrigin) === 'EXTERNAL' || up(l.requestOrigin) === 'CUSTOMER' };
      if (has(l.eqrRequestLineId)) lines[String(l.eqrRequestLineId)] = info;
      if (has(l.eqrEquipmentRequestId)) {
        var r = requests[String(l.eqrEquipmentRequestId)] = requests[String(l.eqrEquipmentRequestId)]
          || { requestId: l.eqrEquipmentRequestId, number: l.requestNumber || '', units: [], lineIds: [], start: '', external: info.external, party: info.party };
        if (!r.number && l.requestNumber) r.number = l.requestNumber;
        if (info.serial) r.units = uniq(r.units.concat([info.serial]));
        if (has(l.eqrRequestLineId)) r.lineIds.push(String(l.eqrRequestLineId));
        if (info.start > r.start) r.start = info.start;
      }
    });
    var serialSet = {};
    (core.serials || []).forEach(function (s) { if (s && s.serialNumber) serialSet[up(s.serialNumber)] = s.serialNumber; });
    (core.lines || []).forEach(function (l) { if (l.allocatedSerial) serialSet[up(l.allocatedSerial)] = l.allocatedSerial; });
    if (core.serial) serialSet[up(core.serial)] = core.serial;
    var serialById = {};
    (core.serials || []).forEach(function (s) { if (s && has(s.id) && s.serialNumber) serialById[String(s.id)] = s.serialNumber; });
    return { lines: lines, requests: requests, serialSet: serialSet, serialById: serialById };
  }

  function requestOpen(number, id) { return number || has(id) ? { record: 'request', id: id, number: number || '' } : null; }
  function reqName(number, id) { return number || (has(id) ? 'request ' + id : 'a request'); }

  /** Each booking: the request, its project or customer, its dates and where that piece is on its journey. */
  function fromBookings(lines, mode) {
    return (lines || []).map(function (l) {
      var alloc = up(l.allocStatus);
      var reserve = av.reserveOf(alloc);
      var external = up(l.requestOrigin) === 'EXTERNAL' || up(l.requestOrigin) === 'CUSTOMER';
      var st = av.stageOf(l.lineStatus, alloc, '', external, reserve);
      var party = l.projectName || l.customerName || '';
      var name = reqName(l.requestNumber, l.eqrEquipmentRequestId);
      var title;
      if (!l.allocatedSerial) title = 'Asked for on ' + name;
      else if (reserve === 'cancelled' || st.stage === 'stopped') title = 'Booking ' + (st.stage === 'stopped' ? st.label.toLowerCase() : 'cancelled') + ': ' + name;
      else title = 'Booked on ' + name;
      var dates = l.requestedStartDate ? av.range(l.requestedStartDate, l.requestedEndDate || l.requestedStartDate) : 'no dates recorded';
      var noUnit = !l.allocatedSerial && !/no unit/i.test(st.label);
      var held = !!l.allocatedSerial && reserve === 'soft' && !/held/i.test(st.label);
      return entry({
        at: l.requestedStartDate, kind: 'booking', stage: reserve === 'cancelled' ? 'stopped' : st.stage, recorded: false, dated: 'from its dates',
        title: title + (party ? ' · ' + party : ''),
        text: [dates, st.label, held ? 'held, not confirmed' : '', noUnit ? 'no unit assigned yet' : ''].filter(Boolean).join(' · '),
        who: l.requestorName || '', units: l.allocatedSerial ? [l.allocatedSerial] : [], open: requestOpen(l.requestNumber, l.eqrEquipmentRequestId),
        ref: l.requestNumber || ''
      });
    });
  }

  /** allocations rows -> a unit assigned (allocatedDate) and released (releasedDate). */
  function fromAllocations(rows, line, serialById) {
    var out = [];
    rowsOf(rows).forEach(function (a) {
      if (!a) return;
      var serial = (has(a.serialRefId) && serialById[String(a.serialRefId)]) || line.serial || '';
      var status = up(a.allocationStatus);
      var name = reqName(line.number, line.requestId);
      var open = requestOpen(line.number, line.requestId);
      var bits = [status ? words(status) : '', has(a.allocatedQty) && Number(a.allocatedQty) > 1 ? plural(Number(a.allocatedQty), 'piece') : '', a.notes ? '“' + a.notes + '”' : ''];
      var at = a.allocatedDate || a.createdDate;
      if (at || !a.releasedDate) {
        out.push(entry({ at: at, kind: 'allocation', stage: status === 'CANCELLED' || status === 'REJECTED' ? 'stopped' : 'ready',
          title: (status === 'PENDING' || status === 'IN_PROCESS' ? 'Unit held for ' : 'Unit assigned to ') + name + (line.party ? ' · ' + line.party : ''),
          text: bits.filter(Boolean).join(' · '), units: serial ? [serial] : [], open: open, ref: line.number || '' }));
      }
      if (a.releasedDate) {
        out.push(entry({ at: a.releasedDate, kind: 'allocation', kindLabel: 'Unit released', stage: 'done', title: 'Unit released from ' + name,
          text: a.notes ? '“' + a.notes + '”' : '', units: serial ? [serial] : [], open: open, ref: line.number || '' }));
      }
    });
    return out;
  }

  /** request-status-history rows: the changes to this equipment's lines, and to the request itself (no line named). */
  function fromStatusRows(rows, req, idx) {
    var mine = {};
    var whole = [];
    rowsOf(rows).forEach(function (r) {
      var lid = pick(r, ['lineId', 'requestLineId', 'eqrRequestLineId', 'eqrEquipmentRequestLineId']);
      if (!has(lid)) { whole.push(r); return; }
      if (!idx.lines[String(lid)]) return;
      (mine[String(lid)] = mine[String(lid)] || []).push(r);
    });
    var out = [];
    var name = reqName(req.number, req.requestId);
    var open = requestOpen(req.number, req.requestId);
    function add(list, units, scope) {
      RH.fromStatusHistory(list, req.external).forEach(function (e) {
        out.push(entry({ at: e.at, kind: e.kind === 'stopped' ? 'stopped' : 'status', stage: e.stage || 'draft', title: e.title + ' · ' + name,
          text: [scope, e.text].filter(Boolean).join(' · '), who: e.who, units: units, open: open, ref: req.number || '' }));
      });
    }
    Object.keys(mine).forEach(function (lid) { var info = idx.lines[lid]; add(mine[lid], info.serial ? [info.serial] : [], ''); });
    if (whole.length) add(whole, req.units, 'the request');
    return out;
  }

  /** Is a transfer-order line about one of these units (its serial, or one of its request lines)? */
  function lineIsOurs(l, idx) {
    if (!l) return false;
    if (l.serialNumber && idx.serialSet[up(l.serialNumber)]) return true;
    if (has(l.serialRefId) && idx.serialById[String(l.serialRefId)]) return true;
    return has(l.requestLineId) && !!idx.lines[String(l.requestLineId)] && !!idx.lines[String(l.requestLineId)].serial;
  }

  /**
   * transfer-orders rows (out to site, back to the yard) -> raised, shipped, received (requestHistory's words), for
   * the orders that carry one of these units. Without its lines an order is kept, and says its units were not read.
   */
  function fromOrders(orders, linesByOrder, req, idx) {
    var out = [];
    rowsOf(orders).forEach(function (o) {
      if (!o || up(o.orderType) === 'INTER_PROJECT') return;
      var lines = has(o.id) ? linesByOrder[String(o.id)] : undefined;
      var units;
      var unread = !Array.isArray(lines);
      if (!unread) {
        var ours = lines.filter(function (l) { return lineIsOurs(l, idx); });
        if (!ours.length) return;
        units = uniq(ours.map(function (l) {
          return (l.serialNumber && idx.serialSet[up(l.serialNumber)]) || (has(l.serialRefId) && idx.serialById[String(l.serialRefId)])
            || (has(l.requestLineId) && idx.lines[String(l.requestLineId)] && idx.lines[String(l.requestLineId)].serial) || '';
        }));
      } else {
        units = req.units.slice();
      }
      var open = has(o.id) || o.orderNumber ? { record: 'transfer', id: o.id, number: o.orderNumber || '' } : requestOpen(req.number, req.requestId);
      RH.fromTransferOrders([o]).forEach(function (e) {
        out.push(entry({ at: e.at, kind: e.kind, stage: e.stage, title: e.title,
          text: [e.text, 'for ' + reqName(req.number, req.requestId), unread ? 'its units could not be read: it may carry other equipment of the request' : ''].filter(Boolean).join(' · '),
          units: units, open: open, ref: o.orderNumber || '' }));
      });
    });
    return out;
  }

  /** transfer-history rows -> moves between projects, for these units (by serial, or by request line). */
  function fromMoves(rows, idx, seen) {
    var out = [];
    rowsOf(rows).forEach(function (h) {
      if (!h) return;
      var key = has(h.id) ? 'id:' + h.id : JSON.stringify(h);
      if (seen[key]) return;
      var serial = (h.serialNumber && idx.serialSet[up(h.serialNumber)]) || '';
      if (!serial) {
        var lid = pick(h, ['requestLineId', 'sourceRequestLineId', 'destinationRequestLineId']);
        var info = has(lid) ? idx.lines[String(lid)] : null;
        serial = info && info.serial ? info.serial : '';
      }
      if (!serial) return;
      seen[key] = true;
      var from = [h.sourceRequestNumber || (has(h.sourceRequestId) ? 'request ' + h.sourceRequestId : ''), h.sourceProjectName].filter(Boolean).join(' ');
      var to = [h.destinationRequestNumber || (has(h.destinationRequestId) ? 'request ' + h.destinationRequestId : ''), h.destinationProjectName].filter(Boolean).join(' ');
      var status = up(h.transferStatus || h.status);
      var ref = h.orderNumber || h.fusionTransferNumber || '';
      var open = has(h.transferOrderId) ? { record: 'transfer', id: h.transferOrderId, number: h.orderNumber || '' }
        : (h.orderNumber ? { record: 'transfer', number: h.orderNumber, source: 'history' }
          : requestOpen(h.destinationRequestNumber, h.destinationRequestId));
      out.push(entry({ at: pick(h, ['transferDate', 'transferredDate', 'createdDate', 'creationDate']), kind: 'move', stage: status === 'FAILED' ? 'stopped' : 'onsite',
        title: to ? 'Moved to ' + to : 'Moved between projects',
        text: [from ? 'from ' + from : '', ref, status === 'FAILED' ? 'the transfer failed' : (status === 'PENDING' ? 'pending' : '')].filter(Boolean).join(' · '),
        who: pick(h, ['transferredBy', 'createdBy']) || '', units: [serial], open: open, ref: ref }));
    });
    return out;
  }

  var RESULT = { PASS: ['Inspection passed', 'onsite'], PASSED: ['Inspection passed', 'onsite'], FAIL: ['Inspection failed', 'stopped'],
    FAILED: ['Inspection failed', 'stopped'], CONDITIONAL: ['Passed with conditions', 'ready'] };

  /** inspections rows -> completed (with the result), scheduled, or started; the line's request opens. */
  function fromInspections(rows, line) {
    return rowsOf(rows).filter(Boolean).map(function (r) {
      var res = RESULT[up(r.overallResult)];
      var status = up(r.inspectionStatus);
      var title;
      var at;
      var stage = 'draft';
      var whenWord = '';
      if (r.completedDate) { at = r.completedDate; title = res ? res[0] : 'Inspection completed'; stage = res ? res[1] : 'done'; }
      else if (r.scheduledDate) { at = r.scheduledDate; title = 'Inspection scheduled'; whenWord = 'for'; }
      else { at = r.createdDate; title = status === 'COMPLETED' ? (res ? res[0] : 'Inspection completed') : 'Inspection started'; if (res) stage = res[1]; }
      return entry({ at: at, kind: 'inspection', stage: stage, whenWord: whenWord,
        title: title + (r.inspectionType ? ' · ' + words(r.inspectionType).toLowerCase() : ''),
        text: [reqName(line.number, line.requestId), status && status !== 'COMPLETED' ? words(status).toLowerCase() : '', r.notes ? '“' + r.notes + '”' : ''].filter(Boolean).join(' · '),
        units: line.serial ? [line.serial] : [], open: requestOpen(line.number, line.requestId), ref: line.number || '' });
    });
  }

  /** Fusion work orders on the units' maintenance assets (and the item's own): planned, and completed when it says so. */
  function fromWorkOrders(byAsset, assetUnits) {
    var out = [];
    var seen = {};
    Object.keys(byAsset || {}).forEach(function (asset) {
      (byAsset[asset] || []).forEach(function (w) {
        if (!w) return;
        var key = w.WorkOrderId != null ? 'id:' + w.WorkOrderId : (w.WorkOrderNumber ? 'n:' + w.WorkOrderNumber : '');
        if (key && seen[key]) return;
        if (key) seen[key] = true;
        var units = assetUnits[asset] || [];
        var ps = d10(w.PlannedStartDate);
        var pc = d10(w.PlannedCompletionDate);
        var status = w.WorkOrderStatus || w.WorkOrderStatusName || w.WorkOrderStatusCode || '';
        var name = 'Maintenance work order' + (w.WorkOrderNumber ? ' ' + w.WorkOrderNumber : '');
        out.push(entry({ at: w.PlannedStartDate, kind: 'maint', stage: 'maint', recorded: false, dated: 'planned in Fusion', title: name,
          text: [ps ? 'planned ' + av.range(ps, pc || ps) : '', w.WorkOrderType, w.WorkOrderDescription, status ? 'status ' + status : '',
            units.length ? '' : 'asset ' + asset].filter(Boolean).join(' · '),
          units: units, ref: w.WorkOrderNumber || '' }));
        var done = w.ActualCompletionDate || w.CompletionDate;
        if (done) out.push(entry({ at: done, kind: 'maint', stage: 'done', title: name + ' completed', text: w.WorkOrderDescription || '', units: units, ref: w.WorkOrderNumber || '' }));
      });
    });
    return out;
  }

  /** equipment-certifications rows -> issued, and expired (or expiring) on its date. */
  function fromCerts(rows, t) {
    var out = [];
    rowsOf(rows).forEach(function (c) {
      if (!c) return;
      var type = c.certType ? (/[_a-z]/.test(c.certType) ? words(c.certType) : String(c.certType)) : 'Certificate';
      var name = [type, c.certNumber].filter(Boolean).join(' ');
      if (c.issuedDate) {
        out.push(entry({ at: c.issuedDate, kind: 'cert', stage: 'onsite', title: 'Certificate issued: ' + name,
          text: [c.issuedBy ? 'by ' + c.issuedBy : '', c.expiryDate ? 'valid to ' + av.fmtDay(d10(c.expiryDate), true) : '', c.notes || ''].filter(Boolean).join(' · ') }));
      }
      if (c.expiryDate) {
        var past = d10(c.expiryDate) < t;
        out.push(entry({ at: c.expiryDate, kind: 'cert', stage: past ? 'stopped' : 'ready', title: (past ? 'Certificate expired: ' : 'Certificate expires: ') + name,
          text: c.status ? 'status ' + words(c.status).toLowerCase() : '' }));
      }
    });
    return out;
  }

  /** equipment-attachments rows -> a document added (the master's, or a unit's). */
  function fromDocs(rows, serial) {
    return rowsOf(rows).filter(function (d) { return d && d.createdDate; }).map(function (d) {
      var name = d.attachmentName || d.fileName || ('Document ' + (d.id != null ? d.id : ''));
      return entry({ at: d.createdDate, kind: 'doc', stage: 'draft', title: 'Document added: ' + name,
        text: [d.categoryLabel || d.categoryCode || '', d.validToDate ? 'valid to ' + av.fmtDay(d10(d.validToDate), true) : '', serial ? '' : 'for the equipment'].filter(Boolean).join(' · '),
        who: d.createdBy && d.createdBy !== 'SYSTEM' ? d.createdBy : '', units: serial ? [serial] : [] });
    });
  }

  /** The records themselves: the item added to the master, each unit added to EquipRite. */
  function fromRecords(core) {
    var out = [];
    var m = core.master;
    if (m && m.createdDate && core.mode === 'item') {
      out.push(entry({ at: m.createdDate, kind: 'record', stage: 'draft', title: 'Added to the equipment master', text: m.equipmentNumber || '',
        who: m.createdBy && m.createdBy !== 'SYSTEM' ? m.createdBy : '' }));
    }
    (core.serials || []).forEach(function (s) {
      if (!s || !s.serialNumber || !s.createdDate) return;
      out.push(entry({ at: s.createdDate, kind: 'record', stage: 'draft', title: 'Unit ' + s.serialNumber + ' added to EquipRite',
        who: s.createdBy && s.createdBy !== 'SYSTEM' ? s.createdBy : '', units: [s.serialNumber] }));
    });
    return out;
  }

  function byNewest(a, b) {
    if (a.ms == null && b.ms == null) return a.n - b.n;
    if (a.ms == null) return 1;
    if (b.ms == null) return -1;
    return b.ms - a.ms || a.n - b.n;
  }

  /**
   * The history: every source's entries merged, newest first; a chip per unit (an item with more than one);
   * what it is made of, and what could not be read, in words.
   * @param {Object} core  loadCore's answer
   * @param {Object} more  loadMore's answer ({} while it is not there yet)
   */
  function historyOf(core, more, today) {
    var c = core || {};
    var x = more || {};
    var t = d10(today) || av.todayKey();
    var idx = indexCore(c);
    var events = fromBookings(c.lines, c.mode);
    Object.keys(x.allocations || {}).forEach(function (lid) { if (idx.lines[lid]) events = events.concat(fromAllocations(x.allocations[lid], idx.lines[lid], idx.serialById)); });
    Object.keys(x.inspections || {}).forEach(function (lid) { if (idx.lines[lid]) events = events.concat(fromInspections(x.inspections[lid], idx.lines[lid])); });
    Object.keys(x.status || {}).forEach(function (rid) { if (idx.requests[rid]) events = events.concat(fromStatusRows(x.status[rid], idx.requests[rid], idx)); });
    Object.keys(x.orders || {}).forEach(function (rid) { if (idx.requests[rid]) events = events.concat(fromOrders(x.orders[rid], x.orderLines || {}, idx.requests[rid], idx)); });
    var seenMove = {};
    Object.keys(x.moves || {}).forEach(function (rid) { events = events.concat(fromMoves(x.moves[rid], idx, seenMove)); });
    var assetUnits = {};
    (c.serials || []).forEach(function (s) {
      if (s && s.maintenanceAssetNumber && s.serialNumber) assetUnits[s.maintenanceAssetNumber] = uniq((assetUnits[s.maintenanceAssetNumber] || []).concat([s.serialNumber]));
    });
    events = events.concat(fromWorkOrders(x.workOrders || {}, assetUnits), fromCerts(x.certs, t), fromRecords(c));
    (x.docs || []).forEach(function (d) { events = events.concat(fromDocs(d.rows, d.serial)); });
    // A unit page shows only that unit's entries and the item's own (certificates, documents of the equipment).
    if (c.mode === 'unit') events = events.filter(function (e) { return !e.units.length || e.units.some(function (u) { return up(u) === up(c.serial); }); });
    // Bookings, planned maintenance, a scheduled inspection or an expiry still to come say so.
    events.forEach(function (e) {
      if (e.at && d10(e.at) > t) { e.ahead = true; e.meta += ' · ahead'; }
    });
    events.sort(byNewest);

    var serials = [];
    (c.serials || []).forEach(function (s) { if (s && s.serialNumber) serials.push(s.serialNumber); });
    (c.lines || []).forEach(function (l) { if (l.allocatedSerial) serials.push(l.allocatedSerial); });
    serials = uniq(serials).sort();
    var chips = c.mode === 'item' && serials.length > 1
      ? [{ key: 'all', label: 'All units', count: events.length }].concat(serials.map(function (s) {
        return { key: s, label: s, count: events.filter(function (e) { return e.units.indexOf(s) !== -1; }).length };
      }))
      : [];
    var failed = (c.failed || []).concat(x.failed || []).filter(Boolean);
    var kinds = {};
    events.forEach(function (e) { kinds[e.kind] = true; });
    var made = [['booking', 'bookings'], ['allocation', 'units assigned and released'], ['status', 'status changes'], ['transfer', 'transfer orders'],
      ['move', 'moves between projects'], ['inspection', 'inspections'], ['maint', 'Fusion maintenance work orders'], ['cert', 'certificates'], ['doc', 'documents']]
      .filter(function (k) { return kinds[k[0]] || (k[0] === 'status' && kinds.stopped) || (k[0] === 'transfer' && (kinds.shipped || kinds.received)); })
      .map(function (k) { return k[1]; });
    var note = events.length
      ? plural(events.length, 'entry', 'entries') + ', newest first' + (made.length ? ', from ' + made.join(', ') : '') + '. A booking is dated from its start; a date that was not recorded is not shown.'
      : 'Nothing has been recorded for this equipment yet.';
    if (x.limited) note += ' ' + x.limited;
    return { loading: false, events: events, chips: chips, note: note, failed: failed.length ? 'Not read, so left out: ' + failed.join('; ') + '.' : '', count: events.length };
  }

  /** The entries a unit chip shows ('all': every one). */
  function shown(events, chip) {
    var list = Array.isArray(events) ? events : [];
    if (!chip || chip === 'all') return list;
    return list.filter(function (e) { return e.units.indexOf(chip) !== -1; });
  }

  // ── Reading it ────────────────────────────────────────────────────────────────────────────────────────────────

  function http(r) { return (r && r.status) || 'no answer'; }

  /** One call: { ok, body, rows, status }; a failure (or a throw) is { ok: false }. */
  function one(call, endpoint, uriParams) {
    var sent;
    try { sent = Promise.resolve(call({ endpoint: endpoint, uriParams: uriParams })); } catch (e) { sent = Promise.reject(e); }
    return sent
      .then(function (r) { return r && r.ok ? { ok: true, body: r.body, rows: rowsOf(r.body), status: r.status } : { ok: false, body: null, rows: [], status: http(r) }; },
        function () { return { ok: false, body: null, rows: [], status: 'no answer' }; });
  }

  /** At most n of these at once, in order; each answer in its place (null when it threw). */
  function pool(fns, n) {
    var out = new Array(fns.length);
    var at = 0;
    function worker() {
      if (at >= fns.length) return Promise.resolve();
      var k = at++;
      return Promise.resolve().then(fns[k]).then(function (r) { out[k] = r; }, function () { out[k] = null; }).then(worker);
    }
    var workers = [];
    for (var i = 0; i < Math.min(n || POOL, fns.length); i++) workers.push(worker());
    return Promise.all(workers).then(function () { return out; });
  }

  function masterOf(rows) {
    var hit = (rows || []).filter(function (r) { return r && has(r.equipmentMasterId); })[0];
    return hit ? String(hit.equipmentMasterId) : '';
  }

  /**
   * The item, its units and its bookings: what the head, the units and the availability need.
   * @param {Function} call (options) => Actions.callRest(context, options)
   * @param {Object}   p    the tab's inputs { name, equipmentId, serial, unit }
   * @returns Promise<{ mode, serial, equipmentId, name, master, className, serials, unitsAll, lines, locationsById, yards, notes, failed, error }>
   */
  async function loadCore(call, p) {
    var tg = target(p);
    var core = { mode: tg.mode, serial: tg.serial, name: tg.name, equipmentId: tg.equipmentId, master: null, className: '', serials: [], unitsAll: 0,
      lines: [], locationsById: {}, yards: {}, notes: [], failed: [], error: '', bookingsRead: true };
    var eqId = tg.equipmentId;
    var unitHist = null;
    var unitDep = null;
    if (tg.mode === 'unit') {
      var u = await Promise.all([
        avData.readAll(call, EP.history, { serialNumber: tg.serial, page: 0, size: 500 }),
        avData.readAll(call, EP.deployed, { serialNumber: tg.serial, lineStatus: LINE_STATUSES, page: 0, size: 500 })
      ]);
      unitHist = u[0];
      unitDep = u[1];
      if (!eqId) eqId = masterOf(unitHist.rows) || masterOf(unitDep.rows);
      if (!eqId) {
        // Neither view names the unit's equipment: find the serial among the units.
        var all = await avData.readAll(call, EP.serials, { size: 10000 });
        var hit = all.rows.filter(function (s) { return s && up(s.serialNumber) === up(tg.serial); })[0];
        if (hit && has(hit.equipmentId)) eqId = String(hit.equipmentId);
        if (!eqId) {
          core.error = all.ok || unitHist.ok ? 'Unit ' + tg.serial + ' was not found in EquipRite: no unit record or booking names it.'
            : 'Unit ' + tg.serial + ' could not be looked up (HTTP ' + http(all) + ').';
          return core;
        }
      }
    } else if (!eqId) {
      if (!tg.name) { core.error = 'No equipment was named. Open one from the search, Availability or the Fleet.'; return core; }
      var found = await avData.readAll(call, EP.masters, { q: tg.name, page: 0, size: 50 });
      // The master of that name; else one whose name holds it; never an unrelated one the search also returned.
      var exact = found.rows.filter(function (m) { return m && has(m.id) && up(m.equipmentName) === up(tg.name); })[0]
        || found.rows.filter(function (m) { return m && has(m.id) && up(m.equipmentName).indexOf(up(tg.name)) !== -1; })[0];
      if (!exact || !has(exact.id)) {
        core.error = found.ok ? tg.name + ' was not found in the equipment master.' : tg.name + ' could not be looked up in the equipment master (HTTP ' + http(found) + ').';
        return core;
      }
      eqId = String(exact.id);
    }
    core.equipmentId = eqId;
    var id = Number(eqId);
    var r = await Promise.all([
      one(call, EP.master, { id: id }),
      avData.readAll(call, EP.serials, { equipmentId: id, size: 10000 }),
      tg.mode === 'item' ? avData.readAll(call, EP.history, { equipmentMasterId: id, page: 0, size: 1000 }) : Promise.resolve(unitHist),
      tg.mode === 'item' ? avData.readAll(call, EP.deployed, { equipmentMasterId: id, lineStatus: LINE_STATUSES, page: 0, size: 1000 }) : Promise.resolve(unitDep),
      avData.readAll(call, EP.bookings, { equipmentMasterId: id, page: 0, size: 10000 })
    ]);
    var master = r[0].ok && r[0].body && (has(r[0].body.id) || r[0].body.equipmentName) ? r[0].body : null;
    if (!master) core.failed.push('the equipment master record (HTTP ' + http(r[0]) + ')');
    var seen = {};
    var serials = r[1].rows.filter(function (s) {
      if (!s || !s.serialNumber || seen[up(s.serialNumber)]) return false;
      // Asked for this equipment's units: a row naming another equipment is not one of them.
      if (has(s.equipmentId) && String(s.equipmentId) !== String(id)) return false;
      seen[up(s.serialNumber)] = true;
      return true;
    });
    if (!r[1].ok) core.notes.push('The units of this equipment could not be loaded (HTTP ' + http(r[1]) + '): only units its bookings name are shown.');
    if (!r[2].ok) core.failed.push('the bookings (equipment history, HTTP ' + http(r[2]) + ')');
    if (!r[3].ok) core.failed.push('which request each booking is on (deployed units, HTTP ' + http(r[3]) + ')');
    if (!r[4].ok) core.failed.push('the active bookings (HTTP ' + http(r[4]) + ')');
    if (!r[2].ok && !r[3].ok && !r[4].ok) {
      core.bookingsRead = false;
      core.notes.push('Bookings could not be loaded: units are shown without them, so do not read them as free.');
    } else if (r[2].partial || r[3].partial) {
      core.notes.push('Not every booking could be loaded: a unit may look free when it is not.');
    }
    core.master = master;
    core.unitsAll = serials.length;
    if (tg.mode === 'unit') {
      var own = serials.filter(function (s) { return up(s.serialNumber) === up(tg.serial); })[0];
      core.serials = [own || { serialNumber: tg.serial, equipmentId: id }];
    } else {
      core.serials = serials;
    }
    core.lines = bookings({ history: r[2].rows, deployed: r[3].rows, ldb: r[4].rows, serial: tg.mode === 'unit' ? tg.serial : '' });
    // The unit's yard as the views name it, for a unit whose location is not held.
    r[3].rows.forEach(function (d) { if (d && d.serialNumber && d.yardOrgName && !core.yards[up(d.serialNumber)]) core.yards[up(d.serialNumber)] = d.yardOrgName; });
    core.serials.forEach(function (s) { var y = s.invOrgName || s.currentOrgName || s.locationName; if (y && !core.yards[up(s.serialNumber)]) core.yards[up(s.serialNumber)] = y; });
    if (!master && !serials.length && !core.lines.length) {
      core.error = 'This equipment could not be loaded (HTTP ' + http(r[0]) + ').';
      return core;
    }
    // Its class, and each unit's yard (each location once).
    var locIds = uniq(core.serials.map(function (s) {
      return has(s.currentLocationId) ? s.currentLocationId : (master && has(master.currentLocationId) ? master.currentLocationId : null);
    }));
    var c = await Promise.all([
      master && has(master.equipmentClassId) ? one(call, EP.cls, { id: Number(master.equipmentClassId) }) : Promise.resolve(null),
      Promise.all(locIds.map(function (lid) { return one(call, EP.location, { id: Number(lid) }); }))
    ]);
    core.className = (c[0] && c[0].ok && c[0].body && (c[0].body.className || c[0].body.name)) || '';
    var misses = 0;
    locIds.forEach(function (lid, i) {
      var l = c[1][i];
      if (!l || !l.ok || !l.body) { misses += 1; return; }
      core.locationsById[String(lid)] = { locationName: l.body.locationName || l.body.address || '', locationCode: l.body.locationCode || '' };
    });
    if (misses) core.notes.push(misses + ' of ' + locIds.length + ' yards could not be loaded: those units show no yard.');
    return core;
  }

  /**
   * The rest of the history and Fusion's planned maintenance: per request (status changes, transfer orders and their
   * units, moves between projects), per request line (allocations, inspections), the item's certificates and documents
   * (and each unit's), and the work orders. At most POOL reads at once.
   */
  async function loadMore(call, core) {
    var c = core || {};
    var idx = indexCore(c);
    var reqs = Object.keys(idx.requests).map(function (k) { return idx.requests[k]; })
      .sort(function (a, b) { return a.start < b.start ? 1 : (a.start > b.start ? -1 : 0); });
    var lineIds = Object.keys(idx.lines).filter(function (k) { return idx.lines[k].serial; })
      .sort(function (a, b) { return idx.lines[a].start < idx.lines[b].start ? 1 : (idx.lines[a].start > idx.lines[b].start ? -1 : 0); });
    var reqRead = reqs.slice(0, MAX_REQUESTS);
    var lineRead = lineIds.slice(0, MAX_LINES);
    var out = { status: {}, orders: {}, orderLines: {}, moves: {}, allocations: {}, inspections: {}, certs: [], docs: [], workOrders: {}, failed: [], limited: '' };
    var miss = { status: [], orders: [], moves: [], allocations: 0, inspections: 0, orderLines: 0 };
    var fns = [];
    reqRead.forEach(function (q) {
      var rid = Number(q.requestId);
      var name = reqName(q.number, q.requestId);
      fns.push(function () { return one(call, EP.status, { requestId: rid }).then(function (res) { if (res.ok) out.status[String(q.requestId)] = res.rows; else miss.status.push(name); }); });
      fns.push(function () { return one(call, EP.orders, { equipmentRequestId: rid }).then(function (res) { if (res.ok) out.orders[String(q.requestId)] = res.rows; else miss.orders.push(name); }); });
      fns.push(function () { return one(call, EP.moves, { equipmentRequestId: rid }).then(function (res) { if (res.ok) out.moves[String(q.requestId)] = res.rows; else miss.moves.push(name); }); });
    });
    lineRead.forEach(function (lid) {
      fns.push(function () { return one(call, EP.allocations, { requestLineId: Number(lid) }).then(function (res) { if (res.ok) out.allocations[lid] = res.rows; else miss.allocations += 1; }); });
      fns.push(function () { return one(call, EP.inspections, { requestLineId: Number(lid) }).then(function (res) { if (res.ok) out.inspections[lid] = res.rows; else miss.inspections += 1; }); });
    });
    var eqId = Number(c.equipmentId) || 0;
    var docsFailed = 0;
    if (eqId) {
      fns.push(function () { return one(call, EP.certs, { equipmentId: eqId }).then(function (res) { if (res.ok) out.certs = res.rows; else out.failed.push('the certificates'); }); });
      if (c.mode === 'item') {
        fns.push(function () { return one(call, EP.docs, { entityName: 'EQR_EQUIPMENT_MASTER', entityId: eqId }).then(function (res) { if (res.ok) out.docs.push({ serial: '', rows: res.rows }); else docsFailed += 1; }); });
      }
    }
    (c.serials || []).filter(function (s) { return s && has(s.id); }).slice(0, MAX_DOC_UNITS).forEach(function (s) {
      fns.push(function () { return one(call, EP.docs, { entityName: 'EQR_SERIAL_REF', entityId: Number(s.id) }).then(function (res) { if (res.ok) out.docs.push({ serial: s.serialNumber, rows: res.rows }); else docsFailed += 1; }); });
    });
    // Fusion: the units' maintenance assets (and the item's own), as Availability reads them.
    var assetRows = (c.serials || []).slice();
    if (c.mode === 'item' && c.master && c.master.maintenanceAssetNumber) assetRows.push({ maintenanceAssetNumber: c.master.maintenanceAssetNumber });
    var hasAssets = assetRows.some(function (s) { return s && s.maintenanceAssetNumber; });
    var woP = hasAssets ? Promise.resolve(avData.workOrders(call, assetRows)).catch(function () { return { byAsset: {}, assets: 1, failed: 1 }; })
      : Promise.resolve({ byAsset: {}, assets: 0, failed: 0 });
    var res = await Promise.all([pool(fns, POOL), woP]);
    var wo = res[1] || { byAsset: {}, failed: 0 };
    out.workOrders = wo.byAsset || {};
    // Which units each transfer order carries (out to site and back; an inter-project order is read from its moves).
    var orders = [];
    Object.keys(out.orders).forEach(function (rid) {
      out.orders[rid].forEach(function (o) { if (o && has(o.id) && up(o.orderType) !== 'INTER_PROJECT') orders.push(o); });
    });
    orders.sort(function (a, b) { return String(b.createdDate || '').localeCompare(String(a.createdDate || '')) || Number(b.id) - Number(a.id); });
    await pool(orders.slice(0, MAX_ORDERS).map(function (o) {
      return function () {
        return one(call, EP.orderLines, { transferOrderId: Number(o.id) }).then(function (r) { if (r.ok) out.orderLines[String(o.id)] = r.rows; else miss.orderLines += 1; });
      };
    }), POOL);
    if (miss.status.length) out.failed.push('the status changes of ' + miss.status.join(', '));
    if (miss.orders.length) out.failed.push('the transfer orders of ' + miss.orders.join(', '));
    if (miss.moves.length) out.failed.push('the moves between projects of ' + miss.moves.join(', '));
    if (miss.orderLines) out.failed.push('which units ' + plural(miss.orderLines, 'transfer order carries', 'transfer orders carry'));
    if (miss.allocations) out.failed.push('the allocations of ' + plural(miss.allocations, 'booking'));
    if (miss.inspections) out.failed.push('the inspections of ' + plural(miss.inspections, 'booking'));
    if (docsFailed) out.failed.push(docsFailed === 1 ? 'the documents' : 'the documents of ' + docsFailed + ' records');
    if (wo.failed) out.failed.push('Fusion maintenance work orders' + (wo.assets > 1 ? ' (' + wo.failed + ' of ' + wo.assets + ' maintenance assets)' : ''));
    out.woFailed = !!wo.failed;
    var limits = [];
    if (reqs.length > reqRead.length) limits.push('status changes and transfers are read for the ' + reqRead.length + ' most recent requests of ' + reqs.length);
    if (lineIds.length > lineRead.length) limits.push('allocations and inspections for the ' + lineRead.length + ' most recent bookings of ' + lineIds.length);
    if (orders.length > MAX_ORDERS) limits.push('the units of the ' + MAX_ORDERS + ' most recent transfer orders of ' + orders.length);
    if (limits.length) out.limited = 'Older bookings show their dates only: ' + limits.join('; ') + '.';
    return out;
  }

  // ── Export ────────────────────────────────────────────────────────────────────────────────────────────────────

  function historyColumns() {
    return [
      { key: 'when', label: 'When' }, { key: 'kindLabel', label: 'What' }, { key: 'title', label: 'Entry' }, { key: 'text', label: 'Details' },
      { key: 'unitText', label: 'Unit' }, { key: 'who', label: 'Who' }, { key: 'ref', label: 'Request, transfer or work order' },
      { key: 'source', label: 'Date from', value: function (e) { return !e.when ? 'not recorded' : (e.recorded ? 'recorded' : (e.kind === 'maint' ? 'planned in Fusion' : 'its dates')); } }
    ];
  }

  function unitColumns() {
    return [
      { key: 'serial', label: 'Unit (serial)' }, { key: 'name', label: 'Equipment' }, { key: 'cls', label: 'Class' }, { key: 'yard', label: 'Yard' },
      { key: 'now', label: 'Now', value: function (r) { return r.now.label; } }, { key: 'nowText', label: 'Now, in detail', value: function (r) { return r.now.text; } },
      { key: 'next', label: 'Next booking', value: function (r) { return r.next ? r.next.text : ''; } },
      { key: 'win', label: 'In the window', value: function (r) { return r.win.label; } }, { key: 'why', label: 'Why', value: function (r) { return r.win.why; } }
    ];
  }

  return {
    WINDOW_DAYS: WINDOW_DAYS, PRESETS: PRESETS, LINE_STATUSES: LINE_STATUSES, EP: EP, MAX_REQUESTS: MAX_REQUESTS, MAX_LINES: MAX_LINES, NOW: NOW,
    target: target, identity: identity, bookings: bookings, modelOf: modelOf, nowOf: nowOf, nextOf: nextOf, spanText: spanText, unitRow: unitRow,
    answer: answer, rangeOf: rangeOf, barClass: barClass, view: view, legend: legend, headOf: headOf, whenText: whenText,
    fromBookings: fromBookings, fromAllocations: fromAllocations, fromStatusRows: fromStatusRows, fromOrders: fromOrders, fromMoves: fromMoves,
    fromInspections: fromInspections, fromWorkOrders: fromWorkOrders, fromCerts: fromCerts, fromDocs: fromDocs, historyOf: historyOf, shown: shown,
    pool: pool, loadCore: loadCore, loadMore: loadMore, historyColumns: historyColumns, unitColumns: unitColumns
  };
});
