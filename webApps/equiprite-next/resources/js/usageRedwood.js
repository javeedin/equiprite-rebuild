define(['resources/js/fmt'], function (fmt) {
  'use strict';

  // EquipRite Next, Usage & billing: the Redwood views of Timesheets, Approve time and Post costs (your menu, Look).
  // Each is Oracle's Smart Search page over the same rows its current look lists (the page functions' queueShown, shown
  // and shownRows, from the same state): these turn those rows into flat oj-table rows, give every column filter its
  // options with how many rows hold each (from all the rows, not only the ones shown, so a filter can be changed), and
  // apply the column filters to the Redwood rows only (the current look never filters by a filter it does not show).
  // Reads only.

  // Oracle's oj-badge classes per journey tone (as requestList's BADGE for Requests).
  var BADGE = {
    draft: 'oj-badge oj-badge-subtle', approval: 'oj-badge oj-badge-info oj-badge-subtle', ready: 'oj-badge oj-badge-warning oj-badge-subtle',
    out: 'oj-badge oj-badge-info', onsite: 'oj-badge oj-badge-success oj-badge-subtle', back: 'oj-badge oj-badge-info oj-badge-subtle',
    done: 'oj-badge oj-badge-subtle', stopped: 'oj-badge oj-badge-danger oj-badge-subtle'
  };
  function badge(tone) { return BADGE[tone] || BADGE.draft; }

  function str(v) { return v === undefined || v === null ? '' : String(v).trim(); }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  // A burst of changes (Post costs' breakdown arrives three requests at a time; a request picked sets its lines, then what
  // was used) is taken in once it settles: an oj-table given new rows while it is still drawing the last ones gives up
  // that draw with an error ("Aborting stale fetch"). latest(screen) resolves true for the last call of a burst only.
  var calls = {};
  var SETTLE_MS = 120;
  function latest(screen) {
    var n = (calls[screen] = (calls[screen] || 0) + 1);
    return new Promise(function (r) { setTimeout(r, SETTLE_MS); }).then(function () { return calls[screen] === n; });
  }

  /** Options with their counts: [{ value, label: 'Pipeline North (3)' }], by label unless an order is given. */
  function tally(items, keyOf, labelOf, order) {
    var counts = {};
    var labels = {};
    var keys = [];
    (items || []).forEach(function (r) {
      [].concat(keyOf(r)).forEach(function (k) {
        var key = str(k);
        if (!key) return;
        if (!(key in counts)) { counts[key] = 0; labels[key] = labelOf ? labelOf(key, r) : key; keys.push(key); }
        counts[key]++;
      });
    });
    keys.sort(order || function (a, b) { return labels[a].localeCompare(labels[b]); });
    return keys.map(function (k) { return { value: k, label: labels[k] + ' (' + counts[k] + ')' }; });
  }

  /** Fixed choices, each with how many rows have it: [{ value, label }] from [[key, label]]. */
  function choices(items, keyOf, list) {
    return list.map(function (c) {
      var n = (items || []).filter(function (r) { return keyOf(r) === c[0]; }).length;
      return { value: c[0], label: c[1] + ' (' + n + ')' };
    });
  }

  /**
   * Smart Search's criterion, read: what was typed, and a value per filter field. The criterion is a tree: a text node and
   * $eq nodes, a $eq node holding its value either as { attribute, value } or as { value: { field: v } } (as Old reads it).
   */
  function readCriterion(c) {
    var text = '';
    var picks = {};
    function pick(field, val) { if (field) picks[field] = str(val); }
    function read(node) {
      if (!node) return;
      if (Array.isArray(node.criteria)) node.criteria.forEach(read);
      if (node.text !== undefined && node.text !== null) text = String(node.text);
      if (node.op === '$eq') {
        if (node.attribute) pick(node.attribute, node.value);
        else if (node.value && typeof node.value === 'object') Object.keys(node.value).forEach(function (k) { pick(k, node.value[k]); });
      }
    }
    read(c);
    return { text: text.trim(), picks: picks };
  }

  /** The column filters out of the picks: { key: value or '' } for each key. */
  function colsOf(picks, keys) {
    var out = {};
    keys.forEach(function (k) { out[k] = str(picks && picks[k]); });
    return out;
  }

  /** The Redwood rows that match every column filter set ('' is any): a row matches when its field holds the value. */
  function byColumns(rows, cols, fields) {
    var c = cols || {};
    return (rows || []).filter(function (r) {
      return Object.keys(fields).every(function (k) {
        if (!c[k]) return true;
        return [].concat(fields[k](r)).map(str).indexOf(c[k]) !== -1;
      });
    });
  }

  // ── Timesheets: the requests on site (views/timesheets, one row per request with its current week) ──────────────
  var TS_COLS = ['number', 'project', 'task', 'week', 'equipment', 'hours'];
  var TS_FIELDS = {
    number: function (q) { return q.requestNumber; },
    project: function (q) { return q.projectName; },
    task: function (q) { return q.taskName; },
    week: function (q) { return q.weekStartDate; },
    equipment: function (q) { return String(Number(q.equipCount) || 0); },
    hours: function (q) { return Number(q.totalHours) ? 'some' : 'none'; }
  };

  /** A request's current week in words, as the current look's queue note and export say it. */
  function tsWord(q, fns) { return q.eqrTimeEntryId || Number(q.totalHours) ? fns.statusWord(q.status) : 'Not started'; }

  /** One oj-table row per request on site; `open` marks the request whose week is open below. */
  function tsRows(queue, fns, openNumber) {
    return (queue || []).map(function (q) {
      var started = !!(q.eqrTimeEntryId || Number(q.totalHours));
      return {
        key: q.requestNumber,
        number: q.requestNumber,
        open: q.requestNumber === openNumber,
        project: q.projectName || '—',
        task: q.taskName || '—',
        week: q.weekStartDate ? fns.weekLabel(q.weekStartDate) : '—',
        weekStart: q.weekStartDate || '',
        equipCount: Number(q.equipCount) || 0,
        equipment: fmt.count(Number(q.equipCount) || 0, 'piece'),
        totalHours: Number(q.totalHours) || 0,
        hours: (Number(q.totalHours) || 0) + ' h',
        bill: Number(q.billAmount) ? fmt.money(q.billAmount) : '',
        status: tsWord(q, fns),
        badge: started ? badge(fns.statusTone(q.status)) : BADGE.draft
      };
    });
  }

  /** Every Timesheets filter's options, from all the requests on site. */
  function tsOptions(queue, fns) {
    var list = queue || [];
    return {
      number: list.filter(function (q) { return q.requestNumber; })
        .map(function (q) { return { value: q.requestNumber, label: q.requestNumber + (q.projectName ? ' · ' + q.projectName : '') }; }),
      project: tally(list, TS_FIELDS.project),
      task: tally(list, TS_FIELDS.task),
      week: tally(list, TS_FIELDS.week, function (k) { return fns.weekLabel(k); }, function (a, b) { return b.localeCompare(a); }),
      equipment: tally(list, TS_FIELDS.equipment, function (k) { return fmt.count(Number(k), 'piece'); }, function (a, b) { return Number(a) - Number(b); }),
      hours: choices(list, TS_FIELDS.hours, [['none', 'No hours yet'], ['some', 'With hours']]),
      status: fns.queueChips(list).map(function (c) { return { value: c.key, label: c.label + ' (' + c.count + ')' }; })
    };
  }

  function tsByColumns(queue, cols) { return byColumns(queue, cols, TS_FIELDS); }

  // ── Approve time: every line of the week (views/timesheet-approval-details) ────────────────────────────────────
  var TA_COLS = ['number', 'project', 'type', 'hours', 'change', 'equipment', 'submitter'];
  var TAG_BADGE = { high: 'oj-badge oj-badge-danger oj-badge-subtle', long: 'oj-badge oj-badge-warning oj-badge-subtle', change: 'oj-badge oj-badge-info oj-badge-subtle' };
  var CHANGES = [['new', 'New this week'], ['more', 'More than last week'], ['less', 'Less than last week'], ['same', 'Same as last week']];

  function changeKey(fns, rowsAll, r) {
    var prev = fns.previous(rowsAll, r);
    if (!prev) return 'new';
    var sum = function (a) { return Math.round((a || []).reduce(function (s, h) { return s + (Number(h) || 0); }, 0) * 100) / 100; };
    var d = sum(r.days) - sum(prev);
    return d > 0 ? 'more' : (d < 0 ? 'less' : 'same');
  }

  function taFields(fns, rowsAll, weekDays) {
    return {
      number: function (r) { return r.requestNumber; },
      project: function (r) { return r.projectName; },
      type: function (r) { return fns.typeLabel(r.hoursType); },
      hours: function (r) { return fns.needsLook(rowsAll, r, weekDays) ? 'look' : 'clean'; },
      change: function (r) { return changeKey(fns, rowsAll, r); },
      equipment: function (r) { return r.equipmentName; },
      submitter: function (r) { return r.submittedBy; }
    };
  }

  /** One oj-table row per line shown, with what needs a look as Oracle's badges; `act` when it can be ticked and adjusted. */
  function taRows(shown, rowsAll, weekDays, auditByEntry, fns, readOnly) {
    return (shown || []).map(function (r) {
      var days = (weekDays || []).map(function (d, i) { return { d: d, h: Number(r.days[i]) || 0 }; })
        .filter(function (x) { return x.h > 0; }).map(function (x) { return x.d.dow + ' ' + x.h; });
      return {
        key: r.key,
        number: r.requestNumber,
        equipment: r.equipmentName + (r.className ? ' · ' + r.className : ''),
        project: (r.projectName || '—') + (r.taskName ? ' / ' + r.taskName : ''),
        by: r.submittedBy ? 'by ' + r.submittedBy : '',
        type: fns.typeLabel(r.hoursType),
        totalHours: Number(r.totalHours) || 0,
        hours: (Number(r.totalHours) || 0) + ' h · ' + fns.money(r.totalBill),
        days: days.join(' · ') || 'No hours',
        tags: fns.exceptions(rowsAll, r, weekDays).map(function (x) { return { text: x.text, badge: TAG_BADGE[x.tone] || TAG_BADGE.change }; }),
        wow: fns.wowShort(rowsAll, r),
        wowText: fns.wowText(rowsAll, r),
        status: fns.statusWord(r.status),
        badge: badge(fns.statusTone(r.status)),
        adjusted: !!fns.adjusted(auditByEntry, r),
        act: !!fns.canAct(r, readOnly)
      };
    });
  }

  /** Every Approve time filter's options: the week's lines for the columns, every week for the Week filter. */
  function taOptions(rowsAll, week, weekDays, fns) {
    var all = rowsAll || [];
    var inWeek = all.filter(function (r) { return !week || r.week === week; });
    var f = taFields(fns, all, weekDays);
    var byNumber = {};
    inWeek.forEach(function (r) { if (r.requestNumber && !byNumber[r.requestNumber]) byNumber[r.requestNumber] = r.projectName; });
    return {
      number: tally(inWeek, f.number, function (k) { return k + (byNumber[k] ? ' · ' + byNumber[k] : ''); }),
      project: tally(inWeek, f.project),
      type: tally(inWeek, f.type),
      hours: choices(inWeek, f.hours, [['look', 'Needs a look'], ['clean', 'Looks right']]),
      change: choices(inWeek, f.change, CHANGES),
      status: fns.statusChips(all, week).map(function (c) { return { value: c.key, label: c.label + ' (' + c.count + ')' }; }),
      week: fns.weekChips(all).map(function (w) { return { value: w.week, label: w.label + ' (' + w.lines + ')' }; }),
      equipment: tally(inWeek, f.equipment),
      submitter: tally(inWeek, f.submitter)
    };
  }

  /** The lines shown that match every column filter. ("Needs a look" is the page's own onlyLook; the rest are here.) */
  function taByColumns(shown, rowsAll, weekDays, cols, fns) { return byColumns(shown, cols, taFields(fns, rowsAll, weekDays)); }

  // ── Post costs: one row per request with cost (views/post-cost), each with its breakdown once worked out ──────────
  var PC_COLS = ['number', 'project', 'rental', 'cost', 'ready', 'posted', 'task'];
  var KIND = {
    ready: { word: 'Ready to post', badge: BADGE.ready }, running: { word: 'Rental running', badge: BADGE.onsite },
    posted: { word: 'All posted', badge: 'oj-badge oj-badge-success oj-badge-subtle' }, none: { word: 'Nothing to post', badge: BADGE.draft },
    '': { word: 'Working it out…', badge: BADGE.draft }
  };

  function readyKeys(b) {
    if (!b) return [];
    var out = [];
    if (b.readyWeeks) out.push('weeks');
    if (b.readyCharges) out.push('charges');
    return out.length ? out : ['none'];
  }

  function pcFields(fns) {
    return {
      number: function (r) { return r.requestNumber; },
      project: function (r) { return r.projectName; },
      rental: function (r) { return fns.listState(r); },
      cost: function (r) { return Number(r.totalBillCost) > 0 ? 'some' : 'none'; },
      ready: function (r) { return readyKeys(r.b); },
      posted: function (r) { return r.b ? (r.b.posted > 0 ? 'some' : 'none') : ''; },
      task: function (r) { return r.taskName; }
    };
  }

  /** One oj-table row per request shown (rows from the page's shownRows, each with its breakdown `b`). */
  function pcRows(shown, fns, readOnly) {
    return (shown || []).map(function (r) {
      var b = r.b;
      var kind = KIND[fns.listKind(r, b)] || KIND[''];
      var ppm = r.ppmProjectNumber ? 'PPM ' + r.ppmProjectNumber + (r.ppmTaskNumber ? ' / ' + r.ppmTaskNumber : '') : '';
      return {
        key: r.requestNumber,
        id: Number(r.eqrEquipmentRequestId) || 0,
        number: r.requestNumber,
        sub: r.agreementNumber && r.agreementNumber !== '—' ? 'Agreement ' + r.agreementNumber : fns.plural(Number(r.timesheets) || 0, 'timesheet'),
        project: r.projectName || '—',
        task: [r.taskName && r.taskName !== '—' ? r.taskName : '', ppm].filter(function (x) { return !!x; }).join(' · '),
        rental: fns.range(r.startDate, r.endDate) || '—',
        end: r.endDate || '',
        state: fns.stateText(r),
        stateBadge: badge(fns.stateTone(r)),
        kind: kind.word,
        kindBadge: kind.badge,
        costValue: Number(r.totalBillCost) || 0,
        cost: fns.money(r.totalBillCost),
        hours: (Number(r.totalHours) || 0) + ' h',
        readyValue: b ? Number(b.ready) || 0 : -1,
        ready: fns.cell(b, 'ready'),
        readyNote: fns.readyNote(b),
        canPost: !readOnly && !!b && b.ready > 0,
        postedValue: b ? Number(b.posted) || 0 : -1,
        posted: fns.cell(b, 'posted'),
        lastPosted: b && b.lastPosted ? 'Last posted ' + b.lastPosted : (b ? 'Nothing posted yet' : ''),
        running: b && b.running ? fns.cell(b, 'running') + ' running' + (fns.runningNote(b) ? ', ' + fns.runningNote(b) : '') : ''
      };
    });
  }

  /** Every Post costs filter's options, from all the requests with cost. Status is the page's own chip. */
  function pcOptions(list, breakdown, fns) {
    var b = breakdown || {};
    var rows = (list || []).map(function (r) { return Object.assign({}, r, { b: b[r.requestNumber] || null }); });
    var f = pcFields(fns);
    return {
      number: rows.filter(function (r) { return r.requestNumber; })
        .map(function (r) { return { value: r.requestNumber, label: r.requestNumber + (r.projectName && r.projectName !== '—' ? ' · ' + r.projectName : '') }; }),
      project: tally(rows, function (r) { return r.projectName === '—' ? '' : r.projectName; }),
      rental: choices(rows, f.rental, [['over', 'Rental over'], ['running', 'Rental running'], ['future', 'Not started']]),
      status: fns.listChips(list, b).map(function (c) { return { value: c.key, label: c.label + ' (' + c.count + ')' }; }),
      cost: choices(rows, f.cost, [['some', 'With cost to date'], ['none', 'No cost yet']]),
      ready: [['weeks', 'Weeks ended, not posted'], ['charges', 'Charges not posted'], ['none', 'Nothing ready']].map(function (c) {
        return { value: c[0], label: c[1] + ' (' + rows.filter(function (r) { return readyKeys(r.b).indexOf(c[0]) !== -1; }).length + ')' };
      }),
      posted: choices(rows, f.posted, [['some', 'Something posted'], ['none', 'Nothing posted yet']]),
      task: tally(rows, function (r) { return r.taskName === '—' ? '' : r.taskName; })
    };
  }

  function pcByColumns(shown, cols, fns) { return byColumns(shown, cols, pcFields(fns)); }

  return {
    BADGE: BADGE, badge: badge, tally: tally, same: same, latest: latest, readCriterion: readCriterion, colsOf: colsOf, byColumns: byColumns,
    TS_COLS: TS_COLS, tsRows: tsRows, tsOptions: tsOptions, tsByColumns: tsByColumns,
    TA_COLS: TA_COLS, taRows: taRows, taOptions: taOptions, taByColumns: taByColumns,
    PC_COLS: PC_COLS, pcRows: pcRows, pcOptions: pcOptions, pcByColumns: pcByColumns
  };
});
