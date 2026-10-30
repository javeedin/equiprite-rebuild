define(['resources/js/requestProgress', 'resources/js/fmt'], function (Progress, fmt) {
  'use strict';

  // A request from start to end: the milestones every request passes (created, sent for approval, approved, unit
  // assigned, picked, shipped, on site, coming back, back at the yard), when each was reached and by whom, how many of
  // its pieces have reached it, and everything recorded on the way (the approval history among it).
  //
  // Read from what EquipRite keeps (reads only; nothing here writes):
  //   request-status-history?requestId     each status change the server recorded: who, when, from, to, comment
  //   equipment-requests/{id}               when the request was created, and by whom
  //   views/request-detail-lines            each piece of equipment and where it is now
  //   transfer-orders?equipmentRequestId    out to site and back to the yard: raised, shipped, received
  //   transfer-history?equipmentRequestId   moves between projects
  //   equipment-requests/{id}/quotes        quotes (customer requests)
  //   purchase-requisitions?requestId       equipment bought for it
  // The status history's field names are not documented; several spellings are read (as alerts.fromServer does).
  // Where a step was not recorded, its date comes from the transfer orders, or it says it was not recorded: a step is
  // never given a date it does not have.

  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // The milestones, in order. A line's status says which it has reached (AT below).
  var MILESTONES = [
    { key: 'created',   label: 'Created',            stage: 'draft' },
    { key: 'submitted', label: 'Sent for approval',  stage: 'approval' },
    { key: 'approved',  label: 'Approved',           stage: 'ready' },
    { key: 'allocated', label: 'Unit assigned',      stage: 'ready' },
    { key: 'picked',    label: 'Picking started',    stage: 'ready' },
    { key: 'shipped',   label: 'Shipped to site',    stage: 'out' },
    { key: 'onsite',    label: 'On site',            stage: 'onsite' },
    { key: 'back',      label: 'Coming back',        stage: 'back' },
    { key: 'done',      label: 'Back at the yard',   stage: 'done' }
  ];
  var INDEX = {};
  MILESTONES.forEach(function (m, i) { INDEX[m.key] = i; });

  // The furthest milestone a line at each status has reached.
  var AT = {
    DRAFT: 'created',
    SUBMITTED: 'submitted', QUOTE_GENERATED: 'submitted',
    IN_PROCESS: 'approved', APPROVED: 'approved', QUOTE_ACCEPTED: 'approved', UNDER_PROCUREMENT: 'approved',
    ALLOCATED: 'allocated', INSPECTION_FAILED: 'allocated',
    SCHEDULED_FOR_PICKING: 'allocated',
    PICK_INITIATED: 'picked', PICK_RELEASED: 'picked', EQP_INSPECTION_COMPLETE: 'picked',
    SHIP_TO_SITE: 'shipped', SHIPPED: 'shipped',
    DELIVERED: 'onsite', DEPLOYED: 'onsite',
    RETURN_INITIATED: 'back', RETURN_IN_PROCESS: 'back', SHIPPED_TO_YARD: 'back',
    RETURNED: 'done', CLOSED: 'done', CONSUMED: 'done'
  };
  var STOPPED = { REJECTED: 1, CANCELLED: 1, DECLINED: 1 };

  // A recorded change to each status, in words.
  var CHANGE = {
    DRAFT: 'Saved as a draft',
    SUBMITTED: 'Sent for approval',
    QUOTE_GENERATED: 'Quote sent to the customer',
    QUOTE_ACCEPTED: 'Quote accepted by the customer',
    IN_PROCESS: 'Approved',
    APPROVED: 'Approved',
    UNDER_PROCUREMENT: 'Sent to procurement',
    ALLOCATED: 'Unit assigned',
    SCHEDULED_FOR_PICKING: 'Confirmed for picking',
    PICK_INITIATED: 'Picking started',
    PICK_RELEASED: 'Released for picking',
    EQP_INSPECTION_COMPLETE: 'Inspected, ready to ship',
    INSPECTION_FAILED: 'Failed inspection',
    SHIP_TO_SITE: 'Shipped to site',
    SHIPPED: 'Shipped to site',
    DELIVERED: 'Delivered to site',
    DEPLOYED: 'Delivered to site',
    RETURN_INITIATED: 'Return asked for',
    RETURN_IN_PROCESS: 'Being returned',
    SHIPPED_TO_YARD: 'Shipped back to the yard',
    RETURNED: 'Received back at the yard',
    CLOSED: 'Closed',
    CONSUMED: 'Used up on site',
    REJECTED: 'Sent back',
    CANCELLED: 'Cancelled',
    DECLINED: 'Declined'
  };

  function up(v) { return String(v == null ? '' : v).trim().toUpperCase(); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function pick(r, names) {
    for (var i = 0; i < names.length; i++) {
      var v = r && r[names[i]];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return undefined;
  }
  function listOf(body) {
    if (Array.isArray(body)) return body;
    if (body && Array.isArray(body.data)) return body.data;
    if (body && Array.isArray(body.items)) return body.items;
    return [];
  }

  /** A date-time from the server, as ms (a bare date is midnight UTC); null when there is none. */
  function msOf(v) {
    if (v == null || v === '') return null;
    var s = String(v);
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
    if (!m) return null;
    if (!m[4]) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    var t = Date.parse(s.replace(' ', 'T'));
    return isNaN(t) ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0)) : t;
  }
  function hasTime(v) { return /[T ]\d{2}:\d{2}/.test(String(v || '')) && !/[T ]00:00(:00(\.0+)?)?(Z|[+-]00:?00)?$/.test(String(v)); }

  /** "8 Oct 2026, 14:05" (local time when the server gave one), "8 Oct 2026" otherwise. */
  function whenText(raw, ms) {
    if (ms == null) return '';
    var d = new Date(ms);
    if (!hasTime(raw)) return d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear() + ', ' + hh + ':' + mm;
  }
  function shortDay(ms) {
    if (ms == null) return '';
    var d = new Date(ms);
    return d.getUTCDate() + ' ' + MON[d.getUTCMonth()];
  }

  function event(o) {
    var ms = msOf(o.at);
    return {
      at: o.at || '', ms: ms, when: whenText(o.at, ms), kind: o.kind, stage: o.stage || '', milestone: o.milestone || '',
      title: o.title, text: o.text || '', who: o.who || '', recorded: !!o.recorded, code: o.code || ''
    };
  }

  /**
   * request-status-history rows -> events, oldest first. Changes to the same status by the same person within the same
   * minute (one approval of several lines) are one event: "Approved (3 pieces)".
   */
  function fromStatusHistory(rows, external) {
    var groups = [];
    var byKey = {};
    listOf(rows).forEach(function (r) {
      var to = up(pick(r, ['toStatus', 'newStatus', 'statusTo', 'status', 'currentStatus', 'lineStatus', 'requestStatus']));
      if (!to) return;
      var from = up(pick(r, ['fromStatus', 'oldStatus', 'previousStatus', 'statusFrom', 'prevStatus']));
      var at = pick(r, ['changedDate', 'statusDate', 'changeDate', 'statusChangeDate', 'createdDate', 'creationDate', 'createdOn',
        'eventDate', 'actionDate', 'lastUpdatedDate', 'updatedDate', 'timestamp']) || '';
      var who = pick(r, ['changedByName', 'changedBy', 'actionByName', 'actionBy', 'performedBy', 'userName', 'createdByName',
        'createdBy', 'lastUpdatedBy', 'updatedBy']) || '';
      var note = pick(r, ['comments', 'comment', 'reason', 'rejectionReason', 'remarks', 'notes', 'note', 'changeReason', 'description']) || '';
      var lineId = pick(r, ['lineId', 'requestLineId', 'eqrRequestLineId', 'eqrEquipmentRequestLineId']);
      var ms = msOf(at);
      var key = to + '|' + String(who) + '|' + (ms == null ? '' : Math.floor(ms / 60000)) + '|' + String(note);
      if (byKey[key]) {
        if (lineId != null) byKey[key].lines += 1;
        return;
      }
      var g = { to: to, from: from, at: at, who: who, note: note, lines: lineId != null ? 1 : 0, ms: ms };
      byKey[key] = g;
      groups.push(g);
    });
    return groups.map(function (g) {
      var info = Progress.line(g.to, external);
      var title = external && g.to === 'IN_PROCESS' ? 'Sent to the Equipment Manager' : (CHANGE[g.to] || info.label || g.to);
      var bits = [];
      if (g.lines > 1) bits.push(plural(g.lines, 'piece'));
      if (g.from && CHANGE[g.from] && g.from !== g.to) bits.push('was: ' + Progress.line(g.from, external).label.toLowerCase());
      var text = bits.join(' · ');
      if (g.note) text = (text ? text + ' · ' : '') + '“' + String(g.note) + '”';
      var milestone = external && g.to === 'IN_PROCESS' ? 'submitted' : (AT[g.to] || '');
      return event({ at: g.at, kind: STOPPED[g.to] ? 'stopped' : 'status', stage: info.stage, milestone: milestone, title: title, text: text,
        who: g.who, recorded: true, code: g.to });
    }).sort(byTime);
  }

  /** transfer-orders rows -> events: raised, shipped, received; out to site or back to the yard. */
  function fromTransferOrders(rows) {
    var out = [];
    listOf(rows).forEach(function (o) {
      var type = up(o.orderType);
      if (type === 'INTER_PROJECT') return;
      var back = type === 'INBOUND' || /RETURN/.test(type);
      var name = 'Transfer order ' + (o.orderNumber || ('#' + (o.id || '')));
      var carrier = [o.carrierName, o.trackingNumber ? 'tracking ' + o.trackingNumber : ''].filter(Boolean).join(', ');
      if (pick(o, ['createdDate', 'requestedDate'])) {
        out.push(event({ at: pick(o, ['createdDate', 'requestedDate']), kind: 'transfer', stage: back ? 'back' : 'ready',
          milestone: back ? 'back' : 'picked', title: back ? name + ' raised to bring it back' : name + ' raised for picking',
          text: o.needByDate ? 'Needed by ' + shortDay(msOf(o.needByDate)) : '' }));
      }
      if (o.shippedDate) {
        out.push(event({ at: o.shippedDate, kind: 'shipped', stage: back ? 'back' : 'out', milestone: back ? 'back' : 'shipped',
          title: back ? 'Shipped back to the yard' : 'Shipped to site', text: [o.orderNumber, carrier].filter(Boolean).join(' · ') }));
      }
      if (o.receivedDate) {
        out.push(event({ at: o.receivedDate, kind: 'received', stage: back ? 'done' : 'onsite', milestone: back ? 'done' : 'onsite',
          title: back ? 'Received back at the yard' : 'Received on site', text: o.orderNumber || '' }));
      }
    });
    return out;
  }

  /** transfer-history rows -> moves between projects. */
  function fromTransfers(rows) {
    return listOf(rows).map(function (t) {
      var at = pick(t, ['transferDate', 'transferredDate', 'createdDate', 'creationDate']);
      var to = pick(t, ['toProjectName', 'destinationProjectName', 'toRequestNumber', 'destinationRequestNumber', 'targetRequestNumber']);
      var from = pick(t, ['fromProjectName', 'sourceProjectName', 'fromRequestNumber', 'sourceRequestNumber']);
      var status = up(pick(t, ['status', 'transferStatus']));
      return event({ at: at, kind: 'move', stage: 'onsite', title: to ? 'Moved to ' + to : 'Moved between projects',
        text: [from ? 'from ' + from : '', pick(t, ['serialNumber', 'equipmentName']) || '', status === 'FAILED' ? 'failed' : ''].filter(Boolean).join(' · '),
        who: pick(t, ['createdBy', 'transferredBy']) || '' });
    }).filter(function (e) { return e.ms != null; });
  }

  /** Quote history rows -> events (customer requests). */
  function fromQuotes(rows) {
    return listOf(rows).map(function (q) {
      var status = up(pick(q, ['status', 'quoteStatus']));
      var at = pick(q, ['acceptedDate', 'generatedDate', 'quoteDate', 'createdDate', 'creationDate']);
      var name = 'Quote' + (pick(q, ['quoteNumber', 'versionNumber', 'version']) != null ? ' ' + pick(q, ['quoteNumber', 'versionNumber', 'version']) : '');
      var title = status === 'ACCEPTED' || status === 'QUOTE_ACCEPTED' ? name + ' accepted'
        : (status === 'SUPERSEDED' || status === 'EXPIRED' ? name + ' replaced' : name + ' sent to the customer');
      return event({ at: at, kind: 'quote', stage: 'approval', title: title, text: pick(q, ['totalAmount', 'quoteTotal']) != null ? fmt.money(pick(q, ['totalAmount', 'quoteTotal'])) : '',
        who: pick(q, ['createdBy', 'generatedBy']) || '' });
    }).filter(function (e) { return e.ms != null; });
  }

  /** purchase-requisitions rows -> events. */
  function fromRequisitions(rows) {
    return listOf(rows).map(function (p) {
      var at = pick(p, ['createdDate', 'creationDate', 'requisitionDate']);
      return event({ at: at, kind: 'buy', stage: 'ready', title: 'Purchase requisition raised' + (p.requisitionNumber ? ' (' + p.requisitionNumber + ')' : ''),
        text: [pick(p, ['status', 'requisitionStatus']) ? 'status ' + String(pick(p, ['status', 'requisitionStatus'])).toLowerCase().replace(/_/g, ' ') : '',
          pick(p, ['poNumber']) ? 'PO ' + p.poNumber : ''].filter(Boolean).join(' · ') });
    }).filter(function (e) { return e.ms != null; });
  }

  function byTime(a, b) {
    if (a.ms == null && b.ms == null) return 0;
    if (a.ms == null) return 1;
    if (b.ms == null) return -1;
    return a.ms - b.ms;
  }

  /**
   * The history.
   *   o: { head: { status, external, createdDate, requestor, number }, lines: [{ lineStatus }], statusHistory, transferOrders,
   *        transfers, quotes, requisitions, failed: [names of the reads that failed], now }
   * Returns {
   *   milestones  [{ key, label, stage, state: done | partly | here | todo | stopped, reached, total, when, who, note }]
   *   events      everything, newest first: [{ when, kind, stage, title, text, who, recorded }]
   *   approvals   the approval history: sent, approved, sent back, quotes (oldest first)
   *   p           requestProgress.summarize, for the headline and the next step
   *   recorded    how many status changes the server recorded
   *   note        where it comes from, in words
   * }
   */
  function build(o) {
    var head = o.head || {};
    var external = !!head.external;
    var status = up(head.status);
    var lines = Array.isArray(o.lines) ? o.lines : [];
    var p = Progress.summarize(status, lines, { start: head.start, end: head.end, external: external, now: o.now });

    var recorded = fromStatusHistory(o.statusHistory, external);
    var events = recorded.slice();
    if (head.createdDate) {
      events.push(event({ at: head.createdDate, kind: 'created', stage: 'draft', milestone: 'created', title: 'Request created',
        text: head.number || '', who: head.requestor || '' }));
    }
    events = events.concat(fromTransferOrders(o.transferOrders), fromTransfers(o.transfers), fromQuotes(o.quotes), fromRequisitions(o.requisitions));
    events.sort(byTime);

    // How far each piece has come. A piece sent back or cancelled is left out of the counts (as requestProgress does).
    var active = lines.map(function (l) { return up(l.lineStatus || l.status || status); }).filter(function (c) { return !STOPPED[c]; });
    var reach = active.map(function (c) {
      var k = external && c === 'IN_PROCESS' ? 'submitted' : AT[c];
      return k != null ? INDEX[k] : 2;
    });
    if (!reach.length) {
      var own = external && status === 'IN_PROCESS' ? 'submitted' : AT[status];
      if (own != null) reach = [INDEX[own]];
    }
    var total = reach.length;
    var stopped = STOPPED[status] || (!total && lines.length);
    var stopEvent = recorded.filter(function (e) { return e.kind === 'stopped'; }).pop();

    var firstOpen = -1;
    var milestones = MILESTONES.map(function (m, i) {
      var reached = reach.filter(function (r) { return r >= i; }).length;
      // The first time this milestone was reached: a recorded change or a transfer order date for it.
      var hit = events.filter(function (e) { return e.milestone === m.key && e.ms != null; })[0] || null;
      var state;
      if (i === 0) state = 'done';
      else if (total && reached === total) state = 'done';
      else if (reached > 0) state = 'partly';
      else state = 'todo';
      if (state !== 'done' && firstOpen === -1) firstOpen = i;
      return { key: m.key, label: m.label, stage: m.stage, state: state, reached: reached, total: total,
        when: hit ? hit.when : '', who: hit ? hit.who : '', note: '' };
    });
    if (stopped) {
      var at = firstOpen === -1 ? milestones.length - 1 : firstOpen;
      milestones[at] = Object.assign({}, milestones[at], { state: 'stopped', label: status === 'CANCELLED' ? 'Cancelled' : 'Sent back',
        when: stopEvent ? stopEvent.when : '', who: stopEvent ? stopEvent.who : '', note: stopEvent ? stopEvent.text : '' });
      for (var j = at + 1; j < milestones.length; j++) milestones[j] = Object.assign({}, milestones[j], { state: 'skipped' });
    } else if (firstOpen !== -1) {
      var cur = milestones[firstOpen];
      cur.state = cur.state === 'partly' ? 'partly' : 'here';
      cur.note = p.next ? 'Next: ' + p.next.text : '';
    }
    milestones.forEach(function (m) {
      if (m.state === 'partly' && m.total > 1) m.count = m.reached + ' of ' + m.total;
      if ((m.state === 'done' || m.state === 'partly') && !m.when && m.key !== 'created') m.missing = true;
    });

    var approvals = events.filter(function (e) {
      return e.milestone === 'submitted' || e.milestone === 'approved' || e.kind === 'stopped' || e.kind === 'quote';
    });

    var failed = (o.failed || []).filter(Boolean);
    var note = recorded.length
      ? plural(recorded.length, 'status change') + ' recorded by EquipRite' + (events.length > recorded.length ? ', with the transfer orders and dates it keeps' : '')
      : 'No status changes were recorded on the server for this request; the steps come from its pieces of equipment, transfer orders and dates. A step without a date was not recorded.';
    if (failed.length) note += ' Not read: ' + failed.join(', ') + '.';

    return {
      milestones: milestones,
      events: events.slice().reverse(),
      approvals: approvals,
      p: p,
      recorded: recorded.length,
      note: note
    };
  }

  /**
   * Reads everything a request's history is made of, at once, and builds it. A read that fails leaves its part out
   * and is named in the note; nothing is written.
   *   o: { id, head (as build), lines (when already loaded), now }
   * @returns {Promise<history | { error }>}
   */
  async function load(context, Actions, o) {
    var id = Number(o && o.id);
    if (!id) return { error: 'This request has no id yet: open it from Requests.' };
    var get = function (endpoint, uriParams) {
      return Actions.callRest(context, { endpoint: endpoint, uriParams: uriParams })
        .then(function (r) { return r && r.ok ? { ok: true, body: r.body } : { ok: false }; })
        .catch(function () { return { ok: false }; });
    };
    var head = Object.assign({}, (o && o.head) || {});
    var res = await Promise.all([
      get('eqp-v1/getRequestStatusHistory', { requestId: id }),
      get('eqp-v1/getEquipriteV1EquipmentRequestById', { id: id }),
      o && Array.isArray(o.lines) && o.lines.length ? Promise.resolve({ ok: true, lines: o.lines })
        : get('eqp-v1/getEquipriteV1ViewsRequestDetailLines', { requestId: id, page: 0, size: 500 }),
      get('eqp-v1/getTransferOrders', { equipmentRequestId: id }),
      get('eqp-v1/getTransferHistory', { equipmentRequestId: id }),
      head.external ? get('eqp-v1/getQuoteHistory', { requestId: id }) : Promise.resolve({ ok: true, body: [] }),
      get('eqp-v1/getPurchaseRequisitions', { requestId: id, page: 0, size: 200 })
    ]);
    var header = res[1].ok && res[1].body ? res[1].body : {};
    var lines = res[2].lines || listOf(res[2].body);
    var first = lines[0] || {};
    head.status = head.status || first.requestStatus || header.status || '';
    head.number = head.number || first.requestNumber || header.requestNumber || '';
    head.requestor = head.requestor || header.requestorName || first.requestorName || '';
    head.createdDate = head.createdDate || header.createdDate || pick(header, ['creationDate', 'createdOn']) || '';
    head.start = head.start || String(first.requestedStartDate || header.requestedStartDate || '').slice(0, 10);
    head.end = head.end || String(first.requestedEndDate || header.requestedEndDate || '').slice(0, 10);
    var failed = [];
    if (!res[0].ok) failed.push('the status history');
    if (!res[2].ok) failed.push('the equipment');
    if (!res[3].ok) failed.push('the transfer orders');
    return build({
      head: head,
      lines: lines.map(function (l) {
        return { lineStatus: up(pick(l, ['lineStatus', 'status'])) || up(l.requestStatus), start: l.start || l.startDate, end: l.end || l.endDate };
      }),
      statusHistory: res[0].ok ? res[0].body : [],
      transferOrders: res[3].ok ? res[3].body : [],
      transfers: res[4].ok ? res[4].body : [],
      quotes: res[5].ok ? res[5].body : [],
      requisitions: res[6].ok ? res[6].body : [],
      failed: failed,
      now: o && o.now
    });
  }

  return {
    MILESTONES: MILESTONES,
    build: build,
    load: load,
    fromStatusHistory: fromStatusHistory,
    fromTransferOrders: fromTransferOrders,
    msOf: msOf
  };
});
