define(['resources/js/fmt', 'resources/js/requestProgress'], function (fmt, Progress) {
  'use strict';

  // Transfers in EquipRite Next (FDD 7.16, 7.16A, S13, S26, S28): every transfer order EquipRite keeps, read as a person
  // asks about it: what is moving, from where to where, where it is now, and what is late.
  //
  //   OUTBOUND       yard -> site (Initiate picking, INT-04)        "Out to site"
  //   INBOUND        site -> yard (the return leg)                  "Back to the yard"
  //   INTER_PROJECT  site -> site, request to request (7.16A)       "Between projects"
  //
  // Where it is comes from the equipment, not from the order's stored status: the backend does not move orderStatus on
  // release (New EquipRite, picking ReleaseTransferOrderChain), so an order would read "PENDING" while its units are on
  // site. Each unit is placed by its request line's status (requestProgress words); an inter-project transfer by its
  // transfer-history status (PENDING -> COMPLETED / POSTED, or FAILED, as New EquipRite records it). Late is said only
  // when the units were read, never from a stored status alone. Display only: nothing here writes.

  var DAY = 86400000;
  var KINDS = {
    OUTBOUND: { key: 'out', label: 'Out to site', due: 'Due on site', newNav: 'picking' },
    INBOUND: { key: 'back', label: 'Back to the yard', due: 'Due back at the yard', newNav: 'returns' },
    INTER_PROJECT: { key: 'between', label: 'Between projects', due: 'Transfer date', newNav: 'transfers' }
  };
  var KIND_ORDER = ['out', 'back', 'between'];

  // Where a unit on each kind of order is, by its request line status.
  var LEGS = {
    out: {
      waiting: ['IN_PROCESS', 'APPROVED', 'ALLOCATED', 'QUOTE_ACCEPTED', 'UNDER_PROCUREMENT', 'SCHEDULED_FOR_PICKING', 'PICK_INITIATED',
        'PICK_RELEASED', 'EQP_INSPECTION_COMPLETE'],
      moving: ['SHIP_TO_SITE', 'SHIPPED'],
      arrived: ['DELIVERED', 'DEPLOYED', 'RETURN_INITIATED', 'RETURN_IN_PROCESS', 'SHIPPED_TO_YARD', 'RETURNED', 'CLOSED', 'CONSUMED'],
      stopped: ['INSPECTION_FAILED', 'CANCELLED', 'REJECTED', 'DECLINED']
    },
    back: {
      waiting: ['DELIVERED', 'DEPLOYED', 'RETURN_INITIATED'],
      moving: ['RETURN_IN_PROCESS', 'SHIPPED_TO_YARD'],
      arrived: ['RETURNED', 'CLOSED'],
      stopped: ['CANCELLED', 'REJECTED', 'DECLINED']
    }
  };
  var RANK = { stopped: 0, waiting: 1, moving: 2, arrived: 3 };
  // The order a list sorted by "where it is" reads in: what needs someone first.
  var STATE_ORDER = { stopped: 0, waiting: 1, moving: 2, arrived: 3, unread: 4, cancelled: 5 };
  var STATE_CHIPS = [
    { key: 'waiting', label: 'Not left yet' },
    { key: 'moving', label: 'On the way' },
    { key: 'arrived', label: 'Arrived' },
    { key: 'stopped', label: 'Stopped' }
  ];
  var HISTORY_DONE = { COMPLETED: true, POSTED: true };

  function up(v) { return String(v == null ? '' : v).trim().toUpperCase(); }
  function low(v) { return String(v == null ? '' : v).trim().toLowerCase(); }
  function has(v) { return v !== null && v !== undefined && v !== ''; }
  function iso(v) { return v ? String(v).slice(0, 10) : ''; }
  function words(code) {
    var s = up(code);
    return s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ') : '';
  }
  function rows(body) {
    return Array.isArray(body) ? body : ((body && Array.isArray(body.data)) ? body.data : []);
  }

  function kindOf(type) {
    return KINDS[up(type)] || { key: 'other', label: words(type) || 'Transfer', due: 'Due', newNav: '' };
  }

  // ── The same rules as New EquipRite's transfers page (flows/operations/pages/transfers-page.js); the unit test holds
  //    them equal to New's: an org's name, a history row, its status words, the inter-project switch. ──────────────

  /** Org id -> "TEXAS · Texas project sites" from inv-orgs rows, 'Org 300…' when unknown, 'not known' without one. */
  function orgText(invOrgs, orgId) {
    if (!has(orgId)) return 'not known';
    var o = (Array.isArray(invOrgs) ? invOrgs : []).filter(function (x) {
      return Number(x.organizationId) === Number(orgId) || Number(x.invOrgId) === Number(orgId);
    })[0];
    return o ? [o.organizationCode, o.organizationName].filter(Boolean).join(' · ') : 'Org ' + orgId;
  }

  /** A transfer-history status in words. */
  function historyStatusText(s) {
    return { PENDING: 'Pending', COMPLETED: 'Completed', POSTED: 'Completed', FAILED: 'Failed', CANCELLED: 'Cancelled' }[up(s)] || (s ? String(s) : '');
  }

  /** Transfer-history rows for display, newest first: [{ id, date, equipment, from, to, ref, status, by }]. */
  function historyRows(list, limit) {
    var out = (Array.isArray(list) ? list : []).filter(Boolean).map(function (h) {
      return {
        id: h.id,
        sort: String(h.transferDate || h.createdDate || ''),
        date: fmt.date(h.transferDate || h.createdDate),
        equipment: (h.equipmentName || '') + (h.serialNumber ? ' · ' + h.serialNumber : ''),
        from: (h.sourceRequestNumber || (has(h.sourceRequestId) ? 'Request ' + h.sourceRequestId : '')) + (h.sourceProjectName ? ' ' + h.sourceProjectName : ''),
        to: (h.destinationRequestNumber || (has(h.destinationRequestId) ? 'Request ' + h.destinationRequestId : '')) + (h.destinationProjectName ? ' ' + h.destinationProjectName : ''),
        ref: h.orderNumber || h.fusionTransferNumber || (has(h.transferOrderId) ? 'TO ' + h.transferOrderId : ''),
        status: up(h.transferStatus || h.status) || 'PENDING',
        by: h.transferredBy || h.createdBy || ''
      };
    });
    out.sort(function (a, b) { return b.sort.localeCompare(a.sort) || (Number(b.id) - Number(a.id)); });
    return limit ? out.slice(0, limit) : out;
  }

  /** True only when the flag is loaded and explicitly off (the FDD default for ENABLE_INTER_PROJECT_TRANSFER is Yes). */
  function interProjectOff(flags, loaded) {
    return !!(loaded && flags && String(flags.ENABLE_INTER_PROJECT_TRANSFER || '').toLowerCase() === 'false');
  }

  // ── A unit and an order ─────────────────────────────────────────────────────────────────────────────────────────

  /** Where one unit on an order of this kind is: { key, words, stage }. */
  function unitState(kind, lineStatus) {
    var s = up(lineStatus);
    var leg = LEGS[kind];
    if (!leg || !s) return { key: 'unknown', words: s ? Progress.line(s).label : 'Not known', stage: 'draft' };
    var key = ['waiting', 'moving', 'arrived', 'stopped'].filter(function (k) { return leg[k].indexOf(s) !== -1; })[0] || 'unknown';
    var text;
    if (kind === 'out') {
      text = { moving: 'On the way to site', arrived: 'Arrived on site' }[key]
        || (s === 'INSPECTION_FAILED' ? 'Failed inspection at the yard' : Progress.line(s).label);
    } else {
      text = { moving: s === 'RETURN_IN_PROCESS' ? 'Being returned' : 'On the way back to the yard', arrived: 'Back at the yard' }[key]
        || (s === 'RETURN_INITIATED' ? 'Return asked for, waiting for pickup' : (key === 'waiting' ? 'Waiting for pickup at site' : Progress.line(s).label));
    }
    return { key: key, words: text, stage: stageOf(kind, key) };
  }

  function stageOf(kind, key) {
    if (key === 'stopped') return 'stopped';
    if (key === 'cancelled' || key === 'unread' || key === 'unknown') return key === 'cancelled' ? 'done' : 'draft';
    if (kind === 'back') return key === 'arrived' ? 'done' : 'back';
    if (kind === 'between') return key === 'arrived' ? 'onsite' : 'ready';
    return { waiting: 'ready', moving: 'out', arrived: 'onsite' }[key] || 'draft';
  }

  var COUNT_WORDS = {
    out: { waiting: 'not left yet', moving: 'on the way', arrived: 'arrived', stopped: 'stopped' },
    back: { waiting: 'not picked up yet', moving: 'on the way back', arrived: 'back', stopped: 'stopped' }
  };

  /** An order's state from its units: the least advanced unit names it; a stopped unit comes first. */
  function stateFromUnits(kind, units) {
    var known = units.filter(function (u) { return u.state.key !== 'unknown'; });
    if (!known.length) return null;
    var least = known.slice().sort(function (a, b) { return RANK[a.state.key] - RANK[b.state.key]; })[0];
    var key = least.state.key;
    var label;
    if (key === 'stopped') label = least.state.words;
    else if (key === 'waiting') label = least.state.words;
    else if (kind === 'out') label = key === 'moving' ? 'On the way to site' : 'Arrived on site';
    else label = key === 'moving' ? 'On the way back to the yard' : 'Back at the yard';
    var counts = {};
    known.forEach(function (u) { counts[u.state.key] = (counts[u.state.key] || 0) + 1; });
    var detail = Object.keys(counts).length > 1
      ? ['arrived', 'moving', 'waiting', 'stopped'].filter(function (k) { return counts[k]; })
        .map(function (k) { return counts[k] + ' ' + COUNT_WORDS[kind][k]; }).join(' · ')
      : '';
    return { key: key, label: label, stage: stageOf(kind, key), detail: detail };
  }

  /** The units of an order: its transfer-order lines, each placed by its request line. */
  function unitsOf(kind, toLines, lineById) {
    return (Array.isArray(toLines) ? toLines : []).map(function (tl) {
      var l = (lineById || {})[String(tl.requestLineId)] || {};
      var st = unitState(kind, l.lineStatus);
      return {
        requestLineId: tl.requestLineId,
        lineNumber: tl.lineNumber,
        name: l.equipmentName || tl.itemNumber || 'Equipment',
        cls: l.className || '',
        serial: tl.serialNumber || l.allocatedSerial || '',
        qty: Number(tl.quantity) || Number(l.quantity) || 1,
        lineStatus: up(l.lineStatus),
        toLineStatus: up(tl.lineStatus),
        state: st
      };
    });
  }

  /** The units of an inter-project transfer: its history rows (one per unit, readable on both requests). */
  function unitsOfHistory(hist) {
    return hist.map(function (h) {
      var s = up(h.transferStatus || h.status) || 'PENDING';
      return {
        requestLineId: h.destinationRequestLineId,
        lineNumber: null,
        name: h.equipmentName || 'Equipment',
        cls: '',
        serial: h.serialNumber || '',
        qty: Number(h.quantity) || 1,
        lineStatus: '',
        toLineStatus: s,
        state: { key: HISTORY_DONE[s] ? 'arrived' : (s === 'FAILED' ? 'stopped' : (s === 'CANCELLED' ? 'cancelled' : 'waiting')), words: historyStatusText(s), stage: '' }
      };
    });
  }

  function what(units) {
    if (!units.length) return '';
    var first = units[0].name + (units[0].serial ? ' · ' + units[0].serial : '');
    return units.length > 1 ? first + ' +' + (units.length - 1) : first;
  }

  /**
   * One transfer order in words. ctx: { orgs, requests: { id: { number, party } }, toLines: { orderId: rows },
   * lines: { requestLineId: row }, history: rows, now }. An order whose lines were not read (not in ctx.toLines)
   * shows its stored dates and status only, and is never called late.
   */
  function decorate(order, ctx) {
    var c = ctx || {};
    var o = order || {};
    var kind = kindOf(o.orderType);
    var id = o.id;
    var stored = up(o.orderStatus);
    var req = (c.requests || {})[String(o.equipmentRequestId)] || {};
    var hist = (Array.isArray(c.history) ? c.history : []).filter(function (h) {
      return h && ((has(id) && has(h.transferOrderId) && Number(h.transferOrderId) === Number(id)) || (o.orderNumber && h.orderNumber === o.orderNumber));
    });
    var units = [];
    var read = false;
    if (kind.key === 'between') {
      units = unitsOfHistory(hist);
      read = hist.length > 0;
    } else if (c.toLines && Object.prototype.hasOwnProperty.call(c.toLines, String(id))) {
      units = unitsOf(kind.key, c.toLines[String(id)], c.lines);
      read = true;
    }

    var st = null;
    if (stored === 'CANCELLED' || stored === 'CANCELED') st = { key: 'cancelled', label: 'Cancelled', stage: 'done', detail: '' };
    else if (stored === 'FAILED') st = { key: 'stopped', label: 'Failed in Fusion: retry it in New EquipRite', stage: 'stopped', detail: '' };
    else if (kind.key === 'between' && read) {
      var hs = up(hist[0].transferStatus || hist[0].status) || 'PENDING';
      st = HISTORY_DONE[hs] ? { key: 'arrived', label: 'Moved to the new project', stage: 'onsite', detail: '' }
        : (hs === 'FAILED' ? { key: 'stopped', label: 'Failed in Fusion: retry it in New EquipRite', stage: 'stopped', detail: '' }
          : (hs === 'CANCELLED' ? { key: 'cancelled', label: 'Cancelled', stage: 'done', detail: '' }
            : { key: 'waiting', label: 'Waiting for the inter-org transfer in Fusion', stage: 'ready',
              detail: 'The units stay on ' + (hist[0].sourceRequestNumber || 'their request') + ' until it completes' }));
    } else if (read) {
      st = stateFromUnits(kind.key, units) || { key: 'unread', label: units.length ? 'Where it is is not known' : 'No equipment on this order', stage: 'draft', detail: '' };
    }
    if (!st) {
      // Not read: the stored dates say what they can; nothing is called late.
      if (o.receivedDate) st = { key: 'arrived', label: 'Received ' + fmt.date(o.receivedDate), stage: stageOf(kind.key, 'arrived'), detail: '' };
      else if (o.shippedDate) st = { key: 'moving', label: 'Shipped ' + fmt.date(o.shippedDate), stage: stageOf(kind.key, 'moving'), detail: '' };
      else st = { key: 'unread', label: 'Open it to see where it is', stage: 'draft', detail: '' };
    }

    var due = kind.key === 'between' && hist.length ? iso(hist[0].transferDate) || iso(o.requestedDate) : iso(o.needByDate) || iso(o.requestedDate);
    var today = fmt.today(c.now);
    var lateDays = 0;
    if (due && read && (st.key === 'waiting' || st.key === 'moving')) {
      var d = Math.round((today - fmt.dayMs(due)) / DAY);
      if (d > 0) lateDays = d;
    }
    var lateText = '';
    if (lateDays) {
      lateText = kind.key === 'between'
        ? 'Transfer date ' + fmt.date(due, false) + ' · waiting ' + fmt.count(lateDays, 'day') + ' for Fusion'
        : kind.due + ' ' + fmt.date(due, false) + ' · ' + fmt.count(lateDays, 'day') + ' late';
    }
    var dueText = '';
    if (st.key === 'arrived' && o.receivedDate) dueText = 'Received ' + fmt.date(o.receivedDate);
    else if (due && st.key !== 'cancelled') dueText = kind.due + ' ' + fmt.date(due) + (st.key === 'arrived' ? '' : ' (' + fmt.relative(due, c.now) + ')');

    var h0 = hist[0] || {};
    var fromId = has(o.sourceOrgId) ? o.sourceOrgId : h0.sourceOrgId;
    var toId = has(o.destinationOrgId) ? o.destinationOrgId : h0.destinationOrgId;
    var requestNumber = req.number || (kind.key === 'between' ? h0.destinationRequestNumber : '') || (has(o.equipmentRequestId) ? 'Request ' + o.equipmentRequestId : '');
    var party = req.party || (kind.key === 'between' ? h0.destinationProjectName : '') || '';
    var fromRequest = kind.key === 'between' && hist.length ? [h0.sourceRequestNumber, h0.sourceProjectName].filter(Boolean).join(' · ') : '';
    var row = {
      id: id,
      key: (o.synthetic ? 'h:' : 'to:') + (has(id) ? id : o.orderNumber),
      synthetic: !!o.synthetic,
      number: o.orderNumber || (has(id) ? 'Transfer ' + id : 'Transfer'),
      type: up(o.orderType),
      kind: kind.key,
      kindLabel: kind.label,
      newNav: kind.newNav,
      requestId: has(o.equipmentRequestId) ? Number(o.equipmentRequestId) : null,
      requestNumber: requestNumber,
      party: party,
      fromRequest: fromRequest,
      sourceRequestId: h0.sourceRequestId != null ? Number(h0.sourceRequestId) : null,
      sourceRequestNumber: h0.sourceRequestNumber || '',
      fromId: fromId,
      toId: toId,
      from: orgText(c.orgs, fromId),
      to: orgText(c.orgs, toId),
      units: units,
      unitCount: units.length,
      what: what(units),
      read: read,
      state: st.key,
      label: st.label,
      stage: st.stage,
      detail: st.detail,
      due: due,
      dueText: dueText,
      late: lateDays > 0,
      lateDays: lateDays,
      lateText: lateText,
      requested: iso(o.requestedDate),
      needBy: iso(o.needByDate),
      shipped: iso(o.shippedDate),
      received: iso(o.receivedDate),
      created: iso(o.createdDate),
      carrier: o.carrierName || '',
      tracking: o.trackingNumber || '',
      notes: o.shippingNotes || '',
      storedStatus: stored
    };
    row.route = row.from + ' → ' + row.to;
    row.hay = [row.number, row.kindLabel, row.requestNumber, row.party, row.fromRequest, row.from, row.to, row.carrier, row.tracking]
      .concat(units.map(function (u) { return u.name + ' ' + u.serial; })).map(low).join(' ');
    return row;
  }

  /** Inter-project transfers on record without a transfer order to show (history only), as orders of their own. */
  function historyOnly(orders, history) {
    var known = {};
    (Array.isArray(orders) ? orders : []).forEach(function (o) {
      if (o && has(o.id)) known['id:' + Number(o.id)] = true;
      if (o && o.orderNumber) known['n:' + o.orderNumber] = true;
    });
    var out = [];
    var seen = {};
    (Array.isArray(history) ? history : []).forEach(function (h) {
      if (!h) return;
      var k = has(h.transferOrderId) ? 'id:' + Number(h.transferOrderId) : (h.orderNumber ? 'n:' + h.orderNumber : 'h:' + h.id);
      if (known[k] || (h.orderNumber && known['n:' + h.orderNumber]) || seen[k]) return;
      seen[k] = true;
      out.push({
        id: has(h.transferOrderId) ? Number(h.transferOrderId) : null,
        orderNumber: h.orderNumber || '',
        orderType: 'INTER_PROJECT',
        orderStatus: '',
        equipmentRequestId: h.destinationRequestId,
        sourceOrgId: h.sourceOrgId,
        destinationOrgId: h.destinationOrgId,
        requestedDate: h.transferDate,
        createdDate: h.createdDate || h.transferDate,
        synthetic: true
      });
    });
    return out;
  }

  /** The orders whose units to read on the list: open ones (not cancelled, not received), newest first, at most max. */
  function toRead(orders, max) {
    return (Array.isArray(orders) ? orders : [])
      .filter(function (o) {
        var s = up(o && o.orderStatus);
        return o && has(o.id) && !o.synthetic && kindOf(o.orderType).key !== 'between' && s !== 'CANCELLED' && s !== 'CANCELED' && !o.receivedDate;
      })
      .sort(function (a, b) { return String(b.createdDate || '').localeCompare(String(a.createdDate || '')) || (Number(b.id) - Number(a.id)); })
      .slice(0, max || 60);
  }

  /** request-detail-lines rows -> { requestLineId: row }. */
  function indexLines(list) {
    var out = {};
    (Array.isArray(list) ? list : []).forEach(function (l) {
      var k = l && (l.lineId != null ? l.lineId : l.id);
      if (k != null) out[String(k)] = l;
    });
    return out;
  }

  /** views/my-requests rows -> { id: { number, party } }. */
  function indexRequests(list) {
    var out = {};
    (Array.isArray(list) ? list : []).forEach(function (r) {
      if (!r || r.eqrEquipmentRequestId == null) return;
      out[String(r.eqrEquipmentRequestId)] = { number: r.requestNumber || '', party: r.projectName || r.customerName || r.projectOrCustomer || '' };
    });
    return out;
  }

  // ── The list ───────────────────────────────────────────────────────────────────────────────────────────────────

  function chips(list) {
    var all = Array.isArray(list) ? list : [];
    var out = [{ key: 'all', label: 'All', count: all.length },
      { key: 'late', label: 'Late', count: all.filter(function (r) { return r.late; }).length }];
    STATE_CHIPS.forEach(function (c) {
      out.push({ key: c.key, label: c.label, count: all.filter(function (r) { return r.state === c.key; }).length });
    });
    return out;
  }

  function kinds(list) {
    var all = Array.isArray(list) ? list : [];
    return [{ key: 'all', label: 'Every kind', count: all.length }].concat(KIND_ORDER.map(function (k) {
      var lab = { out: 'Out to site', back: 'Back to the yard', between: 'Between projects' }[k];
      return { key: k, label: lab, count: all.filter(function (r) { return r.kind === k; }).length };
    }));
  }

  function filter(list, chip, kind, text) {
    var q = low(text);
    return (Array.isArray(list) ? list : []).filter(function (r) {
      if (chip === 'late' && !r.late) return false;
      if (chip && chip !== 'all' && chip !== 'late' && r.state !== chip) return false;
      if (kind && kind !== 'all' && r.kind !== kind) return false;
      return !q || r.hay.indexOf(q) !== -1;
    });
  }

  function open(r) { return r.state === 'waiting' || r.state === 'moving' || r.state === 'stopped'; }

  /** Sort: due (what is still open first, then by the date: most overdue first ascending), number, request, state. */
  function sort(list, key, dir) {
    var sign = dir === 'desc' ? -1 : 1;
    var cmp = {
      due: function (a, b) {
        return (Number(open(b)) - Number(open(a))) || sign * String(a.due || '9999').localeCompare(String(b.due || '9999'));
      },
      number: function (a, b) { return sign * String(a.number).localeCompare(String(b.number), undefined, { numeric: true }); },
      request: function (a, b) { return sign * String(a.requestNumber).localeCompare(String(b.requestNumber), undefined, { numeric: true }); },
      state: function (a, b) { return sign * (STATE_ORDER[a.state] - STATE_ORDER[b.state]); }
    }[key] || function () { return 0; };
    return (Array.isArray(list) ? list : []).slice().sort(function (a, b) {
      return cmp(a, b) || String(b.created).localeCompare(String(a.created)) || (Number(b.id) - Number(a.id));
    });
  }

  /** "12 transfers · 4 not left yet · 3 on the way · 2 late". */
  function summary(list) {
    var all = Array.isArray(list) ? list : [];
    if (!all.length) return 'No transfers';
    var parts = [fmt.count(all.length, 'transfer')];
    var n = function (k) { return all.filter(function (r) { return r.state === k; }).length; };
    if (n('waiting')) parts.push(n('waiting') + ' not left yet');
    if (n('moving')) parts.push(n('moving') + ' on the way');
    if (n('stopped')) parts.push(n('stopped') + ' stopped');
    var late = all.filter(function (r) { return r.late; }).length;
    if (late) parts.push(late + ' late');
    return parts.join(' · ');
  }

  function exportColumns() {
    return [
      { key: 'number', label: 'Transfer' },
      { key: 'kindLabel', label: 'Kind' },
      { key: 'requestNumber', label: 'Request' },
      { key: 'party', label: 'Project or customer' },
      { key: 'fromRequest', label: 'From request' },
      { key: 'from', label: 'From' },
      { key: 'to', label: 'To' },
      { key: 'what', label: 'What is moving', value: function (r) { return r.units.map(function (u) { return u.name + (u.serial ? ' · ' + u.serial : ''); }).join('; '); } },
      { key: 'unitCount', label: 'Units', type: 'number', value: function (r) { return r.read ? r.unitCount : ''; } },
      { key: 'label', label: 'Where it is' },
      { key: 'detail', label: 'Detail' },
      { key: 'due', label: 'Due' },
      { key: 'lateDays', label: 'Days late', type: 'number', value: function (r) { return r.late ? r.lateDays : ''; } },
      { key: 'requested', label: 'Requested' },
      { key: 'needBy', label: 'Need by' },
      { key: 'shipped', label: 'Shipped' },
      { key: 'received', label: 'Received' },
      { key: 'carrier', label: 'Carrier' },
      { key: 'tracking', label: 'Tracking' },
      { key: 'storedStatus', label: 'Stored order status' }
    ];
  }

  return {
    KINDS: KINDS,
    kindOf: kindOf,
    orgText: orgText,
    historyStatusText: historyStatusText,
    historyRows: historyRows,
    interProjectOff: interProjectOff,
    unitState: unitState,
    stateFromUnits: stateFromUnits,
    unitsOf: unitsOf,
    decorate: decorate,
    historyOnly: historyOnly,
    toRead: toRead,
    indexLines: indexLines,
    indexRequests: indexRequests,
    rows: rows,
    chips: chips,
    kinds: kinds,
    filter: filter,
    sort: sort,
    summary: summary,
    exportColumns: exportColumns
  };
});
