define(['resources/js/customerPortal'], (portal) => {
  'use strict';

  // One customer request, tracked like a parcel (wireframe: Portal requests, the tracker card; replaces
  // customer-request-detail). The next thing the customer must do sits at the top; the equipment below takes the old
  // page's line actions (accept or refuse a delivery, start a return), copied from its chains.

  const NOUNS = { DAILY: 'DAY', WEEKLY: 'WEEK', MONTHLY: 'MONTH', HOURLY: 'HOUR', YEARLY: 'YEAR' };

  class PageModule {
    constructor() {
      this._lineRefs = [];
      this._selectedRows = new Set();
    }

    // ── Lines and selection: the interface the old page's chains call (initGridData, getSelectedLines, …), as in
    //    New EquipRite's request-detail-page.js. ─────────────────────────────────────────────────────────────────────

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

    /** Ticks exactly the lines in one status (the "Select the arrived items" shortcut). Returns how many. */
    selectByStatus(status) {
      this._selectedRows = new Set();
      this._lineRefs.forEach((l, i) => { if (l && l.lineStatus === status) this._selectedRows.add(i); });
      return this._selectedRows.size;
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
        allReturnable: lines.every((l) => (l.isReturnable != null ? l.isReturnable === true : l.lineStatus === 'DEPLOYED')),
        allShipToSite: lines.every((l) => l.lineStatus === 'SHIP_TO_SITE'),
      };
    }

    headerIsConfirmed(status) {
      return portal.headerIsConfirmed(status);
    }

    formatDate(value) {
      return value ? String(value).substring(0, 10) : '';
    }

    // ── What the customer sees ────────────────────────────────────────────────────────────────────────────────────

    steps(status, lines, info, tick) {
      return portal.trackSteps(status, lines, info || {});
    }

    next(formData, lines, quotingAllowed, tick) {
      return portal.nextAction(formData || {}, lines, { quotingAllowed });
    }

    hasQuote(status, quotingAllowed) {
      return portal.hasQuote(status, quotingAllowed);
    }

    statusText(s) { return portal.statusText(s); }

    statusClass(s) { return portal.statusClass(s); }

    dateRange(a, b) { return portal.dateRange(a, b); }

    /** The rate as quoted ("$1,400 / DAY"), or '—' while a quote is still to come. */
    rateText(line) {
      if (!line || line.billRate === '' || line.billRate == null) return '—';
      const u = String(line.priceUom || '').trim().toUpperCase();
      return portal.money(line.billRate) + (u ? ' / ' + (NOUNS[u] || u) : '');
    }

    /** How many lines are in a status (for the button labels). */
    countIn(lines, status) {
      return (Array.isArray(lines) ? lines : []).filter((l) => l && l.lineStatus === status).length;
    }

    oldLink(oldAppUrl, requestNumber, numericId) {
      return portal.oldLink(oldAppUrl, 'customer-request-detail', requestNumber, numericId);
    }
  }

  return PageModule;
});
