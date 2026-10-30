define(['resources/js/requestProgress'], (Progress) => {
  'use strict';

  // Where the request is comes from its equipment (resources/js/requestProgress.js): the request's own status stays
  // IN_PROCESS from approval to the end, so the heading, the journey and each line's status are read from the lines.

  class PageModule {
    constructor() {
      this._lineRefs = [];
      this._selectedRows = new Set();
    }

    // ── Lines and selection. Same interface as the old page's grid helpers, so the copied action chains
    //    (initiateReturnChain, acceptDeliveryChain, confirmRequestChain, …) work unchanged. ──────────────────

    /** Called by initChain with the mapped lines; returns them for the lines table. */
    initGridData(lines) {
      this._lineRefs = Array.isArray(lines) ? lines : [];
      this._selectedRows = new Set();
      return this._lineRefs;
    }

    isRowSelected(index) {
      return this._selectedRows.has(index);
    }

    /** Ticks or unticks one line (index into the lines). */
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

    /** What the selection allows, for the action buttons (same rules as the old page). */
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
        allReturnable: lines.every((l) => (l.isReturnable != null ? l.isReturnable === true : l.lineStatus === 'DEPLOYED')),
        allShipToSite: lines.every((l) => l.lineStatus === 'SHIP_TO_SITE'),
      };
    }

    /** Lines can be acted on (delivery, return) only once the request is in operations. Same allowlist as before. */
    headerIsConfirmed(status) {
      return ['IN_PROCESS', 'QUOTE_ACCEPTED', 'DEPLOYED'].indexOf(String(status || '').toUpperCase()) !== -1;
    }

    formatDate(value) {
      return value ? String(value).substring(0, 10) : '';
    }

    // ── Journey ───────────────────────────────────────────────────────────────────────────────────────────────

    /**
     * Where the request is, from its lines: headline ("Partly shipped · 1 of 3"), detail, next step, what is late,
     * and the stops of the journey with how many pieces are at each (requestProgress.summarize).
     */
    progress(status, lines, form) {
      const f = form || {};
      return Progress.summarize(status, (Array.isArray(lines) ? lines : []).map((l) => ({
        lineStatus: l.lineStatus, start: l.startIso, end: l.endIso,
      })), { start: f.startDate, end: f.endDate, external: !!f.isCustomer });
    }

    /** A stop's note under the journey: "2 of 3 here", "all past", "". */
    stopNote(stop, total) {
      if (!stop) return '';
      if (stop.state === 'here') return total > 1 ? `${stop.count} of ${total} here` : 'Here';
      if (stop.state === 'done') return 'All past';
      if (stop.state === 'passed') return 'Some past';
      return '';
    }

    /** The journey stage of a line status (its colour). */
    lineStage(status, isCustomer) {
      return Progress.line(status, !!isCustomer).stage || 'ready';
    }

    /** A line status in words: "Approved, no unit assigned yet", "On the way to site". */
    lineLabel(status, isCustomer) {
      return Progress.line(status, !!isCustomer).label;
    }

    /** The serial, else whether a unit is assigned yet, in words. */
    serialText(line) {
      const l = line || {};
      if (l.allocatedSerialNumber) return l.allocatedSerialNumber;
      return { ALLOCATED: 'Unit assigned', PARTIALLY_ALLOCATED: 'Partly assigned', PENDING: 'No unit assigned yet',
        UNALLOCATED: 'No unit assigned yet' }[l.allocStatus] || '—';
    }

    // ── Old EquipRite links ───────────────────────────────────────────────────────────────────────────────────

    /** This request in Old EquipRite (project or customer detail page), or ''. */
    oldDetailLink(oldAppUrl, requestNumber, numericId, isCustomer) {
      if (!oldAppUrl || !numericId) {
        return '';
      }
      const base = oldAppUrl.endsWith('/') ? oldAppUrl : `${oldAppUrl}/`;
      const page = isCustomer ? 'customer-portal/customer-request-detail' : 'main/equipment-request-detail';
      return `${base}vp/shell/${page}?requestId=${encodeURIComponent(requestNumber || '')}&requestNumericId=${encodeURIComponent(numericId)}`;
    }

    /** The quote in Old EquipRite (project or customer quote page), or ''. */
    oldQuoteLink(oldAppUrl, requestNumber, numericId, isCustomer) {
      if (!oldAppUrl || !numericId) {
        return '';
      }
      const base = oldAppUrl.endsWith('/') ? oldAppUrl : `${oldAppUrl}/`;
      const page = isCustomer ? 'customer-portal/customer-quote' : 'main/project-quote';
      return `${base}vp/shell/${page}?requestId=${encodeURIComponent(requestNumber || '')}&requestNumericId=${encodeURIComponent(numericId)}`;
    }
  }

  return PageModule;
});
