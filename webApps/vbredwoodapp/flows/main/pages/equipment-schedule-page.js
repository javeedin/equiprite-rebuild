define([
  'schedulerPro',
  'mapboxgl',
  // Month-agenda popup. Loads Bryntum Calendar into an iframe rather than onto
  // this page — Calendar and Scheduler Pro cannot share a document (different
  // major versions, 741 colliding `.b-*` selectors, one `bryntum` global).
  // See resources/js/monthAgendaPopup.js for the full reasoning.
  'resources/js/monthAgendaPopup',
], (schedulerPro, mapboxgl, monthAgendaPopup) => {
  'use strict';

  const MAPBOX_TOKEN = 'pk.eyJ1IjoicmFodWxqYW1hbGFwdXJhbSIsImEiOiJjbXNkYngyeDcwNGN4MzVwdmRkMHRmN2ppIn0.P7EFTLmcAsXXammLSgF3Qw';

  // Token is applied LAZILY and GUARDED — it used to be a bare
  // `mapboxgl.accessToken = '…'` executed here at module-load time.
  //
  // Mapbox GL's UMD wrapper takes its AMD branch under require.js
  // (`typeof define === 'function' && define.amd ? define(factory) : …`), so it
  // never sets window.mapboxgl. That is fine for us — app-flow.json path-maps
  // 'mapboxgl' → resources/js/mapbox-gl, so the injected argument above IS the
  // module. But if that resolution fails for ANY reason (the vendored file
  // missing from a standalone export, a 404, a CSP block on the chunk), the
  // argument arrives undefined and the old top-level assignment threw
  // "Cannot set properties of undefined (setting 'accessToken')" WHILE THE
  // MODULE WAS STILL LOADING.
  //
  // That is what made a missing map take down the whole page: the page module
  // never finished defining, so $page.functions was null and initSchedulerChain
  // died on buildResourcesAndEvents of null — a scheduler failure with no
  // visible connection to Mapbox.
  //
  // Assigning inside a guarded helper instead means a broken map degrades to a
  // page without a map, which is the same failure mode the two customer-portal
  // pages already have (they null-check mapboxgl before touching it).
  function ensureMapboxToken() {
    if (!mapboxgl) {
      console.warn('[equipment-schedule] mapboxgl not loaded — map skipped.');
      return false;
    }
    if (!mapboxgl.accessToken) mapboxgl.accessToken = MAPBOX_TOKEN;
    return true;
  }

  // Resource row dot color — driven by booking presence per serial unit
  const STATUS_COLORS = {
    active:       '#10b981',
    available:    '#10b981',
    deployed:     '#1565C0',
    reserved:     '#E65100',
    maintenance:  '#757575',
    retired:      '#9ca3af',
  };

  class PageModule {

    constructor(context) {
      this.eventHelper = context.getEventHelper();
      this._scheduler  = null;
      // Which rail row is selected, so the month popup can open on the unit the
      // user is already looking at. Kept here rather than read back off the
      // scheduler because selectionChange already computes it (see the listener
      // in _buildScheduler) and the two must not disagree.
      this._selectedResourceId = null;
      // Blob URL backing the popup iframe, held so it can be revoked on close.
      this._monthAgendaUrl     = null;
    }

    setDateFormat(dateStr) {
      const date   = new Date(dateStr);
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return String(date.getDate()).padStart(2,'0') + '-' + months[date.getMonth()] + '-' + date.getFullYear();
    }

    // Color picker for booking bars keyed to allocStatus from workbench-lines
    _eventColorFor(allocStatus) {
      const s = (allocStatus || '').toUpperCase();
      if (s === 'ALLOCATED')                       return '#1565C0';
      if (s === 'PENDING' || s === 'IN_PROCESS')   return '#E65100';
      if (s === 'REJECTED' || s === 'CANCELLED')   return '#9ca3af';
      if (s === 'MOBILIZATION')                    return '#2E7D32';
      // Planned maintenance from Fusion work orders. Grey #757575 is NOT an
      // arbitrary pick — it is the colour the legend bar's existing
      // "Maintenance" pill already uses (.eqp-pill--maintenance, see
      // equipment-schedule-page.html). That pill was in the legend before any
      // maintenance bar existed to explain; this makes it mean something.
      if (s === 'MAINTENANCE')                     return '#757575';
      return '#10b981';
    }

    // One Bryntum resource per serial-ref record. Four lookups:
    //   - equipment-classes (by classId)              → human-readable className
    //   - masterById        (by equipmentId)          → name / class / type /
    //                                                   manufacturer / mfgYear
    //                                                   (serial-ref carries
    //                                                    only the FK)
    //   - locationsById     (by currentLocationId)    → lat / long / name /
    //                                                   code for the resource
    //                                                   marker (where unit IS)
    //   - siteByRequestId   (by eqrEquipmentRequestId) → lat / long for the
    //                                                    event marker (where
    //                                                    the booking ships to)
    // Events come from workbench-lines joined to serials by allocatedSerial.
    // workOrdersByAsset: { maintenanceAssetNumber: [Fusion work order, …] },
    // fetched by initSchedulerChain. Optional — omit it and the Gantt renders
    // rental bars only, exactly as before.
    buildResourcesAndEvents(serials, classes, lines, locationsById, siteByRequestId, masterById, workOrdersByAsset) {
      const locByLocId = locationsById   || {};
      const siteByReq  = siteByRequestId || {};
      const mastersById = masterById     || {};
      // Track how many events have already been pinned at each lat/long key
      // so we can jitter overlapping events on a tight ring. Same pattern as
      // the resource-marker jitter, but per-event because users can have many
      // bookings on the same ship-to-site.
      const eventsByLatLngKey = new Map();
      // equipment-classes: classId → className
      const classNameById = new Map();
      classes.forEach(c => {
        if (c && c.id != null) classNameById.set(c.id, c.className || '');
      });

      // workbench-lines: allocatedSerial → array of line rows
      const linesBySerial = new Map();
      lines.forEach(l => {
        if (!l) return;
        const key = l.allocatedSerial;
        if (!key) return;
        if (!linesBySerial.has(key)) linesBySerial.set(key, []);
        linesBySerial.get(key).push(l);
      });

      const resources = [];
      const events    = [];
      let   eventSeq  = 1;
      let   minStart  = null;

      serials.forEach((s, idx) => {
        // EQR_SERIAL_REF carries serialNumber; the unitIdentifier name only
        // existed on the merged EQR_UNIT_REF. Guarding on the wrong one skips
        // EVERY row and renders an empty scheduler, so this must track
        // whichever table the chain is reading.
        if (!s || !s.serialNumber) return;

        const serialNumber  = s.serialNumber;
        const matchingLines = linesBySerial.get(serialNumber) || [];

        // Serial-ref wins; equipment-master fills the gaps. Serial-ref only
        // carries the FK (equipmentId), so name / class / type / manufacturer /
        // mfgYear come from the master record in most cases.
        const eqId          = s.equipmentId != null ? Number(s.equipmentId) : null;
        const master        = eqId != null ? mastersById[eqId] : null;
        const eqName        = s.equipmentName || (master && master.equipmentName) || '';
        const eqClassId     = s.equipmentClassId != null
                                ? s.equipmentClassId
                                : (master && master.equipmentClassId != null ? master.equipmentClassId : null);
        const className     = eqClassId != null ? (classNameById.get(eqClassId) || '') : '';
        const eqType        = s.equipmentType || (master && master.equipmentType) || '';
        const manufacturer  = s.manufacturer  || (master && master.manufacturer)  || '';
        const mfgYear       = s.mfgYear != null ? s.mfgYear : (master && master.mfgYear != null ? master.mfgYear : null);

        // Prefer most recent booking's deployment location for the map marker.
        const bookingLocation = matchingLines
          .map(l => l.deploymentLocation)
          .filter(Boolean)
          .slice(-1)[0];

        // Resolved location (lat/long/name/code) for this serial-ref's
        // current physical location. Drives the "where is the unit"
        // resource marker on the map. null when the serial has no
        // currentLocationId, or the location lookup didn't resolve.
        const locId      = s.currentLocationId != null ? Number(s.currentLocationId) : null;
        const resolvedLoc = (locId != null) ? locByLocId[locId] : null;

        const resourceId = idx + 1;
        resources.push({
          id:                  resourceId,
          name:                serialNumber,
          serial_number:       serialNumber,
          equipment_id:        s.equipmentId || '',
          equipment_name:      eqName,
          equipment_class:     className,
          equipment_subclass:  '',
          equipment_type:      eqType,
          status:              'available',
          owner_type:          eqType,
          manufacturer:        manufacturer,
          model_year:          mfgYear,
          fa_asset_number:     s.faAssetRefId || '',
          // Display: prefer the resolved location name; fall back to the
          // booking's free-text deploymentLocation for serials without one.
          location:            (resolvedLoc && resolvedLoc.locationName) || bookingLocation || '',
          location_code:       (resolvedLoc && resolvedLoc.locationCode) || '',
          owning_org:          s.orgId || '',
          uom:                 '',
          acquisition_cost:    null,
          latitude:            resolvedLoc && resolvedLoc.latitude  != null ? resolvedLoc.latitude  : null,
          longitude:           resolvedLoc && resolvedLoc.longitude != null ? resolvedLoc.longitude : null,
        });

        matchingLines.forEach(l => {
          const s10 = l.requestedStartDate ? String(l.requestedStartDate).substring(0, 10) : null;
          const e10 = l.requestedEndDate   ? String(l.requestedEndDate).substring(0, 10)   : null;
          if (!s10) return;

          const dur = (s10 && e10)
            ? Math.max(1, Math.round(Math.abs(new Date(e10) - new Date(s10)) / 86400000) + 1)
            : 1;

          const startDt = new Date(s10);
          if (!minStart || startDt < minStart) minStart = startDt;

          const rawStatus = (l.allocStatus || '').toUpperCase();
          const displayName =
            rawStatus === 'ALLOCATED'                          ? 'Booked' :
            rawStatus === 'PENDING' || rawStatus === 'IN_PROCESS' ? 'Reserved' :
            rawStatus === 'MOBILIZATION'                       ? 'Mobilization' :
            (l.allocStatus || 'BOOKED');

          // Look up the request's ship-to-site for the event marker's
          // lat/long. Silent no-marker if the request has no site (older
          // pre-ship-to-site rows) or the site has no coordinates.
          const reqId = l.eqrEquipmentRequestId != null ? Number(l.eqrEquipmentRequestId) : null;
          const site  = reqId != null ? siteByReq[reqId] : null;
          let evtLat = null;
          let evtLon = null;
          if (site && site.latitude != null && site.longitude != null) {
            // Jitter events that share the same site so overlapping pins are
            // individually clickable. ~4 decimals ≈ 11 m granularity; ring
            // radius ~10 m at zoom 14+.
            const baseLat = Number(site.latitude);
            const baseLon = Number(site.longitude);
            const key = baseLat.toFixed(4) + ',' + baseLon.toFixed(4);
            const idx = eventsByLatLngKey.get(key) || 0;
            eventsByLatLngKey.set(key, idx + 1);
            if (idx === 0) {
              evtLat = baseLat;
              evtLon = baseLon;
            } else {
              // Pretend we're spreading 12 items on a ring; if more than 12
              // events share one site, they wrap around the ring. Acceptable
              // — popup tells you which event is which.
              const RADIUS_DEG = 0.00009;
              const angle = (2 * Math.PI * idx) / 12;
              evtLat = baseLat + RADIUS_DEG * Math.cos(angle);
              evtLon = baseLon + RADIUS_DEG * Math.sin(angle);
            }
          }

          events.push({
            id:           eventSeq++,
            resourceId,
            name:         displayName,
            allocStatus:  rawStatus,
            projectName:  l.projectName || '',
            taskName:     l.taskName    || '',
            // Prefer the site's name/address over the free-text deploymentLocation
            // when we have it — the site label is canonical.
            shortAddress: (site && (site.siteName || site.address)) || l.deploymentLocation || '',
            lblStartDate: this.setDateFormat(s10),
            lblEndDate:   e10 ? this.setDateFormat(e10) : '—',
            startDate:    s10,
            duration:     dur,
            eventColor:   this._eventColorFor(l.allocStatus),
            address: { lat: evtLat, lon: evtLon },
          });
        });

        // ── Planned maintenance bars ─────────────────────────────────────
        // One bar per Fusion work order on this serial's maintenance asset,
        // drawn from PlannedStartDate → PlannedCompletionDate. Same records the
        // unit-detail page's Maintenance tab lists.
        //
        // These sit on the SAME resource row as the rental bars on purpose:
        // the question this page answers is "when is this unit unavailable",
        // and planned maintenance is an answer to it. The grey bar colour (see
        // _eventColorFor's 'MAINTENANCE') matches the legend's existing
        // Maintenance pill, so it is already explained to the user.
        //
        // A work order with no planned start is SKIPPED rather than defaulted
        // to today — an unscheduled work order has no place on a timeline, and
        // inventing a date would assert maintenance that is not planned.
        const woList = (workOrdersByAsset && s.maintenanceAssetNumber)
          ? (workOrdersByAsset[s.maintenanceAssetNumber] || [])
          : [];

        woList.forEach(w => {
          const ws10 = w.PlannedStartDate
            ? String(w.PlannedStartDate).substring(0, 10) : null;
          if (!ws10) return;

          // Missing completion → a single day, matching how the rental bars
          // treat a missing end date.
          const we10 = w.PlannedCompletionDate
            ? String(w.PlannedCompletionDate).substring(0, 10) : null;
          const wDur = (ws10 && we10)
            ? Math.max(1, Math.round(Math.abs(new Date(we10) - new Date(ws10)) / 86400000) + 1)
            : 1;

          // Extend the chart window the same way rental bars do, so a
          // maintenance bar earlier than every booking is still reachable.
          const wStartDt = new Date(ws10);
          if (!minStart || wStartDt < minStart) minStart = wStartDt;

          events.push({
            id:           eventSeq++,
            resourceId,
            // Bar label reads "Maintenance", not the raw work-order number.
            // The number (WO-001-…) means nothing at a glance on a timeline and
            // truncates to noise in a narrow bar; what the row needs to say is
            // that the unit is unavailable. The number is still one hover away —
            // the popup's WORK ORDER line carries it (see workOrderNumber
            // below), so nothing is lost.
            name:         'Maintenance',
            allocStatus:  'MAINTENANCE',
            // Carried so the popup can show it now that the bar no longer does.
            // Without this the work-order number would be unreachable from the
            // schedule entirely — the one identifier that ties a bar back to a
            // record in Fusion.
            workOrderNumber: w.WorkOrderNumber || '',
            // Reuse the fields the tooltip/popup already reads, so maintenance
            // bars need no separate template: the work order's type and
            // description stand in for project and task.
            projectName:  w.WorkOrderType || 'Maintenance',
            taskName:     w.WorkOrderDescription || w.WorkOrderStatus || '',
            shortAddress: w.AssetNumber || '',
            lblStartDate: this.setDateFormat(ws10),
            lblEndDate:   we10 ? this.setDateFormat(we10) : '—',
            startDate:    ws10,
            duration:     wDur,
            eventColor:   this._eventColorFor('MAINTENANCE'),
            // No map pin: a work order is against the ASSET, not a ship-to
            // site, so there is no coordinate to place it at.
            address: { lat: null, lon: null },
          });
        });
      });

      // Mark resources with active ALLOCATED bookings as deployed for the row dot.
      const allocatedResourceIds = new Set(
        events
          .filter(ev => ev.allocStatus === 'ALLOCATED')
          .map(ev => ev.resourceId)
      );
      const reservedResourceIds = new Set(
        events
          .filter(ev => ['PENDING', 'IN_PROCESS'].includes(ev.allocStatus))
          .map(ev => ev.resourceId)
      );
      resources.forEach(r => {
        if (allocatedResourceIds.has(r.id))      r.status = 'deployed';
        else if (reservedResourceIds.has(r.id))  r.status = 'reserved';
      });

      // Window: start at min(today, earliest booking) so historical bars stay visible.
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const startDate = (minStart && minStart < today) ? new Date(minStart) : new Date(today);
      startDate.setDate(1);
      const endDate = new Date(startDate);
      endDate.setFullYear(endDate.getFullYear() + 3);

      return { resources, events, startDate, endDate };
    }

    // Core builder — called by initScheduler (from eqp-v1 data) and alterResp (from schedule endpoint)
    _buildScheduler(resources, events, startDate, endDate) {
      const mainEl = document.getElementById('eqp-main');
      if (!mainEl) return;

      // Clear previous Bryntum instances
      mainEl.innerHTML = '';

      // Random suffix prevents "already registered" error on VBCS hot-reload
      const widgetId = Math.floor(Math.random() * 1000000);

      const DH    = schedulerPro.DateHelper;
      const today = DH.clearTime(new Date());

      // ── MapPanel class (defined inside build so type name is unique each call) ──
      class EqpMapPanel extends schedulerPro.Panel {
        static get type()  { return 'eqpmappanel' + widgetId; }
        static get $name() { return 'EqpMapPanel'; }

        static get configurable() {
          return {
            monitorResize: true,
            zoom: 5,
            lat:  24.7,
            lon:  46.7,
            textContent: false,
            cls: 'eqp-map-panel',
            tbar: [
              {
                type: 'widget',
                cls:  'widget-title',
                html: '<span style="display:flex;align-items:center;gap:6px;"><i class="b-fa b-fa-map-location-dot" style="font-size:13px;opacity:0.85;"></i> Map View</span>',
                flex: 1,
              },
              {
                type:        'buttongroup',
                cls:         'eqp-map-style-group',
                toggleGroup: true,
                items: [
                  { ref: 'btnLight', text: 'Streets',   pressed: true, onClick: 'up.onStyleLight' },
                  { ref: 'btnDark',  text: 'Dark',                     onClick: 'up.onStyleDark'  },
                  { ref: 'btnSat',   text: 'Satellite',                onClick: 'up.onStyleSat'   },
                ],
              },
              {
                type:    'button',
                cls:     'b-fa b-fa-plus',
                tooltip: 'Zoom in',
                onClick: 'up.onZoomIn',
              },
              {
                type:    'button',
                cls:     'b-fa b-fa-minus',
                tooltip: 'Zoom out',
                onClick: 'up.onZoomOut',
              },
            ],
          };
        }

        onZoomIn()     { this.map?.zoomIn();  }
        onZoomOut()    { this.map?.zoomOut(); }
        onStyleLight() { this.map?.setStyle('mapbox://styles/mapbox/streets-v11');           }
        onStyleDark()  { this.map?.setStyle('mapbox://styles/mapbox/dark-v11');              }
        onStyleSat()   { this.map?.setStyle('mapbox://styles/mapbox/satellite-streets-v12'); }

        construct() {
          super.construct(...arguments);
          const me = this;
          // Applies the token on first use and bails if the library never
          // resolved. Returning early leaves me.map undefined, so the two
          // methods that reach for it outside this constructor
          // (_focusMarker's flyTo, scrollMarkerIntoView's easeTo) were changed
          // to optional-chain — the widget then renders empty instead of
          // throwing.
          if (!ensureMapboxToken()) return;
          me.map = new mapboxgl.Map({
            container: me.contentElement,
            style:     'mapbox://styles/mapbox/streets-v11',
            center:    [me.lon, me.lat],
            zoom:       me.zoom,
          });
          me.map.on('load', async () => {
            if (me.isDestroying) return;
            await me.eventStore.project.commitAsync();
            me._onStoreChange({ action: 'dataset', records: me.eventStore.records });
            // Drop resource markers (where each unit physically is) after
            // events have rendered. Independent layer; focus() can hide
            // both at once.
            me.renderResourceMarkers();
          });
          me.eventStore.on('change', me._onStoreChange, me);
          me.timeAxis.on('reconfigure', me._onTimeAxisReconfigure, me);
        }

        async _onStoreChange(event) {
          await this.eventStore.project.commitAsync();
          switch (event.action) {
            case 'dataset':
              this._removeAllMarkers();
              event.records.forEach(r => this._addMarker(r));
              break;
            case 'add':
              event.records.forEach(r => this._addMarker(r));
              break;
            case 'remove':
              event.records.forEach(r => this._removeMarker(r));
              break;
            case 'update':
              this._removeMarker(event.record);
              this._addMarker(event.record);
              break;
            case 'filter': {
              const rendered = [];
              this.eventStore.query(r => r.marker, true).forEach(r => {
                if (!event.records.includes(r)) { this._removeMarker(r); }
                else { rendered.push(r); }
              });
              event.records.forEach(r => { if (!rendered.includes(r)) this._addMarker(r); });
              break;
            }
          }
        }

        _onTimeAxisReconfigure() {
          this.eventStore.forEach(r => { this._removeMarker(r); this._addMarker(r); });
        }

        _addMarker(eventRecord) {
          if (!eventRecord.address) return;
          const { lat, lon } = eventRecord.address;
          if (!lat || !lon) return;
          if (!this.timeAxis.isTimeSpanInAxis(eventRecord)) return;

          const color  = eventRecord.eventColor || '#1565C0';
          const marker = new mapboxgl.Marker({ color }).setLngLat([lon, lat]);
          const res    = eventRecord.resource || {};

          const statusColors = { booked:'#1565C0', reserved:'#E65100', mobilization:'#2E7D32', maintenance:'#757575', available:'#10b981' };
          const evtColor = statusColors[(eventRecord.name || '').toLowerCase()] || color;
          const popup = new mapboxgl.Popup({ offset: 28, maxWidth: '240px' }).setHTML(`
            <div style="font-family:var(--oj-typography-body-font-family,'Oracle Sans',sans-serif);min-width:200px;padding:2px 0;">
              <div style="display:flex;align-items:center;gap:7px;margin-bottom:8px;">
                <span style="width:10px;height:10px;border-radius:50%;background:${evtColor};flex-shrink:0;box-shadow:0 0 0 2px rgba(0,0,0,0.08);"></span>
                <span style="font-size:13px;font-weight:700;color:#161616;">${res.equipment_id || res.name || '—'}</span>
              </div>
              <div style="font-size:11px;color:#565656;margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid #e0e0e0;">
                ${res.equipment_name || ''}${res.equipment_class ? ' · ' + res.equipment_class : ''}
              </div>
              <div style="display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:11px;line-height:1.7;">
                <span style="color:#9ca3af;text-transform:uppercase;font-size:10px;font-weight:600;">Event</span>
                <span style="font-weight:600;color:${evtColor};">${eventRecord.name || '—'}</span>
                <span style="color:#9ca3af;text-transform:uppercase;font-size:10px;font-weight:600;">Location</span>
                <span style="color:#374151;">${eventRecord.shortAddress || res.location || '—'}</span>
              </div>
            </div>
          `);

          marker.setPopup(popup);
          this._registerPopup(popup);
          marker.getElement().id = 'mkr-' + eventRecord.id;
          marker.getElement().style.cursor = 'pointer';
          eventRecord.marker = marker;
          marker.eventRecord = eventRecord;
          marker.addTo(this.map);
        }

        // Ensures only ONE popup is open at a time. Any popup registered
        // here will close the previously-open popup when it opens.
        _registerPopup(popup) {
          popup.on('open', () => {
            if (this._openPopup && this._openPopup !== popup && this._openPopup.isOpen()) {
              this._openPopup.remove();
            }
            this._openPopup = popup;
          });
          popup.on('close', () => {
            if (this._openPopup === popup) this._openPopup = null;
          });
        }

        _closeOpenPopup() {
          if (this._openPopup && this._openPopup.isOpen()) {
            this._openPopup.remove();
          }
          this._openPopup = null;
        }

        _removeMarker(eventRecord) {
          if (eventRecord.marker) {
            eventRecord.marker.popup?.remove();
            eventRecord.marker.remove();
            eventRecord.marker = null;
          }
        }

        _removeAllMarkers() {
          this.eventStore.forEach(r => this._removeMarker(r));
        }

        // ── Resource markers (where each unit physically is) ──────────────
        // Independent of event markers. One green pin per serial-ref with a
        // valid currentLocationId. Resources sharing the same lat/long are
        // jittered in a tight ring so each unit remains individually pinned
        // and clickable (no cluster collapsing).
        //
        // Tracking:
        //   this._resourceMarkers   = Map<resourceId, mapboxgl.Marker>
        //   this._resourceMarkerList = Array<mapboxgl.Marker>   // for show/hide
        //   this._focusedResourceId = id of currently focused resource (or null)

        renderResourceMarkers() {
          if (!this.resourceStore) return;
          this._removeAllResourceMarkers();

          // Group resources sharing a rounded lat/long key so we can spread
          // overlapping pins in a small ring. ~4 decimals ≈ 11 m granularity.
          const sameLocGroups = new Map(); // key → [resource, ...]
          const resourcesWithLoc = [];
          this.resourceStore.forEach(res => {
            if (res.latitude == null || res.longitude == null) return;
            const lat = Number(res.latitude);
            const lon = Number(res.longitude);
            if (isNaN(lat) || isNaN(lon)) return;
            resourcesWithLoc.push({ res, lat, lon });
            const key = lat.toFixed(4) + ',' + lon.toFixed(4);
            if (!sameLocGroups.has(key)) sameLocGroups.set(key, []);
            sameLocGroups.get(key).push(res);
          });

          this._resourceMarkers    = new Map();
          this._resourceMarkerList = [];

          // For each group, build a per-resource offset map. Solo resources
          // get the exact lat/long. Resources sharing a spot get arranged on
          // a small ring (~10 m radius) so they don't all stack visually.
          const offsetByResId = new Map();
          sameLocGroups.forEach(group => {
            if (group.length === 1) {
              offsetByResId.set(group[0].id, { dLat: 0, dLon: 0 });
              return;
            }
            const RADIUS_DEG = 0.00009; // ~10 m, easily visible at zoom 14+
            group.forEach((res, i) => {
              const angle = (2 * Math.PI * i) / group.length;
              offsetByResId.set(res.id, {
                dLat: RADIUS_DEG * Math.cos(angle),
                dLon: RADIUS_DEG * Math.sin(angle)
              });
            });
          });

          resourcesWithLoc.forEach(({ res, lat, lon }) => {
            const off = offsetByResId.get(res.id) || { dLat: 0, dLon: 0 };
            const finalLat = lat + off.dLat;
            const finalLon = lon + off.dLon;

            const el = document.createElement('div');
            el.className = 'eqp-resource-pin';
            el.style.cssText =
              'width:14px;height:14px;border-radius:50%;background:#10b981;' +
              'border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.4);cursor:pointer;';
            // Native browser tooltip — shows equipment name on hover. No
            // extra DOM, no z-index fights with the map canvas.
            el.title = res.equipment_name || res.serial_number || '';

            const marker = new mapboxgl.Marker({ element: el })
              .setLngLat([finalLon, finalLat])
              .addTo(this.map);

            const popup = new mapboxgl.Popup({ offset: 18, maxWidth: '240px' }).setHTML(
              `<div style="font-family:var(--oj-typography-body-font-family,'Oracle Sans',sans-serif);min-width:200px;padding:2px 0;">
                <div style="font-size:13px;font-weight:700;color:#161616;margin-bottom:6px;">
                  ${res.equipment_name || '—'}
                </div>
                <div style="font-size:11px;color:#565656;margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid #e0e0e0;">
                  ${res.serial_number || ''}${res.equipment_class ? ' · ' + res.equipment_class : ''}
                </div>
                <div style="display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:11px;line-height:1.7;">
                  <span style="color:#9ca3af;text-transform:uppercase;font-size:10px;font-weight:600;">Location</span>
                  <span style="color:#374151;">${res.location || '—'}</span>
                  ${res.location_code ? `<span style="color:#9ca3af;text-transform:uppercase;font-size:10px;font-weight:600;">Yard</span><span style="color:#374151;">${res.location_code}</span>` : ''}
                </div>
              </div>`
            );
            marker.setPopup(popup);
            this._registerPopup(popup);

            this._resourceMarkers.set(res.id, marker);
            this._resourceMarkerList.push(marker);
          });
        }

        _removeAllResourceMarkers() {
          if (this._resourceMarkerList) {
            this._resourceMarkerList.forEach(m => {
              m.popup?.remove();
              m.remove();
            });
          }
          this._resourceMarkers    = new Map();
          this._resourceMarkerList = [];
        }

        // ── Focus on one resource: fly+zoom, hide every other marker
        // (resource pins, cluster pins, and event pins). Calling with null
        // restores everything to visible.
        focusOnResource(resource) {
          if (!resource) { this._restoreAllMarkers(); return; }
          const marker = this._resourceMarkers ? this._resourceMarkers.get(resource.id) : null;
          if (!marker) {
            // No physical location for this resource — just restore default state.
            this._restoreAllMarkers();
            return;
          }
          // Close any open popup before flying — user navigated away from it.
          this._closeOpenPopup();
          this._focusedResourceId = resource.id;

          // Hide every resource pin except the focused one.
          if (this._resourceMarkers) {
            this._resourceMarkers.forEach((m, id) => {
              m.getElement().style.display = (id === resource.id) ? '' : 'none';
            });
          }
          // Hide every event marker.
          if (this.eventStore) {
            this.eventStore.forEach(r => {
              if (r.marker) r.marker.getElement().style.display = 'none';
            });
          }

          const ll = marker.getLngLat();
          this.map?.flyTo({ center: [ll.lng, ll.lat], zoom: Math.max(this.map.getZoom(), 14) });
        }

        _restoreAllMarkers() {
          // Deselect — also dismiss any open popup since the user moved on.
          this._closeOpenPopup();
          this._focusedResourceId = null;
          if (this._resourceMarkerList) {
            this._resourceMarkerList.forEach(m => { m.getElement().style.display = ''; });
          }
          if (this.eventStore) {
            this.eventStore.forEach(r => {
              if (r.marker) r.marker.getElement().style.display = '';
            });
          }
        }

        scrollMarkerIntoView(eventRecord) {
          if (eventRecord.marker) this.map?.easeTo({ center: eventRecord.marker.getLngLat() });
        }

        showTooltip(eventRecord, centerAtMarker) {
          if (centerAtMarker) this.scrollMarkerIntoView(eventRecord);
          eventRecord.marker?.togglePopup();
        }

        onResize() { this.map?.resize(); }

        doDestroy() {
          this.eventStore.un('change', this._onStoreChange, this);
          this.timeAxis.un('reconfigure', this._onTimeAxisReconfigure, this);
          this._removeAllMarkers();
          this._removeAllResourceMarkers();
          this.map?.remove();
          super.doDestroy();
        }
      }

      EqpMapPanel.initClass();

      // ── Scheduler ──────────────────────────────────────────────────────────
      this._scheduler = null; // reset before creating new instance
      const schedule = this._scheduler = new schedulerPro.Scheduler({
        insertFirst: 'eqp-main',
        flex: 5,

        startDate,
        endDate,

        rowHeight:  50,
        barMargin:  5,
        eventColor: null,
        eventStyle: null,

        hideHorizontalScrollbar: false,

        viewPreset: {
          base:      'dayAndMonth',
          tickWidth: 18,
        },

        tbar: [
          { type: 'widget', cls: 'widget-title', html: '<b>Schedule View</b>', flex: 1 },
          // MONTH VIEW BUTTON REMOVED - the Bryntum Calendar bundle it opens
          // (resources/js/calendar.umd.js, 5.1 MB) was deleted because it
          // broke the CI build: VBCS transpiles every .js under the webApp
          // through Babel, and that one file alone retains ~1.3 GB of heap
          // against a ~2.0 GB ceiling. It was also an unlicensed TRIAL build
          // that injected a Google Analytics tag. openMonthAgenda() below is
          // kept but inert; restore this button when a licensed, transpile-
          // safe Calendar bundle is available.
          {
            type:     'datefield',
            ref:      'dateField',
            width:    190,
            editable: false,
            value:    today,
            step:     1,
            onChange({ value, userAction }) {
              if (userAction) {
                schedule.scrollToDate(DH.set(value, 'hour', 12), { block: 'center', animate: 500 });
              }
            },
          },
        ],

        features: {
          filterBar:   false,
          eventEdit:   false,
          eventResize: false,
          eventDrag:   false,
          // Disable all paths that let the user create an event from the UI.
          // The schedule is read-only — bookings come from request lines, not
          // from user click/drag/right-click on empty schedule cells.
          eventDragCreate: false,   // click-drag on empty cell → creates "New event"
          scheduleMenu:    false,   // right-click on empty cell → "Add event" menu
          eventMenu: {
            items: {
              deleteEvent: false, editEvent: false,
              copyEvent:   false, cutEvent:  false, splitEvent: false,
            },
          },
          eventTooltip: {
            template: ({ eventRecord }) => {
              const res = eventRecord.resource || {};
              return `
                <div style="font-size:13px;min-width:260px;">
                  <div style="font-weight:700;font-size:14px;margin-bottom:6px;">
                    ${res.equipment_id || res.name || '—'}
                    <span style="font-weight:400;color:#6b7280;"> · ${res.equipment_name || ''}</span>
                  </div>
                  <div style="display:grid;grid-template-columns:auto 1fr;gap:3px 10px;line-height:1.7;">
                    <span style="color:#6b7280;font-size:11px;">EVENT</span>        <span style="font-weight:600;">${eventRecord.name}</span>
                    ${eventRecord.allocStatus === 'MAINTENANCE'
                      // A maintenance bar is a Fusion work order, not a booking:
                      // it has no project or task. Its type and description ride
                      // in the same two fields (so the bar needs no separate
                      // template), so only the LABELS change here — captioning a
                      // work-order type as "PROJECT" would be plainly wrong.
                      // WORK ORDER is the NUMBER — the bar itself now just says
                      // "Maintenance", so this is the only place the identifier
                      // appears.
                      // "WO TYPE", not "TYPE": the block below already has a
                      // TYPE row for the equipment's owner_type, and two rows
                      // with the same label meaning different things is worse
                      // than a slightly clumsy one.
                      ? `<span style="color:#6b7280;font-size:11px;">WORK ORDER</span> <span>${eventRecord.workOrderNumber || '—'}</span>
                         <span style="color:#6b7280;font-size:11px;">WO TYPE</span>    <span>${eventRecord.projectName || '—'}</span>
                         <span style="color:#6b7280;font-size:11px;">DETAIL</span>     <span>${eventRecord.taskName || '—'}</span>`
                      : `<span style="color:#6b7280;font-size:11px;">PROJECT</span>    <span>${eventRecord.projectName || '—'}</span>
                         <span style="color:#6b7280;font-size:11px;">TASK</span>       <span>${eventRecord.taskName || '—'}</span>`}
                    <span style="color:#6b7280;font-size:11px;">START</span>        <span>${eventRecord.lblStartDate || '—'}</span>
                    <span style="color:#6b7280;font-size:11px;">END</span>          <span>${eventRecord.lblEndDate || '—'}</span>
                    <span style="color:#6b7280;font-size:11px;">CLASS</span>        <span>${(res.equipment_class || '—').replace(/_/g,' ')}</span>
                    <span style="color:#6b7280;font-size:11px;">TYPE</span>         <span>${res.owner_type || '—'}</span>
                    <span style="color:#6b7280;font-size:11px;">SERIAL</span>       <span>${res.serial_number || '—'}</span>
                    <span style="color:#6b7280;font-size:11px;">MANUFACTURER</span> <span>${res.manufacturer || '—'}</span>
                    <span style="color:#6b7280;font-size:11px;">LOCATION</span>     <span>${res.location || eventRecord.shortAddress || '—'}</span>
                  </div>
                </div>
              `;
            },
          },
        },

        columns: [{
          text:       'Equipment',
          width:      220,
          htmlEncode: false,
          renderer:   ({ record }) => {
            const color  = STATUS_COLORS[(record.status || '').toLowerCase()] || '#9ca3af';
            const sn     = record.serial_number || record.name || '';
            const eqName = record.equipment_name || '—';
            const cls    = record.equipment_class || '';
            const sub    = sn ? (cls ? `${sn} · ${cls}` : sn) : cls;
            // Per-row month button. A plain <button> in the renderer's HTML
            // rather than a Bryntum widget column: the renderer returns a
            // string, so there is nowhere to attach a handler — the click is
            // picked up by the cellClick listener below, which tests the event
            // target. That also keeps it to one column instead of stealing
            // width for a second.
            return `
              <div class="eqp-resource-cell">
                <div class="eqp-status-dot" style="background:${color};"></div>
                <div style="overflow:hidden;flex:1 1 auto;">
                  <div class="eqp-resource-name">${eqName}</div>
                  <div class="eqp-resource-sn">${sub || '—'}</div>
                </div>
                <button type="button" class="eqp-cal-btn b-fa b-fa-calendar-days"
                        title="Month view for ${sn || eqName}"
                        aria-label="Month view for ${sn || eqName}"></button>
              </div>
            `;
          },
        }],

        project: {
          resourcesData: resources,
          eventsData:    events,
        },

        listeners: {
          // Per-row month button, rendered by the Equipment column above.
          // Bryntum fires cellClick with the DOM event, which is the only hook
          // available for a control a string renderer produced.
          cellClick: ({ record, target }) => {
            // `target` is a documented cellClick param (the target element),
            // alongside grid/record/column/cellElement/event.
            if (!target || !target.closest || !target.closest('.eqp-cal-btn')) return;
            // Bryntum has already selected the row by now, so the map has
            // flown to this unit — which is the right context for the popup
            // that is about to open over it.
            this.openMonthAgenda(record.id);
          },

          eventClick: ({ eventRecord }) => {
            if (eventRecord.marker) mapPanel?.showTooltip(eventRecord, true);
          },
          // Left-rail row click → focus map on that serial's location.
          // Bryntum emits selectionChange with { selection } where each item
          // is either a resource or an event record; we filter to resources
          // (event records have a resource property; resources do not).
          selectionChange: ({ selection }) => {
            // Remember the selected unit for the month popup. Computed
            // separately from the map's pick below, which additionally
            // requires a latitude — a unit with no resolved location still has
            // a perfectly good month of bookings to show.
            const pickedResource = (selection || []).find(s => s && !s.resource);
            this._selectedResourceId = pickedResource ? pickedResource.id : null;

            if (!mapPanel) return;
            const firstResource = (selection || []).find(s => s && !s.resource && s.latitude != null);
            if (firstResource) {
              mapPanel.focusOnResource(firstResource);
            } else if (!selection || selection.length === 0) {
              // Selection cleared → restore all markers.
              mapPanel._restoreAllMarkers();
            }
          },
        },
      });

      // ── Splitter ───────────────────────────────────────────────────────────
      new schedulerPro.Splitter({ appendTo: 'eqp-main' });

      // ── Map Panel ──────────────────────────────────────────────────────────
      let mapPanel;

      mapPanel = new EqpMapPanel({
        appendTo:      'eqp-main',
        flex:          2,
        eventStore:    schedule.eventStore,
        resourceStore: schedule.resourceStore,
        timeAxis:      schedule.timeAxis,
        // Default map center: Houston metro. Most fleet activity is in the
        // Houston area, so the map opens with the relevant region in view.
        lat:           29.7604,
        lon:           -95.3698,
        zoom:          9,
        listeners: {
          markerclick: async ({ eventRecord }) => {
            await schedule.scrollEventIntoView(eventRecord, { animate: true, highlight: true });
            schedule.selectedEvents = [eventRecord];
          },
        },
      });

      // Update asset count
      const countEl = document.getElementById('eqpAssetCount');
      if (countEl) countEl.textContent = resources.length + ' assets';
    }

    // Called from initSchedulerChain with resources/events built by buildResourcesAndEvents.
    // startDate/endDate are precomputed by the builder so the window covers historical bookings.
    initScheduler(resources, events, startDate, endDate) {
      if (!resources || resources.length === 0) return;

      // Compute label dates on events (defensive — builder already sets these)
      (events || []).forEach(ev => {
        if (ev.startDate && !ev.lblStartDate) {
          const eDate = new Date(ev.startDate);
          eDate.setDate(eDate.getDate() + (ev.duration || 1) - 1);
          ev.lblStartDate = this.setDateFormat(ev.startDate);
          ev.lblEndDate   = this.setDateFormat(eDate.toISOString().split('T')[0]);
        }
      });

      if (!startDate) {
        startDate = new Date();
        startDate.setDate(1);
      }
      if (!endDate) {
        endDate = new Date(startDate);
        endDate.setFullYear(endDate.getFullYear() + 3);
      }

      this._buildScheduler(resources, events || [], startDate, endDate);

      // ── Open on the CURRENT month, not on the oldest booking ──────────────
      // The scheduler's time axis deliberately starts at the earliest booking
      // (min(today, earliest) — see buildResourcesAndEvents) so historical bars
      // remain reachable by scrolling. But the VIEWPORT then opens at that edge
      // too, which is why the chart landed on September 2024: the range was
      // right, the scroll position was wrong.
      //
      // Fixing it by moving startDate to today would truncate every past
      // booking, so scroll instead — the range keeps its full span and the user
      // simply starts where the work is. line-detail-page opens on the current
      // month for the same reason; it just gets there by building a window
      // around today rather than by scrolling.
      //
      // Same call the toolbar's date picker already makes (see the datefield's
      // onChange), so the initial position and a manual "jump to date" behave
      // identically. `block: 'start'` puts today at the left edge, which reads
      // as "today onward" — 'center' would waste half the viewport on the past.
      //
      // Deferred a tick: scrollToDate needs the scheduler laid out, and this
      // runs immediately after construction. Failure is non-fatal — the chart
      // still works, it just opens at the old position.
      const schedule = this._scheduler;
      if (schedule) {
        setTimeout(() => {
          try {
            const today = new Date();
            today.setHours(12, 0, 0, 0);   // midday: avoids DST edges at 00:00
            schedule.scrollToDate(today, { block: 'start', animate: false });
          } catch (e) {
            console.warn('[equipment-schedule] could not scroll to today', e);
          }
        }, 0);
      }
    }

    // ── Month-agenda popup ───────────────────────────────────────────────
    //
    // Opens the Bryntum Calendar month view for one unit, in a modal dialog.
    // The calendar runs inside an iframe because Calendar 7.3.6 and the
    // Scheduler Pro 6.1.1 driving this page cannot coexist in one document —
    // monthAgendaPopup.js documents why in full.
    //
    // No REST calls: the popup is built from the scheduler's own stores, which
    // initSchedulerChain already filled on page enter. Because resourceStore
    // honours the smart-search filter, the unit picker inside the popup shows
    // whatever the rail is currently showing.
    // resourceId: which unit to open on. Passed by the per-row calendar
    // button; omitted by the toolbar button, which falls back to whatever row
    // is selected.
    openMonthAgenda(resourceId) {
      // DISABLED. resources/js/calendar.umd.js was removed (see the toolbar
      // note above); without it the iframe would load a 404 and render blank.
      // The rest of this method is left intact (including the per-row
      // resourceId param added alongside it) so restoring the feature is
      // putting a licensed bundle back and deleting this guard.
      console.warn('[equipment-schedule] month agenda is disabled - the Bryntum Calendar bundle was removed from the build');
      return;

      // eslint-disable-next-line no-unreachable
      const wanted = (resourceId !== undefined && resourceId !== null)
        ? resourceId
        : this._selectedResourceId;
      const schedule = this._scheduler;
      const dialog   = document.getElementById('eqpMonthAgendaDialog');
      const frame    = document.getElementById('eqpMonthAgendaFrame');
      if (!schedule || !dialog || !frame) return;

      // Revoke any URL from a previous open before replacing it; each open
      // builds a fresh document so the popup reflects the current filter and
      // selection.
      this._revokeMonthAgendaUrl();

      try {
        this._monthAgendaUrl = monthAgendaPopup.createUrl(
          schedule.resourceStore, schedule.eventStore, wanted
        );
      } catch (e) {
        console.warn('[equipment-schedule] could not build the month agenda', e);
        return;
      }

      frame.src = this._monthAgendaUrl;

      // Bound once, not per open: ojClose fires on the same element every time,
      // and re-adding the listener on each open would revoke the URL as many
      // times as the dialog had been opened.
      if (!this._monthAgendaCloseBound) {
        this._monthAgendaCloseBound = true;

        dialog.addEventListener('ojClose', () => {
          // Blank the frame first. Revoking a blob URL that a live document is
          // still loading from can abort mid-parse and log a console error.
          frame.src = 'about:blank';
          this._revokeMonthAgendaUrl();
        });
      }

      if (typeof dialog.open === 'function') dialog.open();
    }

    _revokeMonthAgendaUrl() {
      if (!this._monthAgendaUrl) return;
      try {
        URL.revokeObjectURL(this._monthAgendaUrl);
      } catch (e) { /* already gone — nothing to clean up */ }
      this._monthAgendaUrl = null;
    }

    // Called by ScheduleFilterChain when the smart-search filterCriterion changes.
    // Filters Bryntum resourceStore rows in-place — no re-render needed.
    filterScheduler(filterCriterion) {
      const scheduler = this._scheduler;
      if (!scheduler) return;

      const store = scheduler.resourceStore;

      // No active criterion — show all
      if (!filterCriterion ||
          (Array.isArray(filterCriterion.criteria) && filterCriterion.criteria.length === 0) ||
          (filterCriterion.$tag === '_root_' && Array.isArray(filterCriterion.criteria) && filterCriterion.criteria.length === 0)) {
        store.clearFilters();
        return;
      }

      const matchesCriterion = (resource, criterion) => {
        if (!criterion) return true;

        // Keyword text search
        if (criterion.text && criterion.matchBy === 'phrase') {
          const words = criterion.text.toLowerCase().split(/\s+/).filter(w => w);
          const haystack = [
            resource.serial_number, resource.equipment_id, resource.equipment_name,
            resource.equipment_class, resource.equipment_subclass,
          ].join(' ').toLowerCase();
          return words.some(w => haystack.includes(w));
        }

        // $eq flat: { op:'$eq', attribute:'field', value:'val' }
        if (criterion.op === '$eq' && criterion.attribute) {
          return String(resource[criterion.attribute] || '').toLowerCase() ===
                 String(criterion.value || '').toLowerCase();
        }

        // $eq nested: { op:'$eq', value:{ field:'val' } }
        if (criterion.op === '$eq' && criterion.value && typeof criterion.value === 'object' && !Array.isArray(criterion.value)) {
          const attr = Object.keys(criterion.value)[0];
          return attr ? String(resource[attr] || '').toLowerCase() ===
                        String(criterion.value[attr] || '').toLowerCase() : true;
        }

        // $and compound
        if (criterion.op === '$and' && Array.isArray(criterion.criteria)) {
          return criterion.criteria.every(sub => matchesCriterion(resource, sub));
        }

        // $or compound
        if (criterion.op === '$or' && Array.isArray(criterion.criteria)) {
          return criterion.criteria.some(sub => matchesCriterion(resource, sub));
        }

        return true;
      };

      store.filter({
        filters: resource => {
          if (filterCriterion.$tag === '_root_' && Array.isArray(filterCriterion.criteria)) {
            return filterCriterion.criteria.every(c => matchesCriterion(resource, c));
          }
          return matchesCriterion(resource, filterCriterion);
        },
        replace: true,
      });
    }

    // Called by searchActionChain once a dedicated schedule endpoint is wired up
    alterResp(resp) {
      if (!resp || resp.length === 0) return;

      const mainEl = document.getElementById('eqp-main');
      if (mainEl) mainEl.innerHTML = '';

      const uniqEquipment = [];
      const resources     = [];
      const events        = [];
      let   startDate     = new Date();
      let   endDate       = new Date(new Date().setMonth(new Date().getMonth() + 1));
      let   eventIdSeq    = 1;

      resp.forEach((item, indx) => {
        if (uniqEquipment.indexOf(item.equipment_number) === -1) {
          uniqEquipment.push(item.equipment_number);
          resources.push({
            id:               indx + 1,
            name:             item.equipment_number,
            equipment_id:     item.equipment_number,
            equipment_name:   item.equipment_name,
            equipment_class:  item.equipment_class  || '',
            serial_number:    item.equipment_number,
            status:           (item.type || 'available').toLowerCase(),
            owner_type:       item.equipment_resource_class || '',
            location:         item.location || item.city || '',
            latitude:         item.latitude,
            longitude:        item.longitude,
          });
        }
        if (item.crew_start_date) startDate = new Date(item.crew_start_date);
        if (item.crew_end_date)   endDate   = new Date(item.crew_end_date);
      });

      resources.forEach(res => {
        resp.forEach(item => {
          if (res.equipment_id !== item.equipment_number) return;

          let eventColor = '#9ca3af';
          if      (item.type === 'Booked')       eventColor = '#1565C0';
          else if (item.type === 'maintenance')   eventColor = '#757575';
          else if (item.type === 'Reserved')      eventColor = '#E65100';
          else if (item.type === 'Mobilization')  eventColor = '#2E7D32';
          else if (item.type === 'Available')     eventColor = '#10b981';

          const s = item.equipment_start_date ? item.equipment_start_date.split('T')[0] : null;
          const e = item.equipment_end_date   ? item.equipment_end_date.split('T')[0]   : null;
          const dur = (s && e)
            ? Math.round(Math.abs(new Date(e) - new Date(s)) / 86400000) + 1
            : 1;

          events.push({
            id:           eventIdSeq++,
            resourceId:   res.id,
            name:         item.type || 'Unassigned',
            projectName:  item.project_name,
            taskName:     item.task_name,
            shortAddress: item.city || item.location || '',
            lblStartDate: s ? this.setDateFormat(s) : '—',
            lblEndDate:   e ? this.setDateFormat(e) : '—',
            startDate:    s,
            duration:     dur,
            eventColor,
            address: {
              lat: item.latitude  ? parseFloat(String(item.latitude).split('° N')[0])  : null,
              lon: item.longitude ? parseFloat(String(item.longitude).split('° W')[0]) : null,
            },
          });
        });
      });

      this._buildScheduler(resources, events, startDate, endDate);
    }
  }

  return PageModule;
});
