define([
  'resources/js/lineStatusLabels'
], (lineStatusLabels) => {
  'use strict';

  // Receipt & returns (FDD 5.3-5.5). Page module for the returns queue, the open request's lines and the
  // Direct Return dialog. The selection rules and the Direct Return helpers are the old page's
  // (equipment-returns-page.js), under the same names, because the chains copied unchanged from it call them:
  // getSelectedLines (AcceptReturnLinesChain), getLineSelectionStateRaw (LineSelectionChangedChain). The lines
  // and the Direct Return results are div grids instead of oj-data-grids, so the grid providers are gone and
  // ticks are kept by line id / row key; selection still resets whenever the lines change, as before.

  // Same as the old page: only lines physically back at the yard can be received (closed) here.
  const ACCEPTABLE_RETURN_STATUS = 'SHIPPED_TO_YARD';
  const PICKING_BLANK_STATUSES = ['SUBMITTED', 'IN_PROCESS'];

  // Where a line is on its way back, for the tiles and the order of the lines.
  const STAGE_OF = {
    SHIPPED_TO_YARD: 'ready',
    RETURN_INITIATED: 'transit',
    RETURN_IN_PROCESS: 'transit',
    DEPLOYED: 'site',
    DELIVERED: 'site',
    SHIP_TO_SITE: 'site',
    CLOSED: 'closed',
    CONSUMED: 'closed',
  };
  const STAGE_ORDER = { ready: 0, transit: 1, site: 2, other: 3, closed: 4 };
  const stageOf = (status) => STAGE_OF[String(status || '').toUpperCase()] || 'other';

  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAY_MS = 24 * 60 * 60 * 1000;
  const utcDay = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  };

  class PageModule {
    constructor() {
      this._linesSignature = '';
      this._lineRefs = [];
      this._selectedLineIds = new Set();
    }

    // ── Queue ───────────────────────────────────────────────────────────────────────────────────────────────

    /**
     * Rows on screen: the class chip (the old smart search's Class filter) and the keyword rule of the old
     * FilterPickingQueueChain (any word in request number, project / customer, requestor or class).
     */
    queueRows(rows, text, cls) {
      const words = String(text || '').toLowerCase().split(/\s+/).filter((w) => w);
      return (Array.isArray(rows) ? rows : []).filter((r) => {
        if (cls && cls !== 'all' && String(r.equipmentClass || '').toLowerCase() !== String(cls).toLowerCase()) {
          return false;
        }
        if (!words.length) {
          return true;
        }
        return words.some((w) => [r.requestNumber, r.project, r.requestor, r.equipmentClass]
          .some((v) => v && String(v).toLowerCase().includes(w)));
      });
    }

    /** Class chips with counts, All first (classes from InitPickingQueueChain's classesArray). */
    classChips(rows, classes) {
      const list = Array.isArray(rows) ? rows : [];
      return [{ key: 'all', label: 'All classes', count: list.length }].concat((Array.isArray(classes) ? classes : []).map((c) => ({
        key: c.value,
        label: c.label,
        count: list.filter((r) => String(r.equipmentClass || '').toLowerCase() === String(c.value).toLowerCase()).length,
      })));
    }

    /** "8 Nov" from an ISO date. */
    day(iso) {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
      return m ? `${Number(m[3])} ${MON[Number(m[2]) - 1]}` : '';
    }

    /** Whole days a due date is past today (0 when not overdue or unknown). */
    daysOverdue(iso, today) {
      const due = utcDay(iso);
      if (due === null) {
        return 0;
      }
      const t = today ? utcDay(today) : utcDay(new Date().toISOString());
      return Math.max(0, Math.round((t - due) / DAY_MS));
    }

    /** "21 Oct · 8 days overdue" for the queue's Due back column. */
    dueText(iso, today) {
      const d = this.day(iso);
      if (!d) {
        return '—';
      }
      const late = this.daysOverdue(iso, today);
      return late ? `${d} · ${late === 1 ? '1 day' : `${late} days`} overdue` : d;
    }

    nextRequest(rows, currentId) {
      const list = Array.isArray(rows) ? rows : [];
      if (!list.length) {
        return null;
      }
      const at = list.findIndex((r) => String(r.id) === String(currentId));
      if (at === -1) {
        return list[0];
      }
      return list.length > 1 ? list[(at + 1) % list.length] : null;
    }

    // ── Lines (receive at yard) ─────────────────────────────────────────────────────────────────────────────

    /** Keeps the module's lines in step with $variables.selectedRequest.lines; any change clears the ticks. */
    syncLines(linesData) {
      const lines = Array.isArray(linesData) ? linesData : [];
      const signature = lines.length + ':' + lines.map((l) => (l.lineId || '') + '|' + (l.lineStatus || '') + '|' + (l.toNumber || '')).join('~');
      if (signature !== this._linesSignature) {
        this._linesSignature = signature;
        this._lineRefs = lines;
        this._selectedLineIds = new Set();
      }
      return lines;
    }

    /** Only a line back at the yard (SHIPPED_TO_YARD) can be ticked. */
    isLineEligible(line) {
      return !!line && line.lineStatus === ACCEPTABLE_RETURN_STATUS;
    }

    isLineSelected(lineId) {
      return this._selectedLineIds.has(String(lineId));
    }

    _eligible() {
      return (this._lineRefs || []).filter((l) => this.isLineEligible(l));
    }

    /** Header box = every eligible line ticked. `lines` (optional) syncs first, for the binding. */
    isAllLinesSelected(lines) {
      if (lines) {
        this.syncLines(lines);
      }
      const eligible = this._eligible();
      return eligible.length > 0 && eligible.every((l) => this._selectedLineIds.has(String(l.lineId)));
    }

    /** One box. Ineligible lines cannot be ticked (behind the disabled box). */
    toggleLine(lineId, on) {
      const line = (this._lineRefs || []).find((l) => String(l.lineId) === String(lineId));
      if (!this.isLineEligible(line)) {
        return;
      }
      if (on) {
        this._selectedLineIds.add(String(lineId));
      } else {
        this._selectedLineIds.delete(String(lineId));
      }
    }

    /** Header box: all eligible lines, or none. */
    toggleAllLines() {
      this._selectedLineIds = this.isAllLinesSelected() ? new Set() : new Set(this._eligible().map((l) => String(l.lineId)));
    }

    /** The ticked lines, in load order: what AcceptReturnLinesChain closes. */
    getSelectedLines() {
      return (this._lineRefs || []).filter((l) => l && this._selectedLineIds.has(String(l.lineId)));
    }

    /** For LineSelectionChangedChain: drives the Receive button. */
    getLineSelectionStateRaw() {
      return { count: this.getSelectedLines().length };
    }

    getLineStatusLabel(status) {
      return lineStatusLabels.formatLineStatus(status, PICKING_BLANK_STATUSES);
    }

    stageOf(status) {
      return stageOf(status);
    }

    /** Lines to show: back at the yard first, then on the way, still on site, closed last; load order within. */
    lineRows(lines) {
      return this.syncLines(lines)
        .map((l, i) => ({ l, i, s: STAGE_ORDER[stageOf(l.lineStatus)] }))
        .sort((a, b) => (a.s - b.s) || (a.i - b.i))
        .map((x) => x.l);
    }

    /** { ready, transit, site, closed, other, total } line counts for the tiles. */
    returnCounts(lines) {
      const out = { ready: 0, transit: 0, site: 0, closed: 0, other: 0, total: 0 };
      (Array.isArray(lines) ? lines : []).forEach((l) => {
        out[stageOf(l.lineStatus)]++;
        out.total++;
      });
      return out;
    }

    /** The distinct inbound transfer orders on the lines. */
    inboundTOs(lines) {
      const seen = [];
      (Array.isArray(lines) ? lines : []).forEach((l) => {
        if (l && l.toNumber && seen.indexOf(l.toNumber) === -1) {
          seen.push(l.toNumber);
        }
      });
      return seen.join(', ');
    }

    /** "Serial EX-2207 is DAMAGED" for a line whose unit came back flagged (from the line's condition). */
    conditionNote(line) {
      if (!line || !line.condition || line.condition === 'GOOD') {
        return '';
      }
      return `Unit flagged ${String(line.condition).toLowerCase()}: check it before it goes back to stock.`;
    }

    todayIso() {
      return new Date().toISOString().slice(0, 10);
    }

    // ── Direct Return (old page's helpers; selection by row key, never by position) ─────────────────────────

    isDirectRowSelected(rowKey, $page) {
      const sel = ($page && $page.variables.directReturnSelected) || [];
      return sel.indexOf(rowKey) !== -1;
    }

    toggleDirectRow(rowKey, $page) {
      const sel = ($page.variables.directReturnSelected || []).slice();
      const i = sel.indexOf(rowKey);
      if (i === -1) {
        sel.push(rowKey);
      } else {
        sel.splice(i, 1);
      }
      $page.variables.directReturnSelected = sel;
    }

    directSelectedCount($page) {
      return (($page && $page.variables.directReturnSelected) || []).length;
    }

    /** "Showing N of M" whenever the set is cut short, so a broad term reads as broad. */
    directResultSummary($page) {
      const m = ($page && $page.variables.directReturnMeta) || {};
      if (!m.searched) {
        return '';
      }
      if (m.tooShort) {
        return 'Type at least 2 characters.';
      }
      if (m.error) {
        return 'Search failed. Try again.';
      }
      const shown = (($page.variables.directReturnRows) || []).length;
      if (!shown) {
        return 'No equipment in the field matches that.';
      }
      return shown < m.recordCount
        ? `Showing ${shown} of ${m.recordCount} matches — narrow the search to see the rest.`
        : shown + (shown === 1 ? ' match' : ' matches');
    }

    /** A unit can be out on more than one rental, so several matches need a deliberate choice. */
    directAmbiguityWarning($page) {
      const m = ($page && $page.variables.directReturnMeta) || {};
      const rows = ($page && $page.variables.directReturnRows) || [];
      if (!m.searched || rows.length < 2) {
        return '';
      }
      return 'check the request and project — a unit can be out on more than one rental';
    }

    directUnitLabel(row) {
      if (!row) {
        return '';
      }
      return row.serialNumber || row.unitIdentifier || '—';
    }

    directDateOnly(iso) {
      return iso ? String(iso).slice(0, 10) : '';
    }
  }

  return PageModule;
});
