define([], () => {
  'use strict';

  // Import from Fusion and Sync from Fusion in EquipRite Next: the page functions their chains call, carried over from
  // New EquipRite unchanged (webApps/equiprite/flows/master/pages/equipment-import-page.js, the whole page module, and
  // syncSummary / syncLabel from equipment-page.js). New's two pages are one screen here (the Equipment master's
  // Import from Fusion view), so that page's module extends this class and the chains call these by the same names.
  // tests/next-equipment.test.js checks they still give New's answers.
  //
  // New's notes on its import page module:
  //
  //   Import from Fusion: Fetch, review the fetched items, give them a class, Import the ticked ones (FDD 7.2.6).
  //   This is the old Equipment Master page's Import From Fusion dialog as a page of its own.
  //
  //   Every function below the "old page module" mark is copied from
  //   vbredwoodapp/flows/equipment-foundation/pages/equipment-master-page.js with its logic unchanged (some long
  //   comments are shortened; the old file has the full reasoning). The
  //   old dialog drew its rows in an oj-data-grid fed by an ArrayDataGridProvider; this page draws them in a div
  //   grid, so buildStagingGrid keeps only its other job (the rowIndex -> fusionInventoryItemId map every edit
  //   writes through) and is called indexRows, and getStagingProvider returns the subclass list as an array
  //   (subclassChoices) instead of a data provider. The rules inside both are the old ones.

  // Column indexes the old edit functions are written against (applyEdit, canEdit, displayFor).
  const COL_SELECT   = 0;
  const COL_CLASS    = 6;
  const COL_SUBCLASS = 7;

  // ── "What to map next" ────────────────────────────────────────────────
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
  const UNMATCHED_VISIBLE = 8;

  // Status chips: the old dialog's importStatusOptionsArray, in its order.
  const IMPORT_STATUSES = [
    { value: 'AUTO_MAPPED', label: 'Auto-mapped', hint: 'Class Mapping matched: tick and Import to merge' },
    { value: 'ERRORED', label: 'Errored', hint: 'Class mapping did not resolve' },
    { value: 'UNMAPPED', label: 'Unmapped', hint: 'No mapping source' },
    { value: 'NEW', label: 'New', hint: 'Not yet classified' },
    { value: 'MAPPED', label: 'Mapped', hint: 'Classified by a person; goes in on the next Import' },
    { value: 'NO_UNIT_PATHWAY', label: 'No unit pathway', hint: 'A valid item with no units' },
  ];

  class EquipmentImport {
    constructor() {
      // rowIndex -> fusionInventoryItemId. The grid addresses cells by index;
      // every write has to land on the merge key instead, because indexes
      // shift under sorting and paging while the id does not.
      this._rowKeys = [];
      this._lastVariables = null;
    }

    /**
     * The rowIndex -> fusionInventoryItemId map, rebuilt from the staged rows (old buildStagingGrid, without the
     * oj-data-grid provider). MUST be called whenever stagingArray changes — a stale key map writes a user's
     * class onto the wrong item.
     */
    indexRows(stagingArray, variables) {
      this._lastVariables = variables || null;
      const rows = Array.isArray(stagingArray) ? stagingArray : [];
      this._rowKeys = rows.map(r => (r && r.fusionInventoryItemId) || null);
      return this._rowKeys.length;
    }

    /**
     * Subclasses offered for one row (old getStagingProvider, as an array): every subclass while the row has no
     * class; else those of the row's class, plus the row's OWN saved subclass even when it is out of class, so a
     * choice already made is never dropped from view.
     */
    subclassChoices(rowIndex, variables) {
      const vars = variables || this._lastVariables || {};
      const all = Array.isArray(vars.subclassOptionsArray) ? vars.subclassOptionsArray : [];
      const currentClassId = this.getCellValue(rowIndex, COL_CLASS, vars);
      if (currentClassId == null) return all.slice();
      let narrowed = all.filter(s => s && Number(s.classId) === Number(currentClassId));
      const currentSub = this.getCellValue(rowIndex, COL_SUBCLASS, vars);
      if (currentSub != null && !narrowed.some(s => s.value === currentSub)) {
        const saved = all.filter(s => s && s.value === currentSub);
        narrowed = saved.concat(narrowed);
      }
      return narrowed;
    }

    /** Subclasses of a class, for the "give the ticked rows a class" panel. */
    subclassesOf(classId, variables) {
      const vars = variables || this._lastVariables || {};
      const all = Array.isArray(vars.subclassOptionsArray) ? vars.subclassOptionsArray : [];
      if (classId == null || classId === '') return [];
      return all.filter(s => s && Number(s.classId) === Number(classId));
    }

    /** Index on this page of the row the class editor is open for (by merge key), or -1. */
    editIndex(editKey, stagingArray) {
      if (editKey === '' || editKey == null) return -1;
      const rows = Array.isArray(stagingArray) ? stagingArray : [];
      return rows.findIndex(r => r && String(r.fusionInventoryItemId) === String(editKey));
    }

    importStatuses() {
      return IMPORT_STATUSES;
    }

    /** Item classes matching the typed text (name or code), at most 12, so a long Fusion list stays readable. */
    itemClassMatches(options, query) {
      const q = String(query || '').trim().toLowerCase();
      return (Array.isArray(options) ? options : [])
        .filter(o => o && (!q || String(o.label || '').toLowerCase().includes(q) || String(o.value || '').toLowerCase().includes(q)))
        .slice(0, 12);
    }

    /** Item class code and the first two category segments (what the common Class Mapping types match on). */
    itemMeta(row) {
      return [row && row.itemClassCode, row && row.catSegment1, row && row.catSegment2].filter(Boolean).join(' · ');
    }

    /** The label of the picked item class, or its code when the list has not loaded. */
    itemClassLabel(options, value) {
      const o = (Array.isArray(options) ? options : []).find(x => x && x.value === value);
      return o ? o.label : String(value || '');
    }

    statusLabel(code) {
      const s = IMPORT_STATUSES.find(x => x.value === code);
      return s ? s.label : String(code || '').replace(/_/g, ' ');
    }

    statusClass(code) {
      return 'er-imp er-imp--' + String(code || 'NONE');
    }

    /**
     * What Import will do, before the click: how many ticked rows go in and under which classes, and how many are
     * skipped for having no class (buildImportBody decides; this only words it).
     */
    importPreview(stagingSelectedRows, stagingChangedRows, stagingArray, classesById) {
      const built = this.buildImportBody(stagingSelectedRows, stagingChangedRows, stagingArray);
      const by = {};
      built.assignments.forEach(a => {
        const name = this.classNameFor(a.resolvedClassId, classesById) || ('class ' + a.resolvedClassId);
        by[name] = (by[name] || 0) + 1;
      });
      const parts = Object.keys(by).sort((a, b) => by[b] - by[a]).map(k => by[k] + ' ' + k);
      const n = built.assignments.length;
      let text = n
        ? 'Import adds ' + n + ' item' + (n === 1 ? '' : 's') + ' to the equipment master: ' + parts.join(', ') + '.'
        : 'Tick the rows to import.';
      if (built.noClass) {
        text += ' ' + built.noClass + ' ticked row' + (built.noClass === 1 ? ' has' : 's have') + ' no class and will be skipped.';
      }
      return { count: n, noClass: built.noClass, text: text };
    }

    /** "Showing 1–100 of 5,266": the page's position, for the pager. */
    pageText(page, size, total, shown) {
      const t = Number(total) || 0;
      if (!t) return '';
      const from = (Number(page) || 0) * (Number(size) || 100) + 1;
      const to = from + (Number(shown) || 0) - 1;
      return from.toLocaleString() + '–' + Math.max(from, to).toLocaleString() + ' of ' + t.toLocaleString();
    }

    lastPage(size, total) {
      const t = Number(total) || 0;
      return t ? Math.max(0, Math.ceil(t / (Number(size) || 100)) - 1) : 0;
    }

    // ── old page module (equipment-master-page.js), unchanged ──────────────

    classNameFor(equipmentClassId, classesById) {
      if (equipmentClassId == null) return '';
      const map = classesById || {};
      return map[equipmentClassId] || '';
    }

    subclassNameFor(equipmentSubclassId, subclassesById) {
      if (equipmentSubclassId == null) return '';
      const map = subclassesById || {};
      return map[equipmentSubclassId] || '';
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

    busyText(statusMsg) {
      const m = String(statusMsg || '');
      if (!/^BUSY\b/i.test(m)) return '';
      const detail = m.replace(/^BUSY\s*:?\s*/i, '').trim();
      return 'Another import or sync is running' + (detail ? ' (' + detail + ')' : '') +
             '. Try again when it finishes.';
    }

    /** What leaving the page now would interrupt, or '' (BeforeExitChain). */
    busyLeaveMessage(variables) {
      const v = variables || {};
      if (v.isSyncing) return 'Sync from Fusion is still running.';
      if (v.isImporting || v.isImportingUnits) return 'Import From Fusion is still fetching.';
      if (v.stagingSaving) return 'Import is still merging the ticked rows.';
      return '';
    }

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

    isBusy(variables) {
      const vars = variables || this._lastVariables || {};
      return !!(vars.isImporting || vars.isImportingUnits ||
                vars.stagingSaving || vars.stagingClearing || vars.isSyncing);
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

    /** The merge key for a grid row, or null if the map is stale. */
    rowKeyAt(rowIndex) {
      return (rowIndex != null && this._rowKeys) ? (this._rowKeys[rowIndex] || null) : null;
    }

    /** The class / subclass NAME for an id, as the grid shows it. */
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
     * Does this subclass sit under this class?
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

    /**
     * Only the class and subclass cells may be edited. A MERGED row is
     * already in EQR_EQUIPMENT_MASTER, and changing its class there is out of
     * scope — the PATCH rejects it with ALREADY_MERGED.
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
     * PATCH expects and it survives sorting and paging.
     *
     * Changing the class clears the subclass only when it no longer BELONGS to
     * the new class, and "changed" is measured against the SAVED class on the
     * row, never against the pending entry: class and subclass edits can arrive
     * in either order.
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

    /** Mirror a committed edit back onto stagingArray (a NEW array). */
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

    dimTypeLabel(code) {
      if (code == null || code === '') return '';
      const c = String(code);
      if (DIM_TYPE_LABELS[c]) return DIM_TYPE_LABELS[c];
      for (let i = 0; i < DIM_TYPE_PATTERNS.length; i++) {
        const m = DIM_TYPE_PATTERNS[i][0].exec(c);
        if (m) return DIM_TYPE_PATTERNS[i][1] + Number(m[1]);
      }
      if (/^FA_/.test(c)) {
        return 'FA ' + c.slice(3).split('_').filter(Boolean)
          .map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
      }
      return c;
    }

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

    unmatchedAction(group) {
      if (!group || group.dimValue == null || group.dimValue === '') return '';
      if (group.reason === 'SUBCLASS_NO_MATCH') {
        return group.className ? 'Add subclass under ' + group.className : 'Add subclass';
      }
      if (group.reason === 'NO_MAPPING_MATCH') return 'Add class';
      return '';
    }

    unmatchedIsFallback(group) {
      return !!group && group.isFallback === 'Y';
    }

    unmatchedCoveredCount(groups) {
      return (Array.isArray(groups) ? groups : []).reduce((sum, g) =>
        (g && g.dimValue != null && g.dimValue !== '')
          ? sum + (Number(g.itemCount) || 0) : sum, 0);
    }

    unmatchedVisible(groups, showAll) {
      const list = Array.isArray(groups) ? groups : [];
      return showAll ? list : list.slice(0, UNMATCHED_VISIBLE);
    }

    unmatchedHasMore(groups) {
      return Array.isArray(groups) && groups.length > UNMATCHED_VISIBLE;
    }

    unmatchedSummary(groups, totalGroups) {
      const n = Array.isArray(groups) ? groups.length : 0;
      if (!n) return '';
      const covered = this.unmatchedCoveredCount(groups);
      const total = Number(totalGroups) > n ? ' of ' + Number(totalGroups) : '';
      return covered + ' item' + (covered === 1 ? '' : 's') + ' in the top ' + n +
             total + ' group' + ((Number(totalGroups) || n) === 1 ? '' : 's');
    }

    // ── New EquipRite's Equipment page module (equipment-page.js): Sync from Fusion, unchanged ──────────

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

    /**
     * The Sync button's label: the old menu item's rule (actionsFor): "Syncing from Fusion… (step)" while a Sync
     * runs, else "Sync from Fusion".
     */
    syncLabel(isSyncing, syncStep) {
      return isSyncing ? 'Syncing from Fusion…' + (syncStep ? ' (' + syncStep + ')' : '') : 'Sync from Fusion';
    }
  }

  return EquipmentImport;
});
