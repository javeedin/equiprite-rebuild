define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/bryntumDates',
  'resources/js/lineDetailUnits',
  'resources/js/lineConfirmed',
  'resources/js/maintenanceWorkOrders',
  'resources/js/requestDetailLines',
], (ActionChain, Actions, bryntumDates, lineDetailUnits, lineConfirmed, maintenanceWorkOrders, rdl) => {
  'use strict';

  class vbEnterChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;

      console.log('[line-detail vbEnterChain v2-canonical] starting');

      const requestId         = $page.variables.requestId;
      const lineId            = $page.variables.lineId;
      const equipmentMasterId = $page.variables.equipmentMasterId;

      if (!requestId || !lineId) {
        console.warn('[line-detail vbEnterChain] Missing requestId or lineId');
        return;
      }

      // ── Fetch in parallel ───────────────────────────────────────────────
      // line-detail-units is the primary source — header + line + per-unit
      // picker + availability all come from it (see the call comment below).
      //
      // Use Promise.allSettled so a transient network blip on any single call
      // (e.g. ERR_NETWORK_CHANGED) does NOT abort the whole page load —
      // we render with whatever data we did get and warn for what we missed.
      // Run all fetches in parallel:
      //   line-detail-units  → line shim + HEADER fields (every row repeats
      //                        requestNumber/projectName/taskName/requestor/
      //                        location/requestStatus) + the per-unit picker
      //                        (all 3 modes), location + availability on each row
      //   ship-to-sites      → current request's event-marker lat/long (block a)
      //   getAllocations     → block (a) serial bar windows (this line)
      //   getTransferOrders  → confirmed? → Reserving (orange) vs Booked (blue)
      // line-detail-bookings (cross-request bars) is fetched separately below,
      // once the master id is known.
      const settled = await Promise.allSettled([
        // line-detail-units → ONE row per physical unit (serial/lot/inventory)
        // of THIS line, each carrying the full line/header context + name/class
        // + control flags + per-unit availabilityStatus (computed server-side
        // over the line's date window). Replaces /lines2 + equipment-catalog +
        // equipment-master (summary) + workbench-requests(header) AND, for the
        // serial branch, getSerialRefs + getAllocations(status) + locations.
        // Row 0 supplies the line + header shim; unitType rows drive the picker.
        Actions.callRest(context, {
          endpoint:  'eqp-v1/getEquipriteV1ViewsLineDetailUnits',
          uriParams: { requestId: Number(requestId), lineId: Number(lineId), size: 10000 }
        }),
        // Ship-to-sites — used to put real lat/long on the CURRENT request's
        // event marker (block (a)). Cross-request bars (block (b)) now carry
        // their own ship-to coords from line-detail-bookings. size=10000.
        Actions.callRest(context, {
          endpoint:  'eqp-v1/getShipToSites',
          uriParams: { size: 10000 }
        }),
        // Existing allocations for THIS line (was sequential — only needs lineId).
        Actions.callRest(context, {
          endpoint:  'eqp-v1/getAllocations',
          uriParams: { requestLineId: Number(lineId) }
        }),
        // Has THIS request been confirmed? TO existence is the source of truth
        // (was sequential — only needs requestId). Used by the serial branch to
        // colour bars Reserving (orange) vs Booked (blue).
        Actions.callRest(context, {
          endpoint:  'eqp-v1/getTransferOrders',
          uriParams: { equipmentRequestId: Number(requestId) }
        }),
        // Unit-refs, ONLY for maintenanceAssetNumber — the key that ties a
        // serial to its Fusion maintenance asset, and so to its work orders.
        // views/line-detail-units does not carry it (the view has UNIT_REF_ID,
        // UNIT_NUMBER, UNIT_TYPE, UNIT_STATUS and nothing asset-related), so it
        // has to come from the base table. Joined below on the resource id
        // (= the view's unitRefId) === the unit-ref row's `id`.
        // Added to this batch rather than fetched later so it costs no extra
        // round-trip latency.
        Actions.callRest(context, {
          endpoint:  'eqp-v1/getSerialRefs',
          uriParams: { size: 10000 }
        })
      ]);

      const detailResp = settled[0].status === 'fulfilled' ? settled[0].value : null;
      const sitesResp  = settled[1].status === 'fulfilled' ? settled[1].value : null;
      const allocResp  = settled[2].status === 'fulfilled' ? settled[2].value : null;
      const toResp     = settled[3].status === 'fulfilled' ? settled[3].value : null;
      const serialResp = settled[4].status === 'fulfilled' ? settled[4].value : null;

      if (settled[0].status === 'rejected') console.warn('[line-detail vbEnterChain] line-detail-units fetch failed:', settled[0].reason);
      if (settled[1].status === 'rejected') console.warn('[line-detail vbEnterChain] ship-to-sites fetch failed:', settled[1].reason);
      if (settled[2].status === 'rejected') console.warn('[line-detail vbEnterChain] getAllocations fetch failed:', settled[2].reason);
      if (settled[3].status === 'rejected') console.warn('[line-detail vbEnterChain] getTransferOrders fetch failed:', settled[3].reason);
      if (settled[4].status === 'rejected') console.warn('[line-detail vbEnterChain] getSerialRefs fetch failed — no maintenance bars:', settled[4].reason);

      // Bridge: requestId → ship-to-site row (lat/long for event markers).
      // Multiple sites per request shouldn't happen — first-seen wins.
      const siteByRequestId = {};
      const sites = (sitesResp && sitesResp.ok && Array.isArray(sitesResp.body.data))
        ? sitesResp.body.data : [];
      sites.forEach(s => {
        if (!s || s.equipmentRequestId == null) return;
        const rid = Number(s.equipmentRequestId);
        if (siteByRequestId[rid] != null) return;
        siteByRequestId[rid] = {
          latitude:  s.latitude  != null ? Number(s.latitude)  : null,
          longitude: s.longitude != null ? Number(s.longitude) : null,
          siteName:  s.siteName  || '',
          address:   s.address   || ''
        };
      });

      // ── line-detail-units rows for THIS line ────────────────────────────
      // ONE row per physical unit; EVERY row repeats the same line/header
      // context (requestId, lineId, equipmentName, quantity, flags, dates).
      // So row 0 supplies the line shim, and the SERIAL/LOT/INVENTORY rows
      // drive the picker below. Shim row 0 into the canonical RequestLineDto
      // field names the rest of this chain already reads so nothing downstream
      // changes.
      let detailRows = [];
      if (detailResp && detailResp.ok && detailResp.body && Array.isArray(detailResp.body.data)) {
        detailRows = detailResp.body.data;
      }

      const detailRow = detailRows.find(r => String(r.lineId) === String(lineId));
      if (!detailRow) {
        console.warn('[line-detail vbEnterChain] No line-detail-units rows for lineId:', lineId,
                     'in', detailRows.length, 'rows');
        return;
      }

      // Canonical-named shim — downstream code reads these field names.
      //
      // KEEP IN SYNC with every field anything downstream reads off lineRow.
      // lineStatus was missing here while the ALLOCATION GATE in saveLineChain
      // read lineRow.lineStatus, so line_status below stamped '' for every line
      // and the gate's strict compare ('' !== 'IN_PROCESS') blocked ALL
      // allocation with "This line is not set" — silently, because a dropped
      // field is undefined, not an error. Any field added to the gate or to
      // lineData has to be added here too, or it fails the same way.
      const lineRow = {
        id:                   detailRow.lineId,
        eqrEquipmentMasterId: detailRow.equipmentMasterId,
        quantity:             detailRow.quantity,
        allocationStatus:     detailRow.allocStatus,
        lineStatus:           detailRow.lineStatus,
        billRate:             detailRow.billRate,
        estimatedCost:        detailRow.estimatedCost,
        targetUtilPercent:    detailRow.targetUtilPercent,
        startDate:            detailRow.startDate,
        endDate:              detailRow.endDate,
      };

      console.log('[line-detail vbEnterChain] found detail line:', {
        id: lineRow.id, master: lineRow.eqrEquipmentMasterId, qty: lineRow.quantity
      });

      // ── Equipment name/class straight from the enriched row ─────────────
      const eqpInfo = {
        equipmentName: detailRow.equipmentName || '',
        className:     detailRow.className      || '',
      };
      const formatDate = iso => iso ? iso.slice(0, 10) : '';

      // ── Header (request-level fields) — from the same line-detail-units row.
      // Every row repeats requestNumber/projectName/taskName/requestor/location/
      // requestStatus + line dates, so no separate workbench-requests pull.
      // Mapped into the field names the subtitle/requestData/bar code reads.
      const header = {
        requestNumber:      detailRow.requestNumber,
        projectName:        detailRow.projectName,
        projectOrCustomer:  detailRow.projectName,    // single source on this view
        taskName:           detailRow.taskName,
        requestor:          detailRow.requestor,
        location:           detailRow.location,
        requestStatus:      detailRow.requestStatus,
        requestedStartDate: detailRow.lineStartDate,  // line dates double as the
        requestedEndDate:   detailRow.lineEndDate,     // header window on this page
      };

      // Picker read-only reason (separate from confirmed): a CUSTOMER-sourced
      // request whose LINE is at UNDER_PROCUREMENT is viewable but NOT
      // allocatable — the manager opens line-detail to see the picker/schedule
      // (and can generate a quote from request-detail), but Assign/Release stay
      // hidden. NOTE: UNDER_PROCUREMENT is a LINE status; the request HEADER
      // stays SUBMITTED at this point — so we gate on detailRow.lineStatus, not
      // requestStatus. `source`/`lineStatus` aren't in the openapi3 schema for
      // this view but EQR_V_LINE_DETAIL_UNITS returns them and callRest passes
      // undeclared body fields through.
      // Origin is 'EXTERNAL' | 'INTERNAL' (was 'CUSTOMER' | 'PROJECT') —
      // resolved through the app-flow owner, which accepts both spellings.
      const isCustomerSource = $application.functions.isExternalSource(detailRow.source);
      const isLineUnderProcurement =
        String(detailRow.lineStatus || '').toUpperCase() === 'UNDER_PROCUREMENT';
      const pickerReadOnly = isCustomerSource && isLineUnderProcurement;

      // Header gate: allocation is not allowed while the request is awaiting
      // approval (SUBMITTED) or a quote is still owed — when ENABLE_QUOTES
      // covers this request's origin, the manager must generate the quote
      // before committing equipment. This mirrors the disabled hamburger +
      // rowClickChain guard on request-detail — it's the direct-access backstop
      // so a bookmarked/back-nav URL can't be used to reach this page and
      // stage/save an allocation. Bounce back to the request before the
      // scheduler builds. Keep in lockstep with isRequestSubmitted /
      // isQuoteOwed in request-detail-page.js.
      // Quoting is resolved here from $application rather than read off
      // request-detail's cached quotingAllowed — this page may be entered
      // directly, so that variable isn't reachable. Fails CLOSED (no quote
      // owed) while settings load, same as the request-detail resolver.
      // EXCEPTION: a customer line at UNDER_PROCUREMENT is intentionally
      // viewable (read-only) even though the gate is closed — let it through so
      // the manager can view the picker/schedule. pickerReadOnly keeps
      // Assign/Release hidden in that case.
      const gateStatus  = String(header.requestStatus || '').toUpperCase();
      const quoteExists = ['QUOTE_GENERATED', 'QUOTE_ACCEPTED', 'DEPLOYED']
        .indexOf(gateStatus) !== -1;
      const quotingOn   = $application.functions.isQuotingAllowed(
        $application.variables.globalSettings,
        $application.variables.flagsLoaded,
        detailRow.source
      );
      const quoteOwed = quotingOn && !quoteExists;
      if ((gateStatus === 'SUBMITTED' || quoteOwed) && !pickerReadOnly) {
        console.log('[line-detail vbEnterChain] allocation gated (status=' + gateStatus +
                    ', quoteOwed=' + quoteOwed + ') — returning to request-detail');
        await Actions.navigateToPage(context, {
          page:   'request-detail',
          params: {
            requestId:     String(requestId),
            requestNumber: String($page.variables.requestNumber || header.requestNumber || '')
          }
        });
        return;
      }

      // ── Determine mode: 'serial' vs 'lot' vs 'inventory' ───────────────
      // Drives the entire scheduler-resource flow below. Flags come straight
      // from the enriched row. Precedence: serial → lot → inventory. (Multiple
      // Y flags on the same master is unusual; we render the most specific
      // picker available.) Default to 'serial' if a flag is somehow missing
      // (back-compat with prior behavior).
      const toBoolY = (v) => (typeof v === 'boolean')
        ? v
        : (v || '').toString().toUpperCase() === 'Y';
      const isLotCtrl    = toBoolY(detailRow.isLotControlled);
      const isSerialCtrl = (detailRow.isSerialControlled != null)
        ? toBoolY(detailRow.isSerialControlled)
        : true; // default true → preserve existing behavior
      const isInvTracked = toBoolY(detailRow.isInventoryTracked);
      // F&M — no Fusion inventory movement, so it is assigned directly rather
      // than picked. The class is the line's FULFILMENT_CLASS (master AND both
      // yards transactable), which views/line-detail-units repeats on every
      // unit row. rdl.isFAndM is the one front-end reader of the rule; it falls
      // back to isTransactable, and to S&T when neither field is present.
      const isFAndM = rdl.isFAndM(detailRow);
      let mode;
      if (isSerialCtrl)         mode = 'serial';
      else if (isLotCtrl)       mode = 'lot';
      else if (isInvTracked)    mode = 'inventory';
      else                      mode = 'serial'; // fallback (free-stock should not reach this page)
      console.log('[line-detail vbEnterChain] mode=', mode,
        'isSerialCtrl=', isSerialCtrl, 'isLotCtrl=', isLotCtrl,
        'isInvTracked=', isInvTracked, 'isFAndM=', isFAndM);

      // F&M lines need NO special mode today. Serial control is orthogonal to
      // the S&T/F&M split, and every F&M master currently in paasdev (30 of
      // them, 60 EQR_SERIAL_REF units) is serial controlled — so they all take
      // the 'serial' branch above and assign real units, exactly like a serial
      // S&T line. The ONLY difference between the two classes is downstream:
      // F&M creates no Transfer Order at confirm.
      //
      // A NON-SERIAL F&M master (no serial units, no lot, no inventory item)
      // has no picker that applies and would need quantity-against-the-master
      // allocation, which does not exist yet. None exist, so rather than ship
      // an untestable branch this logs loudly if one ever appears. If this
      // warning shows up in a console, that pathway now has to be built.
      if (isFAndM && !isSerialCtrl && !isLotCtrl) {
        console.warn('[line-detail vbEnterChain] NON-SERIAL F&M line ' + lineId +
          ' — no unit picker applies (no serial/lot units, no inventory item).' +
          ' Quantity-against-master allocation is NOT implemented; the picker' +
          ' will render empty. See docs/FIXED_ASSET_FM_PATHWAY_SPEC.md §3.2.');
      }

      // ── Populate header / line page variables ───────────────────────────
      $page.variables.pageTitle = eqpInfo.equipmentName || ('Line ' + lineId);

      const subtitleParts = [
        header.requestNumber,
        header.projectOrCustomer || header.projectName,
        header.taskName,
      ].filter(Boolean);
      $page.variables.pageSubtitle = subtitleParts.join(' | ');

      $page.variables.requestData = {
        request_number:   header.requestNumber   || '',
        project_customer: header.projectOrCustomer || header.projectName || '',
        task:             header.taskName        || '',
        requestor:        header.requestor       || '',
        location:         header.location        || '',
        start_date:       formatDate(header.requestedStartDate),
        end_date:         formatDate(header.requestedEndDate),
        status:           header.requestStatus   || '',
      };

      const lineStart = formatDate(header.requestedStartDate);
      const lineEnd   = formatDate(header.requestedEndDate);

      $page.variables.lineData = {
        line_id:             lineRow.id,
        equipment_master_id: lineRow.eqrEquipmentMasterId,
        equipment_name:      eqpInfo.equipmentName,
        class:               eqpInfo.className,
        qty:                 lineRow.quantity           || 1,
        alloc_status:        lineRow.allocationStatus   || 'PENDING',
        allocated_serial:    '',
        allocated_qty:       0,
        bill_rate:           lineRow.billRate           || 0,
        est_cost:            lineRow.estimatedCost      || 0,
        util_pct:            lineRow.targetUtilPercent  || 0,
        start_date:          lineStart,
        end_date:             lineEnd,
        // Carried for the ALLOCATION GATE in saveLineChain: allocation is only
        // permitted at the point in the lifecycle where equipment may actually
        // be committed, and that point depends on whether this request gets
        // quoted. Both values are already resolved above, so stamping them here
        // saves the save chain re-fetching the line and re-reading the setting.
        line_status:         lineRow.lineStatus || '',
        source:              detailRow.source   || '',
        quoting_on:          quotingOn === true,
      };

      $page.variables.adjustedStartDate = lineStart;
      $page.variables.adjustedEndDate   = lineEnd;

      // ── Existing allocations for this line (fetched in the parallel batch) ─
      // Used ONLY by the serial event-bar block (a) below — the per-unit
      // allocation state (allocationId/allocatedQty) for all three modes now
      // comes straight off the line-detail-units rows.
      let activeAllocations = [];
      if (allocResp && allocResp.ok) {
        const allAllocations = (allocResp.body && allocResp.body.data) || [];
        activeAllocations = allAllocations.filter(a =>
          (a.allocationStatus || '').toUpperCase() !== 'RELEASED'
        );
      }

      // ── Is THIS LINE confirmed? PER-LINE (not request-level): a TO raised for
      // a sibling line must NOT lock this line. A line is confirmed only when its
      // requestLineId is on a TO line whose TO is LIVE in Fusion
      // (fusionToStatus==='TO_CREATED') — see resources/js/lineConfirmed.
      // Pending ('SR_CREATED') / failed ('TO_FAILED') TOs don't lock.
      // Computed HERE — ahead of the lot/inventory branches, which return early —
      // so it can be passed into initScheduler in every mode. Drives the read-only
      // picker gate (Assign + Release hidden) and, for serial, the bar colour
      // below (Reserving orange vs Booked blue).
      const currentLineConfirmed = await lineConfirmed.lineIsConfirmed(
        context, Actions,
        (toResp && toResp.ok && toResp.body && toResp.body.data) || [],
        lineId
      );

      // ──────────────────────────────────────────────────────────────────
      // LOT-CONTROLLED BRANCH — fetch lot-refs, build lot-resources, init
      // scheduler in 'lot' mode, then return. Skips the entire serial flow
      // (serial-refs fetch, workbench-lines cross-request bars, event bars).
      // ──────────────────────────────────────────────────────────────────
      if (mode === 'lot') {
        // LOT rows come from line-detail-units (unitType=LOT); resources built
        // by the shared module (ATR only, no on-hand). No cross-request bars
        // for lots in v1 — scheduler shows the green "Requested period" band.
        const eqpMasterId = equipmentMasterId || lineRow.eqrEquipmentMasterId;
        const built = lineDetailUnits.buildResources(detailRows, 'lot', eqpInfo, eqpMasterId);
        console.log('[line-detail vbEnterChain] LOT units from line-detail-units:', built.resources.length);

        $page.variables.lineHasAllocations = built.allocated.length > 0;
        $page.functions.initScheduler(built.resources, [], $page.variables.lineData, built.allocated, 'lot', currentLineConfirmed, pickerReadOnly);
        return;
      }

      // ──────────────────────────────────────────────────────────────────
      // INVENTORY-TRACKED BRANCH — fetch inventory-item-refs, filter to
      // this equipment master client-side (endpoint only accepts invOrgId
      // as a query param, NOT equipmentId — see openapi3.json), build
      // resources shaped like lots, init scheduler in 'inventory' mode.
      // No cross-request booking bars (AllocationDto has no inventory FK
      // declared in the spec — until that's wired, allocations from this
      // page reuse the lotRefId slot in the same allocation save path).
      // ──────────────────────────────────────────────────────────────────
      if (mode === 'inventory') {
        // INVENTORY rows from line-detail-units (unitType=INVENTORY); resources
        // built by the shared module (lot-shaped for the qty renderer, ATR
        // only). No cross-request bars for inventory in v1.
        const eqpMasterId = equipmentMasterId || lineRow.eqrEquipmentMasterId;
        const built = lineDetailUnits.buildResources(detailRows, 'inventory', eqpInfo, eqpMasterId);
        console.log('[line-detail vbEnterChain] INVENTORY units from line-detail-units:', built.resources.length);

        $page.variables.lineHasAllocations = built.allocated.length > 0;
        $page.functions.initScheduler(built.resources, [], $page.variables.lineData, built.allocated, 'inventory', currentLineConfirmed, pickerReadOnly);
        return;
      }

      // ── SERIAL units from line-detail-units ─────────────────────────────
      // The serial picker comes from the enriched view, which computes per-unit
      // availabilityStatus server-side over the line window (EQR_AVAILABILITY_
      // PKG). Resources built by the shared module (status from availability
      // Status + allocationId). The bar logic below still reads `resources` /
      // `allocatedSerials`.
      const eqpMasterId = equipmentMasterId || lineRow.eqrEquipmentMasterId;
      const builtSerial = lineDetailUnits.buildResources(detailRows, 'serial', eqpInfo, eqpMasterId);
      const resources = builtSerial.resources;
      const allocatedSerials = builtSerial.allocated;
      console.log('[line-detail vbEnterChain] SERIAL units from line-detail-units:', resources.length);

      // ── Cross-request bookings for this master (Phase 2) ────────────────
      // line-detail-bookings returns one row per ALLOCATED serial booking on
      // THIS master, across all requests, already carrying the booking window,
      // serial unitRefId (join straight to resource.id — no serial-name match),
      // project/task, and ship-to coords. Replaces the (500-ing) workbench-
      // lines feed. Fetched here (not in the parallel batch) because the master
      // id is only known after the units fetch resolves; the URL param may be
      // empty. Bars are serial-only, so skip the fetch in lot/inventory modes.
      let bookingRows = [];
      if (eqpMasterId) {
        let bookingsResp = null;
        try {
          bookingsResp = await Actions.callRest(context, {
            endpoint:  'eqp-v1/getEquipriteV1ViewsLineDetailBookings',
            uriParams: { equipmentMasterId: Number(eqpMasterId), size: 10000 }
          });
        } catch (e) {
          console.warn('[line-detail vbEnterChain] line-detail-bookings fetch failed:', e);
        }
        if (bookingsResp && bookingsResp.ok && bookingsResp.body && Array.isArray(bookingsResp.body.data)) {
          bookingRows = bookingsResp.body.data;
        } else if (bookingsResp) {
          console.warn('[line-detail vbEnterChain] line-detail-bookings not ok HTTP', bookingsResp.status);
        }
      }

      // See resources/js/bryntumDates.js — Bryntum endDate is exclusive;
      // bump +1 day so bars visually cover through the inclusive backend end.
      const inclusiveEnd = bryntumDates.inclusiveEnd;

      const myReqNumber = header.requestNumber || $page.variables.requestNumber || '';

      // Confirmed state (currentLineConfirmed) was resolved above, ahead of
      // the lot/inventory branches. Allocations on a request with a TO render
      // as Booked (blue); otherwise Reserving (orange).

      // Build the events array two ways:
      //   (a) THIS line's bar comes from the allocations table (instant after
      //       Save — no view-refresh lag). Labelled Reserving/Booked by the
      //       request-confirmed flag above.
      //   (b) OTHER requests' bars (cross-request visibility) come from the
      //       workbench-lines view. Filtered to EXCLUDE our own request to
      //       avoid double-drawing.
      const events = [];
      let evtSeq = 1;

      // Tracks how many events have been pinned at each lat/long key so we
      // can jitter overlapping events on a 12-position ring (~10 m radius).
      // Same pattern as the schedule page so the map doesn't stack pins.
      const eventsByLatLngKey = new Map();
      const RING_RADIUS_DEG   = 0.00009; // ~10 m
      const RING_SLOTS        = 12;

      // Resolve a request's ship-to-site → event-marker lat/lon. Returns
      // { lat, lon } or { lat:null, lon:null } when the request has no
      // site or the site has no coordinates. Auto-jitters duplicates.
      function resolveEventAddress(reqId) {
        const site = (reqId != null) ? siteByRequestId[Number(reqId)] : null;
        if (!site || site.latitude == null || site.longitude == null) {
          return { lat: null, lon: null, shortAddress: '' };
        }
        const baseLat = Number(site.latitude);
        const baseLon = Number(site.longitude);
        const key = baseLat.toFixed(4) + ',' + baseLon.toFixed(4);
        const idx = eventsByLatLngKey.get(key) || 0;
        eventsByLatLngKey.set(key, idx + 1);
        if (idx === 0) {
          return { lat: baseLat, lon: baseLon, shortAddress: site.siteName || site.address || '' };
        }
        const angle = (2 * Math.PI * idx) / RING_SLOTS;
        return {
          lat: baseLat + RING_RADIUS_DEG * Math.cos(angle),
          lon: baseLon + RING_RADIUS_DEG * Math.sin(angle),
          shortAddress: site.siteName || site.address || ''
        };
      }

      // (a) Current-line bar(s) from activeAllocations + this line's window.
      const lineStartDate = lineRow.startDate || header.requestedStartDate;
      const lineEndDate   = lineRow.endDate   || header.requestedEndDate;
      activeAllocations.forEach(a => {
        // Allocations carry one FK per unit type; the resource rows come from
        // views/line-detail-units, whose unitRefId is that same per-type ref
        // id. Compare against whichever FK this allocation actually has.
        const allocRefId = a.eqrSerialRefId != null ? a.eqrSerialRefId
                         : a.eqrLotRefId    != null ? a.eqrLotRefId
                         : a.inventoryItemRefId;
        const matchingResource = resources.find(r =>
          allocRefId != null && Number(r.unitRefId) === Number(allocRefId));
        if (!matchingResource) return;
        if (!lineStartDate || !lineEndDate) return;
        const addr = resolveEventAddress(requestId);
        events.push({
          id:          'evt-' + (evtSeq++),
          resourceId:  matchingResource.id,
          name:        currentLineConfirmed ? 'Booked' : 'Reserving',
          startDate:   lineStartDate,
          endDate:     inclusiveEnd(lineEndDate),
          eventColor:  currentLineConfirmed ? '#1565C0' : '#f59e0b',
          requestNumber: myReqNumber,
          projectName:  header.projectName || '',
          taskName:     header.taskName    || '',
          shortAddress: addr.shortAddress,
          address:      { lat: addr.lat, lon: addr.lon },
        });
      });

      // (b) Other requests' bars from line-detail-bookings (filter out OUR
      // request so we don't double-draw the bar synthesised in (a)). The view
      // already returns only ALLOCATED bookings, and each row joins to a
      // resource directly by unitRefId (== resource.id) — no serial-name match.
      // Jitter overlapping ship-to coords on the same 12-position ring as (a).
      const resourceIds = new Set(resources.map(r => Number(r.id)));
      // The view can return exact-duplicate booking rows (same unit + request +
      // window); dedupe so we don't draw two identical bars on one serial.
      const seenBooking = new Set();
      const diag = { totalBookings: bookingRows.length, ownSkipped: 0, unmatched: 0, withDates: 0, dedupedDrops: 0, built: 0 };

      const jitter = (lat, lon, siteName) => {
        if (lat == null || lon == null) return { lat: null, lon: null, shortAddress: siteName || '' };
        const baseLat = Number(lat), baseLon = Number(lon);
        const key = baseLat.toFixed(4) + ',' + baseLon.toFixed(4);
        const idx = eventsByLatLngKey.get(key) || 0;
        eventsByLatLngKey.set(key, idx + 1);
        if (idx === 0) return { lat: baseLat, lon: baseLon, shortAddress: siteName || '' };
        const angle = (2 * Math.PI * idx) / RING_SLOTS;
        return {
          lat: baseLat + RING_RADIUS_DEG * Math.cos(angle),
          lon: baseLon + RING_RADIUS_DEG * Math.sin(angle),
          shortAddress: siteName || ''
        };
      };

      bookingRows.forEach(b => {
        if (!b) return;
        // Skip bookings on THIS request — covered authoritatively by block (a).
        if (String(b.bookingRequestNumber || '') === String(myReqNumber || '')) { diag.ownSkipped++; return; }

        const resId = Number(b.unitRefId);
        if (!resourceIds.has(resId)) { diag.unmatched++; return; }

        const barStart = b.bookingStartDate;
        const barEnd   = b.bookingEndDate;
        if (!barStart || !barEnd) return;
        diag.withDates++;

        const dedupeKey = resId + '|' + (b.bookingRequestNumber || '') + '|' + barStart + '|' + barEnd;
        if (seenBooking.has(dedupeKey)) { diag.dedupedDrops++; return; }
        seenBooking.add(dedupeKey);

        // Booked (blue) — from this user's standpoint the serial is occupied
        // by another request during that window regardless of its confirm state.
        const addr = jitter(b.shipToLatitude, b.shipToLongitude, b.shipToSiteName || b.location);
        events.push({
          id:          'evt-' + (evtSeq++),
          resourceId:  resId,
          name:        'Booked',
          startDate:   barStart,
          endDate:     inclusiveEnd(barEnd),
          eventColor:  '#1565C0',
          requestNumber: b.bookingRequestNumber || '',
          projectName:  b.projectName || '',
          taskName:     b.taskName || '',
          shortAddress: addr.shortAddress || b.location || '',
          address:      { lat: addr.lat, lon: addr.lon },
        });
        diag.built++;
      });

      console.log('[line-detail vbEnterChain] cross-request bar diagnostics:', diag);
      console.log('[line-detail vbEnterChain] currentLineConfirmed=', currentLineConfirmed,
                  'events built=', events.length, 'sample=', events[0]);

      // Lock date pickers if this line already has any active allocations —
      // moving a line's dates after allocation creates inconsistency. User
      // must release first, save, then come back to edit dates.
      $page.variables.lineHasAllocations = allocatedSerials.length > 0;

      // ── Planned maintenance bars ────────────────────────────────────────
      // Same source and same treatment as the fleet-wide equipment-schedule
      // page: Fusion maintenance work orders drawn PlannedStartDate →
      // PlannedCompletionDate, in the legend's Maintenance grey.
      //
      // It belongs here for the same reason it belongs there — this scheduler
      // answers "is this serial free for my window", and a unit booked into the
      // workshop is not free. Without these bars a user can allocate a serial
      // straight over its own scheduled maintenance.
      //
      // Scoped to THIS line's serials only, so it is a handful of assets rather
      // than the whole fleet.
      try {
        const serialRows = (serialResp && serialResp.ok && serialResp.body)
          ? (serialResp.body.data || []) : [];

        // Join on the SERIAL ref. The resource id comes from
        // views/line-detail-units' unitRefId, which emits serial-ref ids
        // (verified against EQR_V_LINE_DETAIL_UNITS), so sr.id from
        // /serial-refs is the matching space. Both sides have to move
        // together: pairing one space against the other matches nothing and
        // the maintenance bars silently stop rendering.
        const resourceIds = new Set(resources.map(r => Number(r.id)));
        const mineWithAsset = serialRows.filter(sr =>
          sr && resourceIds.has(Number(sr.id)) && sr.maintenanceAssetNumber);

        if (mineWithAsset.length) {
          const woByAsset = await maintenanceWorkOrders.fetchByAsset(
            context, Actions, mineWithAsset);

          // One asset commonly covers MANY serials, so a work order on it draws
          // a bar on every serial sharing it — which is correct: they are the
          // same physical asset in Fusion's eyes.
          mineWithAsset.forEach(sr => {
            const list = woByAsset[sr.maintenanceAssetNumber] || [];
            list.forEach(w => {
              const bar = maintenanceWorkOrders.toBar(w);
              if (!bar) return;   // no planned start → not on a timeline
              events.push({
                id:          'evt-' + (evtSeq++),
                resourceId:  Number(sr.id),
                name:        'Maintenance',
                startDate:   bar.start,
                // inclusiveEnd matches how every other bar on this page is
                // built; a missing completion date collapses to a single day.
                endDate:     inclusiveEnd(bar.end || bar.start),
                eventColor:  maintenanceWorkOrders.COLOR,
                // The popup reads these three; work-order fields stand in.
                requestNumber: bar.number,
                projectName:   bar.type,
                taskName:      bar.detail,
                shortAddress:  bar.asset,
                // No map pin: a work order is against the ASSET, not a ship-to
                // site, so there is no coordinate to place it at.
                address:      { lat: null, lon: null },
              });
            });
          });
        }
      } catch (e) {
        // Never let maintenance take out the allocation picker — that is what
        // this page is actually for.
        console.warn('[line-detail vbEnterChain] maintenance bars unavailable', e);
      }

      // ── Build the Bryntum split-pane (scheduler + map) ──────────────────
      $page.functions.initScheduler(resources, events, $page.variables.lineData, allocatedSerials, 'serial', currentLineConfirmed, pickerReadOnly);
    }
  }

  return vbEnterChain;
});

