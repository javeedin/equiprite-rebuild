define(['resources/js/availability'], function (Av) {
  'use strict';

  // "Where is it, and when can I have it?" for one equipment item, while raising a request (New request's catalog:
  // the small location icon on a card). Pure: newRequest's availChain reads the item's units, the bookings, the
  // locations and inventory orgs; this answers, with the Availability screen's own rules (availability.js: a booking
  // or planned maintenance holds a unit; back and out again within TIGHT days is a tight turnaround):
  //   - how many of its units are free for the request's dates, and where: by inventory org and yard;
  //   - each unit that is not: where it is now (on site, on the way, in maintenance) and when it is back;
  //   - other dates that work for the same length (nearest first, earlier or later), and the longest free stretch
  //     inside the dates (a shorter request, or a split);
  //   - free alternatives in its class, from the catalog's own counts for the dates.
  // Nothing here writes; "Use these dates" and "Add" are New request's own steps.

  var TIGHT = Av.TIGHT;
  var LOOK_AHEAD = 120; // days past the request's start to look for another slot
  var MAX_SLOTS = 3;
  var MAX_ALTERNATIVES = 3;

  function up(v) { return String(v == null ? '' : v).trim().toUpperCase(); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function key(v) { return v == null || v === '' ? '' : String(v); }

  /** The inventory org a unit's location belongs to: by location id, else location code, else the location's org id. */
  function orgOf(locId, loc, invOrgs) {
    var list = Array.isArray(invOrgs) ? invOrgs : [];
    var hit = null;
    if (locId != null) hit = list.filter(function (o) { return key(o.locationId) === key(locId); })[0] || null;
    if (!hit && loc && loc.locationCode) hit = list.filter(function (o) { return up(o.locationCode) === up(loc.locationCode); })[0] || null;
    if (!hit && loc && loc.orgId != null) hit = list.filter(function (o) { return key(o.organizationId) === key(loc.orgId); })[0] || null;
    if (!hit) return null;
    return { code: hit.organizationCode || '', name: hit.organizationName || '', id: hit.organizationId != null ? hit.organizationId : hit.invOrgId };
  }

  /** The holds on one unit (bookings that hold it, planned maintenance), earliest first. */
  function holdsOf(model, unitId) {
    return ((model.byUnit || {})[unitId] || []).filter(function (b) { return b.holds; });
  }

  /** Whether a unit is clear from a to b; pad: also clear TIGHT days either side (no tight turnaround). */
  function clear(holds, a, b, pad) {
    var from = pad ? Av.addDays(a, -TIGHT) : a;
    var to = pad ? Av.addDays(b, TIGHT) : b;
    return !holds.some(function (h) { return h.start <= to && h.end >= from; });
  }

  /** The first day on or after `day` the unit is not held (its holds back to back count as one). */
  function freeFrom(holds, day) {
    var d = day;
    var moved = true;
    while (moved) {
      moved = false;
      for (var i = 0; i < holds.length; i++) {
        if (holds[i].start <= d && holds[i].end >= d) { d = Av.addDays(holds[i].end, 1); moved = true; }
      }
    }
    return d;
  }

  /** Where a unit is on a day, in words: the hold covering it, or its yard. */
  function whereOn(holds, day, yard) {
    var h = holds.filter(function (b) { return b.start <= day && b.end >= day; })[0];
    if (!h) return yard ? 'At ' + yard : 'At its yard';
    if (h.kind === 'maintenance') return 'In maintenance' + (h.wo ? ' (' + h.wo + ')' : '');
    return h.stageLabel + (h.party ? ' · ' + h.party : '') + (h.requestNumber ? ' (' + h.requestNumber + ')' : '');
  }

  /**
   * Starts worth trying for other dates: today, and the day after each hold on any of the units (and that day with
   * the turnaround left clear), from today to LOOK_AHEAD days past the request's start, not the request's own start.
   */
  function candidates(units, from, today) {
    var cands = [today];
    units.forEach(function (u) {
      u.holds.forEach(function (h) { cands.push(Av.addDays(h.end, 1)); cands.push(Av.addDays(h.end, 1 + TIGHT)); });
    });
    var limit = Av.addDays(from, LOOK_AHEAD);
    var seen = {};
    return cands.filter(function (c) {
      if (!c || c < today || c > limit || c === from || seen[c]) return false;
      seen[c] = true;
      return true;
    }).sort();
  }

  /** The longest clear run inside from..to on a unit: { start, end, days } or null. */
  function longestRun(holds, from, to) {
    var best = null;
    var runStart = null;
    for (var d = from; d <= to; d = Av.addDays(d, 1)) {
      var held = holds.some(function (h) { return h.start <= d && h.end >= d; });
      if (!held && runStart === null) runStart = d;
      if ((held || d === to) && runStart !== null) {
        var end = held ? Av.addDays(d, -1) : d;
        var n = Av.diff(end, runStart) + 1;
        if (!best || n > best.days) best = { start: runStart, end: end, days: n };
        runStart = null;
      }
    }
    return best;
  }

  function shiftText(n) {
    if (n === 0) return 'Your dates';
    return plural(Math.abs(n), 'day') + (n > 0 ? ' later' : ' earlier');
  }

  /**
   * The answer for one item.
   *   model      Av.build over the item's units (its serial-refs, the bookings, locations, work orders)
   *   input      { serials (the item's serial-refs rows), locationsById, invOrgs, masterRow ({ currentLocationId }) }
   *   o          { from, to, today, need (units wanted, default 1), catalogRows (for alternatives), itemId, cls }
   * Returns {
   *   window { from, to, days, text }, total, free, need, tone: ok | short | none | unknown, headline, note,
   *   places  [{ key, org, yard, label, free, total }]   where its units are, by inventory org and yard, most free first
   *   units   [{ serial, place, state, stateLabel, why, now, back, backText, tone }]   free first, then soonest back
   *   slots   [{ start, end, text, shift, shiftText, count, places, tight }]   other dates for the same length
   *   partial { serial, start, end, days, text } | null   the longest free stretch inside the dates (when none is whole)
   *   alternatives [{ id, name, label, rate }]   free in its class for the dates
   * }
   */
  function assess(model, input, o) {
    var opts = o || {};
    var inp = input || {};
    var today = Av.d10(opts.today) || Av.todayKey();
    var win = Av.windowOf(opts.from, opts.to, today);
    var need = Math.max(1, Number(opts.need) || 1);
    var locs = inp.locationsById || {};
    var serialRow = {};
    (inp.serials || []).forEach(function (s) { if (s && s.serialNumber) serialRow[String(s.serialNumber)] = s; });
    var masterLoc = inp.masterRow && inp.masterRow.currentLocationId != null ? inp.masterRow.currentLocationId : null;

    var units = ((model && model.units) || []).filter(function (u) { return u.known !== false; }).map(function (u) {
      var s = serialRow[u.serial] || {};
      var locId = s.currentLocationId != null ? s.currentLocationId : masterLoc;
      var loc = locId != null ? locs[String(locId)] || null : null;
      var org = orgOf(locId, loc, inp.invOrgs);
      var yardName = (loc && (loc.locationName || loc.locationCode)) || (u.yardKey ? u.yard : '');
      var place = org ? (org.code || org.name) + (yardName ? ' · ' + yardName : '') : (u.yardKey ? u.yard : 'No yard recorded');
      var holds = holdsOf(model, u.id);
      var st = Av.windowState(model.byUnit[u.id] || [], win.from, win.to);
      var blocking = holds.filter(function (h) { return h.start <= win.to && h.end >= win.from; })[0];
      var back = blocking && (st.state === 'booked' || st.state === 'maint') ? freeFrom(holds, blocking.start) : '';
      return {
        serial: u.serial, name: u.name, placeKey: org ? 'o:' + (org.code || org.name) : 'y:' + (u.yardKey || ''), place: place, org: org,
        state: st.state, stateLabel: st.label, why: st.why,
        now: whereOn(holds, today, u.yardKey ? u.yard : ''),
        back: back, backText: back ? 'Free again from ' + Av.fmtDay(back) : '',
        tone: st.state === 'free' ? 'ok' : (st.state === 'tight' ? 'tight' : 'busy'),
        holds: holds
      };
    });

    var free = units.filter(function (u) { return u.state === 'free' || u.state === 'tight'; });
    var placesBy = {};
    units.forEach(function (u) {
      var p = placesBy[u.placeKey] = placesBy[u.placeKey] || { key: u.placeKey, label: u.place, free: 0, total: 0 };
      p.total += 1;
      if (u.state === 'free' || u.state === 'tight') p.free += 1;
    });
    var places = Object.keys(placesBy).map(function (k) { return placesBy[k]; })
      .sort(function (a, b) { return b.free - a.free || b.total - a.total || (a.label < b.label ? -1 : 1); });

    var tone = !units.length ? 'unknown' : (free.length >= need ? 'ok' : (free.length ? 'short' : 'none'));
    var headline = !units.length ? 'No units recorded'
      : free.length + ' of ' + plural(units.length, 'unit') + ' free';
    var note = !units.length
      ? 'EquipRite has no units of this equipment on record, so where it is cannot be shown. The catalog\'s own count is on the card.'
      : (tone === 'ok' ? 'Free at ' + places.filter(function (p) { return p.free; }).map(function (p) { return p.label; }).join(', ') + '.'
        : (tone === 'short' ? 'Only ' + plural(free.length, 'unit') + ' free for these dates; ' + need + ' wanted.' : 'None free for these dates.'));

    // Other dates for the same length: per start, which units and where; nearest to the request's start first.
    var slots = [];
    var partial = null;
    if (units.length && tone !== 'ok') {
      var want = Math.min(need, units.length);
      var all = candidates(units, win.from, today).map(function (c) {
        var end = Av.addDays(c, win.days - 1);
        var clean = units.filter(function (u) { return clear(u.holds, c, end, true); });
        var tight = units.filter(function (u) { return !clear(u.holds, c, end, true) && clear(u.holds, c, end, false); });
        var those = clean.concat(tight);
        var places = {};
        those.forEach(function (u) { places[u.place] = true; });
        var shift = Av.diff(c, win.from);
        return { start: c, end: end, text: Av.range(c, end), shift: shift, shiftText: shiftText(shift), count: those.length,
          units: those.map(function (u) { return u.serial; }), places: Object.keys(places).join(', '), tight: clean.length < want };
      }).filter(function (s) { return s.count >= want; });
      // A clean slot before a tight one, the nearest first; the nearest earlier one is always offered when there is one.
      var rank = function (a, b) { return Number(a.tight) - Number(b.tight) || Math.abs(a.shift) - Math.abs(b.shift) || b.count - a.count; };
      var later = all.filter(function (s) { return s.shift > 0; }).sort(rank);
      var earlier = all.filter(function (s) { return s.shift < 0; }).sort(rank);
      if (later.length) slots.push(later[0]);
      if (earlier.length) slots.push(earlier[0]);
      all.sort(rank).forEach(function (s) { if (slots.length < MAX_SLOTS && slots.indexOf(s) === -1) slots.push(s); });
      slots.sort(function (a, b) { return a.start < b.start ? -1 : 1; });
      units.forEach(function (u) {
        var run = longestRun(u.holds, win.from, win.to);
        if (run && run.days < win.days && (!partial || run.days > partial.days || (run.days === partial.days && run.start < partial.start))) {
          partial = { serial: u.serial, place: u.place, start: run.start, end: run.end, days: run.days,
            text: Av.range(run.start, run.end) + ' · ' + run.days + ' of ' + plural(win.days, 'day') };
        }
      });
    }

    // Free instead: the catalog's own answer for these dates, in the same class.
    var alternatives = [];
    if (tone !== 'ok' && opts.cls) {
      alternatives = (opts.catalogRows || []).filter(function (r) {
        return r && Number(r.eqrEquipmentMasterId) !== Number(opts.itemId) && (r.className || r.category) === opts.cls
          && up(r.availabilityStatus) === 'AVAILABLE';
      }).sort(function (a, b) { return (Number(b.availableQty) || 0) - (Number(a.availableQty) || 0); })
        .slice(0, MAX_ALTERNATIVES)
        .map(function (r) {
          return { id: Number(r.eqrEquipmentMasterId), name: r.equipmentName || 'Equipment',
            label: r.availableQty != null ? r.availableQty + ' free' : 'Free', rate: r.rate != null ? r.rate : null };
        });
    }

    units.sort(function (a, b) {
      var ra = a.tone === 'ok' ? 0 : (a.tone === 'tight' ? 1 : 2);
      var rb = b.tone === 'ok' ? 0 : (b.tone === 'tight' ? 1 : 2);
      if (ra !== rb) return ra - rb;
      var x = a.back || '';
      var y = b.back || '';
      return x < y ? -1 : (x > y ? 1 : (a.serial < b.serial ? -1 : 1));
    });
    units.forEach(function (u) { delete u.holds; });
    return { window: win, total: units.length, free: free.length, need: need, tone: tone, headline: headline, note: note,
      places: places, units: units, slots: slots, partial: partial, alternatives: alternatives };
  }

  return { assess: assess, orgOf: orgOf, freeFrom: freeFrom, longestRun: longestRun, LOOK_AHEAD: LOOK_AHEAD };
});
