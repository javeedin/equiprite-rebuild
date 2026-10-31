define(['resources/js/timeEntry', 'resources/js/exportKit', 'resources/js/nav', 'resources/js/usageWeeks'], (TE, exportKit, nav, weeks) => {
  'use strict';

  // Timesheets: binding helpers. The rules are New EquipRite's Time entry, unchanged (resources/js/timeEntry.js
  // TimeEntryRules: buildRows, isEditable, cellEditable, hoursMax, problems, changeSet, copyFrom, gridKey …); Next's own
  // words and checks are its TimeEntry layer. The chains call these as $page.functions, as New's chains do.
  class PageModule extends TE.TimeEntry {
    formats() { return exportKit.FORMATS; }

    /** Whether this role sees another menu item (for the link to Approve time). */
    canOpen(vars, navId) {
      const v = vars || {};
      return nav.itemVisible(nav.item(navId), v.pageAccessMap, v.pageAccessLoaded, v.featureFlags, v.flagsLoaded, v.buRateSources || {});
    }

    plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

    today() { return weeks.today(); }

    /** "2 rows to save" / "Everything is saved". */
    saveNote(rows, edits) {
      const n = this.pendingCount(rows, edits);
      return n === 0 ? 'Everything is saved' : this.plural(n, 'row') + ' to save';
    }

    saveLabel(rows, edits, isSaving, saveMode) {
      if (isSaving && saveMode === 'save') return 'Saving…';
      const n = this.pendingCount(rows, edits);
      return n ? 'Save draft (' + n + ')' : 'Save draft';
    }

    submitLabel(picked, isSaving, saveMode) {
      if (isSaving && saveMode === 'submit') return 'Submitting…';
      const n = this.pickedCount(picked);
      return n ? 'Submit ' + this.plural(n, 'row') + ' for approval' : 'Submit for approval';
    }

    /** The hours box: bad (New's cellState), a weekday with no hours (what is missing), or plain. */
    cellClass(row, day, edits, list, weekDays) {
      let c = 'nx-ts-hours';
      if (this.cellState(row, day.i, edits, list) === 'bad') c += ' nx-ts-hours--bad';
      else if (this.isGap(row, edits, weekDays, day)) c += ' nx-ts-hours--gap';
      return c;
    }

    rowClass(row, edits, readOnly) {
      return 'nx-row nx-ts-row' + (this.isRowDirty(row, edits) || this.isExpDirty(row, edits) ? ' nx-ts-row--dirty' : '')
        + (this.isEditable(row, readOnly) ? '' : ' nx-ts-row--locked');
    }

    dayHeadClass(day) {
      return 'nx-ts-c-day' + (this.isToday(day) ? ' nx-ts-today' : '');
    }

    /** The tick box is shown on rows Submit can take. */
    canPick(row) { return this.isEditable(row, false); }

    /** The row's sub line: task, the rate as priced on the request. */
    rowSub(row, lineRates) {
      const rate = this.rateText(row, lineRates);
      return (row.taskName || '—') + (rate ? ' · ' + rate : '');
    }

    queueItemClass(q, current) {
      return 'nx-ts-qitem' + (q.requestNumber === current ? ' nx-ts-qitem--on' : '');
    }

    weekTitle(weekStart) { return weekStart ? 'Week of ' + this.weekLabel(weekStart) : ''; }

    stepOk(list, current, dir) { return !!this.stepWeek(list, current, dir); }
  }

  return PageModule;
});
