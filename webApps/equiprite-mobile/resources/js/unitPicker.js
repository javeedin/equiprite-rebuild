define([], function () {
  'use strict';

  // The unit picker of one request line: which units are free over the line's dates, what is staged to assign or
  // release, and what Save will write. Nothing is written here; approveAllocate.saveAllocation writes what
  // getStagedChanges() returns.
  //
  // COPIED from New EquipRite's Approve & allocate page module (webApps/equiprite/flows/workbench/pages/
  // approve-allocate-page.js, "Unit picker"), which carries it over from the old line-detail page module:
  // initUnits, getStagedChanges, remainingCapacity, stageAssign, stageLot, setLotQty, stageRelease, cancelStage,
  // fillFree, allocationSummary, scheduleWindow, unitRows, windowBand. Their bodies are unchanged, so staging
  // (the line quantity cap, a lot's free quantity, what a confirmed or read-only line refuses) is the same.
  // tests/next-approvals.test.js runs both side by side. Added for Next, read only: suggestions() and plan(), the
  // staged changes in words.

  const parseDay = (v) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000 : null;
  };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayLabel = (n) => {
    const d = new Date(n * 86400000);
    return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
  };

  class Picker {
    constructor() {
      this._mode = 'serial';
      this._lineData = null;
      this._resources = [];
      this._allocated = [];
      this._bookings = [];
      this._ownRequest = '';
      this._confirmed = false;
      this._readOnly = false;
      this._pendingAssignments = [];
      this._pendingReleases = [];
      this._draftQty = {};
    }

    /**
     * Load the picker for one line (old initScheduler without the scheduler). Resets staging.
     * @param resources  lineDetailUnits.buildResources(...).resources
     * @param allocated  lineDetailUnits.buildResources(...).allocated
     * @param lineData   { line_id, qty, start_date, end_date, … }
     * @param mode       'serial' | 'lot' | 'inventory'
     * @param confirmed  a live Transfer Order on this line (lineConfirmed): read only
     * @param readOnly   customer line at UNDER_PROCUREMENT, or a read-only role
     * @param bookings   views/line-detail-bookings rows (serial mode), for the schedule
     * @param ownRequest this request's number (its own bookings are drawn from the allocations instead)
     */
    initUnits(resources, allocated, lineData, mode, confirmed, readOnly, bookings, ownRequest) {
      this._mode = (mode === 'lot' || mode === 'inventory') ? mode : 'serial';
      this._resources = Array.isArray(resources) ? resources : [];
      this._allocated = Array.isArray(allocated) ? allocated : [];
      this._lineData = lineData || null;
      this._confirmed = !!confirmed;
      this._readOnly = !!readOnly;
      this._bookings = Array.isArray(bookings) ? bookings : [];
      this._ownRequest = ownRequest || '';
      this._pendingAssignments = [];
      this._pendingReleases = [];
      this._draftQty = {};
    }

    /** Read by saveAllocation (old saveLineChain reads the same from the old page module). */
    getStagedChanges() {
      return {
        mode:               this._mode,
        pendingAssignments: this._pendingAssignments.slice(),
        pendingReleases:    this._pendingReleases.slice(),
      };
    }

    lineData() {
      return this._lineData;
    }

    isQtyMode() {
      return this._mode === 'lot' || this._mode === 'inventory';
    }

    _resource(id) {
      return this._resources.find((r) => String(r.id) === String(id)) || null;
    }

    /** _remainingLineCapacity: line quantity less (allocated − staged releases + staged assignments). */
    remainingCapacity() {
      const target = (this._lineData && this._lineData.qty) || 1;
      const qtyMode = this.isQtyMode();
      const allocatedNow = qtyMode
        ? this._allocated.reduce((sum, a) => sum + Number(a.allocatedQty || 0), 0)
        : this._allocated.length;
      const releasing = qtyMode
        ? this._pendingReleases.reduce((sum, r) => sum + Number(r.qty || r.allocatedQty || 0), 0)
        : this._pendingReleases.length;
      const staging = qtyMode
        ? this._pendingAssignments.reduce((sum, a) => sum + Number(a.qty || 0), 0)
        : this._pendingAssignments.length;
      return Math.max(0, target - (allocatedNow - releasing + staging));
    }

    _locked() {
      return this._confirmed || this._readOnly;
    }

    /** _stageAssign (serial). Returns 'STAGED', 'FULL', 'GONE' or 'LOCKED'. */
    stageAssign(id) {
      if (this._locked()) return 'LOCKED';
      const resource = this._resource(id);
      if (!resource || resource.status !== 'available') return 'GONE';
      if (this._pendingAssignments.some((p) => String(p.resourceId) === String(resource.id))) return 'STAGED';
      if (this.remainingCapacity() <= 0) return 'FULL';
      this._pendingAssignments.push({
        eqrSerialRefId: resource.eqrSerialRefId != null ? resource.eqrSerialRefId
          : (resource.unitRefId != null ? resource.unitRefId : resource.id),
        resourceId:   resource.id,
        serialNumber: resource.serialNumber,
        invOrgId:     resource.invOrgId != null ? resource.invOrgId : null,
        invOrgName:   resource.invOrgName || '',
      });
      return 'STAGED';
    }

    /** _onLotStageAssign (lot / inventory): qty clamped to the lot's free quantity and the line's remaining need. */
    stageLot(id, qty) {
      if (this._locked()) return 'LOCKED';
      const resource = this._resource(id);
      if (!resource) return 'GONE';
      const avail = Number(resource.availableQty || 0);
      if (avail < 1) return 'GONE';
      this._pendingAssignments = this._pendingAssignments.filter((p) => String(p.lotRefId) !== String(resource.id));
      const remaining = this.remainingCapacity();
      if (remaining <= 0) return 'FULL';
      const want = qty != null && qty !== '' ? Number(qty) : (this._draftQty[resource.id] || Math.min(avail, remaining));
      const clamped = Math.max(1, Math.min(Number(want || 1), avail, remaining));
      const staged = {
        lotRefId:  resource.id,
        eqrLotRefId: resource.eqrLotRefId != null ? resource.eqrLotRefId
          : (resource.unitRefId != null ? resource.unitRefId : resource.id),
        inventoryItemRefId: resource.inventoryItemRefId != null ? resource.inventoryItemRefId
          : (resource.unitRefId != null ? resource.unitRefId : resource.id),
        lotNumber: resource.lotNumber || '',
        qty:       clamped,
        invOrgId:   resource.invOrgId != null ? resource.invOrgId : null,
        invOrgName: resource.invOrgName || '',
      };
      if (this._mode === 'inventory') {
        staged.itemNumber = resource.itemNumber || resource.lotNumber || '';
      }
      this._pendingAssignments.push(staged);
      return 'STAGED';
    }

    /** The quantity box on a lot row: updates a staged lot (_onLotQtyChanged) or remembers it for Assign. */
    setLotQty(id, qty) {
      const n = Math.max(1, Math.floor(Number(qty) || 1));
      const existing = this._pendingAssignments.find((p) => String(p.lotRefId) === String(id));
      if (!existing) {
        this._draftQty[id] = n;
        return;
      }
      const resource = this._resource(id);
      if (!resource) return;
      const avail = Number(resource.availableQty || 0);
      const remaining = this.remainingCapacity() + Number(existing.qty || 0);
      existing.qty = Math.max(1, Math.min(n, avail, remaining));
    }

    /** _onStageRelease. */
    stageRelease(id) {
      if (this._locked()) return 'LOCKED';
      const resource = this._resource(id);
      if (!resource || resource.allocationId == null) return 'GONE';
      if (this._pendingReleases.some((p) => p.allocationId === resource.allocationId)) return 'STAGED';
      if (this.isQtyMode()) {
        const rel = {
          allocationId: resource.allocationId,
          eqrLotRefId: resource.eqrLotRefId != null ? resource.eqrLotRefId
            : (resource.unitRefId != null ? resource.unitRefId : resource.id),
          inventoryItemRefId: resource.inventoryItemRefId != null ? resource.inventoryItemRefId
            : (resource.unitRefId != null ? resource.unitRefId : resource.id),
          lotNumber: resource.lotNumber,
          qty:       Number(resource.allocatedQty || 0),
        };
        if (this._mode === 'inventory') {
          rel.itemNumber = resource.itemNumber || resource.lotNumber || '';
        }
        this._pendingReleases.push(rel);
        return 'STAGED';
      }
      this._pendingReleases.push({
        allocationId: resource.allocationId,
        eqrSerialRefId: resource.eqrSerialRefId != null ? resource.eqrSerialRefId
          : (resource.unitRefId != null ? resource.unitRefId : resource.id),
        serialNumber: resource.serialNumber,
      });
      return 'STAGED';
    }

    /** _onCancelStageAssign / _onCancelStageRelease. */
    cancelStage(id) {
      const resource = this._resource(id);
      this._pendingAssignments = this._pendingAssignments.filter((p) => String(p.resourceId) !== String(id)
        && String(p.lotRefId) !== String(id));
      if (resource && resource.allocationId != null) {
        this._pendingReleases = this._pendingReleases.filter((p) => p.allocationId !== resource.allocationId);
      }
    }

    /**
     * Fill the line from free units, in the order the view lists them, up to the line's remaining quantity. Stages
     * only: nothing is written until Save, and Save writes exactly what a manual Assign would. Returns the count staged.
     */
    fillFree() {
      if (this._locked()) return 0;
      let staged = 0;
      for (const r of this._resources) {
        if (this.remainingCapacity() <= 0) break;
        if (r.allocationId != null) continue;
        if (this._pendingAssignments.some((p) => String(p.resourceId) === String(r.id) || String(p.lotRefId) === String(r.id))) continue;
        if (this.isQtyMode()) {
          if (Number(r.availableQty || 0) >= 1 && this.stageLot(r.id, Math.min(Number(r.availableQty), this.remainingCapacity())) === 'STAGED') staged++;
        } else if (r.status === 'available' && this.stageAssign(r.id) === 'STAGED') {
          staged++;
        }
      }
      return staged;
    }

    /** "2 / 3 serials allocated (1 pending)" and whether Save has anything to do (old _updateAllocationProgress). */
    allocationSummary(tick) {
      const target = (this._lineData && this._lineData.qty) || 1;
      const qtyMode = this.isQtyMode();
      const allocated = qtyMode ? this._allocated.reduce((s, a) => s + Number(a.allocatedQty || 0), 0) : this._allocated.length;
      const pendAssn = qtyMode ? this._pendingAssignments.reduce((s, a) => s + Number(a.qty || 0), 0) : this._pendingAssignments.length;
      const pendRel = qtyMode ? this._pendingReleases.reduce((s, r) => s + Number(r.qty || r.allocatedQty || 0), 0) : this._pendingReleases.length;
      const effective = allocated - pendRel + pendAssn;
      const noun = qtyMode ? 'units' : 'serials';
      const pending = this._pendingAssignments.length + this._pendingReleases.length;
      return {
        target,
        allocated,
        effective,
        pct: target > 0 ? Math.min(100, Math.round((effective / target) * 100)) : 0,
        pending,
        canSave: pending > 0 && !this._locked(),
        free: this._resources.filter((r) => r.allocationId == null && (qtyMode ? Number(r.availableQty || 0) >= 1 : r.status === 'available')).length,
        remaining: this.remainingCapacity(),
        locked: this._locked(),
        confirmed: this._confirmed,
        text: `${effective} / ${target} ${noun} allocated` + (pending ? ` (${pending} pending)` : ''),
      };
    }

    /** The schedule window: the line's dates with a week either side. { start, end, days, ticks: [{ label, left }] } */
    scheduleWindow() {
      const s = parseDay(this._lineData && this._lineData.start_date);
      const e = parseDay(this._lineData && this._lineData.end_date);
      if (s === null || e === null) return null;
      const start = s - 7;
      const end = Math.max(e, s) + 8;
      const days = end - start;
      const step = days > 70 ? 14 : 7;
      const ticks = [];
      for (let d = start; d < end; d += step) {
        ticks.push({ label: dayLabel(d), left: Math.round(((d - start) / days) * 1000) / 10 });
      }
      return { start, end, days, ticks, from: s, to: e };
    }

    _span(win, from, to) {
      const a = parseDay(from);
      const b = parseDay(to);
      if (a === null || b === null || !win) return null;
      const lo = Math.max(win.start, a);
      const hi = Math.min(win.end, b + 1);
      if (hi <= lo) return null;
      return { left: Math.round(((lo - win.start) / win.days) * 1000) / 10, width: Math.max(1, Math.round(((hi - lo) / win.days) * 1000) / 10) };
    }

    /**
     * The picker rows: each unit with its state, its controls and its bars on the schedule.
     * state: available | assigned | booked | out | staged-assign | staged-release
     */
    unitRows(tick) {
      const win = this.scheduleWindow();
      const locked = this._locked();
      const atCap = this.remainingCapacity() <= 0;
      const qtyMode = this.isQtyMode();
      const lineStart = this._lineData && this._lineData.start_date;
      const lineEnd = this._lineData && this._lineData.end_date;
      const own = String(this._ownRequest || '');
      const reqA = parseDay(lineStart);
      const reqB = parseDay(lineEnd);
      return this._resources.map((r) => {
        const stagedAssign = this._pendingAssignments.find((p) => String(p.resourceId) === String(r.id) || String(p.lotRefId) === String(r.id)) || null;
        const stagedRelease = r.allocationId != null ? this._pendingReleases.find((p) => p.allocationId === r.allocationId) || null : null;
        const avail = Number(r.availableQty || 0);
        let state;
        if (stagedRelease) state = 'staged-release';
        else if (stagedAssign) state = 'staged-assign';
        else if (r.allocationId != null) state = 'assigned';
        else if (qtyMode ? avail >= 1 : r.status === 'available') state = 'available';
        else state = qtyMode ? 'out' : 'booked';
        const LABEL = {
          'staged-release': 'Release on save',
          'staged-assign': qtyMode ? `Assign ${stagedAssign ? stagedAssign.qty : ''} on save` : 'Assign on save',
          assigned: qtyMode ? `Assigned · ${Number(r.allocatedQty || 0)}${r.uomCode ? ` ${r.uomCode}` : ''}` : 'Assigned',
          available: qtyMode ? `${avail}${r.uomCode ? ` ${r.uomCode}` : ''} free` : 'Available',
          booked: 'Booked elsewhere',
          out: 'None free',
        };
        // Bars: other requests' bookings (from line-detail-bookings), this line's own allocation or staged assign.
        const bars = [];
        let conflict = false;
        if (win) {
          this._bookings.forEach((b) => {
            if (!b || Number(b.unitRefId) !== Number(r.unitRefId != null ? r.unitRefId : r.id)) return;
            if (String(b.bookingRequestNumber || '') === own) return;
            const span = this._span(win, b.bookingStartDate, b.bookingEndDate);
            if (!span) return;
            const ba = parseDay(b.bookingStartDate);
            const bb = parseDay(b.bookingEndDate);
            const overlaps = reqA !== null && reqB !== null && ba !== null && bb !== null && ba <= reqB && bb >= reqA;
            if (overlaps) conflict = true;
            bars.push(Object.assign(span, {
              kind: overlaps ? 'conflict' : 'booked',
              label: (b.bookingRequestNumber || 'Booked') + (b.projectName ? ` · ${b.projectName}` : ''),
            }));
          });
          if (state === 'assigned' || state === 'staged-assign' || state === 'staged-release') {
            const span = this._span(win, lineStart, lineEnd);
            if (span) {
              bars.push(Object.assign(span, {
                kind: state === 'assigned' ? (this._confirmed ? 'own-hard' : 'own') : (state === 'staged-assign' ? 'staged' : 'releasing'),
                label: state === 'assigned' ? (this._confirmed ? 'This request (booked)' : 'This request (reserving)')
                  : (state === 'staged-assign' ? 'Assign on save' : 'Release on save'),
              }));
            }
          }
        }
        const qtyCap = Math.min(avail, this.remainingCapacity() + (stagedAssign ? Number(stagedAssign.qty || 0) : 0));
        return {
          id: r.id,
          name: r.name || r.serialNumber || r.lotNumber || String(r.id),
          yard: r.invOrgName || r.location || r.invOrgCode || '',
          state,
          label: LABEL[state],
          conflict,
          bars,
          qtyMode,
          canAssign: !locked && state === 'available' && !atCap,
          assignTitle: atCap ? 'The line quantity is reached' : '',
          canRelease: !locked && state === 'assigned',
          canCancel: !locked && (state === 'staged-assign' || state === 'staged-release'),
          qty: stagedAssign ? stagedAssign.qty : (this._draftQty[r.id] || Math.max(1, Math.min(avail, this.remainingCapacity()))),
          qtyMax: Math.max(1, qtyCap),
        };
      });
    }

    /** The requested-dates band on the schedule ({ left, width }), or null. */
    windowBand() {
      const win = this.scheduleWindow();
      return win ? this._span(win, this._lineData.start_date, this._lineData.end_date) : null;
    }

    pickerMode() {
      return this._mode;
    }

    // ── Added for Next (read only): the staging in words ────────────────────────────────────────────────────

    /** The staged assignments as [{ unit, yard, qty, text }]: "EX-2203 (Houston Yard)", "3 from LOT-A (Houston Yard)". */
    suggestions() {
      const qtyMode = this.isQtyMode();
      return this._pendingAssignments.map((a) => {
        const unit = qtyMode ? (a.itemNumber || a.lotNumber || '') : (a.serialNumber || '');
        const yard = a.invOrgName || '';
        const qty = qtyMode ? Number(a.qty || 0) : 1;
        return { unit, yard, qty, text: (qtyMode ? qty + ' from ' : '') + unit + (yard ? ' (' + yard + ')' : '') };
      });
    }

    /**
     * What Save will do, in words: { assign: [..], release: [..], after, text }. after is the line's count once saved.
     * "Assign EX-2203 (Houston Yard) and release EX-2201. The line will have 1 of 1 unit."
     */
    plan() {
      const qtyMode = this.isQtyMode();
      const assign = this.suggestions().map((s) => s.text);
      const release = this._pendingReleases.map((r) => (qtyMode ? Number(r.qty || r.allocatedQty || 0) + ' from ' : '')
        + (qtyMode ? (r.itemNumber || r.lotNumber || '') : (r.serialNumber || '')));
      const s = this.allocationSummary(0);
      const parts = [];
      if (assign.length) parts.push('assign ' + join(assign));
      if (release.length) parts.push('release ' + join(release));
      const noun = s.target === 1 ? 'unit' : 'units';
      const text = parts.length
        ? cap(parts.join(' and ')) + '. The line will have ' + s.effective + ' of ' + s.target + ' ' + noun + '.'
        : '';
      return { assign, release, after: s.effective, target: s.target, text };
    }
  }

  function join(list) {
    if (list.length <= 1) return list[0] || '';
    return list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
  }
  function cap(t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; }

  return { Picker: Picker };
});
