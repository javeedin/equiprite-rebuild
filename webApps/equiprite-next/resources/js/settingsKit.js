define(['resources/js/configurationInventory'], (inv) => {
  'use strict';

  /*
   * Settings in EquipRite Next: the helpers New EquipRite's Configuration page (flows/settings/pages/configuration-page.js)
   * runs its settings and business-unit chains on, copied here verbatim so the Next chains compute the same maps,
   * bodies and guards from the same inputs (tests/next-insights-admin.test.js runs both on the same data):
   *   - from the old page module, which New carried over unchanged: buildSettingsMap, getSettingBool, getSettingValue,
   *     getMissingPpmPostingRows, esColumnMap, esSettingKeys, esParseBool, esParseNum, esDraftToBody, mapFusionBuAttrs,
   *     buildSettingsByBu, esLovLabel, esYesNo;
   *   - from New: norm, textMatches, sectionTitleMatches, settingMatches, settingDef, storedValue, displayValue, rows,
   *     row, changeList, flagsAfter, menuImpact, esRateText, markupText, rateSourceOptions, boolOptions, rowOptions.
   * What each setting does, needs and affects is resources/js/configurationInventory.js (New's, unchanged).
   * Below the marker are Next's own: the sections, the pending-change summary, business-unit rows and changes,
   * history, exports. Pure.
   */

  // The sections Next shows and edits; the list sections (yards, classes, expenditure types, agreement types,
  // attachment categories) are managed in New EquipRite's Configuration, which the page links to.
  const EDITED = { modules: 1, costing: 1, notifications: 1, 'bu-settings': 1, history: 1 };

  class SettingsKit {
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

    /** Lower-cased, trimmed search text. */
    norm(q) {
      return String(q == null ? '' : q).trim().toLowerCase();
    }

    /** True when every word of the query appears in one of the texts. */
    textMatches(q, texts) {
      const words = this.norm(q).split(/\s+/).filter(Boolean);
      if (!words.length) return true;
      const hay = (texts || []).filter(t => t != null).join(' ').toLowerCase();
      return words.every(w => hay.indexOf(w) !== -1);
    }

    /** The search names the section itself (its title or the old tab's name): show all of it. */
    sectionTitleMatches(key, q) {
      const s = inv.SECTIONS.find(x => x.key === key);
      return !!s && this.textMatches(q, [s.title, s.oldTab]);
    }

    /** A setting matches on its label, key, help, what it affects, its old label or its options. */
    settingMatches(s, q) {
      return this.textMatches(q, [s.label, s.key, s.help, s.affects, s.oldLabel,
        (s.options || []).map(o => o.label).join(' ')]);
    }

    /** The inventory entry of a setting key. */
    settingDef(key) {
      return inv.BY_KEY[key] || null;
    }

    /** What a stored row says (the page as loaded), '' when never saved. */
    storedValue(stored, key) {
      const e = (stored || {})[key];
      return e && e.settingValue != null ? String(e.settingValue) : '';
    }

    /** A value as people read it: On / Off for a switch, the option's label, the text, or (blank). */
    displayValue(def, value) {
      if (!def) return String(value == null ? '' : value);
      if (def.kind === 'flag') return value === 'true' || value === true ? 'On' : 'Off';
      if (def.options) {
        const o = def.options.find(x => x.value === value);
        if (o) return o.label;
      }
      return value === '' || value == null ? '(blank)' : String(value);
    }

    /**
     * The rows of a settings section (Modules & features, Costing & timesheets, Notifications), filtered by the
     * search. Each row knows its control, whether it is changed, what it needs (and whether that is met) and
     * what it affects. Children of a switched-off parent stay visible but read as dimmed; the PPM posting labels
     * are only shown while Fusion PPM rates is on, as on the old page.
     */
    rows(section, map, stored, changed, q, readOnly) {
      const titleHit = this.sectionTitleMatches(section, q);
      return inv.SETTINGS
        .filter(s => s.section === section && s.kind !== 'now')
        .filter(s => !s.showWhen || this.getSettingBool(map, s.showWhen))
        .filter(s => !this.norm(q) || titleHit || this.settingMatches(s, q))
        .map(s => this.row(s, map, stored, changed, readOnly));
    }

    row(s, map, stored, changed, readOnly) {
      const isFlag = s.kind === 'flag';
      const value = isFlag ? (this.getSettingBool(map, s.key) ? 'true' : 'false')
        : String(this.getSettingValue(map, s.key, s.defaultValue != null ? s.defaultValue : ''));
      const pending = !!(changed && changed[s.key] !== undefined);
      const needs = (s.needs || []).map(k => ({
        key: k, label: (inv.BY_KEY[k] || {}).label || k, ok: this.getSettingBool(map, k),
      }));
      const needsMet = needs.every(n => n.ok);
      const locked = !!s.lockWhenSaved && this.storedValue(stored, s.key) !== '';
      const blockedByNeeds = !!s.enforced && !needsMet;
      const parentOff = !!s.parent && !this.getSettingBool(map, s.parent);
      let note = '';
      if (locked) {
        note = 'Saved as ' + this.displayValue(s, this.storedValue(stored, s.key)) + '. It is locked; Reset to pick another day.';
      } else if (blockedByNeeds) {
        note = 'Turn on ' + needs.filter(n => !n.ok).map(n => n.label).join(' and ') + ' first.';
      }
      return {
        key: s.key,
        label: s.label,
        help: s.help,
        kind: s.kind,
        depth: s.depth || 0,
        on: value === 'true',
        value: value,
        options: (s.options || []).map(o => ({ value: o.value, label: o.label, on: o.value === value })),
        changed: pending,
        was: !pending ? '' : (stored && stored[s.key] ? this.displayValue(s, this.storedValue(stored, s.key)) : 'not saved yet'),
        neverSaved: !(stored && stored[s.key] && stored[s.key].id),
        needs: needs,
        needsMet: needsMet,
        keepOn: s.keepOn ? ((inv.BY_KEY[s.keepOn] || {}).label || s.keepOn) : '',
        affects: s.affects || '',
        dim: parentOff,
        disabled: !!readOnly || blockedByNeeds || locked,
        note: note,
        canReset: !!s.lockWhenSaved && locked && !readOnly,
      };
    }

    /**
     * The unsaved changes in the order they will be written (saveChangesChain walks changedRows in insertion
     * order): [{ key, label, from, to }]. A key the database has never had reads "not saved yet".
     */
    changeList(changed, stored) {
      return Object.keys(changed || {}).map(k => {
        const def = this.settingDef(k);
        const has = !!(stored && stored[k]);
        return {
          key: k,
          label: def ? def.label : k,
          from: has ? this.displayValue(def, this.storedValue(stored, k)) : 'not saved yet',
          to: this.displayValue(def, changed[k].settingValue),
        };
      });
    }

    /** The feature flags the app will run on once the pending changes are saved. */
    flagsAfter(flags, changed) {
      const out = Object.assign({}, flags || {});
      Object.keys(changed || {}).forEach(k => {
        const def = this.settingDef(k);
        if (def && def.category === 'FEATURE_FLAG') out[k] = String(changed[k].settingValue);
      });
      return out;
    }

    /**
     * What saving does to the menu, from two visibleNavGroups results (now and after): the items it shows and the
     * items it hides. Shown before the click, in the unsaved-changes bar.
     */
    menuImpact(before, after) {
      const ids = groups => {
        const m = {};
        (groups || []).forEach(g => (g.items || []).forEach(it => { m[it.id] = it.label; }));
        return m;
      };
      const a = ids(before);
      const b = ids(after);
      const shows = Object.keys(b).filter(k => !(k in a)).map(k => b[k]);
      const hides = Object.keys(a).filter(k => !(k in b)).map(k => a[k]);
      const lines = [];
      if (shows.length) lines.push('The menu will show ' + shows.join(', ') + '.');
      if (hides.length) lines.push('The menu will hide ' + hides.join(', ') + '.');
      return lines;
    }

    /** RATE SOURCE cell: the global PPM switch overrides every BU (usesPpmRates), so say what applies. */
    esRateText(row, map) {
      return this.getSettingBool(map, 'PPM_RATES_ENABLED')
        ? 'PPM Rates (global)'
        : (this.esLovLabel(row && row.RATE_SOURCE, inv.BU_FIELDS[0].options) || 'Not set');
    }

    /** Dash for unset, "0%" for a deliberate zero (the two mean different things to a reader). */
    markupText(v) {
      return v != null && v !== '' ? v + '%' : '—';
    }

    /** The rate source choices, marked. */
    rateSourceOptions(value) {
      return inv.BU_FIELDS[0].options.map(o => ({ value: o.value, label: o.label, on: o.value === value }));
    }

    /** Yes / No for an on/off draft field (true / false). */
    boolOptions(value) {
      const on = value === true || value === 'true' || value === 'Y';
      return [{ value: 'true', label: 'Yes', on: on }, { value: 'false', label: 'No', on: !on }];
    }

    /** A choice row's buttons, each carrying the row's key and whether it can be pressed. */
    rowOptions(row) {
      return ((row && row.options) || []).map(o => ({ key: row.key, value: o.value, label: o.label, on: o.on, disabled: !!row.disabled }));
    }

    /* =====================================================================
     * EQUIPRITE NEXT ONLY (everything above is copied from New EquipRite's configuration-page.js, verbatim)
     * ===================================================================== */

    /** The sections Next shows and edits, in page order, and the ones still managed in New EquipRite. */
    nextSections() {
      return inv.SECTIONS.filter(s => EDITED[s.key]);
    }

    newSections() {
      return inv.SECTIONS.filter(s => !EDITED[s.key]);
    }

    /**
     * The three settings sections as the page shows them: each { key, title, summary, rows } with the rows that
     * match the search (rows() above, New's), and the count of changed rows.
     */
    settingSections(map, stored, changed, q, readOnly) {
      return ['modules', 'costing', 'notifications'].map(key => {
        const s = inv.SECTIONS.find(x => x.key === key) || { key, title: key, summary: '' };
        const rows = this.rows(key, map, stored, changed, q, readOnly).map(r => Object.assign({}, r, {
          cls: this.rowClassNext(r),
          needsText: (r.needs || []).map(n => n.label + (n.ok ? ' (on)' : ' (off)')).join(', '),
        }));
        return { key, title: s.title, summary: s.summary, rows, changed: rows.filter(r => r.changed).length };
      }).filter(s => s.rows.length || !this.norm(q));
    }

    rowClassNext(r) {
      return 'nx-st-row nx-st-row--d' + (r.depth || 0) + (r.changed ? ' nx-st-row--changed' : '') + (r.dim ? ' nx-st-row--dim' : '');
    }

    /**
     * What Save changes, said before it is pressed: the values from and to (changeList, New's), what each one
     * affects, and what the menu shows and hides after (menuImpact, New's) from Next's own menu.
     *   menuBefore, menuAfter   nav.visibleGroups with the flags as they are and as they would be
     */
    pending(changed, stored, menuBefore, menuAfter) {
      const list = this.changeList(changed, stored).map(c => Object.assign({}, c, { affects: ((this.settingDef(c.key) || {}).affects) || '' }));
      return { list, menu: this.menuImpact(menuBefore, menuAfter), count: list.length };
    }

    /** Business unit rows as the table shows them (buildSettingsByBu's rows, in words). */
    buRows(esRows, map) {
      return (esRows || []).map(r => ({
        key: String(r.buId), buId: r.buId, buName: r.buName || String(r.buId),
        rate: this.esRateText(r, map), rateSource: r.RATE_SOURCE || '',
        transSource: r.PPM_TRANS_SOURCE || '', batchPrefix: r.PPM_BATCH_PREFIX || '',
        markup: this.markupText(r.MARGIN_PERCENTAGE), passCost: this.esYesNo(r.PASS_PROCUREMENT_COST), adhoc: this.esYesNo(r.ADHOC_TIMESHEET_ENABLED),
      }));
    }

    /**
     * What saving a business unit changes, before Save: each field from and to, and what the rate source does to
     * the menu (Rate schedules leave it when no business unit prices from EquipRite; Fusion PPM rates overrides all).
     */
    buChanges(draft, row, map) {
      const d = draft || {};
      const r = row || {};
      const word = (k, v) => {
        if (k === 'RATE_SOURCE') return this.esLovLabel(v, inv.BU_FIELDS[0].options) || 'Not set';
        if (k === 'PASS_PROCUREMENT_COST' || k === 'ADHOC_TIMESHEET_ENABLED') return this.esYesNo(v);
        if (k === 'MARGIN_PERCENTAGE') return this.markupText(v);
        return v === null || v === undefined || v === '' ? '(blank)' : String(v);
      };
      const same = (k, a, b) => {
        if (k === 'PASS_PROCUREMENT_COST' || k === 'ADHOC_TIMESHEET_ENABLED') return this.esParseBool(a) === this.esParseBool(b);
        if (k === 'MARGIN_PERCENTAGE') return this.esParseNum(a) === this.esParseNum(b);
        return String(a == null ? '' : a) === String(b == null ? '' : b);
      };
      const out = [];
      inv.BU_FIELDS.forEach(f => {
        if (!same(f.key, r[f.key], d[f.key])) out.push({ key: f.key, label: f.label, from: word(f.key, r[f.key]), to: word(f.key, d[f.key]), affects: f.affects || f.help || '' });
      });
      if (this.getSettingBool(map, 'PPM_RATES_ENABLED') && out.some(c => c.key === 'RATE_SOURCE')) {
        out.push({ key: 'NOTE', label: 'Note', from: '', to: '', affects: 'Fusion PPM rates is on, so every business unit prices from PPM whatever this says, until it is turned off.' });
      }
      return out;
    }

    /** The draft's field values for the editor, each with its words. */
    buFields(draft) {
      const d = draft || {};
      return inv.BU_FIELDS.map(f => ({
        key: f.key, label: f.label, help: f.help || '', affects: f.affects || '', required: !!f.required,
        kind: f.options ? 'choice' : (f.key === 'PASS_PROCUREMENT_COST' || f.key === 'ADHOC_TIMESHEET_ENABLED' ? 'bool' : (f.key === 'MARGIN_PERCENTAGE' ? 'number' : 'text')),
        value: d[f.key] === null || d[f.key] === undefined ? '' : String(d[f.key]),
        options: f.options ? this.rateSourceOptions(d[f.key]) : (f.key === 'PASS_PROCUREMENT_COST' || f.key === 'ADHOC_TIMESHEET_ENABLED' ? this.boolOptions(d[f.key]) : []),
      }));
    }

    /** Change history rows matching the search (who, field, section, values). */
    historyRows(rows, q) {
      return (rows || []).filter(h => this.textMatches(q, [h.modifiedBy, h.section, h.field, h.oldValue, h.newValue, h.timestamp]))
        .map((h, i) => Object.assign({ key: String(i) }, h));
    }

    /** Every setting as shown, for the export. */
    settingExportRows(sections) {
      const out = [];
      (sections || []).forEach(s => (s.rows || []).forEach(r => out.push(Object.assign({ section: s.title }, r))));
      return out;
    }

    exportOf(list) {
      if (list === 'bu') {
        return { name: 'business-unit-settings', title: 'Business unit settings', columns: [
          { key: 'buName', label: 'Business unit' }, { key: 'buId', label: 'Business unit id', type: 'number' }, { key: 'rate', label: 'Rate source' },
          { key: 'transSource', label: 'Project transaction source' }, { key: 'batchPrefix', label: 'Expenditure batch prefix' },
          { key: 'markup', label: 'Procurement markup' }, { key: 'passCost', label: 'Pass procurement cost' }, { key: 'adhoc', label: 'Adhoc timesheets' }] };
      }
      if (list === 'history') {
        return { name: 'configuration-history', title: 'Configuration change history', columns: [
          { key: 'timestamp', label: 'When' }, { key: 'modifiedBy', label: 'Who' }, { key: 'section', label: 'Section' }, { key: 'field', label: 'Field' },
          { key: 'oldValue', label: 'Old value' }, { key: 'newValue', label: 'New value' }] };
      }
      return { name: 'settings', title: 'Settings', columns: [
        { key: 'section', label: 'Section' }, { key: 'label', label: 'Setting' }, { key: 'key', label: 'Key' },
        { key: 'shown', label: 'Value', value: r => (r.kind === 'flag' ? (r.on ? 'On' : 'Off') : this.displayValue(this.settingDef(r.key), r.value)) },
        { key: 'changed', label: 'Unsaved', value: r => (r.changed ? 'Yes, was ' + r.was : '') }, { key: 'help', label: 'What it does' },
        { key: 'affects', label: 'What changes' }, { key: 'needsText', label: 'Needs' }] };
    }

  }

  return new SettingsKit();
});
