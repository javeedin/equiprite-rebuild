define(['resources/js/availability'], function (av) {
  'use strict';

  // Availability's yard grid: the fleet as a pivot. Rows are equipment (the equipment item's name, grouped by class
  // as the timeline groups them) or, one level down, units; columns are yards (one per yard, "No yard recorded"
  // last). A cell has a tick when that equipment has units at that yard, with how many and how many are free in your
  // window, coloured by the window: all free, some free, none free. A unit row has a tick in its own yard's column
  // with its state in the window (free, free but tight, booked, maintenance). Row totals and a totals row per yard.
  //
  // Pure, and Next only: it reads availability.build()'s model and the units the page's search, class, yard and chip
  // let through (availability.view().ordered), so the grid always shows what the timeline shows. Free means what it
  // means everywhere on the page (availability.windowState: free, or free with a tight turnaround). Nothing here
  // reads or writes data.

  var TICK = '✓';
  // Rows: about ROWS at first, shared between the classes (at least MIN_ROWS each); "Show more" adds MORE_ROWS.
  var ROWS = 200;
  var MIN_ROWS = 10;
  var MORE_ROWS = 100;
  var NO_YARD_KEY = '-';
  // How many serials a cell's hover lists.
  var SERIALS = 8;

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function lc(v) { return String(v == null ? '' : v).toLowerCase(); }
  function cmp(a, b) { return a < b ? -1 : (a > b ? 1 : 0); }
  function isFree(state) { return state === 'free' || state === 'tight'; }

  /** { serial: equipment master id } from serial-refs rows (the first id a serial names), for the equipment's tab. */
  function equipmentIds(serials) {
    var out = {};
    (serials || []).forEach(function (s) {
      if (!s || !s.serialNumber || s.equipmentId === undefined || s.equipmentId === null || s.equipmentId === '') return;
      var k = String(s.serialNumber);
      if (out[k] === undefined) out[k] = String(s.equipmentId);
    });
    return out;
  }

  /**
   * The columns: every yard of the fleet in the yard filter's order (by name, "No yard recorded" last), or the one
   * yard picked. Each: { key, label, code, name, fleet }. A yard stays a column when the search leaves it empty, so
   * "not there" reads as plainly as "there".
   */
  function columns(model, yard) {
    return av.yards(model).filter(function (y) { return !yard || y.key === yard; }).map(function (y) {
      var none = y.key === NO_YARD_KEY;
      var at = y.label.indexOf(' · ');
      return {
        key: y.key, label: y.label, fleet: y.count,
        code: none ? av.NO_YARD : (at === -1 ? y.label : y.label.slice(0, at)),
        name: none || at === -1 ? '' : y.label.slice(at + 3)
      };
    });
  }

  /** What the page's choices mean for the grid. `vars` holds the page's variables; `ids` the units the filters let through. */
  function optionsFrom(vars, ids, grain) {
    var v = vars || {};
    return {
      ids: ids || [], from: v.from, to: v.to, yard: v.yard || '', grain: grain || v.grain,
      collapsed: v.gridCollapsed || {}, more: v.gridMore || {}, equipmentIds: v.equipmentIds || {}
    };
  }

  /** Units in a cell: n in all; free (free or tight, as the page counts them), of which tight; booked; maint. */
  function emptyCounts() { return { n: 0, free: 0, tight: 0, booked: 0, maint: 0 }; }

  function add(c, state) {
    c.n += 1;
    if (isFree(state)) c.free += 1;
    if (state === 'tight' || state === 'booked' || state === 'maint') c[state] += 1;
  }

  function stateOfCounts(c) {
    if (!c.n) return '';
    return c.free === c.n ? 'all' : (c.free ? 'some' : 'none');
  }

  /** "2 free (1 tight) · 1 booked · 1 in maintenance". */
  function breakdown(c) {
    return [c.free + ' free' + (c.tight ? ' (' + c.tight + ' tight)' : ''), c.booked ? c.booked + ' booked' : '', c.maint ? c.maint + ' in maintenance' : '']
      .filter(Boolean).join(' · ');
  }

  /**
   * The whole grid, every row (no paging): columns, classes and their rows with a cell per column, totals.
   * @param {Object} model availability.build()
   * @param {Object} o { ids, from, to, yard, grain: equipment | units, equipmentIds: { serial: id } }
   */
  function compute(model, o) {
    var m = model || { units: [], byUnit: {}, today: av.todayKey() };
    var opts = o || {};
    var grain = opts.grain === 'units' ? 'units' : 'equipment';
    var win = av.windowOf(opts.from, opts.to, m.today);
    var cols = columns(m, opts.yard);
    var colAt = {};
    cols.forEach(function (c, i) { colAt[c.key] = i; });
    var byId = {};
    (m.units || []).forEach(function (u) { byId[u.id] = u; });
    var ids = Array.isArray(opts.ids) ? opts.ids : (m.units || []).map(function (u) { return u.id; });
    var eqIds = opts.equipmentIds || {};

    var groups = {};
    var seen = {};
    ids.forEach(function (id) {
      var u = byId[id];
      if (!u || seen[id]) return;
      seen[id] = true;
      var yk = u.yardKey || NO_YARD_KEY;
      if (colAt[yk] === undefined) return;
      var ws = av.windowState((m.byUnit || {})[id], win.from, win.to);
      var g = groups[u.cls] || (groups[u.cls] = { key: 'c:' + u.cls, label: u.cls, last: u.cls === av.NO_CLASS, byKey: {}, rows: [] });
      var rk = grain === 'units' ? 'u:' + u.id : 'e:' + u.cls + '|' + u.name;
      var r = g.byKey[rk];
      if (!r) {
        r = g.byKey[rk] = { key: rk, name: u.name, serial: grain === 'units' ? u.serial : '', cls: u.cls, known: u.known !== false, units: [] };
        g.rows.push(r);
      }
      r.units.push({ u: u, col: colAt[yk], ws: ws });
    });

    var glist = Object.keys(groups).map(function (k) { return groups[k]; })
      .sort(function (a, b) { return Number(a.last) - Number(b.last) || cmp(lc(a.label), lc(b.label)) || cmp(a.label, b.label); });
    var total = cols.map(emptyCounts);
    var all = emptyCounts();
    var rowCount = 0;

    glist.forEach(function (g) {
      g.rows.sort(function (a, b) { return cmp(lc(a.name), lc(b.name)) || cmp(a.name, b.name) || cmp(a.serial, b.serial); });
      g.sum = cols.map(emptyCounts);
      g.all = emptyCounts();
      g.rows = g.rows.map(function (r) {
        var counts = cols.map(emptyCounts);
        var serials = cols.map(function () { return []; });
        var ids2 = {};
        r.units.forEach(function (x) {
          add(counts[x.col], x.ws.state);
          add(g.sum[x.col], x.ws.state);
          add(total[x.col], x.ws.state);
          add(g.all, x.ws.state);
          add(all, x.ws.state);
          serials[x.col].push(x.u.serial);
          var eid = eqIds[x.u.serial];
          if (eid !== undefined) ids2[eid] = true;
        });
        var units = r.units.length;
        var free = r.units.filter(function (x) { return isFree(x.ws.state); }).length;
        var yards = counts.filter(function (c) { return c.n > 0; }).length;
        var eidList = Object.keys(ids2);
        // The equipment's own id when its units all name the same one (two masters sharing a name open by name).
        var equipmentId = grain === 'equipment' && eidList.length === 1 ? eidList[0] : '';
        var cells;
        var row;
        if (grain === 'units') {
          var one = r.units[0];
          var st = av.STATES[one.ws.state];
          cells = cols.map(function (c, i) {
            if (i !== one.col) return { key: c.key, n: 0, state: '', text: '', tickCls: '', cls: 'nx-pv-cell nx-pv-c nx-pv-c--empty', title: '' };
            return { key: c.key, n: 1, state: one.ws.state, text: TICK + ' ' + one.ws.label, tickCls: 'nx-pv-tick nx-pv-tick--' + one.ws.state,
              cls: 'nx-pv-cell nx-pv-c nx-pv-c--' + one.ws.state, title: r.serial + ' at ' + c.label + '\n' + st.label + ' ' + av.range(win.from, win.to) + ': ' + one.ws.why };
          });
          row = {
            type: 'row', key: r.key, grain: grain, name: r.name, serial: r.serial, equipmentId: '', main: r.serial,
            sub: r.name + (r.known ? '' : ' · not in the unit list'), state: one.ws.state, stateLabel: one.ws.label, why: one.ws.why,
            yard: cols[one.col].label, units: 1, free: free, cells: cells,
            title: 'Open everything about unit ' + r.serial + ' (' + r.name + ')'
          };
        } else {
          cells = counts.map(function (c, i) {
            var s = stateOfCounts(c);
            if (!c.n) return { key: cols[i].key, n: 0, free: 0, state: '', text: '', tickCls: '', cls: 'nx-pv-cell nx-pv-c nx-pv-c--empty', title: '' };
            var list = serials[i];
            return {
              key: cols[i].key, n: c.n, free: c.free, tight: c.tight, booked: c.booked, maint: c.maint, state: s,
              text: TICK + ' ' + c.n + ' · ' + c.free + ' free', tickCls: 'nx-pv-tick nx-pv-tick--' + s, cls: 'nx-pv-cell nx-pv-c nx-pv-c--' + s,
              title: r.name + ' at ' + cols[i].label + ': ' + plural(c.n, 'unit') + ', ' + breakdown(c) + ' ' + av.range(win.from, win.to)
                + '\n' + list.slice(0, SERIALS).join(', ') + (list.length > SERIALS ? ' and ' + (list.length - SERIALS) + ' more' : '')
            };
          });
          var only = yards === 1 ? cols[counts.map(function (c) { return c.n > 0; }).indexOf(true)] : null;
          row = {
            type: 'row', key: r.key, grain: grain, name: r.name, serial: '', equipmentId: equipmentId, main: r.name,
            sub: only ? (only.key === NO_YARD_KEY ? 'No yard recorded' : 'All at ' + only.code) : 'At ' + yards + ' yards',
            yards: yards, units: units, free: free, cells: cells,
            title: 'Open everything about ' + r.name + ' (' + plural(units, 'unit') + ')'
          };
        }
        row.freeCls = 'nx-pv-cell nx-pv-num nx-pv-num--free' + (free ? '' : ' nx-pv-num--none');
        rowCount += 1;
        return row;
      });
    });

    var sumCells = function (list) {
      return list.map(function (c, i) {
        return { key: cols[i].key, n: c.n, free: c.free, text: c.n ? c.n + ' · ' + c.free + ' free' : '',
          cls: 'nx-pv-cell nx-pv-c nx-pv-c--sum' + (c.n ? '' : ' nx-pv-c--empty'), title: c.n ? cols[i].label + ': ' + plural(c.n, 'unit') + ', ' + breakdown(c) : '' };
      });
    };
    var yardsWith = total.filter(function (c) { return c.n > 0; }).length;
    return {
      grain: grain, win: win, columns: cols.map(function (c, i) {
        return Object.assign({}, c, { n: total[i].n, free: total[i].free,
          cls: 'nx-pv-cell nx-pv-yard' + (total[i].n ? '' : ' nx-pv-yard--empty'),
          title: c.label + ': ' + (total[i].n ? plural(total[i].n, 'unit') + ' shown, ' + breakdown(total[i]) + ' ' + av.range(win.from, win.to) : 'none of the units shown')
            + (c.fleet !== total[i].n ? ' (' + plural(c.fleet, 'unit') + ' in all)' : '') });
      }),
      groups: glist.map(function (g) {
        return { key: g.key, label: g.label, rows: g.rows, units: g.all.n, free: g.all.free, cells: sumCells(g.sum) };
      }),
      totals: { units: all.n, free: all.free, cells: sumCells(total), freeCls: 'nx-pv-cell nx-pv-num nx-pv-num--free' + (all.free ? '' : ' nx-pv-num--none') },
      rows: rowCount, units: all.n, free: all.free, yardsWith: yardsWith
    };
  }

  /**
   * What the grid shows: compute(), with each class a collapsible group row (its subtotals per yard) and a page of
   * its rows, "Show more" for the rest; the CSS columns; the line above it.
   * @param {Object} o as compute(), plus collapsed: { groupKey: true }, more: { groupKey: extra rows }
   */
  function grid(model, o) {
    var opts = o || {};
    var c = compute(model, opts);
    var collapsed = opts.collapsed || {};
    var extra = opts.more || {};
    var perGroup = Math.max(MIN_ROWS, Math.floor(ROWS / Math.max(1, c.groups.length)));
    var items = [];
    var hidden = 0;
    var units = c.grain === 'units';
    c.groups.forEach(function (g) {
      var isCollapsed = !!collapsed[g.key];
      items.push({ type: 'group', key: 'g|' + g.key, group: g.key, label: g.label, collapsed: isCollapsed, units: g.units, free: g.free, cells: g.cells,
        freeCls: 'nx-pv-cell nx-pv-num nx-pv-num--free' + (g.free ? '' : ' nx-pv-num--none'),
        text: (units ? '' : plural(g.rows.length, 'item') + ' · ') + plural(g.units, 'unit') + ' · ' + g.free + ' free' });
      if (isCollapsed) return;
      var cap = perGroup + (Number(extra[g.key]) || 0);
      g.rows.slice(0, cap).forEach(function (r) { items.push(r); });
      var left = g.rows.length - Math.min(cap, g.rows.length);
      if (left > 0) {
        hidden += left;
        items.push({ type: 'more', key: 'm|' + g.key, group: g.key, left: left,
          text: 'Show ' + Math.min(MORE_ROWS, left) + ' more of ' + g.label + ' (' + left + ' not shown)' });
      }
    });
    var n = c.columns.length;
    var what = units ? plural(c.rows, 'unit') : plural(c.rows, 'equipment item');
    return {
      grain: c.grain,
      win: c.win,
      columns: c.columns,
      cols: 'var(--pv-first) ' + (n ? 'repeat(' + n + ', minmax(var(--pv-col), 1fr)) ' : '') + 'var(--pv-num) var(--pv-num)',
      items: items,
      totals: c.totals,
      rows: c.rows,
      units: c.units,
      free: c.free,
      more: hidden,
      head: units ? 'Unit' : 'Equipment',
      note: c.rows ? (units ? '' : what + ' · ') + plural(c.units, 'unit') + ' in ' + plural(c.yardsWith, 'yard') + ' · '
        + c.free + ' free ' + av.range(c.win.from, c.win.to) : '',
      exportNote: c.rows ? what + ' by ' + plural(n, 'yard') + ', free ' + av.range(c.win.from, c.win.to) : 'Nothing to export'
    };
  }

  /** Export: the grid as shown (every row in the filters, folded or not), then the totals. { rows, columns }. */
  function exportTable(model, o) {
    var c = compute(model, o);
    var units = c.grain === 'units';
    var columnsOut = [{ key: 'cls', label: 'Class' }];
    if (units) columnsOut.push({ key: 'serial', label: 'Unit (serial)' });
    columnsOut.push({ key: 'equipment', label: 'Equipment' });
    c.columns.forEach(function (col, i) { columnsOut.push({ key: 'y' + i, label: col.label }); });
    if (units) columnsOut.push({ key: 'why', label: 'In your window' });
    columnsOut.push({ key: 'units', label: 'Units', type: 'number' }, { key: 'free', label: 'Free in your window', type: 'number' });
    var rows = [];
    c.groups.forEach(function (g) {
      g.rows.forEach(function (r) {
        var out = { cls: g.label, serial: r.serial, equipment: r.name, why: units ? r.stateLabel + ': ' + r.why : '', units: r.units, free: r.free };
        r.cells.forEach(function (cell, i) { out['y' + i] = cell.text; });
        rows.push(out);
      });
    });
    if (rows.length) {
      var tot = { cls: '', serial: '', equipment: 'Total', why: '', units: c.totals.units, free: c.totals.free };
      c.totals.cells.forEach(function (cell, i) { tot['y' + i] = cell.text; });
      if (units) tot.serial = 'Total';
      if (units) tot.equipment = '';
      rows.push(tot);
    }
    return { rows: rows, columns: columnsOut };
  }

  /** What the colours mean, per grain. */
  function legend(grain) {
    if (grain === 'units') {
      return ['free', 'tight', 'booked', 'maint'].map(function (k) {
        return { key: k, label: av.STATES[k].label, cls: 'nx-pv-key nx-pv-tick--' + k, title: av.STATES[k].hint };
      });
    }
    return [
      { key: 'all', label: 'All free in your window', cls: 'nx-pv-key nx-pv-tick--all', title: 'Every unit there is free in your window' },
      { key: 'some', label: 'Some free', cls: 'nx-pv-key nx-pv-tick--some', title: 'Some units there are free in your window' },
      { key: 'none', label: 'None free', cls: 'nx-pv-key nx-pv-tick--none', title: 'Every unit there is booked or in maintenance in your window' }
    ];
  }

  return {
    TICK: TICK, ROWS: ROWS, MIN_ROWS: MIN_ROWS, MORE_ROWS: MORE_ROWS, NO_YARD_KEY: NO_YARD_KEY,
    equipmentIds: equipmentIds, columns: columns, optionsFrom: optionsFrom, compute: compute, grid: grid, exportTable: exportTable, legend: legend
  };
});
