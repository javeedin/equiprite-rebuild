define(['resources/js/approvalQueue', 'resources/js/fmt', 'resources/js/mobileRecent'], function (queue, fmt, recent) {
  'use strict';

  // EquipRite Mobile's Approve tab, pure (no calls): the Equipment Manager's queue as cards on a phone, the chips, what
  // comes next once a request is decided, what a decision will do (in one line, before it is made), the quick reasons
  // for sending back, the units of a line in the unit sheet, and the copy kept on the phone.
  //
  // The rules are Next's Approve & allocate's (approvalQueue: the queue, the gates, the words; approveAllocate: the
  // calls). Nothing here decides who may do what: it says it. Each card keeps its latest date (lastAt: when it was raised
  // or last changed, its start, its end) so the queue can open on the last few days (mobileRecent).

  // approveAllocate's allow-lists (confirmRequestChain's CASCADABLE, rejectRequestChain's TERMINAL_STATES), to name the
  // lines a decision will change before it is made. tests/mobile-approve.test.js checks they are approveAllocate's and
  // give approvalQueue.decisionPlan's counts.
  var APPROVABLE = [null, '', 'DRAFT', 'SUBMITTED', 'IN_PROCESS'];
  var REJECT_TERMINAL = ['REJECTED', 'CANCELLED', 'CLOSED', 'CONSUMED'];
  // approvalQueue.build's lines in question: waiting for a decision, or approved with no unit yet.
  var DECISION_LINES = ['', 'DRAFT', 'SUBMITTED'];
  var NO_UNIT_LINES = ['IN_PROCESS', 'APPROVED', 'QUOTE_ACCEPTED'];

  var CHIPS = [
    { key: 'decide', label: 'To decide' },
    { key: 'allocate', label: 'To assign units' },
    { key: 'late', label: 'Late' },
    { key: 'all', label: 'All' }
  ];

  /** Sending back: the reasons a manager gives most, one tap each (added to the reason, or taken out again). */
  var REASONS = [
    'Not available for these dates',
    'Change the dates',
    'Wrong project or task',
    'Fewer pieces would do',
    'Ask for another model',
    'Say more about the work'
  ];

  var OFFLINE = 'No connection: nothing was sent.';
  var CREATED = ['createdDate', 'creationDate', 'createdOn'];

  function up(v) { return String(v == null ? '' : v).trim().toUpperCase(); }
  function lc(v) { return String(v == null ? '' : v).toLowerCase(); }
  function cap(t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; }
  function plural(n, one, many) { return fmt.count(n, one, many); }
  function join(list) {
    var l = (list || []).filter(function (x) { return !!x; });
    if (l.length <= 1) return l[0] || '';
    return l.slice(0, -1).join(', ') + ' and ' + l[l.length - 1];
  }
  function pick(r, names) {
    for (var i = 0; i < names.length; i++) {
      var v = r && r[names[i]];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return '';
  }
  function plain(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

  /** Whether the phone has a connection (navigator.onLine; no navigator: assume so). */
  function online(nav) { return !nav || nav.onLine !== false; }

  /** "Raised today", "Raised yesterday", "Raised 5 days ago"; '' when not known. */
  function age(created, now) {
    var d = fmt.dayMs(created);
    if (d == null) return '';
    var rel = fmt.relative(created, now);
    if (/^in /.test(rel) || rel === 'tomorrow') return 'Raised today';
    return 'Raised ' + rel;
  }

  // ── The queue ───────────────────────────────────────────────────────────────────────────────────────────

  /** A queue item's lines in question (approvalQueue.build's rule). */
  function waitingLines(item, lines) {
    return (lines || []).filter(function (l) {
      var s = up(l.lineStatus);
      return item.kind === 'decide' ? DECISION_LINES.indexOf(s) !== -1 : NO_UNIT_LINES.indexOf(s) !== -1 && up(l.allocation) !== 'ALLOCATED';
    });
  }

  /**
   * The cards, in the queue's order (most urgent first): each approvalQueue.build item with what a phone shows.
   *   items           approvalQueue.build(rows, linesByRequest, …)
   *   linesByRequest  requestData.linesByRequest
   *   rows            views/my-requests rows (for when a request was raised)
   */
  function cards(items, linesByRequest, rows, now) {
    var byNumber = {};
    (rows || []).forEach(function (r) { if (r && r.requestNumber) byNumber[String(r.requestNumber)] = r; });
    return (items || []).map(function (it) { return card(it, (linesByRequest || {})[it.number] || [], byNumber[it.number] || {}, now); });
  }

  function card(it, lines, row, now) {
    var waiting = waitingLines(it, lines);
    var pieces = waiting.reduce(function (n, l) { return n + (Number(l.qty) || 1); }, 0);
    return {
      key: it.key,
      id: it.id,
      number: it.number,
      kind: it.kind,
      status: it.status,
      external: !!it.external,
      party: it.party || '',
      task: it.task || '',
      requestor: it.requestor || '',
      start: it.start,
      end: it.end,
      dates: it.dates || '',
      when: it.when || '',
      late: it.late || '',
      lateWhy: it.lateWhy || '',
      lateDays: it.lateDays || 0,
      waiting: it.waiting,
      lineCount: it.lineCount,
      pieces: pieces,
      quoteOwed: !!it.quoteOwed,
      est: it.est || 0,
      equipment: it.equipment || '',
      detail: it.detail || '',
      needs: it.kind === 'decide' ? 'To decide' : (it.quoteOwed ? 'Quote owed' : 'To assign units'),
      tone: it.kind === 'decide' ? 'approval' : 'ready',
      age: age(pick(row, CREATED), now),
      lastAt: recent.latest(row, [it.start, it.end]),
      hay: it.hay || ''
    };
  }

  function keysOf(c) {
    var k = ['all', c.kind];
    if (c.lateDays) k.push('late');
    return k;
  }

  /** The chips with their counts; Late only when something is. */
  function chips(list) {
    var counts = {};
    (list || []).forEach(function (c) { keysOf(c).forEach(function (k) { counts[k] = (counts[k] || 0) + 1; }); });
    return CHIPS.map(function (c) { return { key: c.key, label: c.label, count: counts[c.key] || 0 }; })
      .filter(function (c) { return c.key !== 'late' || c.count > 0; });
  }

  /** The cards under a chip matching every word searched (approvalQueue.filter). */
  function filter(list, chip, text) {
    return queue.filter(list || [], text, chip || 'all');
  }

  /** Where the queue opens: what waits for a decision, else units to assign, else everything. */
  function firstChip(list) {
    if ((list || []).some(function (c) { return c.kind === 'decide'; })) return 'decide';
    if ((list || []).some(function (c) { return c.kind === 'allocate'; })) return 'allocate';
    return 'all';
  }

  /**
   * The line under the title: "3 to decide · 1 with units to assign · 1 late"; when the list is the last few days of a
   * queue that is not empty (lately): "In the last 3 days: 3 to decide · 1 late", or "Nothing in the last 3 days".
   */
  function summary(list, lately) {
    var l = list || [];
    var lead = lately ? cap(recent.PHRASE) + ': ' : '';
    if (!l.length) return lately ? 'Nothing ' + recent.PHRASE : 'Nothing is waiting on you';
    var decide = l.filter(function (c) { return c.kind === 'decide'; }).length;
    var allocate = l.length - decide;
    var late = l.filter(function (c) { return c.lateDays; }).length;
    var parts = [];
    if (decide) parts.push(decide + ' to decide');
    if (allocate) parts.push(allocate + ' with units to assign');
    if (late) parts.push(late + ' late');
    return lead + parts.join(' · ');
  }

  /**
   * The tab's count (as the shell counts it): the requests waiting for a decision, of what the queue opens on (the last
   * few days), so the count matches the list it opens. now: given, the cards older than the period are left out.
   */
  function badge(list, now) {
    var l = now === undefined ? (list || []) : recent.only(list, now);
    return l.filter(function (c) { return c.kind === 'decide'; }).length;
  }

  /** A card's second line: "2 pieces · Sam Ortiz", or for units "1 of 3 lines still without a unit · Sam Ortiz". */
  function cardSub(c) {
    if (!c) return '';
    var what = c.kind === 'decide' ? (c.pieces ? plural(c.pieces, 'piece') : '') : c.detail;
    return [what, c.requestor].filter(function (x) { return !!x; }).join(' · ');
  }

  /** "2 of 5" in the list shown; '' when the request is not in it. */
  function position(list, key) {
    var l = list || [];
    for (var i = 0; i < l.length; i++) {
      if (l[i].key === String(key)) return (i + 1) + ' of ' + l.length;
    }
    return '';
  }

  /** The card after this one in the list shown (Skip), or null at the end. */
  function after(list, key) {
    var l = list || [];
    for (var i = 0; i < l.length; i++) {
      if (l[i].key === String(key)) return l[i + 1] || null;
    }
    return null;
  }

  /**
   * Next up, once a request is decided: the next request in the order the person was going through (order: the keys
   * shown before), under the same chip when one is left there, wrapping to the top; null when nothing else waits.
   */
  function nextUp(list, doneKey, order, chip) {
    var others = (list || []).filter(function (c) { return c.key !== String(doneKey); });
    var pool = others.filter(function (c) { return !chip || chip === 'all' || keysOf(c).indexOf(chip) !== -1; });
    if (!pool.length) pool = others;
    if (!pool.length) return null;
    var ord = (order || []).map(String);
    var at = ord.indexOf(String(doneKey));
    if (at !== -1) {
      var later = ord.slice(at + 1);
      for (var i = 0; i < later.length; i++) {
        var hit = pool.filter(function (c) { return c.key === later[i]; })[0];
        if (hit) return hit;
      }
    }
    return pool[0];
  }

  /**
   * The queue as next up goes through it: on the last few days (period recent), their cards first, then the older ones
   * (each in the queue's order); on every date, as it is.
   */
  function byPeriod(list, period, now) {
    return period === 'all' ? (list || []).slice() : recent.recentFirst(list, now);
  }

  /**
   * After a decision or units saved: what happened, the same request if it still waits (now for units, or for its
   * other lines), and what is next up.
   *   o: { action: approve | reject | units, words: { tone, text }, items (lines, in words), key, number, list (cards
   *        now), order (keys shown before), chip }
   */
  function done(o) {
    var list = o.list || [];
    var again = list.filter(function (c) { return c.key === String(o.key); })[0] || null;
    var next = nextUp(list, o.key, o.order, o.chip);
    var title = { approve: 'Approved', reject: 'Sent back', units: 'Units assigned' }[o.action] || 'Done';
    var againLabel = '';
    if (again) {
      if (again.kind === 'decide') againLabel = 'Decide the rest of ' + again.number;
      else if (again.quoteOwed) againLabel = 'See ' + again.number + ' (a quote is owed)';
      else againLabel = 'Assign ' + again.number + '\'s units now';
    }
    return {
      tone: (o.words && o.words.tone) || 'ok',
      title: title + ' · ' + (o.number || ''),
      text: (o.words && o.words.text) || '',
      items: (o.items || []).slice(),
      number: o.number || '',
      againKey: again ? again.key : '',
      againLabel: againLabel,
      next: next ? plain(next) : null,
      left: summary(list),
      clear: !list.length
    };
  }

  /** What the phone keeps of the queue for when there is no connection. */
  function keep(list, max) {
    return (list || []).slice(0, max || 60).map(function (c) { return plain(c); });
  }

  /** Cards back from the phone's copy: readable, nothing to decide (that needs a connection). */
  function restore(list) {
    return (list || []).filter(function (c) { return c && c.key && c.number; }).map(function (c) {
      return Object.assign({}, c, { offline: true, hay: c.hay || lc([c.number, c.party, c.task, c.requestor, c.equipment].join(' ')) });
    });
  }

  /** The request open from the phone's copy (no connection): what the card knew, nothing to act on. */
  function offlineRec(c, savedText) {
    var x = c || {};
    return {
      loading: false,
      error: '',
      offline: true,
      head: {
        id: x.id, number: x.number, status: x.status, external: !!x.external, party: x.party, task: x.task, requestor: x.requestor,
        dates: x.dates, when: x.when, late: x.lateWhy || x.late, headline: x.needs, tone: x.tone, est: x.est, age: x.age,
        location: '', deciding: false, allocating: false, needsUnits: false, equipment: x.equipment, detail: x.detail
      },
      rows: [],
      verdict: { tone: 'info', text: (savedText || 'Saved on this phone') + '. Approving, sending back and assigning units need a connection.', next: '' }
    };
  }

  // ── A request ───────────────────────────────────────────────────────────────────────────────────────────

  /**
   * The lines as a phone shows them: approvalQueue.lineRows (the gates, the words) with what each costs and whether a
   * decision can still change it.
   *   rows  approvalQueue.lineRows(raw, head, …);  raw  approveAllocate.loadLines lines
   */
  function lineCards(rows, raw) {
    var byId = {};
    (raw || []).forEach(function (l) { byId[String(l.lineId)] = l; });
    return (rows || []).map(function (r) {
      var l = byId[r.id] || {};
      var est = Number(r.est) || 0;
      return Object.assign({}, r, {
        title: r.no + '. ' + r.name + (r.qty > 1 ? ' × ' + r.qty : ''),
        cost: [r.rate, est ? 'est. ' + fmt.money(est) : ''].filter(function (x) { return !!x; }).join(' · '),
        free: r.tracking === 'Free stock',
        // Approve or Send back can still change it (a line sent back or cancelled is settled: no tick).
        decidable: APPROVABLE.indexOf(l.lineStatus) !== -1 || REJECT_TERMINAL.indexOf(up(l.lineStatus)) === -1
      });
    });
  }

  /** The lines a decision will change (approveAllocate.approve / reject's targets), from the pool. */
  function acting(kind, lines, ticks) {
    var p = queue.pool(lines || [], ticks || []);
    return kind === 'reject'
      ? p.filter(function (l) { return REJECT_TERMINAL.indexOf(up(l.lineStatus)) === -1; })
      : p.filter(function (l) { return APPROVABLE.indexOf(l.lineStatus) !== -1; });
  }

  /**
   * The decision sheet: what Approve or Send back will do, before it is done.
   *   head: recordChain's head;  lines: approveAllocate.loadLines lines;  ticks: the lines chosen (none: every line)
   * { kind, title, label, count, say (the one line), names, note (approvalQueue.decisionPlan), warn, headerMoves }
   */
  function decideSheet(kind, head, lines, ticks) {
    var k = kind === 'reject' ? 'reject' : 'approve';
    var h = head || {};
    var plan = queue.decisionPlan(k, lines || [], ticks || [], h.requestor);
    var acts = acting(k, lines, ticks);
    var pieces = acts.reduce(function (n, l) { return n + (Number(l.qty) || 1); }, 0);
    var est = acts.reduce(function (s, l) { return s + (Number(l.est_cost) || 0); }, 0);
    var names = acts.map(function (l) { return (l.equipment_name || l.equipmentName || 'Equipment') + ((Number(l.qty) || 1) > 1 ? ' × ' + Number(l.qty) : ''); });
    var say;
    if (!acts.length) say = plan.note;
    else if (k === 'reject') say = 'Send back ' + plural(pieces, 'piece') + ' to ' + (h.requestor || 'the requester') + '.';
    else say = 'Approve ' + plural(pieces, 'piece') + (h.party ? ' for ' + h.party : '') + (h.dates ? ', ' + h.dates : '') + (est ? ' · est. ' + fmt.money(est) : '') + '.';
    var warn = '';
    if (k === 'approve') {
      var none = acts.filter(function (l) { return queue.availTone(l.availability) === 'none'; }).map(function (l) { return l.equipment_name; });
      var part = acts.filter(function (l) { return queue.availTone(l.availability) === 'part'; }).map(function (l) { return l.equipment_name; });
      var bits = [];
      if (none.length) bits.push(join(none) + (none.length === 1 ? ' is' : ' are') + ' not available for ' + (none.length === 1 ? 'its' : 'their') + ' dates');
      if (part.length) bits.push(join(part) + (part.length === 1 ? ' is' : ' are') + ' only partly available');
      warn = bits.length ? cap(bits.join('; ')) + '.' : '';
    }
    return {
      kind: k,
      title: (k === 'reject' ? 'Send back ' : 'Approve ') + (h.number || ''),
      label: plan.label,
      count: plan.count,
      say: say,
      names: names,
      note: plan.note,
      warn: warn,
      headerMoves: plan.headerMoves
    };
  }

  /** A quick reason: added to the reason as a sentence, or taken out when it is there already. */
  function addReason(text, phrase) {
    var t = String(text == null ? '' : text);
    var p = String(phrase == null ? '' : phrase).trim();
    if (!p) return t;
    var at = lc(t).indexOf(lc(p));
    if (at !== -1) {
      var rest = t.slice(0, at) + t.slice(at + p.length).replace(/^\.?\s*/, '');
      return rest.replace(/\s{2,}/g, ' ').replace(/^\s*\.\s*/, '').trim();
    }
    var base = t.replace(/\s+$/, '');
    if (!base) return p + '.';
    return base + (/[.!?]$/.test(base) ? ' ' : '. ') + p + '.';
  }

  /** Whether a quick reason is in the reason now. */
  function hasReason(text, phrase) {
    return !!phrase && lc(text).indexOf(lc(phrase)) !== -1;
  }

  /** The units suggested for a line (suggestChain), by name: what the unit sheet marks as suggested. */
  function suggestedNames(sugg, lineId) {
    var s = sugg && sugg.byLine ? sugg.byLine[String(lineId)] : null;
    return s && s.picks ? s.picks.map(function (p) { return p.unit; }).filter(Boolean) : [];
  }

  /** A line's button on the request: "Change" when a unit is suggested, else approvalQueue's label. */
  function lineButton(row, sugg) {
    if (!row || (row.action !== 'allocate' && row.action !== 'view')) return '';
    var s = sugg && sugg.byLine ? sugg.byLine[String(row.id)] : null;
    if (row.action === 'allocate' && s && s.words && s.words.state === 'ready') return 'Change';
    return row.actionLabel || 'See units';
  }

  /**
   * The unit sheet's rows, from unitPicker.unitRows: each unit with one step (use, release, undo), whether it was
   * suggested, and any clash with another request's booking over the line's dates, in words.
   */
  function unitRows(rows, suggested) {
    var sug = {};
    (suggested || []).forEach(function (n) { sug[String(n)] = 1; });
    return (rows || []).map(function (u) {
      var clash = (u.bars || []).filter(function (b) { return b.kind === 'conflict'; }).map(function (b) { return b.label; });
      var act = u.canCancel ? 'cancel' : (u.canRelease ? 'release' : (u.canAssign ? 'assign' : ''));
      return {
        id: String(u.id),
        name: u.name,
        yard: u.yard || '',
        state: u.state,
        label: u.label,
        tone: { available: 'ok', 'staged-assign': 'on', assigned: 'on', 'staged-release': 'off', booked: 'off', out: 'off' }[u.state] || 'off',
        qtyMode: !!u.qtyMode,
        qty: u.qty,
        qtyMax: u.qtyMax,
        clash: clash.length ? 'Booked by ' + join(clash) + ' over these dates' : '',
        suggested: !!sug[String(u.name)],
        act: act,
        actLabel: { cancel: 'Undo', release: 'Release', assign: 'Use' }[act] || ''
      };
    });
  }

  /** A toast's tone for words' tone. */
  function toastTone(tone) {
    return tone === 'error' ? 'error' : (tone === 'warn' ? 'warning' : 'info');
  }

  // ── Steps that stay in New EquipRite (Fusion) or Old (quotes) ──────────────────────────────────────────

  function base(b) { return b ? (b.slice(-1) === '/' ? b : b + '/') : ''; }

  /** New EquipRite's Initiate picking (the Transfer Order goes to Fusion). */
  function pickingUrl(newBase) { return newBase ? base(newBase) + 'vp/shell/logistics/picking' : ''; }

  /** This request on New EquipRite's Approve & allocate (Next's newUrl). */
  function inNewUrl(newBase, head) {
    if (!newBase || !head || !head.id) return '';
    return base(newBase) + 'vp/shell/workbench/approve-allocate?requestId=' + encodeURIComponent(head.number || '') + '&requestNumericId=' + encodeURIComponent(head.id);
  }

  /** The quote page in Old EquipRite, where quotes are generated (Next's quoteUrl). */
  function quoteUrl(oldBase, head) {
    if (!oldBase || !head || !head.id) return '';
    return base(oldBase) + 'vp/shell/equipment-foundation/request-quote?requestId=' + encodeURIComponent(head.id)
      + '&requestNumber=' + encodeURIComponent(head.number || '') + '&sourcePage=request-detail';
  }

  return {
    CHIPS: CHIPS, REASONS: REASONS, OFFLINE: OFFLINE, APPROVABLE: APPROVABLE, REJECT_TERMINAL: REJECT_TERMINAL,
    online: online, age: age, waitingLines: waitingLines, cards: cards, keysOf: keysOf, chips: chips, filter: filter, firstChip: firstChip,
    summary: summary, badge: badge, cardSub: cardSub, position: position, after: after, nextUp: nextUp, byPeriod: byPeriod, done: done, keep: keep,
    restore: restore, offlineRec: offlineRec, lineCards: lineCards, acting: acting, decideSheet: decideSheet, addReason: addReason,
    hasReason: hasReason, suggestedNames: suggestedNames, lineButton: lineButton, unitRows: unitRows, toastTone: toastTone,
    pickingUrl: pickingUrl, inNewUrl: inNewUrl, quoteUrl: quoteUrl
  };
});
