define(['resources/js/requestProgress', 'resources/js/requestData', 'resources/js/requestDetailLines', 'resources/js/fmt'],
function (Progress, requestData, rdl, fmt) {
  'use strict';

  // The yard's work, pure: what has to go out (Picking & shipping) and what is coming back (Receiving & returns),
  // one row per request, in sections by date (late first), filtered by yard, stage and search; the selection rules
  // of the picking workspace; which steps would write to Fusion; what each list exports.
  //
  // The business rules are New EquipRite's (webApps/equiprite/flows/logistics), kept as they are:
  //   - the queues: views/workbench-requests?stage=INITIATE | RETURN&size=1000, one row per request, newest first,
  //     party and person from the project or the customer (InitPickingQueueChain on each page);
  //   - the yard a line ships from: the yard recorded on its allocation, else on the line (AUTO lines: the line's),
  //     never where a unit happens to sit now (openPickingDrawerChain);
  //   - the ticks and transfer orders that scope Pick and ship (picking-page.js), stateless here;
  //   - only lines shipped back to the yard (SHIPPED_TO_YARD) can be received (receipt-page.js).
  // Where a piece is, in words, is requestProgress's, the same as on every Next screen.

  var DAY = 86400000;
  var WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function up(v) { return String(v == null ? '' : v).trim().toUpperCase(); }
  function lc(v) { return String(v == null ? '' : v).toLowerCase(); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

  // ── The queues ────────────────────────────────────────────────────────────────────────────────────────────
  var QUEUE = {
    picking: { endpoint: 'eqp-v1/getEquipriteV1ViewsWorkbenchRequests', uriParams: { stage: 'INITIATE', size: 1000 } },
    returns: { endpoint: 'eqp-v1/getEquipriteV1ViewsWorkbenchRequests', uriParams: { stage: 'RETURN', size: 1000 } }
  };

  /**
   * Queue rows, one per request (the view may answer one row per line: the first row wins), newest first. A customer
   * request names the customer and its contact, a project request the project and its requestor (New's rule).
   */
  function queueRows(raw, isExternal) {
    var seen = {};
    var out = [];
    (Array.isArray(raw) ? raw : []).forEach(function (r) {
      var id = r && (r.eqrEquipmentRequestId != null ? r.eqrEquipmentRequestId : r.requestNumber);
      if (id == null || seen[id]) return;
      seen[id] = true;
      var customer = !!(isExternal ? isExternal(r.source) : false);
      out.push({
        id: String(r.eqrEquipmentRequestId || r.requestNumber || ''),
        eqrEquipmentRequestId: r.eqrEquipmentRequestId,
        requestNumber: r.requestNumber || '',
        isCustomer: customer,
        party: customer ? (r.customerName || r.projectName || '') : (r.projectName || r.customerName || ''),
        task: customer ? '' : (r.taskName || ''),
        requestor: customer ? (r.contactName || r.requestor || '') : (r.requestor || r.contactName || ''),
        location: r.location || '',
        cls: r.className || '',
        status: r.requestStatus || '',
        source: r.source || '',
        start: r.requestedStartDate ? String(r.requestedStartDate).slice(0, 10) : '',
        end: r.requestedEndDate ? String(r.requestedEndDate).slice(0, 10) : ''
      });
    });
    out.sort(function (a, b) { return Number(b.eqrEquipmentRequestId || 0) - Number(a.eqrEquipmentRequestId || 0); });
    return out;
  }

  // ── Where a piece is, for the yard ────────────────────────────────────────────────────────────────────────
  // Out of the yard: scheduled for picking, being picked, ready to ship (inspected), shipped.
  var OUT = { SCHEDULED_FOR_PICKING: 'pick', PICK_INITIATED: 'picking', PICK_RELEASED: 'picking', EQP_INSPECTION_COMPLETE: 'ship',
    SHIP_TO_SITE: 'shipped', SHIPPED: 'shipped' };
  // Back to the yard: still on site, return asked for, on the way back, shipped back to the yard, closed.
  var IN = { DEPLOYED: 'site', DELIVERED: 'site', RETURN_INITIATED: 'requested', RETURN_IN_PROCESS: 'transit', SHIPPED_TO_YARD: 'receive',
    RETURNED: 'done', CLOSED: 'done', CONSUMED: 'done' };

  var STAGES = {
    picking: [
      { key: 'late', label: 'Late', hint: 'Not shipped by the day it is needed', tone: 'late' },
      { key: 'pick', label: 'To pick', hint: 'Scheduled for picking, waiting for release', tone: 'pick' },
      { key: 'picking', label: 'Being picked', hint: 'Released for picking', tone: 'picking' },
      { key: 'ship', label: 'Ready to ship', hint: 'Picked and inspected', tone: 'ship' },
      { key: 'shipped', label: 'Shipped', hint: 'On the way to site', tone: 'shipped' }
    ],
    returns: [
      { key: 'late', label: 'Overdue', hint: 'Past the end date, still on site', tone: 'late' },
      { key: 'receive', label: 'To receive', hint: 'Shipped back to the yard', tone: 'receive' },
      { key: 'requested', label: 'Return requested', hint: 'Waiting for pickup', tone: 'requested' },
      { key: 'transit', label: 'On the way back', hint: 'Return transfer order raised', tone: 'transit' },
      { key: 'site', label: 'On site', hint: 'Due back on its end date', tone: 'site' }
    ]
  };
  var OPEN = { picking: ['pick', 'picking', 'ship'], returns: ['site', 'requested', 'transit', 'receive'] };

  var SECTIONS = {
    picking: [
      { key: 'late', label: 'Late', hint: 'Should have left the yard already' },
      { key: 'today', label: 'Today', hint: 'Needed on site today' },
      { key: 'tomorrow', label: 'Tomorrow', hint: 'Needed on site tomorrow' },
      { key: 'week', label: 'Within a week', hint: 'Needed in the next 7 days' },
      { key: 'later', label: 'Later', hint: 'Needed in more than a week' },
      { key: 'nodate', label: 'No date', hint: 'No start date on the request' },
      { key: 'done', label: 'Shipped', hint: 'Everything here has left the yard' },
      { key: 'other', label: 'Not at a picking step', hint: 'No line scheduled for picking yet, or the lines could not be loaded' }
    ],
    returns: [
      { key: 'overdue', label: 'Overdue', hint: 'Past the end date and still on site' },
      { key: 'receive', label: 'To receive', hint: 'Shipped back to the yard: receive them as they arrive' },
      { key: 'requested', label: 'Return requested', hint: 'Waiting for pickup and a return transfer order' },
      { key: 'transit', label: 'On the way back', hint: 'Return transfer order raised, coming back from site' },
      { key: 'week', label: 'Due back within a week', hint: 'On site, end date in the next 7 days' },
      { key: 'later', label: 'Due back later', hint: 'On site, end date more than a week away' },
      { key: 'done', label: 'Closed', hint: 'Everything here is back' },
      { key: 'other', label: 'Nothing on its way back yet', hint: 'No line on site or coming back, or the lines could not be loaded' }
    ]
  };

  function dayMs(v) { return fmt.dayMs(v); }
  function today(now) { return fmt.today(now); }

  /** 'Thu 5 Nov' (the year when it is not this year's). */
  function dayLabel(iso, now) {
    var d = dayMs(iso);
    if (d == null) return '';
    var x = new Date(d);
    var sameYear = new Date(today(now)).getUTCFullYear() === x.getUTCFullYear();
    return WEEKDAY[x.getUTCDay()] + ' ' + fmt.date(iso, sameYear ? false : true);
  }

  /** One piece of equipment on a request, for the yard: the line's own fields plus where it is in the yard's work. */
  function piece(raw, req, kind, now) {
    var r = raw || {};
    var l = requestData.lineOf(r, req.requestNumber);
    var status = l.lineStatus || up(req.status);
    var info = Progress.line(status, req.isCustomer);
    var stage = (kind === 'returns' ? IN : OUT)[status] || '';
    var start = l.start || req.start || '';
    var end = l.end || req.end || '';
    var t = today(now);
    var s = dayMs(start);
    var e = dayMs(end);
    var late = 0;
    if (kind === 'picking' && OPEN.picking.indexOf(stage) !== -1 && s != null && t > s) late = Math.round((t - s) / DAY);
    if (kind === 'returns' && stage === 'site' && e != null && t > e) late = Math.round((t - e) / DAY);
    var lineId = r.lineId != null ? String(r.lineId) : (r.id != null ? String(r.id) : '');
    return {
      key: req.id + ':' + (lineId || l.key),
      requestId: req.id,
      requestNumber: req.requestNumber,
      lineId: lineId,
      lineNumber: l.lineNumber,
      name: l.name,
      cls: l.cls,
      qty: l.qty,
      serial: l.serial || '',
      status: status,
      stage: stage,
      label: info.label,
      tone: info.stage || 'ready',
      start: start,
      end: end,
      late: late,
      toNumber: r.toNumber || '',
      inboundToNumber: r.inboundToNumber || '',
      fm: rdl.isFAndM(r),
      location: l.location || req.location || ''
    };
  }

  /** "2 to pick · 1 being picked", in the order of the work. */
  function piecesText(counts, kind) {
    var words = kind === 'returns'
      ? [['receive', 'to receive'], ['requested', 'return requested'], ['transit', 'on the way back'], ['site', 'on site'], ['done', 'closed']]
      : [['pick', 'to pick'], ['picking', 'being picked'], ['ship', 'ready to ship'], ['shipped', 'shipped']];
    return words.filter(function (w) { return counts[w[0]] > 0; }).map(function (w) { return counts[w[0]] + ' ' + w[1]; }).join(' · ');
  }

  /** The yard's next step on a request: { text, where: 'here' | 'new' | 'fusion' | '' , note }. */
  function nextStep(kind, pieces, req, now) {
    var at = function (st) { return pieces.filter(function (p) { return p.stage === st; }); };
    if (kind === 'picking') {
      var pick = at('pick');
      if (pick.length) {
        var st = pick.filter(function (p) { return !p.fm; }).length;
        return { text: 'Release ' + plural(pick.length, 'piece') + ' for picking',
          where: st ? 'new' : 'here', note: st ? 'Transfer order release is a Fusion step: in New EquipRite' : 'Fixed asset, no transfer order: here' };
      }
      var initiated = pieces.filter(function (p) { return p.status === 'PICK_INITIATED'; });
      if (initiated.length) return { text: 'Pick and ship ' + plural(initiated.length, 'piece'), where: 'here', note: 'Once they have left the yard' };
      var released = pieces.filter(function (p) { return p.status === 'PICK_RELEASED'; });
      if (released.length) return { text: 'Pick on Oracle mobile, then inspect or ship confirm', where: 'fusion', note: plural(released.length, 'piece') + ' released in Fusion' };
      var ship = at('ship');
      if (ship.length) return { text: 'Ship confirm ' + plural(ship.length, 'piece'), where: 'fusion', note: 'In Oracle Shipping (Fusion)' };
      return { text: 'Nothing left to ship', where: '', note: '' };
    }
    var receive = at('receive');
    if (receive.length) return { text: 'Receive ' + plural(receive.length, 'piece') + ' at the yard', where: 'here', note: 'When they arrive' };
    var requested = at('requested');
    if (requested.length) {
      var stock = requested.filter(function (p) { return !p.fm; }).length;
      return stock
        ? { text: 'Raise the return transfer order (' + requested.length + ')', where: 'new', note: 'A Fusion step: in New EquipRite' }
        : { text: 'Record the return when it is back (' + requested.length + ')', where: 'here', note: 'Fixed asset, no transfer order' };
    }
    var transit = at('transit');
    if (transit.length) return { text: plural(transit.length, 'piece') + ' coming back', where: '', note: 'Moves to "to receive" when it ships from site' };
    var site = at('site');
    var overdue = site.filter(function (p) { return p.late > 0; });
    if (overdue.length) {
      return { text: (req.requestor || 'The requester') + ' to start the return', where: '',
        note: plural(overdue.length, 'piece') + ' past the end date' };
    }
    if (site.length) {
      var ends = site.map(function (p) { return p.end; }).filter(Boolean).sort();
      return { text: ends.length ? 'Due back ' + dayLabel(ends[0], now) : 'On site', where: '', note: '' };
    }
    return { text: 'Nothing left to receive', where: '', note: '' };
  }

  function minOf(list) {
    var vals = list.filter(function (v) { return !!v; }).sort();
    return vals.length ? vals[0] : '';
  }

  /** Picking: the section of a date it is needed by. */
  function pickBucket(date, now) {
    var d = dayMs(date);
    if (d == null) return { section: 'nodate', date: '', late: 0 };
    var n = Math.round((d - today(now)) / DAY);
    var section = n < 0 ? 'late' : (n === 0 ? 'today' : (n === 1 ? 'tomorrow' : (n <= 7 ? 'week' : 'later')));
    return { section: section, date: date, late: n < 0 ? -n : 0 };
  }

  /** Returns: the section of a date it is due back by, while it is still on site. */
  function siteBucket(date, now) {
    var d = dayMs(date);
    if (d == null) return { section: 'later', date: '', late: 0 };
    var n = Math.round((d - today(now)) / DAY);
    if (n < 0) return { section: 'overdue', date: date, late: -n };
    return { section: n <= 7 ? 'week' : 'later', date: date, late: 0 };
  }

  /** The section and the date a request sorts by (late first). */
  function placeOf(kind, pieces, now) {
    var open = pieces.filter(function (p) { return OPEN[kind].indexOf(p.stage) !== -1; });
    if (kind === 'picking') {
      if (!open.length) return { section: 'done', date: minOf(pieces.map(function (p) { return p.start; })), late: 0 };
      return pickBucket(minOf(open.map(function (p) { return p.start; })), now);
    }
    var site = pieces.filter(function (p) { return p.stage === 'site'; });
    var overdue = site.filter(function (p) { return p.late > 0; });
    if (overdue.length) {
      return { section: 'overdue', date: minOf(overdue.map(function (p) { return p.end; })), late: Math.max.apply(null, overdue.map(function (p) { return p.late; })) };
    }
    var firstOf = function (st) { return pieces.filter(function (p) { return p.stage === st; }); };
    var keys = ['receive', 'requested', 'transit'];
    for (var i = 0; i < keys.length; i++) {
      var at = firstOf(keys[i]);
      if (at.length) return { section: keys[i], date: minOf(at.map(function (p) { return p.end; })), late: 0 };
    }
    if (site.length) return siteBucket(minOf(site.map(function (p) { return p.end; })), now);
    return { section: 'done', date: '', late: 0 };
  }

  /**
   * One row per request for a yard list: its pieces (only those at a step of this screen), counts per stage, the
   * section and date it sorts by, how late, the yards it ships from (or goes back to), the next step.
   *   records   queueRows()
   *   linesBy   { requestId: raw lines (views/request-detail-lines) | null (could not be loaded) }
   *   yards     { lineId: 'Houston Yard' | '' (not recorded) } for the lines looked up so far
   *   opts      { finding: true while yards are still being looked up }
   */
  function items(kind, records, linesBy, yards, now, opts) {
    var y = yards || {};
    var finding = !!(opts && opts.finding);
    return (Array.isArray(records) ? records : []).map(function (req) {
      var raw = (linesBy || {})[req.id];
      var all = Array.isArray(raw) ? raw.map(function (r) { return piece(r, req, kind, now); }) : [];
      var pieces = all.filter(function (p) { return !!p.stage; });
      pieces.forEach(function (p) {
        p.yard = p.lineId && Object.prototype.hasOwnProperty.call(y, p.lineId) ? (y[p.lineId] || '') : null;
      });
      var counts = { late: 0 };
      STAGES[kind].forEach(function (s) { counts[s.key] = 0; });
      counts.done = 0;
      pieces.forEach(function (p) {
        counts[p.stage] = (counts[p.stage] || 0) + 1;
        if (p.late > 0) counts.late += 1;
      });
      // Lines not loaded, or none at a step of this screen yet: a section of their own (never "late" or "done" on a
      // guess), so nothing drops off the list for want of a line.
      var place = Array.isArray(raw) && pieces.length ? placeOf(kind, pieces, now)
        : { section: 'other', date: kind === 'picking' ? req.start : req.end, late: 0 };
      var waiting = Array.isArray(raw) && !pieces.length ? all[0] : null;
      var yardList = [];
      var unknown = 0;
      pieces.forEach(function (p) {
        if (p.yard === null) { unknown += 1; return; }
        String(p.yard || '').split(',').map(function (s) { return s.trim(); }).forEach(function (n) {
          var name = n || 'Not recorded';
          if (yardList.indexOf(name) === -1) yardList.push(name);
        });
      });
      return Object.assign({}, req, {
        kind: kind,
        loaded: Array.isArray(raw),
        pieces: pieces,
        otherCount: all.length - pieces.length,
        counts: counts,
        section: place.section,
        date: place.date,
        late: place.late,
        when: whenText(kind, place, now),
        yards: yardList,
        yardsPending: unknown,
        yardText: yardList.length ? yardList.join(', ') + (unknown && finding ? ' …' : '')
          : (unknown ? (finding ? 'Finding…' : 'Open it to see') : (pieces.length ? 'Not recorded' : '—')),
        summary: !Array.isArray(raw) ? 'Lines could not be loaded: open it to retry'
          : (pieces.length ? piecesText(counts, kind) : (kind === 'picking' ? 'Nothing scheduled for picking yet' : 'Nothing out on site or coming back')),
        next: !Array.isArray(raw) ? { text: 'Open it to see its lines', where: '', note: '' }
          : (waiting ? { text: waiting.label, where: '', note: Progress.line(waiting.status, req.isCustomer).who
            ? Progress.line(waiting.status, req.isCustomer).who + ' to ' + Progress.line(waiting.status, req.isCustomer).what : '' }
            : nextStep(kind, pieces, req, now)),
        segs: pieces.map(function (p) { return { stage: p.stage, title: p.name + ': ' + p.label }; })
      });
    });
  }

  /** { main, sub } for the When column: "3 days late" / "Today" / "Thu 5 Nov", and the date or how far off it is. */
  function whenText(kind, place, now) {
    var date = place.date;
    var lead = kind === 'returns' ? 'due back ' : 'needed ';
    if (!date) return { main: place.section === 'done' ? '—' : 'No date', sub: '' };
    if (place.late > 0) return { main: plural(place.late, 'day') + (kind === 'returns' ? ' overdue' : ' late'), sub: lead + fmt.date(date) };
    var n = Math.round((dayMs(date) - today(now)) / DAY);
    if (n === 0) return { main: 'Today', sub: lead + fmt.date(date) };
    if (n === 1) return { main: 'Tomorrow', sub: lead + fmt.date(date) };
    return { main: dayLabel(date, now), sub: lead + fmt.relative(date, now) };
  }

  /** The yards to filter by, from what has been looked up: [{ key, label, count }], All first. */
  function yardOptions(list) {
    var counts = {};
    (list || []).forEach(function (it) { (it.yards || []).forEach(function (y) { counts[y] = (counts[y] || 0) + 1; }); });
    var names = Object.keys(counts).sort(function (a, b) {
      if (a === 'Not recorded') return 1;
      if (b === 'Not recorded') return -1;
      return a.localeCompare(b);
    });
    return [{ key: 'all', label: 'All yards', count: (list || []).length }].concat(names.map(function (n) { return { key: n, label: n, count: counts[n] }; }));
  }

  function pieceMatchesYard(p, yard) {
    if (!yard || yard === 'all') return true;
    if (p.yard === null) return false;
    var names = String(p.yard || '').split(',').map(function (s) { return s.trim() || 'Not recorded'; });
    if (!names.length) names = ['Not recorded'];
    return names.indexOf(yard) !== -1;
  }

  function pieceMatchesStage(p, stage) {
    if (!stage || stage === 'all') return true;
    if (stage === 'late') return p.late > 0;
    return p.stage === stage;
  }

  function textMatches(it, q) {
    if (!q) return true;
    if ([it.requestNumber, it.party, it.task, it.requestor, it.location, it.cls].some(function (v) { return lc(v).indexOf(q) !== -1; })) return true;
    return (it.pieces || []).some(function (p) {
      return [p.name, p.cls, p.serial, p.toNumber, p.inboundToNumber, p.yard].some(function (v) { return lc(v).indexOf(q) !== -1; });
    });
  }

  /**
   * What is shown: requests with a piece at the stage and from the yard, matching the search. A request whose lines
   * could not be loaded stays (nothing is hidden on a failed read) unless a stage or yard is picked.
   */
  function filter(list, o) {
    var f = o || {};
    var q = lc(f.text).trim();
    return (list || []).filter(function (it) {
      if (!textMatches(it, q)) return false;
      var narrowed = (f.stage && f.stage !== 'all') || (f.yard && f.yard !== 'all');
      if (!narrowed) return true;
      return (it.pieces || []).some(function (p) { return pieceMatchesStage(p, f.stage) && pieceMatchesYard(p, f.yard); });
    });
  }

  /** The pieces of what is shown that match the stage and the yard (what the export writes). */
  function shownPieces(list, o) {
    var f = o || {};
    var out = [];
    (list || []).forEach(function (it) {
      (it.pieces || []).forEach(function (p) {
        if (pieceMatchesStage(p, f.stage) && pieceMatchesYard(p, f.yard)) out.push(Object.assign({ item: it }, p));
      });
    });
    return out;
  }

  /** The list in sections, each sorted late first then by date (empty sections left out). */
  function sections(kind, list, collapsed) {
    var shut = collapsed || {};
    return SECTIONS[kind].map(function (s) {
      var rows = (list || []).filter(function (it) { return it.section === s.key; }).sort(function (a, b) {
        return (b.late - a.late) || String(a.date || '9999').localeCompare(String(b.date || '9999'))
          || (Number(b.eqrEquipmentRequestId) || 0) - (Number(a.eqrEquipmentRequestId) || 0);
      });
      return { key: s.key, label: s.label, hint: s.hint, count: rows.length, items: shut[s.key] ? [] : rows, collapsed: !!shut[s.key],
        pieces: rows.reduce(function (n, it) { return n + it.pieces.length; }, 0) };
    }).filter(function (s) { return s.count > 0; });
  }

  /** The stage tiles: pieces at each stage (and on how many requests), from everything loaded. */
  function tiles(kind, list) {
    return STAGES[kind].map(function (s) {
      var pieces = 0;
      var reqs = 0;
      (list || []).forEach(function (it) {
        var n = (it.pieces || []).filter(function (p) { return pieceMatchesStage(p, s.key); }).length;
        pieces += n;
        if (n) reqs += 1;
      });
      return { key: s.key, label: s.label, hint: s.hint, tone: s.tone, count: pieces, requests: reqs };
    });
  }

  /** The line under the page title. */
  function summary(kind, list) {
    var all = list || [];
    var open = 0;
    var late = 0;
    var now = 0;
    var reqs = 0;
    all.forEach(function (it) {
      var o = (it.pieces || []).filter(function (p) { return OPEN[kind].indexOf(p.stage) !== -1; });
      open += o.length;
      if (o.length) reqs += 1;
      late += it.counts.late || 0;
      now += kind === 'returns' ? (it.counts.receive || 0) : (it.section === 'today' ? o.length : 0);
    });
    if (!all.length) return kind === 'picking' ? 'Nothing waiting to go out.' : 'Nothing out on site or coming back.';
    var parts = kind === 'picking'
      ? [plural(open, 'piece') + ' to get out on ' + plural(reqs, 'request'), late ? late + ' late' : '', now ? now + ' needed today' : '']
      : [plural(open, 'piece') + ' out or coming back on ' + plural(reqs, 'request'), late ? late + ' overdue' : '', now ? now + ' to receive' : ''];
    return parts.filter(Boolean).join(' · ');
  }

  /** The lines whose yard is still to be looked up: [{ requestId, lineId }], urgent sections first. */
  function yardLookups(list, yards) {
    var y = yards || {};
    var order = {};
    ['late', 'overdue', 'today', 'receive', 'tomorrow', 'requested', 'transit', 'week', 'later', 'nodate', 'done', 'other'].forEach(function (k, i) { order[k] = i; });
    var out = [];
    var rank = function (it) { return order[it.section] != null ? order[it.section] : 99; };
    (list || []).slice().sort(function (a, b) { return rank(a) - rank(b); }).forEach(function (it) {
      (it.pieces || []).forEach(function (p) {
        if (!p.lineId || Object.prototype.hasOwnProperty.call(y, p.lineId)) return;
        if (it.kind === 'picking' && p.stage === 'shipped') return; // gone: its yard does not change the work
        if (it.kind === 'returns' && p.stage === 'done') return;
        out.push({ requestId: it.id, lineId: p.lineId });
      });
    });
    return out;
  }

  // ── The yard a line ships from (New's openPickingDrawerChain rule) ────────────────────────────────────────
  /**
   * From views/line-detail-units rows: a MANUAL line's yard is the one recorded on its allocations (else the line's own
   * stamp), an AUTO line's is the line's stamp. Only a recorded yard, never a unit's current one; '' when none.
   */
  function yardOfUnits(unitRows) {
    var rows = Array.isArray(unitRows) ? unitRows : [];
    var allocRows = rows.filter(function (u) { return u && u.allocationId != null; });
    var methodRow = allocRows[0] || rows[0] || {};
    var auto = up(methodRow.allocationMethod) === 'AUTO';
    var pick = auto ? function (u) { return u.lineSourceInvOrgName; } : function (u) { return u.sourceInvOrgName || u.lineSourceInvOrgName; };
    var seen = [];
    (auto ? rows : allocRows).forEach(function (u) {
      var n = pick(u);
      if (n != null && n !== '' && seen.indexOf(n) === -1) seen.push(n);
    });
    return seen.join(', ');
  }

  /** Runs worker(item, i) over items, at most `limit` at a time; resolves the results in order (errors as { error }). */
  function pool(list, limit, worker) {
    var all = Array.isArray(list) ? list : [];
    return new Promise(function (resolve) {
      var results = new Array(all.length);
      var next = 0;
      var active = 0;
      var done = 0;
      if (!all.length) { resolve(results); return; }
      var launch = function () {
        while (active < limit && next < all.length) {
          (function (i) {
            active += 1;
            Promise.resolve().then(function () { return worker(all[i], i); })
              .then(function (r) { results[i] = r; }, function (e) { results[i] = { error: e }; })
              .then(function () {
                active -= 1;
                done += 1;
                if (done === all.length) resolve(results);
                else launch();
              });
          }(next++));
        }
      };
      launch();
    });
  }

  // ── Picking: ticks and transfer orders (New's picking-page.js rules, without the module state) ─────────────
  var RELEASABLE = ['SCHEDULED_FOR_PICKING', 'ALLOCATED'];

  function tickSet(ticks) {
    var s = {};
    (ticks || []).forEach(function (t) { s[String(t)] = true; });
    return s;
  }

  /** The ticked lines, in load order. */
  function selectedLines(lines, ticks) {
    var s = tickSet(ticks);
    return (Array.isArray(lines) ? lines : []).filter(function (l) { return l && s[String(l.lineId)]; });
  }

  /** The transfer orders the ticked lines belong to (matched on toNumber). */
  function selectedTOOptions(tos, lines, ticks) {
    var options = Array.isArray(tos) ? tos : [];
    if (!options.length) return [];
    var ticked = {};
    selectedLines(lines, ticks).forEach(function (l) { var n = String((l && l.toNumber) || ''); if (n) ticked[n] = true; });
    if (!Object.keys(ticked).length) return [];
    return options.filter(function (t) { return t && t.orderNumber && ticked[String(t.orderNumber)]; });
  }

  /** Of those, the ones still awaiting release. */
  function releasableTOOptions(tos, lines, ticks) {
    return selectedTOOptions(tos, lines, ticks).filter(function (t) { return !t.released; });
  }

  /** selectedTOId follows the ticks: one ticked order gives its id, none or several give ''. */
  function selectedTOIdFor(tos, lines, ticks) {
    var picked = selectedTOOptions(tos, lines, ticks);
    return picked.length === 1 ? String(picked[0].value) : '';
  }

  /** The lines of one transfer order (what the workspace opens ticked: the first order awaiting release). */
  function ticksForOrder(lines, orderNumber) {
    var n = String(orderNumber || '');
    if (!n) return [];
    return (Array.isArray(lines) ? lines : []).filter(function (l) { return l && String(l.toNumber || '') === n; }).map(function (l) { return String(l.lineId); });
  }

  /** One box. */
  function toggleTick(ticks, lineId, on) {
    var id = String(lineId);
    var rest = (ticks || []).map(String).filter(function (t) { return t !== id; });
    return on ? rest.concat([id]) : rest;
  }

  /** Header box: all when not all are ticked, else none. */
  function toggleAll(lines, ticks, eligible) {
    var list = (Array.isArray(lines) ? lines : []).filter(function (l) { return !eligible || eligible(l); });
    var s = tickSet(ticks);
    var all = list.length > 0 && list.every(function (l) { return s[String(l.lineId)]; });
    return all ? [] : list.map(function (l) { return String(l.lineId); });
  }

  function allTicked(lines, ticks, eligible) {
    var list = (Array.isArray(lines) ? lines : []).filter(function (l) { return !eligible || eligible(l); });
    var s = tickSet(ticks);
    return list.length > 0 && list.every(function (l) { return s[String(l.lineId)]; });
  }

  /** Ticked fixed-asset lines still waiting for release: what Release for picking moves here (no transfer order). */
  function fmToRelease(lines, ticks) {
    return selectedLines(lines, ticks).filter(function (l) { return l && l.isFAndM === true && RELEASABLE.indexOf(up(l.lineStatus)) !== -1; });
  }

  /** Lines waiting for release on a transfer order (a Fusion release: New EquipRite). */
  function stockToRelease(lines) {
    return (Array.isArray(lines) ? lines : []).filter(function (l) { return l && l.isFAndM !== true && RELEASABLE.indexOf(up(l.lineStatus)) !== -1; });
  }

  /** Fixed-asset lines waiting for release (ticked or not). */
  function fmAwaiting(lines) {
    return (Array.isArray(lines) ? lines : []).filter(function (l) { return l && l.isFAndM === true && RELEASABLE.indexOf(up(l.lineStatus)) !== -1; });
  }

  function unreleasedTOs(tos) { return (Array.isArray(tos) ? tos : []).filter(function (t) { return t && !t.released; }); }

  /**
   * Pick and ship is live when a ticked (or, with nothing ticked, any) fixed-asset line is at Pick initiated, or the
   * single ticked transfer order is released and still has lines at Pick initiated.
   */
  function canShip(tos, selectedTOId, lines, ticks) {
    if (!Array.isArray(lines)) return false;
    var ticked = selectedLines(lines, ticks);
    var candidates = ticked.length ? ticked : lines;
    if (candidates.some(function (l) { return l && l.isFAndM === true && l.lineStatus === 'PICK_INITIATED'; })) return true;
    if (!Array.isArray(tos) || !selectedTOId) return false;
    var sel = tos.filter(function (t) { return t && String(t.value) === String(selectedTOId); })[0];
    if (!sel || !sel.released) return false;
    var num = String(sel.orderNumber || '');
    return !!num && lines.some(function (l) { return l && String(l.toNumber || '') === num && l.lineStatus === 'PICK_INITIATED'; });
  }

  /**
   * The lines Pick and ship would move, picked the way the ship chain picks them (it then re-reads the statuses):
   * the single ticked order's lines at Pick initiated (every line at Pick initiated when no single order is ticked),
   * plus the fixed-asset lines at Pick initiated (the ticked ones, or all when none is ticked).
   */
  function shipLines(tos, selectedTOId, lines, ticks) {
    var list = Array.isArray(lines) ? lines : [];
    var sel = (Array.isArray(tos) ? tos : []).filter(function (t) { return t && String(t.value) === String(selectedTOId); })[0];
    var selOrderNumber = String((sel && sel.orderNumber) || '');
    var atPickInitiated = list.filter(function (l) { return l && l.lineStatus === 'PICK_INITIATED'; });
    var ids = {};
    var out = [];
    var add = function (l) { if (!ids[String(l.lineId)]) { ids[String(l.lineId)] = true; out.push(l); } };
    var anyOnOrder = list.some(function (x) { return String(x.toNumber || '') === selOrderNumber; });
    atPickInitiated.filter(function (l) { return !selOrderNumber || !anyOnOrder || String(l.toNumber || '') === selOrderNumber; }).forEach(add);
    var tickedFm = tickSet(selectedLines(list, ticks).filter(function (l) { return l.isFAndM === true; }).map(function (l) { return l.lineId; }));
    var anyTickedFm = Object.keys(tickedFm).length > 0;
    atPickInitiated.filter(function (l) { return l.isFAndM === true && (!anyTickedFm || tickedFm[String(l.lineId)]); }).forEach(add);
    return out;
  }

  /**
   * Shipping also moves a maintenance asset in Fusion (maintAssetLocation) when MAINT_ASSET_LOCATION_SYNC_ENABLED is on
   * and a shipped line is maintenance tracked and not transactable (its gate, copied). Those lines, from the server's
   * own rows: Next leaves such a ship to New EquipRite.
   */
  function fusionRelocations(syncOn, serverLines) {
    if (!syncOn) return [];
    return (Array.isArray(serverLines) ? serverLines : []).filter(function (l) {
      if (!l || l.isMaintenanceTracked !== 'Y') return false;
      var tx = l.isTransactable;
      if (tx === undefined || tx === null || tx === '') return false;
      return up(tx) !== 'Y';
    });
  }

  // ── Receiving ────────────────────────────────────────────────────────────────────────────────────────────
  var RECEIVABLE = 'SHIPPED_TO_YARD';
  function isReceivable(l) { return !!l && l.lineStatus === RECEIVABLE; }

  /** The ticked lines that can be received (only lines shipped back to the yard). */
  function toReceive(lines, ticks) { return selectedLines(lines, ticks).filter(isReceivable); }

  /** Direct return: Next records a return only when every ticked unit is a fixed asset (no transfer order). */
  function allFixedAssets(rows) {
    return (rows || []).length > 0 && (rows || []).every(function (r) { return up(r && r.fulfilmentClass) === 'F_AND_M'; });
  }

  // ── Export ────────────────────────────────────────────────────────────────────────────────────────────────
  function exportColumns(kind) {
    if (kind === 'returns') {
      return [
        { key: 'end', label: 'Due back' },
        { key: 'late', label: 'Days overdue', type: 'number', value: function (p) { return p.late || ''; } },
        { key: 'requestNumber', label: 'Request' },
        { key: 'type', label: 'Type', value: function (p) { return p.item.isCustomer ? 'Customer' : 'Project'; } },
        { key: 'party', label: 'Project or customer', value: function (p) { return p.item.party; } },
        { key: 'name', label: 'Equipment' }, { key: 'cls', label: 'Class' }, { key: 'qty', label: 'Qty', type: 'number' },
        { key: 'serial', label: 'Unit / serial' },
        { key: 'yard', label: 'Back to yard', value: function (p) { return p.yard === null ? '' : (p.yard || 'Not recorded'); } },
        { key: 'inboundToNumber', label: 'Return transfer order' },
        { key: 'label', label: 'Where it is' },
        { key: 'next', label: 'Next step', value: function (p) { return p.item.next ? p.item.next.text : ''; } },
        { key: 'status', label: 'Stored line status' }
      ];
    }
    if (kind === 'lines-picking') {
      return [
        { key: 'equipmentName', label: 'Equipment' }, { key: 'equipmentClass', label: 'Class' }, { key: 'quantity', label: 'Qty', type: 'number' },
        { key: 'serialNumber', label: 'Unit / serial' }, { key: 'yard', label: 'From yard' }, { key: 'subinventory', label: 'Subinventory' },
        { key: 'locator', label: 'Locator' }, { key: 'toNumber', label: 'Transfer order' },
        { key: 'kind', label: 'Fulfilment', value: function (l) { return l.isFAndM ? 'Fixed asset (no transfer order)' : 'Stock (transfer order)'; } },
        { key: 'where', label: 'Where it is', value: function (l) { return Progress.line(l.lineStatus).label; } },
        { key: 'lineStatus', label: 'Stored line status' }
      ];
    }
    if (kind === 'lines-returns') {
      return [
        { key: 'equipmentName', label: 'Equipment' }, { key: 'equipmentClass', label: 'Class' }, { key: 'quantity', label: 'Qty', type: 'number' },
        { key: 'serialNumber', label: 'Unit / serial' }, { key: 'toNumber', label: 'Transfer order' },
        { key: 'where', label: 'Where it is', value: function (l) { return Progress.line(l.lineStatus).label; } },
        { key: 'condition', label: 'Unit condition' }, { key: 'lineStatus', label: 'Stored line status' }
      ];
    }
    if (kind === 'found') {
      return [
        { key: 'unit', label: 'Unit', value: function (r) { return r.serialNumber || r.unitIdentifier || ''; } },
        { key: 'equipmentName', label: 'Equipment' }, { key: 'className', label: 'Class' }, { key: 'requestNumber', label: 'Request' },
        { key: 'partyName', label: 'Project or customer' },
        { key: 'where', label: 'Where it is', value: function (r) { return Progress.line(r.lineStatus).label; } },
        { key: 'endDate', label: 'Due back', value: function (r) { return r.endDate ? String(r.endDate).slice(0, 10) : ''; } },
        { key: 'overdue', label: 'Overdue', value: function (r) { return r.overdue ? 'Yes' : ''; } },
        { key: 'yardOrgName', label: 'Yard' },
        { key: 'fulfilmentClass', label: 'Fulfilment', value: function (r) { return up(r.fulfilmentClass) === 'F_AND_M' ? 'Fixed asset' : 'Stock'; } }
      ];
    }
    return [
      { key: 'start', label: 'Needed by' },
      { key: 'late', label: 'Days late', type: 'number', value: function (p) { return p.late || ''; } },
      { key: 'requestNumber', label: 'Request' },
      { key: 'type', label: 'Type', value: function (p) { return p.item.isCustomer ? 'Customer' : 'Project'; } },
      { key: 'party', label: 'Project or customer', value: function (p) { return p.item.party; } },
      { key: 'task', label: 'Task', value: function (p) { return p.item.task; } },
      { key: 'location', label: 'Deliver to' },
      { key: 'name', label: 'Equipment' }, { key: 'cls', label: 'Class' }, { key: 'qty', label: 'Qty', type: 'number' },
      { key: 'serial', label: 'Unit / serial' },
      { key: 'yard', label: 'From yard', value: function (p) { return p.yard === null ? '' : (p.yard || 'Not recorded'); } },
      { key: 'toNumber', label: 'Transfer order' },
      { key: 'label', label: 'Where it is' },
      { key: 'fm', label: 'Fulfilment', value: function (p) { return p.fm ? 'Fixed asset' : 'Stock'; } },
      { key: 'status', label: 'Stored line status' }
    ];
  }

  return {
    QUEUE: QUEUE,
    STAGES: STAGES,
    SECTIONS: SECTIONS,
    OUT: OUT,
    IN: IN,
    queueRows: queueRows,
    piece: piece,
    items: items,
    nextStep: nextStep,
    filter: filter,
    shownPieces: shownPieces,
    sections: sections,
    tiles: tiles,
    summary: summary,
    yardOptions: yardOptions,
    yardLookups: yardLookups,
    yardOfUnits: yardOfUnits,
    dayLabel: dayLabel,
    pool: pool,
    selectedLines: selectedLines,
    selectedTOOptions: selectedTOOptions,
    releasableTOOptions: releasableTOOptions,
    selectedTOIdFor: selectedTOIdFor,
    ticksForOrder: ticksForOrder,
    toggleTick: toggleTick,
    toggleAll: toggleAll,
    allTicked: allTicked,
    fmToRelease: fmToRelease,
    fmAwaiting: fmAwaiting,
    stockToRelease: stockToRelease,
    unreleasedTOs: unreleasedTOs,
    canShip: canShip,
    shipLines: shipLines,
    fusionRelocations: fusionRelocations,
    isReceivable: isReceivable,
    toReceive: toReceive,
    allFixedAssets: allFixedAssets,
    exportColumns: exportColumns
  };
});
