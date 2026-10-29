define([
  'require',
  'resources/js/lineStatusLabels'
], (localRequire, lineStatusLabels) => {
  'use strict';

  // resources/js/pickSlip (copied unchanged) pulls jsPDF from a CDN. The old page module loaded it up front, so
  // an unreachable CDN took the whole page down; here it is loaded only when SHIPPING_DOCUMENTS_ENABLED is on
  // (openPickingDrawerChain / PrintPickSlipChain), and this module reads it once it is there.
  const loadedPickSlip = () => {
    try {
      return localRequire('resources/js/pickSlip');
    } catch (e) {
      return null; // not loaded: no slip has been generated, so there is nothing to offer
    }
  };

  // Initiate picking (FDD 7.16). Page module for the queue and the picking workspace. The selection and
  // transfer-order logic is the old page's (initiate-picking-page.js), kept under the same names because the
  // chains copied unchanged from it call them: selectedLines, selectedTOOptions, releasableTOOptions,
  // onTOSelectionChanged. Two differences, both about how the lines are shown, not what is sent:
  //   - the lines are a div grid, not an oj-data-grid, so syncLines() replaces getLinesGridProvider();
  //   - ticks are kept by line id, so a release that moves the lines' status in place leaves the released
  //     lines ticked for Pick and ship (what the old chain's comments describe). A different line set (another
  //     request, or a reload) clears them and re-ticks the opening transfer order, as before.

  // Same as the old page: the picking workflow hides the pre-allocation statuses.
  const PICKING_BLANK_STATUSES = ['SUBMITTED', 'IN_PROCESS'];

  // Where a line is in picking. The first two mean "confirmed, waiting for release" (SCHEDULED_FOR_PICKING is
  // what Confirm writes; ALLOCATED is kept for lines confirmed before that), matching RELEASABLE in the old
  // canReleaseSelectedTO and RELEASABLE_FM_STATUSES in ReleaseTransferOrderChain.
  const STAGE_OF = {
    SCHEDULED_FOR_PICKING: 'release',
    ALLOCATED: 'release',
    PICK_INITIATED: 'picking',
    SHIP_TO_SITE: 'shipped',
  };
  const STAGE_ORDER = { release: 0, picking: 1, shipped: 2, other: 3 };
  const stageOf = (status) => STAGE_OF[String(status || '').toUpperCase()] || 'other';

  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAY_MS = 24 * 60 * 60 * 1000;

  class PageModule {
    constructor() {
      this._linesSignature = '';
      this._lineIdsKey = '';
      this._lineRefs = [];
      this._selected = new Set(); // line ids (strings)
      // orderNumber of the transfer order the workspace opened on; re-applied when a new line set arrives
      // (openPickingDrawerChain sets it before the lines are loaded). Same device as the old page.
      this._pendingTOOrderNumber = '';
    }

    // ── Queue ───────────────────────────────────────────────────────────────────────────────────────────────

    /**
     * The queue rows on screen: the chip, then the old smart search's keyword rule (any word in request number,
     * project / customer, requestor or class; FilterPickingQueueChain).
     */
    queueRows(rows, text, chip, today) {
      const words = String(text || '').toLowerCase().split(/\s+/).filter((w) => w);
      return (Array.isArray(rows) ? rows : []).filter((r) => {
        if (!this._chipMatch(r, chip, today)) {
          return false;
        }
        if (!words.length) {
          return true;
        }
        return words.some((w) => [r.requestNumber, r.project, r.requestor, r.equipmentClass]
          .some((v) => v && String(v).toLowerCase().includes(w)));
      });
    }

    _chipMatch(r, chip, today) {
      if (chip === 'soon') {
        return this.startsWithin(r.neededByDate, 7, today);
      }
      if (chip === 'project') {
        return !r.isCustomer;
      }
      if (chip === 'customer') {
        return !!r.isCustomer;
      }
      return true;
    }

    /** Chips with counts, All first. "Starts within 7 days" includes requests whose start has passed. */
    queueChips(rows, today) {
      const list = Array.isArray(rows) ? rows : [];
      const count = (key) => list.filter((r) => this._chipMatch(r, key, today)).length;
      return [
        { key: 'all', label: 'All', count: list.length },
        { key: 'soon', label: 'Starts within 7 days', count: count('soon') },
        { key: 'project', label: 'Project', count: count('project') },
        { key: 'customer', label: 'Customer', count: count('customer') },
      ];
    }

    /** True when an ISO date is on or before today + days (overdue starts count). */
    startsWithin(iso, days, today) {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
      if (!m) {
        return false;
      }
      const base = today ? new Date(`${String(today).slice(0, 10)}T00:00:00Z`) : new Date();
      const startOfToday = Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate());
      return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) <= startOfToday + days * DAY_MS;
    }

    /** The row after the open one in the filtered queue (wraps to the first), or null. */
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

    /** "8 Nov" from an ISO date ('' when there is none). */
    day(iso) {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
      return m ? `${Number(m[3])} ${MON[Number(m[2]) - 1]}` : '';
    }

    money(n) {
      if (n === null || n === undefined || n === '' || !Number.isFinite(Number(n))) {
        return '';
      }
      return `$${Math.round(Number(n)).toLocaleString('en-US')}`;
    }

    // ── Lines and ticks ─────────────────────────────────────────────────────────────────────────────────────

    /**
     * Keeps the module's line list in step with $variables.selectedRequest.lines (the old getLinesGridProvider
     * did this from the grid binding). Called from every binding that depends on the lines, so the order the
     * bindings run in does not matter; idempotent per signature.
     */
    syncLines(linesData) {
      const lines = Array.isArray(linesData) ? linesData : [];
      const signature = lines.length + ':' + lines.map((l) => [l.lineId, l.lineStatus, l.toNumber, l.yard,
        l.subinventory, l.locator].map((v) => v || '').join('|')).join('~');
      if (signature === this._linesSignature) {
        return lines;
      }
      this._linesSignature = signature;
      this._lineRefs = lines;
      const idsKey = lines.map((l) => String(l.lineId)).join(',');
      if (idsKey !== this._lineIdsKey) {
        this._lineIdsKey = idsKey;
        this._selected = new Set();
        if (this._pendingTOOrderNumber) {
          lines.forEach((l) => {
            if (l && String(l.toNumber || '') === this._pendingTOOrderNumber) {
              this._selected.add(String(l.lineId));
            }
          });
        }
      }
      return lines;
    }

    isRowSelected(lineId) {
      return this._selected.has(String(lineId));
    }

    /** Header box = every line ticked (not "any"). `lines` (optional) syncs first, for the binding. */
    isAllSelected(lines) {
      if (lines) {
        this.syncLines(lines);
      }
      const total = (this._lineRefs || []).length;
      return total > 0 && this._lineRefs.every((l) => this._selected.has(String(l.lineId)));
    }

    selectedRowCount() {
      return this.selectedLines().length;
    }

    /** The ticked lines, in the order they were loaded (the order the old grid sent them in). */
    selectedLines() {
      return (this._lineRefs || []).filter((l) => l && this._selected.has(String(l.lineId)));
    }

    /** The transfer orders the ticked lines belong to (matched on toNumber, the number the grid shows). */
    selectedTOOptions(tos) {
      const options = Array.isArray(tos) ? tos : [];
      if (!options.length) {
        return [];
      }
      const ticked = new Set(this.selectedLines().map((l) => String((l && l.toNumber) || '')).filter((n) => n !== ''));
      if (!ticked.size) {
        return [];
      }
      return options.filter((t) => t && t.orderNumber && ticked.has(String(t.orderNumber)));
    }

    /** Those still awaiting release: what Release for picking acts on (already released ones are skipped). */
    releasableTOOptions(tos) {
      return this.selectedTOOptions(tos).filter((t) => !t.released);
    }

    /** selectedTOId follows the ticks: one ticked order gives its id, none or several give '' (old rule). */
    _syncSelectedTOFromTicks($page) {
      if (!$page || !$page.variables) {
        return;
      }
      const picked = this.selectedTOOptions($page.variables.selectedRequestTOs);
      $page.variables.selectedTOId = (picked.length === 1) ? String(picked[0].value) : '';
    }

    _bumpSelectionTick($page) {
      if ($page && $page.variables && typeof $page.variables.selectionTick === 'number') {
        $page.variables.selectionTick = $page.variables.selectionTick + 1;
      }
    }

    /** One tick box. */
    toggleLine(lineId, on, $page) {
      if (on) {
        this._selected.add(String(lineId));
      } else {
        this._selected.delete(String(lineId));
      }
      this._syncSelectedTOFromTicks($page);
      this._bumpSelectionTick($page);
    }

    /** Header box: partial -> all, all -> none. */
    toggleAll($page) {
      const lines = this._lineRefs || [];
      this._selected = this.isAllSelected() ? new Set() : new Set(lines.map((l) => String(l.lineId)));
      this._syncSelectedTOFromTicks($page);
      this._bumpSelectionTick($page);
    }

    /**
     * Ticks the lines of one transfer order, replacing the selection. openPickingDrawerChain calls it with the
     * first order still awaiting release, so the workspace opens with that order's lines ticked.
     */
    onTOSelectionChanged(event, $page) {
      const toId = event && event.detail ? event.detail.value : null;
      const tos = ($page && $page.variables && $page.variables.selectedRequestTOs) || [];
      const sel = tos.find((t) => t && String(t.value) === String(toId));
      const orderNumber = String((sel && sel.orderNumber) || '');
      this._pendingTOOrderNumber = orderNumber;
      this._selected = new Set();
      if (orderNumber) {
        (this._lineRefs || []).forEach((l) => {
          if (l && String(l.toNumber || '') === orderNumber) {
            this._selected.add(String(l.lineId));
          }
        });
      }
      this._bumpSelectionTick($page);
    }

    // ── What the buttons may do (same rules as the old page) ────────────────────────────────────────────────

    /**
     * Release for picking is live when a ticked fixed-asset (F&M) line is still waiting for release, or a
     * ticked line names a transfer order still awaiting release. selectionTick only makes the binding re-run.
     */
    canReleaseSelectedTO(tos, selectedTOId, selectionTick, lines) {
      if (lines) {
        this.syncLines(lines);
      }
      const RELEASABLE = ['SCHEDULED_FOR_PICKING', 'ALLOCATED'];
      if (this.selectedLines().some((l) => l && l.isFAndM === true
          && RELEASABLE.indexOf(String(l.lineStatus || '').toUpperCase()) !== -1)) {
        return true;
      }
      return this.releasableTOOptions(tos).length > 0;
    }

    selectedTOCount(tos, selectionTick, lines) {
      if (lines) {
        this.syncLines(lines);
      }
      return this.selectedTOOptions(tos).length;
    }

    /** Order numbers Release will send: "TO-1, TO-2". */
    releasableTONumbers(tos, selectionTick, lines) {
      if (lines) {
        this.syncLines(lines);
      }
      return this.releasableTOOptions(tos).map((t) => String(t.orderNumber || '')).filter((n) => n !== '').join(', ');
    }

    unreleasedTOCount(tos) {
      return Array.isArray(tos) ? tos.filter((t) => t && !t.released).length : 0;
    }

    /**
     * Pick and ship is live when a ticked (or, with nothing ticked, any) F&M line is at Pick initiated, or the
     * single ticked transfer order is released and still has lines at Pick initiated.
     */
    canShipSelectedTO(tos, selectedTOId, lines, selectionTick) {
      if (!Array.isArray(lines)) {
        return false;
      }
      this.syncLines(lines);
      const ticked = this.selectedLines();
      const candidates = ticked.length ? ticked : lines;
      if (candidates.some((l) => l && l.isFAndM === true && l.lineStatus === 'PICK_INITIATED')) {
        return true;
      }
      if (!Array.isArray(tos) || !selectedTOId) {
        return false;
      }
      const sel = tos.find((t) => t && String(t.value) === String(selectedTOId));
      if (!sel || !sel.released) {
        return false;
      }
      const num = String(sel.orderNumber || '');
      return !!num && lines.some((l) => l && String(l.toNumber || '') === num && l.lineStatus === 'PICK_INITIATED');
    }

    /**
     * How many lines Pick and ship would move, worked out the way ShipConfirmStuckLinesChain picks them (it then
     * re-reads the statuses from the server): the lines of the single ticked transfer order at Pick initiated,
     * or every line at Pick initiated when no single order is ticked, plus the fixed-asset lines at Pick
     * initiated (the ticked ones, or all of them when none is ticked). Shown before the click.
     */
    shipCount(tos, selectedTOId, lines, selectionTick) {
      const list = this.syncLines(lines);
      const sel = (Array.isArray(tos) ? tos : []).find((t) => t && String(t.value) === String(selectedTOId));
      const selOrderNumber = String((sel && sel.orderNumber) || '');
      const atPickInitiated = list.filter((l) => l && l.lineStatus === 'PICK_INITIATED');
      const ids = new Set();
      atPickInitiated
        .filter((l) => !selOrderNumber || !list.some((x) => String(x.toNumber || '') === selOrderNumber)
          || String(l.toNumber || '') === selOrderNumber)
        .forEach((l) => ids.add(String(l.lineId)));
      const tickedFm = new Set(this.selectedLines().filter((l) => l.isFAndM === true).map((l) => String(l.lineId)));
      atPickInitiated
        .filter((l) => l.isFAndM === true && (tickedFm.size === 0 || tickedFm.has(String(l.lineId))))
        .forEach((l) => ids.add(String(l.lineId)));
      return ids.size;
    }

    /** 'release' or 'ship': the button the ticked lines are waiting for (shown dark), or ''. */
    nextAction(tos, selectedTOId, lines, selectionTick) {
      if (this.canReleaseSelectedTO(tos, selectedTOId, selectionTick, lines)) {
        return 'release';
      }
      return this.canShipSelectedTO(tos, selectedTOId, lines, selectionTick) ? 'ship' : '';
    }

    /** A request with fixed-asset lines shows the release panel even without a transfer order. */
    hasFAndMLines(lines) {
      return Array.isArray(lines) && lines.some((l) => l && l.isFAndM === true);
    }

    /**
     * The pick slip is offered once a line has been released (the predicate the slip itself filters on). Only
     * asked after a slip was generated, so pickSlip is loaded by then.
     */
    canPrintPickSlip(lines) {
      const pickSlip = loadedPickSlip();
      return !!pickSlip && pickSlip.hasReleasedLines(lines);
    }

    // ── How the lines read ──────────────────────────────────────────────────────────────────────────────────

    /** Status label; blank for SUBMITTED / IN_PROCESS, as on the old page. */
    getLineStatusLabel(status) {
      return lineStatusLabels.formatLineStatus(status, PICKING_BLANK_STATUSES);
    }

    stageOf(status) {
      return stageOf(status);
    }

    /** Lines to show: waiting for release first, then picking, then shipped; load order within each. */
    lineRows(lines, selectionTick) {
      const list = this.syncLines(lines);
      return list
        .map((l, i) => ({ l, i, s: STAGE_ORDER[stageOf(l.lineStatus)] }))
        .sort((a, b) => (a.s - b.s) || (a.i - b.i))
        .map((x) => x.l);
    }

    /** { release, picking, shipped, total } line counts for the step tiles. */
    stageCounts(lines) {
      const out = { release: 0, picking: 0, shipped: 0, total: 0 };
      (Array.isArray(lines) ? lines : []).forEach((l) => {
        const s = stageOf(l.lineStatus);
        if (out[s] !== undefined) {
          out[s]++;
        }
        out.total++;
      });
      return out;
    }

    /** The step the request is on: release while anything waits for release, then picking, then shipped. */
    currentStage(lines) {
      const c = this.stageCounts(lines);
      if (c.release) {
        return 'release';
      }
      if (c.picking) {
        return 'picking';
      }
      return c.shipped ? 'shipped' : '';
    }

    /** The distinct yards the lines are picked from, as recorded on them ("Houston Yard, Atlanta Yard"). */
    yards(lines) {
      const seen = [];
      (Array.isArray(lines) ? lines : []).forEach((l) => {
        String((l && l.yard) || '').split(',').map((y) => y.trim()).filter((y) => y).forEach((y) => {
          if (seen.indexOf(y) === -1) {
            seen.push(y);
          }
        });
      });
      return seen.join(', ');
    }

    /** "Bay 3 · A-12-04" from subinventory and locator. */
    whereText(line) {
      return [line && line.subinventory, line && line.locator].filter((v) => v).join(' · ');
    }

    /** The line's allocation in Old EquipRite (line detail), where a unit is re-allocated. '' when unknown. */
    oldLineLink(oldAppUrl, request, lineId, lines) {
      if (!oldAppUrl || !request || !lineId) {
        return '';
      }
      const numericId = request.eqrEquipmentRequestId || request.id;
      if (!numericId) {
        return '';
      }
      const line = (Array.isArray(lines) ? lines : []).find((l) => String(l.lineId) === String(lineId)) || {};
      const base = oldAppUrl.endsWith('/') ? oldAppUrl : `${oldAppUrl}/`;
      return `${base}vp/shell/equipment-foundation/line-detail?requestId=${encodeURIComponent(numericId)}`
        + `&requestNumber=${encodeURIComponent(request.requestNumber || '')}&lineId=${encodeURIComponent(lineId)}`
        + `&equipmentMasterId=${encodeURIComponent(line.equipmentMasterId != null ? line.equipmentMasterId : '')}`;
    }

    // ── Pick slip preview (DOM only, as on the old page) ────────────────────────────────────────────────────

    /** Prints the PDF through the preview iframe, so the browser prints the slip and not the page. */
    printPickSlip() {
      const frame = document.querySelector('#pickSlipPreviewDialog iframe');
      if (!frame || !frame.contentWindow) {
        console.warn('[pickSlip] preview iframe not found; nothing to print');
        return;
      }
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
      } catch (e) {
        console.error('[pickSlip] print failed:', e);
      }
    }

    /** Saves the slip under its file name. The URL is revoked by closePickingDrawerChain, not here. */
    downloadPickSlip(url, fileName) {
      if (!url) {
        return;
      }
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName || 'pick-slip.pdf';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  }

  return PageModule;
});
