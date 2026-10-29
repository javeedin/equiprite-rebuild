define([], function() {
  'use strict';

  var PageModule = function PageModule() {
    this._imageObjCache = {};
  };

  // Memoized: same URL string → same object reference. Prevents oj-sp-card from
  // re-attaching its <img> on unrelated reactive updates (e.g. checkbox toggle).
  PageModule.prototype.imageObj = function(imageUrl, appPath, equipmentId) {
    var raw = imageUrl || 'resources/images/equipment-placeholder.png';
    // Absolute (http/https) and base64 data: URIs are used as-is; the backend
    // can inline small thumbnails as data: URIs so the catalog returns image
    // bytes in the single catalog call (zero per-card image requests). Only
    // app-relative paths get $application.path prepended.
    var src = (/^(https?:|data:)/.test(raw)) ? raw : ((appPath || '') + raw);
    if (!this._imageObjCache[src]) {
      this._imageObjCache[src] = { src: src };
    }
    return this._imageObjCache[src];
  };

  // ── SDP+DPV helpers (declared in page JSON "functions") ──────────────
  // The catalog grid is now fed by the SDP, whose rows are NOT mutated in a
  // chain. So per-card derived values (class/subclass name, cart qty, badges)
  // are computed in the template via these functions.

  PageModule.prototype.classNameFor = function(equipmentClassId, classesById) {
    if (equipmentClassId == null || !classesById) return '';
    return classesById[equipmentClassId] || classesById[Number(equipmentClassId)] || '';
  };

  PageModule.prototype.subclassNameFor = function(equipmentSubclassId, subclassesById) {
    if (equipmentSubclassId == null || !subclassesById) return '';
    return subclassesById[equipmentSubclassId] || subclassesById[Number(equipmentSubclassId)] || '';
  };

  // Staged (pre-cart) qty shown in the card stepper. Reads the pendingQtyById
  // map keyed by equipment id.
  PageModule.prototype.stagedQtyFor = function(equipmentId, pendingQtyById) {
    if (!pendingQtyById) return 0;
    var v = pendingQtyById[equipmentId];
    if (v == null) v = pendingQtyById[Number(equipmentId)];
    return v != null ? v : 0;
  };

  // Card price line. The label depends on whether the equipment is RENTABLE or a
  // CONSUMABLE, driven by the catalog endpoint's boolean row.isRentable. Only an
  // explicit false marks a consumable — a missing flag falls through to the
  // rentable path so priced rentables never regress.
  //
  //   • RENTABLE  → "Rate": row.rate, a SINGLE per-day amount the catalog endpoint
  //     has already resolved for the requested startDate/endDate window. Rates are
  //     always per day; the daily amount just gets cheaper as the duration crosses
  //     the rate schedule's thresholds (e.g. a 7-day window on a crane returns the
  //     weekly-threshold rate 500, not 600). The server does that resolution — the
  //     frontend renders the number as-is and MUST NOT re-derive or label a tier.
  //     Null when no rate schedule covers the equipment → "Rate on request" rather
  //     than a bogus $0.
  //   • CONSUMABLE → "Unit Price": row.unitPrice, a single per-unit amount. It is
  //     null for any consumable whose class has no rate-period line yet, in which
  //     case we show "Unit price not set" rather than a bogus $0.
  PageModule.prototype.formatCatalogRate = function(row, hideRatesForQuote) {
    if (!row) return '';

    // QUOTED REQUESTS SHOW NO PRICE. When ENABLE_QUOTES covers this request's
    // origin the amount is settled on the quote, by a manager who can still
    // adjust markup and per-line rates — so publishing a catalog figure here
    // would anchor the customer on a number the quote may not honour.
    // Checked BEFORE the consumable branch so unit prices are suppressed too:
    // a consumable on a quoted request is just as much a price.
    // hideRatesForQuote is resolved in CatalogInitChain (the page module cannot
    // reach $application) and defaults to false, so rates stay visible unless
    // quoting is positively enabled for this origin.
    if (hideRatesForQuote) return 'Rate on request';

    // ONE amount only — the price as the business quotes it:
    //
    //   rentable   $3,200 / WEEK     (periodAmount / periodType)
    //   consumable $12.50 / unit     (unitPrice)
    //
    // The derived per-day rate is deliberately NOT shown alongside it. It is an
    // internal figure (periodAmount ÷ threshold, carried to 4 dp so the engine's
    // day-by-day billing lands exactly) and pairing it with the period turned
    // every card into two numbers the user has to reconcile. A base-tier line
    // already reads "$270 / DAY", so the daily case is not lost — it is simply
    // what the period IS there.
    if (row.isRentable === false) {
      // A consumable is priced per unit purchased, not per period — rateUom is
      // null on these rows, so "/ unit" is the right suffix.
      return row.unitPrice != null
        ? '$' + this._fmtAmt(row.unitPrice) + ' / unit'
        : 'Unit price not set';
    }
    if (row.rate == null) return 'Rate on request';

    // The period label comes from periodType (DAILY/WEEKLY/MONTHLY), NOT rateUom
    // — rateUom is the unit the RATE is quoted in (always DAY), so using it here
    // would label a weekly price "/ DAY".
    //
    // Displayed as the noun (WEEK) rather than the adjective the API sends
    // (WEEKLY), because "$3,200 / WEEKLY" doesn't read as a price.
    var uom = this._periodNoun(row.periodType);

    // Fall back to the rate when no period amount was resolved — legacy rate
    // lines carry none, and the catalog view leaves it null there. Suffixed with
    // the row's own rateUom rather than a hardcoded "/ day", so a schedule
    // priced per HOUR follows without a change here.
    if (row.periodAmount == null) {
      var rateUom = (row.rateUom || '').toString().trim().toUpperCase();
      return '$' + this._fmtAmt(row.rate) + (rateUom ? ' / ' + rateUom : '');
    }

    return '$' + this._fmtAmt(row.periodAmount) + (uom ? ' / ' + uom : '');
  };

  // Price-field caption for a card, so the card/summary can render an explicit
  // "Rate" vs "Unit Price" label above/beside the amount. Same boolean
  // isRentable convention as formatCatalogRate (only an explicit false ==
  // consumable). Just "Rate", not "Daily Rate": formatCatalogRate already
  // renders the "/ day" unit, and the duration-resolved amount shouldn't be
  // captioned with a tier name.
  PageModule.prototype.priceFieldLabel = function(row) {
    return (row && row.isRentable === false) ? 'Unit Price' : 'Rate';
  };

  // PERIOD_TYPE (DAILY | WEEKLY | MONTHLY) -> the noun a price reads with
  // (DAY | WEEK | MONTH). Private helper; not exposed in page "functions".
  //
  // Anything unrecognised is passed through upper-cased rather than blanked, so
  // a new period type added server-side still renders something truthful
  // instead of silently losing the unit.
  PageModule.prototype._periodNoun = function(periodType) {
    var t = (periodType || '').toString().trim().toUpperCase();
    if (!t) return '';
    var NOUNS = { DAILY: 'DAY', WEEKLY: 'WEEK', MONTHLY: 'MONTH', HOURLY: 'HOUR', YEARLY: 'YEAR' };
    return NOUNS[t] || t;
  };

  // Thousands-separated amount (private helper; not exposed in page "functions").
  PageModule.prototype._fmtAmt = function(n) {
    var v = Number(n);
    if (isNaN(v)) return '0';
    return v.toLocaleString('en-US');
  };

  // Whether a card's checkbox should be checked.
  //
  // Reads ONE key out of the selectedById map instead of scanning the
  // selectedEquipmentKeys array, and deliberately takes NO selectionTick.
  // That is the whole point of the map. A tick is a variable every card's
  // :checked binding depends on, so bumping it invalidated all of them at
  // once: the catalog renders 306 rows and scroll-policy="loadMoreOnScroll"
  // never discards a loaded card, so one Select All re-evaluated 306 checkbox
  // bindings plus 306 card-class bindings in a single synchronous task and
  // froze the tab. The array scan was not the cost -- 306 indexOf calls is
  // ~0.1ms -- the 612 binding re-evaluations were.
  //
  // Keyed on the map, a row's binding re-runs only when ITS key changes, so
  // toggling one card re-renders one card. This matches how the datagrid
  // pages already do it (a Set + isRowSelected(rowIndex)); the catalog was the
  // outlier, and the only page with enough rows for that to matter.
  //
  // Every writer must rebuild selectedById as a NEW object -- VB publishes a
  // change by reference, so mutating the existing map in place updates nothing.
  // Use buildSelectedById below rather than hand-rolling that.
  PageModule.prototype.isEquipmentSelected = function(equipmentId, selectedById) {
    if (!selectedById || equipmentId == null) return false;
    return selectedById[Number(equipmentId)] === true;
  };

  // Build a selectedById map from a list of ids. Single definition of the
  // shape, so the chains that write selection cannot drift from what the
  // binding above reads. Keys are Numbers, matching isEquipmentSelected's
  // Number(equipmentId) lookup -- a String key would silently never match.
  PageModule.prototype.buildSelectedById = function(ids) {
    var map = {};
    (ids || []).forEach(function(id) { map[Number(id)] = true; });
    return map;
  };

  PageModule.prototype.isInCart = function(equipmentId, cartItems) {
    return (cartItems || []).some(function(ci) { return Number(ci.id) === Number(equipmentId); });
  };

  // Whether a template-preview line's checkbox should be checked. Mirrors
  // isEquipmentSelected — previewSelectionTick only forces the native :checked
  // binding to re-evaluate when the preview selection Set changes.
  PageModule.prototype.isPreviewLineSelected = function(equipmentMasterId, previewSelectedKeys /*, previewSelectionTick */) {
    if (!previewSelectedKeys || equipmentMasterId == null) return false;
    return previewSelectedKeys.indexOf(Number(equipmentMasterId)) >= 0;
  };

  PageModule.prototype.isOnAgreement = function(equipmentId, fromAgreementId, agreementLineIdByEquipmentId) {
    if (!fromAgreementId || !agreementLineIdByEquipmentId) return false;
    return Object.prototype.hasOwnProperty.call(agreementLineIdByEquipmentId, String(equipmentId)) ||
           Object.prototype.hasOwnProperty.call(agreementLineIdByEquipmentId, Number(equipmentId));
  };

  return PageModule;
});
