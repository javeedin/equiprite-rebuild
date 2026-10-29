define(['schedulerPro', 'mapboxgl', 'resources/js/bryntumDates'], (schedulerPro, mapboxgl, bryntumDates) => {
  'use strict';

  const MAPBOX_TOKEN = 'pk.eyJ1IjoicmFodWxqYW1hbGFwdXJhbSIsImEiOiJjbXNkYngyeDcwNGN4MzVwdmRkMHRmN2ppIn0.P7EFTLmcAsXXammLSgF3Qw';

  // Token applied LAZILY and GUARDED, matching equipment-schedule-page.js.
  //
  // The top-level version this replaces was already null-safe for the
  // ASSIGNMENT, so it never threw during module load. What it did not do was
  // stop `new mapboxgl.Map(...)` in construct() below from running anyway when
  // the module was missing — the warning was logged and the code carried on to
  // dereference undefined a moment later.
  //
  // Mapbox GL's UMD wrapper takes its AMD branch under require.js
  // (`typeof define === 'function' && define.amd ? define(factory) : …`), so it
  // never sets window.mapboxgl. Fine here — app-flow.json path-maps
  // 'mapboxgl' → resources/js/mapbox-gl, so the injected argument IS the module
  // — but if that resolution ever fails (file absent from a standalone export,
  // a 404, a CSP block on the chunk) the argument arrives undefined.
  //
  // Returning false lets construct() bail, so a broken map degrades to a panel
  // without a map instead of taking the page module down with it.
  function ensureMapboxToken() {
    if (!mapboxgl) {
      console.warn('[line-detail] mapboxgl module did not load — map panel will be skipped.');
      return false;
    }
    if (!mapboxgl.accessToken) mapboxgl.accessToken = MAPBOX_TOKEN;
    return true;
  }

  // STATUS_COLORS keyed to derived UI status (set in vbEnterChain mapping)
  const STATUS_COLORS = {
    available: '#10b981',
    allocated_to_this_line: '#0891b2',
    allocated_elsewhere: '#9ca3af',
    in_service: '#1565C0',
    maintenance: '#9ca3af',
    retired: '#9ca3af',
  };

  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  class PageModule {

    constructor(context) {
      this._context = context;
      // Page modules CANNOT write $page.variables via context.variables — that
      // write is inert and never reaches KO bindings (the Save button + progress
      // circle were the casualties). Fire a custom page event instead; a
      // registered chain (StagingChangedChain) writes the variables from its
      // writable $page. See getEventHelper()/fireCustomEvent — Oracle's
      // sanctioned page-module → page-variable channel.
      this._eventHelper = (context && typeof context.getEventHelper === 'function')
        ? context.getEventHelper()
        : null;
      this._scheduler = null;
      this._mapPanel = null;
      this._allResources = [];
      this._allEvents = [];

      // 'serial' (default) or 'lot' — set by initScheduler. Drives column
      // headers, cell renderer, capacity math, and the assignment payload.
      this._mode = 'serial';

      // Allocation state — kept inside the page module (NOT in $page.variables,
      // because the constructor `context` does not expose .variables for read).
      this._lineData = null;
      this._allocatedSerials = [];   // server-confirmed allocations for this line
      this._pendingAssignments = [];   // staged client-side, awaiting Save
      this._pendingReleases = [];   // staged client-side, awaiting Save

      // Has THIS request been confirmed (a Transfer Order exists)? Set by
      // initScheduler from vbEnterChain. Sticky: rebuilds from re-scope / save
      // chains omit the flag and keep the last-known value. When true the
      // picker is read-only — no Assign, no Release (allocations are Booked,
      // not just Reserved). Only before confirm can the user edit qty / unassign.
      this._confirmed = false;

      // Independent read-only reason (does NOT affect bar colour like _confirmed
      // does). Set true when the request is CUSTOMER-sourced and still at
      // UNDER_PROCUREMENT: the picker is viewable but Assign/Release are hidden.
      // Sticky, same as _confirmed — only the load path (initScheduler from
      // vbEnterChain) passes it; re-scope/save rebuilds omit it and keep it.
      this._pickerReadOnly = false;

      // Per-unit maintenance child-asset check, keyed by resourceId:
      // 'CHECKING' while CheckChildAssetsChain runs, 'CLEAR' once it found no
      // children or the user acknowledged them. Session-only by design.
      this._childCheck = {};

      this.currentYear = new Date().getFullYear();
      this.currentMonth = new Date().getMonth();

      this.initScheduler = this.initScheduler.bind(this);
      this.prevMonth = this.prevMonth.bind(this);
      this.nextMonth = this.nextMonth.bind(this);
      this.goToday = this.goToday.bind(this);
      this.toggleFilters = this.toggleFilters.bind(this);
      this.applyFilters = this.applyFilters.bind(this);
      this.onAdjustDates = this.onAdjustDates.bind(this);
      this.isSerialMode = this.isSerialMode.bind(this);
      this.applySerialStatuses = this.applySerialStatuses.bind(this);
      this.getStagedChanges = this.getStagedChanges.bind(this);
      this.getRebuildContext = this.getRebuildContext.bind(this);
      this.resetStaging = this.resetStaging.bind(this);
      this.completeStageAssign = this.completeStageAssign.bind(this);
      this.childCheckShown = this.childCheckShown.bind(this);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Public — called by saveLineChain to read what's staged.
    // `mode` is included because lot and inventory staging records have
    // identical shape ({lotRefId, lotNumber, qty}) — the chain needs to
    // know whether to call lot endpoints or inventory endpoints.
    // ─────────────────────────────────────────────────────────────────────
    getStagedChanges() {
      return {
        mode:               this._mode,
        pendingAssignments: this._pendingAssignments.slice(),
        pendingReleases:    this._pendingReleases.slice(),
      };
    }

    // Context a re-scope chain (e.g. RescopeYardChain) needs to rebuild the
    // picker from a fresh line-detail-units fetch without re-deriving mode or
    // re-reading $page.variables. Mode + name/class were resolved on load.
    getRebuildContext() {
      return {
        mode:          this._mode,
        eqpMasterId:   this._lineData && this._lineData.equipment_master_id,
        eqpInfo: {
          equipmentName: (this._lineData && this._lineData.equipment_name) || '',
          className:     (this._lineData && this._lineData.class)          || '',
        },
        lineData:      this._lineData,
      };
    }

    // ─────────────────────────────────────────────────────────────────────
    // Public — called by saveLineChain after a successful Save
    // ─────────────────────────────────────────────────────────────────────
    resetStaging() {
      this._pendingAssignments = [];
      this._pendingReleases = [];
      this._updateAllocationProgress();
    }

    // ─────────────────────────────────────────────────────────────────────
    // Entry point — called by vbEnterChain
    //   mode: 'serial' (default), 'lot', or 'inventory'.
    //   - 'lot':       allocatedSerials carries lot allocations
    //                  {allocationId, lotRefId, lotNumber, allocatedQty, status}.
    //   - 'inventory': same UI shape as lot (qty stepper per row). The
    //                  resource fetch is NOT wired yet — vbEnterChain
    //                  currently passes an empty resources array so the
    //                  page shows the empty-state placeholder.
    // The serial vs lot/inventory branching is localized inside this
    // module's renderer / staging methods.
    // ─────────────────────────────────────────────────────────────────────

    // Resolve a page element by id, tolerant of DUPLICATE ids across cached
    // pages. VB keeps prior page-instance DOMs in the document, so navigating
    // in/out of line-detail repeatedly leaves several '#ld-main' (and sibling)
    // nodes present at once. document.getElementById returns the FIRST match —
    // usually a stale, hidden one — so the imperative Bryntum scheduler ends up
    // built into an off-screen element and the visible page looks empty (only
    // after the 2nd/3rd to-and-fro, once duplicates exist). Pick the VISIBLE
    // element instead (offsetParent is null for display:none subtrees); fall
    // back to the last (newest) match.
    _visibleEl(id) {
      const all = document.querySelectorAll('#' + id);
      if (all.length <= 1) return all[0] || null;
      for (let i = 0; i < all.length; i++) {
        if (all[i].offsetParent !== null) return all[i];
      }
      return all[all.length - 1] || null;
    }

    initScheduler(resources, events, lineData, allocatedSerials, mode, confirmed, readOnly) {
      this._mode = (mode === 'lot' || mode === 'inventory') ? mode : 'serial';
      this._allResources = resources || [];
      this._allEvents = events || [];
      this._lineData = lineData || null;
      this._allocatedSerials = allocatedSerials || [];
      this._pendingAssignments = [];
      this._pendingReleases = [];
      // Sticky: only the load path (vbEnterChain) passes this. Re-scope / save
      // rebuilds omit it and preserve the value resolved on entry.
      if (confirmed !== undefined) this._confirmed = !!confirmed;
      if (readOnly !== undefined) this._pickerReadOnly = !!readOnly;

      console.log('[line-detail] initScheduler mode=', this._mode,
        'resources=', this._allResources.length,
        'events=', this._allEvents.length,
        'allocated=', this._allocatedSerials.length,
        'lineData=', lineData);

      // Open the gantt on the current (today's) month so users see the
      // present-day timeline first. The constructor already initialises
      // currentYear/currentMonth to today — keep them; don't override
      // from lineData.start_date.

      this._updateMonthLabel();
      // Seeds allocationPercent + saveEnabled from the freshly-loaded state.
      // With nothing staged, saveEnabled=false → the header's primary-action
      // (display bound to $variables.saveEnabled) renders Save disabled.
      this._updateAllocationProgress();

      // If the API returned no resources, render a clear empty-state instead
      // of an invisible empty Bryntum grid. The user immediately knows
      // the page loaded but there are simply no serial / lot / inventory
      // refs for this master.
      if (!this._allResources.length) {
        const mainEl = this._visibleEl('ld-main');
        if (mainEl) {
          const eqName  = (lineData && lineData.equipment_name) || 'this equipment';
          let noun, refKind, extra;
          if (this._mode === 'lot') {
            noun = 'lot numbers'; refKind = 'lot-refs'; extra = '';
          } else if (this._mode === 'inventory') {
            noun = 'inventory items'; refKind = 'inventory records';
            extra = ' Inventory picker wiring is in progress — this is a placeholder for now.';
          } else {
            noun = 'serial numbers'; refKind = 'serial-refs'; extra = '';
          }
          mainEl.innerHTML =
            '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;padding:40px;text-align:center;color:var(--oj-core-text-color-secondary,#6b7280);">' +
            '<div style="font-size:42px;color:#cbd5e1;margin-bottom:12px;">&#128230;</div>' +
            '<div style="font-size:15px;font-weight:700;color:#374151;margin-bottom:6px;">No ' + noun + ' found</div>' +
            '<div style="font-size:13px;max-width:480px;">No ' + refKind + ' are registered for <strong>' + eqName +
            '</strong> (equipmentId&nbsp;<code>' + (lineData?.equipment_master_id ?? '—') +
            '</code>).' + extra + '</div>' +
            '</div>';
        }
        const countEl = this._visibleEl('ldAssetCount');
        if (countEl) {
          countEl.textContent = (this._mode === 'lot') ? '0 lots'
                              : (this._mode === 'inventory') ? '0 inventory items'
                              : '0 serials';
        }
        return;
      }

      setTimeout(() => {
        try {
          this._buildScheduler(lineData);
          console.log('[line-detail] scheduler built ok');
        } catch (err) {
          console.error('[line-detail] scheduler build failed:', err);
          const mainEl = this._visibleEl('ld-main');
          if (mainEl) {
            mainEl.innerHTML =
              '<div style="padding:24px;color:#991b1b;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;width:100%;">' +
              '<div style="font-weight:700;margin-bottom:6px;">Scheduler failed to render</div>' +
              '<div style="font-size:12px;font-family:monospace;white-space:pre-wrap;">' +
              (err && err.stack ? err.stack : String(err)) +
              '</div></div>';
          }
        }
      }, 300);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Build split-pane Bryntum Scheduler + Mapbox Map (single #ld-main)
    // ─────────────────────────────────────────────────────────────────────
    _buildScheduler(lineData) {
      const mainEl = this._visibleEl('ld-main');
      if (!mainEl) return;

      mainEl.innerHTML = '';

      if (this._scheduler) { this._scheduler.destroy(); this._scheduler = null; }
      this._mapPanel = null;

      const widgetId = Math.floor(Math.random() * 1000000);
      const DH = schedulerPro.DateHelper;

      // Initial 3-month window centered on the current month so the user
      // Open on the current month. Infinite-scroll extends backward when
      // the user scrolls toward the left edge — no pre-baked back-buffer.
      const startDate = new Date(this.currentYear, this.currentMonth, 1);
      const endDate = new Date(this.currentYear, this.currentMonth + 3, 1);

      // Hard caps so infinite-scroll can't run away if the user pins a wheel.
      const MIN_DATE = new Date(this.currentYear - 5, 0, 1);
      const MAX_DATE = new Date(this.currentYear + 5, 11, 31);
      this._scrollEdgeBusy = false;

      const reqStart = lineData?.start_date ? new Date(lineData.start_date) : null;
      // Bryntum treats endDate as exclusive — bump +1 day so the "Requested
      // period" band visually covers through the user-intended end day.
      const reqEnd = this._inclusiveEnd(lineData?.end_date);

      // ── MapPanel class (random suffix avoids "type already registered" on hot-reload) ──
      class LdMapPanel extends schedulerPro.Panel {
        static get type() { return 'ldmappanel' + widgetId; }
        static get $name() { return 'LdMapPanel'; }

        static get configurable() {
          return {
            monitorResize: true,
            zoom: 5,
            lat: 24.7,
            lon: 46.7,
            textContent: false,
            cls: 'eqp-map-panel',
            tbar: [
              {
                type: 'widget',
                cls: 'widget-title',
                html: '<span style="display:flex;align-items:center;gap:6px;"><i class="b-fa b-fa-map-location-dot" style="font-size:13px;opacity:0.85;"></i> Map View</span>',
                flex: 1,
              },
              {
                type: 'buttongroup',
                cls: 'eqp-map-style-group',
                toggleGroup: true,
                items: [
                  { ref: 'btnLight', text: 'Streets', pressed: true, onClick: 'up.onStyleLight' },
                  { ref: 'btnDark', text: 'Dark', onClick: 'up.onStyleDark' },
                  { ref: 'btnSat', text: 'Satellite', onClick: 'up.onStyleSat' },
                ],
              },
              { type: 'button', cls: 'b-fa b-fa-plus', tooltip: 'Zoom in', onClick: 'up.onZoomIn' },
              { type: 'button', cls: 'b-fa b-fa-minus', tooltip: 'Zoom out', onClick: 'up.onZoomOut' },
            ],
          };
        }

        onZoomIn() { this.map?.zoomIn(); }
        onZoomOut() { this.map?.zoomOut(); }
        onStyleLight() { this.map?.setStyle('mapbox://styles/mapbox/streets-v11'); }
        onStyleDark() { this.map?.setStyle('mapbox://styles/mapbox/dark-v11'); }
        onStyleSat() { this.map?.setStyle('mapbox://styles/mapbox/satellite-streets-v12'); }

        construct() {
          super.construct(...arguments);
          const me = this;
          // Applies the token on first use and bails if the library never
          // resolved. Returning early leaves me.map undefined, so the two
          // methods that reach for it outside this constructor (_focusMarker's
          // flyTo, scrollMarkerIntoView's easeTo) are optional-chained below.
          if (!ensureMapboxToken()) return;
          me.map = new mapboxgl.Map({
            container: me.contentElement,
            style: 'mapbox://styles/mapbox/streets-v11',
            center: [me.lon, me.lat],
            zoom: me.zoom,
          });
          me.map.on('load', async () => {
            if (me.isDestroying) return;
            await me.eventStore.project.commitAsync();
            me._onStoreChange({ action: 'dataset', records: me.eventStore.records });
            // Drop resource markers (where each unit physically is) after
            // events are rendered. Independent layer; focusOnResource() can
            // hide both at once.
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

          const color = eventRecord.eventColor || '#1565C0';
          const marker = new mapboxgl.Marker({ color }).setLngLat([lon, lat]);
          const res = eventRecord.resource || {};

          const popup = new mapboxgl.Popup({ offset: 28, maxWidth: '240px' }).setHTML(`
            <div style="font-family:var(--oj-typography-body-font-family,'Oracle Sans',sans-serif);min-width:200px;padding:2px 0;">
              <div style="display:flex;align-items:center;gap:7px;margin-bottom:8px;">
                <span style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0;box-shadow:0 0 0 2px rgba(0,0,0,0.08);"></span>
                <span style="font-size:13px;font-weight:700;color:#161616;">${res.serialNumber || res.name || '—'}</span>
              </div>
              <div style="font-size:11px;color:#565656;margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid #e0e0e0;">
                ${res.equipment_name || ''}${res.equipment_class ? ' · ' + res.equipment_class : ''}
              </div>
              <div style="display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:11px;line-height:1.7;">
                <span style="color:#9ca3af;text-transform:uppercase;font-size:10px;font-weight:600;">Event</span>
                <span style="font-weight:600;color:${color};">${eventRecord.name || '—'}</span>
                <span style="color:#9ca3af;text-transform:uppercase;font-size:10px;font-weight:600;">Location</span>
                <span style="color:#374151;">${eventRecord.shortAddress || res.location || '—'}</span>
              </div>
            </div>
          `);

          marker.setPopup(popup);
          this._registerPopup(popup);
          marker.getElement().id = 'ld-mkr-' + eventRecord.id;
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
        // jittered on a tight ring so each unit remains individually clickable.
        renderResourceMarkers() {
          if (!this.resourceStore) return;
          this._removeAllResourceMarkers();

          const sameLocGroups = new Map();
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

          const offsetByResId = new Map();
          sameLocGroups.forEach(group => {
            if (group.length === 1) {
              offsetByResId.set(group[0].id, { dLat: 0, dLon: 0 });
              return;
            }
            const RADIUS_DEG = 0.00009;
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
            el.className = 'ld-resource-pin';
            el.style.cssText =
              'width:14px;height:14px;border-radius:50%;background:#10b981;' +
              'border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.4);cursor:pointer;';
            el.title = res.equipment_name || res.serialNumber || res.name || '';

            const marker = new mapboxgl.Marker({ element: el })
              .setLngLat([finalLon, finalLat])
              .addTo(this.map);

            const popup = new mapboxgl.Popup({ offset: 18, maxWidth: '240px' }).setHTML(
              `<div style="font-family:var(--oj-typography-body-font-family,'Oracle Sans',sans-serif);min-width:200px;padding:2px 0;">
                <div style="font-size:13px;font-weight:700;color:#161616;margin-bottom:6px;">
                  ${res.equipment_name || '—'}
                </div>
                <div style="font-size:11px;color:#565656;margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid #e0e0e0;">
                  ${res.serialNumber || res.name || ''}${res.equipment_class ? ' · ' + res.equipment_class : ''}
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

        // Focus on one resource: fly+zoom, hide every other resource pin and
        // event pin. Calling with null restores everything.
        focusOnResource(resource) {
          if (!resource) { this._restoreAllMarkers(); return; }
          const marker = this._resourceMarkers ? this._resourceMarkers.get(resource.id) : null;
          if (!marker) { this._restoreAllMarkers(); return; }
          // Close any open popup before flying — user navigated away from it.
          this._closeOpenPopup();
          this._focusedResourceId = resource.id;

          if (this._resourceMarkers) {
            this._resourceMarkers.forEach((m, id) => {
              m.getElement().style.display = (id === resource.id) ? '' : 'none';
            });
          }
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

      LdMapPanel.initClass();

      // ── Scheduler ──────────────────────────────────────────────────────
      const schedule = this._scheduler = new schedulerPro.Scheduler({
        insertFirst: mainEl,
        flex: 5,

        startDate,
        endDate,

        rowHeight: 50,
        barMargin: 9,
        eventColor: null,
        eventStyle: null,

        hideHorizontalScrollbar: false,

        viewPreset: {
          base: 'dayAndMonth',
          tickWidth: 30,
        },

        features: {
          filterBar: false,
          eventEdit: false,
          eventResize: false,
          eventDrag: false,
          // Disable all paths that let the user create an event from the UI.
          // The schedule is read-only — bookings come from allocations + the
          // workbench-lines view, not from user click/drag/right-click.
          eventDragCreate: false,   // click-drag on empty cell → "New event"
          scheduleMenu:    false,   // right-click on empty cell → context menu
          // Double-click on a LEFT-RAIL cell → inline cell editor. Bryntum
          // enables cellEdit by DEFAULT, so this must be switched off explicitly
          // like the event-editing features above.
          // Why it mattered: the resource column is renderer-only (no `field`) —
          // its content is HTML built by _renderResourceCell (pill, qty stepper,
          // Assign button). Entering edit mode replaced that markup with an input
          // bound to a non-existent field, so the row visibly blanked to an empty
          // white box. No console error, because nothing threw — a different
          // cause from the renderer-throw guarded in _renderResourceCell.
          // The Yard column DOES have field:'location', so it would have opened a
          // real editor and let the yard name be edited in the local store.
          // This picker is read-only: interaction is via Assign / eventClick only.
          cellEdit: false,
          eventMenu: { items: { deleteEvent: false, editEvent: false, copyEvent: false, cutEvent: false, splitEvent: false } },

          eventTooltip: {
            template: ({ eventRecord }) => {
              const res = eventRecord.resource || {};
              const start = eventRecord.startDate?.toLocaleDateString() || '—';
              const end = eventRecord.endDate?.toLocaleDateString() || '—';
              const reqNo = eventRecord.requestNumber || '';
              const proj = eventRecord.projectName || '';
              const task = eventRecord.taskName || '';
              // Maintenance bars reuse the booking fields but mean different
              // things by them — see the labels below.
              const isMaint = eventRecord.name === 'Maintenance';
              return `
                <div style="font-size:13px; min-width:240px;">
                  <div style="font-weight:700; font-size:14px; margin-bottom:8px;">${res.serialNumber || res.name || '—'}</div>
                  <div style="display:grid; grid-template-columns:auto 1fr; gap:3px 10px; line-height:1.6;">
                    <span style="color:#6b7280; font-size:11px;">EQUIPMENT</span> <span>${res.equipment_name || '—'}</span>
                    <span style="color:#6b7280; font-size:11px;">STATUS</span>    <span style="font-weight:600;">${eventRecord.name}</span>
                    ${isMaint
                      // A maintenance bar is a Fusion work order, not a
                      // booking. Its number/type/description ride in the same
                      // three fields so the bar needs no separate template —
                      // only the LABELS change, because captioning a work-order
                      // number as "REQUEST" would be plainly wrong.
                      ? `${reqNo ? `<span style="color:#6b7280; font-size:11px;">WORK ORDER</span> <span>${reqNo}</span>` : ''}
                         ${proj ? `<span style="color:#6b7280; font-size:11px;">WO TYPE</span>    <span>${proj}</span>` : ''}
                         ${task ? `<span style="color:#6b7280; font-size:11px;">DETAIL</span>     <span>${task}</span>` : ''}`
                      : `${reqNo ? `<span style="color:#6b7280; font-size:11px;">REQUEST</span>  <span>${reqNo}</span>` : ''}
                         ${proj ? `<span style="color:#6b7280; font-size:11px;">PROJECT</span>  <span>${proj}</span>` : ''}
                         ${task ? `<span style="color:#6b7280; font-size:11px;">TASK</span>     <span>${task}</span>` : ''}`}
                    <span style="color:#6b7280; font-size:11px;">START</span>     <span>${start}</span>
                    <span style="color:#6b7280; font-size:11px;">END</span>       <span>${end}</span>
                  </div>
                </div>
              `;
            },
          },
        },

        timeRangesData: (reqStart && reqEnd) ? [{
          id: 'req-period',
          name: 'Requested period',
          startDate: reqStart,
          endDate: reqEnd,
          style: 'background: rgba(99,102,241,0.08); border-left: 2px solid #6366f1;',
        }] : [],

        columns: [{
          // Yard / inventory-org the unit physically lives in. Surfaced as its
          // own left-most column so that — with NO yard filter applied (rows
          // span every org) — the user can tell at a glance which yard each
          // unit belongs to. Data is already on the resource (location /
          // location_code, or invOrgName/invOrgCode for inventory).
          text: 'Yard',
          field: 'location',
          width: 150,
          htmlEncode: false,
          renderer: ({ record }) => this._renderYardCell(record),
        }, {
          text: (this._mode === 'lot') ? 'Lot'
              : (this._mode === 'inventory') ? 'Inventory Item'
              : 'Serial',
          width: 320,
          htmlEncode: false,
          renderer: ({ record }) => this._renderResourceCell(record),
        }],

        project: {
          resourcesData: this._allResources,
          eventsData: this._allEvents,
        },

        listeners: {
          eventClick: ({ eventRecord }) => {
            if (eventRecord.marker) this._mapPanel?.showTooltip(eventRecord, true);
            if (eventRecord.name === 'Available' && eventRecord.resource) {
              this._onStageAssign(eventRecord.resource.id);
            }
          },
          // Left-rail row click → focus map on that serial's current
          // physical location, hide all other markers. Bryntum's selection
          // can contain events too; we filter to resources (events have
          // a `resource` property; resource records don't).
          selectionChange: ({ selection }) => {
            const panel = this._mapPanel;
            if (!panel) return;
            const firstResource = (selection || []).find(s => s && !s.resource && s.latitude != null);
            if (firstResource) {
              panel.focusOnResource(firstResource);
            } else if (!selection || selection.length === 0) {
              panel._restoreAllMarkers();
            }
          },
        },
      });

      // ── Infinite horizontal scroll: extend the timeAxis when the user
      //    scrolls within 20% of either edge. Bounded by MIN_DATE/MAX_DATE.
      const EDGE_FRACTION = 0.20;
      let scrollDebounce = null;
      const onScroll = () => {
        if (scrollDebounce) return;
        scrollDebounce = setTimeout(() => {
          scrollDebounce = null;
          if (this._scrollEdgeBusy || !this._scheduler) return;

          const subGrid = this._scheduler.timeAxisSubGrid;
          if (!subGrid) return;
          const scrollable = subGrid.scrollable;
          if (!scrollable) return;

          const x = scrollable.x;
          const maxX = scrollable.maxX;
          const distFromLeft = x;
          const distFromRight = maxX - x;
          const threshold = scrollable.clientWidth * EDGE_FRACTION;

          if (distFromRight < threshold) {
            const curEnd = new Date(this._scheduler.endDate);
            const newEnd = new Date(curEnd.getFullYear(), curEnd.getMonth() + 1, 1);
            if (newEnd <= MAX_DATE) {
              this._scrollEdgeBusy = true;
              this._scheduler.endDate = newEnd;
              this._scrollEdgeBusy = false;
            }
          } else if (distFromLeft < threshold) {
            const curStart = new Date(this._scheduler.startDate);
            const newStart = new Date(curStart.getFullYear(), curStart.getMonth() - 1, 1);
            if (newStart >= MIN_DATE) {
              this._scrollEdgeBusy = true;
              const beforeX = scrollable.x;
              const beforeMaxX = scrollable.maxX;
              this._scheduler.startDate = newStart;
              // Preserve perceived scroll position when adding to the left.
              // After mutation, maxX grows; keep the user looking at the
              // same date by shifting scrollX by the width delta.
              requestAnimationFrame(() => {
                const afterMaxX = scrollable.maxX;
                const delta = afterMaxX - beforeMaxX;
                if (delta > 0) scrollable.x = beforeX + delta;
                this._scrollEdgeBusy = false;
              });
            }
          }
        }, 80);
      };
      schedule.timeAxisSubGrid?.scrollable?.on?.('scroll', onScroll);

      // Splitter + Map panel — only if mapboxgl loaded.
      // Wrapped in try/catch so a mapbox failure never kills the scheduler render.
      if (!mapboxgl) {
        // Stretch the scheduler to fill the full width when there's no map pane.
        schedule.flex = 1;
      } else try {
        new schedulerPro.Splitter({ appendTo: mainEl });

        this._mapPanel = new LdMapPanel({
          appendTo:      mainEl,
          flex:          2,
          eventStore:    schedule.eventStore,
          resourceStore: schedule.resourceStore,
          timeAxis:      schedule.timeAxis,
          // Default map center: Houston metro. Most fleet activity is in
          // the Houston area, so the map opens with the relevant region.
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
      } catch (mapErr) {
        console.error('[line-detail] map panel failed (scheduler still renders):', mapErr);
      }

      // Delegate stage/release clicks inside resource column
      mainEl.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-ld-action]');
        if (!btn) return;
        const action = btn.dataset.ldAction;
        const resourceId = btn.dataset.resourceId ? Number(btn.dataset.resourceId) : null;
        const allocationId = btn.dataset.allocationId ? Number(btn.dataset.allocationId) : null;

        if (action === 'stage-assign') this._onStageAssign(resourceId);
        else if (action === 'cancel-stage-assign') this._onCancelStageAssign(resourceId);
        else if (action === 'stage-release') this._onStageRelease(resourceId);
        else if (action === 'cancel-stage-release') this._onCancelStageRelease(allocationId);
        else if (action === 'stage-assign-lot') {
          // Read qty from the sibling stepper input within the same row.
          const row = btn.closest('.ld-resource-cell');
          const input = row ? row.querySelector('input.ld-lot-qty[data-resource-id="' + resourceId + '"]') : null;
          const qty = input ? Math.max(1, Number(input.value || 1)) : 1;
          this._onLotStageAssign(resourceId, qty);
        }
      });

      // Persist edits to qty stepper into the staged record. We listen on
      // both 'change' (commit) and 'input' (live typing) so cap math stays
      // in sync with the spinner. Live updates are deferred to change to
      // avoid mid-typing-snap surprises; cap clamps still apply on commit.
      mainEl.addEventListener('change', (e) => {
        const inp = e.target.closest('input.ld-lot-qty[data-resource-id]');
        if (!inp) return;
        const resourceId = Number(inp.dataset.resourceId);
        const requested  = Math.max(1, Number(inp.value || 1));
        this._onLotQtyChanged(resourceId, requested);
      });

      this._updateAssetCount();
      this._updateMonthLabel();

      // Force a relayout once the DOM has settled — works around cases where
      // the parent flex container hadn't yet computed its height when build ran.
      setTimeout(() => {
        try {
          this._scheduler?.relayout();
          this._mapPanel?.onResize();
        } catch (e) { /* noop */ }
      }, 200);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Render one row's "Serial" / "Lot" column. Branches on this._mode.
    // Serial mode: 5 visual states — available / staged-assign /
    //   allocated-to-this-line / staged-release / allocated-elsewhere.
    // Lot mode: lot number + on-hand vs reserved vs staged qty, with an
    //   inline qty stepper bound to pendingAssignments and an Assign /
    //   Release button per row.
    // ─────────────────────────────────────────────────────────────────────
    // Modes that pick by quantity (a stepper per row + sum-of-allocatedQty
    // capacity math) vs. by single-unit slots. 'inventory' rides on the
    // same lot-cell renderer for v1 — same data shape, same UX. The chain
    // will populate `inventoryItem`-shaped resources later; until then the
    // page renders its empty-state.
    _isQtyMode() {
      return this._mode === 'lot' || this._mode === 'inventory';
    }

    // ─────────────────────────────────────────────────────────────────────
    // Render the "Yard" column for one row. Yard name on top, org/location
    // code small + grey below (hidden when it equals the name). Pulls from
    // the resource's location/location_code (serial & lot) or invOrgName/
    // invOrgCode (inventory). When the unit has no known yard, shows a muted
    // dash so the column never renders blank. Mirrors the same guard the
    // resource-cell renderer uses (Bryntum can re-invoke with a partial record).
    // ─────────────────────────────────────────────────────────────────────
    _renderYardCell(record) {
      if (!record || record.id == null) return '';
      try {
        const name = record.location || record.invOrgName || record.location_code || record.invOrgCode || '';
        const code = record.location_code || record.invOrgCode || '';
        if (!name) {
          return '<div class="ld-yard-cell"><span class="ld-yard-empty">&mdash;</span></div>';
        }
        const showCode = code && code !== name;
        return (
          '<div class="ld-yard-cell">' +
          '<span class="ld-yard-name">' + name + '</span>' +
          (showCode ? '<span class="ld-yard-code">' + code + '</span>' : '') +
          '</div>'
        );
      } catch (err) {
        console.error('[line-detail] yard cell render failed for record:', record, err);
        return '';
      }
    }

    _renderResourceCell(record) {
      // Bryntum can re-invoke a column renderer with no/partial record on some
      // refresh paths (selection, group/special rows). Guard so a missing
      // record degrades to an empty string instead of throwing inside the
      // renderer — an uncaught throw here leaves the WHOLE cell blank, which
      // is what produced the "row goes blank after clicking" symptom.
      if (!record || record.id == null) return '';

      // Wrap the body so any unexpected throw renders a readable fallback cell
      // (lot/serial label) instead of a blank one, and logs the offending
      // record + error for diagnosis.
      try {
        if (this._isQtyMode()) return this._renderLotCell(record);
        return this._renderSerialCell(record);
      } catch (err) {
        console.error('[line-detail] resource cell render failed for record:', record, err);
        const label = record.lotNumber || record.serialNumber || record.name || '—';
        return '<div class="ld-resource-cell"><div style="flex:1;min-width:0;">' +
               '<div class="ld-resource-name">' + label + '</div></div></div>';
      }
    }

    // Original serial-mode cell body, split out of _renderResourceCell so the
    // wrapper above can guard both serial and lot/inventory paths uniformly.
    _renderSerialCell(record) {

      const sn = record.serialNumber || record.name || '—';
      const eq = record.equipment_name || '';

      const stagedForAssign = this._pendingAssignments.some(p => p.resourceId === record.id);
      const stagedForRelease = record.allocationId
        ? this._pendingReleases.some(p => p.allocationId === record.allocationId)
        : false;

      // Decide effective state for color + control
      let effectiveStatus = record.status;
      if (stagedForAssign) effectiveStatus = 'staged_assign';
      if (stagedForRelease) effectiveStatus = 'staged_release';

      const colorMap = {
        available: '#10b981',
        allocated_to_this_line: '#0891b2',
        allocated_elsewhere: '#9ca3af',
        staged_assign: '#f59e0b',
        staged_release: '#dc2626',
      };
      const color = colorMap[effectiveStatus] || '#9ca3af';

      let badgeHtml = '';
      let buttonHtml = '';

      if (stagedForAssign) {
        badgeHtml = '<span class="ld-pill" style="background:var(--oj-core-warning-color-5,#fef3c7);color:var(--oj-core-warning-color-1,#92400e);border-color:var(--oj-core-warning-color-2,#fcd34d);">Pending Assign</span>';
        buttonHtml = '<button class="ld-btn ld-btn-cancel" data-ld-action="cancel-stage-assign" data-resource-id="' + record.id + '">Cancel</button>';
      } else if (effectiveStatus === 'staged_release') {
        badgeHtml = '<span class="ld-pill" style="background:var(--oj-core-danger-color-5,#fee2e2);color:var(--oj-core-danger-color-1,#991b1b);border-color:var(--oj-core-danger-color-2,#fca5a5);">Pending Release</span>';
        buttonHtml = '<button class="ld-btn ld-btn-cancel" data-ld-action="cancel-stage-release" data-allocation-id="' + record.allocationId + '">Cancel</button>';
      } else if (record.status === 'allocated_to_this_line') {
        // Assigned row: badge + a Release button so the user can un-assign
        // (to reduce qty or swap serials) before the request is confirmed.
        // Once confirmed (a TO exists) the row is read-only — badge only.
        badgeHtml = '<span class="ld-pill" style="background:var(--oj-core-success-color-5,#d1fae5);color:var(--oj-core-success-color-1,#065f46);border-color:var(--oj-core-success-color-2,#6ee7b7);">Assigned</span>';
        if (!this._confirmed && !this._pickerReadOnly) {
          buttonHtml = '<button class="ld-btn ld-btn-release" data-ld-action="stage-release" data-resource-id="' + record.id + '">Release</button>';
        }
      } else if (record.status === 'allocated_elsewhere') {
        badgeHtml = '<span class="ld-pill" style="background:var(--oj-core-neutral-color-2,#f3f4f6);color:var(--oj-core-text-color-secondary,#6b7280);border-color:var(--oj-core-neutral-color-3,#d1d5db);">Booked</span>';
      } else if (record.status === 'available') {
        // Assign only before the request is confirmed — post-confirm the
        // picker is read-only. Also hidden for the customer/UNDER_PROCUREMENT
        // view-only case (_pickerReadOnly).
        if (!this._confirmed && !this._pickerReadOnly) {
          const atCap = this._isAtCap();
          const disabledAttrs = atCap
            ? ' disabled title="Line quantity reached" style="opacity:0.45;cursor:not-allowed;"'
            : '';
          if (this._childCheck[record.id] === 'CHECKING') {
            // Fusion asset-hierarchy lookup in flight (CheckChildAssetsChain).
            buttonHtml = '<button class="ld-btn ld-btn-assign ld-btn-checking" disabled title="Checking the maintenance asset hierarchy">' +
                         '<span class="ld-spin" aria-hidden="true"></span>Checking…</button>';
          } else {
            buttonHtml = '<button class="ld-btn ld-btn-assign" data-ld-action="stage-assign" data-resource-id="' + record.id + '"' + disabledAttrs + '>Assign</button>';
          }
        }
      }

      return (
        '<div class="ld-resource-cell">' +
        '<div class="ld-status-dot" style="background:' + color + ';"></div>' +
        '<div style="overflow:hidden;flex:1;min-width:0;">' +
        '<div class="ld-resource-name">' + sn + '</div>' +
        '<div class="ld-resource-sn">' + eq + '</div>' +
        '</div>' +
        badgeHtml +
        buttonHtml +
        '</div>'
      );
    }

    // ─────────────────────────────────────────────────────────────────────
    // Lot-mode row: lot number, on-hand / available / staged qty summary,
    // inline qty stepper (clamped to availableQty), and Assign / Release.
    // Staged assignment is keyed by lotRefId with a chosen qty (≥1).
    // ─────────────────────────────────────────────────────────────────────
    _renderLotCell(record) {
      const lotNo  = record.lotNumber || record.name || '—';
      const uom    = record.uomCode    || '';
      const avail  = Number(record.availableQty || 0);

      const stagedAssign = this._pendingAssignments.find(p => p.lotRefId === record.id) || null;
      const stagedQty    = stagedAssign ? Number(stagedAssign.qty || 0) : 0;

      const stagedRelease = record.allocationId
        ? this._pendingReleases.find(p => p.allocationId === record.allocationId) || null
        : null;

      // Effective state for the status dot color.
      // - staged_release : red
      // - staged_assign  : amber
      // - allocated_to_this_line : cyan
      // - available      : green (avail >= 1)
      // - allocated_elsewhere : grey (fully reserved / on-hand zero)
      let effectiveStatus;
      if (stagedRelease)               effectiveStatus = 'staged_release';
      else if (stagedAssign)           effectiveStatus = 'staged_assign';
      else if (record.allocationId)    effectiveStatus = 'allocated_to_this_line';
      else if (avail >= 1)             effectiveStatus = 'available';
      else                             effectiveStatus = 'allocated_elsewhere';

      const colorMap = {
        available: '#10b981',
        allocated_to_this_line: '#0891b2',
        allocated_elsewhere: '#9ca3af',
        staged_assign: '#f59e0b',
        staged_release: '#dc2626',
      };
      const color = colorMap[effectiveStatus] || '#9ca3af';

      // Max qty user can stage from THIS lot = avail. We also enforce the
      // line-quantity cap (sum of all staged qty + already-allocated ≤
      // lineData.qty) at staging time via _onLotStageAssign.
      const remainingCap = this._remainingLineCapacity();
      const maxFromLot   = Math.min(avail, remainingCap + stagedQty); // include current stage so the user can edit downward
      const stepperVal   = stagedQty > 0 ? stagedQty : Math.min(1, maxFromLot);

      // ── Build sub-pieces ────────────────────────────────────────────────
      let badgeHtml = '';
      let controlsHtml = '';

      if (stagedRelease) {
        badgeHtml = '<span class="ld-pill" style="background:var(--oj-core-danger-color-5,#fee2e2);color:var(--oj-core-danger-color-1,#991b1b);border-color:var(--oj-core-danger-color-2,#fca5a5);">Pending Release</span>';
        controlsHtml = '<button class="ld-btn ld-btn-cancel" data-ld-action="cancel-stage-release" data-allocation-id="' + record.allocationId + '">Cancel</button>';
      } else if (stagedAssign) {
        badgeHtml = '<span class="ld-pill" style="background:var(--oj-core-warning-color-5,#fef3c7);color:var(--oj-core-warning-color-1,#92400e);border-color:var(--oj-core-warning-color-2,#fcd34d);">Pending Assign · ' + stagedQty + (uom ? ' ' + uom : '') + '</span>';
        controlsHtml =
          '<input type="number" class="ld-lot-qty" data-resource-id="' + record.id + '" ' +
          'min="1" max="' + Math.max(1, maxFromLot) + '" step="1" value="' + stepperVal + '" ' +
          'style="width:64px;padding:4px 6px;font-size:12px;border:1px solid var(--oj-core-border-color-enabled,#d1d5db);border-radius:4px;text-align:right;" />' +
          '<button class="ld-btn ld-btn-cancel" data-ld-action="cancel-stage-assign" data-resource-id="' + record.id + '">Cancel</button>';
      } else if (record.allocationId) {
        // Assigned row: badge + a Release button so the user can un-assign
        // (then re-assign at a new qty) before the request is confirmed.
        // Once confirmed (a TO exists) the row is read-only — badge only.
        const allocQty = Number(record.allocatedQty || 0);
        badgeHtml = '<span class="ld-pill" style="background:var(--oj-core-success-color-5,#d1fae5);color:var(--oj-core-success-color-1,#065f46);border-color:var(--oj-core-success-color-2,#6ee7b7);">Assigned · ' + allocQty + (uom ? ' ' + uom : '') + '</span>';
        if (!this._confirmed && !this._pickerReadOnly) {
          controlsHtml = '<button class="ld-btn ld-btn-release" data-ld-action="stage-release" data-resource-id="' + record.id + '">Release</button>';
        }
      } else if (avail >= 1) {
        // Assign only before the request is confirmed — post-confirm the
        // picker is read-only (availability summary still renders below). Also
        // hidden for the customer/UNDER_PROCUREMENT view-only case.
        if (!this._confirmed && !this._pickerReadOnly) {
          const atCap = this._isAtCap();
          const disabledAttrs = atCap || maxFromLot < 1
            ? ' disabled title="' + (atCap ? 'Line quantity reached' : 'No available qty in this lot') + '" style="opacity:0.45;cursor:not-allowed;"'
            : '';
          // Pre-fill the stepper with everything this lot can still cover for
          // the line (remaining line qty, capped by the lot's availability)
          // rather than a flat 1 — a 2-EA line one click away from allocated.
          // maxFromLot already folds in _remainingLineCapacity(), so at cap
          // this is 0 and the control renders disabled.
          const defaultQty = atCap ? 0 : Math.max(1, maxFromLot);
          controlsHtml =
            '<input type="number" class="ld-lot-qty" data-resource-id="' + record.id + '" ' +
            'min="1" max="' + Math.max(1, maxFromLot) + '" step="1" value="' + defaultQty + '"' + (atCap || maxFromLot < 1 ? ' disabled' : '') + ' ' +
            'style="width:64px;padding:4px 6px;font-size:12px;border:1px solid var(--oj-core-border-color-enabled,#d1d5db);border-radius:4px;text-align:right;' + (atCap || maxFromLot < 1 ? 'opacity:0.55;' : '') + '" />' +
            '<button class="ld-btn ld-btn-assign" data-ld-action="stage-assign-lot" data-resource-id="' + record.id + '"' + disabledAttrs + '>Assign</button>';
        }
      } else {
        // avail < 1, no current allocation → not actionable
        badgeHtml = '<span class="ld-pill" style="background:var(--oj-core-neutral-color-2,#f3f4f6);color:var(--oj-core-text-color-secondary,#6b7280);border-color:var(--oj-core-neutral-color-3,#d1d5db);">Out of stock</span>';
      }

      const summaryLine =
        '<span style="font-size:11px;color:var(--oj-core-text-color-secondary,#6b7280);">' +
          'Available <strong style="color:#065f46;">' + avail + '</strong>' +
          (uom ? ' ' + uom : '') +
        '</span>';

      return (
        '<div class="ld-resource-cell">' +
        '<div class="ld-status-dot" style="background:' + color + ';"></div>' +
        '<div style="overflow:hidden;flex:1;min-width:0;">' +
        '<div class="ld-resource-name">' + lotNo + '</div>' +
        '<div class="ld-resource-sn">' + summaryLine + '</div>' +
        '</div>' +
        badgeHtml +
        controlsHtml +
        '</div>'
      );
    }

    // Remaining slots before we hit lineData.qty across all current allocations
    // + staged assignments (qty-aware for lot/inventory mode) - staged releases.
    _remainingLineCapacity() {
      const target = (this._lineData && this._lineData.qty) || 1;
      const qtyMode = this._isQtyMode();
      let allocatedNow;
      if (qtyMode) {
        allocatedNow = this._allocatedSerials.reduce((sum, a) => sum + Number(a.allocatedQty || 0), 0);
      } else {
        allocatedNow = this._allocatedSerials.length;
      }
      const releasing = qtyMode
        ? this._pendingReleases.reduce((sum, r) => sum + Number(r.qty || r.allocatedQty || 0), 0)
        : this._pendingReleases.length;
      const staging = qtyMode
        ? this._pendingAssignments.reduce((sum, a) => sum + Number(a.qty || 0), 0)
        : this._pendingAssignments.length;
      const effective = allocatedNow - releasing + staging;
      return Math.max(0, target - effective);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Staging actions — toggle pending arrays and refresh the visible row
    // ─────────────────────────────────────────────────────────────────────
    // Capacity = lineData.qty. Effective count = allocated - pendingReleases + pendingAssignments.
    // Returns true when assigning one more would exceed lineData.qty.
    // Lot mode uses unit qty rather than row count.
    _isAtCap() {
      return this._remainingLineCapacity() <= 0;
    }

    // Assign is two-step for serials: CheckChildAssetsChain first looks the
    // unit's maintenance asset up in Fusion, and only if it is a PARENT does the
    // user see the read-only child list + acknowledgement. It is a warning, not a
    // gate — the chain always ends in completeStageAssign(). The page module
    // cannot callRest itself (no chain context), hence the event round-trip.
    _onStageAssign(resourceId) {
      const resource = this._scheduler?.resourceStore?.getById(resourceId);
      if (!resource) return;
      if (this._pendingAssignments.some(p => p.resourceId === resourceId)) return;
      if (this._isAtCap()) {
        const target = (this._lineData && this._lineData.qty) || 1;
        console.warn('[line-detail] cannot assign — already at line qty ' + target);
        return;
      }

      // Already checked this session (no children, or children acknowledged).
      if (this._childCheck[resourceId] === 'CLEAR') {
        this._stageAssign(resourceId);
        return;
      }
      // Idempotent: a second click while the lookup runs (or the dialog is up)
      // is ignored, so one Assign can never stage twice or open two dialogs.
      if (this._childCheck[resourceId] === 'CHECKING' ||
          this._childCheck[resourceId] === 'DIALOG') return;
      if (!this._eventHelper) {
        this._stageAssign(resourceId);
        return;
      }

      // Re-render the row so its button shows "Checking…" while Fusion is read.
      this._childCheck[resourceId] = 'CHECKING';
      this._refreshAll();
      this._eventHelper.fireCustomEvent('onCheckChildAssets', {
        resourceId:   resourceId,
        serialRefId:  resource.eqrSerialRefId != null ? resource.eqrSerialRefId
                    : (resource.unitRefId != null ? resource.unitRefId : resourceId),
        serialNumber: resource.serialNumber || '',
      });
    }

    // Public — called by the child-asset chains to finish (or abandon) an assign.
    //   proceed=true  → stage it, and don't ask again for this unit this session
    //   proceed=false → user cancelled the warning; nothing staged
    // Returns 'STAGED', 'FULL' (the line filled up while Fusion was read — e.g.
    // another unit was assigned meanwhile) or 'GONE' (row no longer shown), so
    // the chain can tell the user instead of silently doing nothing.
    completeStageAssign(resourceId, proceed, childCount) {
      const id = Number(resourceId);
      if (!proceed) {
        delete this._childCheck[id];
        this._refreshAll();
        return 'CANCELLED';
      }
      this._childCheck[id] = 'CLEAR';
      const outcome = this._stageAssign(id, Number(childCount) || 0);
      // _stageAssign refreshes on success; refresh anyway so a cap/dedupe
      // early-return still clears the "Checking…" button.
      this._refreshAll();
      return outcome;
    }

    // Public — the hierarchy dialog is open: stop the row spinner, but keep
    // further Assign clicks on this unit ignored until the user decides.
    childCheckShown(resourceId) {
      this._childCheck[Number(resourceId)] = 'DIALOG';
      this._refreshAll();
    }

    _stageAssign(resourceId, childCount) {
      const resource = this._scheduler?.resourceStore?.getById(resourceId);
      if (!resource) return 'GONE';
      // Re-checked: staging may have changed while the Fusion lookup ran.
      if (this._pendingAssignments.some(p => p.resourceId === resourceId)) return 'STAGED';
      if (this._isAtCap()) {
        const target = (this._lineData && this._lineData.qty) || 1;
        console.warn('[line-detail] cannot assign — already at line qty ' + target);
        return 'FULL';
      }

      this._pendingAssignments.push({
        // The per-type id the write path takes. EQR_UNIT_REF was removed in
        // the three-table revert, so POST /allocations rejects eqrUnitRefId
        // outright; it wants serialRefId / lotRefId / inventoryItemRefId.
        // lineDetailUnits reads V357's derived serialRefId column and falls
        // back to unitRefId, which carries the same value for a SERIAL row -
        // so prefer its resolved value and only fall back to the row id.
        eqrSerialRefId: resource.eqrSerialRefId != null ? resource.eqrSerialRefId
                      : (resource.unitRefId != null ? resource.unitRefId : resourceId),
        // Row identity, kept separate so staged-bar bookkeeping and the
        // dedupe check below still match on what the scheduler knows.
        resourceId:  resourceId,
        serialNumber: resource.serialNumber,
        // Current inv org of the allocated unit — persisted to
        // EQR_ALLOCATION.EQP_INV_ORG_ID by saveLineChain so the outbound TO
        // can derive its source org (was hardcoded '001').
        invOrgId:    resource.invOrgId != null ? resource.invOrgId : null,
        invOrgName:  resource.invOrgName || '',
        // Session-only record that the parent/child warning was acknowledged.
        // saveLineChain builds its POST body field by field, so this is never sent.
        childAssetCount: childCount || 0,
      });
      this._addStagedBar(resourceId);
      this._refreshAll();
      return 'STAGED';
    }

    _onCancelStageAssign(resourceId) {
      if (this._isQtyMode()) {
        this._pendingAssignments = this._pendingAssignments.filter(p => p.lotRefId !== resourceId);
      } else {
        this._pendingAssignments = this._pendingAssignments.filter(
          p => p.resourceId !== resourceId);
      }
      this._removeStagedBar(resourceId);
      this._refreshAll();
    }

    // Lot-mode staging — qty matters. Clamped to (availableQty, remaining
    // line capacity). Replaces any existing stage for this lot.
    _onLotStageAssign(lotRefId, qty) {
      const resource = this._scheduler?.resourceStore?.getById(lotRefId);
      if (!resource) return;
      const avail = Number(resource.availableQty || 0);
      if (avail < 1) return;

      // Remove any previous stage for this lot, then clamp to current
      // remaining capacity (after the removal) and avail.
      this._pendingAssignments = this._pendingAssignments.filter(p => p.lotRefId !== lotRefId);
      const remaining = this._remainingLineCapacity();
      if (remaining <= 0) {
        console.warn('[line-detail] cannot stage — line qty already filled');
        this._refreshAll();
        return;
      }
      const clamped = Math.max(1, Math.min(Number(qty || 1), avail, remaining));

      // Staged record carries lot-shape fields (which the renderer uses)
      // plus inventory-specific aliases so saveLineChain can address the
      // right FK / column name without a separate mode probe.
      const staged = {
        // `lotRefId` here is the scheduler ROW id and is used only for
        // staged-bar bookkeeping. The WRITE id is the per-type one below,
        // which saveLineChain reads as assn.eqrLotRefId (lot mode) or
        // assn.inventoryItemRefId (inventory mode).
        lotRefId:  lotRefId,
        eqrLotRefId: resource.eqrLotRefId != null ? resource.eqrLotRefId
                   : (resource.unitRefId != null ? resource.unitRefId : lotRefId),
        inventoryItemRefId: resource.inventoryItemRefId != null ? resource.inventoryItemRefId
                          : (resource.unitRefId != null ? resource.unitRefId : lotRefId),
        lotNumber: resource.lotNumber || '',
        qty:       clamped,
        // Current inv org of the allocated unit — persisted to
        // EQR_ALLOCATION.EQP_INV_ORG_ID by saveLineChain (lot + inventory
        // share this staging path).
        invOrgId:   resource.invOrgId != null ? resource.invOrgId : null,
        invOrgName: resource.invOrgName || '',
      };
      if (this._mode === 'inventory') {
        staged.itemNumber = resource.itemNumber || resource.lotNumber || '';
      }
      this._pendingAssignments.push(staged);
      this._addStagedBar(lotRefId);
      this._refreshAll();
    }

    // Stepper value changed — if this lot is already staged, update qty in
    // place; otherwise no-op (Assign button must be pressed to stage).
    _onLotQtyChanged(lotRefId, requestedQty) {
      const existing = this._pendingAssignments.find(p => p.lotRefId === lotRefId);
      if (!existing) return;
      const resource = this._scheduler?.resourceStore?.getById(lotRefId);
      if (!resource) return;
      const avail = Number(resource.availableQty || 0);
      // Capacity calc minus the current stage so we can re-allocate within itself.
      const remaining = this._remainingLineCapacity() + Number(existing.qty || 0);
      const clamped   = Math.max(1, Math.min(Number(requestedQty || 1), avail, remaining));
      existing.qty = clamped;
      this._refreshAll();
    }

    // Returns the dates the staged "Reserving" bar should span. Prefers the
    // last-known adjusted window (captured by onAdjustDates) so newly-staged
    // bars use the adjusted dates the user has just typed. Falls back to the
    // line's original dates seeded by vbEnterChain.
    _currentReserveWindow() {
      const adjStart = this._lastAdjustedStart;
      const adjEnd   = this._lastAdjustedEnd;
      const start = adjStart || (this._lineData && this._lineData.start_date) || '';
      const end   = adjEnd   || (this._lineData && this._lineData.end_date)   || '';
      return { start: start, end: end };
    }

    // Bryntum endDate-inclusive shim. See resources/js/bryntumDates.js for
    // why this exists. Thin instance wrapper so existing call sites that
    // use `this._inclusiveEnd(...)` keep working.
    _inclusiveEnd(val) {
      return bryntumDates.inclusiveEnd(val);
    }

    // Live-preview "Reserving" bar pushed directly into Bryntum's eventStore.
    // Uses the user's adjusted dates (if any) so the bar always reflects what
    // will actually be saved.
    _addStagedBar(resourceId) {
      const store = this._scheduler?.eventStore;
      if (!store || !this._lineData) return;
      const win = this._currentReserveWindow();
      if (!win.start || !win.end) return;
      store.add({
        id: 'staged-' + resourceId,
        resourceId: resourceId,
        name: 'Reserving',
        startDate: win.start,
        endDate: this._inclusiveEnd(win.end),
        eventColor: '#f59e0b',
        stagedFor: resourceId,
      });
    }

    _removeStagedBar(resourceId) {
      const store = this._scheduler?.eventStore;
      if (!store) return;
      const rec = store.getById('staged-' + resourceId);
      if (rec) store.remove(rec);
    }

    _onStageRelease(resourceId) {
      const resource = this._scheduler?.resourceStore?.getById(resourceId);
      if (!resource || !resource.allocationId) return;
      if (this._pendingReleases.some(p => p.allocationId === resource.allocationId)) return;

      if (this._isQtyMode()) {
        const rel = {
          allocationId: resource.allocationId,
          // saveLineChain's release branch reads rel.eqrLotRefId to return
          // qty to ATR on /lot-refs/{id}.
          eqrLotRefId: resource.eqrLotRefId != null ? resource.eqrLotRefId
                     : (resource.unitRefId != null ? resource.unitRefId : resource.id),
          inventoryItemRefId: resource.inventoryItemRefId != null ? resource.inventoryItemRefId
                            : (resource.unitRefId != null ? resource.unitRefId : resource.id),
          lotNumber:    resource.lotNumber,
          qty:          Number(resource.allocatedQty || 0),
        };
        if (this._mode === 'inventory') {
          rel.itemNumber = resource.itemNumber || resource.lotNumber || '';
        }
        this._pendingReleases.push(rel);
        this._refreshAll();
        return;
      }

      this._pendingReleases.push({
        allocationId: resource.allocationId,
        // Read as rel.eqrSerialRefId to PATCH /serial-refs/{id} back to
        // AVAILABLE on release.
        eqrSerialRefId: resource.eqrSerialRefId != null ? resource.eqrSerialRefId
                      : (resource.unitRefId != null ? resource.unitRefId : resource.id),
        serialNumber: resource.serialNumber,
      });
      this._refreshAll();
    }

    _onCancelStageRelease(allocationId) {
      this._pendingReleases = this._pendingReleases.filter(p => p.allocationId !== allocationId);
      this._refreshAll();
    }

    _refreshAll() {
      try { this._scheduler?.refreshRows(); } catch (e) { /* noop */ }
      this._updateAllocationProgress();
    }

    _updateAllocationProgress() {
      const target = (this._lineData && this._lineData.qty) || 1;
      let allocated, pendAssn, pendRel, noun;

      if (this._isQtyMode()) {
        allocated = this._allocatedSerials.reduce((sum, a) => sum + Number(a.allocatedQty || 0), 0);
        pendAssn  = this._pendingAssignments.reduce((sum, a) => sum + Number(a.qty || 0), 0);
        pendRel   = this._pendingReleases.reduce((sum, r) => sum + Number(r.qty || r.allocatedQty || 0), 0);
        noun      = 'units';
      } else {
        allocated = this._allocatedSerials.length;
        pendAssn  = this._pendingAssignments.length;
        pendRel   = this._pendingReleases.length;
        noun      = 'serials';
      }

      const effective = allocated - pendRel + pendAssn;
      let summary = effective + ' / ' + target + ' ' + noun + ' allocated';
      if (pendAssn || pendRel) summary += '  (' + (pendAssn + pendRel) + ' pending)';

      const el = this._visibleEl('ldAllocationSummary');
      if (el) el.textContent = summary;

      // Drive the Redwood progress-circle + Save button via reactive page
      // variables. The page header's primary-action display binds to
      // $variables.saveEnabled and the progress circle to $variables.
      // allocationPercent — both written declaratively so the header's own
      // re-render can't stomp them (the old DOM-poking _syncSaveButton lost
      // that race). But a page module CANNOT write $page.variables directly:
      // `context.variables.X = v` is inert and never reaches the bindings
      // (that's why Save stayed greyed and the circle blank). So fire a custom
      // page event carrying the values; StagingChangedChain (registered in the
      // page JSON) writes them from its writable $page. Save enables only when
      // something is staged — a fully-allocated line with nothing pending stays
      // disabled.
      const pct = target > 0 ? Math.min(100, Math.round((effective / target) * 100)) : 0;
      const hasPending =
        this._pendingAssignments.length > 0 || this._pendingReleases.length > 0;
      if (this._eventHelper) {
        this._eventHelper.fireCustomEvent('onStagingChanged', {
          saveEnabled:       hasPending,
          allocationPercent: pct,
        });
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Adjust period highlight + any staged "Reserving" bars when the date
    // pickers change. Called from oj-input-date on-value-changed.
    //
    // Per project rule (feedback_vb_page_module_no_variable_read): page-module
    // methods cannot reliably read $page.variables via this._context. The
    // caller (template) must pass the current values in explicitly.
    // ─────────────────────────────────────────────────────────────────────
    onAdjustDates(startVal, endVal) {
      if (!this._scheduler) return;

      // Fallbacks: if a value wasn't passed (e.g. legacy callsite) or is
      // empty, fall back to the original line dates we already hold.
      const sVal = startVal || (this._lineData && this._lineData.start_date) || '';
      const eVal = endVal   || (this._lineData && this._lineData.end_date)   || '';

      // Stash so _currentReserveWindow (called when staging NEW assignments
      // later) sees the user's latest adjusted dates.
      this._lastAdjustedStart = sVal;
      this._lastAdjustedEnd   = eVal;

      const newStart    = sVal ? new Date(sVal) : null;
      const newEndExcl  = this._inclusiveEnd(eVal); // +1 day for Bryntum's exclusive-end convention
      if (!newStart || !newEndExcl) return;

      // Move the green "Requested period" highlight band.
      const tr = this._scheduler.timeRangeStore?.getById('req-period');
      if (tr) { tr.startDate = newStart; tr.endDate = newEndExcl; }

      // Reposition any in-flight "Reserving" bars so they always reflect what
      // will actually be persisted on Save. Bryntum event-store records
      // require .set() (not direct assignment) to fire the redraw cycle.
      const store = this._scheduler.eventStore;
      if (store && this._pendingAssignments && this._pendingAssignments.length) {
        this._pendingAssignments.forEach(p => {
          const rec = store.getById('staged-' + p.resourceId);
          if (rec && typeof rec.set === 'function') {
            rec.set({ startDate: newStart, endDate: newEndExcl });
          } else if (rec) {
            rec.startDate = newStart;
            rec.endDate = newEndExcl;
          }
        });
      }

      // Per-serial availability against the adjusted window is recomputed
      // SERVER-side now: the HTML date pickers also fire onRescopeDates →
      // RescopeDatesChain re-fetches line-detail-units (startDate/endDate) and
      // calls applySerialStatuses() to repaint the rows. This method only owns
      // the local band/bar repositioning above.
    }

    // True when the picker is in serial mode (status is window-derived).
    // Lot/inventory status is qty-derived, so a date change doesn't affect it.
    isSerialMode() {
      return !this._isQtyMode();
    }

    // Repaint each serial row's status from a fresh line-detail-units fetch
    // (called by RescopeDatesChain after a date adjust). Keys rows by unitRefId
    // == resource id. Mirrors the old _recomputeAllSerialStatuses store-update
    // mechanics but trusts the view's server-computed availabilityStatus.
    applySerialStatuses(units) {
      if (this._isQtyMode()) return;
      const store = this._scheduler && this._scheduler.resourceStore;
      if (!store || !Array.isArray(units)) return;

      const statusByRefId = new Map();
      units.forEach(u => {
        const status = u.allocationId != null
          ? 'allocated_to_this_line'
          : ((u.availabilityStatus || '').toUpperCase() === 'AVAILABLE' ? 'available' : 'allocated_elsewhere');
        statusByRefId.set(Number(u.unitRefId), status);
      });

      store.records.forEach(r => {
        const newStatus = statusByRefId.get(Number(r.id));
        if (newStatus == null || r.status === newStatus) return;
        if (typeof r.set === 'function') r.set('status', newStatus);
        else r.status = newStatus;
      });
    }

    // ─────────────────────────────────────────────────────────────────────
    // Month navigation
    // ─────────────────────────────────────────────────────────────────────
    prevMonth() {
      this.currentMonth--;
      if (this.currentMonth < 0) { this.currentMonth = 11; this.currentYear--; }
      this._navigateScheduler();
    }

    nextMonth() {
      this.currentMonth++;
      if (this.currentMonth > 11) { this.currentMonth = 0; this.currentYear++; }
      this._navigateScheduler();
    }

    goToday() {
      const now = new Date();
      this.currentYear = now.getFullYear();
      this.currentMonth = now.getMonth();
      this._navigateScheduler();
    }

    _navigateScheduler() {
      if (this._scheduler) {
        const target = new Date(this.currentYear, this.currentMonth, 1);
        // If the target is outside the current rendered span, extend first.
        if (target < this._scheduler.startDate) {
          this._scheduler.startDate = target;
        } else if (target >= this._scheduler.endDate) {
          this._scheduler.endDate = new Date(this.currentYear, this.currentMonth + 1, 1);
        }
        // Scroll the existing wide window — no window resize.
        try {
          this._scheduler.scrollToDate(target, { block: 'center', animate: 300 });
        } catch (e) { /* noop */ }
      }
      this._updateMonthLabel();
    }

    _updateMonthLabel() {
      const el = this._visibleEl('ldMonthLabel');
      if (el) el.textContent = MONTH_NAMES[this.currentMonth] + ' ' + this.currentYear;
    }

    _updateAssetCount() {
      const el = this._visibleEl('ldAssetCount');
      if (!el || !this._scheduler) return;
      const noun = (this._mode === 'lot') ? 'lots'
                : (this._mode === 'inventory') ? 'inventory items'
                : 'serials';
      el.textContent = this._scheduler.resourceStore.count + ' ' + noun;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Filters
    // ─────────────────────────────────────────────────────────────────────
    toggleFilters() {
      const panel = this._visibleEl('ldFilterPanel');
      if (!panel) return;
      panel.style.display = (panel.style.display === 'none' || panel.style.display === '') ? 'block' : 'none';
      setTimeout(() => { if (this._scheduler) this._scheduler.relayout(); }, 50);
    }

    applyFilters(override) {
      if (!this._scheduler) return;

      const searchEl = this._visibleEl('ldSearchName');
      const classEl = this._visibleEl('ldClassFilter');

      const search = override?.search || (searchEl?.value || '').toLowerCase().trim();
      const cls = override?.classFilter || classEl?.value || 'all';

      this._scheduler.resourceStore.clearFilters();

      const filters = [];
      if (search) filters.push(r => (r.name + ' ' + (r.serialNumber || '')).toLowerCase().includes(search));
      if (cls && cls !== 'all') filters.push(r => r.eqpClass === (cls || '').toLowerCase());

      if (filters.length) {
        this._scheduler.resourceStore.filter({ filters: r => filters.every(fn => fn(r)), replace: true });
      }

      this._updateAssetCount();
    }

    // ─────────────────────────────────────────────────────────────────────
    // Cleanup
    // ─────────────────────────────────────────────────────────────────────
    disconnectedCallback() {
      if (this._scheduler) { this._scheduler.destroy(); this._scheduler = null; }
      this._mapPanel = null;
    }
  }

  return PageModule;
});

