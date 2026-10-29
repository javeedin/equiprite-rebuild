define([
  'vb/action/actionChain',
  'vb/action/actions',
  'vb/action/actionUtils',
  'resources/js/draftStorage',
], (ActionChain, Actions, ActionUtils, draftStorage) => {
  'use strict';

  class EquipmentDetailInitChain extends ActionChain {
    async run(context) {
      const { $page, $flow } = context;

      const equipmentId = $page.variables.equipmentId;

      if (!equipmentId) {
        $page.variables.messagesBannerArray = [{
          id: 'no-id-error',
          summary: 'Error',
          detail: 'No equipment ID provided. Return to the catalog and select an item.',
          messageType: 'general-error'
        }];
        // Auto-dismiss the banner after 4 seconds (app-wide rule).
        setTimeout(() => { $page.variables.messagesBannerArray = []; }, 4000);
        return;
      }

      // Runs on vbEnter AND again from BundleCardClickChain when a suggestion
      // card swaps this page to another item in place. Skip a re-entry for the
      // id that is already loading/loaded so the two can't race.
      if ($page.variables.loadedForId === String(equipmentId)) return;
      $page.variables.loadedForId = String(equipmentId);

      $page.variables.isLoading = true;
      $page.variables.bundleSuggestions = [];
      $page.variables.bundleQtyById = {};

      // Same quote-pricing rule as CatalogInitChain: when ENABLE_QUOTES covers
      // this request's origin, catalog prices are hidden ("Rate on request").
      // Fails closed to false (rates shown) while settings load.
      {
        const _req0 = $flow.variables.request || {};
        let _origin = String(_req0.requestType || '').toUpperCase();
        if (_origin !== 'EXTERNAL' && _origin !== 'INTERNAL') {
          _origin = ($flow.variables.requestOrigin === 'customer') ? 'EXTERNAL' : 'INTERNAL';
        }
        $page.variables.hideRatesForQuote = !!(
          context.$application &&
          context.$application.functions.isQuotingAllowed(
            context.$application.variables.globalSettings,
            context.$application.variables.flagsLoaded,
            _origin
          )
        );
      }

      // Fusion PPM prices rentals (global flag): show its text instead of any
      // EquipRite list price. Wins over the quote rule above.
      $page.variables.ppmRateText = context.$application
        ? context.$application.functions.ppmRateText(
            context.$application.variables.featureFlags,
            context.$application.variables.flagsLoaded)
        : '';

      // ── 1. Master record (always required first; everything else fans out from it) ──
      const masterResp = await Actions.callRest(context, {
        endpoint: 'eqp-v1/getEquipriteV1EquipmentMasterById',
        uriParams: { id: Number(equipmentId) }
      });

      if (!masterResp.ok || !masterResp.body) {
        $page.variables.messagesBannerArray = [{
          id: 'not-found-error',
          summary: 'Not Found',
          detail: 'Equipment ID ' + equipmentId + ' was not found.',
          messageType: 'general-error'
        }];
        $page.variables.isLoading = false;
        // Let a retry for the same id through.
        $page.variables.loadedForId = '';
        // Auto-dismiss the banner after 4 seconds (app-wide rule).
        setTimeout(() => { $page.variables.messagesBannerArray = []; }, 4000);
        return;
      }

      const master = masterResp.body;

      // ── 2. Fan out remaining lookups in parallel ─────────────────────────
      // Class+subclass is a sequential pair (subclass needs classId). Wrap it
      // as a single promise so it runs in parallel with location and serial.
      const classAndSubclassPromise = (async () => {
        let className = '';
        let subclassName = '';
        if (master.equipmentClassId) {
          try {
            const clsResp = await Actions.callRest(context, {
              endpoint: 'eqp-v1/getEquipmentClassById',
              uriParams: { id: Number(master.equipmentClassId) }
            });
            if (clsResp.ok && clsResp.body) {
              className = clsResp.body.className || clsResp.body.name || '';
            }
          } catch (e) {
            console.warn('[EquipmentDetailInitChain] class lookup failed:', e);
          }
          if (master.equipmentSubclassId) {
            try {
              const subResp = await Actions.callRest(context, {
                endpoint: 'eqp-v1/getSubclassById',
                uriParams: {
                  classId: Number(master.equipmentClassId),
                  id:      Number(master.equipmentSubclassId)
                }
              });
              if (subResp.ok && subResp.body) {
                subclassName = subResp.body.subclassName || subResp.body.name || '';
              }
            } catch (e) {
              console.warn('[EquipmentDetailInitChain] subclass lookup failed:', e);
            }
          }
        }
        return { className: className, subclassName: subclassName };
      })();

      // This page is MODEL-level: one master row, many possible physical units.
      // How those units are tracked decides what stock we can show — same rule
      // (and the same three endpoints) as equipment-units-page:
      //   SERIAL    → /serial-refs  — one row per serialized unit (cranes, welders)
      //   LOT       → /lot-refs     — quantity per lot (gases, lubricants, chemicals)
      //   INVENTORY → /inventory-item-refs — plain stock item (PPE, fasteners, tools)
      // NOTE the filter param differs: inventory-item-refs takes
      // eqrEquipmentMasterId, the other two equipmentId. A wrong name is
      // silently dropped and returns every item in the system.
      const controlType = master.isSerialControlled === 'Y' ? 'SERIAL'
                        : (master.isLotControlled === 'Y' ? 'LOT' : 'INVENTORY');

      const stockPromise = (async () => {
        try {
          if (controlType === 'SERIAL') {
            const resp = await Actions.callRest(context, {
              endpoint: 'eqp-v1/getSerialRefs',
              uriParams: { equipmentId: Number(equipmentId), size: 10000 }
            });
            const units = ((resp && resp.ok && resp.body && resp.body.data) || [])
              .filter((u) => String(u.unitStatus || '').toUpperCase() !== 'RETIRED');
            // Resolve yard names once per distinct location (one parallel batch).
            const locIds = Array.from(new Set(units.map((u) => u.currentLocationId).filter((v) => v != null)));
            const locNames = {};
            await Promise.all(locIds.map((id) => Actions.callRest(context, {
              endpoint: 'eqp-v1/getLocationById',
              uriParams: { id: Number(id) }
            }).then((r) => {
              if (r && r.ok && r.body) locNames[id] = r.body.locationName || r.body.locationCode || r.body.address || '';
            }).catch(() => {})));
            return { units: units, locNames: locNames };
          }
          if (controlType === 'LOT') {
            const resp = await Actions.callRest(context, {
              endpoint: 'eqp-v1/getLotRefs',
              uriParams: { equipmentId: Number(equipmentId), size: 10000 }
            });
            return { lots: (resp && resp.ok && resp.body && resp.body.data) || [] };
          }
          const resp = await Actions.callRest(context, {
            endpoint: 'eqp-v1/getInventoryItemRefs',
            uriParams: { eqrEquipmentMasterId: Number(equipmentId), size: 50 }
          });
          return { refs: (resp && resp.ok && resp.body && resp.body.data) || [] };
        } catch (e) {
          console.warn('[EquipmentDetailInitChain] stock lookup failed:', e);
          return null;
        }
      })();

      // Rate/availability/agreement pricing live on the catalog endpoint, not
      // the master record — same lookup-by-id AddToCartChain used to do on
      // its own; fetching it once here means AddToCartChain can just reuse
      // recordData instead of hitting the network again.
      // The rate this endpoint returns is resolved FOR THE WINDOW AND SCOPE PASSED,
      // so this fetch must use the SAME startDate/endDate + projectRefId/customerRefId
      // as the catalog grid (CatalogInitChain injects them into equipmentSDP.
      // uriParameters). Anything else and the detail page shows a different price
      // than the card the user just clicked.
      //
      // No date fabrication: the old code fell back to today→today+7, which
      // silently priced a different duration than the request. With no request
      // window there is no correct rate, so we skip the fetch and leave
      // catalogRow null — the page then renders its "rate unavailable" state
      // (catalogAvailable false) instead of a plausible-looking wrong number.
      //
      // Resolves to ALL rows (not just this item's): the bundle suggestions
      // below take their price/availability from the same rows, so a
      // suggestion always shows exactly what its own catalog card shows.
      const catalogRowsPromise = (async () => {
        const req = $flow.variables.request || {};
        const startDate = req.startDate, endDate = req.endDate;
        if (!startDate || !endDate) {
          console.warn('[EquipmentDetailInitChain] no request window — skipping catalog rate lookup.');
          return null;
        }
        try {
          const uriParams = {
            startDate: String(startDate).substring(0, 10),
            endDate: String(endDate).substring(0, 10),
            requestedQty: 1, page: 0, size: 10000,
            agreementId: $flow.variables.fromAgreementId || null
          };
          // Rate-scoping context, injected ONLY when present — a uriParam that
          // resolves to undefined is serialized as the literal string "undefined"
          // and the int64 param can't parse it (same rule as CatalogInitChain).
          if (req.projectId != null) uriParams.projectRefId = Number(req.projectId);
          const _detail = $flow.variables.ActiveRequestDetail || {};
          if (_detail.customerRefId != null) uriParams.customerRefId = Number(_detail.customerRefId);

          const resp = await Actions.callRest(context, {
            endpoint: 'eqp-v1/getEquipriteV1ViewsEquipmentCatalog',
            uriParams: uriParams
          });
          return (resp && resp.ok && resp.body && Array.isArray(resp.body.data)) ? resp.body.data : [];
        } catch (e) {
          console.warn('[EquipmentDetailInitChain] catalog row lookup failed:', e);
          return null;
        }
      })();

      // Bundle suggestions: reciprocal item-to-item links (EQP_M_EQUIPMENT_BUNDLE).
      // Relationship data only — no pricing; that comes from catalogRows.
      // A failure just means no strip, never an error banner.
      const bundlePromise = (async () => {
        try {
          const resp = await Actions.callRest(context, {
            endpoint: 'eqp-v1/getEquipmentBundles',
            uriParams: { equipmentId: Number(equipmentId) }
          });
          return (resp && resp.ok && resp.body && Array.isArray(resp.body.data)) ? resp.body.data : [];
        } catch (e) {
          console.warn('[EquipmentDetailInitChain] bundle lookup failed:', e);
          return [];
        }
      })();

      const [classes, stockData, catalogRows, bundleRows] = await Promise.all([
        classAndSubclassPromise,
        stockPromise,
        catalogRowsPromise,
        bundlePromise
      ]);

      // null = no request window (fetch skipped) or the fetch failed.
      const catalogRowById = {};
      (catalogRows || []).forEach((r) => { catalogRowById[Number(r.eqrEquipmentMasterId)] = r; });
      const catalogRow = catalogRowById[Number(equipmentId)] || null;

      // ── 3. Populate page variables ───────────────────────────────────────
      const safe = (v) => (v === undefined || v === null || v === '') ? '—' : v;

      // Agreement rate wins over the catalog's own rate, same rule the
      // catalog page and its cart chains use.
      // Price + unit, branching on RENTABLE vs CONSUMABLE (only an explicit
      // isRentable === false is a consumable, same convention as the catalog page):
      //   • RENTABLE   → catalogRow.rate, the per-day amount the endpoint already
      //     resolved for the requested duration (replaces the old billRate /
      //     dailyRate-weeklyRate-monthlyRate tier fields). Unit is always DAY.
      //   • CONSUMABLE → catalogRow.unitPrice, a per-unit amount. Unit is EACH so
      //     the header renders "$5 / EACH", not "$5 / DAY".
      let billRate = null;
      let rateUom = null;
      if (catalogRow) {
        if (catalogRow.isRentable === false) {
          billRate = catalogRow.unitPrice != null ? catalogRow.unitPrice : 0;
          rateUom  = 'EACH';
        } else {
          billRate = catalogRow.rate != null ? catalogRow.rate : 0;
          rateUom  = catalogRow.rateUom || 'DAY';
        }
      }
      let onAgreement = false;
      if (catalogRow && $flow.variables.fromAgreementId && draftStorage.hasStoredDraft('agreementRateByEquipmentId')) {
        const agreementRateMap = draftStorage.load('agreementRateByEquipmentId') || {};
        const agr = agreementRateMap[equipmentId] || agreementRateMap[String(equipmentId)];
        if (agr) {
          if (agr.billingRate != null) billRate = agr.billingRate;
          if (agr.billingUnit)         rateUom = agr.billingUnit;
          onAgreement = true;
        }
      }

      // ── Model attributes, straight from the master row ─────────────────
      // Only fields that exist on a MASTER. The old page read unit-level
      // fields (serial, location, owner type, model year) off the master,
      // where they don't exist, and hardcoded Owning Org — so they were
      // always blank or wrong. Units are summarised under Stock instead.
      const has = (v) => v !== undefined && v !== null && String(v).trim() !== '';
      const withUom = (v, uom) => has(v) ? String(v) + (has(uom) ? ' ' + uom : '') : '';
      const fmtN = (n) => { const v = Number(n); return isNaN(v) ? '0' : v.toLocaleString('en-US'); };
      const fields = (pairs) => pairs.filter((p) => has(p[1])).map((p) => ({ label: p[0], value: String(p[1]) }));
      const isRentableItem = master.isRentableFlag !== 'N';
      const trackingLabel = { SERIAL: 'Serialized units', LOT: 'Lot-controlled stock', INVENTORY: 'Stock item' }[controlType];

      const overviewFields = fields([
        ['Manufacturer',      master.manufacturer],
        ['Model Number',      master.modelNumber],
        ['Item Number',       master.equipmentNumber],
        ['Equipment Type',    master.equipmentType],
        ['Tracking',          trackingLabel],
        ['Billing',           isRentableItem ? 'Rented — billed per period' : 'Sold — billed per unit, not returned'],
        ['Country of Origin', master.countryOfOrigin]
      ]);

      const dims = [master.dimLength, master.dimWidth, master.dimHeight].filter(has);
      const specFields = fields([
        ['Capacity',     withUom(master.capacity, master.capacityUom)],
        ['Power Rating', withUom(master.powerRating, master.powerUom)],
        ['Fuel Type',    master.fuelType],
        ['Weight',       withUom(master.weight, master.weightUom)],
        ['Dimensions',   dims.length ? withUom(dims.join(' × '), master.dimUom) : '']
      ]);

      // Rental terms only mean something for a rentable item.
      const rentUom = has(master.defaultRentalUom) ? String(master.defaultRentalUom).toLowerCase() : 'day';
      const rentalFields = isRentableItem ? fields([
        ['Minimum Rental', has(master.minRentalDuration) ? master.minRentalDuration + ' ' + rentUom + (Number(master.minRentalDuration) === 1 ? '' : 's') : ''],
        ['Maximum Rental', has(master.maxRentalDuration) ? master.maxRentalDuration + ' ' + rentUom + (Number(master.maxRentalDuration) === 1 ? '' : 's') : '']
      ]) : [];

      const requirements = [];
      if (master.isCertificationRequired === 'Y') requirements.push('Certification required');
      if (master.isInspectable === 'Y')           requirements.push('Inspection required');

      const documents = [];
      if (has(master.safetyInfoUrl)) documents.push({ label: 'Safety information', url: master.safetyInfoUrl });
      if (has(master.userManualUrl)) documents.push({ label: 'User manual',        url: master.userManualUrl });

      // ── Stock, shaped by tracking type ─────────────────────────────────
      // Fleet/lot counts are TODAY's physical stock. Availability for the
      // customer's own dates is the catalog's figure, shown in the header badge.
      let stock = null;
      let stockBadge = null;
      if (stockData && controlType === 'SERIAL') {
        const units = stockData.units || [];
        const isAvail = (u) => String(u.unitStatus || '').toUpperCase() === 'AVAILABLE';
        const avail  = units.filter(isAvail).length;
        const rented = units.filter((u) => String(u.unitStatus || '').toUpperCase() === 'RENTED').length;
        const other  = units.length - avail - rented;
        const byYard = {};
        units.forEach((u) => {
          const name = (u.currentLocationId != null && stockData.locNames[u.currentLocationId]) || 'Location not set';
          byYard[name] = byYard[name] || { total: 0, available: 0 };
          byYard[name].total += 1;
          if (isAvail(u)) byYard[name].available += 1;
        });
        const stats = [
          { label: 'Units in fleet', value: String(units.length), tone: 'neutral' },
          { label: 'Available now',  value: String(avail),        tone: avail > 0 ? 'success' : 'warning' },
          { label: 'On rent',        value: String(rented),       tone: 'neutral' }
        ];
        if (other > 0) stats.push({ label: 'Other status', value: String(other), tone: 'neutral' });
        stock = {
          title: 'Fleet',
          summary: units.length === 0 ? 'No units in the fleet yet.' : '',
          stats: units.length === 0 ? [] : stats,
          rows: Object.keys(byYard)
            .sort((a, b) => byYard[b].available - byYard[a].available || a.localeCompare(b))
            .map((k) => ({
              title:  k,
              detail: byYard[k].total + ' unit' + (byYard[k].total === 1 ? '' : 's') + ' at this yard',
              pill:   byYard[k].available > 0 ? byYard[k].available + ' available' : 'All on rent',
              tone:   byYard[k].available > 0 ? 'success' : 'muted'
            }))
        };
        stockBadge = avail > 0 ? { text: avail + ' available now', status: 'success' }
                               : { text: units.length ? 'None available now' : 'No units', status: 'warning' };
      } else if (stockData && controlType === 'LOT') {
        // Recalled or inactive lots can't be issued, so they don't count.
        const lots = (stockData.lots || []).filter((l) =>
          String(l.lotStatus || 'ACTIVE').toUpperCase() === 'ACTIVE' && l.isRecalledFlag !== 'Y');
        const uom = (lots.find((l) => has(l.uomCode)) || {}).uomCode || '';
        const totalAvail = lots.reduce((s, l) => s + (Number(l.availableToReserve) || 0), 0);
        if (lots.some((l) => l.hazmatFlag === 'Y')) requirements.push('Hazardous material');
        // First-expiring first (FEFO); lots without an expiry go last.
        const byExpiry = lots.slice().sort((a, b) =>
          (a.expiryDate ? 0 : 1) - (b.expiryDate ? 0 : 1) || String(a.expiryDate || '').localeCompare(String(b.expiryDate || '')));
        stock = {
          title: 'Stock by lot',
          summary: lots.length === 0 ? 'No active lots in stock.' : '',
          stats: lots.length === 0 ? [] : [
            { label: 'Available' + (uom ? ' (' + uom + ')' : ''), value: fmtN(totalAvail), tone: totalAvail > 0 ? 'success' : 'warning' },
            { label: 'Active lots', value: String(lots.length), tone: 'neutral' }
          ],
          rows: byExpiry.map((l) => ({
            title:  l.lotNumber || 'Unnumbered lot',
            detail: 'On hand ' + fmtN(l.onHandQty) + (l.expiryDate ? ' · Expires ' + String(l.expiryDate).substring(0, 10) : ' · No expiry'),
            pill:   Number(l.availableToReserve) > 0 ? fmtN(l.availableToReserve) + (uom ? ' ' + uom : '') + ' available' : 'Fully reserved',
            tone:   Number(l.availableToReserve) > 0 ? 'success' : 'muted'
          }))
        };
        stockBadge = totalAvail > 0 ? { text: fmtN(totalAvail) + (uom ? ' ' + uom : '') + ' in stock', status: 'success' }
                                    : { text: 'Out of stock', status: 'warning' };
      } else if (stockData) {
        // Plain stock item. Quantity comes from the catalog (it's resolved for
        // the customer's dates); the item refs are only used for the unit of
        // measure — several masters carry duplicate ref rows, so summing
        // their on-hand would double-count.
        const uom = ((stockData.refs || []).find((r) => has(r.uomCode)) || {}).uomCode || '';
        const qty = catalogRow && catalogRow.availableQty != null ? catalogRow.availableQty : null;
        stock = {
          title: 'Stock',
          summary: qty != null ? '' : 'Select your rental dates to check availability.',
          stats: qty != null
            ? [{ label: 'Available for your dates' + (uom ? ' (' + uom + ')' : ''), value: fmtN(qty), tone: Number(qty) > 0 ? 'success' : 'warning' }]
            : [],
          rows: []
        };
      }

      const record = {
        equipmentId:     master.id,
        equipmentNumber: master.equipmentNumber || '',
        name:            master.equipmentName || '',
        description:     master.equipmentDescription || master.shortDescription || '',
        class:           classes.className,
        classId:         master.equipmentClassId != null ? Number(master.equipmentClassId) : null,
        subClass:        classes.subclassName,
        equipmentType:   master.equipmentType || '',
        controlType:     controlType,
        overviewFields:  overviewFields,
        specFields:      specFields,
        rentalFields:    rentalFields,
        requirements:    requirements,
        documents:       documents,
        stock:           stock,
        catalogAvailable: !!catalogRow,
        // Consumable pricing rides along so AddToCartChain can rebuild a
        // catalog-shaped row and cart.itemFromRow takes the right branch
        // (per-unit 'EACH' vs per-day 'DAY'). Falls back to the master flag
        // for the header's Rate / Unit Price label when there is no row.
        isRentable:      catalogRow ? catalogRow.isRentable : (isRentableItem ? undefined : false),
        unitPrice:       catalogRow ? catalogRow.unitPrice : null,
        billRate:        billRate,
        rateUom:         rateUom,
        onAgreement:     onAgreement,
        equipmentImage:  (catalogRow && catalogRow.equipmentImage) || master.equipmentImage || ''
      };

      $page.variables.recordData = record;

      $page.variables.pageTitle    = record.name || 'Equipment Detail';
      $page.variables.pageSubtitle = (record.class || '') + ' · ' + (record.equipmentNumber || '');

      $page.variables.contextualInfo = [
        { label: 'Class',     value: safe(record.class) },
        { label: 'Sub-Class', value: safe(record.subClass) },
        { label: 'Type',      value: safe(record.equipmentType) },
        { label: 'Tracking',  value: trackingLabel }
      ];

      // Badge reflects real-time availability for the requested rental window
      // (same AVAILABLE | PARTIAL DURATION | PARTIAL QUANTITY | NOT AVAILABLE
      // enum the catalog card badge uses) whenever dates are known. Falls back
      // to the master record's static ownership status in browse-only mode
      // (no dates yet → catalogRow.availabilityStatus is null).
      if (catalogRow && catalogRow.availabilityStatus != null) {
        const availabilityStatusMap = {
          'AVAILABLE':        'success',
          'PARTIAL DURATION': 'warning',
          'PARTIAL QUANTITY': 'warning',
          'NOT AVAILABLE':    'danger'
        };
        $page.variables.badge = {
          text: catalogRow.availabilityStatus + (catalogRow.availableQty != null ? ' | ' + catalogRow.availableQty : ''),
          status: availabilityStatusMap[catalogRow.availabilityStatus] || 'neutral'
        };
      } else {
        // Browse-only (no dates): today's physical stock instead. The old
        // fallback read master.status, which doesn't exist → always "Unknown".
        $page.variables.badge = stockBadge || { text: 'Select dates for availability', status: 'neutral' };
      }

      // Bundle suggestions, joined to their own catalog rows for price and
      // availability. row stays null in browse-only mode (no dates) — the card
      // then shows "Select dates to see rate" and its Add is disabled, the
      // same guard AddToCartChain applies to this item. With dates, a
      // suggestion missing from the scoped catalog can't be ordered on this
      // request, so it is left out rather than shown as a dead card.
      const hasCatalog = catalogRows != null;
      $page.variables.bundleSuggestions = (bundleRows || [])
        .map((b) => ({
          id:             Number(b.suggestedEquipmentId),
          name:           b.equipmentName || '',
          manufacturer:   b.manufacturer || '',
          image:          b.equipmentImage || '',
          className:      b.className || '',
          linkType:       String(b.linkType || '').toLowerCase(),
          relationLabel:  b.relationLabel || '',
          suggestedQty:   Number(b.suggestedQuantity) > 0 ? Number(b.suggestedQuantity) : 1,
          row:            catalogRowById[Number(b.suggestedEquipmentId)] || null
        }))
        .filter((s) => !hasCatalog || s.row);

      // Each card's stepper starts at the link's suggestedQuantity (e.g. the
      // welder suggests 2 argon cylinders). A NEW object so VB publishes it.
      const _qtyById = {};
      $page.variables.bundleSuggestions.forEach((s) => { _qtyById[s.id] = s.suggestedQty; });
      $page.variables.bundleQtyById = _qtyById;

      // Prefill the stepper with the qty already in the cart, so reopening
      // an item you've added shows its current cart quantity, not 1.
      const existingCartLine = ($flow.variables.CartItemsArray || [])
        .find((ci) => Number(ci.id) === Number(equipmentId));
      $page.variables.qty = existingCartLine ? existingCartLine.quantity : 1;

      $page.variables.isLoading = false;
    }
  }

  return EquipmentDetailInitChain;
});
