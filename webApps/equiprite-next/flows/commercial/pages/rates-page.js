define(['resources/js/rateRules', 'resources/js/exportKit', 'resources/js/fmt', 'resources/js/commercialRedwood', 'ojs/ojarraydataprovider'],
  (R, exportKit, fmt, RW, ArrayDataProvider) => {
  'use strict';

  // Rates: binding helpers. The rules are resources/js/rateRules.js (New EquipRite's, unchanged); the chains are
  // rates-page-chains. None uses `this`: a binding may call a function detached from the module.
  const NOUN_SHORT = { HOURLY: 'h', DAILY: 'day', WEEKLY: 'wk', MONTHLY: 'mo', QUARTERLY: 'qtr', YEARLY: 'yr' };

  function money(n, currency) {
    return n == null || n === '' || isNaN(Number(n)) ? '—' : fmt.money(n, currency || 'USD');
  }

  /** A per-day or per-hour rate to its 4 decimals (what the engine multiplies by); no cents when whole. */
  function rate(n, currency) {
    if (n == null || n === '' || isNaN(Number(n))) return '—';
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', minimumFractionDigits: Number(n) % 1 ? 2 : 0,
        maximumFractionDigits: 4 }).format(Number(n));
    } catch (e) {
      return R.rate4(n);
    }
  }

  function simLines(lines, groupKey) {
    return groupKey ? (lines || []).filter((l) => R.groupKey(l) === groupKey) : (lines || []);
  }

  /** "Rate / day", or "Rate / hour" on a line counted in logged hours: Old's Rate / Day column (COST_RATE). */
  function rateLabel(line) { return R.unitWord(line) === 'hours' ? 'Rate / hour' : 'Rate / day'; }

  // ── The Redwood look's schedule detail (as Old's Rate Management): the rates as Oracle's table, one row per equipment
  //    and a column per period, each tier as Old's grid reads it (Threshold, Period total, Rate / day); a row opens
  //    Oracle's drawer to change its rates. ──
  /** One rate line as the Redwood table and drawer show it. */
  function rwTier(line, ranges, currency) {
    const total = R.shownTotal(line);
    const inferred = line.periodAmount == null;
    return {
      key: R.lineKey(line), tier: (ranges || {})[R.lineKey(line)] || '',
      threshold: line.threshold == null ? '' : line.threshold, unit: R.unitWord(line),
      total: money(total, currency), totalValue: total == null ? '' : total, inferred,
      totalNote: inferred ? 'Worked out from the rate: no period total is stored' : '',
      rate: rate(line.costRate, currency), rateValue: line.costRate == null ? '' : line.costRate, rateLabel: rateLabel(line),
    };
  }

  /** The rows of the Redwood rates table: { key, title, sub, method, HOURLY…YEARLY: [tiers] }. */
  function rwRateRows(lines, currency) {
    return R.groupLines(lines || []).map((g) => {
      const ranges = R.tierRanges(g.lines);
      const row = { key: g.key, title: g.title, sub: (g.location || 'All locations') + ' · ' + g.rateTypeLabel, method: g.method };
      g.cells.forEach((c) => { row[c.period] = c.lines.map((l) => rwTier(l, ranges, currency)); });
      return row;
    });
  }

  // The same provider (or object) for the same content: the table redraws only when it changes.
  const kept = {};
  function same(key, content, make) {
    const json = JSON.stringify(content);
    if (!kept[key] || kept[key].json !== json) kept[key] = { json, value: make(content) };
    return kept[key].value;
  }

  class PageModule {
    formats() { return exportKit.FORMATS; }

    /** Redwood: the rates table's data (the rows the search keeps). */
    rwRateADP(lines, currency, cols) {
      const keep = RW.rateLineKeys(lines, cols);
      const rows = rwRateRows(lines, currency).filter((r) => keep.indexOf(r.key) !== -1);
      return same('rates', rows, (r) => new ArrayDataProvider(r, { keyAttributes: 'key' }));
    }

    /** Redwood: something is typed or picked in the rates' Smart Search. */
    rwFiltered(cols) { return !!cols && Object.keys(cols).some((k) => !!cols[k]); }

    /** Redwood: "38 pieces of equipment · 128 rates" over the table, or how many the search keeps. */
    rwCountText(lines, cols) {
      const keep = RW.rateLineKeys(lines, cols);
      const all = rwRateRows(lines, 'USD');
      const shown = all.filter((r) => keep.indexOf(r.key) !== -1);
      const rates = (lines || []).length;
      return this.rwFiltered(cols) ? shown.length + ' of ' + all.length + (all.length === 1 ? ' piece of equipment' : ' pieces of equipment')
        : all.length + (all.length === 1 ? ' piece of equipment' : ' pieces of equipment') + ' · ' + rates + (rates === 1 ? ' rate' : ' rates');
    }

    /** Redwood: the equipment open in the drawer, with each period's tiers worded for it. */
    rwEditGroup(lines, key, currency) {
      const g = key ? R.groupLines(lines || []).filter((x) => x.key === key)[0] : null;
      if (!g) return { title: '', sub: '', cells: [] };
      const ranges = R.tierRanges(g.lines);
      return {
        title: g.title, sub: (g.location || 'All locations') + ' · ' + g.rateTypeLabel + ' · ' + g.method,
        cells: g.cells.map((c) => ({ period: c.period, label: c.label, noun: R.periodNoun(c.period), groupKey: c.groupKey, allowed: c.allowed,
          tiers: c.lines.map((l) => rwTier(l, ranges, currency)) })),
      };
    }

    /** Redwood: the drawer is open while an equipment row is picked (and still there). */
    rwEditOpen(look, lines, key) {
      return look === 'redwood' && !!key && R.groupLines(lines || []).some((g) => g.key === key);
    }
    periods() { return R.PERIODS; }
    rateTypes() { return R.RATE_TYPES; }
    currencies() { return R.CURRENCIES; }

    // ── the list ──
    tagText(s) { return R.tagText(s); }
    windowText(s) { return R.windowText(s); }
    endText(s) { return R.endText(s); }
    isActive(s) { return !!s && s.status === 'ACTIVE'; }
    /** The list row of the open schedule (its yard's PPM marker), or {}. */
    rowOf(rows, id) { return (rows || []).filter((r) => String(r.id) === String(id))[0] || {}; }

    // ── the open schedule ──
    taggedTo(f) { return R.taggedTo(f); }
    /** Who prices from it, in words. */
    usedByNote(f) {
      const d = f || {};
      const tagged = d.customerId != null || d.projectId != null || d.taskId != null || d.yardOrgId != null;
      return tagged ? 'Requests that match these tags take their rates from this schedule, unless an agreement line or a more specific schedule wins.'
        : 'No tags: requests that match no tagged schedule take their rates from here.';
    }
    formWindow(f) { return R.windowText(f || {}); }
    saveText(lines, isNew) { return R.saveText(lines, isNew); }
    taskMatches(tasks, text) { return R.taskMatches(tasks, text); }

    // ── the grid ──
    groupLines(lines) { return R.groupLines(lines); }
    tierRanges(lines) { return R.tierRanges(lines); }
    /** Where a tier applies: "5–29 days". */
    tierOf(ranges, line) { return (ranges || {})[R.lineKey(line)] || ''; }
    lineKey(line) { return R.lineKey(line); }
    shownTotal(line) { return R.shownTotal(line); }
    isInferred(line) { return !!line && line.periodAmount == null; }
    unitWord(line) { return R.unitWord(line); }
    /** "Rate / day" or "Rate / hour": Old's Rate / Day column, the rate the engine bills. */
    rateLabel(line) { return rateLabel(line); }
    /** "$557.1429": a rate to its 4 decimals, as Old's grid shows it. */
    rate(n, currency) { return rate(n, currency); }
    periodShort(p) { return NOUN_SHORT[p] || ''; }
    periodNoun(p) { return R.periodNoun(p); }
    money(n, currency) { return money(n, currency); }

    // ── Try a rate ──
    /** The rows Try a rate can price: each Usage row of the grid. */
    simGroups(lines) {
      return R.groupLines((lines || []).filter((l) => (l.rateType || 'USAGE') === 'USAGE'))
        .map((g) => ({ key: g.key, label: g.title + (g.location ? ' · ' + g.location : '') }));
    }
    simValue(sim, key) { return sim && sim[key] != null ? sim[key] : ''; }
    /** The inputs the chosen row (or every row) needs: days on rent, days worked, logged hours. */
    simInputs(lines, groupKey) { return R.simInputs(simLines(lines, groupKey)); }
    simulate(lines, sim, groupKey) { return R.simulate(simLines(lines, groupKey), sim); }
    /** "17 days on rent reach the Weekly tier (from 5 days)". */
    simReach(r) {
      if (!r || r.cost == null) return r ? r.text : '';
      return r.units + ' ' + r.unitWord + ' reach the ' + r.periodLabel + ' tier (from ' + r.threshold + (r.unitShort === 'h' ? ' h)' : (r.threshold === 1 ? ' day)' : ' days)'));
    }
    /** "17 × $557.1429 a day = $9,471.43 · 2.43 weeks at $3,900 a week". */
    simMath(r, currency) {
      if (!r || r.cost == null) return '';
      const per = r.unitShort === 'h' ? ' an hour' : ' a day';
      let t = (r.qty > 1 ? r.qty + ' × ' : '') + r.units + ' × ' + rate(r.rate, currency) + per + ' = ' + money(r.cost, currency);
      if (r.periods != null && r.periodTotal != null) {
        t += ' · ' + r.periods + ' ' + R.periodNoun(r.period) + (r.periods === 1 ? '' : 's') + ' at ' + money(r.periodTotal, currency) + ' a ' + R.periodNoun(r.period);
      }
      return t;
    }

    // ── the Redwood look (your menu, Look): the list as Oracle's Smart Search page, the open schedule as its record
    //    under Oracle's general overview header (rwView; rwChain), over this screen's own detail body ──
    /** Under Redwood the open schedule's body shows with its record only, not under the list of schedules. */
    rwListShown(look, view) { return look === 'redwood' && view !== 'record'; }
    /** The header's title: the schedule's name (the list's while it loads), or New schedule. */
    rwTitle(f, id, loading, rows) {
      if (id === 'new') return (f && f.scheduleName) || 'New schedule';
      const row = (rows || []).filter((r) => String(r.id) === String(id))[0];
      if (loading) return (row && row.scheduleName) || 'Loading the schedule…';
      return (f && f.scheduleName) || (row && row.scheduleName) || 'Rate schedule';
    }
    /** The kicker (Rate schedule) and what it is: who uses it, when, its currency. */
    rwSubtitle(f, id) {
      const d = f || {};
      if (id === 'new') return 'Rate schedule · not saved yet: fill in its details and rates, then Save';
      const tagged = d.customerId != null || d.projectId != null || d.taskId != null || d.yardOrgId != null;
      return ['Rate schedule', tagged ? 'Used by ' + R.taggedTo(d) : 'The fallback schedule (no tags)', R.windowText(d), d.currency]
        .filter((x) => !!x).join(' · ');
    }
    /** Its status as the header's badge (Active, Inactive). */
    rwBadge(f, id) { return id ? RW.rateBadge(f) : { text: '' }; }
    /** Save schedule: the white button on the header's band (FULL access), as Current's save bar. */
    rwPrimary(canWrite, saving) {
      if (!canWrite) return same('primary', { label: 'Save schedule', display: 'off' }, (x) => x);
      return same('primary', { label: 'Save schedule', icon: 'oj-ux-ico-save', display: saving ? 'disabled' : 'on' }, (x) => x);
    }
    /** The header's other actions, as Current's buttons on the schedule (rwChain routes each id to that button's chain). */
    rwActions(canWrite, id, headerOpen, dirty, lineCount) {
      const out = [];
      if (canWrite) {
        out.push({ id: 'details', label: headerOpen ? 'Done with the details' : 'Edit details', icon: 'oj-ux-ico-edit', display: 'on' });
        out.push({ id: 'add', label: 'Add equipment', icon: 'oj-ux-ico-plus', display: 'on' });
      }
      if (lineCount > 0) out.push({ id: 'export', label: 'Export the rates', icon: 'oj-ux-ico-download', display: 'on' });
      if (canWrite && dirty) out.push({ id: 'discard', label: 'Discard changes', icon: 'oj-ux-ico-undo', display: 'on' });
      if (canWrite && id && id !== 'new') out.push({ id: 'delete', label: 'Delete', icon: 'oj-ux-ico-trash', display: 'on' });
      out.push({ id: 'refresh', label: 'Refresh', icon: 'oj-ux-ico-refresh', display: 'on' });
      return same('actions', out, (x) => x);
    }
  }

  return PageModule;
});
