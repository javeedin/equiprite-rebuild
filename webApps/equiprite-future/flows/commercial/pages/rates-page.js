define(['resources/js/rateRules', 'resources/js/exportKit', 'resources/js/fmt'], (R, exportKit, fmt) => {
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

  class PageModule {
    formats() { return exportKit.FORMATS; }
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
    margin(line) { return R.margin(line); }
    marginIssues(lines) { return R.marginIssues(lines); }
    unitWord(line) { return R.unitWord(line); }
    /** "$557.1429 a day" / "$120 an hour": the rate the engine bills. */
    rateText(line, currency) { return rate(line && line.costRate, currency) + (R.unitWord(line) === 'hours' ? ' an hour' : ' a day'); }
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
  }

  return PageModule;
});
