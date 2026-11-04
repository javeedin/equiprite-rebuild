define(['resources/js/rateRules'], function (R) {
  'use strict';

  // Compare rates: rate schedules side by side, by Old's rate grid's own terms (rateRules). A row is one equipment
  // (rateRules.groupKey: class, subclass, equipment, location, rate type), read across every schedule picked.
  //
  //   tiers   a row per equipment and tier (Hourly … Yearly): each schedule's Rate / day for it (its lowest threshold in
  //           that tier when it has several), with its Period total and Threshold; the cheapest and dearest marked, and
  //           each schedule against the base (the first picked)
  //   rental  a row per equipment: what a rental of N days (and logged hours, for hourly rows) would cost under each
  //           schedule, by the rate engine's rule (rateRules.simulate: the highest threshold reached applies)
  //
  // Rates per day of the same tier compare like for like (a Period total is the rate times the days in the period).
  // A schedule without that equipment or tier is left out of the marks, and counts as a difference.

  var MAX = 6;

  function txt(v) { return v == null ? '' : String(v); }
  function num(v) { var n = Number(v); return v === null || v === undefined || v === '' || isNaN(n) ? null : n; }
  function periodIndex(p) {
    var i = R.PERIODS.map(function (x) { return x.value; }).indexOf(p);
    return i === -1 ? 99 : i;
  }

  /** A money amount in a schedule's currency; a rate to its 4 decimals (as Old shows Rate / Day). */
  function money(n, currency, dp4) {
    if (n === null || n === undefined || isNaN(Number(n))) return '—';
    var v = Number(n);
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency && currency !== '—' ? currency : 'USD',
        minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: dp4 ? 4 : 2 }).format(v);
    } catch (e) {
      return (dp4 ? R.rate4(v) : R.money(v));
    }
  }

  /** "+12.5%", "−5%", "Same", or '' when there is nothing to compare with. */
  function diffText(value, base) {
    if (value === null || base === null) return '';
    if (value === base) return 'Same';
    if (base === 0) return value > 0 ? 'Base is $0' : '';
    var pct = Math.round(((value - base) / base) * 1000) / 10;
    if (pct === 0) return 'Same';
    return (pct > 0 ? '+' : '−') + Math.abs(pct) + '%';
  }

  /** The schedules that can be picked: { id, name, sub, active, currency }, active first, then by name. */
  function pickable(rows) {
    return (Array.isArray(rows) ? rows : []).map(function (s) {
      return {
        id: String(s.id), name: s.scheduleName || ('Schedule ' + s.id), active: s.status === 'ACTIVE', currency: s.currency || '—',
        sub: [R.tagText(s), R.windowText(s), s.currency && s.currency !== '—' ? s.currency : ''].filter(function (x) { return !!x; }).join(' · ')
      };
    }).sort(function (a, b) { return (a.active === b.active ? 0 : (a.active ? -1 : 1)) || a.name.localeCompare(b.name); });
  }

  /** The default pick: the first `n` active schedules (else any), as ids. */
  function defaultPick(rows, n) {
    var list = pickable(rows);
    var active = list.filter(function (s) { return s.active; });
    return (active.length >= 2 ? active : list).slice(0, n || 3).map(function (s) { return s.id; });
  }

  /** Picking or unpicking a schedule: the new list of ids (at most MAX; the first one is the base). */
  function toggle(picked, id) {
    var ids = (Array.isArray(picked) ? picked : []).map(String);
    var k = String(id);
    if (ids.indexOf(k) !== -1) return ids.filter(function (x) { return x !== k; });
    if (ids.length >= MAX) return ids;
    return ids.concat([k]);
  }

  /** A schedule made the base: moved to the front. */
  function makeBase(picked, id) {
    var k = String(id);
    var ids = (Array.isArray(picked) ? picked : []).map(String).filter(function (x) { return x !== k; });
    return [k].concat(ids);
  }

  /** The cheapest and dearest of the values present (only when at least two differ): { low, high }. */
  function marks(values) {
    var present = values.filter(function (v) { return v !== null; });
    if (present.length < 2) return { low: null, high: null };
    var lo = Math.min.apply(null, present);
    var hi = Math.max.apply(null, present);
    return lo === hi ? { low: null, high: null } : { low: lo, high: hi };
  }

  function groupsOf(schedules) {
    var byKey = {};
    var order = [];
    (schedules || []).forEach(function (s) {
      R.groupLines(s.lines || []).forEach(function (g) {
        if (!byKey[g.key]) {
          byKey[g.key] = { key: g.key, title: g.title, sub: (g.location || 'All locations') + ' · ' + g.rateTypeLabel, method: g.method, by: {} };
          order.push(byKey[g.key]);
        }
        byKey[g.key].by[s.id] = g;
      });
    });
    return order.sort(function (a, b) { return a.title.localeCompare(b.title) || a.sub.localeCompare(b.sub); });
  }

  /** A schedule's line for one tier of a group: its lowest threshold in that period, or null. */
  function tierLine(g, period) {
    if (!g) return null;
    var cell = (g.cells || []).filter(function (c) { return c.period === period; })[0];
    var lines = (cell && cell.lines) || [];
    return lines.slice().sort(function (a, b) { return (Number(a.threshold) || 0) - (Number(b.threshold) || 0); })[0] || null;
  }

  function matchesText(row, q) {
    if (!q) return true;
    var hay = (row.title + ' ' + row.sub + ' ' + row.method).toLowerCase();
    return q.split(/\s+/).filter(function (w) { return !!w; }).every(function (w) { return hay.indexOf(w) !== -1; });
  }

  /**
   * The comparison: { cols, rows, total, differ, text }.
   *   schedules  [{ id, name, currency, lines }] in the picked order (the first is the base)
   *   o          { mode: 'tiers' | 'rental', period ('' = every tier), text, onlyDiff, days, hours, qty }
   * cols: { id, name, currency, base, has, cheapest, dearest, avg (vs the base, in words) }
   * rows: { key, title, sub, method, period, periodLabel, differ, cells: { [id]: cell } }, a cell being
   *   { has, value, main, lines: [..] (what to show under it), diff, tone: 'low' | 'high' | '' , note }
   */
  function compare(schedules, o) {
    var opts = o || {};
    var list = (Array.isArray(schedules) ? schedules : []).map(function (s) {
      return { id: String(s.id), name: s.name || ('Schedule ' + s.id), currency: s.currency || 'USD', lines: s.lines || [] };
    });
    var baseId = list.length ? list[0].id : '';
    var mode = opts.mode === 'rental' ? 'rental' : 'tiers';
    var q = txt(opts.text).trim().toLowerCase();
    var groups = groupsOf(list);
    var rows = [];

    if (mode === 'tiers') {
      groups.forEach(function (g) {
        var periods = {};
        list.forEach(function (s) {
          var sg = g.by[s.id];
          (sg ? sg.cells : []).forEach(function (c) { if (c.lines.length) periods[c.period] = true; });
        });
        Object.keys(periods).sort(function (a, b) { return periodIndex(a) - periodIndex(b); }).forEach(function (p) {
          if (opts.period && opts.period !== p) return;
          var cells = {};
          var values = list.map(function (s) {
            var l = tierLine(g.by[s.id], p);
            var hourly = l && R.unitWord(l) === 'hours';
            var value = l ? (num(l.costRate) === null ? 0 : num(l.costRate)) : null;
            cells[s.id] = l ? {
              has: true, value: value, main: money(value, s.currency, true) + (hourly ? ' / hour' : ' / day'),
              lines: ['Period total ' + money(R.shownTotal(l), s.currency), 'Threshold ' + (num(l.threshold) || 0) + (hourly ? ' h' : (num(l.threshold) === 1 ? ' day' : ' days'))],
              threshold: num(l.threshold) || 0, key: R.lineKey(l)
            } : { has: false, value: null, main: '—', lines: ['Not in this schedule'] };
            return value;
          });
          rows.push(finish({ key: g.key + '#' + p, group: g.key, title: g.title, sub: g.sub, method: g.method, period: p,
            periodLabel: R.periodLabel(p) }, cells, values, list, baseId, true));
        });
      });
    } else {
      var days = Math.max(0, Math.floor(num(opts.days) || 0));
      var hours = Math.max(0, num(opts.hours) === null ? days * 8 : num(opts.hours));
      var qty = Math.max(1, Math.floor(num(opts.qty) || 1));
      groups.forEach(function (g) {
        var cells = {};
        var any = false;
        var values = list.map(function (s) {
          var sg = g.by[s.id];
          if (!sg) { cells[s.id] = { has: false, value: null, main: '—', lines: ['Not in this schedule'] }; return null; }
          var usage = sg.lines.filter(function (l) { return (l.rateType || 'USAGE') === 'USAGE'; });
          if (!usage.length) { cells[s.id] = { has: false, value: null, main: '—', lines: ['Not priced by the engine (not Usage)'] }; return null; }
          var r = R.simulate(usage, { daysOnRent: days, daysWorked: days, hours: hours, qty: qty }).rows[0];
          if (!r || r.cost === null || r.cost === undefined) {
            cells[s.id] = { has: false, value: null, main: '—', lines: [r && r.text ? 'No tier applies: every threshold is above ' + days + ' days' : 'No rate'] };
            return null;
          }
          any = true;
          cells[s.id] = { has: true, value: r.cost, main: money(r.cost, s.currency),
            lines: [r.periodLabel + ' tier · ' + (r.qty > 1 ? r.qty + ' × ' : '') + r.units + ' × ' + money(r.rate, s.currency, true) + (r.unitShort === 'h' ? ' an hour' : ' a day')],
            threshold: r.threshold, key: r.lineKey };
          return r.cost;
        });
        if (!any && !q) { /* still shown: no schedule prices it for this length */ }
        rows.push(finish({ key: g.key, group: g.key, title: g.title, sub: g.sub, method: g.method, period: '', periodLabel: 'For ' + days + (days === 1 ? ' day' : ' days') },
          cells, values, list, baseId, false));
      });
    }

    var total = rows.length;
    var shown = rows.filter(function (r) { return matchesText(r, q) && (!opts.onlyDiff || r.differ); });

    var cols = list.map(function (s, i) {
      var has = 0;
      var cheapest = 0;
      var dearest = 0;
      var pcts = [];
      shown.forEach(function (r) {
        var c = r.cells[s.id];
        if (!c || !c.has) return;
        has++;
        if (c.tone === 'low') cheapest++;
        if (c.tone === 'high') dearest++;
        var b = r.cells[baseId];
        if (i > 0 && b && b.has && b.value) pcts.push((c.value - b.value) / b.value * 100);
      });
      var avg = pcts.length ? Math.round(pcts.reduce(function (a, b) { return a + b; }, 0) / pcts.length * 10) / 10 : null;
      return {
        id: s.id, name: s.name, currency: s.currency, base: i === 0, has: has, cheapest: cheapest, dearest: dearest,
        avg: i === 0 ? 'The base' : (avg === null ? 'Nothing in common with the base' : (avg === 0 ? 'Same as the base on average'
          : (avg > 0 ? '+' : '−') + Math.abs(avg) + '% against the base on average'))
      };
    });

    var differ = shown.filter(function (r) { return r.differ; }).length;
    return { cols: cols, rows: shown, total: total, differ: differ, mode: mode, text: summaryText(cols, shown, total, differ, mode, opts) };
  }

  function finish(row, cells, values, list, baseId, perDay) {
    var m = marks(values);
    var base = cells[baseId];
    var present = values.filter(function (v) { return v !== null; });
    var same = present.length === values.length && present.every(function (v) { return v === present[0]; });
    list.forEach(function (s) {
      var c = cells[s.id];
      c.tone = c.has && m.low !== null ? (c.value === m.low ? 'low' : (c.value === m.high ? 'high' : '')) : '';
      c.diff = s.id === baseId || !c.has || !base || !base.has ? '' : diffText(c.value, base.value);
      c.note = c.tone === 'low' ? 'Cheapest' : (c.tone === 'high' ? 'Dearest' : '');
      if (perDay && c.has && base && base.has && s.id !== baseId && c.threshold !== base.threshold) {
        c.lines = c.lines.concat(['Starts at ' + c.threshold + ', the base at ' + base.threshold]);
      }
    });
    row.cells = cells;
    row.differ = !same;
    return row;
  }

  function summaryText(cols, rows, total, differ, mode, opts) {
    if (cols.length < 2) return cols.length ? 'Pick another schedule to compare it with.' : 'Pick two or more schedules to compare.';
    if (!rows.length) return opts.onlyDiff && total ? 'They agree on every rate shown.' : 'Nothing to compare: no rate matches.';
    var what = mode === 'rental' ? 'pieces of equipment' : 'rates';
    var lead = cols.slice().sort(function (a, b) { return b.cheapest - a.cheapest; }).filter(function (c) { return c.cheapest > 0; });
    var parts = [differ + ' of ' + rows.length + ' ' + what + ' differ'];
    if (lead.length) {
      parts.push('cheapest most often: ' + lead.slice(0, 2).map(function (c) { return c.name + ' (' + c.cheapest + ')'; }).join(', '));
    }
    var currencies = cols.map(function (c) { return c.currency; }).filter(function (c, i, a) { return a.indexOf(c) === i; });
    if (currencies.length > 1) parts.push('in ' + currencies.join(' and ') + ': compared as numbers, not converted');
    return parts.join(' · ');
  }

  /** The export: a row per comparison row, a column per schedule (its value, and against the base). */
  function exportColumns(cols, mode) {
    var out = [
      { key: 'title', label: 'Equipment' }, { key: 'sub', label: 'Location · rate type' }, { key: 'method', label: 'Calc method' },
      { key: 'periodLabel', label: mode === 'rental' ? 'Rental' : 'Tier' }
    ];
    (cols || []).forEach(function (c) {
      out.push({ key: 'v' + c.id, label: c.name + (mode === 'rental' ? ' cost' : ' rate / day') + ' (' + c.currency + ')', type: 'number',
        value: function (r) { var x = r.cells[c.id]; return x && x.has ? x.value : ''; } });
      if (!c.base) out.push({ key: 'd' + c.id, label: c.name + ' against the base', value: function (r) { var x = r.cells[c.id]; return (x && x.diff) || ''; } });
      out.push({ key: 'n' + c.id, label: c.name + ' note', value: function (r) { var x = r.cells[c.id]; return x ? [x.note].concat(x.has ? [] : x.lines).filter(Boolean).join('; ') : ''; } });
    });
    return out;
  }

  return { MAX: MAX, pickable: pickable, defaultPick: defaultPick, toggle: toggle, makeBase: makeBase, compare: compare, diffText: diffText,
    exportColumns: exportColumns, money: money };
});
