define(['resources/js/exportKit', 'resources/js/rateRules', 'resources/js/shellBus', 'ojs/ojarraydataprovider'], (exportKit, R, bus, ArrayDataProvider) => {
  'use strict';

  // Compare rates: binding helpers. The comparison is resources/js/rateCompare.js (linesChain stores it in `view`).
  // None uses `this`: a binding may call a function detached from the module.
  const kept = {};
  /** The same object for the same content: Oracle's table and header redraw only when it changes. */
  function same(key, content, make) {
    const json = JSON.stringify(content);
    if (!kept[key] || kept[key].json !== json) kept[key] = { json, value: make(content) };
    return kept[key].value;
  }

  class PageModule {
    constructor(context) {
      // Rates may hand over a schedule to compare (shellBus.focus): focusChain takes it.
      const helper = context && typeof context.getEventHelper === 'function' ? context.getEventHelper() : null;
      bus.onFocus('rate-compare', () => { if (helper) helper.fireCustomEvent('focusRequest', {}); });
    }

    formats() { return exportKit.FORMATS; }

    /** The schedules not picked yet, to add. */
    unpicked(schedules, picked) {
      const ids = (picked || []).map(String);
      return (schedules || []).filter((s) => ids.indexOf(s.id) === -1);
    }

    /** The picked schedules as cards: { id, name, sub, base, cheapest, dearest, avg, has, loaded }. */
    cards(schedules, picked, view) {
      const cols = {};
      ((view && view.cols) || []).forEach((c) => { cols[c.id] = c; });
      return (picked || []).map(String).map((id, i) => {
        const s = (schedules || []).filter((x) => x.id === id)[0] || { id, name: id, sub: '' };
        const c = cols[id];
        return { id, name: s.name, sub: s.sub, base: i === 0, loaded: !!c, active: !!s.active,
          score: c ? 'Cheapest on ' + c.cheapest + ' · dearest on ' + c.dearest + ' · has ' + c.has : 'Reading its rates…',
          avg: c ? c.avg : '' };
      });
    }

    /** The tiers to pick from: Every tier, then each period some picked schedule has a rate in. */
    periods(linesBy, picked) {
      const seen = {};
      (picked || []).forEach((id) => { ((linesBy || {})[id] || []).forEach((l) => { seen[l.period] = true; }); });
      return [{ value: '', label: 'Every tier' }].concat(R.PERIODS.filter((p) => seen[p.value]).map((p) => ({ value: p.value, label: p.label })));
    }

    /** A row's cell for a schedule. */
    cell(row, id) { return (row && row.cells && row.cells[id]) || { has: false, main: '—', lines: [], diff: '', note: '', tone: '' }; }
    cellClass(c) { return 'nx-cm-rc-cell' + (c && c.has ? '' : ' nx-cm-rc-cell--none') + (c && c.tone ? ' nx-cm-rc-cell--' + c.tone : ''); }

    /** The Current grid's columns (each row is a grid of its own): Equipment, the tier, a column per schedule. */
    gridStyle(n) {
      const k = Math.max(1, Number(n) || 1);
      return same('grid' + k, k, () => ({ gridTemplateColumns: 'minmax(200px, 1.6fr) 96px repeat(' + k + ', minmax(140px, 1fr))', minWidth: (330 + k * 150) + 'px' }));
    }

    /** What the comparison shows, in words, by how it compares. */
    boardNote(mode) {
      return mode === 'rental'
        ? 'What a rental of this length costs under each schedule, by the rate engine\'s rule: the highest threshold reached applies, then units × its Rate / day.'
        : 'Each tier\'s Rate / day, with its Period total and Threshold under it, as Old\'s rate grid has them. Green marks the cheapest, red the dearest.';
    }

    /** "Tier" or "Rental". */
    whatHead(mode) { return mode === 'rental' ? 'Rental' : 'Tier'; }

    /** How many rows are shown. */
    countText(view) {
      const v = view || {};
      const what = v.mode === 'rental' ? 'pieces of equipment' : 'rates';
      return (v.rows || []).length === v.total ? v.total + ' ' + what : (v.rows || []).length + ' of ' + v.total + ' ' + what;
    }

    // ── the Redwood look: Oracle's header, and the comparison as Oracle's table ──
    rwSub(view, isLoading) {
      if (isLoading) return 'Reading the rate schedules…';
      return (view && view.text) || 'Rate schedules side by side, by Threshold, Period total and Rate / day';
    }
    rwActions() {
      return same('actions', [
        { id: 'export', label: 'Export to Excel', icon: 'oj-ux-ico-download', display: 'on' },
        { id: 'refresh', label: 'Refresh', icon: 'oj-ux-ico-refresh', display: 'on' }], (x) => x);
    }
    /** Oracle's table's columns: Equipment, Tier (or Rental), a column per schedule (the base first). */
    rwColumns(view) {
      const cols = (view && view.cols) || [];
      const n = Math.max(1, cols.length);
      return same('columns', { mode: view && view.mode, cols: cols.map((c) => [c.id, c.name, c.base]) }, () => [
        { headerText: 'Equipment', field: 'title', template: 'rcEqTpl', weight: 22 },
        { headerText: view && view.mode === 'rental' ? 'Rental' : 'Tier', field: 'periodLabel', template: 'rcTierTpl', weight: 9 },
      ].concat(cols.map((c) => ({ headerText: c.name + (c.base ? ' · base' : ''), field: 's' + c.id, template: 'rcCellTpl', weight: Math.round(69 / n) }))));
    }
    rwADP(view) {
      const rows = ((view && view.rows) || []).map((r) => {
        const o = { key: r.key, title: r.title, sub: r.sub, method: r.method, periodLabel: r.periodLabel, differ: r.differ };
        Object.keys(r.cells || {}).forEach((id) => { o['s' + id] = r.cells[id]; });
        return o;
      });
      return same('rows', rows, (x) => new ArrayDataProvider(x, { keyAttributes: 'key' }));
    }
  }

  return PageModule;
});
