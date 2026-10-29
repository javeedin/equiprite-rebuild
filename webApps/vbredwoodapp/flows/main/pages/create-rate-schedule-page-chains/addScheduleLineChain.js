define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Local copy of the Class -> Subclass -> Equipment ordering used by
  // vbEnterChain. Kept local to the chain on purpose — see the note there: a
  // sort routed through $page.functions took the whole grid down with it.
  var compareLineText = function (a, b) {
    var left  = (a == null ? '' : String(a)).trim();
    var right = (b == null ? '' : String(b)).trim();
    if (left === right) return 0;
    if (left === '') return -1;
    if (right === '') return 1;
    return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
  };

  var sortLines = function (lines) {
    return (lines || []).slice().sort(function (a, b) {
      return compareLineText(a.className, b.className)
        || compareLineText(a.subclassName, b.subclassName)
        || compareLineText(a.equipmentName, b.equipmentName);
    });
  };

  class addScheduleLineChain extends ActionChain {

    /**
     * @param {Object} context
     */
    async run(context) {
      const { $page } = context;

      console.log('--- addScheduleLineChain.run triggered ---');

      // 1. Prepare the new line object — no id field so saveScheduleChain
      //    treats it as a new line and calls createRatePeriodLine
      const currentLine = $page.variables.currentLine;

      // Resolve className and subclassName from the loaded arrays
      // (more reliable than relying on event detail from oj-select-single)
      const classMatch = ($page.variables.classesArray || []).find(
        c => c.value === currentLine.classId
      );
      const subclassMatch = ($page.variables.subclassesArray || []).find(
        s => s.value === currentLine.subclassId
      );

      // Calc Method is the master switch. COMPLETE_PERIOD bills by calendar
      // days and ignores Calc Basis (the field is disabled in the UI). The DB
      // column CALC_BASIS is NOT NULL + CHECK IN ('HOURLY','DAILY','WEEKLY',
      // 'MONTHLY'), so null is rejected — we must send a valid value. For
      // COMPLETE_PERIOD we derive it from the period (which the engine ignores)
      // rather than blindly stamping HOURLY. UTILIZED_DURATION uses the
      // user-picked basis, defaulting to DAILY when unset.
      //
      // DEFAULT CHANGED HOURLY -> DAILY. Billing is day-based: any non-zero
      // hours on a day counts as one whole day. An HOURLY basis makes the
      // engine sum HOURS and multiply by the same per-day COST_RATE -- there is
      // no separate hourly rate column -- and it re-denominates FROM_UNIT into
      // hours, so a "5-day" tier fires after 5 HOURS. Measured on line
      // 1000001975 (5 days / 20 hours at 1970/day): DAILY bills 9,850, HOURLY
      // bills 39,400, and with a 0/3/5 ladder HOURLY picks the 5-rung and bills
      // 24,000. Proof: MD/Post Cost/threshold-tests/THRESHOLD_TEST_SUITE.sql
      // (10/10, rolls back). The option is left in the drawer; only the default
      // moves, so nothing authored so far changes.
      const calcMethod = currentLine.calcMethod || 'UTILIZED_DURATION';

      // Period is coerced to one the method/basis can actually carry before it
      // is used for anything. The drawer greys the illegal options out, so this
      // only bites if a value was set before the gating applied — but the period
      // drives both the derived rate below and the calc basis, so a bad one here
      // would propagate into two more fields.
      // 'DAILY' fallback, matching the calc-basis default below. Safe for the
      // derived rate: DAYS_PER_PERIOD has HOURLY and DAILY both at 1, so
      // deriveRate() returns the same number either way.
      const period = $page.functions.coercePeriod(
        currentLine.period || 'DAILY', calcMethod, currentLine.calcBasis);

      const PERIOD_BASIS = { HOURLY: 'HOURLY', DAILY: 'DAILY', WEEKLY: 'WEEKLY', MONTHLY: 'MONTHLY' };
      const calcBasis  = calcMethod === 'COMPLETE_PERIOD'
        ? (PERIOD_BASIS[period] || 'DAILY')
        : (currentLine.calcBasis || 'DAILY');

      // Period-total authoring: the drawer derives costRate as the user types,
      // but re-derive here as the backstop. If someone typed a total and never
      // touched the rate field (or a handler was missed), the engine must still
      // get a per-unit rate — it bills days x COST_RATE and never reads the
      // total. A hand-entered rate with no total wins as-is; the total is then
      // back-filled so the two can't be stored disagreeing.
      let periodAmount = currentLine.periodAmount;
      let costRate     = currentLine.costRate;

      if (periodAmount !== null && periodAmount !== undefined && periodAmount !== '') {
        costRate = $page.functions.deriveRate(periodAmount, period);
      } else if (costRate !== null && costRate !== undefined && costRate !== '') {
        periodAmount = $page.functions.derivePeriodAmount(costRate, period);
      }

      const newLine = {
        classId:       currentLine.classId      || null,
        subclassId:    currentLine.subclassId   || null,
        className:     classMatch    ? classMatch.label    : (currentLine.className    || ''),
        subclassName:  subclassMatch ? subclassMatch.label : (currentLine.subclassName || ''),
        equipmentName: currentLine.equipmentName || '',
        calcBasis:     calcBasis,
        calcMethod:    calcMethod,
        rateType:      currentLine.rateType     || 'USAGE',
        period:        period,
        threshold:     currentLine.threshold    || 0,
        periodAmount:  periodAmount != null && periodAmount !== '' ? Number(periodAmount) : null,
        // Always NULL. Days-per-period now comes from PERIOD, so there is
        // nothing left for this column to say — and storing the derived 7 or 30
        // would be a denormalized copy that goes stale the day the constant
        // moves. NULL also restores the column's original meaning: a non-null
        // value would mean somebody deliberately overrode the period length.
        periodDivisor: null,
        costRate:      costRate       || 0,
        billRate:      currentLine.billRate     || 0,
        location:      currentLine.location     || '',
        startDate:     currentLine.startDate    || '',
        endDate:       currentLine.endDate      || '',
      };

      console.log('Adding new line:', JSON.stringify(newLine));

      // 3. Add to the array using concatenation to ensure a new reference, then
      //    re-sort Class -> Subclass -> Equipment so the new line lands in its
      //    group instead of at the bottom of the grid. Falls back to append
      //    order if the sort ever throws — losing the line is not an option.
      const withNewLine = [...$page.variables.equipmentLines, newLine];
      let orderedLines = withNewLine;
      try {
        orderedLines = sortLines(withNewLine);
      } catch (e) {
        console.error('Schedule line sort failed — appending unsorted', e);
      }
      $page.variables.equipmentLines = orderedLines;

      // Refresh Data Grid Provider
      $page.variables.dataGridProvider = $page.functions.initGridData($page.variables.equipmentLines);

      // 4. Reset currentLine
      $page.variables.currentLine = {
        classId:       null,
        subclassId:    null,
        className:     null,
        subclassName:  null,
        equipmentName: null,
        calcBasis:     null,
        calcMethod:    null,
        rateType:      null,
        period:        null,
        threshold:     null,
        periodAmount:  null,
        periodDivisor: null,
        costRate:      null,
        billRate:      null,
        location:      null,
        startDate:     null,
        endDate:       null,
      };

      // 5. Close Drawer
      $page.variables.isAddLineDrawerOpen = false;

      // 6. Success Notification
      await Actions.fireNotificationEvent(context, {
        summary: 'Line Added',
        message: 'The equipment line has been added to the schedule.',
        displayMode: 'transient',
        type: 'confirmation',
      });

      console.log('Total Lines now:', $page.variables.equipmentLines.length);
    }
  }

  return addScheduleLineChain;
});
