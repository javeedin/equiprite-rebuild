define(['resources/js/timesheetRows', 'resources/js/usageWeeks'], (timesheetRows, weeks) => {
  'use strict';

  // EquipRite Next, Timesheets: the rules of a week of hours.
  //
  // TimeEntryRules below is New EquipRite's Time entry page module (webApps/equiprite/flows/usage/pages/
  // time-entry-page.js) COPIED UNCHANGED, method for method, so the week rules, the editable states, the hour limits,
  // what Save writes and what Submit checks are New's (and through it Old's timesheet-detail). tests/next-usage.test.js
  // holds every method to New's source text. Next's own layer (words, what is missing, the request list, export) is
  // the TimeEntry class at the end; it only reads.
  //
  // ── New's header, as it stands ──
  // Time entry (wireframe: Time entry; FDD 7.13). One page for the old equipment-timesheets list and
  // timesheet-detail grid: pick a request, pick a week, type the hours.
  //
  // Rows are the request's rentable lines for the week (views/timesheet-details), mapped by the old shared
  // resources/js/timesheetRows.toGridRows. A row holds what was LOADED; what the user types lives in the page's
  // `edits` object, keyed '<rowKey>|d<0-6>', '<rowKey>|type', '<rowKey>|exp'. Keeping the typed values out of the
  // rows means the grid never re-renders under the cursor, so arrow / Enter entry keeps its focus.
  //
  // The rules carried from timesheet-detail-page.js:
  //   - only DRAFT and REJECTED rows (and rows with no time entry yet) are editable (getIsEditable)
  //   - a day outside the line's requested start/end cannot be entered (getIsEditable)
  //   - a row with no time entry is pre-filled with the line's default hours on the days inside its dates
  //     (initProviderFromLines), and is CREATED on save
  //   - an hours box takes 0-24, or 0-1 when the expenditure type's unit is a day (getHoursMax)
  //   - rate types are CHK_TE_ENTRY_TYPE's: Usage, Mobilization, Return, Standby (RATE_TYPE_OPTIONS)

  const RATE_TYPES = [
    { value: 'USAGE', label: 'Usage' },
    { value: 'MOBILIZATION', label: 'Mobilization' },
    { value: 'RETURNING', label: 'Return' },
    { value: 'STANDBY', label: 'Standby' },
  ];
  // The four values proven accepted by unprocessedProjectCosts; the floor under a failed type list (EXP_TYPE_OPTIONS).
  const EXP_TYPE_SEED = [
    { value: 'Equipment', label: 'Equipment' },
    { value: 'Purchased Equipment', label: 'Purchased Equipment' },
    { value: 'Supplies', label: 'Supplies' },
    { value: 'Miscellaneous', label: 'Miscellaneous' },
  ];
  const EDITABLE = { '': true, DRAFT: true, REJECTED: true };

  const num = (v) => {
    if (v === null || v === undefined || String(v).trim() === '') {
      return 0;
    }
    const n = Number(String(v).trim());
    return isNaN(n) ? NaN : n;
  };
  const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
  const isSet = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);

  function money(n) {
    if (n == null || isNaN(Number(n))) {
      return '—';
    }
    const v = Number(n);
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
  }

  class TimeEntryRules {
    rateTypes() {
      return RATE_TYPES;
    }

    expTypeSeed() {
      return EXP_TYPE_SEED.slice();
    }

    // ── weeks ────────────────────────────────────────────────────────────────

    mondayOf(iso) {
      return weeks.mondayOf(iso);
    }

    thisWeek(now) {
      return weeks.mondayOf(weeks.today(now));
    }

    weekDays(weekStart) {
      return weeks.weekDays(weekStart);
    }

    weekLabel(weekStart) {
      return weeks.weekLabel(weekStart);
    }

    /** The Monday n weeks away. */
    shiftWeek(weekStart, n) {
      return weeks.mondayOf(weeks.addDays(weekStart, 7 * Number(n || 0)));
    }

    /** The week picker range: every week of the request's rental span (old vbEnterChain step 2). */
    spanWeeks(start, end, fallbackWeek) {
      const list = weeks.weeksBetween(start, end);
      return list.length ? list : [weeks.mondayOf(fallbackWeek)].filter(Boolean);
    }

    clampWeek(wanted, list) {
      return weeks.clampWeek(wanted, list);
    }

    /** The neighbouring week inside the span, or '' at either end. */
    stepWeek(list, current, dir) {
      const arr = Array.isArray(list) ? list : [];
      const i = arr.indexOf(current);
      const j = i + (dir < 0 ? -1 : 1);
      return i >= 0 && j >= 0 && j < arr.length ? arr[j] : '';
    }

    // ── rows ─────────────────────────────────────────────────────────────────

    /**
     * Grid rows from a views/timesheet-details page. Non-rentable lines never appear (isRentable 'N' only, so a
     * freshly deployed line the backend synthesised without the flag still shows). A row with no time entry takes the
     * line's default hours on the days inside its dates, as initProviderFromLines does.
     */
    buildRows(apiRows, weekStart) {
      const list = (Array.isArray(apiRows) ? apiRows : []).filter((r) => r && r.isRentable !== 'N');
      const days = weeks.weekDays(weekStart);
      return timesheetRows.toGridRows(list).map((g, idx) => {
        const src = list[idx] || {};
        const hasEntry = !!g.eqr_time_entry_id;
        const defaultHrs = !hasEntry && g.default_hours ? Number(g.default_hours) : null;
        const hours = [1, 2, 3, 4, 5, 6, 7].map((n, i) => {
          if (defaultHrs && defaultHrs > 0 && days[i]) {
            return weeks.inSpan(days[i].iso, g.start_date, g.end_date) ? defaultHrs : 0;
          }
          return Number(g['hours_day' + n]) || 0;
        });
        return {
          key: g.request_line_id ? 'L' + g.request_line_id : 'R' + idx,
          lineId: g.request_line_id,
          entryId: g.eqr_time_entry_id,
          requestNumber: g.request_number,
          equipmentName: g.equipment_name || 'Equipment',
          className: g.class_name,
          taskName: g.task_name,
          start: g.start_date,
          end: g.end_date,
          status: String(g.status || '').toUpperCase(),
          hoursType: g.hours_type || '',
          expType: g.expenditure_type || '',
          masterId: g.equipment_master_id,
          hours: hours,
          prefilled: !!(defaultHrs && defaultHrs > 0),
          totalBill: Number(src.totalBill || 0),
          viewHours: Number(src.totalHours || 0),
        };
      });
    }

    /** Header status of the week, old refreshGridByWeekChain's rule. */
    headerStatus(apiRows) {
      const rows = (Array.isArray(apiRows) ? apiRows : []).filter((r) => r && r.isRentable !== 'N');
      if (!rows.length) {
        return '';
      }
      const st = (r) => String(r.entryStatus || '').toUpperCase();
      if (rows.every((r) => st(r) === 'POSTED')) return 'POSTED';
      if (rows.every((r) => st(r) === 'APPROVED' || st(r) === 'POSTED')) return 'APPROVED';
      if (rows.every((r) => ['SUBMITTED', 'APPROVED', 'POSTED'].indexOf(st(r)) >= 0)) return 'SUBMITTED';
      return 'DRAFT';
    }

    isEditable(row, readOnly) {
      return !readOnly && !!row && !!EDITABLE[String(row.status || '')];
    }

    cellEditable(row, day, readOnly) {
      return this.isEditable(row, readOnly) && !!day && weeks.inSpan(day.iso, row.start, row.end);
    }

    // ── values (row + edits) ─────────────────────────────────────────────────

    cellRaw(row, i, edits) {
      const k = row.key + '|d' + i;
      if (isSet(edits, k)) {
        return edits[k] == null ? '' : String(edits[k]);
      }
      const v = row.hours[i];
      return v ? String(v) : '0';
    }

    hoursOf(row, edits) {
      return [0, 1, 2, 3, 4, 5, 6].map((i) => {
        const n = num(this.cellRaw(row, i, edits));
        return isNaN(n) ? 0 : n;
      });
    }

    typeOf(row, edits) {
      const k = row.key + '|type';
      return isSet(edits, k) ? String(edits[k] || '') : (row.hoursType || '');
    }

    expOf(row, edits) {
      const k = row.key + '|exp';
      return isSet(edits, k) ? String(edits[k] || '') : (row.expType || '');
    }

    rowTotal(row, edits) {
      return round2(this.hoursOf(row, edits).reduce((s, h) => s + h, 0));
    }

    dayTotals(rows, edits) {
      const out = [0, 0, 0, 0, 0, 0, 0];
      (rows || []).forEach((r) => this.hoursOf(r, edits).forEach((h, i) => { out[i] += h; }));
      return out.map(round2);
    }

    weekTotal(rows, edits) {
      return round2((rows || []).reduce((s, r) => s + this.rowTotal(r, edits), 0));
    }

    /** "Usage 92 · Standby 4" for the footer; a row with no type counts as Usage (the save sends USAGE). */
    typeTotals(rows, edits) {
      const by = {};
      (rows || []).forEach((r) => {
        const t = this.typeOf(r, edits) || 'USAGE';
        by[t] = (by[t] || 0) + this.rowTotal(r, edits);
      });
      return RATE_TYPES.filter((t) => by[t.value]).map((t) => ({ value: t.value, label: t.label, hours: round2(by[t.value]) }));
    }

    typeTotalsText(rows, edits) {
      return this.typeTotals(rows, edits).map((t) => t.label.toLowerCase() + ' ' + t.hours).join(' · ');
    }

    /** True when the row differs from what was loaded (hours or rate type). */
    isRowDirty(row, edits) {
      if (this.typeOf(row, edits) !== (row.hoursType || '')) {
        return true;
      }
      return this.hoursOf(row, edits).some((h, i) => h !== (Number(row.hours[i]) || 0));
    }

    isExpDirty(row, edits) {
      return this.expOf(row, edits) !== (row.expType || '');
    }

    dirtyCount(rows, edits) {
      return (rows || []).filter((r) => this.isRowDirty(r, edits) || this.isExpDirty(r, edits)).length;
    }

    /** Rows that would be written by Save: changed rows with an entry, and every row with no entry yet. */
    pendingCount(rows, edits) {
      return (rows || []).filter((r) => (!r.entryId && this.rowTotal(r, edits) > 0) || (r.entryId && this.isRowDirty(r, edits))
        || this.isExpDirty(r, edits)).length;
    }

    // ── checks ───────────────────────────────────────────────────────────────

    expUnit(value, list) {
      const l = (Array.isArray(list) && list.length) ? list : EXP_TYPE_SEED;
      const hit = value ? l.find((o) => o && o.value === value) : null;
      return hit && hit.uom ? String(hit.uom) : '';
    }

    /** getHoursMax: 24, or 1 for a Day-based expenditure type (1 means a whole day), 99 for Each. */
    hoursMax(row, edits, list) {
      const u = this.expUnit(this.expOf(row, edits), list).toUpperCase();
      if (u === 'DAY' || u === 'DAYS' || u === 'DY') return 1;
      if (u === 'EACH' || u === 'EA') return 99;
      return 24;
    }

    /** CSS state of one hours box: '' | 'bad' (not a number, below 0 or above the cap). */
    cellState(row, i, edits, list) {
      const n = num(this.cellRaw(row, i, edits));
      if (isNaN(n) || n < 0 || n > this.hoursMax(row, edits, list)) {
        return 'bad';
      }
      return '';
    }

    /**
     * What stops a save, as sentences naming the equipment and day ("Wed 4 Nov on CAT 320: 26 h; a day can't exceed
     * 24 h."). Checked before any call so a bad week never half-saves.
     */
    problems(rows, edits, weekDays, list) {
      const out = [];
      (rows || []).forEach((r) => {
        if (!this.isEditable(r, false)) {
          return;
        }
        const max = this.hoursMax(r, edits, list);
        for (let i = 0; i < 7; i++) {
          const raw = this.cellRaw(r, i, edits);
          const n = num(raw);
          const day = (weekDays && weekDays[i] && weekDays[i].label) || ('day ' + (i + 1));
          if (isNaN(n)) {
            out.push(day + ' on ' + r.equipmentName + ': "' + raw + '" is not a number.');
          } else if (n < 0) {
            out.push(day + ' on ' + r.equipmentName + ': hours cannot be negative.');
          } else if (n > max) {
            out.push(day + ' on ' + r.equipmentName + ': ' + n + (max === 1 ? '; this line is entered in days, so a day is at most 1.'
              : ' h; a day can\'t exceed ' + max + ' h.'));
          }
        }
      });
      return out;
    }

    /** validateRateTypes, over the rows being submitted. Same sentence as the old page. */
    validateRateTypes(rows, edits, keys) {
      const missing = [];
      (rows || []).forEach((r, i) => {
        if (keys && keys.indexOf(r.key) === -1) return;
        if (!String(this.typeOf(r, edits) || '').trim()) missing.push(i + 1);
      });
      if (!missing.length) {
        return null;
      }
      return 'Rate Type is required for row' + (missing.length > 1 ? 's' : '') + ' ' + missing.join(', ')
        + '. Please select a Rate Type before submitting.';
    }

    /**
     * validateExpenditureTypes (PPM rates only): every line with hours this week needs a type the list offers,
     * because the approved hours post to Fusion under it and Fusion only refuses a missing one after approval.
     */
    validateExpenditureTypes(rows, edits, list) {
      const allowed = {};
      ((Array.isArray(list) && list.length) ? list : EXP_TYPE_SEED).forEach((o) => { if (o && o.value) allowed[String(o.value)] = 1; });
      const missing = [];
      const unknown = [];
      (rows || []).forEach((r, i) => {
        if (!(this.rowTotal(r, edits) > 0)) return;
        const t = this.expOf(r, edits);
        if (!t) missing.push(i + 1);
        else if (!allowed[t]) unknown.push('row ' + (i + 1) + ' ("' + t + '")');
      });
      if (!missing.length && !unknown.length) {
        return null;
      }
      const msg = [];
      if (missing.length) {
        msg.push('Expenditure Type is required for row' + (missing.length > 1 ? 's' : '') + ' ' + missing.join(', ') + '.');
      }
      if (unknown.length) {
        msg.push('Not an expenditure type in the list: ' + unknown.join(', ') + '.');
      }
      return msg.join(' ') + ' Hours post to Fusion PPM under this type, so please pick one before submitting.';
    }

    // ── what Save sends ──────────────────────────────────────────────────────

    /**
     * prepareChangeSets: a row WITH a time entry is an update when it changed; a row WITHOUT one is always a create
     * (the pre-filled default hours are what makes it worth saving). Bodies are the grid's snake_case shape the old
     * save chains read: hours_day1..7, hours_type, request_line_id.
     */
    changeSet(rows, edits) {
      const updates = [];
      const creates = [];
      (rows || []).forEach((r) => {
        if (!this.isEditable(r, false)) return;
        const h = this.hoursOf(r, edits);
        const body = { hours_type: this.typeOf(r, edits) || null, request_line_id: r.lineId || null };
        h.forEach((v, i) => { body['hours_day' + (i + 1)] = v; });
        if (r.entryId) {
          if (this.isRowDirty(r, edits)) updates.push({ id: r.entryId, key: r.key, body });
        } else {
          creates.push({ key: r.key, body });
        }
      });
      return { updates, creates };
    }

    /**
     * prepareExpTypeChanges: per request LINE, the last changed value wins, a value is never cleared from here, and
     * a value the list does not offer is ignored (it would only fail at OIC submit, after the week is recorded).
     */
    expTypeChanges(rows, edits, list) {
      const allowed = {};
      ((Array.isArray(list) && list.length) ? list : EXP_TYPE_SEED).forEach((o) => { if (o && o.value) allowed[String(o.value)] = 1; });
      const byLine = {};
      (rows || []).forEach((r) => {
        if (!r.lineId) return;
        const cur = this.expOf(r, edits) || null;
        if (cur === (r.expType || null) || cur === null || !allowed[cur]) return;
        byLine[r.lineId] = cur;
      });
      return Object.keys(byLine).map((lid) => ({ requestLineId: Number(lid), expenditureType: byLine[lid] }));
    }

    /** Submit phase 2: the saved entries of the picked rows that are not already SUBMITTED or APPROVED. */
    submitIds(apiRows, entryIds, lineIds) {
      const ids = new Set((entryIds || []).map(Number));
      const lines = new Set((lineIds || []).map(Number));
      return (Array.isArray(apiRows) ? apiRows : [])
        .filter((r) => r.eqrTimeEntryId && (ids.has(Number(r.eqrTimeEntryId)) || lines.has(Number(r.requestLineId)))
          && r.entryStatus !== 'SUBMITTED' && r.entryStatus !== 'APPROVED')
        .map((r) => r.eqrTimeEntryId);
    }

    /** Copy last week (FDD S20): its hours and rate type onto the same lines, only on days this week allows. */
    copyFrom(prevApiRows, rows, edits, weekStart) {
      const prev = {};
      (Array.isArray(prevApiRows) ? prevApiRows : []).forEach((r) => { if (r && r.requestLineId) prev[r.requestLineId] = r; });
      const days = weeks.weekDays(weekStart);
      const next = Object.assign({}, edits || {});
      let copied = 0;
      (rows || []).forEach((r) => {
        const p = r.lineId ? prev[r.lineId] : null;
        if (!p || !this.isEditable(r, false)) return;
        let any = false;
        for (let i = 0; i < 7; i++) {
          if (!weeks.inSpan(days[i] && days[i].iso, r.start, r.end)) continue;
          const v = Number(p['day' + (i + 1) + 'Hours']) || 0;
          next[r.key + '|d' + i] = v;
          any = true;
        }
        if (p.hoursType && !this.typeOf(r, next)) {
          next[r.key + '|type'] = String(p.hoursType);
        }
        if (any) copied++;
      });
      return { edits: next, copied };
    }

    // ── display ──────────────────────────────────────────────────────────────

    /** The same rows as new objects, so oj-bind-for-each redraws them (see editChain). */
    freshRows(rows) {
      return (rows || []).map((r) => Object.assign({}, r));
    }

    pickedCount(picked) {
      return picked ? Object.keys(picked).filter((k) => picked[k]).length : 0;
    }

    isPicked(picked, key) {
      return !!(picked && picked[key]);
    }

    money(n) {
      return money(n);
    }

    /** The line's rate as priced when the request was raised (rate schedule or agreement): "$1,400 / DAY". */
    rateText(row, lineRates) {
      const r = row && row.lineId && lineRates ? lineRates[row.lineId] : null;
      if (!r || r.billRate == null || r.billRate === '') {
        return '';
      }
      const uom = String(r.priceUom || '').trim().toUpperCase();
      return money(r.billRate) + (uom ? ' / ' + uom : '');
    }

    statusText(status) {
      const s = String(status || '').toUpperCase();
      return s ? s.charAt(0) + s.slice(1).toLowerCase() : 'Not saved';
    }

    statusClass(status) {
      const s = String(status || '').toUpperCase();
      return 'er-status er-status--' + (s || 'DRAFT');
    }

    /** One chip per request in the queue (views/timesheets): "REQ-10482 · 40 h". */
    queueRows(queue, text) {
      const q = String(text || '').trim().toLowerCase();
      return (Array.isArray(queue) ? queue : []).filter((r) => !q
        || [r.requestNumber, r.projectName, r.taskName].some((v) => v && String(v).toLowerCase().includes(q)));
    }

    /** The old Export CSV, from what is on screen. */
    csv(rows, edits, weekDays) {
      const q = (v) => {
        const s = v == null ? '' : String(v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const head = ['Request Number', 'Equipment Name', 'Class', 'Task Name', 'Rate Type', 'Expenditure Type']
        .concat((weekDays || []).map((d) => d.iso + ' Hours')).concat(['Total', 'Status']);
      const lines = [head.map(q).join(',')];
      (rows || []).forEach((r) => {
        lines.push([r.requestNumber, r.equipmentName, r.className, r.taskName, this.typeOf(r, edits), this.expOf(r, edits)]
          .concat(this.hoursOf(r, edits)).concat([this.rowTotal(r, edits), r.status]).map(q).join(','));
      });
      return lines.join('\r\n');
    }

    /**
     * Keyboard entry in the grid: Enter / Down to the same day on the next row, Up to the row above, Left / Right
     * across days when the caret is at the edge. Moving focus commits the box (its change event), so typing a week
     * is "8 → 8 → 8 …" without the mouse.
     */
    gridKey(event) {
      const t = event && event.target;
      if (!t || !t.dataset || t.dataset.r === undefined) {
        return;
      }
      const r = Number(t.dataset.r);
      const d = Number(t.dataset.d);
      let nr = r;
      let nd = d;
      const val = String(t.value || '');
      if (event.key === 'Enter' || event.key === 'ArrowDown') {
        nr = r + 1;
      } else if (event.key === 'ArrowUp') {
        nr = r - 1;
      } else if (event.key === 'ArrowRight' && t.selectionStart === val.length) {
        nd = d + 1;
      } else if (event.key === 'ArrowLeft' && t.selectionEnd === 0) {
        nd = d - 1;
      } else {
        return;
      }
      const grid = t.closest ? t.closest('[data-grid]') : null;
      if (!grid) {
        return;
      }
      // Skip boxes that are closed (outside the line's dates, or a submitted row) in the direction of travel.
      for (let step = 0; step < 40; step++) {
        const next = grid.querySelector('input[data-r="' + nr + '"][data-d="' + nd + '"]');
        if (!next) {
          return;
        }
        if (!next.disabled) {
          event.preventDefault();
          next.focus();
          if (next.select) next.select();
          return;
        }
        if (nr !== r) nr += (nr > r ? 1 : -1); else nd += (nd > d ? 1 : -1);
      }
    }

    /** Select the box's contents on focus, so a typed number replaces the old one. */
    selectAll(event) {
      const t = event && event.target;
      if (t && t.select) {
        t.select();
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════
  // EquipRite Next's own layer. Reads only; every rule it leans on is New's (above).
  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════

  // A time entry's stored status in words, and the journey colour it reads as (next.css .nx-stage--<tone>).
  const STATUS = {
    '': { word: 'Not saved yet', tone: 'draft' },
    DRAFT: { word: 'Draft, not submitted', tone: 'draft' },
    SUBMITTED: { word: 'Waiting for approval', tone: 'approval' },
    APPROVED: { word: 'Approved', tone: 'onsite' },
    REJECTED: { word: 'Sent back to correct', tone: 'stopped' },
    POSTED: { word: 'Approved and posted', tone: 'done' },
  };
  // A weekday (Monday to Friday) inside a line's dates, up to today, with no hours is worth a look.
  const WORKDAYS = 5;
  // The request list's chips: what each request's current week (views/timesheets) still needs.
  const QUEUE_KINDS = [
    { key: 'all', label: 'All' },
    { key: 'todo', label: 'To fill in' },
    { key: 'waiting', label: 'Waiting for approval' },
    { key: 'approved', label: 'Approved' },
  ];

  const up = (v) => String(v == null ? '' : v).trim().toUpperCase();

  class TimeEntry extends TimeEntryRules {
    statusWord(status) {
      const s = STATUS[up(status)];
      return s ? s.word : this.statusText(status);
    }

    statusTone(status) {
      const s = STATUS[up(status)];
      return s ? s.tone : 'draft';
    }

    /** The week as a whole, from New's headerStatus. */
    weekWord(headerStatus, rows) {
      if (!(rows || []).length) return 'Nothing to enter';
      return headerStatus ? this.statusWord(headerStatus) : 'Not saved yet';
    }

    rateTypeLabel(value) {
      const hit = RATE_TYPES.find((t) => t.value === up(value));
      return hit ? hit.label : '';
    }

    /** Monday to Friday of the week, as labels ("Mon 26 Oct"), for the column heads. */
    dayHead(day) {
      return day ? day.dow + ' ' + day.num : '';
    }

    isToday(day, todayIso) {
      return !!day && day.iso === (todayIso || weeks.today());
    }

    /**
     * What this week still needs, line by line, before it can be approved: a line sent back, a rate type (Submit
     * refuses without it), an expenditure type under Fusion PPM rates (Submit refuses without it), and weekdays inside
     * the line's dates, up to today, with no hours. [] when nothing is missing.
     */
    missing(rows, edits, weekDays, ppmOn, todayIso) {
      const today = todayIso || weeks.today();
      const out = [];
      (rows || []).forEach((r) => {
        if (up(r.status) === 'REJECTED') {
          out.push({ key: r.key + '|back', tone: 'stopped', text: r.equipmentName + ': sent back by the approver. Correct the hours, then submit again.' });
        }
        if (!this.isEditable(r, false)) return;
        if (!String(this.typeOf(r, edits) || '').trim()) {
          out.push({ key: r.key + '|type', tone: 'warn', text: r.equipmentName + ': choose a rate type; Submit needs one.' });
        }
        if (ppmOn && this.rowTotal(r, edits) > 0 && !this.expOf(r, edits)) {
          out.push({ key: r.key + '|exp', tone: 'warn', text: r.equipmentName + ': choose an expenditure type; the hours go to Fusion PPM under it.' });
        }
        const hours = this.hoursOf(r, edits);
        const gaps = (weekDays || []).filter((d) => d.i < WORKDAYS && d.iso <= today && weeks.inSpan(d.iso, r.start, r.end) && !(hours[d.i] > 0));
        if (gaps.length) {
          out.push({ key: r.key + '|gap', tone: 'warn', text: r.equipmentName + ': no hours on ' + gaps.map((d) => d.label).join(', ') + '.' });
        }
      });
      return out;
    }

    /** "Usage 85 h · Standby 4 h", from New's typeTotals. */
    typeTotalsWords(rows, edits) {
      return this.typeTotals(rows, edits).map((t) => t.label + ' ' + t.hours + ' h').join(' · ');
    }

    /** Days of a row with no hours that `missing` names, as a lookup { i: true }, to mark the boxes. */
    gapDays(row, edits, weekDays, todayIso) {
      const today = todayIso || weeks.today();
      const out = {};
      if (!this.isEditable(row, false)) return out;
      const hours = this.hoursOf(row, edits);
      (weekDays || []).forEach((d) => {
        if (d.i < WORKDAYS && d.iso <= today && weeks.inSpan(d.iso, row.start, row.end) && !(hours[d.i] > 0)) out[d.i] = true;
      });
      return out;
    }

    isGap(row, edits, weekDays, day, todayIso) {
      return !!(day && this.gapDays(row, edits, weekDays, todayIso)[day.i]);
    }

    /** The week in one line: "2 lines · 85 h · 1 to save · 2 to submit · 0 waiting". */
    weekFacts(rows, edits, picked) {
      const list = rows || [];
      return {
        lines: list.length,
        hours: this.weekTotal(list, edits),
        toSave: this.pendingCount(list, edits),
        toSubmit: this.pickedCount(picked),
        open: list.filter((r) => this.isEditable(r, false)).length,
        waiting: list.filter((r) => up(r.status) === 'SUBMITTED').length,
        approved: list.filter((r) => up(r.status) === 'APPROVED' || up(r.status) === 'POSTED').length,
      };
    }

    // ── the request list (views/timesheets: one row per request, its current week) ──

    queueKind(status) {
      const s = up(status);
      if (s === 'SUBMITTED') return 'waiting';
      if (s === 'APPROVED' || s === 'POSTED') return 'approved';
      return 'todo';
    }

    queueChips(queue) {
      const list = Array.isArray(queue) ? queue : [];
      return QUEUE_KINDS.map((k) => ({
        key: k.key,
        label: k.label,
        count: k.key === 'all' ? list.length : list.filter((r) => this.queueKind(r.status) === k.key).length,
      }));
    }

    /** New's queueRows (search), then the chip. */
    queueShown(queue, text, kind) {
      return this.queueRows(queue, text).filter((r) => !kind || kind === 'all' || this.queueKind(r.status) === kind);
    }

    /** "Draft · 40 h", "Waiting for approval · 40 h", "Not started". */
    queueNote(r) {
      if (!r) return '';
      const hrs = Number(r.totalHours) || 0;
      if (!r.eqrTimeEntryId && !hrs) return 'Not started';
      return this.statusWord(r.status) + ' · ' + hrs + ' h';
    }

    // ── export: the week as shown, typed values included ──

    exportColumns(weekDays) {
      const cols = [
        { key: 'requestNumber', label: 'Request' },
        { key: 'equipmentName', label: 'Equipment' },
        { key: 'className', label: 'Class' },
        { key: 'taskName', label: 'Task' },
        { key: 'rateType', label: 'Rate type' },
        { key: 'expType', label: 'Expenditure type' },
      ];
      (weekDays || []).forEach((d) => cols.push({ key: 'd' + d.i, label: d.label, type: 'number' }));
      return cols.concat([
        { key: 'total', label: 'Total hours', type: 'number' },
        { key: 'word', label: 'Status' },
        { key: 'status', label: 'Stored status' },
      ]);
    }

    exportRows(rows, edits) {
      return (rows || []).map((r) => {
        const out = {
          requestNumber: r.requestNumber,
          equipmentName: r.equipmentName,
          className: r.className || '',
          taskName: r.taskName || '',
          rateType: this.rateTypeLabel(this.typeOf(r, edits)),
          expType: this.expOf(r, edits),
          total: this.rowTotal(r, edits),
          word: this.statusWord(r.status),
          status: r.status || '',
        };
        this.hoursOf(r, edits).forEach((h, i) => { out['d' + i] = h; });
        return out;
      });
    }

    queueColumns() {
      return [
        { key: 'requestNumber', label: 'Request' },
        { key: 'projectName', label: 'Project' },
        { key: 'taskName', label: 'Task' },
        { key: 'weekStartDate', label: 'Week starting' },
        { key: 'equipCount', label: 'Equipment', type: 'number' },
        { key: 'totalHours', label: 'Hours', type: 'number' },
        { key: 'word', label: 'Status', value: (r) => (r.eqrTimeEntryId || Number(r.totalHours) ? this.statusWord(r.status) : 'Not started') },
        { key: 'status', label: 'Stored status' },
      ];
    }
  }

  return { TimeEntryRules, TimeEntry, RATE_TYPES, STATUS };
});
