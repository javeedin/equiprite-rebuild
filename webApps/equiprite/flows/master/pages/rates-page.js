define([], () => {
  'use strict';

  // Rate schedules (wireframe: Rate schedules; FDD 7.3). The list of schedules on the left, the chosen schedule on
  // the right: its header, its rate lines as one grid of the six periods, the margin check and a simulator.
  // Replaces rate-schedule (the list) and create-rate-schedule (the editor) of Old EquipRite.
  //
  // The rate rules are the old editor's (vbredwoodapp/flows/main/pages/create-rate-schedule-page.js), copied with
  // their logic unchanged: DAYS_PER_PERIOD, isHourlyBasis, isPeriodAllowed, coercePeriod, periodUnits, deriveRate,
  // derivePeriodAmount and the edit arithmetic of its handleEditEnd (here applyLineEdit). In short, as that file
  // explains at length:
  //   - the cost engine bills qty × units × COST_RATE (the "rate per day", or per hour on an hourly-basis line);
  //     PERIOD_TYPE is a label for what one period holds: a week is 7 days, a month 30, a quarter 90, a year 365;
  //   - the period total is what people type; the per-unit rate is derived from it (4 dp), and typing the rate
  //     restates the total (2 dp);
  //   - FROM_UNIT (threshold) is only the tier gate: the line whose threshold the duration reaches applies, the
  //     highest one reached winning ("above the last threshold the longest period applies");
  //   - units: UTILIZED_DURATION + HOURLY sums logged hours, UTILIZED_DURATION + DAILY counts worked days (any
  //     hours on a day count as one day), COMPLETE_PERIOD counts calendar days and ignores the basis; an
  //     hours-billed line can only carry HOURLY, a complete-period line never HOURLY.
  // The simulator applies exactly those rules; only USAGE lines are priced by the engine today.

  var DAYS_PER_PERIOD = {
    HOURLY: 1,      // an hourly line's unit IS the hour
    DAILY: 1,
    WEEKLY: 7,
    MONTHLY: 30,
    QUARTERLY: 90,
    YEARLY: 365
  };

  var PERIOD_NOUN = {
    HOURLY: 'hour', DAILY: 'day', WEEKLY: 'week',
    MONTHLY: 'month', QUARTERLY: 'quarter', YEARLY: 'year'
  };

  var isHourlyBasis = function (calcMethod, calcBasis) {
    return (calcMethod || '').toString().toUpperCase() === 'UTILIZED_DURATION' &&
           (calcBasis  || '').toString().toUpperCase() === 'HOURLY';
  };

  var isPeriodAllowed = function (periodType, calcMethod, calcBasis) {
    var p = (periodType || '').toString().trim().toUpperCase();
    if (!p) return true;                                  // nothing chosen yet
    if (isHourlyBasis(calcMethod, calcBasis)) return p === 'HOURLY';
    if ((calcMethod || '').toString().toUpperCase() === 'COMPLETE_PERIOD') return p !== 'HOURLY';
    return true;
  };

  var coercePeriod = function (periodType, calcMethod, calcBasis) {
    if (isPeriodAllowed(periodType, calcMethod, calcBasis)) return periodType;
    return isHourlyBasis(calcMethod, calcBasis) ? 'HOURLY' : 'DAILY';
  };

  var toNum = function (v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isNaN(n) ? null : n;
  };

  var round4 = function (n) {
    return Math.round((n + Number.EPSILON) * 10000) / 10000;
  };

  var periodUnits = function (periodType) {
    var key = (periodType || '').toString().trim().toUpperCase();
    return DAYS_PER_PERIOD[key] || 1;
  };

  var deriveRate = function (periodAmount, periodType) {
    var amt = toNum(periodAmount);
    if (amt === null) return null;
    return round4(amt / periodUnits(periodType));
  };

  var round2 = function (n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  };

  var derivePeriodAmount = function (costRate, periodType) {
    var rate = toNum(costRate);
    if (rate === null) return null;
    return round2(rate * periodUnits(periodType));
  };

  // CK_EQR_RATE_PL_RTYPE / CK_EQR_RATE_PL_PTYPE / CK_RPL_CALC_METHOD (the old grid's DROPDOWN_OPTIONS).
  var RATE_TYPES = [
    { value: 'USAGE', label: 'Usage' }, { value: 'MOBILIZATION', label: 'Mobilization' },
    { value: 'RETURN', label: 'Return' }, { value: 'STANDBY', label: 'Standby' },
    { value: 'BLACKOUT', label: 'Blackout / maintenance' },
  ];
  var PERIODS = [
    { value: 'HOURLY', label: 'Hourly' }, { value: 'DAILY', label: 'Daily' }, { value: 'WEEKLY', label: 'Weekly' },
    { value: 'MONTHLY', label: 'Monthly' }, { value: 'QUARTERLY', label: 'Quarterly' }, { value: 'YEARLY', label: 'Yearly' },
  ];
  var METHODS = [
    { value: 'COMPLETE_PERIOD', label: 'Complete period' }, { value: 'UTILIZED_DURATION', label: 'Utilized duration' },
  ];
  var CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD'];
  var PERIOD_BASIS = { HOURLY: 'HOURLY', DAILY: 'DAILY', WEEKLY: 'WEEKLY', MONTHLY: 'MONTHLY' };
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var txt = function (v) { return v == null ? '' : String(v); };
  var label = function (list, v) { var o = list.find(function (x) { return x.value === v; }); return o ? o.label : txt(v); };

  // The old vbEnterChain's display order: class, then subclass, then equipment, blanks first.
  var compareLineText = function (a, b) {
    var left  = (a == null ? '' : String(a)).trim();
    var right = (b == null ? '' : String(b)).trim();
    if (left === right) return 0;
    if (left === '') return -1;
    if (right === '') return 1;
    return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
  };

  function money(n, dp) {
    if (n == null || n === '' || isNaN(Number(n))) return '—';
    var v = Number(n);
    var d = dp != null ? dp : (Math.abs(v % 1) > 0 ? 2 : 0);
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: Math.max(d, 2) });
  }

  class PageModule {
    // ── old editor (create-rate-schedule-page.js), unchanged ──────────────────

    periodUnits(periodType) { return periodUnits(periodType); }

    periodNoun(periodType) {
      return PERIOD_NOUN[(periodType || '').toString().trim().toUpperCase()] || 'period';
    }

    isHourlyBasis(calcMethod, calcBasis) { return isHourlyBasis(calcMethod, calcBasis); }

    isPeriodAllowed(periodType, calcMethod, calcBasis) { return isPeriodAllowed(periodType, calcMethod, calcBasis); }

    coercePeriod(periodType, calcMethod, calcBasis) { return coercePeriod(periodType, calcMethod, calcBasis); }

    deriveRate(periodAmount, periodType) { return deriveRate(periodAmount, periodType); }

    derivePeriodAmount(costRate, periodType) { return derivePeriodAmount(costRate, periodType); }

    /** The old chains' Class -> Subclass -> Equipment ordering of equipmentLines. */
    sortLines(lines) {
      return (lines || []).slice().sort(function (a, b) {
        return compareLineText(a.className, b.className)
          || compareLineText(a.subclassName, b.subclassName)
          || compareLineText(a.equipmentName, b.equipmentName);
      });
    }

    /**
     * One edit of one line, with the old grid's rules (handleEditEnd): returns { ok, line } with a NEW line, or
     * { ok: false } when the value is refused (the cell keeps its old value).
     *   threshold        a whole number ≥ 0 (FROM_UNIT is an integer duration)
     *   periodAmount     ≥ 0 sets the total and derives the rate; blank means "nobody authored a total" and the
     *                    grid shows the figure the rate implies
     *   costRate         ≥ 0 (4 dp) restates the total
     *   billRate         ≥ 0 (4 dp); not part of the cost arithmetic
     *   period           must be allowed for the line's method and basis; the rate is held and the total restated
     *   calcMethod, calcBasis   may strand the period: coerced, and the total restated (old drawer + grid rule)
     *   rateType, location, startDate, endDate   as given
     */
    applyLineEdit(line, key, value) {
      var l = Object.assign({}, line || {});
      var blank = value === '' || value === null || value === undefined;
      if (key === 'rateType') {
        if (!RATE_TYPES.some(function (o) { return o.value === value; })) return { ok: false };
        l.rateType = value;
        return { ok: true, line: l };
      }
      if (key === 'location' || key === 'startDate' || key === 'endDate') {
        l[key] = blank ? '' : String(value);
        return { ok: true, line: l };
      }
      if (key === 'period') {
        if (!PERIODS.some(function (o) { return o.value === value; })) return { ok: false };
        if (!isPeriodAllowed(value, l.calcMethod, l.calcBasis)) return { ok: false };
        l.period = value;
        if (l.periodAmount != null) l.periodAmount = derivePeriodAmount(l.costRate, value);
        return { ok: true, line: l };
      }
      if (key === 'calcMethod' || key === 'calcBasis') {
        if (key === 'calcMethod' && !METHODS.some(function (o) { return o.value === value; })) return { ok: false };
        if (key === 'calcBasis' && ['HOURLY', 'DAILY'].indexOf(value) === -1) return { ok: false };
        l[key] = value;
        var fixed = coercePeriod(l.period, l.calcMethod, l.calcBasis);
        if (fixed !== l.period) {
          l.period = fixed;
          if (l.periodAmount != null) l.periodAmount = derivePeriodAmount(l.costRate, fixed);
        }
        return { ok: true, line: l };
      }
      if (key === 'periodAmount' && blank) {
        l.periodAmount = null;
        return { ok: true, line: l };
      }
      var n = toNum(value);
      if (n === null || n < 0) return { ok: false };
      if (key === 'threshold') {
        l.threshold = Math.floor(n);
      } else if (key === 'periodAmount') {
        l.periodAmount = round4(n);
        l.costRate = deriveRate(l.periodAmount, l.period);
      } else if (key === 'costRate') {
        l.costRate = round4(n);
        l.periodAmount = derivePeriodAmount(l.costRate, l.period);
      } else if (key === 'billRate') {
        l.billRate = round4(n);
      } else {
        return { ok: false };
      }
      return { ok: true, line: l };
    }

    // ── the list ───────────────────────────────────────────────────────────

    /** What a schedule is tagged to, as short phrases; [] for an untagged (fallback) schedule. */
    tagsOf(s) {
      var out = [];
      if (s && s.customer && s.customer !== '—') out.push('Customer ' + s.customer);
      if (s && s.project && s.project !== '—') out.push('Project ' + s.project + (s.task && s.task !== '—' ? ' · ' + s.task : ''));
      if (s && s.yard && s.yard !== '—') out.push('Yard ' + s.yard);
      return out;
    }

    /** The open schedule's tags from its header (formData). */
    taggedTo(f) {
      var d = f || {};
      var parts = [d.customerName || (d.customerId != null ? 'Customer ' + d.customerId : ''), d.projectName || (d.projectId != null ? 'Project ' + d.projectId : ''),
        d.taskName, d.yardOrgName || (d.yardOrgId != null ? 'Yard ' + d.yardOrgId : '')].filter(function (x) { return x; });
      return parts.length ? parts.join(' · ') : 'Nothing: the fallback schedule';
    }

    tagText(s) {
      var t = this.tagsOf(s);
      return t.length ? t.join(' · ') : 'No tags: the fallback rates';
    }

    /** Days until the schedule ends (null without an end date). */
    daysLeft(endDate, today) {
      var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(txt(endDate));
      if (!m) return null;
      var t = today ? new Date(today + 'T00:00:00Z') : new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
      return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - t.getTime()) / 86400000);
    }

    isExpiring(s, today) {
      var d = this.daysLeft(s && s.endDate, today);
      return !!s && s.status === 'ACTIVE' && d !== null && d >= 0 && d <= 30;
    }

    /** Chips: All, Active, Inactive, Expiring (active, ending within 30 days), Tagged, Untagged, with counts. */
    listChips(rows, today) {
      var list = Array.isArray(rows) ? rows : [];
      var self = this;
      var count = function (f) { return list.filter(f).length; };
      return [
        { key: 'all', label: 'All', count: list.length },
        { key: 'ACTIVE', label: 'Active', count: count(function (r) { return r.status === 'ACTIVE'; }) },
        { key: 'INACTIVE', label: 'Inactive', count: count(function (r) { return r.status !== 'ACTIVE'; }) },
        { key: 'expiring', label: 'Expiring', count: count(function (r) { return self.isExpiring(r, today); }) },
        { key: 'tagged', label: 'Tagged', count: count(function (r) { return self.tagsOf(r).length > 0; }) },
        { key: 'untagged', label: 'No tags', count: count(function (r) { return self.tagsOf(r).length === 0; }) },
      ];
    }

    /**
     * The schedules shown: the chip, then the old RateScheduleFilterChain's keyword rule (any typed word in the
     * name, description, class or yard), widened to customer and project.
     */
    filterSchedules(rows, text, chip, today) {
      var self = this;
      var words = txt(text).toLowerCase().split(/\s+/).filter(function (w) { return w; });
      return (Array.isArray(rows) ? rows : []).filter(function (r) {
        if (chip === 'ACTIVE' && r.status !== 'ACTIVE') return false;
        if (chip === 'INACTIVE' && r.status === 'ACTIVE') return false;
        if (chip === 'expiring' && !self.isExpiring(r, today)) return false;
        if (chip === 'tagged' && !self.tagsOf(r).length) return false;
        if (chip === 'untagged' && self.tagsOf(r).length) return false;
        if (!words.length) return true;
        return words.some(function (word) {
          return [r.scheduleName, r.description, r.equipmentClass, r.yard, r.customer, r.project]
            .some(function (v) { return v && String(v).toLowerCase().indexOf(word) !== -1; });
        });
      });
    }

    // ── the grid ───────────────────────────────────────────────────────────

    periods() { return PERIODS; }
    rateTypes() { return RATE_TYPES; }
    methods() { return METHODS; }
    currencies() { return CURRENCIES; }

    lineKey(line) {
      return line && line.id != null ? 'id:' + line.id : txt(line && line._key);
    }

    groupKey(line) {
      var l = line || {};
      return [l.classId || '', l.subclassId || '', l.equipmentName || '', l.location || '', l.rateType || 'USAGE'].join('|');
    }

    /** The period total shown: the authored one, else what the rate implies (shown muted). */
    shownTotal(line) {
      if (!line) return null;
      return line.periodAmount != null ? line.periodAmount : derivePeriodAmount(line.costRate, line.period);
    }

    /**
     * Margin of one line: cost is the period total, bill the line's bill rate per period (saved as rateAmount with
     * the period's UOM). { state: ok | low | none, text }. A bill rate below cost is flagged before anything else.
     */
    margin(line) {
      var bill = toNum(line && line.billRate);
      var cost = this.shownTotal(line);
      if (bill === null || bill === 0) return { state: 'none', text: 'No bill rate' };
      if (cost === null || cost === 0) return { state: 'ok', text: 'No cost' };
      var pct = Math.round(((bill - cost) / bill) * 1000) / 10;
      return { state: bill < cost ? 'low' : 'ok', text: (pct > 0 ? '+' : '') + pct + '%' };
    }

    /** Lines whose bill rate is below cost, worded for the margin check. */
    marginIssues(lines) {
      var self = this;
      return (Array.isArray(lines) ? lines : []).filter(function (l) { return self.margin(l).state === 'low'; })
        .map(function (l) {
          return { key: self.lineKey(l), text: self.groupTitle(l) + (l.location ? ' · ' + l.location : '') + ' · '
            + label(PERIODS, l.period) + ': bill ' + money(l.billRate) + ' is below cost ' + money(self.shownTotal(l)) + '.' };
        });
    }

    groupTitle(line) {
      var l = line || {};
      return [l.className, l.subclassName, l.equipmentName].filter(function (x) { return x; }).join(' · ') || 'Any equipment';
    }

    /** "days" or "hours": what this line's threshold and rate count. */
    unitWord(line) {
      return isHourlyBasis(line && line.calcMethod, line && line.calcBasis) ? 'hours' : 'days';
    }

    methodText(line) {
      var l = line || {};
      if (l.calcMethod === 'COMPLETE_PERIOD') return 'Complete period · calendar days';
      return 'Utilized · ' + (isHourlyBasis(l.calcMethod, l.calcBasis) ? 'logged hours' : 'worked days');
    }

    /**
     * The grid: one row per group (class, subclass, equipment, location, rate type), one cell per period, each cell
     * holding that period's lines (usually one; hourly tiers can stack), lowest threshold first. An empty cell is
     * "allowed" when the group's method and basis can carry that period (the old drawer's gating).
     */
    groupLines(lines) {
      var self = this;
      var groups = [];
      var byKey = {};
      this.sortLines(lines || []).forEach(function (l) {
        var k = self.groupKey(l);
        if (!byKey[k]) {
          byKey[k] = { key: k, title: self.groupTitle(l), location: l.location || '', rateType: l.rateType || 'USAGE',
            rateTypeLabel: label(RATE_TYPES, l.rateType || 'USAGE'), first: l, lines: [] };
          groups.push(byKey[k]);
        }
        byKey[k].lines.push(l);
      });
      return groups.map(function (g) {
        return Object.assign(g, {
          method: self.methodText(g.first),
          unit: self.unitWord(g.first),
          cells: PERIODS.map(function (p) {
            var ls = g.lines.filter(function (l) { return l.period === p.value; })
              .sort(function (a, b) { return (Number(a.threshold) || 0) - (Number(b.threshold) || 0); });
            return { period: p.value, label: p.label, lines: ls, groupKey: g.key,
              allowed: isPeriodAllowed(p.value, g.first.calcMethod, g.first.calcBasis) };
          }),
        });
      });
    }

    /**
     * A new line for a group and period, with the old addScheduleLineChain's defaults: method UTILIZED_DURATION,
     * basis DAILY (a COMPLETE_PERIOD line takes the basis of its period), rate type USAGE, period coerced to one
     * the method and basis can carry, no total, rate 0. Its threshold starts at 0 for a group's first line and at
     * one period's length after that, so a new weekly tier does not tie the base tier.
     */
    newLine(template, period, existingCount, key) {
      var t = template || {};
      var calcMethod = t.calcMethod || 'UTILIZED_DURATION';
      var p = coercePeriod(period || 'DAILY', calcMethod, t.calcBasis);
      var calcBasis = calcMethod === 'COMPLETE_PERIOD' ? (PERIOD_BASIS[p] || 'DAILY') : (t.calcBasis || 'DAILY');
      return {
        _key: key,
        classId: t.classId || null, subclassId: t.subclassId || null,
        className: t.className || '', subclassName: t.subclassName || '', equipmentName: t.equipmentName || '',
        calcBasis: calcBasis, calcMethod: calcMethod, rateType: t.rateType || 'USAGE', period: p,
        threshold: existingCount ? (p === 'HOURLY' ? 8 : periodUnits(p)) : 0,
        periodAmount: null, periodDivisor: null, costRate: 0, billRate: 0,
        location: t.location || '', startDate: '', endDate: '',
      };
    }

    /**
     * The simulator: what this schedule's USAGE lines would cost for a duration, by the engine's rules (see the
     * top of this file). Each line counts its own unit: logged hours (utilized, hourly basis), worked days
     * (utilized, daily basis) or days on rent (complete period). The applicable line is the one with the highest
     * threshold the duration reaches; cost = ROUND(qty × units × rate, 2).
     *
     * @param {Array} lines
     * @param {{hours:number, daysWorked:number, daysOnRent:number, qty:number}} input
     * @returns {{ rows: Array, total: number }}
     */
    simulate(lines, input) {
      var self = this;
      var inp = input || {};
      var qty = Math.max(1, Number(inp.qty) || 1);
      var unitsFor = function (l) {
        if (l.calcMethod === 'COMPLETE_PERIOD') return { n: Math.max(0, Number(inp.daysOnRent) || 0), word: 'days on rent', short: 'day' };
        if (isHourlyBasis(l.calcMethod, l.calcBasis)) return { n: Math.max(0, Number(inp.hours) || 0), word: 'logged hours', short: 'h' };
        return { n: Math.max(0, Number(inp.daysWorked) || 0), word: 'days worked', short: 'day' };
      };
      var usage = (Array.isArray(lines) ? lines : []).filter(function (l) { return (l.rateType || 'USAGE') === 'USAGE'; });
      var rows = this.groupLines(usage).map(function (g) {
        var best = null;
        g.lines.forEach(function (l) {
          var u = unitsFor(l);
          if (u.n <= 0 || (Number(l.threshold) || 0) > u.n) return;
          if (!best || (Number(l.threshold) || 0) > (Number(best.line.threshold) || 0)
              || ((Number(l.threshold) || 0) === (Number(best.line.threshold) || 0) && periodUnits(l.period) > periodUnits(best.line.period))) {
            best = { line: l, units: u };
          }
        });
        if (!best) {
          return { key: g.key, title: g.title, location: g.location, cost: null,
            text: 'No line applies: every threshold is above the duration.' };
        }
        var l = best.line;
        var u = best.units;
        var rate = Number(l.costRate) || 0;
        var cost = round2(qty * u.n * rate);
        var per = periodUnits(l.period);
        var periods = Math.round((u.n / per) * 100) / 100;
        var total = self.shownTotal(l);
        var text = u.n + ' ' + u.word + ' reach the ' + label(PERIODS, l.period) + ' tier (from ' + (Number(l.threshold) || 0) + ' '
          + (u.short === 'h' ? 'h' : 'days') + ') → ' + (qty > 1 ? qty + ' × ' : '') + u.n + ' × ' + self.rate4(rate) + '/' + u.short
          + ' = ' + money(cost, 2);
        if (per > 1 && total != null) text += ' (' + periods + ' ' + self.periodNoun(l.period) + (periods === 1 ? '' : 's') + ' at ' + money(total) + ')';
        var bill = toNum(l.billRate);
        return { key: g.key, title: g.title, location: g.location, cost: cost, text: text,
          bill: bill ? round2(qty * (u.n / per) * bill) : null };
      });
      var sum = rows.reduce(function (s, r) { return s + (r.cost || 0); }, 0);
      return { rows: rows, total: round2(sum) };
    }

    // ── small formatters ───────────────────────────────────────────────────

    money(n, dp) { return money(n, dp); }

    rate4(n) {
      if (n == null || n === '' || isNaN(Number(n))) return '—';
      return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    }

    day(v) {
      var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(txt(v));
      return m ? Number(m[3]) + ' ' + MON[Number(m[2]) - 1] + ' ' + m[1] : '';
    }

    window(s) {
      if (!s) return '';
      var a = this.day(s.startDate);
      var b = this.day(s.endDate);
      return a && b ? a + ' – ' + b : (a ? 'From ' + a : (b ? 'To ' + b : 'No dates'));
    }

    periodLabel(p) { return label(PERIODS, p); }
    rateTypeLabel(t) { return label(RATE_TYPES, t); }

    /** What Save writes, before the click. */
    saveText(lines, isNew) {
      var n = (Array.isArray(lines) ? lines : []).length;
      return (isNew ? 'Creates the schedule' : 'Writes the header') + ' and ' + (n === 1 ? 'its line' : 'all ' + n + ' lines')
        + ', one after another, as Old EquipRite does.';
    }

    /** Tasks matching the filter text (number or name), at most 30. */
    taskMatches(tasks, text) {
      var q = txt(text).trim().toLowerCase();
      return (Array.isArray(tasks) ? tasks : [])
        .filter(function (t) { return !q || [t.TaskNumber, t.TaskName].some(function (v) { return v && String(v).toLowerCase().indexOf(q) !== -1; }); })
        .slice(0, 30);
    }
  }

  return PageModule;
});
