define(['resources/js/rateRules', 'resources/js/agreementRules', 'resources/js/fmt'], function (R, A, fmt) {
  'use strict';

  // EquipRite Next, Commercial, the Redwood look (your menu, Look): Rates and Agreements as Oracle's Smart Search page
  // over an oj-table, as Old EquipRite builds them (rate-schedule-page, rental-agreements-page). Here: each table's rows
  // (every cell's words, so the templates bind plain values), a Smart Search filter per column with what the rows hold
  // and how many hold it, the rows a set of column filters keeps, the Smart Search criterion read, and the record
  // header's status badge. Pure. The rules stay rateRules and agreementRules, unchanged.

  // Oracle's oj-badge classes (Redwood theme), as Requests uses them (requestList BADGE).
  var BADGE = {
    neutral: 'oj-badge oj-badge-subtle', info: 'oj-badge oj-badge-info oj-badge-subtle', warning: 'oj-badge oj-badge-warning oj-badge-subtle',
    success: 'oj-badge oj-badge-success oj-badge-subtle', danger: 'oj-badge oj-badge-danger oj-badge-subtle'
  };
  // A Commercial tone (agreementRules.tone; a schedule is active or ended) as Oracle's badge status.
  var STATUS = { draft: 'neutral', approval: 'info', active: 'success', ended: 'neutral', stopped: 'danger' };
  var DAY = 86400000;
  var NO_CURRENCY = 'No currency';
  var NO_CUSTOMER = 'No customer';
  var NO_TYPE = 'No type';

  var txt = function (v) { return v == null ? '' : String(v); };
  var blank = function (v) { return v == null || v === '' || v === '—'; };
  var arr = function (a) { return Array.isArray(a) ? a : []; };
  var utcDay = function (iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(txt(iso));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
  };

  // Options with their counts, by label: [{ value, label: 'Houston Yard (3)' }].
  function tally(items, valuesOf, order) {
    var counts = {};
    arr(items).forEach(function (r) { valuesOf(r).forEach(function (v) { if (v) counts[v] = (counts[v] || 0) + 1; }); });
    return Object.keys(counts).sort(order || function (a, b) { return a.localeCompare(b); })
      .map(function (v) { return { value: v, label: v + ' (' + counts[v] + ')' }; });
  }

  /**
   * Which date windows a record's dates fall in, today: in effect now, starting later, ending within `soon` days, ended,
   * no end date.
   */
  function windowKeys(start, end, soon, today) {
    var t = utcDay(today || new Date().toISOString().slice(0, 10));
    var s = utcDay(start);
    var e = utcDay(end);
    var keys = [];
    if (s != null && t < s) keys.push('later');
    if ((s == null || s <= t) && (e == null || t <= e)) keys.push('now');
    if (e != null && t <= e && e - t <= soon * DAY) keys.push('ending');
    if (e != null && e < t) keys.push('ended');
    if (e == null) keys.push('open');
    return keys;
  }

  function windowOptions(windows, rows, keysOf) {
    var inWindow = {};
    arr(rows).forEach(function (r) { keysOf(r).forEach(function (k) { inWindow[k] = (inWindow[k] || 0) + 1; }); });
    return windows.map(function (w) { return { value: w.key, label: w.label + ' (' + (inWindow[w.key] || 0) + ')' }; });
  }

  // ── Smart Search's criterion ────────────────────────────────────────────────────────────────────────────

  /**
   * What Smart Search's criterion holds: { text, fields: { field: value } }. The criterion is a tree: a text node, and
   * $eq nodes for a filter's field, the value either on the node ({ attribute, value }) or inside an object
   * ({ value: { field: v } }); both are read, as Requests' rwFilterChain and Old's pages read them.
   */
  function readCriterion(c) {
    var text = '';
    var fields = {};
    var pick = function (field, val) { fields[field] = val === undefined || val === null ? '' : String(val); };
    var read = function (node) {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node.criteria)) node.criteria.forEach(read);
      if (node.text !== undefined && node.text !== null) text = String(node.text);
      if (node.op === '$eq') {
        if (node.attribute) pick(node.attribute, node.value);
        else if (node.value && typeof node.value === 'object') Object.keys(node.value).forEach(function (k) { pick(k, node.value[k]); });
      }
    };
    read(c);
    return { text: text.trim(), fields: fields };
  }

  // ── Rates ────────────────────────────────────────────────────────────────────────────────────────────────

  // The Effective filter's windows (ending: within rateRules' 30 days, as the "Ending soon" chip counts).
  var RATE_WINDOWS = [
    { key: 'now', label: 'In effect now' },
    { key: 'later', label: 'Starting later' },
    { key: 'ending', label: 'Ending within ' + R.EXPIRING_DAYS + ' days' },
    { key: 'ended', label: 'Ended' },
    { key: 'open', label: 'No end date' }
  ];
  // The Status filter: the list's own chips that are a status (the page's listChip; Tagged and No tags are Used by's).
  var RATE_STATUS_CHIPS = ['all', 'ACTIVE', 'expiring', 'INACTIVE'];

  /** Who uses a schedule, one phrase per tag; an untagged schedule is the fallback. */
  function usedByOf(s) {
    var tags = R.tagsOf(s);
    return tags.length ? tags : [R.tagText(s)];
  }
  function currencyOf(s) { return blank(s && s.currency) ? NO_CURRENCY : s.currency; }
  function rateWindowKeys(s, today) { return windowKeys(s && s.startDate, s && s.endDate, R.EXPIRING_DAYS, today); }

  /** The Redwood table's rows: one per schedule shown (the list's chip and search), in the list's order. */
  function rateRows(shown, today) {
    return arr(shown).map(function (s) {
      var active = s.status === 'ACTIVE';
      return {
        key: String(s.id),
        name: s.scheduleName || '—',
        description: blank(s.description) ? '' : s.description,
        usedBy: R.tagText(s),
        dates: R.windowText(s),
        ends: R.endText(s, today),
        currency: blank(s.currency) ? '—' : s.currency,
        status: active ? 'Active' : 'Inactive',
        badge: active ? BADGE.success : BADGE.neutral,
        note: s.ppmUnused ? 'Not used: its yard takes Fusion PPM rates' : ''
      };
    });
  }

  /**
   * Every column filter's options, from all the schedules (not just the ones shown, so a filter can be changed):
   * Schedule, Used by, Effective, Currency, Status (the list's chips that are a status, with their counts).
   */
  function rateOptions(rows, today) {
    var list = arr(rows);
    return {
      name: tally(list, function (s) { return [txt(s.scheduleName).trim()]; }),
      usedBy: tally(list, usedByOf),
      dates: windowOptions(RATE_WINDOWS, list, function (s) { return rateWindowKeys(s, today); }),
      currency: tally(list, function (s) { return [currencyOf(s)]; }),
      chip: R.listChips(list, today).filter(function (c) { return RATE_STATUS_CHIPS.indexOf(c.key) !== -1; })
        .map(function (c) { return { value: c.key, label: c.label + ' (' + c.count + ')' }; })
    };
  }

  /** The schedules that match every column filter set: { name, usedBy, dates, currency } ('' = any). */
  function rateByColumns(rows, f, today) {
    var c = f || {};
    return arr(rows).filter(function (s) {
      if (c.name && txt(s.scheduleName).trim() !== c.name) return false;
      if (c.usedBy && usedByOf(s).indexOf(c.usedBy) === -1) return false;
      if (c.dates && rateWindowKeys(s, today).indexOf(c.dates) === -1) return false;
      if (c.currency && currencyOf(s) !== c.currency) return false;
      return true;
    });
  }

  /** The open schedule's status, as the header's badge. */
  function rateBadge(formData) {
    var active = !!(formData && formData.activeStatus);
    return { text: active ? 'Active' : 'Inactive', status: active ? 'success' : 'neutral' };
  }

  // ── Agreements ───────────────────────────────────────────────────────────────────────────────────────────

  // The Valid filter's windows (ending: within agreementRules' 60 days, as "Ending soon" counts).
  var AGREEMENT_WINDOWS = [
    { key: 'now', label: 'In effect now' },
    { key: 'later', label: 'Starting later' },
    { key: 'ending', label: 'Ending within ' + A.EXPIRING_DAYS + ' days' },
    { key: 'ended', label: 'Ended' }
  ];

  function agreementWindowKeys(r, today) { return windowKeys(r && r.startDate, r && r.endDate, A.EXPIRING_DAYS, today); }
  function customerOf(r) { return txt(r && r.customer).trim() || NO_CUSTOMER; }
  function typeOf(r) { return txt(r && r.agreementType).trim() || NO_TYPE; }
  function linesOf(r) { return fmt.count(r && r.lineCount, 'line'); }
  /**
   * What is next for an agreement, in short (agreementRules.nextStep's lead: "In use", "Finance to approve it",
   * "Ending soon"…), so agreements in the same place count together.
   */
  function nextOf(r, today) {
    var t = A.nextStep(r && r.statusCode, r && r.endDate, r && r.lineCount, today);
    if (/^Ends (today|in \d+ days?)/.test(t)) return 'Ending soon';
    return t.split(/[:;]/)[0].trim();
  }

  /** The Redwood table's rows: one per agreement shown (the chip, the search, the order). */
  function agreementRows(shown, today) {
    return arr(shown).map(function (r) {
      return {
        key: r.agreementNumber ? String(r.agreementNumber) : 'id:' + r.headerId,
        number: r.agreementNumber || '—',
        name: r.agreementName || '',
        customer: r.customer || '—',
        type: r.agreementType || '—',
        status: A.statusLabel(r.statusCode),
        badge: BADGE[STATUS[A.tone(r.statusCode)]] || BADGE.neutral,
        stored: r.statusCode || 'none',
        dates: fmt.range(r.startDate, r.endDate) || '—',
        ends: A.expiryText(r, today),
        lines: linesOf(r),
        next: A.nextStep(r.statusCode, r.endDate, r.lineCount, today)
      };
    });
  }

  /**
   * Every column filter's options, from all the agreements: Agreement (newest first, with its name), Customer, Type,
   * Status (the list's chips, with their counts), Valid, Lines, Next step.
   */
  function agreementOptions(rows, today) {
    var list = arr(rows);
    var byNumber = function (a, b) { return (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0); };
    return {
      number: A.newestFirst(list).filter(function (r) { return r.agreementNumber; })
        .map(function (r) { return { value: String(r.agreementNumber), label: r.agreementNumber + (r.agreementName ? ' · ' + r.agreementName : '') }; }),
      customer: tally(list, function (r) { return [customerOf(r)]; }),
      type: tally(list, function (r) { return [typeOf(r)]; }),
      chip: A.chips(list, today).map(function (c) { return { value: c.key, label: c.label + ' (' + c.count + ')' }; }),
      dates: windowOptions(AGREEMENT_WINDOWS, list, function (r) { return agreementWindowKeys(r, today); }),
      lines: tally(list, function (r) { return [linesOf(r)]; }, byNumber),
      next: tally(list, function (r) { return [nextOf(r, today)]; })
    };
  }

  /** The agreements that match every column filter set: { number, customer, type, dates, lines, next } ('' = any). */
  function agreementByColumns(rows, f, today) {
    var c = f || {};
    return arr(rows).filter(function (r) {
      if (c.number && String(r.agreementNumber) !== c.number) return false;
      if (c.customer && customerOf(r) !== c.customer) return false;
      if (c.type && typeOf(r) !== c.type) return false;
      if (c.dates && agreementWindowKeys(r, today).indexOf(c.dates) === -1) return false;
      if (c.lines && linesOf(r) !== c.lines) return false;
      if (c.next && nextOf(r, today) !== c.next) return false;
      return true;
    });
  }

  // ── A schedule's rates (its record under Redwood): Smart Search over the rates table ───────────────────────────
  // One filter per thing a rates row is (its equipment, class, location, rate type, how it is counted), the periods it
  // has a rate in, and its margin; each offers what the schedule's rows hold, with how many rows hold it. A row is
  // rateRules.groupLines' group (one equipment's lines).
  var RATE_LINE_FIELDS = ['equipment', 'cls', 'location', 'period', 'margin', 'rateType', 'method'];
  var MARGIN_WORDS = { low: 'Below cost', ok: 'At or above cost', none: 'No bill rate' };
  var PERIOD_ORDER = R.PERIODS.map(function (p) { return p.label; });

  function rateGroupValues(g) {
    var first = (g && g.first) || {};
    var seen = {};
    return {
      equipment: [g.title],
      cls: [txt(first.className) || 'No class'],
      location: [g.location || 'All locations'],
      period: arr(g.cells).filter(function (c) { return arr(c.lines).length > 0; }).map(function (c) { return c.label; }),
      margin: arr(g.lines).map(function (l) { return MARGIN_WORDS[R.margin(l).state]; }).filter(function (w) { if (!w || seen[w]) return false; seen[w] = true; return true; }),
      rateType: [g.rateTypeLabel],
      method: [g.method]
    };
  }

  /** Every rate filter's options, from the schedule's lines: { equipment, cls, location, period, margin, rateType, method }. */
  function rateLineOptions(lines) {
    var groups = R.groupLines(arr(lines));
    var out = {};
    RATE_LINE_FIELDS.forEach(function (f) {
      var order = f === 'period' ? function (a, b) { return PERIOD_ORDER.indexOf(a) - PERIOD_ORDER.indexOf(b); } : null;
      out[f] = tally(groups, function (g) { return rateGroupValues(g)[f]; }, order);
    });
    return out;
  }

  /** The rows (groupLines' keys) a search and a set of rate filters keep: { text, equipment, cls, … } ('' = any). */
  function rateLineKeys(lines, cols) {
    var c = cols || {};
    var q = txt(c.text).trim().toLowerCase();
    return R.groupLines(arr(lines)).filter(function (g) {
      var v = rateGroupValues(g);
      var ok = RATE_LINE_FIELDS.every(function (f) { return !c[f] || v[f].indexOf(c[f]) !== -1; });
      if (!ok || !q) return ok;
      return [g.title, v.cls[0], v.location[0], g.rateTypeLabel, g.method].join(' ').toLowerCase().indexOf(q) !== -1;
    }).map(function (g) { return g.key; });
  }

  /** An agreement's status, as the header's badge. */
  function agreementBadge(code) {
    return { text: A.statusLabel(code), status: STATUS[A.tone(code)] || 'neutral' };
  }

  return {
    BADGE: BADGE, RATE_WINDOWS: RATE_WINDOWS, AGREEMENT_WINDOWS: AGREEMENT_WINDOWS,
    readCriterion: readCriterion, windowKeys: windowKeys,
    rateRows: rateRows, rateOptions: rateOptions, rateByColumns: rateByColumns, rateBadge: rateBadge,
    agreementRows: agreementRows, agreementOptions: agreementOptions, agreementByColumns: agreementByColumns, agreementBadge: agreementBadge,
    nextOf: nextOf, RATE_LINE_FIELDS: RATE_LINE_FIELDS, rateLineOptions: rateLineOptions, rateLineKeys: rateLineKeys
  };
});
