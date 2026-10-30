define([
  'resources/js/equipmentMaster',
  'resources/js/exportKit',
  'resources/js/fmt',
], (em, exportKit, fmt) => {
  'use strict';

  // An equipment item's tab (FDD 7.2.5): what it is, its units, its certificates and documents, its Fusion work orders
  // and expenditure types, and Change class.
  //
  // The functions under "New EquipRite's Equipment detail" are copied from
  // webApps/equiprite/flows/master/pages/equipment-detail-page.js with their logic unchanged (the chains carried over
  // from it call them by these names); tests/next-equipment.test.js checks they still give New's answers. One is
  // Next's own: formatDate writes "8 Oct 2026", as every Next screen does, where New wrote 10/8/2026.

  // A work order no longer holds the equipment once it reaches one of these (Fusion system statuses, as words
  // after the ORA_ prefix is dropped).
  const WO_DONE = /^(COMPLETED|COMPLETE|CLOSED|CANCELED|CANCELLED|RESOLVED)$/;
  const CONTROL_LABEL = { SERIAL: 'Serial-controlled', LOT: 'Lot-controlled', INVENTORY: 'Quantity (on hand)' };
  const AUTO_WO_ASSETS = 25;
  const UNITS_TITLE = { SERIAL: 'Serial units', LOT: 'Lots', INVENTORY: 'Stock by organization' };

  const txt = (v) => (v == null ? '' : String(v));

  class PageModule {
    // ── Next ──────────────────────────────────────────────────────────────────

    /** "8 Oct 2026" (New wrote 10/8/2026); '' for none. */
    formatDate(value) { return fmt.date(value); }

    formats() { return exportKit.FORMATS; }

    /** "Serial-tracked equipment", above the name. */
    kicker(controlType) { return em.trackingLong(controlType); }

    /** "EQ-2201 · Excavators · Crawler · Caterpillar · 320 GC", under the name. */
    subline(m) { return [m && m.equipmentNumber, this.classText(m), this.makerModel(m)].filter((x) => !!x && x !== 'No class').join(' · '); }

    statusLabel(code) { return em.statusLabel(code); }

    /** "Company-owned" for COMPANY_OWNED. */
    typeWords(code) { return em.typeWords(code); }

    statusPill(code) { return 'nx-pill nx-record-pill nx-eqm-tone--' + em.statusTone(code); }

    /** "Serial units", "Lots", "Stock by organization". */
    unitsTitle(controlType) { return UNITS_TITLE[txt(controlType).toUpperCase()] || 'Units'; }

    unitWord(status) { return em.unitWord(status); }

    unitPill(status) { return 'nx-pill nx-eqi-unit--' + em.unitTone(status); }

    /** Units by status, most first, in words. */
    unitCounts(rows) { return em.unitCounts(rows, (r) => this.unitStatus(r)); }

    /** The units tile: { value, label, note }. */
    unitsGlance(rows, controlType) { return em.unitsGlance(rows, controlType, (r) => this.unitStatus(r)); }

    /** The "available now" tile: { value, note }. */
    availableGlance(rows) {
      const list = Array.isArray(rows) ? rows : [];
      const n = em.availableCount(list, (r) => this.unitStatus(r));
      if (!list.length) return { value: '0', note: 'Nothing to send out until units are on record' };
      return { value: String(n), note: n ? 'can go out on a request' : 'every unit is out, held or retired' };
    }

    certLight(rows) { return em.certLight(rows); }

    certText(rows) { return em.certLight(rows).text; }

    woLight(rows, loaded, loading) { return em.woLight(rows, loaded, loading); }

    woText(rows, loaded, loading) { return em.woLight(rows, loaded, loading).text; }

    /** The tile's colour bar: 'ok' green, 'warn' amber, 'bad' red, 'none' grey. */
    lightClass(tone) { return 'nx-kpi nx-eqi-tile nx-eqi-tile--' + (tone || 'none'); }

    /** A document's validity in words, and its tone (FDD 7.2.5A: amber 30 days before expiry). */
    docStatus(row) {
      const r = row || {};
      const d = em.daysTo(r.validTo);
      if (r.status === 'expired') return { tone: 'bad', label: 'Expired' };
      if (r.status === 'upcoming') return { tone: 'warn', label: 'Not valid yet' };
      if (r.status === 'valid' && d != null && d <= 30) return { tone: 'warn', label: d === 0 ? 'Expires today' : 'Expires in ' + d + (d === 1 ? ' day' : ' days') };
      if (r.status === 'valid') return { tone: 'ok', label: 'Valid' };
      return { tone: 'none', label: '' };
    }

    /** "Load test · valid to 19 Nov 2026 · PDF". */
    docLine(row) {
      const r = row || {};
      const valid = em.docValidity(r, fmt.date);
      return [r.categoryLabel, valid ? valid.charAt(0).toLowerCase() + valid.slice(1) : '', r.fileType].filter((x) => !!x).join(' · ');
    }

    /** "MA-1001 · 3 Nov – 5 Nov 2026 · Replace hydraulic hose". */
    woLine(w) {
      const r = w || {};
      return [r.asset, fmt.range(r.start, r.end), r.description].filter((x) => !!x).join(' · ');
    }

    /** "12 t" style value and its unit, or '—'. */
    measure(value, uom) { return value == null || value === '' ? '—' : value + (uom ? ' ' + uom : ''); }

    /** Where the item came from. */
    sourceText(m) { return m && m.createdBy === 'FUSION_IMPORT' ? 'Imported from Fusion' : 'Added in EquipRite'; }

    /** This item in New EquipRite, or ''. */
    newUrl(newBase, id) { return em.newItemUrl(newBase, id); }

    /** The export menu's note: what it writes. */
    exportNote(v) {
      if (v.exportWhat === 'docs') return v.attRows.length + (v.attRows.length === 1 ? ' document' : ' documents');
      if (v.exportWhat === 'wos') return v.workOrders.length + (v.workOrders.length === 1 ? ' work order' : ' work orders');
      const n = this.filterUnits(v.unitsArray, v.unitFilter).length;
      return n + (n === 1 ? ' unit' : ' units') + ', as shown';
    }

    /** How many maintenance assets the work orders are read for. */
    assetText(master, units) {
      const n = this.assetNumbers(master, units).length;
      return n ? n + (n === 1 ? ' maintenance asset' : ' maintenance assets') + ' on this item and its units' : 'No maintenance asset on this item or its units';
    }

    // ── New EquipRite's Equipment detail (equipment-detail-page.js), unchanged ──────────────────────────────────

    formatNumber(value) {
      if (value == null || value === '') return '';
      const n = Number(value);
      if (isNaN(n)) return String(value);
      return n.toLocaleString();
    }

    // Tracking flags arrive from eqp-v1 as the strings 'Y'/'N'. A bare
    // truthiness check reported every master as tracked, because 'N' is
    // truthy. Compare explicitly.
    yesNo(value) {
      if (value == null || value === '') return '';
      if (value === true  || value === 'Y' || value === 'y') return 'Yes';
      if (value === false || value === 'N' || value === 'n') return 'No';
      return String(value);
    }

    /** Subclasses of one class, for the dialog's second dropdown. */
    subclassOptionsFor(allSubclassOptions, classId) {
      if (classId == null) return [];
      return (Array.isArray(allSubclassOptions) ? allSubclassOptions : [])
        .filter(o => o && Number(o.classId) === Number(classId));
    }

    /** True when an end date is set and already past. */
    isEndDated(effectiveEndDate, now) {
      if (!effectiveEndDate) return false;
      const t = Date.parse(effectiveEndDate);
      return !isNaN(t) && t < (now != null ? now : Date.now());
    }

    /**
     * May the dialog save? { ok, message }.
     * A class is required. A class that HAS subclasses requires one: whether
     * PATCH clears a field sent as null is unverified, so null is only sent
     * for a class with none (saveClassChangeChain also reads the result back).
     */
    canSaveClass(draft, masterRecord, subclassOptions) {
      const d = draft || {};
      const m = masterRecord || {};
      if (d.classId == null) return { ok: false, message: 'Choose a class.' };
      const subs = Array.isArray(subclassOptions) ? subclassOptions : [];
      if (subs.length && d.subclassId == null) {
        return { ok: false, message: 'This class has subclasses. Choose one.' };
      }
      const same = Number(d.classId) === Number(m.equipmentClassId) &&
        (d.subclassId == null ? m.equipmentSubclassId == null
                              : Number(d.subclassId) === Number(m.equipmentSubclassId));
      if (same) return { ok: false, message: 'That is the current class. Nothing to save.' };
      return { ok: true, message: '' };
    }

    filterAttachments(rows, category, status) {
      if (!Array.isArray(rows)) return [];
      return rows.filter(r =>
        (!category || category === 'ALL' || String(r.categoryId) === String(category)) &&
        (!status   || status   === 'ALL' || r.status === status));
    }

    attExpiredCount(rows) {
      return Array.isArray(rows) ? rows.filter(r => r.status === 'expired').length : 0;
    }

    /** SERIAL, LOT or INVENTORY from the master's own flags (the old RowClickChain's rule). */
    controlTypeOf(master) {
      if (master && master.isSerialControlled === 'Y') return 'SERIAL';
      if (master && master.isLotControlled === 'Y') return 'LOT';
      return 'INVENTORY';
    }

    controlLabel(controlType) {
      return CONTROL_LABEL[txt(controlType).toUpperCase()] || '';
    }

    /** The identifier column of a unit row for its control type. */
    unitId(row, controlType) {
      const c = txt(controlType).toUpperCase();
      if (!row) return '';
      if (c === 'LOT') return row.lotNumber || '';
      if (c === 'INVENTORY') return row.itemNumber || row.subinventoryCode || '';
      return row.serialNumber || '';
    }

    /** A unit's status: serial unitStatus, lot lotStatus, inventory itemStatus (the old page's three columns). */
    unitStatus(row) {
      return txt(row && (row.unitStatus || row.lotStatus || row.itemStatus || row.status));
    }

    /** Where a unit is: its EQR_LOCATION and current org (serial, lot), or its inventory org (quantity items). */
    unitWhere(row) {
      if (!row) return '';
      const parts = [row.locationName, row.currentOrgName || row.invOrgName, row.currentSubinventory || row.subinventoryCode];
      return parts.filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · ');
    }

    /** The dates the old tables showed for each kind: in service / received / last sync from Fusion. */
    unitDates(row, controlType) {
      const c = txt(controlType).toUpperCase();
      if (!row) return '';
      if (c === 'LOT') return [row.receivedDate && 'Received ' + this.formatDate(row.receivedDate), row.expiryDate && 'expires ' + this.formatDate(row.expiryDate)].filter(Boolean).join(', ');
      if (c === 'INVENTORY') return row.lastSyncDate ? 'Synced ' + this.formatDate(row.lastSyncDate) : '';
      return [row.inServiceDate && 'In service ' + this.formatDate(row.inServiceDate), row.retiredDate && 'retired ' + this.formatDate(row.retiredDate)].filter(Boolean).join(', ');
    }

    /** Units shown: free text over identifier, status, location, current org. */
    filterUnits(rows, text) {
      const q = txt(text).trim().toLowerCase();
      return (Array.isArray(rows) ? rows : []).filter((r) => !q || [r.serialNumber, r.lotNumber, r.itemNumber,
        this.unitStatus(r), r.locationName, r.currentOrgName, r.invOrgName, r.maintenanceAssetNumber, r.unitTagNumber]
        .some((v) => v && String(v).toLowerCase().includes(q)));
    }

    /** Quantity of a unit row: 1 for a serial, on hand for a lot or an inventory row. */
    unitQty(row, controlType) {
      const c = txt(controlType).toUpperCase();
      if (c === 'SERIAL') return '1';
      // EQR_LOT_REF / EQR_INVENTORY_ITEM_REF carry onHandQty (never "quantity": the old Quantity column read a
      // field that does not exist and showed blank).
      const q = row && row.onHandQty;
      return q == null ? '' : this.formatNumber(q) + (row.uomCode ? ' ' + row.uomCode : '');
    }

    /** "Caterpillar · 320 GC". */
    makerModel(m) {
      return [m && m.manufacturer, m && m.modelNumber].filter(Boolean).join(' · ');
    }

    /** Which Fusion modules track it: "Maintenance Yes · Fixed assets No · Inventory Yes". */
    trackedIn(m) {
      const r = m || {};
      const flags = [['Maintenance', r.isMaintenanceTracked], ['Fixed assets', r.isFixedAssetTracked], ['Inventory', r.isInventoryTracked]]
        .map((f) => [f[0], this.yesNo(f[1])]);
      const yes = flags.filter((f) => f[1] === 'Yes').map((f) => f[0]);
      if (yes.length) return yes.join(', ');
      return flags.some((f) => f[1]) ? 'None' : '—';
    }

    /** "Excavators · Crawler" for the master record. */
    classText(m) {
      return [m && m.equipmentClassName, m && m.equipmentSubclassName].filter(Boolean).join(' · ') || 'No class';
    }

    /**
     * What Change class will do, before the click: from what to what, and what follows. The units reference the
     * master, not the class, so they do not change; inherited expenditure types follow the new class.
     */
    classChangeText(draft, master, classOptions, subclassOptions) {
      const d = draft || {};
      const cls = (classOptions || []).find(o => o.value === d.classId);
      const sub = (subclassOptions || []).find(o => o.value === d.subclassId);
      const to = [cls && cls.label, sub && sub.label].filter(Boolean).join(' · ');
      if (!to) return '';
      return (master && master.equipmentNumber ? master.equipmentNumber : 'This item') + ' moves from '
        + this.classText(master) + ' to ' + to + '. Its units stay as they are; expenditure types it inherits from '
        + 'its class or subclass follow the new one.';
    }

    /** "Unreleased" from a Fusion work order (status words; ORA_ prefix dropped, title case). */
    woStatus(w) {
      const v = w && (w.WorkOrderStatus || w.WorkOrderStatusName || w.WorkOrderStatusCode || w.SystemStatus
        || w.SystemStatusCode || w.StatusCode || '');
      return txt(v).replace(/^ORA_/, '').replace(/_/g, ' ')
        .replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
    }

    isOpenWorkOrder(w) {
      return !WO_DONE.test(this.woStatus(w).toUpperCase().replace(/\s+/g, '_'));
    }

    /** Flatten { assetNumber: [workOrder] } into rows, open ones first, then by planned start. */
    workOrderRows(byAsset) {
      const out = [];
      Object.keys(byAsset || {}).forEach((asset) => (byAsset[asset] || []).forEach((w) => {
        out.push({
          key: asset + ':' + (w.WorkOrderNumber || w.WorkOrderId || out.length),
          number: w.WorkOrderNumber || '',
          asset: w.AssetNumber || asset,
          type: txt(w.WorkOrderType || w.WorkOrderTypeCode || '').replace(/^ORA_/, '').replace(/_/g, ' '),
          description: w.WorkOrderDescription || '',
          status: this.woStatus(w),
          open: this.isOpenWorkOrder(w),
          start: txt(w.PlannedStartDate).substring(0, 10),
          end: txt(w.PlannedCompletionDate).substring(0, 10),
        });
      }));
      return out.sort((a, b) => (a.open === b.open ? (b.start || '').localeCompare(a.start || '') : (a.open ? -1 : 1)));
    }

    /** Distinct maintenance asset numbers on the master and its units. */
    assetNumbers(master, units) {
      const seen = new Set();
      [master].concat(Array.isArray(units) ? units : []).forEach((r) => {
        if (r && r.maintenanceAssetNumber) seen.add(r.maintenanceAssetNumber);
      });
      return Array.from(seen);
    }

    /** Fusion work orders are read on entry only up to this many assets (two Fusion calls each). */
    autoWorkOrderAssets() {
      return AUTO_WO_ASSETS;
    }

    /** Documents with a validity: { expired, upcoming, valid } counts for the certificate light. */
    certSummary(rows) {
      const out = { expired: 0, upcoming: 0, valid: 0, total: 0 };
      (Array.isArray(rows) ? rows : []).forEach((r) => {
        if (r.status === 'expired' || r.status === 'upcoming' || r.status === 'valid') {
          out[r.status] += 1;
          out.total += 1;
        }
      });
      return out;
    }

    /** "Inherited from its subclass: A, B" / "Set on this equipment" / "None set". */
    expTypeText(level, inherited, ownCount) {
      if (Number(ownCount) > 0) return 'Set on this equipment';
      if (level === 'SUBCLASS' || level === 'CLASS') {
        return 'Inherited from its ' + level.toLowerCase() + (inherited ? ': ' + inherited : '');
      }
      return 'None set: a timesheet offers the project\'s full list';
    }

    /** One serial unit's page in Old EquipRite (project and task assignment, its own documents, cost). */
    oldUnitLink(oldAppUrl, equipmentId, unitId, controlType) {
      if (!oldAppUrl || !equipmentId || unitId == null) return '';
      const base = oldAppUrl.endsWith('/') ? oldAppUrl : oldAppUrl + '/';
      return base + 'vp/shell/equipment-foundation/equipment-unit-detail?equipmentId=' + encodeURIComponent(equipmentId)
        + '&serialRefId=' + encodeURIComponent(unitId) + '&controlType=' + encodeURIComponent(controlType || 'SERIAL');
    }

    /** "/vp/shell/equipment-foundation/equipment-units?equipmentId=…" in Old EquipRite, for what is still there. */
    oldUnitsLink(oldAppUrl, equipmentId, controlType) {
      if (!oldAppUrl || !equipmentId) return '';
      const base = oldAppUrl.endsWith('/') ? oldAppUrl : oldAppUrl + '/';
      return base + 'vp/shell/equipment-foundation/equipment-units?equipmentId=' + encodeURIComponent(equipmentId)
        + (controlType ? '&controlType=' + encodeURIComponent(controlType) : '');
    }
  }

  return PageModule;
});
