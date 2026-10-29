define([
  'ojs/ojdatagridprovider',
  'ojs/ojeventtarget',
  'resources/js/lineStatusLabels',
  'resources/js/pickSlip'
], (ojdatagridprovider, ojeventtarget, lineStatusLabels, pickSlip) => {
  'use strict';

  // Page-specific override: picking workflow hides pre-allocation statuses
  // since those lines aren't pickable yet. All other labels come from the
  // shared map in resources/js/lineStatusLabels.js (single source of truth).
  const PICKING_BLANK_STATUSES = ['SUBMITTED', 'IN_PROCESS'];

  // ═══════════════════════════════════════════════════════════════════
  // ArrayDataGridProvider — embedded from Oracle JET cookbook
  // (read-only variant; identical structure to the request-detail
  //  page provider, sans the editable bits we don't use here)
  // ═══════════════════════════════════════════════════════════════════
  function ArrayDataGridProvider(dataParameters, sortParameters, mergeStrategy, requiredParameters, filterParameters, itemMetadata) {
    this.dataParameters = dataParameters;
    this.sortParameters = sortParameters || {};
    this.mergeStrategy = mergeStrategy || {};
    this.requiredParameters = requiredParameters || {};
    this.filterParameters = filterParameters || {};
    this.itemMetadata = itemMetadata || {};
    this.version = 0;
    this.totals = {};
    this.levels = {};
    this._setTotalCounts();
  }

  ArrayDataGridProvider.row = 'row';
  ArrayDataGridProvider.rowEnd = 'rowEnd';
  ArrayDataGridProvider.column = 'column';
  ArrayDataGridProvider.columnEnd = 'columnEnd';
  ArrayDataGridProvider.unsorted = 'unsorted';

  ArrayDataGridProvider.prototype._setTotalCounts = function () {
    const dp = this.dataParameters;
    this.totals.column = Math.max(
      dp.data && dp.data[0] ? dp.data[0].length : -1,
      dp.columnHeader && dp.columnHeader[0] ? dp.columnHeader[0].length : -1
    );
    this.totals.row = Math.max(
      dp.data ? dp.data.length : -1,
      dp.rowHeader && dp.rowHeader[0] ? dp.rowHeader[0].length : -1
    );
    this.levels.row = Math.max(0, dp.rowHeader ? dp.rowHeader.length : 0);
    this.levels.column = Math.max(0, dp.columnHeader ? dp.columnHeader.length : 0);
    this.levels.rowEnd = 0;
    this.levels.columnEnd = 0;
  };

  ArrayDataGridProvider.prototype.fetchByOffset = function (parameters) {
    const self = this;
    return new Promise((resolve) => {
      const rowOffset = parameters.rowOffset;
      const columnOffset = parameters.columnOffset;
      const rowCount = Math.min(parameters.rowCount, self.totals.row - rowOffset);
      const columnCount = Math.min(parameters.columnCount, self.totals.column - columnOffset);
      const version = self.version;

      const databody = self._getResults(self.dataParameters.data, {
        outerOffset: rowOffset, innerOffset: columnOffset,
        outerCount: rowCount,    innerCount: columnCount
      }, self._createDataItem.bind(self));

      const rowHeader = self._getResults(self.dataParameters.rowHeader, {
        outerOffset: 0, innerOffset: rowOffset,
        outerCount: self.levels.row, innerCount: rowCount
      }, self._createHeaderItem.bind(self, ArrayDataGridProvider.row));

      const columnHeader = self._getResults(self.dataParameters.columnHeader, {
        outerOffset: 0, innerOffset: columnOffset,
        outerCount: self.levels.column, innerCount: columnCount
      }, self._createHeaderItem.bind(self, ArrayDataGridProvider.column));

      resolve({
        fetchParameters: parameters,
        rowDone:    rowOffset + rowCount >= self.totals.row,
        columnDone: columnOffset + columnCount >= self.totals.column,
        rowOffset, columnOffset, rowCount, columnCount,
        totalRowCount:    self.totals.row,
        totalColumnCount: self.totals.column,
        results: { databody, rowHeader, columnHeader },
        version, next: null
      });
    });
  };

  ArrayDataGridProvider.prototype.getCapability = function (capabilityName) {
    if (capabilityName === 'version') return 'monotonicallyIncreasing';
    return null;
  };

  ArrayDataGridProvider.prototype.isEmpty = function () {
    return (this.totals.column <= 0 && this.totals.row <= 0) ? 'yes' : 'no';
  };

  ArrayDataGridProvider.prototype._getResults = function (outerValues, params, createItem) {
    const { outerOffset, innerOffset, outerCount, innerCount } = params;
    if (outerValues && outerValues[0] && outerValues[0].length > 0) {
      const results = [];
      for (let outer = outerOffset; outer < outerOffset + outerCount; outer++) {
        const innerValues = outerValues[outer];
        if (!innerValues) continue;
        for (let inner = innerOffset; inner < innerOffset + innerCount; inner++) {
          const data = innerValues[inner];
          const mergeResults = { innerOffset: inner, outerOffset: outer, innerExtent: 1, outerExtent: 1 };
          results.push(createItem(data, mergeResults));
        }
      }
      return results;
    }
    return null;
  };

  ArrayDataGridProvider.prototype._createDataItem = function (data, m) {
    return {
      rowExtent: m.outerExtent, columnExtent: m.innerExtent,
      rowIndex:  m.outerOffset, columnIndex: m.innerOffset,
      metadata: {}, data
    };
  };

  ArrayDataGridProvider.prototype._createHeaderItem = function (axis, data, m) {
    const level = this.levels[axis] - m.outerOffset - m.outerExtent;
    return { index: m.innerOffset, extent: m.innerExtent, level, depth: m.outerExtent, metadata: {}, data };
  };

  ojeventtarget.EventTargetMixin.applyMixin(ArrayDataGridProvider);


  // ═══════════════════════════════════════════════════════════════════
  // Column configuration — physical order in the grid (index 0 leftmost)
  // ═══════════════════════════════════════════════════════════════════
  // These four arrays are PARALLEL and consumed by index — keep them in
  // lockstep when adding or removing a column. The cell template dispatches on
  // getColumnType(columnIndex) rather than on literal indices, so nothing in
  // the HTML needs touching.
  // Column 0 is the row-select checkbox. It has NO backing field on the line —
  // '' is a placeholder so the four arrays stay index-aligned; the 'select'
  // cell template renders a checkbox and ignores the cell value entirely.
  // Selection lives in the page module's _selectedRows Set, not in grid data.
  const COLUMN_KEYS = [
    '',
    'equipmentName',
    'equipmentClass',
    'quantity',
    'serialNumber',
    'yard',
    'subinventory',
    'locator',
    'toNumber',
    'lineStatus'
  ];

  const COLUMN_HEADERS = [
    '', 'Equipment', 'Class', 'Qty', 'Serial Number', 'Yard',
    'Subinventory', 'Locator', 'Transfer Order No.', 'Line Status'
  ];

  // 'statusblank' column honours the rule: if the row's lineStatus is
  // SUBMITTED or IN_PROCESS, render an empty cell (no em-dash, no text).
  const COLUMN_TYPES = [
    'select',       // 0  row checkbox (no backing field)
    'readonly',     // 1  equipmentName
    'readonly',     // 2  equipmentClass
    'readonly',     // 3  quantity
    'readonly',     // 4  serialNumber
    'readonly',     // 5  yard  (inv org of the allocated unit — see openPickingDrawerChain)
    'readonly',     // 6  subinventory (EQR_SERIAL_REF.CURRENT_SUBINVENTORY, via getSerialRefs)
    'readonly',     // 7  locator      (EQR_SERIAL_REF.CURRENT_LOCATOR)
    'readonly',     // 8  toNumber
    'statusblank'   // 9  lineStatus
  ];

  // Sums to 1494, inside the dialog's 95vw / max 1600px.
  const COLUMN_WIDTHS = [
    44, 260, 160, 70, 240, 150, 140, 130, 160, 140
  ];


  class PageModule {
    constructor() {
      this._linesSignature = '';
      this._dataGridProvider = null;
      // Row-select checkbox state: indices into the CURRENT lines array.
      // Held here rather than in grid data because the provider rebuilds its
      // rows on every signature change and would drop it.
      this._selectedRows = new Set();
      this._lineRefs = [];
      // orderNumber of the TO currently chosen in the LOV, so the grid provider
      // can re-apply its auto-tick after a rebuild. See onTOSelectionChanged.
      this._pendingTOOrderNumber = '';
    }

    // ─── small utilities ────────────────────────────────────────────
    stopEvent(event) {
      if (event && typeof event.stopPropagation === 'function') {
        event.stopPropagation();
      }
    }

    isAllSelected(selectedIds, rows) {
      if (!rows || rows.length === 0) return false;
      if (!selectedIds || selectedIds.length === 0) return false;
      return selectedIds.length >= rows.length;
    }

    isPartiallySelected(selectedIds, rows) {
      if (!selectedIds || selectedIds.length === 0) return false;
      if (!rows || rows.length === 0) return false;
      return selectedIds.length > 0 && selectedIds.length < rows.length;
    }

    // ─── badge label / variant maps (still used by exception cards) ─
    getPickingStatusLabel(status) {
      const map = {
        PENDING:     'Pending',
        IN_PROGRESS: 'In Progress',
        COMPLETED:   'Completed',
        EXCEPTION:   'Exception',
        ALLOCATED:   'Allocated'
      };
      return map[status] || status;
    }

    getPickingStatusVariant(status) {
      const map = {
        PENDING:     'pick-status--neutral',
        IN_PROGRESS: 'pick-status--info',
        COMPLETED:   'pick-status--success',
        EXCEPTION:   'pick-status--danger',
        ALLOCATED:   'pick-status--success'
      };
      return map[status] || 'pick-status--neutral';
    }

    // Request status uses the app-wide pill map so this page's colours match
    // every other page. See resources/js/lineStatusLabels.js.
    getReqStatusVariant(status) {
      return lineStatusLabels.statusPillClass(status);
    }

    getReqStatusLabel(status) {
      const map = {
        IN_PROCESS:     'IN PROCESS',
        QUOTE_ACCEPTED: 'QUOTE ACCEPTED',
        PICK_INITIATED: 'PICKING IN PROGRESS',
        PICK_RELEASED:  'PICKING COMPLETE',
        REJECTED:       'REJECTED'
      };
      return map[status] || status;
    }

    // Delegates to the shared label map in resources/js/lineStatusLabels.js.
    // PICKING_BLANK_STATUSES hides SUBMITTED / IN_PROCESS for this page only
    // (the picking workflow ignores pre-allocation lifecycle states).
    getLineStatusLabel(status) {
      return lineStatusLabels.formatLineStatus(status, PICKING_BLANK_STATUSES);
    }

    getPriorityVariant(priority) {
      const map = { HIGH: 'pick-status--danger', MEDIUM: 'pick-status--warning', LOW: 'pick-status--neutral' };
      return map[priority] || 'pick-status--neutral';
    }

    getBulkProgressPct(current, total) {
      if (!total) return 0;
      return Math.round((current / total) * 100);
    }

    /**
     * Is the TO currently chosen in the LOV still awaiting release?
     *
     * Drives the Release for Picking button's enablement. Released TOs are now
     * kept in selectedRequestTOs flagged `released` (ReleaseTransferOrderChain
     * explains why they are no longer spliced out), so "can I release this one?"
     * is a per-option question rather than "is the list non-empty".
     *
     * Returns false when nothing is selected, so the button greys out instead of
     * firing a release with no target.
     */
    canReleaseSelectedTO(tos, selectedTOId, selectionTick) {
      // F&M lines are released by TICKING them, not by picking a transfer
      // order — they have none. Any ticked F&M line still at ALLOCATED enables
      // the button, independently of the LOV, so an F&M-only request (which
      // has no selectable TO at all) can still be released.
      //
      // selectionTick is unused inside, but MUST stay in the signature: the
      // checkbox state lives in a plain Set on the page module, which is not
      // observable, so the binding needs a variable that changes to re-evaluate
      // this. See onRowCheckboxChanged.
      if (this._selectedRows && this._selectedRows.size) {
        const picked = this.selectedLines();
        // SCHEDULED_FOR_PICKING is what Confirm now writes; ALLOCATED is kept
        // for lines confirmed before that change. Both mean "confirmed, not yet
        // released". Must match RELEASABLE_FM_STATUSES in
        // ReleaseTransferOrderChain, or the button enables and the click no-ops.
        const RELEASABLE = ['SCHEDULED_FOR_PICKING', 'ALLOCATED'];
        if (picked.some(l => l && l.isFAndM === true
                             && RELEASABLE.indexOf(String(l.lineStatus || '').toUpperCase()) !== -1)) {
          return true;
        }
      }
      // TRANSFER ORDERS COME FROM THE TICKS, NOT FROM A DROPDOWN.
      //
      // selectedTOId is still maintained (_syncSelectedTOFromTicks) for the
      // consumers that are single-TO by nature, but it goes BLANK on a multi-TO
      // tick — so gating on it here would grey the button out for exactly the
      // case this now supports. Ask the ticks instead: any ticked order still
      // awaiting release enables Release, and the chain sends them all to OIC
      // in one batch.
      //
      // Orders already released are filtered out by releasableTOOptions rather
      // than blocking the selection, so a mixed tick (one done, one not) still
      // releases the one that needs it.
      return this.releasableTOOptions(tos).length > 0;
    }

    /**
     * How many distinct transfer orders the ticked lines span.
     *
     * Drives the panel's "releasing N transfer orders" note. With the LOV gone,
     * nothing else on screen states how wide the selection is — the grid shows
     * the numbers per line, but a user ticking forty rows should not have to
     * read the column to find out that Release is about to act on three orders.
     */
    selectedTOCount(tos, selectionTick) {
      return this.selectedTOOptions(tos).length;
    }

    /** Order numbers of the ticked, still-unreleased TOs — for the note's text. */
    releasableTONumbers(tos, selectionTick) {
      return this.releasableTOOptions(tos)
        .map(t => String(t.orderNumber || ''))
        .filter(n => n !== '')
        .join(', ');
    }

    /** Count of transfer orders still awaiting release — for the hint text. */
    unreleasedTOCount(tos) {
      if (!Array.isArray(tos)) return 0;
      return tos.filter(t => t && !t.released).length;
    }

    /**
     * Can the TO currently chosen in the LOV be shipped — i.e. is it released
     * AND does it still have lines sitting at PICK_INITIATED?
     *
     * Drives Pick and Ship. Scoped to the SELECTED transfer order rather than
     * "any PICK_INITIATED line on the request", so with several TOs the button
     * acts on the order the user actually picked in the LOV. The old
     * request-wide test would light up for TO -002 because TO -001 had picked
     * lines, making it ambiguous which order was about to ship.
     *
     * Lines are matched on toNumber, the same field the Equipment Lines grid
     * shows in its TRANSFER ORDER NO. column.
     */
    // selectionTick is unused inside but MUST stay in the signature: the
    // ticked-rows Set is not observable, and this gate now depends on it, so
    // the binding needs a changing variable to re-evaluate. Same device as
    // canReleaseSelectedTO.
    canShipSelectedTO(tos, selectedTOId, lines, selectionTick) {
      if (!Array.isArray(lines)) return false;

      // F&M lines have no transfer order, so they enable the button
      // INDEPENDENTLY of the LOV selection — requiring a released TO would
      // leave an F&M-only request with Pick and Ship permanently greyed.
      //
      // PICK_INITIATED, not ALLOCATED: an F&M line must be released first
      // (tick it + Release for Picking), exactly like an S&T line. A line still
      // at ALLOCATED has not been released and must not ship.
      //
      // HONOURS THE TICKS. When rows are ticked, only those rows count — the
      // chain ships exactly the ticked lines, so the button must not light up
      // on the strength of some OTHER line being ready. Without this, ticking
      // an ALLOCATED line showed Pick and Ship enabled (because a different,
      // unticked line was at PICK_INITIATED) and clicking it shipped that
      // other line.
      const ticked = (this._selectedRows && this._selectedRows.size)
        ? this.selectedLines()
        : null;
      const candidates = ticked && ticked.length ? ticked : lines;
      const hasFAndMReady = candidates.some(l => l
        && l.isFAndM === true
        && l.lineStatus === 'PICK_INITIATED');
      if (hasFAndMReady) return true;
      // Ticked rows that are all F&M but none ready → nothing to ship. Fall
      // through to the TO test below rather than returning early, so a mixed
      // request with a live transfer order still enables correctly.

      if (!Array.isArray(tos) || !selectedTOId) return false;
      const sel = tos.find(t => t && String(t.value) === String(selectedTOId));
      if (!sel || !sel.released) return false;
      const num = String(sel.orderNumber || '');
      if (!num) return false;
      return lines.some(l => l
        && String(l.toNumber || '') === num
        && l.lineStatus === 'PICK_INITIATED');
    }

    /**
     * Does the open request contain any F&M line?
     *
     * F&M (Fixed-asset / Maintenance tracked, isTransactable='N') lines never
     * get a Transfer Order, so an F&M-ONLY request reaches this drawer with
     * selectedRequestTOs empty. The Transfer Order panel used to be gated purely
     * on that array being non-empty, which hid the panel — and with it the Pick
     * and Ship button — for exactly the requests that need it, showing "No
     * Transfer Order on this request yet" instead. Those lines were then
     * unshippable from this page.
     *
     * The panel now renders when there are TOs OR F&M lines. The LOV and Release
     * for Picking stay disabled with no TOs (canReleaseSelectedTO returns false
     * on an empty selection), so an F&M-only request shows the panel with only
     * Pick and Ship live — which is the whole of its pathway.
     */
    hasFAndMLines(lines) {
      return Array.isArray(lines) && lines.some(l => l && l.isFAndM === true);
    }

    hasLastResult(lastPickingResults, requestId) {
      return !!(lastPickingResults && lastPickingResults[requestId]);
    }

    getLastResult(lastPickingResults, requestId) {
      return (lastPickingResults && lastPickingResults[requestId]) || null;
    }

    // ─── Equipment Lines data grid ──────────────────────────────────
    // Called from the HTML as: data="[[ $page.functions.getLinesGridProvider($variables.selectedRequest.lines) ]]"
    // The signature check rebuilds the provider whenever the lines array
    // changes (which is how the dialog refreshes between requests).
    getLinesGridProvider(linesData) {
      const lines = linesData || [];
      // Signature must change when lineStatus / toNumber / yard move, not just
      // when the line set changes — otherwise the grid won't refresh when
      // those fields are populated by the open-drawer chain. yard is included
      // for the same reason: it arrives with the per-line units fetch, after
      // the dialog has already rendered its first (empty) line array.
      const signature = lines.length + ':' + lines.map(l =>
        (l.lineId || '') + '|' + (l.lineStatus || '') + '|' + (l.toNumber || '') +
        '|' + (l.yard || '') +
        // subinventory/locator arrive with the same fetch wave as yard, after
        // the dialog has rendered its first (empty) line array — omitting them
        // here leaves both columns permanently blank.
        '|' + (l.subinventory || '') + '|' + (l.locator || '')
      ).join('~');
      if (signature === this._linesSignature && this._dataGridProvider) {
        return this._dataGridProvider;
      }
      this._linesSignature = signature;

      // Selection is by ROW INDEX, so it is only meaningful against the lines
      // it was made on. The signature changing means the rows moved (a
      // different request opened, or a status/TO/yard update rebuilt them), so
      // stale indices would silently point at the wrong lines — clear them.
      this._selectedRows = new Set();
      this._lineRefs = lines;

      // Re-apply the drawer's opening auto-tick against the NEW rows.
      //
      // ORDERING: openPickingDrawerChain picks the actionable order and calls
      // onTOSelectionChanged while fetching transfer orders, which is BEFORE the
      // lines arrive and before this provider is first built. So that tick was
      // either against an empty _lineRefs or wiped by the clear above.
      // Re-deriving it here from the remembered order number is what makes the
      // drawer open with the right lines already ticked — and since the ticks
      // are now what scopes Release and Pick and Ship, opening without them
      // would leave both buttons dead on arrival.
      //
      // Derived, never carried over: it re-matches on toNumber against these
      // rows, so it cannot resurrect an index from the previous line set.
      if (this._pendingTOOrderNumber) {
        lines.forEach((l, i) => {
          if (l && String(l.toNumber || '') === this._pendingTOOrderNumber) {
            this._selectedRows.add(i);
          }
        });
      }

      const data = lines.map(line => {
        return COLUMN_KEYS.map((key, idx) => {
          // Column 0 (the checkbox) has no backing field; its cell value is
          // unused because the 'select' template renders an input instead.
          if (COLUMN_TYPES[idx] === 'select') {
            return { data: '' };
          }
          const raw = line[key] !== undefined && line[key] !== null ? line[key] : '';
          // 'statusblank' = lineStatus column. Run the raw DB value through
          // the friendly-label map so the cell shows 'PICK INITIATED' instead
          // of 'PICK_INITIATED', and stays blank for SUBMITTED / IN_PROCESS.
          if (COLUMN_TYPES[idx] === 'statusblank') {
            return { data: this.getLineStatusLabel(raw) };
          }
          return { data: raw };
        });
      });
      const rowHeaders    = [lines.map((_, i) => i + 1)];
      const columnHeaders = [COLUMN_HEADERS.slice()];

      this._dataGridProvider = new ArrayDataGridProvider(
        { data, rowHeader: rowHeaders, columnHeader: columnHeaders },
        {}, {}, {}, {}, {}
      );
      return this._dataGridProvider;
    }

    // ─── Row selection (checkbox column) ────────────────────────────
    // Mirrors equipment-request-detail-page.js: selection is held in a Set of
    // row indices on the page module, NOT in the grid's data, because
    // ArrayDataGridProvider rebuilds its rows whenever the signature changes
    // and would discard any checked state stored in a cell.
    //
    // The grid does not re-render on a Set mutation (it is not observable), so
    // each handler calls _refreshGridCells() to push a refresh event, exactly
    // as the reference page does.

    isRowSelected(rowIndex) {
      return this._selectedRows.has(Number(rowIndex));
    }

    /**
     * Header checkbox visual = ALL rows selected, not "any".
     * An any-selected semantic makes the header look checked on a partial
     * selection, which reads as "everything is selected".
     */
    isAllSelected() {
      const total = (this._lineRefs || []).length;
      return total > 0 && this._selectedRows.size === total;
    }

    /** Count of ticked rows — for callers that want to gate an action on it. */
    selectedRowCount() {
      return this._selectedRows.size;
    }

    /** The selected line objects, in grid order. */
    selectedLines() {
      const refs = this._lineRefs || [];
      return refs.filter((_, i) => this._selectedRows.has(i));
    }

    /**
     * The transfer orders the TICKED lines belong to, as options from
     * selectedRequestTOs.
     *
     * THIS REPLACED THE TRANSFER ORDER LOV. The dropdown used to be the one
     * place a TO could be named, so it had to be the control too. The grid now
     * shows each line's order in its TRANSFER ORDER NO. column, which made the
     * LOV a second telling of the same fact — and a worse one, because it could
     * only ever name ONE order while the grid can show several.
     *
     * Scope now comes from the ticks, the same mechanism the F&M path has always
     * used (F&M lines have no TO at all, so they could never be scoped by a
     * dropdown). One mechanism for both classes instead of two.
     *
     * Matched on toNumber — the value the grid displays — so what gets released
     * is exactly what the user can see they ticked. Lines with no toNumber (F&M)
     * contribute nothing here and are handled by the F&M branch instead.
     *
     * Returns the option objects, not just numbers, because the caller needs
     * `value` (the transferOrderId, for the source-org lookup) and `released`
     * (to skip orders already done).
     */
    selectedTOOptions(tos) {
      const options = Array.isArray(tos) ? tos : [];
      if (!options.length) return [];

      const tickedNumbers = new Set(
        this.selectedLines()
          .map(l => String((l && l.toNumber) || ''))
          .filter(n => n !== '')
      );
      if (!tickedNumbers.size) return [];

      return options.filter(t => t && t.orderNumber
        && tickedNumbers.has(String(t.orderNumber)));
    }

    /**
     * Those of the above still awaiting release — what Release for Picking acts on.
     *
     * Already-released orders are SKIPPED rather than rejected: ticking a mix of
     * released and unreleased lines is a reasonable thing to do (they are all on
     * the same request), and refusing the whole selection because one order was
     * already done would make the user hunt for which one.
     */
    releasableTOOptions(tos) {
      return this.selectedTOOptions(tos).filter(t => !t.released);
    }

    /**
     * Keeps $page.variables.selectedTOId in step with the ticks.
     *
     * The variable OUTLIVED the LOV on purpose. Five consumers read it — the two
     * button-enablement functions, ShipConfirmStuckLinesChain's line scoping,
     * PrintPickSlipChain's header, and openPickingDrawerChain's auto-selection —
     * and keeping it as the single scoping value meant none of them had to
     * change when the dropdown went.
     *
     * Single ticked order → that order's id. Zero or SEVERAL → ''. Blank is the
     * honest answer for a multi-TO tick: those consumers are all single-TO by
     * nature (one pick slip header, one ship scope), so pointing them at an
     * arbitrary one of several would be worse than pointing them at none.
     * Multi-TO RELEASE does not read this — it reads releasableTOOptions above.
     */
    _syncSelectedTOFromTicks($page) {
      if (!$page || !$page.variables) return;
      const picked = this.selectedTOOptions($page.variables.selectedRequestTOs);
      $page.variables.selectedTOId = (picked.length === 1) ? String(picked[0].value) : '';
    }

    onRowCheckboxChanged(rowIndex, $page, event) {
      const idx = Number(rowIndex);
      if (event && event.target && event.target.checked) {
        this._selectedRows.add(idx);
      } else {
        this._selectedRows.delete(idx);
      }
      this._syncSelectedTOFromTicks($page);
      this._refreshGridCells();
      this._bumpSelectionTick($page);
    }

    /**
     * partial → all, all → none. The browser flips the native input first, so
     * state is driven from the post-event Set rather than event.target.checked.
     */
    onHeaderCheckboxChanged($page) {
      const total = (this._lineRefs || []).length;
      if (this._selectedRows.size === total && total > 0) {
        this._selectedRows = new Set();
      } else {
        this._selectedRows = new Set();
        for (let i = 0; i < total; i++) {
          this._selectedRows.add(i);
        }
      }
      this._syncSelectedTOFromTicks($page);
      this._refreshGridCells();
      this._bumpSelectionTick($page);
    }

    /**
     * Make the selection change visible to page bindings.
     *
     * _selectedRows is a plain Set, so mutating it notifies nothing. The
     * Release for Picking button's enablement depends on what is ticked, so it
     * reads $variables.selectionTick — bumping that number is what re-runs the
     * binding. Without this the button stays greyed until some unrelated
     * variable happens to change.
     */
    _bumpSelectionTick($page) {
      if ($page && $page.variables && typeof $page.variables.selectionTick === 'number') {
        $page.variables.selectionTick = $page.variables.selectionTick + 1;
      }
    }

    /**
     * Picking a transfer order in the LOV ticks that order's lines below.
     *
     * The two controls describe the same thing from different ends — the LOV
     * names an order, the grid lists the lines on it — so choosing one and
     * having the other stay blank makes the user re-select by hand what they
     * just selected. Lines are matched on toNumber, the same value the grid's
     * TRANSFER ORDER NO. column displays, so what gets ticked is exactly what
     * the user can see belongs to that order.
     *
     * REPLACES the selection rather than adding to it: the LOV is single-select,
     * so "show me this order" means this order, not this one plus whatever was
     * ticked before. Leaving stale ticks from a previous order would be the
     * dangerous reading, since Release and Pick and Ship act on ticked lines.
     *
     * Selecting a TO with no matching lines clears the selection — accurate,
     * and it avoids implying the previous order's lines belong to this one.
     *
     * Wired from on-value-changed, so it fires on user choice AND on the
     * auto-selection the open/release chains perform (they set selectedTOId
     * directly). That is intended: after releasing one order and auto-advancing
     * to the next, the newly-selected order's lines are already ticked.
     */
    onTOSelectionChanged(event, $page) {
      const toId = event && event.detail ? event.detail.value : null;
      const tos  = ($page && $page.variables && $page.variables.selectedRequestTOs) || [];
      const sel  = tos.find(t => t && String(t.value) === String(toId));
      const orderNumber = String((sel && sel.orderNumber) || '');

      // Remembered so getLinesGridProvider can re-apply the tick after it
      // rebuilds rows — the drawer selects a TO before the lines have loaded,
      // so this call alone often has nothing to match against yet.
      this._pendingTOOrderNumber = orderNumber;

      const lines = this._lineRefs || [];
      this._selectedRows = new Set();

      if (orderNumber) {
        lines.forEach((l, i) => {
          if (l && String(l.toNumber || '') === orderNumber) {
            this._selectedRows.add(i);
          }
        });
      }

      this._refreshGridCells();
      this._bumpSelectionTick($page);
    }

    /**
     * Nudge the grid to re-render its cells after a selection change.
     * The Set is plain state, so nothing else would tell the grid to repaint
     * and the checkbox would appear not to respond to the click.
     */
    _refreshGridCells() {
      const grid = document.getElementById('linesDataGrid');
      if (grid && typeof grid.refresh === 'function') {
        try {
          grid.refresh();
        } catch (e) {
          console.warn('[initiate-picking] grid refresh failed:', e);
        }
      }
    }

    getColumnType(columnIndex) {
      return COLUMN_TYPES[columnIndex] || 'readonly';
    }

    getColumnHeaderStyle(headerContext) {
      const baseStyle = 'font-weight: 700; background-color: #f1f5f9; color: #475569; padding: 10px 12px; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
      const w = COLUMN_WIDTHS[headerContext.index] || 120;
      return baseStyle + ' width: ' + w + 'px;';
    }

    getIsEditable() {
      return false;
    }

    // True once Release for Picking has actually advanced a line to
    // PICK_INITIATED. Gates the pick slip icon, and delegates to the SAME
    // predicate the document filters on (resources/js/pickSlip.js) so the icon
    // cannot offer a slip that would come out empty.
    canPrintPickSlip(lines) {
      return pickSlip.hasReleasedLines(lines);
    }

    // The pick slip card is a div, so Enter/Space have to be wired by hand for
    // anyone not using a mouse. preventDefault stops Space scrolling the
    // dialog behind the card.
    openPickSlipOnEnter(event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      const dialog = document.getElementById('pickSlipPreviewDialog');
      if (dialog && typeof dialog.open === 'function') dialog.open();
    }

    // ─── Pick slip preview actions ──────────────────────────────────────
    // Both act on the preview iframe / its blob URL. Kept as page functions
    // rather than chains because neither touches page state or calls REST —
    // they are DOM operations on an element this page owns.

    // Prints the PDF through the iframe's own print, so the browser prints the
    // document rather than the app page around it.
    //
    // contentWindow is reachable because the blob URL is same-origin with the
    // app. A cross-origin src would throw here — worth knowing if this is ever
    // repointed at a server-streamed URL.
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

    // Saves the slip. A synthesised <a download> is the only way to name a
    // downloaded blob — the same device equipment-reports-page and
    // exportCsvChain already use for their exports.
    downloadPickSlip(url, fileName) {
      if (!url) return;
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName || 'pick-slip.pdf';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // The URL is NOT revoked here — the preview iframe is still showing it.
      // ClosePickSlipPreviewChain owns the revoke.
    }
  }

  return PageModule;
});
