define([], () => {
  'use strict';

  // Equipment detail (wireframe: Equipment detail; FDD 7.2.5). One equipment definition: what it is, its units,
  // its documents and certificates, its expenditure types and open Fusion work orders, and Change class.
  // Replaces equipment-units (the page a row of the old Equipment Master opened). The functions under "old page
  // module" are copied from vbredwoodapp/flows/equipment-foundation/pages/equipment-units-page.js with their logic
  // unchanged; the badge classes carry this app's er- prefix.

  const STATUS_BUCKET = {
    AVAILABLE: 'good', ACTIVE: 'good',
    RETIRED: 'blocked', LOST: 'blocked', EXPIRED: 'blocked', RECALLED: 'blocked', REJECTED: 'blocked',
    RENTED: 'progress', RESERVED: 'progress', IN_MAINTENANCE: 'progress', IN_TRANSIT: 'progress',
    RETURN_INITIATED: 'progress', IN_SERVICE: 'progress', MAINTENANCE: 'progress',
  };
  // A work order no longer holds the equipment once it reaches one of these (Fusion system statuses, as words
  // after the ORA_ prefix is dropped).
  const WO_DONE = /^(COMPLETED|COMPLETE|CLOSED|CANCELED|CANCELLED|RESOLVED)$/;
  const CONTROL_LABEL = { SERIAL: 'Serial-controlled', LOT: 'Lot-controlled', INVENTORY: 'Quantity (on hand)' };
  const AUTO_WO_ASSETS = 25;

  const txt = (v) => (v == null ? '' : String(v));

  class PageModule {
    // ── old page module (equipment-units-page.js), unchanged ──────────────────

    formatDate(value) {
      if (!value) return '';
      const s = String(value).substring(0, 10);
      const parts = s.split('-');
      if (parts.length !== 3) return s;
      const year  = parts[0];
      const month = parseInt(parts[1], 10);
      const day   = parseInt(parts[2], 10);
      if (isNaN(month) || isNaN(day)) return s;
      return month + '/' + day + '/' + year;
    }

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

    badgeClass(status) {
      const bucket = STATUS_BUCKET[String(status || '').toUpperCase()] || 'neutral';
      return 'er-unit-badge er-unit-badge--' + bucket;
    }

    badgeLabel(status) {
      if (!status) return '';
      return String(status).replace(/_/g, ' ');
    }

    filterAttachments(rows, category, status) {
      if (!Array.isArray(rows)) return [];
      return rows.filter(r =>
        (!category || category === 'ALL' || String(r.categoryId) === String(category)) &&
        (!status   || status   === 'ALL' || r.status === status));
    }

    attStatusClass(status) {
      const bucket = { valid: 'good', expired: 'blocked', upcoming: 'progress' }[status] || 'neutral';
      return 'er-unit-badge er-unit-badge--' + bucket;
    }

    attExpiredCount(rows) {
      return Array.isArray(rows) ? rows.filter(r => r.status === 'expired').length : 0;
    }

    // ── this page ─────────────────────────────────────────────────────────────

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

    /** Unit status counts: [{ key, label, count, cls }], most common first. */
    unitSummary(rows) {
      const counts = {};
      (Array.isArray(rows) ? rows : []).forEach((r) => {
        const s = this.unitStatus(r).toUpperCase() || 'UNKNOWN';
        counts[s] = (counts[s] || 0) + 1;
      });
      return Object.keys(counts).sort((a, b) => counts[b] - counts[a])
        .map((s) => ({ key: s, label: this.badgeLabel(s), count: counts[s], cls: this.badgeClass(s) }));
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

    /** The light in the band: worst first. */
    certLight(rows) {
      const s = this.certSummary(rows);
      if (s.expired) return { cls: 'er-light er-light--bad', text: s.expired + (s.expired === 1 ? ' certificate expired' : ' certificates expired') };
      if (s.upcoming) return { cls: 'er-light er-light--warn', text: s.upcoming + ' not yet valid' };
      if (s.valid) return { cls: 'er-light er-light--ok', text: 'Certificates valid' };
      return { cls: 'er-light er-light--none', text: 'No certificates on file' };
    }

    woLight(rows, loaded) {
      if (!loaded) return { cls: 'er-light er-light--none', text: 'Work orders not checked' };
      const open = (Array.isArray(rows) ? rows : []).filter((r) => r.open).length;
      return open
        ? { cls: 'er-light er-light--warn', text: open + (open === 1 ? ' open work order' : ' open work orders') }
        : { cls: 'er-light er-light--ok', text: 'No open work orders' };
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
