define(['resources/js/usageWeeks'], (weeks) => {
  'use strict';

  // Timesheet approval (wireframe: Timesheet approval; FDD 7.14, S21, DP-06). One page for the old
  // timesheet-approvals list and timesheet-approval-detail grid: every submitted line of a week, across requests,
  // with the checks an approver makes before approving:
  //   - a day over 10 h is amber, over 16 h red (FDD S21)
  //   - week over week: last week's hours on the same line, and the change
  //   - what approving costs (the view's billed amount) and what the requests have cost so far
  // and the actions: Approve and Reject (the old chains, request by request), and Adjust hours, which keeps the
  // submitted hours in the audit trail and leaves the line SUBMITTED (no resubmission, FDD 7.14.3).

  const STATUS_CHIPS = [
    { key: 'SUBMITTED', label: 'To approve' },
    { key: 'APPROVED', label: 'Approved' },
    { key: 'REJECTED', label: 'Rejected' },
    { key: 'all', label: 'All' },
  ];
  const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

  function money(n) {
    if (n == null || isNaN(Number(n))) {
      return '—';
    }
    const v = Number(n);
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
  }

  class PageModule {
    /**
     * Rows from views/timesheet-approval-details, one per time entry (request line x week). The old detail page
     * read the row status from entryStatus and approved by it (getSelectedTimeEntryIdsByStatus).
     */
    mapRows(apiRows) {
      return (Array.isArray(apiRows) ? apiRows : []).filter((r) => r && r.eqrTimeEntryId).map((r) => ({
        key: 'E' + r.eqrTimeEntryId,
        entryId: Number(r.eqrTimeEntryId),
        requestNumber: r.requestNumber || '',
        projectName: r.projectName || '',
        taskName: r.taskName || '',
        equipmentName: r.equipmentName || 'Equipment',
        className: r.className || '',
        hoursType: r.hoursType || '',
        status: String(r.entryStatus || r.timesheetStatus || '').toUpperCase(),
        lineId: r.requestLineId != null ? Number(r.requestLineId) : null,
        week: weeks.iso10(r.weekStartDate),
        start: weeks.iso10(r.requestedStartDate),
        end: weeks.iso10(r.requestedEndDate),
        days: [1, 2, 3, 4, 5, 6, 7].map((n) => Number(r['day' + n + 'Hours']) || 0),
        totalHours: Number(r.totalHours || 0),
        totalBill: Number(r.totalBill || 0),
        submittedBy: r.submittedByName || '',
      }));
    }

    /** Week chips, newest first, with how many lines wait for approval in each. */
    weekChips(rows) {
      const by = {};
      (rows || []).forEach((r) => {
        if (!r.week) return;
        const w = by[r.week] || (by[r.week] = { week: r.week, label: weeks.weekLabel(r.week), waiting: 0, lines: 0 });
        w.lines++;
        if (r.status === 'SUBMITTED') w.waiting++;
      });
      return Object.keys(by).sort((a, b) => b.localeCompare(a)).map((k) => by[k]);
    }

    /** The week to open: the newest week with lines waiting, else the newest week. */
    defaultWeek(rows) {
      const chips = this.weekChips(rows);
      const waiting = chips.find((c) => c.waiting > 0);
      return (waiting || chips[0] || { week: '' }).week;
    }

    statusChips(rows, week) {
      const inWeek = (rows || []).filter((r) => !week || r.week === week);
      return STATUS_CHIPS.map((c) => ({
        key: c.key,
        label: c.label,
        count: c.key === 'all' ? inWeek.length : inWeek.filter((r) => r.status === c.key).length,
      }));
    }

    visible(rows, week, status, text) {
      const q = String(text || '').trim().toLowerCase();
      return (rows || []).filter((r) => {
        if (week && r.week !== week) return false;
        if (status && status !== 'all' && r.status !== status) return false;
        if (!q) return true;
        return [r.requestNumber, r.equipmentName, r.projectName, r.taskName, r.className, r.submittedBy]
          .some((v) => v && String(v).toLowerCase().includes(q));
      }).sort((a, b) => a.requestNumber.localeCompare(b.requestNumber) || a.equipmentName.localeCompare(b.equipmentName));
    }

    weekDays(week) {
      return weeks.weekDays(week);
    }

    weekLabel(week) {
      return weeks.weekLabel(week);
    }

    // ── variance ─────────────────────────────────────────────────────────────

    /** FDD S21: over 10 h in a day is amber, over 16 h is red. */
    dayLevel(hours) {
      const h = Number(hours) || 0;
      if (h > 16) return 'high';
      if (h > 10) return 'long';
      return '';
    }

    /** Last week's hours on the same request line, or null when that week has no entry for it. */
    previous(rows, row) {
      if (!row || !row.lineId || !row.week) return null;
      const prevWeek = weeks.addDays(row.week, -7);
      const p = (rows || []).find((r) => r.lineId === row.lineId && r.week === prevWeek);
      return p ? p.days.slice() : null;
    }

    /** "+8 h" / "−4 h" / "same" against last week; '' when there is nothing to compare with. */
    wowText(rows, row) {
      const prev = this.previous(rows, row);
      if (!prev) return 'new this week';
      const d = round2(row.days.reduce((s, h) => s + h, 0) - prev.reduce((s, h) => s + h, 0));
      if (!d) return 'same as last week';
      return (d > 0 ? '+' : '−') + Math.abs(d) + ' h vs last week';
    }

    /** Last week's hours on the same line and day, or '' when last week has no entry for the line. */
    prevDay(rows, row, i) {
      const prev = this.previous(rows, row);
      return prev ? String(prev[i]) : '';
    }

    /** The view's billed amount over its hours, as an hourly figure ("$175/h"); '' when there is no billed amount. */
    rateText(row) {
      if (!row || !(row.totalBill > 0) || !(row.totalHours > 0)) return '';
      return money(round2(row.totalBill / row.totalHours)) + '/h';
    }

    money(n) {
      return money(n);
    }

    statusClass(status) {
      return 'er-status er-status--' + (String(status || '') || 'DRAFT');
    }

    statusText(status) {
      const s = String(status || '');
      return s ? s.charAt(0) + s.slice(1).toLowerCase() : '—';
    }

    // ── selection and money ──────────────────────────────────────────────────

    /** Rows that can be approved, rejected or adjusted: SUBMITTED only (old getSelectedTimeEntryIdsByStatus). */
    canAct(row, readOnly) {
      return !readOnly && !!row && row.status === 'SUBMITTED';
    }

    pickedRows(rows, picked) {
      return (rows || []).filter((r) => picked && picked[r.key] && r.status === 'SUBMITTED');
    }

    isPicked(picked, key) {
      return !!(picked && picked[key]);
    }

    /** { lines, hours, cost } of the ticked SUBMITTED lines. */
    selection(rows, picked) {
      const list = this.pickedRows(rows, picked);
      return {
        lines: list.length,
        hours: round2(list.reduce((s, r) => s + r.days.reduce((a, h) => a + h, 0), 0)),
        cost: round2(list.reduce((s, r) => s + r.totalBill, 0)),
        requests: list.map((r) => r.requestNumber).filter((v, i, a) => a.indexOf(v) === i),
      };
    }

    /** Approval runs request by request (Fusion is sent one request number): [{ requestNumber, entryIds }]. */
    byRequest(rows, picked) {
      const out = [];
      this.pickedRows(rows, picked).forEach((r) => {
        let g = out.find((x) => x.requestNumber === r.requestNumber);
        if (!g) out.push(g = { requestNumber: r.requestNumber, entryIds: [] });
        g.entryIds.push(r.entryId);
      });
      return out;
    }

    /** Cost so far on the requests in view (views/project-cost-detail rows), plus what approving would add. */
    costToDate(costByRequest, requests) {
      return round2((requests || []).reduce((s, r) => s + Number((costByRequest || {})[r] || 0), 0));
    }

    sumCostRows(rows) {
      return round2((Array.isArray(rows) ? rows : []).reduce((s, r) => s + Number(r.totalCost != null ? r.totalCost : (r.cost || 0)), 0));
    }

    // ── adjust with an audit trail ───────────────────────────────────────────

    adjustRaw(adjust, row, i) {
      if (adjust && adjust.key === row.key && adjust.days && adjust.days[i] !== undefined) return String(adjust.days[i]);
      return String(row.days[i]);
    }

    isAdjusting(adjust, row) {
      return !!adjust && !!row && adjust.key === row.key;
    }

    dayOpen(row, day) {
      return !!row && !!day && weeks.inSpan(day.iso, row.start, row.end);
    }

    /** Problems with an adjustment, as sentences; [] when it can be saved. */
    adjustProblems(row, adjust) {
      if (!row || !adjust) return ['Nothing to adjust.'];
      const out = [];
      (adjust.days || []).forEach((v, i) => {
        const n = Number(String(v).trim() === '' ? 0 : v);
        if (isNaN(n) || n < 0 || n > 24) out.push('Day ' + (i + 1) + ': enter 0 to 24 hours.');
      });
      const before = row.days;
      const after = (adjust.days || []).map((v) => Number(String(v).trim() === '' ? 0 : v) || 0);
      if (!out.length && before.every((h, i) => h === after[i])) out.push('No hours were changed.');
      if (!String(adjust.reason || '').trim()) out.push('Say why the hours are adjusted; the submitter sees it in the audit trail.');
      return out;
    }

    /** The audit entry for an adjustment (POST /audit-trail): what was submitted, what it is now, and why. */
    auditBody(row, afterDays, reason, actor, weekDays) {
      const before = row.days.slice();
      const after = afterDays.map((v) => Number(v) || 0);
      const changes = [];
      after.forEach((h, i) => {
        if (h !== before[i]) changes.push(((weekDays && weekDays[i] && weekDays[i].label) || ('Day ' + (i + 1))) + ' ' + before[i] + ' → ' + h + ' h');
      });
      const sum = (a) => round2(a.reduce((s, h) => s + h, 0));
      return {
        entityName: 'EQR_TIME_ENTRY',
        entityId: row.entryId,
        action: 'ADJUST_HOURS',
        changedBy: actor || null,
        oldValues: JSON.stringify({ requestNumber: row.requestNumber, weekStartDate: row.week, days: before, totalHours: sum(before) }),
        newValues: JSON.stringify({ requestNumber: row.requestNumber, weekStartDate: row.week, days: after, totalHours: sum(after) }),
        changeSummary: 'Hours adjusted at approval on ' + row.requestNumber + ' · ' + row.equipmentName + ': '
          + changes.join(', ') + '. Reason: ' + String(reason || '').trim(),
      };
    }

    /**
     * Adjustments recorded in the audit trail, by entry: the hours as first SUBMITTED (the oldest entry's old values)
     * and the latest summary, so an adjusted line shows what it was.
     */
    auditMap(auditRows) {
      const out = {};
      (Array.isArray(auditRows) ? auditRows : [])
        .filter((a) => a && a.entityName === 'EQR_TIME_ENTRY' && a.action === 'ADJUST_HOURS' && a.entityId != null)
        .sort((a, b) => String(a.changedDate || '').localeCompare(String(b.changedDate || '')) || (Number(a.id) || 0) - (Number(b.id) || 0))
        .forEach((a) => {
          let old = null;
          try { old = JSON.parse(a.oldValues || 'null'); } catch (e) { old = null; }
          const k = String(a.entityId);
          if (!out[k]) out[k] = { original: old && Array.isArray(old.days) ? old.days : null, count: 0 };
          out[k].count++;
          out[k].summary = a.changeSummary || '';
          out[k].by = a.changedBy || '';
          out[k].date = String(a.changedDate || '').slice(0, 10);
        });
      return out;
    }

    adjusted(auditByEntry, row) {
      return !!(auditByEntry && row && auditByEntry[String(row.entryId)]);
    }

    /** The submitted value of a day when it was adjusted since, else ''. */
    originalDay(auditByEntry, row, i) {
      const a = auditByEntry && row ? auditByEntry[String(row.entryId)] : null;
      if (!a || !a.original || a.original[i] === undefined) return '';
      return Number(a.original[i]) === Number(row.days[i]) ? '' : String(a.original[i]);
    }

    auditTitle(auditByEntry, row) {
      const a = auditByEntry && row ? auditByEntry[String(row.entryId)] : null;
      return a ? (a.summary + (a.by ? ' (' + a.by + (a.date ? ', ' + a.date : '') + ')' : '')) : '';
    }
  }

  return PageModule;
});
