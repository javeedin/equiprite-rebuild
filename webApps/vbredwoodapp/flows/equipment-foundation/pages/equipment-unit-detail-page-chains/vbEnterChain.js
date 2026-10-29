define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/unitProjectStore',
], (ActionChain, Actions, ups) => {
  'use strict';

  // ══════════════════════════════════════════════════════════════════════
  // Equipment Unit Detail - data assembly
  // ══════════════════════════════════════════════════════════════════════
  //
  // One physical stock unit == one EQR_SERIAL_REF row. Around it Oracle keeps
  // up to two more records for the SAME physical thing:
  //
  //   stock (serial) --serial number--> fixed asset --FA number--> maint asset
  //
  // Which of the three exist is driven by the master tracking flags
  // (IS_INVENTORY_TRACKED / IS_FIXED_ASSET_TRACKED / IS_MAINTENANCE_TRACKED).
  // Live dev data: 84 masters are stock-only, 30 are maintenance+fixed asset
  // with no stock, 8 are all three.
  //
  // ── WHERE EACH TAB'S DATA COMES FROM ──────────────────────────────────
  // Overview          EquipRite only. EQR_SERIAL_REF plus the master record.
  //                   Never calls Fusion.
  // Maintenance Asset LIVE from Fusion - installedBaseAssets for the asset,
  //                   maintenanceWorkOrders for its work orders. Falls back to
  //                   the sample builders only when Fusion returns nothing.
  // Fixed Asset       HIDDEN (2026-10-12), and DERIVED - no live feed exists.
  //                   Gated by showFixedAssetTab (now false); code kept intact.
  //                   Read the note below before trusting any figure on it.
  //
  // ── THE FIXED ASSET TAB HAS NO LIVE FEED ──────────────────────────────
  // There is no readable fixed-asset REST resource on this pod. Probed directly
  // with working credentials on 2026-08-24: Financials REST is live (invoices,
  // journalBatches, receivablesInvoices, expenditureTypesLOV, projectsLOV,
  // erpintegrations all 200) but every asset resource 404s - fixedAssets,
  // assets, fixedAssetDepreciation, fixedAssetTransactions and ~40 more.
  //
  // That is Oracle's design, not a naming miss. The documentation states that
  // ALL fixed asset REST operations go through the erpintegrations endpoint by
  // POST, so there is no GET that returns cost, depreciation reserve or net
  // book value. It also explains the previous EquipRite app, which pulled FA
  // cost through the EQP_FA_COSTDETAILS OIC integration and an ORDS endpoint
  // rather than REST.
  //
  // So every figure on that tab is derived, not read from the asset book.
  // The tab is shown anyway and carries no on-screen marking - by request.
  // fixedAssetIsSample is still computed below, so re-binding a chip is a
  // one-line change if that call is reversed. Three routes would make the
  // figures live, cheapest first:
  //
  //   1. installedBaseAssets/{AssetId}/child/fixedAssetAssociations answers
  //      400, NOT 404 - "You need the MNT_ASSET_FIXEDASSET_ASSOCIATE security
  //      privilege". The resource exists; the account lacks a role. One grant
  //      away from being testable.
  //   2. The EQP_FA_COSTDETAILS OIC integration already returns
  //      {initial_cost, deprn_amount, net_book_value}. Needs redeploying here.
  //   3. A BI Publisher report through erpintegrations, which answers 200 and
  //      for which the bipService backend is already configured.
  //
  // fixedAssetBooksLOV and fixedAssetCategoriesLOV DO answer 200, but they list
  // every book and category rather than the one a given asset uses, so they
  // serve a picker, not this page.
  //
  // To show the tab again: set showFixedAssetTab to true in the page
  // variables (optionally re-add it to the tabsArray default too, so it
  // doesn't pop in after the chain runs). While false, the chain drops it
  // from tabsArray and bounces a stale 'fixedasset' selection back to Overview.
  // ══════════════════════════════════════════════════════════════════════

  // ── deterministic pseudo-random ───────────────────────────────────────
  // Sample values must not reshuffle on every visit: a demo that shows a
  // different work-order list each time it opens reads as broken. Seed a small
  // LCG off the serial-ref id so a given unit always renders identically.
  function makeRng(seed) {
    let s = (Number(seed) || 1) % 2147483647;
    if (s <= 0) s += 2147483646;
    return function next() {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  function pick(rng, arr) {
    return arr[Math.floor(rng() * arr.length) % arr.length];
  }

  // ── date helpers (plain YYYY-MM-DD, no timezone drift) ────────────────
  function toIsoDate(d) {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function parseDate(value) {
    if (!value) return null;
    const s = String(value).substring(0, 10).split('-');
    if (s.length !== 3) return null;
    const d = new Date(Number(s[0]), Number(s[1]) - 1, Number(s[2]));
    return isNaN(d.getTime()) ? null : d;
  }

  function addDays(date, n) {
    const d = new Date(date.getTime());
    d.setDate(d.getDate() + n);
    return d;
  }

  // ── fallbacks for serials the seed data never filled in ───────────────
  // 60 of the 225 serials sit under a maintenance+fixed-asset master yet carry
  // no asset number, no cost and no in-service date (every Y/Y/N master is in
  // this state, including the Atlas Copco compressor). Without a fallback both
  // tabs would render structurally correct but completely blank, which reads
  // as broken rather than as pending data. These derive a stable stand-in so
  // the record is legible; the panels stay marked as sample either way.

  function deriveAssetNumber(unit) {
    if (unit.maintenanceAssetNumber) return unit.maintenanceAssetNumber;
    return 'MNT-' + String(unit.id || '0').slice(-10);
  }

  // Cost band keyed off the equipment class so a generator does not come back
  // priced like a crawler crane. Deterministic in the serial id.
  function deriveCost(unit, master, rng) {
    if (Number(unit.purchasePrice) > 0) return Number(unit.purchasePrice);

    const text = ((master.equipmentName || '') + ' ' +
                  (master.equipmentClassName || '')).toLowerCase();

    let lo = 40000, hi = 120000;
    if (/crane|crawler/.test(text))            { lo = 600000; hi = 1400000; }
    else if (/dozer|excavat|loader|scraper/.test(text)) { lo = 280000; hi = 620000; }
    else if (/truck|tractor|spmt|haul/.test(text))      { lo = 120000; hi = 380000; }
    else if (/lift|boom|telehandler/.test(text))        { lo = 70000;  hi = 180000; }
    else if (/compressor|generator|pump|welder/.test(text)) { lo = 18000; hi = 65000; }

    // Round to the nearest 500 so it reads like a real purchase figure.
    return Math.round((lo + rng() * (hi - lo)) / 500) * 500;
  }

  function deriveInServiceDate(unit, master) {
    if (unit.inServiceDate) return unit.inServiceDate;
    if (unit.purchaseDate)  return unit.purchaseDate;
    if (unit.mfgDate)       return unit.mfgDate;
    // Fall back to the model year, else two years ago - a schedule has to
    // start somewhere for the periods to be labelled.
    const year = Number(unit.mfgYear) || Number(master.mfgYear)
      || (new Date().getFullYear() - 2);
    return year + '-01-01';
  }

  // ══════════════════════════════════════════════════════════════════════
  // Service position rows
  // ══════════════════════════════════════════════════════════════════════
  //
  // Condition, meters and telematics are EquipRite's own reading of the unit -
  // EQR_SERIAL_REF columns, nothing to do with Fusion. They live on the
  // Overview tab, which is the all-EquipRite tab, and every unit has them
  // including the 125 stock-only serials that have no maintenance tab at all.
  //
  // Unlike the Maintenance Asset card - which mirrors Fusion's own layout and
  // therefore keeps Fusion's empty labels - there is nothing to mirror here, so
  // an empty field carries no information. Emit only what has a value; one
  // populated column should not drag eleven blank labels onto the page.
  //
  // Values arrive pre-formatted so the template stays a plain repeat.

  function fmtDateDisplay(v) {
    if (!v) return '';
    const parts = String(v).substring(0, 10).split('-');
    if (parts.length !== 3) return String(v);
    const mo = parseInt(parts[1], 10), da = parseInt(parts[2], 10);
    if (isNaN(mo) || isNaN(da)) return String(v);
    return mo + '/' + da + '/' + parts[0];
  }

  function fmtNumDisplay(v) {
    if (v === null || v === undefined || v === '') return '';
    const n = Number(v);
    return isNaN(n) ? String(v) : n.toLocaleString();
  }

  function buildServiceRows(u) {
    const rows = [];
    const add = (label, value) => {
      if (value !== null && value !== undefined && value !== '') {
        rows.push({ label: label, value: String(value) });
      }
    };
    add('Condition',             u.conditionCode);
    add('Operating Hours',       fmtNumDisplay(u.currentOperatingHours));
    add('Odometer',              fmtNumDisplay(u.currentOdometer));
    add('Last Service',          fmtDateDisplay(u.lastServiceDate));
    add('Next Service',          fmtDateDisplay(u.nextServiceDate));
    add('Hours at Last Service', fmtNumDisplay(u.lastServiceHours));
    add('Last Inspection',       fmtDateDisplay(u.lastInspectionDate));
    add('Next Inspection',       fmtDateDisplay(u.nextInspectionDate));
    add('Telematics Device',     u.telematicsDeviceId);
    add('GPS Latitude',          u.gpsLatitude);
    add('GPS Longitude',         u.gpsLongitude);
    add('GPS Timestamp',         fmtDateDisplay(u.gpsTimestamp));
    return rows;
  }

  // ══════════════════════════════════════════════════════════════════════
  // Live Fusion lookups
  // ══════════════════════════════════════════════════════════════════════
  //
  // The moment the functional team attaches a maintenance asset to a serial in
  // Fusion, these start returning rows and the page switches itself over - the
  // sample builders below are only reached when Fusion has nothing to give.
  // Nothing to redeploy, nothing to toggle.
  //
  // Matching order: MAINTENANCE_ASSET_NUMBER first, serial number second.
  //
  // Oracle's real join between stock and the asset is the serial number, but
  // EquipRite's serials are seeded strings ('TAD-RTC-GR1000-2023-0001') that do
  // not exist in Fusion, so matching on them can never hit. The asset number is
  // the field we can actually populate with a genuine Fusion key, so it leads.
  // The serial attempt is kept behind it for the day the stock records are
  // imported from Fusion rather than generated.

  // Fusion q values are single-quoted, so an embedded quote has to be doubled
  // or the filter is malformed.
  function qLit(v) {
    return "'" + String(v).replace(/'/g, "''") + "'";
  }

  async function fusionGet(context, endpoint, uriParams) {
    try {
      const resp = await Actions.callRest(context, { endpoint, uriParams });
      if (!resp || !resp.ok || !resp.body) return null;
      const items = resp.body.items || resp.body;
      return Array.isArray(items) ? items : null;
    } catch (e) {
      // A Fusion outage, a missing role or a CORS refusal must not take the
      // page down - fall through to the sample builders instead.
      console.warn('[unit-detail] Fusion call failed (' + endpoint + '):', e);
      return null;
    }
  }

  async function fetchFusionAsset(context, unit) {
    const attempts = [];
    if (unit.maintenanceAssetNumber) {
      attempts.push('AssetNumber=' + qLit(unit.maintenanceAssetNumber));
    }
    if (unit.serialNumber) {
      attempts.push('SerialNumber=' + qLit(unit.serialNumber));
    }

    for (let i = 0; i < attempts.length; i++) {
      const items = await fusionGet(context, 'ProjectLOV/getInstalledBaseAssets', {
        q: attempts[i],
        limit: 1
      });
      if (items && items.length) return items[0];
    }
    return null;
  }

  // Work orders hang off the asset. Two earlier integrations confirm the link is
  // the asset key: EQP_MAINTCOSTDETAILS_REST returns
  // {work_order_number, asset_number, asset_id, work_order_id} per asset, and
  // the TimeRite ORDS endpoint takes p_asset_number directly.
  //
  // Which attribute maintenanceWorkOrders actually filters on is the open
  // question. In those samples asset_number is a numeric surrogate identical to
  // asset_id, whereas a Fusion asset like BT-100000 carries a human code in
  // AssetNumber and the surrogate in AssetId. So try the number, then the id.
  //
  // Returns: an array (possibly empty - the asset genuinely has none), or null
  // meaning every attempt failed and we do not know either way.
  async function fetchFusionWorkOrders(context, assetNumber, assetId, orgCode) {
    // Fusion asset keys come in two shapes and we have both in play:
    //   BT-100000        a human code, AssetNumber != AssetId
    //   100001728623616  a numeric surrogate, AssetNumber == AssetId
    // and maintenance work orders are raised inside an organization
    // (WO-001-1000 sits in org 001 - Seattle), which several Fusion
    // maintenance resources require as query context. Any of those can be the
    // reason a filter comes back rejected or empty, so widen progressively
    // rather than guessing one shape.
    const org = orgCode ? " and OrganizationCode=" + qLit(orgCode) : '';
    const attempts = [];
    if (assetNumber) {
      attempts.push('AssetNumber=' + qLit(assetNumber));
      if (org) attempts.push('AssetNumber=' + qLit(assetNumber) + org);
    }
    if (assetId) {
      attempts.push('AssetId=' + assetId);
      if (org) attempts.push('AssetId=' + assetId + org);
    }
    if (!attempts.length) return null;

    let reachedFusion = false;
    for (let i = 0; i < attempts.length; i++) {
      const rows = await fusionGet(context, 'ProjectLOV/getMaintenanceWorkOrders', {
        q: attempts[i],
        limit: 100,
        orderBy: 'PlannedStartDate:desc'
      });
      if (rows === null) continue;      // that filter was rejected - try the next
      reachedFusion = true;
      if (rows.length) {
        // Which filter actually worked is the one thing worth knowing when a
        // unit unexpectedly shows none, so carry it back rather than leaving it
        // in a console line buried under VB's own logging. Narrow the ladder
        // once this is settled against the real instance.
        rows.matchedOn = attempts[i];
        return rows;
      }
    }
    // Fusion answered but had nothing, vs never answered at all.
    return reachedFusion ? [] : null;
  }

  // Fusion carries the operating organization as a code ('411') and a name
  // ('MNT B') in separate fields, and its own asset page shows only the code.
  // Show both so the page is readable without losing the value people search
  // and reconcile on. Degrades to whichever half is present.
  function orgLabel(code, name) {
    const c = code ? String(code).trim() : '';
    const n = name ? String(name).trim() : '';
    if (c && n && c !== n) return c + ' — ' + n;
    return c || n || '';
  }

  // Fusion returns lookup values as raw codes - ORA_PLANNED, PREVENTIVE,
  // ORA_COMPLETED. The Fusion UI renders them as Planned / Preventive /
  // Completed, so strip the prefix and title-case rather than leaking the code
  // onto the page.
  function prettyCode(v) {
    if (v === null || v === undefined || v === '') return '';
    return String(v)
      .replace(/^ORA_/, '')
      .replace(/_/g, ' ')
      .replace(/\w\S*/g, t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
  }

  // woBadgeClass buckets on the cleaned words, so status goes through the same
  // normaliser as every other code.
  // The real payload carries WorkOrderStatus ("Unreleased") alongside
  // WorkOrderStatusCode ("ORA_UNRELEASED"). Neither of the names this
  // originally looked for exists, so the Status column rendered empty on every
  // live row. Prefer the already-readable value, fall back through the codes.
  function prettyStatus(row) {
    return prettyCode(
      row.WorkOrderStatus || row.WorkOrderStatusName ||
      row.WorkOrderStatusCode || row.SystemStatus || row.SystemStatusCode ||
      row.StatusCode || row.WoStatusCode || ''
    );
  }

  // Normalise a Fusion work order onto the shape the table binds. Field names
  // vary a little by Fusion release, so each one falls back through its known
  // aliases rather than rendering blank.
  // Only header attributes are available here. Resource hours and meter
  // readings are NOT on maintenanceWorkOrders - they hang off
  // /child/operations/child/resources - so they are not carried or shown.
  function mapFusionWorkOrder(row) {
    return {
      WorkOrderNumber:       row.WorkOrderNumber || row.WoNumber || '',
      WorkOrderType:         row.WorkOrderType || row.WorkOrderTypeName
                               || prettyCode(row.WorkOrderTypeCode),
      WorkOrderSubType:      row.WorkOrderSubType || row.WorkOrderSubTypeName
                               || prettyCode(row.WorkOrderSubTypeCode),
      Description:           row.WorkOrderDescription || row.Description || '',
      StatusCode:            prettyStatus(row),
      WorkOrderPriority:     row.WorkOrderPriority,
      AssetNumber:           row.AssetNumber || '',
      AssetDescription:      row.AssetDescription || '',
      ItemNumber:            row.ItemNumber || '',
      OrganizationCode:      row.OrganizationCode || '',
      MaintenanceProgramName: row.MaintenanceProgramName || '',
      PlannedStartDate:      row.PlannedStartDate || row.WoPlannedStartDate || null,
      PlannedCompletionDate: row.PlannedCompletionDate || null,
      ActualStartDate:       row.ActualStartDate || null,
      ActualCompletionDate:  row.ActualCompletionDate || row.CompletedDate || null
    };
  }

  // Fusion installedBaseAssets -> the panel shape. Service-position fields stay
  // on EquipRite's side (Fusion's asset record does not carry them), so the
  // serial's own readings are merged in.
  function mapFusionAsset(fa, unit, master, locationName) {
    return {
      AssetNumber:               fa.AssetNumber || '',
      AssetId:                   fa.AssetId,
      OperatingOrganizationCode: fa.OperatingOrganizationCode || '',
      Description:               fa.Description || master.equipmentName || '',
      ItemNumber:                fa.ItemNumber || '',
      ItemDescription:           fa.ItemDescription || fa.ItemLongDescription || '',
      SerialNumber:              fa.SerialNumber || unit.serialNumber || '',
      LotNumber:                 fa.LotNumber || null,
      Quantity:                  fa.Quantity != null ? fa.Quantity : 1,
      UnitOfMeasure:             fa.UnitOfMeasure || 'Ea',
      OperatingOrganizationName: orgLabel(fa.OperatingOrganizationCode,
                                          fa.OperatingOrganizationName),
      SubinventoryCode:          fa.SubinventoryCode || unit.currentSubinventory || '',
      LocatorName:               fa.LocatorName || unit.currentLocator || '',
      CurrentLocationName:       fa.CurrentLocationName || locationName || '',
      InServiceDate:             fa.InServiceDate || null,
      ActiveEndDate:             fa.ActiveEndDate || null,
      CreationDate:              fa.CreationDate || null,
      WorkCenterName:            fa.WorkCenterName || '',
      MaintainableFlag:          fa.MaintainableFlag,
      NewWoAllowedFlag:          fa.NewWoAllowedFlag,
      IotEnabledFlag:            fa.IotEnabledFlag,
      CompetitorAssetFlag:       fa.CompetitorAssetFlag,
      DfltWoTypeCode:            prettyCode(fa.DfltWoTypeCode),
      DfltWoSubTypeCode:         prettyCode(fa.DfltWoSubTypeCode),
      ParentAssetNumber:         fa.ParentAssetNumber || null,
      RegistrationDate:          fa.RegistrationDate || null,
      InstalledDate:             fa.InstalledDate || null,
      ContactName:               fa.ContactName || null,
      CountryOfOrigin:           fa.Country || null,
      SecondaryQuantity:         fa.SecondaryQuantity,
      SecondaryUOMCode:          fa.SecondaryUOMCode,

      // Condition and meters live on the EquipRite serial, not on the Fusion
      // asset, so they are real regardless of which side supplied the header.
      ConditionCode:         unit.conditionCode || '',
      LastInspectionDate:    unit.lastInspectionDate || null,
      NextInspectionDate:    unit.nextInspectionDate || null,
      LastServiceDate:       unit.lastServiceDate || null,
      NextServiceDate:       unit.nextServiceDate || null,
      LastServiceHours:      unit.lastServiceHours,
      LastServiceOdometer:   unit.lastServiceOdometer,
      CurrentOperatingHours: unit.currentOperatingHours,
      CurrentOdometer:       unit.currentOdometer,
      TelematicsDeviceId:    unit.telematicsDeviceId || '',
      GpsLatitude:           unit.gpsLatitude,
      GpsLongitude:          unit.gpsLongitude,
      GpsTimestamp:          unit.gpsTimestamp || null
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  // Fixed asset - live from Fusion Assets
  // ══════════════════════════════════════════════════════════════════════
  //
  // The FA number is held on EQR_SERIAL_REF.ATTRIBUTE4, which the units grid
  // already labels "FA Asset No.".
  //
  // UNVERIFIED, unlike the maintenance side. installedBaseAssets was proven -
  // the previous EquipRite app called it against Dev 20. Nothing here ever
  // called a Fusion FA resource directly; FA cost came through the
  // EQP_FA_COSTDETAILS OIC integration and an ORDS endpoint, both returning
  // {asset_number, initial_cost, deprn_amount, net_book_value}. So the resource
  // name and its filter attribute are both open questions, and the lookup tries
  // each candidate rather than betting on one.
  //
  // Field names below are taken from what the customer's own Asset Inquiry
  // screen displays (Asset Number, Description, Cost, Salvage Value,
  // Recoverable Cost, In Service Date, Category) plus the column names the
  // backend already chose for EQR_FA_ASSET_T, with aliases for both.

  // NO LIVE FIXED-ASSET READ IS POSSIBLE ON THIS POD.
  //
  // Probed directly with working credentials on 2026-08-24: Financials REST is
  // live (invoices, journalBatches, receivablesInvoices, expenditureTypesLOV,
  // projectsLOV, erpintegrations all answer 200) but EVERY Assets resource
  // returns 404 - fixedAssets, assets, assetsFinancials, financialAssets,
  // capitalAssets, faAssets, assetBooks, assetCategories, assetDepreciation,
  // assetAssignments, assetRetirements and a dozen more. Oracle Fusion Assets
  // has no REST surface here.
  //
  // That also explains the previous EquipRite app: it never called a Fusion FA
  // resource either, pulling cost through the EQP_FA_COSTDETAILS OIC
  // integration and an ORDS endpoint instead. Those returned
  // {asset_number, initial_cost, deprn_amount, net_book_value}.
  //
  // So the fixed-asset panel is fed from EQR_SERIAL_REF, and the real Fusion
  // figures have to reach that table by sync rather than by a live read. When
  // a route does exist - OIC, a BI Publisher report through erpintegrations, or
  // an eqp-v1 endpoint over the already-synced EQR_FA_ASSET_T - this is the one
  // function to restore.

  // Pick the first alias present. Distinguishes absent from a real zero, so a
  // fully-depreciated asset still reports 0 rather than falling through.
  function firstOf(row, names) {
    for (let i = 0; i < names.length; i++) {
      const v = row[names[i]];
      if (v !== null && v !== undefined && v !== '') return v;
    }
    return null;
  }

  // ══════════════════════════════════════════════════════════════════════
  // Maintenance asset - Fusion installedBaseAssets shape
  // ══════════════════════════════════════════════════════════════════════
  function buildMaintenanceAsset(unit, master, locationName, inServiceDate) {
    const assetNumber = deriveAssetNumber(unit);

    // Service position falls back to a cycle anchored on the in-service date
    // so the dates, the meter and the work orders stay consistent with each
    // other even when the serial carries none of them.
    const svcStart  = parseDate(inServiceDate) || new Date();
    const lastSvc   = unit.lastServiceDate    || null;
    const nextSvc   = unit.nextServiceDate    || null;
    const lastInsp  = unit.lastInspectionDate || null;
    const nextInsp  = unit.nextInspectionDate || null;

    return {
      // -- carried by EQR_SERIAL_REF or the master: REAL --
      AssetNumber:               assetNumber,
      Description:               master.equipmentName || '',
      ItemNumber:                unit.attribute5 || master.equipmentNumber || '',
      ItemDescription:           master.equipmentDescription || master.equipmentName || '',
      SerialNumber:              unit.serialNumber || '',
      LotNumber:                 null,
      Quantity:                  1,
      UnitOfMeasure:             'Ea',
      OperatingOrganizationName: unit.eqpInvOrgName || unit.attribute9 || '',
      SubinventoryCode:          unit.currentSubinventory || '',
      LocatorName:               unit.currentLocator || '',
      CurrentLocationName:       locationName || '',
      InServiceDate:             inServiceDate || null,
      ActiveEndDate:             unit.retiredDate || null,
      CreationDate:              unit.createdDate || null,
      WorkCenterName:            unit.attributeCategory || 'Main Yard Shop',
      ConditionCode:             unit.conditionCode || 'GOOD',
      // Quarterly cycle off the in-service date when the serial has no dates.
      LastInspectionDate:        lastInsp || toIsoDate(addDays(svcStart, 300)),
      NextInspectionDate:        nextInsp || toIsoDate(addDays(svcStart, 665)),
      LastServiceDate:           lastSvc  || toIsoDate(addDays(svcStart, 360)),
      NextServiceDate:           nextSvc  || toIsoDate(addDays(svcStart, 450)),
      LastServiceHours:          unit.lastServiceHours,
      LastServiceOdometer:       unit.lastServiceOdometer,
      CurrentOperatingHours:     unit.currentOperatingHours,
      CurrentOdometer:           unit.currentOdometer,
      TelematicsDeviceId:        unit.telematicsDeviceId || '',
      GpsLatitude:               unit.gpsLatitude,
      GpsLongitude:              unit.gpsLongitude,
      GpsTimestamp:              unit.gpsTimestamp || null,

      // -- not held in EquipRite yet: SAMPLE --
      // Fusion defaults every maintainable asset to these two; they gate
      // whether PM schedules and manual work orders can be raised at all.
      MaintainableFlag:    true,
      NewWoAllowedFlag:    true,
      IotEnabledFlag:      !!unit.telematicsDeviceId,
      CompetitorAssetFlag: false,
      DfltWoTypeCode:      'Preventive',
      DfltWoSubTypeCode:   'Planned',
      ParentAssetNumber:   null,
      RegistrationDate:    null,
      InstalledDate:       inServiceDate || null,
      ContactName:         null,
      CountryOfOrigin:     null,
      ProjectName:         null,
      TaskName:            null,
      SecondaryQuantity:   null,
      SecondaryUOMCode:    null
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  // Work orders - Fusion maintenanceWorkOrders shape. SAMPLE.
  // ══════════════════════════════════════════════════════════════════════
  //
  // Built backwards from the REAL lastServiceDate / nextServiceDate so the
  // history lines up with the meter readings and dates shown beside it - the
  // meeting example was a monthly or quarterly inspection cycle.
  function buildWorkOrders(unit, asset, rng) {
    const assetNumber = asset.AssetNumber || '';
    const stem        = assetNumber.replace(/[^0-9A-Za-z]/g, '') || 'ASSET';
    const itemNumber  = asset.ItemNumber || '';
    const orgCode     = asset.OperatingOrganizationCode || '';

    const lastService = parseDate(asset.LastServiceDate)
      || parseDate(asset.InServiceDate) || new Date();
    const nextService = parseDate(asset.NextServiceDate) || addDays(lastService, 120);
    const lastInsp    = parseDate(asset.LastInspectionDate);
    const nextInsp    = parseDate(asset.NextInspectionDate);

    const meter = Number(unit.currentOperatingHours) || 0;

    const CORRECTIVE = [
      'Replace hydraulic return filter',
      'Repair coolant leak at radiator hose',
      'Rebuild brake calipers',
      'Replace worn track pads',
      'Alternator replacement',
      'Repair cab HVAC blower'
    ];

    const rows = [];

    // Quarterly PM, completed - anchored to the real last service date.
    rows.push({
      WorkOrderNumber:       'WO-' + stem + '-0003',
      WorkOrderType:         'Preventive',
      WorkOrderSubType:      'Planned',
      Description:           'Quarterly service - 250 hour interval',
      StatusCode:            'Completed',
      WorkOrderPriority:     3,
      AssetNumber:           assetNumber,
      ItemNumber:            itemNumber,
      OrganizationCode:      orgCode,
      PlannedStartDate:      toIsoDate(addDays(lastService, -1)),
      PlannedCompletionDate: toIsoDate(lastService),
      ActualStartDate:       toIsoDate(addDays(lastService, -1)),
      ActualCompletionDate:  toIsoDate(lastService),
    });

    // Annual inspection, completed - anchored to the real last inspection date.
    if (lastInsp) {
      rows.push({
        WorkOrderNumber:       'WO-' + stem + '-0002',
        WorkOrderType:         'Inspection',
        WorkOrderSubType:      'Planned',
        Description:           'Annual safety and compliance inspection',
        StatusCode:            'Completed',
        WorkOrderPriority:     2,
        AssetNumber:           assetNumber,
      ItemNumber:            itemNumber,
      OrganizationCode:      orgCode,
          PlannedStartDate:      toIsoDate(lastInsp),
        PlannedCompletionDate: toIsoDate(lastInsp),
        ActualStartDate:       toIsoDate(lastInsp),
        ActualCompletionDate:  toIsoDate(addDays(lastInsp, 1)),
            });
    }

    // An in-flight corrective job, so the grid shows a non-terminal status.
    const correctiveStart = addDays(lastService, Math.round(20 + rng() * 40));
    rows.push({
      WorkOrderNumber:       'WO-' + stem + '-0004',
      WorkOrderType:         'Corrective',
      WorkOrderSubType:      'Unplanned',
      Description:           pick(rng, CORRECTIVE),
      StatusCode:            'In Progress',
      WorkOrderPriority:     1,
      AssetNumber:           assetNumber,
      ItemNumber:            itemNumber,
      OrganizationCode:      orgCode,
      PlannedStartDate:      toIsoDate(correctiveStart),
      PlannedCompletionDate: toIsoDate(addDays(correctiveStart, 2)),
      ActualStartDate:       toIsoDate(correctiveStart),
      ActualCompletionDate:  null,
    });

    // The next scheduled PM, not yet released.
    rows.push({
      WorkOrderNumber:       'WO-' + stem + '-0005',
      WorkOrderType:         'Preventive',
      WorkOrderSubType:      'Planned',
      Description:           'Quarterly service - 250 hour interval',
      StatusCode:            'Unreleased',
      WorkOrderPriority:     3,
      AssetNumber:           assetNumber,
      ItemNumber:            itemNumber,
      OrganizationCode:      orgCode,
      PlannedStartDate:      toIsoDate(nextService),
      PlannedCompletionDate: toIsoDate(addDays(nextService, 1)),
      ActualStartDate:       null,
      ActualCompletionDate:  null,
    });

    // The next inspection, if the unit has one booked.
    if (nextInsp) {
      rows.push({
        WorkOrderNumber:       'WO-' + stem + '-0006',
        WorkOrderType:         'Inspection',
        WorkOrderSubType:      'Planned',
        Description:           'Annual safety and compliance inspection',
        StatusCode:            'Unreleased',
        WorkOrderPriority:     2,
        AssetNumber:           assetNumber,
      ItemNumber:            itemNumber,
      OrganizationCode:      orgCode,
          PlannedStartDate:      toIsoDate(nextInsp),
        PlannedCompletionDate: toIsoDate(nextInsp),
        ActualStartDate:       null,
        ActualCompletionDate:  null,
            });
    }

    // Newest first, the order a maintenance planner expects.
    rows.sort((a, b) => String(b.PlannedStartDate).localeCompare(String(a.PlannedStartDate)));
    return rows;
  }

  // ══════════════════════════════════════════════════════════════════════
  // Depreciation schedule
  // ══════════════════════════════════════════════════════════════════════
  //
  // Annual periods. MACRS uses the published IRS percentage tables; STL is
  // straight line over the stated life. The half-year convention is already
  // baked into the MACRS tables, which is why 5-year life runs six rows.
  function buildDeprnSchedule(cost, inServiceDate, method) {
    if (!cost || cost <= 0) return [];

    const MACRS_5 = [0.20, 0.32, 0.192, 0.1152, 0.1152, 0.0576];
    const MACRS_7 = [0.1429, 0.2449, 0.1749, 0.1249, 0.0893, 0.0892, 0.0893, 0.0446];

    let rates;
    if (method === 'MACRS-5YR')      rates = MACRS_5;
    else if (method === 'MACRS-7YR') rates = MACRS_7;
    else {
      const years = String(method).indexOf('7YR') >= 0 ? 7 : 5;
      rates = new Array(years).fill(1 / years);
    }

    const start = parseDate(inServiceDate);
    const startYear = start ? start.getFullYear() : new Date().getFullYear();

    const rows = [];
    let reserve = 0;
    rates.forEach((rate, i) => {
      let amount = Math.round(cost * rate * 100) / 100;
      // Absorb rounding drift into the final period so reserve lands on cost
      // exactly and net book value closes at zero.
      if (i === rates.length - 1) amount = Math.round((cost - reserve) * 100) / 100;
      reserve = Math.round((reserve + amount) * 100) / 100;
      rows.push({
        PeriodName:   'FY' + (startYear + i),
        FiscalYear:   startYear + i,
        PeriodNumber: i + 1,
        DeprnAmount:  amount,
        DeprnReserve: reserve,
        NetBookValue: Math.round((cost - reserve) * 100) / 100
      });
    });
    return rows;
  }

  // ══════════════════════════════════════════════════════════════════════
  // Fixed asset. Header is largely REAL; book and depreciation are SAMPLE.
  // ══════════════════════════════════════════════════════════════════════
  //
  // Shape follows EQR_FA_ASSET_T (the 2,210-row Fusion FA sync) plus the book
  // columns on EQR_FA_ASSET_REF, so this drops onto the real join once
  // EQR_SERIAL_REF.FA_ASSET_REF_ID is populated.
  function buildFixedAsset(unit, master, rng, locationName, schedule, cost, inServiceDate) {
    // attribute4 already carries the FA number on the units grid.
    const faNumber = unit.attribute4 || ('FA-' + String(unit.id || '').slice(-6));

    // Reserve accumulated to date, not to end of life - a live asset should
    // show a net book value that is still falling.
    const thisYear = new Date().getFullYear();
    let reserve = 0;
    (schedule || []).forEach(r => {
      if (r.FiscalYear <= thisYear) reserve = r.DeprnReserve;
    });

    const method = (schedule && schedule.length && schedule.__method) || null;

    return {
      AssetNumber:         faNumber,
      Description:         master.equipmentName || '',
      AssetBook:           'CIANBRO-CORP-BOOK',
      AssetCategory:       unit.attribute10 || 'Equipment',
      TagNumber:           unit.unitTagNumber || '',
      SerialNumber:        unit.serialNumber || '',
      ManufacturerName:    master.manufacturer || '',
      ModelNumber:         master.modelNumber || '',
      ModelYear:           unit.mfgYear,
      NewUsed:             unit.newUsed || '',
      AssetType:           'CAPITALIZED',
      OwnedLeased:         unit.ownershipStatus === 'LEASED' ? 'LEASED' : 'OWNED',
      DatePlacedInService: inServiceDate || null,
      PurchaseDate:        unit.purchaseDate || null,
      Cost:                cost,
      CurrencyCode:        unit.purchaseCurrency || 'USD',
      DeprnReserve:        Math.round(reserve * 100) / 100,
      NetBookValue:        Math.round((cost - reserve) * 100) / 100,
      SalvageValue:        0,
      DepreciationMethod:  method,
      LifeInMonths:        method && String(method).indexOf('7YR') >= 0 ? 84 : 60,
      ProrateConvention:   'HALF-YEAR',
      AssetLocation:       locationName || unit.currentSubinventory || '',
      AssetOrganization:   unit.attribute9 || '',
      ExpenditureOrg:      unit.attributeCategory || '',
      DateRetired:         unit.retiredDate || null,
      RetirementTypeCode:  unit.retiredDate ? 'FULL' : null,
      FullyDepreciated:    cost > 0 && reserve >= cost
    };
  }

  class vbEnterChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const serialRefId = $page.variables.serialRefId;
      const equipmentId = $page.variables.equipmentId;
      // goToUnitDetailChain forwards the grid's controlType, so LOT and
      // INVENTORY rows reach this page too. The id is that table's own PK, so
      // the by-id endpoint has to match the type it came from - the three id
      // spaces are disjoint, and asking the wrong one 404s or, worse, returns
      // an unrelated unit that happens to share the number.
      const controlType = ($page.variables.controlType || 'SERIAL').toUpperCase();

      if (!serialRefId) {
        await Actions.navigateToPage(context, { page: 'equipment-master' });
        return;
      }

      $page.variables.isLoading = true;

      // ── 1. The unit itself. REAL. ───────────────────────────────────
      const unitByIdEndpoint =
        controlType === 'LOT'       ? 'eqp-v1/getLotRefById'           :
        controlType === 'INVENTORY' ? 'eqp-v1/getInventoryItemRefById' :
                                      'eqp-v1/getSerialRefById';
      const unitResp = await Actions.callRest(context, {
        endpoint:  unitByIdEndpoint,
        uriParams: { id: Number(serialRefId) }
      });

      if (!unitResp.ok || !unitResp.body) {
        $page.variables.isLoading = false;
        await Actions.fireNotificationEvent(context, {
          summary: 'Unit Unavailable',
          message: 'Could not load details for this serial unit.',
          type: 'error',
          displayMode: 'transient'
        });
        await Actions.navigateToPage(context, {
          page:   'equipment-units',
          params: { equipmentId: String(equipmentId || ''), controlType: controlType }
        });
        return;
      }
      const unit = unitResp.body;

      // ── 2. Master definition (drives the tracking flags). REAL. ─────
      // Prefer the unit own equipmentId: deep-linking straight to this page
      // must not depend on the caller having passed the master id too.
      let master = {};
      const masterId = unit.equipmentId || equipmentId;
      if (masterId) {
        try {
          const mResp = await Actions.callRest(context, {
            endpoint:  'eqp-v1/getEquipriteV1EquipmentMasterById',
            uriParams: { id: Number(masterId) }
          });
          if (mResp.ok && mResp.body) master = mResp.body;
        } catch (e) {
          console.warn('[unit-detail] master lookup failed:', e);
        }
      }

      // Class then subclass for the summary rail. Sequential - the subclass
      // lookup is nested under its class id.
      if (master.equipmentClassId) {
        try {
          const clsResp = await Actions.callRest(context, {
            endpoint:  'eqp-v1/getEquipmentClassById',
            uriParams: { id: Number(master.equipmentClassId) }
          });
          if (clsResp.ok && clsResp.body) {
            master.equipmentClassName = clsResp.body.className || clsResp.body.name || '';
          }
        } catch (e) {
          console.warn('[unit-detail] class lookup failed:', e);
        }
        if (master.equipmentSubclassId) {
          try {
            const subResp = await Actions.callRest(context, {
              endpoint:  'eqp-v1/getSubclassById',
              uriParams: {
                classId: Number(master.equipmentClassId),
                id:      Number(master.equipmentSubclassId)
              }
            });
            if (subResp.ok && subResp.body) {
              master.equipmentSubclassName =
                subResp.body.subclassName || subResp.body.name || '';
            }
          } catch (e) {
            console.warn('[unit-detail] subclass lookup failed:', e);
          }
        }
      }

      // ── 3. Location name. REAL. ─────────────────────────────────────
      let locationName = '';
      if (unit.currentLocationId != null) {
        try {
          const locResp = await Actions.callRest(context, {
            endpoint:  'eqp-v1/getLocationById',
            uriParams: { id: Number(unit.currentLocationId) }
          });
          if (locResp.ok && locResp.body) {
            locationName = locResp.body.locationName
              || locResp.body.address
              || locResp.body.locationCode || '';
          }
        } catch (e) {
          console.warn('[unit-detail] location lookup failed:', e);
        }
      }

      // ── 3b. CURRENT location. Where the unit IS, not where it belongs. ──
      // currentInvOrgId is written by resources/js/maintAssetLocation.js when the
      // unit ships to an internal location. It is a FK to EQR_INV_ORG.INV_ORG_ID —
      // the local surrogate — so it is resolved against invOrgId, NOT the Fusion
      // organizationId. Home yard remains eqpInvOrgName and is untouched by a
      // deployment.
      //
      // Matters most on the Fusion Maintenance Asset tab below: that card reads
      // CurrentLocationName live from Fusion, so without this the same page would
      // show Fusion saying Chicago and EquipRite saying nothing.
      let currentOrgName = '';
      if (unit.currentInvOrgId != null) {
        try {
          const orgResp = await Actions.callRest(context, {
            endpoint:  'eqp-v1/getInvOrgs',
            uriParams: { size: 500 }
          });
          if (orgResp.ok && orgResp.body && Array.isArray(orgResp.body.data)) {
            const hit = orgResp.body.data.filter(
              o => o && String(o.invOrgId) === String(unit.currentInvOrgId))[0];
            if (hit) currentOrgName = hit.organizationName || hit.organizationCode || '';
          }
        } catch (e) {
          console.warn('[unit-detail] current inv-org lookup failed:', e);
        }
      }

      // ── 4. Tracking flags decide which tabs carry content ───────────
      // The REST projection sends 'Y'/'N' strings, so compare explicitly - the
      // string 'N' is truthy and a bare check reports every unit as tracked.
      // (That exact bug is why the units header card showed
      // "Is Inventory Track? Yes" on masters flagged N.)
      const isTracked = v => v === 'Y' || v === 'y' || v === true;
      const hasMaintenance = isTracked(master.isMaintenanceTracked);
      const hasFixedAsset  = isTracked(master.isFixedAssetTracked);
      const hasInventory   = isTracked(master.isInventoryTracked);

      // ── 5. Maintenance and fixed-asset panels ───────────────────────
      const rng = makeRng(unit.id || serialRefId);

      // Resolved once and shared, so the maintenance cycle, the work-order
      // history and the depreciation periods all key off the same start date.
      const inServiceDate = deriveInServiceDate(unit, master);

      let maintenanceAsset = {};
      let workOrders = [];
      let maintenanceIsSample = false;
      let workOrdersAreSample = false;
      let workOrdersUnavailable = false;
      let workOrdersMatchedOn = '';

      if (hasMaintenance) {
        // Ask Fusion first. Anything it returns is authoritative.
        const fusionAsset = await fetchFusionAsset(context, unit);

        if (fusionAsset) {
          maintenanceAsset = mapFusionAsset(fusionAsset, unit, master, locationName);

          const fusionWos = await fetchFusionWorkOrders(
            context,
            maintenanceAsset.AssetNumber,
            maintenanceAsset.AssetId,
            maintenanceAsset.OperatingOrganizationCode
          );
          if (fusionWos === null) {
            // Every filter was rejected. Saying "none raised" here would be a
            // claim we cannot support - the asset may well have work orders.
            workOrdersUnavailable = true;
            workOrders = [];
          } else {
            // An empty array is a real answer: the asset has none yet. Never
            // invent a history against a live asset number.
            workOrders = fusionWos.map(mapFusionWorkOrder);
            workOrdersMatchedOn = fusionWos.matchedOn || '';
          }
        } else {
          maintenanceAsset = buildMaintenanceAsset(unit, master, locationName, inServiceDate);
          workOrders = buildWorkOrders(unit, maintenanceAsset, rng);
          maintenanceIsSample = true;
          workOrdersAreSample = true;
        }
      }

      let fixedAsset = {};
      let deprnSchedule = [];
      let fixedAssetIsSample = false;

      // Fusion Assets has no readable REST resource on this pod (see the probe
      // notes above), so everything this block produces is derived. The tab is
      // shown rather than withheld; the flag still switches the whole thing
      // off in one place if that call is reversed.
      const showFixedAssetTab = $page.variables.showFixedAssetTab === true;

      if (hasFixedAsset && showFixedAssetTab) {
        // Cost and in-service date come from the serial when they are known.
        // A single stated straight-line basis rather than a random pick: with
        // no live method from Fusion, varying it per serial invented a fact.
        const cost = deriveCost(unit, master, rng);
        const method = 'STL-5YR';
        deprnSchedule = buildDeprnSchedule(cost, inServiceDate, method);
        deprnSchedule.__method = method;
        fixedAsset = buildFixedAsset(
          unit, master, rng, locationName, deprnSchedule, cost, inServiceDate
        );
        // Only the derived half is a placeholder. A serial carrying a real
        // purchase price and in-service date reports real figures.
        fixedAssetIsSample = !(Number(unit.purchasePrice) > 0 && unit.inServiceDate);
      }

      // Project / task keyed in with "Edit Project & Task" live in this
      // browser until the serial has columns for them - unitProjectStore.js.
      $page.variables.unit               = ups.apply(unit, controlType, serialRefId);
      $page.variables.masterRecord       = master;
      $page.variables.locationName       = locationName;
      // The rail's Location / Subinventory rows bind to these two, which were
      // declared but never assigned — so both have always rendered '—' regardless
      // of the data. Wired up here alongside Current Location below, because a new
      // populated row sitting next to two permanently blank ones reads as a bug.
      $page.variables.displayLocation     = locationName;
      $page.variables.displaySubinventory = unit.currentSubinventory || '';
      $page.variables.displayCurrentLocation = currentOrgName;
      $page.variables.maintenanceAsset   = maintenanceAsset;
      $page.variables.fixedAsset         = fixedAsset;
      $page.variables.workOrdersArray    = workOrders;
      $page.variables.deprnScheduleArray = deprnSchedule.slice ? deprnSchedule.slice() : [];
      $page.variables.hasMaintenanceAsset = hasMaintenance;
      $page.variables.hasFixedAsset       = hasFixedAsset && showFixedAssetTab;

      // Tab list is rebuilt each entry so the switch takes effect without a
      // second place to edit.
      const tabs = [
        { id: 'overview',    label: 'OVERVIEW',          icon: 'oj-ux-ico-information-s' },
        { id: 'maintenance', label: 'MAINTENANCE ASSET', icon: 'oj-ux-ico-wrench' }
      ];
      if (showFixedAssetTab) {
        tabs.push({ id: 'fixedasset', label: 'FIXED ASSET', icon: 'oj-ux-ico-bank' });
      }
      $page.variables.tabsArray = tabs;

      // A stale selection would leave the pane blank with no tab to return to.
      if (!showFixedAssetTab && $page.variables.selectedTab === 'fixedasset') {
        $page.variables.selectedTab = 'overview';
      }

      // Chips are per-panel and self-clearing: whichever panel Fusion actually
      // answered for loses its chip without anyone editing code.
      $page.variables.maintenanceIsSample = maintenanceIsSample;
      $page.variables.workOrdersAreSample = workOrdersAreSample;
      $page.variables.workOrdersUnavailable = workOrdersUnavailable;
      $page.variables.workOrdersMatchedOn = workOrdersMatchedOn;
      $page.variables.fixedAssetIsSample   = fixedAssetIsSample;

      $page.variables.pageTitle    = unit.serialNumber || 'Equipment Unit';
      $page.variables.pageSubtitle = master.equipmentName || '';

      $page.variables.isLoading = false;
    }
  }

  return vbEnterChain;
});
