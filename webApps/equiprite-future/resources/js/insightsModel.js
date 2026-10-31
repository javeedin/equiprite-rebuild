define([
  'resources/js/requestProgress',
  'resources/js/requestList',
  'resources/js/analyticsData',
  'resources/js/fmt'
], function (Progress, list, analyticsData, fmt) {
  'use strict';

  // Analytics in EquipRite Next: five questions, each answered from data the page has already loaded. Pure: the
  // chains fetch (the fleet and utilization through analyticsData.loadActiveTab, New's module, unchanged; requests
  // through requestData; cost through the Old Reports page's project-cost-detail call) and hand the rows here, which
  // turns them into the headline, the tiles, the charts (bar widths and heights in %, drawn with CSS and SVG) and the
  // table. Nothing here writes.
  //
  //   fleet   What is out, and what is sitting idle?        yard-stock (RPT-01)
  //   use     How busy has each yard been?                  yard-utilization (RPT-03)
  //   late    What is late going out or coming back?        requests and their equipment (RPT-15)
  //   flow    How are requests moving through?              requests (RPT-02)
  //   cost    What is the equipment costing, is it posted?  project-cost-detail (RPT-05)
  //
  // Rules kept from New and Old EquipRite:
  //   - a unit is out when RENTED or DEPLOYED, idle when AVAILABLE, otherwise not available (analyticsData
  //     buildStockCharts); the fleet-wide tiles are analyticsData's kpisFromGroups (utilization = RENTED ÷ all units);
  //   - late is requestProgress's rule: not shipped by the start date, or out past the end date and not back;
  //   - the views return at most analyticsData.PAGE_SIZE (2000) rows, and the page says so when a list is full.

  var DAY = 86400000;
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var REPORTS = [
    { key: 'fleet', label: 'Out or idle', question: 'What is out, and what is sitting idle?', rpt: 'RPT-01', code: 'EQR_ANALYTICS', icon: 'oj-ux-ico-truck' },
    { key: 'use', label: 'Utilization', question: 'How busy has each yard been?', rpt: 'RPT-03', code: 'EQR_ANALYTICS', icon: 'oj-ux-ico-calendar' },
    { key: 'late', label: 'Late', question: 'What is late going out or coming back?', rpt: 'RPT-15', code: 'EQR_ANALYTICS', icon: 'oj-ux-ico-warning' },
    { key: 'flow', label: 'Requests', question: 'How are requests moving through?', rpt: 'RPT-02', code: 'EQR_ANALYTICS', icon: 'oj-ux-ico-documents' },
    { key: 'cost', label: 'Cost', question: 'What is the equipment costing, and is it posted?', rpt: 'RPT-05', code: 'EQR_REPORTS', icon: 'oj-ux-ico-currency-dollar' }
  ];

  var PERIODS = [
    { key: 'last-30', label: 'Last 30 days' },
    { key: 'last-90', label: 'Last 90 days' },
    { key: 'ytd', label: 'Year to date' },
    { key: 'custom', label: 'Custom' }
  ];

  // The other reports: where each one lives today.
  var MORE = [
    { key: 'onhand', label: 'On-hand stock', rpt: 'RPT-01', where: 'new', report: 'onhand', desc: 'Bulk and consumable quantities by item and yard.' },
    { key: 'pending', label: 'Approvals in progress', rpt: 'RPT-02', where: 'new', report: 'equipment-pending', desc: 'Request lines being approved, allocated, picked and shipped.' },
    { key: 'history', label: 'Equipment history', rpt: '', where: 'old', desc: 'Every allocation of each unit over time.' },
    { key: 'rental', label: 'Rental requests', rpt: '', where: 'old', desc: 'Request lines with their procurement status.' },
    { key: 'rate-exc', label: 'Rate exceptions', rpt: '', where: 'old', desc: 'Units whose rate resolves to zero.' },
    { key: 'rate-sched', label: 'Rate schedules', rpt: 'RPT-07', where: 'old', desc: 'Rate lines by class, period and threshold.' },
    { key: 'agreements', label: 'Agreement expiry', rpt: 'RPT-16', where: 'old', desc: 'Agreements ending soon, with what is still out.' },
    { key: 'integrations', label: 'Integration errors', rpt: 'RPT-17', where: 'next', navId: 'integrations', desc: 'Failed calls to Fusion and the exception queue.' }
  ];
  var NOT_YET = [
    { rpt: 'RPT-19', label: 'Downtime analysis' },
    { rpt: 'RPT-20', label: 'Utilization against revenue' }
  ];

  // ── small helpers ─────────────────────────────────────────────────────────────────────────────────────────
  function up(v) { return String(v == null ? '' : v).trim().toUpperCase(); }
  function lc(v) { return String(v == null ? '' : v).toLowerCase(); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function n0(v) { return Math.round(num(v)).toLocaleString('en-US'); }
  function n1(v) { var x = Math.round(num(v) * 10) / 10; return x.toLocaleString('en-US', { maximumFractionDigits: 1 }); }
  function pct(part, whole) { return whole > 0 ? Math.round((part / whole) * 100) : 0; }
  function plural(n, one, many) { return n0(n) + ' ' + (Math.round(num(n)) === 1 ? one : (many || one + 's')); }
  function today(now) { return fmt.today(now); }
  function dayLabel(iso) { var d = fmt.dayMs(iso); if (d == null) return ''; var x = new Date(d); return x.getUTCDate() + ' ' + MON[x.getUTCMonth()]; }
  function matches(q, values) {
    var t = lc(q).trim();
    if (!t) return true;
    var hay = values.map(lc).join(' ');
    return t.split(/\s+/).every(function (w) { return hay.indexOf(w) !== -1; });
  }
  function top(entries, n) { return entries.slice(0, n); }
  function cap(s) { var t = String(s || ''); return t.charAt(0).toUpperCase() + t.slice(1); }

  /** The reports a role may open: fleet, use, late and flow need EQR_ANALYTICS; cost needs EQR_REPORTS. */
  function reportsFor(canAnalytics, canReports) {
    return REPORTS.filter(function (r) { return r.code === 'EQR_ANALYTICS' ? canAnalytics : canReports; });
  }

  // ── What is out, and what is idle ─────────────────────────────────────────────────────────────────────────
  /** out | idle | other, by buildStockCharts' rule. */
  function unitState(status) {
    var s = up(status);
    if (s === 'AVAILABLE') return 'idle';
    if (s === 'RENTED' || s === 'DEPLOYED') return 'out';
    return 'other';
  }
  var STATE_LABEL = { out: 'Out', idle: 'Available', other: 'Not available' };

  function fleetRow(r, i, now) {
    var state = unitState(r.unit_status);
    var end = fmt.dayMs(r.end_date);
    var pastEnd = state === 'out' && end != null && today(now) > end;
    var until = '';
    if (state === 'out' && r.end_date) until = pastEnd ? 'Past its end date (' + fmt.date(r.end_date) + ')' : 'Until ' + fmt.date(r.end_date);
    return {
      key: String(i) + ':' + (r.unit_number || r.asset_number || r.equip_name || ''),
      cls: r.equip_class || '', name: r.equip_name || 'Equipment', unit: r.unit_number || '', asset: r.asset_number || '',
      type: r.unit_type || '', yard: r.yard || '', yardId: r.inv_org_id, status: up(r.unit_status),
      statusLabel: analyticsData.unitStatusLabel(r.unit_status) || 'No status', state: state, stateLabel: STATE_LABEL[state],
      project: r.project_name || '', start: r.start_date || '', end: r.end_date || '', until: until, pastEnd: pastEnd,
      pastDays: pastEnd ? Math.round((today(now) - end) / DAY) : 0
    };
  }

  /** The units the filters leave; `skip` names filters to leave out (a chart that is itself a filter skips its own). */
  function fleetFilter(rows, f, skip) {
    var o = f || {};
    var off = [].concat(skip || []);
    return rows.filter(function (r) {
      if (off.indexOf('yard') === -1 && o.yard && r.yard !== o.yard) return false;
      if (off.indexOf('cls') === -1 && o.cls && r.cls !== o.cls) return false;
      if (off.indexOf('show') === -1 && o.show && o.show !== 'all' && r.state !== o.show) return false;
      return matches(o.text, [r.name, r.cls, r.unit, r.asset, r.yard, r.project, r.statusLabel]);
    });
  }

  function stackOf(counts, max, labels) {
    return ['out', 'idle', 'other'].filter(function (k) { return counts[k] > 0; }).map(function (k) {
      return { key: k, n: counts[k], w: max > 0 ? (counts[k] / max) * 100 : 0, title: n0(counts[k]) + ' ' + (labels || STATE_LABEL)[k].toLowerCase() };
    });
  }

  /**
   * The fleet now.
   *   stockRows   analyticsData's mapped yard-stock rows (equip_class, yard, unit_status, …)
   *   kpis        analyticsData's fleet-wide tiles (kpisFromGroups)
   *   mixGroups, mixSeries   the whole-fleet status mix (analyticsData donutFromGroups: status codes, counts)
   *   f           { show: all|out|idle|other, yard, cls, text }
   */
  function fleet(stockRows, kpis, mixGroups, mixSeries, f, now) {
    var all = (stockRows || []).map(function (r, i) { return fleetRow(r, i, now); });
    var k = kpis || {};
    var total = num(k.totalUnits);
    var out = num(k.outOnRent);
    var idle = num(k.available);
    var other = Math.max(0, total - out - idle);
    var o = f || {};

    // The whole fleet's status mix, every status in words.
    var vals = (mixSeries && mixSeries[0] && mixSeries[0].items) || [];
    var mix = (mixGroups || []).map(function (g, i) {
      var n = num(vals[i] && typeof vals[i] === 'object' ? vals[i].value : vals[i]);
      return { key: g, label: analyticsData.unitStatusLabel(g === '(none)' ? '' : g) || 'No status', n: n, state: unitState(g) };
    }).filter(function (m) { return m.n > 0; }).sort(function (a, b) { return b.n - a.n; });
    var mixTotal = mix.reduce(function (s, m) { return s + m.n; }, 0);
    mix.forEach(function (m) { m.w = mixTotal ? (m.n / mixTotal) * 100 : 0; m.pct = pct(m.n, mixTotal); m.title = m.label + ': ' + n0(m.n) + ' (' + m.pct + '%)'; });
    var otherWords = mix.filter(function (m) { return m.state === 'other'; }).map(function (m) { return m.label.toLowerCase(); });

    // By yard (class and search apply, so a click moves between yards) and by class (yard and search apply). Both show
    // out, available and not available, so the out-or-idle pick does not narrow them.
    var yardMap = {};
    fleetFilter(all, o, ['yard', 'show']).forEach(function (r) {
      var y = (r.yard && r.yard.trim()) || '(Unknown)';
      var e = yardMap[y] = yardMap[y] || { label: y, out: 0, idle: 0, other: 0, total: 0 };
      e[r.state]++; e.total++;
    });
    var yards = Object.keys(yardMap).map(function (y) { return yardMap[y]; }).sort(function (a, b) { return b.total - a.total || a.label.localeCompare(b.label); });
    var maxYard = yards.reduce(function (m, y) { return Math.max(m, y.total); }, 0);
    yards.forEach(function (y) {
      y.segs = stackOf(y, maxYard);
      y.on = !!o.yard && o.yard === y.label;
      y.value = n0(y.out) + ' of ' + n0(y.total) + ' out';
      y.title = y.label + ': ' + n0(y.out) + ' out, ' + n0(y.idle) + ' available, ' + n0(y.other) + ' not available. ' + (y.on ? 'Click to show every yard.' : 'Click to show only this yard.');
    });

    var classMap = {};
    fleetFilter(all, o, ['cls', 'show']).forEach(function (r) {
      var c = r.cls || '(No class)';
      var e = classMap[c] = classMap[c] || { label: c, out: 0, idle: 0, other: 0, total: 0 };
      e[r.state]++; e.total++;
    });
    var classes = Object.keys(classMap).map(function (c) { return classMap[c]; });
    classes.forEach(function (c) {
      c.pct = pct(c.out, c.total);
      c.w = c.pct;
      c.on = !!o.cls && o.cls === c.label;
      c.value = c.pct + '%';
      c.sub = n0(c.out) + ' of ' + n0(c.total);
      c.title = c.label + ': ' + n0(c.out) + ' of ' + n0(c.total) + ' out (' + c.pct + '%), ' + n0(c.idle) + ' available. ' + (c.on ? 'Click to show every class.' : 'Click to show only this class.');
    });
    classes.sort(function (a, b) { return b.pct - a.pct || b.total - a.total || a.label.localeCompare(b.label); });

    var shown = fleetFilter(all, o).sort(function (a, b) {
      var order = { out: 0, idle: 1, other: 2 };
      return (b.pastEnd - a.pastEnd) || (order[a.state] - order[b.state]) || a.yard.localeCompare(b.yard) || a.name.localeCompare(b.name);
    });
    var shownCounts = { out: 0, idle: 0, other: 0 };
    shown.forEach(function (r) { shownCounts[r.state]++; });
    var pastEnd = all.filter(function (r) { return r.pastEnd; }).length;

    // Where the available units are, from every unit (not only the filtered ones), the most first.
    var idleMap = {};
    all.forEach(function (r) { if (r.state === 'idle') { var y = (r.yard && r.yard.trim()) || '(Unknown)'; idleMap[y] = (idleMap[y] || 0) + 1; } });
    var idleYards = Object.keys(idleMap).map(function (y) { return { label: y, idle: idleMap[y] }; })
      .sort(function (a, b) { return b.idle - a.idle || a.label.localeCompare(b.label); });
    var headline = total
      ? n0(out) + ' of ' + plural(total, 'unit') + (out === 1 ? ' is' : ' are') + ' out on rent (' + pct(out, total) + '% utilization). ' + n0(idle) + ' ' + (idle === 1 ? 'is' : 'are')
        + ' available in a yard' + (idleYards.length > 1 ? ' (' + idleYards.slice(0, 3).map(function (y) { return y.label + ' ' + n0(y.idle); }).join(', ')
          + (idleYards.length > 3 ? ' and ' + plural(idleYards.length - 3, 'more yard') : '') + ')' : (idleYards.length ? ' in ' + idleYards[0].label : '')) + '.'
        + (other ? ' ' + n0(other) + ' cannot go out' + (otherWords.length ? ' (' + otherWords.join(', ') + ')' : '') + '.' : '')
      : 'No units are recorded in the fleet yet.';

    var chips = [{ key: 'all', label: 'All', count: fleetFilter(all, o, 'show').length }].concat(['out', 'idle', 'other'].map(function (s) {
      return { key: s, label: STATE_LABEL[s], count: fleetFilter(all, Object.assign({}, o, { show: s })).length };
    }));

    return {
      headline: headline,
      kpis: [
        { key: 'all', field: 'show', label: 'Units in the fleet', value: n0(total), note: 'Every unit in every yard', tone: 'total' },
        { key: 'out', field: 'show', label: 'Out on rent', value: n0(out), note: pct(out, total) + '% of the fleet: the utilization', tone: 'out' },
        { key: 'idle', field: 'show', label: 'Available in a yard', value: n0(idle), note: pct(idle, total) + '% of the fleet, free to send out', tone: 'idle' },
        { key: 'other', field: 'show', label: 'Cannot go out', value: n0(other), note: otherWords.length ? cap(otherWords.join(', ')) : 'In maintenance, retired or without a status', tone: 'other' }
      ],
      mix: mix,
      mixText: mix.map(function (m) { return m.label + ' ' + n0(m.n); }).join(', '),
      yards: yards,
      classes: classes,
      chips: chips,
      rows: shown,
      shownText: plural(shown.length, 'unit') + ' shown · ' + n0(shownCounts.out) + ' out · ' + n0(shownCounts.idle) + ' available · ' + n0(shownCounts.other) + ' not available',
      pastEnd: pastEnd,
      pastEndText: pastEnd ? (pastEnd === 1 ? '1 unit is still out after its rental ended.' : n0(pastEnd) + ' units are still out after their rental ended.') + ' Late lists them with their requests.' : '',
      full: all.length >= analyticsData.PAGE_SIZE,
      fullText: all.length >= analyticsData.PAGE_SIZE
        ? 'The list holds the first ' + n0(all.length) + ' units, the most the report returns at once; the tiles count the whole fleet.' : '',
      filters: activeFilters(o, { yard: 'Yard', cls: 'Class' })
    };
  }

  function activeFilters(o, names) {
    return Object.keys(names).filter(function (k) { return o && o[k]; }).map(function (k) { return { field: k, label: names[k] + ': ' + o[k] }; });
  }

  // ── How busy each yard has been ───────────────────────────────────────────────────────────────────────────
  function mondayOf(ms) { var d = new Date(ms); var dow = (d.getUTCDay() + 6) % 7; return ms - dow * DAY; }

  /**
   * Utilization over the period.
   *   rows   yard-utilization rows (yardName, dayDate, monthLabel, fleetSize, deployedUnits, utilPercent, usedHours)
   *   win    { fromDate, toDate } (analyticsData.periodToWindow)
   *   f      { yard, view: yard | day }
   */
  function utilization(rows, win, f) {
    var o = f || {};
    var all = (rows || []).filter(function (r) { return r && r.dayDate; });
    var mine = all.filter(function (r) { return !o.yard || (r.yardName || '—') === o.yard; });

    // Per day (one column per day; per week when the period is long).
    var dayMap = {};
    mine.forEach(function (r) {
      var d = String(r.dayDate).slice(0, 10);
      var e = dayMap[d] = dayMap[d] || { day: d, out: 0, fleet: 0 };
      e.out += num(r.deployedUnits);
      e.fleet += num(r.fleetSize);
    });
    var days = Object.keys(dayMap).sort().map(function (d) { return dayMap[d]; });
    var weekly = days.length > 62;
    var cols = days;
    if (weekly) {
      var wk = {};
      days.forEach(function (d) {
        var m = mondayOf(fmt.dayMs(d.day));
        var e = wk[m] = wk[m] || { day: new Date(m).toISOString().slice(0, 10), out: 0, fleet: 0, n: 0 };
        e.out += d.out; e.fleet += d.fleet; e.n++;
      });
      cols = Object.keys(wk).sort(function (a, b) { return a - b; }).map(function (m) {
        var e = wk[m];
        return { day: e.day, out: e.out / e.n, fleet: e.fleet / e.n };
      });
    }
    var maxFleet = cols.reduce(function (m, c) { return Math.max(m, c.fleet, c.out); }, 0);
    var step = Math.max(1, Math.ceil(cols.length / 7));
    cols = cols.map(function (c, i) {
      var p = pct(c.out, c.fleet);
      var label = (weekly ? 'Week of ' : '') + dayLabel(c.day);
      return {
        key: c.day, label: label, tick: i % step === 0 ? dayLabel(c.day) : '', out: c.out, fleet: c.fleet, pct: p,
        hOut: maxFleet ? (c.out / maxFleet) * 100 : 0, hFleet: maxFleet ? (c.fleet / maxFleet) * 100 : 0,
        title: label + ': ' + n1(c.out) + ' of ' + n1(c.fleet) + ' units out (' + p + '%)' + (weekly ? ', a day on average' : '')
      };
    });

    // Per yard (every yard, whatever is picked, so the pick can move).
    var yardMap = {};
    all.forEach(function (r) {
      var y = r.yardName || '—';
      var e = yardMap[y] = yardMap[y] || { label: y, out: 0, fleet: 0, days: 0, peak: 0, peakDay: '', lastDay: '', lastFleet: 0, hours: 0, series: {} };
      var d = String(r.dayDate).slice(0, 10);
      e.out += num(r.deployedUnits); e.fleet += num(r.fleetSize); e.days++; e.hours += num(r.usedHours);
      if (num(r.deployedUnits) > e.peak || !e.peakDay) { e.peak = num(r.deployedUnits); e.peakDay = d; }
      if (d >= e.lastDay) { e.lastDay = d; e.lastFleet = num(r.fleetSize); }
      e.series[d] = num(r.fleetSize) ? (num(r.deployedUnits) / num(r.fleetSize)) * 100 : 0;
    });
    var yards = Object.keys(yardMap).map(function (y) {
      var e = yardMap[y];
      var p = pct(e.out, e.fleet);
      var keys = Object.keys(e.series).sort();
      return {
        label: e.label, fleet: e.lastFleet, avgOut: e.days ? e.out / e.days : 0, avgOutText: n1(e.days ? e.out / e.days : 0),
        pct: p, w: p, value: p + '%', peak: e.peak, peakDay: e.peakDay, peakText: e.peakDay ? n0(e.peak) + ' on ' + dayLabel(e.peakDay) : '',
        days: e.days, hours: e.hours, on: !!o.yard && o.yard === e.label,
        spark: sparkPath(keys.map(function (k) { return e.series[k]; })),
        title: e.label + ': ' + p + '% of its units out on an average day (' + n1(e.days ? e.out / e.days : 0) + ' of ' + n0(e.lastFleet) + '). '
          + (o.yard === e.label ? 'Click to show every yard.' : 'Click to show only this yard.')
      };
    }).sort(function (a, b) { return b.pct - a.pct || a.label.localeCompare(b.label); });

    var sumOut = days.reduce(function (s, d) { return s + d.out; }, 0);
    var sumFleet = days.reduce(function (s, d) { return s + d.fleet; }, 0);
    var avg = pct(sumOut, sumFleet);
    var busiest = days.reduce(function (b, d) { return !b || d.out > b.out ? d : b; }, null);
    var period = periodText(win && win.fromDate, win && win.toDate);
    var who = o.yard ? o.yard : 'the fleet';
    var headline = !days.length
      ? 'No utilization is recorded for ' + (o.yard ? o.yard + ' in ' : '') + period + '.'
      : 'Over ' + period + ', ' + avg + '% of ' + who + ' was out on an average day (' + n1(sumOut / days.length) + ' of ' + n1(sumFleet / days.length) + ' units).'
        + (busiest ? ' The busiest day was ' + dayLabel(busiest.day) + ', with ' + n0(busiest.out) + ' out.' : '')
        + (!o.yard && yards.length > 1 ? ' Busiest yard: ' + yards[0].label + ' (' + yards[0].pct + '%); quietest: ' + yards[yards.length - 1].label + ' (' + yards[yards.length - 1].pct + '%).' : '');

    var flat = mine.map(function (r, i) {
      return { key: i + ':' + r.yardName + ':' + r.dayDate, yard: r.yardName || '—', day: String(r.dayDate).slice(0, 10), dayText: fmt.date(r.dayDate),
        month: r.monthLabel || '', fleet: num(r.fleetSize), out: num(r.deployedUnits), pct: r.utilPercent != null ? num(r.utilPercent) : pct(num(r.deployedUnits), num(r.fleetSize)),
        hours: r.usedHours != null ? num(r.usedHours) : '' };
    }).sort(function (a, b) { return a.day < b.day ? 1 : a.day > b.day ? -1 : a.yard.localeCompare(b.yard); });

    return {
      headline: headline,
      period: period,
      kpis: [
        { key: 'avg', label: 'Average utilization', value: days.length ? avg + '%' : '–', note: 'Units out ÷ units in the fleet, every day of the period', tone: 'out' },
        { key: 'out', label: 'Out on an average day', value: days.length ? n1(sumOut / days.length) : '–', note: days.length ? 'of ' + n1(sumFleet / days.length) + ' units' : 'No days recorded', tone: 'total' },
        { key: 'peak', label: 'Busiest day', value: busiest ? n0(busiest.out) : '–', note: busiest ? 'out on ' + fmt.date(busiest.day) : 'No days recorded', tone: 'total' },
        { key: 'yards', label: o.yard ? 'Yard' : 'Yards', value: o.yard ? o.yard : n0(yards.length), note: o.yard ? 'Click it again in the chart to see every yard' : (yards.length ? 'Quietest: ' + yards[yards.length - 1].label : ''), tone: 'idle' }
      ],
      cols: cols,
      weekly: weekly,
      axis: maxFleet ? [{ v: n0(maxFleet), at: 'top' }, { v: n0(maxFleet / 2), at: 'mid' }, { v: '0', at: 'bottom' }] : [],
      colsText: cols.length ? (o.yard ? o.yard + ': ' : '') + 'units out ' + (weekly ? 'per week (a day on average)' : 'per day') + ', from ' + cols[0].label + ' to ' + cols[cols.length - 1].label
        + '. Highest ' + n0(cols.reduce(function (m, c) { return Math.max(m, c.out); }, 0)) + ' of ' + n0(maxFleet) + '.' : 'No days recorded.',
      yards: yards,
      rows: o.view === 'day' ? flat : yards,
      flat: flat,
      full: all.length >= analyticsData.PAGE_SIZE,
      fullText: all.length >= analyticsData.PAGE_SIZE ? 'The report returned its most rows at once (' + n0(all.length) + '); pick a shorter period to see every day.' : '',
      filters: activeFilters(o, { yard: 'Yard' })
    };
  }

  /** An SVG path for a sparkline in a 100 × 24 box, values 0–100. '' for fewer than two points. */
  function sparkPath(values) {
    var v = (values || []).map(num);
    if (v.length < 2) return '';
    return v.map(function (x, i) {
      var px = (i / (v.length - 1)) * 100;
      var py = 22 - (Math.max(0, Math.min(100, x)) / 100) * 20;
      return (i ? 'L' : 'M') + px.toFixed(1) + ' ' + py.toFixed(1);
    }).join(' ');
  }

  function periodText(from, to) {
    var r = fmt.range(from, to);
    return r || 'the period';
  }

  // ── What is late ──────────────────────────────────────────────────────────────────────────────────────────
  var LATE_KIND = { overdue: 'Past its end date, not back', 'not-shipped': 'Not shipped by its start date' };
  var BUCKETS = [
    { key: 'b1', label: '1–3 days', min: 1, max: 3 }, { key: 'b2', label: '4–7 days', min: 4, max: 7 },
    { key: 'b3', label: '8–14 days', min: 8, max: 14 }, { key: 'b4', label: '15–30 days', min: 15, max: 30 },
    { key: 'b5', label: 'Over 30 days', min: 31, max: Infinity }
  ];

  /** Each late piece of equipment (requestProgress's rule), with how late and what is next. */
  function lateRows(items, linesByRequest, now) {
    var t = today(now);
    return list.equipmentRows(items, linesByRequest, now).map(function (e) {
      var one = Progress.summarize(e.status, [{ lineStatus: e.status, start: e.start, end: e.end }], { external: e.external, now: now });
      var late = one.late[0];
      if (!late) return null;
      var due = late.kind === 'overdue' ? e.end : e.start;
      var info = Progress.line(e.status, e.external);
      var days = Math.max(1, Math.round((t - fmt.dayMs(due)) / DAY));
      return Object.assign({}, e, {
        kind: late.kind, kindLabel: LATE_KIND[late.kind], due: due, days: days,
        dueText: (late.kind === 'overdue' ? 'Ended ' : 'Due out ') + fmt.date(due),
        daysText: plural(days, 'day') + ' late',
        next: late.kind === 'overdue' ? (info.who === 'Requester' || !info.who ? 'Requester to return it' : info.who + ' to ' + info.what) : (info.who ? info.who + ' to ' + info.what : '')
      });
    }).filter(Boolean);
  }

  /**
   * The late report.
   *   items, linesByRequest   requestList.decorate's requests and requestData's lines
   *   f   { kind: all | overdue | not-shipped, party, text }
   */
  function late(items, linesByRequest, now, f, linesLoaded) {
    var o = f || {};
    var all = lateRows(items, linesByRequest, now).sort(function (a, b) { return b.days - a.days || a.requestNumber.localeCompare(b.requestNumber); });
    var filt = function (skip) {
      var off = [].concat(skip || []);
      return all.filter(function (r) {
        if (off.indexOf('kind') === -1 && o.kind && o.kind !== 'all' && r.kind !== o.kind) return false;
        if (off.indexOf('party') === -1 && o.party && (r.party || '(None)') !== o.party) return false;
        return matches(o.text, [r.requestNumber, r.name, r.cls, r.unit, r.party, r.location, r.label]);
      });
    };
    var overdue = all.filter(function (r) { return r.kind === 'overdue'; });
    var notShipped = all.filter(function (r) { return r.kind === 'not-shipped'; });
    var oldest = function (rows) { return rows.reduce(function (m, r) { return Math.max(m, r.days); }, 0); };
    var reqs = {};
    all.forEach(function (r) { reqs[r.requestNumber] = true; });

    // The charts show both kinds of late, so the kind chip does not narrow them; who has it skips its own pick.
    var base = filt('kind');
    var bucketRows = BUCKETS.map(function (b) {
      var c = { overdue: 0, 'not-shipped': 0 };
      base.forEach(function (r) { if (r.days >= b.min && r.days <= b.max) c[r.kind]++; });
      return { key: b.key, label: b.label, total: c.overdue + c['not-shipped'], c: c };
    });
    var maxB = bucketRows.reduce(function (m, b) { return Math.max(m, b.total); }, 0);
    bucketRows.forEach(function (b) {
      b.segs = lateSegs(b.c, maxB);
      b.value = b.total ? n0(b.total) : '';
    });

    var partyMap = {};
    filt(['party', 'kind']).forEach(function (r) {
      var p = r.party || '(None)';
      var e = partyMap[p] = partyMap[p] || { label: p, total: 0, c: { overdue: 0, 'not-shipped': 0 }, days: 0 };
      e.total++; e.c[r.kind]++; e.days = Math.max(e.days, r.days);
    });
    var parties = Object.keys(partyMap).map(function (p) { return partyMap[p]; })
      .sort(function (a, b) { return b.total - a.total || b.days - a.days || a.label.localeCompare(b.label); });
    var morePartiesCount = Math.max(0, parties.length - 8);
    parties = top(parties, 8);
    var maxP = parties.reduce(function (m, p) { return Math.max(m, p.total); }, 0);
    parties.forEach(function (p) {
      p.segs = lateSegs(p.c, maxP);
      p.value = n0(p.total);
      p.on = !!o.party && o.party === p.label;
      p.title = p.label + ': ' + n0(p.c.overdue) + ' past the end date, ' + n0(p.c['not-shipped']) + ' not shipped; the oldest ' + plural(p.days, 'day') + ' late. '
        + (p.on ? 'Click to show everyone.' : 'Click to show only this one.');
    });

    var headline = !all.length
      ? (linesLoaded === false ? 'The equipment on requests could not be loaded, so lateness cannot be worked out. Try Refresh.'
        : 'Nothing is late. Everything out is within its dates, and everything due to go out has shipped.')
      : plural(all.length, 'piece', 'pieces') + ' of equipment ' + (all.length === 1 ? 'is' : 'are') + ' late'
        + (overdue.length ? ': ' + n0(overdue.length) + ' past ' + (overdue.length === 1 ? 'its' : 'their') + ' end date and not back (the oldest ' + plural(oldest(overdue), 'day') + ')' : '')
        + (notShipped.length ? (overdue.length ? ', and ' : ': ') + n0(notShipped.length) + ' not shipped by ' + (notShipped.length === 1 ? 'its' : 'their') + ' start date (the oldest ' + plural(oldest(notShipped), 'day') + ')' : '')
        + '.';

    var shown = filt();
    var chips = [{ key: 'all', label: 'All', count: filt('kind').length },
      { key: 'overdue', label: 'Past end date', count: filt('kind').filter(function (r) { return r.kind === 'overdue'; }).length },
      { key: 'not-shipped', label: 'Not shipped', count: filt('kind').filter(function (r) { return r.kind === 'not-shipped'; }).length }];

    return {
      headline: headline,
      kpis: [
        { key: 'overdue', field: 'kind', label: 'Past the end date, not back', value: n0(overdue.length), note: overdue.length ? 'The oldest ' + plural(oldest(overdue), 'day') + ' late' : 'None', tone: 'late' },
        { key: 'not-shipped', field: 'kind', label: 'Not shipped by the start date', value: n0(notShipped.length), note: notShipped.length ? 'The oldest ' + plural(oldest(notShipped), 'day') + ' late' : 'None', tone: 'ready' },
        { key: 'all', field: 'kind', label: 'Requests affected', value: n0(Object.keys(reqs).length), note: 'Open one to act on it', tone: 'total' }
      ],
      buckets: bucketRows,
      parties: parties,
      morePartiesText: morePartiesCount ? '+' + plural(morePartiesCount, 'more project or customer', 'more projects or customers') + ' in the table' : '',
      chips: chips,
      rows: shown,
      shownText: plural(shown.length, 'piece') + ' shown',
      filters: activeFilters(o, { party: 'Project or customer' })
    };
  }

  function lateSegs(c, max) {
    return ['overdue', 'not-shipped'].filter(function (k) { return c[k] > 0; }).map(function (k) {
      return { key: k, n: c[k], w: max ? (c[k] / max) * 100 : 0, title: n0(c[k]) + ' ' + (k === 'overdue' ? 'past the end date' : 'not shipped') };
    });
  }

  // ── How requests are moving ───────────────────────────────────────────────────────────────────────────────
  function monthKey(v) { var m = /^(\d{4})-(\d{2})/.exec(String(v || '')); return m ? m[1] + '-' + m[2] : ''; }
  function monthLabel(key) { var p = key.split('-'); return MON[Number(p[1]) - 1] + ' ' + p[0]; }
  function addMonths(key, n) {
    var p = key.split('-');
    var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1 + n, 1));
    return d.toISOString().slice(0, 7);
  }

  /**
   * Requests: where each one is now, and how many start each month.
   *   items   requestList.decorate's requests (each with p and lane)
   *   f       { months: 6 | 12, lane, month, text }
   */
  function flow(items, now, f) {
    var o = f || {};
    var all = items || [];
    var span = Number(o.months) === 12 ? 12 : 6;
    var thisMonth = new Date(today(now)).toISOString().slice(0, 7);
    var keys = [];
    for (var i = -(span - 1); i <= 2; i++) keys.push(addMonths(thisMonth, i));

    var laneCounts = {};
    list.LANES.forEach(function (l) { laneCounts[l.key] = 0; });
    all.forEach(function (r) { laneCounts[r.lane] = (laneCounts[r.lane] || 0) + 1; });
    var maxLane = Object.keys(laneCounts).reduce(function (m, k) { return Math.max(m, laneCounts[k]); }, 0);
    var lanes = list.LANES.map(function (l) {
      var n = laneCounts[l.key] || 0;
      return { key: l.key, label: l.label, hint: l.hint, n: n, value: n0(n), w: maxLane ? (n / maxLane) * 100 : 0, tone: l.key === 'action' ? 'stopped' : l.key,
        on: o.lane === l.key, title: l.label + ': ' + plural(n, 'request') + '. ' + (o.lane === l.key ? 'Click to show every request.' : 'Click to show only these.') };
    });

    var byMonth = {};
    keys.forEach(function (k) { byMonth[k] = { total: 0, c: {} }; });
    var startedInRange = 0;
    all.forEach(function (r) {
      var k = monthKey(r.startDate);
      if (!byMonth[k]) return;
      byMonth[k].total++;
      byMonth[k].c[r.lane] = (byMonth[k].c[r.lane] || 0) + 1;
      if (k <= thisMonth) startedInRange++;
    });
    var maxM = keys.reduce(function (m, k) { return Math.max(m, byMonth[k].total); }, 0);
    var months = keys.map(function (k) {
      var e = byMonth[k];
      return {
        key: k, label: MON[Number(k.slice(5, 7)) - 1], year: k.slice(0, 4), future: k > thisMonth, now: k === thisMonth, total: e.total, value: e.total ? n0(e.total) : '',
        h: maxM ? (e.total / maxM) * 100 : 0, on: o.month === k,
        segs: list.LANES.filter(function (l) { return e.c[l.key]; }).map(function (l) {
          return { key: l.key, tone: l.key === 'action' ? 'stopped' : l.key, h: (e.c[l.key] / e.total) * 100, title: n0(e.c[l.key]) + ' ' + l.label.toLowerCase() };
        }),
        title: monthLabel(k) + ': ' + plural(e.total, 'request') + ' starting' + (e.total ? ' (' + list.LANES.filter(function (l) { return e.c[l.key]; })
          .map(function (l) { return n0(e.c[l.key]) + ' ' + l.label.toLowerCase(); }).join(', ') + ')' : '') + '. ' + (o.month === k ? 'Click to show every month.' : 'Click to show only this month.')
      };
    });
    var past = months.filter(function (m) { return !m.future; });
    var busiest = past.reduce(function (b, m) { return !b || m.total > b.total ? m : b; }, null);

    var shown = all.filter(function (r) {
      if (o.lane && r.lane !== o.lane) return false;
      if (o.month && monthKey(r.startDate) !== o.month) return false;
      return matches(o.text, [r.requestNumber, r.party, r.taskName, r.requestorName, r.contactName, r.p && r.p.headline]);
    });
    var lateCount = all.filter(function (r) { return r.p && r.p.late && r.p.late.length; }).length;
    var out = (laneCounts.out || 0) + (laneCounts.onsite || 0) + (laneCounts.back || 0);

    var parts = [
      [laneCounts.action, 'waiting on the requester or customer'], [laneCounts.approval, 'waiting for approval'], [laneCounts.ready, 'getting ready'],
      [out, 'with equipment out'], [laneCounts.done, 'done']
    ].filter(function (x) { return x[0]; }).map(function (x) { return n0(x[0]) + ' ' + x[1]; });
    var headline = !all.length ? 'No requests yet.'
      : plural(all.length, 'request') + ': ' + (parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts.join('')) + '. '
        + n0(startedInRange) + ' started in the last ' + span + ' months' + (busiest && busiest.total ? '; the busiest month was ' + monthLabel(busiest.key) + ' (' + n0(busiest.total) + ')' : '') + '.'
        + (lateCount ? ' ' + (lateCount === 1 ? '1 request is late.' : n0(lateCount) + ' requests are late.') : '');

    return {
      headline: headline,
      kpis: [
        { key: 'approval', field: 'lane', label: 'Waiting for approval', value: n0(laneCounts.approval || 0), note: 'With the Equipment Manager', tone: 'approval' },
        { key: 'ready', field: 'lane', label: 'Getting ready', value: n0(laneCounts.ready || 0), note: 'Units assigned, bought or picked', tone: 'ready' },
        { key: 'out', label: 'Equipment out', value: n0(out), note: 'On the way, on site or coming back', tone: 'out' },
        { key: 'done', field: 'lane', label: 'Done', value: n0(laneCounts.done || 0), note: 'Returned, closed or cancelled', tone: 'done' }
      ],
      lanes: lanes,
      months: months,
      monthsText: months.map(function (m) { return monthLabel(m.key) + ' ' + m.total; }).join(', '),
      legend: list.LANES.map(function (l) { return { key: l.key, label: l.label, tone: l.key === 'action' ? 'stopped' : l.key }; }),
      span: span,
      rows: shown,
      shownText: plural(shown.length, 'request') + ' shown',
      filters: activeFilters({ lane: o.lane ? (list.LANES.filter(function (l) { return l.key === o.lane; })[0] || {}).label : '', month: o.month ? monthLabel(o.month) : '' },
        { lane: 'Where', month: 'Starting' })
    };
  }

  // ── What it costs ─────────────────────────────────────────────────────────────────────────────────────────
  function costRow(r, i) {
    var x = r || {};
    var total = x.totalCost != null && x.totalCost !== '' ? num(x.totalCost) : num(x.cost);
    var st = up(x.postedStatus);
    var state = st === 'POSTED' ? 'posted' : (st === 'UNPOSTED' || st === 'NOT_POSTED' ? 'unposted' : (st ? 'unposted' : 'unknown'));
    return {
      key: i + ':' + (x.rowKey || x.requestLineId || ''), requestNumber: x.requestNumber || '', line: x.lineNumber != null ? String(x.lineNumber) : '',
      equipNumber: x.equipmentNumber || '', equipName: x.equipmentName || x.equipmentDescription || '', project: x.projectName || x.customerName || '',
      projectNumber: x.projectNumber || '', customer: x.customerName || '', yard: x.yardLocation || '', qty: x.quantity != null ? num(x.quantity) : '',
      cost: x.cost != null ? num(x.cost) : '', total: total, state: state,
      stateLabel: { posted: 'Posted', unposted: 'Not posted yet', unknown: 'Not recorded' }[state],
      postedDate: x.postedDate ? String(x.postedDate).slice(0, 10) : '', status: st
    };
  }

  /**
   * Cost.
   *   rows   project-cost-detail rows
   *   f      { posted: all | posted | unposted, party, yard, text }
   */
  function cost(rows, f) {
    var o = f || {};
    var all = (rows || []).map(costRow);
    var filt = function (skip) {
      var off = [].concat(skip || []);
      return all.filter(function (r) {
        if (off.indexOf('posted') === -1 && o.posted && o.posted !== 'all' && r.state !== o.posted) return false;
        if (off.indexOf('party') === -1 && o.party && (r.project || '(None)') !== o.party) return false;
        if (off.indexOf('yard') === -1 && o.yard && (r.yard || '(None)') !== o.yard) return false;
        return matches(o.text, [r.requestNumber, r.equipNumber, r.equipName, r.project, r.projectNumber, r.yard]);
      });
    };
    var sum = function (rs, state) { return rs.reduce(function (s, r) { return s + (!state || r.state === state ? r.total : 0); }, 0); };
    var total = sum(all);
    var posted = sum(all, 'posted');
    var unposted = sum(all, 'unposted');
    var unknown = sum(all, 'unknown');

    var group = function (rs, field, n) {
      var m = {};
      rs.forEach(function (r) {
        var k = r[field] || '(None)';
        var e = m[k] = m[k] || { label: k, total: 0, c: { posted: 0, unposted: 0, unknown: 0 }, lines: 0 };
        e.total += r.total; e.c[r.state] += r.total; e.lines++;
      });
      var out = Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.total - a.total || a.label.localeCompare(b.label); });
      var more = Math.max(0, out.length - n);
      out = out.slice(0, n);
      var max = out.reduce(function (x, e) { return Math.max(x, e.total); }, 0);
      out.forEach(function (e) {
        e.value = fmt.money(Math.round(e.total)) || '$0';
        e.on = !!o[field === 'project' ? 'party' : 'yard'] && o[field === 'project' ? 'party' : 'yard'] === e.label;
        e.segs = ['posted', 'unposted', 'unknown'].filter(function (k) { return e.c[k] > 0; }).map(function (k) {
          return { key: k, w: max ? (e.c[k] / max) * 100 : 0, title: (fmt.money(Math.round(e.c[k])) || '$0') + ' ' + { posted: 'posted', unposted: 'not posted yet', unknown: 'not recorded' }[k] };
        });
        e.title = e.label + ': ' + e.value + ' on ' + plural(e.lines, 'line') + ' (' + (fmt.money(Math.round(e.c.posted)) || '$0') + ' posted). '
          + (e.on ? 'Click to show everything.' : 'Click to show only this one.');
      });
      return { items: out, more: more };
    };
    // The charts show posted and not posted, so the posted chip does not narrow them; each skips its own pick.
    var byParty = group(filt(['party', 'posted']), 'project', 10);
    var byYard = group(filt(['yard', 'posted']), 'yard', 8);
    var shown = filt().sort(function (a, b) { return b.total - a.total || a.requestNumber.localeCompare(b.requestNumber); });
    var money = function (v) { return fmt.money(Math.round(v)) || '$0'; };
    // The largest, over every line (the answer does not follow the filters).
    var leadMap = {};
    all.forEach(function (r) { var k = r.project || '(None)'; leadMap[k] = (leadMap[k] || 0) + r.total; });
    var leadKey = Object.keys(leadMap).sort(function (a, b) { return leadMap[b] - leadMap[a] || a.localeCompare(b); })[0];
    var lead = leadKey ? { label: leadKey, total: leadMap[leadKey], value: fmt.money(Math.round(leadMap[leadKey])) || '$0' } : null;

    var headline = !all.length ? 'No equipment cost is recorded yet.'
      : money(total) + ' of equipment cost on ' + plural(all.length, 'line') + ': ' + money(posted) + ' posted to projects, ' + money(unposted) + ' not posted yet'
        + (unknown ? ', ' + money(unknown) + ' with no posting status' : '') + '.'
        + (lead ? ' The largest is ' + lead.label + ' (' + lead.value + ', ' + pct(lead.total, total) + '%).' : '');

    var chips = [{ key: 'all', label: 'All', count: filt('posted').length },
      { key: 'posted', label: 'Posted', count: filt('posted').filter(function (r) { return r.state === 'posted'; }).length },
      { key: 'unposted', label: 'Not posted yet', count: filt('posted').filter(function (r) { return r.state === 'unposted'; }).length }];
    if (all.some(function (r) { return r.state === 'unknown'; })) {
      chips.push({ key: 'unknown', label: 'Not recorded', count: filt('posted').filter(function (r) { return r.state === 'unknown'; }).length });
    }

    return {
      headline: headline,
      kpis: [
        { key: 'all', field: 'posted', label: 'Equipment cost', value: money(total), note: plural(all.length, 'cost line'), tone: 'total' },
        { key: 'posted', field: 'posted', label: 'Posted to projects', value: money(posted), note: pct(posted, total) + '% of the cost', tone: 'onsite' },
        { key: 'unposted', field: 'posted', label: 'Not posted yet', value: money(unposted), note: pct(unposted, total) + '% · posted from Post costs', tone: 'ready' }
      ],
      parties: byParty.items,
      morePartiesText: byParty.more ? '+' + plural(byParty.more, 'more project or customer', 'more projects or customers') + ' in the table' : '',
      yards: byYard.items,
      moreYardsText: byYard.more ? '+' + plural(byYard.more, 'more yard') + ' in the table' : '',
      chips: chips,
      rows: shown,
      shownText: plural(shown.length, 'line') + ' shown · ' + money(sum(shown)),
      full: all.length >= analyticsData.PAGE_SIZE,
      fullText: all.length >= analyticsData.PAGE_SIZE ? 'The list holds the first ' + n0(all.length) + ' cost lines, the most the report returns at once.' : '',
      filters: activeFilters(o, { party: 'Project or customer', yard: 'Yard' })
    };
  }

  // ── Export: what each report's table holds, as a person reads it ──────────────────────────────────────────
  function exportOf(report, view) {
    if (report === 'fleet') {
      return { name: 'fleet-out-or-idle', title: 'Fleet: out or idle', columns: [
        { key: 'cls', label: 'Class' }, { key: 'name', label: 'Equipment' }, { key: 'unit', label: 'Unit / serial' }, { key: 'asset', label: 'Asset' },
        { key: 'yard', label: 'Yard' }, { key: 'stateLabel', label: 'Out or idle' }, { key: 'statusLabel', label: 'Unit status' },
        { key: 'project', label: 'Current project' }, { key: 'start', label: 'Start' }, { key: 'end', label: 'End' },
        { key: 'pastDays', label: 'Days past its end date', type: 'number', value: function (r) { return r.pastEnd ? r.pastDays : ''; } },
        { key: 'status', label: 'Stored unit status' }] };
    }
    if (report === 'use') {
      if (view === 'day') {
        // New EquipRite's Utilization CSV columns, in its order.
        return { name: 'utilization-by-day', title: 'Utilization by yard and day', columns: [
          { key: 'yard', label: 'Yard' }, { key: 'day', label: 'Date' }, { key: 'month', label: 'Month' }, { key: 'fleet', label: 'Fleet Size', type: 'number' },
          { key: 'out', label: 'Deployed Units', type: 'number' }, { key: 'pct', label: 'Utilization %', type: 'number' }, { key: 'hours', label: 'Used Hours', type: 'number' }] };
      }
      return { name: 'utilization-by-yard', title: 'Utilization by yard', columns: [
        { key: 'label', label: 'Yard' }, { key: 'fleet', label: 'Units (latest day)', type: 'number' },
        { key: 'avgOut', label: 'Out on an average day', type: 'number', value: function (r) { return Math.round(r.avgOut * 10) / 10; } },
        { key: 'pct', label: 'Utilization %', type: 'number' }, { key: 'peak', label: 'Most out on one day', type: 'number' },
        { key: 'peakDay', label: 'On' }, { key: 'days', label: 'Days recorded', type: 'number' }] };
    }
    if (report === 'late') {
      return { name: 'late-equipment', title: 'Late equipment', columns: [
        { key: 'requestNumber', label: 'Request' }, { key: 'name', label: 'Equipment' }, { key: 'cls', label: 'Class' }, { key: 'unit', label: 'Unit / serial' },
        { key: 'kindLabel', label: 'Late' }, { key: 'days', label: 'Days late', type: 'number' }, { key: 'due', label: 'Due' },
        { key: 'label', label: 'Where it is' }, { key: 'next', label: 'Next step' }, { key: 'party', label: 'Project or customer' },
        { key: 'location', label: 'Location' }, { key: 'start', label: 'Start' }, { key: 'end', label: 'End' }, { key: 'status', label: 'Stored line status' }] };
    }
    if (report === 'flow') {
      return { name: 'requests-flow', title: 'Requests', columns: list.exportColumns('list') };
    }
    return { name: 'equipment-cost', title: 'Equipment cost', columns: [
      { key: 'requestNumber', label: 'Request' }, { key: 'line', label: 'Line' }, { key: 'equipNumber', label: 'Equipment number' },
      { key: 'equipName', label: 'Equipment' }, { key: 'projectNumber', label: 'Project number' }, { key: 'project', label: 'Project or customer' },
      { key: 'yard', label: 'Yard' }, { key: 'qty', label: 'Qty', type: 'number' }, { key: 'cost', label: 'Cost', type: 'number' },
      { key: 'total', label: 'Total cost', type: 'number' }, { key: 'stateLabel', label: 'Posted' }, { key: 'postedDate', label: 'Posted on' }] };
  }

  /** Plain words for calls that failed: [{ endpoint, status }]. */
  function loadErrorText(failed) {
    var f = Array.isArray(failed) ? failed : [];
    if (!f.length) return '';
    var codes = f.map(function (x) { return x.status; }).filter(Boolean);
    var auth = codes.some(function (s) { return s === 401 || s === 403; });
    return 'Some of this report could not be loaded' + (codes.length ? ' (HTTP ' + codes[0] + ')' : '') + ', so the numbers may be incomplete.'
      + (auth ? ' Your sign-in may have expired: reload the page and sign in again.' : ' Try Refresh in a minute; if it keeps happening, check Integrations.');
  }

  return {
    REPORTS: REPORTS,
    PERIODS: PERIODS,
    MORE: MORE,
    NOT_YET: NOT_YET,
    BUCKETS: BUCKETS,
    reportsFor: reportsFor,
    unitState: unitState,
    fleet: fleet,
    utilization: utilization,
    sparkPath: sparkPath,
    lateRows: lateRows,
    late: late,
    flow: flow,
    costRow: costRow,
    cost: cost,
    exportOf: exportOf,
    loadErrorText: loadErrorText,
    periodText: periodText
  };
});
