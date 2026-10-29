/*
 * Equipment schedule (FDD 7.10, wireframe Schedule). Replaces Old EquipRite's main/equipment-schedule page.
 *
 * Same data as the old page: loadScheduleChain makes initSchedulerChain's calls, and buildResourcesAndEvents below
 * is the old page's builder, carried over (changes marked NEW). Like the old page it is READ ONLY: the old Scheduler
 * had drag, resize, edit, create, the schedule menu and the event menu's edit items switched off, and no chain on it
 * writes. A booking's dates and its unit are changed on the request line (Old EquipRite's line-detail page, where
 * saveLineChain writes), so every booking and every conflict links there.
 *
 * Pure functions first (tests/schedule.test.js), then the two views: the Bryntum Scheduler Gantt and the Mapbox map.
 * Both libraries are loaded lazily through requirejs (paths `schedulerPro` and `mapboxgl` in app-flow.json, files
 * copied unchanged from Old EquipRite), so the page renders at once and, when a library cannot load, keeps showing
 * the same data as a readable list.
 */
define(['require'], (require) => {
  'use strict';

  // ── Carried over from the old page ─────────────────────────────────────────────────────────────────────────────
  // The public token and the opening view (Houston metro, "most fleet activity is in the Houston area").
  const MAPBOX_TOKEN = 'pk.eyJ1IjoicmFodWxqYW1hbGFwdXJhbSIsImEiOiJjbXNkYngyeDcwNGN4MzVwdmRkMHRmN2ppIn0.P7EFTLmcAsXXammLSgF3Qw';
  const MAP_VIEW = { lat: 29.7604, lon: -95.3698, zoom: 9 };
  const MAP_STYLES = {
    streets: 'mapbox://styles/mapbox/streets-v11',
    dark: 'mapbox://styles/mapbox/dark-v11',
    satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
  };
  // Pins that share a spot are spread on a ring of this radius (about 10 m), so each stays clickable.
  const RING_DEG = 0.00009;
  const DAY_MS = 86400000;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
    'November', 'December'];

  // Bar kinds. WHICH allocStatus is which is the old page's (_eventColorFor and its bar names): ALLOCATED "Booked",
  // PENDING / IN_PROCESS "Reserved", MOBILIZATION, REJECTED / CANCELLED greyed, MAINTENANCE for Fusion work orders,
  // anything else a booking under its raw status. The LOOK is the wireframe's and FDD S32's: hard reserve dark blue,
  // soft reserve light blue, maintenance hatched, conflicts outlined red. `holds`: the bar keeps the unit busy, so
  // two of them on one unit at once are a conflict (a cancelled booking holds nothing).
  const KINDS = {
    hard: { label: 'Hard reserve', hint: 'Allocated', color: '#1565c0', holds: true },
    soft: { label: 'Soft reserve', hint: 'Pending or in process', color: '#90caf9', holds: true },
    mobilization: { label: 'Mobilization', hint: 'Moving to site', color: '#2e7d32', holds: true },
    maintenance: { label: 'Maintenance block', hint: 'Planned work order', color: '#f59e0b', holds: true },
    other: { label: 'Other booking', hint: 'Any other allocation status', color: '#0f766e', holds: true },
    cancelled: { label: 'Cancelled or rejected', hint: 'Holds nothing', color: '#cbd5e1', holds: false },
  };
  const KIND_ORDER = ['hard', 'soft', 'mobilization', 'maintenance', 'other', 'cancelled'];

  // Unit status for the row dot and the map pin. deployed / reserved / available are the old page's rule (any
  // ALLOCATED booking, else any PENDING / IN_PROCESS one); NEW: a planned work order covering today wins.
  const UNIT_STATUS = {
    maintenance: { label: 'In maintenance today', color: '#ea580c' },
    deployed: { label: 'Deployed', color: '#1565c0' },
    reserved: { label: 'Reserved', color: '#1565c0' },
    available: { label: 'Available', color: '#16a34a' },
  };

  const SCALES = {
    day: { base: 'dayAndMonth', tickWidth: 34 },
    week: { base: 'weekAndMonth', tickWidth: 84 },
    month: { base: 'monthAndYear', tickWidth: 120 },
  };

  const NO_CLASS = 'No class';
  const NO_YARD = 'No location';

  // ── Small helpers ──────────────────────────────────────────────────────────────────────────────────────────────

  const pad = (n) => (n < 10 ? '0' : '') + n;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
  const words = (t) => String(t || '').toLowerCase().split(/\s+/).filter((w) => w);
  const asSet = (a) => new Set(Array.isArray(a) ? a : []);
  const cmp = (a, b) => (a < b ? -1 : (a > b ? 1 : 0));

  /** 'YYYY-MM-DD' of a timestamp, an ISO string or a Date: the first ten characters, as the old builder took them. */
  function day10(v) {
    return v ? String(v).substring(0, 10) : null;
  }

  /** Bar length in days, both ends counted, at least one: the old builder's formula. */
  function spanDays(s10, e10) {
    return (s10 && e10)
      ? Math.max(1, Math.round(Math.abs(new Date(e10) - new Date(s10)) / DAY_MS) + 1)
      : 1;
  }

  /** 'YYYY-MM-DD' plus n days (calendar arithmetic on the date itself, no time zone involved). */
  function addDays(s10, n) {
    const d = new Date(String(s10) + 'T00:00:00Z');
    if (isNaN(d)) {
      return s10;
    }
    d.setUTCDate(d.getUTCDate() + (n || 0));
    return d.toISOString().substring(0, 10);
  }

  /** Today as 'YYYY-MM-DD' in the browser's time zone. */
  function todayKey(now) {
    const d = now ? new Date(now) : new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function barKind(allocStatus) {
    const s = String(allocStatus || '').toUpperCase();
    if (s === 'ALLOCATED') { return 'hard'; }
    if (s === 'PENDING' || s === 'IN_PROCESS') { return 'soft'; }
    if (s === 'MOBILIZATION') { return 'mobilization'; }
    if (s === 'MAINTENANCE') { return 'maintenance'; }
    if (s === 'REJECTED' || s === 'CANCELLED') { return 'cancelled'; }
    return 'other';
  }

  /** The old page's bar name for an allocation status ('Booked', 'Reserved', 'Mobilization', or the raw status). */
  function displayName(allocStatus) {
    const raw = String(allocStatus || '').toUpperCase();
    if (raw === 'ALLOCATED') { return 'Booked'; }
    if (raw === 'PENDING' || raw === 'IN_PROCESS') { return 'Reserved'; }
    if (raw === 'MOBILIZATION') { return 'Mobilization'; }
    return allocStatus || 'BOOKED';
  }

  // ── The page module ────────────────────────────────────────────────────────────────────────────────────────────

  class PageModule {
    constructor(context) {
      this._eventHelper = (context && typeof context.getEventHelper === 'function') ? context.getEventHelper() : null;
      this._gantt = null;
      this._ganttLib = null;
      this._map = null;
      this._mapLib = null;
      this._model = null;
      this._eventsById = {};
      this._unitsById = {};
      this._visible = null;
      this._projects = null;
      this._eventMarkers = [];
      this._unitMarkers = new Map();
      this._markerByEvent = {};
      this._openPopup = null;
      this._focusedUnit = null;
      this._month = '';
      this._monthTimer = null;
    }

    // ── Dates ────────────────────────────────────────────────────────────────────────────────────────────────────

    day10(v) { return day10(v); }
    spanDays(s10, e10) { return spanDays(s10, e10); }
    addDays(s10, n) { return addDays(s10, n); }
    todayKey(now) { return todayKey(now); }

    /** Last day of a bar that starts on s10 and lasts `duration` days. */
    lastDay(s10, duration) {
      return addDays(s10, Math.max(1, duration || 1) - 1);
    }

    /**
     * '02 Nov 2026', read from the date itself. (The old setDateFormat went through new Date() and local getters,
     * which put every label a day early west of UTC, Houston included.)
     */
    fmtDay(s10) {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s10 || ''));
      return m ? m[3] + ' ' + MON[Number(m[2]) - 1] + ' ' + m[1] : '';
    }

    /** '2 – 27 Nov 2026', '28 Nov – 4 Dec 2026', '20 Dec 2026 – 3 Jan 2027'. */
    dateRange(a, b) {
      const p = (v) => {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
        return m ? { y: m[1], m: Number(m[2]) - 1, d: Number(m[3]) } : null;
      };
      const x = p(a);
      const y = p(b);
      if (!x) { return y ? `${y.d} ${MON[y.m]} ${y.y}` : ''; }
      if (!y || (x.y === y.y && x.m === y.m && x.d === y.d)) { return `${x.d} ${MON[x.m]} ${x.y}`; }
      if (x.y !== y.y) { return `${x.d} ${MON[x.m]} ${x.y} – ${y.d} ${MON[y.m]} ${y.y}`; }
      if (x.m !== y.m) { return `${x.d} ${MON[x.m]} – ${y.d} ${MON[y.m]} ${y.y}`; }
      return `${x.d} – ${y.d} ${MON[y.m]} ${y.y}`;
    }

    /** 'YYYY-MM' of a day or a Date. */
    monthKey(v) {
      if (v instanceof Date) {
        return v.getFullYear() + '-' + pad(v.getMonth() + 1);
      }
      return String(v || '').substring(0, 7);
    }

    /** 'YYYY-MM' moved by n months. */
    addMonths(month, n) {
      const m = /^(\d{4})-(\d{2})/.exec(String(month || ''));
      if (!m) { return month; }
      const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + (n || 0);
      return Math.floor(total / 12) + '-' + pad((total % 12) + 1);
    }

    /** 'November 2026'. */
    monthLabel(month) {
      const m = /^(\d{4})-(\d{2})/.exec(String(month || ''));
      return m ? MONTH[Number(m[2]) - 1] + ' ' + m[1] : '';
    }

    /**
     * The day to put at the left edge for a month: its 1st, except this month, where it is a week before today (the
     * old page opened on today so the work ahead is in view; a week back keeps what is running in sight too).
     */
    leftDay(month, today) {
      const first = String(month || '').substring(0, 7) + '-01';
      const t = today || todayKey();
      if (this.monthKey(t) !== String(month || '').substring(0, 7)) { return first; }
      const weekBack = addDays(t, -7);
      return weekBack > first ? weekBack : first;
    }

    /** 'HOU-Y1 · Houston Yard', 'HOU-Y1', 'Houston Yard' or 'No location'. */
    yardLabel(code, name) {
      if (code) { return name && name !== code ? code + ' · ' + name : code; }
      return name || NO_YARD;
    }

    // ── Bars ─────────────────────────────────────────────────────────────────────────────────────────────────────

    barKind(allocStatus) { return barKind(allocStatus); }
    displayName(allocStatus) { return displayName(allocStatus); }

    /** Holds the unit (two at once are a conflict)? */
    holdsUnit(kind) {
      return !!(KINDS[kind] && KINDS[kind].holds);
    }

    /**
     * CSS classes of a bar: its kind, the red conflict outline, and dimmed when a project filter is on and the bar
     * belongs to another project (maintenance is never dimmed: it is the unit's, not a project's).
     */
    barClasses(ev, projects) {
      const out = ['er-sch-bar', 'er-sch-bar--' + (KINDS[ev && ev.kind] ? ev.kind : 'other')];
      if (ev && ev.conflict) {
        out.push('er-sch-bar--conflict');
      }
      const p = projects instanceof Set ? projects : asSet(projects);
      if (ev && p.size && ev.kind !== 'maintenance' && !p.has(ev.projectName || '')) {
        out.push('er-sch-bar--dim');
      }
      return out;
    }

    /** Text on a bar: 'REQ-10530 · Pipeline North', 'Maintenance · WO-55821', or the old bar name. */
    barLabel(ev) {
      if (!ev) { return ''; }
      if (ev.kind === 'maintenance') {
        return 'Maintenance' + (ev.workOrderNumber ? ' · ' + ev.workOrderNumber : '');
      }
      const parts = [ev.requestNumber, ev.projectName].filter((x) => x);
      return parts.length ? parts.join(' · ') : (ev.name || '');
    }

    /** Legend entries, in the order the wireframe lists them, plus the conflict outline and the today line. */
    legend() {
      return KIND_ORDER.map((k) => ({ key: k, label: KINDS[k].label, hint: KINDS[k].hint, cls: 'er-sch-swatch er-sch-swatch--' + k }))
        .concat([
          { key: 'conflict', label: 'Conflict', hint: 'Two bookings, or a booking and maintenance, at once', cls: 'er-sch-swatch er-sch-swatch--conflict' },
          { key: 'today', label: 'Today', hint: '', cls: 'er-sch-swatch er-sch-swatch--today' },
        ]);
    }

    /** Map legend: what a pin's colour says (er-sch-pin-key--<key> in fulfil.css). */
    mapLegend() {
      return [
        { key: 'available', label: 'Available' },
        { key: 'deployed', label: 'Deployed or reserved' },
        { key: 'maintenance', label: 'In maintenance today' },
        { key: 'site', label: 'Booking site, current or upcoming' },
      ];
    }

    unitStatusLabel(status) {
      return (UNIT_STATUS[status] || UNIT_STATUS.available).label;
    }

    unitStatusColor(status) {
      return (UNIT_STATUS[status] || UNIT_STATUS.available).color;
    }

    /** Bryntum view preset for the Day / Week / Month scale. */
    presetFor(scale) {
      return Object.assign({}, SCALES[scale] || SCALES.week);
    }

    /**
     * Gantt features. Read only, as the old page: no drag, resize, edit, drag-create, schedule menu or event menu.
     * Grouped by class (the wireframe's class headings, classes with conflicts first), with the today line.
     */
    ganttFeatures(tooltip, groupRenderer) {
      return {
        eventDrag: false,
        eventResize: false,
        eventEdit: false,
        eventDragCreate: false,
        scheduleMenu: false,
        eventMenu: false,
        cellEdit: false,
        filterBar: false,
        group: { field: 'group_key', renderer: groupRenderer || null },
        timeRanges: { showCurrentTimeLine: { name: 'Today' } },
        // A white Redwood card instead of Bryntum's grey tip (fulfil.css .er-sch-tooltip).
        eventTooltip: { template: tooltip || null, cls: 'er-sch-tooltip' },
      };
    }

    // ── The data: the old page's builder ─────────────────────────────────────────────────────────────────────────

    /**
     * One resource per serial-ref, its bookings from workbench-lines (joined on allocatedSerial) and its planned
     * maintenance from Fusion work orders. Carried over from equipment-schedule-page.js buildResourcesAndEvents:
     * the same joins, fallbacks, durations, jittered map positions and window. NEW fields, all read from the same
     * rows, are marked; the bar colour now comes from the kind (CSS), not an inline eventColor.
     *
     * @param {string} [today] 'YYYY-MM-DD'; defaults to the browser's today (tests pass one)
     * @returns {{resources, events, startDate: Date, endDate: Date, windowStart: string, windowEnd: string}}
     */
    buildResourcesAndEvents(serials, classes, lines, locationsById, siteByRequestId, masterById, workOrdersByAsset, today) {
      const locByLocId = locationsById || {};
      const siteByReq = siteByRequestId || {};
      const mastersById = masterById || {};
      const eventsByLatLngKey = new Map();
      const classNameById = new Map();
      (classes || []).forEach((c) => {
        if (c && c.id != null) { classNameById.set(c.id, c.className || ''); }
      });

      const linesBySerial = new Map();
      (lines || []).forEach((l) => {
        if (!l) { return; }
        const key = l.allocatedSerial;
        if (!key) { return; }
        if (!linesBySerial.has(key)) { linesBySerial.set(key, []); }
        linesBySerial.get(key).push(l);
      });

      const resources = [];
      const events = [];
      let eventSeq = 1;
      let minStart = null;

      (serials || []).forEach((s, idx) => {
        // EQR_SERIAL_REF carries serialNumber (see the old builder's note on unitIdentifier).
        if (!s || !s.serialNumber) { return; }
        const serialNumber = s.serialNumber;
        const matchingLines = linesBySerial.get(serialNumber) || [];

        // Serial-ref wins; equipment-master fills the gaps.
        const eqId = s.equipmentId != null ? Number(s.equipmentId) : null;
        const master = eqId != null ? mastersById[eqId] : null;
        const eqName = s.equipmentName || (master && master.equipmentName) || '';
        const eqClassId = s.equipmentClassId != null
          ? s.equipmentClassId
          : (master && master.equipmentClassId != null ? master.equipmentClassId : null);
        const className = eqClassId != null ? (classNameById.get(eqClassId) || '') : '';
        const eqType = s.equipmentType || (master && master.equipmentType) || '';
        const manufacturer = s.manufacturer || (master && master.manufacturer) || '';
        const mfgYear = s.mfgYear != null ? s.mfgYear : (master && master.mfgYear != null ? master.mfgYear : null);

        const bookingLocation = matchingLines.map((l) => l.deploymentLocation).filter(Boolean).slice(-1)[0];
        const locId = s.currentLocationId != null ? Number(s.currentLocationId) : null;
        const resolvedLoc = (locId != null) ? locByLocId[locId] : null;

        const resourceId = idx + 1;
        const location = (resolvedLoc && resolvedLoc.locationName) || bookingLocation || '';
        const locationCode = (resolvedLoc && resolvedLoc.locationCode) || '';
        resources.push({
          id: resourceId,
          name: serialNumber,
          serial_number: serialNumber,
          equipment_id: s.equipmentId || '',
          equipment_name: eqName,
          equipment_class: className,
          equipment_subclass: '',
          equipment_type: eqType,
          status: 'available',
          owner_type: eqType,
          manufacturer,
          model_year: mfgYear,
          fa_asset_number: s.faAssetRefId || '',
          location,
          location_code: locationCode,
          owning_org: s.orgId || '',
          uom: '',
          acquisition_cost: null,
          latitude: resolvedLoc && resolvedLoc.latitude != null ? resolvedLoc.latitude : null,
          longitude: resolvedLoc && resolvedLoc.longitude != null ? resolvedLoc.longitude : null,
          // NEW: the yard filter's key and label: the unit's current location only (the old map popup called its
          // code the "Yard"); a booking's free-text deployment location is not a yard.
          yard_key: locationCode || (resolvedLoc && resolvedLoc.locationName) || '',
          yard_label: this.yardLabel(locationCode, resolvedLoc && resolvedLoc.locationName),
        });

        matchingLines.forEach((l) => {
          const s10 = l.requestedStartDate ? String(l.requestedStartDate).substring(0, 10) : null;
          const e10 = l.requestedEndDate ? String(l.requestedEndDate).substring(0, 10) : null;
          if (!s10) { return; }
          const dur = spanDays(s10, e10);
          const startDt = new Date(s10);
          if (!minStart || startDt < minStart) { minStart = startDt; }
          const rawStatus = (l.allocStatus || '').toUpperCase();

          // The request's ship-to-site for the booking's map pin, jittered on a ring when several share a site.
          const reqId = l.eqrEquipmentRequestId != null ? Number(l.eqrEquipmentRequestId) : null;
          const site = reqId != null ? siteByReq[reqId] : null;
          let evtLat = null;
          let evtLon = null;
          if (site && site.latitude != null && site.longitude != null) {
            const baseLat = Number(site.latitude);
            const baseLon = Number(site.longitude);
            const key = baseLat.toFixed(4) + ',' + baseLon.toFixed(4);
            const n = eventsByLatLngKey.get(key) || 0;
            eventsByLatLngKey.set(key, n + 1);
            if (n === 0) {
              evtLat = baseLat;
              evtLon = baseLon;
            } else {
              const angle = (2 * Math.PI * n) / 12;
              evtLat = baseLat + RING_DEG * Math.cos(angle);
              evtLon = baseLon + RING_DEG * Math.sin(angle);
            }
          }

          events.push({
            id: eventSeq++,
            resourceId,
            name: displayName(l.allocStatus),
            allocStatus: rawStatus,
            projectName: l.projectName || '',
            taskName: l.taskName || '',
            shortAddress: (site && (site.siteName || site.address)) || l.deploymentLocation || '',
            lblStartDate: this.fmtDay(s10),
            lblEndDate: e10 ? this.fmtDay(e10) : '—',
            startDate: s10,
            duration: dur,
            address: { lat: evtLat, lon: evtLon },
            // NEW, from the same workbench-lines row: kind, last day, and what a person needs to act on it.
            kind: barKind(rawStatus),
            startDay: s10,
            endDay: this.lastDay(s10, dur),
            requestNumber: l.requestNumber || '',
            requestorName: l.requestorName || '',
            requestStatus: l.requestStatus || '',
            lineNumber: l.lineNumber != null ? l.lineNumber : null,
            lineId: l.eqrRequestLineId != null ? l.eqrRequestLineId : null,
            requestId: reqId,
            equipmentMasterId: l.eqrEquipmentMasterId != null ? l.eqrEquipmentMasterId : (s.equipmentId != null ? s.equipmentId : null),
          });
        });

        // Planned maintenance: one bar per Fusion work order on the serial's maintenance asset, PlannedStartDate to
        // PlannedCompletionDate; no planned start, no bar (an unscheduled work order has no place on a timeline).
        const woList = (workOrdersByAsset && s.maintenanceAssetNumber)
          ? (workOrdersByAsset[s.maintenanceAssetNumber] || [])
          : [];
        woList.forEach((w) => {
          const ws10 = w.PlannedStartDate ? String(w.PlannedStartDate).substring(0, 10) : null;
          if (!ws10) { return; }
          const we10 = w.PlannedCompletionDate ? String(w.PlannedCompletionDate).substring(0, 10) : null;
          const wDur = spanDays(ws10, we10);
          const wStartDt = new Date(ws10);
          if (!minStart || wStartDt < minStart) { minStart = wStartDt; }
          events.push({
            id: eventSeq++,
            resourceId,
            name: 'Maintenance',
            allocStatus: 'MAINTENANCE',
            workOrderNumber: w.WorkOrderNumber || '',
            projectName: w.WorkOrderType || 'Maintenance',
            taskName: w.WorkOrderDescription || w.WorkOrderStatus || '',
            shortAddress: w.AssetNumber || '',
            lblStartDate: this.fmtDay(ws10),
            lblEndDate: we10 ? this.fmtDay(we10) : '—',
            startDate: ws10,
            duration: wDur,
            // No map pin: a work order is against the asset, not a ship-to site.
            address: { lat: null, lon: null },
            kind: 'maintenance',
            startDay: ws10,
            endDay: this.lastDay(ws10, wDur),
            workOrderStatus: w.WorkOrderStatus || '',
          });
        });
      });

      // Row dot: deployed when the unit has an ALLOCATED booking, reserved when it has a PENDING / IN_PROCESS one.
      const allocated = new Set(events.filter((ev) => ev.allocStatus === 'ALLOCATED').map((ev) => ev.resourceId));
      const reserved = new Set(events.filter((ev) => ['PENDING', 'IN_PROCESS'].includes(ev.allocStatus)).map((ev) => ev.resourceId));
      resources.forEach((r) => {
        if (allocated.has(r.id)) { r.status = 'deployed'; } else if (reserved.has(r.id)) { r.status = 'reserved'; }
      });

      // Window: from the 1st of the month of min(today, earliest bar), three years long, so history stays reachable.
      const t = today || todayKey();
      const earliest = minStart ? minStart.toISOString().substring(0, 10) : null;
      const from = (earliest && earliest < t ? earliest : t).substring(0, 7) + '-01';
      const to = (Number(from.substring(0, 4)) + 3) + from.substring(4);
      const startDate = new Date(Number(from.substring(0, 4)), Number(from.substring(5, 7)) - 1, 1);
      const endDate = new Date(startDate);
      endDate.setFullYear(endDate.getFullYear() + 3);
      return { resources, events, startDate, endDate, windowStart: from, windowEnd: to };
    }

    // ── Conflicts ────────────────────────────────────────────────────────────────────────────────────────────────

    /** Do two bars share at least one day? (Both ends count.) */
    overlaps(a, b) {
      return !!(a && b && a.startDay && b.startDay && a.startDay <= b.endDay && b.startDay <= a.endDay);
    }

    /**
     * FDD S32: two bars on one unit at once, where both hold the unit (bookings of any live status and planned
     * maintenance; a cancelled or rejected booking holds nothing; two work orders together are not a conflict).
     * Only conflicts still open on `since` (their shared days end on or after it) count: a clash that is over is
     * history, not work.
     *
     * @returns {Array<{id, resourceId, a, b, type: 'double'|'maintenance', from, to}>} earliest first
     */
    findConflicts(events, since) {
      const byRes = new Map();
      (events || []).forEach((e) => {
        if (!e || !e.startDay || !e.endDay || !this.holdsUnit(e.kind)) { return; }
        if (!byRes.has(e.resourceId)) { byRes.set(e.resourceId, []); }
        byRes.get(e.resourceId).push(e);
      });
      const out = [];
      byRes.forEach((list, rid) => {
        list.sort((x, y) => cmp(x.startDay, y.startDay) || (x.id - y.id));
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length && list[j].startDay <= list[i].endDay; j++) {
            const a = list[i];
            const b = list[j];
            if (a.kind === 'maintenance' && b.kind === 'maintenance') { continue; }
            const from = b.startDay;
            const to = a.endDay < b.endDay ? a.endDay : b.endDay;
            if (since && to < since) { continue; }
            out.push({
              id: a.id + '-' + b.id,
              resourceId: rid,
              a: a.id,
              b: b.id,
              type: (a.kind === 'maintenance' || b.kind === 'maintenance') ? 'maintenance' : 'double',
              from,
              to,
            });
          }
        }
      });
      return out.sort((x, y) => cmp(x.from, y.from) || cmp(x.id, y.id));
    }

    /**
     * Ready for display: marks conflicting bars and units, sets "in maintenance today", and orders the rows the way
     * the page reads them: classes that have conflicts first, units with conflicts first in their class.
     */
    prepare(built, today) {
      const t = today || todayKey();
      const resources = (built && built.resources ? built.resources : []).map((r) => Object.assign({}, r));
      const events = (built && built.events ? built.events : []).map((e) => Object.assign({}, e, { conflict: false }));
      const conflicts = this.findConflicts(events, t);
      const byId = {};
      events.forEach((e) => { byId[e.id] = e; });
      const count = {};
      conflicts.forEach((c) => {
        byId[c.a].conflict = true;
        byId[c.b].conflict = true;
        count[c.resourceId] = (count[c.resourceId] || 0) + 1;
      });
      const inMaintenance = new Set(events
        .filter((e) => e.kind === 'maintenance' && e.startDay <= t && e.endDay >= t)
        .map((e) => e.resourceId));
      const classHasConflict = {};
      resources.forEach((r) => {
        r.conflict_count = count[r.id] || 0;
        if (inMaintenance.has(r.id)) { r.status = 'maintenance'; }
        if (r.conflict_count) { classHasConflict[r.equipment_class || ''] = true; }
      });
      resources.forEach((r) => {
        const c = r.equipment_class || '';
        r.class_label = c || NO_CLASS;
        r.group_key = (classHasConflict[c] ? '0' : '1') + '|' + (c ? c.toLowerCase() : '~') + '|' + r.class_label;
        r.sort_key = (r.conflict_count ? '0' : '1') + '|' + String(r.equipment_name || '~').toLowerCase() + '|' + r.serial_number;
      });
      resources.sort((a, b) => cmp(a.group_key, b.group_key) || cmp(a.sort_key, b.sort_key));
      return {
        resources,
        events,
        conflicts,
        today: t,
        windowStart: built ? built.windowStart : '',
        windowEnd: built ? built.windowEnd : '',
      };
    }

    /** Group heading from a group key: the class name. */
    groupLabel(groupKey) {
      return String(groupKey || '').split('|').slice(2).join('|') || NO_CLASS;
    }

    /** How many units in a class group (of those shown) have a conflict. */
    groupClashes(model, groupKey, visible) {
      return ((model && model.resources) || [])
        .filter((r) => r.group_key === groupKey && r.conflict_count && (!visible || visible.has(r.id))).length;
    }

    // ── Filters ──────────────────────────────────────────────────────────────────────────────────────────────────

    /** An empty filter. */
    emptyFilters() {
      return { text: '', classes: [], projects: [], yards: [], conflictsOnly: false };
    }

    /**
     * Ids of the units that pass the filters, in display order. Class, yard and project are each a set (any of the
     * picked values); search matches every word across the unit and its bookings (equipment, serial, fixed asset,
     * location, request, project, task, requestor, work order).
     */
    filterUnits(model, filters) {
      const f = Object.assign(this.emptyFilters(), filters || {});
      const q = words(f.text);
      const cls = asSet(f.classes);
      const prj = asSet(f.projects);
      const yard = asSet(f.yards);
      const byRes = this._bookingsByUnit(model);
      return ((model && model.resources) || []).filter((r) => {
        if (cls.size && !cls.has(r.class_label || r.equipment_class || NO_CLASS)) { return false; }
        if (yard.size && !yard.has(r.yard_key || '')) { return false; }
        if (f.conflictsOnly && !r.conflict_count) { return false; }
        const evs = byRes[r.id] || [];
        if (prj.size && !evs.some((e) => e.kind !== 'maintenance' && prj.has(e.projectName || ''))) { return false; }
        if (q.length) {
          const hay = [r.serial_number, r.equipment_id, r.equipment_name, r.equipment_class, r.fa_asset_number, r.location, r.location_code]
            .concat(...evs.map((e) => [e.requestNumber, e.projectName, e.taskName, e.requestorName, e.workOrderNumber]))
            .join(' ').toLowerCase();
          if (!q.every((w) => hay.includes(w))) { return false; }
        }
        return true;
      }).map((r) => r.id);
    }

    _bookingsByUnit(model) {
      const out = {};
      ((model && model.events) || []).forEach((e) => { (out[e.resourceId] = out[e.resourceId] || []).push(e); });
      return out;
    }

    /**
     * Choices for one filter with unit counts, sorted by label: 'class', 'yard' or 'project'.
     * @returns {Array<{value, label, count, on}>}
     */
    filterOptions(model, kind, selected) {
      const on = asSet(selected);
      const counts = new Map();
      const add = (value, label, unitId) => {
        if (!counts.has(value)) { counts.set(value, { value, label, units: new Set() }); }
        counts.get(value).units.add(unitId);
      };
      const resources = (model && model.resources) || [];
      if (kind === 'class') {
        resources.forEach((r) => add(r.class_label || r.equipment_class || NO_CLASS, r.class_label || r.equipment_class || NO_CLASS, r.id));
      } else if (kind === 'yard') {
        resources.forEach((r) => add(r.yard_key || '', r.yard_label || NO_YARD, r.id));
      } else if (kind === 'project') {
        ((model && model.events) || []).forEach((e) => {
          if (e.kind !== 'maintenance' && e.projectName) { add(e.projectName, e.projectName, e.resourceId); }
        });
      }
      return Array.from(counts.values())
        .map((o) => ({ value: o.value, label: o.label, count: o.units.size, on: on.has(o.value) }))
        .sort((a, b) => cmp(a.label.toLowerCase(), b.label.toLowerCase()));
    }

    /** The filter chip's text: 'Class', 'Class: Excavators', 'Class: Excavators, Cranes +2'. */
    filterChipText(title, selected, options) {
      const list = Array.isArray(selected) ? selected : [];
      if (!list.length) { return title; }
      const labelOf = {};
      (options || []).forEach((o) => { labelOf[o.value] = o.label; });
      const names = list.map((v) => labelOf[v] || v || NO_YARD);
      return title + ': ' + names.slice(0, 2).join(', ') + (names.length > 2 ? ' +' + (names.length - 2) : '');
    }

    /** Toggle a value in a list (returns a new list). */
    toggle(list, value) {
      const a = Array.isArray(list) ? list.slice() : [];
      const i = a.indexOf(value);
      if (i === -1) { a.push(value); } else { a.splice(i, 1); }
      return a;
    }

    // ── What the page lists ──────────────────────────────────────────────────────────────────────────────────────

    /** Link to the booking's line in Old EquipRite (line-detail: reassign the unit or change the dates there). */
    oldLineLink(oldAppUrl, ev) {
      if (!oldAppUrl || !ev || ev.kind === 'maintenance' || ev.lineId == null || ev.requestId == null) { return ''; }
      const base = oldAppUrl.endsWith('/') ? oldAppUrl : oldAppUrl + '/';
      const q = [
        'requestId=' + encodeURIComponent(String(ev.requestId)),
        'requestNumber=' + encodeURIComponent(String(ev.requestNumber || '')),
        'lineId=' + encodeURIComponent(String(ev.lineId)),
        'equipmentMasterId=' + encodeURIComponent(ev.equipmentMasterId != null ? String(ev.equipmentMasterId) : ''),
      ].join('&');
      return base + 'vp/shell/equipment-foundation/line-detail?' + q;
    }

    _booking(ev, oldAppUrl) {
      return {
        eventId: ev.id,
        kind: ev.kind,
        kindLabel: (KINDS[ev.kind] || KINDS.other).label,
        swatch: 'er-sch-swatch er-sch-swatch--' + ev.kind,
        label: this.barLabel(ev),
        dates: this.dateRange(ev.startDay, ev.endDay),
        detail: ev.kind === 'maintenance'
          ? [ev.projectName, ev.taskName].filter((x) => x && x !== 'Maintenance').join(' · ')
          : [ev.taskName, ev.requestorName].filter((x) => x).join(' · '),
        conflict: !!ev.conflict,
        isBooking: ev.kind !== 'maintenance',
        canOpen: ev.kind !== 'maintenance' && ev.requestId != null,
        requestNumber: ev.requestNumber || '',
        requestId: ev.requestId,
        oldLink: this.oldLineLink(oldAppUrl, ev),
      };
    }

    /**
     * The conflict panel: one row per open conflict, earliest first, each with both bars and what to do about them.
     */
    conflictRows(model, oldAppUrl, visibleIds) {
      const evs = {};
      const units = {};
      ((model && model.events) || []).forEach((e) => { evs[e.id] = e; });
      ((model && model.resources) || []).forEach((r) => { units[r.id] = r; });
      const show = visibleIds ? new Set(visibleIds) : null;
      return ((model && model.conflicts) || [])
        .filter((c) => !show || show.has(c.resourceId))
        .map((c) => {
          const u = units[c.resourceId] || {};
          return {
            id: c.id,
            unitId: c.resourceId,
            unit: u.equipment_name || u.serial_number || '',
            sub: [u.serial_number, u.class_label].filter((x) => x).join(' · '),
            title: c.type === 'maintenance' ? 'Booked during maintenance' : 'Double booking',
            when: this.dateRange(c.from, c.to),
            items: [evs[c.a], evs[c.b]].filter((x) => x).map((e) => this._booking(e, oldAppUrl)),
          };
        });
    }

    /**
     * Units for the list (the side panel's List, and the whole timeline when the Gantt cannot load): current and
     * upcoming bars per unit, the next one named, earlier ones counted.
     */
    listRows(model, visibleIds, limit, oldAppUrl) {
      const units = {};
      ((model && model.resources) || []).forEach((r) => { units[r.id] = r; });
      const byRes = this._bookingsByUnit(model);
      const t = (model && model.today) || todayKey();
      const ids = visibleIds || ((model && model.resources) || []).map((r) => r.id);
      return ids.slice(0, limit || ids.length).map((id) => {
        const r = units[id] || {};
        const all = (byRes[id] || []).slice().sort((a, b) => cmp(a.startDay, b.startDay) || (a.id - b.id));
        const live = all.filter((e) => e.endDay >= t);
        const next = live.find((e) => e.kind !== 'cancelled');
        return {
          id,
          name: r.equipment_name || r.serial_number || '',
          sub: [r.serial_number, r.fa_asset_number ? 'FA ' + r.fa_asset_number : '', r.class_label].filter((x) => x).join(' · '),
          where: [r.location_code, r.location && r.location !== r.location_code ? r.location : ''].filter((x) => x).join(' · ') || NO_YARD,
          status: r.status || 'available',
          statusLabel: this.unitStatusLabel(r.status),
          dot: 'er-sch-dot er-sch-dot--' + (r.status || 'available'),
          conflicts: r.conflict_count || 0,
          next: next ? this.barLabel(next) + ' · ' + this.dateRange(next.startDay, next.endDay) : 'Nothing booked ahead',
          bookings: live.map((e) => this._booking(e, oldAppUrl)),
          earlier: all.length - live.length,
        };
      });
    }

    /** Header counts: units, live bookings, open conflicts, units in maintenance today. */
    summary(model, visibleIds) {
      const resources = (model && model.resources) || [];
      const t = (model && model.today) || todayKey();
      const show = new Set(visibleIds || resources.map((r) => r.id));
      const events = ((model && model.events) || []).filter((e) => show.has(e.resourceId));
      return {
        units: show.size,
        totalUnits: resources.length,
        bookings: events.filter((e) => e.kind !== 'maintenance' && e.kind !== 'cancelled' && e.endDay >= t).length,
        conflicts: ((model && model.conflicts) || []).filter((c) => show.has(c.resourceId)).length,
        maintenance: resources.filter((r) => show.has(r.id) && r.status === 'maintenance').length,
      };
    }

    /** The band's sub line. */
    summaryText(s, loading) {
      if (loading) { return 'Loading the fleet…'; }
      if (!s || !s.totalUnits) { return 'No units to show'; }
      const n = (x, one, many) => x + ' ' + (x === 1 ? one : many);
      const units = s.units === s.totalUnits ? n(s.units, 'unit', 'units') : s.units + ' of ' + n(s.totalUnits, 'unit', 'units');
      return [units, n(s.bookings, 'current or upcoming booking', 'current or upcoming bookings'),
        s.conflicts ? n(s.conflicts, 'conflict', 'conflicts') : 'no conflicts'].join(' · ');
    }

    /** Booking tooltip (HTML, every value escaped): the old page's tooltip fields. */
    tooltipHtml(ev, res) {
      const r = res || {};
      const row = (k, v) => `<dt>${esc(k)}</dt><dd>${esc(v || '—')}</dd>`;
      const head = `<div class="er-sch-tip-title">${esc(this.barLabel(ev))}</div>`
        + `<div class="er-sch-tip-sub">${esc((KINDS[ev.kind] || KINDS.other).label)}${ev.conflict ? ' · <strong>Conflict</strong>' : ''}</div>`;
      const what = ev.kind === 'maintenance'
        ? row('Work order', ev.workOrderNumber) + row('Type', ev.projectName) + row('Detail', ev.taskName)
        : row('Request', ev.requestNumber) + row('Project', ev.projectName) + row('Task', ev.taskName) + row('Requestor', ev.requestorName)
          + row('Status', ev.name);
      return `<div class="er-sch-tip">${head}<dl>${what}${row('Dates', this.dateRange(ev.startDay, ev.endDay))}`
        + `${row('Unit', [r.equipment_name, r.serial_number].filter((x) => x).join(' · '))}`
        + `${row('Class', String(r.equipment_class || '').replace(/_/g, ' '))}${row('Manufacturer', r.manufacturer)}`
        + `${row('Site', ev.shortAddress || r.location)}</dl></div>`;
    }

    /** Ring offsets for unit pins that share a spot (the old renderResourceMarkers): id -> { dLat, dLon }. */
    ringOffsets(resources) {
      const groups = new Map();
      (resources || []).forEach((r) => {
        if (r.latitude == null || r.longitude == null) { return; }
        const lat = Number(r.latitude);
        const lon = Number(r.longitude);
        if (isNaN(lat) || isNaN(lon)) { return; }
        const key = lat.toFixed(4) + ',' + lon.toFixed(4);
        if (!groups.has(key)) { groups.set(key, []); }
        groups.get(key).push(r);
      });
      const out = {};
      groups.forEach((g) => {
        g.forEach((r, i) => {
          const angle = (2 * Math.PI * i) / g.length;
          out[r.id] = g.length === 1 ? { dLat: 0, dLon: 0 } : { dLat: RING_DEG * Math.cos(angle), dLon: RING_DEG * Math.sin(angle) };
        });
      });
      return out;
    }

    // ── Views: shared ────────────────────────────────────────────────────────────────────────────────────────────

    /** Loads a library through requirejs; null when it cannot load, so the page keeps its list. */
    _load(id) {
      return new Promise((resolve) => {
        try {
          require([id], (lib) => resolve(lib || null), (err) => {
            console.warn('[schedule] ' + id + ' did not load; the page shows the list instead.', (err && err.message) || '');
            try { require.undef(id); } catch (e) { /* nothing to forget */ }
            resolve(null);
          });
        } catch (e) {
          resolve(null);
        }
      });
    }

    /** Waits for an element the page template renders (VB may still be binding it when the data arrives). */
    _waitFor(id, ms) {
      const until = Date.now() + (ms || 8000);
      return new Promise((resolve) => {
        const tick = () => {
          const el = document.getElementById(id);
          if (el && el.isConnected) { resolve(el); return; }
          if (Date.now() > until) { resolve(null); return; }
          setTimeout(tick, 50);
        };
        tick();
      });
    }

    _index(model) {
      this._model = model;
      this._eventsById = {};
      this._unitsById = {};
      ((model && model.events) || []).forEach((e) => { this._eventsById[e.id] = e; });
      ((model && model.resources) || []).forEach((r) => { this._unitsById[r.id] = r; });
    }

    _fire(name, payload) {
      try {
        if (this._eventHelper) { this._eventHelper.fireCustomEvent(name, payload); }
      } catch (e) {
        console.warn('[schedule] could not raise ' + name, e);
      }
    }

    _localDate(s10) {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s10 || ''));
      return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
    }

    // ── View: the Gantt ──────────────────────────────────────────────────────────────────────────────────────────

    /**
     * Draws the Gantt into #erScheduleGantt. Resolves true when it is on screen, false when Bryntum could not load
     * or start (the page then shows the list in its place).
     * @param {Object} model  prepare()'s result
     * @param {Object} view   { scale, month, visibleIds, projects }
     */
    async renderGantt(model, view) {
      this._index(model);
      const v = view || {};
      const el = await this._waitFor('erScheduleGantt');
      if (!el) { return false; }
      const lib = await this._load('schedulerPro');
      if (!lib || typeof lib.Scheduler !== 'function') { return false; }
      this._ganttLib = lib;
      this.destroyGantt();
      try {
        const me = this;
        const resources = model.resources.map((r) => Object.assign({}, r));
        const events = model.events.map((e) => ({
          id: e.id,
          resourceId: e.resourceId,
          name: e.name,
          startDate: me._localDate(e.startDay),
          endDate: me._localDate(addDays(e.endDay, 1)),
          kind: e.kind,
        }));
        const start = this._localDate(model.windowStart) || new Date();
        const end = this._localDate(model.windowEnd) || new Date(start.getFullYear() + 3, start.getMonth(), 1);
        // What the user asked for while the library was loading wins over the snapshot taken when loading ended.
        const asked = this._asked || {};
        const filter = asked.filter || { ids: v.visibleIds, projects: v.projects };
        this._projects = asSet(filter.projects);
        this._gantt = new lib.Scheduler({
          appendTo: el,
          height: '100%',
          startDate: start,
          endDate: end,
          viewPreset: this.presetFor(asked.scale || v.scale),
          rowHeight: 46,
          barMargin: 8,
          eventColor: null,
          eventStyle: null,
          readOnly: true,
          hideHorizontalScrollbar: false,
          features: this.ganttFeatures(
            ({ eventRecord }) => {
              const ev = me._eventsById[eventRecord.id];
              return ev ? me.tooltipHtml(ev, me._unitsById[ev.resourceId]) : '';
            },
            ({ isFirstColumn, groupRowFor, count }) => {
              if (!isFirstColumn) { return ''; }
              const clashes = me.groupClashes(me._model, groupRowFor, me._visible);
              return esc(me.groupLabel(groupRowFor)) + ' <span class="er-sch-group-count">' + count
                + (clashes ? ' · ' + clashes + ' with conflicts' : '') + '</span>';
            }),
          columns: [{
            text: 'Equipment · fixed asset',
            field: 'sort_key',
            width: 250,
            sortable: false,
            groupable: false,
            renderer: ({ record }) => {
              const r = me._unitsById[record.id] || {};
              const sub = [r.serial_number, r.fa_asset_number ? 'FA ' + r.fa_asset_number : '', r.class_label].filter((x) => x).join(' · ');
              return {
                className: 'er-sch-unit-cell',
                children: [
                  { tag: 'span', className: 'er-sch-dot er-sch-dot--' + (r.status || 'available'), title: me.unitStatusLabel(r.status) },
                  {
                    tag: 'span',
                    className: 'er-sch-unit-text',
                    children: [
                      { tag: 'strong', text: r.equipment_name || r.serial_number || '—' },
                      { tag: 'span', text: sub || '—' },
                    ],
                  },
                  r.conflict_count ? { tag: 'span', className: 'er-sch-unit-flag', text: '!', title: r.conflict_count + ' conflict(s)' } : null,
                ],
              };
            },
          }],
          project: { resourcesData: resources, eventsData: events },
          eventRenderer: ({ eventRecord, renderData }) => {
            const ev = me._eventsById[eventRecord.id] || { kind: 'other' };
            me.barClasses(ev, me._projects).forEach((c) => { renderData.cls[c] = 1; });
            renderData.iconCls = null;
            return [{ tag: 'span', className: 'er-sch-bar-text', text: me.barLabel(ev) }];
          },
          listeners: {
            eventClick: ({ eventRecord }) => { me._showOnMap(eventRecord.id); },
            selectionChange: ({ selection }) => {
              const unit = (selection || []).find((s) => s && !s.isEventModel && !s.resource);
              me._focusUnitOnMap(unit ? unit.id : null);
            },
            visibleDateRangeChange: ({ new: range }) => { me._noteMonth(range && range.startDate); },
          },
        });
        this.applyGanttFilter(filter.ids, filter.projects);
        // Open on the month the band shows (today's at first), not on the window's first month.
        const month = asked.month || v.month || this.monthKey(new Date());
        setTimeout(() => this.scrollToMonth(month), 0);
        return true;
      } catch (e) {
        console.warn('[schedule] the Gantt could not start; the page shows the list instead.', e && e.message);
        this.destroyGantt();
        return false;
      }
    }

    /** Shows only these units (null, or every unit: no filter) and dims bars of other projects. */
    applyGanttFilter(visibleIds, projects) {
      const all = ((this._model && this._model.resources) || []).length;
      this._visible = (Array.isArray(visibleIds) && visibleIds.length !== all) ? new Set(visibleIds) : null;
      this._projects = asSet(projects);
      this._ask('filter', { ids: Array.isArray(visibleIds) ? visibleIds.slice() : null, projects: Array.isArray(projects) ? projects.slice() : [] });
      const g = this._gantt;
      if (!g) { this._drawMarkers(); return; }
      try {
        const store = g.resourceStore;
        if (!this._visible) {
          store.clearFilters();
        } else {
          const keep = this._visible;
          store.filter({ filters: (r) => keep.has(r.id), replace: true });
        }
        g.refreshRows ? g.refreshRows() : g.refresh();
      } catch (e) {
        console.warn('[schedule] filter not applied to the Gantt', e && e.message);
      }
      this._drawMarkers();
    }

    /** Remembers the latest filter / scale / month, for a Gantt that is still loading. */
    _ask(key, value) {
      this._asked = Object.assign({}, this._asked, { [key]: value });
    }

    setScale(scale, month) {
      this._ask('scale', scale);
      const g = this._gantt;
      if (!g) { return; }
      try {
        g.viewPreset = this.presetFor(scale);
        this.scrollToMonth(month || this._month);
      } catch (e) {
        console.warn('[schedule] scale not changed', e && e.message);
      }
    }

    /** Scrolls the Gantt to a month (leftDay: its 1st, or a week before today in this month). */
    scrollToMonth(month) {
      if (!/^\d{4}-\d{2}/.test(String(month || ''))) { return; }
      this._ask('month', String(month).substring(0, 7));
      const g = this._gantt;
      if (!g) { return; }
      try {
        this._month = String(month).substring(0, 7);
        const day = this._localDate(this.leftDay(month, todayKey()));
        day.setHours(12);
        g.scrollToDate(day, { block: 'start', animate: false });
      } catch (e) {
        console.warn('[schedule] could not scroll to ' + month, e && e.message);
      }
    }

    /** The user scrolled: tell the page which month is now at the left, once it settles. */
    _noteMonth(date) {
      if (!(date instanceof Date) || isNaN(date)) { return; }
      clearTimeout(this._monthTimer);
      this._monthTimer = setTimeout(() => {
        // The month most of the left edge's first week falls in.
        const mid = new Date(date.getTime() + 3 * DAY_MS);
        const month = this.monthKey(mid);
        if (month !== this._month) {
          this._month = month;
          this._fire('scheduleMonthInView', { month });
        }
      }, 200);
    }

    /** Brings a bar into view, selects it and opens its pin. */
    async focusEvent(eventId) {
      const g = this._gantt;
      const id = Number(eventId);
      if (g) {
        try {
          const rec = g.eventStore.getById(id);
          if (rec) {
            await g.scrollEventIntoView(rec, { animate: true, highlight: true, block: 'center' });
            g.selectedEvents = [rec];
          }
        } catch (e) {
          console.warn('[schedule] could not show booking ' + eventId, e && e.message);
        }
      }
      this._showOnMap(id);
    }

    /** Brings a unit's row into view and selects it (the map follows). */
    async focusUnit(unitId) {
      const g = this._gantt;
      const id = Number(unitId);
      if (g) {
        try {
          const rec = g.resourceStore.getById(id);
          if (rec) {
            await g.scrollResourceIntoView(rec, { animate: true, highlight: true, block: 'center' });
            g.selectedRecord = rec;
          }
        } catch (e) {
          console.warn('[schedule] could not show unit ' + unitId, e && e.message);
        }
      }
      this._focusUnitOnMap(id);
    }

    destroyGantt() {
      if (this._gantt) {
        try { this._gantt.destroy(); } catch (e) { /* already gone */ }
      }
      this._gantt = null;
    }

    // ── View: the map ────────────────────────────────────────────────────────────────────────────────────────────

    /**
     * Draws the map into #erScheduleMap: one pin per unit at its current location (coloured by status) and one per
     * current or upcoming booking at its ship-to site. Resolves true once the map has loaded, false when Mapbox could
     * not load, the browser cannot draw it (no WebGL) or the style did not arrive (no network); the page then lists
     * the units instead.
     */
    async renderMap(model, view) {
      this._index(model);
      const v = view || {};
      if (Array.isArray(v.visibleIds) && v.visibleIds.length !== model.resources.length) { this._visible = new Set(v.visibleIds); }
      const el = await this._waitFor('erScheduleMap');
      if (!el) { return false; }
      const lib = await this._load('mapboxgl');
      if (!lib || typeof lib.Map !== 'function') { return false; }
      if (typeof lib.supported === 'function' && !lib.supported()) {
        console.warn('[schedule] this browser cannot draw the map (no WebGL); the page lists the units instead.');
        return false;
      }
      this._mapLib = lib;
      if (!lib.accessToken) { lib.accessToken = MAPBOX_TOKEN; }
      this.destroyMap();
      return new Promise((resolve) => {
        let settled = false;
        let map = null;
        const finish = (ok, why) => {
          if (settled) { return; }
          settled = true;
          if (!ok) {
            console.warn('[schedule] the map did not load; the page lists the units instead.', why || '');
            try { if (map) { map.remove(); } } catch (e) { /* gone */ }
            this._map = null;
          }
          resolve(ok);
        };
        try {
          map = new lib.Map({
            container: el,
            style: MAP_STYLES.streets,
            center: [MAP_VIEW.lon, MAP_VIEW.lat],
            zoom: MAP_VIEW.zoom,
          });
        } catch (e) {
          finish(false, e && e.message);
          return;
        }
        map.addControl(new lib.NavigationControl({ showCompass: false }), 'top-right');
        map.on('error', (e) => {
          const msg = (e && e.error && e.error.message) || 'map error';
          if (!settled) { finish(false, msg); } else { console.warn('[schedule] map: ' + msg); }
        });
        map.on('load', () => {
          if (settled) { return; }
          this._map = map;
          this._drawMarkers();
          finish(true);
        });
        setTimeout(() => finish(false, 'no answer from the map service'), 20000);
      });
    }

    setMapStyle(style) {
      if (this._map && MAP_STYLES[style]) {
        try { this._map.setStyle(MAP_STYLES[style]); } catch (e) { console.warn('[schedule] map style not changed', e && e.message); }
      }
    }

    resizeMap() {
      if (this._map) {
        setTimeout(() => { try { this._map.resize(); } catch (e) { /* hidden */ } }, 0);
      }
    }

    _registerPopup(popup) {
      popup.on('open', () => {
        if (this._openPopup && this._openPopup !== popup && this._openPopup.isOpen()) { this._openPopup.remove(); }
        this._openPopup = popup;
      });
      popup.on('close', () => { if (this._openPopup === popup) { this._openPopup = null; } });
    }

    _closePopup() {
      if (this._openPopup && this._openPopup.isOpen()) { this._openPopup.remove(); }
      this._openPopup = null;
    }

    _clearMarkers() {
      this._eventMarkers.forEach((m) => { try { m.remove(); } catch (e) { /* gone */ } });
      this._unitMarkers.forEach((m) => { try { m.remove(); } catch (e) { /* gone */ } });
      this._eventMarkers = [];
      this._unitMarkers = new Map();
      this._markerByEvent = {};
    }

    _popupHtml(title, sub, rows) {
      return `<div class="er-sch-pop"><div class="er-sch-pop-title">${esc(title)}</div><div class="er-sch-pop-sub">${esc(sub)}</div><dl>`
        + rows.filter((r) => r[1]).map((r) => `<dt>${esc(r[0])}</dt><dd>${esc(r[1])}</dd>`).join('') + '</dl></div>';
    }

    /** (Re)draws the pins for the units in the filter. */
    _drawMarkers() {
      const map = this._map;
      const lib = this._mapLib;
      const model = this._model;
      if (!map || !lib || !model) { return; }
      this._clearMarkers();
      const show = this._visible;
      const units = model.resources.filter((r) => !show || show.has(r.id));
      const offsets = this.ringOffsets(units);
      units.forEach((r) => {
        const off = offsets[r.id];
        if (!off) { return; }
        const el = document.createElement('div');
        el.className = 'er-sch-pin er-sch-pin--' + (r.status || 'available');
        el.title = r.equipment_name || r.serial_number || '';
        const popup = new lib.Popup({ offset: 14, maxWidth: '260px' }).setHTML(this._popupHtml(
          r.equipment_name || r.serial_number, [r.serial_number, r.class_label].filter((x) => x).join(' · '),
          [['Status', this.unitStatusLabel(r.status)], ['Location', r.location], ['Yard', r.location_code]]));
        this._registerPopup(popup);
        const marker = new lib.Marker({ element: el })
          .setLngLat([Number(r.longitude) + off.dLon, Number(r.latitude) + off.dLat])
          .setPopup(popup)
          .addTo(map);
        this._unitMarkers.set(r.id, marker);
      });
      const t = model.today || todayKey();
      model.events.forEach((e) => {
        if (show && !show.has(e.resourceId)) { return; }
        if (!e.address || !e.address.lat || !e.address.lon) { return; }
        if (e.kind === 'cancelled' || e.endDay < t) { return; }
        const r = this._unitsById[e.resourceId] || {};
        const popup = new lib.Popup({ offset: 28, maxWidth: '260px' }).setHTML(this._popupHtml(
          this.barLabel(e), [r.equipment_name, r.serial_number].filter((x) => x).join(' · '),
          [['Booking', (KINDS[e.kind] || KINDS.other).label + (e.conflict ? ' · conflict' : '')],
            ['Dates', this.dateRange(e.startDay, e.endDay)], ['Site', e.shortAddress]]));
        this._registerPopup(popup);
        const marker = new lib.Marker({ color: (KINDS[e.kind] || KINDS.other).color })
          .setLngLat([e.address.lon, e.address.lat])
          .setPopup(popup)
          .addTo(map);
        marker.getElement().classList.add('er-sch-site-pin');
        // A booking pin scrolls the Gantt to its bar.
        marker.getElement().addEventListener('click', () => {
          const g = this._gantt;
          const rec = g && g.eventStore.getById(e.id);
          if (rec) {
            g.scrollEventIntoView(rec, { animate: true, highlight: true }).catch(() => {});
            g.selectedEvents = [rec];
          }
        });
        this._eventMarkers.push(marker);
        this._markerByEvent[e.id] = marker;
      });
      if (this._focusedUnit != null) { this._focusUnitOnMap(this._focusedUnit); }
    }

    /** A clicked bar: centre on its site and open its pin (the old eventClick). */
    _showOnMap(eventId) {
      const marker = this._markerByEvent && this._markerByEvent[eventId];
      if (!this._map || !marker) { return; }
      this._map.easeTo({ center: marker.getLngLat() });
      if (!marker.getPopup().isOpen()) { marker.togglePopup(); }
    }

    /**
     * A selected row: fly to the unit and hide every other pin; no unit (or one without a location) shows them all
     * again (the old focusOnResource / _restoreAllMarkers).
     */
    _focusUnitOnMap(unitId) {
      this._focusedUnit = unitId;
      if (!this._map) { return; }
      const marker = unitId != null ? this._unitMarkers.get(Number(unitId)) : null;
      this._closePopup();
      if (!marker) {
        this._focusedUnit = null;
        this._unitMarkers.forEach((m) => { m.getElement().style.display = ''; });
        this._eventMarkers.forEach((m) => { m.getElement().style.display = ''; });
        return;
      }
      this._unitMarkers.forEach((m, id) => { m.getElement().style.display = id === Number(unitId) ? '' : 'none'; });
      this._eventMarkers.forEach((m) => { m.getElement().style.display = 'none'; });
      const ll = marker.getLngLat();
      this._map.flyTo({ center: [ll.lng, ll.lat], zoom: Math.max(this._map.getZoom(), 14) });
    }

    destroyMap() {
      this._clearMarkers();
      if (this._map) {
        try { this._map.remove(); } catch (e) { /* gone */ }
      }
      this._map = null;
    }

    /** Leaving the page: free both views. */
    destroyViews() {
      clearTimeout(this._monthTimer);
      this.destroyGantt();
      this.destroyMap();
    }
  }

  return PageModule;
});
