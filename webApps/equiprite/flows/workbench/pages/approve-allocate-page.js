define([], () => {
  'use strict';

  // Approve & allocate (FDD 7.8, 7.10). Three parts:
  //   - the lines and their tick boxes, with the same interface as Request detail's page module, so the approve and
  //     reject chains copied from it run unchanged (getSelectedLines, getAllLines, getSelectionStateRaw, …);
  //   - the gates the old Workbench detail page applies (equipment-foundation request-detail-page.js:
  //     isLineTerminal, isLinePickable, isRequestSubmitted / isQuoteOwed, isRowLineDetailBlocked);
  //   - the unit picker for one line, carried over from the old line-detail page module (line-detail-page.js:
  //     _pendingAssignments / _pendingReleases, _remainingLineCapacity, _stageAssign, _onLotStageAssign,
  //     _onStageRelease, getStagedChanges), without the Bryntum scheduler: saveAllocationChain reads
  //     getStagedChanges() exactly as the old saveLineChain does.

  const TERMINAL_LINE_STATUSES = ['REJECTED', 'CANCELLED'];
  const QUOTE_EXISTS = ['QUOTE_GENERATED', 'QUOTE_ACCEPTED', 'DEPLOYED'];
  // Approve walks lines forward only from these (confirmRequestChain's CASCADABLE); reject skips these
  // (rejectRequestChain's TERMINAL_STATES). Used here only to say what a click will do before it is made.
  const APPROVABLE = [null, '', 'DRAFT', 'SUBMITTED', 'IN_PROCESS'];
  const REJECT_TERMINAL = ['REJECTED', 'CANCELLED', 'CLOSED', 'CONSUMED'];
  const ALLOCATION_OPEN = ['IN_PROCESS', 'QUOTE_GENERATED', 'QUOTE_ACCEPTED'];

  const up = (v) => String(v || '').toUpperCase();
  const num = (v) => {
    if (v === null || v === undefined || v === '') return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const parseDay = (v) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000 : null;
  };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayLabel = (n) => {
    const d = new Date(n * 86400000);
    return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
  };

  class PageModule {
    constructor() {
      this._lineRefs = [];
      this._selectedRows = new Set();
      // Unit picker state (old line-detail page module), for the one line whose picker is open.
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

    // ── Lines and selection (Request detail's interface) ──────────────────────────────────────────────────────

    /** Called by initChain with the mapped lines; returns them for the lines grid. */
    initGridData(lines) {
      this._lineRefs = Array.isArray(lines) ? lines : [];
      this._selectedRows = new Set();
      return this._lineRefs;
    }

    isRowSelected(index) {
      return this._selectedRows.has(index);
    }

    setRowSelected(index, on) {
      if (on) {
        this._selectedRows.add(index);
      } else {
        this._selectedRows.delete(index);
      }
    }

    setAllSelected(on) {
      this._selectedRows = on ? new Set(this._lineRefs.map((l, i) => i)) : new Set();
    }

    isAllSelected() {
      return this._lineRefs.length > 0 && this._selectedRows.size === this._lineRefs.length;
    }

    getSelectedLines() {
      return Array.from(this._selectedRows).map((i) => this._lineRefs[i]).filter((l) => l != null);
    }

    getAllLines() {
      return this._lineRefs.slice();
    }

    getSelectionStateRaw() {
      const lines = this.getSelectedLines();
      const count = lines.length;
      if (!count) {
        return { count: 0, sharedStatus: '', isMixed: false, allSelected: false, allDeployed: false, allReturnable: false, allShipToSite: false };
      }
      const first = lines[0].lineStatus || '';
      const allSame = lines.every((l) => (l.lineStatus || '') === first);
      return {
        count,
        sharedStatus: allSame ? first : '',
        isMixed: !allSame,
        allSelected: this.isAllSelected(),
        allDeployed: lines.every((l) => l.lineStatus === 'DEPLOYED'),
        allReturnable: lines.every((l) => l.lineStatus === 'DEPLOYED'),
        allShipToSite: lines.every((l) => l.lineStatus === 'SHIP_TO_SITE'),
      };
    }

    // ── What a click will do ──────────────────────────────────────────────────────────────────────────────────

    /**
     * Approve or reject on the ticked lines, or every line when none is ticked (the copied chains' rule):
     * { count, all, label, note }. count is how many lines the chain will change; the others are already settled.
     */
    decisionPlan(kind, lines, selectedCount, tick) {
      const all = Array.isArray(lines) ? lines : [];
      const pool = selectedCount > 0 ? this.getSelectedLines() : all;
      const acts = kind === 'reject'
        ? pool.filter((l) => REJECT_TERMINAL.indexOf(up(l.lineStatus)) === -1)
        : pool.filter((l) => APPROVABLE.indexOf(l.lineStatus) !== -1);
      const n = acts.length;
      const verb = kind === 'reject' ? 'Reject' : 'Approve';
      let label;
      if (!n) {
        label = verb;
      } else if (selectedCount > 0) {
        label = `${verb} ${n} ${n === 1 ? 'line' : 'lines'}`;
      } else {
        label = n === 1 ? `${verb} the line` : `${verb} all ${n} lines`;
      }
      return { count: n, all: !(selectedCount > 0), label, settled: pool.length - n };
    }

    /**
     * The one sentence above the lines: is the request ready, what will happen next, what is in the way.
     * { tone: 'ok' | 'warn' | 'info', text }
     */
    verdict(formData, lines, quotingAllowed) {
      const fd = formData || {};
      const status = up(fd.status);
      const list = Array.isArray(lines) ? lines : [];
      const live = list.filter((l) => TERMINAL_LINE_STATUSES.indexOf(up(l.line_status)) === -1);
      const unavailable = live.filter((l) => /NOT AVAILABLE/i.test(l.availability || ''));
      const partial = live.filter((l) => /PARTIAL/i.test(l.availability || ''));
      const pickable = live.filter((l) => this.isPickable(l));
      const missing = pickable.filter((l) => l.alloc_status !== 'ALLOCATED');
      const quoteOwed = this.isQuoteOwed(status, quotingAllowed);
      const avail = [];
      if (unavailable.length) avail.push(`${this.lineList(unavailable)} ${unavailable.length === 1 ? 'is' : 'are'} not available for ${unavailable.length === 1 ? 'its' : 'their'} dates`);
      if (partial.length) avail.push(`${this.lineList(partial)} ${partial.length === 1 ? 'is' : 'are'} only partly available`);
      const availText = avail.length ? ` ${avail.join('; ')}.` : '';

      if (status === 'SUBMITTED') {
        const approvable = list.filter((l) => APPROVABLE.indexOf(l.lineStatus) !== -1).length;
        return {
          tone: unavailable.length ? 'warn' : 'ok',
          text: `Ready to approve: ${approvable} of ${list.length} ${list.length === 1 ? 'line' : 'lines'} waiting for a decision. `
            + 'Approving every line moves the request to In process; allocation opens after that.'
            + availText
            + (quoteOwed ? ' A quote is owed for this request: allocation stays closed until it is generated.' : ''),
        };
      }
      if (ALLOCATION_OPEN.indexOf(status) !== -1) {
        if (quoteOwed) {
          return { tone: 'warn', text: 'A quote is owed for this request: generate it in Old EquipRite before allocating.' + availText };
        }
        if (!pickable.length) {
          return { tone: 'ok', text: 'No line here takes serials, lots or stock quantities: nothing to allocate. Next: Initiate picking.' };
        }
        if (!missing.length) {
          return { tone: 'ok', text: `Every line is allocated (${pickable.length} of ${pickable.length}). Next: Initiate picking.` };
        }
        return {
          tone: unavailable.length ? 'warn' : 'info',
          text: `${pickable.length - missing.length} of ${pickable.length} ${pickable.length === 1 ? 'line' : 'lines'} allocated. `
            + `${this.lineList(missing)} still ${missing.length === 1 ? 'needs' : 'need'} units: allocate here, or leave `
            + `${missing.length === 1 ? 'it' : 'them'} for the yard to pick on the Oracle mobile app.` + availText,
        };
      }
      if (status === 'REJECTED' || status === 'CANCELLED') {
        return { tone: 'info', text: `This request is ${status.toLowerCase()}: nothing to approve or allocate.` };
      }
      return { tone: 'info', text: `This request is ${this.statusWords(status)}: approval and allocation are behind it. Open it in Request detail to follow it.` };
    }

    lineList(lines) {
      const names = (lines || []).map((l) => `line ${l.line_no}`);
      const head = names.length > 3 ? names.slice(0, 3).concat([`${names.length - 3} more`]) : names;
      const text = head.length > 1 ? `${head.slice(0, -1).join(', ')} and ${head[head.length - 1]}` : (head[0] || '');
      return text.charAt(0).toUpperCase() + text.slice(1);
    }

    statusWords(status) {
      return String(status || 'in another stage').toLowerCase().replace(/_/g, ' ');
    }

    /** The three steps this page walks: approve, allocate, then picking (on Initiate picking). */
    steps(status, quotingAllowed, lines) {
      const s = up(status);
      const pickable = (Array.isArray(lines) ? lines : []).filter((l) => this.isPickable(l)
        && TERMINAL_LINE_STATUSES.indexOf(up(l.line_status)) === -1);
      const allAllocated = pickable.every((l) => l.alloc_status === 'ALLOCATED');
      let at;
      if (s === 'SUBMITTED') at = 0;
      else if (ALLOCATION_OPEN.indexOf(s) !== -1) at = allAllocated && !this.isQuoteOwed(s, quotingAllowed) ? 2 : 1;
      else at = 3;
      const labels = ['Approve', 'Allocate', 'Pick (Initiate picking)'];
      if (s === 'REJECTED' || s === 'CANCELLED') {
        return labels.map((label, i) => ({ label: i === 0 ? 'Rejected' : label, state: i === 0 ? 'stopped' : 'todo' }));
      }
      return labels.map((label, i) => ({ label, state: i < at ? 'done' : (i === at ? 'current' : 'todo') }));
    }

    // ── Gates (old equipment-foundation request-detail-page.js) ───────────────────────────────────────────────

    /** isQuoteOwed: quoting is on for this origin and no quote has been produced yet. */
    isQuoteOwed(status, quotingAllowed) {
      return !!quotingAllowed && QUOTE_EXISTS.indexOf(up(status)) === -1;
    }

    /** isLinePickable: serial, lot or inventory tracked, or an F&M line (assigned directly). */
    isPickable(line) {
      return !!(line && (line.is_serial_controlled || line.is_lot_controlled || line.is_inventory_tracked
        || line.fulfilment_class === 'F_AND_M'));
    }

    /** What a line takes: Serial, Lot, Quantity (inventory item), or none (free stock, quantity checked only). */
    tracking(line) {
      if (!line) return '';
      if (line.is_serial_controlled) return 'Serial';
      if (line.is_lot_controlled) return 'Lot';
      if (line.is_inventory_tracked) return 'Quantity';
      if (line.fulfilment_class === 'F_AND_M') return 'Fixed asset';
      return 'Free stock';
    }

    /**
     * Can this line's units be opened, and why not. Mirrors rowClickChain + isRowLineDetailBlocked: terminal lines
     * never; while the request is SUBMITTED or owes a quote, only a customer line at UNDER_PROCUREMENT (read only);
     * free stock never (no allocation pathway).
     * { kind: 'allocate' | 'view' | 'blocked' | 'none', label, reason }
     */
    lineAction(line, formData, quotingAllowed, readOnly) {
      if (!line) return { kind: 'none', label: '', reason: '' };
      const ls = up(line.line_status);
      if (TERMINAL_LINE_STATUSES.indexOf(ls) !== -1) {
        return { kind: 'none', label: '', reason: 'Rejected lines take no action.' };
      }
      const fd = formData || {};
      const status = up(fd.status);
      const gated = status === 'SUBMITTED' || this.isQuoteOwed(status, quotingAllowed);
      if (gated && !(fd.isCustomer && ls === 'UNDER_PROCUREMENT')) {
        return {
          kind: 'blocked', label: 'Allocate',
          reason: status === 'SUBMITTED' ? 'Opens once the request is approved.' : 'Opens once the quote is generated.',
        };
      }
      if (!this.isPickable(line)) {
        return { kind: 'none', label: '', reason: 'Free stock: no units to allocate.' };
      }
      if (gated || readOnly || ALLOCATION_OPEN.indexOf(status) === -1) {
        return { kind: 'view', label: 'Units', reason: '' };
      }
      return { kind: 'allocate', label: line.alloc_status === 'ALLOCATED' ? 'Change units' : 'Allocate', reason: '' };
    }

    /** Availability over the line's dates (views/request-detail-lines availabilityStatus): ok | part | none | unknown. */
    availTone(availability) {
      const a = up(availability);
      if (!a) return 'unknown';
      if (a === 'AVAILABLE') return 'ok';
      if (a.indexOf('PARTIAL') === 0) return 'part';
      return 'none';
    }

    availLabel(availability) {
      const a = up(availability);
      if (!a) return '—';
      if (a === 'AVAILABLE') return 'Available';
      if (a === 'PARTIAL DURATION') return 'Partial dates';
      if (a === 'PARTIAL QUANTITY') return 'Partial quantity';
      if (a === 'NOT AVAILABLE') return 'Not available';
      return a.charAt(0) + a.slice(1).toLowerCase();
    }

    /** Allocation tone of a line, as the old Workbench colours it: none | partial | complete. */
    allocTone(line) {
      const s = line ? line.alloc_status : '';
      return s === 'ALLOCATED' ? 'complete' : (s === 'PARTIAL' ? 'partial' : 'none');
    }

    /** Extra facts on a line: purchase requisition / order, transfer orders, a failed Transfer Order. */
    lineNotes(line) {
      if (!line) return '';
      const out = [];
      if (line.pr_number) out.push(`PR ${line.pr_number}`);
      if (line.po_number) out.push(`PO ${line.po_number}`);
      if (line.to_number) out.push(`TO ${line.to_number}`);
      if (line.to_failure_code === 'TO_FAILED') out.push('Transfer Order failed');
      if (line.to_failure_code === 'TO_STALLED') out.push('Transfer Order stalled in Fusion');
      return out.join(' · ');
    }

    // ── Totals and links ──────────────────────────────────────────────────────────────────────────────────────

    /** computeTotalCost of the old page: the lines' estimated costs added up. */
    totalCost(lines) {
      return (Array.isArray(lines) ? lines : []).reduce((s, l) => s + (num(l.est_cost) || 0), 0);
    }

    money(v) {
      return '$' + Math.round(num(v)).toLocaleString('en-US');
    }

    /** "8 – 22 Nov 2026", "6 Nov 2026 – 6 Jan 2027", from ISO dates. */
    dateRange(start, end) {
      const a = parseDay(start);
      const b = parseDay(end);
      const parts = (n) => { const d = new Date(n * 86400000); return { d: d.getUTCDate(), m: d.getUTCMonth(), y: d.getUTCFullYear() }; };
      if (a === null && b === null) return '—';
      if (a === null || b === null) {
        const x = parts(a === null ? b : a);
        return `${x.d} ${MON[x.m]} ${x.y}`;
      }
      const x = parts(a);
      const y = parts(b);
      if (x.y !== y.y) return `${x.d} ${MON[x.m]} ${x.y} – ${y.d} ${MON[y.m]} ${y.y}`;
      if (x.m !== y.m) return `${x.d} ${MON[x.m]} – ${y.d} ${MON[y.m]} ${y.y}`;
      return `${x.d} – ${y.d} ${MON[y.m]} ${y.y}`;
    }

    /** This request on the old Workbench's request page (what the old Workbench row opens). */
    oldDetailLink(oldAppUrl, requestNumber, numericId) {
      if (!oldAppUrl || !numericId) return '';
      const base = oldAppUrl.endsWith('/') ? oldAppUrl : `${oldAppUrl}/`;
      return `${base}vp/shell/equipment-foundation/request-detail?requestNumber=${encodeURIComponent(requestNumber || '')}`
        + `&requestId=${encodeURIComponent(numericId)}&sourcePage=${encodeURIComponent('Equipment Workbench')}`;
    }

    /** The quote page in Old EquipRite, where quotes are generated. */
    oldQuoteLink(oldAppUrl, requestNumber, numericId) {
      if (!oldAppUrl || !numericId) return '';
      const base = oldAppUrl.endsWith('/') ? oldAppUrl : `${oldAppUrl}/`;
      return `${base}vp/shell/equipment-foundation/request-quote?requestId=${encodeURIComponent(numericId)}`
        + `&requestNumber=${encodeURIComponent(requestNumber || '')}&sourcePage=request-detail`;
    }

    // ── Unit picker (old line-detail page module) ─────────────────────────────────────────────────────────────

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

    /** Read by saveAllocationChain (old saveLineChain reads the same from the old page module). */
    getStagedChanges() {
      return {
        mode:               this._mode,
        pendingAssignments: this._pendingAssignments.slice(),
        pendingReleases:    this._pendingReleases.slice(),
      };
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

    /** The bars of a unit as words, for screen readers. */
    barText(bars) {
      return (Array.isArray(bars) ? bars : []).map((b) => b.label).join('; ');
    }

    /** The requested-dates band on the schedule ({ left, width }), or null. */
    windowBand() {
      const win = this.scheduleWindow();
      return win ? this._span(win, this._lineData.start_date, this._lineData.end_date) : null;
    }

    pickerMode() {
      return this._mode;
    }
  }

  return PageModule;
});
