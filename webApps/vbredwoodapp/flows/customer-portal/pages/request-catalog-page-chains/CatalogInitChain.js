define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/draftStorage',
  'resources/js/fetchAllPages',
], function(ActionChain, Actions, draftStorage, paging) {
  'use strict';

  class CatalogInitChain extends ActionChain {
    async run(context) {
      var $page = context.$page;
      var $flow = context.$flow;

      // ── 0. Hydrate from localStorage if a persisted draft exists (refresh / cross-tab resume).
      // Always prefer the saved draft over VBCS default initialization, since
      // request.* defaults (creditLimit, budget, etc.) would otherwise make the
      // variable look populated and silently swallow user-typed fields.
      if (draftStorage.hasStoredDraft('request')) {
        $flow.variables.request = draftStorage.load('request');
      }
      if (draftStorage.hasStoredDraft('ActiveRequestDetail')) {
        $flow.variables.ActiveRequestDetail = draftStorage.load('ActiveRequestDetail');
      }
      if (draftStorage.hasStoredDraft('requestOrigin')) {
        $flow.variables.requestOrigin = draftStorage.load('requestOrigin');
      }
      if (draftStorage.hasStoredDraft('CartItemsArray')) {
        $flow.variables.CartItemsArray = draftStorage.load('CartItemsArray');
      }
      // Agreement context — must also survive refresh so strict-mode filter stays
      // applied. GATED: only hydrate agreement scope when the AGREEMENTS feature is
      // enabled (fail closed while flags load). When off, any stale stored agreement
      // context is ignored so the catalog is never agreement-scoped.
      var _flags = (context.$application && context.$application.variables.featureFlags) || {};
      var _flagsLoaded = context.$application && context.$application.variables.flagsLoaded === true;
      if (_flagsLoaded && _flags.AGREEMENTS_ENABLED === 'true') {
        if (draftStorage.hasStoredDraft('fromAgreementId')) {
          $flow.variables.fromAgreementId = draftStorage.load('fromAgreementId');
        }
        if (draftStorage.hasStoredDraft('fromAgreementNumber')) {
          $flow.variables.fromAgreementNumber = draftStorage.load('fromAgreementNumber');
        }
        if (draftStorage.hasStoredDraft('fromAgreementCustomer')) {
          $flow.variables.fromAgreementCustomer = draftStorage.load('fromAgreementCustomer');
        }
        if (draftStorage.hasStoredDraft('agreementLineIdByEquipmentId')) {
          $flow.variables.agreementLineIdByEquipmentId = draftStorage.load('agreementLineIdByEquipmentId');
        }
        if (draftStorage.hasStoredDraft('agreementClassIds')) {
          $flow.variables.agreementClassIds = draftStorage.load('agreementClassIds');
        }
      }

      // ── Agreement scope ──────────────────────────────────────────────
      // When this request came from a rental agreement, the catalog endpoint
      // is scoped + repriced server-side via equipmentSDP's agreementId
      // uriParameter (bound to $flow.variables.fromAgreementId, hydrated above).
      // No in-memory dataset is built here — the SDP returns only the
      // agreement's equipment, at the negotiated rates, with onAgreement set per
      // row. The sidebar class/subclass filters compose with that scope.

      // ── 1. Filter VOCABULARY — full class + subclass sets ────────────
      // These populate the Class/Subclass dropdowns + sidebar tree. They are
      // page-INDEPENDENT: with server-side pagination the loaded page holds only
      // `pageSize` rows, so filter options must come from the complete reference
      // data, NOT from the visible equipment. Fetched in parallel.
      var [classesResp, subResp] = await Promise.all([
        // Every class, not the first page: getEquipmentClasses pages at 20 and
        // there are 21, so a single call dropped the 21st (2026-10-06).
        paging.fetchAllPages(o => Actions.callRest(context, o),
          'eqp-v1/getEquipmentClasses', {}, 'getEquipmentClasses')
          .then(rows => ({ ok: true, body: { data: rows } })),
        Actions.callRest(context, {
          endpoint: 'eqp-v1/getAllSubclasses',
          uriParams: { page: 0, size: 10000 }
        })
      ]);

      var classes = (classesResp.ok && classesResp.body && Array.isArray(classesResp.body.data))
        ? classesResp.body.data
        : (Array.isArray(classesResp.body && classesResp.body.items) ? classesResp.body.items : []);
      var subRows = (subResp && subResp.ok && subResp.body && Array.isArray(subResp.body.data))
        ? subResp.body.data
        : (Array.isArray(subResp.body && subResp.body.items) ? subResp.body.items : []);

      // Dropdown options — value = ID so the smart-search chips carry the id the
      // server-side filter needs (label stays the human name).
      $page.variables.ClassOptionsArray = classes
        .map(function(c) { return { value: c.id, label: c.className }; })
        .sort(function(a, b) { return String(a.label).localeCompare(String(b.label)); });
      $page.variables.SubclassOptionsArray = subRows
        .map(function(s) { return { value: s.id, label: s.subclassName, classId: s.eqrEquipmentClassId }; })
        .sort(function(a, b) { return String(a.label).localeCompare(String(b.label)); });
      // Starts as a copy of the full list (no Class selected yet) — scoped
      // down by CatalogFilterCriterionChangedChain once a Class chip/sidebar
      // row is picked. This is what the Subclass CHIP itself binds to.
      $page.variables.SubclassOptionsFilteredArray = $page.variables.SubclassOptionsArray.slice();
      // Asset groups (synced from Fusion Maintenance). The catalog filters
      // server-side on ?assetGroupId: items with at least one active asset in
      // the group (EQR_ASSET_GROUP_ITEM_V). Ended groups are left out.
      var today = new Date().toISOString().slice(0, 10);
      var groups = await paging.fetchAllPages(o => Actions.callRest(context, o),
        'eqp-v1/getAssetGroups', {}, 'getAssetGroups');
      $page.variables.AssetGroupOptionsArray = groups
        .filter(function(g) { return g && !(g.inactiveOnDate && String(g.inactiveOnDate).slice(0, 10) <= today); })
        .map(function(g) { return { value: g.id, label: g.groupName || g.groupNumber || ('Group ' + g.id) }; })
        .sort(function(a, b) { return String(a.label).localeCompare(String(b.label)); });
      // Status is a COMPUTED enum from EQR_AVAILABILITY_PKG (no LOV endpoint to
      // fetch from), so it's hardcoded here. These are the actual values the
      // engine emits — must match the catalog row's availabilityStatus exactly,
      // since the filter sends ?status=<value> server-side. (Previously listed
      // 'PARTIAL AVAILABLE', which the engine never returns → matched nothing.)
      $page.variables.StatusOptionsArray = [
        { value: 'AVAILABLE',        label: 'AVAILABLE' },
        { value: 'PARTIAL DURATION', label: 'PARTIAL DURATION' },
        { value: 'PARTIAL QUANTITY', label: 'PARTIAL QUANTITY' },
        { value: 'NOT AVAILABLE',    label: 'NOT AVAILABLE' }
      ];

      // id -> name maps for the card templates (SDP rows carry only the ids).
      var classesById = {};
      classes.forEach(function(c) { if (c.id != null) classesById[c.id] = c.className || ''; });
      $page.variables.classesById = classesById;

      var subclassesById = {};
      subRows.forEach(function(s) { if (s.id != null) subclassesById[s.id] = s.subclassName || ''; });
      $page.variables.subclassesById = subclassesById;

      // Sidebar class -> subclass tree, built from the full vocabulary.
      var subsByClassId = new Map();
      subRows.forEach(function(s) {
        var cid = Number(s.eqrEquipmentClassId);
        if (!subsByClassId.has(cid)) subsByClassId.set(cid, []);
        subsByClassId.get(cid).push({ subClassName: s.subclassName, subclassId: s.id, className: null });
      });
      var tree = classes.map(function(c) {
        var subs = (subsByClassId.get(Number(c.id)) || [])
          .map(function(s) { return { subClassName: s.subClassName, subclassId: s.subclassId, className: c.className, count: 0 }; })
          .sort(function(a, b) { return String(a.subClassName).localeCompare(String(b.subClassName)); });
        return { className: c.className, classId: c.id, count: 0, subClasses: subs };
      }).sort(function(a, b) { return String(a.className).localeCompare(String(b.className)); });
      $page.variables.categoryTree = tree;

      // ── Hide rates when this request will be quoted ─────────────────────
      // When ENABLE_QUOTES covers this request's ORIGIN, the customer is meant
      // to receive a quote — the price is decided there, by a manager who can
      // still adjust markup and per-line rates. Showing a catalog amount first
      // pre-empts that: the user anchors on a number that the quote may not
      // match. So with quoting on for this origin the cards (and the cart) show
      // "Rate on request" and no amount at all.
      //
      // Resolved HERE because the page module can't reach $application, and
      // cached on a page variable — the same arrangement request-detail-page
      // uses for its own quotingAllowed.
      //
      // The origin is the REQUEST TYPE ('EXTERNAL' | 'INTERNAL'), with
      // requestOrigin as the fallback for the customer flow, which has no Request
      // Type picker. isQuotingAllowed() owns the mapping from that origin plus
      // the ENABLE_QUOTES setting (NONE | PROJECTS | CUSTOMER | BOTH), so the
      // policy lives in exactly one place.
      //
      // Fails CLOSED — false while settings load, i.e. rates are SHOWN. That is
      // the deliberate direction: the pre-existing behaviour is to show rates,
      // and a slow settings load shouldn't blank every price on the page.
      var _req0 = $flow.variables.request || {};
      var _origin = String(_req0.requestType || '').toUpperCase();
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

      // Fusion PPM prices rentals (global flag): show its text instead of any
      // EquipRite list price. Wins over the quote rule above.
      $page.variables.ppmRateText = context.$application
        ? context.$application.functions.ppmRateText(
            context.$application.variables.featureFlags,
            context.$application.variables.flagsLoaded)
        : '';

      // Inject date params into the SDP only when dates are present.
      // Keeping them out of the JSON defaultValue prevents VB from serializing
      // undefined as the literal string "undefined" in the URL.
      var req = $flow.variables.request || {};
      if (req.startDate && req.endDate) {
        $page.variables.equipmentSDP.uriParameters.startDate = String(req.startDate).substring(0, 10);
        $page.variables.equipmentSDP.uriParameters.endDate   = String(req.endDate).substring(0, 10);
        $page.variables.equipmentSDP.uriParameters.requestedQty = 1;
      }

      // Rate-scoping context — inject ONLY when present, for the SAME reason as
      // the dates above: a JSON defaultValue expression that resolves to
      // undefined is serialized as the literal string "undefined" in the URL
      // (?projectRefId=undefined), which the int64 param can't parse → empty
      // grid. Omitting the key entirely makes the backend resolve rates from the
      // application-wide blanket schedule. projectRefId comes off the request
      // (Fusion project id, same value SubmitRequestChain sends); customerRefId
      // off the customer-mode form snapshot (ActiveRequestDetail).
      if (req.projectId != null) {
        $page.variables.equipmentSDP.uriParameters.projectRefId = Number(req.projectId);
      }
      var _detail = $flow.variables.ActiveRequestDetail || {};
      if (_detail.customerRefId != null) {
        $page.variables.equipmentSDP.uriParameters.customerRefId = Number(_detail.customerRefId);
      }

      // Delivery coordinates — lets the backend price each item from the yard
      // NEAREST the delivery address instead of the default schedule. Resolved
      // on the create-request page (map-picked point, or geocoded from the
      // chosen ship-to address) and carried on the request.
      //
      // Injected conditionally for the SAME reason as the dates/ids above: a
      // JSON defaultValue expression resolving to undefined serializes as the
      // literal string "undefined" in the URL, which a numeric param can't
      // parse. Sent only as a PAIR — one coordinate alone is meaningless and
      // could make the backend compute a nonsense distance.
      if (req.locationLatitude != null && req.locationLongitude != null) {
        $page.variables.equipmentSDP.uriParameters.latitude  = Number(req.locationLatitude);
        $page.variables.equipmentSDP.uriParameters.longitude = Number(req.locationLongitude);
      }

      // Equipment rows themselves are fetched by the SDP+DPV once the list-view
      // binds to equipmentDPV.instance — no explicit row fetch here. Selection
      // highlight still comes from the persisted cart.
      var cartItems = $flow.variables.CartItemsArray || [];
      var cartIds = cartItems.map(function(ci) { return Number(ci.id); });
      $page.variables.selectedEquipmentKeys = cartIds;
      // Seed the keyed map the card :checked bindings read, so cart items show
      // as checked on first render without a tick.
      $page.variables.selectedById = $page.functions.buildSelectedById(cartIds);

      // Seed the per-card staging qty from the pre-loaded cart so the card
      // steppers reflect the cart quantity (e.g. agreement Path A pre-loads
      // qty 1). Without this, selection highlights show but steppers read 0
      // because stagedQtyFor() reads pendingQtyById, which was never seeded.
      var seededQty = {};
      cartItems.forEach(function(ci) {
        var id = Number(ci.id);
        if (!isNaN(id)) seededQty[id] = (ci.quantity != null ? Number(ci.quantity) : 1);
      });
      $page.variables.pendingQtyById = seededQty;

      // Template HEADERS are NOT loaded here — they're fetched lazily the first
      // time the user opens the Templates dialog (CatalogTemplatesChain) and
      // cached in templatesArray, so the catalog's initial load makes no
      // template call. Template lines are lazier still (per-template, on preview).
    }
  }

  return CatalogInitChain;
});
