define([
  'ojs/ojdatagridprovider',
  'ojs/ojeventtarget',
  'resources/js/lineStatusLabels'
], (ojdatagridprovider, ojeventtarget, lineStatusLabels) => {
  'use strict';

  // Page-specific override: picking workflow hides pre-allocation statuses
  // since those lines aren't pickable yet. All other labels come from the
  // shared map in resources/js/lineStatusLabels.js (single source of truth).
  const PICKING_BLANK_STATUSES = ['SUBMITTED', 'IN_PROCESS'];

  // Only lines physically returned to the yard can be accepted (closed) here.
  // Every other lineStatus renders as a disabled row (grayed + checkbox off)
  // and cannot feed the Accept action.
  const ACCEPTABLE_RETURN_STATUS = 'SHIPPED_TO_YARD';

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

  // Dispatches a refresh so cell templates re-render — needed because the
  // data grid does not re-evaluate cell-template :checked bindings on plain
  // KO observable changes, only on a provider event (see checkbox handlers).
  ArrayDataGridProvider.prototype.doRefresh = function () {
    this.dispatchEvent(new ojdatagridprovider.DataGridProviderRefreshEvent());
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
  const COLUMN_KEYS = [
    '__select__',
    'equipmentName',
    'equipmentClass',
    'quantity',
    'serialNumber',
    'toNumber',
    'lineStatus'
  ];

  const COLUMN_HEADERS = [
    '', 'Equipment', 'Class', 'Qty', 'Serial Number', 'Inbound Transfer Order No',
    'Line Status'
  ];

  // 'statusblank' column honours the rule: if the row's lineStatus is
  // SUBMITTED or IN_PROCESS, render an empty cell (no em-dash, no text).
  const COLUMN_TYPES = [
    'select',       // 0  row checkbox
    'readonly',     // 1  equipmentName
    'readonly',     // 2  equipmentClass
    'readonly',     // 3  quantity
    'readonly',     // 4  serialNumber
    'readonly',     // 5  toNumber
    'statusblank'   // 6  lineStatus
  ];

  const COLUMN_WIDTHS = [
    44, 260, 160, 70, 240, 200, 140
  ];

  // ═══════════════════════════════════════════════════════════════════
  // Direct Return dialog grid — its own column set.
  //
  // Deliberately separate from COLUMN_* above: that grid lists the LINES of
  // one known request, this one lists candidate UNITS found by scanning, and
  // the whole point of the feature is that the request is not yet known. The
  // Request and Project columns are what let an operator tell two rentals of
  // the same machine apart, so they cannot be dropped to match the other grid.
  // ═══════════════════════════════════════════════════════════════════
  const DR_COLUMN_HEADERS = [
    '', 'Unit', 'Equipment', 'Request', 'Project / Customer', 'Status', 'Due back', 'Yard'
  ];

  const DR_COLUMN_TYPES = [
    'select',    // 0  row checkbox
    'unit',      // 1  serial / unit identifier (monospace)
    'readonly',  // 2  equipmentName
    'readonly',  // 3  requestNumber
    'readonly',  // 4  partyName
    'status',    // 5  lineStatus  -> pill
    'duedate',   // 6  endDate     -> red when overdue
    'readonly'   // 7  yardOrgName
  ];

  const DR_COLUMN_WIDTHS = [
    44, 190, 230, 190, 210, 150, 110, 150
  ];


  class PageModule {
    constructor() {
      this._linesSignature = '';
      this._dataGridProvider = null;
      this._lineRefs = [];
      this._selectedLineRows = new Set();
      // Direct Return dialog grid
      this._directSignature = '';
      this._directGridProvider = null;
      this._directRefs = [];
    }

    // ─── small utilities ────────────────────────────────────────────
    stopEvent(event) {
      if (event && typeof event.stopPropagation === 'function') {
        event.stopPropagation();
      }
    }

    // Today as an ISO date string (YYYY-MM-DD) — caps the Actual Return Date
    // picker so a return can't be dated in the future (an equipment can only
    // have come back on or before today).
    todayIso() {
      return new Date().toISOString().slice(0, 10);
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
      // Signature must change when lineStatus / toNumber move, not just
      // when the line set changes — otherwise the grid won't refresh when
      // those fields are populated by the open-drawer chain.
      const signature = lines.length + ':' + lines.map(l =>
        (l.lineId || '') + '|' + (l.lineStatus || '') + '|' + (l.toNumber || '')
      ).join('~');
      if (signature === this._linesSignature && this._dataGridProvider) {
        return this._dataGridProvider;
      }
      this._linesSignature = signature;
      this._lineRefs = lines;
      // Row indices are only meaningful against the line set that produced
      // them — reset selection whenever that set is rebuilt (new request
      // opened, or lines refreshed after Accept).
      this._selectedLineRows = new Set();

      const data = lines.map(line => {
        return COLUMN_KEYS.map((key, idx) => {
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

    // ─── Equipment Lines row selection (Accept action) ──────────────
    // A line is actionable only once its lineStatus is SHIPPED_TO_YARD;
    // every other status renders disabled and cannot be selected/accepted.
    isLineRowEligible(rowIndex) {
      const line = (this._lineRefs || [])[rowIndex];
      return !!line && line.lineStatus === ACCEPTABLE_RETURN_STATUS;
    }

    _eligibleRowIndices() {
      const refs = this._lineRefs || [];
      const out = [];
      for (let i = 0; i < refs.length; i++) {
        if (refs[i] && refs[i].lineStatus === ACCEPTABLE_RETURN_STATUS) out.push(i);
      }
      return out;
    }

    // Inline style for a line cell — grays out ineligible rows so the whole
    // line reads as disabled.
    getReturnCellStyle(rowIndex) {
      const base = 'padding: 0 4px;';
      return this.isLineRowEligible(rowIndex) ? base : base + ' opacity: 0.45; color: #94a3b8;';
    }

    isLineRowSelected(rowIndex) {
      return this._selectedLineRows.has(rowIndex);
    }

    toggleLineRowSelected(rowIndex, event) {
      // Ineligible lines can't be selected (defense-in-depth behind the
      // disabled checkbox in the cell template).
      if (!this.isLineRowEligible(rowIndex)) return;
      if (event.target.checked) {
        this._selectedLineRows.add(rowIndex);
      } else {
        this._selectedLineRows.delete(rowIndex);
      }
    }

    onLineRowCheckboxChanged(rowIndex, notify, event) {
      this.toggleLineRowSelected(rowIndex, event);
      this._refreshLinesGridCells();
      try { if (typeof notify === 'function') notify(event); } catch (e) {}
    }

    onLineHeaderCheckboxChanged(notify, event) {
      this.toggleAllLinesSelected(event);
      this._refreshLinesGridCells();
      try { if (typeof notify === 'function') notify(event); } catch (e) {}
    }

    isAllLinesSelected() {
      // "Select all" is scoped to eligible (SHIPPED_TO_YARD) lines only.
      const eligible = this._eligibleRowIndices();
      return eligible.length > 0 && eligible.every(i => this._selectedLineRows.has(i));
    }

    toggleAllLinesSelected(event) {
      const eligible = this._eligibleRowIndices();
      const allSelected = eligible.length > 0 && eligible.every(i => this._selectedLineRows.has(i));
      this._selectedLineRows = allSelected ? new Set() : new Set(eligible);
    }

    _refreshLinesGridCells() {
      const p = this._dataGridProvider;
      if (p && typeof p.doRefresh === 'function') {
        try { p.doRefresh(); } catch (e) {}
      }
    }

    // Called by AcceptReturnLinesChain to know which lines to PATCH.
    getSelectedLines() {
      const refs = this._lineRefs || [];
      return Array.from(this._selectedLineRows)
        .map(idx => refs[idx])
        .filter(l => l !== undefined && l !== null);
    }

    // Called by LineSelectionChangedChain to drive the Accept button's
    // disabled state via $page.variables.lineSelectionState.
    getLineSelectionStateRaw() {
      return { count: this._selectedLineRows.size };
    }

    getColumnType(columnIndex) {
      return COLUMN_TYPES[columnIndex] || 'readonly';
    }

    getColumnHeaderStyle(headerContext) {
      const baseStyle = 'font-weight: 700; background-color: #f1f5f9; color: #475569; padding: 10px 12px; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
      const w = COLUMN_WIDTHS[headerContext.index] || 120;
      return baseStyle + ' width: ' + w + 'px;';
    }

    // ══ DIRECT RETURN dialog helpers ═════════════════════════════════
    // Selection here is by ROW KEY, not row index. The dialog's list is
    // re-fetched on every search, so an index would point at a different unit
    // after the next scan — and returning the wrong unit frees equipment that
    // is still on site. rowKey is (line, unit), the endpoint's own grain.

    // ─── Direct Return data grid ────────────────────────────────────
    // Same ArrayDataGridProvider shape as getLinesGridProvider, rebuilt when
    // the result set changes. The signature includes rowKey so a new search
    // that happens to return the same COUNT still rebuilds the grid.
    getDirectGridProvider(rows) {
      const list = rows || [];
      const signature = list.length + ':' + list.map(r => r && r.rowKey).join('~');
      if (signature === this._directSignature && this._directGridProvider) {
        return this._directGridProvider;
      }
      this._directSignature = signature;
      // Row order is the grid's only handle on a row; keep the array the
      // cell templates resolve against in lockstep with the provider.
      this._directRefs = list;

      const data = list.map(row => DR_COLUMN_TYPES.map((type, idx) => {
        switch (type) {
          case 'select':   return { data: '' };
          case 'unit':     return { data: this.directUnitLabel(row) };
          case 'status':   return { data: row.lineStatus || '' };
          case 'duedate':  return { data: this.directDateOnly(row.endDate) };
          default:
            // Column order is fixed by DR_COLUMN_TYPES; map index -> field.
            return { data: [
              '', '', row.equipmentName, row.requestNumber,
              row.partyName, '', '', row.yardOrgName
            ][idx] || '' };
        }
      }));

      this._directGridProvider = new ArrayDataGridProvider(
        {
          data,
          rowHeader:    [list.map((_, i) => i + 1)],
          columnHeader: [DR_COLUMN_HEADERS.slice()]
        },
        {}, {}, {}, {}, {}
      );
      return this._directGridProvider;
    }

    directColumnType(columnIndex) {
      return DR_COLUMN_TYPES[columnIndex] || 'readonly';
    }

    directColumnHeaderStyle(headerContext) {
      const base = 'font-weight: 700; background-color: var(--oj-core-neutral-color-10, #f1f5f9); '
                 + 'color: var(--oj-core-text-color-secondary, #475569); padding: 10px 12px; '
                 + 'font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em; '
                 + 'white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
      const w = DR_COLUMN_WIDTHS[headerContext.index] || 140;
      return base + ' width: ' + w + 'px;';
    }

    // The row behind a grid row index. Selection is stored by rowKey, so every
    // cell template resolves index -> row -> rowKey rather than trusting index.
    directRowAt(rowIndex) {
      return (this._directRefs || [])[rowIndex] || null;
    }

    directRowKeyAt(rowIndex) {
      const r = this.directRowAt(rowIndex);
      return r ? r.rowKey : '';
    }

    isDirectRowIndexSelected(rowIndex, $page) {
      return this.isDirectRowSelected(this.directRowKeyAt(rowIndex), $page);
    }

    toggleDirectRowIndex(rowIndex, $page) {
      const key = this.directRowKeyAt(rowIndex);
      if (key) this.toggleDirectRow(key, $page);
    }

    // Overdue is server-told; the client never re-derives it, or the grid and
    // the filter would disagree about the boundary.
    directCellStyle(rowIndex, columnIndex) {
      const base = 'padding: 0 4px;';
      if (DR_COLUMN_TYPES[columnIndex] !== 'duedate') return base;
      const row = this.directRowAt(rowIndex);
      return (row && row.overdue)
        ? base + ' color: var(--oj-core-danger-color-1, #c74634); font-weight: 600;'
        : base;
    }

    isDirectRowSelected(rowKey, $page) {
      const sel = ($page && $page.variables.directReturnSelected) || [];
      return sel.indexOf(rowKey) !== -1;
    }

    toggleDirectRow(rowKey, $page) {
      const sel = ($page.variables.directReturnSelected || []).slice();
      const i = sel.indexOf(rowKey);
      if (i === -1) sel.push(rowKey); else sel.splice(i, 1);
      // Reassign rather than mutate — the binding only re-evaluates on a new
      // array reference.
      $page.variables.directReturnSelected = sel;
    }

    directSelectedCount($page) {
      return (($page && $page.variables.directReturnSelected) || []).length;
    }

    // Result-count line. Says "showing N of M" whenever the set is truncated,
    // so a broad term visibly reads as broad instead of looking complete.
    directResultSummary($page) {
      const m = ($page && $page.variables.directReturnMeta) || {};
      if (!m.searched) return '';
      if (m.tooShort)  return 'Type at least 2 characters.';
      if (m.error)     return 'Search failed. Try again.';
      const shown = (($page.variables.directReturnRows) || []).length;
      if (!shown)      return 'No equipment in the field matches that.';
      return shown < m.recordCount
        ? 'Showing ' + shown + ' of ' + m.recordCount + ' matches — narrow the search to see the rest.'
        : shown + (shown === 1 ? ' match' : ' matches');
    }

    // Shown when a search returns several candidates. A unit can be on more
    // than one rental, so the operator must pick the right one — 47% of
    // deployed serials map to multiple lines.
    directAmbiguityWarning($page) {
      const m = ($page && $page.variables.directReturnMeta) || {};
      const rows = ($page && $page.variables.directReturnRows) || [];
      if (!m.searched || rows.length < 2) return '';
      // Runs inline after the count now, not in a banner, so it is phrased as
      // a short clause rather than a standalone sentence. The row count is
      // already stated by directResultSummary immediately before it.
      return 'check the request and project — a unit can be out on more than one rental';
    }

    // '' when the unit has no label at all (a lot/bulk line with no unit row).
    directUnitLabel(row) {
      if (!row) return '';
      return row.serialNumber || row.unitIdentifier || '—';
    }

    directDateOnly(iso) {
      return iso ? String(iso).slice(0, 10) : '';
    }

    getIsEditable() {
      return false;
    }
  }

  return PageModule;
});
