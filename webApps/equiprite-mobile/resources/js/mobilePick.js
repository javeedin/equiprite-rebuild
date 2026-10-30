define(['resources/js/yardWork', 'resources/js/requestProgress', 'resources/js/fmt', 'resources/js/mobileRecent'], function (yw, Progress, fmt, recent) {
  'use strict';

  // EquipRite Mobile's Pick tab, pure (no calls, no storage, no DOM): what a phone in the yard shows of Next's yard
  // rules. The rules stay Next's (resources/js/yardWork.js: the queue, the sections, the ticks, the transfer orders,
  // what Release and Pick and ship move, which steps write to Fusion); this module only arranges them for a thumb:
  //   - the list as cards with a progress ring (how many pieces are picked, how many have shipped);
  //   - a request's pieces as a checklist, by step, in walking order (pickSlip's rule: subinventory, then locator),
  //     with the next piece to fetch;
  //   - a scanned or typed unit matched to its piece (or to the request it is really on);
  //   - what the Release and Ship sheets say before anything is sent;
  //   - the copy kept on the phone for a yard with no signal (the list, the requests opened, the ticks);
  //   - the list on the last few days (mobileRecent), from the dates a work item carries: the request's start and end,
  //     the day it is needed by, its pieces' start and end.
  //
  // A tick is Next's tick (it scopes Release and Pick and ship). On a phone it means "picked" for a piece being picked
  // and "release this one" for a fixed asset waiting for release. Only those two kinds can be ticked: a stock piece
  // waits for its transfer order to be released in Fusion (New EquipRite), and a shipped piece is done. Every set of
  // ticks a phone can make is one Next can make; what is sent is worked out by the same chains from it.

  var RELEASABLE = ['SCHEDULED_FOR_PICKING', 'ALLOCATED'];  // yardWork's release rule (Next's, New's)
  var OPEN = ['pick', 'picking', 'ship'];                    // yardWork's open picking stages
  var TICKS_KEEP_MS = 12 * 3600000;                          // ticks kept on the phone: a shift
  var WORKS_KEPT = 12;                                       // requests whose pick list the phone keeps
  var SAME_SCAN_MS = 2500;                                   // the same tag read again this soon is the same read

  // hint: for someone who acts; look: for read-only access, which sees the same pieces and takes no step.
  var GROUPS = [
    { key: 'release', label: 'To release for picking', hint: 'Fixed assets, no transfer order: tick them, then release them here.',
      look: 'Fixed assets, no transfer order: released for picking in EquipRite.' },
    { key: 'pick', label: 'Being picked', hint: 'Tick each piece as you pick it, or scan its tag.', look: 'Released for picking: picked in the yard, then shipped.' },
    { key: 'fusion', label: 'Waiting for release in Fusion', hint: 'On a transfer order: it is released in New EquipRite first.',
      look: 'On a transfer order: it is released in New EquipRite first.' },
    { key: 'shipped', label: 'Shipped', hint: 'On the way to site.', look: 'On the way to site.' }
  ];

  function s(v) { return v === null || v === undefined ? '' : String(v); }
  function up(v) { return s(v).trim().toUpperCase(); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function tickSet(ticks) {
    var out = {};
    (Array.isArray(ticks) ? ticks : []).forEach(function (t) { out[String(t)] = true; });
    return out;
  }
  function uniq(list) {
    var out = [];
    list.forEach(function (x) { if (x && out.indexOf(x) === -1) out.push(x); });
    return out;
  }

  // ── A piece's step on a phone ─────────────────────────────────────────────────────────────────────────────────
  /** 'release' (fixed asset waiting for release) | 'pick' (being picked) | 'fusion' (stock waiting for Fusion) | 'shipped'. */
  function stepOf(line) {
    var st = up(line && line.lineStatus);
    if (st === 'PICK_INITIATED') return 'pick';
    if (st === 'SHIP_TO_SITE') return 'shipped';
    if (RELEASABLE.indexOf(st) !== -1) return line.isFAndM === true ? 'release' : 'fusion';
    return 'other';
  }

  function tickable(line) {
    var st = stepOf(line);
    return st === 'pick' || st === 'release';
  }

  /** The ticks kept for a request that still mean something: lines still on it, still tickable. */
  function liveTicks(lines, ticks) {
    var t = tickSet(ticks);
    return (Array.isArray(lines) ? lines : []).filter(function (l) { return l && t[String(l.lineId)] && tickable(l); })
      .map(function (l) { return String(l.lineId); });
  }

  /** The ticks once Release has moved these lines on: a released piece is ticked again when it is picked. */
  function afterRelease(ticks, releasedIds) {
    var gone = tickSet(releasedIds);
    return (Array.isArray(ticks) ? ticks : []).map(String).filter(function (t) { return !gone[t]; });
  }

  /** A group's box: every piece of the group ticked, or none of it (the other groups' ticks stay). */
  function toggleGroup(lines, ticks, group) {
    var list = Array.isArray(lines) ? lines : [];
    var inGroup = function (l) { return stepOf(l) === group; };
    var all = yw.allTicked(list, ticks, inGroup);
    var out = (Array.isArray(ticks) ? ticks : []).map(String);
    list.filter(inGroup).forEach(function (l) { out = yw.toggleTick(out, l.lineId, !all); });
    return out;
  }

  // ── Walking order (pickSlip.sortForWalk's rule) ───────────────────────────────────────────────────────────────
  function cmp(a, b) { return s(a).localeCompare(s(b), undefined, { numeric: true, sensitivity: 'base' }); }

  /** By subinventory, then locator, then name; pieces with neither last. The order the pick slip prints. */
  function walk(lines) {
    return (Array.isArray(lines) ? lines : []).slice().sort(function (a, b) {
      var aUn = !s(a.subinventory).trim() && !s(a.locator).trim();
      var bUn = !s(b.subinventory).trim() && !s(b.locator).trim();
      if (aUn !== bUn) return aUn ? 1 : -1;
      return cmp(a.subinventory, b.subinventory) || cmp(a.locator, b.locator) || cmp(a.equipmentName, b.equipmentName);
    });
  }

  /** The unit numbers allocated to a line (its serials, as openWorkChain read them). */
  function unitsOf(line) {
    var l = line || {};
    var out = uniq((Array.isArray(l.allocUnits) ? l.allocUnits : []).map(function (u) { return s(u && u.serialNumber).trim(); }));
    if (!out.length) out = uniq(s(l.serialNumber).split(',').map(function (x) { return x.trim(); }));
    return out;
  }

  /** The unit numbers in a views/line-detail-units answer (the allocated rows, as openWorkChain reads them). */
  function unitNumbers(rows) {
    return uniq((Array.isArray(rows) ? rows : []).filter(function (u) { return u && u.allocationId != null; })
      .map(function (u) { return s(u.unitNumber).trim(); }));
  }

  /** Where to pick it: "Houston Yard · Available · A-12-04" (Next's words). */
  function where(line) {
    return [line && line.yard, line && line.subinventory, line && line.locator].filter(function (v) { return !!v; }).join(' · ') || 'Yard not recorded';
  }

  function pieceOf(line, t, external, problems) {
    var step = stepOf(line);
    var info = Progress.line(line.lineStatus, !!external);
    var units = unitsOf(line);
    var on = !!t[String(line.lineId)] && tickable(line);
    var word = {
      release: on ? 'To release' : 'Tick to release',
      pick: on ? 'Picked' : 'Tick when picked',
      fusion: 'Released in Fusion first',
      shipped: 'Shipped'
    }[step] || '';
    return {
      lineId: String(line.lineId),
      name: line.equipmentName || 'Equipment',
      qty: Number(line.quantity) || 1,
      cls: line.equipmentClass || '',
      unit: units.join(', '),
      units: units,
      spot: [line.subinventory, line.locator].filter(function (v) { return !!v; }).join(' · '),
      yard: line.yard || '',
      where: where(line),
      fm: line.isFAndM === true,
      toNumber: line.toNumber || '',
      step: step,
      label: info.label || '—',
      tone: info.stage || 'ready',
      tickable: tickable(line),
      ticked: on,
      word: word,
      problem: problems[String(line.lineId)] || ''
    };
  }

  /** The ring's colours, as a style object (JET's :style takes one): shipped, picked, being picked, still to do. */
  function ring(total, shipped, picked, picking) {
    if (!total) return { backgroundImage: 'conic-gradient(var(--mb-line) 0 100%)' };
    var pc = function (n) { return Math.round(Math.max(0, Math.min(100, (n / total) * 100)) * 10) / 10 + '%'; };
    var a = pc(shipped);
    var b = pc(shipped + picked);
    var c = pc(shipped + picked + picking);
    return { backgroundImage: 'conic-gradient(var(--mb-ok) 0 ' + a + ', var(--mb-accent) 0 ' + b + ', var(--mb-warn) 0 ' + c + ', var(--mb-line) 0 100%)' };
  }

  /** "TO-778402, TO-778399 · 2 awaiting release" (Next's words). */
  function toList(tos) {
    var list = Array.isArray(tos) ? tos : [];
    if (!list.length) return '';
    var waiting = list.filter(function (t) { return !t.released; }).length;
    return list.map(function (t) { return t.orderNumber || 'one being created'; }).join(', ')
      + ' · ' + (waiting === 0 ? (list.length === 1 ? 'released' : 'all released')
        : (waiting === list.length && list.length > 1 ? 'all awaiting release' : waiting + ' awaiting release'));
  }

  /** "2 pieces on transfer order TO-778402 wait for release." (Next's stockReleaseText). */
  function fusionText(lines, tos) {
    var n = yw.stockToRelease(lines).length;
    if (!n) return '';
    var list = yw.unreleasedTOs(tos).map(function (t) { return t.orderNumber || 'a transfer order still being created in Fusion'; }).join(', ');
    return plural(n, 'piece') + (list ? ' on transfer order ' + list : ' on a transfer order still being created in Fusion')
      + (n === 1 ? ' waits' : ' wait') + ' for release.';
  }

  /**
   * A request's pick list on a phone, from the workspace openWorkChain read (Next's) and the ticks:
   *   groups     [{ key, label, hint, count, ticked, all, pieces }] by step, each in walking order
   *   next       the next piece to fetch: the first being picked and not yet ticked, in walking order
   *   total, picked (shipped + ticked as picked), shipped, progress ("3 of 5 picked"), ring
   *   release    ticked fixed assets Release would move (yardWork.fmToRelease)
   *   canShip, ship   Pick and ship's gate and how many it would move (yardWork.canShip, shipLines)
   *   relocates  pieces of that set whose maintenance asset Fusion would move (asset sync on): left to New
   *   primary    the screen's one main step: 'release' | 'ship' | '' (then hint says what to do)
   * o: { syncOn, external }
   */
  function checklist(work, ticks, selectedTOId, o) {
    var w = work || {};
    var opts = o || {};
    var lines = Array.isArray(w.lines) ? w.lines : [];
    var tos = Array.isArray(w.tos) ? w.tos : [];
    var t = tickSet(ticks);
    var problems = {};
    (Array.isArray(w.exceptions) ? w.exceptions : []).forEach(function (x) { if (x) problems[String(x.lineId)] = x.issue || ''; });
    var pieces = walk(lines).map(function (l) { return pieceOf(l, t, opts.external, problems); }).filter(function (p) { return p.step !== 'other'; });
    var groups = GROUPS.map(function (g) {
      var ps = pieces.filter(function (p) { return p.step === g.key; });
      var on = ps.filter(function (p) { return p.ticked; }).length;
      return { key: g.key, label: g.label, hint: g.hint, look: g.look, count: ps.length, ticked: on, all: ps.length > 0 && on === ps.length,
        tickable: g.key === 'pick' || g.key === 'release', pieces: ps };
    }).filter(function (g) { return g.count > 0; });
    var at = function (step) { return pieces.filter(function (p) { return p.step === step; }); };
    var shipped = at('shipped').length;
    var pickedNow = at('pick').filter(function (p) { return p.ticked; }).length;
    var picking = at('pick').length - pickedNow;
    var total = pieces.length;
    var picked = shipped + pickedNow;
    var shipSet = yw.shipLines(tos, selectedTOId, lines, ticks);
    var canShip = yw.canShip(tos, selectedTOId, lines, ticks);
    var release = yw.fmToRelease(lines, ticks).length;
    var relocates = opts.syncOn
      ? yw.fusionRelocations(true, shipSet.map(function (l) { return { isMaintenanceTracked: l.maintenanceTracked, isTransactable: l.transactable }; })).length : 0;
    var primary = release ? 'release' : (canShip ? 'ship' : '');
    return {
      groups: groups,
      next: at('pick').filter(function (p) { return !p.ticked; })[0] || null,
      total: total,
      picked: picked,
      shipped: shipped,
      ticked: pieces.filter(function (p) { return p.ticked; }).length,
      progress: total ? picked + ' of ' + total + ' picked' : 'Nothing at a picking step',
      ring: ring(total, shipped, pickedNow, picking),
      ringText: total ? picked + '/' + total : '–',
      release: release,
      canShip: canShip,
      ship: shipSet.length,
      shipAllTicked: shipSet.length > 0 && shipSet.every(function (l) { return t[String(l.lineId)]; }),
      relocates: relocates,
      fusion: at('fusion').length,
      fusionText: fusionText(lines, tos),
      awaitingRelease: at('release').length,
      released: lines.some(function (l) { return ['PICK_INITIATED', 'SHIP_TO_SITE', 'DELIVERED', 'DEPLOYED'].indexOf(up(l.lineStatus)) !== -1; }),
      tos: toList(tos),
      primary: primary,
      hint: primary ? '' : hintFor(pieces, tos, selectedTOId, lines, ticks)
    };
  }

  function hintFor(pieces, tos, selectedTOId, lines, ticks) {
    var at = function (step) { return pieces.filter(function (p) { return p.step === step; }); };
    if (at('release').length && !at('pick').length) return 'Tick the fixed-asset pieces to release them';
    if (at('pick').length) {
      var sel = (tos || []).filter(function (x) { return String(x.value) === String(selectedTOId); })[0];
      if (sel && !sel.released) return 'Transfer order ' + (sel.orderNumber || '') + ' still has pieces waiting for release in Fusion';
      var orders = uniq(yw.selectedLines(lines, ticks).map(function (l) { return s(l.toNumber); }));
      if (orders.length > 1) return 'Tick the pieces of one transfer order at a time to ship them';
      return 'Tick the pieces as you pick them';
    }
    if (at('fusion').length) return 'Waiting for release in Fusion';
    if (pieces.length && at('shipped').length === pieces.length) return 'Everything here has shipped';
    return '';
  }

  /** The request's other pieces (not at a picking step handled here), from the list's lines (Next's otherLines). */
  function otherLines(raw, workLines, external) {
    if (!Array.isArray(raw)) return [];
    var here = {};
    (workLines || []).forEach(function (l) { here[String(l.lineId)] = true; });
    return raw.filter(function (r) { return !here[String(r.lineId)]; }).map(function (r) {
      var info = Progress.line(r.lineStatus, !!external);
      return { lineId: String(r.lineId), name: r.equipmentName || 'Equipment', cls: r.className || '', qty: r.quantity || 1, status: r.lineStatus || '',
        label: info.label, tone: info.stage || 'ready', next: info.who ? info.who + ' to ' + info.what : '' };
    });
  }

  // ── What the sheets say, before anything is sent ──────────────────────────────────────────────────────────────
  function sheetPieces(lines, t) {
    return walk(lines).map(function (l) {
      return { lineId: String(l.lineId), name: l.equipmentName || 'Equipment', qty: Number(l.quantity) || 1, unit: unitsOf(l).join(', '),
        spot: [l.subinventory, l.locator].filter(function (v) { return !!v; }).join(' · '), ticked: !!t[String(l.lineId)] };
    });
  }

  /**
   * The Ship sheet: "Ship 3 pieces of REQ-2003 to EPC_MO_Operations", the pieces Pick and ship would move (picked the
   * way the ship chain picks them), which of them are not ticked as picked, and the ids, so the ship chain can check
   * that what it reads live is what the sheet said.
   */
  function shipSheet(work, ticks, selectedTOId) {
    var w = work || {};
    var req = w.req || {};
    var set = yw.shipLines(w.tos, selectedTOId, w.lines, ticks);
    var t = tickSet(ticks);
    var pieces = sheetPieces(set, t);
    var unticked = pieces.filter(function (p) { return !p.ticked; }).length;
    var n = pieces.length;
    return {
      kind: 'ship',
      count: n,
      ids: set.map(function (l) { return String(l.lineId); }),
      title: 'Ship ' + plural(n, 'piece') + ' of ' + (req.requestNumber || 'this request') + (req.party ? ' to ' + req.party : ''),
      to: req.location || '',
      pieces: pieces,
      unticked: unticked,
      untickedText: !unticked ? '' : (unticked === n
        ? (n === 1 ? 'It is not ticked as picked.' : 'None of them is ticked as picked.')
        : plural(unticked, 'of these is', 'of these are') + ' not ticked as picked.')
        + ' EquipRite ships every piece being picked on this request (or every piece of the one transfer order ticked): make sure '
        + (n === 1 ? 'it is' : 'they are') + ' on the truck.',
      button: 'Ship ' + plural(n, 'piece')
    };
  }

  /** The Release sheet: the ticked fixed assets waiting for release (yardWork.fmToRelease, what Release moves). */
  function releaseSheet(work, ticks) {
    var w = work || {};
    var req = w.req || {};
    var set = yw.fmToRelease(w.lines, ticks);
    var n = set.length;
    return {
      kind: 'release',
      count: n,
      ids: set.map(function (l) { return String(l.lineId); }),
      title: 'Release ' + plural(n, 'fixed-asset piece') + ' of ' + (req.requestNumber || 'this request') + ' for picking',
      pieces: sheetPieces(set, tickSet(ticks)),
      note: 'EquipRite marks ' + (n === 1 ? 'it' : 'them') + ' being picked (Pick initiated). They have no transfer order: nothing is sent to Fusion.',
      button: 'Release ' + plural(n, 'piece')
    };
  }

  // ── A scanned or typed unit ───────────────────────────────────────────────────────────────────────────────────
  function norm(v) { return up(v).replace(/\s+/g, ''); }
  function tokens(v) { return up(v).split(/[^A-Z0-9._-]+/).filter(function (x) { return !!x; }); }

  /** Whether what was read is this unit: the same number (any case, spaces aside), or a tag (a QR link) holding it. */
  function sameUnit(read, unit) {
    var a = norm(read);
    var b = norm(unit);
    if (!a || !b) return false;
    return a === b || tokens(read).indexOf(b) !== -1;
  }

  function lineForUnit(lines, value) {
    var list = Array.isArray(lines) ? lines : [];
    var exact = list.filter(function (l) { return unitsOf(l).some(function (u) { return norm(u) === norm(value); }); })[0];
    return exact || list.filter(function (l) { return unitsOf(l).some(function (u) { return sameUnit(value, u); }); })[0] || null;
  }

  /** The units the list knows: from request-detail-lines' serial, and from the yard lookups (units: { lineId: [..] }). */
  function listUnits(items, units) {
    var u = units || {};
    var out = [];
    (Array.isArray(items) ? items : []).forEach(function (it) {
      (it.pieces || []).forEach(function (p) {
        var nums = uniq(s(p.serial).split(',').map(function (x) { return x.trim(); }).concat(Array.isArray(u[p.lineId]) ? u[p.lineId] : []));
        nums.forEach(function (n) { out.push({ unit: n, id: it.id, number: it.requestNumber, party: it.party || '', lineId: p.lineId, stage: p.stage }); });
      });
    });
    return out;
  }

  /** The request a unit is on, of today's work: { id, number, party, lineId, unit } or null. Exact numbers first. */
  function findInList(items, units, value) {
    var all = listUnits(items, units);
    return all.filter(function (x) { return norm(x.unit) === norm(value); })[0]
      || all.filter(function (x) { return sameUnit(value, x.unit); })[0] || null;
  }

  /**
   * What a read means on the open request: { tone: ok | info | warn | miss, title, text, lineId, tick, buzz: hit | miss }.
   *   o: { canTick (FULL access), number, party, items, units } (items and units: the list, to say where else it is)
   */
  function scanResult(work, ticks, value, o) {
    var opts = o || {};
    var w = work || {};
    var read = s(value).trim();
    var number = opts.number || (w.req && w.req.requestNumber) || 'this request';
    var line = lineForUnit(w.lines, read);
    if (!line) {
      var elsewhere = findInList((opts.items || []).filter(function (it) { return String(it.id) !== String(w.req && w.req.id); }), opts.units, read);
      return {
        tone: 'miss', buzz: 'miss', tick: false, lineId: '', unit: read,
        title: read + ' is not on ' + number,
        text: elsewhere ? 'It is on ' + elsewhere.number + (elsewhere.party ? ' (' + elsewhere.party + ')' : '') + '. Nothing was ticked.'
          : 'Check the tag, or type the unit number. Nothing was ticked.'
      };
    }
    var p = pieceOf(line, tickSet(ticks), opts.external, {});
    var unit = lineForUnitNumber(line, read);
    var base = { lineId: p.lineId, unit: unit, buzz: 'hit', tick: false };
    var named = p.name + (unit ? ' · ' + unit : '');
    if (!opts.canTick) return Object.assign(base, { tone: 'info', title: named, text: 'On this request: ' + p.label + '. ' + p.where + '.' });
    if (p.step === 'shipped') return Object.assign(base, { tone: 'info', title: named, text: 'It has already shipped.' });
    if (p.step === 'fusion') {
      return Object.assign(base, { tone: 'warn', title: named, text: 'Its transfer order ' + (line.toNumber ? line.toNumber + ' ' : '')
        + 'is released in Fusion first (New EquipRite): not ticked.' });
    }
    if (p.ticked) return Object.assign(base, { tone: 'info', title: named, text: 'Already ticked ' + (p.step === 'release' ? 'to release.' : 'as picked.') });
    return Object.assign(base, { tone: 'ok', tick: true, title: (p.step === 'release' ? 'To release: ' : 'Picked: ') + named, text: p.where });
  }

  function lineForUnitNumber(line, read) {
    return unitsOf(line).filter(function (u) { return sameUnit(read, u); })[0] || '';
  }

  /** The same tag read again within a moment (the camera keeps seeing it): ignored. */
  function sameScan(last, value, now) {
    return !!last && norm(last.value) === norm(value) && (now - (last.at || 0)) < SAME_SCAN_MS;
  }

  /** A buzz in the hand, where the phone can: short on a match, twice on a miss, a tap on a tick. */
  function vibrate(nav, kind) {
    try {
      if (!nav || typeof nav.vibrate !== 'function' || !kind) return false;
      return nav.vibrate(kind === 'miss' ? [90, 60, 90] : (kind === 'tap' ? 15 : 45)) !== false;
    } catch (e) {
      return false;
    }
  }

  // ── The list ──────────────────────────────────────────────────────────────────────────────────────────────────
  /** The stage chips: All, then yardWork's tiles (late, to pick, being picked, ready to ship, shipped). */
  function chips(tiles, items) {
    var all = (Array.isArray(items) ? items : []).length;
    return [{ key: 'all', label: 'All', count: all }].concat((Array.isArray(tiles) ? tiles : []).map(function (t) {
      return { key: t.key, label: t.label, count: t.count, tone: t.tone };
    }));
  }

  /** A card per request: when it must ship, where to, the yards, its pieces and how many are picked. */
  function card(item, kept, now) {
    var it = item || {};
    var pieces = Array.isArray(it.pieces) ? it.pieces : [];
    var entry = ticksOf(kept, it.id, now);
    var t = tickSet(entry ? entry.ticks : []);
    var shipped = pieces.filter(function (p) { return p.stage === 'shipped'; }).length;
    var ready = pieces.filter(function (p) { return p.stage === 'ship'; }).length;
    var tickedPick = pieces.filter(function (p) { return p.status === 'PICK_INITIATED' && t[p.lineId]; }).length;
    var picking = pieces.filter(function (p) { return p.stage === 'picking'; }).length - tickedPick;
    var total = pieces.length;
    var picked = shipped + ready + tickedPick;
    var when = it.when || { main: '', sub: '' };
    var next = it.next || { text: '', where: '', note: '' };
    return {
      id: String(it.id || ''),
      number: it.requestNumber || '',
      party: it.party || (it.isCustomer ? 'Customer' : 'No project'),
      sub: [it.task, it.location ? 'to ' + it.location : ''].filter(function (v) { return !!v; }).join(' · '),
      when: when.main || '',
      whenSub: when.sub || '',
      tone: it.late > 0 ? 'late' : (it.section === 'today' ? 'today' : (it.section === 'done' ? 'done' : 'plain')),
      yard: it.yardText && it.yardText !== '—' ? it.yardText : '',
      summary: it.summary || '',
      next: next.text || '',
      where: next.where || '',
      total: total,
      picked: picked,
      shipped: shipped,
      pickedText: total ? picked + ' of ' + plural(total, 'piece') + ' picked' : '',
      ringText: total ? picked + '/' + total : '–',
      ring: ring(total, shipped, ready + tickedPick, Math.max(0, picking)),
      kept: tickedPick ? plural(tickedPick, 'piece') + ' ticked on this phone' : '',
      offline: !!(entry && entry.offline && entry.ticks.length)
    };
  }

  /** yardWork's sections, with a card for each request. */
  function sections(list, kept, now) {
    return (Array.isArray(list) ? list : []).map(function (sec) {
      return Object.assign({}, sec, { cards: (sec.items || []).map(function (it) { return card(it, kept, now); }) });
    });
  }

  // ── The period (mobileRecent) ───────────────────────────────────────────────────────────────────────────────
  /** A work item's latest date (ms, null when it has none): the request's start and end, the day it is needed by, its pieces'. */
  function lastAt(item) {
    var it = item || {};
    var more = [it.date];
    (Array.isArray(it.pieces) ? it.pieces : []).forEach(function (p) { more.push(p && p.start, p && p.end); });
    return recent.latest(it, more, recent.SPAN);
  }

  /** The work items of the last few days (what the list opens on, and what the tab's count counts). */
  function recentItems(items, now) { return recent.only(items, now, lastAt); }

  /** What the list shows for the period and the search (mobileRecent.view, over work items). */
  function period(items, which, text, now) { return recent.view(items, which, text, now, lastAt); }

  /**
   * The line under the title (yardWork's); when the list is the last few days of work that is not empty (lately):
   * "7 pieces to get out on 3 requests in the last 3 days · 4 late", or "Nothing waiting to go out in the last 3 days.".
   */
  function summary(items, lately) {
    var said = yw.summary('picking', items);
    if (!lately) return said;
    if (!(items || []).length) return 'Nothing waiting to go out ' + recent.PHRASE + '.';
    var parts = said.split(' · ');
    parts[0] = parts[0] + ' ' + recent.PHRASE;
    return parts.join(' · ');
  }

  /** Pieces still to get out of the yard (to pick, being picked, ready to ship): the Pick tab's count. */
  function left(items) {
    return (Array.isArray(items) ? items : []).reduce(function (n, it) {
      return n + (it.pieces || []).filter(function (p) { return OPEN.indexOf(p.stage) !== -1; }).length;
    }, 0);
  }

  /** The yard chosen, in words. */
  function yardLabel(yard) { return !yard || yard === 'all' ? 'All yards' : yard; }

  /** New EquipRite's Initiate picking (Next's nav.newUrl for 'picking'): where the Fusion steps are done. */
  function newUrl(base) {
    if (!base) return '';
    return (base.slice(-1) === '/' ? base : base + '/') + 'vp/shell/logistics/picking';
  }

  // ── The copy kept on the phone (offlineSnapshot, under 'pick', per user) ──────────────────────────────────────
  //   { list: { at, records, linesBy, yards, units }, works: { id: { at, work } }, ticks: { id: { at, ticks, offline,
  //     number } }, yard: 'Houston Yard' }
  var LINE_FIELDS = ['lineId', 'id', 'eqrEquipmentRequestLineId', 'lineNumber', 'equipmentName', 'name', 'itemName', 'className', 'equipmentClass',
    'qty', 'quantity', 'lineStatus', 'status', 'requestStatus', 'allocationStatus', 'allocatedSerialNumber', 'allocatedSerial', 'serialNumber',
    'startDate', 'requestedStartDate', 'endDate', 'requestedEndDate', 'deploymentLocation', 'location', 'toNumber', 'inboundToNumber',
    'fulfilmentClass', 'fulfilment_class', 'isTransactable', 'is_transactable', 'requestNumber'];

  function compactLine(r) {
    var out = {};
    LINE_FIELDS.forEach(function (k) { if (r && r[k] !== undefined && r[k] !== null && r[k] !== '') out[k] = r[k]; });
    return out;
  }

  function kept(raw) {
    var d = raw && typeof raw === 'object' ? raw : {};
    return { list: d.list || null, works: d.works || {}, ticks: d.ticks || {}, yard: d.yard || '' };
  }

  /** The list as loaded (queue rows, their lines in the fields the list reads, yards, units). */
  function withList(k, records, linesBy, yards, units, now) {
    var by = {};
    Object.keys(linesBy || {}).forEach(function (id) {
      var rows = linesBy[id];
      by[id] = Array.isArray(rows) ? rows.map(compactLine) : null;
    });
    return Object.assign({}, kept(k), { list: { at: now, records: records || [], linesBy: by, yards: yards || {}, units: units || {} } });
  }

  /** A request's pick list as read (the newest few). */
  function withWork(k, work, now) {
    var base = kept(k);
    var id = String(work && work.req && work.req.id || '');
    if (!id) return base;
    var works = Object.assign({}, base.works);
    works[id] = { at: now, work: work };
    var ids = Object.keys(works).sort(function (a, b) { return (works[b].at || 0) - (works[a].at || 0); });
    ids.slice(WORKS_KEPT).forEach(function (x) { delete works[x]; });
    return Object.assign({}, base, { works: works });
  }

  /**
   * A request's ticks. offline: true marks ticks made with no connection (picked, not yet sent), false clears the mark
   * (they were sent), undefined keeps it. No ticks: the request is forgotten.
   */
  function withTicks(k, id, number, ticks, offline, now) {
    var base = kept(k);
    var all = Object.assign({}, base.ticks);
    var key = String(id || '');
    if (!key) return base;
    var list = (Array.isArray(ticks) ? ticks : []).map(String);
    var was = all[key];
    var mark = offline === true ? true : (offline === false ? false : !!(was && was.offline));
    if (!list.length) delete all[key];
    else all[key] = { at: now, ticks: list, number: number || (was && was.number) || '', offline: mark };
    return Object.assign({}, base, { ticks: all });
  }

  /**
   * Changes the copy kept on the phone: reads it fresh (another step may have changed it meanwhile), applies change
   * (kept → kept) and saves it. store is offlineSnapshot; the copy is per user, under 'pick'. Never throws.
   */
  function keep(store, user, change, now) {
    try {
      var at = now || Date.now();
      var next = change(kept((store.read('pick', user) || {}).data), at);
      return store.save('pick', user, next, at);
    } catch (e) {
      return false;
    }
  }

  /** The copy kept on the phone, read (offlineSnapshot): always the full shape. */
  function read(store, user) {
    try {
      return kept((store.read('pick', user) || {}).data);
    } catch (e) {
      return kept(null);
    }
  }

  function withYard(k, yard) { return Object.assign({}, kept(k), { yard: yard && yard !== 'all' ? String(yard) : '' }); }

  /** A request's ticks kept on the phone, while they are fresh (a shift): { at, ticks, offline, number } or null. */
  function ticksOf(k, id, now) {
    var e = kept(k).ticks[String(id || '')];
    if (!e || !Array.isArray(e.ticks) || !e.ticks.length) return null;
    if (now && e.at && now - e.at > TICKS_KEEP_MS) return null;
    return e;
  }

  /** Requests with pieces ticked with no connection, still to send: [{ id, number, count, text }]. */
  function pending(k, now) {
    var all = kept(k).ticks;
    return Object.keys(all).map(function (id) { return Object.assign({ id: id }, all[id]); })
      .filter(function (e) { return e.offline && ticksOf(k, e.id, now); })
      .map(function (e) {
        return { id: e.id, number: e.number || 'A request', count: e.ticks.length,
          text: (e.number || 'A request') + ': ' + plural(e.ticks.length, 'piece') + ' ticked with no connection, kept on this phone' };
      });
  }

  /** A work saved on the phone: { at, work } or null. */
  function workOf(k, id) { return kept(k).works[String(id || '')] || null; }

  /** "2 days late · needed Wed 28 Oct" / "Today · Fri 30 Oct" / "Thu 5 Nov · in 6 days": when the open request must ship. */
  function whenText(req, now) {
    var start = req && req.start;
    var d = start ? fmt.dayMs(start) : null;
    if (d == null) return 'No date';
    var n = Math.round((d - fmt.today(now)) / 86400000);
    var day = yw.dayLabel(start, now);
    if (n < 0) return plural(-n, 'day') + ' late · needed ' + day;
    if (n === 0) return 'Today · ' + day;
    if (n === 1) return 'Tomorrow · ' + day;
    return day + ' · ' + fmt.relative(start, now);
  }

  return {
    GROUPS: GROUPS,
    TICKS_KEEP_MS: TICKS_KEEP_MS,
    WORKS_KEPT: WORKS_KEPT,
    stepOf: stepOf,
    tickable: tickable,
    liveTicks: liveTicks,
    afterRelease: afterRelease,
    toggleGroup: toggleGroup,
    walk: walk,
    unitsOf: unitsOf,
    unitNumbers: unitNumbers,
    where: where,
    ring: ring,
    toList: toList,
    fusionText: fusionText,
    checklist: checklist,
    otherLines: otherLines,
    shipSheet: shipSheet,
    releaseSheet: releaseSheet,
    sameUnit: sameUnit,
    lineForUnit: lineForUnit,
    findInList: findInList,
    scanResult: scanResult,
    sameScan: sameScan,
    vibrate: vibrate,
    chips: chips,
    card: card,
    sections: sections,
    left: left,
    lastAt: lastAt,
    recentItems: recentItems,
    period: period,
    summary: summary,
    yardLabel: yardLabel,
    newUrl: newUrl,
    kept: kept,
    keep: keep,
    read: read,
    withList: withList,
    withWork: withWork,
    withTicks: withTicks,
    withYard: withYard,
    ticksOf: ticksOf,
    pending: pending,
    workOf: workOf,
    whenText: whenText
  };
});
