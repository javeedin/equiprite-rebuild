define([
  'ojs/ojarraydataprovider',
  'resources/js/arrayDataGridProvider'
], (ArrayDataProvider, ArrayDataGridProvider) => {
  'use strict';

  // ── Staging review grid ───────────────────────────────────────────────
  // The 8 columns the user actually works in. The 133-column oj-table stays
  // as a read-only evidence view; editing two columns that sit ~120 columns
  // apart from the description you need to read them against is not workable.
  //
  // COL_CLASS and COL_SUBCLASS are the only editable ones. Their indexes are
  // used by getColumnType/getStagingProvider, so they are named rather than
  // written as literals in three places.
  // COL_SELECT is the tick box: Import merges exactly the ticked rows. A class
  // match from the Class Mapping config is only a suggestion (AUTO_MAPPED) --
  // nothing reaches the equipment master until a person ticks it and imports.
  const COL_SELECT   = 0;
  const COL_STATUS   = 1;
  const COL_ITEM_NO  = 2;
  const COL_ITEM_DESC = 3;
  const COL_CATEGORY = 4;
  const COL_ITEM_CLASS_CODE = 5;
  const COL_CLASS    = 6;
  const COL_SUBCLASS = 7;
  const COL_PATHWAY  = 8;
  // Column 9, Reason: why the class mapping ERRORED the row, e.g.
  // "NO_MAPPING_MATCH (INVENTORY)" -- REJECT_REASON from resolve_and_promote.

  // The tick-box header is '' on purpose: the header template draws the
  // "select all on this page" box for the empty header.
  const COLUMN_HEADERS = [
    '', 'Status', 'Item Number', 'Description', 'Category', 'Item Class',
    'Class', 'Subclass', 'Unit Pathway', 'Reason', 'Source',
    'Catalog', 'Segment 1', 'Segment 2'
  ];

  // Explicit per-column widths, index-aligned with COLUMN_HEADERS.
  //
  // oj-data-grid defaults every column to the same narrow width, which wrapped
  // headers onto three lines and truncated descriptions and class codes — the
  // two things the reviewer is reading the row FOR. Widths are sized to the
  // content: descriptions are free text and get the most, the two editable
  // columns have to fit an oj-select-single plus its dropdown arrow, and
  // Status is a short enum.
  //
  // These are starting widths, not a lock: header.column.resizable.width is
  // enabled on the grid, so the user can still drag any of them.
  const COLUMN_WIDTHS = [
    '48px',   // (tick box)
    '130px',  // Status        — enum, longest is AUTO_MAPPED
    '150px',  // Item Number
    '340px',  // Description   — free text, the widest thing on the row
    '170px',  // Category
    '190px',  // Item Class    — Fusion class CODE, can be long
    '220px',  // Class         — editable: oj-select-single
    '220px',  // Subclass      — editable: oj-select-single
    '150px',  // Unit Pathway  — "Serial + Lot" is the longest value
    '260px',  // Reason        — e.g. "SUBCLASS_NO_MATCH (FIXED_ASSET)"
    '130px',  // Source        — which precedence source classified the row
    '130px',  // Catalog       — CATALOG_CODE, e.g. Inv_Items
    '160px',  // Segment 1     — the category's first segment (Class Mapping types
    '160px'   // Segment 2       CAT_SEGMENT1/2 match on these)
  ];
  const COLUMN_WIDTH_FALLBACK = '150px';

  // ── "What to map next" ────────────────────────────────────────────────
  // Mapping-type codes as the Class Mapping screen names them. The popup
  // must use the SAME words as the screen the admin is sent to, or "Category
  // Segment 2 = Tablet Cmp" cannot be found there. Numbered families
  // (CAT_SEGMENTn, DFF_ATTRIBUTEn, …) are patterns rather than rows so a
  // segment 7 nobody listed still reads properly.
  const DIM_TYPE_LABELS = {
    CATEGORY:            'Category',
    CATALOG:             'Catalog',
    ITEM_CLASS:          'Item Class',
    ITEM_USER_TYPE:      'Item Type',
    ITEM_STATUS:         'Item Status',
    ITEM_EQUIPMENT_TYPE: 'Equipment Type',
    ITEM_ASSET_CLASS:    'Asset Class',
    MAJOR:               'Major Category',
    MINOR:               'Minor Category',
    WO_TYPE:             'Work Order Type',
    WO_SUB_TYPE:         'Work Order Sub Type',
    ITEM:                'Maintenance Item'
  };
  const DIM_TYPE_PATTERNS = [
    [/^CAT_SEGMENT(\d+)$/,   'Category Segment '],
    [/^DFF_ATTRIBUTE(\d+)$/, 'Item Attribute '],
    [/^CAT_ATTRIBUTE(\d+)$/, 'Category Attribute '],
    [/^MNT_ATTRIBUTE(\d+)$/, 'Maintenance Attribute ']
  ];
  // The popup is a pointer, not a report: eight rows first, "Show all"
  // reveals the rest (the chain asks for 20).
  const UNMATCHED_VISIBLE = 8;

  class PageModule {
    constructor() {
      // rowIndex -> fusionInventoryItemId. The grid addresses cells by index;
      // every write has to land on the merge key instead, because indexes
      // shift under sorting and paging while the id does not.
      this._rowKeys = [];
      // Kept so the navigation-mode renderer can resolve a name without the
      // page variables, which the cell template does not pass it.
      this._lastVariables = null;
    }

    // ── Name lookups (unchanged; used by the 133-column table) ──────────

    /**
     * Class name lookup for a row. Called from the column template since
     * the entity row only carries equipmentClassId. classesById is loaded
     * once at init by EquipmentInitChain.
     */
    classNameFor(equipmentClassId, classesById) {
      if (equipmentClassId == null) return '';
      const map = classesById || {};
      return map[equipmentClassId] || '';
    }

    /**
     * Subclass name lookup for a row. Same pattern as classNameFor.
     */
    subclassNameFor(equipmentSubclassId, subclassesById) {
      if (equipmentSubclassId == null) return '';
      const map = subclassesById || {};
      return map[equipmentSubclassId] || '';
    }

    // ── Grid construction ───────────────────────────────────────────────

    /**
     * Build the review grid's provider from the staged rows.
     *
     * Also rebuilds _rowKeys, so this MUST be called whenever stagingArray
     * changes — a stale key map writes a user's class onto the wrong item.
     */
    buildStagingGrid(stagingArray, variables) {
      this._lastVariables = variables || null;
      const rows = Array.isArray(stagingArray) ? stagingArray : [];

      this._rowKeys = rows.map(r => (r && r.fusionInventoryItemId) || null);

      // EVERY CELL IS WRAPPED AS { data: value }, never a bare value.
      //
      // The provider hands the template its cell as cell.item.data, so the
      // template reads cell.item.data.data — outer = the provider's cell,
      // inner = this wrapper. A bare value makes .data.data undefined and the
      // grid renders blank rows (measured: 100 rows of empty cells while the
      // REST call had returned all 100 items correctly).
      //
      // The wrapper is also what makes editing possible at all: cellEdit
      // two-way binds {{ cell.item.data.data }}, and you cannot write back
      // into a primitive. Same shape as timesheet-detail-page.js:1002.
      const cell = v => ({ data: v });
      const selected = (variables && variables.stagingSelectedRows) || {};

      const data = rows.map(r => {
        const row = r || {};
        const key = row.fusionInventoryItemId;
        return [
          // Initial tick state. The native checkbox then holds its own state;
          // the selection map in stagingSelectedRows is the source of truth.
          cell(key != null && !!selected[key]),
          cell(row.importStatus || ''),
          cell(row.itemNumber || ''),
          cell(row.itemDescription || ''),
          cell(row.categoryName || ''),
          cell(row.itemClassCode || ''),
          // The editable pair. null, not '', so oj-select-single renders as
          // empty rather than trying to match an option whose value is ''.
          cell(row.resolvedClassId != null ? row.resolvedClassId : null),
          cell(row.resolvedSubclassId != null ? row.resolvedSubclassId : null),
          cell(this.unitPathwayFor(row)),
          cell(row.rejectReason || ''),
          // Blank until the staging GET passes RESOLVED_SOURCE through
          // (backend ask 2026-10-02 API #2) -- no guessing from other fields.
          cell(this.sourceLabel(row.resolvedSource)),
          // The values the most common Class Mapping types match on, so a
          // reviewer sees WHY a row did or did not map without opening it.
          cell(row.catalogCode || ''),
          cell(row.catSegment1 || ''),
          cell(row.catSegment2 || '')
        ];
      });

      // Kept so refreshRowCells can redraw one row in place (see there).
      this._grid = new ArrayDataGridProvider({
        data: data,
        columnHeader: [COLUMN_HEADERS]
      });
      return this._grid;
    }

    /**
     * Which physical-unit table this item's units would land in.
     *
     * Serial- and lot-control codes are Fusion's: 1 means "no control", and
     * anything else is controlled. Never test for specific codes — 2, 5, 6,
     * 7 and 8 all exist and all mean controlled.
     *
     * 'None' is NOT an error. Those items have a valid definition and simply
     * have no units; the user may still classify and promote them.
     */
    unitPathwayFor(row) {
      if (!row) return '';
      const serial = Number(row.serialNumControlCode || 1);
      const lot    = Number(row.lotControlCode || 1);
      const paths = [];
      if (serial !== 1) paths.push('Serial');
      if (lot !== 1) paths.push('Lot');
      if (!paths.length && (row.inventoryItemFlag === 'Y')) paths.push('Inventory');
      return paths.length ? paths.join(' + ') : 'None';
    }

    /**
     * Which Class Mapping source classified a row (RESOLVED_SOURCE), as a
     * label. Unknown codes are shown as-is rather than hidden.
     */
    sourceLabel(code) {
      if (!code) return '';
      const labels = { INVENTORY: 'Inventory', MAINTENANCE: 'Maintenance',
                       FIXED_ASSET: 'Fixed Asset', MANUAL: 'Manual' };
      return labels[code] || String(code);
    }

    /**
     * Main list Source column: Fusion for rows the import created, Manual for
     * everything else. CREATED_BY is the only marker the list API returns
     * (no fusionInventoryItemId), and the import stamps it FUSION_IMPORT.
     */
    recordSourceLabel(createdBy) {
      return createdBy === 'FUSION_IMPORT' ? 'Fusion' : 'Manual';
    }

    /**
     * Main list Stock column, from the list API's serialUnitCount (serials of
     * this item) and onHandQty (on-hand + lots). Blank when it has neither.
     */
    stockLabel(serialUnitCount, onHandQty) {
      const parts = [];
      const s = Number(serialUnitCount);
      if (s > 0) parts.push(s.toLocaleString() + (s === 1 ? ' serial' : ' serials'));
      if (onHandQty != null && onHandQty !== '' && !isNaN(Number(onHandQty))) {
        parts.push(Number(onHandQty).toLocaleString() + ' on hand');
      }
      return parts.join(' · ');
    }

    /**
     * The engine refuses a call while another run holds the group lock with
     * statusCode 'E' and statusMsg 'BUSY: …' (V387). Returns a user-facing
     * sentence for that, or '' when the message is not a BUSY refusal.
     */
    busyText(statusMsg) {
      const m = String(statusMsg || '');
      if (!/^BUSY\b/i.test(m)) return '';
      const detail = m.replace(/^BUSY\s*:?\s*/i, '').trim();
      return 'Another import or sync is running' + (detail ? ' (' + detail + ')' : '') +
             '. Try again when it finishes.';
    }

    /**
     * The Import dialog may close during a Fetch: the run carries on in the
     * background on this page and announces itself when done. Not during
     * Import or Clear -- those take seconds and the user should see the
     * result.
     */
    canCloseImportDialog(variables) {
      const v = variables || {};
      return !(v.stagingSaving || v.stagingClearing);
    }

    /** What leaving the page now would interrupt, or '' (BeforeExitChain). */
    busyLeaveMessage(variables) {
      const v = variables || {};
      if (v.isSyncing) return 'Sync from Fusion is still running.';
      if (v.isImporting || v.isImportingUnits) return 'Import From Fusion is still fetching.';
      if (v.stagingSaving) return 'Import is still merging the ticked rows.';
      return '';
    }

    /**
     * Browser prompt on tab close / reload while a long run is in progress.
     * Browsers show their own text; returnValue just has to be set.
     */
    setLeaveGuard(active) {
      if (typeof window === 'undefined' || !window.addEventListener) return false;
      if (!this._leaveHandler) {
        this._leaveHandler = e => { e.preventDefault(); e.returnValue = ''; return ''; };
      }
      window.removeEventListener('beforeunload', this._leaveHandler);
      if (active) window.addEventListener('beforeunload', this._leaveHandler);
      return !!active;
    }

    /** 'select' for the tick box, 'editable' for class/subclass, else 'readonly'. */
    getColumnType(columnIndex) {
      if (columnIndex === COL_SELECT) return 'select';
      return (columnIndex === COL_CLASS || columnIndex === COL_SUBCLASS)
        ? 'editable' : 'readonly';
    }

    // ── Selection: Import merges exactly the ticked rows ────────────────
    //
    // Keyed on fusionInventoryItemId (the merge key), like the edit map, so a
    // tick survives a grid rebuild. Reset on every load: a selection belongs
    // to the rows on screen, and stale keys would import rows nobody can see.

    /** A MERGED row is already in the equipment master: nothing to import. */
    canSelect(rowIndex, variables) {
      const vars = variables || this._lastVariables || {};
      const rows = Array.isArray(vars.stagingArray) ? vars.stagingArray : [];
      const row = rows[rowIndex];
      return !!row && row.fusionInventoryItemId != null && row.importStatus !== 'MERGED';
    }

    /** Returns a NEW map (VBCS re-evaluates on reassignment, not mutation). */
    toggleRowSelection(rowIndex, checked, variables) {
      const vars = variables || this._lastVariables || {};
      const next = Object.assign({}, vars.stagingSelectedRows || {});
      const key = this.rowKeyAt(rowIndex);
      if (key == null || !this.canSelect(rowIndex, vars)) return next;
      if (checked) { next[key] = true; } else { delete next[key]; }
      return next;
    }

    /** Tick / untick every selectable row on this page. */
    setPageSelection(checked, variables) {
      const vars = variables || this._lastVariables || {};
      const rows = Array.isArray(vars.stagingArray) ? vars.stagingArray : [];
      const next = Object.assign({}, vars.stagingSelectedRows || {});
      rows.forEach((r, i) => {
        if (!this.canSelect(i, vars)) return;
        if (checked) { next[r.fusionInventoryItemId] = true; }
        else { delete next[r.fusionInventoryItemId]; }
      });
      return next;
    }

    /** True when every selectable row on the page is ticked (and there is one). */
    allOnPageSelected(variables) {
      const vars = variables || this._lastVariables || {};
      const rows = Array.isArray(vars.stagingArray) ? vars.stagingArray : [];
      const sel = vars.stagingSelectedRows || {};
      const selectable = rows.filter((r, i) => this.canSelect(i, vars));
      return selectable.length > 0 && selectable.every(r => !!sel[r.fusionInventoryItemId]);
    }

    /**
     * Live tick state for the tick-box cell. The box binds THIS, not the value
     * baked into the provider at build time: oj-data-grid re-renders rows as it
     * scrolls, and a frozen value drew a row unticked that Import would still
     * merge (or the reverse). Reads stagingSelectedRows, so it re-evaluates on
     * every reassignment of the map.
     */
    isRowSelected(rowIndex, variables) {
      const vars = variables || this._lastVariables || {};
      const key = this.rowKeyAt(rowIndex);
      return key != null && !!(vars.stagingSelectedRows || {})[key];
    }

    /**
     * Ticked + edited rows that would be lost by leaving this page of rows --
     * paging, a filter change, Fetch, Close. Each of those
     * asks before discarding them (2026-10-05: paging used to IMPORT them).
     */
    pendingWorkCount(variables) {
      const vars = variables || this._lastVariables || {};
      const keys = Object.assign({}, vars.stagingSelectedRows || {}, vars.stagingChangedRows || {});
      return Object.keys(keys).length;
    }

    /** "3 ticked and 2 edited rows" -- for the discard prompts. */
    pendingWorkText(variables) {
      const vars = variables || this._lastVariables || {};
      const t = Object.keys(vars.stagingSelectedRows || {}).length;
      const e = Object.keys(vars.stagingChangedRows || {}).length;
      const parts = [];
      if (t) parts.push(t + ' ticked');
      if (e) parts.push(e + ' edited');
      return parts.join(' and ') + ' row' + ((t + e) === 1 ? '' : 's');
    }

    /**
     * One rule for "something is writing staging": Fetch, Import or Clear.
     * Fetch, Import, Clear, the filters and paging are all disabled while it is
     * true. Running two at once is unsafe: a Fetch deletes unconfirmed rows on
     * batch 1, so an Import mid-Fetch PATCHes rows that are being replaced, and
     * two promotes race on the same job-log row.
     */
    isBusy(variables) {
      const vars = variables || this._lastVariables || {};
      return !!(vars.isImporting || vars.isImportingUnits ||
                vars.stagingSaving || vars.stagingClearing || vars.isSyncing);
    }

    /**
     * Redraw ONE row's tick / class / subclass cells from stagingArray.
     *
     * Needed after a class edit clears the subclass (applyEdit): the data said
     * "no subclass" while the cell still showed the old one, so Import sent a
     * null subclass the user could not see. Writes the current values into the
     * provider's cell objects and fires a cell-range update -- no rebuild, so the
     * grid keeps its scroll position and focus.
     */
    refreshRowCells(rowIndex, variables) {
      const vars = variables || this._lastVariables || {};
      const grid = this._grid;
      const rows = Array.isArray(vars.stagingArray) ? vars.stagingArray : [];
      const row = rows[rowIndex];
      const cells = grid && grid.dataParameters && grid.dataParameters.data
        ? grid.dataParameters.data[rowIndex] : null;
      if (!row || !cells) return false;
      cells[COL_SELECT]   = { data: this.isRowSelected(rowIndex, vars) };
      cells[COL_CLASS]    = { data: row.resolvedClassId    != null ? row.resolvedClassId    : null };
      cells[COL_SUBCLASS] = { data: row.resolvedSubclassId != null ? row.resolvedSubclassId : null };
      try {
        grid.version = (grid.version || 0) + 1;
        grid.doUpdate({
          ranges: [{ rowOffset: rowIndex, columnOffset: 0, rowCount: 1,
                     columnCount: COLUMN_HEADERS.length }],
          version: grid.version
        });
        return true;
      } catch (e) {
        return false;
      }
    }

    /** How many rows are ticked. */
    selectedCount(stagingSelectedRows) {
      return Object.keys(stagingSelectedRows || {}).length;
    }

    /**
     * The PATCH body for Import: the TICKED rows only, each with its class --
     * the user's pending edit if there is one, else the class already on the
     * row (an AUTO_MAPPED suggestion, or one set earlier).
     *
     * Ticked rows with no class are left out and counted in noClass: the
     * endpoint marks every row it receives MAPPED, so sending a null class
     * would mark a row "a human decided" with nothing to promote.
     */
    buildImportBody(stagingSelectedRows, stagingChangedRows, stagingArray) {
      const sel = stagingSelectedRows || {};
      const changed = stagingChangedRows || {};
      const rows = Array.isArray(stagingArray) ? stagingArray : [];
      const byKey = {};
      rows.forEach(r => { if (r && r.fusionInventoryItemId != null) byKey[r.fusionInventoryItemId] = r; });

      const assignments = [];
      let noClass = 0;
      Object.keys(sel).forEach(k => {
        const row = byKey[k];
        if (!row || row.importStatus === 'MERGED') return;
        const edit = changed[k];
        const classId = edit ? edit.resolvedClassId : row.resolvedClassId;
        const subclassId = edit ? edit.resolvedSubclassId : row.resolvedSubclassId;
        if (classId == null) { noClass++; return; }
        assignments.push({
          fusionInventoryItemId: row.fusionInventoryItemId,
          resolvedClassId:       classId,
          resolvedSubclassId:    subclassId != null ? subclassId : null
        });
      });
      return { assignments: assignments, noClass: noClass };
    }

    /**
     * Per-column width + header chrome for the review grid.
     *
     * oj-data-grid takes column widths ONLY through this callback — there is no
     * columns[] array to hang a width on the way oj-table has. It is bound as
     *   header.column.style="[[ $functions.stagingColumnHeaderStyle.bind($functions) ]]"
     * and JET calls it once per column header with a context carrying .index.
     *
     * ⚠ .bind($functions) is required. Without it JET invokes the function
     *   detached and `this` is undefined, so reading COLUMN_WIDTHS off the
     *   module closure still works but any this.* would throw. Every other
     *   header.column.style in this app is bound the same way — keep it.
     *
     * Setting the width on the HEADER is what sizes the whole column; the
     * databody cells follow it. Cell padding and text overflow are left to
     * app.css (#stagingReviewGrid) rather than a cell.style callback — the
     * grid renders its cells through a cellTemplate, and CSS does not have to
     * reason about how the two interact.
     */
    stagingColumnHeaderStyle(headerContext) {
      const i = headerContext ? headerContext.index : -1;
      const w = COLUMN_WIDTHS[i] || COLUMN_WIDTH_FALLBACK;
      return 'width:' + w + '; font-weight:600; padding:8px 10px;'
           + ' white-space:normal; line-height:1.25;';
    }

    /** The merge key for a grid row, or null if the map is stale. */
    rowKeyAt(rowIndex) {
      return (rowIndex != null && this._rowKeys) ? (this._rowKeys[rowIndex] || null) : null;
    }

    // ── Cell rendering ──────────────────────────────────────────────────

    /**
     * Navigation-mode text for an editable cell — the NAME, not the id.
     *
     * The cell template calls this without the page variables, so it falls
     * back to the maps captured by buildStagingGrid.
     */
    displayFor(columnIndex, value, variables) {
      if (value == null || value === '') return '';
      const vars = variables || this._lastVariables || {};
      if (columnIndex === COL_CLASS) {
        return this.classNameFor(value, vars.classesById);
      }
      if (columnIndex === COL_SUBCLASS) {
        return this.subclassNameFor(value, vars.subclassesById);
      }
      return String(value);
    }

    /**
     * The data provider for an editing cell.
     *
     * Class: every class.
     * Subclass: only those belonging to the class chosen ON THIS ROW.
     *
     * Two traps, both learned from getExpTypeProvider on timesheet-detail:
     *
     *  1. NEVER cache the provider. The narrowing input differs per row, so a
     *     cached one hands row 2 row 1's options.
     *
     *  2. The row's OWN saved value must survive narrowing. oj-select-single
     *     is two-way bound: a value absent from its data renders blank AND
     *     writes null back through the binding, silently destroying a choice
     *     the user already made. Showing one extra option is much cheaper.
     */
    getStagingProvider(columnIndex, rowIndex, variables) {
      const vars = variables || this._lastVariables || {};

      if (columnIndex === COL_CLASS) {
        const classOptions = Array.isArray(vars.classOptionsArray) ? vars.classOptionsArray : [];
        return new ArrayDataProvider(classOptions, { keyAttributes: 'value' });
      }

      const all = Array.isArray(vars.subclassOptionsArray) ? vars.subclassOptionsArray : [];
      const currentClassId = this.getCellValue(rowIndex, COL_CLASS, vars);

      // No class chosen yet: show everything rather than an empty picker. An
      // empty dropdown reads as "broken", not as "choose a class first".
      if (currentClassId == null) {
        return new ArrayDataProvider(all, { keyAttributes: 'value' });
      }

      let narrowed = all.filter(s => s && Number(s.classId) === Number(currentClassId));

      // Trap 2 — keep whatever this row already has, even out of class.
      const currentSub = this.getCellValue(rowIndex, COL_SUBCLASS, vars);
      if (currentSub != null && !narrowed.some(s => s.value === currentSub)) {
        const saved = all.filter(s => s && s.value === currentSub);
        narrowed = saved.concat(narrowed);
      }

      return new ArrayDataProvider(narrowed, { keyAttributes: 'value' });
    }

    /**
     * Does this subclass sit under this class?
     *
     * The authority on the pairing, used both to decide whether a class change
     * invalidates a pending subclass and to keep a legal pair intact.
     *
     * Unknown subclass id -> false: if it cannot be shown to belong, it is not
     * kept. Better to clear a choice the user can re-pick than to send the
     * PATCH a pair it rejects with SUBCLASS_NOT_IN_CLASS.
     *
     * NB Number() on both sides. Class and subclass ids are separate sequences
     * and DO collide -- class 1000000101 "Tools" and subclass 1000000101
     * "Hammers" both exist on paasdev -- so this must compare a subclass's
     * PARENT against the class, never the two ids against each other.
     */
    subclassBelongsTo(subclassId, classId, variables) {
      if (subclassId == null || classId == null) return false;
      const vars = variables || this._lastVariables || {};
      const all = Array.isArray(vars.subclassOptionsArray) ? vars.subclassOptionsArray : [];
      const found = all.filter(s => s && Number(s.value) === Number(subclassId))[0];
      return !!found && Number(found.classId) === Number(classId);
    }

    /** Current value of a cell, read from the staged row rather than the grid. */
    getCellValue(rowIndex, columnIndex, variables) {
      const vars = variables || this._lastVariables || {};
      const rows = Array.isArray(vars.stagingArray) ? vars.stagingArray : [];
      const row = rows[rowIndex];
      if (!row) return null;
      if (columnIndex === COL_CLASS) {
        return row.resolvedClassId != null ? row.resolvedClassId : null;
      }
      if (columnIndex === COL_SUBCLASS) {
        return row.resolvedSubclassId != null ? row.resolvedSubclassId : null;
      }
      return null;
    }

    // ── Editing ─────────────────────────────────────────────────────────

    /**
     * Only the class and subclass cells may be edited. A MERGED row is
     * already in EQR_EQUIPMENT_MASTER, and changing its class there is out of
     * scope — the PATCH rejects it with ALREADY_MERGED, so blocking the edit
     * up front is kinder than letting someone type into a cell that will be
     * refused on save.
     */
    canEdit(rowIndex, columnIndex, variables) {
      if (this.getColumnType(columnIndex) !== 'editable') return false;
      const vars = variables || this._lastVariables || {};
      const rows = Array.isArray(vars.stagingArray) ? vars.stagingArray : [];
      const row = rows[rowIndex];
      return !!row && row.importStatus !== 'MERGED';
    }

    /**
     * Commit one cell edit into the dirty map.
     *
     * Keyed on fusionInventoryItemId, never rowIndex: it is the merge key the
     * PATCH expects, it is the ADP's keyAttribute, and it survives sorting
     * and paging.
     *
     * Returns the new dirty map so a chain can assign it — VBCS re-evaluates
     * on reassignment, not on mutation.
     */
    applyEdit(rowIndex, columnIndex, newValue, variables) {
      const vars = variables || this._lastVariables || {};
      const key = this.rowKeyAt(rowIndex);
      if (key == null) return vars.stagingChangedRows || {};

      const changed = Object.assign({}, vars.stagingChangedRows || {});
      const rows = Array.isArray(vars.stagingArray) ? vars.stagingArray : [];
      const row = rows[rowIndex] || {};

      const entry = Object.assign({
        fusionInventoryItemId: key,
        resolvedClassId:    row.resolvedClassId != null ? row.resolvedClassId : null,
        resolvedSubclassId: row.resolvedSubclassId != null ? row.resolvedSubclassId : null
      }, changed[key] || {});

      if (columnIndex === COL_CLASS) {
        entry.resolvedClassId = newValue != null ? newValue : null;

        // Changing the class clears the subclass. Otherwise a row can read
        // "Excavator / Light Truck" — the old subclass stays visible and,
        // worse, gets saved against the new class. The PATCH would reject it
        // with SUBCLASS_NOT_IN_CLASS, but only after the user thought it saved.
        //
        // "Changed" is measured against the SAVED class on the row, never
        // against whatever the pending entry happens to hold. The grid commits
        // a cell on blur, so the two edits can arrive in EITHER order; when
        // the class cell committed second, the entry's class was still null
        // and this read as a change, wiping a subclass the user had just
        // picked. Measured, not theorised: same two picks, reversed commit
        // order, subclass silently lost.
        //
        // The subclass is only cleared when it no longer BELONGS to the new
        // class. Re-picking the same class, or picking a class the pending
        // subclass already sits under, leaves the choice alone.
        const savedClass = row.resolvedClassId != null ? row.resolvedClassId : null;
        const classReallyChanged =
          savedClass != null && Number(savedClass) !== Number(entry.resolvedClassId);

        if (classReallyChanged && !this.subclassBelongsTo(entry.resolvedSubclassId,
                                                          entry.resolvedClassId, vars)) {
          entry.resolvedSubclassId = null;
        }
      } else if (columnIndex === COL_SUBCLASS) {
        entry.resolvedSubclassId = newValue != null ? newValue : null;
      }

      changed[key] = entry;
      return changed;
    }

    /**
     * Mirror a committed edit back onto stagingArray.
     *
     * The grid re-reads its provider from this array, and getStagingProvider
     * narrows subclasses from it, so without this the cascade would still be
     * narrowing against the class the row had before the edit.
     */
    applyEditToRows(rowIndex, entry, stagingArray) {
      const rows = Array.isArray(stagingArray) ? stagingArray.slice() : [];
      if (!rows[rowIndex] || !entry) return rows;
      rows[rowIndex] = Object.assign({}, rows[rowIndex], {
        resolvedClassId:    entry.resolvedClassId,
        resolvedSubclassId: entry.resolvedSubclassId
      });
      return rows;
    }

    // ── "What to map next" popup ───────────────────────────────────────
    // Pure functions over the groups LoadUnmatchedValuesChain stores. A
    // group is { sourceType, reason, classId, className, dimType, dimValue,
    // dimLabel, isFallback, itemCount } — see the unmatched-values operation
    // in services/eqp-v1/openapi3.json.

    /** Human label for a mapping-type code; an unknown code is shown as is. */
    dimTypeLabel(code) {
      if (code == null || code === '') return '';
      const c = String(code);
      if (DIM_TYPE_LABELS[c]) return DIM_TYPE_LABELS[c];
      for (let i = 0; i < DIM_TYPE_PATTERNS.length; i++) {
        const m = DIM_TYPE_PATTERNS[i][0].exec(c);
        if (m) return DIM_TYPE_PATTERNS[i][1] + Number(m[1]);
      }
      // Fixed-asset types: FA_ASSET_KEY -> "FA Asset Key". FA stays upper
      // case; title-casing it to "Fa" reads as a typo.
      if (/^FA_/.test(c)) {
        return 'FA ' + c.slice(3).split('_').filter(Boolean)
          .map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
      }
      return c;
    }

    /**
     * "Computer › Category Segment 2 = Tablet Cmp" / "Category =
     * Pharmaceuticals". dimLabel first: for CATEGORY the value is an id
     * (300000167938722) and only the label is findable on the mapping screen.
     * A null value is a real group (items with nothing in that field), shown
     * as "(no value)" rather than hidden — it still explains a count.
     */
    unmatchedText(group) {
      if (!group) return '';
      const hasValue = group.dimValue != null && group.dimValue !== '';
      const value = !hasValue ? '(no value)'
        : (group.dimLabel != null && group.dimLabel !== '' ? group.dimLabel : group.dimValue);
      const text = this.dimTypeLabel(group.dimType) + ' = ' + value;
      return (group.reason === 'SUBCLASS_NO_MATCH' && group.className)
        ? group.className + ' › ' + text
        : text;
    }

    /**
     * What to create on the Class Mapping tab. '' for a null value: there is
     * nothing to map ON, so suggesting a mapping would send the admin looking
     * for a value that does not exist. '' for an unknown reason too — better
     * no advice than wrong advice.
     */
    unmatchedAction(group) {
      if (!group || group.dimValue == null || group.dimValue === '') return '';
      if (group.reason === 'SUBCLASS_NO_MATCH') {
        return group.className ? 'Add subclass under ' + group.className : 'Add subclass';
      }
      if (group.reason === 'NO_MAPPING_MATCH') return 'Add class';
      return '';
    }

    /** True when the group is on another type than the user's mappings use. */
    unmatchedIsFallback(group) {
      return !!group && group.isFallback === 'Y';
    }

    /**
     * Items a mapping could classify across the listed groups. Null-value
     * groups are excluded: no mapping can fix them, so counting them would
     * overstate what working down the list achieves.
     */
    unmatchedCoveredCount(groups) {
      return (Array.isArray(groups) ? groups : []).reduce((sum, g) =>
        (g && g.dimValue != null && g.dimValue !== '')
          ? sum + (Number(g.itemCount) || 0) : sum, 0);
    }

    /**
     * The secondary menu as this user may use it. Import From Fusion and Sync
     * from Fusion write the equipment master, so they need FULL access to
     * EQR_EQUIPMENT_MASTER; a READ_ONLY user browses the list without them
     * (the same rule hides Create). Access not loaded yet reads as HIDDEN, so
     * they stay off until the map arrives rather than flashing on. While a
     * Sync runs its item reads "Syncing from Fusion…" and is disabled.
     * Returns new objects: the page variable is never mutated.
     */
    actionsFor(secondaryActions, accessLevel, isSyncing, syncStep, isFetching) {
      const full = accessLevel === 'FULL';
      const writes = { importFusion: true, syncFusion: true };
      return (Array.isArray(secondaryActions) ? secondaryActions : []).map(a => {
        if (!a || !writes[a.id]) return a;
        if (!full) return Object.assign({}, a, { display: 'off' });
        if (a.id === 'syncFusion' && isSyncing) {
          return Object.assign({}, a, { display: 'disabled',
            label: 'Syncing from Fusion…' + (syncStep ? ' (' + syncStep + ')' : '') });
        }
        // A Fetch running with the dialog closed: say so, and keep the item
        // enabled -- it reopens the dialog on the run's progress.
        if (a.id === 'importFusion' && isFetching) {
          return Object.assign({}, a, { label: 'Import From Fusion (fetching…)' });
        }
        return a;
      });
    }

    /**
     * The Sync from Fusion result as { title, message, type } from the
     * refresh-units counts. Stock read only partly (stockOk false) is a
     * warning: units were refreshed but nothing was marked gone, by design.
     */
    syncSummary(counts, stockOk, stockMessage, heldNumbers) {
      const c = counts || {};
      const n = k => Number(c[k]) || 0;
      const fmt = x => x.toLocaleString();
      const plural = (x, one, many) => fmt(x) + ' ' + (x === 1 ? one : (many || one + 's'));
      const units = n('serials') + n('lots') + n('onhand');
      const gone = n('serialsGone') + n('lotsGone') + n('onhandGone');
      const parts = [
        plural(n('itemsChanged'), 'item') + ' updated',
        plural(units, 'unit record') + ' refreshed (serials ' + fmt(n('serials')) +
          ', lots ' + fmt(n('lots')) + ', on-hand ' + fmt(n('onhand')) + ')'
      ];
      if (gone) {
        parts.push(fmt(gone) + ' no longer in Fusion yard stock (zeroed or flagged, not deleted)');
      }
      const held = n('itemsHeld');
      if (held) {
        const list = (Array.isArray(heldNumbers) ? heldNumbers : []).slice(0, 5).join(', ');
        parts.push(plural(held, 'item') + ' held: serial/lot control changed in Fusion while ' +
          'it has units' + (list ? ' (' + list + (held > 5 ? ', …' : '') + ')' : ''));
      }
      if (n('stockWaiting')) {
        parts.push(fmt(n('stockWaiting')) + ' stock rows wait for their item to be imported');
      }
      let message = parts.join(' · ') + '.';
      if (!stockOk) {
        message += ' Stock was read only partly' + (stockMessage ? ' (' + stockMessage + ')' : '') +
          ', so nothing was marked as gone.';
      }
      const warn = !stockOk || held > 0;
      return { title: warn ? 'Sync finished with warnings' : 'Sync complete',
               message: message, type: warn ? 'warning' : 'confirmation' };
    }

    /** The rows the panel draws: the first UNMATCHED_VISIBLE, or all. */
    unmatchedVisible(groups, showAll) {
      const list = Array.isArray(groups) ? groups : [];
      return showAll ? list : list.slice(0, UNMATCHED_VISIBLE);
    }

    /** True when there are rows beyond the first UNMATCHED_VISIBLE. */
    unmatchedHasMore(groups) {
      return Array.isArray(groups) && groups.length > UNMATCHED_VISIBLE;
    }

    /** Header line: "2,412 items in the top 20 of 118 groups". */
    unmatchedSummary(groups, totalGroups) {
      const n = Array.isArray(groups) ? groups.length : 0;
      if (!n) return '';
      const covered = this.unmatchedCoveredCount(groups);
      const total = Number(totalGroups) > n ? ' of ' + Number(totalGroups) : '';
      return covered + ' item' + (covered === 1 ? '' : 's') + ' in the top ' + n +
             total + ' group' + ((Number(totalGroups) || n) === 1 ? '' : 's');
    }
  }

  return PageModule;
});
