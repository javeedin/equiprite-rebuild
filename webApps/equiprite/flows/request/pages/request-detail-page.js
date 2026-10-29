define([], () => {
  'use strict';

  // Lifecycle steps for the tracker (FDD 5.6), with the statuses that mean "at this step". Line statuses count too:
  // a request whose lines are on site is shown on site even while the header still reads IN_PROCESS.
  const STEPS = [
    { key: 'draft',     label: 'Draft',     statuses: ['DRAFT'] },
    { key: 'submitted', label: 'Submitted', statuses: ['SUBMITTED', 'QUOTE_GENERATED', 'QUOTE_ACCEPTED'] },
    { key: 'approved',  label: 'Approved',  statuses: ['IN_PROCESS', 'APPROVED', 'ALLOCATED'] },
    { key: 'picking',   label: 'Picking',   statuses: ['PICK_INITIATED', 'PICK_RELEASED', 'EQP_INSPECTION_COMPLETE'] },
    { key: 'shipped',   label: 'Shipped',   statuses: ['SHIPPED', 'SHIP_TO_SITE'] },
    { key: 'onsite',    label: 'On site',   statuses: ['DEPLOYED', 'DELIVERED', 'CONSUMED'] },
    { key: 'returning', label: 'Returning', statuses: ['RETURN_INITIATED', 'RETURNED'] },
    { key: 'closed',    label: 'Closed',    statuses: ['CLOSED'] },
  ];
  const STOPPED = ['REJECTED', 'CANCELLED', 'DECLINED'];
  const stepIndex = (status) => STEPS.findIndex((s) => s.statuses.indexOf(String(status || '').toUpperCase()) !== -1);

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

    // ── Tracker ───────────────────────────────────────────────────────────────────────────────────────────────

    /** [{ label, state: 'done' | 'current' | 'todo' | 'stopped' }] for the header status and the lines. */
    steps(status, lines, tick) {
      const header = String(status || '').toUpperCase();
      let at = stepIndex(header);
      (Array.isArray(lines) ? lines : []).forEach((l) => { at = Math.max(at, stepIndex(l.lineStatus)); });
      const stopped = STOPPED.indexOf(header) !== -1;
      if (stopped && at < 1) {
        at = 1; // a rejected request stopped at the review step
      }
      return STEPS.map((s, i) => ({
        label: stopped && i === at ? header.charAt(0) + header.slice(1).toLowerCase() : s.label,
        state: stopped && i === at ? 'stopped' : (i < at ? 'done' : (i === at ? 'current' : 'todo')),
      }));
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
