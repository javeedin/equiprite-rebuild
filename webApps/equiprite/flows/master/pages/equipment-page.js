define([], () => {
  'use strict';

  // Equipment (wireframe: Equipment master; FDD 7.2). The list of equipment definitions, as a grid or a map.
  //
  // Server filters, as the old Smart Search sent them to GET /equipment-master: q (number, name, serial, type,
  // manufacturer, location), equipmentClassId, equipmentSubclassId, assetGroupId. Every page of the answer is
  // loaded (loadEquipmentChain), so the status, tracking and source chips count what the server matched rather
  // than one page of it.
  //
  // The functions marked "old page module" are copied unchanged from
  // vbredwoodapp/flows/equipment-foundation/pages/equipment-master-page.js; the chains copied from that page call
  // them by the same names.

  const STATUS_LABELS = {
    ACTIVE: 'Active', INACTIVE: 'Inactive', AVAILABLE: 'Available', DEPLOYED: 'Deployed',
    MAINTENANCE: 'Maintenance', RETIRED: 'Retired',
  };
  // INACTIVE is a Fusion item whose ENABLED_FLAG is N (the import sets CATALOG_STATUS ACTIVE / INACTIVE); RETIRED
  // is the old manual value. Both read as "not in service" (the old list drew them with the same badge).
  const STATUS_TONE = { ACTIVE: 'ok', AVAILABLE: 'ok', DEPLOYED: 'busy', MAINTENANCE: 'warn', INACTIVE: 'off', RETIRED: 'off' };
  const TRACKING = [
    { key: 'SERIAL', label: 'Serial' },
    { key: 'LOT', label: 'Lot' },
    { key: 'INVENTORY', label: 'Quantity' },
  ];
  const MAP_W = 1000;
  const MAP_H = 460;
  const MAP_PAD = 60;

  const txt = (v) => (v == null ? '' : String(v));
  const statusOf = (r) => txt(r && r.catalogStatus).toUpperCase();

  class PageModule {
    // ── old page module (equipment-master-page.js), unchanged ──────────────────

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

    // ── this page ─────────────────────────────────────────────────────────────

    /**
     * The Sync button's label: the old menu item's rule (actionsFor): "Syncing from Fusion… (step)" while a Sync
     * runs, else "Sync from Fusion".
     */
    syncLabel(isSyncing, syncStep) {
      return isSyncing ? 'Syncing from Fusion…' + (syncStep ? ' (' + syncStep + ')' : '') : 'Sync from Fusion';
    }

    /** SERIAL, LOT or INVENTORY: the old RowClickChain's rule on the master's control flags. */
    trackingOf(row) {
      if (row && row.isSerialControlled === 'Y') return 'SERIAL';
      if (row && row.isLotControlled === 'Y') return 'LOT';
      return 'INVENTORY';
    }

    trackingLabel(row) {
      const t = this.trackingOf(row);
      return (TRACKING.find((x) => x.key === t) || {}).label || '';
    }

    statusLabel(code) {
      const c = txt(code).toUpperCase();
      if (!c) return 'No status';
      return STATUS_LABELS[c] || (c.charAt(0) + c.slice(1).toLowerCase()).replace(/_/g, ' ');
    }

    statusClass(code) {
      return 'er-eqs er-eqs--' + (STATUS_TONE[txt(code).toUpperCase()] || 'none');
    }

    /** Status chips with counts, All first, then the statuses present (most common first). */
    statusChips(rows) {
      const list = Array.isArray(rows) ? rows : [];
      const counts = {};
      list.forEach((r) => { const s = statusOf(r) || 'NONE'; counts[s] = (counts[s] || 0) + 1; });
      return [{ key: 'all', label: 'All', count: list.length }].concat(Object.keys(counts)
        .sort((a, b) => counts[b] - counts[a] || a.localeCompare(b))
        .map((s) => ({ key: s, label: s === 'NONE' ? 'No status' : this.statusLabel(s), count: counts[s] })));
    }

    /** Tracking chips (serial / lot / quantity) with counts; only the kinds present. */
    trackingChips(rows) {
      const list = Array.isArray(rows) ? rows : [];
      const counts = {};
      list.forEach((r) => { const t = this.trackingOf(r); counts[t] = (counts[t] || 0) + 1; });
      return TRACKING.filter((t) => counts[t.key]).map((t) => ({ key: t.key, label: t.label, count: counts[t.key] }));
    }

    /** Source chips (Fusion / Manual) with counts; only the sources present. */
    sourceChips(rows) {
      const list = Array.isArray(rows) ? rows : [];
      const counts = {};
      list.forEach((r) => { const s = this.recordSourceLabel(r && r.createdBy); counts[s] = (counts[s] || 0) + 1; });
      return ['Fusion', 'Manual'].filter((s) => counts[s]).map((s) => ({ key: s, label: s, count: counts[s] }));
    }

    /** The rows shown: the client chips over what the server matched, plus the map's picked location. */
    filterRows(rows, status, tracking, source, locationId) {
      return (Array.isArray(rows) ? rows : []).filter((r) => {
        if (status && status !== 'all' && (statusOf(r) || 'NONE') !== status) return false;
        if (tracking && this.trackingOf(r) !== tracking) return false;
        if (source && this.recordSourceLabel(r.createdBy) !== source) return false;
        if (locationId !== undefined && locationId !== null && locationId !== '') {
          const loc = r.currentLocationId != null ? String(r.currentLocationId) : 'none';
          if (loc !== String(locationId)) return false;
        }
        return true;
      });
    }

    /** Subclasses of one class for the subclass chips (all of them while no class is picked). */
    subclassChoices(subclassOptions, classId) {
      const all = Array.isArray(subclassOptions) ? subclassOptions : [];
      if (classId == null || classId === '') return [];
      return all.filter((s) => s && Number(s.classId) === Number(classId));
    }

    /** The class and subclass under the name: "Excavators · Crawler". */
    classText(row, classesById, subclassesById) {
      return [this.classNameFor(row && row.equipmentClassId, classesById),
        this.subclassNameFor(row && row.equipmentSubclassId, subclassesById)].filter(Boolean).join(' · ');
    }

    /**
     * Columns. oj-table sizes from width / minWidth; Status, Stock and Source are not sortable on the server, so
     * every column is sorted in the browser over the rows already loaded.
     */
    columns() {
      return [
        { headerText: 'Equipment', field: 'equipmentName', template: 'nameTpl', sortable: 'enabled', minWidth: 230 },
        { headerText: 'Class · subclass', field: 'equipmentClassId', template: 'classTpl', sortable: 'disabled', minWidth: 170 },
        { headerText: 'Type', field: 'equipmentType', sortable: 'enabled', width: 120 },
        { headerText: 'Manufacturer', field: 'manufacturer', sortable: 'enabled', width: 160 },
        { headerText: 'Tracking', field: 'isSerialControlled', template: 'trackTpl', sortable: 'disabled', width: 100 },
        { headerText: 'Stock', field: 'onHandQty', template: 'stockTpl', sortable: 'disabled', width: 120 },
        { headerText: 'Status', field: 'catalogStatus', template: 'statusTpl', sortable: 'enabled', width: 110 },
        { headerText: 'Source', field: 'createdBy', template: 'sourceTpl', sortable: 'disabled', width: 100 },
      ];
    }

    /** "412 items", "38 of 412 items" when a chip narrows them, "Loading 200 of 412…" while pages arrive. */
    countText(shown, loaded, total, loading) {
      const t = Number(total) || 0;
      const l = Number(loaded) || 0;
      const s = Number(shown) || 0;
      if (loading && t > l) return 'Loading ' + l.toLocaleString() + ' of ' + t.toLocaleString() + '…';
      if (loading && !l) return 'Loading…';
      const all = Math.max(t, l);
      const noun = all === 1 ? ' item' : ' items';
      return s === all ? all.toLocaleString() + noun : s.toLocaleString() + ' of ' + all.toLocaleString() + noun;
    }

    /**
     * The map: one bubble per EQR_LOCATION (latitude / longitude from GET /locations) sized by how many of the
     * listed items sit there (their currentLocationId). An equirectangular projection fitted to the points, so
     * the bubbles keep their real relative positions without a tile server. Items with no location, or a
     * location without coordinates, are counted in `unplaced`.
     *
     * @returns {{ points: Array, unplaced: number, placed: number }}
     */
    mapPoints(rows, locations) {
      const byId = {};
      (Array.isArray(locations) ? locations : []).forEach((l) => {
        const lat = Number(l && l.latitude);
        const lon = Number(l && l.longitude);
        if (l && l.id != null && l.latitude != null && l.longitude != null && !isNaN(lat) && !isNaN(lon)) {
          byId[String(l.id)] = { id: String(l.id), name: l.locationName || l.locationCode || ('Location ' + l.id), lat, lon };
        }
      });
      const counts = {};
      let unplaced = 0;
      (Array.isArray(rows) ? rows : []).forEach((r) => {
        const id = r && r.currentLocationId != null ? String(r.currentLocationId) : '';
        if (id && byId[id]) { counts[id] = (counts[id] || 0) + 1; } else { unplaced += 1; }
      });
      const ids = Object.keys(counts);
      if (!ids.length) return { points: [], unplaced, placed: 0 };
      const lats = ids.map((i) => byId[i].lat);
      const lons = ids.map((i) => byId[i].lon);
      const minLat = Math.min(...lats); const maxLat = Math.max(...lats);
      const minLon = Math.min(...lons); const maxLon = Math.max(...lons);
      const spanLat = maxLat - minLat || 1;
      const spanLon = maxLon - minLon || 1;
      const max = Math.max(...ids.map((i) => counts[i]));
      const points = ids.map((i) => {
        const p = byId[i];
        const x = maxLon === minLon ? MAP_W / 2 : MAP_PAD + ((p.lon - minLon) / spanLon) * (MAP_W - 2 * MAP_PAD);
        const y = maxLat === minLat ? MAP_H / 2 : MAP_PAD + ((maxLat - p.lat) / spanLat) * (MAP_H - 2 * MAP_PAD);
        return {
          id: p.id, name: p.name, count: counts[i],
          x: Math.round(x), y: Math.round(y),
          r: Math.round(10 + 22 * Math.sqrt(counts[i] / max)),
          label: p.name + ' · ' + counts[i],
        };
      }).sort((a, b) => b.count - a.count);
      return { points, unplaced, placed: rows.length - unplaced };
    }

    mapViewBox() {
      return '0 0 ' + MAP_W + ' ' + MAP_H;
    }

    /**
     * True when two row lists hold the same records in the same order (same id and the same object, so a
     * reload that brings fresh objects still counts as a change and the grid shows the new values).
     */
    sameRows(a, b) {
      if (a === b) return true;
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
      }
      return true;
    }

    /** Where a bubble sits on the map, as a style object (JET's :style takes an object, not a CSS string). */
    dotStyle(p) {
      const d = p || {};
      return {
        left: ((Number(d.x) || 0) / MAP_W * 100).toFixed(2) + '%',
        top: ((Number(d.y) || 0) / MAP_H * 100).toFixed(2) + '%',
        width: (2 * (Number(d.r) || 0)) + 'px',
        height: (2 * (Number(d.r) || 0)) + 'px',
      };
    }

    /** "28 Oct 22:00" from an ISO timestamp, '' when there is none. */
    when(v) {
      const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(txt(v));
      if (!m) return '';
      const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return Number(m[3]) + ' ' + MON[Number(m[2]) - 1] + ' ' + m[1] + (m[4] ? ' ' + m[4] + ':' + m[5] : '');
    }
  }

  return PageModule;
});
