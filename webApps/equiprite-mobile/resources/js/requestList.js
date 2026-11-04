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
        // A line removed before anyone decided it (CANCELLED, Edit request) is no longer a piece of the request.
        pieces: lines.filter(function (l) { return up(l.lineStatus || l.status) !== 'CANCELLED'; })
          .reduce(function (s, l) { return s + (Number(l.qty) || 1); }, 0) || (lines.length ? 0 : Number(r.lines) || 0),
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

  // A piece with its unit assigned waits for the Equipment Manager to confirm it for picking: Confirm creates its
  // transfer order in Fusion and schedules it for picking (Old EquipRite's request detail, New's Workbench). Only then
  // is it in the yard's queue: the pieces the yard can pick are those confirmed or being picked, not shipped yet (the
  // Picking & shipping workspace's own statuses, openWorkChain).
  var CONFIRMABLE = ['ALLOCATED'];
  var PICKABLE = ['SCHEDULED_FOR_PICKING', 'PICK_INITIATED', 'PICK_RELEASED', 'EQP_INSPECTION_COMPLETE'];
  var APPROVED_HEADERS = ['IN_PROCESS', 'APPROVED', 'ALLOCATED', 'QUOTE_ACCEPTED'];
  // On its way to site: the site accepts the delivery (acceptDelivery).
  var ACCEPTABLE = ['SHIP_TO_SITE'];

  // The road from approval to site, as the "Get it to site" popup draws it: each step, who takes it, its statuses.
  var YARD_STEPS = [
    { key: 'assign', label: 'Unit to assign', who: 'Equipment Manager assigns a unit (Approve & allocate)', statuses: ['IN_PROCESS', 'APPROVED', 'QUOTE_ACCEPTED'] },
    { key: 'confirm', label: 'Unit assigned', who: 'Equipment Manager confirms it for picking: the transfer order is created in Fusion', statuses: CONFIRMABLE },
    { key: 'pick', label: 'Waiting to be picked', who: 'Yard releases it for picking (Picking & shipping)', statuses: ['SCHEDULED_FOR_PICKING'] },
    { key: 'picking', label: 'Being picked', who: 'Yard picks and ships it (Picking & shipping)', statuses: ['PICK_INITIATED', 'PICK_RELEASED', 'EQP_INSPECTION_COMPLETE'] },
    { key: 'shipped', label: 'On the way to site', who: 'Site accepts the delivery', statuses: ['SHIP_TO_SITE'] }
  ];

  /**
   * Where each piece of a request is on its road to site: the five steps with how many pieces sit at each (the one most
   * behind is "now"), and each piece with its unit and where it is. Pieces before approval or already on site are
   * counted apart (before, beyond).
   */
  function yardJourney(lines) {
    var steps = YARD_STEPS.map(function (s) { return { key: s.key, label: s.label, who: s.who, count: 0, pieces: [] }; });
    var before = 0;
    var beyond = 0;
    (lines || []).forEach(function (l) {
      var st = up(l.lineStatus);
      var i = -1;
      YARD_STEPS.forEach(function (s, k) { if (s.statuses.indexOf(st) !== -1) i = k; });
      if (i === -1) {
        if (['DRAFT', 'SUBMITTED', 'QUOTE_GENERATED'].indexOf(st) !== -1) before += 1;
        else if (['REJECTED', 'CANCELLED', 'DECLINED'].indexOf(st) === -1) beyond += 1;
        return;
      }
      steps[i].count += 1;
      // A serial is not in every view: past "unit to assign" the unit is there even when its serial is not shown (at
      // "Unit assigned" its step already says so).
      steps[i].pieces.push({ key: String(l.key || l.name) + ':' + i, name: l.name || 'Equipment', unit: l.serial || '', step: steps[i].key, label: steps[i].label,
        unitText: l.serial ? 'Unit ' + l.serial : (i === 0 ? 'No unit yet' : i === 1 ? '' : 'Unit assigned') });
    });
    var at = -1;
    steps.forEach(function (s, k) { if (at === -1 && s.count > 0) at = k; });
    var now = at === -1 ? null : steps[at];
    steps.forEach(function (s, k) { s.state = at === -1 ? 'todo' : k === at ? 'now' : k < at ? 'past' : s.count ? 'also' : 'todo'; });
    return { steps: steps, pieces: [].concat.apply([], steps.map(function (s) { return s.pieces; })), now: now ? now.key : '', before: before, beyond: beyond,
      assign: steps[0].count, confirm: steps[1].count, pick: steps[2].count + steps[3].count, shipped: steps[4].count };
  }

  /**
   * The steps a request's row offers, each only to those whose access lets them take it:
   *   approve  it waits for a decision (Approve & allocate's queue says 'decide'); can.decide: EQR_WORKBENCH FULL
   *   assign   approved, units still to assign (the queue says 'allocate'); can.assign: EQR_WORKBENCH not hidden
   *   confirm  pieces with their unit assigned, waiting for the Equipment Manager to confirm them for picking (creates
   *            the transfer order in Fusion), how many; can.assign: EQR_WORKBENCH not hidden
   *   pick     pieces in the yard's queue (confirmed, or being picked), how many; can.pick: EQR_INITIATE_PICKING not hidden
   *   accept   pieces on their way to site, for the site to accept, how many; can.accept: may accept a delivery
   *   item: a decorated request; lines: its lines; queueKind: approvalQueue.build's kind for it ('' when not queued).
   */
  function actions(item, lines, queueKind, can) {
    var c = can || {};
    var status = up(item && (item.status || item.requestStatus));
    var approved = APPROVED_HEADERS.indexOf(status) !== -1;
    var count = function (set, ok) { return ok ? (lines || []).filter(function (l) { return set.indexOf(up(l.lineStatus)) !== -1; }).length : 0; };
    return {
      approve: queueKind === 'decide' && !!c.decide,
      assign: queueKind === 'allocate' && !!c.assign,
      confirm: c.assign ? count(CONFIRMABLE, approved) : 0,
      pick: c.pick ? count(PICKABLE, approved) : 0,
      // A request already marked Deployed can still have a piece on its way (one shipped later).
      accept: c.accept ? count(ACCEPTABLE, approved || status === 'DEPLOYED') : 0
    };
  }

  // The Redwood look's status badge per stage: Oracle's own oj-badge classes (Redwood theme), not Next's colours.
  var BADGE = {
    draft: 'oj-badge oj-badge-subtle', approval: 'oj-badge oj-badge-info oj-badge-subtle', ready: 'oj-badge oj-badge-warning oj-badge-subtle',
    out: 'oj-badge oj-badge-info', onsite: 'oj-badge oj-badge-success oj-badge-subtle', back: 'oj-badge oj-badge-info oj-badge-subtle',
    done: 'oj-badge oj-badge-subtle', stopped: 'oj-badge oj-badge-danger oj-badge-subtle'
  };

  /** Where today is in the rental: "Starts in 5 days", "Ends today", "Ended 3 days ago". */
  function whenText(start, end, now) {
    var t = fmt.today(now);
    var s = fmt.dayMs(start);
    var e = fmt.dayMs(end);
    if (s != null && t < s) return 'Starts ' + fmt.relative(start, now);
    if (e != null && t <= e) return 'Ends ' + fmt.relative(end, now);
    if (e != null) return 'Ended ' + fmt.relative(end, now);
    return '';
  }

  /**
   * The Redwood look (requests page, oj-table): one flat row per request shown, with what each cell says and the steps
   * the row offers (actions, as on the current look), so the template binds plain values only.
   */
  function redwoodRows(shown, now) {
    return (Array.isArray(shown) ? shown : []).map(function (r) {
      var p = r.p || {};
      var a = r.acts || {};
      var steps = [];
      if (a.approve) steps.push({ act: 'approve', label: 'Approve', chroming: 'callToAction' });
      if (a.assign) steps.push({ act: 'assign', label: 'Assign units', chroming: 'outlined' });
      if (a.confirm > 0) steps.push({ act: 'confirm', label: 'Confirm ' + a.confirm, chroming: 'outlined' });
      if (a.pick > 0) steps.push({ act: 'pick', label: 'Pick ' + a.pick, chroming: 'outlined' });
      if (a.accept > 0) steps.push({ act: 'accept', label: 'Accept ' + a.accept, chroming: 'outlined' });
      return {
        key: String(r.eqrEquipmentRequestId != null ? r.eqrEquipmentRequestId : r.requestNumber),
        number: String(r.requestNumber || ''),
        type: r.external ? 'Customer' : 'Project',
        party: r.party || '—',
        task: r.taskName || (r.partyFor ? 'for ' + r.partyFor : ''),
        status: p.headline || '',
        badge: BADGE[p.tone] || BADGE.draft,
        late: p.late && p.late.length ? p.late[0].text : '',
        pieces: r.pieces ? fmt.count(r.pieces, 'piece') + (p.detail ? ' · ' + p.detail : '') : '',
        dates: r.dates || '',
        when: whenText(r.startDate, r.endDate, now),
        next: p.next ? p.next.text : '',
        requester: r.requestorName || r.contactName || '—',
        steps: steps
      };
    });
  }

  // The Redwood look's Smart Search filters, one per column as Redwood shows them (Request, Project or customer,
  // Status, Equipment, Dates, Next step) and the request's Type and Requester: each offers what the requests hold, with
  // how many requests have it. Status and Type are the page's own stage and source; the rest are byColumns'.
  var DATE_WINDOWS = [
    { key: 'now', label: 'On rent now' },
    { key: 'starting', label: 'Starting in the next 7 days' },
    { key: 'later', label: 'Starting later' },
    { key: 'ending', label: 'Ending in the next 7 days' },
    { key: 'ended', label: 'Ended' }
  ];
  var NOBODY = 'Nothing to do';
  var WEEK_MS = 7 * 86400000;

  /** Which date windows a request's rental falls in (DATE_WINDOWS keys). */
  function dateKeys(r, now) {
    var t = fmt.today(now);
    var s = fmt.dayMs(r && r.startDate);
    var e = fmt.dayMs(r && r.endDate);
    var keys = [];
    if (s != null && t < s) keys.push(s - t <= WEEK_MS ? 'starting' : 'later');
    if ((s == null || s <= t) && e != null && t <= e) {
      keys.push('now');
      if (e - t <= WEEK_MS) keys.push('ending');
    }
    if (e != null && e < t) keys.push('ended');
    return keys;
  }
  function equipmentNames(r, linesByRequest) {
    var seen = {};
    return ((linesByRequest || {})[r.requestNumber] || []).map(function (l) { return String(l.name || '').trim(); })
      .filter(function (n) { if (!n || seen[n]) return false; seen[n] = true; return true; });
  }
  function nextWho(r) { return r && r.p && r.p.next && r.p.next.who ? r.p.next.who : NOBODY; }
  function requesterOf(r) { return String((r && (r.requestorName || r.contactName)) || '').trim(); }

  // Options with their counts, by label: [{ value, label: 'Pier B (3)' }].
  function tally(items, valuesOf) {
    var counts = {};
    (items || []).forEach(function (r) { valuesOf(r).forEach(function (v) { if (v) counts[v] = (counts[v] || 0) + 1; }); });
    return Object.keys(counts).sort(function (a, b) { return a.localeCompare(b); })
      .map(function (v) { return { value: v, label: v + ' (' + counts[v] + ')' }; });
  }

  /** Every column filter's options, from all the requests (not just the ones shown, so a filter can be changed). */
  function columnOptions(items, linesByRequest, now) {
    var list = items || [];
    var inWindow = {};
    list.forEach(function (r) { dateKeys(r, now).forEach(function (k) { inWindow[k] = (inWindow[k] || 0) + 1; }); });
    var external = list.filter(function (r) { return r.external; }).length;
    return {
      number: list.slice().sort(function (a, b) { return (Number(b.eqrEquipmentRequestId) || 0) - (Number(a.eqrEquipmentRequestId) || 0); })
        .filter(function (r) { return r.requestNumber; })
        .map(function (r) { return { value: String(r.requestNumber), label: r.requestNumber + (r.party ? ' · ' + r.party : '') }; }),
      party: tally(list, function (r) { return [r.party]; }),
      equipment: tally(list, function (r) { return equipmentNames(r, linesByRequest); }),
      dates: DATE_WINDOWS.map(function (w) { return { value: w.key, label: w.label + ' (' + (inWindow[w.key] || 0) + ')' }; }),
      next: tally(list, function (r) { return [nextWho(r)]; }),
      type: [{ value: 'INTERNAL', label: 'Project (' + (list.length - external) + ')' }, { value: 'EXTERNAL', label: 'Customer (' + external + ')' }],
      requester: tally(list, function (r) { return [requesterOf(r)]; })
    };
  }

  /** The requests that match every column filter set: { number, party, equipment, dates, next, requester } ('' = any). */
  function byColumns(items, f, linesByRequest, now) {
    var c = f || {};
    return (items || []).filter(function (r) {
      if (c.number && String(r.requestNumber) !== c.number) return false;
      if (c.party && r.party !== c.party) return false;
      if (c.equipment && equipmentNames(r, linesByRequest).indexOf(c.equipment) === -1) return false;
      if (c.dates && dateKeys(r, now).indexOf(c.dates) === -1) return false;
      if (c.next && nextWho(r) !== c.next) return false;
      if (c.requester && requesterOf(r) !== c.requester) return false;
      return true;
    });
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
    summary: summary, unitText: unitText, actions: actions, redwoodRows: redwoodRows, columnOptions: columnOptions, byColumns: byColumns,
    dateKeys: dateKeys, DATE_WINDOWS: DATE_WINDOWS, yardJourney: yardJourney, PICKABLE: PICKABLE, CONFIRMABLE: CONFIRMABLE, ACCEPTABLE: ACCEPTABLE
  };
});
