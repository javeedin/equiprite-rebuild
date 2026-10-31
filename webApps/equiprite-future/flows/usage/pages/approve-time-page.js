define(['resources/js/timeApproval', 'resources/js/exportKit', 'resources/js/nav', 'resources/js/fmt'], (TA, exportKit, nav, fmt) => {
  'use strict';

  // Approve time: binding helpers. The rules are New EquipRite's Timesheet approval, unchanged (resources/js/
  // timeApproval.js TimeApprovalRules: mapRows, visible, dayLevel, previous, canAct, selection, byRequest, auditBody …);
  // what needs a look is its TimeApproval layer. The chains call these as $page.functions, as New's chains do.
  class PageModule extends TA.TimeApproval {
    formats() { return exportKit.FORMATS; }

    canOpen(vars, navId) {
      const v = vars || {};
      return nav.itemVisible(nav.item(navId), v.pageAccessMap, v.pageAccessLoaded, v.featureFlags, v.flagsLoaded, v.buRateSources || {});
    }

    /** Approve time in New EquipRite, on this week. */
    newApproveUrl(newBase, week) {
      const u = nav.newUrl(newBase, 'approve-time');
      return u ? u + (week ? '?week=' + encodeURIComponent(week) : '') : '';
    }

    plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

    money(n) { return fmt.money(n) || '$0'; }

    summary(rowsAll, week, weekDays, isLoading) {
      if (isLoading && !(rowsAll || []).length) return 'Loading the submitted hours…';
      if (!week) return 'No timesheet has been submitted yet.';
      const w = this.waiting(rowsAll, week, weekDays);
      return 'Week of ' + this.weekLabel(week) + ' · ' + (w.lines ? this.plural(w.lines, 'line') + ' waiting for approval' : 'nothing waiting for approval')
        + (w.look ? ' · ' + w.look + ' need a look' : '');
    }

    selectionText(rowsAll, picked) {
      const s = this.selection(rowsAll, picked);
      return s.lines ? this.plural(s.lines, 'line') + ' selected · ' + s.hours + ' h · ' + this.money(s.cost) : 'Nothing selected';
    }

    approveLabel(rowsAll, picked) {
      const s = this.selection(rowsAll, picked);
      return s.lines ? 'Approve ' + s.lines + ' · ' + this.money(s.cost) : 'Approve';
    }

    rejectLabel(rowsAll, picked) {
      const s = this.selection(rowsAll, picked);
      return s.lines ? 'Send back ' + s.lines : 'Send back';
    }

    cleanCount(rowsAll, shownRows, readOnly, weekDays) {
      return Object.keys(this.cleanKeys(rowsAll, shownRows, readOnly, weekDays)).length;
    }

    rowClass(rowsAll, row, picked, weekDays) {
      const w = this.worst(rowsAll, row, weekDays);
      return 'nx-row nx-ta-row' + (w ? ' nx-ta-row--' + w : '') + (this.isPicked(picked, row.key) ? ' nx-ta-row--on' : '');
    }

    dayClass(adjust, row, i) {
      if (this.isAdjusting(adjust, row)) return 'nx-ta-c-day nx-ta-day--edit';
      const lvl = this.dayLevel(row.days[i]);
      return 'nx-ta-c-day' + (lvl ? ' nx-ta-day--' + lvl : '');
    }

    tagClass(tone) {
      return 'nx-u-tag ' + (tone === 'high' ? 'nx-u-tag--bad' : (tone === 'long' ? 'nx-u-tag--warn' : 'nx-u-tag--info'));
    }

    /** The week's requests, in order. */
    weekRequests(rowsAll, week) {
      return (rowsAll || []).filter((r) => r.week === week).map((r) => r.requestNumber).filter((x, i, a) => x && a.indexOf(x) === i).sort();
    }

    /** Cost so far on the selected lines' requests plus the selection (New's cost-impact cards); with nothing selected,
     * the cost so far on the week's requests. */
    afterApproval(costByRequest, rowsAll, picked, week) {
      const s = this.selection(rowsAll, picked);
      if (!s.lines) return this.costToDate(costByRequest, this.weekRequests(rowsAll, week));
      return this.costToDate(costByRequest, s.requests) + s.cost;
    }

    afterNote(rowsAll, picked, week) {
      const s = this.selection(rowsAll, picked);
      if (s.lines) return 'On ' + s.requests.join(', ') + ', with the selection';
      const reqs = this.weekRequests(rowsAll, week);
      return reqs.length ? 'On ' + reqs.join(', ') + '. Select lines to see what approving adds.' : 'No request this week';
    }
  }

  return PageModule;
});
