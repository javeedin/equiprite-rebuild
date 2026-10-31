define(['resources/js/costPreview', 'resources/js/postCostToFusion', 'resources/js/usageWeeks', 'resources/js/fmt'], function (CP, postCostToFusion, usageWeeks, nxFmt) {
  'use strict';

  // EquipRite Next, posting a request's costs to Fusion PPM. EquipRite Next only (the phone app does not post).
  //
  // The business rules are New EquipRite's Post costs (webApps/equiprite/flows/usage/pages/post-costs-page*), and so
  // are the figures and bodies: every one comes from New's page module, carried unchanged as costPreview.js CostRules
  // (weeksToPost, miscToPost, ledgerBody, postingPlan, restampSelection …), and the Fusion send is New's
  // postCostToFusion.js, copied unchanged. tests/next-posting.test.js runs New's chains and Next's on one fake backend.
  //
  //   post(context, Actions, o)   New's postSelectedChain, step for step and in its order:
  //     1 RECORD  each ticked postable week (not posted, not reversed): ONE ledger call, createPostedWeek, or
  //               createPostedWeekSplit for a week with a saved split of 2+ projects (percentages only; the server
  //               apportions). Then the ticked charges: ONE postMiscTransactions { ids } (all or nothing).
  //     2 SEND    only if something was recorded: the OIC post-cost flow for the request (postCostToFusion.post: the
  //               project URL, then v1 on a 404). It takes everything recorded and not yet sent, so it is safe to
  //               repeat; a failure here is not a lost post (the next post sends it) and is said as a warning.
  //     (3 the chain reads the record again: the preview, then the list, as New does.)
  //   Next adds only what a person sees: each line's progress and result in words (EquipRite's or Fusion's answer),
  //   and two guards on top of New's: one post at a time per request (claim) and the lines just recorded are marked
  //   posted on screen at once (markPosted), so nothing can be sent twice even if the read that follows fails.
  //
  //   The rest is the screen's pure logic: what is ticked (everything ready, less what the person unticked), New's
  //   tick rules, the plan and its sentence ("Post 3 weeks, $2,085, to 10011 EPC_MO_Operations / task 1.2.1.1 in Fusion
  //   PPM"), the calls exactly as they will be sent, and the rows of the week-by-week grid.
  var rules = new CP.CostPreview();

  // What each call is, as the services name it (services/eqp-v1 and services/ics openapi3.json).
  var PATHS = {
    week: '/equiprite/v1/posted-weeks',
    split: '/equiprite/v1/posted-weeks/split',
    misc: '/equiprite/v1/misc-transactions/post',
    fusion: '/ic/api/integration/v2/flows/rest/project/EQUIPRITE_DEV/EQP_POST_COST_FLOW_TEST/1.0/eqp/post-cost',
    fusionV1: '/ic/api/integration/v1/flows/rest/EQP_POST_COST_FLOW_TEST/1.0/eqp/post-cost'
  };

  function money(n) { return nxFmt.money(n) || '$0'; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function round2(n) { return Math.round(Number(n || 0) * 100) / 100; }

  // ── what is ticked ────────────────────────────────────────────────────────────────────────────────────

  /** A row New lets Finance tick: a postable week not posted, a charge not posted (Next's everythingReady). */
  function tickable(r) {
    return !!r && ((r.kind === 'week' && r.postable && !r.posted) || (r.kind === 'misc' && r.status !== 'POSTED'));
  }

  /** Everything ready is ticked, less what the person unticked (kept across reads by row key). */
  function select(all, unticked) {
    var skip = {};
    (unticked || []).forEach(function (k) { skip[k] = 1; });
    return rules.restampSelection((all || []).map(function (r) {
      if (!tickable(r)) return r.selected ? Object.assign({}, r, { selected: false }) : r;
      var on = !skip[r.rowKey];
      return r.selected === on ? r : Object.assign({}, r, { selected: on });
    }));
  }

  /** The keys of what could be ticked and is not. */
  function untickedOf(all) {
    return (all || []).filter(function (r) { return tickable(r) && !r.selected; }).map(function (r) { return r.rowKey; });
  }

  /**
   * A tick, by New's treeChain rules (null when nothing changes):
   *   week   only a postable week, not posted
   *   group  every postable week of the equipment, on unless all are on already
   *   misc   a charge not posted, toggled
   *   all / none   every week and charge that can be ticked (New's "Select all past weeks", charges included)
   */
  function tick(all, action, key, on) {
    var rows = (all || []).slice();
    if (action === 'week') {
      var target = rows.filter(function (r) { return r.kind === 'week' && r.rowKey === key; })[0];
      if (!target || !target.postable || target.posted) return null;
      return rules.restampSelection(rows.map(function (r) { return r === target ? Object.assign({}, r, { selected: !!on }) : r; }));
    }
    if (action === 'group') {
      var mine = rows.filter(function (r) { return r.kind === 'week' && r.groupKey === key && r.postable && !r.posted; });
      if (!mine.length) return null;
      var next = !mine.every(function (r) { return r.selected; });
      return rules.restampSelection(rows.map(function (r) { return mine.indexOf(r) >= 0 ? Object.assign({}, r, { selected: next }) : r; }));
    }
    if (action === 'misc') {
      var hit = false;
      var out = rows.map(function (r) {
        if (r.kind !== 'misc' || r.rowKey !== key || r.status === 'POSTED') return r;
        hit = true;
        return Object.assign({}, r, { selected: !r.selected });
      });
      return hit ? out : null;
    }
    if (action === 'all' || action === 'none') {
      var want = action === 'all';
      return rules.restampSelection(rows.map(function (r) { return tickable(r) && !!r.selected !== want ? Object.assign({}, r, { selected: want }) : r; }));
    }
    return null;
  }

  /** Opens or closes a week's days (to exclude some). */
  function toggleDays(all, key) {
    return (all || []).map(function (r) { return r.kind === 'week' && r.rowKey === key ? Object.assign({}, r, { weekExpanded: !r.weekExpanded }) : r; });
  }

  // ── what will be posted ───────────────────────────────────────────────────────────────────────────────

  /** New's postingPlan over what is ticked, a rental week named the Next way (as CostPreview.readyPlan names it). */
  function plan(all, hdr, rateScheduleId) {
    var byKey = {};
    (all || []).forEach(function (r) { if (r.kind === 'week' || r.kind === 'misc') byKey[r.rowKey] = r; });
    return rules.postingPlan(all, hdr, rateScheduleId).map(function (p) {
      var r = byKey[p.key];
      if (r && r.kind === 'week' && !r.direct && r.weekStartISO) {
        return Object.assign({}, p, { what: (r.equipmentName || 'Equipment') + ' · week of ' + usageWeeks.weekLabel(r.weekStartISO) });
      }
      if (r && r.kind === 'misc' && r.expItemDate) return Object.assign({}, p, { quantity: r.quantity + ' on ' + nxFmt.date(r.expItemDate) });
      return p;
    });
  }

  /** "3 weeks and 1 charge" for what is ticked. */
  function itemsText(sel) {
    var s = sel || {};
    var parts = [];
    if (s.weeks) parts.push(plural(s.weeks, 'week'));
    if (s.misc) parts.push(plural(s.misc, 'charge'));
    return parts.join(' and ');
  }

  /** Where an unsplit line goes, as New's postingPlan says it. */
  function ownProject(hdr) {
    var h = hdr || {};
    return (h.projectNumber ? h.projectNumber + (h.projectName ? ' ' + h.projectName : '') : 'the request\'s project')
      + (h.taskNumber ? ' / task ' + h.taskNumber : '');
  }

  /**
   * What the confirmation says before anything is sent:
   *   title  "Post 3 weeks, $2,085, to 10011 EPC_MO_Operations / task 1.2.1.1 in Fusion PPM"
   *   split  "1 week is split: Generator · week of …: 60% PRJ-B / 4.2, 40% PRJ-C / 2.1." ('' when none is)
   */
  function sentence(all, hdr) {
    var sel = rules.selection(all);
    if (!sel.items) return { title: 'Nothing is ticked to post', split: '', items: '', amount: 0, count: 0 };
    var weeks = rules.weeksToPost(all);
    var split = weeks.filter(function (r) { return rules.postedSplits(r).isSplit; });
    var own = ownProject(hdr);
    var items = itemsText(sel);
    var toOwn = sel.items > split.length;
    var title = 'Post ' + items + ', ' + money(sel.cost) + ', ' + (toOwn ? 'to ' + own : 'split across projects') + ' in Fusion PPM';
    var parts = split.map(function (r) {
      return (r.equipmentName || 'Equipment') + ' · ' + rules.weekName(r) + ': ' + rules.postedSplits(r).splits.map(function (s) {
        return Number(s.splitPct) + '% ' + s.projectNumber + (s.taskNumber ? ' / ' + s.taskNumber : '');
      }).join(', ');
    });
    var splitText = split.length ? (split.length === 1 ? '1 week is split: ' : split.length + ' weeks are split: ') + parts.join('; ')
      + '. Fusion PPM is sent the percentages; the amounts are worked out when the week posts.' : '';
    return { title: title, split: splitText, items: items, amount: sel.cost, count: sel.items };
  }

  /** The steps a post takes, in words, for what is ticked. */
  function steps(all, requestNumber) {
    var sel = rules.selection(all);
    var out = [];
    if (sel.weeks) out.push('Record ' + plural(sel.weeks, 'week') + ' in the posting ledger');
    if (sel.misc) out.push('Mark ' + plural(sel.misc, 'charge') + ' posted');
    if (sel.items) out.push('Send ' + (requestNumber || 'the request') + ' to Fusion PPM');
    return out;
  }

  /**
   * Exactly what Post will send, call by call, in its order: [{ n, method, path, what, body (JSON text), note }].
   * The ledger bodies are New's ledgerBody; the charges go as one id list; Fusion is sent the request number only.
   */
  function calls(all, row) {
    var cur = row || {};
    var out = [];
    rules.weeksToPost(all).forEach(function (r) {
      if (!r.requestLineId || !r.weekStartISO) return;
      var body = rules.ledgerBody(r, cur.rateScheduleId);
      out.push({ method: 'POST', path: body.splits ? PATHS.split : PATHS.week, what: (r.equipmentName || 'Equipment') + ' · ' + rules.weekName(r)
        + (body.splits ? ', split' : ''), body: JSON.stringify(body, null, 1), note: '' });
    });
    var misc = rules.miscToPost(all);
    if (misc.length) {
      out.push({ method: 'POST', path: PATHS.misc, what: plural(misc.length, 'charge') + ' marked posted',
        body: JSON.stringify({ ids: misc.map(function (x) { return Number(x.miscId); }) }), note: '' });
    }
    if (out.length) {
      out.push({ method: 'POST', path: PATHS.fusion, what: 'Send ' + (cur.requestNumber || 'the request') + ' to Fusion PPM',
        body: JSON.stringify({ requestNumber: String(cur.requestNumber || '') }),
        note: 'Sent only once something is recorded. If this integration server does not serve the project URL (404), the same body goes to '
          + PATHS.fusionV1 + '.' });
    }
    return out.map(function (c, i) { return Object.assign({ n: i + 1 }, c); });
  }

  // ── the week-by-week grid ─────────────────────────────────────────────────────────────────────────────

  /** New's "Mon Oct 12" as Next writes a day ("Mon 12 Oct"). */
  function dayLabel(label) {
    var m = /^([A-Z][a-z]{2}) ([A-Z][a-z]{2}) (\d{1,2})$/.exec(String(label || ''));
    return m ? m[1] + ' ' + m[3] + ' ' + m[2] : String(label || '');
  }

  /**
   * The rows of the week-by-week grid: each equipment, its weeks (a week's days under it while it is open) and its
   * charges, with what can be done to each. readOnly: what a role that may only look sees (nothing to tick or change).
   */
  function gridRows(all, hdr, readOnly) {
    var rows = all || [];
    var out = [];
    var open = {};
    rows.forEach(function (r) {
      if (r.kind === 'group') {
        out.push({ key: r.rowKey, kind: 'group', groupKey: r.groupKey, label: r.label,
          note: r.notStarted ? 'not started' : plural(Number(r.weekCount || 0), 'week'),
          rate: r.rateText || '—', tier: rules.tierText(r), days: rules.daysText(r), cost: Number(r.cost || 0),
          expType: r.expenditureTypeLocked ? 'From the purchase order' : (r.expenditureTypeMixed ? 'Mixed, choose one'
            : (r.expenditureType || 'Equipment (default)')),
          expEdit: !readOnly && !r.expenditureTypeLocked, expUnset: !r.expenditureType || !!r.expenditureTypeMixed,
          where: rules.whereText(r, hdr), word: '', tone: '',
          canAll: !readOnly && !!r.hasPostable, allOn: !!r.allSelected,
          canCharge: !readOnly && r.requestLineId != null,
          retier: !!r.tierChanged, canRetier: !readOnly && !!r.tierChanged, reversal: !!r.hasReversal });
      } else if (r.kind === 'week') {
        if (r.weekExpanded) open[r.rowKey] = 1;
        var locked = !!r.splitLocked;
        out.push({ key: r.rowKey, kind: 'week', groupKey: r.groupKey, label: rules.weekName(r), equipment: r.equipmentName || '',
          note: r.blackoutDays > 0 ? plural(Number(r.blackoutDays), 'day') + ' excluded' : '',
          rate: r.rateText || '—', tier: rules.tierText(r), days: rules.daysText(r), cost: Number(r.cost || 0),
          expType: r.lineExpenditureType || 'Equipment (default)', expEdit: false, expUnset: false,
          where: rules.whereText(r, hdr), word: rules.rowWord(r), tone: rules.rowTone(r),
          canTick: !readOnly && !!r.postable && !r.posted && !r.reversed, on: !!r.selected,
          canDays: !readOnly && !!r.canBlackout && !r.posted && !r.reversed, daysOpen: !!r.weekExpanded,
          canSplit: !readOnly && !locked, splitText: r.splitCount ? rules.splitLabel(r) : 'Split across projects',
          lockText: locked ? (r.splitCount ? rules.splitLabel(r) : (r.splitLockedByPr ? 'PO project' : '')) : '', lockWhy: r.splitLockReason || '' });
      } else if (r.kind === 'day') {
        if (!open[r.weekKey]) return;
        out.push({ key: r.rowKey, kind: 'day', groupKey: r.groupKey, label: dayLabel(r.label), excluded: !!r.blackout, inert: !!r.inert,
          canExclude: !readOnly && !r.locked && !r.inert, locked: !!r.locked, cost: Number(r.dayCost || 0) });
      } else if (r.kind === 'misc') {
        var draft = r.status !== 'POSTED';
        out.push({ key: r.rowKey, kind: 'misc', groupKey: r.groupKey, label: 'Charge: ' + r.label, equipment: r.equipmentName || '',
          note: r.expItemDate ? nxFmt.date(r.expItemDate) : '', rate: r.rateText || '—', tier: '', days: '—', cost: Number(r.cost || 0),
          expType: r.expenditureType || '—', expEdit: false, expUnset: false, where: rules.whereText(r, hdr), word: rules.rowWord(r), tone: rules.rowTone(r),
          canTick: !readOnly && draft, on: !!r.selected, canRemove: !readOnly && draft && !!r.miscId });
      }
    });
    return out;
  }

  /** The record's figures after a change made on screen (a day excluded): ready, running and the cost to date. */
  function refigure(facts, all, delta) {
    var f = facts || {};
    var s = rules.summarize({ rowsAll: all, postedCost: f.posted, totalCost: round2(Number(f.total || 0) + Number(delta || 0)) });
    return Object.assign({}, f, { ready: s.ready, readyWeeks: s.readyWeeks, readyCharges: s.readyCharges, running: s.running, runningWeeks: s.runningWeeks,
      pending: s.pending, pendingWeeks: s.pendingWeeks, total: Math.max(s.total, 0) });
  }

  // ── posting ───────────────────────────────────────────────────────────────────────────────────────────

  var STATUS_WORDS = {
    400: 'the request was refused as it stands',
    401: 'the service did not accept the sign-in',
    403: 'this sign-in may not do that',
    404: 'the service was not found',
    409: 'it conflicts with what is already recorded',
    422: 'the details were refused',
    500: 'the service failed',
    502: 'the service did not answer',
    503: 'the service is not available',
    504: 'the service did not answer in time'
  };

  /** What a service answered, in words: its own message when it gave one, with the HTTP status. */
  function errorWords(resp) {
    if (!resp) return 'there was no answer';
    var b = resp.body;
    var detail = '';
    if (b && typeof b === 'object') {
      var det = b['o:errorDetails'] || b.errorDetails;
      var first = Array.isArray(det) && det[0] ? (det[0].detail || det[0].title || det[0].message || '') : '';
      detail = b.detail || first || b.message || b.title || b.error_description || (typeof b.error === 'string' ? b.error : '') || '';
    } else if (typeof b === 'string' && !/^\s*</.test(b)) {
      detail = b;
    }
    detail = String(detail || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    var st = resp.status ? 'HTTP ' + resp.status : '';
    if (detail) return detail + (st ? ' (' + st + ')' : '');
    if (resp.status && STATUS_WORDS[resp.status]) return STATUS_WORDS[resp.status] + ' (' + st + ')';
    return st || 'there was no answer';
  }

  var busy = {};

  /** One post at a time per request, whatever the screen does. False when one is under way. */
  function claim(requestNumber) {
    var k = String(requestNumber || '');
    if (busy[k]) return false;
    busy[k] = true;
    return true;
  }

  function release(requestNumber) { delete busy[String(requestNumber || '')]; }

  /**
   * Posts what is ticked: New's postSelectedChain steps 1 and 2 (see the top). o: { rows (the preview tree), row (the
   * request: requestNumber, rateScheduleId, project), onProgress(result so far) }. Returns:
   *   { lines: [{ key, kind, what, amount, state, words }], charges, fusion: { state, words }, okCount, failCount,
   *     movedCost, miscOk, miscCost, miscFailed, sentToFusion, fusionFailed, recorded, postedKeys, postedMisc,
   *     summary, tone ('ok' | 'warn' | 'error') }
   * state: waiting → posting → recorded → posted (sent to Fusion), or failed.
   */
  async function post(context, Actions, o) {
    var opts = o || {};
    var cur = opts.row || {};
    var all = opts.rows || [];
    var number = String(cur.requestNumber || '');
    var toPost = rules.weeksToPost(all);
    var selMisc = rules.miscToPost(all);
    var named = {};
    plan(all, rules.hdrOf(cur), cur.rateScheduleId).forEach(function (p) { named[p.key] = p.what; });
    var lines = toPost.map(function (r) {
      return { key: r.rowKey, kind: 'week', what: named[r.rowKey] || ((r.equipmentName || 'Equipment') + ' · ' + r.label), amount: Number(r.cost || 0),
        state: 'waiting', words: 'Waiting' };
    });
    var charges = selMisc.length ? { count: selMisc.length, what: plural(selMisc.length, 'charge'), amount: round2(selMisc.reduce(function (s, x) {
      return s + Number(x.cost || 0); }, 0)), keys: selMisc.map(function (x) { return x.rowKey; }), state: 'waiting', words: 'Waiting' } : null;
    var fusion = { state: 'waiting', words: 'Sent to Fusion PPM once something is recorded' };
    var res = { lines: lines, charges: charges, fusion: fusion, okCount: 0, failCount: 0, movedCost: 0, miscOk: 0, miscCost: 0, miscFailed: false,
      sentToFusion: false, fusionFailed: false, recorded: false, postedKeys: [], postedMisc: [], summary: '', tone: '' };
    var tell = function () {
      if (typeof opts.onProgress !== 'function') return;
      try { opts.onProgress(snapshot(res)); } catch (e) { /* the page was left */ }
    };
    var setLine = function (i, state, words) { lines[i] = Object.assign({}, lines[i], { state: state, words: words }); };
    if (!toPost.length && !selMisc.length) return finish(res, number);

    // 1 RECORD: each week, one ledger call
    for (var i = 0; i < toPost.length; i++) {
      var r = toPost[i];
      if (!r.requestLineId || !r.weekStartISO) {
        res.failCount++;
        setLine(i, 'failed', 'Not posted: this week has no request line to record it against. It stays ready to post.');
        tell();
        continue;
      }
      var body = rules.ledgerBody(r, cur.rateScheduleId);
      setLine(i, 'posting', 'Recording in the posting ledger…');
      tell();
      try {
        var resp = await Actions.callRest(context, {
          endpoint: body.splits ? 'eqp-v1/createPostedWeekSplit' : 'eqp-v1/createPostedWeek',
          body: body
        });
        if (resp && resp.ok) {
          res.okCount++;
          res.movedCost += Number(r.cost || 0);
          res.postedKeys.push(r.rowKey);
          setLine(i, 'recorded', 'Recorded in the posting ledger');
        } else {
          res.failCount++;
          setLine(i, 'failed', 'Not posted: EquipRite could not record it: ' + errorWords(resp) + '. It stays ready to post.');
        }
      } catch (e) {
        res.failCount++;
        setLine(i, 'failed', 'Not posted: ' + ((e && e.message) || 'the call failed') + '. It stays ready to post.');
        console.error('[costPosting] ledger write failed', e && e.message);
      }
      tell();
    }

    // the charges: one call, all or nothing
    if (selMisc.length) {
      res.charges = Object.assign({}, res.charges, { state: 'posting', words: 'Marking the charges posted…' });
      tell();
      var m = null;
      try {
        m = await Actions.callRest(context, { endpoint: 'eqp-v1/postMiscTransactions', body: { ids: selMisc.map(function (x) { return Number(x.miscId); }) } });
      } catch (e) {
        m = { ok: false, status: 0, body: { message: (e && e.message) || 'the call failed' } };
      }
      if (m && m.ok) {
        res.miscOk = selMisc.length;
        res.miscCost = round2(selMisc.reduce(function (s, x) { return s + Number(x.cost || 0); }, 0));
        res.postedMisc = selMisc.map(function (x) { return x.rowKey; });
        res.charges = Object.assign({}, res.charges, { state: 'recorded', words: 'Marked posted' });
      } else {
        res.miscFailed = true;
        res.charges = Object.assign({}, res.charges, { state: 'failed', words: 'Not posted: EquipRite could not mark them posted: ' + errorWords(m)
          + '. They stay ready to post.' });
      }
      tell();
    }

    // 2 SEND: only if something was recorded
    res.recorded = res.okCount > 0 || res.miscOk > 0;
    if (res.recorded) {
      res.fusion = { state: 'posting', words: 'Sending ' + number + ' to Fusion PPM…' };
      tell();
      var f = null;
      try {
        f = await postCostToFusion.post(context, Actions, cur.requestNumber || '');
        if (f && f.ok) res.sentToFusion = true; else res.fusionFailed = true;
      } catch (e) {
        res.fusionFailed = true;
        f = { ok: false, status: 0, body: { message: (e && e.message) || 'the call failed' } };
      }
      res.fusion = res.sentToFusion
        ? { state: 'posted', words: 'Sent to Fusion PPM, which takes every recorded line of ' + number + ' not yet sent' }
        : { state: 'failed', words: 'Fusion PPM did not take it: ' + errorWords(f) + '. What was recorded stays recorded and goes with the next post.' };
      lines.forEach(function (l, j) {
        if (l.state !== 'recorded') return;
        setLine(j, res.sentToFusion ? 'posted' : 'recorded', res.sentToFusion ? 'Posted to Fusion PPM' : 'Recorded; not sent to Fusion PPM yet (it goes with the next post)');
      });
      if (res.charges && res.charges.state === 'recorded') {
        res.charges = Object.assign({}, res.charges, { state: res.sentToFusion ? 'posted' : 'recorded',
          words: res.sentToFusion ? 'Posted to Fusion PPM' : 'Marked posted; not sent to Fusion PPM yet (they go with the next post)' });
      }
    } else {
      res.fusion = { state: 'skipped', words: 'Not sent: nothing was recorded, so nothing went to Fusion PPM.' };
    }
    return finish(res, number);
  }

  function snapshot(res) {
    return { lines: res.lines.slice(), charges: res.charges ? Object.assign({}, res.charges) : null, fusion: Object.assign({}, res.fusion) };
  }

  /** The outcome in one or two sentences, and its tone. */
  function finish(res, number) {
    var parts = [];
    if (res.okCount) parts.push(plural(res.okCount, 'week') + ' (' + money(res.movedCost) + ')');
    if (res.miscOk) parts.push(plural(res.miscOk, 'charge') + ' (' + money(res.miscCost) + ')');
    var after = [];
    if (res.failCount) after.push(plural(res.failCount, 'week') + (res.failCount === 1 ? ' was' : ' were') + ' not recorded and ' + (res.failCount === 1 ? 'stays' : 'stay') + ' ready to post.');
    if (res.miscFailed) after.push('The charges were not posted and stay ready to post.');
    if (!res.recorded) {
      res.tone = 'error';
      if (!res.lines.length && !res.charges) res.summary = 'Nothing is ticked to post.';
      else if (res.failCount > 0) res.summary = 'Posting failed for ' + plural(res.failCount, 'week') + '. Nothing was recorded, so nothing was sent to Fusion PPM.';
      else res.summary = 'The charges could not be posted. Nothing was sent to Fusion PPM.';
      return res;
    }
    if (res.sentToFusion) {
      res.summary = 'Posted ' + parts.join(' and ') + ' of ' + number + ' to Fusion PPM.' + (after.length ? ' ' + after.join(' ') : '');
      res.tone = after.length ? 'warn' : 'ok';
    } else {
      res.summary = 'Recorded ' + parts.join(' and ') + ' of ' + number + ' in EquipRite, but the send to Fusion PPM failed. It goes again with the next post.'
        + (after.length ? ' ' + after.join(' ') : '');
      res.tone = 'warn';
    }
    return res;
  }

  /** The lines just recorded, posted on screen at once (the read that follows replaces them). */
  function markPosted(all, res) {
    var weeks = {};
    var misc = {};
    ((res && res.postedKeys) || []).forEach(function (k) { weeks[k] = 1; });
    ((res && res.postedMisc) || []).forEach(function (k) { misc[k] = 1; });
    return rules.restampSelection((all || []).map(function (r) {
      if (r.kind === 'week' && weeks[r.rowKey]) return Object.assign({}, r, { posted: true, postable: false, selected: false, whenTag: 'Posted', weekExpanded: false });
      if (r.kind === 'misc' && misc[r.rowKey]) return Object.assign({}, r, { posted: true, postable: false, status: 'POSTED', selected: false, whenTag: 'Posted' });
      return r;
    }));
  }

  // ── telling the list ──────────────────────────────────────────────────────────────────────────────────

  var listeners = {};

  /** A screen that shows posted figures (the Post costs list): fn(requestNumber) runs after a request is posted. */
  function onPosted(key, fn) {
    if (typeof fn === 'function') listeners[key] = fn;
    else delete listeners[key];
  }

  function announce(requestNumber) {
    Object.keys(listeners).forEach(function (k) {
      try { listeners[k](requestNumber); } catch (e) { /* a closed tab's page */ }
    });
  }

  return {
    PATHS: PATHS,
    tickable: tickable,
    select: select,
    untickedOf: untickedOf,
    tick: tick,
    toggleDays: toggleDays,
    plan: plan,
    itemsText: itemsText,
    ownProject: ownProject,
    sentence: sentence,
    steps: steps,
    calls: calls,
    dayLabel: dayLabel,
    gridRows: gridRows,
    refigure: refigure,
    errorWords: errorWords,
    claim: claim,
    release: release,
    post: post,
    markPosted: markPosted,
    onPosted: onPosted,
    announce: announce
  };
});
