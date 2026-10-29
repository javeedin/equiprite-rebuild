define([], () => {
  'use strict';

  /**
   * TYPE (TRACKING_TYPE) — the subclass's default tracking intent.
   *
   * These four values are the authoring-time counterpart of the three tracking
   * axes on EQR_EQUIPMENT_MASTER (IS_INVENTORY_TRACKED / IS_MAINTENANCE_TRACKED /
   * IS_FIXED_ASSET_TRACKED). Those axes are INDEPENDENT and COMBINABLE — an item
   * can legitimately be all three at once — so this single-valued field is a
   * DEFAULT for new items, never a constraint on the ones already there. Do not
   * use it to filter, validate or re-tag equipment.
   *
   * Labels live here rather than being re-derived at each binding site so the
   * grid, the drawer and the dialog cannot drift apart. Keep in sync with
   * TrackingTypeLovArray in configurations-page.json.
   */
  const TRACKING_TYPE_LABELS = {
    INVENTORY: 'Inventory',
    MAINTENANCE: 'Maintenance',
    FIXED_ASSET: 'Fixed Assets',
    CUSTOM: 'Custom'
  };
  const TRACKING_TYPE_DEFAULT = 'INVENTORY';

  /**
   * Class Mapping category types (the Class / Subclass Attribute lists) are NOT
   * defined here. EQP_CATEGORY_LOV_RP's TYPES branch is the one place they are
   * defined -- codes, labels and order, per source -- and loadClassMapTypesChain
   * loads them into ClassMapTypesArray as {source, value, label, sort}. Every
   * source's list is universal: any type can be the class and the subclass may
   * be any OTHER one.
   */

  /**
   * What a NULL stored type means, per V370: the pairing the tab used before the
   * type was stored. Deliberately NOT the current picker default -- Inventory's
   * default is now Category, but an untyped Inventory class was mapped as a
   * Catalog, and reading it any other way would misdescribe stored data.
   */
  const LEGACY_TYPES = {
    INVENTORY: { classType: 'CATALOG', subclassType: 'CATEGORY' },
    FIXED_ASSET: { classType: 'MAJOR', subclassType: 'MINOR' },
    MAINTENANCE: { classType: 'ITEM', subclassType: 'WO_TYPE' }
  };

  /** Labels for retired types that stored rows can still carry. Display only. */
  const RETIRED_TYPE_LABELS = { CATALOG: 'Catalog' };

  const SOURCE_CODES = ['INVENTORY', 'FIXED_ASSET', 'MAINTENANCE'];

  /**
   * The loaded type list for one source, in report order, each entry able to
   * parent every other.
   */
  function categoryTypesFor(source, types) {
    const src = String(source || '').toUpperCase();
    const all = (types || [])
      .filter(t => t.source === src)
      .slice()
      .sort((a, b) => String(a.sort).localeCompare(String(b.sort)));
    return all.map(t => ({
      value: t.value,
      label: t.label,
      children: all.map(o => o.value).filter(v => v !== t.value)
    }));
  }

  /**
   * Normalise any incoming trackingType to a known code. Absent, empty or
   * unrecognised values fall back to the column default rather than producing a
   * blank cell or an unbindable select value.
   */
  function normaliseTrackingType(raw) {
    const v = String(raw == null ? '' : raw).toUpperCase();
    return TRACKING_TYPE_LABELS[v] ? v : TRACKING_TYPE_DEFAULT;
  }

  class PageModule {

    /**
     * Display label for the grid's TYPE column. Falls back to the default's
     * label so a row never renders empty.
     */
    trackingTypeLabel(code) {
      return TRACKING_TYPE_LABELS[normaliseTrackingType(code)];
    }

    /**
     * Debounce helper for the searchable BU LOV (clone of the project-create page).
     * Returns a Promise that resolves to `value` only if no newer call for the same
     * key arrived within `delay` ms; otherwise resolves null (caller skips the query).
     */
    debounce(key, value, delay) {
      if (!this._debounceState) this._debounceState = {};
      const state = this._debounceState;
      if (!state[key]) state[key] = { count: 0 };
      state[key].count++;
      const myCount = state[key].count;
      return new Promise((resolve) => {
        if (state[key].timer) clearTimeout(state[key].timer);
        state[key].timer = setTimeout(() => {
          resolve(state[key].count === myCount ? value : null);
        }, delay || 200);
      });
    }

    /**
     * Converts an API array of settings records into a flat map keyed by settingKey.
     * @param {Array} dataArray - Array of {id, settingKey, settingValue, ...}
     * @returns {Object} e.g. { "PROJECTS_MODULE_ENABLED": {id: 5, settingValue: "true"} }
     */
    buildSettingsMap(dataArray) {
      if (!dataArray || !dataArray.length) return {};
      const map = {};
      dataArray.forEach(record => {
        if (record.settingKey) {
          map[record.settingKey] = {
            id: record.id || null,
            settingValue: record.settingValue || '',
            businessUnitId: record.businessUnitId || null
          };
        }
      });
      return map;
    }

    /**
     * Returns true if a setting exists in the map and its value is the string "true".
     * Used to bind oj-switch value expressions.
     */
    getSettingBool(map, key) {
      if (!map || !key || !map[key]) return false;
      const v = map[key].settingValue;
      return v === 'true' || v === true;
    }

    /**
     * Gets the raw string value of a setting from the map, with a fallback default.
     */
    getSettingValue(map, key, defaultVal) {
      const fallback = defaultVal !== undefined ? defaultVal : '';
      if (!map || !key || !map[key]) return fallback;
      const v = map[key].settingValue;
      return v !== undefined && v !== null ? v : fallback;
    }

    /**
     * PPM posting labels that are shown on screen but have no row in the DB.
     *
     * The three inputs display a default when the key was never saved, but the
     * save path only writes keys the user edited — so an untouched default was
     * never persisted, and EQP_P_FUSION_POST_QUEUE's TSDAY branch fails closed on
     * a missing key. Returns changedRows-shaped entries for the missing ones
     * (using the value currently on screen) so the caller can mark them pending.
     */
    getMissingPpmPostingRows(map, onScreen) {
      const defs = [
        { key: 'PPM_TXN_SOURCE', value: onScreen.txnSource,
          description: 'Fusion transaction source for PPM-mode equipment cost. Replaces the hardcoded literal in the OIC field map.' },
        { key: 'PPM_DOCUMENT', value: onScreen.document,
          description: 'Fusion document for PPM-mode equipment cost.' },
        { key: 'PPM_DOC_ENTRY', value: onScreen.docEntry,
          description: 'Fusion document entry for PPM-mode equipment cost. Carries the expenditure type class and the Import raw cost amounts flag.' }
      ];
      const rows = {};
      defs.forEach(function (d) {
        const stored = map && map[d.key];
        if (stored && stored.id) return;
        if (!d.value) return;
        rows[d.key] = {
          id: null,
          settingValue: String(d.value),
          businessUnitId: null,
          settingCategory: 'PPM_POSTING',
          description: d.description
        };
      });
      return rows;
    }

    /**
     * Equipment Classes tab (MD/EquipRite_Equipment_Class_Config_Context.md).
     *
     * Classes come from EQR_EQUIPMENT_CLASS (eqp-v1/getEquipmentClasses) and
     * subclasses from EQR_EQUIPMENT_SUBCLASS (eqp-v1/getEquipmentSubclassesByClassId)
     * — two separate tables, loaded via the load chains and mapped through the
     * helpers below. This screen sets only the Consumable (existing) and
     * Auto-Consume (new) flags, plus Active; it NEVER touches the inspection_*
     * columns (context §8 — owned by the Inspection page).
     *
     * consumableFlag / autoConsumeFlag / timesheetEntryEnabled / bufferPeriodDays are
     * ALL real subclass columns and all four come back on the DTO (V149 consumable +
     * buffer, V201 timesheet entry, V312 renamed AUTO_RECEIVE_FLAG -> AUTO_CONSUME_FLAG).
     * mapSubclassRows still normalises them defensively so the switches always have a
     * 'Y'/'N' to bind to.
     *
     * mapClassRows: normalise the /equipment-classes payload to the left-list shape.
     */
    mapClassRows(dataArray) {
      if (!dataArray || !dataArray.length) return [];
      return dataArray
        .filter(c => c != null)
        .map(c => ({
          id: c.id,
          className: c.className || c.classCode || String(c.id),
          classCode: c.classCode || '',
          // Fusion reference captured by the Class Mapping sub-tab. All null on
          // hand-typed classes -- expected, not missing data.
          fusionSourceType: c.fusionSourceType || null,
          fusionClassRef: c.fusionClassRef == null ? null : String(c.fusionClassRef),
          fusionClassCode: c.fusionClassCode || '',
          fusionClassName: c.fusionClassName || '',
          fusionClassType: c.fusionClassType || null,
          fusionClassTypeName: c.fusionClassTypeName || ''
        }))
        .sort((a, b) => String(a.className).localeCompare(String(b.className)));
    }

    /**
     * Request body for bulkCreateClassesFromFusion: the source, its saved column
     * mapping and the pairs. dryRun true decides every pair without writing.
     */
    bulkFusionRequest(source, mapping, pairs, dryRun) {
      return {
        fusionSourceType: source,
        classColumn: mapping.classColumn,
        classColumnName: mapping.classColumnName || mapping.classColumn,
        subclassColumn: mapping.subclassColumn || null,
        subclassColumnName: mapping.subclassColumn ? (mapping.subclassColumnName || mapping.subclassColumn) : null,
        dryRun: !!dryRun,
        pairs: (pairs || []).map(p => ({
          key: p.key,
          classRef: p.classRef,
          classCode: p.classCode || null,
          className: p.className,
          subclassRef: p.subclassRef || null,
          subclassName: p.subclassRef ? p.subclassName : null
        }))
      };
    }

    /**
     * Create from Fusion pair status (bulkCreateClassesFromFusion dryRun, via
     * previewClassMapPairsChain: classAction / subAction EXISTS | LINK | CREATE |
     * CONFLICT, subAction NONE without a subclass). LINK = a hand-made class / subclass of the same name is reused
     * and given the Fusion reference; CONFLICT = that name already belongs to a
     * different Fusion value, so the pair is skipped.
     */
    pairStatusLabel(row) {
      const c = row && row.classAction, s = row && row.subAction;
      if (c === 'CONFLICT') return 'Class name in use';
      if (s === 'CONFLICT') return 'Subclass name in use';
      if (c === 'EXISTS' && (s === 'NONE' || s === 'EXISTS')) return 'Exists';
      if (c === 'CREATE') return 'New';
      const parts = [];
      if (c === 'LINK') parts.push('Link class');
      if (s === 'LINK') parts.push('link subclass');
      if (s === 'CREATE') parts.push('new subclass');
      const t = parts.join(', ');
      return t.charAt(0).toUpperCase() + t.slice(1);
    }

    /** Whether Create New Classes would do anything for a pair. */
    pairActionable(row) {
      const c = row && row.classAction, s = row && row.subAction;
      return c !== 'CONFLICT' && s !== 'CONFLICT' && !(c === 'EXISTS' && (s === 'NONE' || s === 'EXISTS'));
    }

    /**
     * Create from Fusion SOURCE picker: the allowed sources that have a saved
     * column mapping -- there is nothing to list for one that has none.
     */
    bulkSourceOptions(settingsMap, truth) {
      return this.classMapSourceOptions(truth)
        .filter(o => this.columnMappingFor(settingsMap, o.value));
    }

    /**
     * FUSION SOURCE column of the Classes & Subclasses grid, for one subclass row:
     *   classText     'Inventory · EFF Attribute 1 = HPU', or 'Custom' (no Fusion ref)
     *   subclassText  'EFF Attribute 2 = 30T' / 'Subclass: Custom'
     *   classMapped   whether the row's class carries a Fusion ref (Remove class mapping)
     */
    fusionSourceText(row, classes, types) {
      const cls = (classes || []).find(c => Number(c.id) === Number(row && row.classId));
      const classMapped = !!(cls && cls.fusionClassRef);
      const src = cls && cls.fusionSourceType;
      const subRef = row && row.fusionSubclassRef;
      if (!classMapped && !subRef) return { classText: 'Custom', subclassText: '', classMapped: false };
      // Rows mapped before V370 have no stored type: they were made with the
      // old fixed pairing (LEGACY_TYPES).
      const classText = classMapped
        ? [this.fusionSourceLabel(src),
           (cls.fusionClassTypeName || this.categoryTypeLabel(src, cls.fusionClassType || this.legacyClassType(src), types))
             + ' = ' + (cls.fusionClassName || cls.fusionClassRef)].join(' · ')
        : 'Custom';
      const subclassText = subRef
        ? (row.fusionSubclassTypeName || this.categoryTypeLabel(src, row.fusionSubclassType || this.legacySubclassType(src), types))
            + ' = ' + (row.fusionSubclassName || subRef)
        : 'Subclass: Custom';
      return { classText, subclassText, classMapped };
    }

    /**
     * The one place the app's axis code is translated for EQP_CLASS_LOV_RP.
     * EquipRite stores FIXED_ASSET (TRACKING_TYPE and, since V369,
     * FUSION_SOURCE_TYPE -- the backend 400s on FINANCE); the deployed report's
     * branch is literally 'FINANCE' and compares the bind exactly, so an
     * untranslated FIXED_ASSET silently returns zero rows. Uppercases too.
     */
    reportTrackingType(axis) {
      const v = String(axis == null ? '' : axis).trim().toUpperCase();
      return v === 'FIXED_ASSET' ? 'FINANCE' : v;
    }

    /**
     * Display label for a Class Mapping source code (SOURCE picker and column).
     */
    fusionSourceLabel(code) {
      return { INVENTORY: 'Inventory', FIXED_ASSET: 'Fixed Assets', MAINTENANCE: 'Maintenance' }[code] || code || '—';
    }

    /**
     * SOURCE picker options. With no source of truth chosen, all three (the
     * behaviour before the setting existed); otherwise Inventory plus the chosen
     * one. Keep labels in sync with fusionSourceLabel.
     */
    classMapSourceOptions(truth) {
      const allowed = this.allowedSources(truth);
      return SOURCE_CODES
        .filter(v => allowed.indexOf(v) !== -1)
        .map(v => ({ value: v, label: this.fusionSourceLabel(v) }));
    }

    /**
     * SOURCE PRECEDENCE picker options, in the format the item import reads
     * (EQR_ITEM_IMPORT_MERGE_PKG): CLASS_MAPPING_PRECEDENCE is an ordered,
     * comma-separated source list, first = highest -- e.g. 'MAINTENANCE,INVENTORY'.
     * With an asset source chosen there are two orders; none without one.
     */
    classMapPrecedenceOptions(truth) {
      const t = String(truth || '').toUpperCase();
      if (t !== 'FIXED_ASSET' && t !== 'MAINTENANCE') return [];
      return [t + ',INVENTORY', 'INVENTORY,' + t]
        .map(v => ({ value: v, label: this.classMapPrecedenceLabel(v) }));
    }

    /** 'MAINTENANCE,INVENTORY' -> 'Maintenance, then Inventory'. */
    classMapPrecedenceLabel(value) {
      return String(value || '').split(',').map(v => v.trim()).filter(Boolean)
        .map(v => this.fusionSourceLabel(v)).join(', then ');
    }

    /**
     * The precedence list after the asset source changes: the old asset source
     * is swapped for the new one IN PLACE, so its rank is kept ('MAINTENANCE,
     * INVENTORY' -> 'FIXED_ASSET,INVENTORY'). Unset stays unset -- the import
     * then defaults to '<asset source>,INVENTORY'.
     */
    classMapPrecedenceForTruth(precedence, truth) {
      const t = String(truth || '').toUpperCase();
      if (!precedence || (t !== 'FIXED_ASSET' && t !== 'MAINTENANCE')) return precedence || '';
      return String(precedence).split(',').map(v => v.trim().toUpperCase())
        .map(v => (v === 'FIXED_ASSET' || v === 'MAINTENANCE') ? t : v)
        .filter((v, i, a) => v && a.indexOf(v) === i)
        .join(',');
    }

    /**
     * Add Class drawer TYPE options: the allowed classification sources, plus
     * CUSTOM -- a class / subclass typed by hand, with no Fusion column behind it.
     * A CUSTOM class has no Fusion reference, so the item import never matches
     * items to it; it is assigned by hand in the review grid.
     */
    addClassTypeOptions(truth) {
      return this.classMapSourceOptions(truth).concat([{ value: 'CUSTOM', label: 'Custom' }]);
    }

    /** Sources that may be mapped from, given CLASS_MAPPING_SOURCE_OF_TRUTH. */
    allowedSources(truth) {
      const t = String(truth || '').toUpperCase();
      return t === 'FIXED_ASSET' || t === 'MAINTENANCE' ? ['INVENTORY', t] : SOURCE_CODES.slice();
    }

    /** Whether a stored row's source is still allowed by the source of truth. */
    isAllowedSource(source, truth) {
      return this.allowedSources(truth).indexOf(String(source || '').toUpperCase()) !== -1;
    }

    /**
     * FIELD GROUP picker options for a source, in report order (Inventory: Item
     * Class / Attributes / Categories; Maintenance: Attributes; Fixed Assets:
     * Attributes / Categories). Derived from the loaded columns -- the report
     * assigns each column its group; the page defines none.
     */
    fieldGroupOptions(source, types) {
      const seen = {};
      return categoryTypesFor(source, types)
        .map(t => (types || []).find(x => x.value === t.value && x.source === String(source || '').toUpperCase()))
        .filter(t => t && t.group && !seen[t.group] && (seen[t.group] = true))
        .map(t => ({ value: t.group, label: t.groupName || t.group }));
    }

    /** COLUMN picker options: the source's columns in one field group. */
    columnOptions(source, group, types) {
      const src = String(source || '').toUpperCase();
      if (!group) return [];
      return categoryTypesFor(source, types)
        .filter(t => (types || []).some(x => x.value === t.value && x.source === src && x.group === group))
        .map(t => ({ value: t.value, label: t.label }));
    }

    /** Settings key holding a source's column mapping (JSON). */
    columnMappingKey(source) {
      return 'CLASS_MAPPING_COLUMNS_' + String(source || '').toUpperCase();
    }

    /**
     * A source's saved column mapping from ConfigSettingsMap, or null.
     * {classGroup, classColumn, classColumnName, subclassGroup, subclassColumn,
     *  subclassColumnName}
     */
    columnMappingFor(settingsMap, source) {
      const entry = (settingsMap || {})[this.columnMappingKey(source)];
      if (!entry || !entry.settingValue) return null;
      try {
        const m = JSON.parse(entry.settingValue);
        return m && m.classColumn ? m : null;
      } catch (e) {
        return null;
      }
    }

    /** One table row per source with a saved column mapping. */
    columnMappingRows(settingsMap) {
      return SOURCE_CODES
        .map(src => ({ src, m: this.columnMappingFor(settingsMap, src) }))
        .filter(x => x.m)
        .map(x => ({
          source: x.src,
          classGroup: x.m.classGroup,
          classColumn: x.m.classColumn,
          classColumnName: x.m.classColumnName || x.m.classColumn,
          subclassGroup: x.m.subclassGroup || null,
          subclassColumn: x.m.subclassColumn || null,
          subclassColumnName: x.m.subclassColumnName || x.m.subclassColumn || ''
        }));
    }

    /** Display name of a field group code, from the loaded columns. */
    fieldGroupLabel(source, group, types) {
      const src = String(source || '').toUpperCase();
      const t = (types || []).find(x => x.source === src && x.group === group);
      return t ? (t.groupName || group) : (group || '');
    }

    /** What a NULL stored class type means (V370): the pre-type pairing. */
    legacyClassType(source) {
      const l = LEGACY_TYPES[String(source || '').toUpperCase()];
      return l ? l.classType : null;
    }

    /** What a NULL stored subclass type means (V370): the pre-type pairing. */
    legacySubclassType(source) {
      const l = LEGACY_TYPES[String(source || '').toUpperCase()];
      return l ? l.subclassType : null;
    }

    /**
     * Display label for a stored category type, from the loaded lists (all
     * sources are loaded, so it works for any row whatever the add row is set
     * to). Falls back to retired labels (a pre-change Inventory 'Catalog' row)
     * and finally the raw code, so a row never renders blank. The grid prefers
     * the type NAME stored on the row over this.
     */
    categoryTypeLabel(source, type, types) {
      const src = String(source || '').toUpperCase();
      const t = (types || []).find(x => x.value === type && x.source === src)
        || (types || []).find(x => x.value === type);
      if (t) return t.label;
      return RETIRED_TYPE_LABELS[type] || type || '';
    }

    /**
     * mapSubclassRows: normalise the /subclasses payload to the grid shape.
     * Every behaviour flag the grid or the edit dialog binds MUST be mapped here —
     * a field left out does not read as stale, it reads as 'N' and then gets SAVED
     * as 'N' by the edit dialog (see timesheetEntryEnabled below).
     */
    mapSubclassRows(dataArray) {
      if (!dataArray || !dataArray.length) return [];
      const yn = v => (v === 'Y' || v === true ? 'Y' : 'N');
      return dataArray
        .filter(s => s != null)
        .map(s => ({
          id: s.id,
          classId: s.eqrEquipmentClassId,
          subclassName: s.subclassName || s.subclassCode || String(s.id),
          subclassCode: s.subclassCode || '',
          // TYPE — default tracking intent for NEW items in this subclass.
          // MUST be mapped here for the same reason as timesheetEntryEnabled below:
          // a missing property does not read as stale, it reads as the fallback and
          // then gets SAVED as that fallback by the edit dialog. Unknown/absent
          // values normalise to 'INVENTORY' (the column default).
          trackingType: normaliseTrackingType(s.trackingType),
          consumableFlag: yn(s.consumableFlag),
          autoConsumeFlag: yn(s.autoConsumeFlag),
          // MUST be mapped, even though nothing reads the flag yet. Omitting it made
          // the grid column render 'No' unconditionally (the row simply had no such
          // property), and openEditClassSubclassChain then seeded the dialog from that
          // same missing property — so saveEditClassSubclassChain PATCHed a fabricated
          // 'N' over whatever was in the DB. The column is real (V201), the DTO
          // declares it and GET returns it, so that write lands and the round trip is
          // real — which is exactly why the mapping cannot be dropped.
          timesheetEntryEnabled: yn(s.timesheetEntryEnabled),
          // Buffer Period (days after return for QC/maintenance). Real column since
          // V149; defaults to 0 so the input always has a value to bind.
          bufferPeriodDays: s.bufferPeriodDays != null ? Number(s.bufferPeriodDays) : 0,
          // Fusion reference captured by the Class Mapping sub-tab; null when hand-typed.
          fusionSubclassRef: s.fusionSubclassRef == null ? null : String(s.fusionSubclassRef),
          fusionSubclassCode: s.fusionSubclassCode || '',
          fusionSubclassName: s.fusionSubclassName || '',
          fusionSubclassType: s.fusionSubclassType || null,
          fusionSubclassTypeName: s.fusionSubclassTypeName || ''
        }))
        .sort((a, b) => String(a.subclassName).localeCompare(String(b.subclassName)));
    }

    /**
     * filterSubclasses: narrow the full subclass grid by the class filter and/or
     * the subclass filter. With neither set, show everything. Returns the same row
     * object references so switch edits still mutate the underlying rows.
     */
    filterSubclasses(rows, selectedClassId, selectedSubclassId) {
      if (!rows || !rows.length) return [];
      let out = rows;
      if (selectedClassId != null && selectedClassId !== '') {
        out = out.filter(r => Number(r.classId) === Number(selectedClassId));
      }
      if (selectedSubclassId != null && selectedSubclassId !== '') {
        out = out.filter(r => Number(r.id) === Number(selectedSubclassId));
      }
      return out;
    }

    /* ---------------------------------------------------------------------
     * BU & Org Mapping tab (MD/BU_TO_ORG_MAP.md §5)
     *
     * Mixed table across all BUs; a BU filter LOV (built from the BUs present
     * in the loaded data) narrows it client-side, mirroring the Equipment
     * Class filter. Rows persist via the upsert-by-BU PUT
     * (eqp-v1/upsertBuOrgMappingsByBU) and load from getBuOrgMappingsByBU.
     *
     * Row shape used by the drawer + table + save:
     *   rowKey, buId, buName, orgId (Fusion OrganizationId), orgName, orgCode,
     *   location, status, yardType (= orgRole), yardTypeLabel,
     *   isTransactable ('Y'/'N'), subinventoryCode (optional)
     *
     * The upsert-by-BU PUT stores subinventoryCode AS SENT, null included
     * (unlike the address fields, which it only sets when present). Every
     * caller must send it on every row, or it clears the saved value.
     * ------------------------------------------------------------------- */

    /** Stable composite key for the mixed table (org can recur across BUs). */
    buOrgRowKey(buId, orgId) {
      return String(buId == null ? '' : buId) + '-' + String(orgId == null ? '' : orgId);
    }

    /** Friendly label for an org role code. */
    orgRoleLabel(roleCode, roleLov) {
      const lov = roleLov || [];
      const m = lov.find(r => r.value === roleCode);
      return m ? m.label : (roleCode || '');
    }

    /**
     * Normalise the getBuOrgMappings payload (array OR {data:[...]}) into the
     * page-state row shape the drawer/table/save use.
     *
     * Shows ALL rows, active and inactive (isActiveFlag carried through as its
     * own column) — deleting a mapping deactivates it (IS_ACTIVE_FLAG='N')
     * rather than hard-deleting (keeps audit history), and admins can now see
     * that history in the table instead of it just vanishing. Anywhere this
     * array feeds an upsert-by-BU PUT (add/delete chains) must re-filter to
     * active rows itself — this function intentionally does not do that here.
     */
    /**
     * Yard types that carry a subinventory: the equipment yards (a return TO
     * delivers into them) and the two virtual orgs (an outbound TO delivers
     * into them). Destination yards don't. Drives the picker and what is saved.
     */
    buOrgNeedsSubinventory(yardType) {
      var t = String(yardType || '').toUpperCase();
      return t === 'EQUIPMENT_YARD' || t === 'VIRTUAL_PROJECT' || t === 'VIRTUAL_CUSTOMER';
    }

    mapMappingRowsFromApi(payload, roleLov) {
      const arr = Array.isArray(payload) ? payload : (payload && payload.data) || [];
      // Address + coordinate columns are carried through verbatim. They are not
      // displayed in the table, but the save path is an upsert-by-BU PUT that
      // re-sends every row of the BU — so a row loaded here WITHOUT its address
      // would blank those columns out on the next unrelated save. Round-tripping
      // them is what keeps previously-enriched rows intact.
      const ADDRESS_KEYS = [
        'addressLine1', 'addressLine2', 'addressLine3', 'addressLine4',
        'building', 'floorNumber', 'townOrCity',
        'region1', 'region2', 'region3',
        'postalCode', 'longPostalCode', 'country', 'style', 'locationCode',
        'invOrgLatitude', 'invOrgLongitude'
      ];
      return arr
        .filter(r => r != null)
        .map(r => {
          const row = {
            id:            r.id != null ? r.id : null,
            rowKey:        this.buOrgRowKey(r.businessUnitId, r.invOrgId),
            buId:          r.businessUnitId,
            buName:        r.buName || '',
            orgId:         r.invOrgId,
            orgName:       r.invOrgName || '',
            orgCode:       r.invOrgCode || '',
            location:      r.locationCode || '',
            yardType:      r.orgRole || '',
            yardTypeLabel: this.orgRoleLabel(r.orgRole, roleLov),
            isActiveFlag:  r.isActiveFlag === 'N' ? 'N' : 'Y',
            // Missing/blank reads as 'Y' — the column's DEFAULT, so rows from
            // before IS_TRANSACTABLE existed display the value they were backfilled to.
            isTransactable: r.isTransactable === 'N' ? 'N' : 'Y',
            // Optional Fusion subinventory (EQR_BU_ORG_MAPPING.SUBINVENTORY_CODE).
            // Carried on every row because the add path re-sends the whole BU.
            subinventoryCode: r.subinventoryCode || null
          };
          ADDRESS_KEYS.forEach(k => {
            if (r[k] != null && String(r[k]).trim() !== '') row[k] = r[k];
          });
          return row;
        });
    }

    /** Distinct-BU filter LOV from the loaded rows (BUs present in the table). */
    buildBuFilterLov(rows) {
      if (!rows || !rows.length) return [];
      const seen = {};
      const lov = [];
      rows.forEach(r => {
        if (r.buId != null && !seen[r.buId]) {
          seen[r.buId] = true;
          lov.push({ value: r.buId, label: r.buName || String(r.buId) });
        }
      });
      return lov.sort((a, b) => String(a.label).localeCompare(String(b.label)));
    }

    /** Narrow the mixed mapping table by the selected BU filter (none = show all). */
    filterBuOrgMappings(rows, filterBUId) {
      if (!rows || !rows.length) return [];
      if (filterBUId == null || filterBUId === '') return rows;
      return rows.filter(r => String(r.buId) === String(filterBUId));
    }

    /* ---------------------------------------------------------------------
     * BU Settings tab (table + drawer)
     *
     * EQR_CONF_EQUIPMENT_SETTING is COLUMNAR: one row per business unit, each
     * setting a typed column (settingKey/settingValue no longer exist). The GET
     * returns those rows (camelCase columns); we surface ONE display row per BU.
     * A save is ONE write per BU — PATCH the BU's row by id, or POST a new one —
     * never the old per-key fan-out (which created duplicate rows with every
     * typed column null).
     *
     * Rows with a null businessUnitId aren't BU settings and are excluded.
     * ------------------------------------------------------------------- */

    /**
     * Links each display/draft key (UPPERCASE, so table + drawer bindings stay
     * put) to its API column (camelCase) and storage type, which drives coercion
     * both ways:
     *   bool   → CHAR(1) 'Y'/'N'   (NOT the legacy 'true'/'false')
     *   number → NUMBER(10,4)
     *   string → VARCHAR2
     */
    esColumnMap() {
      return {
        RATE_SOURCE:             { col: 'rateSource',            type: 'string' },
        PASS_PROCUREMENT_COST:   { col: 'passProcurementCost',   type: 'bool' },
        PPM_TRANS_SOURCE:        { col: 'ppmTransSource',        type: 'string' },
        PPM_BATCH_PREFIX:        { col: 'ppmBatchPrefix',        type: 'string' },
        ADHOC_TIMESHEET_ENABLED: { col: 'adhocTimesheetEnabled', type: 'bool' },
        // MARGIN_PERCENTAGE — RESTORED to BU authoring (2026-09-03).
        //
        // It was removed from this map when procurement markup was re-conceived as a
        // per-SUBCLASS value ("BU doesn't make sense" — post-Liberty change #3). The
        // subclass half was never built: EQR_EQUIPMENT_SUBCLASS has no markup column
        // (verified live — 15 columns, none of them markup/margin/procurement), and
        // the Equipment Classes dialog's Procurement Markup % is a preview that the
        // save chain deliberately drops. Meanwhile BOTH post-cost views still price
        // markup from cfg.margin_percentage on THIS table, which is the only markup
        // column that exists anywhere in the schema.
        //
        // Net effect of that half-move: the engine reads a value nobody could set.
        // The one live BU row has MARGIN_PERCENTAGE = 0, written once by SYSTEM on
        // 2026-07-19 and never touched, so no markup applied anywhere. Putting it
        // back here restores authoring to the place the storage and the engine both
        // already agree on. Subclass-level markup stays the eventual target and its
        // UI is kept dormant rather than deleted.
        //
        // ⚠️ THE WIPE HAZARD THIS MAP CARRIES: every key here is written by
        // esDraftToBody, so a key that is mapped but NOT bound in the drawer sends
        // marginPercentage:null and blanks the stored percent on the next BU save.
        // This entry is therefore only safe because the drawer now binds it AND both
        // open chains seed it (openEsEditChain from the stored row, openEsDrawerChain
        // as null for a new BU). Do not add a key here without doing all three.
        MARGIN_PERCENTAGE:       { col: 'marginPercentage',      type: 'number' }
        // IS_SHIP_DOCUMENT deliberately ABSENT: the Ship Doc column/switch was
        // dropped from this tab, and keeping it out of the map keeps it out of the
        // save body, so the stored flag survives the partial PATCH.
      };
    }

    /** The setting keys this tab manages, in table-column order. */
    esSettingKeys() {
      return Object.keys(this.esColumnMap());
    }

    /** Stored flag → real boolean. Accepts columnar 'Y' and legacy 'true'/boolean. */
    esParseBool(v) {
      return v === true || v === 'Y' || v === 'true';
    }

    /** Stored number → number|null, keeping a genuine null distinct from Number('')===0. */
    esParseNum(v) {
      return (v === null || v === undefined || v === '') ? null : Number(v);
    }

    /**
     * Build the columnar API body from a drawer draft: each key → its column,
     * coerced to the column's type (bool → 'Y'/'N', number|null, string|null).
     * Spread into the POST/PATCH body by saveEsDrawerChain.
     */
    esDraftToBody(draft) {
      const map = this.esColumnMap();
      const body = {};
      Object.keys(map).forEach((k) => {
        const meta = map[k];
        const v = draft ? draft[k] : undefined;
        if (meta.type === 'bool') {
          body[meta.col] = v ? 'Y' : 'N';
        } else if (meta.type === 'number') {
          body[meta.col] = (v === null || v === undefined || v === '') ? null : Number(v);
        } else {
          body[meta.col] = (v === null || v === undefined || v === '') ? null : v;
        }
      });
      return body;
    }

    /**
     * Map a Fusion finBusinessUnitsLOV item to the BU columns every
     * conf-equipment-settings row denormalizes. Returns the payload shape the
     * POST/PATCH bodies spread directly, or null if there's no item — callers
     * MUST treat null as "unknown" and omit the fields entirely rather than send
     * nulls, which would blank the stored columns.
     *
     * Fusion's types are not what you'd guess (verified against a live row):
     *   PrimaryLedgerId / LegalEntityId  arrive as STRINGS ("300000046975971")
     *   LocationId                       arrives as a number
     *   ManagerId                        is frequently null
     * The columns are all NUMBER and nullable, so each id is coerced through
     * toNum — which must distinguish a real null from Number(null) === 0.
     */
    mapFusionBuAttrs(item) {
      if (!item) return null;

      const toNum = function (v) {
        return (v === null || v === undefined || v === '') ? null : Number(v);
      };

      return {
        businessUnitName:  item.BusinessUnitName || null,
        buPrimaryLedgerId: toNum(item.PrimaryLedgerId),
        buLocationId:      toNum(item.LocationId),
        buManagerId:       toNum(item.ManagerId),
        buLegalEntityId:   toNum(item.LegalEntityId)
      };
    }

    /**
     * Build ONE display row per Business Unit from the columnar GET payload.
     * Row shape: { buId, buName, __rowId, <KEY>: normalized-value, ... } — flags
     * as real booleans, numbers as number|null, strings as-is.
     *
     * A BU should have a single row, but the earlier EAV-shaped save left several
     * all-null duplicate rows per BU. To be robust we pick the MOST-populated row
     * (tie → newest id) so a real data row always beats the null dupes, and carry
     * its id as __rowId so the save PATCHes the right one.
     */
    buildSettingsByBu(dataArray) {
      if (!dataArray || !dataArray.length) return [];
      const map = this.esColumnMap();
      const keys = Object.keys(map);

      const byBu = {};
      dataArray.forEach((rec) => {
        if (rec.businessUnitId == null) return; // not a BU setting
        (byBu[rec.businessUnitId] = byBu[rec.businessUnitId] || []).push(rec);
      });

      const populated = (rec) =>
        keys.reduce((n, k) => n + (rec[map[k].col] != null ? 1 : 0), 0);

      const rows = Object.keys(byBu).map((buId) => {
        const chosen = byBu[buId].slice().sort(
          (a, b) => (populated(b) - populated(a)) || ((b.id || 0) - (a.id || 0))
        )[0];

        const row = {
          buId: Number(buId),
          buName: chosen.businessUnitName || String(buId),
          __rowId: chosen.id != null ? chosen.id : null
        };
        keys.forEach((k) => {
          const meta = map[k];
          const raw = chosen[meta.col];
          row[k] = meta.type === 'bool' ? this.esParseBool(raw)
                 : meta.type === 'number' ? this.esParseNum(raw)
                 : (raw != null ? raw : '');
        });
        return row;
      });

      return rows.sort((a, b) => String(a.buName).localeCompare(String(b.buName)));
    }

    /** Friendly label for a code given a {label,value}[] LOV (falls back to the code). */
    esLovLabel(code, lov) {
      if (code == null || code === '') return '';
      const list = lov || [];
      const m = list.find(o => String(o.value) === String(code));
      return m ? m.label : String(code);
    }

    /** Stored flag → 'Yes'/'No'. Accepts columnar 'Y' and legacy 'true'/boolean. */
    esYesNo(v) {
      return this.esParseBool(v) ? 'Yes' : 'No';
    }
  }

  return PageModule;
});
