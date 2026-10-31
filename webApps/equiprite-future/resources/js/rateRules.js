define(['resources/js/rules', 'resources/js/fmt'], function (rules, fmt) {
  'use strict';

  // Rates (Commercial): the rate-schedule rules, pure. The rules are New EquipRite's (webApps/equiprite/flows/master/
  // pages/rates-page.js, itself the old editor's create-rate-schedule-page.js), copied with their logic unchanged:
  // DAYS_PER_PERIOD, isHourlyBasis, isPeriodAllowed, coercePeriod, periodUnits, deriveRate, derivePeriodAmount,
  // applyLineEdit (the old grid's handleEditEnd), groupLines, newLine, margin and simulate. In short:
  //   - the cost engine bills qty × units × COST_RATE (the "rate per day", or per hour on an hourly-basis line);
  //     PERIOD_TYPE is a label for what one period holds: a week is 7 days, a month 30, a quarter 90, a year 365;
  //   - the period total is what people type; the per-unit rate is derived from it (4 dp), and typing the rate
  //     restates the total (2 dp);
  //   - FROM_UNIT (threshold) is only the tier gate: the line whose threshold the duration reaches applies, the
  //     highest one reached winning ("above the last threshold the longest period applies");
  //   - units: UTILIZED_DURATION + HOURLY sums logged hours, UTILIZED_DURATION + DAILY counts worked days (any hours
  //     on a day count as one day), COMPLETE_PERIOD counts calendar days and ignores the basis; an hours-billed line
  //     can only carry HOURLY, a complete-period line never HOURLY.
  // Only USAGE lines are priced by the engine today.
  //
  // Also here, lifted out of New's chains so they are tested: the list row (loadSchedulesChain), the open schedule
  // (selectScheduleChain), and the bodies Save writes (saveScheduleChain), each unchanged. Next's own: the words a
  // tier is read in (tierText), the summary, and what the two lists export.

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
    { value: 'BLACKOUT', label: 'Blackout / maintenance' }
  ];
  var PERIODS = [
    { value: 'HOURLY', label: 'Hourly' }, { value: 'DAILY', label: 'Daily' }, { value: 'WEEKLY', label: 'Weekly' },
    { value: 'MONTHLY', label: 'Monthly' }, { value: 'QUARTERLY', label: 'Quarterly' }, { value: 'YEARLY', label: 'Yearly' }
  ];
  var METHODS = [
    { value: 'COMPLETE_PERIOD', label: 'Complete period' }, { value: 'UTILIZED_DURATION', label: 'Utilized duration' }
  ];
  var CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD'];
  var PERIOD_BASIS = { HOURLY: 'HOURLY', DAILY: 'DAILY', WEEKLY: 'WEEKLY', MONTHLY: 'MONTHLY' };
  var EXPIRING_DAYS = 30;

  var txt = function (v) { return v == null ? '' : String(v); };
  var label = function (list, v) { var o = list.filter(function (x) { return x.value === v; })[0]; return o ? o.label : txt(v); };

  // The old vbEnterChain's display order: class, then subclass, then equipment, blanks first.
  var compareLineText = function (a, b) {
    var left  = (a == null ? '' : String(a)).trim();
    var right = (b == null ? '' : String(b)).trim();
    if (left === right) return 0;
    if (left === '') return -1;
    if (right === '') return 1;
    return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
  };

  // New's own money: '$' and no cents when whole (the simulator's text is New's, word for word).
  function money(n, dp) {
    if (n == null || n === '' || isNaN(Number(n))) return '—';
    var v = Number(n);
    var d = dp != null ? dp : (Math.abs(v % 1) > 0 ? 2 : 0);
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: Math.max(d, 2) });
  }

  function rate4(n) {
    if (n == null || n === '' || isNaN(Number(n))) return '—';
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }

  function periodNoun(periodType) {
    return PERIOD_NOUN[(periodType || '').toString().trim().toUpperCase()] || 'period';
  }

  /** The old chains' Class -> Subclass -> Equipment ordering of equipmentLines. */
  function sortLines(lines) {
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
  function applyLineEdit(line, key, value) {
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

  // ── the list ─────────────────────────────────────────────────────────────────────────────────────────────

  /** What a schedule is tagged to, as short phrases; [] for an untagged (fallback) schedule. */
  function tagsOf(s) {
    var out = [];
    if (s && s.customer && s.customer !== '—') out.push('Customer ' + s.customer);
    if (s && s.project && s.project !== '—') out.push('Project ' + s.project + (s.task && s.task !== '—' ? ' · ' + s.task : ''));
    if (s && s.yard && s.yard !== '—') out.push('Yard ' + s.yard);
    return out;
  }

  /** The open schedule's tags from its header (formData). */
  function taggedTo(f) {
    var d = f || {};
    var parts = [d.customerName || (d.customerId != null ? 'Customer ' + d.customerId : ''), d.projectName || (d.projectId != null ? 'Project ' + d.projectId : ''),
      d.taskName, d.yardOrgName || (d.yardOrgId != null ? 'Yard ' + d.yardOrgId : '')].filter(function (x) { return x; });
    return parts.length ? parts.join(' · ') : 'Nothing: the fallback schedule';
  }

  function tagText(s) {
    var t = tagsOf(s);
    return t.length ? t.join(' · ') : 'No tags: the fallback rates';
  }

  /** Days until the schedule ends (null without an end date). */
  function daysLeft(endDate, today) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(txt(endDate));
    if (!m) return null;
    var t = today ? new Date(today + 'T00:00:00Z') : new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
    return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - t.getTime()) / 86400000);
  }

  function isExpiring(s, today) {
    var d = daysLeft(s && s.endDate, today);
    return !!s && s.status === 'ACTIVE' && d !== null && d >= 0 && d <= EXPIRING_DAYS;
  }

  /** Chips: All, Active, Ending soon (active, ending within 30 days), Inactive, Tagged, No tags, with counts. */
  function listChips(rows, today) {
    var list = Array.isArray(rows) ? rows : [];
    var count = function (f) { return list.filter(f).length; };
    return [
      { key: 'all', label: 'All', count: list.length },
      { key: 'ACTIVE', label: 'Active', count: count(function (r) { return r.status === 'ACTIVE'; }) },
      { key: 'expiring', label: 'Ending soon', count: count(function (r) { return isExpiring(r, today); }) },
      { key: 'INACTIVE', label: 'Inactive', count: count(function (r) { return r.status !== 'ACTIVE'; }) },
      { key: 'tagged', label: 'Tagged', count: count(function (r) { return tagsOf(r).length > 0; }) },
      { key: 'untagged', label: 'No tags', count: count(function (r) { return tagsOf(r).length === 0; }) }
    ];
  }

  /**
   * The schedules shown: the chip, then the old RateScheduleFilterChain's keyword rule (any typed word in the
   * name, description, class or yard), widened to customer and project.
   */
  function filterSchedules(rows, text, chip, today) {
    var words = txt(text).toLowerCase().split(/\s+/).filter(function (w) { return w; });
    return (Array.isArray(rows) ? rows : []).filter(function (r) {
      if (chip === 'ACTIVE' && r.status !== 'ACTIVE') return false;
      if (chip === 'INACTIVE' && r.status === 'ACTIVE') return false;
      if (chip === 'expiring' && !isExpiring(r, today)) return false;
      if (chip === 'tagged' && !tagsOf(r).length) return false;
      if (chip === 'untagged' && tagsOf(r).length) return false;
      if (!words.length) return true;
      return words.some(function (word) {
        return [r.scheduleName, r.description, r.equipmentClass, r.yard, r.customer, r.project]
          .some(function (v) { return v && String(v).toLowerCase().indexOf(word) !== -1; });
      });
    });
  }

  /**
   * usesPpmRates, from New EquipRite's app-flow.js unchanged: a business unit takes Fusion PPM rates when the global
   * PPM_RATES_ENABLED flag is on, or its own Rate Source is PPM_RATES.
   */
  function usesPpmRates(flags, flagsLoaded, buRateSources, buId) {
    if (rules.isFeatureEnabled(flags, flagsLoaded, 'PPM_RATES_ENABLED')) {
      return true;
    }
    return buId != null && (buRateSources || {})[String(buId)] === 'PPM_RATES';
  }

  /**
   * One row of the list: New's loadSchedulesChain mapping (the old RateScheduleInitChain's), unchanged. yardNames:
   * Map invOrgId -> name; isPpmYard(yardOrgId): every business unit of its yard takes PPM rates.
   */
  function scheduleRow(record, yardNames, isPpmYard) {
    return {
      id:             record.id,
      scheduleName:   record.scheduleName || '—',
      equipmentClass: record.equipmentClassId ? String(record.equipmentClassId) : '—',
      description:    record.description || '—',
      customer:       record.customerName  || '—',
      project:        record.projectName   || '—',
      task:           record.taskName      || '—',
      // Schedules saved before the yard picker moved to Fusion org ids hold a local EQR_INV_ORG PK, which will not
      // resolve: show the raw id rather than a dash so the mismatch is visible instead of looking like "no yard".
      yard:           record.yardOrgId != null
                        ? ((yardNames && yardNames.get(Number(record.yardOrgId))) || String(record.yardOrgId))
                        : '—',
      ppmUnused:      isPpmYard ? isPpmYard(record.yardOrgId) : false,
      calcBasis:      record.calcBasis || '—',
      calcMethod:     record.calcMethod || '—',
      status:         record.isActiveFlag === 'Y' ? 'ACTIVE' : 'INACTIVE',
      currency:       record.currencyCode || '—',
      startDate:      record.effectiveFrom ? record.effectiveFrom.slice(0, 10) : '—',
      endDate:        record.effectiveTo ? record.effectiveTo.slice(0, 10) : '—'
    };
  }

  // ── the open schedule ────────────────────────────────────────────────────────────────────────────────────

  /** The old editor's empty formData (create mode). */
  function emptyForm() {
    return {
      scheduleName:   '',
      scheduleCode:   '',
      equipmentClass: 'HEAVY',
      description:    '',
      customerId:     null,
      customerName:   null,
      project:        '',
      task:           '',
      yardOrgId:      null,
      yardOrgName:    null,
      currency:       'USD',
      startDate:      '',
      endDate:        '',
      activeStatus:   true
    };
  }

  /** formData of a loaded schedule (GET /rate-schedules/{id}), with the project and task names found. */
  function formFromSchedule(body, projectName, taskName) {
    return {
      scheduleName:   body.scheduleName || '',
      scheduleCode:   body.scheduleCode || '',
      equipmentClass: body.equipmentClassId ? String(body.equipmentClassId) : 'HEAVY',
      description:    body.description || '',
      customerId:     body.customerRefId ? Number(body.customerRefId) : null,
      customerName:   null,
      project:        '',
      task:           '',
      projectId:      body.projectRefId ? Number(body.projectRefId) : null,
      projectName:    projectName,
      taskId:         body.taskRefId    ? Number(body.taskRefId)    : null,
      taskName:       taskName,
      yardOrgId:      body.yardOrgId ? Number(body.yardOrgId) : null,
      yardOrgName:    null,
      currency:       body.currencyCode || 'USD',
      startDate:      body.effectiveFrom ? body.effectiveFrom.slice(0, 10) : '',
      endDate:        body.effectiveTo ? body.effectiveTo.slice(0, 10) : '',
      activeStatus:   body.isActiveFlag === 'Y'
    };
  }

  /** One rate period line as the grid holds it (the old vbEnterChain's mapping). */
  function lineFromRecord(line) {
    return {
      id:                  line.id,
      objectVersionNumber: line.objectVersionNumber || 1,
      periodSeq:           line.periodSeq,
      classId:      line.equipmentClassId || null,
      subclassId:   line.equipmentSubclassId || null,
      className:     line.equipmentClassName    || '',
      subclassName:  line.equipmentSubclassName || '',
      equipmentName: line.equipmentName         || '',
      calcBasis:     line.calcBasis || 'DAILY',
      calcMethod:    line.calcMethod || 'UTILIZED_DURATION',
      rateType:     line.rateType || 'USAGE',
      period:        line.periodType || line.rateUom || 'HOURLY',
      threshold:     line.fromUnit || 0,
      periodAmount:  line.periodAmount != null ? Number(line.periodAmount) : null,
      periodDivisor: line.periodDivisor != null ? Number(line.periodDivisor) : null,
      costRate:      line.costRate || 0,
      billRate:      line.billRate || line.rateAmount || 0,
      location:      line.location || '',
      startDate:     line.effectiveFrom ? line.effectiveFrom.slice(0, 10) : '',
      endDate:       line.effectiveTo ? line.effectiveTo.slice(0, 10) : ''
    };
  }

  // ── the grid ─────────────────────────────────────────────────────────────────────────────────────────────

  function lineKey(line) {
    return line && line.id != null ? 'id:' + line.id : txt(line && line._key);
  }

  function groupKey(line) {
    var l = line || {};
    return [l.classId || '', l.subclassId || '', l.equipmentName || '', l.location || '', l.rateType || 'USAGE'].join('|');
  }

  /** The period total shown: the authored one, else what the rate implies (shown muted). */
  function shownTotal(line) {
    if (!line) return null;
    return line.periodAmount != null ? line.periodAmount : derivePeriodAmount(line.costRate, line.period);
  }

  function groupTitle(line) {
    var l = line || {};
    return [l.className, l.subclassName, l.equipmentName].filter(function (x) { return x; }).join(' · ') || 'Any equipment';
  }

  /** "days" or "hours": what this line's threshold and rate count. */
  function unitWord(line) {
    return isHourlyBasis(line && line.calcMethod, line && line.calcBasis) ? 'hours' : 'days';
  }

  function methodText(line) {
    var l = line || {};
    if (l.calcMethod === 'COMPLETE_PERIOD') return 'Complete period · calendar days';
    return 'Utilized · ' + (isHourlyBasis(l.calcMethod, l.calcBasis) ? 'logged hours' : 'worked days');
  }

  /**
   * Margin of one line: cost is the period total, bill the line's bill rate per period (saved as rateAmount with
   * the period's UOM). { state: ok | low | none, text }. A bill rate below cost is flagged before anything else.
   */
  function margin(line) {
    var bill = toNum(line && line.billRate);
    var cost = shownTotal(line);
    if (bill === null || bill === 0) return { state: 'none', text: 'No bill rate' };
    if (cost === null || cost === 0) return { state: 'ok', text: 'No cost' };
    var pct = Math.round(((bill - cost) / bill) * 1000) / 10;
    return { state: bill < cost ? 'low' : 'ok', text: (pct > 0 ? '+' : '') + pct + '%' };
  }

  /** Lines whose bill rate is below cost, worded for the margin check. */
  function marginIssues(lines) {
    return (Array.isArray(lines) ? lines : []).filter(function (l) { return margin(l).state === 'low'; })
      .map(function (l) {
        return { key: lineKey(l), text: groupTitle(l) + (l.location ? ' · ' + l.location : '') + ' · '
          + label(PERIODS, l.period) + ': bill ' + money(l.billRate) + ' is below cost ' + money(shownTotal(l)) + '.' };
      });
  }

  /**
   * The grid: one row per group (class, subclass, equipment, location, rate type), one cell per period, each cell
   * holding that period's lines (usually one; hourly tiers can stack), lowest threshold first. An empty cell is
   * "allowed" when the group's method and basis can carry that period (the old drawer's gating).
   */
  function groupLines(lines) {
    var groups = [];
    var byKey = {};
    sortLines(lines || []).forEach(function (l) {
      var k = groupKey(l);
      if (!byKey[k]) {
        byKey[k] = { key: k, title: groupTitle(l), location: l.location || '', rateType: l.rateType || 'USAGE',
          rateTypeLabel: label(RATE_TYPES, l.rateType || 'USAGE'), first: l, lines: [] };
        groups.push(byKey[k]);
      }
      byKey[k].lines.push(l);
    });
    return groups.map(function (g) {
      return Object.assign(g, {
        method: methodText(g.first),
        unit: unitWord(g.first),
        cells: PERIODS.map(function (p) {
          var ls = g.lines.filter(function (l) { return l.period === p.value; })
            .sort(function (a, b) { return (Number(a.threshold) || 0) - (Number(b.threshold) || 0); });
          return { period: p.value, label: p.label, lines: ls, groupKey: g.key,
            allowed: isPeriodAllowed(p.value, g.first.calcMethod, g.first.calcBasis) };
        })
      });
    });
  }

  /**
   * A new line for a group and period, with the old addScheduleLineChain's defaults: method UTILIZED_DURATION,
   * basis DAILY (a COMPLETE_PERIOD line takes the basis of its period), rate type USAGE, period coerced to one
   * the method and basis can carry, no total, rate 0. Its threshold starts at 0 for a group's first line and at
   * one period's length after that, so a new weekly tier does not tie the base tier.
   */
  function newLine(template, period, existingCount, key) {
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
      location: t.location || '', startDate: '', endDate: ''
    };
  }

  /** Which units a line counts in the simulator: logged hours, days worked or days on rent. */
  function unitsKind(l) {
    if (l && l.calcMethod === 'COMPLETE_PERIOD') return 'daysOnRent';
    if (isHourlyBasis(l && l.calcMethod, l && l.calcBasis)) return 'hours';
    return 'daysWorked';
  }

  /**
   * The simulator: what this schedule's USAGE lines would cost for a duration, by the engine's rules (see the
   * top of this file). Each line counts its own unit: logged hours (utilized, hourly basis), worked days
   * (utilized, daily basis) or days on rent (complete period). The applicable line is the one with the highest
   * threshold the duration reaches; cost = ROUND(qty × units × rate, 2).
   *
   * New's simulate unchanged; each row also carries the figures behind its text (units, period, rate, …) so the
   * screen can lay them out.
   *
   * @param {Array} lines
   * @param {{hours:number, daysWorked:number, daysOnRent:number, qty:number}} input
   * @returns {{ rows: Array, total: number }}
   */
  function simulate(lines, input) {
    var inp = input || {};
    var qty = Math.max(1, Number(inp.qty) || 1);
    var unitsFor = function (l) {
      if (l.calcMethod === 'COMPLETE_PERIOD') return { n: Math.max(0, Number(inp.daysOnRent) || 0), word: 'days on rent', short: 'day' };
      if (isHourlyBasis(l.calcMethod, l.calcBasis)) return { n: Math.max(0, Number(inp.hours) || 0), word: 'logged hours', short: 'h' };
      return { n: Math.max(0, Number(inp.daysWorked) || 0), word: 'days worked', short: 'day' };
    };
    var usage = (Array.isArray(lines) ? lines : []).filter(function (l) { return (l.rateType || 'USAGE') === 'USAGE'; });
    var rows = groupLines(usage).map(function (g) {
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
      var total = shownTotal(l);
      var text = u.n + ' ' + u.word + ' reach the ' + label(PERIODS, l.period) + ' tier (from ' + (Number(l.threshold) || 0) + ' '
        + (u.short === 'h' ? 'h' : 'days') + ') → ' + (qty > 1 ? qty + ' × ' : '') + u.n + ' × ' + rate4(rate) + '/' + u.short
        + ' = ' + money(cost, 2);
      if (per > 1 && total != null) text += ' (' + periods + ' ' + periodNoun(l.period) + (periods === 1 ? '' : 's') + ' at ' + money(total) + ')';
      var bill = toNum(l.billRate);
      return { key: g.key, title: g.title, location: g.location, cost: cost, text: text,
        bill: bill ? round2(qty * (u.n / per) * bill) : null,
        units: u.n, unitWord: u.word, unitShort: u.short, period: l.period, periodLabel: label(PERIODS, l.period),
        threshold: Number(l.threshold) || 0, rate: rate, qty: qty, periods: per > 1 ? periods : null, periodTotal: per > 1 ? total : null,
        lineKey: lineKey(l) };
    });
    var sum = rows.reduce(function (s, r) { return s + (r.cost || 0); }, 0);
    return { rows: rows, total: round2(sum) };
  }

  /** The simulator's inputs the given lines need (their USAGE lines' units), in a fixed order. */
  function simInputs(lines) {
    var need = {};
    (Array.isArray(lines) ? lines : []).forEach(function (l) { if ((l.rateType || 'USAGE') === 'USAGE') need[unitsKind(l)] = true; });
    return [
      { key: 'daysOnRent', label: 'Days on rent', hint: 'calendar days, for days-on-rent lines' },
      { key: 'daysWorked', label: 'Days worked', hint: 'days with any hours, for worked-day lines' },
      { key: 'hours', label: 'Logged hours', hint: 'for hourly lines' }
    ].filter(function (i) { return need[i.key]; });
  }

  /**
   * Where each tier of a row applies, in words, by the simulator's rule (the highest threshold reached wins; on a
   * tie the longer period does): "1–6 days", "7–29 days", "30 days or more", or "Never applies" for a tier another
   * one shadows. Tiers counted in different units (hours, days) are read apart. { lineKey: text }.
   */
  function tierRanges(lines) {
    var out = {};
    var byUnit = {};
    (Array.isArray(lines) ? lines : []).forEach(function (l) {
      var k = unitsKind(l);
      (byUnit[k] = byUnit[k] || []).push(l);
    });
    Object.keys(byUnit).forEach(function (k) {
      var short = k === 'hours' ? 'h' : null;
      var ls = byUnit[k].slice().sort(function (a, b) {
        return ((Number(a.threshold) || 0) - (Number(b.threshold) || 0)) || (periodUnits(a.period) - periodUnits(b.period));
      });
      ls.forEach(function (l, i) {
        var from = Math.max(1, Number(l.threshold) || 0);
        var next = ls[i + 1];
        var nextFrom = next ? Math.max(1, Number(next.threshold) || 0) : null;
        var word = function (n) { return short ? n + ' h' : n + (n === 1 ? ' day' : ' days'); };
        if (nextFrom !== null && nextFrom <= from) { out[lineKey(l)] = 'Never applies: ' + label(PERIODS, next.period) + ' starts at the same point'; return; }
        if (nextFrom === null) { out[lineKey(l)] = word(from) + ' or more'; return; }
        out[lineKey(l)] = nextFrom - 1 === from ? word(from) : (short ? from + '–' + (nextFrom - 1) + ' h' : from + '–' + (nextFrom - 1) + ' days');
      });
    });
    return out;
  }

  // ── Save (New's saveScheduleChain, body for body) ─────────────────────────────────────────────────────────

  /** The schedule code: the one it has, else RS- and the name in capitals (at most 30 characters). */
  function autoCode(formData) {
    return formData.scheduleCode ||
      'RS-' + (formData.scheduleName || 'SCHEDULE')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 30);
  }

  /** The header body for PUT /rate-schedules/{id} or POST /rate-schedules. */
  function scheduleBody(formData, now) {
    return {
      scheduleName:     formData.scheduleName,
      scheduleCode:     autoCode(formData),
      description:      formData.description,
      // calcBasis / calcMethod are LINE-LEVEL (set per rate period line), not on the schedule header. Sending them
      // here wrote stale "ghost" header values that the cost engine must ignore, so they are intentionally omitted.
      currencyCode:     formData.currency,
      effectiveFrom:    formData.startDate
        ? formData.startDate + 'T00:00:00Z'
        : new Date(now || Date.now()).toISOString().split('T')[0] + 'T00:00:00Z',
      effectiveTo:      formData.endDate ? formData.endDate + 'T00:00:00Z' : null,
      isActiveFlag:     formData.activeStatus ? 'Y' : 'N',
      equipmentClassId: null,
      customerRefId:    formData.customerId  ? Number(formData.customerId)  : null,
      projectRefId:     formData.projectId   ? Number(formData.projectId)   : null,
      // The *Name fields are denormalized copies the list reads directly, so they must never outlive their id.
      projectName:      formData.projectId   ? (formData.projectName || null) : null,
      taskRefId:        formData.taskId      ? Number(formData.taskId)      : null,
      taskName:         formData.taskId      ? (formData.taskName    || null) : null,
      // yardOrgId stores the mapping row's invOrgId: the FUSION org id.
      yardOrgId:        formData.yardOrgId   ? Number(formData.yardOrgId)   : null,
      rateType:         'STANDARD',
      agreementHeaderId: null
    };
  }

  var UOM_MAP = {
    'HOURLY': 'HOUR', 'HOUR': 'HOUR',
    'DAILY':  'DAY',  'DAY':  'DAY',
    'WEEKLY': 'WEEK', 'WEEK': 'WEEK',
    'MONTHLY':'MONTH','MONTH':'MONTH',
    'FLAT':   'FLAT'
  };

  /** PERIOD_SEQ is unique per schedule: new lines are numbered above the highest one in use. */
  function maxPeriodSeq(lines) {
    return (lines || []).reduce(function (max, l) {
      return l.periodSeq != null && Number(l.periodSeq) > max ? Number(l.periodSeq) : max;
    }, 0);
  }

  /**
   * One line's body for PUT /rate-period-lines/{id} or POST /rate-period-lines: the full body (PUT is a destructive
   * full merge), the period coerced to what its method / basis can carry.
   */
  function lineBody(line, savedId, periodSeq) {
    var period = coercePeriod(line.period, line.calcMethod, line.calcBasis);
    var uom = UOM_MAP[period] || 'HOUR';
    return {
      rateScheduleId:      savedId,
      periodType:          period,
      costRate:            Number(line.costRate) || 0,
      billRate:            Number(line.billRate) || 0,
      rateAmount:          Number(line.billRate) || 0,
      rateUom:             uom,
      rateType:            line.rateType,
      // CALC_BASIS is NOT NULL + CHECK IN ('HOURLY','DAILY','WEEKLY','MONTHLY'); COMPLETE_PERIOD takes its period's
      // basis, UTILIZED_DURATION only HOURLY or DAILY (anything else prices at nothing in EQR_RESOLVE_RATE).
      calcBasis:           (line.calcMethod || 'UTILIZED_DURATION') === 'COMPLETE_PERIOD'
                             ? ({ HOURLY: 'HOURLY', DAILY: 'DAILY', WEEKLY: 'WEEKLY', MONTHLY: 'MONTHLY' }[period] || 'DAILY')
                             : (['HOURLY', 'DAILY'].indexOf(line.calcBasis) >= 0 ? line.calcBasis : 'DAILY'),
      calcMethod:          line.calcMethod || 'UTILIZED_DURATION',
      location:            line.location || null,
      effectiveFrom:       line.startDate ? line.startDate + 'T00:00:00Z' : null,
      effectiveTo:         line.endDate ? line.endDate + 'T00:00:00Z' : null,
      // fromUnit is an Integer on the entity and the DTO: floored here, visibly.
      fromUnit:            Math.max(0, Math.floor(Number(line.threshold) || 0)),
      toUnit:              null,
      // Authoring provenance for the period-total model; sent on every save because PUT is a full merge.
      periodAmount:        line.periodAmount != null ? Number(line.periodAmount) : null,
      // Always NULL: days-per-period comes from periodType; this clears stale threshold-derived divisors.
      periodDivisor:       null,
      periodSeq:           periodSeq,
      createdBy:           'VBCS',
      lastUpdatedBy:       'VBCS',
      equipmentClassId:    line.classId    ? Number(line.classId)    : null,
      equipmentSubclassId: line.subclassId ? Number(line.subclassId) : null,
      equipmentName:       line.equipmentName || null
    };
  }

  /** What Save writes, before the click. */
  function saveText(lines, isNew) {
    var n = (Array.isArray(lines) ? lines : []).length;
    return (isNew ? 'Creates the schedule' : 'Writes the header') + ' and ' + (n === 1 ? 'its line' : 'all ' + n + ' lines')
      + ', one after another, as Old and New EquipRite do.';
  }

  /** Tasks matching the filter text (number or name), at most 30. */
  function taskMatches(tasks, text) {
    var q = txt(text).trim().toLowerCase();
    return (Array.isArray(tasks) ? tasks : [])
      .filter(function (t) { return !q || [t.TaskNumber, t.TaskName].some(function (v) { return v && String(v).toLowerCase().indexOf(q) !== -1; }); })
      .slice(0, 30);
  }

  // ── Next's words ─────────────────────────────────────────────────────────────────────────────────────────

  /** "5 schedules · 4 active · 1 ending within 30 days · 1 not used (Fusion PPM)". */
  function summary(rows, today) {
    var list = Array.isArray(rows) ? rows : [];
    var active = list.filter(function (r) { return r.status === 'ACTIVE'; }).length;
    var ending = list.filter(function (r) { return isExpiring(r, today); }).length;
    var unused = list.filter(function (r) { return r.ppmUnused; }).length;
    return [fmt.count(list.length, 'schedule'), active + ' active', ending ? ending + ' ending within ' + EXPIRING_DAYS + ' days' : '',
      unused ? unused + ' not used (Fusion PPM)' : ''].filter(Boolean).join(' · ');
  }

  /** "1 Jan – 31 Dec 2026", "From 1 Jan 2026", "No dates". */
  function windowText(s) {
    if (!s) return '';
    var a = fmt.date(s.startDate);
    var b = fmt.date(s.endDate);
    return a && b ? fmt.range(s.startDate, s.endDate) : (a ? 'From ' + a : (b ? 'To ' + b : 'No dates'));
  }

  /** "Ends in 12 days", "Ends today", "Ended 3 days ago", or ''. Only for active schedules ending within 30 days or past. */
  function endText(s, today) {
    var d = daysLeft(s && s.endDate, today);
    if (d === null || !s || s.status !== 'ACTIVE') return '';
    if (d < 0) return 'Past its end date';
    if (d === 0) return 'Ends today';
    return d <= EXPIRING_DAYS ? 'Ends in ' + d + (d === 1 ? ' day' : ' days') : '';
  }

  function listExportColumns() {
    return [
      { key: 'scheduleName', label: 'Schedule' },
      { key: 'status', label: 'Status', value: function (r) { return r.status === 'ACTIVE' ? 'Active' : 'Inactive'; } },
      { key: 'customer', label: 'Customer', value: function (r) { return r.customer === '—' ? '' : r.customer; } },
      { key: 'project', label: 'Project', value: function (r) { return r.project === '—' ? '' : r.project; } },
      { key: 'task', label: 'Task', value: function (r) { return r.task === '—' ? '' : r.task; } },
      { key: 'yard', label: 'Yard', value: function (r) { return r.yard === '—' ? '' : r.yard; } },
      { key: 'usedBy', label: 'Used by', value: function (r) { return tagText(r); } },
      { key: 'startDate', label: 'Effective from', value: function (r) { return r.startDate === '—' ? '' : r.startDate; } },
      { key: 'endDate', label: 'Effective to', value: function (r) { return r.endDate === '—' ? '' : r.endDate; } },
      { key: 'currency', label: 'Currency', value: function (r) { return r.currency === '—' ? '' : r.currency; } },
      { key: 'note', label: 'Note', value: function (r) { return [endText(r), r.ppmUnused ? 'Not used: its yard takes Fusion PPM rates' : ''].filter(Boolean).join('; '); } },
      { key: 'description', label: 'Description', value: function (r) { return r.description === '—' ? '' : r.description; } }
    ];
  }

  function linesExportColumns() {
    var num = function (v) { return v == null || v === '' || isNaN(Number(v)) ? '' : Number(v); };
    return [
      { key: 'className', label: 'Class' }, { key: 'subclassName', label: 'Subclass' }, { key: 'equipmentName', label: 'Equipment' },
      { key: 'location', label: 'Location' },
      { key: 'rateType', label: 'Rate type', value: function (l) { return label(RATE_TYPES, l.rateType || 'USAGE'); } },
      { key: 'method', label: 'Counted by', value: function (l) { return methodText(l); } },
      { key: 'period', label: 'Period', value: function (l) { return label(PERIODS, l.period); } },
      { key: 'threshold', label: 'From', type: 'number', value: function (l) { return num(l.threshold); } },
      { key: 'unit', label: 'Unit', value: function (l) { return unitWord(l); } },
      { key: 'cost', label: 'Cost per period', type: 'number', value: function (l) { return num(shownTotal(l)); } },
      { key: 'costRate', label: 'Cost rate per day or hour', type: 'number', value: function (l) { return num(l.costRate); } },
      { key: 'billRate', label: 'Bill per period', type: 'number', value: function (l) { return num(l.billRate); } },
      { key: 'margin', label: 'Margin', value: function (l) { return margin(l).text; } }
    ];
  }

  return {
    DAYS_PER_PERIOD: DAYS_PER_PERIOD,
    PERIODS: PERIODS,
    RATE_TYPES: RATE_TYPES,
    METHODS: METHODS,
    CURRENCIES: CURRENCIES,
    EXPIRING_DAYS: EXPIRING_DAYS,
    UOM_MAP: UOM_MAP,
    isHourlyBasis: isHourlyBasis,
    isPeriodAllowed: isPeriodAllowed,
    coercePeriod: coercePeriod,
    periodUnits: periodUnits,
    periodNoun: periodNoun,
    deriveRate: deriveRate,
    derivePeriodAmount: derivePeriodAmount,
    sortLines: sortLines,
    applyLineEdit: applyLineEdit,
    tagsOf: tagsOf,
    taggedTo: taggedTo,
    tagText: tagText,
    daysLeft: daysLeft,
    isExpiring: isExpiring,
    listChips: listChips,
    filterSchedules: filterSchedules,
    usesPpmRates: usesPpmRates,
    scheduleRow: scheduleRow,
    emptyForm: emptyForm,
    formFromSchedule: formFromSchedule,
    lineFromRecord: lineFromRecord,
    lineKey: lineKey,
    groupKey: groupKey,
    shownTotal: shownTotal,
    groupTitle: groupTitle,
    unitWord: unitWord,
    methodText: methodText,
    margin: margin,
    marginIssues: marginIssues,
    groupLines: groupLines,
    newLine: newLine,
    unitsKind: unitsKind,
    simulate: simulate,
    simInputs: simInputs,
    tierRanges: tierRanges,
    autoCode: autoCode,
    scheduleBody: scheduleBody,
    maxPeriodSeq: maxPeriodSeq,
    lineBody: lineBody,
    saveText: saveText,
    taskMatches: taskMatches,
    summary: summary,
    windowText: windowText,
    endText: endText,
    money: money,
    rate4: rate4,
    periodLabel: function (p) { return label(PERIODS, p); },
    rateTypeLabel: function (t) { return label(RATE_TYPES, t); },
    listExportColumns: listExportColumns,
    linesExportColumns: linesExportColumns
  };
});
