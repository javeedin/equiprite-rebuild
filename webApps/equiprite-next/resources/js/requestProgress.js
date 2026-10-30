define([], function () {
  'use strict';

  // Where a request is, worked out from its equipment.
  //
  // The database keeps two statuses: the request's (EQR_EQUIPMENT_REQUEST.status) and each line's (lineStatus),
  // plus an allocation status per line. Approving sets both to IN_PROCESS (confirmRequestChain), and the request
  // then stays IN_PROCESS while its equipment is picked, shipped, used and returned, so on its own it says nothing
  // about where the equipment is.
  //
  // Here the request's own status answers only "is it approved?" (draft, sent back, cancelled, waiting); the rest
  // is read from the lines: "Partly shipped · 1 of 3", what happens next and who does it, and what is late.
  // Display only: nothing is written, so the stored statuses, the backend and Old EquipRite are unchanged.

  var DAY = 86400000;
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // The journey every piece of equipment makes, in order. Draft and stopped (sent back, cancelled) sit outside it.
  var STAGES = [
    { key: 'approval', label: 'Waiting for approval', short: 'Approval' },
    { key: 'ready',    label: 'Getting ready',        short: 'Getting ready' },
    { key: 'out',      label: 'On the way',           short: 'On the way' },
    { key: 'onsite',   label: 'On site',              short: 'On site' },
    { key: 'back',     label: 'Coming back',          short: 'Coming back' },
    { key: 'done',     label: 'Completed',            short: 'Done' }
  ];
  var ORDER = { draft: -1, approval: 0, ready: 1, out: 2, onsite: 3, back: 4, done: 5 };

  // A request with equipment at different stages: named by the furthest one reached.
  var PARTLY = { ready: 'Partly approved', out: 'Partly shipped', onsite: 'Partly on site', back: 'Return started', done: 'Partly returned' };

  // Each stored line status: its stage, what it means in words, and what happens next (who, what).
  var LINE = {
    DRAFT:                   ['draft',    'Not sent yet',                         'Requester',         'submit it'],
    SUBMITTED:               ['approval', 'Waiting for approval',                 'Equipment Manager', 'approve it'],
    QUOTE_GENERATED:         ['approval', 'Quote sent, waiting for the customer', 'Customer',          'accept the quote'],
    QUOTE_ACCEPTED:          ['ready',    'Quote accepted, no unit assigned yet', 'Equipment Manager', 'assign a unit'],
    IN_PROCESS:              ['ready',    'Approved, no unit assigned yet',       'Equipment Manager', 'assign a unit'],
    APPROVED:                ['ready',    'Approved, no unit assigned yet',       'Equipment Manager', 'assign a unit'],
    ALLOCATED:               ['ready',    'Unit assigned',                        'Equipment Manager', 'confirm it for picking'],
    UNDER_PROCUREMENT:       ['ready',    'Being bought',                         'Procurement',       'buy it'],
    SCHEDULED_FOR_PICKING:   ['ready',    'Waiting to be picked',                 'Yard',              'start picking'],
    PICK_INITIATED:          ['ready',    'Being picked at the yard',             'Yard',              'pick and ship it'],
    PICK_RELEASED:           ['ready',    'Being picked at the yard',             'Yard',              'pick and ship it'],
    EQP_INSPECTION_COMPLETE: ['ready',    'Inspected, ready to ship',             'Yard',              'ship it'],
    INSPECTION_FAILED:       ['ready',    'Failed inspection',                    'Equipment Manager', 'swap the unit, have it repaired or cancel the line'],
    SHIP_TO_SITE:            ['out',      'On the way to site',                   'Site',              'accept the delivery'],
    SHIPPED:                 ['out',      'On the way to site',                   'Site',              'accept the delivery'],
    DELIVERED:               ['onsite',   'On site',                              'Requester',         'return it when the job is done'],
    DEPLOYED:                ['onsite',   'On site',                              'Requester',         'return it when the job is done'],
    RETURN_INITIATED:        ['back',     'Return asked for, waiting for pickup', 'Yard',              'collect it'],
    RETURN_IN_PROCESS:       ['back',     'Being returned',                       'Yard',              'receive it'],
    SHIPPED_TO_YARD:         ['back',     'On the way back to the yard',          'Yard',              'receive and inspect it'],
    RETURNED:                ['done',     'Back at the yard',                     '',                  ''],
    CLOSED:                  ['done',     'Back at the yard, closed',             '',                  ''],
    CONSUMED:                ['done',     'Used up on site',                      '',                  ''],
    REJECTED:                ['stopped',  'Sent back',                            'Requester',         'fix it and send it again'],
    CANCELLED:               ['stopped',  'Cancelled',                            '',                  ''],
    DECLINED:                ['stopped',  'Declined',                              '',                  '']
  };

  function up(v) { return String(v == null ? '' : v).trim().toUpperCase(); }
  // Flow order of the statuses above, to name the earlier step when two next steps tie.
  var STEP_AT = {};
  Object.keys(LINE).forEach(function (k, i) { STEP_AT[k] = i; });

  // A customer request is IN_PROCESS from the moment it is sent (customer-new-request submitChain), before an
  // Equipment Manager has looked at it, so for customers that status still waits on the Equipment Manager.
  var CUSTOMER_IN_PROCESS = ['approval', 'With the Equipment Manager', 'Equipment Manager', 'review it and assign a unit'];

  // An unknown status still reads as words and counts as getting ready, so it never vanishes.
  function line(status, external) {
    var code = up(status);
    var row = external && code === 'IN_PROCESS' ? CUSTOMER_IN_PROCESS : LINE[code];
    if (row) {
      return { code: code, stage: row[0], label: row[1], who: row[2], what: row[3] };
    }
    var words = code ? code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, ' ') : '';
    return { code: code, stage: code ? 'ready' : '', label: words, who: '', what: '' };
  }

  function stageLabel(key) {
    for (var i = 0; i < STAGES.length; i++) {
      if (STAGES[i].key === key) return STAGES[i].label;
    }
    return key === 'draft' ? 'Draft' : (key === 'stopped' ? 'Stopped' : '');
  }

  function dayOf(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  }
  function today(now) {
    var d = new Date(now || Date.now());
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  function fmtDay(ms) {
    var d = new Date(ms);
    return d.getUTCDate() + ' ' + MON[d.getUTCMonth()];
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  // The status of a line from either view's shape (lineStatus, status, or the request's status on bulk rows).
  function codeOf(l) {
    if (!l) return '';
    return up(l.lineStatus != null && l.lineStatus !== '' ? l.lineStatus : (l.status != null ? l.status : l.requestStatus));
  }

  /**
   * The request, read from its equipment.
   *   header   the request's own status
   *   lines    its lines (lineStatus or status; start/end or startDate/endDate when a line has its own dates)
   *   opts     { start, end, now, external } the request's dates, for what is late; external for a customer request
   * Returns {
   *   stage      draft | approval | ready | out | onsite | back | done | stopped | mixed
   *   tone       the stage that colours it (the furthest reached when mixed)
   *   headline   "Partly shipped · 1 of 3", "On site", "Waiting for approval", "Sent back"
   *   detail     "1 on the way · 2 getting ready"
   *   next       { who, what, count, text } the step holding the request up: "Equipment Manager to assign a unit (2)"
   *   late       [{ kind, count, text }] "2 not shipped, due 8 Oct", "1 past its end date (30 Oct)"
   *   counts     { approval: n, ready: n, … } lines per stage
   *   stops      [{ key, label, count, state: done | here | passed | todo }] for a tracker
   *   stages     the stages this request's equipment is in (for filtering)
   *   total      lines counted (sent back and cancelled lines left out)
   * }
   */
  function summarize(header, lines, opts) {
    var o = opts || {};
    var h = up(header);
    var list = (Array.isArray(lines) ? lines : []).map(function (l) {
      var info = line(codeOf(l) || h, o.external);
      info.start = dayOf(l && (l.start || l.startDate));
      info.end = dayOf(l && (l.end || l.endDate));
      return info;
    });
    var counts = { draft: 0, approval: 0, ready: 0, out: 0, onsite: 0, back: 0, done: 0, stopped: 0 };
    list.forEach(function (i) { if (counts[i.stage] !== undefined) counts[i.stage] += 1; });
    var active = list.filter(function (i) { return i.stage !== 'stopped'; });
    var total = active.length;

    var res = { stage: '', tone: '', headline: '', detail: '', next: null, late: [], counts: counts, stops: [], stages: [], total: total };

    // The request's own decisions come first: a draft, a request sent back or cancelled is that, whatever its lines say.
    var own = line(h, o.external);
    if (h === 'DRAFT' || own.stage === 'stopped' || (!total && list.length)) {
      var stoppedCode = own.stage === 'stopped' ? own : (list.length ? list[0] : own);
      res.stage = h === 'DRAFT' ? 'draft' : 'stopped';
      res.tone = res.stage;
      res.headline = h === 'DRAFT' ? 'Draft' : stoppedCode.label;
      res.next = own.who ? { who: own.who, what: own.what, count: 0, text: own.who + ' to ' + own.what } : null;
      res.stages = [res.stage];
      res.stops = stopsFor(res, -1, -1);
      return res;
    }

    // No lines known (not loaded yet): only the request's own status, in words. An approved request says
    // Approved, not where its equipment is, and nothing is called late on a guess.
    if (!total) {
      var approved = own.code === 'IN_PROCESS' && !o.external || own.code === 'APPROVED';
      res.stage = own.stage || 'ready';
      res.tone = res.stage;
      res.headline = approved ? 'Approved' : (own.stage === 'ready' || own.stage === 'approval' ? own.label : (stageLabel(own.stage) || own.label));
      res.detail = approved ? 'Open it to see where each piece of equipment is' : '';
      res.next = !approved && own.who ? { who: own.who, what: own.what, count: 0, text: own.who + ' to ' + own.what } : null;
      res.stages = res.stage ? [res.stage] : [];
      var at = ORDER[res.stage] !== undefined ? ORDER[res.stage] : -1;
      res.stops = stopsFor(res, at, at);
      res.late = own.stage === 'approval' ? lateFor([{ stage: 'approval', start: null, end: null }], o) : [];
      return res;
    }

    var present = STAGES.filter(function (s) { return counts[s.key] > 0; });
    var lead = present[present.length - 1].key;
    var lag = present[0].key;
    res.stages = present.map(function (s) { return s.key; });
    res.tone = lead;

    if (present.length === 1) {
      res.stage = lead;
      var codes = {};
      active.forEach(function (i) { codes[i.label] = (codes[i.label] || 0) + 1; });
      var labels = Object.keys(codes);
      res.headline = stageLabel(lead);
      // "Getting ready" covers several steps: say which.
      res.detail = labels.length === 1
        ? (labels[0] !== res.headline ? labels[0] : '')
        : labels.map(function (k) { return codes[k] + ' ' + k.charAt(0).toLowerCase() + k.slice(1); }).join(' · ');
    } else {
      res.stage = 'mixed';
      var leadLabel = lead === 'done' && !active.some(function (i) { return i.code === 'CLOSED' || i.code === 'RETURNED'; })
        ? 'Partly complete' : PARTLY[lead];
      res.headline = leadLabel + ' · ' + counts[lead] + ' of ' + total;
      res.detail = present.slice().reverse().map(function (s) {
        return counts[s.key] + ' ' + (s.key === 'done' ? 'done' : s.short.charAt(0).toLowerCase() + s.short.slice(1));
      }).join(' · ');
    }

    // What holds the request up: the most common next step among the lines furthest behind.
    if (lag !== 'done') {
      var steps = {};
      active.forEach(function (i) {
        if (i.stage !== lag || !i.who) return;
        var k = i.who + ' to ' + i.what;
        steps[k] = steps[k] || { who: i.who, what: i.what, count: 0, at: STEP_AT[i.code] != null ? STEP_AT[i.code] : 99 };
        steps[k].count += 1;
      });
      var best = null;
      Object.keys(steps).forEach(function (k) {
        var c = steps[k];
        if (!best || c.count > best.count || (c.count === best.count && c.at < best.at)) best = c;
      });
      if (best) {
        delete best.at;
        best.text = best.who + ' to ' + best.what + (total > 1 ? ' (' + best.count + ' of ' + total + ')' : '');
        // On site and within its dates nothing is waiting on anyone: say until when it is in use instead.
        if (lag === 'onsite') {
          var ends = active.filter(function (i) { return i.stage === 'onsite'; })
            .map(function (i) { return i.end != null ? i.end : dayOf(o.end); }).filter(function (e) { return e != null; });
          var first = ends.length ? Math.min.apply(null, ends) : null;
          best.text = first != null && first >= today(o.now) ? 'In use until ' + fmtDay(first)
            : (first != null ? best.who + ' to return it (ended ' + fmtDay(first) + ')' : 'In use');
        }
        res.next = best;
      }
    }

    res.late = lateFor(active, o);
    res.stops = stopsFor(res, ORDER[lag], ORDER[lead]);
    return res;
  }

  // Late: not shipped by the start date; still out after the end date. A line's own dates win over the request's.
  function lateFor(items, o) {
    var t = today(o.now);
    var reqStart = dayOf(o.start);
    var reqEnd = dayOf(o.end);
    var notShipped = 0;
    var due = null;
    var overdue = 0;
    var ended = null;
    items.forEach(function (i) {
      var s = i.start != null ? i.start : reqStart;
      var e = i.end != null ? i.end : reqEnd;
      if ((i.stage === 'approval' || i.stage === 'ready') && s != null && t > s) {
        notShipped += 1;
        due = due == null ? s : Math.min(due, s);
      }
      if ((i.stage === 'out' || i.stage === 'onsite') && e != null && t > e) {
        overdue += 1;
        ended = ended == null ? e : Math.min(ended, e);
      }
    });
    var out = [];
    if (notShipped) {
      var days = Math.round((t - due) / DAY);
      out.push({ kind: 'not-shipped', count: notShipped,
        text: plural(notShipped, 'not shipped', 'not shipped') + ', due ' + fmtDay(due) + ' (' + plural(days, 'day', 'days') + ' late)' });
    }
    if (overdue) {
      out.push({ kind: 'overdue', count: overdue,
        text: plural(overdue, 'past its end date', 'past their end date') + ' (' + fmtDay(ended) + '), not returned' });
    }
    return out;
  }

  // The tracker: each stage with how many pieces are at it. Stages every line has passed are done; stages between
  // the furthest-behind and the furthest-ahead line with nothing at them are passed by some.
  function stopsFor(res, lagAt, leadAt) {
    return STAGES.map(function (s, i) {
      var n = res.counts[s.key] || 0;
      var state = 'todo';
      if (n > 0) state = 'here';
      else if (lagAt >= 0 && i < lagAt) state = 'done';
      else if (lagAt >= 0 && i > lagAt && i < leadAt) state = 'passed';
      if (s.key === 'done' && n > 0 && n === res.total) state = 'done';
      return { key: s.key, label: s.short, count: n, state: state };
    });
  }

  /** The stage a line status belongs to, for one colour per stage. */
  function stageOf(status) {
    return line(status).stage;
  }

  return {
    STAGES: STAGES,
    line: line,
    stageOf: stageOf,
    stageLabel: stageLabel,
    summarize: summarize
  };
});
