define(['resources/js/requestProgress', 'resources/js/fmt', 'resources/js/rules'], function (Progress, fmt, rules) {
  'use strict';

  // Approve & allocate, the logic of the screen, pure (no calls): the Equipment Manager's queue, a request's lines in
  // words, what each action will do before it is done, and what it did afterwards.
  //
  // The queue holds two kinds of request, read from the shared request list (requestData) and its equipment:
  //   decide    the request is SUBMITTED: approve it or send it back (New EquipRite's "To approve")
  //   allocate  the request is approved (IN_PROCESS, or QUOTE_ACCEPTED for a quoted customer request) and some of its
  //             approved lines have no unit yet (New's "Allocate" on Outbound)
  // Most urgent first: by start date (a late request started earliest, so it comes first), then the oldest request.
  // Late is requestProgress's: not shipped by its start date.
  //
  // The gates (lineAction, isPickable, isQuoteOwed) are New EquipRite's Approve & allocate page module's, unchanged
  // in what they allow; only their words are Next's.

  var DAY = 86400000;
  var ALLOCATE_HEADERS = ['IN_PROCESS', 'QUOTE_ACCEPTED'];
  var NO_UNIT_LINES = ['IN_PROCESS', 'APPROVED', 'QUOTE_ACCEPTED'];
  var DECISION_LINES = ['', 'DRAFT', 'SUBMITTED'];
  // New EquipRite approve-allocate-page.js
  var TERMINAL_LINE_STATUSES = ['REJECTED', 'CANCELLED'];
  var QUOTE_EXISTS = ['QUOTE_GENERATED', 'QUOTE_ACCEPTED', 'DEPLOYED'];
  var APPROVABLE = [null, '', 'DRAFT', 'SUBMITTED', 'IN_PROCESS'];
  var REJECT_TERMINAL = ['REJECTED', 'CANCELLED', 'CLOSED', 'CONSUMED'];
  var HEADER_READY = ['IN_PROCESS', 'ALLOCATED', 'REJECTED'];
  var ALLOCATION_OPEN = ['IN_PROCESS', 'QUOTE_GENERATED', 'QUOTE_ACCEPTED'];

  var CHIPS = [
    { key: 'all', label: 'All' },
    { key: 'late', label: 'Late' },
    { key: 'decide', label: 'To decide' },
    { key: 'allocate', label: 'Units to assign' }
  ];

  function up(v) { return String(v == null ? '' : v).trim().toUpperCase(); }
  function lc(v) { return String(v == null ? '' : v).toLowerCase(); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function num(v) {
    if (v === null || v === undefined || v === '') return 0;
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }
  function join(list) {
    var l = (list || []).filter(function (x) { return !!x; });
    if (l.length <= 1) return l[0] || '';
    return l.slice(0, -1).join(', ') + ' and ' + l[l.length - 1];
  }
  function cap(t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; }

  /** Is a quote owed (quoting is on for this origin and none exists yet)? New: isQuoteOwed. */
  function isQuoteOwed(status, quotingAllowed) {
    return !!quotingAllowed && QUOTE_EXISTS.indexOf(up(status)) === -1;
  }

  // ── The queue ───────────────────────────────────────────────────────────────────────────────────────────

  /**
   * The queue: every request waiting on the Equipment Manager, with what it waits for.
   *   rows            views/my-requests rows (requestData)
   *   linesByRequest  requestData.linesByRequest
   *   o               { now, quoting: fn(source) -> bool (ENABLE_QUOTES for that origin),
   *                     settled: { key: n } requests read with nothing left to assign, n lines then taking no unit }
   * Each item: { key, id, number, kind, status, external, party, task, requestor, start, end, dates, startMs,
   *   when, late (text), lateDays, p (requestProgress), waiting (lines in question), lineCount, needs, detail,
   *   quoteOwed, est, equipment, hay }
   */
  function build(rows, linesByRequest, o) {
    var opts = o || {};
    var now = opts.now || Date.now();
    var t = fmt.today(now);
    var out = [];
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      if (!r || !r.requestNumber) return;
      var number = String(r.requestNumber);
      var status = up(r.status || r.requestStatus);
      var lines = (linesByRequest || {})[number] || [];
      var external = rules.isExternalSource(r.requestOrigin || r.source);
      var kind = '';
      var waiting = [];
      if (status === 'SUBMITTED') {
        kind = 'decide';
        waiting = lines.filter(function (l) { return DECISION_LINES.indexOf(up(l.lineStatus)) !== -1; });
      } else if (ALLOCATE_HEADERS.indexOf(status) !== -1) {
        waiting = lines.filter(function (l) { return NO_UNIT_LINES.indexOf(up(l.lineStatus)) !== -1 && up(l.allocation) !== 'ALLOCATED'; });
        // The request list does not say which lines take no unit (free stock): once the request has been read and
        // nothing was left to assign, it leaves the queue, unless more of its lines wait than did then.
        var settled = (opts.settled || {})[String(r.eqrEquipmentRequestId != null ? r.eqrEquipmentRequestId : number)];
        if (waiting.length && !(settled != null && waiting.length <= settled)) kind = 'allocate';
      }
      if (!kind) return;
      var quoteOwed = isQuoteOwed(status, typeof opts.quoting === 'function' && opts.quoting(r.requestOrigin || r.source));
      var p = Progress.summarize(status, lines, { start: r.startDate, end: r.endDate, external: external, now: now });
      var startMs = fmt.dayMs(r.startDate);
      var lateDays = startMs != null && t > startMs ? Math.round((t - startMs) / DAY) : 0;
      var active = lines.filter(function (l) { return TERMINAL_LINE_STATUSES.indexOf(up(l.lineStatus)) === -1; });
      var item = {
        key: String(r.eqrEquipmentRequestId != null ? r.eqrEquipmentRequestId : number),
        id: r.eqrEquipmentRequestId != null ? Number(r.eqrEquipmentRequestId) : null,
        number: number,
        kind: kind,
        status: status,
        external: external,
        party: r.projectName || r.customerName || r.projectInternalCustomer || '',
        task: r.taskName || '',
        requestor: r.requestorName || r.contactName || '',
        start: String(r.startDate || '').slice(0, 10),
        end: String(r.endDate || '').slice(0, 10),
        dates: fmt.range(r.startDate, r.endDate),
        startMs: startMs,
        when: whenText(r.startDate, now),
        lateDays: lateDays,
        late: lateDays ? plural(lateDays, 'day') + ' late' : '',
        lateWhy: p.late.length ? p.late[0].text : '',
        p: p,
        waiting: waiting.length,
        lineCount: active.length,
        quoteOwed: quoteOwed,
        est: num(r.totalEstCost != null ? r.totalEstCost : r.estimatedCost),
        equipment: join(waiting.map(function (l) { return l.name; }).slice(0, 3)) + (waiting.length > 3 ? ' and ' + (waiting.length - 3) + ' more' : ''),
        stored: status
      };
      item.needs = kind === 'decide' ? 'To decide' : (quoteOwed ? 'Quote owed' : 'Units to assign');
      item.detail = detailText(item, lines);
      item.hay = [number, item.party, item.task, item.requestor, r.customerName, r.projectName]
        .concat(lines.map(function (l) { return l.name + ' ' + l.cls; })).map(lc).join(' ');
      out.push(item);
    });
    return sort(out);
  }

  function detailText(it, lines) {
    if (it.kind === 'decide') {
      if (!lines.length) return 'Waiting for your decision · open it to see its equipment';
      return it.waiting
        ? plural(it.waiting, 'line') + ' waiting for your decision' + (it.waiting < it.lineCount ? ' (of ' + it.lineCount + ')' : '')
        : 'Every line is decided; the request is still Submitted';
    }
    if (it.quoteOwed) return 'A quote is owed before units can be assigned';
    var partly = lines.filter(function (l) { return NO_UNIT_LINES.indexOf(up(l.lineStatus)) !== -1 && up(l.allocation) === 'PARTIAL'; }).length;
    var none = it.waiting - partly;
    var parts = [];
    if (none) parts.push(none === it.lineCount ? plural(none, 'line') + ' approved, no unit assigned yet' : none + ' of ' + plural(it.lineCount, 'line') + ' still without a unit');
    if (partly) parts.push(plural(partly, 'line') + ' with only part of ' + (partly === 1 ? 'its' : 'their') + ' units');
    return parts.join(' · ');
  }

  /** "Starts in 5 days", "Starts today", "Started 3 days ago". */
  function whenText(start, now) {
    var s = fmt.dayMs(start);
    if (s == null) return '';
    var t = fmt.today(now);
    if (s === t) return 'Starts today';
    return (s > t ? 'Starts ' : 'Started ') + fmt.relative(start, now);
  }

  /** Most urgent first: earliest start (the latest request first), then the oldest request; no date last. */
  function sort(items) {
    return (items || []).slice().sort(function (a, b) {
      var x = a.startMs == null ? Infinity : a.startMs;
      var y = b.startMs == null ? Infinity : b.startMs;
      if (x !== y) return x < y ? -1 : 1;
      return (a.id || 0) - (b.id || 0);
    });
  }

  function keysOf(it) {
    var keys = ['all', it.kind];
    if (it.lateDays) keys.push('late');
    return keys;
  }

  /** The chips with their counts; Late only when something is. */
  function chips(items) {
    var counts = {};
    (items || []).forEach(function (it) { keysOf(it).forEach(function (k) { counts[k] = (counts[k] || 0) + 1; }); });
    return CHIPS.map(function (c) { return { key: c.key, label: c.label, count: counts[c.key] || 0 }; })
      .filter(function (c) { return c.key !== 'late' || c.count > 0; });
  }

  /** The chip, the source (INTERNAL | EXTERNAL) and the search (any word: number, project, customer, requester, equipment). */
  function filter(items, text, stage, source) {
    var words = lc(text).split(/\s+/).filter(Boolean);
    return (items || []).filter(function (it) {
      if (stage && stage !== 'all' && keysOf(it).indexOf(stage) === -1) return false;
      if (source === 'EXTERNAL' && !it.external) return false;
      if (source === 'INTERNAL' && it.external) return false;
      return !words.length || words.every(function (w) { return it.hay.indexOf(w) !== -1; });
    });
  }

  /** The band under the title: "3 requests to decide · 2 with units to assign · 1 late". */
  function summary(items) {
    var list = items || [];
    if (!list.length) return 'Nothing is waiting on you: every request is decided and every approved line has its units.';
    var decide = list.filter(function (i) { return i.kind === 'decide'; }).length;
    var allocate = list.length - decide;
    var late = list.filter(function (i) { return i.lateDays; }).length;
    var parts = [];
    if (decide) parts.push(plural(decide, 'request') + ' to decide');
    if (allocate) parts.push(plural(allocate, 'request') + ' with units to assign');
    if (late) parts.push(late + ' late');
    return parts.join(' · ');
  }

  /** What the ticked requests add up to, before the click (New's selectionSummary): { count, ids, rows, text }. */
  function selection(items, ids) {
    var set = {};
    (ids || []).forEach(function (id) { set[String(id)] = 1; });
    var picked = (items || []).filter(function (it) { return it.kind === 'decide' && set[it.key]; });
    var project = picked.filter(function (r) { return !r.external; }).length;
    var customer = picked.length - project;
    var lines = picked.reduce(function (s, r) { return s + r.lineCount; }, 0);
    var est = picked.reduce(function (s, r) { return s + r.est; }, 0);
    var parts = [];
    if (project) parts.push(project + ' project');
    if (customer) parts.push(customer + ' customer');
    return {
      count: picked.length,
      ids: picked.map(function (r) { return r.key; }),
      text: picked.length ? [plural(picked.length, 'request') + ' ticked', parts.join(', '), lines ? plural(lines, 'line') : '', est ? fmt.money(est) + ' estimated' : '']
        .filter(Boolean).join(' · ') : ''
    };
  }

  /** What the queue exports: the columns a person wants in Excel. */
  function exportColumns() {
    return [
      { key: 'number', label: 'Request' },
      { key: 'type', label: 'Type', value: function (r) { return r.external ? 'Customer' : 'Project'; } },
      { key: 'party', label: 'Project or customer' }, { key: 'task', label: 'Task' },
      { key: 'needs', label: 'Waiting for' }, { key: 'detail', label: 'What' },
      { key: 'equipment', label: 'Equipment' },
      { key: 'start', label: 'Start' }, { key: 'end', label: 'End' }, { key: 'when', label: 'When' },
      { key: 'late', label: 'Late' }, { key: 'requestor', label: 'Requested by' },
      { key: 'stored', label: 'Stored status' }
    ];
  }

  // ── A request's lines (New EquipRite's gates) ─────────────────────────────────────────────────────────

  /** isLinePickable: serial, lot or inventory tracked, or an F&M line (assigned directly). */
  function isPickable(line) {
    return !!(line && (line.is_serial_controlled || line.is_lot_controlled || line.is_inventory_tracked || line.fulfilment_class === 'F_AND_M'));
  }

  /** What a line takes: Serial, Lot, Quantity (inventory item), Fixed asset, or Free stock (quantity checked only). */
  function tracking(line) {
    if (!line) return '';
    if (line.is_serial_controlled) return 'Serial';
    if (line.is_lot_controlled) return 'Lot';
    if (line.is_inventory_tracked) return 'Quantity';
    if (line.fulfilment_class === 'F_AND_M') return 'Fixed asset';
    return 'Free stock';
  }

  /**
   * Can this line's units be opened, and why not (New: lineAction, from the old rowClickChain +
   * isRowLineDetailBlocked). Terminal lines never; while the request is SUBMITTED or owes a quote, only a customer
   * line at UNDER_PROCUREMENT (read only); free stock never.
   *   head: { status, external }
   * { kind: 'allocate' | 'view' | 'blocked' | 'none', label, reason }
   */
  function lineAction(line, head, quotingAllowed, readOnly) {
    if (!line) return { kind: 'none', label: '', reason: '' };
    var ls = up(line.line_status);
    if (TERMINAL_LINE_STATUSES.indexOf(ls) !== -1) return { kind: 'none', label: '', reason: 'Sent back or cancelled: nothing to assign.' };
    var h = head || {};
    var status = up(h.status);
    var gated = status === 'SUBMITTED' || isQuoteOwed(status, quotingAllowed);
    if (gated && !(h.external && ls === 'UNDER_PROCUREMENT')) {
      return { kind: 'blocked', label: 'Pick units',
        reason: status === 'SUBMITTED' ? 'Units can be assigned once the request is approved.' : 'Units can be assigned once the quote is generated.' };
    }
    if (!isPickable(line)) return { kind: 'none', label: '', reason: 'Free stock: no unit to assign; the yard picks the quantity.' };
    if (gated || readOnly || ALLOCATION_OPEN.indexOf(status) === -1) return { kind: 'view', label: 'See units', reason: '' };
    return { kind: 'allocate', label: line.alloc_status === 'ALLOCATED' ? 'Change units' : 'Pick units', reason: '' };
  }

  /** Availability over the line's dates (views/request-detail-lines availabilityStatus): ok | part | none | unknown. */
  function availTone(a) {
    var v = up(a);
    if (!v) return 'unknown';
    if (v === 'AVAILABLE') return 'ok';
    if (v.indexOf('PARTIAL') === 0) return 'part';
    return 'none';
  }

  function availLabel(a) {
    var v = up(a);
    if (!v) return 'Not known';
    if (v === 'AVAILABLE') return 'Available';
    if (v === 'PARTIAL DURATION') return 'Free for part of the dates';
    if (v === 'PARTIAL QUANTITY') return 'Not enough free';
    if (v === 'NOT AVAILABLE') return 'Not available';
    return v.charAt(0) + v.slice(1).toLowerCase();
  }

  /** "Line 2 (Dump Truck)", for sentences. */
  function lineName(l) {
    return 'line ' + (l && l.line_no) + (l && l.equipment_name ? ' (' + l.equipment_name + ')' : '');
  }

  /** The lines as the panel shows them. head: { status, external }. */
  function lineRows(lines, head, quotingAllowed, readOnly) {
    var h = head || {};
    return (lines || []).map(function (l) {
      var info = Progress.line(l.line_status, !!h.external);
      var act = lineAction(l, h, quotingAllowed, readOnly);
      var pickable = isPickable(l);
      var qty = num(l.qty) || 1;
      var got = Math.min(qty, Number(String(l.allocated_serial || '').split(' ')[0]) || 0);
      return {
        id: String(l.lineId),
        no: l.line_no,
        name: l.equipment_name || 'Equipment',
        cls: l.class || '',
        qty: qty,
        tracking: tracking(l),
        sub: [l.class, tracking(l), fmt.range(l.line_start_date, l.line_end_date)].filter(function (x) { return !!x; }).join(' · '),
        avail: availTone(l.availability),
        availLabel: availLabel(l.availability),
        stage: info.stage || 'ready',
        label: info.label || '',
        stored: up(l.line_status),
        pickable: pickable,
        units: pickable ? (got >= qty ? (qty === 1 ? 'Unit assigned' : 'All ' + qty + ' assigned') : got + ' of ' + qty + ' assigned') : 'No unit needed',
        unitsTone: !pickable ? 'none' : (l.alloc_status === 'ALLOCATED' ? 'complete' : (l.alloc_status === 'PARTIAL' ? 'partial' : 'missing')),
        action: act.kind,
        actionLabel: act.label,
        reason: act.reason,
        dates: fmt.range(l.line_start_date, l.line_end_date),
        notes: lineNotes(l),
        est: num(l.est_cost),
        rate: l.bill_rate || ''
      };
    });
  }

  /** Facts on a line: purchase requisition / order, transfer order, a failed Transfer Order. */
  function lineNotes(l) {
    var out = [];
    if (l.pr_number) out.push('PR ' + l.pr_number);
    if (l.po_number) out.push('PO ' + l.po_number);
    if (l.to_number) out.push('TO ' + l.to_number);
    if (l.to_failure_code === 'TO_FAILED') out.push('Transfer Order failed');
    return out.join(' · ');
  }

  // ── What a click will do ─────────────────────────────────────────────────────────────────────────────

  /**
   * The lines a decision acts on: the ticked ones in the order they were ticked (New's getSelectedLines), or every
   * line when none is ticked.
   */
  function pool(lines, ticked) {
    var all = lines || [];
    var ids = ticked || [];
    if (!ids.length) return all.slice();
    return ids.map(function (id) { return all.filter(function (l) { return String(l.lineId) === String(id); })[0]; }).filter(Boolean);
  }

  /**
   * Approve or send back, before the click: { count, all, label, settled, headerMoves, note }. count is how many
   * lines will change (the rest are settled); headerMoves: the request itself moves (approved, or sent back).
   *   requester: the name to address in words
   */
  function decisionPlan(kind, lines, ticked, requester) {
    var all = lines || [];
    var p = pool(all, ticked);
    var acts = kind === 'reject'
      ? p.filter(function (l) { return REJECT_TERMINAL.indexOf(up(l.lineStatus)) === -1; })
      : p.filter(function (l) { return APPROVABLE.indexOf(l.lineStatus) !== -1; });
    var n = acts.length;
    var ids = {};
    acts.forEach(function (l) { ids[String(l.lineId)] = 1; });
    var verb = kind === 'reject' ? 'Send back' : 'Approve';
    var someTicked = (ticked || []).length > 0;
    var label = !n ? verb : (someTicked ? verb + ' ' + plural(n, 'line') : (n === 1 ? verb + ' the line' : verb + ' all ' + n + ' lines'));
    var headerMoves;
    var note;
    var who = requester || 'the requester';
    if (kind === 'reject') {
      headerMoves = n > 0 && all.length > 0 && !all.some(function (l) { return !ids[String(l.lineId)] && REJECT_TERMINAL.indexOf(up(l.lineStatus)) === -1; });
      note = !n ? 'No line here can be sent back.'
        : cap(plural(n, 'line')) + ' will go back to ' + who + ' with your reason; a line sent back cannot be approved later. '
          + (headerMoves ? 'No line is left open, so the request is sent back.' : 'The rest of the request stays open.');
    } else {
      headerMoves = n > 0 && all.length > 0 && all.every(function (l) { return ids[String(l.lineId)] || HEADER_READY.indexOf(up(l.lineStatus)) !== -1; });
      var left = all.filter(function (l) { return !ids[String(l.lineId)] && HEADER_READY.indexOf(up(l.lineStatus)) === -1; }).length;
      note = !n ? 'No line here can be approved.'
        : cap(plural(n, 'line')) + ' will be approved. '
          + (headerMoves ? 'Every line is then decided, so the request moves on to unit assignment.'
            : 'The request keeps waiting for ' + plural(left, 'line') + ' still to decide.');
    }
    var settled = p.length - n;
    if (n && settled) note += ' ' + cap(plural(settled, 'line')) + ' already decided ' + (settled === 1 ? 'stays' : 'stay') + ' as ' + (settled === 1 ? 'it is' : 'they are') + '.';
    return { count: n, all: !someTicked, label: label, settled: settled, headerMoves: headerMoves, note: note };
  }

  /**
   * The one sentence above the lines (New: verdict): is the request ready, what will happen next, what is in the way.
   *   head: { status, external, headline }; lines: loadLines lines
   * { tone: 'ok' | 'warn' | 'info', text, next: '' | 'picking' | 'quote' | 'record' }
   */
  function verdict(head, lines, quotingAllowed) {
    var h = head || {};
    var status = up(h.status);
    var list = lines || [];
    var live = list.filter(function (l) { return TERMINAL_LINE_STATUSES.indexOf(up(l.line_status)) === -1; });
    var unavailable = live.filter(function (l) { return availTone(l.availability) === 'none'; });
    var partial = live.filter(function (l) { return availTone(l.availability) === 'part'; });
    var pickable = live.filter(isPickable);
    var missing = pickable.filter(function (l) { return l.alloc_status !== 'ALLOCATED'; });
    var quoteOwed = isQuoteOwed(status, quotingAllowed);
    var avail = [];
    if (unavailable.length) avail.push(cap(join(unavailable.map(lineName))) + (unavailable.length === 1 ? ' is' : ' are') + ' not available for ' + (unavailable.length === 1 ? 'its' : 'their') + ' dates');
    if (partial.length) avail.push(cap(join(partial.map(lineName))) + (partial.length === 1 ? ' is' : ' are') + ' only partly available');
    var availText = avail.length ? ' ' + avail.join('; ') + '.' : '';

    if (status === 'SUBMITTED') {
      var open = list.filter(function (l) { return APPROVABLE.indexOf(l.lineStatus) !== -1; }).length;
      return {
        tone: unavailable.length ? 'warn' : 'ok',
        text: 'Waiting for your decision: ' + open + ' of ' + plural(list.length, 'line') + '. Approve it, or send it back with a reason; '
          + 'units can be assigned once every line is decided.' + availText
          + (quoteOwed ? ' A quote is owed for this request: units can be assigned only once it is generated.' : ''),
        next: quoteOwed ? 'quote' : ''
      };
    }
    if (ALLOCATION_OPEN.indexOf(status) !== -1) {
      if (quoteOwed) return { tone: 'warn', text: 'A quote is owed for this request: generate it in Old EquipRite, then assign units here.' + availText, next: 'quote' };
      if (!pickable.length) return { tone: 'ok', text: 'No line takes serials, lots or stock: no unit to assign. Next: the yard picks it (Initiate picking, in New EquipRite).', next: 'picking' };
      if (!missing.length) return { tone: 'ok', text: 'Every line has its units (' + pickable.length + ' of ' + pickable.length + '). Next: Initiate picking, in New EquipRite.', next: 'picking' };
      return {
        tone: unavailable.length ? 'warn' : 'info',
        text: (pickable.length - missing.length) + ' of ' + plural(pickable.length, 'line') + ' ' + (pickable.length - missing.length === 1 ? 'has its' : 'have their') + ' units. '
          + cap(join(missing.map(lineName))) + ' still ' + (missing.length === 1 ? 'needs' : 'need') + ' units: assign them here, or leave '
          + (missing.length === 1 ? 'it' : 'them') + ' for the yard to pick on the Oracle mobile app.' + availText,
        next: ''
      };
    }
    if (status === 'REJECTED' || status === 'CANCELLED') {
      return { tone: 'info', text: 'This request is ' + (status === 'REJECTED' ? 'sent back' : 'cancelled') + ': nothing to decide or assign.', next: 'record' };
    }
    return { tone: 'info', text: 'This request is past approval and unit assignment' + (h.headline ? ' (' + h.headline + ')' : '') + '. Open it to follow it.', next: 'record' };
  }

  /**
   * A request read in full with nothing left to assign (units can be assigned, and every line that takes units has
   * them): how many of its lines take no unit (free stock), which the request list still counts as waiting; else null.
   */
  function settledCount(head, lines, quotingAllowed) {
    var status = up(head && head.status);
    if (ALLOCATION_OPEN.indexOf(status) === -1 || isQuoteOwed(status, quotingAllowed)) return null;
    var live = (lines || []).filter(function (l) { return TERMINAL_LINE_STATUSES.indexOf(up(l.line_status)) === -1; });
    if (live.filter(isPickable).some(function (l) { return l.alloc_status !== 'ALLOCATED'; })) return null;
    return live.filter(function (l) { return !isPickable(l); }).length;
  }

  // ── What a click did ─────────────────────────────────────────────────────────────────────────────────

  /** approveAllocate.approve's result in words: { tone, text }. */
  function approveWords(number, res) {
    if (!res) return { tone: 'error', text: 'Nothing was approved.' };
    if (res.nothing) return { tone: 'warn', text: 'No line on ' + number + ' could be approved: they are already decided.' };
    if (!res.ok) return { tone: 'error', text: 'Nothing was approved on ' + number + ': ' + res.message + conflictHint(res.message) };
    var t = 'Approved ' + plural(res.updated, 'line') + ' on ' + number + '. ';
    var allocated = (res.updates || []).filter(function (u) { return u.lineStatus === 'ALLOCATED'; }).length;
    if (allocated) t += cap(plural(allocated, 'line')) + ' already had ' + (allocated === 1 ? 'its' : 'their') + ' units and ' + (allocated === 1 ? 'is' : 'are') + ' ready for picking. ';
    if (res.headerMoved) t += 'Every line is decided: the request moves on to unit assignment.';
    else if (res.headerFailed) t += 'The request itself could not be moved on; Refresh and try again.';
    else t += 'The request keeps waiting for the lines still to decide.';
    return { tone: res.headerFailed ? 'warn' : 'ok', text: t.trim() };
  }

  /** approveAllocate.reject's result in words (with the reason's fate): { tone, text }. */
  function rejectWords(number, res, note, requester) {
    if (!res) return { tone: 'error', text: 'Nothing was sent back.' };
    if (res.nothing) return { tone: 'warn', text: 'No line on ' + number + ' could be sent back: they are already settled.' };
    if (!res.ok) return { tone: 'error', text: 'Nothing was sent back on ' + number + ': ' + res.message + conflictHint(res.message) };
    var t = 'Sent back ' + plural(res.updated, 'line') + ' on ' + number + '. ';
    if (res.requestRejected) t += 'No line is left open, so the request is sent back. ';
    else if (res.headerFailed) t += 'The request itself could not be marked sent back; Refresh and try again. ';
    t += reasonWords(note, requester);
    return { tone: res.headerFailed || (note && !note.ok) ? 'warn' : 'ok', text: t.trim() };
  }

  function reasonWords(note, requester) {
    var who = requester || 'the requester';
    if (!note) return '';
    if (note.ok) return 'Your reason was sent to ' + who + '.';
    if (note.skipped) return 'Your reason could not be sent: the request names no requester user. Tell ' + who + ' yourself.';
    return 'Your reason could not be sent (HTTP ' + (note.status || '?') + '). Tell ' + who + ' yourself.';
  }

  /** A batch refused as a whole: someone else may have changed it. */
  function conflictHint(message) {
    return /409|changed|lock|version|conflict/i.test(String(message || ''))
      ? ' Someone else may have changed this request meanwhile; it has been read again.' : ' It has been read again.';
  }

  /** approveAllocate.saveAllocation's result in words, for one line: { tone, text }. */
  function saveWords(line, res, plan) {
    var name = cap(lineName(line));
    if (!res) return { tone: 'error', text: 'Nothing was saved.' };
    if (res.nothing) return { tone: 'info', text: 'Nothing to save: assign or release a unit first.' };
    if (res.confirmed) return { tone: 'error', text: name + ': a Transfer Order is live for this line, so its units can no longer change. Nothing was saved.' };
    var problems = (res.errors || []).concat(res.lineError ? [res.lineError] : []);
    var done = plan && plan.text ? plan.text.replace(/\. The line will have.*$/, '') : 'Saved';
    var after = res.allocationStatus === 'ALLOCATED' ? 'it has all its units' : (res.allocationStatus === 'PARTIAL' ? 'it has ' + res.allocated + ' of ' + (line.qty || 1) : 'it has no unit');
    if (problems.length) return { tone: 'error', text: name + ': saved with problems. ' + problems.join('; ') + '. Read again: ' + after + '.' };
    return { tone: 'ok', text: name + ': ' + lowerFirst(done) + '. ' + cap(after) + '.' };
  }

  function lowerFirst(t) { return t ? t.charAt(0).toLowerCase() + t.slice(1) : t; }

  /**
   * The suggestion of one line, in words: { state, text }. state: ready | none | locked | error | full.
   *   s: { error, locked, why, picks: [{ text }], remaining (before), needed }
   */
  function suggestionWords(s) {
    if (!s) return { state: 'none', text: '' };
    if (s.error) return { state: 'error', text: s.error };
    if (s.locked) return { state: 'locked', text: s.why || 'Its units can no longer change.' };
    if (!s.needed) return { state: 'full', text: 'Has its units' };
    if (!s.picks.length) return { state: 'none', text: 'No free unit for its dates: leave it for the yard, or buy or rent one in New EquipRite' };
    var short = s.needed - s.got;
    return { state: 'ready', text: 'Suggested: ' + join(s.picks.map(function (p) { return p.text; })) + (short > 0 ? ' · ' + short + ' more not free' : '') };
  }

  /** Auto-allocate in words, before ({ count, lines, text }) and after (results per line). */
  function autoPlan(rows, sugg) {
    var lines = (rows || []).filter(function (r) { var s = (sugg || {})[r.id]; return s && s.picks && s.picks.length && !s.locked && !s.error; });
    var count = lines.reduce(function (n, r) { return n + sugg[r.id].picks.length; }, 0);
    var none = (rows || []).filter(function (r) { var s = (sugg || {})[r.id]; return s && s.needed && !s.locked && !s.error && !s.picks.length; });
    return {
      count: count,
      lines: lines.map(function (r) { return { id: r.id, text: 'Line ' + r.no + ' · ' + r.name + ': ' + join(sugg[r.id].picks.map(function (p) { return p.text; })) }; }),
      none: none.map(function (r) { return 'Line ' + r.no + ' · ' + r.name; }),
      label: count ? 'Assign the suggested units to ' + plural(lines.length, 'line') : 'No unit to suggest'
    };
  }

  /** The bulk result in words: { title, tone, done, failed, skipped } (New's bulkResult). */
  function bulkWords(action, total, done, failed, skipped) {
    var past = action === 'approve' ? 'approved' : 'sent back';
    return {
      action: action,
      tone: failed.length ? 'error' : (skipped.length ? 'warn' : 'ok'),
      title: done.length + ' of ' + plural(total, 'request') + ' ' + past + (failed.length ? ' · ' + failed.length + ' failed' : '') + (skipped.length ? ' · ' + skipped.length + ' skipped' : ''),
      done: done, failed: failed, skipped: skipped
    };
  }

  return {
    CHIPS: CHIPS, build: build, sort: sort, chips: chips, filter: filter, summary: summary, selection: selection, exportColumns: exportColumns,
    whenText: whenText, isQuoteOwed: isQuoteOwed, isPickable: isPickable, tracking: tracking, lineAction: lineAction, availTone: availTone,
    availLabel: availLabel, lineRows: lineRows, lineName: lineName, pool: pool, decisionPlan: decisionPlan, verdict: verdict, settledCount: settledCount,
    approveWords: approveWords, rejectWords: rejectWords, reasonWords: reasonWords, saveWords: saveWords, suggestionWords: suggestionWords,
    autoPlan: autoPlan, bulkWords: bulkWords
  };
});
